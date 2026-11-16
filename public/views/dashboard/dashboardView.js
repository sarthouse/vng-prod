import { api } from '../../lib/api.js';
import { esc, fmtMoney, fmtNum, badgeForEstado } from '../../lib/format.js';
import { renderKpiStrip, renderDataTable } from '../../lib/engine/index.js';

export async function renderDashboardView() {
  const root = document.getElementById('app-view');
  const d = await api('/api/dashboard');
  const b = d.borradores || {};
  const totalBorradores = (b.compras || 0) + (b.recepciones || 0) + (b.entregas || 0) + (b.remitos_taller || 0) + (b.presupuestos_venta || 0);

  root.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Dashboard</h1>
        <p class="muted">Resumen financiero, operativo y alertas pendientes de confirmación.</p>
      </div>
      <div class="actions">
        <a href="/ventas" data-link class="btn">+ Nueva Venta</a>
        <a href="/compras" data-link class="btn">+ Nueva Compra</a>
        <a href="/ordenes/nueva" data-link class="btn btn-primary">+ Nueva Orden</a>
      </div>
    </div>

    <div id="dash-kpis"></div>

    <div class="dashboard-grid" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap:1rem; margin-bottom:1rem;">
      <div class="card" style="margin-bottom:0;">
        <div class="card-header">
          <h2>Borradores Pendientes</h2>
        </div>
        <div id="dash-borradores"></div>
      </div>

      <div class="card" style="margin-bottom:0;">
        <div class="card-header">
          <h2>Alertas de Stock Bajo Mínimo (${(d.stock_bajo_minimo || []).length})</h2>
          <a href="/inventario" data-link class="btn btn-sm">Ver inventario</a>
        </div>
        <div id="dash-stock-bajo"></div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2>Órdenes de Producción Activas</h2>
        <a href="/ordenes" data-link class="btn btn-sm">Ver todas</a>
      </div>
      <div id="dash-ordenes"></div>
    </div>
  `;

  renderKpiStrip(root.querySelector('#dash-kpis'), [
    { label: 'Caja Disponible', value: fmtMoney(d.caja_disponible), tone: 'success', href: '/tesoreria' },
    { label: 'Cuentas por Cobrar', value: fmtMoney(d.cuentas_por_cobrar), href: '/ventas' },
    { label: 'Cuentas por Pagar', value: fmtMoney(d.cuentas_por_pagar), tone: d.cuentas_por_pagar > 0 ? 'accent' : 'default', href: '/compras' },
    { label: 'Valor de Stock', value: fmtMoney(d.valor_inventario), href: '/inventario' },
    { label: 'Ventas Confirmadas', value: fmtMoney(d.ventas_totales), href: '/ventas' },
    { label: 'Compras Confirmadas', value: fmtMoney(d.compras_totales), href: '/compras' },
  ]);

  const borradorRows = [
    { tipo: 'Compras en Borrador', cantidad: b.compras || 0, href: '/compras' },
    { tipo: 'Recepciones en Borrador', cantidad: b.recepciones || 0, href: '/operaciones-stock' },
    { tipo: 'Entregas en Borrador', cantidad: b.entregas || 0, href: '/operaciones-stock' },
    { tipo: 'Traslados en Borrador', cantidad: b.remitos_taller || 0, href: '/operaciones-stock' },
    { tipo: 'Presupuestos de Venta', cantidad: b.presupuestos_venta || 0, href: '/ventas' },
  ].filter(r => r.cantidad > 0);

  renderDataTable(root.querySelector('#dash-borradores'), {
    emptyText: 'No hay borradores pendientes de confirmación.',
    columns: [
      { label: 'Documento / Operación', render: r => `<a href="${esc(r.href)}" data-link class="link-primary">${esc(r.tipo)}</a>` },
      { label: 'Pendientes', align: 'right', render: r => `<span class="badge badge-parcial">${r.cantidad}</span>` },
    ],
    rows: borradorRows,
  });

  renderDataTable(root.querySelector('#dash-stock-bajo'), {
    emptyText: 'Todos los productos están por encima del stock mínimo.',
    columns: [
      { label: 'Producto', render: r => `<a href="/plantillas/${r.plantilla_id}" data-link class="link-primary">${esc(r.nombre)}</a>` },
      { label: 'Actual', align: 'right', render: r => `<strong style="color:var(--color-accent);">${fmtNum(r.stock)} ${esc(r.udm)}</strong>` },
      { label: 'Mínimo', align: 'right', render: r => `${fmtNum(r.stock_minimo)}` },
    ],
    rows: d.stock_bajo_minimo || [],
  });

  renderDataTable(root.querySelector('#dash-ordenes'), {
    emptyText: 'Sin órdenes de producción activas.',
    columns: [
      { label: 'Orden', render: r => `<a href="/ordenes/${r.id}" data-link class="link-primary"><strong>${esc(r.codigo)}</strong></a>` },
      { label: 'Modelo', render: r => esc(r.modelo_nombre || '-') },
      { label: 'Estado', render: r => badgeForEstado(r.estado) },
      { label: 'Cantidad', align: 'right', render: r => `<strong>${r.cantidad || 0}</strong>` },
      { label: 'Objetivo', render: r => esc(r.fecha_objetivo || '-') },
    ],
    rows: d.ordenes_activas_list || [],
  });
}
