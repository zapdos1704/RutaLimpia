import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareLine, nearestOnLine, pointAlong, sliceLine, buildTrace, simplifyLine, zoneFromRoute,
  buildTimeline, etaForPoint, fmtClock, fitRouteToPoints, createDeviationTracker, spliceDetour, rerouteAroundBlock, routeChange,
} from '../route-learning.js';
import { haversineM, pointInRing, ringSelfIntersects, polylineLengthM } from '../geo.js';

const LAT0 = 20.05, LNG0 = -102.72;
const M_LAT = 1 / 111320, M_LNG = 1 / (111320 * Math.cos(LAT0 * Math.PI / 180));
const at = (eastM, northM) => [LNG0 + eastM * M_LNG, LAT0 + northM * M_LAT];
/* Calle en «L»: 1.2 km hacia el este y 0.8 km hacia el norte. */
const L_ROUTE = [at(0, 0), at(1200, 0), at(1200, 800)];
const dense = (route, stepM) => {
  const line = prepareLine(route); const out = [];
  for (let d = 0; d <= line.total; d += stepM) out.push(pointAlong(line, d));
  return out;
};
/* Un día de recorrido: 4 m/s más `delayS` de retraso, con pequeño ruido GPS reproducible. */
const day = (route, { startH = 7, delayS = 0, speed = 4, noiseM = 3, seed = 1 } = {}) => {
  let r = seed; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647 - 0.5;
  const base = new Date(2026, 8, 15, startH, 0, 0).getTime() + delayS * 1000;
  return dense(route, 20).map((p, i) => ({ lng: p[0] + rnd() * noiseM * M_LNG, lat: p[1] + rnd() * noiseM * M_LAT, ts: base + (i * 20 / speed) * 1000 }));
};

test('buildTrace descarta saltos de GPS, ceros y lecturas repetidas, y detecta paradas', () => {
  const t0 = Date.UTC(2026, 8, 15, 13, 0, 0);
  const rows = [
    { lng: LNG0, lat: LAT0, ts: t0 },
    { lng: 0, lat: 0, ts: t0 + 5000 },                                           // sin fix
    { lng: at(5000, 0)[0], lat: LAT0, ts: t0 + 6000 },                           // salto de 5 km en 1 s
    { lng: at(30, 0)[0], lat: LAT0, ts: t0 + 10000 },
    { lng: at(30, 0)[0], lat: LAT0, ts: t0 + 11000 },                            // repetida
    ...Array.from({ length: 8 }, (_, i) => ({ lng: at(40, 0)[0], lat: LAT0, ts: t0 + 20000 + i * 20000 })),   // 140 s parado
    { lng: at(200, 0)[0], lat: LAT0, ts: t0 + 200000 },
  ];
  const trace = buildTrace(rows);
  assert.equal(trace.points.some(p => p.lat === 0), false);
  assert.equal(trace.points.some(p => p.lng > at(1000, 0)[0]), false);
  assert.equal(trace.stops.length, 1);
  assert.ok(trace.stops[0].dwellS >= 120);
  assert.ok(Math.abs(trace.distanceM - 200) < 15);
});

test('simplifyLine conserva las esquinas y quita los puntos alineados', () => {
  const simple = simplifyLine(dense(L_ROUTE, 10), 8);
  assert.ok(simple.length <= 4, `quedaron ${simple.length}`);
  assert.ok(simple.some(p => haversineM(p, L_ROUTE[1]) < 12));
});

test('zoneFromRoute envuelve todo el recorrido con un polígono válido y ceñido', () => {
  const { ring, kind, areaKm2 } = zoneFromRoute(dense(L_ROUTE, 15), { widthM: 60 });
  assert.equal(ringSelfIntersects(ring), false);
  for (const p of dense(L_ROUTE, 25)) assert.ok(pointInRing(p, ring), 'un punto del recorrido quedó fuera');
  // Ceñido: la «L» mide ~2 km × 120 m ≈ 0.24 km², muy lejos del rectángulo 1.2×0.8 = 0.96 km².
  assert.ok(areaKm2 > 0.15 && areaKm2 < 0.45, `área ${areaKm2}`);
  assert.equal(kind, 'contorno');
});

