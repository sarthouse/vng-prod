import { esc, fmtMoney } from '../format.js';
import { createModal } from './modalEngine.js';

/**
 * Motor visual para Matrices Financieras y Operativas (ej. Flujo de Caja con Semanas/Meses en columnas y Conceptos en filas).
 * Soporta:
 * - Primera columna sticky (Concepto) y última columna sticky opcional (Total)
 * - Filas de grupo colapsables/expandibles (group_in, group_out) y filas hijas (item_in, item_out)
 * - Resaltado de columna de período actual (isCurrent) y distinción Histórico vs Proyectado
 * - Drill-down interactivo al hacer clic en cualquier celda con movimientos asociados
 */
export function renderMatrixTable(container, {
  periods = [],
  rows = [],
  formatValue = (v) => fmtMoney(v),
  showTotalCol = true,
  totalColLabel = 'Total / Cierre',
  emptyText = 'Sin períodos para mostrar.',
} = {}) {
  if (!container) return;
  if (!periods.length || !rows.length) {
    container.innerHTML = `<div class="empty-state">${esc(emptyText)}</div>`;
    return;
  }

  const collapsedGroups = container.__veMatrixCollapsed || new Set();
  container.__veMatrixCollapsed = collapsedGroups;

  const openDrillDown = (row, period, items) => {
    createModal({
      title: `${row.label} — ${period.label} (${period.sublabel || ''})`,
      size: 'lg',
      bodyHtml: `
        <div class="table-wrap">
          <table class="data-table no-bulk">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Estado / Origen</th>
                <th>Contraparte / Cuenta</th>
                <th>Concepto</th>
                <th class="num">Importe</th>
              </tr>
            </thead>
            <tbody>
              ${items.map(it => `
                <tr>
                  <td>
                    ${esc(it.fecha || '-')}
                    ${it.vencido ? '<span class="badge badge-warn" style="margin-left:4px;">Vencido</span>' : ''}
                  </td>
                  <td><span class="badge ${String(it.origen).includes('Real') || it.origen === 'Comprometido' ? 'badge-ok' : 'badge-muted'}">${esc(it.origen || '-')}</span></td>
                  <td><strong>${esc(it.contraparte || '-')}</strong></td>
                  <td>${esc(it.concepto || '-')}</td>
                  <td class="num"><strong style="color:${Number(it.monto) >= 0 ? '#15803d' : 'var(--color-accent)'};">${formatValue(it.monto)}</strong></td>
                </tr>
              `).join('')}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="4"><strong>Total (${items.length} movimiento${items.length === 1 ? '' : 's'})</strong></td>
                <td class="num"><strong>${formatValue(items.reduce((s, x) => s + (Number(x.monto) || 0), 0))}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      `,
      footerHtml: `<button type="button" class="btn btn-primary" data-ve-close>Cerrar</button>`,
      onMount: (el, cleanup) => {
        el.querySelector('[data-ve-close]')?.addEventListener('click', cleanup);
      },
    });
  };

  const draw = () => {
    container.innerHTML = `
      <div class="table-wrap ve-matrix-wrap">
        <table class="data-table ve-matrix-table no-bulk">
          <thead>
            <tr>
              <th class="ve-matrix-sticky-col">Concepto / Ítem</th>
              ${periods.map(p => {
                const kindCls = p.isCurrent ? 've-col-current' : p.kind === 'historico' ? 've-col-hist' : 've-col-proy';
                return `
                  <th class="num ${kindCls}">
                    <div class="ve-matrix-col-head">
                      <span>${esc(p.label)}</span>
                      ${p.sublabel ? `<small class="ve-matrix-col-sub">${esc(p.sublabel)}</small>` : ''}
                    </div>
                  </th>
                `;
              }).join('')}
              ${showTotalCol ? `<th class="num ve-matrix-total-col">${esc(totalColLabel)}</th>` : ''}
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => {
              if (r.parent && collapsedGroups.has(r.parent)) return '';
              const isGroup = Array.isArray(r.children) && r.children.length > 0;
              const isCollapsed = isGroup && collapsedGroups.has(r.id);
              const rowTypeCls = `ve-matrix-row-${r.type || 'default'}`;

              const renderValCell = (val, p) => {
                const n = Number(val) || 0;
                const items = p ? (r.details?.[p.key] || []) : [];
                const clickable = items.length > 0;
                const kindCls = p ? (p.isCurrent ? 've-col-current' : p.kind === 'historico' ? 've-col-hist' : 've-col-proy') : 've-matrix-total-col';

                let valCls = '';
                if (Math.abs(n) < 0.005 && r.type !== 'balance_start' && r.type !== 'balance_end') {
                  valCls = 'zero-val';
                } else if (r.type === 'group_in' || r.type === 'item_in') {
                  if (n > 0) valCls = 've-val-pos';
                } else if (r.type === 'group_out' || r.type === 'item_out') {
                  if (n > 0) valCls = 've-val-neg';
                } else if (r.type === 'net' || r.type === 'balance_end' || r.type === 'balance_start') {
                  if (n < 0) valCls = 've-val-neg';
                  else if (n > 0 && r.type === 'net') valCls = 've-val-pos';
                }

                const display = Math.abs(n) < 0.005 && (r.type?.startsWith('item_') || r.type === 'neutral')
                  ? '—'
                  : formatValue(n);

                if (clickable && p) {
                  return `
                    <td class="num ${kindCls} ${valCls} ve-matrix-cell-clickable" data-row-id="${esc(r.id)}" data-period-key="${esc(p.key)}" title="Ver ${items.length} comprobante(s) / evento(s)">
                      <span class="ve-matrix-cell-link">${display}</span>
                    </td>
                  `;
                }
                return `<td class="num ${kindCls} ${valCls}">${display}</td>`;
              };

              return `
                <tr class="${rowTypeCls}">
                  <td class="ve-matrix-sticky-col ${r.parent ? 've-matrix-child-label' : ''}">
                    ${isGroup ? `
                      <button type="button" class="ve-matrix-toggle" data-toggle-group="${esc(r.id)}" aria-expanded="${!isCollapsed}">
                        <span class="ve-matrix-caret">${isCollapsed ? '▸' : '▾'}</span>
                        <strong>${esc(r.label)}</strong>
                      </button>
                    ` : r.type?.startsWith('balance_') || r.type === 'net' ? `
                      <strong>${esc(r.label)}</strong>
                    ` : `
                      <span>${esc(r.label)}</span>
                    `}
                  </td>
                  ${periods.map(p => renderValCell(r.values?.[p.key] ?? 0, p)).join('')}
                  ${showTotalCol ? renderValCell(r.total ?? 0, null) : ''}
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    container.querySelectorAll('[data-toggle-group]').forEach(btn => {
      btn.addEventListener('click', () => {
        const gId = btn.dataset.toggleGroup;
        if (collapsedGroups.has(gId)) collapsedGroups.delete(gId);
        else collapsedGroups.add(gId);
        draw();
      });
    });

    container.querySelectorAll('.ve-matrix-cell-clickable').forEach(td => {
      td.addEventListener('click', () => {
        const rId = td.dataset.rowId;
        const pKey = td.dataset.periodKey;
        const row = rows.find(x => String(x.id) === String(rId));
        const period = periods.find(x => String(x.key) === String(pKey));
        const items = row?.details?.[pKey] || [];
        if (row && period && items.length) {
          openDrillDown(row, period, items);
        }
      });
    });
  };

  draw();
}
