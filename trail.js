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

export class SnapError extends Error {
  constructor(message) { super(message); this.name = 'SnapError'; }
}

/* ── Por qué /match y no /route ──
   Se probaron los dos contra datos con ruido de GPS realista (±6 m sobre una
   ruta conocida de 2.89 km):

     trazo crudo (rectas entre pings) ....... 2.71 km   (−6 %)
     /route por los pings ................... 8.89 km   (+208 %)  ← inservible
     /match en trozos ....................... 2.72 km   (−6 %)    ← correcto

   /route obliga a pasar EXACTAMENTE por cada ping. Con ruido, un ping cae al
   otro lado de la calle o en una bocacalle y el enrutador rodea la manzana para
   tocarlo. Con veintitantos pings eso son kilómetros inventados.

   /match usa un modelo que evalúa todos los puntos en conjunto y tolera el
   ruido: es el algoritmo pensado para esto.

   El pero: el servidor público limita /match a 10 coordenadas por petición
   (con 11 responde "TooBig"). Antes se pedían 90 de golpe, así que TODAS las
   peticiones fallaban y el trazo salía sin ajustar — por eso la casilla no
   hacía nada visible. Ahora se trocea a ese tamaño. Un servidor propio admite
   mucho más, y se detecta solo. */
const PUBLIC_OSRM      = /router\.project-osrm\.org/i;
const CHUNK_PUBLIC     = 10;    // tope real del demo público
const CHUNK_OWN        = 90;    // un OSRM propio admite bastante más
const MIN_SEPARATION_M = 30;    // el matching mejora con puntos; solo se quita el ruido de estar parado
const PAUSE_PUBLIC_MS  = 180;   // cortesía con el servidor público
const MAX_REQUESTS     = 60;    // techo para no dispararse en periodos largos

/** Quita puntos casi pegados (camión parado): no aportan y multiplican peticiones. */
function thinPoints(points, minMeters = MIN_SEPARATION_M) {
  if (points.length <= 2) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    if (distanceMeters(out[out.length - 1], points[i]) >= minMeters) out.push(points[i]);
  }
  out.push(points[points.length - 1]);   // el último siempre se conserva
  return out;
}

const coordList = pts => pts.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
const espera = ms => new Promise(r => setTimeout(r, ms));

async function osrmMatch(chunk, endpoint, signal) {
  /* radiuses: cuánto puede desplazarse cada lectura para caer en una calle.
     40 m cubre el error urbano típico sin permitir saltar de calle. */
  const radiuses = chunk.map(() => 40).join(';');
  const url = `${endpoint.replace(/\/$/, '')}/match/v1/driving/${coordList(chunk)}` +
              `?geometries=geojson&overview=full&radiuses=${radiuses}&gaps=split&tidy=true`;

  const res = await fetch(url, { signal });
  if (!res.ok) {
    const detalle = await res.json().catch(() => null);
    throw new SnapError(detalle?.message || `El servidor de rutas respondió ${res.status}.`);
  }
  const json = await res.json();
  if (json.code !== 'Ok' || !json.matchings?.length) {
    throw new SnapError(json.message || 'No se pudo ajustar este tramo a la red vial.');
  }
  /* Un trozo puede partirse en varios matchings si el modelo no logra unirlos. */
  return json.matchings.map(m => m.geometry.coordinates);
}

/**
 * Ajusta los segmentos a las calles reales mediante map matching.
 *
 * Nunca deja sin trazo: el tramo que no se pueda ajustar se devuelve tal cual y
 * se informa cuántos quedaron así.
 *
 * @param {Array<Array<{lat,lng,timestamp}>>} segments
 * @returns {Promise<{lines:Array<Array<[number,number]>>, snapped:boolean,
 *                    error:string|null, adjusted:number, total:number,
 *                    truncated:boolean, endpoint:string}>}
 */
export async function snapSegmentsToRoads(segments, { endpoint, signal } = {}) {
  const url      = endpoint || getOsrmEndpoint();
  const esPublico = PUBLIC_OSRM.test(url);
  const tamano    = esPublico ? CHUNK_PUBLIC : CHUNK_OWN;

  const lines = [];
  let fallos = 0, ajustados = 0, total = 0, ultimoError = null, truncado = false;

  for (const seg of segments) {
    if (seg.length < 2) continue;
    const puntos = thinPoints(seg);

    /* Se solapa un punto entre trozos para que no queden huecos al unirlos. */
    for (let i = 0; i < puntos.length - 1; i += tamano - 1) {
      const chunk = puntos.slice(i, i + tamano);
      if (chunk.length < 2) continue;

      if (total >= MAX_REQUESTS) {
        truncado = true;
        lines.push(...puntos.slice(i).reduce((acc, p) => { acc[0].push([p.lng, p.lat]); return acc; }, [[]]));
        break;
      }
      total++;

      try {
        lines.push(...await osrmMatch(chunk, url, signal));
        ajustados++;
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        console.warn('[snap]', err.message);
        ultimoError = err.message;
        fallos++;
        lines.push(chunk.map(p => [p.lng, p.lat]));   // tramo sin ajustar
      }

      if (esPublico) await espera(PAUSE_PUBLIC_MS);
    }
    if (truncado) break;
  }

  const avisos = [];
  if (fallos)   avisos.push(`${fallos} de ${total} tramos sin ajustar.${ultimoError ? ' ' + ultimoError : ''}`);
  if (truncado) avisos.push('El periodo es muy largo para el servidor público: se ajustó solo el principio. Elige un periodo más corto o conecta un OSRM propio.');

  return {
    lines,
    snapped: fallos === 0 && ajustados > 0 && !truncado,
    adjusted: ajustados,
    total,
    truncated: truncado,
    endpoint: url,
    error: avisos.length ? avisos.join(' ') : null,
  };
}

