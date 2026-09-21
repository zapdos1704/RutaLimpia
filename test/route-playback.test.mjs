import test from 'node:test';
import assert from 'node:assert/strict';
import {
  haversineM, bearingDeg, cumulativeM, pointAt, stepIndexAt, detectTurns, fallbackSteps,
  normalizePlan, buildPrintHtml, routeSvg, projector, fmtKm, fmtMin, escapeHtml, packAiPlan, unpackAiPlan,
} from '../route-playback.js';

const LNG0 = -102.7245, LAT0 = 20.0538;
const M_LAT = 1 / 110540;
const M_LNG = 1 / (111320 * Math.cos(LAT0 * Math.PI / 180));
const en = (este, norte) => [LNG0 + este * M_LNG, LAT0 + norte * M_LAT];

test('haversine mide unos 100 m entre dos puntos a 100 m', () => {
  assert.ok(Math.abs(haversineM(en(0, 0), en(100, 0)) - 100) < 1);
});

test('el rumbo va de 0 (norte) a 360 sin salirse', () => {
  assert.ok(Math.abs(bearingDeg(en(0, 0), en(0, 100))) < 0.5);
  assert.ok(Math.abs(bearingDeg(en(0, 0), en(100, 0)) - 90) < 0.5);
  assert.ok(Math.abs(bearingDeg(en(0, 0), en(-100, 0)) - 270) < 0.5);
});

test('cumulativeM acumula y empieza en cero', () => {
  const c = cumulativeM([en(0, 0), en(100, 0), en(100, 50)]);
  assert.equal(c[0], 0);
  assert.ok(Math.abs(c[1] - 100) < 1 && Math.abs(c[2] - 150) < 1.5);
});

test('pointAt interpola sobre el tramo correcto y lo encuentra por índice', () => {
  const coords = [en(0, 0), en(100, 0), en(100, 100)];
  const cum = cumulativeM(coords);
  const p = pointAt(coords, cum, 150);
  assert.equal(p.index, 1);
  assert.ok(Math.abs(p.lng - coords[1][0]) < 1e-9);
  assert.ok(Math.abs((p.lat - coords[1][1]) / M_LAT - 50) < 1);
  assert.ok(Math.abs(p.bearing) < 1);          // ahí va al norte
});

test('pointAt se queda en los extremos si se pasa o es negativo', () => {
  const coords = [en(0, 0), en(100, 0)];
  const cum = cumulativeM(coords);
  assert.deepEqual([pointAt(coords, cum, -5).lng, pointAt(coords, cum, -5).lat], coords[0]);
  const fin = pointAt(coords, cum, 10_000);
  assert.ok(Math.abs(fin.lng - coords[1][0]) < 1e-9);
});

test('stepIndexAt devuelve la última indicación que ya empezó', () => {
  const steps = [{ desde: 0 }, { desde: 4 }, { desde: 9 }];
  assert.equal(stepIndexAt(steps, 0), 0);
  assert.equal(stepIndexAt(steps, 3), 0);
  assert.equal(stepIndexAt(steps, 4), 1);
  assert.equal(stepIndexAt(steps, 50), 2);
  assert.equal(stepIndexAt([], 3), -1);
});

test('detectTurns: derecha, izquierda y vuelta en U', () => {
  assert.deepEqual(detectTurns([en(0, 0), en(100, 0), en(100, -100)]).map(t => t.kind), ['derecha']);
  assert.deepEqual(detectTurns([en(0, 0), en(100, 0), en(100, 100)]).map(t => t.kind), ['izquierda']);
  assert.deepEqual(detectTurns([en(0, 0), en(150, 0), en(0, 0)]).map(t => t.kind), ['vuelta']);
  assert.deepEqual(detectTurns([en(0, 0), en(300, 0)]), []);
});

