import { api, toast } from '../../lib/api.js';
import { esc, fmtMoney, badgeForEstado, renderPuntoVentaOptions, bindPuntoVentaSeq, bindCuentaMetodoSync, exportRowsToCSV } from '../../lib/format.js';
import { renderMetaPanel } from '../../lib/metaPanel.js';
import { printRemito } from '../../lib/remitoPrint.js';
import { printOrdenPago } from '../../lib/tesoreriaPrint.js';
import { mountCombobox, quickCreateProveedor, quickCreateProducto } from '../../lib/autocomplete.js';
import { getIvaRatesFromConfig, calcDocumentTotals, renderTaxFooterHtml } from '../../lib/taxHelper.js';
import { renderKpiStrip, renderFilterBar, renderDataTable } from '../../lib/viewEngine.js';
import { showConfirmModal, showPromptModal } from '../../lib/modal.js';
import { navigate } from '../../router.js';

async function imprimirRemitoCompra(compraId, empresa) {
  const data = await api(`/api/compras/${compraId}`);
  const cmp = data.compra || {};
  await printRemito({
    tipoDoc: 'REMITO DE COMPRA / RECEPCIÓN',
    numero: cmp.numero,
    fecha: cmp.fecha,
    mostrarOrigenDestino: false,
    contraparteLabel: 'Proveedor',
    contraparteNombre: cmp.proveedor_nombre || '',
    contraparteCuit: cmp.proveedor_cuit || '',
    contraparteDireccion: cmp.proveedor_direccion || '',
    contraparteLocalidad: cmp.proveedor_localidad || '',
    contraparteProvincia: cmp.proveedor_provincia || '',
    contraparteCp: cmp.proveedor_codigo_postal || '',
    contraparteTelefono: cmp.proveedor_telefono || '',
    contraparteEmail: cmp.proveedor_email || '',
    lineas: data.lineas || [],
    nota: cmp.observaciones || '',
    empresa,
  });
}

