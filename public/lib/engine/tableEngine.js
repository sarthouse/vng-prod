import { esc, exportRowsToCSV } from '../format.js';
import { showConfirmModal } from './modalEngine.js';

function downloadCsv(filename, headers, matrixRows) {
  exportRowsToCSV(headers, matrixRows, filename || 'seleccion.csv');
}

function stripHtmlText(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
}

function extractSortComparable(val) {
  if (val === null || val === undefined) return { type: 'empty', val: '' };
  if (typeof val === 'number' && !Number.isNaN(val)) return { type: 'num', val };
  const s = String(val).trim();
  if (!s || s === '-') return { type: 'empty', val: '' };
  // Fecha ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return { type: 'str', val: s };
  // Fecha DD/MM/YYYY
  const dmy = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (dmy) return { type: 'str', val: `${dmy[3]}-${dmy[2]}-${dmy[1]}` };
  // Número o moneda formateada ($ 1.234,56 o -1234.56)
  if (/^[-+$€\s]*[\d.,]+(%|\s*[a-zA-Z]{0,3})?$/.test(s)) {
    const clean = s.replace(/[^0-9,.-]/g, '');
    const normalized = clean.includes(',') && clean.includes('.')
      ? (clean.lastIndexOf(',') > clean.lastIndexOf('.') ? clean.replace(/\./g, '').replace(',', '.') : clean.replace(/,/g, ''))
      : clean.includes(',')
        ? clean.replace(',', '.')
        : clean;
    const n = Number(normalized);
    if (!Number.isNaN(n)) return { type: 'num', val: n };
  }
  return { type: 'str', val: s.toLowerCase() };
}

