import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AREA_MAX_M2, AREA_MIN_M2, buildSavePayload, circleRing, describeSite, ringAreaM2, shapeOf,
  siteCenter, siteRing, sitesToFeatureCollection,
} from '../dump-sites.js';
import { GENERAL, buildSchedulePayload, countByRoute, describeSchedule, normalizeTime, schedulesFor, sortSchedules } from '../schedules.js';
import { NEEDS_SQL_008, friendlyDbError, isDenied, isMissingSql } from '../db-errors.js';
import { haversineM } from '../geo.js';

const C = [-102.73, 19.99];
// ~157 m x 156 m
const SQUARE = [[-102.7300, 19.9900], [-102.7285, 19.9900], [-102.7285, 19.9914], [-102.7300, 19.9914]];

/* ── dump-sites ─────────────────────────────────────────────── */

test('circleRing: anillo cerrado con todos los puntos a `radio` metros del centro', () => {
  const ring = circleRing(C, 120);
  assert.equal(ring.length, 49);
  assert.deepEqual(ring[0], ring[48]);
  for (const p of ring) assert.ok(Math.abs(haversineM(C, p) - 120) < 1.5, `a ${haversineM(C, p)} m`);
});

test('ringAreaM2 es coherente con la geografía', () => {
  const w = haversineM(SQUARE[0], SQUARE[1]), h = haversineM(SQUARE[0], SQUARE[3]);
  assert.ok(Math.abs(ringAreaM2(SQUARE) - w * h) < w * h * 0.01, `${ringAreaM2(SQUARE)} vs ${w * h}`);
  assert.equal(ringAreaM2([[0, 0]]), 0);
});

test('shapeOf / siteRing / siteCenter / describeSite: círculo y polígono', () => {
  const circle = { id: 'a', name: 'C', is_active: true, radius_m: 120, center_lng: C[0], center_lat: C[1], area: null };
  const poly = { id: 'b', name: 'P', is_active: true, radius_m: null, center_lng: null, center_lat: null, area: { type: 'Polygon', coordinates: [[...SQUARE, SQUARE[0]]] } };
  assert.equal(shapeOf(circle), 'circle');
  assert.equal(shapeOf(poly), 'polygon');
  assert.equal(siteRing(circle).length, 49);
  assert.deepEqual(siteRing(poly)[0], SQUARE[0]);
  assert.deepEqual(siteCenter(circle), C);
  const pc = siteCenter(poly);
  assert.ok(pc[0] < -102.7285 && pc[0] > -102.7300 && pc[1] > 19.9900 && pc[1] < 19.9914);
  assert.equal(describeSite(circle), 'Círculo de 120 m');
  assert.match(describeSite(poly), /^Polígono de \d+ m²$/);
});

test('siteRing/siteCenter: filas dañadas no rompen (null)', () => {
  assert.equal(siteRing({ radius_m: 100, center_lng: null, center_lat: null }), null);
  assert.equal(siteRing({ radius_m: 0, center_lng: 1, center_lat: 1 }), null);
  assert.equal(siteRing({ area: { coordinates: [[[0, 0], [1, 1]]] } }), null);
  assert.equal(siteRing({ area: { coordinates: [[[0, 0], [1, 1], [2, 'x'], [0, 0]]] } }), null);
  assert.equal(siteCenter({ radius_m: 100, center_lng: 500, center_lat: 0 }), null);
  assert.equal(siteRing(null), null);
});

test('sitesToFeatureCollection: sólo filas válidas y marca la seleccionada / inactiva', () => {
  const rows = [
    { id: 'a', name: 'A', is_active: true, radius_m: 100, center_lng: C[0], center_lat: C[1], area: null },
    { id: 'b', name: 'B', is_active: false, radius_m: 100, center_lng: C[0] + 0.01, center_lat: C[1], area: null },
    { id: 'x', name: 'Rota', radius_m: 100, center_lng: null, center_lat: null, area: null },
  ];
  const fc = sitesToFeatureCollection(rows, 'a');
  assert.equal(fc.features.length, 2);
  assert.deepEqual(fc.features.map(f => [f.properties.id, f.properties.active, f.properties.selected]), [['a', true, true], ['b', false, false]]);
  assert.equal(sitesToFeatureCollection(null).features.length, 0);
});

