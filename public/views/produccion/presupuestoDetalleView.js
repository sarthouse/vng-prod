import { api } from '../../lib/api.js';
import { downloadCSV, esc, fmtMoney, fmtNum } from '../../lib/format.js';

export async function renderPresupuestoDetalleView(container, params) {
  const p = await api(`/api/presupuestos/${params.id}`);

  container.innerHTML = `
    <div class="panel-header">
      <div>
        <h2>Snapshot de Presupuesto #${p.id}: ${esc(p.titulo)}</h2>
        <p class="muted">Registro inmutable guardado el ${p.fecha}.</p>
      </div>
      <div class="actions">
        <button class="btn btn-secondary" id="btn-export-snap">Exportar CSV</button>
        <a href="/" data-link class="btn btn-secondary">← Volver al Dashboard</a>
      </div>
    </div>

    <div class="detail-meta">
      <div><span>Fecha</span><strong>${p.fecha}</strong></div>
      <div><span>Total Pares</span><strong>${p.total_pares}</strong></div>
      <div><span>Total Presupuesto</span><strong>${fmtMoney(p.total_monto)}</strong></div>
      <div><span>Observaciones</span><strong>${esc(p.observaciones || '-')}</strong></div>
    </div>

    <div class="card">
      <div class="card-title">Detalle de Insumos (Snapshot)</div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Categoría</th>
              <th>Proveedor</th>
              <th class="num">Precio Unit.</th>
              <th class="num">Cant. Necesaria</th>
              <th class="num">Mín. Compra</th>
              <th class="num">A Comprar</th>
              <th>UdM</th>
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
              <td colspan="8">Total Snapshot</td>
              <td class="num">${fmtMoney(p.total_monto)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  `;

  container.querySelector('#btn-export-snap').addEventListener('click', () => {
    const csv = [
      ['Componente', 'Categoria', 'Proveedor', 'Precio Unit', 'Cantidad', 'Minimo', 'A Comprar', 'UdM', 'Subtotal'].join(','),
      ...p.items.map(it => [`"${it.nombre.replace(/"/g, '""')}"`, `"${it.categoria}"`, `"${it.proveedor_nombre || ''}"`, it.precio_unitario, it.cantidad, it.minimo_compra, it.a_comprar ?? it.cantidad, `"${it.udm}"`, it.subtotal].join(',')),
    ].join('\n');
    downloadCSV(csv, `presupuesto_${p.id}.csv`);
  });
}
