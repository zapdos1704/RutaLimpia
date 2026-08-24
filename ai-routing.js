/* ══════════════════════════════════════════════════════
   RUTALIMPIA — ai-routing.js
   Sugerencia automática de rutas.

   ESTADO: el modelo de IA todavía NO existe. Este módulo deja listo todo lo que
   sí se puede tener hoy:

     1. Obtener las calles reales del área (OpenStreetMap vía Overpass).
     2. Un contrato HTTP claro para el futuro servicio de IA, configurable desde
        la interfaz (no hay que tocar código para conectarlo).
     3. Un trazado heurístico local (vecino más cercano) que se usa mientras el
        modelo no esté conectado, para que el flujo completo sea usable y
        probable desde ahora.

   Cuando el servicio de Python exista, basta con capturar su URL en el modal de
   "Nueva ruta" → pestaña "Automática (IA)" → "Servicio de IA".
   Ver AI_RUTAS.md para el contrato de petición/respuesta.
══════════════════════════════════════════════════════ */

const LS_AI_ENDPOINT   = 'rl_ai_routing_endpoint';
const LS_AI_KEY        = 'rl_ai_routing_key';
const LS_OVERPASS       = 'rl_overpass_endpoint';

export const DEFAULT_OVERPASS = 'https://overpass-api.de/api/interpreter';
/* El proyecto ya tiene un Overpass propio (mapOverPass/docker-compose.yaml)
   publicado en el puerto 12345; se ofrece como opción en la interfaz. */
export const LOCAL_OVERPASS   = 'http://localhost:12345/api/interpreter';

const read  = (k, fallback = '') => { try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; } };
const write = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* modo privado */ } };

export const getAiEndpoint  = () => read(LS_AI_ENDPOINT);
export const setAiEndpoint  = v => write(LS_AI_ENDPOINT, (v || '').trim());
export const getAiKey       = () => read(LS_AI_KEY);
export const setAiKey       = v => write(LS_AI_KEY, (v || '').trim());
export const getOverpass    = () => read(LS_OVERPASS) || DEFAULT_OVERPASS;
export const setOverpass    = v => write(LS_OVERPASS, (v || '').trim());
export const isAiConfigured = () => !!getAiEndpoint();

/* ── Geometría ── */

const R_EARTH_KM = 6371;
const rad = d => (d * Math.PI) / 180;

