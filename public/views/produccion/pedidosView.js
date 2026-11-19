import { api, toast, refreshKPIs } from '../../lib/api.js';
import { esc, filterVisibleDocs, renderDocEstadoBadges, buildArchivarBulkActions } from '../../lib/format.js';
import { showConfirmModal } from '../../lib/engine/index.js';
import { renderDataTable } from '../../lib/engine/index.js';

let pedShowHidden = false;

export async function renderPedidosView() {
  const root = document.getElementById('app-view');
  const pedidos = await api('/api/pedidos');
  const visible = filterVisibleDocs(pedidos, pedShowHidden);

  root.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Registro de Pedidos</h1>
        <p class="muted">Pedidos de producción con snapshot congelado de receta e insumos a comprar.</p>
      </div>
      <div class="actions">
        <button type="button" id="btn-ped-toggle-hidden" class="btn ${pedShowHidden ? 'btn-primary' : ''}">
          ${pedShowHidden ? 'Ocultar cancelados / archivados' : 'Mostrar cancelados / archivados'}
        </button>
        <a href="/pedidos/nuevo" data-link class="btn btn-primary">+ Nuevo Pedido</a>
      </div>
    </div>

    <div class="card">
      <div id="pedidos-table-wrap"></div>
    </div>
  `;

  root.querySelector('#btn-ped-toggle-hidden').addEventListener('click', () => {
    pedShowHidden = !pedShowHidden;
    renderPedidosView();
  });

  renderDataTable(root.querySelector('#pedidos-table-wrap'), {
    rows: visible,
    emptyText: 'No hay pedidos registrados. Podés crear uno nuevo o enviar la curva actual desde Curva y Planificación.',
    exportFilename: `pedidos_${new Date().toISOString().slice(0, 10)}.csv`,
    bulkActions: [
      {
        id: 'confirmar',
        label: 'Confirmar Borradores',
        variant: 'primary',
        confirm: (sel) => {
          const n = sel.filter(p => p.estado === 'Borrador').length;
          return n ? `¿Confirmar ${n} pedido(s) en Borrador?` : null;
        },
        onClick: async (sel) => {
          const targets = sel.filter(p => p.estado === 'Borrador');
          if (!targets.length) { toast('No hay pedidos en Borrador en la selección', true); return; }
          let ok = 0; let errs = 0;
          for (const p of targets) {
            try { await api(`/api/pedidos/${p.id}`, { method: 'PUT', body: JSON.stringify({ estado: 'Confirmado' }) }); ok++; }
            catch { errs++; }
          }
          toast(`${ok} confirmado(s)${errs ? `, ${errs} con error` : ''}`, errs > 0 && ok === 0);
          await refreshKPIs();
          await renderPedidosView();
        },
      },
      {
        id: 'cancelar',
        label: 'Cancelar seleccionados',
        confirm: (sel) => {
          const n = sel.filter(p => !['Entregado', 'Cancelado'].includes(p.estado)).length;
          return n ? `¿Cancelar ${n} pedido(s) seleccionado(s)?` : null;
        },
        onClick: async (sel) => {
          const targets = sel.filter(p => !['Entregado', 'Cancelado'].includes(p.estado));
          if (!targets.length) { toast('No hay pedidos cancelables en la selección', true); return; }
          let ok = 0; let errs = 0;
          for (const p of targets) {
            try { await api(`/api/pedidos/${p.id}/cancelar`, { method: 'POST' }); ok++; }
            catch { errs++; }
          }
          toast(`${ok} cancelado(s)${errs ? `, ${errs} con error` : ''}`, errs > 0 && ok === 0);
          await refreshKPIs();
          await renderPedidosView();
        },
      },
      ...buildArchivarBulkActions({
        api,
        toast,
        endpointPrefix: '/api/pedidos',
        showHidden: pedShowHidden,
        onDone: async () => { await refreshKPIs(); await renderPedidosView(); },
      }),
      {
        id: 'eliminar',
        label: 'Eliminar Borradores',
        variant: 'danger',
        confirm: (sel) => {
          const n = sel.filter(p => p.estado === 'Borrador').length;
          return n ? `¿Eliminar ${n} borrador(es) seleccionado(s)?` : null;
        },
        onClick: async (sel) => {
          const targets = sel.filter(p => p.estado === 'Borrador');
          if (!targets.length) { toast('Solo se pueden eliminar pedidos en Borrador', true); return; }
          let ok = 0; let errs = 0;
          for (const p of targets) {
            try { await api(`/api/pedidos/${p.id}`, { method: 'DELETE' }); ok++; }
            catch { errs++; }
          }
          toast(`${ok} borrador(es) eliminado(s)${errs ? `, ${errs} con error` : ''}`, errs > 0 && ok === 0);
          await refreshKPIs();
          await renderPedidosView();
        },
      },
    ],
    columns: [
      { label: 'Pedido #', render: p => `<a href="/pedidos/${p.id}" data-link class="link-primary"><strong>#${p.pedido}</strong></a>` },
      { label: 'Estado', render: p => renderDocEstadoBadges(p) },
      { label: 'Producto', render: p => `<strong>${esc(p.plantilla_nombre)}</strong>` },
      { label: 'Cliente', render: p => esc(p.contacto_nombre || '-') },
      { label: 'Fecha', render: p => esc(p.fecha || '-') },
      { label: 'Entrega Est.', render: p => esc(p.fecha_est || '-') },
      { label: 'Total', align: 'right', render: p => `<strong>${p.cantidad}</strong>` },
      {
        label: 'Acciones',
        render: p => `
          <div class="actions">
            ${p.estado === 'Borrador' ? `<button type="button" class="btn btn-sm btn-primary" data-conf-ped="${p.id}" data-nro="${p.pedido}">Confirmar</button>` : ''}
            <a href="/pedidos/${p.id}" data-link class="btn btn-sm ${p.estado === 'Borrador' ? '' : 'btn-primary'}">Detalle</a>
            <a href="/pedidos/${p.id}/editar" data-link class="btn btn-sm">Editar</a>
            <button type="button" class="btn btn-sm btn-danger" data-del="${p.id}" data-nro="${p.pedido}">Borrar</button>
          </div>
        `,
      },
    ],
  });

  root.querySelectorAll('[data-conf-ped]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/pedidos/${btn.dataset.confPed}`, {
          method: 'PUT',
          body: JSON.stringify({ estado: 'Confirmado' }),
        });
        toast(`Pedido #${btn.dataset.nro} confirmado`);
        await refreshKPIs();
        await renderPedidosView();
      } catch (err) {
        toast(err.message, true);
      }
    });
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
