/* ══════════════════════════════════════════════════════
   RUTALIMPIA — route-playback.js
   Lógica pura para «ver cómo se recorre la ruta» y mostrársela al chofer:
   posición del camión a lo largo del trazo, en qué indicación va, indicaciones
   de respaldo cuando la ruta no trae las de la IA y la hoja imprimible / PDF.

   Sin DOM ni mapa: se prueba en Node (test/route-playback.test.mjs). La tarjeta
   con el mapa vive en route-player.js.

   Coordenadas siempre [lng, lat]. Una «indicación» (step) es
   { tipo:'recolectar'|'trasladar', calle, giro, metros, desde, hasta, texto },
   donde desde/hasta son índices del arreglo de coordenadas (los mismos que
   devuelve el servicio de IA: no se debe simplificar el trazo antes de animarlo).
══════════════════════════════════════════════════════ */

const R_M = 6371008.8;
const rad = d => d * Math.PI / 180;

export function haversineM(a, b) {
  const dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDeg(a, b) {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/** Metros acumulados en cada vértice (cum[0] = 0). */
export function cumulativeM(coords) {
  const cum = new Array(coords.length).fill(0);
  for (let i = 1; i < coords.length; i++) cum[i] = cum[i - 1] + haversineM(coords[i - 1], coords[i]);
  return cum;
}

/** Posición a `m` metros del inicio: { lng, lat, bearing, index }, con `index` = vértice previo. */
export function pointAt(coords, cum, m) {
  const last = coords.length - 1;
  if (last < 1) return { lng: coords[0][0], lat: coords[0][1], bearing: 0, index: 0 };
  const d = Math.max(0, Math.min(m, cum[last]));
  let lo = 0, hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid; else hi = mid;
  }
  const seg = cum[hi] - cum[lo];
  const f = seg > 0 ? (d - cum[lo]) / seg : 0;
  const a = coords[lo], b = coords[hi];
  return { lng: a[0] + (b[0] - a[0]) * f, lat: a[1] + (b[1] - a[1]) * f, bearing: bearingDeg(a, b), index: lo };
}

/** Índice de la indicación en la que está el vértice `coordIndex` (la última que ya empezó). */
export function stepIndexAt(steps, coordIndex) {
  if (!steps?.length) return -1;
  let found = 0;
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].desde <= coordIndex) found = i; else break;
  }
  return found;
}

/* ── Giros a partir de la geometría (rutas guardadas que no traen indicaciones) ── */

function resample(coords, stepM) {
  const out = [coords[0]];
  let pending = stepM;
  for (let i = 1; i < coords.length; i++) {
    const seg = haversineM(coords[i - 1], coords[i]);
    if (seg === 0) continue;
    let d = pending;
    while (d <= seg) {
      const f = d / seg;
      out.push([coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * f, coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * f]);
      d += stepM;
    }
    pending = d - seg;
  }
  return out;
}

const signedDelta = (a, b) => ((b - a + 540) % 360) - 180;

/**
 * Giros del trazo: cambio de rumbo ≥ 40° medido entre los 20 m anteriores y los 20 m
 * siguientes (una curva suave no cuenta y un giro no se cuenta dos veces). Mismo criterio
 * que app/metricas.py del servicio de IA. Devuelve [{ index, angle, kind }] con `index`
 * = vértice original más cercano.
 */
export function detectTurns(coords, { stepM = 5, windowM = 20, minDeg = 40, uDeg = 150 } = {}) {
  if (coords.length < 3) return [];
  const pts = resample(coords, stepM);
  const w = Math.max(1, Math.round(windowM / stepM));
  if (pts.length < 2 * w + 1) return [];
  const nearestIndex = p => {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < coords.length; i++) {
      const d = (coords[i][0] - p[0]) ** 2 + (coords[i][1] - p[1]) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };
  const angles = new Array(pts.length).fill(0);
  for (let k = w; k < pts.length - w; k++) {
    angles[k] = signedDelta(bearingDeg(pts[k - w], pts[k]), bearingDeg(pts[k], pts[k + w]));
  }
  const turns = [];
  let k = w;
  while (k < pts.length - w) {
    if (Math.abs(angles[k]) >= minDeg) {
      let j = k, best = k;
      while (j < pts.length - w && Math.abs(angles[j]) >= minDeg) {
        if (Math.abs(angles[j]) > Math.abs(angles[best])) best = j;
        j++;
      }
      const a = angles[best];
      turns.push({ index: nearestIndex(pts[best]), angle: a, kind: Math.abs(a) >= uDeg ? 'vuelta' : (a > 0 ? 'derecha' : 'izquierda') });
      k = j;
    } else k++;
  }
  return turns;
}

const TURN_TEXT = { derecha: 'Gira a la derecha', izquierda: 'Gira a la izquierda', vuelta: 'Da la vuelta' };

