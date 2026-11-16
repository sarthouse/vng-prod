import { api, toast } from '../../lib/api.js';
import { exportRowsToCSV, esc, fmtMoney, fmtNum } from '../../lib/format.js';
import { renderMetaPanel } from '../../lib/metaPanel.js';
import { openPdfFromEndpoint } from '../../lib/remitoPrint.js';
import { mountDetailView } from '../../lib/engine/detailEngine.js';

export async function renderPresupuestoDetalleView(container, params) {
  const p = await api(`/api/presupuestos/${params.id}`);

  const mainHtml = `
    <div class="card">
      <div class="card-header"><h2>Insumos</h2></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Categoría</th>
              <th>Proveedor</th>
              <th class="num">Precio Unit.</th>
              <th class="num">Requerido</th>
              <th class="num">Mín. Compra</th>
              <th class="num">A Comprar</th>
              <th>Unidad</th>
              <th class="num">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${p.items.map(it => `
              <tr>
                <td><strong>${esc(it.nombre)}</strong></td>
                <td>${esc(it.categoria)}</td>
                <td>${esc(it.proveedor_nombre || '-')}</td>
                <td class="num">${fmtMoney(it.precio_unitario)}</td>
                <td class="num">${fmtNum(it.cantidad, 4)}</td>
                <td class="num">${it.minimo_compra > 0 ? fmtNum(it.minimo_compra, 3) : '-'}</td>
                <td class="num"><strong>${fmtNum(it.a_comprar ?? it.cantidad, 4)}</strong></td>
                <td>${esc(it.udm)}</td>
                <td class="num"><strong>${fmtMoney(it.subtotal)}</strong></td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="8"><strong>Total</strong></td>
              <td class="num"><strong>${fmtMoney(p.total_monto)}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>
      ${p.observaciones ? `<p class="muted" style="margin-top:10px; font-size:0.85rem;">Observaciones: ${esc(p.observaciones)}</p>` : ''}
    </div>
  `;

  mountDetailView(container, {
    breadcrumb: { label: 'Volver a Dashboard', href: '/' },
    title: `Presupuesto #${p.id} — ${p.titulo}`,
    subtitle: `Fecha: ${esc(p.fecha)}`,
    badge: { text: p.estado || 'Confirmado', className: 'badge-confirmado' },
    actions: [
      {
        label: 'Imprimir PDF',
        primary: true,
        onClick: async () => {
          try {
            await openPdfFromEndpoint('/api/print/presupuesto-pdf', { presupuesto: p }, `Presupuesto_${p.id}.pdf`);
          } catch (err) {
            toast(err.message, true);
          }
        },
      },
      {
        label: 'Exportar CSV',
        onClick: () => {
          exportRowsToCSV(
            ['Producto', 'Categoría', 'Proveedor', 'Precio Unitario', 'Requerido', 'Mínimo Compra', 'A Comprar', 'Unidad', 'Subtotal'],
            p.items.map(it => [
              it.nombre,
              it.categoria,
              it.proveedor_nombre || '',
              Number(it.precio_unitario || 0),
              Number(it.cantidad || 0),
              Number(it.minimo_compra || 0),
              Number(it.a_comprar ?? it.cantidad ?? 0),
              it.udm,
              Number(it.subtotal || 0),
            ]),
            `presupuesto_${p.id}.csv`
          );
        },
      },
    ],
    smartButtons: [
      { label: 'Insumos', count: (p.items || []).length, icon: '📦' },
    ],
    kpis: [
      { label: 'Fecha', value: esc(p.fecha) },
      { label: 'Unidades', value: fmtNum(p.total_pares || 0) },
      { label: 'Total', value: fmtMoney(p.total_monto || 0), tone: 'ok' },
      { label: 'Ítems', value: String((p.items || []).length) },
    ],
    mainHtml,
    sidebarHtml: '<div id="presupuesto-meta-panel"></div>',
    onMountSidebar: (sidebarEl) => {
      renderMetaPanel(sidebarEl.querySelector('#presupuesto-meta-panel'), {
        entidadTipo: 'presupuesto',
        entidadId: p.id,
        titulo: `Presupuesto #${p.id}`,
        record: p,
      });
    },
  });
}