/** Haversine, en km. Puntos en formato [lng, lat]. */
export function haversineKm(a, b) {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Longitud total de una polilínea [[lng,lat], …] en km. */
export function pathLengthKm(coords) {
  let total = 0;
  for (let i = 1; i < (coords?.length || 0); i++) total += haversineKm(coords[i - 1], coords[i]);
  return total;
}

/**
 * Caja envolvente de una lista de puntos, con margen opcional en km.
 * @param {Array<[number,number]>} points [lng, lat]
 * @returns {{south:number, west:number, north:number, east:number}}
 */
export function bboxOfPoints(points, padKm = 0.3) {
  const lngs = points.map(p => p[0]), lats = points.map(p => p[1]);
  const padLat = padKm / 111.32;
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const padLng = padKm / (111.32 * Math.max(0.2, Math.cos(rad(midLat))));
  return {
    south: Math.min(...lats) - padLat,
    west:  Math.min(...lngs) - padLng,
    north: Math.max(...lats) + padLat,
    east:  Math.max(...lngs) + padLng,
  };
}

/** Área aproximada del bbox en km², para avisar cuando la consulta será enorme. */
export function bboxAreaKm2(b) {
  const h = (b.north - b.south) * 111.32;
  const w = (b.east - b.west) * 111.32 * Math.cos(rad((b.north + b.south) / 2));
  return Math.abs(h * w);
}

/** El bbox como anillo cerrado, para dibujarlo en el mapa. */
export function bboxToRing(b) {
  return [[b.west, b.south], [b.east, b.south], [b.east, b.north], [b.west, b.north], [b.west, b.south]];
}

/* ── OpenStreetMap / Overpass ── */

/* Calles por las que puede circular un camión recolector. Se excluyen
   explícitamente andadores, escaleras y ciclovías. */
const DRIVABLE = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|road';

export class OverpassError extends Error {
  constructor(message) { super(message); this.name = 'OverpassError'; }
}

/**
 * Descarga las calles reales dentro del área indicada.
 * Es una lectura de datos públicos de OpenStreetMap; solo se envía el recuadro.
 *
 * @param {{south:number,west:number,north:number,east:number}} bbox
 * @param {{signal?:AbortSignal, endpoint?:string}} [opts]
 * @returns {Promise<{ways:Array, totalKm:number, bbox:object, endpoint:string}>}
 */
export async function fetchStreetsInBBox(bbox, opts = {}) {
  const endpoint = opts.endpoint || getOverpass();
  const { south, west, north, east } = bbox;
  const query = `[out:json][timeout:30];
way["highway"~"^(${DRIVABLE})$"]["area"!~"yes"](${south.toFixed(6)},${west.toFixed(6)},${north.toFixed(6)},${east.toFixed(6)});
out geom;`;

  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: query,
      signal: opts.signal,
    });
  } catch (err) {
    throw new OverpassError(`No se pudo contactar el servidor de calles (${endpoint}). ${err.message}`);
  }
  if (!res.ok) {
    throw new OverpassError(res.status === 429 || res.status === 504
      ? 'El servidor público de OpenStreetMap está saturado. Intenta de nuevo o usa el Overpass local.'
      : `El servidor de calles respondió ${res.status}.`);
  }

  const json = await res.json();
  const ways = (json.elements || [])
    .filter(el => el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 2)
    .map(el => ({
      id: el.id,
      name: el.tags?.name || null,
      highway: el.tags?.highway || null,
      oneway: el.tags?.oneway === 'yes',
      coords: el.geometry.map(g => [g.lon, g.lat]),
    }));

  ways.forEach(w => { w.lengthKm = pathLengthKm(w.coords); });
  const totalKm = ways.reduce((s, w) => s + w.lengthKm, 0);
  return { ways, totalKm, bbox, endpoint };
}

