/* ══════════════════════════════════════════════════════
   RUTALIMPIA — events.js
   Vocabulario de eventos del dispositivo y estado derivado.

   Los cinco literales de abajo son exactamente los que publica el firmware del
   ESP32 (ruta_limpia_completo.ino) y que el backend guarda en gps_logs:

     inicio_pausa               → el operador presionó el botón de pausa
     fin_pausa                  → el operador quitó la pausa manualmente
     fin_pausa_auto_movimiento  → estaba en pausa manual y el camión se movió solo
     bloqueo_ruta               → el operador reportó la calle bloqueada
     reinicio_movimiento        → salió de auto-sleep por movimiento real

   No hay un "fin de incidencia" explícito en la base: el estado de pausa se
   DERIVA recorriendo los eventos en orden (ver derivePauseState).
══════════════════════════════════════════════════════ */

export const EVENT_META = {
  inicio_pausa: {
    label: 'Pausa del dispositivo', short: 'Pausa', icon: '⏸️',
    color: '#f59e0b', kind: 'pause_start', severity: 'warn',
    desc: 'El operador puso el camión en pausa desde el botón del dispositivo.',
  },
  fin_pausa: {
    label: 'Fin de pausa', short: 'Fin de pausa', icon: '▶️',
    color: '#22c55e', kind: 'pause_end', severity: 'ok',
    desc: 'El operador reanudó la operación manualmente.',
  },
  fin_pausa_auto_movimiento: {
    label: 'Fin de pausa por movimiento', short: 'Fin pausa auto', icon: '🚀',
    color: '#4ade80', kind: 'pause_end', severity: 'ok',
    desc: 'Estaba en pausa manual y el dispositivo detectó movimiento real.',
  },
  bloqueo_ruta: {
    label: 'Bloqueo de ruta', short: 'Bloqueo', icon: '🚧',
    color: '#ef4444', kind: 'blocked', severity: 'alert',
    desc: 'El operador reportó que la calle está bloqueada.',
  },
  reinicio_movimiento: {
    label: 'Reinicio de movimiento', short: 'Reinicio', icon: '🔄',
    color: '#3b82f6', kind: 'resume', severity: 'info',
    desc: 'El camión salió de reposo automático al detectar movimiento.',
  },
};

const UNKNOWN_META = {
  label: 'Evento del dispositivo', short: 'Evento', icon: '📡',
  color: '#94a3b8', kind: 'other', severity: 'info',
  desc: 'Evento reportado por el dispositivo.',
};

/** Metadatos de un evento; nunca falla, aunque el firmware añada literales nuevos. */
export function eventMeta(name) {
  if (!name) return UNKNOWN_META;
  return EVENT_META[name] || { ...UNKNOWN_META, label: String(name).replace(/_/g, ' ') };
}

/** Orden en que se muestran los filtros de incidencia. */
export const EVENT_ORDER = [
  'inicio_pausa', 'bloqueo_ruta', 'reinicio_movimiento', 'fin_pausa', 'fin_pausa_auto_movimiento',
];

const PAUSE_START = new Set(['inicio_pausa']);
const PAUSE_END   = new Set(['fin_pausa', 'fin_pausa_auto_movimiento', 'reinicio_movimiento']);

/* ── Vigencia de un bloqueo de ruta ──
   El dispositivo avisa del bloqueo pero NUNCA manda un "ya se liberó": el botón
   solo tiene una posición. Si se dejara vigente hasta el siguiente movimiento,
   la alerta se quedaba pegada horas y acababa ignorándose.

   Se trata como un AVISO, no como un estado: dura poco y se apaga solo. Si el
   bloqueo sigue, el operador vuelve a pulsar y la alerta reaparece. */
export const BLOCK_TTL_MS = 15 * 60 * 1000; // 15 min

/* Una pausa sí es un estado real (el equipo entra en reposo), así que se
   mantiene mientras dure. Pero pasado este tiempo deja de gritar en la franja
   de alertas: a esas alturas es "el camión terminó su turno", no una urgencia. */
export const PAUSE_ALERT_TTL_MS = 60 * 60 * 1000; // 1 h

/**
 * Estado actual derivado de la lista de eventos de UN camión.
 * @param {Array<{event:string, timestamp:string, lat?:number, lng?:number}>} events
 * @returns {{paused:boolean, pausedSince:Date|null, blocked:boolean, blockedSince:Date|null,
 *            lastEvent:object|null, pauseEvent:object|null, blockEvent:object|null}}
 */
