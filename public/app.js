import { addRoute, initRouter } from './router.js';
import { api, refreshKPIs, setOnUnauthorized, toast } from './lib/api.js';
import { observeTableBulkSelection } from './lib/viewEngine.js';
import { loadComprobantesCatalog } from './lib/comprobantesAr.js';
import { renderAuthView } from './views/auth/authView.js';
import { renderDatabasesView } from './views/auth/databasesView.js';

import { renderPresupuestoDetalleView } from './views/produccion/presupuestoDetalleView.js';
import { renderRecetasView, renderRecetaNuevaView } from './views/produccion/recetasView.js';
import { renderRecetaDetalleView } from './views/produccion/recetaDetalleView.js';
import { renderOrdenesView, renderOrdenNuevaView } from './views/produccion/ordenesView.js';
import { renderOrdenDetalleView } from './views/produccion/ordenDetalleView.js';
import { renderEntregasView } from './views/produccion/entregasView.js';
import { renderEntregaFormView } from './views/produccion/entregaFormView.js';
import { renderPendientesView } from './views/produccion/pendientesView.js';
import { renderEtapasView } from './views/produccion/etapasView.js';

import { renderPlantillasView } from './views/inventario/plantillasView.js';
import { renderPlantillaFormView } from './views/inventario/plantillaFormView.js';
import { renderInventarioView } from './views/inventario/inventarioView.js';
import { renderOperacionesStockView, renderOperacionStockFormView, renderOperacionStockDetalleView } from './views/inventario/operacionesStockView.js';
import {
  renderCategoriasView,
  renderVariantesView,
  renderUnidadesView,
  renderUbicacionesView,
} from './views/inventario/catalogoConfigView.js';

import { renderComprasView, renderCompraFormView } from './views/comercial/comprasView.js';
import { renderVentasView, renderVentaFormView } from './views/comercial/ventasView.js';
import { renderComercialReglasView } from './views/comercial/comercialReglasView.js';
import { renderCondicionesComercialesView } from './views/comercial/condicionesComercialesView.js';
import { renderContactosView, renderContactoFormView } from './views/comercial/contactosView.js';
import { renderCronogramaView } from './views/comercial/cronogramaView.js';

import { renderTesoreriaView, renderPagosView, renderPagoFormView, renderCobrosView, renderCobroFormView } from './views/finanzas/tesoreriaView.js';
import { renderTesoreriaCuentasView } from './views/finanzas/tesoreriaCuentasView.js';
import {
  renderLibroDiarioView,
  renderAsientoNuevoView,
  renderLibroMayorView,
  renderBalanceResultadosView,
  renderPlanCuentasView,
} from './views/finanzas/contabilidadView.js';
import { renderImpuestosView } from './views/finanzas/impuestosView.js';
import { renderLibrosFiscalesView } from './views/finanzas/librosFiscalesView.js';
import {
  renderPosicionIvaView,
  renderConciliacionBancariaView,
  renderCierresYMonedasView,
} from './views/finanzas/contabilidadAvanzadaView.js';

import { renderConfigView } from './views/config/configView.js';
import { renderDashboardView } from './views/dashboard/dashboardView.js';

addRoute('/', renderDashboardView);
addRoute('/presupuestos/:id', renderPresupuestoDetalleView, 'produccion.ver');

addRoute('/recetas', () => renderRecetasView(), 'produccion.ver');
addRoute('/recetas/nueva', () => renderRecetaNuevaView(), 'produccion.editar');
addRoute('/recetas/:id', (_c, params) => renderRecetaDetalleView(params), 'produccion.ver');

addRoute('/productos', () => renderPlantillasView(), 'inventario.ver');
addRoute('/plantillas/nueva', () => renderPlantillaFormView(), 'inventario.editar');
addRoute('/plantillas/:id', (_c, params) => renderPlantillaFormView(params), 'inventario.ver');

addRoute('/compras', () => renderComprasView(), 'comercial.ver');
addRoute('/compras/nueva', () => renderCompraFormView(), 'comercial.editar');
addRoute('/compras/:id', (_c, params) => renderCompraFormView(params), 'comercial.ver');

addRoute('/ventas', () => renderVentasView(), 'comercial.ver');
addRoute('/ventas/reglas', () => renderComercialReglasView(), 'comercial.ver');
addRoute('/condiciones-comerciales', () => renderCondicionesComercialesView(), 'comercial.ver');
addRoute('/ventas/nueva', () => renderVentaFormView(), 'comercial.editar');
addRoute('/ventas/:id', (_c, params) => renderVentaFormView(params), 'comercial.ver');

