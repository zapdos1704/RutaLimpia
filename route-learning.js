/* ══════════════════════════════════════════════════════
   RUTALIMPIA — route-learning.js
   Aprendizaje de rutas a partir del GPS del camión. Sin red ni Supabase: sólo
   geometría y estadística, para que se pruebe igual en el navegador y en Node.

   · buildTrace      → limpia las lecturas GPS de un día (saltos, duplicados, paradas).
   · routeFromTrace  → línea simplificada que representa el recorrido.
   · zoneFromRoute   → polígono que se adapta al recorrido (la «zona propia»).
   · buildTimeline   → línea del tiempo: a qué hora pasa el camión por cada tramo,
                       con la mediana de varios días.
   · etaForPoint     → hora estimada de paso cerca de un punto (para avisar a vecinos).
   · fitRouteToPoints→ ajusta el recorrido a un inicio y fin elegidos por la persona.
   · createDeviationTracker / spliceDetour → detectar que la ruta se movió y cambiarla.
   · rerouteAroundBlock → rodea un bloqueo con la alternativa más corta que lo evite.

   Coordenadas [lng, lat]. Tiempos en milisegundos (ts) o segundos del día (s).
══════════════════════════════════════════════════════ */

import {
  haversineM, polylineLengthM, pointInRing, ringSelfIntersects, ringAreaKm2,
  closeRing, distanceToSegmentM, rad, toXY, insideRatio,
} from './geo.js?v=fe162393';

const R = 6371000;
const isFiniteNum = Number.isFinite;

/* ── Línea preparada: longitudes acumuladas para medir «a lo largo» ── */

export function prepareLine(coords) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversineM(coords[i - 1], coords[i]));
  return { coords, cum, total: cum[cum.length - 1] || 0 };
}

/** Punto más cercano de la línea: { distM, alongM, point, index } (index = tramo). */
export function nearestOnLine(line, p) {
  const { coords, cum } = line;
  if (coords.length === 1) return { distM: haversineM(coords[0], p), alongM: 0, point: coords[0], index: 0 };
  const lat0 = p[1];
  const [px, py] = toXY(p, lat0);
  let best = { distM: Infinity, alongM: 0, point: coords[0], index: 0 };
  for (let i = 0; i < coords.length - 1; i++) {
    const [ax, ay] = toXY(coords[i], lat0);
    const [bx, by] = toXY(coords[i + 1], lat0);
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d < best.distM) {
      best = {
        distM: d,
        alongM: cum[i] + t * (cum[i + 1] - cum[i]),
        point: [coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t, coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t],
        index: i,
      };
    }
  }
  return best;
}

/** Punto a `alongM` metros del inicio. */
export function pointAlong(line, alongM) {
  const { coords, cum, total } = line;
  if (alongM <= 0) return coords[0];
  if (alongM >= total) return coords[coords.length - 1];
  let i = 1;
  while (i < cum.length - 1 && cum[i] < alongM) i++;
  const span = cum[i] - cum[i - 1] || 1;
  const k = (alongM - cum[i - 1]) / span;
  return [coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * k, coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * k];
}

/** Tramo de la línea entre dos distancias (en cualquier orden se devuelve de menor a mayor). */
export function sliceLine(line, fromM, toM) {
  const a = Math.max(0, Math.min(fromM, toM)), b = Math.min(line.total, Math.max(fromM, toM));
  const out = [pointAlong(line, a)];
  for (let i = 0; i < line.coords.length; i++) if (line.cum[i] > a && line.cum[i] < b) out.push(line.coords[i]);
  out.push(pointAlong(line, b));
  return out;
}

const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1];
const joinLines = (...parts) => parts.reduce((acc, part) => {
  for (const p of part) if (!acc.length || !samePoint(acc[acc.length - 1], p)) acc.push(p);
  return acc;
}, []);

/* ── 1. Limpiar el recorrido de un día ── */

const toMs = ts => (typeof ts === 'number' ? ts : Date.parse(ts));

/**
 * @param {Array<{lng:number,lat:number,ts:number|string}>} rows lecturas GPS
 * @returns {{points:Array<{lng,lat,ts}>, stops:Array<{lng,lat,ts,dwellS}>, distanceM:number}}
 */
