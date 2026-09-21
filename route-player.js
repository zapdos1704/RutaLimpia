/* ══════════════════════════════════════════════════════
   RUTALIMPIA — route-player.js
   «Ver recorrido»: una tarjeta sobre el mapa que recorre la ruta con un camión,
   marca la indicación en curso y permite saltar, cambiar la velocidad o imprimirla
   para el chofer. Usa el mapa de la página (MapLibre) y la lógica de
   route-playback.js; no descarga nada.

   Uso:  openRoutePlayer({ map, plan, title, subtitle, color, zone })
         closeRoutePlayer()
   `plan` sale de normalizePlan(): coords, cum, steps, metrics, skipped…
══════════════════════════════════════════════════════ */

import { icon } from './icons.js?v=426c553c';
import { pointAt, stepIndexAt, fmtKm, fmtMin, escapeHtml, buildPrintHtml } from './route-playback.js?v=426c553c';

const BASE_MPS = 30;            // velocidad ×1: 30 m/s (108 km/h de pantalla), pensada para verla, no para medir
const SPEEDS = [1, 2, 4, 8];
const SEEK_MAX = 10000;

let current = null;

const EMPTY = { type: 'FeatureCollection', features: [] };
const line = coords => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });

function addLayers(map, plan) {
  const has = id => !!map.getSource(id);
  if (!has('rp-skipped')) map.addSource('rp-skipped', { type: 'geojson', data: EMPTY });
  if (!has('rp-done')) map.addSource('rp-done', { type: 'geojson', data: EMPTY });
  if (!has('rp-step')) map.addSource('rp-step', { type: 'geojson', data: EMPTY });
  if (!map.getLayer('rp-skipped-line')) {
    map.addLayer({ id: 'rp-skipped-line', type: 'line', source: 'rp-skipped',
      layout: { 'line-cap': 'round' }, paint: { 'line-color': '#93c5fd', 'line-width': 2.5, 'line-dasharray': [1.5, 2], 'line-opacity': 0.9 } });
  }
  if (!map.getLayer('rp-done-line')) {
    map.addLayer({ id: 'rp-done-line', type: 'line', source: 'rp-done',
      layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#22c55e', 'line-width': 6, 'line-opacity': 0.95 } });
  }
  if (!map.getLayer('rp-step-line')) {
    map.addLayer({ id: 'rp-step-line', type: 'line', source: 'rp-step',
      layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 3, 'line-opacity': 0.95 } });
  }
  map.getSource('rp-skipped').setData({
    type: 'FeatureCollection',
    features: plan.skipped.filter(s => s.coordinates?.length > 1).map(s => line(s.coordinates)),
  });
}

function removeLayers(map) {
  for (const id of ['rp-step-line', 'rp-done-line', 'rp-skipped-line']) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of ['rp-step', 'rp-done', 'rp-skipped']) if (map.getSource(id)) map.removeSource(id);
}

