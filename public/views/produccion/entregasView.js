import { api, toast, refreshKPIs } from '../../lib/api.js';
import { esc } from '../../lib/format.js';
import { showConfirmModal } from '../../lib/engine/index.js';
import { renderDataTable } from '../../lib/engine/index.js';

export async function renderEntregasView() {
  const root = document.getElementById('app-view');
  const entregas = await api('/api/entregas');

  root.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Entregas Registradas</h1>
        <p class="muted">Seguimiento de entregas parciales o totales por pedido.</p>
      </div>
      <div class="actions">
        <a href="/entregas/nueva" data-link class="btn btn-primary">+ Nueva Entrega</a>
      </div>
    </div>

    <div class="card">
      <div id="entregas-table-wrap"></div>
    </div>
  `;

  renderDataTable(root.querySelector('#entregas-table-wrap'), {
    rows: entregas,
    emptyText: 'No hay entregas registradas todavía.',
    exportFilename: `entregas_${new Date().toISOString().slice(0, 10)}.csv`,
    bulkActions: [
      {
        id: 'eliminar',
        label: 'Eliminar seleccionadas',
        variant: 'danger',
        confirm: (sel) => `¿Eliminar ${sel.length} entrega(s) seleccionada(s)?`,
        onClick: async (sel) => {
          let ok = 0; let errs = 0;
          for (const e of sel) {
            try { await api(`/api/entregas/${e.id}`, { method: 'DELETE' }); ok++; }
            catch { errs++; }
          }
          toast(`${ok} entrega(s) eliminada(s)${errs ? `, ${errs} con error` : ''}`, errs > 0 && ok === 0);
          await refreshKPIs();
          await renderEntregasView();
        },
      },
    ],
    columns: [
      { label: 'Fecha', render: e => esc(e.fecha || '-') },
      { label: 'Entrega #', render: e => `<strong>#${e.nro_entrega}</strong>` },
      { label: 'Lote / Pedido #', render: e => `<strong>#${e.lote}</strong>` },
      { label: 'Producto', render: e => `<strong>${esc(e.plantilla_nombre || '-')}</strong>` },
      { label: 'Total', align: 'right', render: e => `<strong>${e.total}</strong>` },
      { label: 'Observaciones', render: e => `<span class="muted">${esc(e.observaciones || '-')}</span>` },
      {
        label: 'Acciones',
        render: e => `
          <div class="actions">
            <a href="/entregas/${e.id}/editar" data-link class="btn btn-sm">Editar</a>
            <button type="button" class="btn btn-sm btn-danger" data-del="${e.id}">Borrar</button>
          </div>
        `,
      },
    ],
  });

  root.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!(await showConfirmModal('¿Eliminar esta entrega?'))) return;
      try {
        await api(`/api/entregas/${btn.dataset.del}`, { method: 'DELETE' });
        toast('Entrega eliminada');
        await refreshKPIs();
        await renderEntregasView();
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
}
