/* ══════════════════════════════════════════════════════
   RUTALIMPIA — bridge-auth.js
   Credencial con la que el panel habla con el puente de IA/OSRM.

   Se usa la sesión de Supabase de quien inició sesión: el puente la valida y pone
   por su cuenta la clave hacia la PC. Nadie teclea ni guarda la clave en el
   navegador. Si alguien ya tenía una clave guardada de antes, se respeta como
   respaldo cuando no hay sesión.
══════════════════════════════════════════════════════ */

import { sb } from './db.js?v=7d5234fc';

const LS_AI_KEY = 'rl_ai_routing_key';
/* El servidor público de demostración no acepta credenciales ajenas. */
const PUBLIC_OSRM = /router\.project-osrm\.org/i;

export async function bridgeAuthHeaders(endpoint = '') {
  if (PUBLIC_OSRM.test(endpoint)) return {};
  try {
    const { data } = await sb.auth.getSession();
    const token = data?.session?.access_token;
    if (token) return { Authorization: `Bearer ${token}` };
  } catch { /* sin sesión: se prueba la clave antigua */ }
  try {
    const key = localStorage.getItem(LS_AI_KEY) || '';
    return key ? { Authorization: `Bearer ${key}` } : {};
  } catch { return {}; }
}