function cardHtml({ title, subtitle, plan }) {
  const m = plan.metrics;
  const chips = [
    `<span><b>${fmtKm(m ? m.km * 1000 : plan.cum.at(-1))}</b> distancia</span>`,
    m ? `<span><b>${fmtMin(m.minutos_camion)}</b> estimado</span>` : '',
    m ? `<span><b>${m.giros}</b> giros · <b>${m.vueltas_u_prohibidas}</b> vueltas en U</span>` : '',
    m && m.calles_a_pie ? `<span><b>${m.calles_a_pie}</b> calles a pie (≤ ${m.max_a_ruta_m} m)</span>` : '',
  ].join('');
  return `
    <div class="rp-head">
      <div><div class="rp-title">${icon('route', { cls: 'ic-blue' })} ${escapeHtml(title)}</div>
        ${subtitle ? `<div class="rp-sub">${escapeHtml(subtitle)}</div>` : ''}</div>
      <button class="rp-x" type="button" id="rp-close" aria-label="Cerrar recorrido">${icon('close')}</button>
    </div>
    <div class="rp-chips">${chips}</div>
    <div class="rp-now" id="rp-now" aria-live="polite"></div>
    <input class="rp-seek" id="rp-seek" type="range" min="0" max="${SEEK_MAX}" value="0" aria-label="Avance del recorrido"/>
    <div class="rp-controls">
      <button class="btn-new" type="button" id="rp-play">${icon('play')} <span>Reproducir</span></button>
      <label class="rp-opt">Velocidad
        <select class="form-select" id="rp-speed">${SPEEDS.map(s => `<option value="${s}"${s === 4 ? ' selected' : ''}>×${s}</option>`).join('')}</select>
      </label>
      <label class="rp-opt"><input type="checkbox" id="rp-follow" checked/> Seguir al camión</label>
      <button class="btn-cancel" type="button" id="rp-print">Imprimir / PDF</button>
    </div>
    <div class="rp-prog" id="rp-prog"></div>
    <ol class="rp-steps" id="rp-steps">${plan.steps.map((s, i) => `
      <li data-i="${i}" class="${s.tipo === 'trasladar' ? 'tr' : ''}" tabindex="0">
        <span class="rp-n">${i + 1}</span><span class="rp-t">${escapeHtml(s.texto)}</span><span class="rp-m">${s.metros} m</span>
      </li>`).join('')}</ol>
    ${plan.hasNames ? '' : '<div class="rp-note">Esta ruta no trae los nombres de las calles: solo se muestran los giros.</div>'}`;
}

export function isRoutePlayerOpen() { return !!current; }

/** Abre la hoja imprimible (o «Guardar como PDF») de una ruta, sin necesidad de abrir la tarjeta. */
export function printRoutePlan(plan, { title = 'Ruta de recolección', subtitle = '', zone = null, color = '#2563eb' } = {}) {
  const w = window.open('', '_blank');
  if (!w) { alert('El navegador bloqueó la ventana. Permite las ventanas emergentes para imprimir.'); return; }
  w.document.open();
  w.document.write(buildPrintHtml(plan, { title, subtitle, zone, color, dateText: new Date().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) }));
  w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch { /* el botón de la hoja también imprime */ } }, 500);
}

export function closeRoutePlayer() {
  if (!current) return;
  const { map, card, marker, raf, onKey, onDrag, onClose } = current;
  cancelAnimationFrame(raf);
  marker.remove();
  removeLayers(map);
  map.off('dragstart', onDrag);
  document.removeEventListener('keydown', onKey);
  card.remove();
  current = null;
  if (typeof onClose === 'function') onClose();
}

