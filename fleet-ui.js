/* ══════════════════════════════════════════════════════
   RUTALIMPIA — fleet-ui.js
   Formularios compartidos de flota.

   El botón "+ Nuevo camión" de la barra lateral existía en el Dashboard y en
   el Mapa en vivo pero no hacía nada (o solo mostraba un toast). El formulario
   real solo vivía dentro de page-9.html. Aquí se extrae ese formulario a un
   módulo reutilizable para que funcione desde cualquier página.
══════════════════════════════════════════════════════ */

import { insertVehicle } from './db.js';
import { icon } from './icons.js';

const MODAL_ID = 'shared-truck-modal';

const FIELDS = ['t-economic','t-plates','t-capacity','t-year','t-brand','t-model','t-notes'];

function buildModal() {
  const wrap = document.createElement('div');
  wrap.className = 'modal-overlay';
  wrap.id = MODAL_ID;
  wrap.innerHTML = `
  <div class="modal">
    <div class="modal-header">
      <span class="modal-title">${icon('truck')} Nuevo camión</span>
      <button class="modal-close" data-close="1">${icon('close')}</button>
    </div>
    <div class="modal-body">
      <div class="form-row">
        <div class="form-field">
          <label class="form-label" for="t-economic">Número económico *</label>
          <input class="form-input" id="t-economic" placeholder="Ej. VH-005"/>
        </div>
        <div class="form-field">
          <label class="form-label" for="t-plates">Placas *</label>
          <input class="form-input" id="t-plates" placeholder="Ej. ABC-123-D"/>
        </div>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label class="form-label" for="t-type">Tipo</label>
          <select class="form-select" id="t-type">
            <option value="compactor">Compactador</option>
            <option value="simple">Simple</option>
          </select>
        </div>
        <div class="form-field">
          <label class="form-label" for="t-status">Estado</label>
          <select class="form-select" id="t-status">
            <option value="active">Activo</option>
            <option value="maintenance">Mantenimiento</option>
            <option value="inactive">Inactivo</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label class="form-label" for="t-capacity">Capacidad (ton) *</label>
          <input class="form-input" id="t-capacity" type="number" step="0.5" min="0" placeholder="10"/>
        </div>
        <div class="form-field">
          <label class="form-label" for="t-year">Año</label>
          <input class="form-input" id="t-year" type="number" min="1980" max="2100" placeholder="2020"/>
        </div>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label class="form-label" for="t-brand">Marca</label>
          <input class="form-input" id="t-brand" placeholder="Ej. International"/>
        </div>
        <div class="form-field">
          <label class="form-label" for="t-model">Modelo</label>
          <input class="form-input" id="t-model" placeholder="Ej. 7400"/>
        </div>
      </div>
      <div class="form-field">
        <label class="form-label" for="t-notes">Notas</label>
        <input class="form-input" id="t-notes" placeholder="Observaciones del vehículo"/>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-cancel" data-close="1">Cancelar</button>
      <button class="btn-new" data-save="1">Guardar camión</button>
    </div>
  </div>`;
  document.body.appendChild(wrap);
  return wrap;
}

/**
 * Monta (una sola vez) el modal de alta de camión y devuelve la función que lo abre.
 * @param {{ onCreated?: (vehicle:any) => void }} [options]
 * @returns {() => void} abrir el modal
 */
export function mountNewTruckModal(options = {}) {
  const existing = document.getElementById(MODAL_ID);
  const modal = existing || buildModal();
  const $ = id => modal.querySelector('#' + id);

  const close = () => modal.classList.remove('open');
  const open  = () => {
    FIELDS.forEach(id => { const el = $(id); if (el) el.value = ''; });
    $('t-type').value = 'compactor';
    $('t-status').value = 'active';
    modal.classList.add('open');
    $('t-economic').focus();
  };

  if (!existing) {
    modal.addEventListener('click', e => {
      if (e.target === modal || e.target.dataset.close) close();
      if (e.target.dataset.save) save(e.target);
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && modal.classList.contains('open')) close();
    });
  }

  async function save(btn) {
    const economic = $('t-economic').value.trim();
    const plates   = $('t-plates').value.trim();
    const capacity = $('t-capacity').value;

    if (!economic) { showToast('El número económico es obligatorio', 'warn');; $('t-economic').focus(); return; }
    if (!plates)   { showToast('Las placas son obligatorias', 'warn');;        $('t-plates').focus();   return; }
    if (!capacity) { showToast('La capacidad es obligatoria', 'warn');;        $('t-capacity').focus(); return; }

    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Guardando…';
    try {
      const vehicle = await insertVehicle({
        economic_number: economic,
        plates,
        type:          $('t-type').value,
        status:        $('t-status').value,
        capacity_tons: Number(capacity),
        year:          $('t-year').value ? Number($('t-year').value) : null,
        brand:         $('t-brand').value.trim() || null,
        model:         $('t-model').value.trim() || null,
        notes:         $('t-notes').value.trim() || null,
      });
      close();
      showToast('Camión registrado', 'success');;
      options.onCreated?.(vehicle);
    } catch (err) {
      console.error('[insertVehicle]', err);
      const msg = /duplicate|unique/i.test(err.message || '')
        ? 'Ya existe un camión con ese número económico o placas'
        : (err.message || 'No se pudo guardar');
      showToast('' + msg);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  return open;
}

/** Escapa texto que viene de la base de datos antes de interpolarlo en HTML. */
export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
