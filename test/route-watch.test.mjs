import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteWatcher } from '../route-watch.js';
import { prepareLine, pointAlong, buildTimeline, retimeTimeline, etaForPoint } from '../route-learning.js';
import { haversineM } from '../geo.js';

const LAT0 = 20.05, LNG0 = -102.72;
const M_LAT = 1 / 111320, M_LNG = 1 / (111320 * Math.cos(LAT0 * Math.PI / 180));
const at = (e, n) => [LNG0 + e * M_LNG, LAT0 + n * M_LAT];
const ROUTE = [at(0, 0), at(1200, 0), at(1200, 800)];

const dayRows = () => {
  const line = prepareLine(ROUTE); const base = new Date(2026, 8, 15, 7, 0, 0).getTime(); const rows = [];
  for (let d = 0, i = 0; d <= line.total; d += 20, i++) { const [lng, lat] = pointAlong(line, d); rows.push({ lng, lat, ts: base + i * 5000 }); }
  return rows;
};
const timeline = buildTimeline([dayRows()], ROUTE);

function setup({ learning = true, mode = 'learning' } = {}) {
  const calls = { persist: [], notify: [], log: [], reload: 0 };
  let clock = Date.now();
  const watcher = createRouteWatcher({
    persist: async args => { calls.persist.push(args); },
    logEvent: async args => { calls.log.push(args); },
    fetchRoutes: async (points) => {
      const [a, b] = [points[0], points[points.length - 1]];
      return [[a, at(600, 0), b], [a, at(470, 200), at(760, 200), b]];
    },
    notify: (msg, kind) => calls.notify.push({ msg, kind }),
    reload: () => { calls.reload++; },
    now: () => clock,
  });
  const plan = { id: 'r1', name: 'Centro', vehicle_id: 'v1', route_geojson: { type: 'LineString', coordinates: ROUTE }, learning_enabled: learning, route_mode: mode, timeline, updated_at: '2026-09-19T10:00:00Z' };
  const truck = { id: 'v1', economic_number: 'VH-002' };
  const move = (e, n, extra = {}) => {
    clock += 6000;
    const [lng, lat] = at(e, n);
    Object.assign(truck, { _lng: lng, _lat: lat, _ts: clock, ...extra });
    watcher.tick([truck], [plan]);
  };
  return { watcher, calls, plan, truck, move, tick: () => watcher.tick([truck], [plan]) };
}
const settle = () => new Promise(r => setTimeout(r, 5));

test('con aprendizaje activo, un desvío que regresa cambia la ruta y recalcula el horario', async () => {
  const { calls, move } = setup();
  [[200, 4], [300, 3]].forEach(([e, n]) => move(e, n));
  [[500, 90], [560, 140], [620, 200], [700, 200], [760, 120], [820, 60], [900, 8], [960, 4], [1020, 2]].forEach(([e, n]) => move(e, n));
  await settle();
  assert.ok(calls.notify.some(n => /salió de su ruta/.test(n.msg)), 'debió avisar la salida');
  assert.equal(calls.persist.length, 1);
  const saved = calls.persist[0];
  assert.equal(saved.kind, 'route_changed');
  assert.equal(saved.routeId, 'r1');
  assert.equal(saved.expectedUpdatedAt, '2026-09-19T10:00:00Z');
  assert.ok(saved.route.coordinates.some(p => haversineM(p, at(620, 200)) < 10), 'la ruta debe incluir el camino real');
  assert.ok(saved.timeline.points.length >= 10);
  assert.match(saved.message, /Nuevo horario/);
  assert.equal(calls.reload, 1);
  assert.ok(calls.log.some(l => l.kind === 'deviation'));
});

test('con aprendizaje apagado la ruta predeterminada no se toca', async () => {
  const { calls, move } = setup({ learning: false, mode: 'predefined' });
  [[200, 4], [300, 3], [500, 90], [560, 140], [620, 200], [700, 200], [760, 120], [820, 60], [900, 8], [960, 4], [1020, 2]].forEach(([e, n]) => move(e, n));
  await settle();
  assert.equal(calls.persist.length, 0);
  assert.ok(calls.notify.some(n => /Aprendizaje apagado/.test(n.msg)));
  assert.ok(calls.notify.some(n => /volvió a su ruta/.test(n.msg)));
});