/** Nombres de calle únicos, para mostrar un resumen legible. */
export function uniqueStreetNames(ways) {
  return [...new Set(ways.map(w => w.name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
}

/* ── Servicio de IA (aún no desplegado) ── */

export class AiNotConfiguredError extends Error {
  constructor() {
    super('El servicio de IA de rutas todavía no está conectado.');
    this.name = 'AiNotConfiguredError';
  }
}

/**
 * Construye el cuerpo que recibirá el modelo. Este objeto ES el contrato:
 * documentarlo aquí evita que el servicio de Python y la web se desincronicen.
 * Ver AI_RUTAS.md.
 */
export function buildAiRequest({ streets, depot, vehicle, bbox, constraints = {} }) {
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    area: bbox ? { bbox, area_km2: Number(bboxAreaKm2(bbox).toFixed(3)) } : null,
    depot: depot ? { lng: depot[0], lat: depot[1] } : null,
    vehicle: vehicle ? {
      id: vehicle.id,
      economic_number: vehicle.economic_number,
      capacity_tons: vehicle.capacity_tons ?? null,
      type: vehicle.type ?? null,
    } : null,
    constraints: {
      max_distance_km: constraints.maxKm ?? null,
      avoid_narrow_alleys: !!constraints.avoidNarrow,
      avoid_steep_terrain: !!constraints.avoidSteep,
      route_type: constraints.routeType ?? null,
      ...constraints.extra,
    },
    streets: (streets || []).map(w => ({
      id: w.id, name: w.name, highway: w.highway, oneway: w.oneway,
      length_km: Number((w.lengthKm ?? pathLengthKm(w.coords)).toFixed(4)),
      coordinates: w.coords,
    })),
  };
}

/**
 * Pide la ruta sugerida al servicio de IA.
 * Respuesta esperada: { coordinates:[[lng,lat],…], name?, distance_km?, notes?, model? }
 *
 * @throws {AiNotConfiguredError} si aún no se capturó la URL del servicio.
 */
export async function requestAiRoute(request, { signal } = {}) {
  const endpoint = getAiEndpoint();
  if (!endpoint) throw new AiNotConfiguredError();

  const headers = { 'Content-Type': 'application/json' };
  const key = getAiKey();
  if (key) headers['Authorization'] = `Bearer ${key}`;

  const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(request), signal });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`El servicio de IA respondió ${res.status}. ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!Array.isArray(data?.coordinates) || data.coordinates.length < 2) {
    throw new Error('El servicio de IA no devolvió un trazo válido (se esperaba "coordinates").');
  }
  return {
    coordinates: data.coordinates,
    name: data.name || null,
    distanceKm: data.distance_km ?? pathLengthKm(data.coordinates),
    notes: data.notes || null,
    model: data.model || 'servicio-ia',
    source: 'ia',
  };
}

/* ── Trazado heurístico local (mientras no haya modelo) ── */

const endpointsOf = w => [w.coords[0], w.coords[w.coords.length - 1]];

/**
 * Encadena las calles con "vecino más cercano": desde el punto actual se toma
 * la calle cuyo extremo esté más cerca, se recorre completa y se continúa desde
 * su otro extremo. No es óptimo (eso lo hará el modelo), pero produce un
 * recorrido coherente y sin saltos absurdos.
 *
 * @param {{streets:Array, depot?:[number,number], maxStreets?:number, maxKm?:number}} params
 */
export function suggestRouteLocally({ streets, depot, maxStreets = 80, maxKm = null }) {
  const pending = (streets || []).filter(w => w.coords?.length >= 2).slice();
  if (!pending.length) return { coordinates: [], distanceKm: 0, streetsUsed: 0, source: 'heuristica' };

  let current = depot || pending[0].coords[0];
  const out = [];
  let used = 0, km = 0;

  while (pending.length && used < maxStreets) {
    let bestIdx = 0, bestDist = Infinity, bestReversed = false;
    pending.forEach((w, i) => {
      const [a, b] = endpointsOf(w);
      const da = haversineKm(current, a);
      const db = haversineKm(current, b);
      if (da < bestDist)  { bestDist = da; bestIdx = i; bestReversed = false; }
      if (db < bestDist)  { bestDist = db; bestIdx = i; bestReversed = true; }
    });

    const way = pending.splice(bestIdx, 1)[0];
    const coords = bestReversed ? [...way.coords].reverse() : way.coords;
    const addKm = bestDist + (way.lengthKm ?? pathLengthKm(way.coords));
    if (maxKm && km + addKm > maxKm) break;

    /* No se repite el punto de unión cuando coincide con el último añadido. */
    const startAt = out.length && out[out.length - 1][0] === coords[0][0] && out[out.length - 1][1] === coords[0][1] ? 1 : 0;
    out.push(...coords.slice(startAt));
    current = coords[coords.length - 1];
    km += addKm;
    used++;
  }

  return {
    coordinates: out,
    distanceKm: pathLengthKm(out),
    streetsUsed: used,
    streetsSkipped: pending.length,
    source: 'heuristica',
    model: 'vecino-mas-cercano (local)',
  };
}

/**
 * Punto de entrada único: usa la IA si está conectada; si no, avisa y cae en la
 * heurística local. Devuelve siempre `source` para que la interfaz sea honesta
 * sobre quién generó el trazo.
 */
export async function suggestRoute(params, { signal } = {}) {
  if (isAiConfigured()) {
    const request = buildAiRequest(params);
    return await requestAiRoute(request, { signal });
  }
  return suggestRouteLocally(params);
}
