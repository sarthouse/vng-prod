import { api, toast } from '../../lib/api.js';
import { esc, fmtNum, fmtMoney, badgeForTipo } from '../../lib/format.js';
import { renderMetaPanel } from '../../lib/metaPanel.js';

export async function renderOrdenDetalleView({ id }) {
  const root = document.getElementById('app-view');
  const [detail, talleres, operaciones, compras] = await Promise.all([
    api(`/api/ordenes/${id}`),
    api('/api/contactos?es_taller=1'),
    api('/api/operaciones-stock').catch(() => []),
    api('/api/compras').catch(() => []),
  ]);

  const { orden, lineas, etapas, insumos, movimientos } = detail;
  const opsOrden = (operaciones || []).filter(o => o.referencia_tipo === 'orden' && Number(o.referencia_id) === Number(id));
  const comprasOrden = (compras || []).filter(c => Number(c.orden_id) === Number(id));

  root.innerHTML = `
    <div class="page-header">
      <div>
        <div style="margin-bottom:6px;">
          <a href="/ordenes" data-link class="muted" style="font-size:0.85rem;">← Volver a Órdenes</a>
        </div>
        <h1>${esc(orden.codigo)} — ${esc(orden.plantilla_nombre)} <span class="badge ${orden.estado === 'Completada' ? 'badge-ok' : orden.estado === 'En Proceso' ? 'badge-warn' : 'badge-confirmado'}">${esc(orden.estado)}</span></h1>
        <p class="muted">Receta: ${esc(orden.receta_nombre || 'Activa')} · Inicio: ${esc(orden.fecha_inicio)} · Objetivo: ${esc(orden.fecha_objetivo || '-')} · Costo Procesos Est.: <strong>${fmtMoney(orden.costo_procesos_est || 0)}</strong> · Real: <strong>${fmtMoney(orden.costo_procesos_real || 0)}</strong></p>
      </div>
      <div class="actions">
        <a href="/ordenes/nueva" data-link class="btn">+ Nueva Orden</a>
        <a href="/remitos" data-link class="btn">+ Emitir Remito a Taller</a>
      </div>
    </div>

    ${(opsOrden.length > 0 || comprasOrden.length > 0) ? `
      <div class="card">
        <div class="card-header"><h2>Documentos Vinculados</h2></div>
        <div class="actions" style="flex-wrap:wrap;gap:8px;padding:12px 16px;">
          ${opsOrden.map(o => `<a href="/remitos" data-link class="btn btn-sm">Remito/Op: ${esc(o.numero)} (${esc(o.estado)})</a>`).join('')}
          ${comprasOrden.map(c => `<a href="/compras" data-link class="btn btn-sm">Compra: ${esc(c.numero || '#' + c.id)} — ${esc(c.proveedor_nombre)} (${esc(c.estado)})</a>`).join('')}
        </div>
      </div>
    ` : ''}

    <div class="card">
      <div class="card-header">
        <h2>Cantidades de la Orden</h2>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              ${(lineas || []).map(l => `<th class="num">${esc(l.combinacion || l.sku || l.producto_nombre)}</th>`).join('')}
              <th class="num">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              ${(lineas || []).map(l => `<td class="num">${l.cantidad}</td>`).join('')}
              <td class="num"><strong>${orden.cantidad}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2>Etapas de Producción</h2>
      </div>
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
                  ${e.depende_de_nombre ? `<div class="muted" style="font-size:11px;">Depende de: ${esc(e.depende_de_nombre)}</div>` : ''}
                </td>
                <td>
                  <select class="etapa-taller input-sm" data-etapa-id="${e.id}">
                    <option value="">-- Sin taller --</option>
                    ${talleres.map(t => `<option value="${t.id}" ${String(t.id) === String(e.taller_id || '') ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('')}
                  </select>
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

    <div class="card">
      <div class="card-header">
        <h2>Materiales y Servicios por Etapa</h2>
      </div>
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

    ${movimientos.length > 0 ? `
      <div class="card">
        <div class="card-header">
          <h2>Movimientos de Stock Generados</h2>
        </div>
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
      </div>
    ` : ''}

    <div id="orden-meta-panel"></div>
  `;

  renderMetaPanel(root.querySelector('#orden-meta-panel'), {
    entidadTipo: 'orden',
    entidadId: id,
    titulo: `Orden ${orden.codigo}`,
    record: orden,
  });

  const readEtapaPayload = (eid) => ({
    taller_id: root.querySelector(`.etapa-taller[data-etapa-id="${eid}"]`)?.value || null,
    fecha_inicio_est: root.querySelector(`.etapa-ini[data-etapa-id="${eid}"]`)?.value || null,
    fecha_fin_est: root.querySelector(`.etapa-fin[data-etapa-id="${eid}"]`)?.value || null,
    cantidad_producida: Number(root.querySelector(`.etapa-prod[data-etapa-id="${eid}"]`)?.value) || 0,
    cantidad_merma: Number(root.querySelector(`.etapa-merma[data-etapa-id="${eid}"]`)?.value) || 0,
    costo_real: Number(root.querySelector(`.etapa-costo-real[data-etapa-id="${eid}"]`)?.value) || 0,
  });

  root.querySelectorAll('.btn-save-etapa').forEach(btn => {
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

  root.querySelectorAll('.btn-estado-etapa').forEach(btn => {
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
}
