import { enhanceAllSelects, observeSelects } from './lib/autocomplete.js';

const routes = [];

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
      await r.handler(container, params, searchParams);
      enhanceAllSelects(container);
      return;
    }
  }

  container.innerHTML = `<div class="card"><div class="empty-state">Página no encontrada. <a href="/" data-link>Volver al inicio</a></div></div>`;
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