test('buildSavePayload: círculo válido (radio con coma o texto)', () => {
  const r = buildSavePayload({ name: '  Relleno  ', shape: 'circle', center: C, radius: '120,4', active: true });
  assert.equal(r.ok, true);
  assert.deepEqual(r.args, { p_id: null, p_name: 'Relleno', p_active: true, p_center_lng: C[0], p_center_lat: C[1], p_radius_m: 120, p_polygon: null });
  assert.equal(buildSavePayload({ id: 'z', name: 'X', shape: 'circle', center: C, radius: 30, active: false }).args.p_id, 'z');
  assert.equal(buildSavePayload({ name: 'X', shape: 'circle', center: C, radius: 30, active: false }).args.p_active, false);
});

test('buildSavePayload: rechaza nombre, centro y radio inválidos', () => {
  const bad = f => buildSavePayload({ name: 'X', shape: 'circle', center: C, radius: 100, ...f });
  assert.equal(bad({ name: '   ' }).ok, false);
  assert.equal(bad({ name: 'x'.repeat(81) }).ok, false);
  assert.equal(bad({ center: null }).ok, false);
  assert.equal(bad({ center: [200, 10] }).ok, false);
  assert.equal(bad({ center: [10, 95] }).ok, false);
  for (const radius of [29, 1001, '', 'abc', '-50', null, NaN]) assert.equal(bad({ radius }).ok, false, `radio ${radius}`);
  assert.equal(bad({ radius: 1000 }).ok, true);
  assert.equal(bad({ radius: 30 }).ok, true);
  assert.match(bad({ radius: 5 }).error, /30 y 1000/);
});

test('buildSavePayload: polígono válido se cierra y no lleva centro ni radio', () => {
  const r = buildSavePayload({ name: 'Zona', shape: 'polygon', ring: SQUARE });
  assert.equal(r.ok, true);
  const poly = r.args.p_polygon;
  assert.equal(poly.type, 'Polygon');
  assert.equal(poly.coordinates[0].length, 5);
  assert.deepEqual(poly.coordinates[0][0], poly.coordinates[0][4]);
  assert.equal(r.args.p_center_lng, null); assert.equal(r.args.p_radius_m, null);
  // Con el anillo ya cerrado no se duplica el cierre
  assert.equal(buildSavePayload({ name: 'Zona', shape: 'polygon', ring: [...SQUARE, SQUARE[0]] }).args.p_polygon.coordinates[0].length, 5);
});

test('buildSavePayload: polígono con pocos puntos, cruzado, diminuto o enorme', () => {
  const poly = ring => buildSavePayload({ name: 'Z', shape: 'polygon', ring });
  assert.match(poly([SQUARE[0], SQUARE[1]]).error, /3 puntos/);
  assert.match(poly([]).error, /3 puntos/);
  assert.match(poly(null).error, /3 puntos/);
  assert.match(poly([SQUARE[0], SQUARE[2], SQUARE[1], SQUARE[3]]).error, /cruzan/);
  const tiny = [[-102.73, 19.99], [-102.7299, 19.99], [-102.7299, 19.9901], [-102.73, 19.9901]];
  assert.match(poly(tiny).error, new RegExp(`mínimo es ${AREA_MIN_M2}`));
  const huge = [[-102.75, 19.98], [-102.72, 19.98], [-102.72, 20.0], [-102.75, 20.0]];
  assert.match(poly(huge).error, new RegExp(`máximo es ${AREA_MAX_M2 / 1e6}`));
  assert.match(poly([[0, 0], [1, 0], [1, NaN], [0, 1]]).error, /no válidas/);
});

/* ── schedules ──────────────────────────────────────────────── */

test('normalizeTime acepta 7:30, 07:30 y 07:30:00; rechaza el resto', () => {
  assert.equal(normalizeTime('7:30'), '07:30');
  assert.equal(normalizeTime('07:30'), '07:30');
  assert.equal(normalizeTime(' 07:30:00 '), '07:30');
  assert.equal(normalizeTime('00:00'), '00:00');
  assert.equal(normalizeTime('23:59'), '23:59');
  for (const bad of ['24:00', '07:60', '730', '', null, undefined, 'ab:cd', '7:5']) assert.equal(normalizeTime(bad), null, String(bad));
});

