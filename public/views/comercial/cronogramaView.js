import { api } from '../../lib/api.js';
import { esc, fmtNum } from '../../lib/format.js';
import { renderDataTable, renderKpiStrip } from '../../lib/viewEngine.js';

export async function renderCronogramaView() {
  const root = document.getElementById('app-view');
  const data = await api('/api/cronograma-compras');

  const urgBadge = (u) => {
    if (u === 'Comprar Hoy') return '<span class="badge badge-cancelado">Comprar Hoy</span>';
    if (u === 'Próximo') return '<span class="badge badge-warn">Próximo</span>';
    return '<span class="badge badge-ok">En Fecha</span>';
  };

  root.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Cronograma Óptimo de Compras</h1>
        <p class="muted">Fechas recomendadas de compra según las etapas de las órdenes activas, lead time por insumo y punto de reorden.</p>
      </div>
      <div class="actions">
        <a href="/compras" data-link class="btn btn-primary">+ Registrar Compra</a>
      </div>
    </div>

    <div id="mrp-kpis"></div>

    <div class="card">
      <div class="card-header">
        <h2>Compras Consolidadas por Insumo / Proveedor</h2>
      </div>
      <div id="mrp-consolidado-table"></div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2>Planificación de Compras por Etapa</h2>
      </div>
      <div id="mrp-req-table"></div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2>Reposición por Stock Mínimo</h2>
      </div>
      <div id="mrp-min-table"></div>
    </div>
  `;

  renderKpiStrip(root.querySelector('#mrp-kpis'), [
    { label: 'Lead Time Promedio Histórico', value: `${data.lead_time_global_dias} días` },
    { label: 'Entregas Analizadas', value: data.entregas_analizadas },
    { label: 'Requerimientos', value: data.requerimientos.length },
    { label: 'Alertas Stock Mínimo', value: data.alertas_stock_minimo.length, tone: data.alertas_stock_minimo.length > 0 ? 'accent' : 'default' },
  ]);

  renderDataTable(root.querySelector('#mrp-consolidado-table'), {
    rows: data.consolidado || [],
    emptyText: 'No hay requerimientos consolidados pendientes.',
    columns: [
      { label: 'Urgencia', render: c => urgBadge(c.urgencia) },
      { label: 'Fecha Compra Óptima', render: c => `<strong>${esc(c.fecha_compra_optima)}</strong>` },
      { label: 'Lead Time', render: c => `${c.lead_time_dias} días` },
      { label: 'Producto', render: c => `<strong>${esc(c.producto_nombre)}</strong>` },
      { label: 'Proveedor', render: c => esc(c.proveedor_nombre || '-') },
      { label: 'Orígenes', render: c => (c.origenes || []).map(o => `<span class="badge badge-muted" style="margin-right:3px;">${esc(o)}</span>`).join('') },
      { label: 'Demanda OPs', align: 'right', render: c => `${fmtNum(c.demanda_ordenes)} ${esc(c.udm)}` },
      { label: 'Disponible', align: 'right', render: c => fmtNum(c.stock_disponible) },
      { label: 'Stock Mín.', align: 'right', render: c => fmtNum(c.stock_minimo) },
      { label: 'A Comprar', align: 'right', render: c => `<strong>${c.a_comprar > 0 ? `${fmtNum(c.a_comprar)} ${esc(c.udm)}` : '-'}</strong>` },
    ],
  });

  renderDataTable(root.querySelector('#mrp-req-table'), {
    rows: data.requerimientos || [],
    emptyText: 'No hay requerimientos pendientes en órdenes de producción activas.',
    columns: [
      { label: 'Urgencia', render: r => urgBadge(r.urgencia) },
      { label: 'Fecha Compra Óptima', render: r => `<strong>${esc(r.fecha_compra_optima)}</strong>` },
      { label: 'Fecha Etapa', key: 'fecha_necesaria' },
      { label: 'Lead Time', render: r => `${r.lead_time_dias} días` },
      {
        label: 'Orden / Etapa',
        render: r => `
          ${r.orden_id
            ? `<a href="/ordenes/${r.orden_id}" data-link class="link-primary"><strong>${esc(r.origen)}</strong></a>`
            : `<span class="badge badge-warn">${esc(r.origen)}</span>`}
          <div class="muted" style="font-size:0.78rem;">${esc(r.etapa)}</div>
        `,
      },
      { label: 'Producto', render: r => `<strong>${esc(r.producto_nombre)}</strong>` },
      { label: 'Proveedor', render: r => esc(r.proveedor_nombre || '-') },
      { label: 'Req.', align: 'right', render: r => `${fmtNum(r.cantidad_necesaria)} ${esc(r.udm)}` },
      { label: 'Disponible', align: 'right', render: r => fmtNum(r.stock_disponible) },
      { label: 'A Comprar', align: 'right', render: r => `<strong>${r.a_comprar > 0 ? `${fmtNum(r.a_comprar)} ${esc(r.udm)}` : '-'}</strong>` },
    ],
  });

  renderDataTable(root.querySelector('#mrp-min-table'), {
    rows: data.alertas_stock_minimo || [],
    emptyText: 'Todos los componentes están por encima de su stock mínimo.',
    columns: [
      { label: 'Componente', render: a => `<strong>${esc(a.nombre)}</strong>` },
      { label: 'Proveedor', render: a => esc(a.proveedor_nombre || '-') },
      { label: 'Disponible', align: 'right', render: a => `<strong style="color:var(--color-accent);">${fmtNum(a.disponible)} ${esc(a.udm)}</strong>` },
      { label: 'Stock Mínimo', align: 'right', render: a => fmtNum(a.stock_minimo) },
      { label: 'A Comprar', align: 'right', render: a => `<strong>${fmtNum(a.a_comprar)} ${esc(a.udm)}</strong>` },
    ],
  });
}