function compareSortValues(a, b, dir = 1) {
  if (a.type === 'empty' && b.type === 'empty') return 0;
  if (a.type === 'empty') return 1;
  if (b.type === 'empty') return -1;
  if (a.type === 'num' && b.type === 'num') return (a.val - b.val) * dir;
  return String(a.val).localeCompare(String(b.val), 'es', { numeric: true }) * dir;
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
        .map((th, i) => ({
          i,
          text: th.dataset.colLabel || th.textContent.trim(),
          skip: th.classList.contains('bulk-col') || th.classList.contains('ve-col-picker-th'),
        }))
        .filter(x => !x.skip && x.text && x.text.toLowerCase() !== 'acciones');
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

const COLUMNS_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line></svg>`;

function renderColPickerThHtml() {
  return `<th class="ve-col-picker-th" title="Mostrar u ocultar columnas"><button type="button" class="ve-col-picker-btn" data-ve-col-toggle aria-label="Mostrar u ocultar columnas" title="Mostrar u ocultar columnas">${COLUMNS_ICON_SVG}</button></th>`;
}

function renderColPickerMenuHtml(toggleableCols, hiddenCols) {
  return `
    <div class="ve-col-menu" data-ve-col-menu hidden>
      <div class="ve-col-menu-title">Columnas visibles</div>
      ${toggleableCols.map(({ id, label }) => `
        <label class="ve-col-option">
          <input type="checkbox" data-ve-col-id="${esc(id)}" ${!hiddenCols.has(id) ? 'checked' : ''} />
          <span>${esc(label)}</span>
        </label>
      `).join('')}
    </div>
  `;
}

let activeColMenuCleanup = null;

function bindHeaderColumnPicker(triggerBtn, menuEl, { hiddenCols, onToggle }) {
  if (!triggerBtn || !menuEl) return;

  const closeMenu = () => {
    menuEl.hidden = true;
    if (activeColMenuCleanup === closeMenu) activeColMenuCleanup = null;
  };

  const positionMenu = () => {
    const rect = triggerBtn.getBoundingClientRect();
    menuEl.style.top = `${Math.min(window.innerHeight - 20, rect.bottom + 4)}px`;
    menuEl.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
    menuEl.style.left = 'auto';
  };

  triggerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = menuEl.hidden;
    if (activeColMenuCleanup && activeColMenuCleanup !== closeMenu) {
      activeColMenuCleanup();
    }
    menuEl.hidden = !willOpen;
    if (willOpen) {
      positionMenu();
      activeColMenuCleanup = closeMenu;
    } else {
      activeColMenuCleanup = null;
    }
  });

  menuEl.addEventListener('click', (e) => e.stopPropagation());

  menuEl.querySelectorAll('[data-ve-col-id]').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.veColId;
      if (cb.checked) hiddenCols.delete(id);
      else hiddenCols.add(id);
      onToggle?.(id, cb.checked);
    });
  });

  if (!document.__veColMenuGlobalBound) {
    document.__veColMenuGlobalBound = true;
    document.addEventListener('click', () => {
      activeColMenuCleanup?.();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') activeColMenuCleanup?.();
    });
    window.addEventListener('scroll', () => {
      activeColMenuCleanup?.();
    }, true);
  }
}

/**
 * Motor genérico de tablas de listado (ListView) con:
 * - Selección y acciones masivas (Shift+Click, Exportar CSV)
 * - Ordenamiento por columna (Click-to-sort en encabezados)
 * - Fila de totales opcional (c.sum / c.footer)
 * - Paginación ligera automática cuando hay más de pageSize filas
 */
export function renderDataTable(container, {
  columns = [],
  rows = [],
  emptyText = 'Sin registros.',
  selectable = true,
  sortable = true,
  paginate = true,
  pageSize = 25,
  pageSizeOptions = [25, 50, 100, 0],
  getRowId,
  bulkActions = [],
  exportFilename = 'seleccion.csv',
  tableKey = '',
} = {}) {
  if (!container) return;
  if (!rows.length) {
    container.innerHTML = `<div class="empty-state">${esc(emptyText)}</div>`;
    return;
  }

  const prefKey = `ve_table_prefs:${tableKey || `${window.location.pathname}:${container.id || 'default'}`}`;
  const loadPrefs = () => {
    try {
      const raw = localStorage.getItem(prefKey);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  };
  const savePrefs = (prefs) => {
    try { localStorage.setItem(prefKey, JSON.stringify(prefs)); } catch {}
  };
  const prefs = loadPrefs();
  const hiddenCols = new Set(Array.isArray(prefs.hiddenCols) ? prefs.hiddenCols : []);
  const getColId = (c, idx) => String(c.key || c.label || `col_${idx}`);

  let sortColIdx = container.__veSortColIdx ?? -1;
  let sortDir = container.__veSortDir ?? 1;
  let currentPage = container.__vePage ?? 1;
  let currentPageSize = container.__vePageSize !== undefined ? container.__vePageSize : pageSize;

  const resolveId = typeof getRowId === 'function' ? getRowId : (r, i) => (r?.id !== undefined && r?.id !== null ? r.id : i);

  const getColSortValue = (row, col) => {
    if (typeof col.sortValue === 'function') return extractSortComparable(col.sortValue(row));
    if (col.key && row[col.key] !== undefined) return extractSortComparable(row[col.key]);
    if (col.render) return extractSortComparable(stripHtmlText(col.render(row)));
    return { type: 'empty', val: '' };
  };

  const drawTable = () => {
    const visibleColumns = columns.filter((c, idx) => {
      const isAction = !c.label || c.label.toLowerCase() === 'acciones';
      return isAction || !hiddenCols.has(getColId(c, idx));
    });
    const activeColumns = visibleColumns.length ? visibleColumns : columns;

    const orderedRows = [...rows];
    if (sortable && sortColIdx >= 0 && sortColIdx < columns.length) {
      const col = columns[sortColIdx];
      orderedRows.sort((a, b) => compareSortValues(getColSortValue(a, col), getColSortValue(b, col), sortDir));
    }

    const totalRows = orderedRows.length;
    const effectiveSize = paginate ? Number(currentPageSize || 0) : 0;
    const totalPages = effectiveSize > 0 ? Math.max(1, Math.ceil(totalRows / effectiveSize)) : 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    container.__vePage = currentPage;

    const startIdx = effectiveSize > 0 ? (currentPage - 1) * effectiveSize : 0;
    const visibleRows = effectiveSize > 0 && totalRows > effectiveSize
      ? orderedRows.slice(startIdx, startIdx + effectiveSize)
      : orderedRows;
    const fromNum = totalRows === 0 ? 0 : startIdx + 1;
    const toNum = startIdx + visibleRows.length;
    const showPager = paginate && totalRows > Math.min(...pageSizeOptions.filter(n => n > 0), pageSize || 25);

    const idList = visibleRows.map((r, i) => String(resolveId(r, i)));
    const hasFooter = activeColumns.some(c => typeof c.sum === 'function' || c.footer !== undefined);
    const toggleableCols = columns
      .map((c, idx) => ({ idx, id: getColId(c, idx), label: c.label }))
      .filter(c => c.label && c.label.toLowerCase() !== 'acciones');
    const showColPicker = toggleableCols.length > 1;

    container.innerHTML = `
      ${selectable ? renderBulkBarHtml(bulkActions) : ''}
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              ${selectable ? '<th class="bulk-col"><input type="checkbox" class="bulk-check" data-bulk-all title="Seleccionar todos" /></th>' : ''}
              ${activeColumns.map((c) => {
                const idx = columns.indexOf(c);
                const isActionCol = !c.label || c.label.toLowerCase() === 'acciones' || c.sortable === false;
                const canSort = sortable && !isActionCol;
                const activeSort = sortColIdx === idx;
                const arrow = activeSort ? (sortDir === 1 ? ' ▲' : ' ▼') : '';
                const cls = [
                  c.align === 'right' ? 'num' : '',
                  canSort ? 've-sortable-th' : '',
                  activeSort ? 've-sorted-th' : '',
                ].filter(Boolean).join(' ');
                return `<th class="${cls}" data-col-label="${esc(c.label)}" ${canSort ? `data-ve-sort="${idx}" title="Ordenar por ${esc(c.label)}"` : ''}>${esc(c.label)}${arrow ? `<span class="ve-sort-ind">${arrow}</span>` : ''}</th>`;
              }).join('')}
              ${showColPicker ? renderColPickerThHtml() : ''}
            </tr>
          </thead>
          <tbody>
            ${visibleRows.map((r, i) => `
              <tr data-row-id="${esc(idList[i])}">
                ${selectable ? `<td class="bulk-col"><input type="checkbox" class="bulk-check" data-bulk-row="${esc(idList[i])}" /></td>` : ''}
                ${activeColumns.map(c => {
                  const content = c.render ? c.render(r) : esc(r[c.key] ?? '');
                  const tdCls = [
                    c.align === 'right' ? 'num' : '',
                    c.nowrap ? 'nowrap' : '',
                  ].filter(Boolean).join(' ');
                  return `<td class="${tdCls}">${content}</td>`;
                }).join('')}
                ${showColPicker ? '<td class="ve-col-picker-td"></td>' : ''}
              </tr>
            `).join('')}
          </tbody>
          ${hasFooter ? `
            <tfoot>
              <tr>
                ${selectable ? '<td class="bulk-col"></td>' : ''}
                ${activeColumns.map((c, idx) => {
                  const content = typeof c.sum === 'function'
                    ? c.sum(orderedRows)
                    : (c.footer !== undefined ? c.footer : (idx === 0 ? 'Totales' : ''));
                  return `<td class="${c.align === 'right' ? 'num' : ''}">${content}</td>`;
                }).join('')}
                ${showColPicker ? '<td class="ve-col-picker-td"></td>' : ''}
              </tr>
            </tfoot>
          ` : ''}
        </table>
      </div>
      ${showColPicker ? renderColPickerMenuHtml(toggleableCols, hiddenCols) : ''}
      ${showPager ? `
        <div class="ve-table-pager">
          <div class="sx-72fafc">
            <span class="muted">Mostrando ${fromNum}–${toNum} de ${totalRows} registros</span>
            <select class="input-sm sx-83b5ce" data-ve-page-size title="Registros por página">
              ${pageSizeOptions.map(opt => `<option value="${opt}" ${Number(currentPageSize) === Number(opt) ? 'selected' : ''}>${opt === 0 ? 'Todos' : `${opt} / pág.`}</option>`).join('')}
            </select>
          </div>
          ${totalPages > 1 ? `
            <div class="ve-pager-controls">
              <button type="button" class="btn btn-sm" data-ve-page="prev" ${currentPage <= 1 ? 'disabled' : ''}>‹ Anterior</button>
              <span class="ve-pager-info">Página ${currentPage} de ${totalPages}</span>
              <button type="button" class="btn btn-sm" data-ve-page="next" ${currentPage >= totalPages ? 'disabled' : ''}>Siguiente ›</button>
            </div>
          ` : ''}
        </div>
      ` : ''}
    `;

    if (selectable) {
      bindBulkBarAndCheckboxes(container, {
        rows: visibleRows,
        idList,
        bulkActions,
        exportColumns: activeColumns,
        exportFilename,
      });
    }

    container.querySelectorAll('[data-ve-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const idx = Number(th.dataset.veSort);
        if (sortColIdx === idx) {
          if (sortDir === 1) sortDir = -1;
          else { sortColIdx = -1; sortDir = 1; }
        } else {
          sortColIdx = idx;
          sortDir = 1;
        }
        container.__veSortColIdx = sortColIdx;
        container.__veSortDir = sortDir;
        drawTable();
      });
    });

    container.querySelector('[data-ve-page-size]')?.addEventListener('change', (e) => {
      currentPageSize = Number(e.target.value);
      container.__vePageSize = currentPageSize;
      currentPage = 1;
      drawTable();
    });
    container.querySelector('[data-ve-page="prev"]')?.addEventListener('click', () => {
      if (currentPage > 1) { currentPage--; drawTable(); }
    });
    container.querySelector('[data-ve-page="next"]')?.addEventListener('click', () => {
      if (currentPage < totalPages) { currentPage++; drawTable(); }
    });

    if (showColPicker) {
      bindHeaderColumnPicker(
        container.querySelector('[data-ve-col-toggle]'),
        container.querySelector('[data-ve-col-menu]'),
        {
          hiddenCols,
          onToggle: () => {
            savePrefs({ hiddenCols: [...hiddenCols] });
            drawTable();
          },
        }
      );
    }
  };

  drawTable();
}

/**
 * Agrega selección, barra de acciones masivas y ordenamiento por columna a una tabla HTML existente.
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
  const tbody = table.querySelector('tbody');
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

    // Habilitar ordenamiento click-to-sort en encabezados de tablas estáticas
    const allThs = Array.from(headTr.children);
    allThs.forEach((colTh, colIdx) => {
      if (colIdx === 0) return;
      const label = colTh.textContent.trim();
      if (!label || label.toLowerCase() === 'acciones') return;
      colTh.dataset.colLabel = label;
      colTh.classList.add('ve-sortable-th');
      colTh.title = `Ordenar por ${label}`;
      colTh.addEventListener('click', () => {
        const prevDir = Number(colTh.dataset.sortDir || 0);
        const nextDir = prevDir === 1 ? -1 : 1;
        allThs.forEach(h => {
          delete h.dataset.sortDir;
          h.classList.remove('ve-sorted-th');
          h.querySelector('.ve-sort-ind')?.remove();
        });
        colTh.dataset.sortDir = String(nextDir);
        colTh.classList.add('ve-sorted-th');
        const ind = document.createElement('span');
        ind.className = 've-sort-ind';
        ind.textContent = nextDir === 1 ? ' ▲' : ' ▼';
        colTh.appendChild(ind);

        const currentTrs = Array.from(tbody.querySelectorAll('tr'));
        currentTrs.sort((trA, trB) => {
          const cellA = trA.children[colIdx]?.textContent || '';
          const cellB = trB.children[colIdx]?.textContent || '';
          return compareSortValues(extractSortComparable(cellA), extractSortComparable(cellB), nextDir);
        });
        currentTrs.forEach(tr => tbody.appendChild(tr));
      });
    });
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

  attachTableToolbar(table);
}

function attachTableToolbar(table) {
  if (!table || table.dataset.veToolbarBound === '1') return;
  const tableWrap = table.closest('.table-wrap') || table;
  const parent = tableWrap.parentNode;
  if (!parent) {
    table.dataset.veToolbarBound = '1';
    return;
  }
  const headTr = table.querySelector('thead tr');
  if (!headTr || headTr.querySelector('.ve-col-picker-th')) {
    table.dataset.veToolbarBound = '1';
    return;
  }
  table.dataset.veToolbarBound = '1';

  const ths = Array.from(headTr.children);
  const toggleable = ths
    .map((th, idx) => ({
      idx,
      id: (th.textContent || '').replace(/[▲▼]/g, '').trim(),
      label: (th.textContent || '').replace(/[▲▼]/g, '').trim(),
      isBulk: th.classList.contains('bulk-col'),
    }))
    .filter(c => !c.isBulk && c.label && c.label.toLowerCase() !== 'acciones');

  if (toggleable.length <= 1) return;

  const firstLabel = toggleable.slice(0, 3).map(c => c.label).join('|');
  const prefKey = `ve_table_prefs:${window.location.pathname}:${table.id || firstLabel || 'manual'}`;
  const loadPrefs = () => {
    try { return JSON.parse(localStorage.getItem(prefKey) || '{}'); } catch { return {}; }
  };
  const savePrefs = (p) => {
    try { localStorage.setItem(prefKey, JSON.stringify(p)); } catch {}
  };

  const prefs = loadPrefs();
  const hiddenCols = new Set(Array.isArray(prefs.hiddenCols) ? prefs.hiddenCols : []);

  const applyPrefs = () => {
    const allRows = table.querySelectorAll('thead tr, tbody tr, tfoot tr');
    allRows.forEach(tr => {
      const cells = Array.from(tr.children);
      if (cells.length === 1 && cells[0].hasAttribute('colspan')) return;
      toggleable.forEach(({ idx, id }) => {
        const cell = cells[idx];
        if (cell) cell.classList.toggle('ve-col-hidden', hiddenCols.has(id));
      });
    });
  };

  const thWrap = document.createElement('tr');
  thWrap.innerHTML = renderColPickerThHtml();
  headTr.appendChild(thWrap.firstElementChild);

  table.querySelectorAll('tbody tr, tfoot tr').forEach(tr => {
    const cells = Array.from(tr.children);
    if (cells.length === 1 && cells[0].hasAttribute('colspan')) {
      cells[0].setAttribute('colspan', String(Number(cells[0].getAttribute('colspan') || 1) + 1));
      return;
    }
    const td = document.createElement('td');
    td.className = 've-col-picker-td';
    tr.appendChild(td);
  });

  const menuWrap = document.createElement('div');
  menuWrap.innerHTML = renderColPickerMenuHtml(toggleable, hiddenCols);
  const colMenu = menuWrap.firstElementChild;
  parent.appendChild(colMenu);

  const colToggle = headTr.querySelector('[data-ve-col-toggle]');
  bindHeaderColumnPicker(colToggle, colMenu, {
    hiddenCols,
    onToggle: () => {
      savePrefs({ hiddenCols: [...hiddenCols] });
      applyPrefs();
    },
  });

  applyPrefs();
}

/**
 * Observa un contenedor raíz (ej. #app-view) y adjunta selección + Exportar CSV + Ordenamiento
 * a cualquier <table class="data-table"> de listado que no esté dentro de un <form> o modal
 * ni tenga la clase .no-bulk ni ya haya sido inicializada.
 */
export function observeTableBulkSelection(rootEl) {
  if (!rootEl || rootEl.dataset.bulkObserverBound) return;
  rootEl.dataset.bulkObserverBound = '1';

  const scan = () => {
    rootEl.querySelectorAll('table.data-table').forEach(table => {
      if (table.closest('form')) return;
      if (table.closest('.ve-modal')) return;
      if (table.classList.contains('no-bulk')) return;
      if (!table.querySelector('thead tr')) return;
      if (table.querySelector('th.bulk-col')) return;
      const tbodyRows = table.querySelectorAll('tbody tr');
      if (!tbodyRows.length) return;
      if (tbodyRows.length === 1 && tbodyRows[0].children.length === 1 && tbodyRows[0].firstElementChild?.hasAttribute('colspan')) return;
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
