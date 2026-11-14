import { esc } from './format.js';
import { mountCombobox } from './autocomplete.js';
import { showConfirmModal } from './modal.js';

/**
 * Motor declarativo de campos de formulario (SOPORTE: text, number, date, select, combobox).
 * Permite definir vistas como datos sin duplicar HTML ni listeners.
 */
export function mountFormFields(container, fields, state, { onChange } = {}) {
  if (!container) return;
  container.innerHTML = fields.map(f => {
    const val = state[f.name] ?? '';
    const req = f.required ? 'required' : '';
    const cls = f.full ? 'class="full"' : '';
    if (f.type === 'combobox') {
      return `
        <label ${cls}>
          <span>${esc(f.label)}${f.required ? ' *' : ''}</span>
          <div class="ve-combo" data-field="${esc(f.name)}"></div>
        </label>
      `;
    }
    if (f.type === 'select') {
      return `
        <label ${cls}>
          <span>${esc(f.label)}${f.required ? ' *' : ''}</span>
          <select name="${esc(f.name)}" data-field="${esc(f.name)}" ${req}>
            ${(f.options || []).map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(val) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
          </select>
        </label>
      `;
    }
    return `
      <label ${cls}>
        <span>${esc(f.label)}${f.required ? ' *' : ''}</span>
        <input type="${esc(f.type || 'text')}" name="${esc(f.name)}" data-field="${esc(f.name)}" value="${esc(val)}" placeholder="${esc(f.placeholder || '')}" ${req} />
      </label>
    `;
  }).join('');

  for (const f of fields) {
    if (f.type === 'combobox') {
      const el = container.querySelector(`.ve-combo[data-field="${f.name}"]`);
      mountCombobox(el, {
        name: f.name,
        value: state[f.name] ?? '',
        required: !!f.required,
        placeholder: f.placeholder || 'Buscar...',
        items: typeof f.items === 'function' ? f.items() : (f.items || []),
        onSelect: (it) => {
          state[f.name] = it ? String(it.value) : '';
          f.onSelect?.(it, state);
          onChange?.(f.name, state[f.name], state);
        },
        onCreate: f.onCreate || null,
      });
    } else {
      const el = container.querySelector(`[data-field="${f.name}"]`);
      el?.addEventListener('change', (e) => {
        state[f.name] = e.target.value;
        onChange?.(f.name, state[f.name], state);
      });
    }
  }
}