export function derivePauseState(events) {
  const asc = [...(events || [])]
    .filter(e => e && e.event)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  let pauseEvent = null;
  let blockEvent = null;

  for (const e of asc) {
    if (PAUSE_START.has(e.event)) pauseEvent = e;
    else if (PAUSE_END.has(e.event)) { pauseEvent = null; blockEvent = null; }
    else if (e.event === 'bloqueo_ruta') blockEvent = e;
  }

  const now = Date.now();
  if (blockEvent && now - new Date(blockEvent.timestamp).getTime() > BLOCK_TTL_MS) blockEvent = null;

  const pausedSince = pauseEvent ? new Date(pauseEvent.timestamp) : null;

  return {
    paused:       !!pauseEvent,
    pausedSince,
    blocked:      !!blockEvent,
    blockedSince: blockEvent ? new Date(blockEvent.timestamp) : null,
    /* Sigue pausado, pero ya no como alerta urgente en la franja superior. */
    pauseIsFresh: !!pauseEvent && (now - pausedSince.getTime()) <= PAUSE_ALERT_TTL_MS,
    lastEvent:    asc.length ? asc[asc.length - 1] : null,
    pauseEvent,
    blockEvent,
  };
}

/* ══════════════════════════════════════
   INCIDENCIAS DEL DISPOSITIVO

   Hasta ahora "Incidencias" solo mostraba recolecciones marcadas como
   incompletas a mano. Pero el equipo del camión reporta problemas que afectan
   su desempeño y que nadie estaba viendo: bloqueos de calle, pausas largas,
   batería agotándose, GPS sin fix, o el dispositivo callado.

   Esta función las deriva a partir de datos reales. No inventa nada ni escribe
   en la base: son observaciones calculadas sobre gps_logs y device_telemetry.
══════════════════════════════════════ */

export const DEVICE_INCIDENT_RULES = {
  longPauseMinutes:  30,    // pausa que ya afecta la ruta
  lowBatteryPct:     20,
  criticalBatteryPct: 10,
  weakGsmDbm:       -100,
  silentMinutes:     45,    // sin reportar posición estando activo
};

const minutesSince = ts => (Date.now() - new Date(ts).getTime()) / 60000;

/**
 * @param {{vehicles:Array, events:Array, telemetry:Array}} data
 * @returns {Array} incidencias ordenadas: primero lo más grave y reciente
 */
