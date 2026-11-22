import { api, toast } from '../../lib/api.js';
import { esc, fmtNum, fmtMoney, badgeForTipo } from '../../lib/format.js';
import { renderMetaPanel } from '../../lib/metaPanel.js';
import { openPdfFromEndpoint } from '../../lib/print/index.js';
import { mountDetailView, createModal, renderGanttChart, showConfirmModal, renderSpreadsheetTable } from '../../lib/engine/index.js';

const PLAY_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
const CHECK_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

export async function renderOrdenDetalleView({ id }) {
  const root = document.getElementById('app-view');
  const [detail, talleres, operaciones, compras, planCuentas] = await Promise.all([
    api(`/api/ordenes/${id}`),
    api('/api/contactos?es_taller=1'),
    api('/api/operaciones-stock').catch(() => []),
    api('/api/compras').catch(() => []),
    api('/api/tesoreria/plan-cuentas').catch(() => []),
  ]);

  const { orden, lineas, etapas, insumos, movimientos } = detail;
  const opsOrden = (operaciones || []).filter(o => o.referencia_tipo === 'orden' && Number(o.referencia_id) === Number(id));
  const comprasOrden = (compras || []).filter(c => Number(c.orden_id) === Number(id));
  const cuentasEgreso = (planCuentas || []).filter(c => Number(c.activo) !== 0 && Number(c.imputable) !== 0 && (c.tipo === 'egreso' || c.tipo === 'activo'));

  const costoEst = Number(orden.costo_procesos_est || 0);
  const costoReal = Number(orden.costo_procesos_real || 0);
  const desvio = costoReal - costoEst;

  const cantidadesHtml = `
    <div class="card">
      <div class="card-header">
        <div>
          <h2>Cantidades de la Orden</h2>
          <span class="muted text-sm">Podés registrar ingresos parciales de producto terminado a medida que salen del taller o completar todo al cierre.</span>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Concepto</th>
              ${(lineas || []).map(l => `<th class="num">${esc(l.combinacion || l.sku || l.producto_nombre)}</th>`).join('')}
              <th class="num">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Planificado</strong></td>
              ${(lineas || []).map(l => `<td class="num">${fmtNum(l.cantidad)}</td>`).join('')}
              <td class="num"><strong>${fmtNum(orden.cantidad)}</strong></td>
            </tr>
            <tr>
              <td><strong>Ingresado</strong></td>
              ${(lineas || []).map(l => `<td class="num text-success">${fmtNum(l.cantidad_ingresada || 0)}</td>`).join('')}
              <td class="num"><strong class="text-success">${fmtNum(orden.cantidad_ingresada || 0)}</strong></td>
            </tr>
            <tr>
              <td><strong>Pendiente</strong></td>
              ${(lineas || []).map(l => `<td class="num" style="color:${Number(l.cantidad_pendiente) > 0 ? 'var(--color-accent)' : 'var(--color-muted)'};">${fmtNum(l.cantidad_pendiente ?? l.cantidad)}</td>`).join('')}
              <td class="num"><strong style="color:${Number(orden.cantidad_pendiente) > 0 ? 'var(--color-accent)' : 'var(--color-muted)'};">${fmtNum(orden.cantidad_pendiente ?? orden.cantidad)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  const etapasHtml = `
    <div class="card">
      <div class="card-header"><h2>Etapas de Producción</h2></div>
      <div id="orden-etapas-sheet"></div>
    </div>
    <div class="card sx-553a64">
      <div class="card-header">
        <div>
          <h2>Cronograma Gantt de Etapas</h2>
          <span class="muted text-sm">Secuencia temporal estimada y real por etapa y taller asignado.</span>
        </div>
      </div>
      <div id="orden-det-gantt"></div>
    </div>
  `;

  const insumosHtml = `
    <div class="card">
      <div class="card-header"><h2>Materiales y Servicios por Etapa</h2></div>
      ${(insumos || []).length === 0 ? `
        <div class="empty-state">No hay insumos asociados a la receta de esta orden.</div>
      ` : `
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Etapa</th>
                <th>Producto / Insumo</th>
                <th>Tipo</th>
                <th>Proveedor</th>
                <th class="num">Requerido</th>
                <th class="num">Stock Actual</th>
              </tr>
            </thead>
            <tbody>
              ${insumos.map(c => `
                <tr>
                  <td><span class="badge badge-muted">${esc(c.etapa_nombre)}</span></td>
                  <td><strong>${esc(c.producto_nombre)}</strong></td>
                  <td>${badgeForTipo(c.producto_tipo)}</td>
                  <td>${esc(c.proveedor_nombre || '-')}</td>
                  <td class="num"><strong>${fmtNum(c.cantidad_requerida)} ${esc(c.udm)}</strong></td>
                  <td class="num">${c.producto_tipo === 'servicio' ? '-' : `${fmtNum(c.stock_actual)} ${esc(c.udm)}`}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;

  const movimientosHtml = `
    <div class="card">
      <div class="card-header"><h2>Movimientos de Stock Generados</h2></div>
      ${movimientos.length === 0 ? `
        <div class="empty-state">Todavía no se generaron movimientos de stock para esta orden.</div>
      ` : `
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Producto</th>
                <th class="num">Cantidad</th>
                <th class="num">Stock Resultante</th>
                <th>Nota</th>
              </tr>
            </thead>
            <tbody>
              ${movimientos.map(m => `
                <tr>
                  <td>${esc(m.fecha)}</td>
                  <td><strong>${esc(m.producto_nombre)}</strong></td>
                  <td class="num">${fmtNum(m.cantidad)} ${esc(m.udm)}</td>
                  <td class="num">${fmtNum(m.stock_resultante)} ${esc(m.udm)}</td>
                  <td class="muted">${esc(m.nota || '-')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;

  const vinculadosHtml = (opsOrden.length || comprasOrden.length) ? `
    <div class="card">
      <div class="card-header"><h2>Documentos Vinculados</h2></div>
      <div class="actions sx-30973c">
        ${opsOrden.map(o => `<a href="/operaciones-stock/${o.id}" data-link class="btn btn-sm">${esc(o.tipo || 'Operación')}: ${esc(o.numero)} (${esc(o.estado)})</a>`).join('')}
        ${comprasOrden.map(c => `<a href="/compras/${c.id}" data-link class="btn btn-sm">Compra: ${esc(c.numero || '#' + c.id)} — ${esc(c.proveedor_nombre)} (${esc(c.estado)})</a>${c.asiento_id ? `<a href="/contabilidad" data-link class="badge badge-muted" title="Ver asiento contable de la compra">Asiento #${c.asiento_id}</a>` : ''}`).join('')}
      </div>
    </div>
  ` : '';

  mountDetailView(root, {
    breadcrumb: { label: 'Volver a Órdenes', href: '/ordenes' },
    title: `${orden.codigo} — ${orden.plantilla_nombre}`,
    subtitle: `Receta: ${esc(orden.receta_nombre || 'Activa')} · Inicio: ${esc(orden.fecha_inicio)} · Objetivo: ${esc(orden.fecha_objetivo || '-')}`,
    badge: {
      text: orden.estado,
      className: orden.estado === 'Completada' ? 'badge-ok' : orden.estado === 'En Proceso' ? 'badge-warn' : orden.estado === 'Cancelada' ? 'badge-cancelado' : 'badge-confirmado',
    },
    actions: [
      {
        label: 'Imprimir PDF',
        onClick: async () => {
          try {
            await openPdfFromEndpoint('/api/print/orden-pdf', detail, `Orden_${orden.codigo || id}.pdf`);
          } catch (err) {
            toast(err.message, true);
          }
        },
      },
      ...(Number(orden.cantidad_pendiente ?? orden.cantidad) > 0 ? [{
        label: '+ Ingresar Terminado',
        onClick: () => {
          const hoy = new Date().toISOString().slice(0, 10);
          createModal({
            title: `Ingreso de Producto Terminado — ${orden.codigo}`,
            size: 'md',
            bodyHtml: `
              <div class="form-grid">
                <label><span>Fecha *</span><input type="date" id="mod-ing-fecha" value="${hoy}" /></label>
                <label><span>Lote</span><input type="text" id="mod-ing-lote" value="${esc(orden.codigo)}" /></label>
                <label class="full"><span>Observación</span><input type="text" id="mod-ing-nota" placeholder="Ej: 1ra tanda recibida de taller..." /></label>
              </div>
              <div class="table-wrap sx-5371db">
                <table class="data-table no-bulk">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th class="num">Planificado</th>
                      <th class="num">Ingresado</th>
                      <th class="num">Pendiente</th>
                      <th class="num">A Ingresar</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${(lineas || []).map(l => `
                      <tr>
                        <td><strong>${esc(l.producto_nombre || l.combinacion || l.sku)}</strong></td>
                        <td class="num muted">${fmtNum(l.cantidad)}</td>
                        <td class="num muted">${fmtNum(l.cantidad_ingresada || 0)}</td>
                        <td class="num"><strong>${fmtNum(l.cantidad_pendiente ?? l.cantidad)}</strong></td>
                        <td class="num">
                          <input type="number" step="1" min="0" max="${l.cantidad_pendiente ?? l.cantidad}" class="mod-ing-qty num sx-3e7d9e" data-pid="${l.producto_id}" value="${l.cantidad_pendiente ?? l.cantidad}" />
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `,
            footerHtml: `
              <button type="button" class="btn" data-ve-cancel>Cancelar</button>
              <button type="button" class="btn btn-primary" data-ve-ok>Confirmar Ingreso</button>
            `,
            onMount: (el, cleanup) => {
              el.querySelector('[data-ve-cancel]')?.addEventListener('click', cleanup);
              el.querySelector('[data-ve-ok]')?.addEventListener('click', async () => {
                try {
                  const reqLineas = Array.from(el.querySelectorAll('.mod-ing-qty')).map(inp => ({
                    producto_id: Number(inp.dataset.pid),
                    cantidad: Number(inp.value) || 0,
                  })).filter(x => x.cantidad > 0);
                  await api(`/api/ordenes/${id}/ingresar`, {
                    method: 'POST',
                    body: {
                      fecha: el.querySelector('#mod-ing-fecha')?.value || hoy,
                      lote: el.querySelector('#mod-ing-lote')?.value || orden.codigo,
                      nota: el.querySelector('#mod-ing-nota')?.value || '',
                      lineas: reqLineas,
                    },
                  });
                  cleanup();
                  toast('Producto terminado ingresado a stock');
                  await renderOrdenDetalleView({ id });
                } catch (err) { toast(err.message, true); }
              });
            },
          });
        },
      }] : []),
      { label: '+ Nueva Orden', href: '/ordenes/nueva' },
      { label: '+ Nuevo Traslado', href: '/operaciones-stock/nueva', primary: true },
      ...(!['Completada', 'Cancelada'].includes(orden.estado) ? [{
        label: 'Cancelar Orden',
        className: 'btn btn-danger',
        onClick: async () => {
          if (!(await showConfirmModal('¿Cancelar esta orden de producción? Se revertirán los movimientos de stock asociados si existieran.'))) return;
          try {
            await api(`/api/ordenes/${orden.id}/cancelar`, { method: 'POST' });
            toast('Orden cancelada');
            await renderOrdenDetalleView({ id });
          } catch (err) {
            toast(err.message, true);
          }
        },
      }] : []),
    ],
    steps: [
      { key: 'Planificada', label: 'Planificada' },
      { key: 'En Proceso', label: 'En Proceso' },
      { key: 'Completada', label: 'Completada' },
    ],
    currentStep: orden.estado,
    smartButtons: [
      { label: 'Operaciones', count: opsOrden.length, href: '/operaciones-stock' },
      { label: 'Compras', count: comprasOrden.length, href: '/compras' },
    ],
    kpis: [
      { label: 'Planificado / Ingresado', value: `${fmtNum(orden.cantidad || 0)} / ${fmtNum(orden.cantidad_ingresada || 0)}`, hint: `Pendiente: ${fmtNum(orden.cantidad_pendiente ?? orden.cantidad ?? 0)}` },
      { label: 'Costo Estimado', value: fmtMoney(costoEst) },
      { label: 'Costo Real', value: fmtMoney(costoReal) },
      {
        label: 'Desvío',
        value: fmtMoney(desvio),
        tone: desvio > 0.01 ? 'danger' : desvio < -0.01 ? 'ok' : '',
      },
    ],
    tabs: [
      { id: 'etapas', label: 'Etapas', badge: etapas.length, html: etapasHtml },
      { id: 'cantidades', label: 'Cantidades', badge: (lineas || []).length, html: cantidadesHtml },
      { id: 'insumos', label: 'Insumos', badge: (insumos || []).length, html: insumosHtml },
      { id: 'movimientos', label: 'Movimientos', badge: movimientos.length, html: movimientosHtml },
    ],
    defaultTab: 'etapas',
    sidebarHtml: `${vinculadosHtml}<div id="orden-meta-panel"></div>`,
    onMountSidebar: (sidebarEl) => {
      renderMetaPanel(sidebarEl.querySelector('#orden-meta-panel'), {
        entidadTipo: 'orden',
        entidadId: id,
        titulo: `Orden ${orden.codigo}`,
        record: orden,
      });
    },
    onAfterMount: (container) => {
      const ganttEl = container.querySelector('#orden-det-gantt');
      if (ganttEl) {
        const completadas = etapas.filter(e => e.estado === 'Completada').length;
        renderGanttChart(ganttEl, {
          rows: [{
            ...orden,
            etapas_total: etapas.length,
            etapas_completadas: completadas,
            etapas,
          }],
          labelRender: (op) => `
            <div><strong>${esc(op.codigo)}</strong> · ${esc(op.plantilla_nombre)}</div>
            <div class="muted text-2xs">${esc(op.fecha_inicio)} → ${esc(op.fecha_objetivo || '-')} · ${op.cantidad || 0} u.</div>
          `,
        });
      }

      const buildEtapaPayload = (e) => ({
        taller_id: e.taller_id || null,
        plan_cuenta_id: e.plan_cuenta_id || null,
        fecha_inicio_est: e.fecha_inicio_est || null,
        fecha_fin_est: e.fecha_fin_est || null,
        cantidad_producida: Number(e.cantidad_producida) || 0,
        cantidad_merma: Number(e.cantidad_merma) || 0,
        costo_real: Number(e.costo_real ?? e.costo_estimado ?? 0),
      });

      renderSpreadsheetTable(container.querySelector('#orden-etapas-sheet'), {
        rows: etapas,
        emptyText: 'Sin etapas configuradas.',
        compact: true,
        pasteEnabled: false,
        columns: [
          {
            key: 'nombre',
            label: 'Etapa',
            type: 'readonly',
            render: (e) => `
              <strong>${e.orden_num}. ${esc(e.nombre)}</strong>
              ${e.depende_de_nombre ? `<div class="muted text-2xs">Depende de: ${esc(e.depende_de_nombre)}</div>` : ''}
            `,
          },
          {
            key: 'taller_id',
            label: 'Taller',
            type: 'select',
            options: [{ value: '', label: '-- Sin taller --' }, ...talleres.map(t => ({ value: String(t.id), label: t.nombre }))],
            getValue: (e) => (e.taller_id ? String(e.taller_id) : ''),
            parse: (v) => (v ? Number(v) : null),
          },
          {
            key: 'plan_cuenta_id',
            label: 'Cuenta Contable',
            type: 'select',
            options: [{ value: '', label: '-- Cuenta por defecto --' }, ...cuentasEgreso.map(c => ({ value: String(c.id), label: `${c.codigo} · ${c.nombre}` }))],
            getValue: (e) => (e.plan_cuenta_id ? String(e.plan_cuenta_id) : ''),
            parse: (v) => (v ? Number(v) : null),
          },
          { key: 'fecha_inicio_est', label: 'Inicio Est.', type: 'date', nowrap: true },
          { key: 'fecha_fin_est', label: 'Fin Est.', type: 'date', nowrap: true },
          {
            key: 'cantidad_producida',
            label: 'Avance',
            type: 'number',
            min: 0,
            step: 1,
            align: 'right',
            nowrap: true,
            parse: (v) => Math.max(0, Number(v) || 0),
            render: (e) => `${fmtNum(e.cantidad_producida || 0)} / ${fmtNum(e.cantidad_objetivo || orden.cantidad || 0)}`,
          },
          {
            key: 'cantidad_merma',
            label: 'Merma',
            type: 'number',
            min: 0,
            step: 1,
            align: 'right',
            nowrap: true,
            parse: (v) => Math.max(0, Number(v) || 0),
          },
          {
            key: 'costo_real',
            label: 'Costo Real',
            type: 'number',
            min: 0,
            step: 0.01,
            align: 'right',
            nowrap: true,
            getValue: (e) => Number(e.costo_real ?? e.costo_estimado ?? 0),
            parse: (v) => Math.max(0, Number(v) || 0),
            render: (e) => fmtMoney(e.costo_real ?? e.costo_estimado ?? 0),
          },
          {
            key: 'estado',
            label: 'Estado',
            type: 'readonly',
            render: (e) => {
              const bloqueada = Boolean(e.depende_de_orden_etapa_id && e.depende_de_estado !== 'Completada');
              return bloqueada
                ? `<span class="badge badge-muted" title="Esperando ${esc(e.depende_de_nombre)}">Bloqueada</span>`
                : `<span class="badge ${e.estado === 'Completada' ? 'badge-ok' : e.estado === 'En Proceso' ? 'badge-warn' : 'badge-muted'}">${esc(e.estado)}</span>`;
            },
          },
          {
            key: 'stock_consumido',
            label: 'Stock',
            type: 'readonly',
            render: (e) => e.stock_consumido
              ? '<span class="badge badge-ok" title="El stock de esta etapa ya fue descontado; no se puede reabrir sin revertir movimientos">Descontado (fijo)</span>'
              : '<span class="muted">Pendiente</span>',
          },
        ],
        extraActions: (e) => {
          const bloqueada = Boolean(e.depende_de_orden_etapa_id && e.depende_de_estado !== 'Completada');
          return `
            ${e.compra_id ? `<a href="/compras/${e.compra_id}" data-link class="badge badge-ok" title="Compra ${esc(e.compra_numero || '#' + e.compra_id)}">${esc(e.compra_numero || '#' + e.compra_id)}</a>` : ''}
            ${e.estado === 'Pendiente' ? `<button type="button" class="btn btn-sm btn-estado-etapa" data-etapa-id="${e.id}" data-estado="En Proceso" ${bloqueada ? 'disabled' : ''} title="Iniciar etapa" aria-label="Iniciar etapa">${PLAY_ICON_SVG}</button>` : ''}
            ${e.estado !== 'Completada' ? `<button type="button" class="btn btn-sm btn-primary btn-estado-etapa" data-etapa-id="${e.id}" data-estado="Completada" ${bloqueada ? 'disabled' : ''} title="Completar etapa" aria-label="Completar etapa">${CHECK_ICON_SVG}</button>` : ''}
          `;
        },
        onCellChange: async ({ row }) => {
          try {
            await api(`/api/orden-etapas/${row.id}`, {
              method: 'PUT',
              body: JSON.stringify(buildEtapaPayload(row)),
            });
            toast('Etapa actualizada');
          } catch (err) {
            toast(err.message, true);
            throw err;
          }
        },
      });

      container.querySelectorAll('.btn-estado-etapa').forEach(btn => {
        btn.addEventListener('click', async () => {
          const eid = btn.dataset.etapaId;
          const estado = btn.dataset.estado;
          const etapaRow = etapas.find(x => String(x.id) === String(eid));
          try {
            await api(`/api/orden-etapas/${eid}`, {
              method: 'PUT',
              body: JSON.stringify({ ...buildEtapaPayload(etapaRow || {}), estado }),
            });
            toast(estado === 'Completada' ? 'Etapa completada y stock actualizado' : 'Etapa iniciada');
            await renderOrdenDetalleView({ id });
          } catch (err) {
            toast(err.message, true);
          }
        });
      });
    },
  });
}
