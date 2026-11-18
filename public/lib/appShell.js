export const NAV_GROUPS = [
  {
    key: 'produccion',
    title: 'Producción',
    items: [
      { href: '/pedidos', label: 'Pedidos', perm: 'produccion.ver' },
      { href: '/ordenes', label: 'Órdenes', perm: 'produccion.ver' },
      { href: '/produccion/etapas', label: 'Etapas', perm: 'produccion.ver' },
      { href: '/pendientes', label: 'Pendientes', perm: 'produccion.ver' },
      { href: '/recetas', label: 'Recetas', perm: 'produccion.ver' },
    ],
  },
  {
    key: 'inventario',
    title: 'Inventario',
    items: [
      { href: '/productos', label: 'Productos', perm: 'inventario.ver' },
      { href: '/inventario', label: 'Existencias', perm: 'inventario.ver' },
      { href: '/inventario/flujo-stock', label: 'Flujo de Stock', perm: 'inventario.ver' },
      { href: '/operaciones-stock', label: 'Operaciones', perm: 'inventario.ver' },
      { href: '/inventario/categorias', label: 'Categorías', perm: 'inventario.ver' },
      { href: '/inventario/variantes', label: 'Variantes', perm: 'inventario.ver' },
      { href: '/inventario/unidades', label: 'Unidades', perm: 'inventario.ver' },
      { href: '/inventario/ubicaciones', label: 'Ubicaciones', perm: 'inventario.ver' },
    ],
  },
  {
    key: 'comercial',
    title: 'Comercial',
    items: [
      { href: '/ventas', label: 'Ventas', perm: 'comercial.ver' },
      { href: '/compras', label: 'Compras', perm: 'comercial.ver' },
      { href: '/cronograma', label: 'Abastecimiento', perm: 'comercial.ver' },
      { href: '/contactos', label: 'Contactos', perm: 'comercial.ver' },
      { href: '/condiciones-comerciales', label: 'Condiciones', perm: 'comercial.ver' },
    ],
  },
  {
    key: 'tesoreria',
    title: 'Tesorería',
    items: [
      { href: '/tesoreria', label: 'Cuentas y Pagos', perm: 'tesoreria.ver' },
      { href: '/tesoreria/flujo-caja', label: 'Flujo de Caja', perm: 'tesoreria.ver' },
      { href: '/tesoreria/cheques', label: 'Cheques', perm: 'tesoreria.ver' },
      { href: '/tesoreria/conciliacion', label: 'Conciliación', perm: 'tesoreria.ver' },
    ],
  },
  {
    key: 'contabilidad',
    title: 'Contabilidad',
    items: [
      { href: '/contabilidad', label: 'Libro Diario', perm: 'contabilidad.ver' },
      { href: '/contabilidad/mayor', label: 'Libro Mayor', perm: 'contabilidad.ver' },
      { href: '/contabilidad/balance', label: 'Balance', perm: 'contabilidad.ver' },
      { href: '/contabilidad/plan-cuentas', label: 'Plan de Cuentas', perm: 'contabilidad.ver' },
      { href: '/contabilidad/impuestos', label: 'Impuestos', perm: 'contabilidad.ver' },
      { href: '/contabilidad/libros-fiscales', label: 'Libros IVA', perm: 'contabilidad.ver' },
      { href: '/contabilidad/posicion-iva', label: 'Posición IVA', perm: 'contabilidad.ver' },
      { href: '/contabilidad/cierres', label: 'Cierres', perm: 'contabilidad.ver' },
    ],
  },
  {
    key: 'sistema',
    title: 'Sistema',
    items: [
      { href: '/configuracion', label: 'Configuración' },
      { href: '/databases', label: 'Bases de Datos' },
    ],
  },
];

const SEARCH_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;

