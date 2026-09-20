/* ══════════════════════════════════════════════════════
   dump-sites.js
   Tiraderos (geocercas). Cuando un camión entra a uno, el backend lo da por «vaciando» y
   pausa la hora estimada de los ciudadanos hasta que vuelve a la ruta.
   Un tiradero es un CÍRCULO (centro + radio 30–1000 m) o un POLÍGONO (400 m² – 2 km²).
   Lógica pura (sin DOM ni red); las mismas reglas que valida save_dump_site() en SQL 008.
   Coordenadas siempre [lng, lat].
   ══════════════════════════════════════════════════════ */

import { closeRing, ringAreaKm2, ringSelfIntersects, rad } from './geo.js?v=7d5234fc';

export const RADIUS_MIN = 30;
export const RADIUS_MAX = 1000;
export const RADIUS_DEFAULT = 100;
export const AREA_MIN_M2 = 400;
export const AREA_MAX_M2 = 2_000_000;
export const NAME_MAX = 80;

const validLngLat = p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) &&
  Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;

/** Anillo cerrado que aproxima un círculo de `radiusM` metros alrededor de [lng, lat]. */
export function circleRing(center, radiusM, steps = 48) {
  const [lng, lat] = center;
  const mPerDegLat = (Math.PI / 180) * 6371000;
  const mPerDegLng = mPerDegLat * Math.cos(rad(lat));
  const ring = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([lng + (radiusM * Math.sin(a)) / mPerDegLng, lat + (radiusM * Math.cos(a)) / mPerDegLat]);
  }
  ring.push(ring[0]);
  return ring;
}

/** Forma de una fila de dump_sites_geo. */
export const shapeOf = row => (row?.area && Array.isArray(row.area.coordinates) ? 'polygon' : 'circle');

/** Anillo cerrado de la fila, para dibujarlo en el mapa (o null si la fila está dañada). */
export function siteRing(row) {
  if (shapeOf(row) === 'polygon') {
    const ring = row.area.coordinates?.[0];
    return Array.isArray(ring) && ring.length >= 4 && ring.every(validLngLat) ? ring : null;
  }
  const center = [row?.center_lng, row?.center_lat];
  const r = Number(row?.radius_m);
  return validLngLat(center) && Number.isFinite(r) && r > 0 ? circleRing(center, r) : null;
}

/** Punto donde centrar el mapa al elegir un tiradero. */
export function siteCenter(row) {
  if (shapeOf(row) === 'circle') {
    const c = [row?.center_lng, row?.center_lat];
    return validLngLat(c) ? c : null;
  }
  const ring = siteRing(row);
  if (!ring) return null;
  const pts = ring.slice(0, -1);
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export function describeSite(row) {
  if (shapeOf(row) === 'circle') return `Círculo de ${Math.round(Number(row?.radius_m) || 0)} m`;
  const ring = siteRing(row);
  if (!ring) return 'Polígono';
  const m2 = ringAreaKm2(ring) * 1e6;
  return m2 >= 100_000 ? `Polígono de ${round(m2 / 1e6)} km²` : `Polígono de ${Math.round(m2)} m²`;
}

/** FeatureCollection con todos los tiradero válidos (los círculos como polígonos de 48 lados). */
export function sitesToFeatureCollection(rows, selectedId = null) {
  const features = [];
  for (const row of rows || []) {
    const ring = siteRing(row);
    if (!ring) continue;
    features.push({
      type: 'Feature',
      properties: { id: row.id, name: row.name, active: row.is_active !== false, selected: row.id === selectedId },
      geometry: { type: 'Polygon', coordinates: [ring] },
    });
  }
  return { type: 'FeatureCollection', features };
}

/** Área (m²) de un anillo dibujado, con la misma proyección plana que usa el resto del panel. */
export function ringAreaM2(ring) {
  return ring && ring.length >= 3 ? ringAreaKm2(ring) * 1e6 : 0;
}

/**
 * Valida el formulario y arma los argumentos de save_dump_site().
 * form: { id?, name, shape: 'circle'|'polygon', center?, radius?, ring?, active? }
 */
export function buildSavePayload(form) {
  const name = String(form?.name ?? '').trim();
  if (!name) return { ok: false, error: 'Ponle un nombre al tiradero.' };
  if (name.length > NAME_MAX) return { ok: false, error: `El nombre no puede pasar de ${NAME_MAX} caracteres.` };

  const base = { p_id: form.id ?? null, p_name: name, p_active: form.active !== false };

  if (form.shape === 'polygon') {
    const ring = Array.isArray(form.ring) ? form.ring : [];
    const pts = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
    if (pts.length < 3) return { ok: false, error: 'Dibuja al menos 3 puntos en el mapa.' };
    if (!pts.every(validLngLat)) return { ok: false, error: 'Hay un punto con coordenadas no válidas.' };
    if (ringSelfIntersects(pts)) return { ok: false, error: 'Los lados de la zona se cruzan. Usa «Deshacer» y corrígelos.' };
    const m2 = ringAreaM2(pts);
    if (m2 < AREA_MIN_M2) return { ok: false, error: `La zona mide ${Math.round(m2)} m²; el mínimo es ${AREA_MIN_M2} m². Dibújala más grande.` };
    if (m2 > AREA_MAX_M2) return { ok: false, error: `La zona mide ${round(m2 / 1e6)} km²; el máximo es ${AREA_MAX_M2 / 1e6} km². Dibújala más pequeña.` };
    return { ok: true, args: { ...base, p_center_lng: null, p_center_lat: null, p_radius_m: null, p_polygon: { type: 'Polygon', coordinates: [closeRing(pts)] } } };
  }

  if (!validLngLat(form.center)) return { ok: false, error: 'Haz clic en el mapa para colocar el centro del tiradero.' };
  const radiusText = String(form.radius ?? '').trim().replace(',', '.');
  const radius = /^\d+(\.\d+)?$/.test(radiusText) ? Math.round(Number(radiusText)) : NaN;
  if (!Number.isFinite(radius)) return { ok: false, error: 'Escribe el radio en metros (por ejemplo 100).' };
  if (radius < RADIUS_MIN || radius > RADIUS_MAX) return { ok: false, error: `El radio debe estar entre ${RADIUS_MIN} y ${RADIUS_MAX} metros.` };
  return { ok: true, args: { ...base, p_center_lng: form.center[0], p_center_lat: form.center[1], p_radius_m: radius, p_polygon: null } };
}
