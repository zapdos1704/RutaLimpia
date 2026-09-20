/* ══════════════════════════════════════════════════════
   service-stats.js
   Agregados del sondeo a domicilio para el dashboard: cuántos ciudadanos dijeron
   «voy a tirar basura» y cuántos quedaron atendidos, desatendidos o sin confirmar.
   Sólo agregados (nunca personas). Lógica pura, sin red ni DOM.

   Origen de los datos:
     · días cerrados (23:59 hora de Sahuayo)  → tabla daily_service_stats
     · el día en curso                        → vista service_survey_live
   ══════════════════════════════════════════════════════ */

export const SERVICE_TZ = 'America/Mexico_City';

const DAY_MS = 86_400_000;
const isDay = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Fecha local de Sahuayo (YYYY-MM-DD), no la de UTC: a las 8 pm ya es «mañana» en UTC. */
export function localDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SERVICE_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Suma (o resta) días a una fecha YYYY-MM-DD sin depender de la zona horaria de quien la ve. */
export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Rango [from, to] (ambos incluidos) de cada periodo del dashboard, terminando hoy. */
export function periodRange(period, today = localDate()) {
  const back = period === 'mensual' ? 29 : period === 'semanal' ? 6 : 0;
  return { from: addDays(today, -back), to: today };
}

const n = v => (Number.isFinite(Number(v)) ? Math.max(0, Math.trunc(Number(v))) : 0);

function clean(r) {
  const served = n(r.served), unserved = n(r.unserved), unconfirmed = n(r.unconfirmed);
  // Aunque la base garantiza served + unserved + unconfirmed = will_dispose, no se confía en ello aquí.
  const willDispose = Math.max(n(r.will_dispose), served + unserved + unconfirmed);
  return { date: r.stat_date, routeId: r.route_id, routeName: r.route_name || 'Ruta sin nombre', willDispose, served, unserved, unconfirmed };
}

/**
 * Une el historial cerrado con el día en curso.
 *   · Un día cerrado manda sobre la vista en vivo (el conteo ya quedó congelado).
 *   · La vista en vivo sólo aporta días ≤ hoy: un día futuro (respuestas de «mañana») aún no tiene
 *     nada que confirmar y no debe contarse como «sin confirmar».
 */
export function mergeRows(closed = [], live = [], today = localDate()) {
  const key = r => `${r.stat_date}|${r.route_id}`;
  const out = new Map();
  for (const r of closed) if (isDay(r?.stat_date) && r.route_id && r.stat_date <= today) out.set(key(r), clean(r));
  for (const r of live) {
    if (!isDay(r?.stat_date) || !r.route_id || r.stat_date > today || out.has(key(r))) continue;
    out.set(key(r), clean(r));
  }
  return [...out.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.routeName.localeCompare(b.routeName, 'es')));
}

const add = (t, r) => {
  t.willDispose += r.willDispose; t.served += r.served; t.unserved += r.unserved; t.unconfirmed += r.unconfirmed;
  return t;
};
const zero = () => ({ willDispose: 0, served: 0, unserved: 0, unconfirmed: 0 });

/** Porcentaje entero de `part` sobre `whole` (0 si no hay base). */
export const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/**
 * Totales, por ruta y por día. `servedOfConfirmed` es el % de atendidos entre quienes SÍ confirmaron
 * (los «sin confirmar» no cuentan como desatendidos: se muestran aparte).
 */
export function summarize(rows) {
  const total = zero();
  const routes = new Map();
  const days = new Map();
  for (const r of rows) {
    add(total, r);
    if (!routes.has(r.routeId)) routes.set(r.routeId, { routeId: r.routeId, routeName: r.routeName, ...zero() });
    add(routes.get(r.routeId), r);
    if (!days.has(r.date)) days.set(r.date, { date: r.date, ...zero() });
    add(days.get(r.date), r);
  }
  const withPct = t => ({ ...t, servedOfConfirmed: pct(t.served, t.served + t.unserved) });
  return {
    total: withPct(total),
    byRoute: [...routes.values()].map(withPct).sort((a, b) => b.willDispose - a.willDispose || a.routeName.localeCompare(b.routeName, 'es')),
    byDay: [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).map(withPct),
    isEmpty: total.willDispose === 0,
  };
}

/** Anchos (%) de los tres tramos de una barra apilada; siempre suman 100 (o 0 si no hay datos). */
export function segments(t) {
  const whole = t.willDispose;
  if (!whole) return { served: 0, unserved: 0, unconfirmed: 0 };
  const served = Math.round((t.served / whole) * 100);
  const unserved = Math.round((t.unserved / whole) * 100);
  return { served, unserved, unconfirmed: Math.max(0, 100 - served - unserved) };
}
