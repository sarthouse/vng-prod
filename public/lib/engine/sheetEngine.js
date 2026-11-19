import { esc } from '../format.js';
import { mountMultiSelect, mountCombobox } from '../autocomplete.js';

const TRASH_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>`;

/**
 * Motor de tabla tipo hoja de cálculo (Spreadsheet Grid) para edición rápida inline,
 * navegación por teclado (Tab, Enter, Flechas, Esc) y pegado TSV desde Excel/Sheets.
 */
export function renderSpreadsheetTable(container, opts = {}) {
  const {
    columns = [],
    rows = [],
    emptyText = 'Sin registros.',
    getRowId = (r, i) => r?.id ?? i,
    onCellChange = null,
    onDeleteRow = null,
    canDeleteRow = null,
    onAddRow = null,
    addRowLabel = '+ Agregar línea',
    defaultNewRow = null,
    onCreateRow = null,
    extraActions = null,
    footerHtml = '',
    tfootHtml = '',
    tfootId = '',
    compact = true,
    pasteEnabled = true,
    showDirty = true,
    className = '',
    groupBy = null,
    renderGroupRow = null,
    defaultCollapsed = false,
  } = opts;
  if (!container) return;

  const collapsedGroups = container.__veSheetCollapsed || new Set();
  container.__veSheetCollapsed = collapsedGroups;

  let groupedEntries = null;
  let visibleRows = rows;
  if (groupBy) {
    const getGroupKey = typeof groupBy === 'function' ? groupBy : (r) => String(r?.[groupBy] ?? '');
    const map = new Map();
    for (const r of rows) {
      const k = getGroupKey(r);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    }
    groupedEntries = Array.from(map.entries());
    if (defaultCollapsed && !container.__veSheetCollapsedInit) {
      for (const [k] of groupedEntries) collapsedGroups.add(k);
      container.__veSheetCollapsedInit = true;
    }
    visibleRows = [];
    for (const [k, gRows] of groupedEntries) {
      if (!collapsedGroups.has(k)) visibleRows.push(...gRows);
    }
  }

  const hasBlankAppend = typeof defaultNewRow === 'function';
  const displayRows = hasBlankAppend
    ? [...visibleRows, { ...defaultNewRow(), __isNew: true }]
    : visibleRows;

  if (!rows.length && !hasBlankAppend && !footerHtml && !onAddRow) {
    container.innerHTML = `<div class="empty-state">${esc(emptyText)}</div>`;
    return;
  }

  let focused = null; // { r, c }
  let editing = null; // { r, c, prevVal }
  const dirtyCells = new Set();

  const isColEditable = (col, row) => {
    if (!col || col.type === 'readonly' || !col.type) return false;
    if (typeof col.editable === 'function') return Boolean(col.editable(row));
    if (col.editable === false) return false;
    return true;
  };

  const getCellRawValue = (row, col) => {
    if (!row || !col) return '';
    if (typeof col.getValue === 'function') return col.getValue(row);
    return row[col.key] ?? '';
  };

  const renderCellDisplay = (row, col, rIdx) => {
    if (typeof col.render === 'function') return col.render(row, rIdx);
    const val = getCellRawValue(row, col);
    if (col.type === 'checkbox') {
      return Number(val) === 1 || val === true
        ? '<span class="badge badge-ok">Sí</span>'
        : '<span class="muted">-</span>';
    }
    if (col.type === 'select') {
      const opts = typeof col.options === 'function' ? col.options(row) : (col.options || []);
      const found = opts.find(o => String(o.value) === String(val));
      return esc(found ? found.label : (val ?? ''));
    }
    return esc(val ?? '');
  };

  const hasActionsCol = Boolean(onDeleteRow || extraActions);

  const renderDataRow = (r, rIdx) => {
    const rid = r.__isNew ? '__new__' : String(getRowId(r, rIdx));
    return `
      <tr data-sheet-row="${rIdx}" data-row-id="${esc(rid)}" ${r.__isNew ? 'class="ve-sheet-new-row"' : ''}>
        ${columns.map((c, cIdx) => {
          const editable = isColEditable(c, r);
          const cls = [
            've-sheet-cell',
            editable ? 'is-editable' : 'is-readonly',
            c.align === 'right' ? 'num' : c.align === 'center' ? 'text-center' : '',
            c.nowrap ? 'nowrap' : '',
          ].filter(Boolean).join(' ');
          return `<td class="${cls}" ${editable ? 'tabindex="0"' : ''} data-r="${rIdx}" data-c="${cIdx}">${renderCellDisplay(r, c, rIdx)}</td>`;
        }).join('')}
        ${hasActionsCol ? `
          <td class="actions nowrap">
            <div class="actions">
              ${!r.__isNew && typeof extraActions === 'function' ? extraActions(r, rIdx) : ''}
              ${!r.__isNew && onDeleteRow && (typeof canDeleteRow !== 'function' || canDeleteRow(r, rIdx)) ? `<button type="button" class="btn btn-sm btn-danger" data-sheet-del="${rIdx}" title="Eliminar fila" aria-label="Eliminar fila">${TRASH_ICON_SVG}</button>` : ''}
            </div>
          </td>
        ` : ''}
      </tr>
    `;
  };

  let tbodyHtml = '';
  if (groupedEntries) {
    let cursor = 0;
    for (const [gKey, gRows] of groupedEntries) {
      const isCollapsed = collapsedGroups.has(gKey);
      const caretHtml = `<span class="ve-matrix-caret" style="display:inline-block;width:14px;">${isCollapsed ? '▸' : '▾'}</span>`;
      if (typeof renderGroupRow === 'function') {
        tbodyHtml += `<tr class="ve-sheet-group-row" data-sheet-group="${esc(gKey)}" style="cursor:pointer;background:var(--color-surface-alt, rgba(0,0,0,0.02));">${renderGroupRow(gKey, gRows, isCollapsed, caretHtml)}</tr>`;
      } else {
        tbodyHtml += `<tr class="ve-sheet-group-row" data-sheet-group="${esc(gKey)}" style="cursor:pointer;background:var(--color-surface-alt, rgba(0,0,0,0.02));"><td colspan="${columns.length + (hasActionsCol ? 1 : 0)}">${caretHtml} <strong>${esc(gKey)}</strong> <span class="badge badge-muted">${gRows.length}</span></td></tr>`;
      }
      if (!isCollapsed) {
        for (const r of gRows) {
          tbodyHtml += renderDataRow(r, cursor++);
        }
      }
    }
    if (hasBlankAppend) {
      tbodyHtml += renderDataRow(displayRows[cursor], cursor);
    }
  } else {
    tbodyHtml = displayRows.map((r, rIdx) => renderDataRow(r, rIdx)).join('');
  }

  container.innerHTML = `
    <div class="table-wrap">
      <table class="data-table ve-sheet-table ${compact ? 've-table-compact' : ''} ${esc(className)} no-bulk">
        <thead>
          <tr>
            ${columns.map(c => `<th class="${c.align === 'right' ? 'num' : c.align === 'center' ? 'text-center' : ''}">${esc(c.label)}</th>`).join('')}
            ${hasActionsCol ? '<th>Acciones</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${tbodyHtml}
          ${footerHtml || ''}
        </tbody>
        ${tfootHtml ? `<tfoot${tfootId ? ` id="${esc(tfootId)}"` : ''}>${tfootHtml}</tfoot>` : ''}
      </table>
    </div>
    ${onAddRow ? `<div class="mt-sm"><button type="button" class="btn btn-sm" data-sheet-add>${esc(addRowLabel)}</button></div>` : ''}
  `;

  const table = container.querySelector('.ve-sheet-table');
  if (!table) return;

  if (groupedEntries) {
    table.querySelectorAll('[data-sheet-group]').forEach(tr => {
      tr.addEventListener('click', (e) => {
        if (e.target.closest('a, button, input, select')) return;
        const gKey = tr.dataset.sheetGroup;
        if (collapsedGroups.has(gKey)) collapsedGroups.delete(gKey);
        else collapsedGroups.add(gKey);
        renderSpreadsheetTable(container, opts);
      });
    });
  }

  const getCellEl = (r, c) => table.querySelector(`td[data-r="${r}"][data-c="${c}"]`);

  const setFocus = (r, c) => {
    table.querySelectorAll('.ve-sheet-cell.is-focused').forEach(el => el.classList.remove('is-focused'));
    const el = getCellEl(r, c);
    if (el) {
      focused = { r, c };
      el.classList.add('is-focused');
      el.focus({ preventScroll: false });
    }
  };

  const moveFocus = (r, c, dr, dc) => {
    let nr = r + dr;
    let nc = c + dc;
    const totalR = displayRows.length;
    const totalC = columns.length;
    if (dc !== 0) {
      let steps = 0;
      while (steps < totalR * totalC) {
        if (nc >= totalC) { nc = 0; nr++; }
        if (nc < 0) { nc = totalC - 1; nr--; }
        if (nr < 0 || nr >= totalR) return;
        if (isColEditable(columns[nc], displayRows[nr])) { setFocus(nr, nc); return; }
        nc += dc > 0 ? 1 : -1;
        steps++;
      }
      return;
    }
    while (nr >= 0 && nr < totalR) {
      if (isColEditable(columns[nc], displayRows[nr])) { setFocus(nr, nc); return; }
      nr += dr > 0 ? 1 : -1;
    }
  };

  const commitValue = async (r, c, newVal, el) => {
    const row = displayRows[r];
    const col = columns[c];
    const prevVal = getCellRawValue(row, col);
    const parsed = typeof col.parse === 'function' ? col.parse(newVal) : newVal;

    editing = null;
    el.classList.remove('is-editing');

    if (String(parsed ?? '') === String(prevVal ?? '')) {
      el.innerHTML = renderCellDisplay(row, col, r);
      return;
    }

    row[col.key] = parsed;
    dirtyCells.add(`${r}:${c}`);
    el.classList.add('is-saving');
    el.innerHTML = renderCellDisplay(row, col, r);

    if (row.__isNew && typeof onCreateRow === 'function') {
      try {
        const res = await onCreateRow({ row, key: col.key, value: parsed, prevValue: prevVal });
        el.classList.remove('is-saving', 'is-error');
        if (res !== false) {
          // Si onCreateRow devolvió true/objeto, promovemos la fila en memoria y re-renderizamos para generar una nueva fila vacía debajo
          if (!rows.includes(row)) {
            delete row.__isNew;
            rows.push(row);
          }
          renderSpreadsheetTable(container, opts);
        }
      } catch (err) {
        row[col.key] = prevVal;
        el.classList.remove('is-saving');
        el.classList.add('is-error');
        el.innerHTML = renderCellDisplay(row, col, r);
      }
      return;
    }

    if (typeof onCellChange === 'function') {
      try {
        await onCellChange({ row, rowIndex: r, key: col.key, value: parsed, prevValue: prevVal, cellEl: el });
        el.classList.remove('is-saving', 'is-error');
        if (showDirty) el.classList.add('is-dirty');
        // Re-renderizar celdas readonly de la misma fila (ej. subtotales calculados)
        columns.forEach((colDef, ci) => {
          if (colDef.type === 'readonly' || colDef.recomputeOnRowChange) {
            const cEl = getCellEl(r, ci);
            if (cEl) cEl.innerHTML = renderCellDisplay(row, colDef, r);
          }
        });
      } catch (err) {
        row[col.key] = prevVal;
        el.classList.remove('is-saving');
        el.classList.add('is-error');
        el.innerHTML = renderCellDisplay(row, col, r);
      }
    } else {
      el.classList.remove('is-saving');
      if (showDirty) el.classList.add('is-dirty');
    }
  };

  const startEdit = (r, c, initialChar = null) => {
    const row = displayRows[r];
    const col = columns[c];
    const el = getCellEl(r, c);
    if (!el || !isColEditable(col, row)) return;
    if (editing && (editing.r !== r || editing.c !== c)) {
      const prevEl = getCellEl(editing.r, editing.c);
      const inp = prevEl?.querySelector('input, select');
      if (inp) commitValue(editing.r, editing.c, inp.value, prevEl);
    }

    const curVal = getCellRawValue(row, col);
    if (col.type === 'checkbox') {
      const nextBool = !(Number(curVal) === 1 || curVal === true);
      commitValue(r, c, nextBool ? 1 : 0, el);
      return;
    }

    if (col.type === 'chips' || col.type === 'multiselect') {
      editing = { r, c, prevVal: curVal };
      el.classList.add('is-editing');
      const opts = typeof col.options === 'function' ? col.options(row) : (col.options || []);
      let currentVals = Array.isArray(curVal) ? [...curVal] : [];
      el.innerHTML = '<div class="ve-sheet-chips-host"></div>';
      const host = el.querySelector('.ve-sheet-chips-host');
      const multi = mountMultiSelect(host, {
        values: currentVals,
        placeholder: col.placeholder || 'Seleccionar...',
        items: opts,
        onChange: (vals) => { currentVals = vals; },
      });
      const closeAndCommit = (e) => {
        if (el.contains(e.target) || e.target.closest?.('.combo-menu')) return;
        document.removeEventListener('mousedown', closeAndCommit, true);
        commitValue(r, c, multi ? multi.getValues() : currentVals, el);
      };
      setTimeout(() => document.addEventListener('mousedown', closeAndCommit, true), 0);
      host.querySelector('input')?.focus();
      return;
    }

    if (col.type === 'select' || col.type === 'combobox') {
      editing = { r, c, prevVal: curVal };
      el.classList.add('is-editing');
      const opts = typeof col.options === 'function' ? col.options(row) : (col.options || []);
      el.innerHTML = '<div class="ve-sheet-combo-host"></div>';
      const host = el.querySelector('.ve-sheet-combo-host');
      let committed = false;
      const cleanupAndCommit = async (val, rawItem = null) => {
        if (committed) return;
        committed = true;
        document.removeEventListener('mousedown', onOutside, true);
        if (rawItem && typeof col.onPickItem === 'function') await col.onPickItem(row, rawItem);
        await commitValue(r, c, val, el);
      };
      const onOutside = (e) => {
        if (el.contains(e.target) || e.target.closest?.('.combo-menu')) return;
        committed = true;
        document.removeEventListener('mousedown', onOutside, true);
        editing = null;
        el.classList.remove('is-editing');
        el.innerHTML = renderCellDisplay(row, col, r);
      };
      mountCombobox(host, {
        value: curVal !== undefined && curVal !== null ? String(curVal) : '',
        items: opts.map(o => ({ value: String(o.value), label: o.label, raw: o.raw })),
        placeholder: col.placeholder || 'Elegir...',
        onSelect: (it) => {
          if (it) cleanupAndCommit(it.value, it.raw || it);
        },
      });
      setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);
      const inp = host.querySelector('input');
      if (inp) {
        inp.focus();
        inp.click();
      }
      return;
    }

    editing = { r, c, prevVal: curVal };
    el.classList.add('is-editing');

    const editor = document.createElement('input');
    editor.className = 've-sheet-input';
    editor.type = col.type === 'number' ? 'number' : (col.type === 'date' ? 'date' : 'text');
    if (col.type === 'number') {
      if (col.step !== undefined) editor.step = String(col.step);
      if (col.min !== undefined) editor.min = String(col.min);
      if (col.max !== undefined) editor.max = String(col.max);
      editor.classList.add('num');
    }
    editor.value = initialChar !== null ? initialChar : String(curVal ?? '');

    el.innerHTML = '';
    el.appendChild(editor);
    editor.focus();
    if (initialChar === null) editor.select();

    let finished = false;
    const finish = (save, moveDir = null) => {
      if (finished) return;
      finished = true;
      if (save) {
        commitValue(r, c, editor.value, el);
      } else {
        editing = null;
        el.classList.remove('is-editing');
        el.innerHTML = renderCellDisplay(row, col, r);
      }
      if (moveDir) moveFocus(r, c, moveDir.dr, moveDir.dc);
      else setFocus(r, c);
    };

    editor.addEventListener('click', (e) => e.stopPropagation());
    editor.addEventListener('mousedown', (e) => e.stopPropagation());
    editor.addEventListener('blur', () => {
      if (!finished) finish(true);
    });
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        finish(true, { dr: 1, dc: 0 });
      } else if (e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        finish(true, { dr: 0, dc: e.shiftKey ? -1 : 1 });
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      }
    });
  };

  table.querySelectorAll('td.ve-sheet-cell.is-editable').forEach(el => {
    const r = Number(el.dataset.r);
    const c = Number(el.dataset.c);

    el.addEventListener('click', () => {
      if (editing && editing.r === r && editing.c === c) return;
      setFocus(r, c);
      startEdit(r, c);
    });

    el.addEventListener('keydown', (e) => {
      if (editing && editing.r === r && editing.c === c) return;
      if (e.key === 'Enter' || e.key === 'F2' || e.key === ' ') {
        e.preventDefault();
        startEdit(r, c);
      } else if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) {
        e.preventDefault();
        moveFocus(r, c, 0, 1);
      } else if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) {
        e.preventDefault();
        moveFocus(r, c, 0, -1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveFocus(r, c, 1, 0);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveFocus(r, c, -1, 0);
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (columns[c].type === 'text' || columns[c].type === 'number') {
          e.preventDefault();
          startEdit(r, c, e.key);
        }
      }
    });
  });

  if (pasteEnabled) {
    table.addEventListener('paste', async (e) => {
      if (!focused || editing) return;
      const text = e.clipboardData?.getData('text/plain');
      if (!text || (!text.includes('\t') && !text.includes('\n'))) return;
      e.preventDefault();
      const matrix = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').map(line => line.split('\t'));
      for (let dr = 0; dr < matrix.length; dr++) {
        const rr = focused.r + dr;
        if (rr >= displayRows.length) break;
        for (let dc = 0; dc < matrix[dr].length; dc++) {
          const cc = focused.c + dc;
          if (cc >= columns.length) break;
          if (!isColEditable(columns[cc], displayRows[rr])) continue;
          const cellEl = getCellEl(rr, cc);
          if (cellEl) await commitValue(rr, cc, matrix[dr][dc].trim(), cellEl);
        }
      }
    });
  }

  if (onDeleteRow) {
    table.querySelectorAll('[data-sheet-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const rIdx = Number(btn.dataset.sheetDel);
        onDeleteRow(displayRows[rIdx], rIdx);
      });
    });
  }

  if (onAddRow) {
    container.querySelector('[data-sheet-add]')?.addEventListener('click', () => {
      onAddRow();
    });
  }
}
