import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, localDate, mergeRows, pct, periodRange, segments, summarize } from '../service-stats.js';

const row = (stat_date, route_id, will_dispose, served, unserved, unconfirmed, route_name = String(route_id).toUpperCase()) =>
  ({ stat_date, route_id, route_name, will_dispose, served, unserved, unconfirmed });

test('localDate usa la fecha de Sahuayo y no la de UTC', () => {
  // 20:30 del 19 sep en Sahuayo = 02:30 UTC del 20
  assert.equal(localDate(new Date('2026-09-20T02:30:00Z')), '2026-09-19');
  assert.equal(localDate(new Date('2026-09-19T06:30:00Z')), '2026-09-19'); // 00:30 locales
  assert.equal(localDate(new Date('2026-09-19T05:59:00Z')), '2026-09-18'); // 23:59 del día anterior
});

test('addDays cruza mes y año', () => {
  assert.equal(addDays('2026-09-30', 1), '2026-10-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('periodRange: diario = hoy, semanal = 7 días, mensual = 30 días, todos terminando hoy', () => {
  assert.deepEqual(periodRange('diario', '2026-09-19'), { from: '2026-09-19', to: '2026-09-19' });
  assert.deepEqual(periodRange('semanal', '2026-09-19'), { from: '2026-09-13', to: '2026-09-19' });
  assert.deepEqual(periodRange('mensual', '2026-09-19'), { from: '2026-08-21', to: '2026-09-19' });
  assert.deepEqual(periodRange('otro', '2026-09-19'), { from: '2026-09-19', to: '2026-09-19' });
});

test('mergeRows: un día cerrado manda sobre la vista en vivo', () => {
  const closed = [row('2026-09-18', 'a', 10, 6, 1, 3)];
  const live = [row('2026-09-18', 'a', 10, 9, 1, 0), row('2026-09-19', 'a', 4, 0, 0, 4)];
  const out = mergeRows(closed, live, '2026-09-19');
  assert.equal(out.length, 2);
  assert.equal(out[0].served, 6);            // el conteo congelado, no el de la vista
  assert.equal(out[1].date, '2026-09-19');
});

test('mergeRows: los días futuros (respuestas de «mañana») no cuentan como sin confirmar', () => {
  const live = [row('2026-09-20', 'a', 30, 0, 0, 30), row('2026-09-19', 'a', 5, 1, 0, 4)];
  const out = mergeRows([], live, '2026-09-19');
  assert.deepEqual(out.map(r => r.date), ['2026-09-19']);
});

test('mergeRows: ignora filas sin ruta, con fecha inválida o nulas', () => {
  const out = mergeRows([row('2026-09-18', null, 3, 3, 0, 0), row('mal', 'a', 1, 1, 0, 0), null, { stat_date: '2026-09-18' }], [null], '2026-09-19');
  assert.equal(out.length, 0);
});

test('mergeRows: una ruta sin nombre no rompe y el orden es por fecha y nombre', () => {
  const out = mergeRows([row('2026-09-18', 'b', 1, 1, 0, 0, 'Sur'), row('2026-09-17', 'c', 1, 1, 0, 0, null), row('2026-09-18', 'a', 1, 1, 0, 0, 'Norte')], [], '2026-09-19');
  assert.deepEqual(out.map(r => `${r.date} ${r.routeName}`), ['2026-09-17 Ruta sin nombre', '2026-09-18 Norte', '2026-09-18 Sur']);
});

test('mergeRows: valores raros (texto, negativos, nulos) se normalizan a enteros ≥ 0', () => {
  const [r] = mergeRows([{ stat_date: '2026-09-18', route_id: 'a', route_name: 'A', will_dispose: '5', served: '2', unserved: -3, unconfirmed: null }], [], '2026-09-19');
  assert.equal(r.served, 2); assert.equal(r.unserved, 0); assert.equal(r.unconfirmed, 0);
  assert.equal(r.willDispose, 5);
});

test('summarize: totales, por ruta y por día; los sin confirmar NO cuentan como desatendidos', () => {
  const rows = mergeRows([
    row('2026-09-18', 'a', 10, 6, 1, 3, 'Norte'),
    row('2026-09-18', 'b', 4, 4, 0, 0, 'Sur'),
    row('2026-09-17', 'a', 8, 2, 2, 4, 'Norte'),
  ], [], '2026-09-19');
  const s = summarize(rows);
  assert.deepEqual({ ...s.total }, { willDispose: 22, served: 12, unserved: 3, unconfirmed: 7, servedOfConfirmed: 80 });
  assert.equal(s.byRoute[0].routeName, 'Norte');       // la de más respuestas primero
  assert.equal(s.byRoute[0].willDispose, 18);
  assert.deepEqual(s.byDay.map(d => d.date), ['2026-09-17', '2026-09-18']);
  assert.equal(s.byDay[1].willDispose, 14);
  assert.equal(s.isEmpty, false);
});

test('summarize: sin datos', () => {
  const s = summarize([]);
  assert.equal(s.isEmpty, true);
  assert.equal(s.total.servedOfConfirmed, 0);
  assert.deepEqual(s.byRoute, []);
});

test('pct y segments: siempre suman 100 y no dividen entre cero', () => {
  assert.equal(pct(1, 0), 0);
  assert.equal(pct(1, 3), 33);
  assert.deepEqual(segments({ willDispose: 0, served: 0, unserved: 0, unconfirmed: 0 }), { served: 0, unserved: 0, unconfirmed: 0 });
  for (const [w, a, b, c] of [[3, 1, 1, 1], [7, 3, 2, 2], [10, 6, 1, 3], [1, 0, 0, 1], [9, 9, 0, 0]]) {
    const g = segments({ willDispose: w, served: a, unserved: b, unconfirmed: c });
    assert.equal(g.served + g.unserved + g.unconfirmed, 100, `${w}/${a}/${b}/${c}`);
  }
});
