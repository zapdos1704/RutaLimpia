import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
import { deriveDeviceIncidents, timeAgo } from './events.js';

const SUPABASE_URL     = 'https://psbxfrwcubgwmycztiqu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzYnhmcndjdWJnd215Y3p0aXF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2OTkyNzEsImV4cCI6MjA5MzI3NTI3MX0.EYCGIACWSP9ByEeiAHSnIN_Z6k7IxDkf0shIiJVZF2g';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ── Evita que una petición se quede colgada para siempre ──
   Si Supabase no responde en el tiempo dado, se rechaza la promesa
   para que el catch de cada función pueda recuperarse y la UI no se trabe. */
function withTimeout(promise, ms = 10000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Tiempo de espera agotado. Verifica tu conexión.')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/* ── Rango de fechas segun periodo ── */
export function getDateRange(period = 'mensual') {
  const end   = new Date();
  const start = new Date();
  if      (period === 'diario')   { start.setHours(0, 0, 0, 0); }
  else if (period === 'semanal')  { start.setDate(end.getDate() - 6); start.setHours(0, 0, 0, 0); }
  else                            { start.setDate(end.getDate() - 29); start.setHours(0, 0, 0, 0); }
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/* ── Vehiculos ── */
export async function getVehicles() {
  try {
    const { data, error } = await withTimeout(sb.from('vehicles').select('*').order('economic_number'));
    if (error) throw error;
    return data || [];
  } catch (err) { console.error('[vehicles]', err); return []; }
}

/* Descarta coordenadas basura: fuera de rango o el clásico (0,0) que reporta
   el dispositivo cuando aún no tiene fix GPS. Sin este filtro el mapa se aleja
   hasta el Atlántico para poder encuadrar ese punto. */
export function isValidLatLng(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
         Math.abs(lat) <= 90 && Math.abs(lng) <= 180 &&
         !(lat === 0 && lng === 0);
}

/* Convierte una columna geometry (PostGIS, formato GeoJSON) en {lat, lng} */
function pointFromGeometry(geom) {
  if (geom && Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
    const [lng, lat] = geom.coordinates;
    if (isValidLatLng(lat, lng)) return { lat, lng };
  }
  return { lat: null, lng: null };
}

/* ── Telemetria GPS ──
   La tabla real es "device_telemetry" (con columna "location" tipo geometry),
   no "device_telemetry_geo". */
export async function getTelemetry() {
  try {
    const { data, error } = await withTimeout(
      sb.from('device_telemetry').select('*, vehicle:vehicles(economic_number, plates)')
    );
    if (error) throw error;
    return (data || []).map(row => ({ ...row, ...pointFromGeometry(row.location) }));
  } catch (err) { console.error('[telemetry]', err); return []; }
}

/* ── Recolecciones con joins ── */
export async function getCollections(period = 'mensual') {
  try {
    const { start, end } = getDateRange(period);
    const { data, error } = await withTimeout(
      sb.from('collections')
        .select('*, vehicle:vehicles(economic_number,plates), route:routes(name,route_type), driver:users(name), shift:shifts(name)')
        .gte('scheduled_date', start)
        .lte('scheduled_date', end)
        .order('scheduled_date', { ascending: false })
    );
    if (error) throw error;
    return data || [];
  } catch (err) { console.error('[collections]', err); return []; }
}

/* ── Campañas ── */
export async function getCampaigns() {
  try {
    const { data, error } = await withTimeout(sb.from('campaigns').select('*').order('start_date', { ascending: false }));
    if (error) throw error;
    return data || [];
  } catch (err) { console.error('[campaigns]', err); return []; }
}

/* ── Estadisticas de residuos ── */
export async function getWasteStats(period = 'mensual') {
  try {
    const { start, end } = getDateRange(period);
    const { data, error } = await withTimeout(
      sb.from('waste_stats').select('*').gte('date', start).lte('date', end).order('date')
    );
    if (error) throw error;
    return data || [];
  } catch (err) { console.error('[waste_stats]', err); return []; }
}

/* ── Capacidad del camión ──
   La telemetría guarda la capacidad como texto, no como número. */
export const CAPACITY_PCT   = { vacio: 0, algo_lleno: 25, medio: 50, lleno: 100 };
export const CAPACITY_LABEL = { vacio: 'Vacío', algo_lleno: 'Algo lleno', medio: 'Medio', lleno: 'Lleno' };
export const capacityPct   = value => CAPACITY_PCT[value] ?? 0;
export const capacityLabel = value => CAPACITY_LABEL[value] || '—';

/* ── Rutas ── */
export async function getRoutes() {
  try {
    const { data, error } = await withTimeout(sb.from('routes').select('*').order('name'));
    if (error) throw error;
    return data || [];
  } catch (err) { console.error('[routes]', err); return []; }
}

/* ── Alta de ruta ──
   `coordinates` es un arreglo [[lng,lat], …] (orden GeoJSON). La columna
   routes.geometry es PostGIS; PostgREST no acepta GeoJSON directo, así que el
   trazo se manda como EWKT, que Postgres sí sabe convertir.

   Si el despliegue tiene la escritura de geometría restringida (por ejemplo,
   envuelta en un RPC), el insert con trazo falla. En ese caso NO se pierde el
   trabajo: la ruta se guarda sin trazo y se avisa a quien la creó. */
function toEwktLineString(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const pts = coordinates
    .filter(c => Array.isArray(c) && c.length >= 2 && isValidLatLng(c[1], c[0]))
    .map(c => `${Number(c[0]).toFixed(6)} ${Number(c[1]).toFixed(6)}`);
  return pts.length >= 2 ? `SRID=4326;LINESTRING(${pts.join(',')})` : null;
}

export async function insertRoute(form, coordinates) {
  const geometry = toEwktLineString(coordinates);
  const payload = geometry ? { ...form, geometry } : { ...form };

  const { data, error } = await withTimeout(sb.from('routes').insert([payload]).select());
  if (!error) return { route: data?.[0], geometrySaved: !!geometry };

  /* Reintento sin trazo solo si el fallo viene de la geometría. */
  const geometryIssue = geometry && /geometry|geom|wkt|srid|parse/i.test(error.message || '');
  if (!geometryIssue) throw error;

  console.warn('[insertRoute] no se pudo guardar la geometría, se guarda la ruta sin trazo:', error.message);
  const retry = await withTimeout(sb.from('routes').insert([{ ...form }]).select());
  if (retry.error) throw retry.error;
  return { route: retry.data?.[0], geometrySaved: false, geometryError: error.message };
}

/* ── Cuadrilla de los vehículos (conductor + ayudantes) ── */
export async function getVehicleCrew() {
  try {
    const { data, error } = await withTimeout(
      sb.from('vehicle_crew')
        .select('*, user:users(name, phone, role)')
        .eq('is_active', true)
    );
    if (error) throw error;
    return data || [];
  } catch (err) { console.error('[vehicle_crew]', err); return []; }
}

export async function insertVehicle(form) {
  const { data, error } = await withTimeout(sb.from('vehicles').insert([form]).select());
  if (error) throw error;
  return data?.[0];
}

export async function assignCrewMember(vehicleId, userId, crewRole) {
  const { error } = await withTimeout(
    sb.from('vehicle_crew').insert([{ vehicle_id: vehicleId, user_id: userId, crew_role: crewRole, is_active: true }])
  );
  if (error) throw error;
}

/* Asigna una ruta a un vehículo creando/actualizando la recolección de hoy */
export async function assignRouteToVehicle(vehicleId, routeId) {
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: existing }, { data: crew }, { data: shifts }] = await Promise.all([
    withTimeout(sb.from('collections').select('id').eq('vehicle_id', vehicleId).eq('scheduled_date', today).limit(1)),
    withTimeout(sb.from('vehicle_crew').select('user_id').eq('vehicle_id', vehicleId).eq('crew_role', 'driver').limit(1)),
    withTimeout(sb.from('shifts').select('id').order('start_time').limit(1)),
  ]);

  if (existing?.length) {
    const { error } = await withTimeout(
      sb.from('collections').update({ route_id: routeId }).eq('id', existing[0].id)
    );
    if (error) throw error;
    return;
  }

  const driverId = crew?.[0]?.user_id;
  if (!driverId) throw new Error('Asigna primero un conductor a este camión');
  if (!shifts?.length) throw new Error('No hay turnos registrados');

  const { error } = await withTimeout(sb.from('collections').insert([{
    vehicle_id: vehicleId, route_id: routeId, driver_id: driverId, shift_id: shifts[0].id,
    status: 'in_progress', priority: 'normal', scheduled_date: today,
    started_at: new Date().toISOString(), notes: 'Ruta asignada desde el panel de camiones.',
  }]));
  if (error) throw error;
}

