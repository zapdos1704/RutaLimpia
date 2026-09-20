/* ══════════════════════════════════════════════════════
   schedules.js
   Horarios de recolección por ruta (tabla pickup_schedules). Cada fila = ruta + día + hora + tipo
   de residuo. Una fila SIN ruta es «general» y la ven los ciudadanos de todas las rutas.
   Lógica pura (sin DOM ni red); las mismas reglas que valida save_pickup_schedule() en SQL 008.
   ══════════════════════════════════════════════════════ */

export const DAY_LABEL = { 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado', 7: 'Domingo' };
export const DAY_SHORT = { 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb', 7: 'Dom' };
export const WASTE_LABEL = { organica: 'Orgánica', inorganica: 'Inorgánica', general: 'General' };
export const WASTE_TYPES = Object.keys(WASTE_LABEL);
export const ZONE_MAX = 80;
export const GENERAL = 'general';   // clave de «todas las rutas» en el selector

/** Acepta «7:30», «07:30» y «07:30:00»; devuelve «HH:MM» o null. */
export function normalizeTime(raw) {
  const m = /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*$/.exec(String(raw ?? ''));
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/**
 * Valida el formulario y arma los argumentos de save_pickup_schedule().
 * form: { id?, day, time, waste, routeId?, zone?, active? } — routeId vacío/«general» = todas las rutas.
 */
export function buildSchedulePayload(form) {
  const day = Number(form?.day);
  if (!Number.isInteger(day) || day < 1 || day > 7) return { ok: false, error: 'Elige el día de la semana.' };
  const time = normalizeTime(form?.time);
  if (!time) return { ok: false, error: 'Escribe la hora (por ejemplo 07:30).' };
  if (!WASTE_TYPES.includes(form?.waste)) return { ok: false, error: 'Elige el tipo de residuo.' };
  const zone = String(form?.zone ?? '').trim();
  if (zone.length > ZONE_MAX) return { ok: false, error: `La zona no puede pasar de ${ZONE_MAX} caracteres.` };
  const routeId = form?.routeId && form.routeId !== GENERAL ? String(form.routeId) : null;
  return {
    ok: true,
    args: { p_id: form?.id ?? null, p_day: day, p_time: time, p_waste: form.waste, p_route_id: routeId, p_zone_label: zone || null, p_active: form?.active !== false },
  };
}

/** Orden natural: día, hora, tipo. No modifica el arreglo recibido. */
export function sortSchedules(rows) {
  return [...(rows || [])].sort((a, b) =>
    (a.day_of_week - b.day_of_week) ||
    String(a.time).localeCompare(String(b.time)) ||
    String(a.waste_type).localeCompare(String(b.waste_type)));
}

/** Filas de una ruta (o las generales con GENERAL), ya ordenadas. */
export function schedulesFor(rows, routeKey) {
  const wantGeneral = !routeKey || routeKey === GENERAL;
  return sortSchedules((rows || []).filter(r => (wantGeneral ? !r.route_id : r.route_id === routeKey)));
}

/** Cuántos horarios tiene cada ruta (clave GENERAL para los generales), para el selector. */
export function countByRoute(rows) {
  const counts = {};
  for (const r of rows || []) {
    const key = r.route_id || GENERAL;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

/** Texto corto de una fila: «Lunes 07:30 · Orgánica». */
export function describeSchedule(row) {
  const t = String(row?.time ?? '').slice(0, 5);
  return `${DAY_LABEL[row?.day_of_week] || '—'} ${t} · ${WASTE_LABEL[row?.waste_type] || row?.waste_type || '—'}`;
}