export function openRoutePlayer({ map, plan, title = 'Recorrido de la ruta', subtitle = '', color = '#2563eb', zone = null, onClose = null }) {
  closeRoutePlayer();
  if (!plan?.coords?.length || plan.coords.length < 2) throw new Error('La ruta no tiene un trazo que recorrer.');

  const card = document.createElement('section');
  card.className = 'rp-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Recorrido de la ruta');
  card.innerHTML = cardHtml({ title, subtitle, plan });
  document.body.appendChild(card);

  addLayers(map, plan);

  const truck = document.createElement('div');
  truck.className = 'rp-truck';
  truck.innerHTML = icon('truck', { size: 20, color: '#0f172a' });
  const start = plan.coords[0];
  const marker = new maplibregl.Marker({ element: truck }).setLngLat(start).addTo(map);

  const total = plan.cum[plan.cum.length - 1] || 1;
  const $ = id => card.querySelector(id);
  const state = { meters: 0, playing: false, last: 0, speed: 4, stepIdx: -1, lastCam: 0 };
  current = { map, card, marker, raf: 0, onKey: null, onDrag: null, plan, onClose };

  const setPlayIcon = () => {
    $('#rp-play').innerHTML = `${icon(state.playing ? 'pause' : 'play')} <span>${state.playing ? 'Pausar' : (state.meters >= total ? 'Repetir' : 'Reproducir')}</span>`;
  };

  function render(force = false) {
    const p = pointAt(plan.coords, plan.cum, state.meters);
    marker.setLngLat([p.lng, p.lat]);
    map.getSource('rp-done').setData(line([...plan.coords.slice(0, p.index + 1), [p.lng, p.lat]]));
    const idx = stepIndexAt(plan.steps, p.index);
    if (idx !== state.stepIdx || force) {
      state.stepIdx = idx;
      const st = plan.steps[idx];
      if (st) {
        map.getSource('rp-step').setData(line(plan.coords.slice(st.desde, st.hasta + 1)));
        $('#rp-now').innerHTML = `<span class="rp-badge ${st.tipo === 'trasladar' ? 'tr' : ''}">${st.tipo === 'trasladar' ? 'Traslado' : 'Recolectando'}</span> ${escapeHtml(st.texto)}`;
      }
      card.querySelectorAll('.rp-steps li').forEach(li => li.classList.toggle('active', Number(li.dataset.i) === idx));
      card.querySelector('.rp-steps li.active')?.scrollIntoView({ block: 'nearest' });
    }
    $('#rp-seek').value = String(Math.round(state.meters / total * SEEK_MAX));
    $('#rp-prog').textContent = `${fmtKm(state.meters)} de ${fmtKm(total)} · paso ${Math.max(0, idx) + 1} de ${plan.steps.length}`;
    if ($('#rp-follow').checked && performance.now() - state.lastCam > 120) {
      state.lastCam = performance.now();
      map.setCenter([p.lng, p.lat]);
    }
  }

  function frame(now) {
    if (!state.playing) return;
    const dt = Math.min(0.1, (now - state.last) / 1000);        // un salto de pestaña no debe teletransportar al camión
    state.last = now;
    state.meters = Math.min(total, state.meters + BASE_MPS * state.speed * dt);
    render();
    if (state.meters >= total) { state.playing = false; setPlayIcon(); return; }
    current.raf = requestAnimationFrame(frame);
  }

  function play() {
    if (state.meters >= total) state.meters = 0;
    state.playing = true;
    state.last = performance.now();
    setPlayIcon();
    current.raf = requestAnimationFrame(frame);
  }
  function pause() { state.playing = false; cancelAnimationFrame(current.raf); setPlayIcon(); }

  $('#rp-play').addEventListener('click', () => (state.playing ? pause() : play()));
  $('#rp-close').addEventListener('click', closeRoutePlayer);
  $('#rp-speed').addEventListener('change', e => { state.speed = Number(e.target.value); });
  $('#rp-seek').addEventListener('input', e => { state.meters = Number(e.target.value) / SEEK_MAX * total; render(true); setPlayIcon(); });
  card.querySelectorAll('.rp-steps li').forEach(li => {
    const go = () => { state.meters = plan.cum[plan.steps[Number(li.dataset.i)].desde] + 0.01; render(true); };
    li.addEventListener('click', go);
    li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
  $('#rp-print').addEventListener('click', () => printRoutePlan(plan, { title, subtitle, zone, color }));

  current.onKey = e => {
    if (e.key === 'Escape') closeRoutePlayer();
    else if (e.key === ' ' && document.activeElement?.tagName !== 'BUTTON' && document.activeElement?.tagName !== 'LI') { e.preventDefault(); state.playing ? pause() : play(); }
  };
  current.onDrag = () => { const f = $('#rp-follow'); if (f && f.checked) f.checked = false; };
  document.addEventListener('keydown', current.onKey);
  map.on('dragstart', current.onDrag);

  /* Encuadra toda la ruta al abrir y deja al camión en el inicio. */
  const b = new maplibregl.LngLatBounds(plan.coords[0], plan.coords[0]);
  plan.coords.forEach(c => b.extend(c));
  map.fitBounds(b, { padding: { top: 60, bottom: 60, left: 60, right: 420 }, duration: 500, maxZoom: 17 });
  state.stepIdx = -1;
  render(true);
  setPlayIcon();
  return { play, pause, seek: m => { state.meters = Math.max(0, Math.min(total, m)); render(true); } };
}
