export const PRICING = Object.freeze({ implementation: 5700, monthly: 890, manufacturing: 2400, variable: 150, fixed: 10224.5 });
export function estimateFleet(value) {
  const units = Math.min(50, Math.max(1, Math.round(Number(value) || 1)));
  return { units, implementation: units * PRICING.implementation, monthly: units * PRICING.monthly, annual: units * PRICING.monthly * 12 };
}
export const breakEvenUnits = () => Math.ceil(PRICING.fixed / (PRICING.monthly - PRICING.variable));

/**
 * Calles del mapa de demostración: una cuadrícula. Las líneas horizontales están cada `latStep` grados de latitud
 * a partir de `lat0`, y las verticales cada `lngStep` grados de longitud a partir de `lng0`. El recorrido del camión
 * sólo usa vértices sobre esas líneas, así siempre va por las calles y nunca por dentro de una manzana.
 */
export const GRID = Object.freeze({ lat0: 20.050, latStep: 0.002, lat1: 20.068, lng0: -102.733, lngStep: 0.003, lng1: -102.706 });
export const MAP_CENTER = Object.freeze([-102.718, 20.060]);

export const routeCoordinates = [
  [-102.724, 20.056], [-102.721, 20.056], [-102.718, 20.056], [-102.718, 20.058],
  [-102.715, 20.058], [-102.715, 20.060], [-102.715, 20.062], [-102.718, 20.062],
  [-102.718, 20.064],
];
/** La casa del ciudadano en la demo: una esquina de la ruta. */
export const homeCoordinate = routeCoordinates[6];

const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LNG = 111320 * Math.cos(20.06 * Math.PI / 180);
const segmentMeters = (a, b) => Math.hypot((b[0] - a[0]) * M_PER_DEG_LNG, (b[1] - a[1]) * M_PER_DEG_LAT);
const cumulative = routeCoordinates.reduce((acc, point, index) => {
  acc.push(index ? acc[index - 1] + segmentMeters(routeCoordinates[index - 1], point) : 0);
  return acc;
}, []);
export const routeMeters = cumulative.at(-1);

/** Posición del camión (lng, lat) con `progress` de 0 a 1 medido sobre la distancia: avanza a velocidad constante. */
export function routePosition(progress) {
  const target = Math.max(0, Math.min(1, progress)) * routeMeters;
  let index = 1;
  while (index < cumulative.length - 1 && cumulative[index] < target) index++;
  const from = routeCoordinates[index - 1], to = routeCoordinates[index];
  const span = cumulative[index] - cumulative[index - 1] || 1;
  const amount = Math.max(0, Math.min(1, (target - cumulative[index - 1]) / span));
  return from.map((coordinate, axis) => coordinate + (to[axis] - coordinate) * amount);
}