function csvEscape(v) {
  const s = String(v ?? '').replace(/\r?\n/g, ' ');
  return /[",;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename, headers, matrixRows) {
  const lines = [headers.map(csvEscape).join(';'), ...matrixRows.map(r => r.map(csvEscape).join(';'))];
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'seleccion.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function stripHtmlText(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
}

function bindBulkBarAndCheckboxes(rootEl, { rows, idList, bulkActions = [], exportColumns = null, exportFilename = 'seleccion.csv' }) {
  const bar = rootEl.querySelector('[data-bulk-bar]');
  const countEl = rootEl.querySelector('[data-bulk-count]');
  const clearBtn = rootEl.querySelector('[data-bulk-clear]');
  const allCb = rootEl.querySelector('[data-bulk-all]');
  const rowCbs = Array.from(rootEl.querySelectorAll('[data-bulk-row]'));
  if (!bar || !rowCbs.length) return;

  const selected = new Set();
  let lastClickedIdx = -1;

  const sync = () => {
    const n = selected.size;
    bar.hidden = n === 0;
    if (countEl) countEl.textContent = `${n} ${n === 1 ? 'seleccionado' : 'seleccionados'}`;
    if (allCb) {
      allCb.checked = n > 0 && n === rowCbs.length;
      allCb.indeterminate = n > 0 && n < rowCbs.length;
    }
    rowCbs.forEach(cb => {
      const isSel = selected.has(cb.dataset.bulkRow);
      cb.checked = isSel;
      cb.closest('tr')?.classList.toggle('row-selected', isSel);
    });
  };

  allCb?.addEventListener('change', () => {
    if (allCb.checked) rowCbs.forEach(cb => selected.add(cb.dataset.bulkRow));
    else selected.clear();
    sync();
  });

  clearBtn?.addEventListener('click', () => {
    selected.clear();
    sync();
  });

  rowCbs.forEach((cb, idx) => {
    cb.addEventListener('click', (e) => {
      const id = cb.dataset.bulkRow;
      if (e.shiftKey && lastClickedIdx >= 0 && lastClickedIdx !== idx) {
        const [from, to] = lastClickedIdx < idx ? [lastClickedIdx, idx] : [idx, lastClickedIdx];
        const targetState = cb.checked;
        for (let i = from; i <= to; i++) {
          const rid = rowCbs[i].dataset.bulkRow;
          if (targetState) selected.add(rid);
          else selected.delete(rid);
        }
      } else {
        if (cb.checked) selected.add(id);
        else selected.delete(id);
      }
      lastClickedIdx = idx;
      sync();
    });
  });

  const getSelectedRows = () => {
    const out = [];
    for (let i = 0; i < idList.length; i++) {
      if (selected.has(idList[i])) out.push(rows[i]);
    }
    return out;
  };

  rootEl.querySelectorAll('[data-bulk-act]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const act = bulkActions.find(a => String(a.id) === String(btn.dataset.bulkAct));
      if (!act) return;
      const selRows = getSelectedRows();
      if (!selRows.length) return;
      if (act.confirm) {
        const msg = typeof act.confirm === 'function' ? act.confirm(selRows) : act.confirm;
        if (msg) {
          const ok = await showConfirmModal(msg, {
            title: act.label || 'Confirmar acción masiva',
            confirmText: act.confirmText || 'Continuar',
            danger: act.variant === 'danger',
          });
          if (!ok) return;
        }
      }
      btn.disabled = true;
      try {
        await act.onClick?.(selRows, { clear: () => { selected.clear(); sync(); } });
      } finally {
        btn.disabled = false;
      }
    });
  });

  rootEl.querySelector('[data-bulk-export]')?.addEventListener('click', () => {
    const selRows = getSelectedRows();
    if (!selRows.length) return;
    if (exportColumns) {
      const cols = exportColumns.filter(c => c.label && c.label.toLowerCase() !== 'acciones');
      const headers = cols.map(c => c.label);
      const matrix = selRows.map(r => cols.map(c => {
        if (typeof c.exportValue === 'function') return c.exportValue(r);
        if (c.key && r[c.key] !== undefined && r[c.key] !== null) return r[c.key];
        if (c.render) return stripHtmlText(c.render(r));
        return '';
      }));
      downloadCsv(exportFilename, headers, matrix);
    } else {
      const table = rootEl.querySelector('table.data-table');
      if (!table) return;
      const ths = Array.from(table.querySelectorAll('thead th'));
      const keepIdx = ths
        .map((th, i) => ({ i, text: th.textContent.trim(), isBulk: th.classList.contains('bulk-col') }))
        .filter(x => !x.isBulk && x.text.toLowerCase() !== 'acciones');
      const headers = keepIdx.map(x => x.text);
      const trs = Array.from(table.querySelectorAll('tbody tr')).filter(tr => {
        const cb = tr.querySelector('[data-bulk-row]');
        return cb && selected.has(cb.dataset.bulkRow);
      });
      const matrix = trs.map(tr => {
        const tds = Array.from(tr.children);
        return keepIdx.map(x => (tds[x.i]?.textContent || '').replace(/\s+/g, ' ').trim());
      });
      downloadCsv(exportFilename, headers, matrix);
    }
  });
}

function renderBulkBarHtml(bulkActions = []) {
  return `
    <div class="bulk-bar" data-bulk-bar hidden>
      <div class="bulk-bar-info">
        <span data-bulk-count>0 seleccionados</span>
        <button type="button" class="btn btn-sm" data-bulk-clear>Limpiar</button>
      </div>
      <div class="bulk-bar-actions">
        ${bulkActions.map(a => {
          const cls = a.variant === 'primary' ? 'btn-primary' : a.variant === 'danger' ? 'btn-danger' : '';
          return `<button type="button" class="btn btn-sm ${cls}" data-bulk-act="${esc(a.id)}">${esc(a.label)}</button>`;
        }).join('')}
        <button type="button" class="btn btn-sm" data-bulk-export>Exportar CSV</button>
      </div>
    </div>
  `;
}

/**
 * Motor genérico de tablas de listado (ListView) con selección y acciones masivas.
 */