export function buildTrace(rows, { maxSpeedKmh = 120, minStepM = 5, stopMinS = 120, stopRadiusM = 25 } = {}) {
  const valid = (rows || [])
    .map(r => ({ lng: Number(r.lng), lat: Number(r.lat), ts: toMs(r.ts) }))
    .filter(r => isFiniteNum(r.lng) && isFiniteNum(r.lat) && isFiniteNum(r.ts)
      && Math.abs(r.lat) <= 90 && Math.abs(r.lng) <= 180 && !(r.lat === 0 && r.lng === 0))
    .sort((a, b) => a.ts - b.ts);

  const accepted = [];
  for (const r of valid) {
    const prev = accepted[accepted.length - 1];
    if (prev) {
      const dt = (r.ts - prev.ts) / 1000;
      const d = haversineM([prev.lng, prev.lat], [r.lng, r.lat]);
      if (dt <= 0) continue;
      if (d / dt * 3.6 > maxSpeedKmh && d > 40) continue;   // salto de GPS
    }
    accepted.push(r);
  }

  /* Paradas: permanencia ≥ stopMinS dentro de un radio pequeño. */
  const stops = [];
  for (let i = 0; i < accepted.length;) {
    let j = i + 1;
    while (j < accepted.length && haversineM([accepted[i].lng, accepted[i].lat], [accepted[j].lng, accepted[j].lat]) <= stopRadiusM) j++;
    const dwell = (accepted[j - 1].ts - accepted[i].ts) / 1000;
    if (dwell >= stopMinS) stops.push({ lng: accepted[i].lng, lat: accepted[i].lat, ts: accepted[i].ts, dwellS: Math.round(dwell) });
    i = Math.max(j, i + 1);
  }

  const points = [];
  for (const r of accepted) {
    const prev = points[points.length - 1];
    if (!prev || haversineM([prev.lng, prev.lat], [r.lng, r.lat]) >= minStepM) points.push(r);
  }
  return { points, stops, distanceM: polylineLengthM(points.map(p => [p.lng, p.lat])) };
}

/* ── 2. Simplificar (Douglas–Peucker, en metros) ── */

