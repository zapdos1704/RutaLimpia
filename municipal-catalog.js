import { sb } from './db.js?v=ffdd6c4b';
import { escapeHtml } from './fleet-ui.js?v=ffdd6c4b';

const service = { public: 'Público general', commercial: 'Comercial' };
const areas = { urban: 'Urbana', rural: 'Rural' };
const esc = value => escapeHtml(String(value ?? ''));
const option = (value, label, selected) => `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`;
const choices = (items, value) => Object.entries(items).map(([k, v]) => option(k, v, value)).join('');
const field = (label, control) => `<label class="form-field">${label}${control}</label>`;

export function mountMunicipalCatalog({ profile, vehicles, reload, showRoute, redraw }) {
  const dialog = document.getElementById('municipal-catalog');
  const body = dialog.querySelector('[data-body]');
  const status = dialog.querySelector('[role=status]');
  let rows = [], devices = [], staff = [], editing = false, sequence = 0;
  const truckName = id => vehicles().find(v => v.id === id)?.economic_number || 'Sin camión';
  const memberName = id => staff.find(m => m.user_id === id)?.users?.name || (id ? 'Personal municipal' : 'Por asignar');

  async function refresh() {
    const n = ++sequence;
    const results = await Promise.all([
      sb.from('municipal_route_plans').select('*').eq('is_active', true).order('name'),
      sb.from('municipal_device_monitor').select('*').order('device_key'),
      sb.from('municipal_members').select('user_id,users(name)').order('user_id')
    ]);
    if (!dialog.open || editing || n !== sequence) return;
    const failed = results.find(r => r.error);
    if (failed) { body.replaceChildren(); status.textContent = 'No se pudo cargar el catálogo. ' + failed.error.message; return; }
    [rows, devices, staff] = results.map(r => r.data);
    status.textContent = '';
    render();
  }

  function render() {
    editing = false;
    const sections = Object.entries({ ...areas, unknown: 'Zona por clasificar' }).map(([key, name]) => {
      const group = rows.filter(r => (r.area_kind || 'unknown') === key);
      if (!group.length) return '';
      return `<section><h3>${name}</h3>${group.map(r => `<article><b>${esc(r.name)}</b>
        <p>${service[r.service_kind] || 'Servicio por clasificar'} · ${esc(memberName(r.author_id))} · ${esc(truckName(r.vehicle_id))}</p>
        ${r.route_geojson ? button('view', r.id, 'Ver recorrido') : ''}
        ${r.can_edit ? button('edit',r.id,'Editar datos') + button('redraw',r.id,'Redibujar') + button('archive',r.id,'Dar de baja') : ''}</article>`).join('')}</section>`;
    }).join('');
    const inventory = devices.map(d => {
      const names = d.detected_routes || [];
      const current = !d.seen_at || Math.abs(Date.now()-Date.parse(d.seen_at)) > 180000 ? 'Sin señal reciente'
        : names.length === 0 ? 'Fuera de ruta' : names.length === 1 ? names[0] : 'Coinciden varias rutas: ' + names.join(', ');
      const assigned = rows.filter(r => d.vehicle_id && r.vehicle_id === d.vehicle_id).map(r => r.name).join(', ') || 'Sin ruta programada';
      return `<article><b>${esc(d.device_type)} · ${esc(d.model)}</b><p>ID ${esc(d.device_key)} · Camión registrado: ${esc(truckName(d.vehicle_id))}</p>
        <p>Programada: ${esc(assigned)}<br>GPS: ${esc(current)} · Camión reportado: ${esc(truckName(d.reported_vehicle))}</p>
        ${profile.admin ? button('device',d.device_key,'Editar dispositivo') + button('remove',d.device_key,'Retirar dispositivo') : ''}</article>`;
    }).join('');
    body.innerHTML = (sections || '<p>Sin rutas activas en este municipio.</p>') +
      '<section><h3>Dispositivos</h3>' + (profile.admin ? button('new-device','','Registrar dispositivo') : '') +
      (inventory || '<p>Sin dispositivos registrados.</p>') + '</section>';
  }
  function button(action, id, label) {
    return `<button type="button" class="btn-secondary" data-action="${action}" data-id="${esc(id)}">${label}</button>`;
  }
  function form(html, submit) {
    editing = true;
    ++sequence;
    body.innerHTML = `<form>${html}<footer><button type="submit" class="btn-primary">Guardar</button> ${button('back','','Cancelar')}</footer></form>`;
    const f = body.querySelector('form');
    f.onsubmit = async e => {
      e.preventDefault();
      const btn = f.querySelector('[type=submit]');
      btn.disabled = true;
      try { await submit(Object.fromEntries(new FormData(f))); await done(); }
      catch (error) { status.textContent = error.message; btn.disabled = false; }
    };
  }
  async function done() { editing=false; await refresh(); await reload(); }
  async function checked(query) { const { error } = await query.select().single(); if (error) throw error; }
  function editRoute(r) {
    form('<h3>Editar ruta</h3>' + field('Nombre', `<input class="form-input" name="name" required maxlength="160" value="${esc(r.name)}">`) +
      field('Descripción', `<textarea class="form-input" name="description">${esc(r.description)}</textarea>`) +
      field('Servicio', `<select name="service_kind" required>${option('','Selecciona',r.service_kind || '')}${choices(service,r.service_kind)}</select>`) +
      field('Zona', `<select name="area_kind" required>${option('','Selecciona',r.area_kind || '')}${choices(areas,r.area_kind)}</select>`) +
      (profile.admin ? field('Autor', `<select name="author_id">${option('','Por asignar',r.author_id || '')}${staff.map(m=>option(m.user_id,memberName(m.user_id),r.author_id)).join('')}</select>`) : ''),
      async values => {
        values.name = values.name.trim();
        if (!values.name) throw Error('Escribe un nombre para la ruta.');
        if ('author_id' in values) values.author_id ||= null;
        await checked(sb.from('routes').update(values).eq('id',r.id).eq('updated_at',r.updated_at));
      });
  }
  function editDevice(d) {
    const input = (name, value, max, extra='') => `<input name="${name}" class="form-input" value="${esc(value)}" required maxlength="${max}" ${extra}>`;
    form('<h3>Dispositivo GPS</h3>' + field('ID que reporta el equipo',input('device_key',d?.device_key,100,d ? 'readonly' : '')) +
      field('Tipo de dispositivo',input('device_type',d?.device_type,80)) + field('Modelo del dispositivo',input('model',d?.model,100)) +
      field('Camión registrado', `<select name="vehicle_id">${option('','Sin asignar',d?.vehicle_id || '')}${vehicles().map(v=>option(v.id,v.economic_number,d?.vehicle_id)).join('')}</select>`),
      async values => {
        for (const k of ['device_key','device_type','model']) values[k]=values[k].trim();
        values.vehicle_id ||= null;
        await checked(d ? sb.from('municipal_devices').update({device_type:values.device_type,model:values.model,vehicle_id:values.vehicle_id}).eq('device_key',d.device_key) : sb.from('municipal_devices').insert(values));
      });
  }
  body.onclick = async e => {
    const b = e.target.closest('button[data-action]'); if (!b) return;
    const { action, id } = b.dataset; status.textContent='';
    const r = rows.find(row=>row.id===id), d = devices.find(row=>row.device_key===id);
    try {
      if (action==='back') { editing=false; await refresh(); }
      if (action==='view' && r) { dialog.close(); await showRoute(id); }
      if (action==='edit' && r?.can_edit) editRoute(r);
      if (action==='redraw' && r?.can_edit) { dialog.close(); redraw(r); }
      if (action==='archive' && r?.can_edit && confirm('¿Dar de baja la ruta '+r.name+' y conservar su historial?')) {
        await checked(sb.from('routes').update({is_active:false}).eq('id',id).eq('updated_at',r.updated_at)); await done();
      }
      if (profile.admin && (action==='device' || action==='new-device')) editDevice(d);
      if (profile.admin && action==='remove' && d && confirm('¿Retirar el dispositivo '+d.device_key+' del monitoreo?')) {
        await checked(sb.from('municipal_devices').delete().eq('device_key',d.device_key)); await done();
      }
    } catch (error) { status.textContent = error.message; }
  };
  document.getElementById('btn-catalog').onclick = () => { editing=false; dialog.showModal(); body.replaceChildren(); status.textContent='Cargando…'; refresh().catch(e=>status.textContent=e.message); };
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  const timer = setInterval(() => { if (dialog.open && !editing) refresh().catch(e=>status.textContent=e.message); }, 10000);
  window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
}
