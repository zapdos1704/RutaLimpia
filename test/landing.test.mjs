import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateFleet, breakEvenUnits, routePosition, routeCoordinates, routeMeters, homeCoordinate, GRID } from '../landing/model.mjs';

test('la calculadora distingue implementación, mensualidad y anualidad', () => {
  assert.deepEqual(estimateFleet(8), { units: 8, implementation: 45600, monthly: 7120, annual: 85440 });
  assert.deepEqual(estimateFleet(50), { units: 50, implementation: 285000, monthly: 44500, annual: 534000 });
});
test('la flota respeta los límites aunque la entrada no venga del slider', () => {
  assert.equal(estimateFleet(-1).units, 1);
  assert.equal(estimateFleet(100).units, 50);
  assert.equal(estimateFleet(NaN).units, 1);
  assert.equal(estimateFleet(8.4).units, 8);
});
test('el equilibrio redondea hacia arriba para cubrir costos fijos', () => {
  assert.equal(breakEvenUnits(), 14);
  assert.ok(13 * 740 < 10224.5);
  assert.ok(14 * 740 >= 10224.5);
});

// ── el recorrido del camión ──────────────────────────────────────────────
const near = (a, b) => Math.abs(a - b) < 1e-9;
const onLatLine = lat => near(Math.round((lat - GRID.lat0) / GRID.latStep) * GRID.latStep + GRID.lat0, lat);
const onLngLine = lng => near(Math.round((lng - GRID.lng0) / GRID.lngStep) * GRID.lngStep + GRID.lng0, lng);

test('todos los vértices del recorrido caen sobre una esquina de calles', () => {
  for (const [lng, lat] of routeCoordinates) {
    assert.ok(onLngLine(lng), `la longitud ${lng} no está sobre una calle vertical`);
    assert.ok(onLatLine(lat), `la latitud ${lat} no está sobre una calle horizontal`);
  }
});
test('cada tramo va por UNA calle: comparte latitud o longitud con el siguiente y no las dos', () => {
  for (let i = 1; i < routeCoordinates.length; i++) {
    const [aLng, aLat] = routeCoordinates[i - 1], [bLng, bLat] = routeCoordinates[i];
    assert.ok(near(aLng, bLng) !== near(aLat, bLat), `el tramo ${i} no es recto sobre una calle`);
  }
});
test('el camión se queda sobre una calle en cualquier punto del avance', () => {
  for (let p = 0; p <= 1.0001; p += 0.01) {
    const [lng, lat] = routePosition(p);
    assert.ok(onLngLine(lng) || onLatLine(lat), `en ${Math.round(p * 100)} % el camión quedó dentro de una manzana`);
  }
});
test('el recorrido interpola por distancia y conserva sus extremos', () => {
  assert.deepEqual(routePosition(-1), routeCoordinates[0]);
  assert.deepEqual(routePosition(0), routeCoordinates[0]);
  assert.deepEqual(routePosition(1), routeCoordinates.at(-1));
  assert.deepEqual(routePosition(2), routeCoordinates.at(-1));
  assert.ok(routeMeters > 1500 && routeMeters < 3000, 'la ruta de demostración mide un par de kilómetros');
});
test('el camión avanza a velocidad constante', () => {
  const N = 400, expected = routeMeters / N;
  const step = (a, b) => Math.hypot((b[0] - a[0]) * 104563, (b[1] - a[1]) * 110540);
  const distances = [];
  for (let i = 0; i < N; i++) distances.push(step(routePosition(i / N), routePosition((i + 1) / N)));
  const median = [...distances].sort((a, b) => a - b)[N / 2];
  assert.ok(Math.abs(median - expected) / expected < 0.01, `un paso típico mide ${median.toFixed(2)} m y debería medir ${expected.toFixed(2)} m`);
  assert.ok(Math.max(...distances) <= expected * 1.01, 'ningún paso es más largo que los demás');
});
test('la casa es una esquina de la ruta', () => {
  assert.ok(routeCoordinates.some(([lng, lat]) => near(lng, homeCoordinate[0]) && near(lat, homeCoordinate[1])));
});
