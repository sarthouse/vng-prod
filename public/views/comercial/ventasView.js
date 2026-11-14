import { api, toast } from '../../lib/api.js';
import { esc, fmtMoney, renderPuntoVentaOptions, bindPuntoVentaSeq, bindCuentaMetodoSync, exportRowsToCSV } from '../../lib/format.js';
import { renderMetaPanel } from '../../lib/metaPanel.js';
import { navigate } from '../../router.js';
import { printRemito } from '../../lib/remitoPrint.js';
import { printVentaComprobante } from '../../lib/ventaPrint.js';
import { printReciboCobro } from '../../lib/tesoreriaPrint.js';
import { mountCombobox, quickCreateCliente, quickCreateProducto } from '../../lib/autocomplete.js';
import { getIvaRatesFromConfig, calcDocumentTotals, renderTaxFooterHtml } from '../../lib/taxHelper.js';
import { renderKpiStrip, renderFilterBar, renderDataTable } from '../../lib/viewEngine.js';
import { showConfirmModal } from '../../lib/modal.js';
import { COMPROBANTES_AR, resolveComprobanteMeta, resolveLetraFiscalClient } from '../../lib/comprobantesAr.js';

export async function renderVentasView() {
  const root = document.getElementById('app-view');
  const ventas = await api('/api/ventas');
  let filterEstado = '';
  let filterClase = '';
  let search = '';

  const getFiltered = () => {
    const q = search.trim().toLowerCase();
    return ventas.filter(v => {
      if (filterEstado && v.estado !== filterEstado) return false;
      if (filterClase && (v.clase_documento || 'factura') !== filterClase) return false;
      if (q) {
        const hay = `${v.numero || ''} ${v.cliente_nombre || ''} ${v.observaciones || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  };

  const drawTable = () => {
    const filtered = getFiltered();
    renderDataTable(root.querySelector('#vta-table-wrap'), {
      rows: filtered,
      emptyText: 'No hay ventas registradas para ese filtro.',
      exportFilename: `ventas_${new Date().toISOString().slice(0, 10)}.csv`,
      bulkActions: [
        {
          id: 'emitir-afip',
          label: 'Emitir en AFIP',
          variant: 'primary',
          confirm: (sel) => {
            const n = sel.filter(v => v.caracter === 'fiscal' && !v.cae).length;
            return n ? `¿Solicitar CAE en AFIP para ${n} comprobante(s) seleccionado(s)?` : null;
          },
          onClick: async (sel) => {
            const targets = sel.filter(v => v.caracter === 'fiscal' && !v.cae);
            if (!targets.length) { toast('No hay ventas fiscales sin CAE en la selección', true); return; }
            let ok = 0; let errs = 0;
            for (const v of targets) {
              try { await api(`/api/ventas/${v.id}/emitir-afip`, { method: 'POST' }); ok++; }
              catch { errs++; }
            }
            toast(`${ok} emitida(s) en AFIP${errs ? `, ${errs} con error` : ''}`, errs > 0 && ok === 0);
            await renderVentasView();
          },
        },
        {
          id: 'eliminar',
          label: 'Eliminar seleccionadas',
          variant: 'danger',
          confirm: (sel) => `¿Eliminar ${sel.length} venta(s) seleccionada(s)?`,
          onClick: async (sel) => {
            let ok = 0; let errs = 0;
            for (const v of sel) {
              try { await api(`/api/ventas/${v.id}`, { method: 'DELETE' }); ok++; }
              catch { errs++; }
            }
            toast(`${ok} venta(s) eliminada(s)${errs ? `, ${errs} con error` : ''}`, errs > 0 && ok === 0);
            await renderVentasView();
          },
        },
      ],
      columns: [
        { label: 'Fecha', render: v => esc(v.fecha) },
        {
          label: 'Número',
          render: v => `<a href="/ventas/${v.id}" data-link class="link-primary"><strong>${esc(v.numero || '#' + v.id)}</strong></a>${v.clase_documento === 'nota_credito' ? ' <span class="badge badge-parcial">NC</span>' : v.clase_documento === 'nota_debito' ? ' <span class="badge badge-muted">ND</span>' : ''}`,
        },
        { label: 'Estado', render: v => `<span class="badge ${v.estado === 'Entregada' ? 'badge-ok' : v.estado === 'Confirmada' ? 'badge-confirmado' : 'badge-muted'}">${esc(v.estado)}</span>` },
        {
          label: 'AFIP',
          render: v => v.caracter === 'interno'
            ? '<span class="badge badge-muted">Interno</span>'
            : (v.cae ? `<span class="badge badge-ok" title="CAE ${esc(v.cae)}">CAE</span>` : '<span class="badge badge-warn">Sin CAE</span>'),
        },
        { label: 'Cliente', render: v => `<a href="/contactos/${v.cliente_id}" data-link class="link-primary">${esc(v.cliente_nombre)}</a>` },
        { label: 'Total', align: 'right', render: v => `<strong>${fmtMoney(v.total)}</strong>` },
        { label: 'Cobrado', align: 'right', render: v => fmtMoney(Number(v.cobrado || 0)) },
        {
          label: 'Saldo',
          align: 'right',
          render: v => {
            const saldo = Math.max(0, Number(v.total || 0) - Number(v.cobrado || 0));
            return `<strong style="color:${saldo > 0 ? 'var(--color-accent)' : 'var(--color-success)'};">${fmtMoney(saldo)}</strong>`;
          },
        },
        {
          label: 'Acciones',
          render: v => `
            <div class="actions">
              <button type="button" class="btn btn-sm" data-print-pdf-vta="${v.id}">PDF</button>
              <button type="button" class="btn btn-sm" data-print-vta="${v.id}">Remito</button>
              <a href="/ventas/${v.id}" data-link class="btn btn-sm">Abrir</a>
              <button type="button" class="btn btn-sm btn-danger" data-del-vta="${v.id}">Eliminar</button>
            </div>
          `,
        },
      ],
    });

    root.querySelectorAll('[data-print-pdf-vta]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          const data = await api(`/api/ventas/${btn.dataset.printPdfVta}`);
          await printVentaComprobante({
            venta: data.venta || {},
            lineas: data.lineas || [],
            impuestos: data.impuestos || [],
          });
        } catch (err) {
          toast(err.message, true);
        }
      });
    });
    root.querySelectorAll('[data-print-vta]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          const data = await api(`/api/ventas/${btn.dataset.printVta}`);
          const vta = data.venta || {};
          await printRemito({
            tipoDoc: 'REMITO DE ENTREGA',
            numero: vta.numero,
            fecha: vta.fecha,
            mostrarOrigenDestino: false,
            contraparteLabel: 'Cliente',
            contraparteNombre: vta.cliente_nombre || '',
            contraparteCuit: vta.cliente_cuit || '',
            contraparteIva: vta.cliente_iva || '',
            contraparteDireccion: vta.cliente_direccion || '',
            contraparteLocalidad: vta.cliente_localidad || '',
            contraparteProvincia: vta.cliente_provincia || '',
            contraparteCp: vta.cliente_codigo_postal || '',
            contraparteTelefono: vta.cliente_telefono || '',
            contraparteEmail: vta.cliente_email || '',
            lineas: data.lineas || [],
            nota: vta.observaciones || '',
          });
        } catch (err) {
          toast(err.message, true);
        }
      });
    });
    root.querySelectorAll('[data-del-vta]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!(await showConfirmModal('¿Eliminar esta venta?'))) return;
        try {
          await api(`/api/ventas/${btn.dataset.delVta}`, { method: 'DELETE' });
          toast('Venta eliminada');
          await renderVentasView();
        } catch (err) {
          toast(err.message, true);
        }
      });
    });
  };

  const draw = () => {
    root.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Ventas</h1>
          <p class="muted">Registro de ventas y cobros.</p>
        </div>
        <div class="actions">
          <a href="/ventas/reglas" data-link class="btn">Envíos, Cupones y Recargos</a>
          <button type="button" id="btn-export-ventas" class="btn">Exportar CSV</button>
          <a href="/ventas/nueva" data-link class="btn btn-primary">+ Nueva Venta</a>
        </div>
      </div>

      <div id="vta-kpis"></div>

      <div class="card">
        <div id="vta-filters"></div>
        <div id="vta-table-wrap"></div>
      </div>
    `;
    root.querySelector('#btn-export-ventas').addEventListener('click', () => {
      const rows = getFiltered();
      if (!rows.length) { toast('No hay ventas para exportar', true); return; }
      exportRowsToCSV(
        ['Fecha', 'Número', 'Clase', 'Tipo', 'Carácter', 'CAE', 'Vto CAE', 'Cliente', 'Estado', 'Neto', 'IVA', 'Otros Imp.', 'Total', 'Cobrado', 'Saldo'],
        rows.map(v => {
          const saldo = Math.max(0, Number(v.total || 0) - Number(v.cobrado || 0));
          return [
            v.fecha, v.numero || `#${v.id}`, v.clase_documento || 'factura', v.tipo_comprobante || '',
            v.caracter || 'fiscal', v.cae || '', v.cae_vto || '', v.cliente_nombre || '', v.estado,
            Number(v.neto || 0), Number(v.iva_monto || 0), Number(v.otros_impuestos_monto || 0),
            Number(v.total || 0), Number(v.cobrado || 0), saldo,
          ];
        }),
        `ventas_${new Date().toISOString().slice(0, 10)}.csv`
      );
    });
    const vtaConf = ventas.filter(v => v.estado !== 'Presupuesto' && v.estado !== 'Borrador' && v.estado !== 'Anulada');
    const vtaPres = ventas.filter(v => v.estado === 'Presupuesto' || v.estado === 'Borrador').length;
    const vtaTotal = vtaConf.reduce((s, v) => s + (v.clase_documento === 'nota_credito' ? -Number(v.total || 0) : Number(v.total || 0)), 0);
    const vtaCobrado = ventas.reduce((s, v) => s + Number(v.cobrado || 0), 0);
    const vtaSaldo = ventas.reduce((s, v) => s + Math.max(0, Number(v.total || 0) - Number(v.cobrado || 0)), 0);
    renderKpiStrip(root.querySelector('#vta-kpis'), [
      { label: 'Ventas Confirmadas', value: fmtMoney(vtaTotal) },
      { label: 'Presupuestos', value: String(vtaPres), tone: vtaPres > 0 ? 'warn' : 'default' },
      { label: 'Cobrado', value: fmtMoney(vtaCobrado), tone: 'success' },
      { label: 'Por Cobrar', value: fmtMoney(vtaSaldo), tone: vtaSaldo > 0 ? 'accent' : 'default' },
    ]);
    renderFilterBar(root.querySelector('#vta-filters'), {
      searchValue: search,
      searchPlaceholder: 'Buscar número, cliente u observación...',
      filters: [
        {
          name: 'estado',
          value: filterEstado,
          options: [
            { value: '', label: 'Todos los estados' },
            ...['Presupuesto', 'Confirmada', 'Entregada', 'Anulada'].map(st => ({ value: st, label: st })),
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
  };
  draw();
}

export async function renderVentaFormView({ id } = {}) {
  const root = document.getElementById('app-view');
  const isEdit = Boolean(id);
  const params = new URLSearchParams(window.location.search);

  const [clientes, productos, empresa, puntosVenta, nextSeq, existing, impuestosConfig, ubicaciones, diarios, enviosConfig, recargosConfig, cobroBundle, cuentas, nextCobroSeq, terminosPago, metodosPago, listasPrecios] = await Promise.all([
    api('/api/contactos?es_cliente=1'),
    api('/api/productos?se_vende=1'),
    api('/api/empresa'),
    api('/api/puntos-venta'),
    !isEdit ? api('/api/secuencias/siguiente?tipo=venta') : Promise.resolve(null),
    isEdit ? api(`/api/ventas/${id}`) : Promise.resolve(null),
    api('/api/impuestos?aplica_a=ventas&solo_activos=1').catch(() => []),
    api('/api/ubicaciones').catch(() => []),
    api('/api/tesoreria/diarios').catch(() => []),
    api('/api/ventas/envios').catch(() => []),
    api('/api/ventas/recargos').catch(() => []),
    isEdit ? api(`/api/ventas/${id}/cobros`).catch(() => null) : Promise.resolve(null),
    isEdit ? api('/api/tesoreria/cuentas').catch(() => []) : Promise.resolve([]),
    isEdit ? api('/api/secuencias/siguiente?tipo=cobro').catch(() => null) : Promise.resolve(null),
    api('/api/terminos-pago?solo_activos=1').catch(() => []),
    api('/api/metodos-pago?solo_activos=1').catch(() => []),
    api('/api/listas-precios?solo_activos=1').catch(() => []),
  ]);
  const enviosActivos = (enviosConfig || []).filter(e => e.activo !== 0);
  const recargosActivos = (recargosConfig || []).filter(r => r.activo !== 0);
  const ubicacionesActivas = (ubicaciones || []).filter(u => u.activo !== 0);
  const diariosVentas = (diarios || []).filter(d => d.tipo === 'ventas' && d.activo !== 0);
  const defaultDiarioFor = (caracter) => {
    const wantFiscal = caracter === 'fiscal';
    return diariosVentas.find(d => (Number(d.es_fiscal) === 1 || d.caracter === 'fiscal') === wantFiscal)
      || diariosVentas[0]
      || null;
  };

  const defaultIva = Number(empresa?.alicuota_iva_ventas_defecto ?? empresa?.alicuota_iva_defecto ?? 21);
  const v = existing?.venta || {
    numero: nextSeq?.numero || 'FA 0001-00000001',
    clase_documento: 'factura',
    fecha: new Date().toISOString().slice(0, 10),
    fecha_vencimiento: '',
    fecha_entrega_est: '',
    cliente_id: params.get('cliente_id') || (clientes[0]?.id ?? ''),
    estado: 'Confirmada',
    caracter: 'fiscal',
    tipo_comprobante: 'FA-A',
    punto_venta: nextSeq?.punto_venta || null,
    cae: '',
    cae_vto: '',
    alicuota_iva: defaultIva,
    observaciones: '',
  };
  const calcDueFromTerm = (fechaStr, tpId) => {
    const tp = (terminosPago || []).find(t => Number(t.id) === Number(tpId));
    if (!tp || !fechaStr) return '';
    const dt = new Date(`${String(fechaStr).slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(dt.getTime())) return '';
    dt.setUTCDate(dt.getUTCDate() + (Number(tp.dias) || 0));
    return dt.toISOString().slice(0, 10);
  };
  const initCliente = clientes.find(c => String(c.id) === String(v.cliente_id));
  if (!isEdit && initCliente) {
    if (!v.termino_pago_id && initCliente.termino_pago_id) v.termino_pago_id = initCliente.termino_pago_id;
    if (!v.metodo_pago_id && initCliente.metodo_pago_id) v.metodo_pago_id = initCliente.metodo_pago_id;
    if (!v.lista_precio_id && initCliente.lista_precio_id) v.lista_precio_id = initCliente.lista_precio_id;
    if (!v.fecha_vencimiento && v.termino_pago_id) v.fecha_vencimiento = calcDueFromTerm(v.fecha, v.termino_pago_id);
  }
  const initLetra = (!isEdit && v.caracter === 'fiscal' && initCliente)
    ? (resolveLetraFiscalClient(empresa?.condicion_iva, initCliente.condicion_iva) || 'B')
    : null;
  const initTipo = (!isEdit && initLetra) ? `FA-${initLetra}` : (v.tipo_comprobante || (v.caracter === 'interno' ? 'FX' : 'FA-A'));
  const initMeta = resolveComprobanteMeta(initTipo, v.clase_documento);
  v.tipo_comprobante = initMeta.code;
  v.clase_documento = initMeta.clase;
  v.caracter = initMeta.caracter;
  if (!v.diario_id) {
    v.diario_id = defaultDiarioFor(v.caracter)?.id || null;
  }

  let lineas = (existing?.lineas || []).map(l => ({
    producto_id: l.producto_id ? String(l.producto_id) : '',
    tipo_linea: l.tipo_linea || 'producto',
    descripcion: l.descripcion || '',
    cantidad: Number(l.cantidad) || 0,
    udm: l.udm || 'pares',
    precio_unitario: Number(l.precio_unitario) || 0,
    alicuota_iva: Number(l.alicuota_iva ?? v.alicuota_iva ?? defaultIva),
    subtotal: Number(l.subtotal) || 0,
  }));
  if (!isEdit && lineas.length === 0) {
    lineas.push({ producto_id: '', descripcion: '', cantidad: 1, udm: 'pares', precio_unitario: 0, alicuota_iva: defaultIva, subtotal: 0 });
  }

  let impuestos = (existing?.impuestos || []).map(imp => ({
    impuesto_id: imp.impuesto_id || null,
    nombre: imp.nombre || '',
    tipo: imp.tipo || 'percepcion',
    base: Number(imp.base) || 0,
    alicuota: Number(imp.alicuota) || 0,
    monto: Number(imp.monto) || 0,
  }));

  const prodMap = new Map(productos.map(p => [String(p.id), p]));
  const ivaRates = getIvaRatesFromConfig(impuestosConfig);
  const otrosImpuestosConfig = impuestosConfig.filter(ic => ic.tipo !== 'iva');

  const render = () => {
    document.querySelectorAll('.combo-menu').forEach(m => m.remove());
    const totals = calcDocumentTotals(lineas, impuestos, v.caracter, v.tipo_comprobante);
    const selectedDiario = diariosVentas.find(d => String(d.id) === String(v.diario_id));
    const diarioEsFiscal = selectedDiario
      ? (Number(selectedDiario.es_fiscal) === 1 || selectedDiario.caracter === 'fiscal')
      : (v.caracter === 'fiscal');
    const allowedComprobantes = COMPROBANTES_AR.filter(c =>
      diarioEsFiscal ? c.caracter === 'fiscal' : c.caracter === 'interno'
    );
    const pvObj = puntosVenta.find(p => Number(p.numero) === Number(v.punto_venta || nextSeq?.punto_venta));
    const isPvElectronico = Boolean(pvObj?.es_electronica);
    root.innerHTML = `
      <div class="page-header">
        <div>
          <div style="margin-bottom:6px;"><a href="/ventas" data-link class="muted" style="font-size:0.85rem;">← Volver a Ventas</a></div>
          <h1>${isEdit ? `Venta ${esc(v.numero || '#' + id)}` : 'Nueva Venta'}</h1>
        </div>
        ${isEdit ? `
          <div class="actions">
            ${v.caracter === 'fiscal' && !v.cae && puntosVenta.find(p => Number(p.numero) === Number(v.punto_venta))?.es_electronica
              ? `<button type="button" id="btn-vta-solicitar-cae" class="btn btn-primary">Solicitar CAE (AFIP)</button>`
              : ''}
            ${v.caracter === 'fiscal' && v.cae
              ? `<button type="button" id="btn-vta-xml-afip" class="btn">XML AFIP</button>`
              : ''}
            <button type="button" id="btn-vta-print-pdf" class="btn">Imprimir / PDF</button>
            <a href="/ventas/nueva" data-link class="btn btn-primary">+ Nueva Venta</a>
          </div>
        ` : ''}
      </div>

      <form id="form-venta">
        <div class="card">
          <div class="card-header"><h2>Datos de la Venta</h2></div>
          <div class="form-grid">
            <label>
              <span>Cliente *</span>
              <div id="vta-cli-combo"></div>
            </label>
            <label>
              <span>Tipo de Comprobante *</span>
              <select name="tipo_comprobante" id="vta-tipo" ${isEdit ? 'disabled' : ''}>
                ${Array.from(new Set(allowedComprobantes.map(c => c.group))).map(grp => `
                  <optgroup label="${esc(grp)}">
                    ${allowedComprobantes.filter(c => c.group === grp).map(c => `<option value="${c.code}" ${v.tipo_comprobante === c.code ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
                  </optgroup>
                `).join('')}
              </select>
            </label>
            <label>
              <span>Punto de Venta</span>
              <select name="punto_venta" id="vta-pv" ${isEdit ? 'disabled' : ''}>${renderPuntoVentaOptions(puntosVenta, v.punto_venta || nextSeq?.punto_venta)}</select>
            </label>
            <label>
              <span>Diario Contable</span>
              <select name="diario_id" id="vta-diario" ${isEdit ? 'disabled' : ''}>
                <option value="">-- Automático --</option>
                ${diariosVentas.map(d => `<option value="${d.id}" ${String(v.diario_id || '') === String(d.id) ? 'selected' : ''}>${esc(d.codigo)} · ${esc(d.nombre)}</option>`).join('')}
              </select>
            </label>
            <label><span>Número</span><input type="text" name="numero" id="vta-num" value="${esc(v.numero || '')}" /></label>
            <label><span>Fecha *</span><input type="date" name="fecha" id="vta-fecha" required value="${esc(v.fecha)}" /></label>
            <label>
              <span>Término de Pago</span>
              <select name="termino_pago_id" id="vta-tp">
                <option value="">-- Manual / Contado --</option>
                ${(terminosPago || []).map(t => `<option value="${t.id}" ${Number(v.termino_pago_id) === Number(t.id) ? 'selected' : ''}>${esc(t.nombre)} (${t.dias}d)</option>`).join('')}
              </select>
            </label>
            <label><span>Vencimiento</span><input type="date" name="fecha_vencimiento" id="vta-vto" value="${esc(v.fecha_vencimiento || '')}" /></label>
            <label>
              <span>Método de Pago</span>
              <select name="metodo_pago_id" id="vta-mp">
                <option value="">-- Sin definir --</option>
                ${(metodosPago || []).map(m => `<option value="${m.id}" ${Number(v.metodo_pago_id) === Number(m.id) ? 'selected' : ''}>${esc(m.nombre)}</option>`).join('')}
              </select>
            </label>
            <label>
              <span>Lista de Precios</span>
              <select name="lista_precio_id" id="vta-lp">
                <option value="">-- Lista por defecto --</option>
                ${(listasPrecios || []).map(l => `<option value="${l.id}" ${Number(v.lista_precio_id) === Number(l.id) ? 'selected' : ''}>${esc(l.nombre)}</option>`).join('')}
              </select>
            </label>
            <label><span>Entrega Estimada</span><input type="date" name="fecha_entrega_est" value="${esc(v.fecha_entrega_est || '')}" /></label>
            <label>
              <span>Estado *</span>
              <select name="estado">
                ${['Presupuesto', 'Confirmada', 'Entregada', 'Anulada'].map(st =>
                  `<option value="${st}" ${v.estado === st ? 'selected' : ''}>${st}</option>`
                ).join('')}
              </select>
            </label>
            <label>
              <span>Depósito Origen (Stock)</span>
              <select name="ubicacion_id" id="vta-ubicacion">
                <option value="">-- Por defecto --</option>
                ${ubicacionesActivas.map(u => `<option value="${u.id}" ${String(v.ubicacion_id || '') === String(u.id) ? 'selected' : ''}>${esc(u.codigo)} · ${esc(u.nombre)}</option>`).join('')}
              </select>
            </label>
            ${v.caracter === 'fiscal' ? `
              <label><span>CAE</span><input type="text" name="cae" value="${esc(v.cae || '')}" ${isPvElectronico && !v.cae ? 'readonly' : ''} placeholder="${isPvElectronico ? 'Autocompletado al validar ARCA' : 'Opcional'}" /></label>
              <label><span>Vto. CAE</span><input type="date" name="cae_vto" value="${esc(v.cae_vto || '')}" ${isPvElectronico && !v.cae ? 'readonly' : ''} /></label>
            ` : ''}
            <label class="full"><span>Observaciones</span><input type="text" name="observaciones" placeholder="Opcional" value="${esc(v.observaciones || '')}" /></label>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h2>Detalle</h2>
            <button type="button" id="btn-vta-add-line" class="btn btn-sm">+ Agregar Ítem</button>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Descripción</th>
                  <th class="num">Cantidad</th>
                  <th>Unidad</th>
                  <th class="num">Precio</th>
                  <th>IVA</th>
                  <th class="num">Subtotal</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${lineas.map((l, idx) => `
                  <tr>
                    <td style="min-width:220px;"><div class="vl-prod-combo" data-idx="${idx}"></div></td>
                    <td><input type="text" class="vl-desc" data-idx="${idx}" value="${esc(l.descripcion)}" /></td>
                    <td class="num"><input type="number" step="0.01" min="0" class="vl-qty" data-idx="${idx}" value="${l.cantidad}" style="width:90px;text-align:right;" /></td>
                    <td><span class="badge badge-muted vl-udm-badge" data-idx="${idx}">${esc(l.udm || 'pares')}</span></td>
                    <td class="num"><input type="number" step="0.01" min="0" class="vl-price" data-idx="${idx}" value="${l.precio_unitario}" style="width:110px;text-align:right;" /></td>
                    <td>
                      <select class="vl-iva" data-idx="${idx}" style="width:90px;" ${totals.noIva ? 'disabled' : ''}>
                        ${ivaRates.map(r => `<option value="${r.value}" ${Number(l.alicuota_iva ?? defaultIva) === r.value ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}
                      </select>
                    </td>
                    <td class="num"><strong class="vl-sub" data-idx="${idx}">${fmtMoney(l.subtotal)}</strong></td>
                    <td><button type="button" class="btn btn-sm btn-danger vl-del" data-idx="${idx}">Quitar</button></td>
                  </tr>
                `).join('')}
              </tbody>
              <tfoot id="vta-tfoot">
                ${renderTaxFooterHtml(totals, impuestos, 6)}
              </tfoot>
            </table>
          </div>
          <div style="padding:12px 16px;border-top:1px solid var(--color-border);display:flex;gap:12px;flex-wrap:wrap;align-items:center;background:var(--color-bg-subtle,#f8fafc);">
            <div style="display:flex;gap:6px;align-items:center;">
              <select id="vta-envio-sel" style="min-width:190px;">
                <option value="">-- Tipo de envío --</option>
                ${enviosActivos.map(e => `<option value="${e.id}">${esc(e.nombre)} (${fmtMoney(e.precio)})</option>`).join('')}
              </select>
              <button type="button" id="btn-vta-add-envio" class="btn btn-sm">+ Envío</button>
            </div>
            <div style="display:flex;gap:6px;align-items:center;">
              <input type="text" id="vta-cupon-inp" value="${esc(v.cupon_codigo || '')}" placeholder="Código cupón..." style="width:140px;text-transform:uppercase;" />
              <button type="button" id="btn-vta-add-cupon" class="btn btn-sm">Aplicar Cupón</button>
            </div>
            <div style="display:flex;gap:6px;align-items:center;">
              <select id="vta-recargo-sel" style="min-width:190px;">
                <option value="">-- Recargo pago --</option>
                ${recargosActivos.map(r => `<option value="${r.id}">${esc(r.nombre)} (${r.tipo === 'porcentaje' ? `${r.valor}%` : fmtMoney(r.valor)})</option>`).join('')}
              </select>
              <button type="button" id="btn-vta-add-recargo" class="btn btn-sm">+ Recargo</button>
            </div>
          </div>
          <div style="padding:12px 16px;border-top:1px solid var(--color-border);">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
              <strong>Percepciones, Retenciones y Otros Impuestos</strong>
              <div style="display:flex;gap:8px;align-items:center;">
                <select id="vta-imp-select" style="min-width:220px;">
                  <option value="">-- Elegir impuesto configurado --</option>
                  ${otrosImpuestosConfig.map(ic => `<option value="${ic.id}">${esc(ic.nombre)} (${Number(ic.alicuota_defecto || 0)}%)</option>`).join('')}
                </select>
                <button type="button" id="btn-vta-add-imp" class="btn btn-sm">+ Agregar Impuesto</button>
                <button type="button" id="btn-vta-sugerir-iibb" class="btn btn-sm">Sugerir IIBB (Padrón)</button>
              </div>
            </div>
            ${impuestos.length ? `
              <div class="table-wrap">
                <table class="data-table">
                  <thead><tr><th>Impuesto</th><th>Tipo</th><th class="num">Base</th><th class="num">Alícuota (%)</th><th class="num">Monto</th><th></th></tr></thead>
                  <tbody>
                    ${impuestos.map((imp, iIdx) => `
                      <tr>
                        <td><strong>${esc(imp.nombre)}</strong></td>
                        <td>${esc(imp.tipo)}</td>
                        <td class="num"><input type="number" step="0.01" min="0" class="vi-base" data-idx="${iIdx}" value="${Number(imp.base || 0)}" style="width:110px;text-align:right;" /></td>
                        <td class="num"><input type="number" step="0.01" min="0" class="vi-aliq" data-idx="${iIdx}" value="${Number(imp.alicuota || 0)}" style="width:85px;text-align:right;" /></td>
                        <td class="num"><input type="number" step="0.01" min="0" class="vi-monto" data-idx="${iIdx}" value="${Number(imp.monto || 0)}" style="width:110px;text-align:right;" /></td>
                        <td><button type="button" class="btn btn-sm btn-danger vi-del" data-idx="${iIdx}">Quitar</button></td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            ` : '<p class="muted" style="font-size:0.82rem;margin:0;">Sin percepciones ni retenciones adicionales.</p>'}
          </div>
          <div class="form-footer" style="padding:14px 16px;">
            <a href="/ventas" data-link class="btn">Cancelar</a>
            <button type="submit" class="btn btn-primary">${isEdit ? 'Guardar Venta' : 'Registrar Venta'}</button>
          </div>
        </div>
      </form>
      ${isEdit ? `
        <div class="card" style="border-left:4px solid var(--color-primary);">
          <div class="card-header">
            <div>
              <h2>Cobros Asociados</h2>
              <p class="muted" style="font-size:0.84rem;">
                Total: <strong>${fmtMoney(cobroBundle?.venta?.total ?? v.total ?? 0)}</strong> ·
                Cobrado: <strong>${fmtMoney(cobroBundle?.venta?.cobrado ?? 0)}</strong> ·
                Saldo Pendiente: <strong style="color:${Number(cobroBundle?.venta?.saldo_pendiente ?? 0) > 0 ? 'var(--color-accent)' : 'var(--color-success)'};">${fmtMoney(cobroBundle?.venta?.saldo_pendiente ?? 0)}</strong>
              </p>
            </div>
          </div>
          <div class="card-body">
            <form id="form-cobro-venta-det" class="form-grid" style="margin-bottom:0;">
              <label>
                <span>Cuenta *</span>
                <select name="cuenta_id" required>
                  ${(cuentas || []).map(ct => `<option value="${ct.id}">${esc(ct.nombre)} (${fmtMoney(ct.saldo_actual)})</option>`).join('')}
                </select>
              </label>
              <label>
                <span>Método</span>
                <select name="metodo">
                  ${['Transferencia', 'Efectivo', 'Cheque', 'MercadoPago', 'Otro'].map(m => `<option value="${m}">${m}</option>`).join('')}
                </select>
              </label>
              <label><span>Fecha *</span><input type="date" name="fecha" required value="${new Date().toISOString().slice(0, 10)}" /></label>
              <label>
                <span>Punto de Venta</span>
                <select name="punto_venta" id="cob-vta-det-pv">${renderPuntoVentaOptions(puntosVenta, nextCobroSeq?.punto_venta)}</select>
              </label>
              <label><span>Comprobante</span><input type="text" name="numero" id="cob-vta-det-num" value="${esc(nextCobroSeq?.numero || '')}" /></label>
              <label><span>Monto *</span><input type="number" step="0.01" min="0.01" name="monto" required value="${Number(cobroBundle?.venta?.saldo_pendiente ?? 0) > 0 ? cobroBundle.venta.saldo_pendiente : ''}" /></label>
              <div style="align-self:end;"><button type="submit" class="btn btn-primary">+ Registrar Cobro</button></div>
            </form>

            ${!(cobroBundle?.cobros || []).length ? '<div class="empty-state">Sin cobros asociados todavía.</div>' : `
              <div class="table-wrap" style="margin-top:12px;">
                <table class="data-table">
                  <thead><tr><th>Fecha</th><th>Comprobante</th><th>Cuenta</th><th>Método</th><th class="num">Monto</th><th></th></tr></thead>
                  <tbody>
                    ${(cobroBundle?.cobros || []).map(cb => `
                      <tr>
                        <td>${esc(cb.fecha)}</td>
                        <td>${esc(cb.numero || '-')}</td>
                        <td>${esc(cb.cuenta_nombre || '-')}</td>
                        <td>${esc(cb.metodo)}</td>
                        <td class="num"><strong>${fmtMoney(cb.monto)}</strong></td>
                        <td>
                          <div class="actions">
                            <button type="button" class="btn btn-sm" data-print-cobro-det="${cb.id}">PDF</button>
                            <button type="button" class="btn btn-sm btn-danger" data-del-cobro-det="${cb.id}">Eliminar</button>
                          </div>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `}
          </div>
        </div>
        <div id="vta-form-meta-panel"></div>
      ` : ''}
    `;

    if (isEdit) {
      bindPuntoVentaSeq(root.querySelector('#cob-vta-det-pv'), root.querySelector('#cob-vta-det-num'), 'cobro');
      bindCuentaMetodoSync(
        root.querySelector('#form-cobro-venta-det select[name="cuenta_id"]'),
        root.querySelector('#form-cobro-venta-det select[name="metodo"]'),
        cuentas
      );
      root.querySelector('#form-cobro-venta-det')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          await api('/api/tesoreria/cobros', {
            method: 'POST',
            body: JSON.stringify({
              fecha: fd.get('fecha'),
              cuenta_id: Number(fd.get('cuenta_id')),
              contacto_id: v.cliente_id ? Number(v.cliente_id) : null,
              venta_id: Number(id),
              metodo: fd.get('metodo'),
              punto_venta: fd.get('punto_venta') ? Number(fd.get('punto_venta')) : null,
              numero: fd.get('numero'),
              monto: Number(fd.get('monto')),
              concepto: `Cobro Venta ${v.numero || '#' + id}`,
            }),
          });
          toast('Cobro registrado');
          await renderVentaFormView(params);
        } catch (err) { toast(err.message, true); }
      });
      root.querySelectorAll('[data-print-cobro-det]').forEach(btn => btn.addEventListener('click', async () => {
        const cb = (cobroBundle?.cobros || []).find(x => String(x.id) === String(btn.dataset.printCobroDet));
        if (!cb) return;
        await printReciboCobro({ cobro: cb, venta: v });
      }));
      root.querySelectorAll('[data-del-cobro-det]').forEach(btn => btn.addEventListener('click', async () => {
        if (!(await showConfirmModal('¿Eliminar este cobro? Se revertirá el saldo de la cuenta.'))) return;
        try {
          await api(`/api/tesoreria/cobros/${btn.dataset.delCobroDet}`, { method: 'DELETE' });
          toast('Cobro eliminado');
          await renderVentaFormView(params);
        } catch (err) { toast(err.message, true); }
      }));
      root.querySelector('#btn-vta-solicitar-cae')?.addEventListener('click', async () => {
        if (!(await showConfirmModal('¿Autorizar este comprobante ante AFIP (WSFEv1) y solicitar CAE?'))) return;
        const btn = root.querySelector('#btn-vta-solicitar-cae');
        btn.disabled = true;
        btn.textContent = 'Autorizando...';
        try {
          const res = await api(`/api/ventas/${id}/cae`, { method: 'POST' });
          toast(`CAE otorgado: ${res.cae} (Vto. ${res.cae_vto})`);
          await renderVentaFormView(params);
        } catch (err) {
          toast(err.message, true);
          btn.disabled = false;
          btn.textContent = 'Solicitar CAE (AFIP)';
        }
      });
      root.querySelector('#btn-vta-xml-afip')?.addEventListener('click', async () => {
        try {
          const logs = await api(`/api/afip/xml?entidad_tipo=venta&entidad_id=${id}`);
          const ok = logs.find(l => l.resultado === 'A') || logs[0];
          if (!ok) { toast('No hay XML AFIP archivado para esta venta', true); return; }
          window.location.href = `/api/afip/xml/${ok.id}/download?parte=res`;
        } catch (err) { toast(err.message, true); }
      });
      root.querySelector('#btn-vta-print-pdf')?.addEventListener('click', async () => {
        try {
          const data = await api(`/api/ventas/${id}`);
          await printVentaComprobante({
            venta: data.venta || {},
            lineas: data.lineas || [],
            impuestos: data.impuestos || [],
          });
        } catch (err) {
          toast(err.message, true);
        }
      });
      renderMetaPanel(root.querySelector('#vta-form-meta-panel'), {
        entidadTipo: 'venta',
        entidadId: id,
        titulo: `Venta ${v.numero || '#' + id}`,
        record: v,
      });
    }

    const syncTotals = () => {
      const t = calcDocumentTotals(lineas, impuestos, v.caracter, v.tipo_comprobante);
      const tfoot = root.querySelector('#vta-tfoot');
      if (tfoot) tfoot.innerHTML = renderTaxFooterHtml(t, impuestos, 6);
    };

    const capture = () => {
      const fd = new FormData(root.querySelector('#form-venta'));
      v.cliente_id = fd.get('cliente_id');
      if (fd.get('tipo_comprobante')) {
        const meta = resolveComprobanteMeta(fd.get('tipo_comprobante'), v.clase_documento);
        v.tipo_comprobante = meta.code;
        v.clase_documento = meta.clase;
        v.caracter = meta.caracter;
      }
      if (fd.get('punto_venta')) v.punto_venta = Number(fd.get('punto_venta'));
      if (fd.has('diario_id')) v.diario_id = fd.get('diario_id') ? Number(fd.get('diario_id')) : null;
      v.numero = fd.get('numero');
      v.fecha = fd.get('fecha');
      v.termino_pago_id = fd.get('termino_pago_id') ? Number(fd.get('termino_pago_id')) : null;
      v.fecha_vencimiento = fd.get('fecha_vencimiento') || '';
      v.metodo_pago_id = fd.get('metodo_pago_id') ? Number(fd.get('metodo_pago_id')) : null;
      v.lista_precio_id = fd.get('lista_precio_id') ? Number(fd.get('lista_precio_id')) : null;
      v.fecha_entrega_est = fd.get('fecha_entrega_est');
      v.estado = fd.get('estado');
      v.ubicacion_id = fd.get('ubicacion_id') ? Number(fd.get('ubicacion_id')) : null;
      if (fd.has('cae')) v.cae = fd.get('cae');
      if (fd.has('cae_vto')) v.cae_vto = fd.get('cae_vto');
      v.observaciones = fd.get('observaciones');
    };

    const onNum = (idx) => {
      lineas[idx].subtotal = Number((lineas[idx].cantidad * lineas[idx].precio_unitario).toFixed(2));
      root.querySelector(`.vl-sub[data-idx="${idx}"]`).textContent = fmtMoney(lineas[idx].subtotal);
      syncTotals();
    };

    const refreshNumeroFromSeq = async () => {
      if (isEdit) return;
      try {
        const meta = resolveComprobanteMeta(v.tipo_comprobante, v.clase_documento);
        const pv = v.punto_venta || '';
        const s = await api(`/api/secuencias/siguiente?tipo=${meta.seqCode}${pv ? `&punto_venta=${pv}` : ''}`);
        if (s?.numero) v.numero = s.numero;
      } catch { /* ignore */ }
    };

    root.querySelector('#vta-tipo')?.addEventListener('change', async (e) => {
      capture();
      const prevCaracter = v.caracter;
      const meta = resolveComprobanteMeta(e.target.value, v.clase_documento);
      v.tipo_comprobante = meta.code;
      v.clase_documento = meta.clase;
      v.caracter = meta.caracter;
      if (!isEdit && (prevCaracter !== v.caracter || !v.diario_id)) {
        v.diario_id = defaultDiarioFor(v.caracter)?.id || null;
      }
      await refreshNumeroFromSeq();
      render();
    });
    root.querySelector('#vta-diario')?.addEventListener('change', async (e) => {
      capture();
      const d = diariosVentas.find(x => String(x.id) === String(e.target.value));
      if (d) {
        const esFiscal = Number(d.es_fiscal) === 1 || d.caracter === 'fiscal';
        v.diario_id = d.id;
        v.caracter = esFiscal ? 'fiscal' : 'interno';
        if (d.punto_venta_id) {
          const pv = puntosVenta.find(p => Number(p.id) === Number(d.punto_venta_id));
          if (pv) v.punto_venta = pv.numero;
        }
        if (!esFiscal) {
          const nextCode = v.clase_documento === 'nota_credito' ? 'NCX' : v.clase_documento === 'nota_debito' ? 'NDX' : 'FX';
          const meta = resolveComprobanteMeta(nextCode, v.clase_documento);
          v.tipo_comprobante = meta.code;
          v.clase_documento = meta.clase;
        } else if (v.caracter === 'fiscal') {
          const cli = clientes.find(c => String(c.id) === String(v.cliente_id));
          const letra = resolveLetraFiscalClient(empresa?.condicion_iva, cli?.condicion_iva) || 'B';
          const pref = v.clase_documento === 'nota_credito' ? 'NC' : v.clase_documento === 'nota_debito' ? 'ND' : 'FA';
          const meta = resolveComprobanteMeta(`${pref}-${letra}`, v.clase_documento);
          v.tipo_comprobante = meta.code;
          v.clase_documento = meta.clase;
        }
      }
      await refreshNumeroFromSeq();
      render();
    });
    root.querySelector('#vta-pv')?.addEventListener('change', async (e) => {
      capture();
      v.punto_venta = e.target.value ? Number(e.target.value) : null;
      await refreshNumeroFromSeq();
      render();
    });
    const syncVtoFromTp = () => {
      const tpVal = root.querySelector('#vta-tp')?.value || '';
      const fVal = root.querySelector('#vta-fecha')?.value || v.fecha;
      if (!tpVal) return;
      const due = calcDueFromTerm(fVal, tpVal);
      if (due) {
        v.fecha_vencimiento = due;
        const vtoEl = root.querySelector('#vta-vto');
        if (vtoEl) vtoEl.value = due;
      }
    };
    root.querySelector('#vta-tp')?.addEventListener('change', syncVtoFromTp);
    root.querySelector('#vta-fecha')?.addEventListener('change', syncVtoFromTp);

    mountCombobox(root.querySelector('#vta-cli-combo'), {
      name: 'cliente_id',
      required: true,
      value: v.cliente_id,
      placeholder: 'Buscar o crear cliente...',
      items: clientes.map(c => ({ value: String(c.id), label: c.nombre, sublabel: c.cuit || c.localidad || '', raw: c })),
      onSelect: async (it) => {
        v.cliente_id = it ? String(it.value) : '';
        if (it?.raw && !isEdit) {
          if (it.raw.termino_pago_id) {
            v.termino_pago_id = it.raw.termino_pago_id;
            const tpEl = root.querySelector('#vta-tp');
            if (tpEl) tpEl.value = String(v.termino_pago_id);
            const due = calcDueFromTerm(root.querySelector('#vta-fecha')?.value || v.fecha, v.termino_pago_id);
            if (due) {
              v.fecha_vencimiento = due;
              const vtoEl = root.querySelector('#vta-vto');
              if (vtoEl) vtoEl.value = due;
            }
          }
          if (it.raw.metodo_pago_id) {
            v.metodo_pago_id = it.raw.metodo_pago_id;
            const mpEl = root.querySelector('#vta-mp');
            if (mpEl) mpEl.value = String(v.metodo_pago_id);
          }
          if (it.raw.lista_precio_id) {
            v.lista_precio_id = it.raw.lista_precio_id;
            const lpEl = root.querySelector('#vta-lp');
            if (lpEl) lpEl.value = String(v.lista_precio_id);
          }
        }
        if (it?.raw && v.caracter === 'fiscal' && !isEdit) {
          const letra = resolveLetraFiscalClient(empresa?.condicion_iva, it.raw.condicion_iva) || 'B';
          const pref = v.clase_documento === 'nota_credito' ? 'NC' : v.clase_documento === 'nota_debito' ? 'ND' : 'FA';
          const meta = resolveComprobanteMeta(`${pref}-${letra}`, v.clase_documento);
          v.tipo_comprobante = meta.code;
          v.clase_documento = meta.clase;
          v.caracter = meta.caracter;
          const tipoSel = root.querySelector('#vta-tipo');
          if (tipoSel) {
            tipoSel.value = v.tipo_comprobante;
            tipoSel.dispatchEvent(new Event('change', { bubbles: true }));
          }
          await refreshNumeroFromSeq();
          const numEl = root.querySelector('#vta-num');
          if (numEl) numEl.value = v.numero || '';
          syncTotals();
        }
      },
      onCreate: async (q) => {
        const created = await quickCreateCliente(q);
        if (created) {
          clientes.push(created.raw);
          v.cliente_id = created.value;
        }
        return created;
      },
    });

    const prodItems = () => productos.map(p => ({ value: String(p.id), label: p.nombre, sublabel: p.codigo || p.udm, raw: p }));
    root.querySelectorAll('.vl-prod-combo').forEach(el => {
      const idx = Number(el.dataset.idx);
      mountCombobox(el, {
        value: lineas[idx].producto_id,
        placeholder: 'Buscar o crear producto...',
        items: prodItems(),
        onSelect: async (it) => {
          if (!it) {
            lineas[idx].producto_id = '';
            return;
          }
          const p = it.raw;
          lineas[idx].producto_id = String(p.id);
          lineas[idx].descripcion = p.nombre;
          lineas[idx].udm = p.udm || 'pares';
          let resolvedPrice = Number(p.precio || 0);
          try {
            const lpId = root.querySelector('#vta-lp')?.value || v.lista_precio_id || '';
            const cliId = v.cliente_id || '';
            const pr = await api(`/api/listas-precios/resolver?producto_id=${p.id}&cantidad=${lineas[idx].cantidad || 1}${lpId ? `&lista_precio_id=${lpId}` : ''}${cliId ? `&contacto_id=${cliId}` : ''}`);
            if (pr && typeof pr.precio_unitario === 'number') resolvedPrice = pr.precio_unitario;
          } catch { /* fallback a precio catálogo */ }
          lineas[idx].precio_unitario = resolvedPrice;
          lineas[idx].alicuota_iva = Number(p.alicuota_iva ?? defaultIva);
          lineas[idx].subtotal = Number((lineas[idx].cantidad * lineas[idx].precio_unitario).toFixed(2));
          const descInp = root.querySelector(`.vl-desc[data-idx="${idx}"]`);
          const udmBadge = root.querySelector(`.vl-udm-badge[data-idx="${idx}"]`);
          const priceInp = root.querySelector(`.vl-price[data-idx="${idx}"]`);
          const ivaSel = root.querySelector(`.vl-iva[data-idx="${idx}"]`);
          if (descInp) descInp.value = lineas[idx].descripcion;
          if (udmBadge) udmBadge.textContent = lineas[idx].udm;
          if (priceInp) priceInp.value = lineas[idx].precio_unitario;
          if (ivaSel) ivaSel.value = String(lineas[idx].alicuota_iva);
          onNum(idx);
        },
        onCreate: async (q) => {
          const created = await quickCreateProducto(q, { se_fabrica: true, se_compra: false, udm: 'pares' });
          if (created) {
            productos.push(created.raw);
            prodMap.set(created.value, created.raw);
          }
          return created;
        },
      });
    });

    if (!isEdit) bindPuntoVentaSeq(root.querySelector('#vta-pv'), root.querySelector('#vta-num'), 'venta', api);
    root.querySelector('#btn-vta-add-line').addEventListener('click', () => {
      capture();
      lineas.push({ producto_id: '', descripcion: '', cantidad: 1, udm: 'pares', precio_unitario: 0, alicuota_iva: defaultIva, subtotal: 0 });
      render();
    });
    root.querySelectorAll('.vl-del').forEach(btn => btn.addEventListener('click', () => {
      capture();
      lineas.splice(Number(btn.dataset.idx), 1);
      render();
    }));
    root.querySelectorAll('.vl-desc').forEach(inp => inp.addEventListener('input', () => { lineas[Number(inp.dataset.idx)].descripcion = inp.value; }));
    root.querySelectorAll('.vl-qty').forEach(inp => inp.addEventListener('input', () => { const i = Number(inp.dataset.idx); lineas[i].cantidad = Number(inp.value) || 0; onNum(i); }));
    root.querySelectorAll('.vl-price').forEach(inp => inp.addEventListener('input', () => { const i = Number(inp.dataset.idx); lineas[i].precio_unitario = Number(inp.value) || 0; onNum(i); }));
    root.querySelectorAll('.vl-iva').forEach(sel => sel.addEventListener('change', () => { const i = Number(sel.dataset.idx); lineas[i].alicuota_iva = Number(sel.value) || 0; syncTotals(); }));

    root.querySelector('#btn-vta-add-envio')?.addEventListener('click', () => {
      capture();
      const envId = root.querySelector('#vta-envio-sel')?.value;
      const env = enviosActivos.find(e => String(e.id) === String(envId));
      if (!env) { toast('Elegí un tipo de envío', true); return; }
      const netoProd = lineas.filter(l => !l.tipo_linea || l.tipo_linea === 'producto').reduce((s, l) => s + (Number(l.subtotal) || 0), 0);
      const esGratis = env.tipo_tarifa === 'gratis_desde' && netoProd >= Number(env.monto_minimo_gratis || 0);
      const precio = esGratis ? 0 : Number(env.precio || 0);
      for (let i = lineas.length - 1; i >= 0; i--) {
        if (lineas[i].tipo_linea === 'envio') lineas.splice(i, 1);
      }
      lineas.push({
        producto_id: '',
        tipo_linea: 'envio',
        descripcion: `Envío: ${env.nombre}${esGratis ? ' (Bonificado)' : ''}`,
        cantidad: 1,
        udm: 'servicio',
        precio_unitario: precio,
        alicuota_iva: Number(env.alicuota_iva ?? defaultIva),
        subtotal: precio,
      });
      render();
    });

    root.querySelector('#btn-vta-add-cupon')?.addEventListener('click', async () => {
      capture();
      const codigo = (root.querySelector('#vta-cupon-inp')?.value || '').trim().toUpperCase();
      if (!codigo) { toast('Ingresá un código de cupón', true); return; }
      const netoProd = lineas.filter(l => !l.tipo_linea || l.tipo_linea === 'producto').reduce((s, l) => s + (Number(l.subtotal) || 0), 0);
      try {
        const res = await api('/api/ventas/cupones/validar', {
          method: 'POST',
          body: JSON.stringify({ codigo, subtotal: netoProd, fecha: v.fecha }),
        });
        v.cupon_codigo = res.codigo;
        if (res.envio_gratis) {
          lineas.forEach(l => {
            if (l.tipo_linea === 'envio') {
              l.precio_unitario = 0;
              l.subtotal = 0;
              if (!l.descripcion.includes('(Cupón')) l.descripcion += ` (Cupón ${res.codigo})`;
            }
          });
          toast(`Cupón ${res.codigo}: envío gratis aplicado`);
        } else {
          for (let i = lineas.length - 1; i >= 0; i--) {
            if (lineas[i].tipo_linea === 'descuento') lineas.splice(i, 1);
          }
          lineas.push({
            producto_id: '',
            tipo_linea: 'descuento',
            descripcion: `Descuento Cupón ${res.codigo}`,
            cantidad: 1,
            udm: 'un.',
            precio_unitario: -res.descuento,
            alicuota_iva: Number(res.alicuota_iva ?? defaultIva),
            subtotal: -res.descuento,
          });
          toast(`Cupón ${res.codigo} aplicado (-${fmtMoney(res.descuento)})`);
        }
        render();
      } catch (err) { toast(err.message, true); }
    });

    root.querySelector('#btn-vta-add-recargo')?.addEventListener('click', () => {
      capture();
      const recId = root.querySelector('#vta-recargo-sel')?.value;
      const rec = recargosActivos.find(r => String(r.id) === String(recId));
      if (!rec) { toast('Elegí un recargo configurado', true); return; }
      const netoBase = lineas.filter(l => l.tipo_linea !== 'recargo').reduce((s, l) => s + (Number(l.subtotal) || 0), 0);
      const monto = rec.tipo === 'porcentaje'
        ? Number((Math.max(0, netoBase) * Number(rec.valor || 0) / 100).toFixed(2))
        : Number(rec.valor || 0);
      for (let i = lineas.length - 1; i >= 0; i--) {
        if (lineas[i].tipo_linea === 'recargo') lineas.splice(i, 1);
      }
      lineas.push({
        producto_id: '',
        tipo_linea: 'recargo',
        descripcion: `Recargo: ${rec.nombre}`,
        cantidad: 1,
        udm: 'servicio',
        precio_unitario: monto,
        alicuota_iva: Number(rec.alicuota_iva ?? defaultIva),
        subtotal: monto,
      });
      render();
    });

    root.querySelector('#btn-vta-add-imp')?.addEventListener('click', () => {
      capture();
      const selId = root.querySelector('#vta-imp-select')?.value;
      const cfg = impuestosConfig.find(c => String(c.id) === String(selId));
      if (!cfg) { toast('Elegí un impuesto configurado', true); return; }
      const t = calcDocumentTotals(lineas, impuestos, v.caracter, v.tipo_comprobante);
      const base = cfg.base_calculo === 'total' ? Number((t.neto + t.ivaTotal).toFixed(2)) : cfg.base_calculo === 'fijo' ? 0 : t.neto;
      const alic = Number(cfg.alicuota_defecto || 0);
      const monto = cfg.base_calculo === 'fijo' ? alic : Number((base * alic / 100).toFixed(2));
      impuestos.push({ impuesto_id: cfg.id, nombre: cfg.nombre, tipo: cfg.tipo, base_calculo: cfg.base_calculo, base, alicuota: alic, monto });
      render();
    });
    root.querySelector('#btn-vta-sugerir-iibb')?.addEventListener('click', async () => {
      capture();
      if (!v.contacto_id) { toast('Seleccioná primero un cliente', true); return; }
      const t = calcDocumentTotals(lineas, impuestos, v.caracter, v.tipo_comprobante);
      try {
        const res = await api('/api/fiscal/sugerir-percepciones', {
          method: 'POST',
          body: JSON.stringify({
            contacto_id: Number(v.contacto_id),
            neto: t.neto,
            total: Number((t.neto + t.ivaTotal).toFixed(2)),
            aplica_a: 'ventas',
          }),
        });
        const sugs = res.sugerencias || [];
        if (!sugs.length) { toast('Sin percepciones IIBB sugeridas para la jurisdicción del cliente'); return; }
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
        render();
      } catch (err) { toast(err.message, true); }
    });
    root.querySelectorAll('.vi-base').forEach(inp => inp.addEventListener('input', () => {
      const i = Number(inp.dataset.idx);
      impuestos[i].base = Number(inp.value) || 0;
      impuestos[i].monto = Number((impuestos[i].base * (Number(impuestos[i].alicuota) || 0) / 100).toFixed(2));
      const mInp = root.querySelector(`.vi-monto[data-idx="${i}"]`);
      if (mInp) mInp.value = impuestos[i].monto;
      syncTotals();
    }));
    root.querySelectorAll('.vi-aliq').forEach(inp => inp.addEventListener('input', () => {
      const i = Number(inp.dataset.idx);
      impuestos[i].alicuota = Number(inp.value) || 0;
      impuestos[i].monto = Number(((Number(impuestos[i].base) || 0) * impuestos[i].alicuota / 100).toFixed(2));
      const mInp = root.querySelector(`.vi-monto[data-idx="${i}"]`);
      if (mInp) mInp.value = impuestos[i].monto;
      syncTotals();
    }));
    root.querySelectorAll('.vi-monto').forEach(inp => inp.addEventListener('input', () => {
      const i = Number(inp.dataset.idx);
      impuestos[i].monto = Number(inp.value) || 0;
      syncTotals();
    }));
    root.querySelectorAll('.vi-del').forEach(b => b.addEventListener('click', () => {
      capture();
      impuestos.splice(Number(b.dataset.idx), 1);
      render();
    }));

    root.querySelector('#form-venta').addEventListener('submit', async (e) => {
      e.preventDefault();
      capture();
      const payload = { ...v, cliente_id: Number(v.cliente_id), lineas, impuestos };
      try {
        if (isEdit) {
          await api(`/api/ventas/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
          toast('Venta actualizada');
          await renderVentaFormView({ id });
        } else {
          const res = await api('/api/ventas', { method: 'POST', body: JSON.stringify(payload) });
          toast('Venta registrada');
          navigate(`/ventas/${res.id}`);
        }
      } catch (err) {
        toast(err.message, true);
      }
    });
  };
  render();
}