export function renderDataTable(container, {
  columns = [],
  rows = [],
  emptyText = 'Sin registros.',
  selectable = true,
  getRowId,
  bulkActions = [],
  exportFilename = 'seleccion.csv',
} = {}) {
  if (!container) return;
  if (!rows.length) {
    container.innerHTML = `<div class="empty-state">${esc(emptyText)}</div>`;
    return;
  }

  const resolveId = typeof getRowId === 'function' ? getRowId : (r, i) => (r?.id !== undefined && r?.id !== null ? r.id : i);
  const idList = rows.map((r, i) => String(resolveId(r, i)));

  container.innerHTML = `
    ${selectable ? renderBulkBarHtml(bulkActions) : ''}
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            ${selectable ? '<th class="bulk-col"><input type="checkbox" class="bulk-check" data-bulk-all title="Seleccionar todos" /></th>' : ''}
            ${columns.map(c => `<th class="${c.align === 'right' ? 'num' : ''}">${esc(c.label)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${rows.map((r, i) => `
            <tr data-row-id="${esc(idList[i])}">
              ${selectable ? `<td class="bulk-col"><input type="checkbox" class="bulk-check" data-bulk-row="${esc(idList[i])}" /></td>` : ''}
              ${columns.map(c => {
                const content = c.render ? c.render(r) : esc(r[c.key] ?? '');
                return `<td class="${c.align === 'right' ? 'num' : ''}">${content}</td>`;
              }).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  if (selectable) {
    bindBulkBarAndCheckboxes(container, {
      rows,
      idList,
      bulkActions,
      exportColumns: columns,
      exportFilename,
    });
  }
}

/**
 * Agrega selección y barra de acciones masivas a una tabla HTML existente.
 */
export function attachBulkSelection(container, {
  rows = [],
  getRowId,
  bulkActions = [],
  exportFilename = 'seleccion.csv',
  tableSelector = 'table.data-table',
} = {}) {
  if (!container) return;
  const table = container.matches(tableSelector) ? container : container.querySelector(tableSelector);
  if (!table) return;
  const tbodyRows = Array.from(table.querySelectorAll('tbody tr'));
  if (!tbodyRows.length) return;

  // Evitar duplicar si ya fue adjuntado
  if (table.querySelector('th.bulk-col')) return;

  const resolveId = typeof getRowId === 'function' ? getRowId : (r, i) => (r?.id !== undefined && r?.id !== null ? r.id : i);
  const idList = tbodyRows.map((tr, i) => {
    const r = rows[i];
    if (r !== undefined) return String(resolveId(r, i));
    return String(tr.dataset.rowId ?? tr.dataset.id ?? i);
  });

  const headTr = table.querySelector('thead tr');
  if (headTr) {
    const th = document.createElement('th');
    th.className = 'bulk-col';
    th.innerHTML = '<input type="checkbox" class="bulk-check" data-bulk-all title="Seleccionar todos" />';
    headTr.insertBefore(th, headTr.firstChild);
  }

  tbodyRows.forEach((tr, i) => {
    const td = document.createElement('td');
    td.className = 'bulk-col';
    td.innerHTML = `<input type="checkbox" class="bulk-check" data-bulk-row="${esc(idList[i])}" />`;
    tr.insertBefore(td, tr.firstChild);
  });

  const barWrap = document.createElement('div');
  barWrap.innerHTML = renderBulkBarHtml(bulkActions);
  const barEl = barWrap.firstElementChild;
  const tableWrap = table.closest('.table-wrap') || table;
  tableWrap.parentNode.insertBefore(barEl, tableWrap);

  bindBulkBarAndCheckboxes(tableWrap.parentNode, {
    rows: rows.length ? rows : tbodyRows.map((tr, i) => ({ id: idList[i], _tr: tr })),
    idList,
    bulkActions,
    exportFilename,
  });
}

/**
 * Observa un contenedor raíz (ej. #app-view) y adjunta selección + Exportar CSV
 * a cualquier <table class="data-table"> de listado que no esté dentro de un <form>
 * ni tenga la clase .no-bulk ni ya haya sido inicializada.
 */
export function observeTableBulkSelection(rootEl) {
  if (!rootEl || rootEl.dataset.bulkObserverBound) return;
  rootEl.dataset.bulkObserverBound = '1';

  const scan = () => {
    rootEl.querySelectorAll('table.data-table').forEach(table => {
      if (table.closest('form')) return;
      if (table.classList.contains('no-bulk')) return;
      if (table.querySelector('th.bulk-col')) return;
      const tbodyRows = table.querySelectorAll('tbody tr');
      if (!tbodyRows.length) return;
      attachBulkSelection(table, { exportFilename: 'listado_seleccion.csv' });
    });
  };

  let scheduled = false;
  const obs = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      scan();
    });
  });
  obs.observe(rootEl, { childList: true, subtree: true });
  scan();
}

/**
 * Tira uniforme de KPIs / indicadores por pantalla.
 * items: [{ label, value, sublabel?, tone?: 'default'|'accent'|'success'|'warn', href? }]
 */
export function renderKpiStrip(container, items = []) {
  if (!container) return;
  const colorMap = {
    accent: 'var(--color-accent)',
    success: 'var(--color-success)',
    warn: '#b45309',
  };
  container.innerHTML = `
    <div class="detail-meta" style="margin-bottom:1rem;">
      ${items.map(it => {
        const valColor = colorMap[it.tone] || 'inherit';
        const inner = `
          <span>${esc(it.label)}</span>
          <strong style="color:${valColor};">${esc(it.value)}</strong>
          ${it.sublabel ? `<small class="muted" style="display:block;font-size:0.75rem;margin-top:2px;">${esc(it.sublabel)}</small>` : ''}
        `;
        return it.href
          ? `<a href="${esc(it.href)}" data-link style="text-decoration:none;color:inherit;display:block;">${inner}</a>`
          : `<div>${inner}</div>`;
      }).join('')}
    </div>
  `;
}

/**
 * Barra de filtros estandarizada para listados.
 */
export function renderFilterBar(container, { searchValue = '', searchPlaceholder = 'Buscar...', filters = [], onChange } = {}) {
  if (!container) return;
  container.innerHTML = `
    <div class="toolbar" style="margin-bottom:0.75rem;">
      <input type="search" class="ve-search" value="${esc(searchValue)}" placeholder="${esc(searchPlaceholder)}" style="min-width:220px;" />
      ${filters.map(f => `
        <select class="ve-filter" data-filter="${esc(f.name)}">
          ${(f.options || []).map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(f.value ?? '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select>
      `).join('')}
    </div>
  `;
  const getState = () => {
    const out = { search: container.querySelector('.ve-search')?.value || '' };
    container.querySelectorAll('.ve-filter').forEach(sel => { out[sel.dataset.filter] = sel.value; });
    return out;
  };
  container.querySelector('.ve-search')?.addEventListener('input', () => onChange?.(getState()));
  container.querySelectorAll('.ve-filter').forEach(sel => sel.addEventListener('change', () => onChange?.(getState())));
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

/**
 * Vista Lista Agrupada (Tree agrupado con colapsables y subtotales).
 */
export function renderGroupedList(container, {
  columns = [],
  rows = [],
  groupBy,
  groupLabel,
  emptyText = 'Sin registros.',
} = {}) {
  if (!container) return;
  if (!rows.length) {
    container.innerHTML = `<div class="empty-state">${esc(emptyText)}</div>`;
    return;
  }

  const getKey = typeof groupBy === 'function' ? groupBy : (r) => r?.[groupBy];
  const groups = new Map();
  for (const r of rows) {
    const k = String(getKey(r) ?? 'Sin grupo');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }

  container.innerHTML = `
    <div class="ve-grouped-list">
      ${Array.from(groups.entries()).map(([key, items]) => {
        const title = groupLabel ? groupLabel(key, items) : key;
        const summaries = columns
          .filter(c => typeof c.sum === 'function')
          .map(c => `<span class="ve-group-sum">${esc(c.label)}: <strong>${c.sum(items)}</strong></span>`)
          .join('');
        return `
          <details class="ve-group" open>
            <summary class="ve-group-header">
              <span class="ve-group-title">${esc(title)} <span class="badge badge-muted">${items.length}</span></span>
              ${summaries ? `<span class="ve-group-sums">${summaries}</span>` : ''}
            </summary>
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    ${columns.map(c => `<th class="${c.align === 'right' ? 'num' : ''}">${esc(c.label)}</th>`).join('')}
                  </tr>
                </thead>
                <tbody>
                  ${items.map(r => `
                    <tr>
                      ${columns.map(c => `<td class="${c.align === 'right' ? 'num' : ''}">${c.render ? c.render(r) : esc(r[c.key] ?? '')}</td>`).join('')}
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </details>
        `;
      }).join('')}
    </div>
  `;
}

/**
 * Vista Árbol jerárquico (padre -> hijos recursivo).
 */
export function renderHierarchyTree(container, {
  rows = [],
  idKey = 'id',
  parentKey = 'padre_id',
  renderNode,
  emptyText = 'Sin registros.',
} = {}) {
  if (!container) return;
  if (!rows.length) {
    container.innerHTML = `<div class="empty-state">${esc(emptyText)}</div>`;
    return;
  }

  const byId = new Map(rows.map(r => [String(r[idKey]), r]));
  const childrenMap = new Map();
  const roots = [];

  for (const r of rows) {
    const pid = r[parentKey] !== null && r[parentKey] !== undefined && r[parentKey] !== '' ? String(r[parentKey]) : null;
    if (pid && pid !== String(r[idKey]) && byId.has(pid)) {
      if (!childrenMap.has(pid)) childrenMap.set(pid, []);
      childrenMap.get(pid).push(r);
    } else {
      roots.push(r);
    }
  }

  const seen = new Set();
  const buildNode = (node, depth = 0) => {
    const id = String(node[idKey]);
    if (seen.has(id)) return '';
    seen.add(id);
    const kids = childrenMap.get(id) || [];
    const body = renderNode ? renderNode(node, kids, depth) : `<strong>${esc(node.nombre ?? id)}</strong>`;
    if (!kids.length) {
      return `<div class="ve-tree-leaf" data-tree-id="${esc(id)}">${body}</div>`;
    }
    return `
      <details class="ve-tree-node" open data-tree-id="${esc(id)}">
        <summary class="ve-tree-summary">${body} <span class="badge badge-muted">${kids.length}</span></summary>
        <div class="ve-tree-children">
          ${kids.map(k => buildNode(k, depth + 1)).join('')}
        </div>
      </details>
    `;
  };

  container.innerHTML = `<div class="ve-tree">${roots.map(r => buildNode(r, 0)).join('')}</div>`;
}

/**
 * Vista Kanban por columnas de estado/etapa, con drag & drop opcional.
 */
export function renderKanbanBoard(container, {
  columns = [],
  rows = [],
  groupBy = 'estado',
  idKey = 'id',
  renderCard,
  onMove,
  emptyText = 'Sin registros.',
} = {}) {
  if (!container) return;
  const getGroup = typeof groupBy === 'function' ? groupBy : (r) => r?.[groupBy];
  const colDefs = columns.length
    ? columns
    : Array.from(new Set(rows.map(r => String(getGroup(r) ?? 'Sin estado')))).map(id => ({ id, label: id }));

  const buckets = new Map(colDefs.map(c => [String(c.id), []]));
  for (const r of rows) {
    const g = String(getGroup(r) ?? '');
    if (!buckets.has(g)) buckets.set(g, []);
    buckets.get(g).push(r);
  }

  container.innerHTML = `
    <div class="ve-kanban">
      ${Array.from(buckets.entries()).map(([colId, items]) => {
        const def = colDefs.find(c => String(c.id) === colId) || { id: colId, label: colId };
        return `
          <div class="ve-kanban-col" data-kanban-col="${esc(colId)}">
            <div class="ve-kanban-col-head">
              <span>${esc(def.label)}</span>
              <span class="badge badge-muted">${items.length}</span>
            </div>
            <div class="ve-kanban-cards">
              ${items.length
                ? items.map(r => `
                  <div class="ve-kanban-card" ${onMove ? 'draggable="true"' : ''} data-kanban-id="${esc(r[idKey])}" data-kanban-from="${esc(colId)}">
                    ${renderCard ? renderCard(r) : `<strong>${esc(r.nombre || r.codigo || r[idKey])}</strong>`}
                  </div>
                `).join('')
                : `<div class="muted" style="font-size:0.8rem; padding:12px 6px; text-align:center;">${esc(emptyText)}</div>`}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  if (typeof onMove === 'function') {
    let draggedId = null;
    let draggedFrom = null;
    container.querySelectorAll('.ve-kanban-card[draggable="true"]').forEach(card => {
      card.addEventListener('dragstart', (e) => {
        draggedId = card.dataset.kanbanId;
        draggedFrom = card.dataset.kanbanFrom;
        card.classList.add('dragging');
        e.dataTransfer?.setData('text/plain', draggedId);
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
    });
    container.querySelectorAll('.ve-kanban-col').forEach(col => {
      col.addEventListener('dragover', (e) => {
        e.preventDefault();
        col.classList.add('drag-over');
      });
      col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
      col.addEventListener('drop', (e) => {
        e.preventDefault();
        col.classList.remove('drag-over');
        const targetCol = col.dataset.kanbanCol;
        if (!draggedId || targetCol === draggedFrom) return;
        const row = rows.find(r => String(r[idKey]) === String(draggedId));
        onMove(draggedId, targetCol, row);
      });
    });
  }
}
