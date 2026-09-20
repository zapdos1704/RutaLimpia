import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeStopsPerLoad, parseStopsPerLoad } from '../vehicle-load.js';

test('parseStopsPerLoad acepta enteros, decimales y coma decimal', () => {
  assert.deepEqual(parseStopsPerLoad('120'), { ok: true, value: 120 });
  assert.deepEqual(parseStopsPerLoad(' 85.5 '), { ok: true, value: 85.5 });
  assert.deepEqual(parseStopsPerLoad('85,5'), { ok: true, value: 85.5 });
  assert.deepEqual(parseStopsPerLoad(75), { ok: true, value: 75 });
  assert.deepEqual(parseStopsPerLoad('10.26'), { ok: true, value: 10.3 });
});

test('parseStopsPerLoad rechaza vacío, texto, negativos, cero y exceso', () => {
  for (const bad of ['', '   ', null, undefined, 'abc', '12abc', '-5', '0', '0.4', '5001', '1e3', '1.2.3', '١٢٣']) {
    assert.equal(parseStopsPerLoad(bad).ok, false, `debía rechazar ${JSON.stringify(bad)}`);
  }
  assert.ok(parseStopsPerLoad('').error.length > 0);
});

test('parseStopsPerLoad: los límites valen', () => {
  assert.equal(parseStopsPerLoad('1').ok, true);
  assert.equal(parseStopsPerLoad('5000').ok, true);
});

test('describeStopsPerLoad: sin valor pide definirlo y explica para qué', () => {
  for (const v of [{}, { stops_per_load: null }, { stops_per_load: '' }, { stops_per_load: 0 }, { stops_per_load: -3 }, undefined, null]) {
    const d = describeStopsPerLoad(v);
    assert.equal(d.hasValue, false);
    assert.equal(d.action, 'Definir');
    assert.match(d.detail, /capacidad/);
  }
});

test('describeStopsPerLoad: distingue valor inicial de valor ajustado con cargas reales', () => {
  assert.deepEqual(describeStopsPerLoad({ stops_per_load: 120, stops_per_load_samples: 0 }), { hasValue: true, valueText: '120', detail: 'valor inicial', action: 'Cambiar' });
  assert.equal(describeStopsPerLoad({ stops_per_load: '96.5', stops_per_load_samples: 1 }).detail, 'ajustado con 1 carga');
  assert.equal(describeStopsPerLoad({ stops_per_load: 96.5, stops_per_load_samples: 7 }).detail, 'ajustado con 7 cargas');
  assert.equal(describeStopsPerLoad({ stops_per_load: 96.5, stops_per_load_samples: 7 }).valueText, '96.5');
  assert.equal(describeStopsPerLoad({ stops_per_load: 100, stops_per_load_samples: null }).detail, 'valor inicial');
});
