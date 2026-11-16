import { api, refreshKPIs, toast } from '../../lib/api.js';
import { esc, badgeForEstado, fmtNum } from '../../lib/format.js';
import { renderDataTable, renderKpiStrip } from '../../lib/engine/index.js';
import { showConfirmModal } from '../../lib/engine/index.js';

export async function renderPendientesView() {
  const root = document.getElementById('app-view');
  const data = await api('/api/pendientes');
  const entregas = data.entregas_pendientes || [];
  const ordenes = data.ordenes_pendientes || [];

  root.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Pendientes</h1>
        <p class="muted">Entregas pendientes de despacho y órdenes de producción activas.</p>
      </div>
      <div class="actions">
        <a href="/operaciones-stock" data-link class="btn">Operaciones</a>
        <a href="/ordenes/nueva" data-link class="btn btn-primary">+ Nueva Orden</a>
      </div>
    </div>

    <div id="pend-kpis"></div>

    <div class="card">
      <div class="card-header">
        <h2>Entregas Pendientes</h2>
      </div>
      <div id="pend-entregas-table"></div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2>Órdenes Pendientes</h2>
      </div>
      <div id="pend-ordenes-table"></div>
    </div>
  `;

  renderKpiStrip(root.querySelector('#pend-kpis'), [
    { label: 'Entregas Pendientes', value: entregas.length, tone: entregas.length > 0 ? 'warn' : 'default' },
    { label: 'Unidades a Entregar', value: fmtNum(data.total_entregas_unidades || 0), tone: 'accent' },
    { label: 'Órdenes en Producción', value: ordenes.length },
    { label: 'Unidades en Fabricación', value: fmtNum(data.total_ordenes_unidades || 0), tone: 'success' },
  ]);

  renderDataTable(root.querySelector('#pend-entregas-table'), {
    rows: entregas,
    emptyText: 'No hay entregas pendientes de despacho.',
    exportFilename: `entregas_pendientes_${new Date().toISOString().slice(0, 10)}.csv`,
    bulkActions: [
      {
        id: 'confirmar-entregas',
        label: 'Confirmar Entregas',
        variant: 'primary',
        confirm: (sel) => `¿Confirmar ${sel.length} entrega(s) y descontar el stock?`,
        onClick: async (sel) => {
          let ok = 0; let errs = 0;
          for (const e of sel) {
            try { await api(`/api/operaciones-stock/${e.id}/confirmar`, { method: 'POST' }); ok++; }
            catch { errs++; }
          }
          toast(`${ok} entrega(s) confirmada(s)${errs ? `, ${errs} con error` : ''}`, errs > 0 && ok === 0);
          await renderPendientesView();
        },
      },
    ],
    columns: [
      { label: 'Fecha', key: 'fecha' },
      { label: 'Operación', render: e => `<a href="/operaciones-stock/${e.id}" data-link class="link-primary"><strong>${esc(e.numero)}</strong></a>` },
      { label: 'Estado', render: e => badgeForEstado(e.estado || 'Borrador') },
      { label: 'Cliente / Destinatario', render: e => e.contacto_id ? `<a href="/contactos/${e.contacto_id}" data-link class="link-primary">${esc(e.contacto_nombre)}</a>` : esc(e.contacto_nombre || '-') },
      { label: 'Motivo', render: e => esc(e.motivo || '-') },
      {
        label: 'Doc. Origen',
        render: e => {
          if (!e.referencia_tipo || !e.referencia_id) return '<span class="muted">-</span>';
          const lbl = `${e.referencia_tipo} #${e.referencia_id}`;
          if (e.referencia_tipo === 'venta') return `<a href="/ventas/${e.referencia_id}" data-link class="link-primary">${esc(lbl)}</a>`;
          if (e.referencia_tipo === 'orden') return `<a href="/ordenes/${e.referencia_id}" data-link class="link-primary">${esc(lbl)}</a>`;
          return esc(lbl);
        },
      },
      {
        label: 'Acciones',
        render: e => `
          <div class="actions">
            <button type="button" class="btn btn-sm btn-primary" data-conf-ent="${e.id}">Confirmar Entrega</button>
            <a href="/operaciones-stock/${e.id}" data-link class="btn btn-sm">Abrir</a>
          </div>
        `,
      },
    ],
  });

  renderDataTable(root.querySelector('#pend-ordenes-table'), {
    rows: ordenes,
    emptyText: 'No hay órdenes de producción activas.',
    columns: [
      { label: 'Orden', render: o => `<a href="/ordenes/${o.id}" data-link class="link-primary"><strong>${esc(o.codigo)}</strong></a>` },
      { label: 'Estado', render: o => badgeForEstado(o.estado) },
      { label: 'Producto', render: o => `<strong>${esc(o.plantilla_nombre)}</strong>` },
      { label: 'Inicio', key: 'fecha_inicio' },
      { label: 'Entrega Obj.', key: 'fecha_objetivo' },
      {
        label: 'Acciones',
        render: o => `<a href="/ordenes/${o.id}" data-link class="btn btn-sm">Abrir Orden</a>`,
      },
    ],
  });

  root.querySelectorAll('[data-conf-ent]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!(await showConfirmModal('¿Confirmar esta entrega y descontar el stock?'))) return;
      try {
        await api(`/api/operaciones-stock/${btn.dataset.confEnt}/confirmar`, { method: 'POST' });
        toast('Entrega confirmada');
        await Promise.all([renderPendientesView(), refreshKPIs()]);
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
}
