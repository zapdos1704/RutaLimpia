/* ══════════════════════════════════════════════════════
   admin-tools.js
   Herramientas de administración del Mapa en vivo (sólo administradores; la base de datos
   lo vuelve a comprobar en cada escritura):
     · Tiraderos: círculo o polígono dibujado en el mapa. Cuando un camión entra a uno, el
       sistema lo da por «vaciando» y pausa la hora estimada de los ciudadanos.
     · Horarios: días y horas de recolección por ruta (los generales aplican a todas).
   La lógica y las validaciones están en dump-sites.js, schedules.js y db-errors.js (con pruebas).
   ══════════════════════════════════════════════════════ */

import {
  getDumpSites, saveDumpSite, deleteDumpSite, getPickupSchedules, savePickupSchedule, deletePickupSchedule, getRoutes,
} from './db.js?v=426c553c';
import { icon } from './icons.js?v=426c553c';
import { escapeHtml } from './fleet-ui.js?v=426c553c';
import { friendlyDbError } from './db-errors.js?v=426c553c';
import {
  RADIUS_DEFAULT, RADIUS_MAX, RADIUS_MIN, buildSavePayload, circleRing, describeSite, ringAreaM2, shapeOf,
  siteCenter, siteRing, sitesToFeatureCollection,
} from './dump-sites.js?v=426c553c';
import {
  DAY_LABEL, GENERAL, WASTE_LABEL, buildSchedulePayload, countByRoute, describeSchedule, schedulesFor,
} from './schedules.js?v=426c553c';
import { closeRing } from './geo.js?v=426c553c';

const toast = (msg, type = 'info') => window.showToast?.(msg, type);

const CSS = `
#dumps-panel {
  position: absolute; top: 0; right: 0; bottom: 0; width: 320px; z-index: 22;
  background: var(--bg-sidebar); border-left: 1px solid var(--border);
  display: flex; flex-direction: column;
  transform: translateX(100%); transition: transform .3s cubic-bezier(.4,0,.2,1);
}
#dumps-panel.open { transform: translateX(0); }
.at-body { flex: 1; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
.at-note { font-size: 10px; color: var(--text-2); line-height: 1.5; }
.at-item { display: flex; align-items: center; gap: 8px; padding: 9px 10px; border-radius: 8px; background: rgba(255,255,255,.05); border: 1px solid transparent; }
.at-item.selected { border-color: rgba(245,158,11,.6); }
.at-item-main { flex: 1; min-width: 0; }
.at-item-name { font-size: 12px; font-weight: 700; overflow-wrap: anywhere; }
.at-item-sub { font-size: 10px; color: var(--text-2); margin-top: 2px; }
.at-item-btns { display: flex; gap: 4px; flex-shrink: 0; }
.at-mini { font: inherit; font-size: 10px; font-weight: 600; color: var(--text-1); background: rgba(255,255,255,.08); border: 1px solid var(--border); border-radius: 6px; padding: 4px 8px; cursor: pointer; }
.at-mini:hover { background: rgba(255,255,255,.16); }
.at-mini.danger:hover { background: rgba(239,68,68,.25); border-color: rgba(239,68,68,.5); }
.at-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.at-hint { font-size: 10px; color: var(--text-2); line-height: 1.4; }
.at-error { display: none; font-size: 11px; color: #fca5a5; background: rgba(239,68,68,.12); border: 1px solid rgba(239,68,68,.35); border-radius: 8px; padding: 8px 10px; line-height: 1.4; }
.at-error.show { display: block; }
.at-foot { display: flex; gap: 8px; justify-content: flex-end; padding: 10px 14px; border-top: 1px solid var(--border); flex-shrink: 0; }
.at-check { display: flex; align-items: center; gap: 7px; font-size: 11px; color: var(--text-1); }
.at-empty { text-align: center; color: var(--text-2); font-size: 11px; padding: 18px 8px; line-height: 1.5; }
.sc-table { width: 100%; border-collapse: collapse; }
.sc-table th { font-size: 9px; color: var(--text-2); font-weight: 600; text-transform: uppercase; letter-spacing: .4px; padding: 6px 8px; border-bottom: 1px solid var(--border); text-align: left; }
.sc-table td { font-size: 11px; padding: 7px 8px; border-bottom: 1px solid rgba(255,255,255,.04); vertical-align: middle; }
.sc-table tr.off td { opacity: .5; }
.sc-scroll { max-height: 220px; overflow-y: auto; border: 1px solid var(--border); border-radius: 8px; }
@media (max-width: 768px) {
  #dumps-panel { width: 100%; top: auto; height: min(70vh, 100%); border-left: none; border-top: 1px solid var(--border); border-radius: 20px 20px 0 0; transform: translateY(100%); }
  #dumps-panel.open { transform: translateY(0); }
}
`;