test('buildSchedulePayload: fila válida con ruta y general', () => {
  const r = buildSchedulePayload({ day: '3', time: '7:30', waste: 'organica', routeId: 'r1', zone: '  Centro ', active: true });
  assert.deepEqual(r, { ok: true, args: { p_id: null, p_day: 3, p_time: '07:30', p_waste: 'organica', p_route_id: 'r1', p_zone_label: 'Centro', p_active: true } });
  const g = buildSchedulePayload({ id: 'x', day: 1, time: '08:00', waste: 'general', routeId: GENERAL, active: false });
  assert.equal(g.args.p_route_id, null);
  assert.equal(g.args.p_zone_label, null);
  assert.equal(g.args.p_active, false);
  assert.equal(g.args.p_id, 'x');
  assert.equal(buildSchedulePayload({ day: 1, time: '08:00', waste: 'general', routeId: '' }).args.p_route_id, null);
});

test('buildSchedulePayload: rechaza día, hora, tipo y zona inválidos', () => {
  const ok = { day: 1, time: '07:30', waste: 'general' };
  for (const day of [0, 8, 'x', null, 1.5]) assert.equal(buildSchedulePayload({ ...ok, day }).ok, false, `día ${day}`);
  for (const time of ['', '25:00', 'x']) assert.equal(buildSchedulePayload({ ...ok, time }).ok, false, `hora ${time}`);
  for (const waste of ['peligrosa', '', null]) assert.equal(buildSchedulePayload({ ...ok, waste }).ok, false, `tipo ${waste}`);
  assert.equal(buildSchedulePayload({ ...ok, zone: 'z'.repeat(81) }).ok, false);
  assert.equal(buildSchedulePayload(undefined).ok, false);
});

const ROWS = [
  { id: '1', day_of_week: 3, time: '08:00', waste_type: 'organica', route_id: 'r1' },
  { id: '2', day_of_week: 1, time: '07:30', waste_type: 'general', route_id: 'r1' },
  { id: '3', day_of_week: 1, time: '07:30', waste_type: 'general', route_id: null },
  { id: '4', day_of_week: 1, time: '06:00', waste_type: 'inorganica', route_id: 'r2' },
];

test('sortSchedules / schedulesFor / countByRoute', () => {
  assert.deepEqual(sortSchedules(ROWS).map(r => r.id), ['4', '2', '3', '1']);
  assert.deepEqual(ROWS.map(r => r.id), ['1', '2', '3', '4'], 'no muta el arreglo original');
  assert.deepEqual(schedulesFor(ROWS, 'r1').map(r => r.id), ['2', '1']);
  assert.deepEqual(schedulesFor(ROWS, GENERAL).map(r => r.id), ['3']);
  assert.deepEqual(schedulesFor(ROWS, '').map(r => r.id), ['3']);
  assert.deepEqual(schedulesFor(ROWS, 'nadie'), []);
  assert.deepEqual(countByRoute(ROWS), { r1: 2, general: 1, r2: 1 });
  assert.deepEqual(schedulesFor(null, 'r1'), []);
});

test('describeSchedule', () => {
  assert.equal(describeSchedule({ day_of_week: 1, time: '07:30:00', waste_type: 'organica' }), 'Lunes 07:30 · Orgánica');
  assert.equal(describeSchedule({}), '—  · —');
});

/* ── db-errors ──────────────────────────────────────────────── */

test('friendlyDbError distingue falta de SQL, permisos, validación de 008 y red', () => {
  assert.equal(friendlyDbError({ code: 'PGRST202', message: 'Could not find the function public.save_dump_site' }), NEEDS_SQL_008);
  assert.equal(friendlyDbError({ code: '42P01', message: 'relation "dump_sites_geo" does not exist' }), NEEDS_SQL_008);
  assert.match(friendlyDbError({ code: '42501', message: 'Sólo la administración puede editar tiraderos' }), /administración/);
  assert.equal(friendlyDbError({ code: '22023', message: 'El radio debe estar entre 30 y 1000 metros' }), 'El radio debe estar entre 30 y 1000 metros');
  assert.equal(friendlyDbError({ code: '23505', message: 'Ya existe ese horario para esa ruta' }), 'Ya existe ese horario para esa ruta');
  assert.match(friendlyDbError(new Error('Tiempo de espera agotado. Verifica tu conexión.')), /Sin conexión/);
  assert.equal(friendlyDbError(null), 'No se pudo guardar. Intenta de nuevo.');
  assert.equal(friendlyDbError({ message: 'algo raro' }), 'algo raro');
  assert.equal(isMissingSql({ message: 'x' }), false);
  assert.equal(isDenied({ status: 403 }), true);
});