/** Convierte segmentos crudos en líneas [[lng,lat],…] sin ajustar. */
export const segmentsToLines = segments =>
  segments.filter(s => s.length >= 2).map(s => s.map(p => [p.lng, p.lat]));

/* ══════════════════════════════════════
   AJUSTE INCREMENTAL

   El recorrido crece constantemente: llega una posición nueva cada pocos
   segundos. Volver a ajustar TODO en cada una es inviable — son varias
   peticiones por tanda y ninguna llegaría a terminar antes de la siguiente.

   Este objeto mantiene el trabajo ya hecho: los tramos antiguos quedan
   CONGELADOS y solo se vuelve a pedir la cola que está creciendo. En marcha
   normal eso es una sola petición pequeña por actualización.
══════════════════════════════════════ */
export function createTrailSnapper({ endpoint } = {}) {
  /** @type {Array<Array<[number,number]>>} tramos ya ajustados y definitivos */
  let frozen = [];
  /** cuántos puntos del recorrido están ya congelados */
  let frozenUpTo = 0;
  /** firma de la parte estable, para detectar que el recorrido cambió de raíz */
  let shape = '';
  let lastTail = [];
  let lastTailKey = '';
  let lastStats = { adjusted: 0, total: 0, error: null, truncated: false };

  const chunkSize = () => (PUBLIC_OSRM.test(endpoint || getOsrmEndpoint()) ? CHUNK_PUBLIC : CHUNK_OWN);

  /* Solo el ÚLTIMO segmento crece. Si cambia el número de segmentos (apareció
     un hueco de tiempo) o el recorrido es otro, se empieza de cero. */
  const shapeOf = segments =>
    segments.slice(0, -1).map(s => s.length).join(',') + '|' + segments.length;

  function reset() { frozen = []; frozenUpTo = 0; lastTail = []; lastTailKey = ''; }

  /**
   * @param {Array<Array<{lat,lng,timestamp}>>} segments
   * @returns {Promise<{lines:Array, adjusted:number, total:number,
   *                    error:string|null, incremental:boolean}>}
   */
  async function update(segments, { signal } = {}) {
    const forma = shapeOf(segments);
    const incremental = forma === shape && frozen.length > 0;
    if (!incremental) { reset(); shape = forma; }

    const previos = segments.slice(0, -1);
    const ultimo  = segments[segments.length - 1] || [];

    /* Los segmentos anteriores al último no cambian nunca: se ajustan una vez. */
    if (!incremental) {
      const res = await snapSegmentsToRoads(previos, { endpoint, signal });
      frozen = res.lines;
      frozenUpTo = 0;
      lastStats = res;
    }

    /* De la cola se congela todo menos el último trozo, que puede seguir
       creciendo con las posiciones que lleguen. */
    const tamano = chunkSize();
    const puntos = thinPoints(ultimo);
    const corte = Math.max(0, puntos.length - tamano);

    if (corte > frozenUpTo) {
      const aCongelar = puntos.slice(frozenUpTo, corte + 1);   // +1 para solapar
      if (aCongelar.length >= 2) {
        const res = await snapSegmentsToRoads([aCongelar], { endpoint, signal });
        frozen = frozen.concat(res.lines);
        lastStats = { ...res, adjusted: (lastStats.adjusted || 0) + res.adjusted };
      }
      frozenUpTo = corte;
    }

    /* La cola viva: una sola petición… pero solo si de verdad cambió.
       Si el camión está parado llegan pings que no añaden ningún punto útil
       (thinPoints los descarta), y volver a pedir lo mismo sería tirar
       peticiones al servidor sin cambiar un píxel del mapa. */
    const cola = puntos.slice(frozenUpTo);
    const colaKey = cola.length
      ? `${cola.length}:${cola[cola.length - 1].lng.toFixed(5)},${cola[cola.length - 1].lat.toFixed(5)}`
      : '';

    if (colaKey !== lastTailKey) {
      lastTailKey = colaKey;
      if (cola.length >= 2) {
        const res = await snapSegmentsToRoads([cola], { endpoint, signal });
        lastTail = res.lines;
        lastStats = {
          adjusted: (lastStats.adjusted || 0) + res.adjusted,
          total: (lastStats.total || 0) + res.total,
          error: res.error || lastStats.error,
          truncated: res.truncated || lastStats.truncated,
        };
      } else {
        lastTail = cola.length ? [cola.map(p => [p.lng, p.lat])] : [];
      }
    }

    return {
      lines: frozen.concat(lastTail),
      adjusted: lastStats.adjusted || 0,
      total: lastStats.total || 0,
      error: lastStats.error || null,
      incremental,
    };
  }

  return { update, reset, get frozenChunks() { return frozen.length; } };
}

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