function injectCss() {
  if (document.getElementById('admin-tools-css')) return;
  const style = document.createElement('style');
  style.id = 'admin-tools-css';
  style.textContent = CSS;
  document.head.appendChild(style);
}

function addAction(actions, id, iconName, label) {
  const btn = document.createElement('button');
  btn.className = 'btn-secondary';
  btn.id = id;
  btn.type = 'button';
  btn.innerHTML = `${icon(iconName, { size: 13, color: 'currentColor' })} ${label}`;
  actions.appendChild(btn);
  return btn;
}

/* ══════════════════════════════════════════════════════
   TIRADEROS
   ══════════════════════════════════════════════════════ */
export function mountDumpSites({ map, stage, actions }) {
  injectCss();
  const button = addAction(actions, 'btn-dumps', 'place', 'Tiraderos');
  const panel = document.createElement('div');
  panel.id = 'dumps-panel';
  stage.appendChild(panel);

  let sites = [];
  let loadError = '';
  let selectedId = null;
  let editing = null;          // formulario en curso (null = se ve la lista)
  let drawing = null;          // 'center' | 'ring' | null
  let clickBound = false;
  let formError = '';

  /* ── Capas del mapa ── */
  const EMPTY = { type: 'FeatureCollection', features: [] };
  function ensureLayers() {
    if (map.getSource('dump-sites')) return;
    map.addSource('dump-sites', { type: 'geojson', data: EMPTY });
    map.addSource('dump-draft', { type: 'geojson', data: EMPTY });
    const colour = ['case', ['get', 'active'], '#f59e0b', '#64748b'];
    map.addLayer({ id: 'dump-sites-fill', type: 'fill', source: 'dump-sites', paint: { 'fill-color': colour, 'fill-opacity': 0.22 } });
    map.addLayer({ id: 'dump-sites-line', type: 'line', source: 'dump-sites', paint: { 'line-color': colour, 'line-width': ['case', ['get', 'selected'], 3.5, 2] } });
    map.addLayer({ id: 'dump-draft-fill', type: 'fill', source: 'dump-draft', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#22c55e', 'fill-opacity': 0.2 } });
    map.addLayer({ id: 'dump-draft-line', type: 'line', source: 'dump-draft', filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': '#22c55e', 'line-width': 2.5, 'line-dasharray': [2, 1.5] } });
    map.addLayer({ id: 'dump-draft-pts', type: 'circle', source: 'dump-draft', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 5, 'circle-color': '#22c55e', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
  }

  function draftCollection() {
    if (!editing) return EMPTY;
    const features = [];
    const poly = ring => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } });
    const pt = p => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } });
    if (editing.shape === 'circle') {
      if (editing.center) {
        const r = Number(String(editing.radius).replace(',', '.'));
        if (Number.isFinite(r) && r > 0) features.push(poly(circleRing(editing.center, Math.min(r, 5000))));
        features.push(pt(editing.center));
      }
    } else {
      editing.ring.forEach(p => features.push(pt(p)));
      if (editing.ring.length >= 3) features.push(poly(closeRing(editing.ring)));
      else if (editing.ring.length === 2) features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: editing.ring } });
    }
    return { type: 'FeatureCollection', features };
  }

  function paintMap() {
    if (!map.getSource('dump-sites')) return;
    const visible = panel.classList.contains('open') ? sites.filter(s => s.id !== editing?.id) : [];
    map.getSource('dump-sites').setData(sitesToFeatureCollection(visible, selectedId));
    map.getSource('dump-draft').setData(panel.classList.contains('open') ? draftCollection() : EMPTY);
  }

  /* ── Dibujo con clics ── */
  function onMapClick(e) {
    if (!editing || !drawing) return;
    const p = [e.lngLat.lng, e.lngLat.lat];
    if (drawing === 'center') {
      editing.center = p;
      setDrawing(null);
      renderPanel();
    } else if (drawing === 'ring') {
      const last = editing.ring[editing.ring.length - 1];
      if (last) {   // un doble clic dispara dos clics casi idénticos: el segundo se ignora
        const a = map.project(last);
        if (Math.hypot(a.x - e.point.x, a.y - e.point.y) < 5) return;
      }
      editing.ring.push(p);
      updateHint();
    }
    paintMap();
  }

  function setDrawing(mode) {
    drawing = mode;
    map.getCanvas().style.cursor = mode ? 'crosshair' : '';
    if (mode && !clickBound) { map.on('click', onMapClick); map.doubleClickZoom.disable(); clickBound = true; }
    if (!mode && clickBound) { map.off('click', onMapClick); map.doubleClickZoom.enable(); clickBound = false; }
  }

  /* ── Panel ── */
  const $ = sel => panel.querySelector(sel);

  function header() {
    return `<div class="ep-header">
      <span class="ep-title">${icon('place')} Tiraderos</span>
      <button class="vp-close" data-act="close" aria-label="Cerrar">${icon('close')}</button>
    </div>`;
  }

  function listView() {
    const items = sites.map(s => `
      <div class="at-item ${s.id === selectedId ? 'selected' : ''}">
        <div class="at-item-main">
          <div class="at-item-name">${escapeHtml(s.name)}</div>
          <div class="at-item-sub">${escapeHtml(describeSite(s))} · ${s.is_active ? 'Activo' : 'Inactivo'}</div>
        </div>
        <div class="at-item-btns">
          <button class="at-mini" data-act="view" data-id="${s.id}">Ver</button>
          <button class="at-mini" data-act="edit" data-id="${s.id}">Editar</button>
          <button class="at-mini danger" data-act="delete" data-id="${s.id}">Borrar</button>
        </div>
      </div>`).join('');
    const body = loadError
      ? `<div class="at-error show">${escapeHtml(loadError)}</div>`
      : items || `<div class="at-empty">Aún no hay tiraderos.<br>Sin ellos el sistema no sabe cuándo un camión va a vaciar.</div>`;
    return `${header()}
      <div class="at-body">
        <div class="at-note">Cuando un camión entra a un tiradero (y se queda unos segundos) se marca «Vaciando» y la hora estimada de los ciudadanos se pausa hasta que vuelve a la ruta.</div>
        ${body}
      </div>
      <div class="at-foot"><button class="btn-primary" data-act="add" ${loadError ? 'disabled' : ''}>+ Agregar tiradero</button></div>`;
  }

  function editorView() {
    const e = editing;
    const circle = e.shape === 'circle';
    const shapeControls = circle
      ? `<div class="form-field">
           <label class="form-label" for="at-radius">Radio (metros, ${RADIUS_MIN}–${RADIUS_MAX})</label>
           <input class="form-input" id="at-radius" data-f="radius" inputmode="numeric" autocomplete="off" value="${escapeHtml(e.radius)}"/>
         </div>
         <div class="at-row">
           <button class="at-mini" data-act="pick-center">${e.center ? 'Mover el centro' : 'Colocar el centro en el mapa'}</button>
           <span class="at-hint" id="at-hint"></span>
         </div>`
      : `<div class="at-row">
           <button class="at-mini" data-act="draw-ring">${e.ring.length ? 'Dibujar de nuevo' : 'Dibujar en el mapa'}</button>
           <button class="at-mini" data-act="undo" ${drawing === 'ring' ? '' : 'hidden'}>Deshacer</button>
           <button class="at-mini" data-act="finish" ${drawing === 'ring' ? '' : 'hidden'}>Terminar</button>
         </div>
         <span class="at-hint" id="at-hint"></span>`;
    return `${header()}
      <div class="at-body">
        <div class="form-field">
          <label class="form-label" for="at-name">Nombre</label>
          <input class="form-input" id="at-name" data-f="name" autocomplete="off" maxlength="80" placeholder="Ej. Relleno sanitario" value="${escapeHtml(e.name)}"/>
        </div>
        <div class="form-field">
          <label class="form-label" for="at-shape">Forma</label>
          <select class="form-select" id="at-shape" data-f="shape">
            <option value="circle" ${circle ? 'selected' : ''}>Círculo (centro y radio)</option>
            <option value="polygon" ${circle ? '' : 'selected'}>Polígono (dibujar el contorno)</option>
          </select>
        </div>
        ${shapeControls}
        <label class="at-check"><input type="checkbox" data-f="active" ${e.active ? 'checked' : ''}/> Activo (el sistema lo usa para detectar vaciados)</label>
        <div class="at-error ${formError ? 'show' : ''}" id="at-error">${escapeHtml(formError)}</div>
      </div>
      <div class="at-foot">
        <button class="btn-cancel" data-act="cancel">Cancelar</button>
        <button class="btn-new" data-act="save">Guardar</button>
      </div>`;
  }

  function updateHint() {
    const el = $('#at-hint');
    if (!el || !editing) return;
    if (editing.shape === 'circle') {
      el.textContent = drawing === 'center' ? 'Haz clic en el mapa donde está el tiradero.'
        : editing.center ? `Centro: ${editing.center[1].toFixed(5)}, ${editing.center[0].toFixed(5)}` : 'Aún sin centro.';
    } else {
      const n = editing.ring.length;
      const m2 = n >= 3 ? Math.round(ringAreaM2(editing.ring)) : 0;
      el.textContent = drawing === 'ring'
        ? (n < 3 ? `Haz clic en cada esquina del tiradero (${n} de 3 como mínimo).` : `${n} puntos · ${m2} m² · «Terminar» cuando cierres la zona.`)
        : (n ? `${n} puntos · ${m2} m²` : 'Aún sin contorno.');
    }
  }

  function renderPanel() {
    panel.innerHTML = editing ? editorView() : listView();
    updateHint();
  }

  async function refresh() {
    loadError = '';
    try {
      sites = await getDumpSites();
    } catch (err) {
      console.error('[dump_sites]', err);
      sites = [];
      loadError = friendlyDbError(err, 'No se pudieron cargar los tiraderos.');
    }
    renderPanel();
    paintMap();
  }

  function startEdit(row) {
    formError = '';
    if (!row) {
      editing = { id: null, name: '', shape: 'circle', center: null, radius: String(RADIUS_DEFAULT), ring: [], active: true };
    } else {
      const ring = shapeOf(row) === 'polygon' ? (siteRing(row) || []).slice(0, -1) : [];
      editing = {
        id: row.id, name: row.name, shape: shapeOf(row), center: shapeOf(row) === 'circle' ? siteCenter(row) : null,
        radius: String(row.radius_m ?? RADIUS_DEFAULT), ring, active: row.is_active !== false,
      };
    }
    renderPanel();
    paintMap();
    $('#at-name')?.focus();
  }

  function stopEdit() {
    setDrawing(null);
    editing = null;
    formError = '';
    renderPanel();
    paintMap();
  }

  async function save(btn) {
    const built = buildSavePayload(editing);
    if (!built.ok) { formError = built.error; $('#at-error').textContent = formError; $('#at-error').classList.add('show'); return; }
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Guardando…';
    try {
      const id = await saveDumpSite(built.args);
      toast('Tiradero guardado', 'success');
      selectedId = id;
      setDrawing(null);
      editing = null;
      formError = '';
      await refresh();
    } catch (err) {
      console.error('[saveDumpSite]', err);
      formError = friendlyDbError(err);
      const box = $('#at-error');
      if (box) { box.textContent = formError; box.classList.add('show'); }
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  async function remove(id) {
    const row = sites.find(s => s.id === id);
    if (!row || !window.confirm(`¿Borrar el tiradero «${row.name}»?\n\nEl sistema dejará de detectar vaciados ahí.`)) return;
    try {
      await deleteDumpSite(id);
      toast('Tiradero borrado', 'success');
      if (selectedId === id) selectedId = null;
      await refresh();
    } catch (err) {
      console.error('[deleteDumpSite]', err);
      toast(friendlyDbError(err, 'No se pudo borrar.'), 'error');
    }
  }

  panel.addEventListener('click', ev => {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    const id = b.dataset.id;
    switch (b.dataset.act) {
      case 'close': close(); break;
      case 'add': startEdit(null); break;
      case 'edit': startEdit(sites.find(s => s.id === id)); break;
      case 'delete': remove(id); break;
      case 'view': {
        const row = sites.find(s => s.id === id);
        selectedId = id;
        const c = row && siteCenter(row);
        if (c) map.flyTo({ center: c, zoom: 16 });
        renderPanel(); paintMap();
        break;
      }
      case 'cancel': stopEdit(); break;
      case 'save': save(b); break;
      case 'pick-center': setDrawing('center'); formError = ''; updateHint(); break;
      case 'draw-ring':
        editing.ring = []; formError = '';
        setDrawing('ring');
        renderPanel(); paintMap();
        break;
      case 'undo': editing.ring.pop(); updateHint(); paintMap(); break;
      case 'finish':
        setDrawing(null);
        renderPanel(); paintMap();
        break;
    }
  });

  panel.addEventListener('input', ev => {
    const f = ev.target.dataset?.f;
    if (!f || !editing) return;
    if (f === 'name' || f === 'radius') { editing[f] = ev.target.value; if (f === 'radius') paintMap(); }
  });
  panel.addEventListener('change', ev => {
    const f = ev.target.dataset?.f;
    if (!f || !editing) return;
    if (f === 'active') editing.active = ev.target.checked;
    if (f === 'shape') { setDrawing(null); editing.shape = ev.target.value; formError = ''; renderPanel(); paintMap(); }
  });

  /* ── Abrir / cerrar ── */
  function open() {
    if (!map.isStyleLoaded()) { toast('El mapa aún está cargando; intenta de nuevo en un momento', 'warn'); return; }
    window.closeEventsPanel?.();
    document.getElementById('vehicle-panel')?.classList.remove('open');
    ensureLayers();
    panel.classList.add('open');
    button.classList.add('active');
    editing = null;
    renderPanel();
    refresh();
  }
  function close() {
    setDrawing(null);
    editing = null;
    panel.classList.remove('open');
    button.classList.remove('active');
    paintMap();
  }
  button.addEventListener('click', () => (panel.classList.contains('open') ? close() : open()));
  // Al abrir el panel de eventos se cierra este, para que no se encimen.
  document.getElementById('btn-events')?.addEventListener('click', () => { if (panel.classList.contains('open')) close(); });

  return { open, close };
}

/* ══════════════════════════════════════════════════════
   HORARIOS DE RECOLECCIÓN POR RUTA
   ══════════════════════════════════════════════════════ */
export function mountSchedules({ actions }) {
  injectCss();
  const button = addAction(actions, 'btn-schedules', 'assignment', 'Horarios');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'schedules-modal';
  overlay.innerHTML = `
    <div class="modal" style="width:min(700px,94vw)">
      <div class="modal-header">
        <span class="modal-title">${icon('assignment')} Horarios de recolección</span>
        <button class="modal-close" data-act="close" aria-label="Cerrar">${icon('close')}</button>
      </div>
      <div class="modal-body" id="sc-body"></div>
    </div>`;
  document.body.appendChild(overlay);
  const body = overlay.querySelector('#sc-body');

  let rows = [];
  let routes = [];
  let routeKey = GENERAL;
  let editingId = null;
  let loadError = '';

  const routeName = key => (key === GENERAL ? 'Todas las rutas (generales)' : routes.find(r => r.id === key)?.name || 'Ruta');

  function render() {
    if (loadError) { body.innerHTML = `<div class="at-error show">${escapeHtml(loadError)}</div>`; return; }
    const counts = countByRoute(rows);
    const options = [{ id: GENERAL, name: 'Todas las rutas (generales)' }, ...routes]
      .map(r => `<option value="${r.id}" ${r.id === routeKey ? 'selected' : ''}>${escapeHtml(r.name)} (${counts[r.id] || 0})</option>`).join('');
    const list = schedulesFor(rows, routeKey);
    const editRow = editingId ? rows.find(r => r.id === editingId) : null;
    const trs = list.map(r => `
      <tr class="${r.active ? '' : 'off'}">
        <td>${escapeHtml(DAY_LABEL[r.day_of_week] || '—')}</td>
        <td>${escapeHtml(String(r.time).slice(0, 5))}</td>
        <td>${escapeHtml(WASTE_LABEL[r.waste_type] || r.waste_type)}</td>
        <td>${escapeHtml(r.zone_label || '')}</td>
        <td>${r.active ? 'Activo' : 'Inactivo'}</td>
        <td style="white-space:nowrap">
          <button class="at-mini" data-act="edit" data-id="${r.id}">Editar</button>
          <button class="at-mini danger" data-act="delete" data-id="${r.id}">Borrar</button>
        </td>
      </tr>`).join('');
    const days = Object.entries(DAY_LABEL).map(([n, l]) => `<option value="${n}" ${editRow && String(editRow.day_of_week) === n ? 'selected' : ''}>${l}</option>`).join('');
    const wastes = Object.entries(WASTE_LABEL).map(([k, l]) => `<option value="${k}" ${editRow && editRow.waste_type === k ? 'selected' : ''}>${l}</option>`).join('');

    body.innerHTML = `
      <div class="form-field">
        <label class="form-label" for="sc-route">Ruta</label>
        <select class="form-select" id="sc-route">${options}</select>
      </div>
      <div class="at-note">${routeKey === GENERAL
        ? 'Los horarios generales los ven los ciudadanos de TODAS las rutas.'
        : 'Los ciudadanos de esta ruta ven estos horarios y, además, los generales.'}</div>
      <div class="sc-scroll"><table class="sc-table">
        <thead><tr><th>Día</th><th>Hora</th><th>Residuo</th><th>Zona</th><th>Estado</th><th></th></tr></thead>
        <tbody>${trs || `<tr><td colspan="6" class="at-empty">Sin horarios para «${escapeHtml(routeName(routeKey))}».</td></tr>`}</tbody>
      </table></div>
      <div class="at-note" style="margin-top:4px"><b>${editRow ? 'Editar horario' : 'Agregar horario'}</b>${editRow ? ` · ${escapeHtml(describeSchedule(editRow))}` : ''}</div>
      <div class="form-row">
        <div class="form-field"><label class="form-label" for="sc-day">Día</label><select class="form-select" id="sc-day">${days}</select></div>
        <div class="form-field"><label class="form-label" for="sc-time">Hora</label><input class="form-input" id="sc-time" type="time" value="${editRow ? escapeHtml(String(editRow.time).slice(0, 5)) : '07:00'}"/></div>
        <div class="form-field"><label class="form-label" for="sc-waste">Residuo</label><select class="form-select" id="sc-waste">${wastes}</select></div>
      </div>
      <div class="form-row">
        <div class="form-field"><label class="form-label" for="sc-zone">Zona (opcional)</label><input class="form-input" id="sc-zone" maxlength="80" placeholder="Ej. Colonia Centro" value="${editRow ? escapeHtml(editRow.zone_label || '') : ''}"/></div>
        <div class="form-field" style="justify-content:flex-end"><label class="at-check"><input type="checkbox" id="sc-active" ${!editRow || editRow.active ? 'checked' : ''}/> Activo</label></div>
      </div>
      <div class="at-error" id="sc-error"></div>
      <div class="at-row" style="justify-content:flex-end;margin-top:6px">
        ${editRow ? '<button class="btn-cancel" data-act="cancel-edit">Cancelar edición</button>' : ''}
        <button class="btn-new" data-act="save">${editRow ? 'Guardar cambios' : 'Agregar horario'}</button>
      </div>`;
  }

  async function load() {
    loadError = '';
    try {
      [rows, routes] = await Promise.all([getPickupSchedules(), getRoutes()]);
    } catch (err) {
      console.error('[pickup_schedules]', err);
      loadError = friendlyDbError(err, 'No se pudieron cargar los horarios.');
    }
    render();
  }

  const showError = msg => { const b = body.querySelector('#sc-error'); if (b) { b.textContent = msg; b.classList.toggle('show', !!msg); } };

  async function save(btn) {
    const built = buildSchedulePayload({
      id: editingId, day: body.querySelector('#sc-day').value, time: body.querySelector('#sc-time').value,
      waste: body.querySelector('#sc-waste').value, routeId: routeKey, zone: body.querySelector('#sc-zone').value,
      active: body.querySelector('#sc-active').checked,
    });
    if (!built.ok) { showError(built.error); return; }
    btn.disabled = true;
    try {
      await savePickupSchedule(built.args);
      toast(editingId ? 'Horario actualizado' : 'Horario agregado', 'success');
      editingId = null;
      await load();
    } catch (err) {
      console.error('[savePickupSchedule]', err);
      showError(friendlyDbError(err));
      btn.disabled = false;
    }
  }

  async function remove(id) {
    const row = rows.find(r => r.id === id);
    if (!row || !window.confirm(`¿Borrar el horario ${describeSchedule(row)}?`)) return;
    try {
      await deletePickupSchedule(id);
      toast('Horario borrado', 'success');
      if (editingId === id) editingId = null;
      await load();
    } catch (err) {
      console.error('[deletePickupSchedule]', err);
      toast(friendlyDbError(err, 'No se pudo borrar.'), 'error');
    }
  }

  overlay.addEventListener('click', ev => {
    if (ev.target === overlay) return close();
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    switch (b.dataset.act) {
      case 'close': close(); break;
      case 'edit': editingId = b.dataset.id; render(); break;
      case 'cancel-edit': editingId = null; render(); break;
      case 'delete': remove(b.dataset.id); break;
      case 'save': save(b); break;
    }
  });
  overlay.addEventListener('change', ev => {
    if (ev.target.id === 'sc-route') { routeKey = ev.target.value; editingId = null; render(); }
  });

  function open() {
    overlay.classList.add('open');
    body.innerHTML = '<div class="at-empty">Cargando…</div>';
    load();
  }
  function close() { overlay.classList.remove('open'); editingId = null; }
  button.addEventListener('click', open);
  return { open, close };
}
