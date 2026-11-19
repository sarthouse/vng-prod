import { api, toast, refreshKPIs } from '../../lib/api.js';
import { esc, fmtMoney, fmtNum, badgeForEstado, badgeForTipo, downloadCSV } from '../../lib/format.js';
import { renderMetaPanel } from '../../lib/metaPanel.js';
import { mountDetailView } from '../../lib/engine/detailEngine.js';
import { renderSpreadsheetTable, showConfirmModal } from '../../lib/engine/index.js';
import { navigate } from '../../router.js';

export async function renderPedidoDetalleView({ id }) {
  const root = document.getElementById('app-view');
  const detail = await api(`/api/pedidos/${id}`);
  const { pedido, lineas, snapshot, entregas, pendiente, ordenes = [] } = detail;

  const totalCosto = snapshot.reduce((acc, s) => acc + Number(s.subtotal || 0), 0);
  const pendTotal = Number(pendiente?.total ?? 0);
  const pendMap = new Map((pendiente?.lineas || []).map(l => [Number(l.producto_id), l]));

  const detalleHtml = `
    <div class="card">
      <div class="card-header"><h2>Detalle del Pedido vs Pendiente</h2></div>
      <div id="pedido-detalle-sheet"></div>
      ${pedido.observaciones ? `<p class="muted sx-404273">Observaciones: ${esc(pedido.observaciones)}</p>` : ''}
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
      <div id="pedido-snapshot-sheet"></div>
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

  const isBorrador = pedido.estado === 'Borrador';
  const estadoBadgeClass = pedido.estado === 'Entregado' ? 'badge-ok' : (pedido.estado === 'Entrega Parcial' || pedido.estado === 'Parcial') ? 'badge-warn' : pedido.estado === 'Confirmado' ? 'badge-confirmado' : 'badge-muted';

  const clienteHtml = pedido.contacto_nombre
    ? (pedido.contacto_id
      ? `Cliente: <a href="/contactos/${pedido.contacto_id}" data-link class="link-primary"><strong>${esc(pedido.contacto_nombre)}</strong></a> · `
      : `Cliente: <strong>${esc(pedido.contacto_nombre)}</strong> · `)
    : '';

  const vinculadosHtml = ordenes.length > 0 ? `
    <div class="card mb-md">
      <div class="card-header"><h3>Documentos Vinculados</h3></div>
      <div class="actions sx-3a4c1e">
        ${ordenes.map(o => `<a href="/ordenes/${o.id}" data-link class="btn btn-sm">Orden: ${esc(o.codigo)} (${esc(o.estado)})</a>`).join('')}
      </div>
    </div>
  ` : '';

  mountDetailView(root, {
    breadcrumb: { label: 'Volver a Pedidos', href: '/pedidos' },
    title: `Pedido #${pedido.pedido} — ${pedido.plantilla_nombre}`,
    subtitle: `${clienteHtml}Fecha pedido: ${esc(pedido.fecha || '-')} · Entrega estimada: ${esc(pedido.fecha_est || '-')}`,
    badge: { text: pedido.estado || 'Borrador', className: estadoBadgeClass },
    actions: [
      { label: '+ Nuevo Pedido', href: '/pedidos/nuevo' },
      ...(isBorrador ? [{
        label: 'Confirmar Pedido',
        primary: true,
        onClick: async () => {
          try {
            await api(`/api/pedidos/${pedido.id}`, {
              method: 'PUT',
              body: JSON.stringify({ estado: 'Confirmado' }),
            });
            await refreshKPIs();
            toast('Pedido confirmado');
            await renderPedidoDetalleView({ id });
          } catch (err) {
            toast(err.message, true);
          }
        },
      }] : []),
      ...(!isBorrador && pedido.estado !== 'Cancelado' ? [{ label: '+ Registrar Entrega', href: `/entregas/nueva?lote=${pedido.pedido}` }] : []),
      { label: 'Editar Pedido', href: `/pedidos/${pedido.id}/editar` },
      ...(!isBorrador && pedido.plantilla_id && pedido.estado !== 'Cancelado' ? [{
        label: 'Lanzar Orden de Producción',
        primary: true,
        onClick: async () => {
          try {
            const res = await api('/api/ordenes', {
              method: 'POST',
              body: JSON.stringify({
                plantilla_id: pedido.plantilla_id,
                pedido_id: pedido.id,
                receta_id: pedido.receta_id || null,
                notas: `Generada desde Pedido #${pedido.pedido}`,
              }),
            });
            await refreshKPIs();
            toast('Orden de producción creada');
            navigate(`/ordenes/${res.id}`);
          } catch (err) {
            toast(err.message, true);
          }
        },
      }] : []),
      ...(!['Entregado', 'Cancelado'].includes(pedido.estado) ? [{
        label: 'Cancelar Pedido',
        className: 'btn btn-danger',
        onClick: async () => {
          if (!(await showConfirmModal('¿Cancelar este pedido?'))) return;
          try {
            await api(`/api/pedidos/${pedido.id}/cancelar`, { method: 'POST' });
            await refreshKPIs();
            toast('Pedido cancelado');
            await renderPedidoDetalleView({ id });
          } catch (err) {
            toast(err.message, true);
          }
        },
      }] : []),
    ],
    steps: [
      { key: 'Borrador', label: 'Borrador' },
      { key: 'Confirmado', label: 'Confirmado' },
      { key: 'En Producción', label: 'En Producción' },
      { key: 'Entrega Parcial', label: 'Parcial' },
      { key: 'Entregado', label: 'Entregado' },
    ],
    currentStep: pedido.estado,
    smartButtons: [
      ...(ordenes.length > 0 ? [{ label: 'Órdenes', count: ordenes.length, href: ordenes.length === 1 ? `/ordenes/${ordenes[0].id}` : '/ordenes' }] : []),
      { label: 'Entregas', count: entregas.length, href: '/entregas' },
      { label: 'Insumos', count: snapshot.length },
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
    sidebarHtml: `${vinculadosHtml}<div id="pedido-meta-panel"></div>`,
    onMountSidebar: (sidebarEl) => {
      renderMetaPanel(sidebarEl.querySelector('#pedido-meta-panel'), {
        entidadTipo: 'pedido',
        entidadId: id,
        titulo: `Pedido #${pedido.pedido}`,
        record: pedido,
      });
    },
    onAfterMount: (container) => {
      const detalleRows = (lineas || []).map(l => {
        const p = pendMap.get(Number(l.producto_id));
        return {
          ...l,
          pendiente: p ? p.pendiente : l.cantidad,
        };
      });
      renderSpreadsheetTable(container.querySelector('#pedido-detalle-sheet'), {
        rows: detalleRows,
        emptyText: 'Este pedido no tiene líneas.',
        compact: true,
        pasteEnabled: false,
        showDirty: false,
        columns: [
          {
            key: 'producto_nombre',
            label: 'Producto',
            type: 'readonly',
            render: (l) => `<strong>${esc(l.combinacion || l.sku || l.producto_nombre)}</strong>`,
          },
          {
            key: 'cantidad',
            label: 'Pedido Original',
            type: 'readonly',
            align: 'right',
            nowrap: true,
            render: (l) => fmtNum(l.cantidad),
          },
          {
            key: 'pendiente',
            label: 'Pendiente',
            type: 'readonly',
            align: 'right',
            nowrap: true,
            render: (l) => fmtNum(l.pendiente),
          },
        ],
        tfootHtml: `
          <tr>
            <td><strong>Total</strong></td>
            <td class="num"><strong>${fmtNum(pedido.cantidad)}</strong></td>
            <td class="num"><strong>${fmtNum(pendTotal)}</strong></td>
          </tr>
        `,
      });

      renderSpreadsheetTable(container.querySelector('#pedido-snapshot-sheet'), {
        rows: snapshot,
        emptyText: 'Este pedido no tiene insumos en su snapshot.',
        compact: true,
        pasteEnabled: false,
        showDirty: false,
        columns: [
          {
            key: 'comprado',
            label: 'Comprado',
            type: 'checkbox',
            align: 'center',
            editable: () => !['Entregado', 'Cancelado'].includes(pedido.estado),
            render: (item) => Number(item.comprado) === 1
              ? '<span class="badge badge-ok">Sí</span>'
              : '<span class="muted">No</span>',
          },
          { key: 'nombre', label: 'Producto / Insumo', type: 'readonly', render: (item) => `<strong>${esc(item.nombre)}</strong>` },
          { key: 'tipo', label: 'Tipo', type: 'readonly', render: (item) => badgeForTipo(item.tipo) },
          { key: 'categoria', label: 'Categoría', type: 'readonly', render: (item) => `<span class="badge badge-muted">${esc(item.categoria)}</span>` },
          { key: 'proveedor_nombre', label: 'Proveedor', type: 'readonly', render: (item) => esc(item.proveedor_nombre || '-') },
          { key: 'cantidad_requerida', label: 'Req. Exacto', type: 'readonly', align: 'right', nowrap: true, render: (item) => fmtNum(item.cantidad_requerida) },
          { key: 'minimo_compra', label: 'Mín. Compra', type: 'readonly', align: 'right', nowrap: true, render: (item) => item.tipo === 'servicio' ? '-' : fmtNum(item.minimo_compra) },
          { key: 'cantidad_a_comprar', label: 'A Comprar', type: 'readonly', align: 'right', nowrap: true, render: (item) => `<strong>${fmtNum(item.cantidad_a_comprar)}</strong>` },
          { key: 'udm', label: 'UdM', type: 'readonly', nowrap: true },
          { key: 'precio_unitario', label: 'Precio Unit.', type: 'readonly', align: 'right', nowrap: true, render: (item) => fmtMoney(item.precio_unitario) },
          { key: 'subtotal', label: 'Subtotal', type: 'readonly', align: 'right', nowrap: true, render: (item) => `<strong>${fmtMoney(item.subtotal)}</strong>` },
        ],
        tfootHtml: snapshot.length > 0 ? `
          <tr>
            <td colspan="10"><strong>Total Materiales y Servicios Snapshot</strong></td>
            <td class="num"><strong>${fmtMoney(totalCosto)}</strong></td>
          </tr>
        ` : '',
        onCellChange: async ({ row, key, value }) => {
          if (key !== 'comprado') return;
          try {
            await api(`/api/pedido-insumos/${row.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ comprado: Boolean(Number(value)) }),
            });
            toast(Number(value) ? 'Marcado como comprado' : 'Desmarcado');
          } catch (err) {
            toast(err.message, true);
            throw err;
          }
        },
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
