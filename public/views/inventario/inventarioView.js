import { api, toast } from '../../lib/api.js';
import { esc, fmtNum, badgeForTipo } from '../../lib/format.js';
import { renderMetaPanel } from '../../lib/metaPanel.js';
import { printRemito } from '../../lib/remitoPrint.js';
import { mountCombobox } from '../../lib/autocomplete.js';
import { renderDataTable } from '../../lib/viewEngine.js';

const MOV_LABEL = {
  compra: '<span class="badge badge-ok">Compra / Recepción</span>',
  entrada_compra: '<span class="badge badge-ok">Compra / Recepción</span>',
  venta: '<span class="badge badge-confirmado">Venta / Entrega</span>',
  remito_taller: '<span class="badge badge-warn">Remito Taller</span>',
  salida_remito: '<span class="badge badge-warn">Remito Taller</span>',
  consumo_produccion: '<span class="badge badge-parcial">Producción</span>',
  consumo_op: '<span class="badge badge-parcial">Producción</span>',
  transferencia: '<span class="badge badge-confirmado">Traslado</span>',
  ajuste: '<span class="badge badge-muted">Ajuste Inventario</span>',
};

export async function renderInventarioView() {
  const root = document.getElementById('app-view');
  const [inventario, movimientos, ubicaciones, quants] = await Promise.all([
    api('/api/inventario'),
    api('/api/movimientos-stock'),
    api('/api/ubicaciones'),
    api('/api/stock-quants?solo_internas=1'),
  ]);

  let onlyAlerts = false;
  let search = '';
  let movCompFilter = '';
  let movCompId = inventario[0]?.id ? String(inventario[0].id) : '';
  let quantUbicFilter = '';
  let movMode = 'traslado'; // 'traslado' | 'ajuste'

  const internas = ubicaciones.filter(u => u.tipo === 'interna');
  const depCentral = internas.find(u => u.codigo === 'DEP-CENTRAL') || internas[0] || ubicaciones[0];
  const tallerExt = internas.find(u => u.codigo === 'TALLER-EXT') || internas[1] || depCentral;
  const virtAjuste = ubicaciones.find(u => u.codigo === 'VIRT-AJUSTE') || ubicaciones[0];

  const alertasCount = inventario.filter(i => i.alerta_minimo).length;
  const conFaltante = inventario.filter(i => i.a_comprar > 0).length;

  const draw = () => {
    document.querySelectorAll('.combo-menu').forEach(m => m.remove());
    const filteredInv = inventario.filter(i => {
      if (onlyAlerts && !i.alerta_minimo) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!i.nombre.toLowerCase().includes(q) && !(i.proveedor_nombre || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });

    const filteredMovs = movCompFilter
      ? movimientos.filter(m => String(m.producto_id) === String(movCompFilter))
      : movimientos;

    root.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Stock y Movimientos</h1>
          <p class="muted">Existencias, alertas de mínimo y movimientos de stock.</p>
        </div>
        <div class="actions">
          <a href="/traslados" data-link class="btn btn-primary">+ Nuevo Traslado / Ajuste</a>
          <a href="/cronograma" data-link class="btn">Cronograma de Compras</a>
        </div>
      </div>

      <div class="summary-cards">
        <div class="summary-card">
          <div class="label">Materiales en Catálogo</div>
          <div class="val">${inventario.length}</div>
        </div>
        <div class="summary-card">
          <div class="label">Alertas Stock Mínimo</div>
          <div class="val" style="color:var(--color-accent);">${alertasCount}</div>
        </div>
        <div class="summary-card">
          <div class="label">Con Necesidad de Compra</div>
          <div class="val">${conFaltante}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h2>Stock Disponible por Componente</h2>
        </div>
        <div class="toolbar">
          <label class="checkbox-inline">
            <input type="checkbox" id="inv-only-alerts" ${onlyAlerts ? 'checked' : ''} />
            <span>Solo alertas de stock mínimo</span>
          </label>
          <input type="search" id="inv-search" placeholder="Buscar componente o proveedor..." value="${esc(search)}" style="min-width:240px;" />
        </div>
        <div id="inv-stock-table"></div>
      </div>

      <div class="card">
        <div class="card-header">
          <h2>Stock por Ubicación / Quants (${quants.filter(q => !quantUbicFilter || String(q.ubicacion_id) === String(quantUbicFilter)).length})</h2>
          <select id="quant-ubic-filter" class="input-sm">
            <option value="">Todas las ubicaciones internas</option>
            ${ubicaciones.filter(u => u.tipo === 'interna').map(u => `<option value="${u.id}" ${String(quantUbicFilter) === String(u.id) ? 'selected' : ''}>${esc(u.nombre)}</option>`).join('')}
          </select>
        </div>
        <div id="inv-quants-table"></div>
      </div>

      <div class="card">
        <div class="card-header">
          <h2>Movimientos de Stock</h2>
          <select id="mov-comp-filter" class="input-sm">
            <option value="">Todos los productos</option>
            ${inventario.map(i => `<option value="${i.id}" ${String(movCompFilter) === String(i.id) ? 'selected' : ''}>${esc(i.nombre)}</option>`).join('')}
          </select>
        </div>
        <div id="inv-movs-table"></div>
      </div>
      <div id="inv-meta-panel"></div>
    `;

    renderDataTable(root.querySelector('#inv-stock-table'), {
      rows: filteredInv,
      emptyText: 'No hay componentes para mostrar.',
      exportFilename: `stock_actual_${new Date().toISOString().slice(0, 10)}.csv`,
      columns: [
        { label: 'Componente', render: i => `<a href="${i.plantilla_id ? `/plantillas/${i.plantilla_id}` : '/productos'}" data-link class="link-primary"><strong>${esc(i.nombre)}</strong></a>` },
        { label: 'Tipo', render: i => badgeForTipo(i.tipo) },
        { label: 'Proveedor', render: i => esc(i.proveedor_nombre || '-') },
        { label: 'Stock Físico', align: 'right', render: i => `${fmtNum(i.stock)} ${esc(i.udm)}` },
        { label: 'Reservado OP', align: 'right', render: i => fmtNum(i.reservado) },
        { label: 'Disponible', align: 'right', render: i => `<strong style="${i.disponible < 0 ? 'color:var(--color-accent);' : ''}">${fmtNum(i.disponible)}</strong>` },
        { label: 'Stock Mínimo', align: 'right', render: i => fmtNum(i.stock_minimo) },
        { label: 'A Comprar', align: 'right', render: i => `<strong>${i.a_comprar > 0 ? fmtNum(i.a_comprar) : '-'}</strong>` },
        { label: 'Estado', render: i => i.alerta_minimo ? '<span class="badge badge-cancelado">Stock Bajo</span>' : '<span class="badge badge-ok">OK</span>' },
      ],
    });

    const filteredQuants = quants.filter(q => !quantUbicFilter || String(q.ubicacion_id) === String(quantUbicFilter));
    renderDataTable(root.querySelector('#inv-quants-table'), {
      rows: filteredQuants,
      emptyText: 'No hay stock registrado en ubicaciones internas todavía.',
      exportFilename: `stock_ubicaciones_${new Date().toISOString().slice(0, 10)}.csv`,
      getRowId: (q, idx) => `${q.ubicacion_id}-${q.producto_id}-${q.lote || idx}`,
      columns: [
        { label: 'Ubicación', render: q => `<span class="badge badge-muted">${esc(q.ubicacion_nombre)}</span>` },
        { label: 'Producto / Material', render: q => `<strong>${esc(q.item_nombre)}</strong>` },
        { label: 'Lote', render: q => `<span class="muted">${esc(q.lote || '—')}</span>` },
        { label: 'Cantidad', align: 'right', render: q => `<strong>${fmtNum(q.cantidad)} ${esc(q.udm)}</strong>` },
      ],
    });

    renderDataTable(root.querySelector('#inv-movs-table'), {
      rows: filteredMovs,
      emptyText: 'No hay movimientos registrados todavía.',
      exportFilename: `movimientos_stock_${new Date().toISOString().slice(0, 10)}.csv`,
      columns: [
        { label: 'Fecha', render: m => esc(m.fecha) },
        { label: 'Movimiento', render: m => MOV_LABEL[m.tipo] || esc(m.tipo) },
        { label: 'Producto', render: m => `<strong>${esc(m.componente_nombre)}</strong>` },
        {
          label: 'Ubicación',
          render: m => m.tipo === 'transferencia'
            ? `${esc(m.origen_nombre || '—')} → ${esc(m.destino_nombre || '—')}`
            : esc(m.destino_nombre || m.origen_nombre || '—'),
        },
        { label: 'Lote', render: m => `<span class="muted">${esc(m.lote || '—')}</span>` },
        { label: 'Cantidad', align: 'right', render: m => `<strong>${m.cantidad > 0 ? '+' : ''}${fmtNum(m.cantidad)} ${esc(m.udm)}</strong>` },
        { label: 'Stock Total', align: 'right', render: m => `${fmtNum(m.stock_resultante)} ${esc(m.udm)}` },
        { label: 'Referencia / Nota', render: m => `<span class="muted">${esc(m.nota || '-')}</span>` },
        {
          label: 'Acciones',
          render: m => `
            <div class="actions">
              <button type="button" class="btn btn-sm" data-print-mov="${m.id}">Remito</button>
              <button type="button" class="btn btn-sm" data-meta-mov="${m.id}">Notas / Adj.</button>
            </div>
          `,
        },
      ],
    });

    root.querySelectorAll('[data-meta-mov]').forEach(btn => btn.addEventListener('click', () => {
      const m = movimientos.find(x => String(x.id) === String(btn.dataset.metaMov));
      const panel = root.querySelector('#inv-meta-panel');
      renderMetaPanel(panel, {
        entidadTipo: 'movimiento',
        entidadId: btn.dataset.metaMov,
        titulo: `Movimiento #${btn.dataset.metaMov} — ${m?.componente_nombre || ''}`,
        record: m || null,
        onClose: () => {},
      });
      panel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }));

    root.querySelector('#inv-only-alerts').addEventListener('change', (e) => {
      onlyAlerts = e.target.checked;
      draw();
    });

    const sEl = root.querySelector('#inv-search');
    sEl.addEventListener('input', (e) => {
      search = e.target.value;
      draw();
      const el = root.querySelector('#inv-search');
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });

    root.querySelector('#quant-ubic-filter')?.addEventListener('change', (e) => {
      quantUbicFilter = e.target.value;
      draw();
    });

    root.querySelector('#mov-comp-filter').addEventListener('change', (e) => {
      movCompFilter = e.target.value;
      draw();
    });

    root.querySelectorAll('[data-mov-mode]').forEach(btn => btn.addEventListener('click', () => {
      movMode = btn.dataset.movMode;
      draw();
    }));

    root.querySelectorAll('[data-print-mov]').forEach(btn => btn.addEventListener('click', async () => {
      const m = movimientos.find(x => String(x.id) === String(btn.dataset.printMov));
      if (!m) return;
      const t = String(m.tipo || '').toLowerCase();
      let tipoDoc = 'REMITO DE MOVIMIENTO';
      if (t === 'compra' || t === 'entrada_compra') tipoDoc = 'REMITO DE RECEPCIÓN';
      else if (t === 'venta') tipoDoc = m.cantidad < 0 ? 'REMITO DE ENTREGA' : 'REMITO DE RECEPCIÓN';
      else if (t === 'remito_taller' || t === 'salida_remito') tipoDoc = 'REMITO DE TRASLADO A TALLER';
      else if (t === 'transferencia') tipoDoc = 'REMITO DE TRASLADO INTERNO';
      else if (t === 'ajuste') tipoDoc = 'COMPROBANTE DE AJUSTE DE INVENTARIO';

      await printRemito({
        tipoDoc,
        numero: `MOV-${String(m.id).padStart(6, '0')}`,
        fecha: m.fecha,
        origen: m.origen_nombre || '—',
        destino: m.destino_nombre || '—',
        lineas: [{
          nombre: m.componente_nombre,
          lote: m.lote || '',
          cantidad: Math.abs(Number(m.cantidad) || 0),
          udm: m.udm || 'unidades',
        }],
        nota: m.nota || '',
      });
    }));
  };

  draw();
}
