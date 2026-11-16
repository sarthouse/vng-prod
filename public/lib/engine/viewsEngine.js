import { esc } from '../format.js';

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

/**
 * Vista Cronograma Gantt (con soporte de sub-etapas colapsables, indicador de hoy y barra de progreso).
 */
export function renderGanttChart(container, {
  rows = [],
  startKey = 'fecha_inicio',
  endKey = 'fecha_objetivo',
  labelRender,
  subRowsKey = 'etapas',
  subStartKey = 'fecha_inicio_est',
  subEndKey = 'fecha_fin_est',
  subLabelRender,
  toolbarHtml = '',
  emptyText = 'Sin órdenes ni tareas para graficar en el cronograma.',
} = {}) {
  if (!container) return;

  const parseDay = (iso) => {
    if (!iso || typeof iso !== 'string') return null;
    const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
    return isNaN(d.getTime()) ? null : d;
  };
  const fmtIso = (d) => d.toISOString().slice(0, 10);
  const fmtShort = (iso) => {
    if (!iso || iso.length < 10) return '';
    return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  };
  const addDays = (d, n) => {
    const c = new Date(d.getTime());
    c.setUTCDate(c.getUTCDate() + n);
    return c;
  };
  const diffDays = (a, b) => Math.round((b.getTime() - a.getTime()) / 86400000);

  if (!rows.length) {
    container.innerHTML = `${toolbarHtml}<div class="empty-state">${esc(emptyText)}</div>`;
    return;
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const todayDate = parseDay(todayIso);

  let minDate = null;
  let maxDate = null;

  const touchRange = (s, e) => {
    if (s && (!minDate || s < minDate)) minDate = s;
    if (e && (!maxDate || e > maxDate)) maxDate = e;
  };

  const normalized = rows.map(r => {
    const s = parseDay(r[startKey]) || todayDate;
    let e = parseDay(r[endKey]);
    const subs = Array.isArray(r[subRowsKey]) ? r[subRowsKey] : [];
    const normSubs = subs.map(sr => {
      const ss = parseDay(sr[subStartKey] || sr.fecha_inicio_real) || s;
      let se = parseDay(sr[subEndKey] || sr.fecha_fin_real) || addDays(ss, 2);
      if (se < ss) se = ss;
      touchRange(ss, se);
      return { raw: sr, start: ss, end: se, startIso: fmtIso(ss), endIso: fmtIso(se) };
    });
    if (!e) {
      const maxSub = normSubs.reduce((m, x) => (!m || x.end > m ? x.end : m), null);
      e = maxSub || addDays(s, 7);
    }
    if (e < s) e = s;
    touchRange(s, e);
    return { raw: r, start: s, end: e, startIso: fmtIso(s), endIso: fmtIso(e), subs: normSubs };
  });

  if (!minDate) minDate = todayDate;
  if (!maxDate) maxDate = addDays(minDate, 14);
  minDate = addDays(minDate, -2);
  maxDate = addDays(maxDate, 3);

  const totalDays = Math.max(7, Math.min(180, diffDays(minDate, maxDate) + 1));
  const days = [];
  for (let i = 0; i < totalDays; i++) {
    const d = addDays(minDate, i);
    const iso = fmtIso(d);
    const dow = d.getUTCDay();
    days.push({
      iso,
      dayNum: iso.slice(8, 10),
      monthShort: iso.slice(5, 7),
      isToday: iso === todayIso,
      isWeekend: dow === 0 || dow === 6,
    });
  }

  const todayIdx = days.findIndex(d => d.isToday);
  const todayPct = todayIdx >= 0 ? ((todayIdx + 0.5) / totalDays) * 100 : -1;

  const toneForEstado = (est, endIso) => {
    if (est === 'Completada') return 'ok';
    if (est === 'Cancelada') return 'muted';
    if (endIso && endIso < todayIso) return 'overdue';
    if (est === 'En Proceso') return 'warn';
    return 'info';
  };

  container.innerHTML = `
    ${toolbarHtml}
    <div class="ve-gantt-wrap">
      <div class="ve-gantt" style="--gantt-days:${totalDays};">
        <div class="ve-gantt-header">
          <div class="ve-gantt-col-info">Orden / Etapa</div>
          <div class="ve-gantt-timeline-head">
            ${days.map(d => `
              <div class="ve-gantt-day-head ${d.isToday ? 'is-today' : ''} ${d.isWeekend ? 'is-weekend' : ''}" title="${d.iso}">
                <span class="ve-gantt-m">${d.dayNum === '01' || d === days[0] ? `${d.monthShort}/` : ''}${d.dayNum}</span>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="ve-gantt-body">
          ${normalized.map((item, idx) => {
            const r = item.raw;
            const startOffset = Math.max(0, diffDays(minDate, item.start));
            const duration = Math.max(1, diffDays(item.start, item.end) + 1);
            const leftPct = Math.min(99, (startOffset / totalDays) * 100);
            const widthPct = Math.max(1.5, Math.min(100 - leftPct, (duration / totalDays) * 100));
            const tone = toneForEstado(r.estado, item.endIso);
            const pct = Number(r.etapas_total) > 0
              ? Math.round((Number(r.etapas_completadas || 0) / Number(r.etapas_total)) * 100)
              : (r.estado === 'Completada' ? 100 : 0);

            return `
              <div class="ve-gantt-group" data-gantt-group="${idx}">
                <div class="ve-gantt-row ve-gantt-row-parent">
                  <div class="ve-gantt-col-info">
                    <div class="ve-gantt-info-main">
                      ${item.subs.length ? `<button type="button" class="ve-gantt-toggle" data-gantt-toggle="${idx}" title="Mostrar/ocultar etapas">▾</button>` : '<span style="width:18px;display:inline-block;"></span>'}
                      <div class="ve-gantt-info-text">
                        ${labelRender ? labelRender(r) : `<strong>${esc(r.codigo || r.nombre)}</strong>`}
                      </div>
                    </div>
                  </div>
                  <div class="ve-gantt-timeline-track">
                    ${todayPct >= 0 ? `<div class="ve-gantt-today-line" style="left:${todayPct.toFixed(2)}%;" title="Hoy (${todayIso})"></div>` : ''}
                    <div class="ve-gantt-bar ve-gantt-bar-${tone}" style="left:${leftPct.toFixed(2)}%;width:${widthPct.toFixed(2)}%;" title="${esc(r.codigo || '')} · ${esc(r.plantilla_nombre || '')} (${item.startIso} → ${item.endIso}) · Avance: ${pct}%">
                      <div class="ve-gantt-bar-fill" style="width:${pct}%;"></div>
                      <span class="ve-gantt-bar-label">${esc(r.codigo || '')} · ${r.cantidad || 0} u. (${pct}%)</span>
                    </div>
                  </div>
                </div>
                ${item.subs.map(sub => {
                  const sr = sub.raw;
                  const sOff = Math.max(0, diffDays(minDate, sub.start));
                  const sDur = Math.max(1, diffDays(sub.start, sub.end) + 1);
                  const sLeft = Math.min(99, (sOff / totalDays) * 100);
                  const sWidth = Math.max(1.2, Math.min(100 - sLeft, (sDur / totalDays) * 100));
                  const sTone = toneForEstado(sr.estado, sub.endIso);
                  return `
                    <div class="ve-gantt-row ve-gantt-row-sub" data-gantt-sub="${idx}">
                      <div class="ve-gantt-col-info ve-gantt-col-sub">
                        ${subLabelRender ? subLabelRender(sr, r) : `
                          <span class="muted">${esc(sr.orden_num ? `${sr.orden_num}. ` : '')}${esc(sr.nombre)}</span>
                          ${sr.taller_nombre ? `<span class="badge badge-muted" style="font-size:10px;">${esc(sr.taller_nombre)}</span>` : ''}
                        `}
                      </div>
                      <div class="ve-gantt-timeline-track">
                        ${todayPct >= 0 ? `<div class="ve-gantt-today-line" style="left:${todayPct.toFixed(2)}%;"></div>` : ''}
                        <div class="ve-gantt-bar ve-gantt-bar-sub ve-gantt-bar-${sTone}" style="left:${sLeft.toFixed(2)}%;width:${sWidth.toFixed(2)}%;" title="${esc(sr.nombre)} (${fmtShort(sub.startIso)} → ${fmtShort(sub.endIso)}) · ${esc(sr.estado)}">
                          <span class="ve-gantt-bar-label">${esc(sr.nombre)} (${fmtShort(sub.startIso)}-${fmtShort(sub.endIso)})</span>
                        </div>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            `;
          }).join('')}
        </div>
      </div>
      <div class="ve-gantt-legend">
        <span><i class="ve-gantt-dot ve-gantt-bar-info"></i> Planificada / Pendiente</span>
        <span><i class="ve-gantt-dot ve-gantt-bar-warn"></i> En Proceso</span>
        <span><i class="ve-gantt-dot ve-gantt-bar-overdue"></i> Vencida / Demorada</span>
        <span><i class="ve-gantt-dot ve-gantt-bar-ok"></i> Completada</span>
        <span><i class="ve-gantt-today-swatch"></i> Hoy (${todayIso})</span>
      </div>
    </div>
  `;

  container.querySelectorAll('[data-gantt-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = btn.dataset.ganttToggle;
      const subs = container.querySelectorAll(`[data-gantt-sub="${idx}"]`);
      const isHidden = subs[0]?.classList.contains('is-collapsed');
      subs.forEach(el => el.classList.toggle('is-collapsed', !isHidden));
      btn.textContent = isHidden ? '▾' : '▸';
    });
  });
}