test('un recorrido en vuelta sigue dando un polígono válido que lo contiene', () => {
  const loop = [at(0, 0), at(600, 0), at(600, 600), at(0, 600), at(0, 30)];
  const { ring, kind } = zoneFromRoute(dense(loop, 15), { widthM: 50 });
  assert.equal(ringSelfIntersects(ring), false);
  for (const p of dense(loop, 30)) assert.ok(pointInRing(p, ring));
  assert.ok(kind === 'casco' || kind === 'contorno');
});

test('buildTimeline usa la mediana de varios días y sus horas nunca retroceden', () => {
  const days = [day(L_ROUTE, { delayS: 0, seed: 1 }), day(L_ROUTE, { delayS: 120, seed: 2 }), day(L_ROUTE, { delayS: 600, seed: 3 })];
  const tl = buildTimeline(days, L_ROUTE);
  assert.equal(tl.days, 3);
  assert.ok(tl.points.length >= 12);
  for (let i = 1; i < tl.points.length; i++) assert.ok(tl.points[i].s >= tl.points[i - 1].s);
  // Mediana = el día con 120 s de retraso: sale a las 07:02.
  assert.ok(Math.abs(tl.startS - (7 * 3600 + 120)) < 40, fmtClock(tl.startS));
  // 2 km a 4 m/s = 500 s más.
  assert.ok(Math.abs((tl.endS - tl.startS) - 500) < 60);
});

test('etaForPoint da la hora de paso cerca de una casa y null si está lejos', () => {
  const tl = buildTimeline([day(L_ROUTE, { seed: 4 })], L_ROUTE);
  const house = at(600, 25);                       // a mitad del tramo este, 25 m de la calle
  const eta = etaForPoint(tl, house);
  assert.ok(eta, 'debió haber ETA');
  assert.ok(Math.abs(eta.s - (7 * 3600 + 150)) < 45, eta.clock);   // 600 m / 4 m/s = 150 s
  assert.equal(etaForPoint(tl, at(600, 900)), null);
});

test('fitRouteToPoints recorta el recorrido entre inicio y fin y lo invierte si hace falta', () => {
  const ring = zoneFromRoute(dense(L_ROUTE, 15)).ring;
  const fit = fitRouteToPoints(L_ROUTE, at(300, 4), at(1200, 500), ring);
  assert.equal(fit.reversed, false);
  assert.ok(Math.abs(fit.lengthM - (900 + 500)) < 25, `${fit.lengthM}`);
  assert.ok(fit.insideRatio > 0.95);
  const back = fitRouteToPoints(L_ROUTE, at(1200, 500), at(300, 0), ring);
  assert.equal(back.reversed, true);
  assert.ok(haversineM(back.coords[0], at(1200, 500)) < 1);
});

test('el rastreador detecta la salida de la ruta y el regreso, con histéresis', () => {
  const line = prepareLine(L_ROUTE);
  const tracker = createDeviationTracker({ offM: 60, backM: 40, needOff: 3, needBack: 3 });
  const events = [];
  const feed = p => { const e = tracker.update(line, p); if (e) events.push(e); };
  feed(at(300, 5)); feed(at(400, 20));                          // sobre la ruta
  feed(at(500, 90)); feed(at(520, 140));                        // 2 lecturas fuera: aún no
  assert.equal(events.length, 0);
  feed(at(540, 200));                                           // la tercera confirma
  assert.equal(events[0].type, 'off_route');
  assert.ok(Math.abs(events[0].exitAlongM - 500) < 30);
  feed(at(700, 90)); feed(at(800, 50)); feed(at(900, 10)); feed(at(950, 5)); feed(at(1000, 3));
  const back = events.find(e => e.type === 'back_on_route');
  assert.ok(back, 'debió regresar a la ruta');
  assert.ok(back.detour.length >= 6);
  assert.ok(back.reenterAlongM > back.exitAlongM);
});

