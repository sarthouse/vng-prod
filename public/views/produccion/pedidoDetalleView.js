import { api, toast } from '../../lib/api.js';
import { esc, fmtMoney, fmtNum, badgeForEstado, badgeForTipo, downloadCSV } from '../../lib/format.js';
import { renderMetaPanel } from '../../lib/metaPanel.js';
import { mountDetailView } from '../../lib/engine/detailEngine.js';

export async function renderPedidoDetalleView({ id }) {
  const root = document.getElementById('app-view');
  const detail = await api(`/api/pedidos/${id}`);
  const { pedido, lineas, snapshot, entregas, pendiente } = detail;

  const totalCosto = snapshot.reduce((acc, s) => acc + Number(s.subtotal || 0), 0);
  const pendTotal = Number(pendiente?.total ?? 0);
  const pendMap = new Map((pendiente?.lineas || []).map(l => [Number(l.producto_id), l]));

  const detalleHtml = `
    <div class="card">
      <div class="card-header"><h2>Detalle del Pedido vs Pendiente</h2></div>
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
              <td><strong>Pedido Original</strong></td>
              ${(lineas || []).map(l => `<td class="num">${l.cantidad}</td>`).join('')}
              <td class="num"><strong>${pedido.cantidad}</strong></td>
            </tr>
            <tr>
              <td><strong>Pendiente</strong></td>
              ${(lineas || []).map(l => {
                const p = pendMap.get(Number(l.producto_id));
                return `<td class="num">${p ? p.pendiente : l.cantidad}</td>`;
              }).join('')}
              <td class="num"><strong>${pendTotal}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
      ${pedido.observaciones ? `<p class="muted" style="margin-top:10px; font-size:0.85rem;">Observaciones: ${esc(pedido.observaciones)}</p>` : ''}
    </div>
  `;

  const snapshotHtml = `
    <div class="card">
      <div class="card-header">
        <div>
          <h2>Insumos a Comprar</h2>
          <p class="muted">Snapshot congelado al registrar el pedido con proveedor, mínimo de compra y estado.</p>
        </div>
        ${snapshot.length > 0 ? `<button type="button" id="btn-export-snapshot" class="btn btn-sm">Exportar CSV</button>` : ''}
      </div>
      ${snapshot.length === 0 ? `
        <div class="empty-state">Este pedido no tiene insumos en su snapshot.</div>
      ` : `
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Comprado</th>
                <th>Producto / Insumo</th>
                <th>Tipo</th>
                <th>Categoría</th>
                <th>Proveedor</th>
                <th class="num">Req. Exacto</th>
                <th class="num">Mín. Compra</th>
                <th class="num">A Comprar</th>
                <th>UdM</th>
                <th class="num">Precio Unit.</th>
                <th class="num">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              ${snapshot.map(item => `
                <tr>
                  <td>
                    <input type="checkbox" class="snap-check" data-snap-id="${item.id}" ${item.comprado ? 'checked' : ''} />
                  </td>
                  <td><strong>${esc(item.nombre)}</strong></td>
                  <td>${badgeForTipo(item.tipo)}</td>
                  <td><span class="badge badge-muted">${esc(item.categoria)}</span></td>
                  <td>${esc(item.proveedor_nombre || '-')}</td>
                  <td class="num">${fmtNum(item.cantidad_requerida)}</td>
                  <td class="num">${item.tipo === 'servicio' ? '-' : fmtNum(item.minimo_compra)}</td>
                  <td class="num"><strong>${fmtNum(item.cantidad_a_comprar)}</strong></td>
                  <td>${esc(item.udm)}</td>
                  <td class="num">${fmtMoney(item.precio_unitario)}</td>
                  <td class="num"><strong>${fmtMoney(item.subtotal)}</strong></td>
                </tr>
              `).join('')}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="10"><strong>Total Materiales y Servicios Snapshot</strong></td>
                <td class="num"><strong>${fmtMoney(totalCosto)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      `}
    </div>
  `;

  const entregasHtml = `
    <div class="card">
      <div class="card-header">
        <h2>Entregas del Pedido</h2>
        <a href="/entregas/nueva?lote=${pedido.pedido}" data-link class="btn btn-sm">+ Nueva Entrega</a>
      </div>
      ${entregas.length === 0 ? `
        <div class="empty-state">Aún no se registraron entregas para este pedido.</div>
      ` : `
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Entrega #</th>
                <th>Fecha</th>
                <th class="num">Total</th>
                <th>Observaciones</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${entregas.map(e => `
                <tr>
                  <td>#${e.nro_entrega}</td>
                  <td>${esc(e.fecha || '-')}</td>
                  <td class="num"><strong>${e.total}</strong></td>
                  <td class="muted">${esc(e.observaciones || '-')}</td>
                  <td><a href="/entregas/${e.id}/editar" data-link class="btn btn-sm">Editar</a></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;

  const estadoBadgeClass = pedido.estado === 'Entregado' ? 'badge-ok' : pedido.estado === 'Parcial' ? 'badge-warn' : 'badge-muted';

  mountDetailView(root, {
    breadcrumb: { label: 'Volver a Pedidos', href: '/pedidos' },
    title: `Pedido #${pedido.pedido} — ${pedido.plantilla_nombre}`,
    subtitle: `${pedido.contacto_nombre ? `Cliente: <strong>${esc(pedido.contacto_nombre)}</strong> · ` : ''}Fecha pedido: ${esc(pedido.fecha || '-')} · Entrega estimada: ${esc(pedido.fecha_est || '-')}`,
    badge: { text: pedido.estado || 'Pendiente', className: estadoBadgeClass },
    actions: [
      { label: '+ Nuevo Pedido', href: '/pedidos/nuevo' },
      { label: '+ Registrar Entrega', href: `/entregas/nueva?lote=${pedido.pedido}` },
      { label: 'Editar Pedido', href: `/pedidos/${pedido.id}/editar`, primary: true },
    ],
    steps: [
      { key: 'Pendiente', label: 'Pendiente' },
      { key: 'En Producción', label: 'En Producción' },
      { key: 'Parcial', label: 'Parcial' },
      { key: 'Entregado', label: 'Entregado' },
    ],
    currentStep: pedido.estado,
    smartButtons: [
      { label: 'Entregas', count: entregas.length, icon: '🚚', href: '/entregas' },
      { label: 'Insumos', count: snapshot.length, icon: '📦' },
    ],
    kpis: [
      { label: 'Total Pedido', value: `${pedido.cantidad} u.` },
      { label: 'Pendiente de Entrega', value: `${pendTotal} u.`, tone: pendTotal > 0 ? 'warn' : 'ok' },
      { label: 'Entregas Registradas', value: String(entregas.length) },
      { label: 'Costo Total Snapshot', value: fmtMoney(totalCosto) },
    ],
    tabs: [
      { id: 'detalle', label: 'Detalle vs Pendiente', badge: (lineas || []).length, html: detalleHtml },
      { id: 'insumos', label: 'Insumos a Comprar', badge: snapshot.length, html: snapshotHtml },
      { id: 'entregas', label: 'Entregas', badge: entregas.length, html: entregasHtml },
    ],
    defaultTab: 'detalle',
    sidebarHtml: '<div id="pedido-meta-panel"></div>',
    onMountSidebar: (sidebarEl) => {
      renderMetaPanel(sidebarEl.querySelector('#pedido-meta-panel'), {
        entidadTipo: 'pedido',
        entidadId: id,
        titulo: `Pedido #${pedido.pedido}`,
        record: pedido,
      });
    },
    onAfterMount: (container) => {
      container.querySelectorAll('.snap-check').forEach(cb => {
        cb.addEventListener('change', async () => {
          try {
            await api(`/api/pedido-insumos/${cb.dataset.snapId}`, {
              method: 'PATCH',
              body: JSON.stringify({ comprado: cb.checked }),
            });
            toast(cb.checked ? 'Marcado como comprado' : 'Desmarcado');
          } catch (err) {
            cb.checked = !cb.checked;
            toast(err.message, true);
          }
        });
      });

      container.querySelector('#btn-export-snapshot')?.addEventListener('click', () => {
        const header = ['Producto', 'Categoria', 'Proveedor', 'Requerido', 'MinimoCompra', 'AComprar', 'UdM', 'PrecioUnitario', 'Subtotal', 'Comprado'];
        const lines = [header.join(',')];
        for (const s of snapshot) {
          lines.push([
            `"${(s.nombre || '').replace(/"/g, '""')}"`,
            `"${(s.categoria || '').replace(/"/g, '""')}"`,
            `"${(s.proveedor_nombre || '').replace(/"/g, '""')}"`,
            s.cantidad_requerida,
            s.minimo_compra,
            s.cantidad_a_comprar,
            `"${s.udm}"`,
            s.precio_unitario,
            s.subtotal,
            s.comprado ? 'SI' : 'NO',
          ].join(','));
        }
        downloadCSV(lines.join('\n'), `pedido_${pedido.pedido}_insumos.csv`);
      });
    },
  });
}