export async function renderComprasView() {
  const root = document.getElementById('app-view');
  const [compras, empresa] = await Promise.all([
    api('/api/compras'),
    api('/api/empresa'),
  ]);

  let filterEstado = '';
  let filterClase = '';
  let search = '';

  const getFilteredCompras = () => {
    const q = search.trim().toLowerCase();
    return compras.filter(c => {
      if (filterEstado && c.estado !== filterEstado) return false;
      if (filterClase && (c.clase_documento || 'factura') !== filterClase) return false;
      if (q) {
        const hay = `${c.numero || ''} ${c.proveedor_nombre || ''} ${c.observaciones || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  };

  root.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Compras</h1>
        <p class="muted">Registro de compras a proveedores.</p>
      </div>
      <div class="actions">
        <button type="button" id="btn-export-compras" class="btn">Exportar CSV</button>
        <a href="/compras/nueva" data-link class="btn btn-primary">+ Nueva Compra</a>
      </div>
    </div>

    <div id="cmp-kpis"></div>

    <div class="card">
      <div id="cmp-filters"></div>
      <div id="cmp-table-wrap"></div>
    </div>
  `;

  const cmpConf = compras.filter(c => c.estado !== 'Borrador');
  const cmpBorr = compras.filter(c => c.estado === 'Borrador').length;
  const cmpTotal = cmpConf.reduce((s, c) => s + (c.clase_documento === 'nota_credito' ? -Number(c.total || 0) : Number(c.total || 0)), 0);
  const cmpPagado = compras.reduce((s, c) => s + Number(c.pagado || 0), 0);
  const cmpSaldo = compras.reduce((s, c) => s + Number(c.saldo_pendiente || 0), 0);
  renderKpiStrip(root.querySelector('#cmp-kpis'), [
    { label: 'Compras Confirmadas', value: fmtMoney(cmpTotal) },
    { label: 'En Borrador', value: String(cmpBorr), tone: cmpBorr > 0 ? 'warn' : 'default' },
    { label: 'Total Pagado', value: fmtMoney(cmpPagado), tone: 'success' },
    { label: 'Saldo por Pagar', value: fmtMoney(cmpSaldo), tone: cmpSaldo > 0 ? 'accent' : 'default' },
  ]);

  const drawTable = () => {
    renderDataTable(root.querySelector('#cmp-table-wrap'), {
      rows: getFilteredCompras(),
      emptyText: 'No hay compras registradas para ese filtro.',
      exportFilename: `compras_${new Date().toISOString().slice(0, 10)}.csv`,
      bulkActions: [
        {
          id: 'eliminar',
          label: 'Eliminar seleccionadas',
          variant: 'danger',
          confirm: (sel) => `¿Eliminar ${sel.length} compra(s) seleccionada(s)?`,
          onClick: async (sel) => {
            let ok = 0; let errs = 0;
            for (const c of sel) {
              try { await api(`/api/compras/${c.id}`, { method: 'DELETE' }); ok++; }
              catch { errs++; }
            }
            toast(`${ok} compra(s) eliminada(s)${errs ? `, ${errs} con error` : ''}`, errs > 0 && ok === 0);
            await renderComprasView();
          },
        },
      ],
      columns: [
        { label: 'Fecha', render: c => esc(c.fecha) },
        {
          label: 'Número',
          render: c => `<a href="/compras/${c.id}" data-link class="link-primary"><strong>${esc(c.numero || '#' + c.id)}</strong></a>${c.clase_documento === 'nota_credito' ? ' <span class="badge badge-parcial">NC</span>' : c.clase_documento === 'nota_debito' ? ' <span class="badge badge-muted">ND</span>' : ''}`,
        },
        { label: 'Estado', render: c => badgeForEstado(c.estado) },
        {
          label: 'AFIP',
          render: c => c.caracter === 'interno'
            ? '<span class="badge badge-muted">Interno</span>'
            : (c.afip_constatado ? `<span class="badge badge-ok" title="Constatado en AFIP ${esc(c.afip_constatado_fecha || '')}">AFIP OK</span>` : '<span class="badge badge-muted">-</span>'),
        },
        { label: 'Proveedor', render: c => `<a href="/contactos/${c.proveedor_id}" data-link class="link-primary">${esc(c.proveedor_nombre)}</a>` },
        { label: 'Total', align: 'right', render: c => `<strong>${fmtMoney(c.total)}</strong>` },
        { label: 'Pagado', align: 'right', render: c => fmtMoney(c.pagado) },
        { label: 'Saldo', align: 'right', render: c => `<strong style="color:${c.saldo_pendiente > 0 ? 'var(--color-accent)' : 'var(--color-success)'};">${fmtMoney(c.saldo_pendiente)}</strong>` },
        {
          label: 'Acciones',
          render: c => `
            <div class="actions">
              ${c.estado === 'Borrador' ? `<button type="button" class="btn btn-sm btn-primary" data-conf-cmp="${c.id}" data-caracter="${esc(c.caracter || 'fiscal')}">Confirmar</button>` : ''}
              ${c.caracter === 'fiscal' && c.cae && !c.afip_constatado ? `<button type="button" class="btn btn-sm" data-constatar-cmp="${c.id}">Constatar AFIP</button>` : ''}
              ${c.afip_constatado ? `<button type="button" class="btn btn-sm" data-xml-cmp="${c.id}">XML AFIP</button>` : ''}
              <a href="/compras/${c.id}" data-link class="btn btn-sm">Abrir</a>
              <button type="button" class="btn btn-sm" data-print-cmp="${c.id}">Remito</button>
              <button type="button" class="btn btn-sm btn-danger" data-del-cmp="${c.id}">Eliminar</button>
            </div>
          `,
        },
      ],
    });

    root.querySelectorAll('[data-xml-cmp]').forEach(btn => btn.addEventListener('click', async () => {
      try {
        const logs = await api(`/api/afip/xml?entidad_tipo=compra&entidad_id=${btn.dataset.xmlCmp}`);
        const ok = logs.find(l => l.resultado === 'A') || logs[0];
        if (!ok) { toast('No hay XML AFIP archivado para esta compra', true); return; }
        window.location.href = `/api/afip/xml/${ok.id}/download?parte=res`;
      } catch (err) { toast(err.message, true); }
    }));
    root.querySelectorAll('[data-constatar-cmp]').forEach(btn => btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Constatando...';
      try {
        const r = await api(`/api/compras/${btn.dataset.constatarCmp}/constatar`, { method: 'POST' });
        toast(`Comprobante constatado en AFIP (${r.entorno})${r.obs_texto ? ': ' + r.obs_texto : ''}`);
        await renderComprasView();
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
        btn.textContent = 'Constatar AFIP';
      }
    }));
    root.querySelectorAll('[data-conf-cmp]').forEach(btn => btn.addEventListener('click', async () => {
      const esFiscal = btn.dataset.caracter !== 'interno';
      const nro = esFiscal ? (await showPromptModal('Ingresá el número de factura del proveedor:')) : '';
      if (esFiscal && (!nro || !nro.trim())) return;
      try {
        await api(`/api/compras/${btn.dataset.confCmp}/confirmar`, {
          method: 'POST',
          body: JSON.stringify({ numero: nro ? nro.trim() : '' }),
        });
        toast('Compra confirmada y recepción generada en Borrador');
        await renderComprasView();
      } catch (err) { toast(err.message, true); }
    }));
    root.querySelectorAll('[data-print-cmp]').forEach(btn => btn.addEventListener('click', async () => {
      try { await imprimirRemitoCompra(btn.dataset.printCmp, empresa); }
      catch (err) { toast(err.message, true); }
    }));
    root.querySelectorAll('[data-del-cmp]').forEach(btn => btn.addEventListener('click', async () => {
      if (!(await showConfirmModal('¿Eliminar esta compra?'))) return;
      await api(`/api/compras/${btn.dataset.delCmp}`, { method: 'DELETE' });
      toast('Compra eliminada');
      await renderComprasView();
    }));
  };

  const cmpEstados = [...new Set(compras.map(c => c.estado).filter(Boolean))];
  renderFilterBar(root.querySelector('#cmp-filters'), {
    searchValue: search,
    searchPlaceholder: 'Buscar número, proveedor u observación...',
    filters: [
      {
        name: 'estado',
        value: filterEstado,
        options: [
          { value: '', label: 'Todos los estados' },
          ...cmpEstados.map(st => ({ value: st, label: st })),
        ],
      },
      {
        name: 'clase',
        value: filterClase,
        options: [
          { value: '', label: 'Todos los comprobantes' },
          { value: 'factura', label: 'Facturas' },
          { value: 'nota_credito', label: 'Notas de Crédito' },
          { value: 'nota_debito', label: 'Notas de Débito' },
        ],
      },
    ],
    onChange: (st) => {
      search = st.search;
      filterEstado = st.estado || '';
      filterClase = st.clase || '';
      drawTable();
    },
  });
  drawTable();

  root.querySelector('#btn-export-compras').addEventListener('click', () => {
    const rows = getFilteredCompras();
    if (!rows.length) { toast('No hay compras para exportar', true); return; }
    exportRowsToCSV(
      ['Fecha', 'Número', 'Clase', 'Tipo', 'Carácter', 'CAE', 'Constatado AFIP', 'Proveedor', 'Estado', 'Neto', 'IVA', 'Otros Imp.', 'Total', 'Pagado', 'Saldo'],
      rows.map(c => [
        c.fecha, c.numero || `#${c.id}`, c.clase_documento || 'factura', c.tipo_comprobante || '',
        c.caracter || 'fiscal', c.cae || '', c.afip_constatado ? 'Sí' : 'No',
        c.proveedor_nombre || '', c.estado,
        Number(c.neto || 0), Number(c.iva_monto || 0), Number(c.otros_impuestos_monto || 0),
        Number(c.total || 0), Number(c.pagado || 0), Number(c.saldo_pendiente || 0),
      ]),
      `compras_${new Date().toISOString().slice(0, 10)}.csv`
    );
  });
}

export async function renderCompraFormView({ id } = {}) {
  const root = document.getElementById('app-view');
  const isEdit = Boolean(id);
  const params = new URLSearchParams(window.location.search);

  const [proveedores, productos, empresa, cuentas, puntosVenta, nextCompraSeq, nextPagoSeq, existing, comprasList, impuestosConfig, planCuentas, ubicaciones, terminosPago, metodosPago] = await Promise.all([
    api('/api/contactos?es_proveedor=1'),
    api('/api/productos?se_compra=1'),
    api('/api/empresa'),
    api('/api/tesoreria/cuentas'),
    api('/api/puntos-venta'),
    !isEdit ? api('/api/secuencias/siguiente?tipo=compra') : Promise.resolve(null),
    isEdit ? api('/api/secuencias/siguiente?tipo=pago') : Promise.resolve(null),
    isEdit ? api(`/api/compras/${id}`) : Promise.resolve(null),
    api('/api/compras'),
    api('/api/impuestos?aplica_a=compras&solo_activos=1').catch(() => []),
    api('/api/tesoreria/plan-cuentas').catch(() => []),
    api('/api/ubicaciones').catch(() => []),
    api('/api/terminos-pago?solo_activos=1').catch(() => []),
    api('/api/metodos-pago?solo_activos=1').catch(() => []),
  ]);

  const ubicacionesActivas = (ubicaciones || []).filter(u => u.activo !== 0);
  const cuentasEgreso = planCuentas.filter(pc => pc.activo !== 0 && pc.imputable !== 0 && pc.tipo === 'egreso');
  const ivaRates = getIvaRatesFromConfig(impuestosConfig);
  const otrosImpuestosConfig = impuestosConfig.filter(ic => ic.tipo !== 'iva');
  const prodMap = new Map(productos.map(p => [String(p.id), p]));
  const defaultIva = Number(empresa?.alicuota_iva_compras_defecto ?? empresa?.alicuota_iva_defecto ?? 21);

  const c = existing?.compra || null;
  const isBorrador = !isEdit || c?.estado === 'Borrador';
  const editable = isBorrador;

  let proveedorId = String(c?.contacto_id || c?.proveedor_id || params.get('proveedor_id') || '');
  let ubicacionId = c?.ubicacion_id ? String(c.ubicacion_id) : '';
  let claseDocumento = c?.clase_documento || 'factura';
  let comprobanteOrigenId = c?.comprobante_origen_id ? String(c.comprobante_origen_id) : '';
  let caracter = c?.caracter || 'fiscal';
  let tipoComprobante = c?.tipo_comprobante || (caracter === 'interno' ? 'INT' : 'FA-A');
  let numero = c?.numero || (caracter === 'interno' && nextCompraSeq?.numero ? nextCompraSeq.numero : '');
  let fecha = c?.fecha || new Date().toISOString().slice(0, 10);
  let fechaVencimiento = c?.fecha_vencimiento || '';
  let terminoPagoId = c?.termino_pago_id ? String(c.termino_pago_id) : '';
  let metodoPagoId = c?.metodo_pago_id ? String(c.metodo_pago_id) : '';
  const calcDueFromTerm = (fechaStr, tpId) => {
    const tp = (terminosPago || []).find(t => Number(t.id) === Number(tpId));
    if (!tp || !fechaStr) return '';
    const dt = new Date(`${String(fechaStr).slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(dt.getTime())) return '';
    dt.setUTCDate(dt.getUTCDate() + (Number(tp.dias) || 0));
    return dt.toISOString().slice(0, 10);
  };
  if (!isEdit && proveedorId) {
    const initProv = proveedores.find(p => String(p.id) === String(proveedorId));
    if (initProv) {
      terminoPagoId = String(initProv.termino_pago_compra_id || initProv.termino_pago_id || '');
      metodoPagoId = String(initProv.metodo_pago_id || '');
      if (!fechaVencimiento && terminoPagoId) fechaVencimiento = calcDueFromTerm(fecha, terminoPagoId);
    }
  }
  let cae = c?.cae || '';

  let lineas = (existing?.lineas || []).map(l => ({
    producto_id: l.producto_id ? String(l.producto_id) : '',
    plan_cuenta_id: l.plan_cuenta_id ? Number(l.plan_cuenta_id) : '',
    descripcion: l.descripcion || l.item_nombre || '',
    cantidad: Number(l.cantidad) || 0,
    udm: l.udm || 'unidades',
    precio_unitario: Number(l.precio_unitario) || 0,
    alicuota_iva: Number(l.alicuota_iva ?? defaultIva),
    subtotal: Number(l.subtotal) || 0,
  }));
  if (!isEdit && lineas.length === 0) {
    lineas.push({ producto_id: '', plan_cuenta_id: '', descripcion: '', cantidad: 1, udm: 'unidades', precio_unitario: 0, alicuota_iva: defaultIva, subtotal: 0 });
  }

  let impuestos = (existing?.impuestos || []).map(imp => ({
    impuesto_id: imp.impuesto_id || null,
    nombre: imp.nombre || '',
    tipo: imp.tipo || 'percepcion',
    base: Number(imp.base) || 0,
    alicuota: Number(imp.alicuota) || 0,
    monto: Number(imp.monto) || 0,
  }));

  const draw = () => {
    document.querySelectorAll('.combo-menu').forEach(m => m.remove());
    const totals = calcDocumentTotals(lineas, impuestos, caracter, tipoComprobante);
    const pagos = existing?.pagos || [];

    root.innerHTML = `
      <div class="page-header">
        <div>
          <div style="margin-bottom:6px;"><a href="/compras" data-link class="muted" style="font-size:0.85rem;">← Volver a Compras</a></div>
          <h1>${isEdit ? `Compra ${esc(c?.numero || '#' + id)}` : 'Nueva Compra'}</h1>
          ${isEdit && c ? `
            <p class="muted" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              ${badgeForEstado(c.estado)}
              <span>${esc(c.proveedor_nombre || '')}</span>
              ${c.afip_constatado ? `<span class="badge badge-ok">AFIP Constatado</span>` : ''}
            </p>
          ` : '<p class="muted">Registro de comprobante de compra a proveedor.</p>'}
        </div>
        ${isEdit && c ? `
          <div class="actions">
            ${c.estado === 'Borrador' ? `<button type="button" class="btn btn-primary" id="btn-cmp-confirmar">Confirmar Compra</button>` : ''}
            ${c.caracter === 'fiscal' && c.cae && !c.afip_constatado ? `<button type="button" class="btn" id="btn-cmp-constatar-doc">Constatar AFIP</button>` : ''}
            ${c.afip_constatado ? `<button type="button" class="btn" id="btn-cmp-xml">XML AFIP</button>` : ''}
            <button type="button" class="btn" id="btn-cmp-remito">Imprimir Remito</button>
          </div>
        ` : ''}
      </div>

      <div class="card">
        <form id="form-compra" class="form-grid">
          <label>
            <span>Proveedor *</span>
            ${editable ? '<div id="cmp-prov-combo"></div>' : `<input type="text" value="${esc(c?.proveedor_nombre || '')}" disabled />`}
          </label>
          <label>
            <span>Clase</span>
            <select name="clase_documento" id="cmp-clase" ${editable ? '' : 'disabled'}>
              <option value="factura" ${claseDocumento === 'factura' ? 'selected' : ''}>Factura</option>
              <option value="nota_credito" ${claseDocumento === 'nota_credito' ? 'selected' : ''}>Nota de Crédito</option>
              <option value="nota_debito" ${claseDocumento === 'nota_debito' ? 'selected' : ''}>Nota de Débito</option>
            </select>
          </label>
          ${claseDocumento !== 'factura' ? `
            <label>
              <span>Comprobante Origen</span>
              <select name="comprobante_origen_id" id="cmp-origen-doc" ${editable ? '' : 'disabled'}>
                <option value="">-- Opcional --</option>
                ${comprasList.filter(x => x.clase_documento === 'factura').map(x => `<option value="${x.id}" ${String(x.id) === comprobanteOrigenId ? 'selected' : ''}>${esc(x.numero || '#' + x.id)} (${esc(x.proveedor_nombre)})</option>`).join('')}
              </select>
            </label>
          ` : ''}
          <label>
            <span>Carácter</span>
            <select name="caracter" id="cmp-caracter" ${editable ? '' : 'disabled'}>
              <option value="fiscal" ${caracter === 'fiscal' ? 'selected' : ''}>Factura Fiscal</option>
              <option value="interno" ${caracter === 'interno' ? 'selected' : ''}>Comprobante Interno</option>
            </select>
          </label>
          ${caracter === 'fiscal' ? `
            <label>
              <span>Tipo de Comprobante</span>
              <select name="tipo_comprobante" id="cmp-tipo" ${editable ? '' : 'disabled'}>
                ${['FA-A', 'FA-B', 'FA-C', 'FA-M', 'NC-A', 'NC-B', 'ND-A', 'ND-B'].map(t => `<option value="${t}" ${tipoComprobante === t ? 'selected' : ''}>${t}</option>`).join('')}
              </select>
            </label>
            <label><span>Nº Factura Proveedor</span><input type="text" name="numero" id="cmp-num" value="${esc(numero)}" placeholder="0001-00012345" ${editable ? '' : 'disabled'} /></label>
            <label style="min-width:0;">
              <span>CAE</span>
              <div style="display:flex;gap:6px;align-items:center;min-width:0;">
                <input type="text" name="cae" id="cmp-cae" value="${esc(cae)}" placeholder="Opcional" style="flex:1;min-width:0;width:auto;" ${editable ? '' : 'disabled'} />
                ${editable ? `<button type="button" class="btn btn-sm" id="btn-cmp-constatar" title="Constatar comprobante en AFIP (WSCDC)" style="flex-shrink:0;white-space:nowrap;">Constatar</button>` : ''}
              </div>
            </label>
          ` : `
            <label>
              <span>Punto de Venta</span>
              <select name="punto_venta" id="cmp-pv" ${editable ? '' : 'disabled'}>${renderPuntoVentaOptions(puntosVenta, c?.punto_venta ?? nextCompraSeq?.punto_venta)}</select>
            </label>
            <label><span>Número Interno</span><input type="text" name="numero" id="cmp-num" value="${esc(numero || nextCompraSeq?.numero || '')}" ${editable ? '' : 'disabled'} /></label>
          `}
          <label><span>Fecha *</span><input type="date" name="fecha" id="cmp-fecha" required value="${esc(fecha)}" ${editable ? '' : 'disabled'} /></label>
          <label>
            <span>Término de Pago</span>
            <select name="termino_pago_id" id="cmp-tp" ${editable ? '' : 'disabled'}>
              <option value="">-- Manual / Contado --</option>
              ${(terminosPago || []).map(t => `<option value="${t.id}" ${Number(terminoPagoId) === Number(t.id) ? 'selected' : ''}>${esc(t.nombre)} (${t.dias}d)</option>`).join('')}
            </select>
          </label>
          <label><span>Vencimiento</span><input type="date" name="fecha_vencimiento" id="cmp-vto" value="${esc(fechaVencimiento)}" ${editable ? '' : 'disabled'} /></label>
          <label>
            <span>Método de Pago</span>
            <select name="metodo_pago_id" id="cmp-mp" ${editable ? '' : 'disabled'}>
              <option value="">-- Sin definir --</option>
              ${(metodosPago || []).map(m => `<option value="${m.id}" ${Number(metodoPagoId) === Number(m.id) ? 'selected' : ''}>${esc(m.nombre)}</option>`).join('')}
            </select>
          </label>
          <label>
            <span>Depósito Destino (Stock)</span>
            <select name="ubicacion_id" id="cmp-ubicacion" ${editable ? '' : 'disabled'}>
              <option value="">-- Por defecto --</option>
              ${ubicacionesActivas.map(u => `<option value="${u.id}" ${String(ubicacionId || '') === String(u.id) ? 'selected' : ''}>${esc(u.codigo)} · ${esc(u.nombre)}</option>`).join('')}
            </select>
          </label>

          <div class="full">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <strong>Detalle</strong>
              ${editable ? '<button type="button" id="btn-cmp-add-line" class="btn btn-sm">+ Agregar Ítem</button>' : ''}
            </div>
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>Producto</th><th>Descripción</th><th>Cuenta Gasto</th><th class="num">Cant.</th><th>Unidad</th><th class="num">Precio</th><th>IVA</th><th class="num">Subtotal</th>${editable ? '<th></th>' : ''}</tr></thead>
                <tbody>
                  ${lineas.map((l, idx) => `
                    <tr>
                      <td style="min-width:190px;">${editable ? `<div class="cl-prod-combo" data-idx="${idx}"></div>` : esc(prodMap.get(String(l.producto_id))?.nombre || '-')}</td>
                      <td><input type="text" class="cl-desc" data-idx="${idx}" value="${esc(l.descripcion)}" placeholder="Ej: Servicio de luz / ítem" ${editable ? '' : 'disabled'} /></td>
                      <td>
                        <select class="cl-cta" data-idx="${idx}" style="min-width:165px;" ${editable ? '' : 'disabled'}>
                          <option value="">-- Por defecto --</option>
                          ${cuentasEgreso.map(pc => `<option value="${pc.id}" ${String(l.plan_cuenta_id || '') === String(pc.id) ? 'selected' : ''}>${esc(pc.codigo)} ${esc(pc.nombre)}</option>`).join('')}
                        </select>
                      </td>
                      <td class="num"><input type="number" step="0.01" min="0" class="cl-qty" data-idx="${idx}" value="${l.cantidad}" style="width:80px;text-align:right;" ${editable ? '' : 'disabled'} /></td>
                      <td><span class="badge badge-muted cl-udm-badge" data-idx="${idx}">${esc(l.udm || 'unidades')}</span></td>
                      <td class="num"><input type="number" step="0.01" min="0" class="cl-price" data-idx="${idx}" value="${l.precio_unitario}" style="width:100px;text-align:right;" ${editable ? '' : 'disabled'} /></td>
                      <td>
                        <select class="cl-iva" data-idx="${idx}" style="width:85px;" ${(!editable || totals.noIva) ? 'disabled' : ''}>
                          ${ivaRates.map(r => `<option value="${r.value}" ${Number(l.alicuota_iva ?? defaultIva) === r.value ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}
                        </select>
                      </td>
                      <td class="num"><strong class="cl-sub" data-idx="${idx}">${fmtMoney(l.subtotal)}</strong></td>
                      ${editable ? `<td><button type="button" class="btn btn-sm btn-danger cl-del" data-idx="${idx}">Quitar</button></td>` : ''}
                    </tr>
                  `).join('')}
                </tbody>
                <tfoot id="cmp-tfoot">
                  ${renderTaxFooterHtml(totals, impuestos, editable ? 7 : 6)}
                </tfoot>
              </table>
            </div>
          </div>

          <div class="full" style="border-top:1px solid var(--color-border);padding-top:12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
              <strong>Percepciones, Retenciones y Otros Impuestos</strong>
              ${editable ? `
                <div style="display:flex;gap:8px;align-items:center;">
                  <select id="cmp-imp-select" style="min-width:220px;">
                    <option value="">-- Elegir impuesto configurado --</option>
                    ${otrosImpuestosConfig.map(ic => `<option value="${ic.id}">${esc(ic.nombre)} (${Number(ic.alicuota_defecto || 0)}%)</option>`).join('')}
                  </select>
                  <button type="button" id="btn-cmp-add-imp" class="btn btn-sm">+ Agregar Impuesto</button>
                  <button type="button" id="btn-cmp-sugerir-iibb" class="btn btn-sm">Sugerir IIBB (Padrón)</button>
                </div>
              ` : ''}
            </div>
            ${impuestos.length ? `
              <div class="table-wrap">
                <table class="data-table">
                  <thead><tr><th>Impuesto</th><th>Tipo</th><th class="num">Base</th><th class="num">Alícuota (%)</th><th class="num">Monto</th>${editable ? '<th></th>' : ''}</tr></thead>
                  <tbody>
                    ${impuestos.map((imp, iIdx) => `
                      <tr>
                        <td><strong>${esc(imp.nombre)}</strong></td>
                        <td>${esc(imp.tipo)}</td>
                        <td class="num"><input type="number" step="0.01" min="0" class="ci-base" data-idx="${iIdx}" value="${Number(imp.base || 0)}" style="width:110px;text-align:right;" ${editable ? '' : 'disabled'} /></td>
                        <td class="num"><input type="number" step="0.01" min="0" class="ci-aliq" data-idx="${iIdx}" value="${Number(imp.alicuota || 0)}" style="width:85px;text-align:right;" ${editable ? '' : 'disabled'} /></td>
                        <td class="num"><input type="number" step="0.01" min="0" class="ci-monto" data-idx="${iIdx}" value="${Number(imp.monto || 0)}" style="width:110px;text-align:right;" ${editable ? '' : 'disabled'} /></td>
                        ${editable ? `<td><button type="button" class="btn btn-sm btn-danger ci-del" data-idx="${iIdx}">Quitar</button></td>` : ''}
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            ` : '<p class="muted" style="font-size:0.82rem;margin:0;">Sin percepciones ni retenciones adicionales.</p>'}
          </div>

          ${editable ? `
            <div class="full modal-footer">
              <a href="/compras" data-link class="btn">Cancelar</a>
              <button type="submit" class="btn btn-primary">${isEdit ? 'Guardar Borrador' : 'Guardar Compra'}</button>
            </div>
          ` : ''}
        </form>
      </div>

      ${isEdit && c ? `
        <div class="card" style="border-left:4px solid var(--color-blue);">
          <div class="card-header">
            <div>
              <h2>Pagos Asociados</h2>
              <p class="muted" style="font-size:0.82rem;">
                Total: <strong>${fmtMoney(c.total)}</strong> ·
                Pagado: <strong>${fmtMoney(c.pagado)}</strong> ·
                Saldo Pendiente: <strong style="color:${c.saldo_pendiente > 0 ? 'var(--color-accent)' : 'var(--color-success)'};">${fmtMoney(c.saldo_pendiente)}</strong>
              </p>
            </div>
          </div>

          <form id="form-pago-compra" class="form-grid" style="margin-bottom:12px;">
            <label><span>Fecha *</span><input type="date" name="fecha" required value="${new Date().toISOString().slice(0, 10)}" /></label>
            <label>
              <span>Cuenta *</span>
              <select name="cuenta_id" required>
                ${cuentas.map(ct => `<option value="${ct.id}">${esc(ct.nombre)} (${fmtMoney(ct.saldo_actual)})</option>`).join('')}
              </select>
            </label>
            <label>
              <span>Método</span>
              <select name="metodo">
                ${['Transferencia', 'Efectivo', 'Cheque', 'MercadoPago', 'Otro'].map(m => `<option value="${m}">${m}</option>`).join('')}
              </select>
            </label>
            <label>
              <span>Punto de Venta</span>
              <select name="punto_venta" id="pago-cmp-pv">${renderPuntoVentaOptions(puntosVenta, nextPagoSeq?.punto_venta)}</select>
            </label>
            <label><span>Comprobante</span><input type="text" name="numero" id="pago-cmp-num" value="${esc(nextPagoSeq?.numero || '')}" /></label>
            <label><span>Monto *</span><input type="number" step="0.01" min="0.01" name="monto" required value="${c.saldo_pendiente > 0 ? c.saldo_pendiente : ''}" /></label>
            <div style="align-self:end;"><button type="submit" class="btn btn-primary">+ Registrar Pago</button></div>
          </form>

          ${pagos.length === 0 ? '<div class="empty-state">Sin pagos asociados todavía.</div>' : `
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>Fecha</th><th>Comprobante</th><th>Cuenta</th><th>Método</th><th class="num">Monto</th><th>Acciones</th></tr></thead>
                <tbody>
                  ${pagos.map(p => `
                    <tr>
                      <td>${esc(p.fecha)}</td>
                      <td><strong>${esc(p.numero || '#' + p.id)}</strong></td>
                      <td>${esc(p.cuenta_nombre || '-')}</td>
                      <td>${esc(p.metodo)}</td>
                      <td class="num"><strong>${fmtMoney(p.monto)}</strong></td>
                      <td>
                        <div class="actions">
                          <button type="button" class="btn btn-sm" data-print-pago-cmp="${p.id}">PDF</button>
                          <button type="button" class="btn btn-sm btn-danger" data-del-pago-cmp="${p.id}">Eliminar</button>
                        </div>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>

        <div id="cmp-det-meta"></div>
      ` : ''}
    `;

    if (isEdit && c) {
      renderMetaPanel(root.querySelector('#cmp-det-meta'), {
        entidadTipo: 'compra',
        entidadId: c.id,
        titulo: `Compra ${c.numero || '#' + c.id}`,
        record: c,
        onClose: null,
      });

      root.querySelector('#btn-cmp-remito')?.addEventListener('click', async () => {
        try { await imprimirRemitoCompra(c.id, empresa); }
        catch (err) { toast(err.message, true); }
      });

      root.querySelector('#btn-cmp-xml')?.addEventListener('click', async () => {
        try {
          const logs = await api(`/api/afip/xml?entidad_tipo=compra&entidad_id=${c.id}`);
          const ok = logs.find(l => l.resultado === 'A') || logs[0];
          if (!ok) { toast('No hay XML AFIP archivado para esta compra', true); return; }
          window.location.href = `/api/afip/xml/${ok.id}/download?parte=res`;
        } catch (err) { toast(err.message, true); }
      });

      root.querySelector('#btn-cmp-constatar-doc')?.addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        btn.disabled = true;
        btn.textContent = 'Constatando...';
        try {
          const r = await api(`/api/compras/${c.id}/constatar`, { method: 'POST' });
          toast(`Comprobante constatado en AFIP (${r.entorno})${r.obs_texto ? ': ' + r.obs_texto : ''}`);
          await renderCompraFormView({ id });
        } catch (err) {
          toast(err.message, true);
          btn.disabled = false;
          btn.textContent = 'Constatar AFIP';
        }
      });

      root.querySelector('#btn-cmp-confirmar')?.addEventListener('click', async () => {
        const esFiscal = c.caracter !== 'interno';
        const nro = esFiscal && !c.numero ? (await showPromptModal('Ingresá el número de factura del proveedor:')) : (c.numero || '');
        if (esFiscal && !c.numero && (!nro || !nro.trim())) return;
        try {
          await api(`/api/compras/${c.id}/confirmar`, {
            method: 'POST',
            body: JSON.stringify({ numero: nro ? nro.trim() : '' }),
          });
          toast('Compra confirmada y recepción generada en Borrador');
          await renderCompraFormView({ id });
        } catch (err) { toast(err.message, true); }
      });

      bindPuntoVentaSeq(root.querySelector('#pago-cmp-pv'), root.querySelector('#pago-cmp-num'), 'pago', api);
      bindCuentaMetodoSync(
        root.querySelector('#form-pago-compra select[name="cuenta_id"]'),
        root.querySelector('#form-pago-compra select[name="metodo"]'),
        cuentas
      );
      root.querySelector('#form-pago-compra')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          await api('/api/tesoreria/pagos', {
            method: 'POST',
            body: JSON.stringify({
              fecha: fd.get('fecha'),
              cuenta_id: Number(fd.get('cuenta_id')),
              proveedor_id: c.proveedor_id,
              compra_id: c.id,
              metodo: fd.get('metodo'),
              numero: fd.get('numero'),
              monto: Number(fd.get('monto')),
              concepto: `Pago compra ${c.numero || '#' + c.id}`,
            }),
          });
          toast('Pago registrado y asociado a la compra');
          await renderCompraFormView({ id });
        } catch (err) { toast(err.message, true); }
      });
      root.querySelectorAll('[data-print-pago-cmp]').forEach(btn => btn.addEventListener('click', async () => {
        try {
          const data = await api(`/api/tesoreria/pagos/${btn.dataset.printPagoCmp}`);
          await printOrdenPago({ pago: data.pago || {}, lineas: data.lineas || [] });
        } catch (err) { toast(err.message, true); }
      }));
      root.querySelectorAll('[data-del-pago-cmp]').forEach(btn => btn.addEventListener('click', async () => {
        if (!(await showConfirmModal('¿Eliminar este pago?'))) return;
        await api(`/api/tesoreria/pagos/${btn.dataset.delPagoCmp}`, { method: 'DELETE' });
        toast('Pago eliminado');
        await renderCompraFormView({ id });
      }));
    }

    if (editable) {
      mountCombobox(root.querySelector('#cmp-prov-combo'), {
        name: 'proveedor_id',
        required: true,
        value: proveedorId,
        placeholder: 'Buscar o crear proveedor...',
        items: proveedores.map(p => ({ value: String(p.id), label: p.nombre, sublabel: p.cuit || (p.es_taller ? 'Taller' : ''), raw: p })),
        onSelect: (it) => {
          proveedorId = it ? String(it.value) : '';
          if (it?.raw && !isEdit) {
            const tp = it.raw.termino_pago_compra_id || it.raw.termino_pago_id || '';
            if (tp) {
              terminoPagoId = String(tp);
              const tpEl = root.querySelector('#cmp-tp');
              if (tpEl) tpEl.value = terminoPagoId;
              const due = calcDueFromTerm(root.querySelector('#cmp-fecha')?.value || fecha, terminoPagoId);
              if (due) {
                fechaVencimiento = due;
                const vtoEl = root.querySelector('#cmp-vto');
                if (vtoEl) vtoEl.value = due;
              }
            }
            if (it.raw.metodo_pago_id) {
              metodoPagoId = String(it.raw.metodo_pago_id);
              const mpEl = root.querySelector('#cmp-mp');
              if (mpEl) mpEl.value = metodoPagoId;
            }
          }
        },
        onCreate: async (q) => {
          const created = await quickCreateProveedor(q, { es_taller: false });
          if (created) {
            proveedores.push(created.raw);
            proveedorId = created.value;
          }
          return created;
        },
      });

      const syncHeaderMeta = () => {
        numero = root.querySelector('#cmp-num')?.value ?? numero;
        fecha = root.querySelector('#cmp-fecha')?.value || fecha;
        terminoPagoId = root.querySelector('#cmp-tp')?.value ?? terminoPagoId;
        fechaVencimiento = root.querySelector('#cmp-vto')?.value ?? fechaVencimiento;
        metodoPagoId = root.querySelector('#cmp-mp')?.value ?? metodoPagoId;
        cae = root.querySelector('#cmp-cae')?.value ?? cae;
        ubicacionId = root.querySelector('#cmp-ubicacion')?.value ?? ubicacionId;
      };
      const syncCmpVto = () => {
        const tpVal = root.querySelector('#cmp-tp')?.value || '';
        const fVal = root.querySelector('#cmp-fecha')?.value || fecha;
        if (!tpVal) return;
        const due = calcDueFromTerm(fVal, tpVal);
        if (due) {
          fechaVencimiento = due;
          const vtoEl = root.querySelector('#cmp-vto');
          if (vtoEl) vtoEl.value = due;
        }
      };
      root.querySelector('#cmp-tp')?.addEventListener('change', syncCmpVto);
      root.querySelector('#cmp-fecha')?.addEventListener('change', syncCmpVto);

      const syncTotals = () => {
        const t = calcDocumentTotals(lineas, impuestos, caracter, tipoComprobante);
        const tfoot = root.querySelector('#cmp-tfoot');
        if (tfoot) tfoot.innerHTML = renderTaxFooterHtml(t, impuestos, 7);
      };
      const onNum = (i) => {
        lineas[i].subtotal = Number((lineas[i].cantidad * lineas[i].precio_unitario).toFixed(2));
        root.querySelector(`.cl-sub[data-idx="${i}"]`).textContent = fmtMoney(lineas[i].subtotal);
        syncTotals();
      };

      root.querySelector('#cmp-caracter')?.addEventListener('change', (e) => {
        syncHeaderMeta();
        caracter = e.target.value;
        tipoComprobante = caracter === 'interno' ? 'INT' : 'FA-A';
        numero = caracter === 'interno' ? (nextCompraSeq?.numero || '') : '';
        draw();
      });
      root.querySelector('#cmp-tipo')?.addEventListener('change', (e) => {
        syncHeaderMeta();
        tipoComprobante = e.target.value;
        draw();
      });

      const prodItems = () => productos.map(p => ({ value: String(p.id), label: p.nombre, sublabel: p.codigo || p.udm, raw: p }));
      root.querySelectorAll('.cl-prod-combo').forEach(el => {
        const i = Number(el.dataset.idx);
        mountCombobox(el, {
          value: lineas[i].producto_id,
          placeholder: 'Buscar o crear producto...',
          items: prodItems(),
          onSelect: async (it) => {
            if (!it) {
              lineas[i].producto_id = '';
              return;
            }
            const p = it.raw;
            lineas[i].producto_id = String(p.id);
            lineas[i].descripcion = p.nombre;
            lineas[i].udm = p.udm || 'unidades';
            let resolvedCosto = Number(p.costo || p.precio || 0);
            try {
              if (proveedorId) {
                const pr = await api(`/api/producto-proveedores/resolver?contacto_id=${proveedorId}&producto_id=${p.id}&cantidad=${lineas[i].cantidad || 1}`);
                if (pr && pr.origen !== 'costo_catalogo' && typeof pr.precio_unitario === 'number') {
                  resolvedCosto = pr.precio_unitario;
                }
              }
            } catch { /* fallback a costo catálogo */ }
            lineas[i].precio_unitario = resolvedCosto;
            lineas[i].alicuota_iva = Number(p.alicuota_iva ?? defaultIva);
            lineas[i].subtotal = Number((lineas[i].cantidad * lineas[i].precio_unitario).toFixed(2));
            const descInp = root.querySelector(`.cl-desc[data-idx="${i}"]`);
            const udmBadge = root.querySelector(`.cl-udm-badge[data-idx="${i}"]`);
            const priceInp = root.querySelector(`.cl-price[data-idx="${i}"]`);
            const ivaSel = root.querySelector(`.cl-iva[data-idx="${i}"]`);
            if (descInp) descInp.value = lineas[i].descripcion;
            if (udmBadge) udmBadge.textContent = lineas[i].udm;
            if (priceInp) priceInp.value = lineas[i].precio_unitario;
            if (ivaSel) ivaSel.value = String(lineas[i].alicuota_iva);
            onNum(i);
          },
          onCreate: async (q) => {
            const created = await quickCreateProducto(q, { se_compra: true, se_fabrica: false });
            if (created) {
              productos.push(created.raw);
              prodMap.set(created.value, created.raw);
            }
            return created;
          },
        });
      });

      root.querySelector('#btn-cmp-constatar')?.addEventListener('click', async () => {
        syncHeaderMeta();
        const t = calcDocumentTotals(lineas, impuestos, caracter, tipoComprobante);
        const btn = root.querySelector('#btn-cmp-constatar');
        btn.disabled = true;
        btn.textContent = 'Constatando...';
        try {
          const r = await api('/api/compras/constatar', {
            method: 'POST',
            body: JSON.stringify({
              contacto_id: proveedorId ? Number(proveedorId) : null,
              tipo_comprobante: tipoComprobante,
              numero,
              fecha,
              total: t.total,
              cae,
            }),
          });
          toast(`Comprobante constatado en AFIP (${r.entorno})${r.obs_texto ? ': ' + r.obs_texto : ''}`);
        } catch (err) {
          toast(err.message, true);
        } finally {
          btn.disabled = false;
          btn.textContent = 'Constatar';
        }
      });

      root.querySelector('#btn-cmp-add-line')?.addEventListener('click', () => {
        syncHeaderMeta();
        lineas.push({ producto_id: '', plan_cuenta_id: '', descripcion: '', cantidad: 1, udm: 'unidades', precio_unitario: 0, alicuota_iva: defaultIva, subtotal: 0 });
        draw();
      });
      if (caracter === 'interno') {
        bindPuntoVentaSeq(root.querySelector('#cmp-pv'), root.querySelector('#cmp-num'), 'compra', api);
      }
      root.querySelectorAll('.cl-del').forEach(b => b.addEventListener('click', () => { syncHeaderMeta(); lineas.splice(Number(b.dataset.idx), 1); draw(); }));
      root.querySelectorAll('.cl-desc').forEach(inp => inp.addEventListener('input', () => { lineas[Number(inp.dataset.idx)].descripcion = inp.value; }));
      root.querySelectorAll('.cl-cta').forEach(sel => sel.addEventListener('change', () => { lineas[Number(sel.dataset.idx)].plan_cuenta_id = sel.value ? Number(sel.value) : ''; }));
      root.querySelectorAll('.cl-qty').forEach(inp => inp.addEventListener('input', () => { const i = Number(inp.dataset.idx); lineas[i].cantidad = Number(inp.value) || 0; onNum(i); }));
      root.querySelectorAll('.cl-price').forEach(inp => inp.addEventListener('input', () => { const i = Number(inp.dataset.idx); lineas[i].precio_unitario = Number(inp.value) || 0; onNum(i); }));
      root.querySelectorAll('.cl-iva').forEach(sel => sel.addEventListener('change', () => { const i = Number(sel.dataset.idx); lineas[i].alicuota_iva = Number(sel.value) || 0; syncTotals(); }));

      root.querySelector('#btn-cmp-add-imp')?.addEventListener('click', () => {
        syncHeaderMeta();
        const selId = root.querySelector('#cmp-imp-select')?.value;
        const cfg = impuestosConfig.find(x => String(x.id) === String(selId));
        if (!cfg) { toast('Elegí un impuesto configurado', true); return; }
        const t = calcDocumentTotals(lineas, impuestos, caracter, tipoComprobante);
        const base = cfg.base_calculo === 'total' ? Number((t.neto + t.ivaTotal).toFixed(2)) : cfg.base_calculo === 'fijo' ? 0 : t.neto;
        const alic = Number(cfg.alicuota_defecto || 0);
        const monto = cfg.base_calculo === 'fijo' ? alic : Number((base * alic / 100).toFixed(2));
        impuestos.push({ impuesto_id: cfg.id, nombre: cfg.nombre, tipo: cfg.tipo, base_calculo: cfg.base_calculo, base, alicuota: alic, monto });
        draw();
      });
      root.querySelector('#btn-cmp-sugerir-iibb')?.addEventListener('click', async () => {
        syncHeaderMeta();
        if (!contactoId) { toast('Seleccioná primero un proveedor', true); return; }
        const t = calcDocumentTotals(lineas, impuestos, caracter, tipoComprobante);
        try {
          const res = await api('/api/fiscal/sugerir-percepciones', {
            method: 'POST',
            body: JSON.stringify({
              contacto_id: Number(contactoId),
              neto: t.neto,
              total: Number((t.neto + t.ivaTotal).toFixed(2)),
              aplica_a: 'compras',
            }),
          });
          const sugs = res.sugerencias || [];
          if (!sugs.length) { toast('Sin percepciones IIBB sugeridas para la jurisdicción del proveedor'); return; }
          for (const s of sugs) {
            if (!impuestos.some(x => Number(x.impuesto_id) === Number(s.impuesto_id))) {
              impuestos.push({
                impuesto_id: s.impuesto_id,
                nombre: s.nombre,
                tipo: 'percepcion',
                base_calculo: 'neto',
                base: s.base_imponible,
                alicuota: s.alicuota,
                monto: s.monto,
              });
            }
          }
          toast(`Aplicadas ${sugs.length} percepción(es) IIBB (Jur. ${res.jurisdiccion_codigo || '-'})`);
          draw();
        } catch (err) { toast(err.message, true); }
      });
      root.querySelectorAll('.ci-base').forEach(inp => inp.addEventListener('input', () => {
        const i = Number(inp.dataset.idx);
        impuestos[i].base = Number(inp.value) || 0;
        impuestos[i].monto = Number((impuestos[i].base * (Number(impuestos[i].alicuota) || 0) / 100).toFixed(2));
        const mInp = root.querySelector(`.ci-monto[data-idx="${i}"]`);
        if (mInp) mInp.value = impuestos[i].monto;
        syncTotals();
      }));
      root.querySelectorAll('.ci-aliq').forEach(inp => inp.addEventListener('input', () => {
        const i = Number(inp.dataset.idx);
        impuestos[i].alicuota = Number(inp.value) || 0;
        impuestos[i].monto = Number(((Number(impuestos[i].base) || 0) * impuestos[i].alicuota / 100).toFixed(2));
        const mInp = root.querySelector(`.ci-monto[data-idx="${i}"]`);
        if (mInp) mInp.value = impuestos[i].monto;
        syncTotals();
      }));
      root.querySelectorAll('.ci-monto').forEach(inp => inp.addEventListener('input', () => {
        const i = Number(inp.dataset.idx);
        impuestos[i].monto = Number(inp.value) || 0;
        syncTotals();
      }));
      root.querySelectorAll('.ci-del').forEach(b => b.addEventListener('click', () => {
        syncHeaderMeta();
        impuestos.splice(Number(b.dataset.idx), 1);
        draw();
      }));

      root.querySelector('#cmp-clase')?.addEventListener('change', (e) => {
        syncHeaderMeta();
        claseDocumento = e.target.value;
        if (caracter === 'fiscal') {
          tipoComprobante = claseDocumento === 'nota_credito' ? 'NC-A' : claseDocumento === 'nota_debito' ? 'ND-A' : 'FA-A';
        }
        draw();
      });
      root.querySelector('#cmp-origen-doc')?.addEventListener('change', (e) => { comprobanteOrigenId = e.target.value; });

      root.querySelector('#form-compra').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        if (!Number(fd.get('proveedor_id'))) {
          toast('Seleccioná o creá un proveedor', true);
          return;
        }
        try {
          const payload = {
            proveedor_id: Number(fd.get('proveedor_id')),
            ubicacion_id: fd.get('ubicacion_id') ? Number(fd.get('ubicacion_id')) : null,
            clase_documento: claseDocumento,
            comprobante_origen_id: comprobanteOrigenId ? Number(comprobanteOrigenId) : null,
            caracter,
            tipo_comprobante: tipoComprobante,
            punto_venta: fd.get('punto_venta') ? Number(fd.get('punto_venta')) : null,
            numero: fd.get('numero'),
            fecha: fd.get('fecha'),
            termino_pago_id: fd.get('termino_pago_id') ? Number(fd.get('termino_pago_id')) : null,
            fecha_vencimiento: fd.get('fecha_vencimiento') || '',
            metodo_pago_id: fd.get('metodo_pago_id') ? Number(fd.get('metodo_pago_id')) : null,
            cae: fd.get('cae') || '',
            lineas,
            impuestos,
          };
          if (isEdit) {
            await api(`/api/compras/${id}`, {
              method: 'PUT',
              body: JSON.stringify(payload),
            });
            toast('Borrador de compra actualizado');
            await renderCompraFormView({ id });
          } else {
            const res = await api('/api/compras', {
              method: 'POST',
              body: JSON.stringify({ ...payload, estado: 'Confirmado' }),
            });
            toast('Compra registrada');
            navigate(res?.id ? `/compras/${res.id}` : '/compras');
          }
        } catch (err) { toast(err.message, true); }
      });
    }
  };

  draw();
}