export async function updateVehicleStatus(vehicleId, status, notes) {
  const patch = { status };
  if (notes !== undefined) patch.notes = notes;
  const { error } = await withTimeout(sb.from('vehicles').update(patch).eq('id', vehicleId));
  if (error) throw error;
}

/* ── Qué quedaría huérfano al borrar un camión ──
   Se consulta ANTES de eliminar para poder advertir con datos reales, no con
   suposiciones. En las tablas chicas se cuenta exacto; en gps_logs (miles de
   filas) basta con saber si hay historial o no, contar sería caro. */
export async function getVehicleUsage(vehicleId) {
  const usage = { crew: 0, collections: 0, hasGpsHistory: false, hasTelemetry: false, unknown: [] };

  const exactCount = async (table) => {
    const { count, error } = await withTimeout(
      sb.from(table).select('*', { count: 'exact', head: true }).eq('vehicle_id', vehicleId)
    );
    if (error) throw error;
    return count ?? 0;
  };
  const exists = async (table) => {
    const { data, error } = await withTimeout(
      sb.from(table).select('vehicle_id').eq('vehicle_id', vehicleId).limit(1)
    );
    if (error) throw error;
    return (data || []).length > 0;
  };

  const tasks = [
    ['crew',          () => exactCount('vehicle_crew')],
    ['collections',   () => exactCount('collections')],
    ['hasGpsHistory', () => exists('gps_logs')],
    ['hasTelemetry',  () => exists('device_telemetry')],
  ];
  await Promise.all(tasks.map(async ([key, fn]) => {
    try { usage[key] = await fn(); }
    catch (err) { console.warn('[vehicle_usage]', key, err.message); usage.unknown.push(key); }
  }));
  return usage;
}