export function mountAppShell(targetEl = document.body) {
  const navHtml = NAV_GROUPS.map(g => `
    <details class="nav-group" data-group="${g.key}">
      <summary class="nav-group-title">${g.title}</summary>
      <div class="nav-group-items">
        ${g.items.map(it => `<a class="tab" href="${it.href}" data-link${it.perm ? ` data-perm="${it.perm}"` : ''}>${it.label}</a>`).join('')}
      </div>
    </details>
  `).join('');

  targetEl.innerHTML = `
    <header class="topbar">
      <div class="topbar-inner">
        <div class="brand">
          <button type="button" id="btn-toggle-sidebar" class="drawer-toggle" aria-label="Alternar menú">☰</button>
          <div class="brand-icon sx-98d03f">
            <img src="/favicon.svg" alt="VNG" width="40" height="40" class="sx-888096" />
          </div>
          <div>
            <h1>Vanguard Production</h1>
            <p class="subtitle">Gestión de Producción · v0.1.0</p>
            <a class="topbar-db-badge sx-cb4589" id="topbar-db-badge" href="/databases" data-link title="Cambiar base de datos">Base: -</a>
          </div>
        </div>
      </div>
    </header>

    <div class="app-shell" id="app-shell">
      <aside class="sidebar" id="sidebar">
        <nav class="sidebar-nav" id="main-nav">
          <a class="tab sx-a58b07" href="/" data-link>Dashboard</a>
          <a class="tab sx-a58b07" href="/tareas" data-link>Tareas</a>
          ${navHtml}
        </nav>
        <div class="sidebar-footer" id="sidebar-footer">
          <button type="button" class="sidebar-search-btn" id="btn-cmd-palette" title="Ir a pantalla (Ctrl+K)">
            ${SEARCH_ICON_SVG}
            <span>Ir a...</span>
            <kbd>Ctrl+K</kbd>
          </button>
          <div class="sidebar-user-box sx-cb4589" id="topbar-user-box">
            <div class="sidebar-user-info">
              <span class="sidebar-user-group" id="topbar-user-group"></span>
              <strong class="sidebar-user-name" id="topbar-user-name"></strong>
            </div>
            <button type="button" class="btn secondary btn-sm" id="btn-logout">Salir</button>
          </div>
        </div>
      </aside>
      <div class="sidebar-backdrop" id="sidebar-backdrop"></div>
      <main class="container main-content" id="app-view"></main>
    </div>

    <div class="toast-container" id="toast-container"></div>

    <div class="cmd-palette-backdrop" id="cmd-palette-backdrop" hidden>
      <div class="cmd-palette" role="dialog" aria-modal="true" aria-label="Ir a pantalla">
        <div class="cmd-palette-head">
          ${SEARCH_ICON_SVG}
          <input type="text" class="cmd-palette-input" id="cmd-palette-input" placeholder="Buscar pantalla o módulo (ej: stock, ventas, mayor)..." autocomplete="off" />
          <button type="button" class="btn btn-sm secondary" id="cmd-palette-close">Esc</button>
        </div>
        <div class="cmd-palette-list" id="cmd-palette-list"></div>
      </div>
    </div>
  `;

  initCommandPalette();
}

function initCommandPalette() {
  const backdrop = document.getElementById('cmd-palette-backdrop');
  const input = document.getElementById('cmd-palette-input');
  const list = document.getElementById('cmd-palette-list');
  const openBtn = document.getElementById('btn-cmd-palette');
  const closeBtn = document.getElementById('cmd-palette-close');
  if (!backdrop || !input || !list) return;

  let activeIdx = 0;
  let currentItems = [];

  const getRoutes = () => {
    const links = Array.from(document.querySelectorAll('#main-nav a.tab[data-link]'));
    return links
      .filter(a => a.style.display !== 'none')
      .map(a => {
        const groupEl = a.closest('details.nav-group')?.querySelector('.nav-group-title');
        return {
          label: a.textContent.trim(),
          href: a.getAttribute('href'),
          group: groupEl ? groupEl.textContent.trim() : 'General',
          el: a,
        };
      });
  };

  const renderList = () => {
    const q = input.value.trim().toLowerCase();
    const routes = getRoutes();
    currentItems = q
      ? routes.filter(r => r.label.toLowerCase().includes(q) || r.group.toLowerCase().includes(q) || r.href.toLowerCase().includes(q))
      : routes;
    if (activeIdx >= currentItems.length) activeIdx = 0;

    if (!currentItems.length) {
      list.innerHTML = '<div class="muted sx-d80e5a">Sin resultados.</div>';
      return;
    }

    list.innerHTML = currentItems.map((r, i) => `
      <button type="button" class="cmd-palette-item ${i === activeIdx ? 'is-active' : ''}" data-cmd-idx="${i}">
        <span>${r.label}</span>
        <span class="cmd-palette-group">${r.group}</span>
      </button>
    `).join('');

    list.querySelectorAll('[data-cmd-idx]').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = currentItems[Number(btn.dataset.cmdIdx)];
        if (item) {
          closePalette();
          item.el.click();
        }
      });
    });
  };

  const openPalette = () => {
    if (!window.__currentUser) return;
    backdrop.hidden = false;
    input.value = '';
    activeIdx = 0;
    renderList();
    setTimeout(() => input.focus(), 10);
  };

  const closePalette = () => {
    backdrop.hidden = true;
  };

  openBtn?.addEventListener('click', openPalette);
  closeBtn?.addEventListener('click', closePalette);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closePalette();
  });

  input.addEventListener('input', () => {
    activeIdx = 0;
    renderList();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (currentItems.length) { activeIdx = (activeIdx + 1) % currentItems.length; renderList(); }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (currentItems.length) { activeIdx = (activeIdx - 1 + currentItems.length) % currentItems.length; renderList(); }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = currentItems[activeIdx];
      if (item) { closePalette(); item.el.click(); }
    } else if (e.key === 'Escape') {
      closePalette();
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (backdrop.hidden) openPalette();
      else closePalette();
    } else if (e.key === 'Escape' && !backdrop.hidden) {
      closePalette();
    }
  });
}
