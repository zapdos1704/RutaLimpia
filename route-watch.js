/* ══════════════════════════════════════════════════════
   RUTALIMPIA — route-watch.js
   Vigila que cada camión siga su ruta y reacciona:

   · Se sale de la ruta          → aviso (y registro en route_events).
   · Regresa por otro camino     → con el aprendizaje ACTIVO la ruta cambia al
                                   camino real y la línea del tiempo se recalcula;
                                   con el aprendizaje APAGADO se conserva la ruta
                                   predeterminada.
   · Reporta un bloqueo de ruta  → con aprendizaje activo (o ruta de IA) se busca
                                   una calle alterna y la ruta se cambia.

   Cada cambio queda en route_events; ese registro es lo que después se usa para
   avisar a los vecinos cercanos (hora estimada incluida). Corre mientras haya un
   panel abierto: no sustituye a un proceso del servidor.

   Sin DOM ni red propia: todo llega inyectado, así se prueba en Node.
══════════════════════════════════════════════════════ */

import {
  prepareLine, createDeviationTracker, spliceDetour, routeChange,
  rerouteAroundBlock, retimeTimeline, fmtClock,
} from './route-learning.js?v=7d5234fc';

const FRESH_MS = 15 * 60 * 1000;
const WINDOW_MS = 10 * 60 * 1000;   // los avisos repetidos se agrupan en ventanas de 10 min

export function createRouteWatcher({ persist, logEvent, fetchRoutes, notify, reload = () => {}, now = () => Date.now() }) {
  const states = new Map();
  const handledBlocks = new Set();
  const busy = new Set();

  const learningOn = plan => plan.learning_enabled === true;

  function stateFor(plan) {
    const coords = plan.route_geojson?.coordinates;
    if (!coords || coords.length < 2) return null;
    let s = states.get(plan.id);
    if (!s || s.updatedAt !== plan.updated_at) {
      s = { updatedAt: plan.updated_at, coords, line: prepareLine(coords), tracker: createDeviationTracker(), lastTs: 0 };
      states.set(plan.id, s);
    }
    return s;
  }

  const safeLog = args => Promise.resolve(logEvent(args)).catch(() => { /* migración pendiente o sin permiso: el aviso en pantalla basta */ });

  async function commit(plan, coords, kind, message, payload) {
    if (busy.has(plan.id)) return;
    busy.add(plan.id);
    try {
      const timeline = retimeTimeline(plan.timeline, coords);
      await persist({
        routeId: plan.id,
        route: { type: 'LineString', coordinates: coords },
        timeline, kind,
        message: timeline ? `${message} Nuevo horario: ${fmtClock(timeline.startS)} a ${fmtClock(timeline.endS)}.` : message,
        payload, expectedUpdatedAt: plan.updated_at,
        dedupeKey: `${kind}:${Math.floor(now() / WINDOW_MS)}`,
      });
      notify(message, 'info');
      reload();
    } catch (err) {
      if (err?.missingMigration) notify(err.message, 'warn');
      else if (/modificad|conflict/i.test(err?.message || '')) reload();          // otra persona ya lo cambió
      else notify(`No se pudo actualizar la ruta «${plan.name}»: ${err?.message || 'error desconocido'}`, 'error');
    } finally { busy.delete(plan.id); }
  }

  async function onBlocked(plan, vehicle, s) {
    const label = `${vehicle.economic_number} · «${plan.name}»`;
    if (!(learningOn(plan) || plan.route_mode === 'ai')) {
      notify(`Bloqueo en la ruta de ${label}. El aprendizaje está apagado: se conserva la ruta predeterminada.`, 'warn');
      return;
    }
    let result;
    try { result = await rerouteAroundBlock(s.coords, [vehicle._lng, vehicle._lat], fetchRoutes); }
    catch (err) { result = { ok: false, reason: err?.message || 'No se pudo consultar el servidor de rutas.' }; }
    if (result.ok) {
      const km = (Math.abs(result.detourM) / 1000).toFixed(2);
      await commit(plan, result.coords, 'blockage_reroute',
        `Bloqueo en la ruta de ${label}: se cambió por una calle alterna (${result.detourM >= 0 ? '+' : '−'}${km} km).`,
        { vehicleId: vehicle.id, detourM: result.detourM, block: [vehicle._lng, vehicle._lat] });
    } else if (!/no está sobre esta ruta/i.test(result.reason)) {
      notify(`Bloqueo en la ruta de ${label}. ${result.reason}`, 'warn');
      safeLog({ routeId: plan.id, kind: 'blockage', message: `Bloqueo sin alterna: ${result.reason}`, payload: { vehicleId: vehicle.id }, dedupeKey: `blk:${Math.floor(now() / WINDOW_MS)}` });
    }
  }

  function handle(plan, vehicle) {
    const s = stateFor(plan);
    if (!s) return;
    /* La página guarda la marca de tiempo como texto ISO; los números también valen. */
    const ts = typeof vehicle._ts === 'number' ? vehicle._ts : Date.parse(vehicle._ts);
    if (!Number.isFinite(ts) || now() - ts > FRESH_MS) return;

    const blockedSince = vehicle._state?.blocked ? Number(new Date(vehicle._state.blockedSince)) : null;
    if (blockedSince) {
      const key = `${plan.id}:${blockedSince}`;
      if (!handledBlocks.has(key)) { handledBlocks.add(key); onBlocked(plan, vehicle, s); }
    }

    if (ts <= s.lastTs) return;              // la misma lectura no cuenta dos veces
    s.lastTs = ts;
    const ev = s.tracker.update(s.line, [vehicle._lng, vehicle._lat], ts);
    if (!ev) return;
    const label = `${vehicle.economic_number} · «${plan.name}»`;

    if (ev.type === 'off_route') {
      notify(`${label} salió de su ruta (${ev.distM} m). ${learningOn(plan) ? 'Aprendizaje activo: si regresa por otro camino, la ruta se ajustará.' : 'Aprendizaje apagado: se conserva la ruta predeterminada.'}`, 'warn');
      safeLog({ routeId: plan.id, kind: 'deviation', message: `${vehicle.economic_number} salió de la ruta (${ev.distM} m).`, payload: { vehicleId: vehicle.id, distM: ev.distM }, dedupeKey: `dev:${Math.floor(ev.since / WINDOW_MS)}` });
      return;
    }
    if (ev.type === 'back_on_route') {
      if (!learningOn(plan)) { notify(`${label} volvió a su ruta.`, 'info'); return; }
      const coords = spliceDetour(s.coords, ev.detour, { exitAlongM: ev.exitAlongM, reenterAlongM: ev.reenterAlongM });
      const change = routeChange(s.coords, coords);
      if (!change.changed) return;
      commit(plan, coords, 'route_changed',
        `La ruta «${plan.name}» cambió: ${vehicle.economic_number} tomó otro camino (hasta ${change.maxOffM} m de diferencia).`,
        { vehicleId: vehicle.id, maxOffM: change.maxOffM, lengthDeltaM: change.lengthDeltaM });
    }
  }

  return {
    /** Llamar en cada actualización de posiciones. */
    tick(vehicles, plans) {
      for (const plan of plans || []) {
        if (!plan.vehicle_id || !plan.route_geojson) continue;
        const vehicle = (vehicles || []).find(v => v.id === plan.vehicle_id);
        if (vehicle && Number.isFinite(vehicle._lat) && Number.isFinite(vehicle._lng)) handle(plan, vehicle);
      }
    },
    forget(planId) { states.delete(planId); },
  };
}
