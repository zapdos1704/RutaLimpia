/* ══════════════════════════════════════════════════════
   RUTALIMPIA — ai-recovery.js
   Qué pasa cuando la IA no responde: causa clara, tiempo de espera y un reintento.
   Sin dependencias del navegador ni de Supabase, para poder probarlo en Node.
══════════════════════════════════════════════════════ */

/**
 * La IA no se pudo usar. `kind` dice por qué, para que la pantalla (y el reintento automático) actúen distinto:
 *   apagada  la PC del servicio está apagada, sin internet o Docker no corre   (se reintenta una vez)
 *   red      este navegador no llegó al servicio                                (se reintenta una vez)
 *   sesion   no se pudo verificar la sesión con el servidor                     (se reintenta una vez)
 *   lenta    la IA tardó demasiado y el servicio cortó la espera                (no se reintenta: pediría lo mismo)
 *   falla    la IA respondió con un error interno                               (no se reintenta)
 *   config   el puente de la IA está mal configurado (lo arregla el administrador)
 */
export class AiUnavailableError extends Error {
  constructor(message, kind, status = null) {
    super(message);
    this.name = 'AiUnavailableError';
    this.kind = kind;
    this.status = status;
  }
}

/** Cuánto espera este navegador la respuesta: un poco más que los 55 s del servicio, para que el mensaje sea el nuestro. */
export const AI_CLIENT_TIMEOUT_MS = 60_000;
/** Si la falla llega antes de esto no fue una espera larga: el servicio no estaba (p. ej. el túnel se estaba re-registrando). */
export const FAST_FAIL_MS = 40_000;
/** El túnel de la PC se vuelve a registrar cada 3 min y tarda unos segundos: se espera antes de reintentar. */
export const AI_RETRY_WAIT_MS = 6_000;
export const AI_MAX_ATTEMPTS = 2;

const SLOW_MESSAGE = 'La IA tardó demasiado en calcular esta zona y el servicio cortó la espera. Prueba con una zona más pequeña o baja la cobertura.';

/** Traduce lo que respondió el servicio (o su ausencia) a un error entendible. */
export function describeAiFailure({ status = null, code = null, detail = '', elapsedMs = 0, network = false, timedOut = false }) {
  if (timedOut || status === 504 || status === 524) return new AiUnavailableError(SLOW_MESSAGE, 'lenta', status);
  if (network) return new AiUnavailableError('No hay conexión con el servicio de IA. Revisa tu internet e inténtalo de nuevo.', 'red');
  if (status === 401) return new AiUnavailableError('El servicio de IA no reconoció tu sesión. Cierra sesión y vuelve a entrar.', 'sesion', 401);
  if (status === 403) return new AiUnavailableError('Tu cuenta no tiene permiso para usar la IA de rutas.', 'config', 403);
  if (status === 503) {
    if (code === 'auth_unavailable') return new AiUnavailableError('No se pudo verificar tu sesión con el servidor. Inténtalo de nuevo en un momento.', 'sesion', 503);
    if (code === 'session_auth_not_configured' || code === 'configuration_incomplete' || code === 'origin_not_verified' || code === 'bridge_unavailable') {
      return new AiUnavailableError('El puente de la IA no está configurado bien. Avisa al administrador.', 'config', 503);
    }
    if (code === 'upstream_unavailable') {
      return new AiUnavailableError('La IA falló al calcular esta zona. Vuelve a intentarlo; si se repite, prueba con una zona más pequeña o avisa al administrador.', 'falla', 503);
    }
    // «pc_offline» también es lo que responde el puente cuando la IA se pasa de 55 s: por el tiempo transcurrido se sabe cuál fue.
    if (elapsedMs >= FAST_FAIL_MS) return new AiUnavailableError(SLOW_MESSAGE, 'lenta', 503);
    return new AiUnavailableError('La IA no responde: la PC del servicio está apagada, sin internet o Docker no está corriendo. Enciéndela y vuelve a intentar.', 'apagada', 503);
  }
  if (status === 422) return new AiUnavailableError(detail || 'La IA no pudo trazar una ruta con esos datos.', 'falla', 422);
  return new AiUnavailableError(`El servicio de IA respondió ${status}. ${detail}`.trim(), 'falla', status);
}

export const RETRYABLE = new Set(['apagada', 'red', 'sesion']);
export const wait = (ms, signal) => new Promise((resolve, reject) => {
  const id = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(id); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); }, { once: true });
});

/** Cancela con lo que llegue primero: la persona (`signal`) o el tiempo de espera. */
export function withTimeout(signal, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Tiempo de espera agotado', 'TimeoutError')), ms);
  const onAbort = () => controller.abort(signal.reason);
  if (signal) signal.aborted ? onAbort() : signal.addEventListener('abort', onAbort, { once: true });
  return { signal: controller.signal, done: () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); } };
}

/**
 * Hace la petición con tiempo de espera y, si la causa lo merece, UN reintento tras unos segundos.
 * `doFetch(signal)` devuelve la Response (o lanza si no hubo red). Devuelve la Response buena; si no, lanza AiUnavailableError.
 * Si la persona cancela (`signal`), se relanza tal cual: no es una falla.
 */
export async function fetchWithRecovery(doFetch, { signal, onStatus, timeoutMs = AI_CLIENT_TIMEOUT_MS, retryWaitMs = AI_RETRY_WAIT_MS, maxAttempts = AI_MAX_ATTEMPTS } = {}) {
  for (let attempt = 1; ; attempt++) {
    const guard = withTimeout(signal, timeoutMs);
    const t0 = Date.now();
    let failure = null;
    try {
      const res = await doFetch(guard.signal);
      if (res.ok) return res;
      const text = await res.text().catch(() => '');
      let body = null;
      try { body = JSON.parse(text); } catch { /* texto plano */ }
      const detail = typeof body?.detail === 'string' ? body.detail : text.slice(0, 200);
      failure = describeAiFailure({ status: res.status, code: body?.error, detail, elapsedMs: Date.now() - t0 });
    } catch (err) {
      if (signal?.aborted) throw err;
      const timedOut = err?.name === 'TimeoutError' || guard.signal.aborted;
      failure = describeAiFailure({ network: !timedOut, timedOut });
    } finally {
      guard.done();
    }
    if (attempt >= maxAttempts || !RETRYABLE.has(failure.kind)) throw failure;
    onStatus?.('Reconectando con la IA…');
    await wait(retryWaitMs, signal);
  }
}