/* Error de borrado con el motivo clasificado y el mensaje CRUDO de Postgres.
   Ese mensaje crudo es lo único que permite distinguir "hay historial ligado"
   de "la política RLS no te deja"; ocultarlo deja al usuario sin salida. */
export class VehicleDeleteError extends Error {
  /** @param {'fk'|'permission'|'unknown'} reason */
  constructor(reason, message, { raw = null, blockedBy = null, table = null } = {}) {
    super(message);
    this.name = 'VehicleDeleteError';
    this.reason = reason;
    this.raw = raw;         // texto original de Supabase/Postgres
    this.blockedBy = blockedBy; // tabla que impide el borrado, si Postgres la nombra
    this.table = table;     // tabla en la que ocurrió el fallo
  }
}
/* Alias histórico: page-9 lo usaba antes de tener la clasificación por motivo. */
export const VehicleInUseError = VehicleDeleteError;

const rawText = e => [e?.code, e?.message, e?.details, e?.hint].filter(Boolean).join(' · ');

/* Postgres nombra la tabla en details:
   'Key (id)=(…) is still referenced from table "collections".' */
function referencedTable(error) {
  const m = /still referenced from table "([^"]+)"/i.exec(`${error?.details || ''} ${error?.message || ''}`);
  return m ? m[1] : null;
}

function classifyDeleteError(error, table) {
  const text = rawText(error);
  if (/23503|foreign key|still referenced/i.test(text)) {
    const blockedBy = referencedTable(error);
    return new VehicleDeleteError('fk',
      blockedBy
        ? `La base no permite borrarlo: todavía hay registros en "${blockedBy}" que apuntan a este camión.`
        : 'La base no permite borrarlo: todavía tiene registros ligados (historial).',
      { raw: text, blockedBy, table });
  }
  if (/42501|permission denied|row-level security|violates row-level/i.test(text)) {
    return new VehicleDeleteError('permission',
      `Supabase rechazó el borrado en "${table}" por permisos (RLS). Hace falta una política que permita DELETE.`,
      { raw: text, table });
  }
  return new VehicleDeleteError('unknown', error?.message || 'No se pudo eliminar', { raw: text, table });
}

/* Tablas que dependen del camión, de la más desechable a la más histórica.
   El orden importa: gps_logs referencia collections, así que va antes. */
export const VEHICLE_DEPENDENT_TABLES = ['device_telemetry', 'gps_logs', 'collections', 'vehicle_crew'];

/* Errores que solo significan "esa tabla/columna no existe en este esquema";
   no deben abortar el borrado. */
const isMissingRelation = e => /42P01|42703|does not exist|Could not find/i.test(rawText(e));

/* Borra las filas dependientes y devuelve CUÁNTAS se borraron de verdad.
   El conteo importa: si a una tabla le falta política de DELETE, Supabase
   responde 204 sin error y borra 0 filas. Sin este dato, el borrado forzado
   fallaría después en el camión sin poder decir qué tabla fue la culpable. */
async function deleteDependent(table, vehicleId) {
  const { count, error } = await withTimeout(
    sb.from(table).delete({ count: 'exact' }).eq('vehicle_id', vehicleId), 20000
  );
  if (!error) return { table, deleted: count ?? 0 };
  if (isMissingRelation(error)) {
    console.warn(`[deleteVehicle] se omite ${table}:`, error.message);
    return { table, deleted: 0, skipped: true };
  }
  throw classifyDeleteError(error, table);
}

/* "device_telemetry: 1 · gps_logs: 0 · collections: 0 · vehicle_crew: 2" */
const formatReport = report => report
  .map(r => `${r.table}: ${r.skipped ? 'no aplica' : r.deleted}`)
  .join(' · ');

/**
 * Elimina un camión.
 *
 * Por omisión solo retira sus asignaciones de cuadrilla y CONSERVA el historial
 * (recolecciones, GPS, telemetría). Si la base protege ese historial con llaves
 * foráneas, el borrado falla a propósito y se informa el motivo real.
 *
 * Con `{ force: true }` se eliminan además TODAS las filas dependientes. Eso
 * destruye historial de operación de forma irreversible; la interfaz lo pide con
 * una segunda confirmación explícita.
 *
 * @param {string} vehicleId
 * @param {{ force?: boolean }} [options]
 */
export async function deleteVehicle(vehicleId, options = {}) {
  const tables = options.force ? VEHICLE_DEPENDENT_TABLES : ['vehicle_crew'];
  const report = [];
  for (const table of tables) report.push(await deleteDependent(table, vehicleId));

  /* .select() devuelve las filas realmente borradas. Sin esto, un DELETE que
     RLS bloquea responde 204 sin error y la app cantaría un éxito falso. */
  const { data, error } = await withTimeout(
    sb.from('vehicles').delete().eq('id', vehicleId).select()
  );

  if (error) {
    const failure = classifyDeleteError(error, 'vehicles');
    failure.report = report;
    /* Si se pidió forzar y AUN ASÍ estorba una llave foránea, la causa casi
       siempre es que esa tabla no dejó borrar sus filas (le falta política). */
    if (options.force && failure.reason === 'fk') {
      const culprit = report.find(r => r.table === failure.blockedBy);
      failure.message = culprit && culprit.deleted === 0
        ? `No se borró ninguna fila de "${failure.blockedBy}", así que sigue bloqueando al camión. ` +
          `Lo más probable es que a esa tabla le falte una política de DELETE en Supabase.`
        : failure.message;
      failure.raw = `${failure.raw}\n\nFilas borradas por tabla → ${formatReport(report)}`;
    }
    throw failure;
  }

  if (!data || data.length === 0) {
    const failure = new VehicleDeleteError('permission',
      'Supabase no borró ninguna fila. Normalmente significa que la política RLS de "vehicles" ' +
      'no permite DELETE a este usuario (o que el camión ya no existía).',
      { raw: 'DELETE devolvió 0 filas y ningún error', table: 'vehicles' });
    failure.report = report;
    throw failure;
  }
  return { vehicle: data[0], report };
}

