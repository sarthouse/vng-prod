import { api, toast } from '../../lib/api.js';
import { esc, fmtNum, fmtMoney, badgeForTipo } from '../../lib/format.js';
import { renderMetaPanel } from '../../lib/metaPanel.js';
import { openPdfFromEndpoint } from '../../lib/remitoPrint.js';
import { mountDetailView, createModal, renderGanttChart } from '../../lib/engine/index.js';

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
          <span class="muted" style="font-size:0.82rem;">Podés registrar ingresos parciales de producto terminado a medida que salen del taller o completar todo al cierre.</span>
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
              ${(lineas || []).map(l => `<td class="num" style="color:#15803d;">${fmtNum(l.cantidad_ingresada || 0)}</td>`).join('')}
              <td class="num"><strong style="color:#15803d;">${fmtNum(orden.cantidad_ingresada || 0)}</strong></td>
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
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Etapa</th>
              <th>Taller Asignado</th>
              <th>Fechas Est.</th>
              <th>Avance / Merma</th>
              <th class="num">Costo Proceso</th>
              <th>Estado</th>
              <th>Stock</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${etapas.map(e => {
              const bloqueada = Boolean(e.depende_de_orden_etapa_id && e.depende_de_estado !== 'Completada');
              const obj = Number(e.cantidad_objetivo || orden.cantidad || 0);
              const prod = Number(e.cantidad_producida || 0);
              const merma = Number(e.cantidad_merma || 0);
              return `
              <tr>
                <td>
                  <strong>${e.orden_num}. ${esc(e.nombre)}</strong>
                  ${e.descripcion ? `<div class="muted" style="font-size:11px;">${esc(e.descripcion)}</div>` : ''}
                  ${e.depende_de_nombre ? `<div class="muted" style="font-size:11px;">Depende de: ${esc(e.depende_de_nombre)}</div>` : ''}
                </td>
                <td>
                  <select class="etapa-taller input-sm" data-etapa-id="${e.id}">
                    <option value="">-- Sin taller --</option>
                    ${talleres.map(t => `<option value="${t.id}" ${String(t.id) === String(e.taller_id || '') ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('')}
                  </select>
                  <select class="etapa-cta input-sm" data-etapa-id="${e.id}" style="margin-top:4px;">
                    <option value="">-- Cuenta por defecto --</option>
                    ${cuentasEgreso.map(c => `<option value="${c.id}" ${String(c.id) === String(e.plan_cuenta_id || '') ? 'selected' : ''}>${esc(c.codigo)} · ${esc(c.nombre)}</option>`).join('')}
                  </select>
                  ${e.compra_id ? `<div style="margin-top:4px;"><a href="/compras/${e.compra_id}" data-link class="badge badge-ok">Compra ${esc(e.compra_numero || '#' + e.compra_id)}</a></div>` : ''}
                </td>
                <td>
                  <div style="display:flex;flex-direction:column;gap:4px;">
                    <input type="date" class="etapa-ini input-sm" data-etapa-id="${e.id}" value="${esc(e.fecha_inicio_est || '')}" title="Inicio estimado" />
                    <input type="date" class="etapa-fin input-sm" data-etapa-id="${e.id}" value="${esc(e.fecha_fin_est || '')}" title="Fin estimado" />
                  </div>
                </td>
                <td>
                  <div style="display:flex;gap:4px;align-items:center;font-size:12px;">
                    <input type="number" min="0" step="1" class="etapa-prod input-sm" data-etapa-id="${e.id}" value="${prod}" style="width:62px;" title="Unidades producidas" />
                    <span>/ ${obj}</span>
                  </div>
                  <div style="display:flex;gap:4px;align-items:center;font-size:11px;margin-top:4px;">
                    <span class="muted">Merma:</span>
                    <input type="number" min="0" step="1" class="etapa-merma input-sm" data-etapa-id="${e.id}" value="${merma}" style="width:55px;" title="Unidades con falla / merma" />
                  </div>
                </td>
                <td class="num">
                  <div class="muted" style="font-size:11px;">Est: ${fmtMoney(e.costo_estimado || 0)}</div>
                  <input type="number" min="0" step="0.01" class="etapa-costo-real input-sm" data-etapa-id="${e.id}" value="${Number(e.costo_real ?? e.costo_estimado ?? 0)}" style="width:88px;text-align:right;margin-top:3px;" title="Costo real de la etapa" />
                </td>
                <td>
                  ${bloqueada
                    ? `<span class="badge badge-muted" title="Esperando ${esc(e.depende_de_nombre)}">Bloqueada</span>`
                    : `<span class="badge ${e.estado === 'Completada' ? 'badge-ok' : e.estado === 'En Proceso' ? 'badge-warn' : 'badge-muted'}">${esc(e.estado)}</span>`}
                </td>
                <td>${e.stock_consumido ? '<span class="badge badge-ok">Descontado</span>' : '<span class="muted">Pendiente</span>'}</td>
                <td>
                  <div class="actions">
                    <button type="button" class="btn btn-sm btn-save-etapa" data-etapa-id="${e.id}">Guardar</button>
                    ${e.estado === 'Pendiente' ? `<button type="button" class="btn btn-sm btn-estado-etapa" data-etapa-id="${e.id}" data-estado="En Proceso" ${bloqueada ? 'disabled' : ''}>Iniciar</button>` : ''}
                    ${e.estado !== 'Completada' ? `<button type="button" class="btn btn-sm btn-primary btn-estado-etapa" data-etapa-id="${e.id}" data-estado="Completada" ${bloqueada ? 'disabled' : ''}>Completar</button>` : ''}
                  </div>
                </td>
              </tr>
            `; }).join('')}
          </tbody>
        </table>
      </div>
    </div>
    <div class="card" style="margin-top:14px;">
      <div class="card-header">
        <div>
          <h2>Cronograma Gantt de Etapas</h2>
          <span class="muted" style="font-size:0.82rem;">Secuencia temporal estimada y real por etapa y taller asignado.</span>
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
      <div class="actions" style="flex-wrap:wrap;gap:8px;padding:12px 16px;">
        ${opsOrden.map(o => `<a href="/operaciones-stock/${o.id}" data-link class="btn btn-sm">Operación: ${esc(o.numero)} (${esc(o.estado)})</a>`).join('')}
        ${comprasOrden.map(c => `<a href="/compras/${c.id}" data-link class="btn btn-sm">Compra: ${esc(c.numero || '#' + c.id)} — ${esc(c.proveedor_nombre)} (${esc(c.estado)})</a>`).join('')}
      </div>
    </div>
  ` : '';

  mountDetailView(root, {
    breadcrumb: { label: 'Volver a Órdenes', href: '/ordenes' },
    title: `${orden.codigo} — ${orden.plantilla_nombre}`,
    subtitle: `Receta: ${esc(orden.receta_nombre || 'Activa')} · Inicio: ${esc(orden.fecha_inicio)} · Objetivo: ${esc(orden.fecha_objetivo || '-')}`,
    badge: {
      text: orden.estado,
      className: orden.estado === 'Completada' ? 'badge-ok' : orden.estado === 'En Proceso' ? 'badge-warn' : 'badge-confirmado',
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
              <div class="table-wrap" style="margin-top:10px;">
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
                          <input type="number" step="1" min="0" max="${l.cantidad_pendiente ?? l.cantidad}" class="mod-ing-qty num" data-pid="${l.producto_id}" value="${l.cantidad_pendiente ?? l.cantidad}" style="width:95px;text-align:right;font-weight:600;" />
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
    ],
    steps: [
      { key: 'Planificada', label: 'Planificada' },
      { key: 'En Proceso', label: 'En Proceso' },
      { key: 'Completada', label: 'Completada' },
    ],
    currentStep: orden.estado,
    smartButtons: [
      { label: 'Operaciones', count: opsOrden.length, icon: '📦', href: '/operaciones-stock' },
      { label: 'Compras', count: comprasOrden.length, icon: '🧾', href: '/compras' },
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
            <div class="muted" style="font-size:11px;">${esc(op.fecha_inicio)} → ${esc(op.fecha_objetivo || '-')} · ${op.cantidad || 0} u.</div>
          `,
        });
      }

      const readEtapaPayload = (eid) => ({
        taller_id: container.querySelector(`.etapa-taller[data-etapa-id="${eid}"]`)?.value || null,
        plan_cuenta_id: container.querySelector(`.etapa-cta[data-etapa-id="${eid}"]`)?.value || null,
        fecha_inicio_est: container.querySelector(`.etapa-ini[data-etapa-id="${eid}"]`)?.value || null,
        fecha_fin_est: container.querySelector(`.etapa-fin[data-etapa-id="${eid}"]`)?.value || null,
        cantidad_producida: Number(container.querySelector(`.etapa-prod[data-etapa-id="${eid}"]`)?.value) || 0,
        cantidad_merma: Number(container.querySelector(`.etapa-merma[data-etapa-id="${eid}"]`)?.value) || 0,
        costo_real: Number(container.querySelector(`.etapa-costo-real[data-etapa-id="${eid}"]`)?.value) || 0,
      });

      container.querySelectorAll('.btn-save-etapa').forEach(btn => {
        btn.addEventListener('click', async () => {
          const eid = btn.dataset.etapaId;
          try {
            await api(`/api/orden-etapas/${eid}`, {
              method: 'PUT',
              body: JSON.stringify(readEtapaPayload(eid)),
            });
            toast('Etapa actualizada');
            await renderOrdenDetalleView({ id });
          } catch (err) {
            toast(err.message, true);
          }
        });
      });

      container.querySelectorAll('.btn-estado-etapa').forEach(btn => {
        btn.addEventListener('click', async () => {
          const eid = btn.dataset.etapaId;
          const estado = btn.dataset.estado;
          try {
            await api(`/api/orden-etapas/${eid}`, {
              method: 'PUT',
              body: JSON.stringify({ ...readEtapaPayload(eid), estado }),
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