test('acepta la marca de tiempo como texto ISO, tal como la guarda la página', async () => {
  const { calls, watcher, plan, truck } = setup();
  const positions = [[300, 3], [500, 90], [560, 140], [620, 200]];
  let clock = Date.now();
  for (const [e, n] of positions) {
    clock += 6000;
    const [lng, lat] = at(e, n);
    Object.assign(truck, { _lng: lng, _lat: lat, _ts: new Date(clock).toISOString() });
    watcher.tick([truck], [plan]);
  }
  assert.ok(calls.notify.some(n => /salió de su ruta/.test(n.msg)), 'con _ts en ISO debió detectar el desvío');
});

test('la misma lectura repetida y las lecturas viejas no cuentan', async () => {
  const { calls, move, tick, truck } = setup();
  move(500, 90); tick(); tick(); tick();                       // misma lectura: cuenta una sola vez
  await settle();
  assert.equal(calls.notify.length, 0);
  truck._ts = Date.now() - 3 * 3600 * 1000; truck._lat = at(500, 300)[1];
  tick();
  assert.equal(calls.notify.length, 0);
});

test('un bloqueo reportado con aprendizaje activo cambia la ruta por una alterna, una sola vez', async () => {
  const { calls, move, truck, tick } = setup();
  move(600, 0, { _state: { blocked: true, blockedSince: new Date(2026, 8, 19, 8, 0, 0).toISOString() } });
  await settle();
  tick(); tick();
  await settle();
  assert.equal(calls.persist.length, 1);
  assert.equal(calls.persist[0].kind, 'blockage_reroute');
  assert.equal(calls.persist[0].route.coordinates.some(p => haversineM(p, at(600, 0)) < 35), false);
  assert.ok(calls.notify.some(n => /calle alterna/.test(n.msg)));
});

test('un bloqueo con aprendizaje apagado sólo avisa; con IA se reencamina aunque no aprenda', async () => {
  const off = setup({ learning: false, mode: 'predefined' });
  off.move(600, 0, { _state: { blocked: true, blockedSince: new Date().toISOString() } });
  await settle();
  assert.equal(off.calls.persist.length, 0);
  assert.ok(off.calls.notify.some(n => /se conserva la ruta predeterminada/.test(n.msg)));

  const ai = setup({ learning: false, mode: 'ai' });
  ai.move(600, 0, { _state: { blocked: true, blockedSince: new Date().toISOString() } });
  await settle();
  assert.equal(ai.calls.persist.length, 1);
});

test('si la migración falta se avisa una vez con un mensaje claro en lugar de fallar en silencio', async () => {
  const notes = [];
  const watcher = createRouteWatcher({
    persist: async () => { const e = new Error('Falta ejecutar 006_route_learning.sql'); e.missingMigration = true; throw e; },
    logEvent: async () => {}, fetchRoutes: async points => [[points[0], at(470, 200), points[points.length - 1]]],
    notify: (m, k) => notes.push({ m, k }),
  });
  const plan = { id: 'r1', name: 'Centro', vehicle_id: 'v1', route_geojson: { type: 'LineString', coordinates: ROUTE }, learning_enabled: true, updated_at: 'x' };
  const [lng, lat] = at(600, 0);
  watcher.tick([{ id: 'v1', economic_number: 'VH-9', _lng: lng, _lat: lat, _ts: Date.now(), _state: { blocked: true, blockedSince: new Date().toISOString() } }], [plan]);
  await settle();
  assert.ok(notes.some(n => n.k === 'warn' && /006_route_learning/.test(n.m)));
});

test('retimeTimeline conserva las horas donde la ruta coincide e interpola el tramo nuevo', () => {
  const detour = [...ROUTE.slice(0, 1), at(500, 0), at(560, 150), at(700, 150), at(760, 0), at(1200, 0), at(1200, 800)];
  const t2 = retimeTimeline(timeline, detour);
  assert.ok(t2, 'debió recalcularse');
  for (let i = 1; i < t2.points.length; i++) assert.ok(t2.points[i].s >= t2.points[i - 1].s);
  assert.equal(t2.startS, timeline.startS);
  assert.ok(t2.endS >= timeline.endS, 'el fin no llega antes con un rodeo');
  const before = etaForPoint(timeline, at(1200, 400)), after = etaForPoint(t2, at(1200, 400));
  assert.ok(before && after && after.s >= before.s - 5);
});
