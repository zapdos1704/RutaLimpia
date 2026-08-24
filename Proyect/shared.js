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
    { label: 'Campañas',     href: 'page-5.html' },
    { label: 'Incidencias',  href: 'page-6.html' },
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
    { label:'Campañas',   href:'page-5.html', icon:'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z' },
    { label:'Incidencias',href:'page-6.html', icon:'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z' },
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
      <div class="alert-card">
        <div class="ac-title">VH-002 — Combustible bajo</div>
        <div class="ac-desc">Nivel por debajo del 15%. Requiere recarga antes del siguiente turno.</div>
        <div class="ac-meta">Hoy · 08:32</div>
        <div class="ac-actions">
          <button class="ac-btn" onclick="this.closest('.alert-card').remove()">Descartar</button>
          <button class="ac-btn ac-primary" onclick="closeAllPanels();window.location.href='page-1.html'">Ver en mapa</button>
        </div>
      </div>
      <div class="alert-card warn">
        <div class="ac-title">Ruta Sur — Retraso 35 min</div>
        <div class="ac-desc">El vehículo lleva más de 30 minutos de retraso en su ruta programada.</div>
        <div class="ac-meta">Hoy · 09:10</div>
        <div class="ac-actions">
          <button class="ac-btn" onclick="this.closest('.alert-card').remove()">Descartar</button>
          <button class="ac-btn ac-primary" onclick="closeAllPanels();window.location.href='page-1.html'">Ver en mapa</button>
        </div>
      </div>
      <div class="alert-card info">
        <div class="ac-title">VH-003 — GPS débil</div>
        <div class="ac-desc">Calidad de señal GPS reportada como "poor". Verificar dispositivo.</div>
        <div class="ac-meta">Hoy · 10:22</div>
        <div class="ac-actions">
          <button class="ac-btn" onclick="this.closest('.alert-card').remove()">Descartar</button>
          <button class="ac-btn ac-primary">Ver vehículo</button>
        </div>
      </div>
      <div class="alert-card info">
        <div class="ac-title">Campaña 2 — Próxima a cerrar</div>
        <div class="ac-desc">La campaña "Zona Norte" finaliza en 2 días.</div>
        <div class="ac-meta">Hoy · 10:00</div>
        <div class="ac-actions">
          <button class="ac-btn" onclick="this.closest('.alert-card').remove()">Descartar</button>
          <button class="ac-btn ac-primary" onclick="closeAllPanels();window.location.href='page-5.html'">Ver campaña</button>
        </div>
      </div>
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
        <span class="setting-value">OpenStreetMap</span>
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
      <button class="btn-danger" onclick="window.location.href='page.html'">
        Cerrar sesión
      </button>
    </div>
  </div>`;

  document.body.insertAdjacentHTML('beforeend', panels);
}

/* ── INIT: llamar desde cada página ── */
function initShared(activePage) {
  injectTopbar(activePage);
  injectBottomNav(activePage);
  injectPanels();
}
