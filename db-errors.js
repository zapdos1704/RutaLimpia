/* ══════════════════════════════════════════════════════
   db-errors.js
   Traduce los errores de Supabase/PostgREST a un mensaje que una persona pueda usar.
   Las funciones SQL de 008 ya lanzan mensajes en español (códigos 22023, P0002, 23505);
   aquí se distinguen los casos que no son suyos: falta el SQL, sin permiso, sin red.
   ══════════════════════════════════════════════════════ */

export const NEEDS_SQL_008 = 'Falta correr el SQL 008 en Supabase (rutalimpia-ai-service/docs/sql/008_panel_dump_sites_schedules.sql).';

const text = err => `${err?.code || ''} ${err?.message || ''} ${err?.details || ''} ${err?.hint || ''}`;

/** ¿Falta la función o la vista de 008? (PostgREST: PGRST202 función, 42883 función, 42P01 tabla/vista). */
export function isMissingSql(err) {
  return /PGRST202|PGRST205|42883|42P01|Could not find the (function|table)|does not exist/i.test(text(err));
}

/** ¿Es un rechazo de permisos? */
export function isDenied(err) {
  return /42501|permission denied|row-level security|not allowed/i.test(text(err)) || err?.status === 401 || err?.status === 403;
}

/** Mensaje final para mostrar en pantalla. */
export function friendlyDbError(err, fallback = 'No se pudo guardar. Intenta de nuevo.') {
  if (!err) return fallback;
  if (isMissingSql(err)) return NEEDS_SQL_008;
  const code = String(err.code || '');
  // Los mensajes de las funciones de 008 ya están escritos para el usuario.
  if (/^(22023|P0002|23505)$/.test(code) && err.message) return err.message;
  if (isDenied(err)) return 'Sólo la administración puede hacer este cambio.';
  if (/Tiempo de espera agotado|Failed to fetch|NetworkError|network/i.test(text(err))) return 'Sin conexión con el servidor. Revisa tu internet e intenta de nuevo.';
  return err.message || fallback;
}