/** Indicaciones de respaldo (sin nombres de calle): inicio, cada giro y llegada. */
export function fallbackSteps(coords) {
  if (!coords?.length) return [];
  const cum = cumulativeM(coords);
  const turns = detectTurns(coords);
  const cuts = [0, ...turns.map(t => t.index), coords.length - 1];
  const steps = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const desde = cuts[i], hasta = cuts[i + 1];
    if (hasta <= desde) continue;
    const giro = i === 0 ? 'inicio' : turns[i - 1].kind;
    const metros = Math.round(cum[hasta] - cum[desde]);
    steps.push({
      tipo: 'recolectar', calle: null, giro, metros, desde, hasta,
      texto: `${i === 0 ? 'Comienza' : TURN_TEXT[giro]} y continúa ${metros} m.`,
    });
  }
  return steps;
}

/* ── Formato ── */

export const fmtKm = m => `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
export const fmtMin = min => {
  const m = Math.max(1, Math.round(min));
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
};
export const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Lo que la interfaz necesita de la respuesta de la IA (o de una ruta guardada):
 * trazo sin simplificar, indicaciones (las de la IA o de respaldo), métricas y calles a pie.
 */
export function normalizePlan({ coordinates, steps = null, metrics = null, skipped = null, notes = null, source = 'ia' }) {
  const coords = (coordinates || []).map(p => [Number(p[0]), Number(p[1])]);
  const hasSteps = Array.isArray(steps) && steps.length > 0;
  return {
    coords,
    cum: cumulativeM(coords),
    steps: hasSteps ? steps : fallbackSteps(coords),
    hasNames: hasSteps,
    metrics: metrics || null,
    skipped: Array.isArray(skipped) ? skipped : [],
    notes: notes || null,
    source,
  };
}

/* ── Hoja imprimible / PDF ── */

export function projector(points, width, height, pad = 24) {
  const lat0 = points.reduce((s, p) => s + p[1], 0) / points.length;
  const kx = Math.cos(rad(lat0));
  const xs = points.map(p => p[0] * kx), ys = points.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min((width - 2 * pad) / Math.max(maxX - minX, 1e-9), (height - 2 * pad) / Math.max(maxY - minY, 1e-9));
  const offX = (width - (maxX - minX) * scale) / 2, offY = (height - (maxY - minY) * scale) / 2;
  return p => [offX + (p[0] * kx - minX) * scale, height - (offY + (p[1] - minY) * scale)];
}

const pathOf = (pts, proj) => pts.map((p, i) => `${i ? 'L' : 'M'}${proj(p).map(v => v.toFixed(1)).join(' ')}`).join(' ');

/** Esquema en SVG de la ruta (sin mapa de fondo): recorrido, traslados, calles a pie, inicio y fin. */
export function routeSvg(plan, { zone = null, color = '#2563eb', width = 760, height = 520 } = {}) {
  const all = [...plan.coords, ...(zone || []), ...plan.skipped.flatMap(s => s.coordinates || [])];
  const proj = projector(all, width, height);
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Esquema de la ruta">`,
    `<rect width="${width}" height="${height}" fill="#f8fafc" stroke="#cbd5e1"/>`];
  if (zone?.length) parts.push(`<path d="${pathOf(zone, proj)}Z" fill="${color}" fill-opacity=".07" stroke="${color}" stroke-opacity=".5" stroke-dasharray="6 4"/>`);
  for (const s of plan.skipped) {
    if (s.coordinates?.length > 1) parts.push(`<path d="${pathOf(s.coordinates, proj)}" fill="none" stroke="#94a3b8" stroke-width="2" stroke-dasharray="3 3"/>`);
  }
  const steps = plan.steps.length ? plan.steps : [{ tipo: 'recolectar', desde: 0, hasta: plan.coords.length - 1 }];
  for (const st of steps) {
    const seg = plan.coords.slice(st.desde, st.hasta + 1);
    if (seg.length < 2) continue;
    const collect = st.tipo !== 'trasladar';
    parts.push(`<path d="${pathOf(seg, proj)}" fill="none" stroke="${collect ? color : '#64748b'}" stroke-width="${collect ? 4 : 2.5}" ${collect ? '' : 'stroke-dasharray="8 4"'} stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  const numbered = steps.length <= 60;
  steps.forEach((st, i) => {
    if (!numbered || i === 0 || !plan.coords[st.desde]) return;
    const [x, y] = proj(plan.coords[st.desde]);
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="8" fill="#0f172a"/><text x="${x.toFixed(1)}" y="${(y + 3.5).toFixed(1)}" font-size="9" font-weight="700" text-anchor="middle" fill="#fff">${i + 1}</text>`);
  });
  const [sx, sy] = proj(plan.coords[0]);
  const [ex, ey] = proj(plan.coords[plan.coords.length - 1]);
  parts.push(`<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="9" fill="#16a34a" stroke="#fff" stroke-width="3"/>`,
    `<circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="9" fill="#dc2626" stroke="#fff" stroke-width="3"/>`, '</svg>');
  return parts.join('');
}