addRoute('/contactos', () => renderContactosView(), 'comercial.ver');
addRoute('/contactos/nuevo', () => renderContactoFormView(), 'comercial.editar');
addRoute('/contactos/:id', (_c, params) => renderContactoFormView(params), 'comercial.ver');

addRoute('/tesoreria', () => renderTesoreriaView(), 'tesoreria.ver');
addRoute('/tesoreria/cuentas', () => renderTesoreriaCuentasView(), 'tesoreria.ver');
addRoute('/tesoreria/pagos', () => renderPagosView(), 'tesoreria.ver');
addRoute('/tesoreria/pagos/nuevo', () => renderPagoFormView(), 'tesoreria.editar');
addRoute('/tesoreria/cobros', () => renderCobrosView(), 'tesoreria.ver');
addRoute('/tesoreria/cobros/nuevo', () => renderCobroFormView(), 'tesoreria.editar');
addRoute('/contabilidad', () => renderLibroDiarioView(), 'contabilidad.ver');
addRoute('/contabilidad/asientos/nuevo', () => renderAsientoNuevoView(), 'contabilidad.editar');
addRoute('/contabilidad/mayor', () => renderLibroMayorView(), 'contabilidad.ver');
addRoute('/contabilidad/balance', () => renderBalanceResultadosView(), 'contabilidad.ver');
addRoute('/contabilidad/plan-cuentas', () => renderPlanCuentasView(), 'contabilidad.ver');
addRoute('/contabilidad/impuestos', () => renderImpuestosView(), 'contabilidad.ver');
addRoute('/contabilidad/libros-fiscales', () => renderLibrosFiscalesView(), 'contabilidad.ver');
addRoute('/contabilidad/posicion-iva', () => renderPosicionIvaView(), 'contabilidad.ver');
addRoute('/contabilidad/cierres', () => renderCierresYMonedasView(), 'contabilidad.ver');
addRoute('/tesoreria/conciliacion', () => renderConciliacionBancariaView(), 'tesoreria.ver');

addRoute('/inventario', () => renderInventarioView(), 'inventario.ver');
addRoute('/traslados', () => renderOperacionesStockView(), 'inventario.ver');
addRoute('/operaciones-stock', () => renderOperacionesStockView(), 'inventario.ver');
addRoute('/remitos', () => renderOperacionesStockView(), 'inventario.ver');
addRoute('/operaciones-stock/nueva', () => renderOperacionStockFormView({ mode: 'operacion' }), 'inventario.editar');
addRoute('/remitos/nuevo', () => renderOperacionStockFormView({ mode: 'remito' }), 'inventario.editar');
addRoute('/operaciones-stock/:id', (_c, params) => renderOperacionStockDetalleView(params), 'inventario.ver');
addRoute('/inventario/categorias', () => renderCategoriasView(), 'inventario.ver');
addRoute('/inventario/variantes', () => renderVariantesView(), 'inventario.ver');
addRoute('/inventario/unidades', () => renderUnidadesView(), 'inventario.ver');
addRoute('/inventario/ubicaciones', () => renderUbicacionesView(), 'inventario.ver');
addRoute('/produccion/etapas', () => renderEtapasView(), 'produccion.ver');
addRoute('/cronograma', () => renderCronogramaView(), 'comercial.ver');
addRoute('/ordenes', () => renderOrdenesView(), 'produccion.ver');
addRoute('/ordenes/nueva', () => renderOrdenNuevaView(), 'produccion.editar');
addRoute('/ordenes/:id', (_c, params) => renderOrdenDetalleView(params), 'produccion.ver');

addRoute('/entregas', () => renderEntregasView(), 'produccion.ver');
addRoute('/entregas/nueva', () => renderEntregaFormView(), 'produccion.editar');
addRoute('/entregas/:id/editar', (_c, params) => renderEntregaFormView(params), 'produccion.editar');

addRoute('/pendientes', () => renderPendientesView(), 'produccion.ver');
addRoute('/configuracion', () => renderConfigView());
addRoute('/databases', (c) => renderDatabasesView(c));

let routerInitialized = false;
window.__currentUser = null;
const LEGACY_PERM_ALIASES = {
  'comercial.ver': ['compras.ver', 'ventas.ver'],
  'comercial.editar': ['compras.editar', 'ventas.editar'],
};
window.__hasPerm = (perm) => {
  const u = window.__currentUser;
  if (!u) return false;
  if (!perm) return true;
  const perms = u.permisos || [];
  if (u.es_admin || perms.includes('*')) return true;
  if (perms.includes(perm)) return true;
  const aliases = LEGACY_PERM_ALIASES[perm];
  return Array.isArray(aliases) && aliases.some(a => perms.includes(a));
};

