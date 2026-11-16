import { esc } from '../format.js';

/**
 * Tira uniforme de KPIs / indicadores por pantalla.
 * Unificada con la estética de tarjetas KPI de detailEngine (.ve-detail-kpis / .ve-kpi-card).
 * items: [{ label, value, sublabel?, hint?, tone?: 'default'|'accent'|'success'|'ok'|'warn'|'danger', href? }]
 */
export function renderKpiStrip(container, items = []) {
  if (!container) return;
  const toneMap = {
    accent: 'tone-accent',
    success: 'tone-ok',
    ok: 'tone-ok',
    warn: 'tone-warn',
    danger: 'tone-danger',
  };
  container.innerHTML = `
    <div class="ve-detail-kpis" style="margin-bottom:1rem;">
      ${items.map(it => {
        const toneCls = toneMap[it.tone] || '';
        const sub = it.sublabel || it.hint || '';
        const inner = `
          <div class="ve-kpi-label">${esc(it.label)}</div>
          <div class="ve-kpi-value">${esc(it.value)}</div>
          ${sub ? `<div class="ve-kpi-hint">${esc(sub)}</div>` : ''}
        `;
        return it.href
          ? `<a href="${esc(it.href)}" data-link class="ve-kpi-card ve-kpi-link ${toneCls}">${inner}</a>`
          : `<div class="ve-kpi-card ${toneCls}">${inner}</div>`;
      }).join('')}
    </div>
  `;
}

/**
 * Barra de filtros estandarizada para listados.
 * Preserva el foco y el cursor cuando el usuario está tipeando en .ve-search
 * y muestra un botón "× Limpiar" cuando hay filtros activos.
 */
export function renderFilterBar(container, { searchValue = '', searchPlaceholder = 'Buscar...', filters = [], dateRange = null, onChange } = {}) {
  if (!container) return;

  const hasActiveFilters = () => {
    const s = container.querySelector('.ve-search')?.value || '';
    if (s.trim()) return true;
    for (const sel of container.querySelectorAll('.ve-filter')) {
      if (sel.value !== '') return true;
    }
    const df = container.querySelector('.ve-date-from')?.value || '';
    const dt = container.querySelector('.ve-date-to')?.value || '';
    return Boolean(df || dt);
  };

  const syncClearBtn = () => {
    const clearBtn = container.querySelector('[data-ve-filter-clear]');
    if (clearBtn) clearBtn.hidden = !hasActiveFilters();
  };

  // Si ya existe la barra en este contenedor y el foco está en el buscador, actualizamos in-place sin destruir el input
  const existingSearch = container.querySelector('.ve-search');
  if (existingSearch && document.activeElement === existingSearch && container.querySelectorAll('.ve-filter').length === filters.length) {
    container.__veFilterOnChange = onChange;
    filters.forEach(f => {
      const sel = container.querySelector(`.ve-filter[data-filter="${f.name}"]`);
      if (sel && String(sel.value) !== String(f.value ?? '')) {
        sel.value = String(f.value ?? '');
        sel.dispatchEvent(new Event('change'));
      }
    });
    if (dateRange) {
      const df = container.querySelector('.ve-date-from');
      const dt = container.querySelector('.ve-date-to');
      if (df && df.value !== (dateRange.from || '')) df.value = dateRange.from || '';
      if (dt && dt.value !== (dateRange.to || '')) dt.value = dateRange.to || '';
    }
    syncClearBtn();
    return;
  }

  container.__veFilterOnChange = onChange;

  container.innerHTML = `
    <div class="toolbar ve-filterbar" style="margin-bottom:0.75rem;">
      <input type="search" class="ve-search" value="${esc(searchValue)}" placeholder="${esc(searchPlaceholder)}" style="min-width:220px;" />
      ${filters.map(f => `
        <select class="ve-filter" data-filter="${esc(f.name)}">
          ${(f.options || []).map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(f.value ?? '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select>
      `).join('')}
      ${dateRange ? `
        <input type="date" class="ve-date-from" value="${esc(dateRange.from || '')}" title="Desde" style="width:auto;" />
        <input type="date" class="ve-date-to" value="${esc(dateRange.to || '')}" title="Hasta" style="width:auto;" />
      ` : ''}
      <button type="button" class="btn btn-sm ve-filter-clear" data-ve-filter-clear hidden title="Restablecer búsqueda y filtros">× Limpiar</button>
    </div>
  `;

  const getState = () => {
    const out = { search: container.querySelector('.ve-search')?.value || '' };
    container.querySelectorAll('.ve-filter').forEach(sel => { out[sel.dataset.filter] = sel.value; });
    if (dateRange) {
      out.from = container.querySelector('.ve-date-from')?.value || '';
      out.to = container.querySelector('.ve-date-to')?.value || '';
    }
    return out;
  };

  const emit = () => {
    syncClearBtn();
    container.__veFilterOnChange?.(getState());
  };

  container.querySelector('.ve-search')?.addEventListener('input', emit);
  container.querySelectorAll('.ve-filter').forEach(sel => sel.addEventListener('change', emit));
  container.querySelector('.ve-date-from')?.addEventListener('change', emit);
  container.querySelector('.ve-date-to')?.addEventListener('change', emit);

  container.querySelector('[data-ve-filter-clear]')?.addEventListener('click', () => {
    const s = container.querySelector('.ve-search');
    if (s) s.value = '';
    container.querySelectorAll('.ve-filter').forEach(sel => {
      sel.value = '';
      sel.dispatchEvent(new Event('change'));
    });
    const df = container.querySelector('.ve-date-from');
    const dt = container.querySelector('.ve-date-to');
    if (df) df.value = '';
    if (dt) dt.value = '';
    emit();
  });

  syncClearBtn();
}

/**
 * Selector de modo de vista (Lista | Agrupada | Kanban | Árbol).
 */
export function renderViewSwitcher(container, { modes = [], active, onChange } = {}) {
  if (!container) return;
  container.innerHTML = `
    <div class="ve-switcher" role="tablist">
      ${modes.map(m => `
        <button type="button" class="ve-switch-btn ${m.id === active ? 'active' : ''}" data-ve-mode="${esc(m.id)}" role="tab" aria-selected="${m.id === active}">
          ${esc(m.label)}
        </button>
      `).join('')}
    </div>
  `;
  container.querySelectorAll('[data-ve-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.veMode !== active) onChange?.(btn.dataset.veMode);
    });
  });
}

