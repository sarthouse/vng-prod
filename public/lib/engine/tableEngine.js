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
        .map((th, i) => ({ i, text: th.dataset.colLabel || th.textContent.trim(), isBulk: th.classList.contains('bulk-col') }))
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
  pageSize = 100,
  getRowId,
  bulkActions = [],
  exportFilename = 'seleccion.csv',
} = {}) {
  if (!container) return;
  if (!rows.length) {
    container.innerHTML = `<div class="empty-state">${esc(emptyText)}</div>`;
    return;
  }

  let sortColIdx = container.__veSortColIdx ?? -1;
  let sortDir = container.__veSortDir ?? 1;
  let currentPage = 1;
  let currentPageSize = container.__vePageSize ?? pageSize;

  const resolveId = typeof getRowId === 'function' ? getRowId : (r, i) => (r?.id !== undefined && r?.id !== null ? r.id : i);

  const getColSortValue = (row, col) => {
    if (typeof col.sortValue === 'function') return extractSortComparable(col.sortValue(row));
    if (col.key && row[col.key] !== undefined) return extractSortComparable(row[col.key]);
    if (col.render) return extractSortComparable(stripHtmlText(col.render(row)));
    return { type: 'empty', val: '' };
  };

  const drawTable = () => {
    const orderedRows = [...rows];
    if (sortable && sortColIdx >= 0 && sortColIdx < columns.length) {
      const col = columns[sortColIdx];
      orderedRows.sort((a, b) => compareSortValues(getColSortValue(a, col), getColSortValue(b, col), sortDir));
    }

    const totalRows = orderedRows.length;
    const totalPages = currentPageSize > 0 ? Math.max(1, Math.ceil(totalRows / currentPageSize)) : 1;
    if (currentPage > totalPages) currentPage = totalPages;

    const visibleRows = currentPageSize > 0 && totalRows > currentPageSize
      ? orderedRows.slice((currentPage - 1) * currentPageSize, currentPage * currentPageSize)
      : orderedRows;

    const idList = visibleRows.map((r, i) => String(resolveId(r, i)));
    const hasFooter = columns.some(c => typeof c.sum === 'function' || c.footer !== undefined);

    container.innerHTML = `
      ${selectable ? renderBulkBarHtml(bulkActions) : ''}
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              ${selectable ? '<th class="bulk-col"><input type="checkbox" class="bulk-check" data-bulk-all title="Seleccionar todos" /></th>' : ''}
              ${columns.map((c, idx) => {
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
            </tr>
          </thead>
          <tbody>
            ${visibleRows.map((r, i) => `
              <tr data-row-id="${esc(idList[i])}">
                ${selectable ? `<td class="bulk-col"><input type="checkbox" class="bulk-check" data-bulk-row="${esc(idList[i])}" /></td>` : ''}
                ${columns.map(c => {
                  const content = c.render ? c.render(r) : esc(r[c.key] ?? '');
                  return `<td class="${c.align === 'right' ? 'num' : ''}">${content}</td>`;
                }).join('')}
              </tr>
            `).join('')}
          </tbody>
          ${hasFooter ? `
            <tfoot>
              <tr>
                ${selectable ? '<td class="bulk-col"></td>' : ''}
                ${columns.map((c, idx) => {
                  const content = typeof c.sum === 'function'
                    ? c.sum(orderedRows)
                    : (c.footer !== undefined ? c.footer : (idx === 0 ? 'Totales' : ''));
                  return `<td class="${c.align === 'right' ? 'num' : ''}">${content}</td>`;
                }).join('')}
              </tr>
            </tfoot>
          ` : ''}
        </table>
      </div>
      ${totalRows > 50 ? `
        <div class="ve-table-pager">
          <span class="muted">Mostrando ${visibleRows.length} de ${totalRows} registros</span>
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
        exportColumns: columns,
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

    container.querySelector('[data-ve-page="prev"]')?.addEventListener('click', () => {
      if (currentPage > 1) { currentPage--; drawTable(); }
    });
    container.querySelector('[data-ve-page="next"]')?.addEventListener('click', () => {
      if (currentPage < totalPages) { currentPage++; drawTable(); }
    });
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
