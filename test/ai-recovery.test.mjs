import test from 'node:test';
import assert from 'node:assert/strict';
import { AiUnavailableError, describeAiFailure, fetchWithRecovery } from '../ai-recovery.js';

const respuesta = (status, body = {}) => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const opciones = { retryWaitMs: 5, timeoutMs: 1000 };

/* ── qué le decimos a la persona ── */

test('«pc_offline» rápido = la PC del servicio no está (apagada, sin internet o sin Docker)', () => {
  const e = describeAiFailure({ status: 503, code: 'pc_offline', elapsedMs: 800 });
  assert.equal(e.kind, 'apagada');
  assert.match(e.message, /PC del servicio/);
});

test('«pc_offline» después de esperar ~55 s NO es una PC apagada: es que la IA tardó demasiado', () => {
  const e = describeAiFailure({ status: 503, code: 'pc_offline', elapsedMs: 55_200 });
  assert.equal(e.kind, 'lenta');
  assert.match(e.message, /tardó demasiado/);
  assert.doesNotMatch(e.message, /apagada/);
});

test('cada causa tiene su mensaje y su tipo', () => {
  const caso = (args) => describeAiFailure(args);
  assert.equal(caso({ status: 503, code: 'upstream_unavailable' }).kind, 'falla');
  assert.equal(caso({ status: 503, code: 'auth_unavailable' }).kind, 'sesion');
  for (const code of ['session_auth_not_configured', 'configuration_incomplete', 'origin_not_verified', 'bridge_unavailable']) assert.equal(caso({ status: 503, code }).kind, 'config');
  assert.equal(caso({ status: 401 }).kind, 'sesion');
  assert.match(caso({ status: 401 }).message, /Cierra sesión/);
  assert.equal(caso({ status: 403 }).kind, 'config');
  assert.equal(caso({ status: 504 }).kind, 'lenta');
  assert.equal(caso({ status: 524 }).kind, 'lenta');
  assert.equal(caso({ network: true }).kind, 'red');
  assert.equal(caso({ timedOut: true }).kind, 'lenta');
  assert.equal(caso({ status: 422, detail: 'Ninguna calle de la zona se puede recorrer.' }).message, 'Ninguna calle de la zona se puede recorrer.');
  assert.ok(caso({ status: 500, detail: 'boom' }) instanceof AiUnavailableError);
});

/* ── reintento y tiempo de espera ── */

test('si a la primera el servicio no estaba y a la segunda sí, la persona ni se entera (solo ve «Reconectando…»)', async () => {
  const llamadas = [];
  const avisos = [];
  const res = await fetchWithRecovery(async () => { llamadas.push(1); return llamadas.length === 1 ? respuesta(503, { error: 'pc_offline' }) : respuesta(200, {}); }, { ...opciones, onStatus: m => avisos.push(m) });
  assert.equal(res.status, 200);
  assert.equal(llamadas.length, 2);
  assert.deepEqual(avisos, ['Reconectando con la IA…']);
});

test('si sigue sin estar, se rinde tras un solo reintento con la causa clara', async () => {
  let llamadas = 0;
  await assert.rejects(fetchWithRecovery(async () => { llamadas++; return respuesta(503, { error: 'pc_offline' }); }, opciones), e => e.kind === 'apagada');
  assert.equal(llamadas, 2);
});

test('un error de red también se reintenta una vez', async () => {
  let llamadas = 0;
  await assert.rejects(fetchWithRecovery(async () => { llamadas++; throw new TypeError('Failed to fetch'); }, opciones), e => e.kind === 'red');
  assert.equal(llamadas, 2);
});

test('lo que no se arregla repitiendo (falla interna, zona sin calles, sin permiso) NO se reintenta', async () => {
  for (const [status, body, kind] of [[503, { error: 'upstream_unavailable' }, 'falla'], [422, { detail: 'sin calles' }, 'falla'], [403, {}, 'config']]) {
    let llamadas = 0;
    await assert.rejects(fetchWithRecovery(async () => { llamadas++; return respuesta(status, body); }, opciones), e => e.kind === kind);
    assert.equal(llamadas, 1, `${status} no debe reintentarse`);
  }
});

test('si la IA tarda más del tiempo de espera se avisa que tardó demasiado y no se vuelve a pedir lo mismo', async () => {
  let llamadas = 0;
  const colgada = sig => new Promise((_, reject) => { llamadas++; sig.addEventListener('abort', () => reject(sig.reason), { once: true }); });
  await assert.rejects(fetchWithRecovery(colgada, { ...opciones, timeoutMs: 30 }), e => e.kind === 'lenta');
  assert.equal(llamadas, 1);
});

test('si la persona cancela, se relanza la cancelación tal cual (no es una falla)', async () => {
  const c = new AbortController();
  const colgada = sig => new Promise((_, reject) => sig.addEventListener('abort', () => reject(sig.reason), { once: true }));
  const p = fetchWithRecovery(colgada, { ...opciones, signal: c.signal });
  c.abort(new DOMException('cancelado', 'AbortError'));
  await assert.rejects(p, e => e.name === 'AbortError' && !(e instanceof AiUnavailableError));
});

test('cancelar mientras espera el reintento también corta', async () => {
  const c = new AbortController();
  const p = fetchWithRecovery(async () => respuesta(503, { error: 'pc_offline' }), { ...opciones, retryWaitMs: 500, signal: c.signal });
  setTimeout(() => c.abort(new DOMException('cancelado', 'AbortError')), 20);
  await assert.rejects(p, e => e.name === 'AbortError');
});