test('detectTurns ignora una curva suave y no cuenta dos veces una esquina', () => {
  const arco = Array.from({ length: 41 }, (_, i) => { const a = i * Math.PI / 2 / 40; return en(200 * Math.sin(a), 200 * (1 - Math.cos(a))); });
  assert.deepEqual(detectTurns(arco), []);
  const denso = [en(0, 0), en(25, 0), en(50, 0), en(75, 0), en(100, 0), en(100, 25), en(100, 50), en(100, 75), en(100, 100)];
  assert.equal(detectTurns(denso).length, 1);
});

test('fallbackSteps cubre todo el trazo, en orden y sin huecos', () => {
  const coords = [en(0, 0), en(100, 0), en(100, 100), en(200, 100)];
  const steps = fallbackSteps(coords);
  assert.equal(steps[0].giro, 'inicio');
  assert.equal(steps[0].desde, 0);
  assert.equal(steps.at(-1).hasta, coords.length - 1);
  for (let i = 1; i < steps.length; i++) assert.equal(steps[i].desde, steps[i - 1].hasta);
  assert.ok(steps.every(s => s.texto && s.metros > 0));
  assert.deepEqual(fallbackSteps([]), []);
});

test('normalizePlan usa las indicaciones de la IA si vienen y las de respaldo si no', () => {
  const coords = [en(0, 0), en(100, 0), en(100, 100)];
  const iaSteps = [{ tipo: 'recolectar', calle: 'Hidalgo', giro: 'inicio', metros: 200, desde: 0, hasta: 2, texto: 'Comienza en Hidalgo.' }];
  const conIa = normalizePlan({ coordinates: coords, steps: iaSteps });
  assert.equal(conIa.hasNames, true);
  assert.equal(conIa.steps[0].calle, 'Hidalgo');
  const sinIa = normalizePlan({ coordinates: coords });
  assert.equal(sinIa.hasNames, false);
  assert.ok(sinIa.steps.length >= 1);
  assert.equal(sinIa.cum.length, coords.length);
  assert.deepEqual(sinIa.skipped, []);
});

test('projector deja todos los puntos dentro del lienzo y conserva el norte arriba', () => {
  const pts = [en(0, 0), en(500, 0), en(500, 300), en(0, 300)];
  const proj = projector(pts, 760, 520);
  for (const p of pts) {
    const [x, y] = proj(p);
    assert.ok(x >= 0 && x <= 760 && y >= 0 && y <= 520);
  }
  assert.ok(proj(en(0, 300))[1] < proj(en(0, 0))[1]);         // más al norte = más arriba (y menor)
});

const planDemo = () => normalizePlan({
  coordinates: [en(0, 0), en(100, 0), en(100, 100), en(200, 100)],
  steps: [
    { tipo: 'recolectar', calle: 'Calle <b>Hidalgo</b>', giro: 'inicio', metros: 100, desde: 0, hasta: 1, texto: 'Comienza en Calle <b>Hidalgo</b> y recolecta 100 m.' },
    { tipo: 'trasladar', calle: 'Juárez', giro: 'izquierda', metros: 100, desde: 1, hasta: 2, texto: 'Gira a la izquierda en Juárez, 100 m sin recolectar (traslado).' },
    { tipo: 'recolectar', calle: 'Morelos', giro: 'derecha', metros: 100, desde: 2, hasta: 3, texto: 'Gira a la derecha en Morelos y recolecta 100 m.' },
  ],
  metrics: { km: 0.3, minutos_camion: 4, giros: 2, calles_a_pie: 1, max_a_ruta_m: 60, supuestos: 'Minutos estimados con supuestos.' },
  skipped: [{ nombre: 'Cerrada', coordinates: [en(200, 100), en(200, 180)] }],
  notes: 'Nota de prueba',
});

test('la hoja imprimible trae título, cifras, una fila por indicación y las notas', () => {
  const html = buildPrintHtml(planDemo(), { title: 'Ruta Norte', subtitle: 'VH-002', dateText: '20/09/2026' });
  assert.match(html, /<title>Ruta Norte<\/title>/);
  assert.match(html, /0 vueltas en U/);
  assert.equal((html.match(/<tr class=/g) || []).length, 3);
  assert.match(html, /Nota de prueba/);
  assert.match(html, /Minutos estimados con supuestos/);
  assert.match(html, /<svg/);
});