test('spliceDetour reemplaza el tramo abandonado por el desvío real', () => {
  const detour = [at(500, 90), at(600, 120), at(700, 90), at(800, 30)];
  const merged = spliceDetour(L_ROUTE, detour, { exitAlongM: 500, reenterAlongM: 800 });
  assert.ok(merged.some(p => haversineM(p, at(600, 120)) < 1));
  assert.equal(merged.some(p => haversineM(p, at(650, 0)) < 20), false);          // el tramo directo desapareció
  assert.ok(haversineM(merged[merged.length - 1], L_ROUTE[2]) < 1);              // conserva el final
  assert.ok(haversineM(merged[0], L_ROUTE[0]) < 1);
});

test('rerouteAroundBlock elige la alternativa más corta que evita el bloqueo', async () => {
  const block = at(600, 0);
  const calls = [];
  const fetchRoutes = async (points, opts) => {
    calls.push({ n: points.length, alt: opts.alternatives });
    const [a, b] = [points[0], points[points.length - 1]];
    const straight = [a, block, b];                                             // pasa por el bloqueo
    const north = [a, at(470, 180), at(760, 180), b];                            // rodea por el norte
    const far = [a, at(470, 400), at(760, 400), b];
    return [straight, far, north];
  };
  const result = await rerouteAroundBlock(L_ROUTE, block, fetchRoutes);
  assert.equal(result.ok, true);
  assert.equal(result.coords.some(p => haversineM(p, block) < 35), false);
  assert.ok(result.coords.some(p => haversineM(p, at(470, 180)) < 2), 'debió preferir la alterna corta');
  assert.equal(calls.length, 1);
  assert.ok(haversineM(result.coords[0], L_ROUTE[0]) < 1);
  assert.ok(haversineM(result.coords[result.coords.length - 1], L_ROUTE[2]) < 1);
});

test('rerouteAroundBlock prueba un punto lateral si ninguna alterna lo evita, y avisa si no hay salida', async () => {
  const block = at(600, 0);
  const fetchRoutes = async (points) => (points.length === 3 ? [[points[0], points[1], points[2]]] : [[points[0], block, points[1]]]);
  const viaOk = await rerouteAroundBlock(L_ROUTE, block, fetchRoutes);
  assert.equal(viaOk.ok, true);
  const nothing = await rerouteAroundBlock(L_ROUTE, block, async points => [[points[0], block, points[points.length - 1]]]);
  assert.equal(nothing.ok, false);
  assert.match(nothing.reason, /alterna/);
  assert.equal((await rerouteAroundBlock(L_ROUTE, at(600, 500), fetchRoutes)).ok, false);
});

test('routeChange distingue una ruta igual de una modificada', () => {
  assert.equal(routeChange(L_ROUTE, dense(L_ROUTE, 30)).changed, false);
  const moved = spliceDetour(L_ROUTE, [at(500, 90), at(600, 150), at(700, 90)], { exitAlongM: 500, reenterAlongM: 700 });
  const change = routeChange(L_ROUTE, moved);
  assert.equal(change.changed, true);
  assert.ok(change.maxOffM >= 140);
});

test('nearestOnLine y sliceLine miden distancias a lo largo de la línea', () => {
  const line = prepareLine(L_ROUTE);
  assert.ok(Math.abs(line.total - 2000) < 8);
  const n = nearestOnLine(line, at(1200, 300));
  assert.ok(Math.abs(n.alongM - 1500) < 6 && n.distM < 2);
  assert.ok(Math.abs(polylineLengthM(sliceLine(line, 1000, 1500)) - 500) < 4);
});
