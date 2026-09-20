/* ══════════════════════════════════════════════════════
   vehicle-load.js
   «Domicilios por carga»: cuántos domicilios atiende un camión antes de llenarse.
   El valor inicial se captura en el panel y el backend lo va ajustando con cada carga
   real (vehicles.stops_per_load / stops_per_load_samples). Con él se predice cuándo se
   llenará y se avisa de retrasos por capacidad. Lógica pura, sin red ni DOM.
   ══════════════════════════════════════════════════════ */

export const STOPS_PER_LOAD_MIN = 1;
export const STOPS_PER_LOAD_MAX = 5000;

/** Valida lo que escribió el usuario. Acepta coma decimal; guarda con un decimal como el backend. */
export function parseStopsPerLoad(raw) {
  const text = String(raw ?? '').trim().replace(',', '.');
  if (!text) return { ok: false, error: 'Escribe cuántos domicilios caben en una carga.' };
  if (!/^\d+(\.\d+)?$/.test(text)) return { ok: false, error: 'Escribe sólo un número (por ejemplo 120).' };
  const value = Math.round(Number(text) * 10) / 10;
  if (!Number.isFinite(value) || value < STOPS_PER_LOAD_MIN) return { ok: false, error: `Debe ser al menos ${STOPS_PER_LOAD_MIN}.` };
  if (value > STOPS_PER_LOAD_MAX) return { ok: false, error: `No puede pasar de ${STOPS_PER_LOAD_MAX}.` };
  return { ok: true, value };
}

const fmt = n => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Cómo mostrar el dato en la tarjeta del camión. */
export function describeStopsPerLoad(vehicle) {
  const raw = vehicle?.stops_per_load;
  const value = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return { hasValue: false, valueText: 'Sin definir', detail: 'sin esto no se avisan retrasos por capacidad', action: 'Definir' };
  }
  const samples = Math.max(0, Math.trunc(Number(vehicle?.stops_per_load_samples) || 0));
  const detail = samples === 0 ? 'valor inicial' : `ajustado con ${samples} ${samples === 1 ? 'carga' : 'cargas'}`;
  return { hasValue: true, valueText: fmt(value), detail, action: 'Cambiar' };
}
