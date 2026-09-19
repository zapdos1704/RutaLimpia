/* ══════════════════════════════════════════════════════
   RUTALIMPIA — route-planning.js
   Planeación de rutas por zona: geometría, OSRM, guardado en Supabase y avisos
   de proximidad. Sin dependencias externas (todo el cálculo geográfico es local).

   Coordenadas siempre en formato GeoJSON [lng, lat].
   El backend es la migración 20260918_route_planning.sql (vista routes_geojson y
   función save_route_plan, que exige una sesión Supabase autenticada).
══════════════════════════════════════════════════════ */

import { sb } from './db.js';
import { getOsrmEndpoint } from './trail.js';

const LS_AI_KEY = 'rl_ai_routing_key';
const PUBLIC_OSRM = /router\.project-osrm\.org/i;
const REQUEST_TIMEOUT_MS = 20_000;

/* ── Geometría ─────────────────────────────────────── */

const rad = d => (d * Math.PI) / 180;

/** Distancia en metros entre dos puntos [lng, lat]. */
export function haversineM(a, b) {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Proyección plana local (metros) alrededor de una latitud: suficiente para zonas urbanas. */
const toXY = (p, lat0) => [
  rad(p[0]) * 6371000 * Math.cos(rad(lat0)),
  rad(p[1]) * 6371000,
];

/** ¿El punto cae dentro del anillo (ray casting)? El anillo puede venir cerrado o abierto. */
export function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) &&
        pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distancia en metros del punto al segmento a-b. */
function distanceToSegmentM(p, a, b) {
  const lat0 = p[1];
  const [px, py] = toXY(p, lat0);
  const [ax, ay] = toXY(a, lat0);
  const [bx, by] = toXY(b, lat0);
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Distancia en metros del punto al borde del anillo. */
export function distanceToRingM(p, ring) {
  let best = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    best = Math.min(best, distanceToSegmentM(p, ring[i], ring[i + 1]));
  }
  return best;
}

export function polylineLengthM(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += haversineM(coords[i - 1], coords[i]);
  return total;
}

/** Punto a `distM` metros del inicio de la línea. */
export function alongLine(coords, distM) {
  let remaining = distM;
  for (let i = 1; i < coords.length; i++) {
    const seg = haversineM(coords[i - 1], coords[i]);
    if (seg >= remaining && seg > 0) {
      const k = remaining / seg;
      return [
        coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * k,
        coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * k,
      ];
    }
    remaining -= seg;
  }
  return coords[coords.length - 1];
}

/** Anillo cerrado (primer punto repetido al final). */
export const closeRing = ring => {
  const first = ring[0], last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? ring.slice() : [...ring, first];
};

export function ringAreaKm2(ring) {
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const xy = closeRing(ring).map(p => toXY(p, lat0));
  let sum = 0;
  for (let i = 0; i < xy.length - 1; i++) sum += xy[i][0] * xy[i + 1][1] - xy[i + 1][0] * xy[i][1];
  return Math.abs(sum) / 2 / 1e6;
}

export function ringCentroid(ring) {
  const pts = closeRing(ring);
  const lat0 = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const xy = pts.map(p => toXY(p, lat0));
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < xy.length - 1; i++) {
    const cross = xy[i][0] * xy[i + 1][1] - xy[i + 1][0] * xy[i][1];
    a += cross;
    cx += (xy[i][0] + xy[i + 1][0]) * cross;
    cy += (xy[i][1] + xy[i + 1][1]) * cross;
  }
  if (!a) return pts[0];
  cx /= 3 * a; cy /= 3 * a;
  return [(cx / (6371000 * Math.cos(rad(lat0)))) * (180 / Math.PI), (cy / 6371000) * (180 / Math.PI)];
}

/** ¿Algún par de lados no contiguos se cruza? (polígono inválido) */
export function ringSelfIntersects(ring) {
  const pts = closeRing(ring);
  const n = pts.length - 1;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const hit = (p1, p2, p3, p4) => {
    const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2);
    const d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;   // primer y último lado comparten vértice
      if (hit(pts[i], pts[i + 1], pts[j], pts[j + 1])) return true;
    }
  }
  return false;
}

