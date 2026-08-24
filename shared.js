/* ══════════════════════════════════════════════════════
   RUTALIMPIA — shared.js
   Topbar, sidebar, paneles globales, toast
══════════════════════════════════════════════════════ */

/* ── TOAST ── */
let _toastTimer;
function showToast(msg) {
  let t = document.getElementById('rl-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'rl-toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

/* ── OVERLAY ── */
function getOverlay() {
  let o = document.getElementById('rl-overlay');
  if (!o) {
    o = document.createElement('div');
    o.id = 'rl-overlay';
    o.className = 'panel-overlay';
    o.addEventListener('click', closeAllPanels);
    document.body.appendChild(o);
  }
  return o;
}

function showOverlay()  { getOverlay().classList.add('show'); }
function hideOverlay()  { getOverlay().classList.remove('show'); }

function closeAllPanels() {
  document.querySelectorAll('.side-panel').forEach(p => p.classList.remove('open'));
  document.querySelectorAll('.icon-btn').forEach(b => b.classList.remove('active'));
  hideOverlay();
}

function togglePanel(panelId, btnEl) {
  const panel = document.getElementById(panelId);
  const isOpen = panel.classList.contains('open');
  closeAllPanels();
  if (!isOpen) {
    panel.classList.add('open');
    if (btnEl) btnEl.classList.add('active');
    showOverlay();
  }
}

/* ── INJECT TOPBAR ── */
function injectTopbar(activePage) {
  const pages = [
    { label: 'Dashboard',    href: 'page-4.html' },
    { label: 'Mapa en vivo', href: 'page-1.html' },
    { label: 'Camiones',     href: 'page-9.html' },
    { label: 'Campañas',     href: 'page-5.html' },
    { label: 'Incidencias',  href: 'page-6.html' },
    { label: 'Quejas',       href: 'page-8.html' },
  ];

  const navLinks = pages.map(p =>
    `<a href="${p.href}" ${p.label === activePage ? 'class="active"' : ''}>${p.label}</a>`
  ).join('');

  const html = `
  <a class="topbar-brand" href="page-4.html">RUTA<span>LIMPIA</span></a>
  <nav class="topbar-nav">${navLinks}</nav>
  <div class="topbar-right">
    <div class="icon-btn" id="btn-notif" title="Notificaciones"
         onclick="togglePanel('panel-notif', this)">
      <svg viewBox="0 0 24 24"><path d="M12 22c1.1 0 2-.9 2-2H10c0 1.1.9 2 2 2zm6-6V11c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>
      <div class="notif-badge"></div>
    </div>
    <div class="icon-btn" id="btn-settings" title="Ajustes"
         onclick="togglePanel('panel-settings', this)">
      <svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
    </div>
    <div class="topbar-avatar" id="btn-profile" title="Perfil"
         onclick="togglePanel('panel-profile', this)">
      <svg viewBox="0 0 24 24"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg>
    </div>
  </div>`;

  const el = document.querySelector('.topbar');
  if (el) el.innerHTML = html;
}

/* ── INJECT BOTTOM NAV ── */
function injectBottomNav(activePage) {
  const pages = [
    { label:'Dashboard',  href:'page-4.html', icon:'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z' },
    { label:'Mapa',       href:'page-1.html', icon:'M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z' },
    { label:'Camiones',   href:'page-9.html', icon:'M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm12 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z' },
    { label:'Campañas',   href:'page-5.html', icon:'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z' },
    { label:'Incidencias',href:'page-6.html', icon:'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z' },
    { label:'Quejas',     href:'page-8.html', icon:'M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h4l4 4 4-4h4c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7 12h-2v-2h2v2zm0-4h-2V6h2v4z' },
  ];

  const items = pages.map(p => `
    <a class="bn-item ${p.label === activePage ? 'active' : ''}" href="${p.href}">
      <div class="bn-icon-wrap">
        <svg viewBox="0 0 24 24"><path d="${p.icon}"/></svg>
      </div>
      <span class="bn-label">${p.label}</span>
    </a>`).join('');

  const el = document.querySelector('.bottom-nav');
  if (el) el.innerHTML = `<div class="bn-items">${items}</div>`;
}

/* ── NOTIFICACIONES (datos reales, no de ejemplo) ── */
const NOTIF_DISMISSED_KEY = 'rl_dismissed_notifs';
let _dismissedNotifs = new Set();
try { _dismissedNotifs = new Set(JSON.parse(sessionStorage.getItem(NOTIF_DISMISSED_KEY) || '[]')); } catch { _dismissedNotifs = new Set(); }

function saveDismissedNotifs() {
  try { sessionStorage.setItem(NOTIF_DISMISSED_KEY, JSON.stringify([..._dismissedNotifs])); } catch {}
}

function updateNotifBadge(count) {
  const badge = document.querySelector('#btn-notif .notif-badge');
  if (!badge) return;
  badge.style.display = count > 0 ? 'block' : 'none';
}

function dismissNotif(id, cardEl) {
  _dismissedNotifs.add(id);
  saveDismissedNotifs();
  cardEl?.remove();
  updateNotifBadge(document.querySelectorAll('#panel-notif .alert-card').length);
}

let _lastNotifs = [];
function renderNotifications(list) {
  _lastNotifs = Array.isArray(list) ? list : [];
  const body = document.querySelector('#panel-notif .sp-body');
  if (!body) return;
  const typeClass = { red: '', yellow: 'warn', blue: 'info' };
  const visible = _lastNotifs.filter(n => !_dismissedNotifs.has(n.id));
  body.innerHTML = visible.length ? visible.map(n => `
    <div class="alert-card ${typeClass[n.type] || ''}" data-id="${n.id}">
      <div class="ac-title">${n.title}</div>
      <div class="ac-desc">${n.desc}</div>
      <div class="ac-meta">${n.meta || 'Actualizado ahora'}</div>
      <div class="ac-actions">
        <button class="ac-btn" onclick="dismissNotif('${n.id}', this.closest('.alert-card'))">Descartar</button>
        ${n.action ? `<button class="ac-btn ac-primary" onclick="closeAllPanels();window.location.href='${n.action.href}'">${n.action.label}</button>` : ''}
      </div>
    </div>`).join('') : `<div style="text-align:center;color:var(--text-2);font-size:12px;padding:28px 10px;">✅ Sin notificaciones pendientes</div>`;
  updateNotifBadge(visible.length);
}

window.dismissNotif        = dismissNotif;
window.renderNotifications = renderNotifications;

/* ── PERFIL ── */
function renderProfile(user) {
  if (!user) return;
  const nameEl  = document.querySelector('#panel-profile .profile-name');
  const roleEl  = document.querySelector('#panel-profile .profile-role');
  const emailEl = document.querySelector('#panel-profile .profile-email');
  if (nameEl)  nameEl.textContent  = user.name || 'Usuario';
  if (roleEl)  roleEl.textContent  = (user.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : 'Usuario') + ' · RutaLimpia';
  if (emailEl) emailEl.textContent = user.email || '';
}
window.renderProfile = renderProfile;

/* La página que importa db.js define window.doLogout con signOut() real. */
window.doLogout = window.doLogout || function() { window.location.href = 'index.html'; };

/* ── INJECT PANELS ── */
function injectPanels() {
  const panels = `
  <!-- NOTIFICACIONES -->
  <div class="side-panel" id="panel-notif">
    <div class="sp-header">
      <span class="sp-title">🔔 Notificaciones</span>
      <button class="sp-close" onclick="closeAllPanels()">✕</button>
    </div>
    <div class="sp-body">
      <div style="text-align:center;color:var(--text-2);font-size:12px;padding:28px 10px;">Cargando…</div>
    </div>
  </div>

  <!-- AJUSTES -->
  <div class="side-panel" id="panel-settings">
    <div class="sp-header">
      <span class="sp-title">⚙️ Ajustes</span>
      <button class="sp-close" onclick="closeAllPanels()">✕</button>
    </div>
    <div class="sp-body">
      <div class="setting-row">
        <div class="setting-left">
          <span class="setting-icon">🌙</span>
          <span class="setting-label">Modo oscuro</span>
        </div>
        <label class="toggle">
          <input type="checkbox" checked/>
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="setting-row">
        <div class="setting-left">
          <span class="setting-icon">🔔</span>
          <span class="setting-label">Notificaciones</span>
        </div>
        <label class="toggle">
          <input type="checkbox" checked/>
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="setting-row">
        <div class="setting-left">
          <span class="setting-icon">📍</span>
          <span class="setting-label">Actualización GPS</span>
        </div>
        <span class="setting-value">Cada 30 seg</span>
        <span class="setting-arrow">›</span>
      </div>
      <div class="setting-row">
        <div class="setting-left">
          <span class="setting-icon">🗺️</span>
          <span class="setting-label">Mapa predeterminado</span>
        </div>
        <span class="setting-value">MapTiler Dark</span>
        <span class="setting-arrow">›</span>
      </div>
      <div class="setting-row">
        <div class="setting-left">
          <span class="setting-icon">🌐</span>
          <span class="setting-label">Idioma</span>
        </div>
        <span class="setting-value">Español</span>
        <span class="setting-arrow">›</span>
      </div>
      <div class="setting-row">
        <div class="setting-left">
          <span class="setting-icon">📱</span>
          <span class="setting-label">Versión</span>
        </div>
        <span class="setting-value">1.0.0</span>
      </div>
    </div>
  </div>

  <!-- PERFIL -->
  <div class="side-panel" id="panel-profile">
    <div class="sp-header">
      <span class="sp-title">👤 Mi perfil</span>
      <button class="sp-close" onclick="closeAllPanels()">✕</button>
    </div>
    <div class="sp-body">
      <div class="profile-hero">
        <div class="profile-avatar-lg">
          <svg viewBox="0 0 24 24"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg>
        </div>
        <div class="profile-name">Administrador</div>
        <div class="profile-role">Admin · RutaLimpia</div>
        <div class="profile-email">admin@rutalimpia.mx</div>
      </div>
      <div class="sp-divider"></div>
      <div class="setting-row">
        <div class="setting-left">
          <span class="setting-icon">✏️</span>
          <span class="setting-label">Editar perfil</span>
        </div>
        <span class="setting-arrow">›</span>
      </div>
      <div class="setting-row">
        <div class="setting-left">
          <span class="setting-icon">🔑</span>
          <span class="setting-label">Cambiar contraseña</span>
        </div>
        <span class="setting-arrow">›</span>
      </div>
      <div class="setting-row">
        <div class="setting-left">
          <span class="setting-icon">🛡️</span>
          <span class="setting-label">Seguridad</span>
        </div>
        <span class="setting-arrow">›</span>
      </div>
      <div class="sp-divider"></div>
      <button class="btn-danger" onclick="doLogout()">
        Cerrar sesión
      </button>
    </div>
  </div>`;

  document.body.insertAdjacentHTML('beforeend', panels);
}

/* ── INIT: llamar desde cada página ── */
function initShared(activePage) {
  // Mostrar loader
  const loader = document.createElement('div');
  loader.id = 'page-loader';
  loader.innerHTML = `
    <style>
      #page-loader { position:fixed; inset:0; background:var(--bg); z-index:9999; display:flex; flex-direction:column; align-items:center; justify-content:center; color:#fff; font-family:Montserrat, sans-serif; transition:opacity 0.3s; }
      .pl-spinner { width:40px; height:40px; border:3px solid rgba(255,255,255,0.1); border-top-color:var(--green-light); border-radius:50%; animation:spin 1s linear infinite; }
      @keyframes spin { 100% { transform:rotate(360deg); } }
    </style>
    <div class="pl-spinner"></div>
    <div style="margin-top:16px; font-size:14px; font-weight:600; color:var(--text-1)">Cargando datos...</div>
  `;
  document.body.appendChild(loader);

  window.hidePageLoader = function() {
    const l = document.getElementById('page-loader');
    if (l) { l.style.opacity = '0'; setTimeout(()=>l.remove(), 300); }
  };

  /* Red de seguridad: si algo falla antes de llamar hidePageLoader(),
     la pantalla de carga no debe quedarse trabada para siempre. */
  setTimeout(() => window.hidePageLoader?.(), 12000);

  injectTopbar(activePage);
  injectBottomNav(activePage);
  injectPanels();
}
