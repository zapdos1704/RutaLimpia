import test from 'node:test';
import assert from 'node:assert/strict';
import { clean, findNear, toRequest, SAME_STREET_M } from '../blocked-streets-core.js';

const LNG0 = -102.7245, LAT0 = 20.0538;
const M_LAT = 1 / 110540;
const M_LNG = 1 / (111320 * Math.cos(LAT0 * Math.PI / 180));
const en = (este, norte) => [LNG0 + este * M_LNG, LAT0 + norte * M_LAT];

test('clean deja solo los campos que se usan y convierte las coordenadas a número', () => {
  assert.deepEqual(clean({ id: 'a', name: '', lng: '-102.7', lat: '20.05', note: null, extra: 1 }),
    { id: 'a', name: null, lng: -102.7, lat: 20.05, note: null });
});

test('findNear encuentra una cuadra ya marcada a menos de 12 m y no una a más', () => {
  const lista = [{ id: '1', name: 'Hidalgo', lng: en(0, 0)[0], lat: en(0, 0)[1] }];
  assert.equal(findNear(lista, en(8, 0))?.id, '1');
  assert.equal(findNear(lista, en(30, 0)), null);
  assert.equal(SAME_STREET_M, 12);
  assert.equal(findNear([], en(0, 0)), null);
});

test('toRequest manda solo punto y nombre, y descarta filas sin coordenadas', () => {
  const lista = [
    { id: '1', name: 'Hidalgo', lng: -102.72, lat: 20.05, note: 'angosta' },
    { id: '2', name: null, lng: 'no', lat: 20.05 },
    { id: '3', name: 'Juárez', lng: '-102.73', lat: '20.06' },
  ];
  assert.deepEqual(toRequest(lista), [
    { lng: -102.72, lat: 20.05, name: 'Hidalgo' },
    { lng: -102.73, lat: 20.06, name: 'Juárez' },
  ]);
  assert.deepEqual(toRequest([]), []);
});