/** Documento completo para imprimir o «Guardar como PDF». */
export function buildPrintHtml(plan, { title = 'Ruta de recolección', subtitle = '', zone = null, color = '#2563eb', dateText = '' } = {}) {
  const m = plan.metrics;
  const totalM = plan.cum[plan.cum.length - 1] || 0;
  const cifras = [
    ['Distancia', fmtKm(m ? m.km * 1000 : totalM)],
    m ? ['Tiempo estimado', fmtMin(m.minutos_camion)] : null,
    m ? ['Giros', `${m.giros} (0 vueltas en U)`] : null,
    m ? ['Calles a pie', `${m.calles_a_pie} (hasta ${m.max_a_ruta_m} m)`] : null,
  ].filter(Boolean);
  const filas = plan.steps.map((s, i) => `<tr class="${s.tipo === 'trasladar' ? 'tr' : ''}"><td>${i + 1}</td><td>${escapeHtml(s.texto)}</td><td class="n">${s.metros} m</td></tr>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font: 12px/1.45 system-ui, 'Segoe UI', Arial, sans-serif; color: #0f172a; margin: 0; }
  h1 { font-size: 20px; margin: 0 0 2px; } .sub { color: #475569; margin-bottom: 10px; }
  .cifras { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0; }
  .cifras div { border: 1px solid #cbd5e1; border-radius: 8px; padding: 6px 10px; } .cifras b { display: block; font-size: 15px; }
  .cifras span { color: #475569; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; } th, td { padding: 5px 6px; border-bottom: 1px solid #e2e8f0; text-align: left; vertical-align: top; }
  th { font-size: 10px; text-transform: uppercase; color: #475569; } td.n { text-align: right; white-space: nowrap; } tr.tr td { color: #64748b; }
  tr { break-inside: avoid; } .leyenda { font-size: 10px; color: #475569; margin-top: 4px; } .nota { margin-top: 10px; color: #475569; font-size: 10px; }
  @media print { .no-print { display: none; } }
  .no-print { position: fixed; top: 10px; right: 10px; padding: 8px 14px; font: inherit; cursor: pointer; }
</style></head><body>
<button class="no-print" onclick="window.print()">Imprimir / Guardar PDF</button>
<h1>${escapeHtml(title)}</h1><div class="sub">${escapeHtml(subtitle)}${dateText ? ` · ${escapeHtml(dateText)}` : ''}</div>
<div class="cifras">${cifras.map(([k, v]) => `<div><b>${escapeHtml(v)}</b><span>${escapeHtml(k)}</span></div>`).join('')}</div>
${routeSvg(plan, { zone, color })}
<div class="leyenda">Línea sólida: el camión recolecta · Línea punteada gruesa: traslado sin recolectar · Línea punteada fina: calles que atienden los recolectores a pie · Verde: inicio · Rojo: fin</div>
<table><thead><tr><th>#</th><th>Indicación</th><th class="n">Distancia</th></tr></thead><tbody>${filas}</tbody></table>
${plan.notes ? `<div class="nota">${escapeHtml(plan.notes)}</div>` : ''}
${m?.supuestos ? `<div class="nota">${escapeHtml(m.supuestos)}</div>` : ''}
</body></html>`;
}


/* ── Guardar el recorrido con la ruta (routes.ai_plan, SQL 009) ── */

const round5 = c => [Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5];
const MAX_SKIPPED = 400;

/** Lo que se guarda: indicaciones, cifras y calles a pie, más cuántos vértices tenía el trazo. */
export function packAiPlan(plan) {
  return {
    v: 1,
    n: plan.coords.length,
    steps: plan.steps,
    metrics: plan.metrics,
    skipped: plan.skipped.slice(0, MAX_SKIPPED).map(s => ({
      nombre: s.nombre ?? null, largo_m: s.largo_m ?? null, distancia_m: s.distancia_m ?? null,
      coordinates: (s.coordinates || []).map(round5),
    })),
    notes: plan.notes,
  };
}

/**
 * El plan de una ruta guardada. Las indicaciones apuntan a vértices del trazo: si el trazo cambió después
 * (aprendizaje, desvío) ya no encajan y se ignoran; se recurre a los giros detectados de la geometría.
 */
export function unpackAiPlan(stored, coordinates, { source = 'guardada' } = {}) {
  const fits = stored && stored.v === 1 && stored.n === coordinates.length && Array.isArray(stored.steps) && stored.steps.length > 0
    && stored.steps.every(s => Number.isInteger(s.desde) && Number.isInteger(s.hasta) && s.hasta < coordinates.length);
  return normalizePlan({
    coordinates,
    steps: fits ? stored.steps : null,
    metrics: fits ? stored.metrics : null,
    skipped: fits ? stored.skipped : null,
    notes: fits ? stored.notes : null,
    source,
  });
}