function applyNavPermissions(sidebar) {
  if (!sidebar) return;
  sidebar.querySelectorAll('a[data-perm]').forEach(a => {
    a.style.display = window.__hasPerm(a.dataset.perm) ? '' : 'none';
  });
  sidebar.querySelectorAll('.nav-group').forEach(group => {
    const anyVisible = Array.from(group.querySelectorAll('a')).some(a => a.style.display !== 'none');
    group.style.display = anyVisible ? '' : 'none';
  });
}

function setAuthenticatedUI(user) {
  window.__currentUser = user || null;
  const shell = document.getElementById('app-shell');
  const sidebarEl = document.getElementById('sidebar');
  const toggleBtnEl = document.getElementById('btn-toggle-sidebar');
  const kpiCards = document.querySelectorAll('.topbar .kpi-card:not(#topbar-user-box)');
  const userBox = document.getElementById('topbar-user-box');
  const userName = document.getElementById('topbar-user-name');
  const userGroup = document.getElementById('topbar-user-group');
  const sidebar = document.getElementById('main-nav');
  if (user) {
    if (shell) shell.classList.remove('sidebar-collapsed');
    if (sidebarEl) sidebarEl.style.display = '';
    if (toggleBtnEl) toggleBtnEl.style.display = '';
    kpiCards.forEach(el => { el.style.display = ''; });
    if (userBox) userBox.style.display = 'flex';
    if (userName) userName.textContent = user.nombre || user.username;
    if (userGroup) userGroup.textContent = user.grupo_nombre || (user.es_admin ? 'Admin' : 'Usuario');
    if (sidebar) {
      sidebar.style.display = '';
      applyNavPermissions(sidebar);
    }
    refreshKPIs();
    if (window.location.pathname === '/login' || window.location.pathname === '/database') {
      window.history.replaceState({}, '', '/');
    }
    if (!routerInitialized) {
      routerInitialized = true;
      initRouter();
    } else {
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  } else {
    if (shell) shell.classList.add('sidebar-collapsed');
    if (sidebarEl) sidebarEl.style.display = 'none';
    if (toggleBtnEl) toggleBtnEl.style.display = 'none';
    kpiCards.forEach(el => { el.style.display = 'none'; });
    if (userBox) userBox.style.display = 'none';
    if (sidebar) sidebar.style.display = 'none';
    const appView = document.getElementById('app-view');
    if (appView) renderAuthView(appView, (loggedUser) => setAuthenticatedUI(loggedUser));
  }
}

setOnUnauthorized(() => {
  if (window.__currentUser) {
    toast('Tu sesión expiró. Iniciá sesión nuevamente.', true);
  }
  setAuthenticatedUI(null);
});

document.getElementById('btn-logout')?.addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch { /* ignore */ }
  setAuthenticatedUI(null);
});

(async function bootstrap() {
  observeTableBulkSelection(document.getElementById('app-view'));
  loadComprobantesCatalog(api);
  try {
    const res = await api('/api/auth/me');
    setAuthenticatedUI(res.user);
  } catch {
    setAuthenticatedUI(null);
  }
})();

// Drawer lateral toggle (desktop collapse / mobile slide-over)
const shell = document.getElementById('app-shell');
const toggleBtn = document.getElementById('btn-toggle-sidebar');
const backdrop = document.getElementById('sidebar-backdrop');
const nav = document.getElementById('main-nav');

toggleBtn?.addEventListener('click', () => {
  if (window.innerWidth <= 960) {
    shell?.classList.toggle('sidebar-open');
  } else {
    shell?.classList.toggle('sidebar-collapsed');
  }
});

backdrop?.addEventListener('click', () => {
  shell?.classList.remove('sidebar-open');
});

function syncActiveNavGroup(sidebar) {
  if (!sidebar) return;
  const active = sidebar.querySelector('a.tab.active');
  const group = active?.closest('details.nav-group');
  if (group) group.open = true;
}

if (nav) {
  const obs = new MutationObserver(() => syncActiveNavGroup(nav));
  obs.observe(nav, { subtree: true, attributes: true, attributeFilter: ['class'] });
  syncActiveNavGroup(nav);
}

nav?.addEventListener('click', (e) => {
  if (e.target.closest('a[data-link]') && window.innerWidth <= 960) {
    shell?.classList.remove('sidebar-open');
  }
});