export function simplifyLine(coords, toleranceM = 8) {
  if (coords.length <= 2) return coords.slice();
  const keep = new Uint8Array(coords.length);
  keep[0] = keep[coords.length - 1] = 1;
  const stack = [[0, coords.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distanceToSegmentM(coords[i], coords[s], coords[e]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx > 0 && maxD > toleranceM) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return coords.filter((_, i) => keep[i]);
}

export const routeFromTrace = (trace, toleranceM = 8) => simplifyLine(trace.points.map(p => [p.lng, p.lat]), toleranceM);

/* ── 3. Zona propia que se adapta al recorrido ── */

function convexHullXY(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper = [];
  for (const p of pts.slice().reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

const fromXY = (p, lat0) => [(p[0] / (R * Math.cos(rad(lat0)))) * (180 / Math.PI), (p[1] / R) * (180 / Math.PI)];

/** Contorno que rodea la línea a `widthM` de cada lado, con puntas redondeadas. */
function offsetOutline(xy, widthM) {
  const n = xy.length;
  const unit = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
  const normals = [];
  for (let i = 0; i < n; i++) {
    const d1 = i > 0 ? unit(xy[i - 1], xy[i]) : unit(xy[i], xy[i + 1]);
    const d2 = i < n - 1 ? unit(xy[i], xy[i + 1]) : d1;
    let nx = -(d1[1] + d2[1]), ny = d1[0] + d2[0];
    const nl = Math.hypot(nx, ny);
    if (nl < 1e-6) { nx = -d1[1]; ny = d1[0]; } else { nx /= nl; ny /= nl; }
    const cos = Math.max(0.5, nx * -d1[1] + ny * d1[0]);   // límite de inglete
    normals.push([nx, ny, widthM / cos]);
  }
  const left = xy.map((p, i) => [p[0] + normals[i][0] * normals[i][2], p[1] + normals[i][1] * normals[i][2]]);
  const right = xy.map((p, i) => [p[0] - normals[i][0] * normals[i][2], p[1] - normals[i][1] * normals[i][2]]);
  const cap = (center, from, to) => {
    const a0 = Math.atan2(from[1] - center[1], from[0] - center[0]);
    const a1 = Math.atan2(to[1] - center[1], to[0] - center[0]);
    let da = a1 - a0;
    while (da > 0) da -= 2 * Math.PI;   // gira hacia adelante de la línea
    const steps = 6, out = [];
    for (let k = 1; k < steps; k++) { const a = a0 + (da * k) / steps; out.push([center[0] + widthM * Math.cos(a), center[1] + widthM * Math.sin(a)]); }
    return out;
  };
  const endCap = cap(xy[n - 1], left[n - 1], right[n - 1]);
  const startCap = cap(xy[0], right[0], left[0]);
  return [...left, ...endCap, ...right.slice().reverse(), ...startCap];
}

/**
 * Polígono cerrado que envuelve el recorrido. Primero se intenta el contorno
 * «pegado» a la calle; si se cruza sobre sí mismo (recorridos en vuelta o con
 * giros cerrados) se usa el casco convexo del contorno, que siempre es válido.
 * @returns {{ring:Array, kind:'contorno'|'casco', areaKm2:number}}
 */
export function zoneFromRoute(coords, { widthM = 60, simplifyM = 15 } = {}) {
  if (!coords || coords.length < 2) throw new Error('Se necesita un recorrido con al menos dos puntos');
  const lat0 = coords.reduce((s, p) => s + p[1], 0) / coords.length;
  const line = simplifyLine(coords, simplifyM);
  const xy = line.map(p => toXY(p, lat0));

  let ring = null, kind = 'contorno';
  if (xy.length >= 2) {
    const outline = offsetOutline(xy, widthM).map(p => fromXY(p, lat0));
    const closed = closeRing(outline);
    if (!ringSelfIntersects(closed) && ringAreaKm2(closed) > 0) ring = closed;
  }
  if (!ring) {
    kind = 'casco';
    const around = [];
    for (const p of xy) for (let k = 0; k < 12; k++) {
      const a = (k / 12) * 2 * Math.PI;
      around.push([p[0] + widthM * Math.cos(a), p[1] + widthM * Math.sin(a)]);
    }
    ring = closeRing(convexHullXY(around).map(p => fromXY(p, lat0)));
  }
  return { ring, kind, areaKm2: ringAreaKm2(ring) };
}

/* ── 4. Línea del tiempo ── */

const secondsOfDay = ms => { const d = new Date(ms); return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds(); };
const median = list => { const s = list.slice().sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Segundos del día → "HH:MM". */
export const fmtClock = s => {
  if (!isFiniteNum(s)) return '—';
  const t = ((Math.round(s) % 86400) + 86400) % 86400;
  return `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}`;
};

/**
 * Hora (segundos del día) a la que un día concreto pasó por cada muestra de la
 * ruta base. Interpola entre lecturas; ignora las que quedan a más de `maxOffM`.
 */
function timesAlong(line, samples, dayPoints, maxOffM) {
  const seq = [];
  for (const p of dayPoints) {
    const near = nearestOnLine(line, [p.lng, p.lat]);
    if (near.distM <= maxOffM) seq.push({ along: near.alongM, ts: p.ts });
  }
  if (seq.length < 2) return samples.map(() => null);
  return samples.map(s => {
    if (s < seq[0].along - 40 || s > seq[seq.length - 1].along + 40) return null;
    for (let i = 1; i < seq.length; i++) {
      if (seq[i].along >= s) {
        const a = seq[i - 1], b = seq[i];
        const span = b.along - a.along;
        const k = span > 0 ? Math.max(0, Math.min(1, (s - a.along) / span)) : 1;
        return secondsOfDay(a.ts + (b.ts - a.ts) * k);
      }
    }
    return secondsOfDay(seq[seq.length - 1].ts);
  });
}

/**
 * Línea del tiempo del recorrido, con la mediana de todos los días recibidos.
 * @param {Array<Array<{lng,lat,ts}>>} days puntos limpios de cada día
 * @param {Array} baseCoords ruta base [[lng,lat],…]
 */
export function buildTimeline(days, baseCoords, { stepM = 150, maxOffM = 60, stops = [] } = {}) {
  const line = prepareLine(baseCoords);
  if (!line.total) throw new Error('La ruta base no tiene longitud');
  const samples = [];
  for (let d = 0; d < line.total; d += stepM) samples.push(d);
  samples.push(line.total);

  const perDay = days.map(day => timesAlong(line, samples, day, maxOffM));
  const points = [];
  samples.forEach((d, i) => {
    const values = perDay.map(t => t[i]).filter(v => v != null);
    if (!values.length) return;
    const [lng, lat] = pointAlong(line, d);
    points.push({ d: Math.round(d), lng: +lng.toFixed(6), lat: +lat.toFixed(6), s: Math.round(median(values)) });
  });
  if (points.length < 2) throw new Error('Los recorridos no cubren la ruta: no se pudo calcular la línea del tiempo');

  /* Las horas nunca retroceden a lo largo de la ruta. */
  for (let i = 1; i < points.length; i++) if (points[i].s < points[i - 1].s) points[i].s = points[i - 1].s;

  return {
    version: 1,
    tz: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; } })(),
    stepM,
    days: days.length,
    startS: points[0].s,
    endS: points[points.length - 1].s,
    lengthM: Math.round(line.total),
    points,
    stops: stops.map(s => ({ lng: +s.lng.toFixed(6), lat: +s.lat.toFixed(6), s: secondsOfDay(s.ts), dwellS: s.dwellS })),
  };
}

/**
 * Hora estimada en que el camión pasa cerca de un punto (p. ej. la casa de un
 * vecino). Devuelve null si el punto queda a más de `radiusM` de la ruta.
 * @returns {{s:number, clock:string, distM:number}|null}
 */
export function etaForPoint(timeline, point, { radiusM = 150 } = {}) {
  if (!timeline?.points?.length) return null;
  const line = prepareLine(timeline.points.map(p => [p.lng, p.lat]));
  const near = nearestOnLine(line, point);
  if (near.distM > radiusM) return null;
  const pts = timeline.points;
  let i = 1;
  while (i < pts.length - 1 && line.cum[i] < near.alongM) i++;
  const span = line.cum[i] - line.cum[i - 1] || 1;
  const k = Math.max(0, Math.min(1, (near.alongM - line.cum[i - 1]) / span));
  const s = pts[i - 1].s + (pts[i].s - pts[i - 1].s) * k;
  return { s: Math.round(s), clock: fmtClock(s), distM: Math.round(near.distM) };
}

/** Desfasa toda la línea del tiempo (retraso observado) a partir de un punto de la ruta. */
export function shiftTimeline(timeline, fromAlongM, deltaS) {
  return { ...timeline, points: timeline.points.map(p => (p.d >= fromAlongM ? { ...p, s: p.s + deltaS } : p)), endS: timeline.endS + deltaS };
}

/* ── 5. Ajustar el recorrido al inicio y fin elegidos ── */

/**
 * Recorta (y, si hace falta, invierte) el recorrido aprendido para que empiece
 * en `start` y termine en `end`. Devuelve también cuánto del resultado queda
 * dentro del polígono.
 */
export function fitRouteToPoints(routeCoords, start, end, ring = null) {
  const line = prepareLine(routeCoords);
  const a = nearestOnLine(line, start), b = nearestOnLine(line, end);
  const reversed = a.alongM > b.alongM;
  let piece = sliceLine(line, a.alongM, b.alongM);
  if (reversed) piece = piece.slice().reverse();
  const coords = joinLines([start], piece, [end]);
  return {
    coords,
    reversed,
    startOffM: Math.round(a.distM),
    endOffM: Math.round(b.distM),
    lengthM: Math.round(polylineLengthM(coords)),
    insideRatio: ring ? insideRatio(coords, ring) : null,
  };
}

/* ── 6. Desvíos: ¿la ruta se movió? ── */

/**
 * Máquina de estados con histéresis: sale de la ruta tras `needOff` lecturas a
 * más de `offM`, y regresa tras `needBack` lecturas a menos de `backM`.
 * update() devuelve null o { type:'off_route'|'back_on_route', ... }.
 */
export function createDeviationTracker({ offM = 60, backM = 40, needOff = 3, needBack = 3 } = {}) {
  let off = false, offCount = 0, backCount = 0, detour = [], exit = null, offSince = null;
  return {
    get isOff() { return off; },
    update(line, point, ts = Date.now()) {
      const near = nearestOnLine(line, point);
      if (!off) {
        if (near.distM > offM) {
          if (!offCount) exit = { alongM: near.alongM, point: near.point };
          offCount++; detour.push(point);
          if (offCount >= needOff) { off = true; offSince = ts; backCount = 0; return { type: 'off_route', distM: Math.round(near.distM), since: offSince, exitAlongM: exit.alongM }; }
        } else { offCount = 0; detour = []; exit = null; }
        return null;
      }
      detour.push(point);
      if (near.distM < backM) {
        backCount++;
        if (backCount >= needBack) {
          const event = { type: 'back_on_route', detour: detour.slice(), exitAlongM: exit.alongM, reenterAlongM: near.alongM, since: offSince, until: ts };
          off = false; offCount = 0; backCount = 0; detour = []; exit = null; offSince = null;
          return event;
        }
      } else backCount = 0;
      return null;
    },
    /** Camino recorrido fuera de la ruta hasta ahora. */
    currentDetour: () => detour.slice(),
    exitAlongM: () => exit?.alongM ?? null,
    reset() { off = false; offCount = 0; backCount = 0; detour = []; exit = null; offSince = null; },
  };
}

/**
 * Sustituye el tramo de la ruta que el camión dejó de seguir por el desvío real.
 * Si el desvío termina lejos de la ruta (`reenterAlongM` nulo) se corta ahí.
 */
export function spliceDetour(routeCoords, detour, { exitAlongM, reenterAlongM = null }) {
  const line = prepareLine(routeCoords);
  const head = sliceLine(line, 0, exitAlongM);
  if (reenterAlongM == null || reenterAlongM <= exitAlongM) return joinLines(head, detour);
  return joinLines(head, detour, sliceLine(line, reenterAlongM, line.total));
}

/* ── 7. Bloqueos ── */

function distanceToPolylineM(coords, p) {
  let best = Infinity;
  for (let i = 0; i < coords.length - 1; i++) best = Math.min(best, distanceToSegmentM(p, coords[i], coords[i + 1]));
  return best;
}

/**
 * Rodea un bloqueo. `fetchRoutes(points, {alternatives})` debe devolver una lista
 * de recorridos [[lng,lat],…] (OSRM). Se elige el más corto que quede a más de
 * `clearM` del bloqueo; si ninguno lo evita, se prueba pasando por un punto a un lado.
 * @returns {Promise<{ok:boolean, coords?:Array, detourM?:number, reason?:string}>}
 */
export async function rerouteAroundBlock(routeCoords, block, fetchRoutes, { clearM = 35, backM = 120, aheadM = 250, sideM = 160 } = {}) {
  const line = prepareLine(routeCoords);
  const at = nearestOnLine(line, block);
  if (at.distM > 80) return { ok: false, reason: 'El bloqueo no está sobre esta ruta.' };

  const fromAlong = Math.max(0, at.alongM - backM);
  const toAlong = Math.min(line.total, at.alongM + aheadM);
  if (toAlong - fromAlong < 60) return { ok: false, reason: 'El bloqueo está al final de la ruta.' };
  const from = pointAlong(line, fromAlong), to = pointAlong(line, toAlong);

  const clear = list => (list || []).filter(c => c?.length >= 2 && distanceToPolylineM(c, block) > clearM);
  const shortest = list => list.slice().sort((x, y) => polylineLengthM(x) - polylineLengthM(y))[0];

  let choice = shortest(clear(await fetchRoutes([from, to], { alternatives: true })));
  if (!choice) {
    const lat0 = block[1];
    const [bx, by] = toXY(block, lat0);
    const dir = at.index < routeCoords.length - 1 ? [
      toXY(routeCoords[at.index + 1], lat0)[0] - toXY(routeCoords[at.index], lat0)[0],
      toXY(routeCoords[at.index + 1], lat0)[1] - toXY(routeCoords[at.index], lat0)[1]] : [1, 0];
    const dl = Math.hypot(dir[0], dir[1]) || 1;
    for (const side of [1, -1]) {
      const via = fromXY([bx + (-dir[1] / dl) * sideM * side, by + (dir[0] / dl) * sideM * side], lat0);
      const found = shortest(clear(await fetchRoutes([from, via, to], { alternatives: false })));
      if (found && (!choice || polylineLengthM(found) < polylineLengthM(choice))) choice = found;
    }
  }
  if (!choice) return { ok: false, reason: 'No se encontró una calle alterna que evite el bloqueo.' };

  const coords = joinLines(sliceLine(line, 0, fromAlong), choice, sliceLine(line, toAlong, line.total));
  return { ok: true, coords, detourM: Math.round(polylineLengthM(choice) - (toAlong - fromAlong)), from, to };
}

/* ── 8. ¿Cambió lo bastante como para avisar? ── */

/**
 * Compara dos versiones de la ruta: distancia máxima entre ellas y cambio de
 * longitud. Sirve para decidir si vale la pena registrar un aviso.
 */
export function routeChange(before, after) {
  if (!before?.length || !after?.length) return { changed: true, maxOffM: Infinity, lengthDeltaM: 0 };
  let maxOff = 0;
  for (const p of after) maxOff = Math.max(maxOff, distanceToPolylineM(before, p));
  return { changed: maxOff > 40, maxOffM: Math.round(maxOff), lengthDeltaM: Math.round(polylineLengthM(after) - polylineLengthM(before)) };
}

/* ── 9. Recalcular la línea del tiempo tras un cambio de ruta ── */

/**
 * Da hora a una ruta nueva reutilizando la línea del tiempo anterior: donde la
 * nueva ruta coincide con la vieja (a ≤ `matchM`) se conserva su hora; el tramo
 * distinto (desvío o rodeo) se interpola entre las horas de sus extremos.
 */
export function retimeTimeline(oldTimeline, newCoords, { stepM = 150, matchM = 60 } = {}) {
  if (!oldTimeline?.points?.length) return null;
  const oldLine = prepareLine(oldTimeline.points.map(p => [p.lng, p.lat]));
  const newLine = prepareLine(newCoords);
  if (!newLine.total) return null;

  const samples = [];
  for (let d = 0; d < newLine.total; d += stepM) samples.push(d);
  samples.push(newLine.total);

  const timeAtOld = point => {
    const near = nearestOnLine(oldLine, point);
    if (near.distM > matchM) return null;
    const pts = oldTimeline.points;
    let i = 1;
    while (i < pts.length - 1 && oldLine.cum[i] < near.alongM) i++;
    const span = oldLine.cum[i] - oldLine.cum[i - 1] || 1;
    const k = Math.max(0, Math.min(1, (near.alongM - oldLine.cum[i - 1]) / span));
    return pts[i - 1].s + (pts[i].s - pts[i - 1].s) * k;
  };

  const times = samples.map(d => timeAtOld(pointAlong(newLine, d)));
  if (times.every(t => t == null)) return null;
  /* Los huecos se llenan por distancia entre el vecino anterior y el siguiente con hora. */
  for (let i = 0; i < times.length; i++) {
    if (times[i] != null) continue;
    let a = i - 1; while (a >= 0 && times[a] == null) a--;
    let b = i + 1; while (b < times.length && times[b] == null) b++;
    if (a < 0) times[i] = times[b];
    else if (b >= times.length) times[i] = times[a];
    else times[i] = times[a] + ((times[b] - times[a]) * (samples[i] - samples[a])) / ((samples[b] - samples[a]) || 1);
  }
  for (let i = 1; i < times.length; i++) if (times[i] < times[i - 1]) times[i] = times[i - 1];

  const points = samples.map((d, i) => {
    const [lng, lat] = pointAlong(newLine, d);
    return { d: Math.round(d), lng: +lng.toFixed(6), lat: +lat.toFixed(6), s: Math.round(times[i]) };
  });
  return { ...oldTimeline, lengthM: Math.round(newLine.total), startS: points[0].s, endS: points[points.length - 1].s, points, retimedAt: Date.now() };
}

/* ── 10. Recortar la ruta al polígono ── */

/** Tramo continuo más largo de la ruta que queda dentro del polígono (null si mide menos de minM). */
export function clipRouteToRing(coords, ring, { minM = 100 } = {}) {
  const runs = [];
  let cur = [];
  for (const p of coords) {
    if (pointInRing(p, ring)) cur.push(p);
    else { if (cur.length) runs.push(cur); cur = []; }
  }
  if (cur.length) runs.push(cur);
  let best = null, bestLen = 0;
  for (const run of runs) { const len = polylineLengthM(run); if (len > bestLen) { best = run; bestLen = len; } }
  return best && bestLen >= minM ? best : null;
}