export async function removeCrewMember(id) {
  const { error } = await withTimeout(sb.from('vehicle_crew').delete().eq('id', id));
  if (error) throw error;
}

/* Ruta asignada hoy a cada vehículo → { vehicle_id: route } */
export async function getRoutesByVehicle() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await withTimeout(
      sb.from('collections')
        .select('vehicle_id, route:routes(id, name, route_type, geometry, distance_km)')
        .eq('scheduled_date', today)
    );
    if (error) throw error;
    const map = {};
    (data || []).forEach(row => { if (row.route) map[row.vehicle_id] = row.route; });
    return map;
  } catch (err) { console.error('[routes_by_vehicle]', err); return {}; }
}

/* ── Turnos ── */
export async function getShifts() {
  try {
    const { data, error } = await withTimeout(sb.from('shifts').select('*').order('start_time'));
    if (error) throw error;
    return data || [];
  } catch (err) { console.error('[shifts]', err); return []; }
}

/* Distancia aproximada en km entre dos coordenadas (suficiente a escala urbana) */
function distanceKm(a, b) {
  const latRad = ((a.lat + b.lat) / 2) * Math.PI / 180;
  const dx = (a.lng - b.lng) * Math.cos(latRad) * 111.32;
  const dy = (a.lat - b.lat) * 111.32;
  return Math.hypot(dx, dy);
}

/* Radio alrededor de la última posición conocida. Los registros más lejanos se
   descartan: son lecturas corruptas del dispositivo (se han visto puntos a
   380 km, en otra ciudad) y sin este filtro el mapa se aleja para encuadrarlas. */
const GPS_MAX_RADIUS_KM = 25;

/* ── Columna de evento en gps_logs ──
   El firmware publica el campo como "event" y así lo manda el backend al RPC
   flush_gps_logs, pero hay despliegues donde la columna quedó como "event_type".
   En vez de adivinar, se detecta una sola vez y se recuerda. Si ninguna existe,
   la app sigue funcionando: simplemente no habrá eventos que mostrar. */
const EVENT_COLUMN_CANDIDATES = ['event', 'event_type'];
let _eventColumnPromise = null;

export function getEventColumn() {
  if (!_eventColumnPromise) {
    _eventColumnPromise = (async () => {
      for (const col of EVENT_COLUMN_CANDIDATES) {
        try {
          const { error } = await withTimeout(sb.from('gps_logs').select(col).limit(1), 8000);
          if (!error) return col;
        } catch { /* se prueba la siguiente */ }
      }
      console.warn('[gps_logs] no se encontró columna de evento (event / event_type)');
      return null;
    })();
  }
  return _eventColumnPromise;
}

/* Deja siempre la propiedad `event`, venga de la columna que venga. */
function normalizeEvent(row, col) {
  const value = col ? row[col] : null;
  return { ...row, ...pointFromGeometry(row.location), event: value ?? null };
}

/* ── Histórico GPS de un vehículo (recorrido real) ──
   Antes se pedían solo los 300 registros más recientes, así que un turno
   completo se veía cortado. Ahora se pagina: PostgREST devuelve como máximo
   1000 filas por petición, de modo que un recorrido largo necesita varias.

   @param {string} vehicleId
   @param {number|{limit?:number, from?:Date|string, to?:Date|string,
                   pageSize?:number, radiusKm?:number}} [options]
          Se acepta un número por compatibilidad con las llamadas antiguas.
*/
/**
 * Descarga el recorrido y explica qué pasó. Lanza si falla, para que la
 * interfaz pueda decir el motivo en vez de mostrar un mapa vacío sin más.
 *
 * @returns {Promise<{points:Array, meta:{fetched:number, pages:number,
 *          droppedFar:number, pageCap:number|null, reachedLimit:boolean}}>}
 */