const lastPageTabByRoute = new Map();

/**
 * Motor de Plantillas de Página (mountPageView).
 * Estandariza cabeceras, botones de acción, KPIs, pestañas (tabs) y tarjetas
 * sin necesidad de escribir HTML manual de estructura ni márgenes inline.
 */
export function mountPageView(container, {
  breadcrumb = null,
  title = '',
  subtitle = '',
  actions = [],
  kpis = [],
  tabs = [],
  defaultTab = null,
  bodyHtml = '',
  onAfterMount = null,
} = {}) {
  if (!container) return;

  const routeKey = typeof window !== 'undefined' ? window.location.pathname : '';
  const rememberedTab = routeKey ? lastPageTabByRoute.get(routeKey) : null;
  const activeTabId = (rememberedTab && tabs.some(t => t.id === rememberedTab))
    ? rememberedTab
    : (defaultTab && tabs.some(t => t.id === defaultTab) ? defaultTab : (tabs[0]?.id || null));

  const renderAction = (a, idx) => {
    const cls = a.className || (a.primary ? 'btn btn-primary' : 'btn');
    if (a.href) {
      return `<a href="${esc(a.href)}" data-link class="${esc(cls)}">${esc(a.label)}</a>`;
    }
    return `<button type="button" class="${esc(cls)}" data-page-action="${idx}">${esc(a.label)}</button>`;
  };

  container.innerHTML = `
    <div class="ve-page-shell">
      <div class="page-header">
        <div>
          ${breadcrumb ? `<div class="ve-detail-breadcrumb"><a href="${esc(breadcrumb.href)}" data-link>← ${esc(breadcrumb.label)}</a></div>` : ''}
          <h1>${esc(title)}</h1>
          ${subtitle ? `<p class="muted">${esc(subtitle)}</p>` : ''}
        </div>
        ${actions.length ? `<div class="actions">${actions.map(renderAction).join('')}</div>` : ''}
      </div>

      ${kpis.length ? `<div data-page-kpis></div>` : ''}

      ${tabs.length ? `
        <div class="ve-detail-tabs" role="tablist">
          ${tabs.map(t => `
            <button type="button" role="tab"
              class="ve-detail-tab ${t.id === activeTabId ? 'active' : ''}"
              data-page-tab="${esc(t.id)}">
              ${esc(t.label)}
              ${t.badge !== undefined && t.badge !== null ? `<span class="ve-tab-badge">${esc(t.badge)}</span>` : ''}
            </button>
          `).join('')}
        </div>
        <div class="ve-page-tab-panels">
          ${tabs.map(t => `
            <div class="ve-detail-tab-panel ${t.id === activeTabId ? 'active' : ''}" data-page-panel="${esc(t.id)}">
              ${t.html || ''}
            </div>
          `).join('')}
        </div>
      ` : ''}

      ${bodyHtml ? `<div class="ve-page-body">${bodyHtml}</div>` : ''}
    </div>
  `;

  if (kpis.length) {
    renderKpiStrip(container.querySelector('[data-page-kpis]'), kpis);
  }

  actions.forEach((a, idx) => {
    if (typeof a.onClick === 'function') {
      container.querySelector(`[data-page-action="${idx}"]`)?.addEventListener('click', a.onClick);
    }
  });

  if (tabs.length) {
    const tabBtns = container.querySelectorAll('[data-page-tab]');
    const tabPanels = container.querySelectorAll('[data-page-panel]');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.pageTab;
        if (routeKey) lastPageTabByRoute.set(routeKey, id);
        tabBtns.forEach(b => b.classList.toggle('active', b.dataset.pageTab === id));
        tabPanels.forEach(p => p.classList.toggle('active', p.dataset.pagePanel === id));
        const tabObj = tabs.find(t => t.id === id);
        const panelEl = container.querySelector(`[data-page-panel="${id}"]`);
        tabObj?.onMount?.(panelEl);
      });
    });
    const firstTab = tabs.find(t => t.id === activeTabId);
    if (firstTab?.onMount) {
      firstTab.onMount(container.querySelector(`[data-page-panel="${activeTabId}"]`));
    }
  }

  onAfterMount?.(container);
}
