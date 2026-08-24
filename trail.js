/* ══════════════════════════════════════════════════════
   RUTALIMPIA — trail.js
   Tratamiento del recorrido GPS de un camión.

   El dispositivo manda una posición cada cierto tiempo, no un trazo continuo.
   Dibujar esos puntos "tal cual" produce tres problemas visibles:

     1. SALTOS IMPOSIBLES — una lectura corrupta manda el camión a 3 km y
        vuelve. Se detectan por velocidad implícita y se descartan.
     2. LÍNEAS RECTAS ATRAVESANDO MANZANAS — entre dos pings alejados se traza
        la cuerda, no la calle (el caso de la glorieta). Se corrige ajustando el
        trazo a la red vial real (map matching).
     3. UN SOLO TRAZO PARA TODO EL DÍA — si el camión estuvo apagado 4 horas,
        la línea cruza el pueblo. Se parte en segmentos por hueco de tiempo.

   Nada de esto modifica la base: es tratamiento de presentación.
══════════════════════════════════════════════════════ */

const R_EARTH_KM = 6371;
const rad = d => (d * Math.PI) / 180;

/** Distancia entre dos puntos {lat,lng} en metros. */
export function distanceMeters(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_KM * 1000 * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Velocidad implícita entre dos pings, en km/h. */
export function speedKmh(a, b) {
  const ms = new Date(b.timestamp) - new Date(a.timestamp);
  if (!(ms > 0)) return 0;
  return (distanceMeters(a, b) / 1000) / (ms / 3600000);
}

export const DEFAULT_CLEAN_OPTIONS = {
  maxSpeedKmh: 110,   // por encima de esto es lectura corrupta, no un camión
  minMoveMeters: 4,   // ruido del GPS estando parado
  gapMinutes: 20,     // hueco que corta el trazo en dos segmentos
};

/**
 * Limpia el recorrido y lo parte en segmentos continuos.
 *
 * @param {Array<{lat:number,lng:number,timestamp:string}>} points  en orden cronológico
 * @param {Partial<typeof DEFAULT_CLEAN_OPTIONS>} [options]
 * @returns {{segments:Array<Array>, points:Array, removed:number, gaps:number, distanceKm:number}}
 */
export function cleanTrail(points, options = {}) {
  const opt = { ...DEFAULT_CLEAN_OPTIONS, ...options };
  const src = (points || [])
    .filter(p => Number.isFinite(p?.lat) && Number.isFinite(p?.lng) && p.timestamp)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  if (src.length < 2) return { segments: src.length ? [src] : [], points: src, removed: 0, gaps: 0, distanceKm: 0 };

  const kept = [src[0]];
  let removed = 0;

  for (let i = 1; i < src.length; i++) {
    const prev = kept[kept.length - 1];
    const cur  = src[i];
    const d    = distanceMeters(prev, cur);

    /* Parado: el GPS "tiembla" unos metros. Se ignora para no ensuciar el trazo,
       pero el punto sigue existiendo para la reproducción por tiempo. */
    if (d < opt.minMoveMeters) { cur._still = true; removed++; continue; }

    const v = speedKmh(prev, cur);
    /* Solo se descarta por velocidad si además el salto es grande: dos pings
       muy seguidos dan velocidades enormes sin ser errores. */
    if (v > opt.maxSpeedKmh && d > 150) { cur._outlier = true; removed++; continue; }

    kept.push(cur);
  }

  /* Corte en segmentos por hueco temporal */
  const segments = [];
  let current = [kept[0]];
  for (let i = 1; i < kept.length; i++) {
    const minutes = (new Date(kept[i].timestamp) - new Date(kept[i - 1].timestamp)) / 60000;
    if (minutes > opt.gapMinutes) { segments.push(current); current = [kept[i]]; }
    else current.push(kept[i]);
  }
  if (current.length) segments.push(current);

  const distanceKm = segments.reduce((total, seg) => {
    let d = 0;
    for (let i = 1; i < seg.length; i++) d += distanceMeters(seg[i - 1], seg[i]);
    return total + d / 1000;
  }, 0);

  return {
    segments: segments.filter(s => s.length >= 2),
    points: kept,
    removed,
    gaps: Math.max(0, segments.length - 1),
    distanceKm,
  };
}

/* ══════════════════════════════════════
   AJUSTE A CALLES (map matching)

   Pegar cada punto a la calle más cercana NO basta: el problema no son los
   puntos, es la recta que los une. Hace falta un motor que reconstruya el
   camino real por la red vial. Se usa OSRM (/match), que es lo que mueve el
   enrutador de OpenStreetMap.

   El servidor es configurable porque el público es una demo con límites de uso;
   el proyecto ya levanta contenedores propios (ver mapOverPass/), así que puede
   apuntar a un OSRM propio cuando exista.
══════════════════════════════════════ */

const LS_OSRM = 'rl_osrm_endpoint';
export const DEFAULT_OSRM = 'https://router.project-osrm.org';

export const getOsrmEndpoint = () => {
  try { return localStorage.getItem(LS_OSRM) || DEFAULT_OSRM; } catch { return DEFAULT_OSRM; }
};
export const setOsrmEndpoint = v => {
  try { const t = (v || '').trim(); t ? localStorage.setItem(LS_OSRM, t) : localStorage.removeItem(LS_OSRM); } catch {}
};

/* OSRM acepta como máximo ~100 coordenadas por petición. */
const MATCH_CHUNK = 90;

export class SnapError extends Error {
  constructor(message) { super(message); this.name = 'SnapError'; }
}

async function matchChunk(chunk, endpoint, signal) {
  const coords = chunk.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  /* radiuses: cuánto puede moverse cada punto para caer en una calle. Generoso,
     porque las lecturas urbanas se desvían fácil 20-30 m entre edificios. */
  const radiuses = chunk.map(() => 35).join(';');
  const timestamps = chunk.map(p => Math.floor(new Date(p.timestamp).getTime() / 1000)).join(';');

  const url = `${endpoint.replace(/\/$/, '')}/match/v1/driving/${coords}` +
              `?geometries=geojson&overview=full&radiuses=${radiuses}&timestamps=${timestamps}&gaps=split&tidy=true`;

  const res = await fetch(url, { signal });
  if (!res.ok) throw new SnapError(`El servidor de rutas respondió ${res.status}.`);
  const json = await res.json();
  if (json.code !== 'Ok' || !json.matchings?.length) {
    throw new SnapError(json.message || 'No se pudo ajustar este tramo a la red vial.');
  }
  /* Un chunk puede partirse en varios matchings si OSRM no logra unirlos. */
  return json.matchings.map(m => m.geometry.coordinates); // [[lng,lat], …]
}

/**
 * Ajusta los segmentos a las calles reales.
 * Si el servidor falla, devuelve el trazo original marcando `snapped: false`:
 * es preferible mostrar la línea cruda que no mostrar nada.
 *
 * @param {Array<Array<{lat,lng,timestamp}>>} segments
 * @returns {Promise<{lines:Array<Array<[number,number]>>, snapped:boolean, error:string|null}>}
 */
export async function snapSegmentsToRoads(segments, { endpoint, signal } = {}) {
  const url = endpoint || getOsrmEndpoint();
  const lines = [];
  let failures = 0;

  for (const seg of segments) {
    if (seg.length < 2) continue;
    /* Se solapa un punto entre trozos para que no queden huecos al unirlos. */
    for (let i = 0; i < seg.length; i += MATCH_CHUNK - 1) {
      const chunk = seg.slice(i, i + MATCH_CHUNK);
      if (chunk.length < 2) continue;
      try {
        lines.push(...await matchChunk(chunk, url, signal));
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        failures++;
        lines.push(chunk.map(p => [p.lng, p.lat]));   // tramo sin ajustar
      }
    }
  }

  return {
    lines,
    snapped: failures === 0 && lines.length > 0,
    error: failures ? `${failures} tramo${failures > 1 ? 's' : ''} no se pudo ajustar a calles.` : null,
  };
}

/** Convierte segmentos crudos en líneas [[lng,lat],…] sin ajustar. */
export const segmentsToLines = segments =>
  segments.filter(s => s.length >= 2).map(s => s.map(p => [p.lng, p.lat]));

/* ══════════════════════════════════════
   REPRODUCCIÓN ANIMADA

   La animación va sobre el TIEMPO REAL del recorrido, no sobre el índice de los
   puntos: si el camión estuvo 10 minutos parado, en la reproducción se nota.
   Entre dos pings se interpola la posición para que el movimiento sea continuo
   en lugar de saltar de marcador en marcador.
══════════════════════════════════════ */

/** Prepara un recorrido para reproducirlo: tiempos normalizados y acumulados. */
export function buildPlayback(points) {
  const pts = (points || [])
    .filter(p => Number.isFinite(p?.lat) && Number.isFinite(p?.lng) && p.timestamp)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  if (pts.length < 2) return null;

  const t0 = new Date(pts[0].timestamp).getTime();
  const t1 = new Date(pts[pts.length - 1].timestamp).getTime();
  const frames = pts.map(p => ({
    lng: p.lng, lat: p.lat,
    t: new Date(p.timestamp).getTime() - t0,
    timestamp: p.timestamp,
    event: p.event ?? null,
    battery_pct: p.battery_pct ?? null,
    truck_capacity: p.truck_capacity ?? null,
  }));

  return { frames, duration: Math.max(1, t1 - t0), startedAt: t0, endedAt: t1 };
}

/**
 * Posición en un instante dado del recorrido (ms desde el inicio).
 * Devuelve además el rumbo, para poder orientar el marcador.
 */
export function positionAt(playback, elapsedMs) {
  const { frames } = playback;
  const t = Math.max(0, Math.min(playback.duration, elapsedMs));

  /* Búsqueda binaria: con miles de puntos, recorrer el arreglo en cada cuadro
     de animación se nota. */
  let lo = 0, hi = frames.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) lo = mid; else hi = mid;
  }

  const a = frames[lo], b = frames[hi];
  const span = b.t - a.t;
  const k = span > 0 ? (t - a.t) / span : 0;

  return {
    lng: a.lng + (b.lng - a.lng) * k,
    lat: a.lat + (b.lat - a.lat) * k,
    bearing: bearingBetween(a, b),
    index: lo,
    frame: k < 0.5 ? a : b,
    elapsed: t,
  };
}

/** Rumbo en grados (0 = norte), para girar el ícono del camión. */
export function bearingBetween(a, b) {
  const φ1 = rad(a.lat), φ2 = rad(b.lat), Δλ = rad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/** Porción del trazo ya recorrida en un instante, para pintarla distinto. */
export function traveledLine(playback, elapsedMs) {
  const pos = positionAt(playback, elapsedMs);
  const coords = playback.frames.slice(0, pos.index + 1).map(f => [f.lng, f.lat]);
  coords.push([pos.lng, pos.lat]);
  return coords.length >= 2 ? coords : null;
}

/** "1 h 24 min" / "12 min" — duración legible del recorrido. */
export function formatDuration(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${String(min % 60).padStart(2, '0')} min`;
}
