/* ══════════════════════════════════════════════════════
   RUTALIMPIA — route-wizard.js
   Los dos caminos de «Nueva ruta», sin tocar la interfaz:

   · learnFromGps    → ruta + zona propia (polígono) + línea del tiempo a partir del
                       GPS del camión.
   · generateAiRoute → ruta trazada por la IA dentro de la zona dibujada.

   La interfaz (page-1.html) sólo pinta lo que estas funciones devuelven.
══════════════════════════════════════════════════════ */

import { fetchTrail } from './db.js?v=6378755c';
import { fetchStreetsInBBox, suggestRoute, bboxOfPoints, bboxAreaKm2, pathLengthKm } from './ai-routing.js?v=6378755c';
import { pointInRing, insideRatio, polylineLengthM } from './geo.js?v=6378755c';
import { buildTrace, routeFromTrace, simplifyLine, zoneFromRoute, buildTimeline, clipRouteToRing } from './route-learning.js?v=6378755c';

const MIN_DAY_POINTS = 20;
const MIN_DAY_METERS = 300;
const MAX_STREETS_AREA_KM2 = 40;
const MAX_ROUTE_VERTICES = 500;

const localDay = ms => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Aprende del GPS: toma los últimos días del camión, se queda con los que sirven
 * y usa el de mayor recorrido como ruta base; la línea del tiempo sale de la
 * mediana de todos los días útiles.
 */
export async function learnFromGps({ vehicleId, windowHours = 72, limit = 25000, widthM = 60 }) {
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
  let route = routeFromTrace(reference.trace, 8);
  if (route.length > MAX_ROUTE_VERTICES) route = simplifyLine(route, 15);
  if (route.length < 2) throw new Error('No se pudo obtener una línea del recorrido.');

  const zone = zoneFromRoute(route, { widthM });
  const timeline = buildTimeline(days.map(d => d.trace.points), route, { stops: reference.trace.stops });

  const first = reference.trace.points[0], last = reference.trace.points[reference.trace.points.length - 1];
  return {
    day: reference.key,
    daysUsed: days.length,
    readings: reference.trace.points.length,
    truncated: !!meta?.reachedLimit,
    route,
    distanceM: polylineLengthM(route),
    durationS: Math.max(1, Math.round((last.ts - first.ts) / 1000)),
    ring: zone.ring,
    zoneKind: zone.kind,
    areaKm2: zone.areaKm2,
    timeline,
    stops: reference.trace.stops.length,
  };
}

/**
 * Trazo con IA dentro de la zona: descarga las calles del recuadro de la zona,
 * se queda con las que la tocan, pide el recorrido y lo recorta al polígono.
 */
export async function generateAiRoute({ ring, vehicle = null, depot = null, routeType = null, avoidNarrow = false, avoidSteep = false, signal }) {
  const bbox = bboxOfPoints(ring, 0.05);
  const area = bboxAreaKm2(bbox);
  if (area > MAX_STREETS_AREA_KM2) {
    throw new Error(`La zona abarca ${area.toFixed(1)} km²; para pedir las calles el máximo es ${MAX_STREETS_AREA_KM2} km². Dibújala más pequeña.`);
  }

  const { ways } = await fetchStreetsInBBox(bbox, { signal });
  const inside = ways.filter(w => w.coords.some(c => pointInRing(c, ring)));
  if (!inside.length) throw new Error('No se encontraron calles transitables dentro de la zona.');

  const suggestion = await suggestRoute({
    streets: inside,
    depot: depot && pointInRing(depot, ring) ? depot : null,
    vehicle, bbox,
    constraints: { routeType, avoidNarrow, avoidSteep },
  }, { signal });
  if (!suggestion.coordinates?.length) throw new Error('La IA no pudo construir un recorrido con estas calles.');

  const clipped = clipRouteToRing(suggestion.coordinates, ring);
  if (!clipped) throw new Error('El recorrido propuesto casi no queda dentro de la zona. Intenta con una zona con más calles.');
  const route = clipped.length > MAX_ROUTE_VERTICES ? simplifyLine(clipped, 6) : clipped;

  return {
    route,
    distanceM: polylineLengthM(route),
    insideRatio: insideRatio(route, ring),
    source: suggestion.source,
    model: suggestion.model || null,
    notes: suggestion.notes || null,
    streets: inside.length,
    trimmed: clipped.length < suggestion.coordinates.length,
    km: pathLengthKm(route),
  };
}
