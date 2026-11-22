import { enhanceAllSelects, observeSelects } from './lib/autocomplete.js';
import { esc } from './lib/format.js';

const routes = [];

function renderStatusPage(container, { code, title, message, pathname }) {
  if (!container) return;
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>${esc(code)} — ${esc(title)}</h1>
        <p class="muted">${esc(message)}</p>
      </div>
      <div class="actions">
        <a href="/" data-link class="btn btn-primary">Volver al inicio</a>
      </div>
    </div>
    <div class="card">
      <div class="empty-state">
        <p class="mb-sm">Ruta solicitada: <code>${esc(pathname)}</code></p>
        <a href="/" data-link class="btn btn-sm">Ir al Dashboard</a>
      </div>
    </div>
  `;
}

export function addRoute(pattern, handler, permission = null) {
  const keys = [];
  const regexStr = pattern.replace(/:([^/]+)/g, (_, key) => {
    keys.push(key);
    return '([^/]+)';
  });
  routes.push({
    pattern,
    regex: new RegExp(`^${regexStr}/?$`),
    keys,
    handler,
    permission,
  });
}

export function navigate(path) {
  if (window.location.pathname + window.location.search === path) {
    return resolveRoute();
  }
  window.history.pushState({}, '', path);
  return resolveRoute();
}

export async function resolveRoute() {
  const pathname = window.location.pathname || '/';
  const searchParams = new URLSearchParams(window.location.search);

  // Highlight active nav tab (prefer the most specific / longest matching href)
  const navTabs = Array.from(document.querySelectorAll('#main-nav .tab'));
  const bestMatch = navTabs
    .filter(a => {
      const href = a.getAttribute('href');
      return href === '/'
        ? pathname === '/'
        : (pathname === href || pathname.startsWith(href + '/'));
    })
    .sort((a, b) => b.getAttribute('href').length - a.getAttribute('href').length)[0] || null;
  navTabs.forEach(a => {
    a.classList.toggle('active', a === bestMatch);
  });
  document.querySelectorAll('#sidebar .nav-group').forEach(group => {
    group.classList.toggle('has-active', Boolean(group.querySelector('a.tab.active')));
  });

  const container = document.getElementById('app-view');
  if (container) container.scrollTop = 0;
  for (const r of routes) {
    const match = pathname.match(r.regex);
    if (match) {
      if (r.permission && typeof window.__hasPerm === 'function' && !window.__hasPerm(r.permission)) {
        container.innerHTML = `
          <div class="card">
            <div class="card-header"><h2>Acceso Denegado</h2></div>
            <div class="empty-state">No tenés permiso (<code>${r.permission}</code>) para acceder a esta sección.</div>
          </div>
        `;
        return;
      }
      const params = {};
      r.keys.forEach((k, idx) => { params[k] = decodeURIComponent(match[idx + 1]); });
      try {
        await r.handler(container, params, searchParams);
        enhanceAllSelects(container);
      } catch (err) {
        if (err?.status === 404 || /no encontrad[oa]/i.test(err?.message || '')) {
          renderStatusPage(container, {
            code: '404',
            title: 'Recurso no encontrado',
            message: err?.message || 'El recurso solicitado no existe o fue eliminado.',
            pathname,
          });
        } else if (err?.status === 403) {
          renderStatusPage(container, {
            code: '403',
            title: 'Acceso denegado',
            message: err?.message || 'No tenés permisos para acceder a este recurso.',
            pathname,
          });
        } else {
          renderStatusPage(container, {
            code: String(err?.status || 'Error'),
            title: 'No se pudo cargar la vista',
            message: err?.message || 'Ocurrió un error inesperado al cargar el recurso.',
            pathname,
          });
        }
      }
      return;
    }
  }

  renderStatusPage(container, {
    code: '404',
    title: 'Página no encontrada',
    message: 'La ruta solicitada no existe en la aplicación.',
    pathname,
  });
}

export function initRouter() {
  observeSelects(document.body);
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[data-link]');
    if (!link) return;
    e.preventDefault();
    navigate(link.getAttribute('href'));
  });
  window.addEventListener('popstate', resolveRoute);
  resolveRoute();
}
