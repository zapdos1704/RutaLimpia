/* ══════════════════════════════════════════════════════
   RUTALIMPIA — blocked-streets.js
   Lista manual de calles por las que el camión NO debe pasar (angostas, sin salida
   real, en obra…). El mapa de Sahuayo no trae el ancho de las calles, así que esta lista
   es la forma de corregir lo que la IA no puede saber.

   Se guarda en Supabase (tabla ai_blocked_streets, SQL 009) para que la vea toda la
   administración; si la tabla no existe todavía o no hay sesión, queda en este navegador
   y la interfaz lo avisa. La IA recibe cada calle como un punto sobre ella (lng, lat).
══════════════════════════════════════════════════════ */

import { sb } from './db.js?v=426c553c';
import { clean, findNear, toRequest } from './blocked-streets-core.js?v=426c553c';

export { findNear, toRequest };

const KEY = 'rl.blockedStreets.v1';
const readLocal = () => {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
};
const writeLocal = list => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* navegación privada */ } };

/** { list, shared, note }: `shared` = viene de Supabase; si no, `note` dice por qué es local. */
export async function loadBlockedStreets() {
  try {
    const { data, error } = await sb.from('ai_blocked_streets').select('id,name,lng,lat,note').order('created_at');
    if (error) throw error;
    return { list: (data || []).map(clean), shared: true, note: null };
  } catch (err) {
    return { list: readLocal().map(clean), shared: false, note: err?.message || 'sin conexión' };
  }
}

/** Marca una calle. `shared` indica dónde guardar (lo que devolvió loadBlockedStreets). */
export async function addBlockedStreet({ lng, lat, name = null, note = null }, shared) {
  if (shared) {
    const { data, error } = await sb.from('ai_blocked_streets').insert({ lng, lat, name, note }).select('id,name,lng,lat,note').single();
    if (error) throw error;
    return clean(data);
  }
  const item = clean({ id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, lng, lat, name, note });
  writeLocal([...readLocal(), item]);
  return item;
}

export async function removeBlockedStreet(id, shared) {
  if (shared) {
    const { error } = await sb.from('ai_blocked_streets').delete().eq('id', id);
    if (error) throw error;
    return;
  }
  writeLocal(readLocal().filter(b => b.id !== id));
}
