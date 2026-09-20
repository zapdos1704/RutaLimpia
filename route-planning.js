/* ══════════════════════════════════════════════════════
   RUTALIMPIA — route-planning.js
   Planeación de rutas por zona: geometría, OSRM, guardado en Supabase y avisos
   de proximidad. Sin dependencias externas (todo el cálculo geográfico es local).

   Coordenadas siempre en formato GeoJSON [lng, lat].
   El backend es la migración 20260918_route_planning.sql (vista routes_geojson y
   función save_route_plan, que exige una sesión Supabase autenticada).
══════════════════════════════════════════════════════ */

import { sb } from './db.js?v=f2794234';
import { getOsrmEndpoint } from './trail.js?v=f2794234';
import { bridgeAuthHeaders } from './bridge-auth.js?v=f2794234';

const PUBLIC_OSRM = /router\.project-osrm\.org/i;
const REQUEST_TIMEOUT_MS = 20_000;

/* La geometría vive en geo.js (sin dependencias, probada en Node); se reexporta
   aquí para no cambiar los imports existentes. */
import { haversineM, pointInRing, distanceToRingM, polylineLengthM, alongLine, closeRing, ringAreaKm2, ringCentroid, ringSelfIntersects, insideRatio } from './geo.js?v=f2794234';
export * from './geo.js?v=f2794234';

/* ── OSRM ──────────────────────────────────────────── */

async function osrm(path) {
  const endpoint = getOsrmEndpoint().replace(/\/$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${endpoint}${path}`, { signal: controller.signal, headers: await bridgeAuthHeaders(endpoint) });
    if (res.status === 401) throw new Error('El servidor de rutas no reconoció tu sesión. Cierra sesión y vuelve a entrar.');
    if (res.status === 403) throw new Error('Tu cuenta no tiene permiso para usar el servidor de rutas.');
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

/** Rutas entre puntos (con alternativas opcionales). Devuelve listas de [[lng,lat],…]. */
export async function fetchOSRMRoutes(points, { alternatives = false } = {}) {
  const data = await osrm(`/route/v1/driving/${coordText(points)}?overview=full&geometries=geojson&steps=false&alternatives=${alternatives ? 'true' : 'false'}`);
  return (data.routes || []).map(r => r.geometry?.coordinates).filter(c => c?.length >= 2);
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
    timeline: parseJson(r.timeline),
    base_route: parseJson(r.base_route),
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

/* ── Aprendizaje y cambios de ruta (migración 006_route_learning.sql) ──
   Estas funciones fallan con un mensaje claro si la migración aún no se aplicó. */

const MIGRATION_HINT = 'Falta ejecutar 006_route_learning.sql en Supabase para activar el aprendizaje de rutas.';
export const isMissingMigration = err => /does not exist|could not find|schema cache|PGRST20d|42883|42703|42P01/i.test(`${err?.code || ''} ${err?.message || ''}`);
const rpc = async (name, args) => {
  const { data, error } = await sb.rpc(name, args);
  if (error) { const e = new Error(isMissingMigration(error) ? MIGRATION_HINT : error.message); e.code = error.code; e.missingMigration = isMissingMigration(error); throw e; }
  return data;
};

/** Modo de la ruta, aprendizaje activo, ruta predeterminada y línea del tiempo. */
export const saveRouteExtras = (routeId, { mode, learningEnabled, baseRoute, timeline }) => rpc('set_route_learning', {
  p_route_id: routeId, p_mode: mode, p_learning: !!learningEnabled, p_base_route: baseRoute || null, p_timeline: timeline || null,
});

/** Cambia la ruta activa y deja el aviso en route_events (una sola transacción). */
export const applyRouteChange = ({ routeId, route, timeline, kind, message, payload, expectedUpdatedAt, dedupeKey }) => rpc('apply_route_change', {
  p_route_id: routeId, p_route_geojson: route, p_timeline: timeline || null, p_kind: kind, p_message: message,
  p_payload: payload || {}, p_expected_updated_at: expectedUpdatedAt || null, p_dedupe_key: dedupeKey || null,
});

/** Aviso sin cambiar la ruta (desvío, bloqueo sin salida, etc.). */
export const logRouteEvent = ({ routeId, kind, message, payload, dedupeKey }) => rpc('log_route_event', {
  p_route_id: routeId, p_kind: kind, p_message: message, p_payload: payload || {}, p_dedupe_key: dedupeKey || null,
});

/** Pendiente y calles angostas (no forman parte de save_route_plan). */
export async function saveRouteFlags(routeId, { steep, narrow }) {
  const { error } = await sb.from('routes').update({ has_steep_terrain: !!steep, has_narrow_alleys: !!narrow }).eq('id', routeId);
  if (error) throw error;
}

/** Enciende o apaga el aprendizaje; al apagarlo se restaura la ruta predeterminada. */
export const setLearningEnabled = (routeId, enabled) => rpc('set_route_learning_enabled', { p_route_id: routeId, p_enabled: !!enabled });

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
