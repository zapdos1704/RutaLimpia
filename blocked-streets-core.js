/* ══════════════════════════════════════════════════════
   RUTALIMPIA — blocked-streets-core.js
   Parte pura de la lista de cuadras prohibidas (sin Supabase ni navegador), para probarla
   en Node. El guardado vive en blocked-streets.js.
══════════════════════════════════════════════════════ */

import { haversineM } from './geo.js?v=426c553c';

export const SAME_STREET_M = 12;

/** Normaliza una fila (de Supabase o del navegador) a { id, name, lng, lat, note }. */
export const clean = r => ({ id: r.id, name: r.name || null, lng: Number(r.lng), lat: Number(r.lat), note: r.note || null });

/** ¿Ya hay una cuadra marcada a menos de 12 m de este punto? Devuelve la que sea, o null. */
export function findNear(list, point, meters = SAME_STREET_M) {
  return list.find(b => haversineM([b.lng, b.lat], point) <= meters) || null;
}

/** Lo que recibe la IA: solo puntos y nombre (sin ids ni notas). Descarta filas sin coordenadas válidas. */
export const toRequest = list => list
  .filter(b => Number.isFinite(Number(b.lng)) && Number.isFinite(Number(b.lat)))
  .map(b => ({ lng: Number(b.lng), lat: Number(b.lat), name: b.name ?? null }));
