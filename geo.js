/* ══════════════════════════════════════════════════════
   RUTALIMPIA — geo.js
   Geometría local sin dependencias (ni red, ni Supabase), pensada para correr
   igual en el navegador y en las pruebas de Node.
   Coordenadas siempre en formato GeoJSON [lng, lat].
══════════════════════════════════════════════════════ */

/* ── Geometría ─────────────────────────────────────── */

export const rad = d => (d * Math.PI) / 180;

/** Distancia en metros entre dos puntos [lng, lat]. */
export function haversineM(a, b) {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Proyección plana local (metros) alrededor de una latitud: suficiente para zonas urbanas. */
export const toXY = (p, lat0) => [
  rad(p[0]) * 6371000 * Math.cos(rad(lat0)),
  rad(p[1]) * 6371000,
];

/** ¿El punto cae dentro del anillo (ray casting)? El anillo puede venir cerrado o abierto. */
export function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) &&
        pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distancia en metros del punto al segmento a-b. */
export function distanceToSegmentM(p, a, b) {
  const lat0 = p[1];
  const [px, py] = toXY(p, lat0);
  const [ax, ay] = toXY(a, lat0);
  const [bx, by] = toXY(b, lat0);
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Distancia en metros del punto al borde del anillo. */
export function distanceToRingM(p, ring) {
  let best = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    best = Math.min(best, distanceToSegmentM(p, ring[i], ring[i + 1]));
  }
  return best;
}

export function polylineLengthM(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += haversineM(coords[i - 1], coords[i]);
  return total;
}

/** Punto a `distM` metros del inicio de la línea. */
export function alongLine(coords, distM) {
  let remaining = distM;
  for (let i = 1; i < coords.length; i++) {
    const seg = haversineM(coords[i - 1], coords[i]);
    if (seg >= remaining && seg > 0) {
      const k = remaining / seg;
      return [
        coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * k,
        coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * k,
      ];
    }
    remaining -= seg;
  }
  return coords[coords.length - 1];
}

/** Anillo cerrado (primer punto repetido al final). */
export const closeRing = ring => {
  const first = ring[0], last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? ring.slice() : [...ring, first];
};

export function ringAreaKm2(ring) {
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const xy = closeRing(ring).map(p => toXY(p, lat0));
  let sum = 0;
  for (let i = 0; i < xy.length - 1; i++) sum += xy[i][0] * xy[i + 1][1] - xy[i + 1][0] * xy[i][1];
  return Math.abs(sum) / 2 / 1e6;
}

export function ringCentroid(ring) {
  const pts = closeRing(ring);
  const lat0 = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const xy = pts.map(p => toXY(p, lat0));
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < xy.length - 1; i++) {
    const cross = xy[i][0] * xy[i + 1][1] - xy[i + 1][0] * xy[i][1];
    a += cross;
    cx += (xy[i][0] + xy[i + 1][0]) * cross;
    cy += (xy[i][1] + xy[i + 1][1]) * cross;
  }
  if (!a) return pts[0];
  cx /= 3 * a; cy /= 3 * a;
  return [(cx / (6371000 * Math.cos(rad(lat0)))) * (180 / Math.PI), (cy / 6371000) * (180 / Math.PI)];
}

/** ¿Algún par de lados no contiguos se cruza? (polígono inválido) */
export function ringSelfIntersects(ring) {
  const pts = closeRing(ring);
  const n = pts.length - 1;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const hit = (p1, p2, p3, p4) => {
    const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2);
    const d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;   // primer y último lado comparten vértice
      if (hit(pts[i], pts[i + 1], pts[j], pts[j + 1])) return true;
    }
  }
  return false;
}

/** Fracción (0–1) de la ruta que queda dentro de la zona, muestreada a lo largo del trazo. */
export function insideRatio(routeCoords, ring) {
  const total = polylineLengthM(routeCoords);
  if (!total) return 0;
  const samples = Math.max(20, Math.min(80, Math.ceil((total / 1000) * 12)));
  let inside = 0;
  for (let i = 0; i <= samples; i++) {
    if (pointInRing(alongLine(routeCoords, total * (i / samples)), ring)) inside++;
  }
  return inside / (samples + 1);
}
