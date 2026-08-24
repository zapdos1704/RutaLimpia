/* ══════════════════════════════════════════════════════
   RUTALIMPIA — vehicle-colors.js
   Color de cada camión en el mapa.

   Orden de prioridad al resolver el color:
     1. vehicles.color  — si esa columna existe en la base (compartido entre
        todos los usuarios y dispositivos: es lo deseable)
     2. localStorage    — respaldo por navegador, para que la función sirva
        aunque la columna todavía no exista
     3. color derivado del número económico — estable, nunca cambia solo

   El estado de avería/inactivo SIEMPRE manda sobre el color elegido: un camión
   descompuesto tiene que verse rojo aunque alguien le haya puesto azul.
══════════════════════════════════════════════════════ */

const LS_KEY = 'rl_vehicle_colors';

/** Paleta ofrecida en el selector. Contrasta sobre el mapa oscuro. */
export const COLOR_PALETTE = [
  { hex: '#22c55e', name: 'Verde' },
  { hex: '#3b82f6', name: 'Azul' },
  { hex: '#f59e0b', name: 'Ámbar' },
  { hex: '#8b5cf6', name: 'Morado' },
  { hex: '#06b6d4', name: 'Cian' },
  { hex: '#ec4899', name: 'Rosa' },
  { hex: '#84cc16', name: 'Lima' },
  { hex: '#f97316', name: 'Naranja' },
  { hex: '#14b8a6', name: 'Turquesa' },
  { hex: '#eab308', name: 'Amarillo' },
  { hex: '#a855f7', name: 'Violeta' },
  { hex: '#64748b', name: 'Gris' },
];

const FALLBACK = COLOR_PALETTE.map(c => c.hex);

export const STATUS_COLOR = { maintenance: '#ef4444', inactive: '#64748b' };

function readOverrides() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
}
function writeOverrides(map) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(map)); } catch { /* modo privado */ }
}

/** Color estable derivado del número económico, cuando nadie eligió uno. */
export function defaultColorFor(vehicle) {
  const s = String(vehicle?.economic_number || vehicle?.id || '');
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return FALLBACK[hash % FALLBACK.length];
}

/** Color elegido para el camión, ignorando su estado. */
export function chosenColorFor(vehicle) {
  if (!vehicle) return FALLBACK[0];
  if (isValidHex(vehicle.color)) return vehicle.color;
  const override = readOverrides()[vehicle.id];
  if (isValidHex(override)) return override;
  return defaultColorFor(vehicle);
}

/** Color con el que se pinta en el mapa (el estado tiene prioridad). */
export function mapColorFor(vehicle) {
  if (!vehicle) return FALLBACK[0];
  if (STATUS_COLOR[vehicle.status]) return STATUS_COLOR[vehicle.status];
  return chosenColorFor(vehicle);
}

export const isValidHex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim());

/** Guarda el color solo en este navegador (respaldo cuando no hay columna). */
export function setLocalColor(vehicleId, hex) {
  const map = readOverrides();
  if (isValidHex(hex)) map[vehicleId] = hex.toLowerCase();
  else delete map[vehicleId];
  writeOverrides(map);
}

export function clearLocalColor(vehicleId) { setLocalColor(vehicleId, null); }
