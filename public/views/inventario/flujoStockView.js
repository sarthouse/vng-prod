import { api } from '../../lib/api.js';
import { esc, fmtNum } from '../../lib/format.js';
import {
  mountPageView,
  renderMatrixTable,
  renderComboFlowChart,
} from '../../lib/engine/index.js';

export async function renderFlujoStockView() {
  const root = document.getElementById('app-view');
  let granularidad = 'semana';
  let histPeriodos = 4;
  let proyPeriodos = 6;
  let filtroProducto = '';
  let filtroCategoria = '';
  let filtroRol = '';
  let soloQuiebres = false;

  const inventario = await api('/api/inventario').catch(() => []);
  const categorias = Array.from(new Set(inventario.map(i => i.categoria).filter(Boolean))).sort();

  const loadAndRender = async () => {
    const qs = new URLSearchParams({
      granularidad,
      hist: String(histPeriodos),
      proy: String(proyPeriodos),
    });
    if (filtroProducto) qs.set('producto_id', filtroProducto);
    if (filtroCategoria) qs.set('categoria', filtroCategoria);
    if (filtroRol) qs.set('rol', filtroRol);

    const data = await api(`/api/inventario/flujo-matriz?${qs.toString()}`);
    const res = data.resumen || {};
    const prodSel = data.producto_seleccionado;
    const udmLabel = prodSel ? prodSel.udm : 'un.';

    const buildFilterToolbar = (prefix) => `
      <div class="actions sx-f41bf6">
        <div class="pill-group">
          <button type="button" class="pill ${granularidad === 'semana' ? 'active' : ''}" data-fs-gran="semana">Por Semana</button>
          <button type="button" class="pill ${granularidad === 'mes' ? 'active' : ''}" data-fs-gran="mes">Por Mes</button>
        </div>
        <select class="fs-rol-sel w-auto input-sm" title="Tipo de producto">
          <option value="" ${filtroRol === '' ? 'selected' : ''}>Todos los tipos</option>
          <option value="insumos" ${filtroRol === 'insumos' ? 'selected' : ''}>Insumos</option>
          <option value="fabricados" ${filtroRol === 'fabricados' ? 'selected' : ''}>Fabricados</option>
        </select>
        <select class="fs-cat-sel w-auto input-sm" title="Categoría">
          <option value="">Todas las categorías</option>
          ${categorias.map(c => `<option value="${esc(c)}" ${c === filtroCategoria ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
        <select class="fs-prod-sel w-auto input-sm sx-9cfe42" title="Producto">
          <option value="">Todos los productos (${inventario.length})</option>
          ${inventario
            .filter(p => !filtroCategoria || p.categoria === filtroCategoria)
            .map(p => `<option value="${p.id}" ${String(p.id) === String(filtroProducto) ? 'selected' : ''}>${esc(p.nombre)} (${esc(p.udm)})</option>`).join('')}
        </select>
        <select class="fs-hist-sel w-auto input-sm" title="Períodos históricos">
          ${[2, 4, 6, 8].map(n => `<option value="${n}" ${histPeriodos === n ? 'selected' : ''}>${n} ${granularidad === 'semana' ? 'sem.' : 'meses'} hist.</option>`).join('')}
        </select>
        <select class="fs-proy-sel w-auto input-sm" title="Períodos proyectados">
          ${[4, 6, 8, 12].map(n => `<option value="${n}" ${proyPeriodos === n ? 'selected' : ''}>+${n} ${granularidad === 'semana' ? 'sem.' : 'meses'} proy.</option>`).join('')}
        </select>
      </div>
    `;

    const matrizConceptoHtml = `
      <div class="card mb-md">
        <div id="fs-chart-inline"></div>
      </div>
      <div class="card">
        <div class="card-header">
          <div>
            <h2>Matriz de Flujo de Stock por Concepto ${prodSel ? `— ${esc(prodSel.nombre)} (${esc(prodSel.udm)})` : '(Consolidado)'}</h2>
            <span class="muted text-sm">Hacé clic en cualquier celda subrayada para ver el detalle de Recepciones, Órdenes de Producción o Entregas de ese período.</span>
          </div>
          ${buildFilterToolbar('concepto')}
        </div>
        <div id="fs-matrix-concepto"></div>
      </div>
    `;

    const prodRowsFiltered = soloQuiebres
      ? (data.product_rows || []).filter(r => r.tiene_quiebre)
      : (data.product_rows || []);

    const matrizProductosHtml = `
      <div class="card">
        <div class="card-header">
          <div>
            <h2>Proyección de Saldos por Producto (${prodRowsFiltered.length})</h2>
            <span class="muted text-sm">Muestra el saldo proyectado al cierre de cada ${granularidad === 'semana' ? 'semana' : 'mes'}. En rojo se destacan los períodos con quiebre de stock.</span>
          </div>
          <div class="sx-b830ea">
            <label class="checkbox-inline sx-b68435">
              <input type="checkbox" id="fs-only-quiebres" ${soloQuiebres ? 'checked' : ''} />
              <span>Solo con alerta / quiebre proyectado</span>
            </label>
            ${buildFilterToolbar('productos')}
          </div>
        </div>
        <div id="fs-matrix-productos"></div>
      </div>
    `;

    const graficoTabHtml = `
      <div class="card">
        <div class="card-header">
          <div>
            <h2>Curva de Stock</h2>
            <span class="muted text-sm">Seleccioná un producto arriba para analizar su curva de reposición, consumos por orden y stock mínimo.</span>
          </div>
          ${buildFilterToolbar('grafico')}
        </div>
        <div id="fs-chart-main" class="sx-8e86e5"></div>
      </div>
    `;

    mountPageView(root, {
      breadcrumb: { label: 'Existencias', href: '/inventario' },
      title: 'Flujo de Stock',
      subtitle: 'Evolución histórica y proyección futura por recepciones, consumos de producción y entregas.',
      actions: [
        { label: 'Existencias', href: '/inventario' },
        { label: 'Abastecimiento', href: '/cronograma' },
        { label: '+ Nueva Orden', href: '/ordenes/nueva', primary: true },
      ],
      kpis: [
        {
          label: 'Stock Actual',
          value: `${fmtNum(res.stock_actual || 0)} ${udmLabel}`,
          hint: `Apertura: ${fmtNum(res.stock_apertura || 0)}`,
        },
        {
          label: 'Entradas Proyectadas',
          value: `+${fmtNum(res.entradas_proyectadas || 0)} ${udmLabel}`,
          tone: 'ok',
          hint: 'Recepciones + Producción',
        },
        {
          label: 'Salidas Proyectadas',
          value: `-${fmtNum(res.salidas_proyectadas || 0)} ${udmLabel}`,
          tone: 'warn',
          hint: 'Consumos + Entregas',
        },
        {
          label: 'Stock Proyectado',
          value: `${fmtNum(res.stock_final_proyectado || 0)} ${udmLabel}`,
          tone: (res.stock_final_proyectado || 0) < 0 ? 'danger' : 'ok',
          hint: res.stock_minimo_ref > 0 ? `Mínimo: ${fmtNum(res.stock_minimo_ref)}` : 'Al cierre del horizonte',
        },
        {
          label: 'Alertas de Quiebre',
          value: String(res.quiebres_proyectados || 0),
          tone: (res.quiebres_proyectados || 0) > 0 ? 'danger' : 'ok',
          hint: `${res.productos_analizados || 0} productos`,
        },
      ],
      tabs: [
        { id: 'conceptos', label: 'Matriz de Flujo', html: matrizConceptoHtml },
        { id: 'productos', label: 'Saldos por Producto', badge: res.quiebres_proyectados || 0, html: matrizProductosHtml },
        { id: 'grafico', label: 'Curva de Stock', html: graficoTabHtml },
      ],
      defaultTab: 'conceptos',
      onAfterMount: (container) => {
        const fmtQty = (v) => `${fmtNum(v)} ${udmLabel}`;

        renderComboFlowChart(container.querySelector('#fs-chart-inline'), {
          series: data.chart_series || [],
          formatValue: (v) => fmtNum(v),
          unitLabel: udmLabel,
          title: prodSel ? `Curva de Stock: ${prodSel.nombre} (${prodSel.udm})` : 'Curva de Evolución de Stock Consolidado',
          subtitle: 'Línea continua: Histórico Real · Línea punteada: Proyección según OPs, Compras y Entregas · Barras: Entradas (+) y Salidas (-)',
          showMinLine: Boolean(prodSel || res.stock_minimo_ref > 0),
        });

        renderMatrixTable(container.querySelector('#fs-matrix-concepto'), {
          periods: data.periods || [],
          rows: data.rows || [],
          formatValue: fmtQty,
          totalColLabel: 'Total / Cierre',
        });

        renderMatrixTable(container.querySelector('#fs-matrix-productos'), {
          periods: data.periods || [],
          rows: prodRowsFiltered,
          formatValue: (v) => fmtNum(v),
          totalColLabel: 'Saldo Final Proy.',
          emptyText: soloQuiebres ? 'No hay productos con quiebre de stock proyectado en el horizonte.' : 'Sin productos para mostrar.',
        });

        renderComboFlowChart(container.querySelector('#fs-chart-main'), {
          series: data.chart_series || [],
          formatValue: (v) => fmtNum(v),
          unitLabel: udmLabel,
          title: prodSel ? `Evolución Detallada — ${prodSel.nombre} (${prodSel.udm})` : 'Evolución Detallada de Stock',
          subtitle: 'Pasá el cursor sobre cada barra o nodo para inspeccionar cantidades exactas por período.',
          showMinLine: true,
        });

        container.querySelectorAll('[data-fs-gran]').forEach(btn => {
          btn.addEventListener('click', () => {
            if (granularidad === btn.dataset.fsGran) return;
            granularidad = btn.dataset.fsGran;
            loadAndRender();
          });
        });

        container.querySelectorAll('.fs-rol-sel').forEach(sel => {
          sel.addEventListener('change', (e) => {
            filtroRol = e.target.value;
            loadAndRender();
          });
        });

        container.querySelectorAll('.fs-cat-sel').forEach(sel => {
          sel.addEventListener('change', (e) => {
            filtroCategoria = e.target.value;
            filtroProducto = '';
            loadAndRender();
          });
        });

        container.querySelectorAll('.fs-prod-sel').forEach(sel => {
          sel.addEventListener('change', (e) => {
            filtroProducto = e.target.value;
            loadAndRender();
          });
        });

        container.querySelectorAll('.fs-hist-sel').forEach(sel => {
          sel.addEventListener('change', (e) => {
            histPeriodos = Number(e.target.value) || 4;
            loadAndRender();
          });
        });

        container.querySelectorAll('.fs-proy-sel').forEach(sel => {
          sel.addEventListener('change', (e) => {
            proyPeriodos = Number(e.target.value) || 6;
            loadAndRender();
          });
        });

        container.querySelector('#fs-only-quiebres')?.addEventListener('change', (e) => {
          soloQuiebres = e.target.checked;
          loadAndRender();
        });
      },
    });
  };

  await loadAndRender();
}