test('la hoja imprimible escapa los nombres de calle (no se inyecta HTML)', () => {
  const html = buildPrintHtml(planDemo(), { title: '<script>alert(1)</script>' });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('Calle <b>Hidalgo</b>'));
  assert.match(html, /Calle &lt;b&gt;Hidalgo&lt;\/b&gt;/);
});

test('el esquema dibuja los traslados punteados, las calles a pie y el inicio y el fin', () => {
  const svg = routeSvg(planDemo(), { zone: [en(-20, -20), en(220, -20), en(220, 200), en(-20, 200), en(-20, -20)] });
  assert.match(svg, /stroke-dasharray="8 4"/);          // el traslado
  assert.match(svg, /stroke-dasharray="3 3"/);          // calle a pie
  assert.equal((svg.match(/fill="#16a34a"/g) || []).length, 1);
  assert.equal((svg.match(/fill="#dc2626"/g) || []).length, 1);
});

test('formatos de km y minutos', () => {
  assert.equal(fmtKm(950), '0.95 km');
  assert.equal(fmtKm(12500), '12.5 km');
  assert.equal(fmtMin(45), '45 min');
  assert.equal(fmtMin(75), '1 h 15 min');
  assert.equal(fmtMin(0), '1 min');
  assert.equal(escapeHtml('a&b<"c">'), 'a&amp;b&lt;&quot;c&quot;&gt;');
});

/* ── packAiPlan / unpackAiPlan (recorrido guardado con la ruta) ── */
test('un recorrido guardado se recupera con sus indicaciones si el trazo no cambió', () => {
  const plan = planDemo();
  const guardado = JSON.parse(JSON.stringify(packAiPlan(plan)));         // pasó por JSON, como en la base de datos
  assert.equal(guardado.v, 1);
  assert.equal(guardado.n, plan.coords.length);
  const de_nuevo = unpackAiPlan(guardado, plan.coords);
  assert.equal(de_nuevo.hasNames, true);
  assert.equal(de_nuevo.steps.length, plan.steps.length);
  assert.equal(de_nuevo.metrics.giros, 2);
  assert.equal(de_nuevo.skipped.length, 1);
});

test('si el trazo cambió después de guardar, las indicaciones se ignoran y se usan los giros de la geometría', () => {
  const plan = planDemo();
  const guardado = JSON.parse(JSON.stringify(packAiPlan(plan)));
  const otro = [...plan.coords, en(300, 100)];                            // un vértice más
  const r = unpackAiPlan(guardado, otro);
  assert.equal(r.hasNames, false);
  assert.equal(r.metrics, null);
  assert.ok(r.steps.length >= 1 && r.steps.at(-1).hasta === otro.length - 1);
});

test('unpackAiPlan tolera lo que no existe: sin plan guardado, plan de otra versión o indicaciones fuera de rango', () => {
  const coords = [en(0, 0), en(100, 0), en(100, 100)];
  assert.equal(unpackAiPlan(null, coords).hasNames, false);
  assert.equal(unpackAiPlan({ v: 2, n: 3, steps: [{ desde: 0, hasta: 2 }] }, coords).hasNames, false);
  assert.equal(unpackAiPlan({ v: 1, n: 3, steps: [{ desde: 0, hasta: 99 }] }, coords).hasNames, false);
  assert.equal(unpackAiPlan({ v: 1, n: 3, steps: [] }, coords).hasNames, false);
});

test('packAiPlan redondea las calles a pie y limita cuántas guarda', () => {
  const plan = planDemo();
  plan.skipped = Array.from({ length: 500 }, (_, i) => ({ nombre: `C${i}`, coordinates: [[-102.123456789, 20.987654321], [-102.2, 20.9]] }));
  const p = packAiPlan(plan);
  assert.equal(p.skipped.length, 400);
  assert.deepEqual(p.skipped[0].coordinates[0], [-102.12346, 20.98765]);
});