export async function fetchTrail(vehicleId, options = {}) {
  const opt = typeof options === 'number' ? { limit: options } : (options || {});
  const {
    limit    = 20000,         // un día entero de pings cada 10 s son ~8600
    pageSize = 1000,
    from     = null,
    to       = null,
    radiusKm = GPS_MAX_RADIUS_KM,
    timeoutMs = 30000,
  } = opt;

  const col  = await getEventColumn();
  const cols = ['location', 'timestamp', 'battery_pct', 'truck_capacity',
                'gps_quality', 'gsm_signal_dbm', 'accuracy', col].filter(Boolean).join(', ');

  const rows = [];
  let offset = 0, pages = 0, pageCap = null, sospechaTope = null;

  /* ── Paginado ──
     Antes se cortaba en cuanto una página devolvía menos filas de las pedidas,
     dando por hecho que era el final. Pero PostgREST tiene su propio tope de
     filas por respuesta (db-max-rows): si ese tope es menor que la página que
     pedimos, la PRIMERA respuesta ya viene corta y el bucle paraba ahí. De ahí
     que solo se viera un trozo del recorrido.

     Ahora se avanza por las filas realmente recibidas y solo se para cuando una
     página vuelve vacía. */
  while (offset < limit) {
    const take = Math.min(pageSize, limit - offset);
    let query = sb.from('gps_logs')
      .select(cols)
      .eq('vehicle_id', vehicleId)
      .order('timestamp', { ascending: false })
      .range(offset, offset + take - 1);

    if (from) query = query.gte('timestamp', new Date(from).toISOString());
    if (to)   query = query.lte('timestamp', new Date(to).toISOString());

    const { data, error } = await withTimeout(query, timeoutMs);
    if (error) throw error;

    const recibidas = data?.length || 0;
    if (recibidas === 0) break;              // aquí sí se acabó de verdad

    /* Una página corta puede ser el final de los datos O el tope del servidor.
       Solo es tope si DESPUÉS sigue habiendo filas, así que se anota como
       sospecha y se confirma en la vuelta siguiente. */
    if (sospechaTope !== null) { pageCap = sospechaTope; sospechaTope = null; }
    if (recibidas < take) sospechaTope = recibidas;

    pages++;
    rows.push(...data);
    offset += recibidas;
  }

  const todos = rows
    .map(row => normalizeEvent(row, col))
    .filter(row => row.lat != null && row.lng != null);

  /* Guarda grueso contra lecturas corruptas (se han visto puntos a 380 km).
     Se CUENTA lo descartado para poder avisar: si desaparece medio recorrido,
     hay que saberlo en lugar de mirar un mapa incompleto sin explicación. */
  let points = todos;
  let droppedFar = 0;
  if (todos.length && radiusKm) {
    const latest = todos[0];                 // el más reciente
    points = todos.filter(p => distanceKm(p, latest) <= radiusKm);
    droppedFar = todos.length - points.length;
  }

  return {
    points: points.reverse(),                // orden cronológico
    meta: { fetched: todos.length, pages, droppedFar, pageCap, reachedLimit: offset >= limit },
  };
}

/* Envoltorio compatible: devuelve solo los puntos y nunca lanza.
   Lo usan las partes donde un fallo no debe interrumpir nada (recorridos de
   toda la flota, ventana de área para la IA…). */
export async function getGpsLogs(vehicleId, options = {}) {
  try {
    const { points } = await fetchTrail(vehicleId, options);
    return points;
  } catch (err) { console.error('[gps_logs]', err); return []; }
}

/* ── Periodos del recorrido ──
   "El día completo" es el que de verdad se usa: empieza en el primer registro
   de esa jornada y llega hasta el último, sin recortar por delante. Los
   periodos relativos quedan como atajo para mirar lo inmediato. */
export const TRAIL_WINDOWS = [
  { id: 'day',   label: 'Día completo',      day: true },
  { id: '90m',   label: 'Última 1.5 h',      minutes: 90 },
  { id: '4h',    label: 'Últimas 4 h',       minutes: 240 },
  { id: '24h',   label: 'Últimas 24 h',      minutes: 1440 },
  { id: 'all',   label: 'Todo el historial', all: true },
];
export const DEFAULT_TRAIL_WINDOW = 'day';