/** Fracción (0–1) de la ruta que queda dentro de la zona, muestreada a lo largo del trazo. */
export function insideRatio(routeCoords, ring) {
  const total = polylineLengthM(routeCoords);
  if (!total) return 0;
  const samples = Math.max(20, Math.min(80, Math.ceil((total / 1000) * 12)));
  let inside = 0;
  for (let i = 0; i <= samples; i++) {
    if (pointInRing(alongLine(routeCoords, total * (i / samples)), ring)) inside++;
  }
  return inside / (samples + 1);
}

/* ── OSRM ──────────────────────────────────────────── */

function osrmHeaders(endpoint) {
  if (PUBLIC_OSRM.test(endpoint)) return {};
  try {
    const key = localStorage.getItem(LS_AI_KEY) || '';
    return key ? { Authorization: `Bearer ${key}` } : {};
  } catch { return {}; }
}

async function osrm(path) {
  const endpoint = getOsrmEndpoint().replace(/\/$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${endpoint}${path}`, { signal: controller.signal, headers: osrmHeaders(endpoint) });
    if (res.status === 401) throw new Error('OSRM rechazó la clave de acceso. Captúrala en Nueva ruta → Trazo automático (IA).');
    if (!res.ok) throw new Error(`El servidor de rutas respondió ${res.status}. Revisa que la PC con OSRM esté encendida.`);
    const data = await res.json();
    if (data.code !== 'Ok') throw new Error(data.message || `OSRM respondió ${data.code}`);
    return data;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('OSRM agotó el tiempo de espera');
    if (err instanceof TypeError) throw new Error('No se pudo contactar al servidor de rutas: revisa que la PC con OSRM esté encendida y que este sitio esté autorizado en el puente.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const coordText = list => list.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';');

export async function snapToRoad(coord) {
  const data = await osrm(`/nearest/v1/driving/${coordText([coord])}?number=1`);
  return data.waypoints?.[0]?.location || null;
}

export async function fetchOSRMRoute(start, end) {
  const data = await osrm(`/route/v1/driving/${coordText([start, end])}?overview=full&geometries=geojson&steps=false`);
  const route = data.routes?.[0];
  if (!route?.geometry) throw new Error('OSRM no encontró una ruta entre los puntos');
  return { geometry: route.geometry, distanceMeters: route.distance, durationSeconds: route.duration };
}

/** Candidatos: puntos del contorno + el centro, ajustados a calles y dentro de la zona. */
function zoneCandidates(ring) {
  const closed = closeRing(ring);
  const perimeter = polylineLengthM(closed);
  const count = Math.max(6, Math.min(12, Math.ceil(perimeter / 350)));
  const out = [];
  for (let i = 0; i < count; i++) out.push(alongLine(closed, perimeter * (i / count)));
  const center = ringCentroid(ring);
  if (pointInRing(center, ring)) out.push(center);
  return out;
}

const uniqueCoords = list => {
  const seen = new Set();
  return list.filter(([lng, lat]) => {
    const key = `${lng.toFixed(5)},${lat.toFixed(5)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * Sugerencia determinista (no es un modelo entrenado): ajusta candidatos a
 * calles, compara distancias con `table` y elige el par cuya ruta cubra más
 * zona. Devuelve { start, end, geometry, distanceMeters, durationSeconds, insideRatio }.
 */
export async function suggestRouteForZone(ring) {
  const snapped = await Promise.all(zoneCandidates(ring).map(c => snapToRoad(c).catch(() => null)));
  const candidates = uniqueCoords(snapped.filter(c => c && pointInRing(c, ring)));
  if (candidates.length < 2) throw new Error('No se encontraron al menos dos calles transitables dentro de la zona');

  const table = await osrm(`/table/v1/driving/${coordText(candidates)}?annotations=distance`);
  const pairs = [];
  for (let a = 0; a < candidates.length; a++) {
    for (let b = a + 1; b < candidates.length; b++) {
      const d = Math.max(table.distances?.[a]?.[b] || 0, table.distances?.[b]?.[a] || 0);
      if (Number.isFinite(d) && d > 0) pairs.push({ a, b, d });
    }
  }
  if (!pairs.length) throw new Error('OSRM no encontró pares de calles conectados dentro de la zona');
  pairs.sort((x, y) => y.d - x.d);

  const evaluated = [];
  for (const pair of pairs.slice(0, 6)) {
    try {
      const route = await fetchOSRMRoute(candidates[pair.a], candidates[pair.b]);
      evaluated.push({ ...route, start: candidates[pair.a], end: candidates[pair.b],
        insideRatio: insideRatio(route.geometry.coordinates, ring) });
    } catch { /* se evalúan los demás pares */ }
  }
  if (!evaluated.length) throw new Error('OSRM no pudo construir una ruta para los candidatos');

  const mostlyInside = evaluated.filter(c => c.insideRatio >= 0.75);
  const ranked = mostlyInside.length ? mostlyInside : evaluated;
  ranked.sort((x, y) => y.insideRatio - x.insideRatio || y.distanceMeters - x.distanceMeters);
  return ranked[0];
}

/* ── Supabase ──────────────────────────────────────── */

const parseJson = v => {
  if (!v || typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
};

/** Rutas activas con zona, color, camión, inicio y fin. Lanza si la migración no está aplicada. */
export async function fetchRoutePlans() {
  const { data, error } = await sb.from('routes_geojson').select('*').eq('is_active', true).order('name');
  if (error) throw error;
  return (data || []).map(r => ({
    ...r,
    route_geojson: parseJson(r.route_geojson),
    zone_geojson: parseJson(r.zone_geojson),
    start_geojson: parseJson(r.start_geojson),
    end_geojson: parseJson(r.end_geojson),
  }));
}

/** Guarda la ruta con la función save_route_plan (solo usuarios autenticados). */
export async function saveRoutePlan(plan) {
  const { data: sessionData } = await sb.auth.getSession();
  if (!sessionData?.session) throw new Error('Debes iniciar sesión para guardar rutas');

  const { data, error } = await sb.rpc('save_route_plan', {
    p_name: plan.name,
    p_vehicle_id: plan.vehicleId || null,
    p_zone_geojson: { type: 'Polygon', coordinates: [closeRing(plan.ring)] },
    p_color: plan.color,
    p_start_lng: plan.start[0],
    p_start_lat: plan.start[1],
    p_end_lng: plan.end[0],
    p_end_lat: plan.end[1],
    p_route_geojson: plan.routeGeometry,
    p_planning_mode: plan.mode,
    p_description: plan.description || null,
    p_route_type: plan.routeType || 'residential',
  });
  if (error) throw error;
  return data;
}

/* ── Avisos de proximidad ──────────────────────────── */

const previousStates = new Map();

/**
 * Avisa cuando un camión con ruta asignada pasa de "fuera" a "cerca" (≤ nearM)
 * o a "dentro" de su zona. Ignora lecturas viejas (maxAgeMin).
 * `vehicles` usa los campos de page-1: _lat, _lng, _ts, economic_number.
 */
export function evaluateProximity({ vehicles, plans, notify, nearM = 100, maxAgeMin = 15 }) {
  const now = Date.now();
  for (const plan of plans) {
    const ring = plan.zone_geojson?.coordinates?.[0];
    if (!plan.vehicle_id || !ring) continue;
    const v = vehicles.find(x => x.id === plan.vehicle_id);
    if (!v || !Number.isFinite(v._lat) || !Number.isFinite(v._lng)) continue;

    const ts = v._ts ? new Date(v._ts).getTime() : NaN;
    if (Number.isFinite(ts) && now - ts > maxAgeMin * 60_000) continue;

    const p = [v._lng, v._lat];
    const inside = pointInRing(p, ring);
    const distM = inside ? 0 : distanceToRingM(p, ring);
    const state = inside ? 'inside' : distM <= nearM ? 'near' : 'outside';

    const key = `${plan.vehicle_id}:${plan.id}`;
    const before = previousStates.get(key);
    previousStates.set(key, state);
    /* La primera lectura solo fija el estado: no se avisa de algo que ya era así al abrir la página. */
    if (before === undefined || before === state) continue;

    if (state === 'near') {
      notify(`Camión ${v.economic_number} cerca de su zona`, `Está a ${Math.round(distM)} m de “${plan.name}”.`, 'warn');
    } else if (state === 'inside') {
      notify(`Camión ${v.economic_number} dentro de su zona`, `Entró a la zona asignada “${plan.name}”.`, 'success');
    }
  }
}
