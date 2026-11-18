import { api, toast } from '../../lib/api.js';
import { esc, exportRowsToCSV } from '../../lib/format.js';
import { renderMetaPanel } from '../../lib/metaPanel.js';
import { renderKpiStrip, renderDataTable, renderGroupedList, renderKanbanBoard, renderGanttChart, renderViewSwitcher, renderSpreadsheetTable } from '../../lib/engine/index.js';
import { navigate } from '../../router.js';
import { showConfirmModal } from '../../lib/engine/index.js';

let ordenesViewMode = 'lista';
let ganttSoloPendientes = true;

export async function renderOrdenesView() {
  const root = document.getElementById('app-view');
  const ordenes = await api('/api/ordenes');

  const activas = ordenes.filter(o => o.estado !== 'Completada' && o.estado !== 'Cancelada').length;
  const enProceso = ordenes.filter(o => o.estado === 'En Proceso').length;
  const completadas = ordenes.filter(o => o.estado === 'Completada').length;
  const unidades = ordenes.filter(o => o.estado !== 'Cancelada').reduce((s, o) => s + (Number(o.cantidad) || 0), 0);

  root.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Órdenes</h1>
        <p class="muted">Planificación y seguimiento por etapas productivas asociadas a cada receta y taller.</p>
      </div>
      <div class="actions">
        <div id="ordenes-view-switch"></div>
        <button type="button" id="btn-export-ordenes" class="btn">Exportar CSV</button>
        <a href="/ordenes/nueva" data-link class="btn btn-primary">+ Nueva Orden</a>
      </div>
    </div>

    <div id="ordenes-kpis"></div>
    <div class="card" id="ordenes-table-card"></div>
    <div id="op-meta-panel"></div>
  `;

  root.querySelector('#btn-export-ordenes').addEventListener('click', () => {
    if (!ordenes.length) { toast('No hay órdenes para exportar', true); return; }
    exportRowsToCSV(
      ['Código', 'Producto', 'Receta', 'Fecha Inicio', 'Fecha Objetivo', 'Estado', 'Cantidad', 'Etapas Completadas', 'Etapas Total'],
      ordenes.map(op => [
        op.codigo, op.plantilla_nombre, op.receta_nombre || 'Activa',
        op.fecha_inicio, op.fecha_objetivo || '', op.estado,
        Number(op.cantidad || 0), Number(op.etapas_completadas || 0), Number(op.etapas_total || 0),
      ]),
      `ordenes_produccion_${new Date().toISOString().slice(0, 10)}.csv`
    );
  });

  renderKpiStrip(root.querySelector('#ordenes-kpis'), [
    { label: 'Total Órdenes', value: String(ordenes.length) },
    { label: 'Activas', value: String(activas), tone: activas > 0 ? 'warn' : 'default' },
    { label: 'En Proceso', value: String(enProceso) },
    { label: 'Completadas', value: String(completadas), tone: 'success' },
    { label: 'Unidades Totales', value: String(unidades) },
  ]);

  const columns = [
    { label: 'Orden', render: op => `<a href="/ordenes/${op.id}" data-link class="link-primary"><strong>${esc(op.codigo)}</strong></a>` },
    { label: 'Estado', render: op => `<span class="badge ${op.estado === 'Completada' ? 'badge-ok' : op.estado === 'En Proceso' ? 'badge-warn' : 'badge-confirmado'}">${esc(op.estado)}</span>` },
    { label: 'Producto', render: op => `<strong>${esc(op.plantilla_nombre)}</strong>` },
    { label: 'Receta', render: op => esc(op.receta_nombre || 'Activa') },
    { label: 'Progreso Etapas', render: op => `<span class="badge badge-muted">${op.etapas_completadas} / ${op.etapas_total}</span>` },
    { label: 'Inicio', render: op => esc(op.fecha_inicio) },
    { label: 'Objetivo', render: op => esc(op.fecha_objetivo || '-') },
    { label: 'Cantidad', align: 'right', sum: (grp) => String(grp.reduce((s, o) => s + (Number(o.cantidad) || 0), 0)), render: op => `<strong>${op.cantidad}</strong>` },
    {
      label: 'Acciones',
      render: op => `
        <div class="actions">
          <a href="/ordenes/${op.id}" data-link class="btn btn-sm btn-primary">Abrir</a>
          <button type="button" class="btn btn-sm btn-danger" data-del="${op.id}">Borrar</button>
        </div>
      `,
    },
  ];

  const bindRowActions = () => {
    root.querySelectorAll('[data-meta-op]').forEach(btn => btn.addEventListener('click', () => {
      const op = ordenes.find(x => String(x.id) === String(btn.dataset.metaOp));
      const panel = root.querySelector('#op-meta-panel');
      renderMetaPanel(panel, {
        entidadTipo: 'orden',
        entidadId: btn.dataset.metaOp,
        titulo: `Orden ${op?.codigo || '#' + btn.dataset.metaOp}`,
        record: op || null,
        onClose: () => {},
      });
      panel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }));

    root.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!(await showConfirmModal('¿Eliminar esta orden de producción?'))) return;
        try {
          await api(`/api/ordenes/${btn.dataset.del}`, { method: 'DELETE' });
          toast('Orden eliminada');
          await renderOrdenesView();
        } catch (err) {
          toast(err.message, true);
        }
      });
    });
  };

  const drawBody = () => {
    const container = root.querySelector('#ordenes-table-card');
    renderViewSwitcher(root.querySelector('#ordenes-view-switch'), {
      active: ordenesViewMode,
      modes: [
        { id: 'lista', label: 'Lista' },
        { id: 'agrupada', label: 'Agrupada' },
        { id: 'kanban', label: 'Kanban' },
        { id: 'gantt', label: 'Gantt' },
      ],
      onChange: (mode) => {
        ordenesViewMode = mode;
        drawBody();
      },
    });

    if (ordenesViewMode === 'gantt') {
      const ganttRows = ganttSoloPendientes
        ? ordenes.filter(o => o.estado !== 'Completada' && o.estado !== 'Cancelada')
        : ordenes;
      const toolbarHtml = `
        <div class="sx-7f7d64">
          <div>
            <strong>Cronograma Gantt de Producción</strong>
            <span class="muted sx-450526">Visualización temporal de órdenes y sus etapas por taller (${ganttRows.length} orden${ganttRows.length === 1 ? '' : 'es'})</span>
          </div>
          <label class="checkbox-inline sx-b68435">
            <input type="checkbox" id="cb-gantt-pendientes" ${ganttSoloPendientes ? 'checked' : ''} />
            <span>Solo órdenes pendientes / en proceso</span>
          </label>
        </div>
      `;
      renderGanttChart(container, {
        rows: ganttRows,
        toolbarHtml,
        emptyText: ganttSoloPendientes ? 'No hay órdenes pendientes de producción.' : 'No hay órdenes de producción creadas todavía.',
        labelRender: (op) => `
          <div class="sx-33c883">
            <a href="/ordenes/${op.id}" data-link class="link-primary"><strong>${esc(op.codigo)}</strong></a>
            <span class="badge ${op.estado === 'Completada' ? 'badge-ok' : op.estado === 'En Proceso' ? 'badge-warn' : 'badge-confirmado'} sx-bcf88e">${esc(op.estado)}</span>
          </div>
          <div class="sx-440624">${esc(op.plantilla_nombre)} · <strong>${op.cantidad} u.</strong></div>
          <div class="muted text-2xs">${esc(op.fecha_inicio)} → ${esc(op.fecha_objetivo || '-')} · Etapas: ${op.etapas_completadas}/${op.etapas_total}</div>
        `,
      });
      container.querySelector('#cb-gantt-pendientes')?.addEventListener('change', (e) => {
        ganttSoloPendientes = e.target.checked;
        drawBody();
      });
    } else if (ordenesViewMode === 'agrupada') {
      renderGroupedList(container, {
        emptyText: 'No hay órdenes de producción creadas todavía.',
        groupBy: 'estado',
        columns,
        rows: ordenes,
      });
    } else if (ordenesViewMode === 'kanban') {
      renderKanbanBoard(container, {
        columns: [
          { id: 'Planificada', label: 'Planificada' },
          { id: 'En Proceso', label: 'En Proceso' },
          { id: 'Completada', label: 'Completada' },
          { id: 'Cancelada', label: 'Cancelada' },
        ],
        groupBy: 'estado',
        rows: ordenes,
        emptyText: 'Sin órdenes',
        renderCard: (op) => `
          <div class="sx-631785">
            <a href="/ordenes/${op.id}" data-link class="link-primary"><strong>${esc(op.codigo)}</strong></a>
            <span class="badge badge-muted">${op.cantidad} u.</span>
          </div>
          <div class="sx-be215d">${esc(op.plantilla_nombre)}</div>
          <div class="muted sx-1d2e04">
            Etapas: ${op.etapas_completadas}/${op.etapas_total} · Obj: ${esc(op.fecha_objetivo || '-')}
          </div>
          <div class="actions">
            <a href="/ordenes/${op.id}" data-link class="btn btn-sm">Abrir</a>
          </div>
        `,
      });
    } else {
      renderDataTable(container, {
        emptyText: 'No hay órdenes de producción creadas todavía.',
        exportFilename: `ordenes_produccion_${new Date().toISOString().slice(0, 10)}.csv`,
        bulkActions: [
          {
            id: 'eliminar',
            label: 'Eliminar seleccionadas',
            variant: 'danger',
            confirm: (sel) => `¿Eliminar ${sel.length} orden(es) seleccionada(s)?`,
            onClick: async (sel) => {
              let ok = 0; let errs = 0;
              for (const o of sel) {
                try { await api(`/api/ordenes/${o.id}`, { method: 'DELETE' }); ok++; }
                catch { errs++; }
              }
              toast(`${ok} orden(es) eliminada(s)${errs ? `, ${errs} con error` : ''}`, errs > 0 && ok === 0);
              await renderOrdenesView();
            },
          },
        ],
        columns,
        rows: ordenes,
      });
    }
    bindRowActions();
  };

  drawBody();
}

export async function renderOrdenNuevaView() {
  const root = document.getElementById('app-view');
  const [plantillas, recetas, pedidos, productos] = await Promise.all([
    api('/api/plantillas?se_fabrica=1'),
    api('/api/recetas'),
    api('/api/pedidos'),
    api('/api/productos'),
  ]);

  let selectedPlantillaId = plantillas[0]?.id ? String(plantillas[0].id) : '';
  const today = new Date().toISOString().slice(0, 10);

  const render = () => {
    const prodRecetas = recetas.filter(r => String(r.plantilla_id) === String(selectedPlantillaId));
    const variantes = productos.filter(p => String(p.plantilla_id) === String(selectedPlantillaId));

    root.innerHTML = `
      <div class="page-header">
        <div>
          <div class="mb-xs">
            <a href="/ordenes" data-link class="muted text-md">← Volver a Órdenes</a>
          </div>
          <h1>Nueva Orden de Producción</h1>
          <p class="muted">Genera automáticamente las etapas configuradas y reserva materiales en inventario.</p>
        </div>
      </div>

      <div class="card">
        <form id="form-nueva-orden" class="form-grid">
          <label>
            <span>Producto *</span>
            <div class="sx-c59ad0">
              <select name="plantilla_id" id="orden-plantilla-select" required class="sx-da5cd6">
                <option value="">-- Seleccionar producto --</option>
                ${plantillas.map(p => `<option value="${p.id}" ${String(p.id) === String(selectedPlantillaId) ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}
              </select>
              ${selectedPlantillaId ? `<a href="/plantillas/${selectedPlantillaId}" data-link class="btn btn-sm" title="Ir al detalle del producto">&#8599;</a>` : ''}
            </div>
          </label>
          <label>
            <span>Receta Técnica</span>
            <select name="receta_id">
              <option value="">Usar receta activa del producto</option>
              ${prodRecetas.map(r => `<option value="${r.id}" ${r.activa ? 'selected' : ''}>${esc(r.nombre)}${r.activa ? ' · Activa' : ''}</option>`).join('')}
            </select>
          </label>
          <label>
            <span>Pedido vinculado</span>
            <select name="pedido_id" id="orden-pedido-select">
              <option value="">-- Sin pedido vinculado --</option>
              ${pedidos.map(p => `<option value="${p.id}">#${p.pedido} — ${esc(p.plantilla_nombre)} (${p.cantidad} u.)</option>`).join('')}
            </select>
          </label>
          <label>
            <span>Fecha de Inicio *</span>
            <input type="date" name="fecha_inicio" required value="${today}" />
          </label>
          <label>
            <span>Fecha Objetivo</span>
            <input type="date" name="fecha_objetivo" />
          </label>
          <label>
            <span>Estado *</span>
            <select name="estado">
              <option value="Borrador" selected>Borrador</option>
              <option value="Planificada">Planificada</option>
            </select>
          </label>

          <div class="full">
            <span class="sx-999b07">
              Cantidades por Variante (si vinculás un pedido y dejás todo en 0, copia las cantidades del pedido)
            </span>
            <div id="orden-var-sheet"></div>
          </div>

          <label class="full">
            <span>Notas</span>
            <input type="text" name="notas" placeholder="Observaciones de producción..." />
          </label>

          <div class="full form-footer">
            <a href="/ordenes" data-link class="btn">Cancelar</a>
            <button type="submit" class="btn btn-primary">Crear Orden de Producción</button>
          </div>
        </form>
      </div>
    `;

    const ordenVarRows = variantes.map(v => ({
      producto_id: v.id,
      variante: v.combinacion || v.nombre || '-',
      sku: v.sku || '-',
      cantidad: 0,
    }));
    const varSheetHost = root.querySelector('#orden-var-sheet');
    if (varSheetHost) {
      renderSpreadsheetTable(varSheetHost, {
        rows: ordenVarRows,
        emptyText: 'Este producto no tiene variantes activas.',
        compact: true,
        showDirty: false,
        columns: [
          { key: 'variante', label: 'Variante', type: 'readonly' },
          { key: 'sku', label: 'SKU', type: 'readonly', nowrap: true },
          {
            key: 'cantidad',
            label: 'Cantidad',
            type: 'number',
            min: 0,
            step: 1,
            align: 'right',
            parse: (val) => Math.max(0, Number(val) || 0),
          },
        ],
        onCellChange: () => {},
      });
    }

    root.querySelector('#orden-plantilla-select').addEventListener('change', (e) => {
      selectedPlantillaId = e.target.value;
      render();
    });

    root.querySelector('#form-nueva-orden').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const lineas = ordenVarRows
        .map(r => ({ producto_id: Number(r.producto_id), cantidad: Number(r.cantidad) || 0 }))
        .filter(l => l.cantidad > 0);

      const payload = {
        plantilla_id: Number(fd.get('plantilla_id')),
        receta_id: fd.get('receta_id') ? Number(fd.get('receta_id')) : null,
        pedido_id: fd.get('pedido_id') ? Number(fd.get('pedido_id')) : null,
        fecha_inicio: fd.get('fecha_inicio'),
        fecha_objetivo: fd.get('fecha_objetivo') || null,
        estado: fd.get('estado') || 'Borrador',
        notas: fd.get('notas') || '',
        lineas,
      };

      try {
        const res = await api('/api/ordenes', { method: 'POST', body: JSON.stringify(payload) });
        toast('Orden de producción creada');
        navigate(`/ordenes/${res.id}`);
      } catch (err) {
        toast(err.message, true);
      }
    });
  };

  render();
}
