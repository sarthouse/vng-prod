import { esc } from '../format.js';

const lastActiveTabByRoute = new Map();

/**
 * Motor declarativo de pantallas detalle (estilo ficha ERP).
 * Soporta: breadcrumb, header con acciones, stepper de estados, smart buttons,
 * KPI strip, tabs interactivos (con memoria por ruta al recargar la ficha)
 * y layout 2 columnas (cuerpo principal + sidebar).
 */
export function mountDetailView(container, {
  breadcrumb = null,
  title = '',
  subtitle = '',
  badge = null,
  actions = [],
  steps = [],
  currentStep = '',
  smartButtons = [],
  kpis = [],
  mainHtml = '',
  tabs = [],
  defaultTab = null,
  sidebarHtml = '',
  onMountSidebar = null,
  onAfterMount = null,
} = {}) {
  if (!container) return;

  const routeKey = typeof window !== 'undefined' ? window.location.pathname : '';
  const rememberedTab = routeKey ? lastActiveTabByRoute.get(routeKey) : null;
  const activeTabId = (rememberedTab && tabs.some(t => t.id === rememberedTab))
    ? rememberedTab
    : (defaultTab && tabs.some(t => t.id === defaultTab) ? defaultTab : (tabs[0]?.id || null));

  const renderAction = (a, idx) => {
    const cls = a.className || (a.primary ? 'btn btn-primary' : 'btn');
    if (a.href) {
      return `<a href="${esc(a.href)}" data-link class="${esc(cls)}">${esc(a.label)}</a>`;
    }
    return `<button type="button" class="${esc(cls)}" data-detail-action="${idx}">${esc(a.label)}</button>`;
  };

  const renderSmartBtn = (sb, idx) => {
    const inner = `
      <span class="ve-smart-count">${esc(sb.count ?? 0)}</span>
      <span class="ve-smart-label">${sb.icon ? `${esc(sb.icon)} ` : ''}${esc(sb.label)}</span>
    `;
    if (sb.href) {
      return `<a href="${esc(sb.href)}" data-link class="ve-smart-btn">${inner}</a>`;
    }
    return `<button type="button" class="ve-smart-btn" data-smart-idx="${idx}">${inner}</button>`;
  };

  const currentIdx = steps.findIndex(s => s.key === currentStep);
  const stepperHtml = steps.length ? `
    <div class="ve-stepper" aria-label="Estados">
      ${steps.map((s, i) => {
        const stateCls = i < currentIdx ? 'done' : i === currentIdx ? 'active' : 'pending';
        return `<div class="ve-step ${stateCls}"><span>${esc(s.label)}</span></div>`;
      }).join('')}
    </div>
  ` : '';

  const kpiHtml = kpis.length ? `
    <div class="ve-detail-kpis">
      ${kpis.map(k => `
        <div class="ve-kpi-card ${k.tone ? `tone-${esc(k.tone)}` : ''}">
          <div class="ve-kpi-label">${esc(k.label)}</div>
          <div class="ve-kpi-value">${esc(k.value)}</div>
          ${k.hint ? `<div class="ve-kpi-hint">${esc(k.hint)}</div>` : ''}
        </div>
      `).join('')}
    </div>
  ` : '';

  const tabsHtml = tabs.length ? `
    <div class="ve-detail-tabs-wrap">
      <div class="ve-detail-tabs" role="tablist">
        ${tabs.map(t => `
          <button type="button" role="tab"
            class="ve-detail-tab ${t.id === activeTabId ? 'active' : ''}"
            data-tab-id="${esc(t.id)}">
            ${esc(t.label)}
            ${t.badge !== undefined && t.badge !== null ? `<span class="ve-tab-badge">${esc(t.badge)}</span>` : ''}
          </button>
        `).join('')}
      </div>
      <div class="ve-detail-tab-panels">
        ${tabs.map(t => `
          <div class="ve-detail-tab-panel ${t.id === activeTabId ? 'active' : ''}" data-tab-panel="${esc(t.id)}">
            ${t.html || ''}
          </div>
        `).join('')}
      </div>
    </div>
  ` : '';

  container.innerHTML = `
    <div class="ve-detail-shell">
      <div class="ve-detail-topbar">
        <div class="ve-detail-titleblock">
          ${breadcrumb ? `<div class="ve-detail-breadcrumb"><a href="${esc(breadcrumb.href)}" data-link>← ${esc(breadcrumb.label)}</a></div>` : ''}
          <div class="ve-detail-heading">
            <h1>${esc(title)} ${badge ? `<span class="badge ${esc(badge.className || '')}">${esc(badge.text)}</span>` : ''}</h1>
            ${subtitle ? `<p class="muted ve-detail-subtitle">${subtitle}</p>` : ''}
          </div>
        </div>
        ${smartButtons.length ? `<div class="ve-smart-buttons">${smartButtons.map(renderSmartBtn).join('')}</div>` : ''}
      </div>

      ${(actions.length || stepperHtml) ? `
        <div class="ve-detail-statusbar">
          <div class="ve-detail-actions">${actions.map(renderAction).join('')}</div>
          ${stepperHtml}
        </div>
      ` : ''}

      ${kpiHtml}

      <div class="ve-detail-grid ${sidebarHtml || onMountSidebar ? 'has-sidebar' : ''}">
        <div class="ve-detail-main">
          ${mainHtml}
          ${tabsHtml}
        </div>
        ${(sidebarHtml || onMountSidebar) ? `<aside class="ve-detail-sidebar">${sidebarHtml}</aside>` : ''}
      </div>
    </div>
  `;

  actions.forEach((a, idx) => {
    if (typeof a.onClick === 'function') {
      container.querySelector(`[data-detail-action="${idx}"]`)?.addEventListener('click', a.onClick);
    }
  });

  smartButtons.forEach((sb, idx) => {
    if (typeof sb.onClick === 'function') {
      container.querySelector(`[data-smart-idx="${idx}"]`)?.addEventListener('click', sb.onClick);
    }
  });

  if (tabs.length) {
    const tabBtns = container.querySelectorAll('.ve-detail-tab');
    const tabPanels = container.querySelectorAll('.ve-detail-tab-panel');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.tabId;
        if (routeKey) lastActiveTabByRoute.set(routeKey, id);
        tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tabId === id));
        tabPanels.forEach(p => p.classList.toggle('active', p.dataset.tabPanel === id));
        const tabObj = tabs.find(t => t.id === id);
        const panelEl = container.querySelector(`[data-tab-panel="${id}"]`);
        tabObj?.onMount?.(panelEl);
      });
    });
    const firstTab = tabs.find(t => t.id === activeTabId);
    if (firstTab?.onMount) {
      firstTab.onMount(container.querySelector(`[data-tab-panel="${activeTabId}"]`));
    }
  }

  if (onMountSidebar) {
    onMountSidebar(container.querySelector('.ve-detail-sidebar'));
  }

  onAfterMount?.(container);
}