export function deriveDeviceIncidents({ vehicles = [], events = [], telemetry = [] } = {}) {
  const byVehicle = groupByVehicle(events);
  const out = [];
  const add = i => out.push(i);

  vehicles.forEach(v => {
    const state = derivePauseState(byVehicle[v.id] || []);
    const t = telemetry.find(x => x.vehicle_id === v.id);
    const nombre = v.economic_number || 'Camión';

    /* Bloqueo de calle reportado por el operador */
    if (state.blocked) {
      add({
        id: `dev-block-${v.id}-${state.blockedSince.getTime()}`,
        kind: 'bloqueo_ruta', priority: 'alta', vehicleId: v.id, vehicle: nombre,
        icon: '🚧', color: '#ef4444',
        title: `${nombre} — Bloqueo de ruta`,
        desc: 'El operador reportó la calle bloqueada desde el dispositivo.',
        at: state.blockedSince,
        lat: state.blockEvent?.lat ?? null, lng: state.blockEvent?.lng ?? null,
      });
    }

    /* Pausa que ya se alargó lo suficiente para afectar el turno */
    if (state.paused) {
      const mins = minutesSince(state.pausedSince);
      if (mins >= DEVICE_INCIDENT_RULES.longPauseMinutes) {
        add({
          id: `dev-pause-${v.id}-${state.pausedSince.getTime()}`,
          kind: 'pausa_larga', priority: mins >= 120 ? 'alta' : 'media',
          vehicleId: v.id, vehicle: nombre,
          icon: '⏸️', color: '#f59e0b',
          title: `${nombre} — Pausa prolongada`,
          desc: `Lleva ${timeAgo(state.pausedSince).replace('hace ', '')} en pausa. La ruta no avanza.`,
          at: state.pausedSince,
          lat: state.pauseEvent?.lat ?? null, lng: state.pauseEvent?.lng ?? null,
        });
      }
    }

    if (!t) return;   // sin telemetría no hay nada más que evaluar

    /* Batería del dispositivo */
    if (t.battery_pct != null && t.battery_pct < DEVICE_INCIDENT_RULES.lowBatteryPct) {
      const critica = t.battery_pct < DEVICE_INCIDENT_RULES.criticalBatteryPct;
      add({
        id: `dev-bat-${v.id}`,
        kind: 'bateria_baja', priority: critica ? 'alta' : 'media',
        vehicleId: v.id, vehicle: nombre,
        icon: '🔋', color: critica ? '#ef4444' : '#f97316',
        title: `${nombre} — Batería ${critica ? 'crítica' : 'baja'}`,
        desc: `El dispositivo está al ${Math.round(t.battery_pct)}%. ${critica ? 'Puede apagarse y dejar de rastrear.' : 'Requiere recarga antes del siguiente turno.'}`,
        at: t.updated_at ? new Date(t.updated_at) : new Date(),
        lat: t.lat ?? null, lng: t.lng ?? null,
      });
    }

    /* Calidad de GPS: sin fix no hay rastreo */
    if (t.gps_quality === 'no_fix' || t.gps_quality === 'poor') {
      const sinFix = t.gps_quality === 'no_fix';
      add({
        id: `dev-gps-${v.id}`,
        kind: 'gps_deficiente', priority: sinFix ? 'alta' : 'media',
        vehicleId: v.id, vehicle: nombre,
        icon: '🛰️', color: sinFix ? '#ef4444' : '#f59e0b',
        title: `${nombre} — ${sinFix ? 'GPS sin señal' : 'GPS con señal pobre'}`,
        desc: sinFix
          ? 'El dispositivo no logra fijar posición: su recorrido no se está registrando.'
          : 'La posición reportada puede desviarse varios metros.',
        at: new Date(),
        lat: t.lat ?? null, lng: t.lng ?? null,
      });
    }

    /* Señal de datos: sin GSM el equipo no puede enviar lo que registra */
    if (t.gsm_signal_dbm != null && t.gsm_signal_dbm < DEVICE_INCIDENT_RULES.weakGsmDbm) {
      add({
        id: `dev-gsm-${v.id}`,
        kind: 'gsm_debil', priority: 'baja',
        vehicleId: v.id, vehicle: nombre,
        icon: '📶', color: '#06b6d4',
        title: `${nombre} — Señal de datos débil`,
        desc: `Cobertura en ${Math.round(t.gsm_signal_dbm)} dBm. Los envíos pueden retrasarse o perderse.`,
        at: new Date(),
        lat: t.lat ?? null, lng: t.lng ?? null,
      });
    }

    /* Dispositivo callado: activo pero sin reportar */
    const ultimo = (byVehicle[v.id] || [])[0]?.timestamp || t.timestamp || t.updated_at;
    if (v.status === 'active' && ultimo && !state.paused) {
      const mins = minutesSince(ultimo);
      if (mins >= DEVICE_INCIDENT_RULES.silentMinutes) {
        add({
          id: `dev-silent-${v.id}`,
          kind: 'sin_reportar', priority: 'alta', vehicleId: v.id, vehicle: nombre,
          icon: '📡', color: '#a855f7',
          title: `${nombre} — Sin reportar`,
          desc: `El dispositivo no envía datos desde hace ${Math.round(mins)} min y el camión figura como activo.`,
          at: new Date(ultimo),
          lat: t.lat ?? null, lng: t.lng ?? null,
        });
      }
    }
  });

  const orden = { alta: 0, media: 1, baja: 2 };
  return out.sort((a, b) => (orden[a.priority] - orden[b.priority]) || (new Date(b.at) - new Date(a.at)));
}

/** Agrupa una lista plana de eventos por vehicle_id. */
export function groupByVehicle(events) {
  const map = {};
  (events || []).forEach(e => { (map[e.vehicle_id] = map[e.vehicle_id] || []).push(e); });
  return map;
}

/** "hace 21 min", "hace 3 h 05 min", "hace 2 d". */
export function timeAgo(date) {
  if (!date) return '—';
  const ms = Date.now() - new Date(date).getTime();
  if (ms < 0) return 'ahora';
  const min = Math.floor(ms / 60000);
  if (min < 1)  return 'hace unos segundos';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 24)   return `hace ${h} h ${String(m).padStart(2, '0')} min`;
  const d = Math.floor(h / 24);
  return `hace ${d} día${d > 1 ? 's' : ''}`;
}

/** Hora local corta para las listas de eventos. */
export function shortTime(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
