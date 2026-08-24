import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

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
   Se piden los registros MÁS RECIENTES y luego se ordenan cronológicamente:
   la tabla tiene miles de filas y el recorrido útil es el último, no el primero. */
export async function getGpsLogs(vehicleId, limit = 300) {
  try {
    const col = await getEventColumn();
    const cols = ['location', 'timestamp', 'battery_pct', 'truck_capacity', col].filter(Boolean).join(', ');
    const { data, error } = await withTimeout(
      sb.from('gps_logs')
        .select(cols)
        .eq('vehicle_id', vehicleId)
        .order('timestamp', { ascending: false })
        .limit(limit)
    );
    if (error) throw error;

    const points = (data || [])
      .map(row => normalizeEvent(row, col))
      .filter(row => row.lat != null && row.lng != null);
    if (!points.length) return [];

    const latest = points[0]; // el más reciente: ancla de la posición actual
    return points
      .filter(p => distanceKm(p, latest) <= GPS_MAX_RADIUS_KM)
      .reverse();
  } catch (err) { console.error('[gps_logs]', err); return []; }
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