/** Fecha de hoy como AAAA-MM-DD en hora local (no en UTC). */
export function todayIso() {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/**
 * Rango que hay que consultar.
 * @param {string} windowId
 * @param {string} [dayIso] día en formato AAAA-MM-DD; solo aplica a 'day'
 * @returns {{from:Date|null, to:Date|null}}
 */
export function trailRange(windowId = DEFAULT_TRAIL_WINDOW, dayIso = todayIso()) {
  const w = TRAIL_WINDOWS.find(x => x.id === windowId) || TRAIL_WINDOWS[0];

  if (w.all) return { from: null, to: null };

  if (w.day) {
    /* Se construye en hora LOCAL: con new Date('2026-08-24') el navegador lo
       interpreta como medianoche UTC y en México el día saldría corrido. */
    const [y, m, d] = String(dayIso).split('-').map(Number);
    return {
      from: new Date(y, m - 1, d, 0, 0, 0, 0),
      to:   new Date(y, m - 1, d, 23, 59, 59, 999),
    };
  }

  return { from: new Date(Date.now() - w.minutes * 60000), to: null };
}

/* Compatibilidad con las llamadas antiguas. */
export const trailWindowStart = (windowId, dayIso) => trailRange(windowId, dayIso).from;

/* Recorrido del camión. Lanza si la consulta falla: quien lo llama decide
   cómo contarlo. */
export function fetchTrailWindow(vehicleId, windowId = DEFAULT_TRAIL_WINDOW, opts = {}) {
  const { day, ...resto } = opts;
  const { from, to } = trailRange(windowId, day);
  /* Los periodos largos necesitan más margen: ordenar por timestamp sobre
     gps_logs es caro si la tabla no tiene índice por (vehicle_id, timestamp). */
  const timeoutMs = windowId === 'all' ? 60000
                  : (windowId === '24h' || windowId === 'day') ? 45000
                  : 30000;
  return fetchTrail(vehicleId, {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    timeoutMs,
    ...resto,
  });
}

/* Versión que no lanza, para los sitios donde un fallo no debe cortar nada. */
export async function getTrailWindow(vehicleId, windowId = DEFAULT_TRAIL_WINDOW, opts = {}) {
  try {
    const { points } = await fetchTrailWindow(vehicleId, windowId, opts);
    return points;
  } catch (err) { console.error('[trail_window]', err); return []; }
}

/* Compatibilidad: el recorrido del día completo. */
export function getTodayTrail(vehicleId, opts = {}) {
  return getTrailWindow(vehicleId, 'day', opts);
}

/* ── Color del camión ──
   La columna vehicles.color puede no existir todavía. Se intenta escribir y,
   si la base no la conoce, se avisa para que la interfaz caiga al respaldo
   local en lugar de tragarse el error. */
export class MissingColumnError extends Error {
  constructor(column) {
    super(`La columna "${column}" no existe en la base de datos.`);
    this.name = 'MissingColumnError';
    this.column = column;
  }
}

export async function updateVehicleColor(vehicleId, hex) {
  const { data, error } = await withTimeout(
    sb.from('vehicles').update({ color: hex }).eq('id', vehicleId).select()
  );
  if (error) {
    if (/42703|column .* does not exist|Could not find the '?color'? column/i.test(
          `${error.code || ''} ${error.message || ''} ${error.details || ''}`)) {
      throw new MissingColumnError('vehicles.color');
    }
    throw error;
  }
  if (!data || data.length === 0) {
    throw new Error('Supabase no actualizó ninguna fila (revisa la política de UPDATE).');
  }
  return data[0];
}

/* ── Eventos de TODA la flota ──
   Solo las filas de gps_logs que traen un evento del dispositivo (pausa,
   bloqueo de ruta, reinicio…). Es la fuente del panel "Eventos" y de las
   alertas de camión pausado en el mapa en vivo. */
export async function getFleetEvents(limit = 400) {
  try {
    const col = await getEventColumn();
    if (!col) return [];
    const cols = ['vehicle_id', 'location', 'timestamp', 'battery_pct', 'truck_capacity', col].join(', ');
    const { data, error } = await withTimeout(
      sb.from('gps_logs')
        .select(cols)
        .not(col, 'is', null)
        .order('timestamp', { ascending: false })
        .limit(limit)
    );
    if (error) throw error;
    return (data || [])
      .map(row => normalizeEvent(row, col))
      .filter(row => row.event);
  } catch (err) { console.error('[fleet_events]', err); return []; }
}

/* Eventos de un solo camión (para el panel de detalle). */
export async function getVehicleEvents(vehicleId, limit = 60) {
  try {
    const col = await getEventColumn();
    if (!col) return [];
    const cols = ['vehicle_id', 'location', 'timestamp', 'battery_pct', 'truck_capacity', col].join(', ');
    const { data, error } = await withTimeout(
      sb.from('gps_logs')
        .select(cols)
        .eq('vehicle_id', vehicleId)
        .not(col, 'is', null)
        .order('timestamp', { ascending: false })
        .limit(limit)
    );
    if (error) throw error;
    return (data || []).map(row => normalizeEvent(row, col)).filter(row => row.event);
  } catch (err) { console.error('[vehicle_events]', err); return []; }
}

/* ── Empleados / conductores ── */
export async function getDrivers() {
  try {
    const { data, error } = await withTimeout(sb.from('users').select('*').eq('role', 'driver').order('name'));
    if (error) throw error;
    return data || [];
  } catch (err) { console.error('[drivers]', err); return []; }
}

export async function getAllUsers() {
  try {
    const { data, error } = await withTimeout(sb.from('users').select('*').order('name'));
    if (error) throw error;
    return data || [];
  } catch (err) { console.error('[users]', err); return []; }
}

/* ── Insertar campaña ── */
export async function insertCampaign(form) {
  const { data, error } = await withTimeout(sb.from('campaigns').insert([form]).select());
  if (error) throw error;
  return data;
}

/* ── Registrar una incidencia (fila en collections con status incompleto) ── */
export async function insertIncident(form) {
  const { data, error } = await withTimeout(sb.from('collections').insert([form]).select());
  if (error) throw error;
  return data;
}

/* ── Actualizar estado de una coleccion (incidencia resuelta) ── */
export async function resolveCollection(id) {
  const { error } = await withTimeout(sb.from('collections').update({ status: 'completed' }).eq('id', id));
  if (error) throw error;
}

/* ── Reportes / quejas ciudadanas ── */
export async function getReports() {
  try {
    const { data, error } = await withTimeout(
      sb.from('reports').select('*').order('created_at', { ascending: false })
    );
    if (error) throw error;
    return data || [];
  } catch (err) { console.error('[reports]', err); return []; }
}

export async function resolveReport(id) {
  const { error } = await withTimeout(
    sb.from('reports').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', id)
  );
  if (error) throw error;
}

/* ══════════════════════════════════════
   AUTENTICACIÓN
   Solo inicio de sesión con cuentas ya existentes.
   No hay flujo de registro/creación de cuentas en la app.
══════════════════════════════════════ */
export async function signIn(email, password) {
  const { data, error } = await withTimeout(sb.auth.signInWithPassword({ email, password }), 15000);
  if (error) throw error;
  return data;
}

export async function resetPassword(email) {
  const { error } = await withTimeout(sb.auth.resetPasswordForEmail(email), 15000);
  if (error) throw error;
}

export async function getSession() {
  try {
    const { data, error } = await withTimeout(sb.auth.getSession(), 8000);
    if (error) throw error;
    return data.session || null;
  } catch (err) { console.error('[session]', err); return null; }
}

export async function signOut() {
  try { await withTimeout(sb.auth.signOut(), 8000); } catch (err) { console.error('[signOut]', err); }
}

/* Perfil del usuario autenticado, cruzado con la tabla "users" si existe ahí */
export async function getCurrentUserProfile() {
  const session = await getSession();
  if (!session) return null;
  try {
    const { data, error } = await withTimeout(
      sb.from('users').select('*').eq('id', session.user.id).maybeSingle()
    );
    if (error) throw error;
    return {
      email: session.user.email,
      name:  data?.name || session.user.user_metadata?.name || session.user.email,
      role:  data?.role || 'admin',
    };
  } catch (err) {
    console.error('[profile]', err);
    return { email: session.user.email, name: session.user.user_metadata?.name || session.user.email, role: 'admin' };
  }
}

/* ══════════════════════════════════════
   NOTIFICACIONES
   Se generan a partir de datos reales (no son de ejemplo).
══════════════════════════════════════ */
export async function getNotifications() {
  try {
    const [vehs, telem, colls, camps, reports] = await Promise.all([
      getVehicles(), getTelemetry(), getCollections('semanal'), getCampaigns(), getReports(),
    ]);
    const notifs = [];

    /* Batería baja */
    telem.forEach(t => {
      if (t.battery_pct != null && t.battery_pct < 25) {
        const v = vehs.find(x => x.id === t.vehicle_id);
        notifs.push({
          id: `bat-${t.vehicle_id}`,
          type: 'red',
          title: `${v?.economic_number || 'Vehículo'} — Batería baja`,
          desc: `Nivel de batería en ${Math.round(t.battery_pct)}%. Requiere recarga antes del siguiente turno.`,
          action: { label: 'Ver en mapa', href: 'page-1.html' },
        });
      }
    });

    /* Señal GPS débil */
    telem.forEach(t => {
      if (t.gsm_signal_dbm != null && t.gsm_signal_dbm < -100) {
        const v = vehs.find(x => x.id === t.vehicle_id);
        notifs.push({
          id: `gps-${t.vehicle_id}`,
          type: 'blue',
          title: `${v?.economic_number || 'Vehículo'} — GPS débil`,
          desc: 'Calidad de señal GPS reportada como pobre. Verificar dispositivo.',
          action: { label: 'Ver en mapa', href: 'page-1.html' },
        });
      }
    });

    /* Vehículos en mantenimiento */
    vehs.filter(v => v.status === 'maintenance').forEach(v => {
      notifs.push({
        id: `maint-${v.id}`,
        type: 'yellow',
        title: `${v.economic_number} — En mantenimiento`,
        desc: 'El vehículo está fuera de servicio por mantenimiento.',
        action: { label: 'Ver en mapa', href: 'page-1.html' },
      });
    });

    /* Rutas incompletas / incidencias recientes */
    colls.filter(c => c.status === 'incomplete').slice(0, 6).forEach(c => {
      notifs.push({
        id: `inc-${c.id}`,
        type: 'red',
        title: `${c.route?.name || 'Ruta'} — Recolección incompleta`,
        desc: c.incomplete_reason || 'Marcada como incompleta. Revisa el detalle en Incidencias.',
        action: { label: 'Ver incidencia', href: 'page-6.html' },
      });
    });

    /* Campañas próximas a cerrar (2 días o menos) */
    const now = new Date();
    camps.filter(c => c.status === 'active' && c.end_date).forEach(c => {
      const days = Math.ceil((new Date(c.end_date + 'T00:00:00') - now) / 86400000);
      if (days >= 0 && days <= 2) {
        notifs.push({
          id: `camp-${c.id}`,
          type: 'blue',
          title: `Campaña "${c.name}" — Próxima a cerrar`,
          desc: days === 0 ? 'Finaliza hoy.' : `Finaliza en ${days} día${days > 1 ? 's' : ''}.`,
          action: { label: 'Ver campaña', href: 'page-5.html' },
        });
      }
    });

    /* Incidencias del dispositivo (bloqueos, pausas largas, GPS, batería).
       Solo las RECIENTES: una notificación que lleva horas ahí deja de leerse.
       Las que caducan desaparecen solas del panel en el siguiente refresco. */
    const NOTIF_MAX_AGE_MS = 30 * 60 * 1000;
    const TIPO_NOTIF = { alta: 'red', media: 'yellow', baja: 'blue' };
    deriveDeviceIncidents({ vehicles: vehs, events: await getFleetEvents(200), telemetry: telem })
      .filter(i => Date.now() - new Date(i.at).getTime() <= NOTIF_MAX_AGE_MS)
      .slice(0, 8)
      .forEach(i => {
        notifs.push({
          id: i.id,
          type: TIPO_NOTIF[i.priority] || 'blue',
          title: i.title,
          icon: i.icon,
          desc: i.desc,
          meta: timeAgo(i.at),
          action: { label: 'Ver incidencia', href: 'page-6.html' },
        });
      });

    /* Quejas ciudadanas pendientes */
    const pendingReports = reports.filter(r => r.status !== 'resolved');
    if (pendingReports.length > 0) {
      notifs.push({
        id: 'reports-pending',
        type: 'yellow',
        title: `${pendingReports.length} queja${pendingReports.length > 1 ? 's' : ''} sin resolver`,
        desc: 'Hay reportes ciudadanos pendientes de revisión.',
        action: { label: 'Ver quejas', href: 'page-8.html' },
      });
    }

    return notifs;
  } catch (err) {
    console.error('[notifications]', err);
    return [];
  }
}

/* ── Tiempo real ── */
export function subscribeRealtime(table, callback) {
  return sb.channel(table + '-rl-live')
    .on('postgres_changes', { event: '*', schema: 'public', table }, callback)
    .subscribe();
}

/**
 * Sigue la POSICIÓN de toda la flota y avisa en cuanto alguna cambia.
 *
 * El refresco general va cada 30 s porque arrastra recolecciones, cuadrillas y
 * eventos. Mover un marcador no necesita nada de eso: basta con la telemetría,
 * que es una fila por camión. Por eso este canal va aparte y mucho más seguido.
 *
 * Solo se notifican los camiones cuya coordenada cambió de verdad, así el mapa
 * no se redibuja cuando no hay movimiento.
 *
 * @param {(cambios:Array<{vehicle_id:string, lat:number, lng:number, row:object}>) => void} onMoved
 * @param {{intervalMs?:number}} [options]
 * @returns {() => void}
 */
export function subscribeFleetPositions(onMoved, options = {}) {
  const { intervalMs = 6000 } = options;
  const ultimas = new Map();      // vehicle_id -> "lat,lng"
  let stopped = false, cargando = false;

  async function revisar() {
    if (stopped || cargando) return;
    cargando = true;
    try {
      const filas = await getTelemetry();
      const cambios = [];
      filas.forEach(r => {
        if (!isValidLatLng(r.lat, r.lng)) return;
        const clave = `${r.lat.toFixed(6)},${r.lng.toFixed(6)}`;
        if (ultimas.get(r.vehicle_id) === clave) return;
        ultimas.set(r.vehicle_id, clave);
        cambios.push({ vehicle_id: r.vehicle_id, lat: r.lat, lng: r.lng, row: r });
      });
      if (cambios.length && !stopped) onMoved(cambios);
    } catch (err) {
      console.error('[fleet_positions]', err);
    } finally {
      cargando = false;
    }
  }

  const timer = setInterval(revisar, intervalMs);
  revisar();

  /* Realtime encima del sondeo: si device_telemetry está publicada, la
     reacción es inmediata; si no, el sondeo sigue cubriendo. */
  let channel = null;
  try {
    channel = sb.channel('fleet-positions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'device_telemetry' }, () => revisar())
      .subscribe();
  } catch (err) {
    console.warn('[fleet_positions] realtime no disponible:', err.message);
  }

  return () => {
    stopped = true;
    clearInterval(timer);
    if (channel) { try { sb.removeChannel(channel); } catch {} }
  };
}

/**
 * Sigue el recorrido de UN camión y avisa cuando llegan posiciones nuevas.
 *
 * Combina dos mecanismos a propósito:
 *   · Realtime de Supabase → reacción inmediata al INSERT.
 *   · Sondeo incremental   → red de seguridad. Si la tabla gps_logs no está en
 *     la publicación `supabase_realtime`, el canal nunca dispara y sin esto la
 *     línea del mapa se quedaría congelada sin ningún aviso.
 *
 * El sondeo pide solo lo posterior al último punto conocido, así que es barato
 * aunque el intervalo sea corto.
 *
 * @param {string} vehicleId
 * @param {(points:Array) => void} onNewPoints
 * @param {{intervalMs?:number, since?:Date|string}} [options]
 * @returns {() => void} función para dejar de seguirlo
 */
export function subscribeVehicleGps(vehicleId, onNewPoints, options = {}) {
  const { intervalMs = 8000 } = options;
  let lastTs = options.since ? new Date(options.since).toISOString() : null;
  let stopped = false;
  let polling = false;

  async function poll() {
    if (stopped || polling) return;
    polling = true;
    try {
      const points = await getGpsLogs(vehicleId, { from: lastTs || undefined, limit: 1000 });
      /* `from` es inclusivo: se descarta el punto que ya se conocía. */
      const fresh = lastTs ? points.filter(p => p.timestamp > lastTs) : points;
      if (fresh.length) {
        lastTs = fresh[fresh.length - 1].timestamp;
        if (!stopped) onNewPoints(fresh);
      }
    } catch (err) {
      console.error('[gps_live]', err);
    } finally {
      polling = false;
    }
  }

  const timer = setInterval(poll, intervalMs);
  poll();

  let channel = null;
  try {
    channel = sb.channel(`gps-live-${vehicleId}`)
      .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'gps_logs', filter: `vehicle_id=eq.${vehicleId}` },
          () => poll())
      .subscribe();
  } catch (err) {
    console.warn('[gps_live] realtime no disponible, se usa solo sondeo:', err.message);
  }

  return () => {
    stopped = true;
    clearInterval(timer);
    if (channel) { try { sb.removeChannel(channel); } catch {} }
  };
}
