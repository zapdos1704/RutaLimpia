/* ══════════════════════════════════════════════════════
   RUTALIMPIA — route-wizard.js
   Los dos caminos de «Nueva ruta», sin tocar la interfaz:

   · learnFromGps    → ruta + zona propia (polígono) + línea del tiempo a partir del
                       GPS del camión, ajustada a las calles con el OSRM local.
   · generateAiRoute → ruta que cubre las calles de la zona entre el inicio y el fin
                       elegidos; el servicio de IA toma calles y sentidos del OSRM local.

   La interfaz (page-1.html) sólo pinta lo que estas funciones devuelven.
══════════════════════════════════════════════════════ */

import { fetchTrail } from './db.js?v=f2794234';
import { requestZoneRoute } from './ai-routing.js?v=f2794234';
import { snapSegmentsToRoads } from './trail.js?v=f2794234';
import { pointInRing, insideRatio, polylineLengthM } from './geo.js?v=f2794234';
import { buildTrace, routeFromTrace, simplifyLine, zoneFromRoute, buildTimeline, fitRouteToPoints } from './route-learning.js?v=f2794234';

const MIN_DAY_POINTS = 20;
const MIN_DAY_METERS = 300;
const MAX_ROUTE_VERTICES = 500;
export const TOLERANCE_M = 100;   // cuánto puede salirse la ruta del polígono

const localDay = ms => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Ajusta el recorrido a las calles (map matching del OSRM local). Si el servidor
 * no responde se conserva el trazo original y se avisa con `snapped: false`.
 */
async function snapToStreets(points) {
  try {
    const segment = points.map(p => ({ lat: p.lat, lng: p.lng, timestamp: new Date(p.ts).toISOString() }));
    const res = await snapSegmentsToRoads([segment]);
    const coords = res.lines.flat();
    if (coords.length < 2) return { coords: null, snapped: false, note: res.error || 'sin resultado' };
    return { coords, snapped: res.adjusted > 0 && !res.error, note: res.error || null };
  } catch (err) {
    return { coords: null, snapped: false, note: err.message };
  }
}

/**
 * Aprende del GPS: toma los últimos días del camión, se queda con los que sirven
 * y usa el de mayor recorrido como ruta base (ajustada a calles); la línea del
 * tiempo sale de la mediana de todos los días útiles.
 *
 * Con `zone`, `start` y `end` (los que se eligieron antes) la ruta queda entre esos
 * dos puntos y dentro de esa zona; sin ellos se crea una zona propia que envuelve
 * el recorrido y el inicio y el fin son los extremos aprendidos.
 */
export async function learnFromGps({ vehicleId, zone = null, start = null, end = null, windowHours = 72, limit = 25000, widthM = 60 }) {
  const { points, meta } = await fetchTrail(vehicleId, { from: new Date(Date.now() - windowHours * 3600 * 1000), limit });
  if (!points.length) throw new Error('Este camión no tiene lecturas GPS en los últimos días.');

  const byDay = new Map();
  for (const p of points) {
    const ts = Date.parse(p.timestamp);
    if (!Number.isFinite(ts)) continue;
    const key = localDay(ts);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push({ lng: p.lng, lat: p.lat, ts });
  }

  const days = [...byDay.entries()]
    .map(([key, rows]) => ({ key, trace: buildTrace(rows) }))
    .filter(d => d.trace.points.length >= MIN_DAY_POINTS && d.trace.distanceM >= MIN_DAY_METERS);
  if (!days.length) {
    throw new Error(`El GPS de este camión no forma un recorrido suficiente (se necesitan al menos ${MIN_DAY_POINTS} lecturas y ${MIN_DAY_METERS} m en un día). Prueba cuando haya salido a ruta.`);
  }

  const reference = days.reduce((best, d) => (d.trace.distanceM > best.trace.distanceM ? d : best));

  const snap = await snapToStreets(reference.trace.points);
  let route = snap.coords ? simplifyLine(snap.coords, 4) : routeFromTrace(reference.trace, 8);
  if (route.length > MAX_ROUTE_VERTICES) route = simplifyLine(route, 12);
  if (route.length < 2) throw new Error('No se pudo obtener una línea del recorrido.');

  let ring, zoneKind, areaKm2, fit = null;
  if (zone && start && end) {
    fit = fitRouteToPoints(route, start, end, zone);
    route = fit.coords;
    ring = zone;
    zoneKind = 'dibujada';
  } else {
    const generated = zoneFromRoute(route, { widthM });
    ring = generated.ring; zoneKind = generated.kind; areaKm2 = generated.areaKm2;
  }

  const timeline = buildTimeline(days.map(d => d.trace.points), route, { stops: reference.trace.stops });
  const first = reference.trace.points[0], last = reference.trace.points[reference.trace.points.length - 1];
  return {
    day: reference.key,
    daysUsed: days.length,
    readings: reference.trace.points.length,
    truncated: !!meta?.reachedLimit,
    snapped: snap.snapped,
    snapNote: snap.note,
    route,
    distanceM: polylineLengthM(route),
    durationS: Math.max(1, Math.round((last.ts - first.ts) / 1000)),
    ring,
    zoneKind,
    areaKm2,
    insideRatio: fit?.insideRatio ?? 1,
    startOffM: fit?.startOffM ?? 0,
    endOffM: fit?.endOffM ?? 0,
    timeline,
    stops: reference.trace.stops.length,
  };
}

/**
 * Ruta con IA entre el inicio y el fin, cubriendo las calles de la zona. Las calles
 * y los sentidos salen del OSRM local (dentro del servicio de IA); no se usa Overpass.
 */
export async function generateAiRoute({ ring, start, end, vehicle = null, routeType = null, avoidNarrow = false, avoidSteep = false, signal }) {
  if (!ring || !start || !end) throw new Error('Marca primero la zona y el inicio y el fin.');
  if (!pointInRing(start, ring) || !pointInRing(end, ring)) throw new Error('El inicio y el fin deben quedar dentro de la zona.');

  const r = await requestZoneRoute({ ring, start, end, vehicle, constraints: { routeType, avoidNarrow, avoidSteep }, toleranceM: TOLERANCE_M }, { signal });
  const d = r.diagnostics || {};
  const route = r.coordinates.length > MAX_ROUTE_VERTICES ? simplifyLine(r.coordinates, 3) : r.coordinates;

  return {
    route,
    distanceM: polylineLengthM(route),
    insideRatio: insideRatio(route, ring),
    source: r.source,
    model: r.model || null,
    notes: r.notes || null,
    coverage: d.cobertura_pct ?? null,
    outsideMaxM: d.fuera_max_m ?? null,
    withinTolerance: d.dentro_tolerancia ?? null,
    lengthRatio: d.ratio_longitud ?? null,
    streetsUsed: d.calles_usadas ?? null,
    straightLinks: d.enlaces_rectos ?? null,
    fromOsrm: d.fuente === 'osrm-local',
  };
}
