import { api, toast, refreshKPIs } from '../../lib/api.js';
import { esc, badgeForEstado } from '../../lib/format.js';
import { showConfirmModal } from '../../lib/engine/index.js';
import { renderDataTable } from '../../lib/engine/index.js';

export async function renderPedidosView() {
  const root = document.getElementById('app-view');
  const pedidos = await api('/api/pedidos');

  root.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Registro de Pedidos</h1>
        <p class="muted">Pedidos de producción con snapshot congelado de receta e insumos a comprar.</p>
      </div>
      <div class="actions">
        <a href="/pedidos/nuevo" data-link class="btn btn-primary">+ Nuevo Pedido</a>
      </div>
    </div>

    <div class="card">
      <div id="pedidos-table-wrap"></div>
    </div>
  `;

  renderDataTable(root.querySelector('#pedidos-table-wrap'), {
    rows: pedidos,
    emptyText: 'No hay pedidos registrados. Podés crear uno nuevo o enviar la curva actual desde Curva y Planificación.',
    exportFilename: `pedidos_${new Date().toISOString().slice(0, 10)}.csv`,
    bulkActions: [
      {
        id: 'eliminar',
        label: 'Eliminar seleccionados',
        variant: 'danger',
        confirm: (sel) => `¿Eliminar ${sel.length} pedido(s) seleccionado(s)?`,
        onClick: async (sel) => {
          let ok = 0; let errs = 0;
          for (const p of sel) {
            try { await api(`/api/pedidos/${p.id}`, { method: 'DELETE' }); ok++; }
            catch { errs++; }
          }
          toast(`${ok} pedido(s) eliminado(s)${errs ? `, ${errs} con error` : ''}`, errs > 0 && ok === 0);
          await refreshKPIs();
          await renderPedidosView();
        },
      },
    ],
    columns: [
      { label: 'Pedido #', render: p => `<a href="/pedidos/${p.id}" data-link class="link-primary"><strong>#${p.pedido}</strong></a>` },
      { label: 'Estado', render: p => badgeForEstado(p.estado) },
      { label: 'Producto', render: p => `<strong>${esc(p.plantilla_nombre)}</strong>` },
      { label: 'Cliente', render: p => esc(p.contacto_nombre || '-') },
      { label: 'Fecha', render: p => esc(p.fecha || '-') },
      { label: 'Entrega Est.', render: p => esc(p.fecha_est || '-') },
      { label: 'Total', align: 'right', render: p => `<strong>${p.cantidad}</strong>` },
      {
        label: 'Acciones',
        render: p => `
          <div class="actions">
            <a href="/pedidos/${p.id}" data-link class="btn btn-sm btn-primary">Detalle</a>
            <a href="/pedidos/${p.id}/editar" data-link class="btn btn-sm">Editar</a>
            <button type="button" class="btn btn-sm btn-danger" data-del="${p.id}" data-nro="${p.pedido}">Borrar</button>
          </div>
        `,
      },
    ],
  });

  root.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!(await showConfirmModal(`¿Eliminar el pedido #${btn.dataset.nro}?`))) return;
      try {
        await api(`/api/pedidos/${btn.dataset.del}`, { method: 'DELETE' });
        toast('Pedido eliminado');
        await refreshKPIs();
        await renderPedidosView();
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
}
