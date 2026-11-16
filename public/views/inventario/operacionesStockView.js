import { api, toast } from '../../lib/api.js';
import { esc, fmtNum, badgeForEstado, renderPuntoVentaOptions, bindPuntoVentaSeq } from '../../lib/format.js';
import { renderMetaPanel } from '../../lib/metaPanel.js';
import { printRemito } from '../../lib/remitoPrint.js';
import { mountCombobox, quickCreateProducto, quickCreateProveedor } from '../../lib/autocomplete.js';
import { renderKpiStrip, renderFilterBar, renderDataTable, mountDetailView } from '../../lib/engine/index.js';
import { showConfirmModal } from '../../lib/engine/index.js';
import { navigate } from '../../router.js';

const TIPO_LABELS = {
  recepcion: 'Recepción',
  entrega: 'Entrega',
  remito_taller: 'Traslado',
  traslado: 'Traslado',
  ajuste: 'Ajuste',
};

const TIPO_BADGE_CLASS = {
  recepcion: 'badge-confirmado',
  entrega: 'badge-primary',
  remito_taller: 'badge-confirmado',
  traslado: 'badge-confirmado',
  ajuste: 'badge-parcial',
};

function renderTipoBadge(tipo) {
  return `<span class="badge ${TIPO_BADGE_CLASS[tipo] || 'badge-muted'}">${esc(TIPO_LABELS[tipo] || tipo || '-')}</span>`;
}

async function imprimirOperacionById(id, empresa) {
  const data = await api(`/api/operaciones-stock/${id}`);
  const op = data.operacion || {};
  const tipoDocMap = {
    entrega: 'REMITO DE ENTREGA',
    recepcion: 'REMITO DE RECEPCIÓN',
    remito_taller: 'REMITO DE TRASLADO',
    ajuste: 'COMPROBANTE DE AJUSTE',
    traslado: 'REMITO DE TRASLADO',
  };
  const labelMap = {
    entrega: 'Cliente',
    recepcion: 'Proveedor',
    remito_taller: 'Destinatario',
    traslado: 'Destinatario',
  };
  const notasInternas = [
    ...(Array.isArray(op.notas_internas) ? op.notas_internas : []),
    op.contacto_observaciones || '',
  ].filter(Boolean);
  await printRemito({
    tipoDoc: tipoDocMap[op.tipo] || 'REMITO',
    numero: op.numero,
    fecha: op.fecha,
    origen: op.origen_nombre,
    destino: op.destino_nombre,
    mostrarOrigenDestino: op.tipo === 'traslado' || op.tipo === 'ajuste',
    contraparteLabel: labelMap[op.tipo] || 'Destinatario',
    contraparteNombre: op.contacto_nombre || op.contacto_razon_social || '',
    contraparteCuit: op.contacto_cuit || '',
    contraparteIva: op.contacto_iva || '',
    contraparteDireccion: op.contacto_direccion || '',
    contraparteLocalidad: op.contacto_localidad || '',
    contraparteProvincia: op.contacto_provincia || '',
    contraparteTelefono: op.contacto_telefono || '',
    contraparteEmail: op.contacto_email || '',
    motivo: op.motivo || '',
    envio: op.envio || '',
    codigo_seguimiento: op.codigo_seguimiento || '',
    notasInternas,
    lineas: (data.lineas || []).map(l => ({
      nombre: l.item_nombre,
      lote: l.lote_codigo || l.lote || '',
      cantidad: l.cantidad,
      udm: l.udm || 'unidades',
    })),
    nota: op.observaciones || '',
    empresa,
  });
}

export async function renderOperacionesStockView() {
  const root = document.getElementById('app-view');
  const [operaciones, empresa] = await Promise.all([
    api('/api/operaciones-stock'),
    api('/api/empresa'),
  ]);

  let search = '';
  let filterTipo = '';
  let filterEstado = '';
  let filterContacto = '';
  let filterDesde = '';
  let filterHasta = '';

  const getFiltered = () => {
    const q = search.trim().toLowerCase();
    return operaciones.filter(o => {
      if (filterTipo) {
        if (filterTipo === 'traslado') {
          if (o.tipo !== 'traslado' && o.tipo !== 'remito_taller') return false;
        } else if (o.tipo !== filterTipo) {
          return false;
        }
      }
      if (filterEstado && o.estado !== filterEstado) return false;
      if (filterContacto && String(o.contacto_id || '') !== String(filterContacto)) return false;
      if (filterDesde && (o.fecha || '') < filterDesde) return false;
      if (filterHasta && (o.fecha || '') > filterHasta) return false;
      if (q) {
        const hay = `${o.numero || ''} ${o.contacto_nombre || ''} ${o.motivo || ''} ${o.observaciones || ''} ${o.envio || ''} ${o.codigo_seguimiento || ''} ${o.origen_nombre || ''} ${o.destino_nombre || ''} ${o.referencia_tipo || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  };

  const contactosEnOps = Array.from(
    new Map(
      operaciones
        .filter(o => o.contacto_id && o.contacto_nombre)
        .map(o => [String(o.contacto_id), o.contacto_nombre])
    ).entries()
  ).sort((a, b) => a[1].localeCompare(b[1]));

  root.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Operaciones de Stock</h1>
        <p class="muted">Recepciones, entregas, traslados y ajustes de inventario.</p>
      </div>
      <div class="actions">
        <a href="/operaciones-stock/nueva" data-link class="btn btn-primary">+ Nueva Operación</a>
      </div>
    </div>

    <div id="op-kpis"></div>

    <div class="card">
      <div id="op-filters"></div>
      <div id="op-table-wrap"></div>
    </div>
  `;

  const borradores = operaciones.filter(o => o.estado === 'Borrador').length;
  const confirmados = operaciones.filter(o => o.estado === 'Confirmado').length;
  const trasladosCount = operaciones.filter(o => o.tipo === 'traslado' || o.tipo === 'remito_taller').length;
  const entregasCount = operaciones.filter(o => o.tipo === 'entrega').length;
  const recepcionesCount = operaciones.filter(o => o.tipo === 'recepcion').length;
  renderKpiStrip(root.querySelector('#op-kpis'), [
    { label: 'Total Operaciones', value: String(operaciones.length) },
    { label: 'Borradores', value: String(borradores), tone: borradores > 0 ? 'warn' : 'default' },
    { label: 'Confirmadas', value: String(confirmados), tone: 'success' },
    { label: 'Entregas', value: String(entregasCount) },
    { label: 'Recepciones', value: String(recepcionesCount) },
    { label: 'Traslados', value: String(trasladosCount) },
  ]);

  const drawTable = () => {
    const filtered = getFiltered();
    renderDataTable(root.querySelector('#op-table-wrap'), {
      rows: filtered,
      emptyText: 'No hay operaciones ni remitos para los filtros seleccionados.',
      exportFilename: `operaciones_stock_${new Date().toISOString().slice(0, 10)}.csv`,
      bulkActions: [
        {
          id: 'confirmar',
          label: 'Confirmar Borradores',
          variant: 'primary',
          confirm: (sel) => {
            const n = sel.filter(o => o.estado === 'Borrador').length;
            return n ? `¿Confirmar ${n} documento(s) en Borrador y actualizar el stock?` : null;
          },
          onClick: async (sel) => {
            const targets = sel.filter(o => o.estado === 'Borrador');
            if (!targets.length) { toast('No hay documentos en Borrador en la selección', true); return; }
            let ok = 0; let errs = 0;
            for (const o of targets) {
              try { await api(`/api/operaciones-stock/${o.id}/confirmar`, { method: 'POST' }); ok++; }
              catch { errs++; }
            }
            toast(`${ok} confirmado(s)${errs ? `, ${errs} con error` : ''}`, errs > 0 && ok === 0);
            await renderOperacionesStockView();
          },
        },
        {
          id: 'anular',
          label: 'Anular Confirmados',
          confirm: (sel) => {
            const n = sel.filter(o => o.estado === 'Confirmado').length;
            return n ? `¿Anular ${n} documento(s) Confirmado(s) y revertir sus movimientos de stock?` : null;
          },
          onClick: async (sel) => {
            const targets = sel.filter(o => o.estado === 'Confirmado');
            if (!targets.length) { toast('No hay documentos Confirmados en la selección', true); return; }
            let ok = 0; let errs = 0;
            for (const o of targets) {
              try { await api(`/api/operaciones-stock/${o.id}/anular`, { method: 'POST' }); ok++; }
              catch { errs++; }
            }
            toast(`${ok} anulado(s)${errs ? `, ${errs} con error` : ''}`, errs > 0 && ok === 0);
            await renderOperacionesStockView();
          },
        },
        {
          id: 'eliminar',
          label: 'Eliminar Borradores',
          variant: 'danger',
          confirm: (sel) => {
            const n = sel.filter(o => o.estado === 'Borrador').length;
            return n ? `¿Eliminar ${n} borrador(es) seleccionado(s)?` : null;
          },
          onClick: async (sel) => {
            const targets = sel.filter(o => o.estado === 'Borrador');
            if (!targets.length) { toast('Solo se pueden eliminar documentos en Borrador', true); return; }
            let ok = 0; let errs = 0;
            for (const o of targets) {
              try { await api(`/api/operaciones-stock/${o.id}`, { method: 'DELETE' }); ok++; }
              catch { errs++; }
            }
            toast(`${ok} eliminado(s)${errs ? `, ${errs} con error` : ''}`, errs > 0 && ok === 0);
            await renderOperacionesStockView();
          },
        },
      ],
      columns: [
        { label: 'Fecha', render: o => esc(o.fecha) },
        {
          label: 'Número',
          render: o => `<a href="/operaciones-stock/${o.id}" data-link class="link-primary"><strong>${esc(o.numero || '#' + o.id)}</strong></a>`,
        },
        { label: 'Estado', render: o => badgeForEstado(o.estado) },
        { label: 'Tipo', render: o => renderTipoBadge(o.tipo) },
        {
          label: 'Ubicación',
          render: o => {
            if (o.tipo === 'traslado') return `${esc(o.origen_nombre || '-')} → ${esc(o.destino_nombre || '-')}`;
            if (o.tipo === 'entrega' || o.tipo === 'remito_taller') return esc(o.origen_nombre || o.destino_nombre || '-');
            return esc(o.destino_nombre || o.origen_nombre || '-');
          },
        },
        {
          label: 'Contacto',
          render: o => o.contacto_id
            ? `<a href="/contactos/${o.contacto_id}" data-link class="link-primary">${esc(o.contacto_nombre || '-')}</a>`
            : `<span class="muted">${esc(o.contacto_nombre || '-')}</span>`,
        },
        { label: 'Motivo', render: o => esc(o.motivo || '-') },
        {
          label: 'Doc. Origen',
          render: o => {
            if (!o.referencia_tipo || !o.referencia_id) return '<span class="muted">-</span>';
            const label = `${o.referencia_tipo} #${o.referencia_id}`;
            if (o.referencia_tipo === 'venta') return `<a href="/ventas/${o.referencia_id}" data-link class="link-primary">${esc(label)}</a>`;
            if (o.referencia_tipo === 'orden') return `<a href="/ordenes/${o.referencia_id}" data-link class="link-primary">${esc(label)}</a>`;
            if (o.referencia_tipo === 'compra') return `<a href="/compras/${o.referencia_id}" data-link class="link-primary">${esc(label)}</a>`;
            return `<span class="muted">${esc(label)}</span>`;
          },
        },
        {
          label: 'Acciones',
          render: o => `
            <div class="actions">
              ${o.estado === 'Borrador' ? `<button type="button" class="btn btn-sm btn-primary" data-conf-op="${o.id}">Confirmar</button>` : ''}
              ${o.estado === 'Confirmado' ? `<button type="button" class="btn btn-sm" data-anul-op="${o.id}">Anular</button>` : ''}
              <a href="/operaciones-stock/${o.id}" data-link class="btn btn-sm">Abrir</a>
              <button type="button" class="btn btn-sm" data-print-op="${o.id}">Imprimir</button>
              ${o.estado === 'Borrador' ? `<button type="button" class="btn btn-sm btn-danger" data-del-op="${o.id}">Eliminar</button>` : ''}
            </div>
          `,
        },
      ],
    });

    root.querySelectorAll('[data-print-op]').forEach(btn => btn.addEventListener('click', async () => {
      try { await imprimirOperacionById(btn.dataset.printOp, empresa); }
      catch (err) { toast(err.message, true); }
    }));

    root.querySelectorAll('[data-conf-op]').forEach(btn => btn.addEventListener('click', async () => {
      try {
        await api(`/api/operaciones-stock/${btn.dataset.confOp}/confirmar`, { method: 'POST' });
        toast('Documento confirmado y stock actualizado');
        await renderOperacionesStockView();
      } catch (err) { toast(err.message, true); }
    }));

    root.querySelectorAll('[data-anul-op]').forEach(btn => btn.addEventListener('click', async () => {
      if (!(await showConfirmModal('¿Anular este documento? Se generarán movimientos inversos para revertir el stock.'))) return;
      try {
        await api(`/api/operaciones-stock/${btn.dataset.anulOp}/anular`, { method: 'POST' });
        toast('Documento anulado');
        await renderOperacionesStockView();
      } catch (err) { toast(err.message, true); }
    }));

    root.querySelectorAll('[data-del-op]').forEach(btn => btn.addEventListener('click', async () => {
      if (!(await showConfirmModal('¿Eliminar este borrador?'))) return;
      try {
        await api(`/api/operaciones-stock/${btn.dataset.delOp}`, { method: 'DELETE' });
        toast('Borrador eliminado');
        await renderOperacionesStockView();
      } catch (err) { toast(err.message, true); }
    }));
  };

  renderFilterBar(root.querySelector('#op-filters'), {
    searchValue: search,
    searchPlaceholder: 'Buscar número, contacto, motivo, ubicación o referencia...',
    filters: [
      {
        name: 'tipo',
        value: filterTipo,
        options: [
          { value: '', label: 'Todos los tipos' },
          { value: 'recepcion', label: 'Recepción' },
          { value: 'entrega', label: 'Entrega' },
          { value: 'traslado', label: 'Traslado' },
          { value: 'ajuste', label: 'Ajuste' },
        ],
      },
      {
        name: 'estado',
        value: filterEstado,
        options: [
          { value: '', label: 'Todos los estados' },
          { value: 'Borrador', label: 'Borrador' },
          { value: 'Confirmado', label: 'Confirmado' },
          { value: 'Anulado', label: 'Anulado' },
        ],
      },
      {
        name: 'contacto',
        value: filterContacto,
        options: [
          { value: '', label: 'Todos los contactos' },
          ...contactosEnOps.map(([cid, cname]) => ({ value: cid, label: cname })),
        ],
      },
    ],
    dateRange: { from: filterDesde, to: filterHasta },
    onChange: (st) => {
      search = st.search;
      filterTipo = st.tipo || '';
      filterEstado = st.estado || '';
      filterContacto = st.contacto || '';
      filterDesde = st.from || '';
      filterHasta = st.to || '';
      drawTable();
    },
  });

  drawTable();
}

export async function renderOperacionStockFormView({ mode = 'operacion' } = {}) {
  const root = document.getElementById('app-view');
  const [ubicaciones, productos, quants, contactos, puntosVenta, nextRemitoSeq] = await Promise.all([
    api('/api/ubicaciones'),
    api('/api/productos'),
    api('/api/stock-quants'),
    api('/api/contactos'),
    api('/api/puntos-venta'),
    api('/api/secuencias/siguiente?tipo=remito'),
  ]);

  const internas = ubicaciones.filter(u => u.activa && (u.tipo === 'interna' || u.tipo === 'dedicada'));
  const depCentral = internas.find(u => u.codigo === 'DEP-CENTRAL') || internas[0];
  const tallerExt = internas.find(u => u.codigo === 'TALLER-EXT') || internas[1] || depCentral;
  const prodTerm = internas.find(u => u.codigo === 'PROD-TERM') || depCentral;
  const virtAjuste = ubicaciones.find(u => u.codigo === 'VIRT-AJUSTE') || ubicaciones.find(u => u.tipo === 'virtual');

  const formState = {
    tipo: 'traslado',
    fecha: new Date().toISOString().slice(0, 10),
    origen_id: depCentral?.id ? String(depCentral.id) : '',
    destino_id: tallerExt?.id ? String(tallerExt.id) : '',
    ubicacion_id: depCentral?.id ? String(depCentral.id) : '',
    contacto_id: '',
    numero: mode === 'remito' ? (nextRemitoSeq?.numero || '') : '',
    ajuste_dir: '1',
    motivo: '',
    observaciones: '',
    envio: '',
    codigo_seguimiento: '',
  };
  const lineas = [{ producto_id: '', lote: '', lote_id: '', descripcion: '', cantidad: 1, udm: 'unidades' }];

  const getOriginIdForLotes = () => {
    if (formState.tipo === 'traslado') return Number(formState.origen_id) || null;
    if (formState.tipo === 'entrega') return prodTerm?.id ? Number(prodTerm.id) : null;
    if (formState.tipo === 'ajuste') return formState.ajuste_dir === '-1' ? (Number(formState.ubicacion_id) || null) : null;
    return null;
  };

  const draw = () => {
    document.querySelectorAll('.combo-menu').forEach(m => m.remove());
    const t = formState.tipo;
    const usaContacto = t === 'traslado' || t === 'entrega' || t === 'recepcion';
    const contactoReq = t === 'entrega' || t === 'recepcion';
    const contactoLabel = t === 'traslado' ? 'Destinatario' : t === 'entrega' ? 'Cliente *' : 'Proveedor *';

    root.innerHTML = `
      <div class="page-header">
        <div>
          <div style="margin-bottom:6px;"><a href="/operaciones-stock" data-link class="muted" style="font-size:0.85rem;">← Volver a Operaciones</a></div>
          <h1>Nueva Operación de Stock</h1>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h2>Datos de la Operación</h2></div>
        <form id="form-op-stock" class="form-grid">
          <label>
            <span>Tipo *</span>
            <select id="op-tipo" name="tipo">
              <option value="traslado" ${t === 'traslado' ? 'selected' : ''}>Traslado</option>
              <option value="entrega" ${t === 'entrega' ? 'selected' : ''}>Entrega</option>
              <option value="recepcion" ${t === 'recepcion' ? 'selected' : ''}>Recepción</option>
              <option value="ajuste" ${t === 'ajuste' ? 'selected' : ''}>Ajuste</option>
            </select>
          </label>
          <label><span>Fecha *</span><input type="date" id="op-fecha" name="fecha" required value="${esc(formState.fecha)}" /></label>

          ${t === 'traslado' ? `
            <label>
              <span>Origen *</span>
              <div id="op-origen-combo"></div>
            </label>
            <label>
              <span>Destino *</span>
              <div id="op-destino-combo"></div>
            </label>
          ` : ''}

          ${t === 'ajuste' ? `
            <label>
              <span>Dirección *</span>
              <select id="op-ajuste-dir" name="ajuste_dir">
                <option value="1" ${formState.ajuste_dir === '1' ? 'selected' : ''}>+ Ingreso</option>
                <option value="-1" ${formState.ajuste_dir === '-1' ? 'selected' : ''}>- Egreso</option>
              </select>
            </label>
            <label>
              <span>Ubicación *</span>
              <div id="op-ubicacion-combo"></div>
            </label>
          ` : ''}

          ${usaContacto ? `
            <label>
              <span>${contactoLabel}</span>
              <div id="op-contacto-combo"></div>
            </label>
          ` : ''}

          ${t === 'traslado' ? `
            <label>
              <span>Punto de Venta</span>
              <select name="punto_venta" id="op-rem-pv">${renderPuntoVentaOptions(puntosVenta, nextRemitoSeq?.punto_venta)}</select>
            </label>
            <label><span>Número</span><input type="text" id="op-numero" name="numero" value="${esc(formState.numero || '')}" placeholder="Automático" /></label>
          ` : ''}

          <label><span>Motivo</span><input type="text" id="op-motivo" name="motivo" value="${esc(formState.motivo)}" placeholder="Ej: Conteo físico / Envío a taller" /></label>
          <label><span>Observaciones</span><input type="text" id="op-obs" name="observaciones" value="${esc(formState.observaciones)}" placeholder="Opcional" /></label>
          <label>
            <span>Transporte</span>
            <input type="text" id="op-envio" name="envio" list="op-envio-list" value="${esc(formState.envio)}" placeholder="Ej: Andreani, Correo Argentino, Retiro en local..." />
            <datalist id="op-envio-list">
              <option value="Retiro en Local"></option>
              <option value="Flete Propio"></option>
              <option value="Andreani"></option>
              <option value="Correo Argentino"></option>
              <option value="OCA"></option>
              <option value="Expreso"></option>
            </datalist>
          </label>
          <label><span>Código de Seguimiento</span><input type="text" id="op-seg" name="codigo_seguimiento" value="${esc(formState.codigo_seguimiento)}" placeholder="Ej: AR123456789" /></label>

          <div class="full">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <strong>Detalle (${lineas.length})</strong>
              <button type="button" id="btn-op-add-line" class="btn btn-sm">+ Agregar Ítem</button>
            </div>
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>Producto</th><th>Lote</th><th class="num">Cantidad</th><th>Unidad</th><th></th></tr></thead>
                <tbody>
                  ${lineas.map((l, idx) => `
                    <tr>
                      <td style="min-width:220px;"><div class="op-prod-combo" data-idx="${idx}"></div></td>
                      <td style="min-width:190px;"><div class="op-lote-combo" data-idx="${idx}"></div></td>
                      <td class="num"><input type="number" step="0.01" min="0.01" class="op-qty" data-idx="${idx}" value="${l.cantidad}" style="width:95px;text-align:right;" /></td>
                      <td><span class="badge badge-muted op-udm-badge" data-idx="${idx}">${esc(l.udm || 'unidades')}</span></td>
                      <td><button type="button" class="btn btn-sm btn-danger op-del" data-idx="${idx}">Quitar</button></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <div class="full modal-footer">
            <a href="/operaciones-stock" data-link class="btn">Cancelar</a>
            <button type="button" id="btn-op-draft" class="btn">Guardar Borrador</button>
            <button type="submit" class="btn btn-primary">Confirmar Operación</button>
          </div>
        </form>
      </div>
    `;

    const syncFormMeta = () => {
      formState.fecha = root.querySelector('#op-fecha')?.value || formState.fecha;
      formState.motivo = root.querySelector('#op-motivo')?.value || '';
      formState.observaciones = root.querySelector('#op-obs')?.value || '';
      formState.envio = root.querySelector('#op-envio')?.value || '';
      formState.codigo_seguimiento = root.querySelector('#op-seg')?.value || '';
      const numInp = root.querySelector('#op-numero');
      if (numInp) formState.numero = numInp.value || '';
      if (formState.tipo === 'ajuste') {
        formState.ajuste_dir = root.querySelector('#op-ajuste-dir')?.value || formState.ajuste_dir;
      }
    };

    const ubicItems = internas.map(u => ({
      value: String(u.id),
      label: u.parent_nombre ? `${u.parent_nombre} / ${u.nombre}` : u.nombre,
      sublabel: u.codigo || u.tipo,
      raw: u,
    }));

    if (t === 'traslado') {
      mountCombobox(root.querySelector('#op-origen-combo'), {
        name: 'ubicacion_origen_id',
        value: formState.origen_id,
        required: true,
        placeholder: 'Buscar ubicación origen...',
        items: ubicItems,
        onSelect: (it) => {
          formState.origen_id = it ? String(it.value) : '';
          syncFormMeta();
          draw();
        },
      });
      mountCombobox(root.querySelector('#op-destino-combo'), {
        name: 'ubicacion_destino_id',
        value: formState.destino_id,
        required: true,
        placeholder: 'Buscar ubicación destino...',
        items: ubicItems,
        onSelect: (it) => { formState.destino_id = it ? String(it.value) : ''; },
      });
    } else if (t === 'ajuste') {
      mountCombobox(root.querySelector('#op-ubicacion-combo'), {
        name: 'ubicacion_id',
        value: formState.ubicacion_id,
        required: true,
        placeholder: 'Buscar ubicación...',
        items: ubicItems,
        onSelect: (it) => {
          formState.ubicacion_id = it ? String(it.value) : '';
          syncFormMeta();
          draw();
        },
      });
    }

    if (usaContacto) {
      const sortedContacts = contactos.slice().sort((a, b) => {
        if (t === 'traslado') return Number(Boolean(b.es_taller)) - Number(Boolean(a.es_taller));
        if (t === 'entrega') return Number(Boolean(b.es_cliente)) - Number(Boolean(a.es_cliente));
        return Number(Boolean(b.es_proveedor)) - Number(Boolean(a.es_proveedor));
      });
      mountCombobox(root.querySelector('#op-contacto-combo'), {
        name: 'contacto_id',
        required: contactoReq,
        value: formState.contacto_id,
        placeholder: 'Buscar o crear contacto...',
        items: sortedContacts.map(c => ({
          value: String(c.id),
          label: c.nombre,
          sublabel: c.es_taller ? 'Taller' : c.es_cliente ? 'Cliente' : 'Proveedor',
          raw: c,
        })),
        onSelect: (it) => { formState.contacto_id = it ? String(it.value) : ''; },
        onCreate: async (q) => {
          const created = await quickCreateProveedor(q, { es_taller: t === 'traslado' });
          if (created) {
            contactos.push(created.raw);
            formState.contacto_id = created.value;
          }
          return created;
        },
      });
    }

    if (t === 'traslado') {
      bindPuntoVentaSeq(root.querySelector('#op-rem-pv'), root.querySelector('#op-numero'), 'remito', api);
    }

    root.querySelector('#op-tipo').addEventListener('change', (e) => {
      syncFormMeta();
      formState.tipo = e.target.value;
      draw();
    });
    root.querySelector('#op-ajuste-dir')?.addEventListener('change', (e) => {
      syncFormMeta();
      formState.ajuste_dir = e.target.value;
      draw();
    });

    const prodItems = () => productos.map(p => ({
      value: String(p.id),
      label: p.nombre,
      sublabel: `Stock: ${p.stock} ${p.udm || ''}`,
      raw: p,
    }));

    const mountLoteCombo = (el, idx) => {
      const l = lineas[idx];
      const origId = getOriginIdForLotes();
      const opts = quants
        .filter(q => (!l.producto_id || String(q.producto_id) === String(l.producto_id)) && (!origId || Number(q.ubicacion_id) === origId) && Number(q.cantidad) > 0)
        .map(q => ({
          value: q.lote_codigo || '',
          label: q.lote_codigo || 'Sin lote',
          sublabel: `Disp: ${q.cantidad} (${q.ubicacion_nombre})`,
          raw: q,
        }));
      mountCombobox(el, {
        value: l.lote || '',
        allowFreeText: true,
        placeholder: 'Lote / Quant (opcional)...',
        items: opts,
        onSelect: (it) => {
          if (!it) { l.lote = ''; l.lote_id = ''; return; }
          if (it.raw) {
            l.lote = it.raw.lote_codigo || '';
            l.lote_id = it.raw.lote_id || '';
          } else {
            l.lote = it.label || it.value || '';
            l.lote_id = '';
          }
        },
      });
    };

    root.querySelectorAll('.op-prod-combo').forEach(el => {
      const idx = Number(el.dataset.idx);
      mountCombobox(el, {
        value: lineas[idx].producto_id,
        placeholder: 'Buscar o crear producto...',
        items: prodItems(),
        onSelect: (it) => {
          if (!it) { lineas[idx].producto_id = ''; return; }
          const p = it.raw;
          lineas[idx].producto_id = String(p.id);
          lineas[idx].descripcion = p.nombre;
          lineas[idx].udm = p.udm || 'unidades';
          const udmBadge = root.querySelector(`.op-udm-badge[data-idx="${idx}"]`);
          if (udmBadge) udmBadge.textContent = lineas[idx].udm;
          const loteEl = root.querySelector(`.op-lote-combo[data-idx="${idx}"]`);
          if (loteEl) mountLoteCombo(loteEl, idx);
        },
        onCreate: async (q) => {
          const created = await quickCreateProducto(q, { se_compra: true, se_fabrica: false });
          if (created) productos.push(created.raw);
          return created;
        },
      });
    });

    root.querySelectorAll('.op-lote-combo').forEach(el => mountLoteCombo(el, Number(el.dataset.idx)));

    root.querySelector('#btn-op-add-line').addEventListener('click', () => {
      syncFormMeta();
      lineas.push({ producto_id: '', lote: '', lote_id: '', descripcion: '', cantidad: 1, udm: 'unidades' });
      draw();
    });
    root.querySelectorAll('.op-del').forEach(b => b.addEventListener('click', () => {
      syncFormMeta();
      lineas.splice(Number(b.dataset.idx), 1);
      draw();
    }));
    root.querySelectorAll('.op-qty').forEach(inp => inp.addEventListener('input', () => { lineas[Number(inp.dataset.idx)].cantidad = Number(inp.value) || 0; }));

    const submitOp = async (estado) => {
      syncFormMeta();
      if (contactoReq && !Number(formState.contacto_id)) {
        toast('Seleccioná o creá un contacto destinatario', true);
        return;
      }
      const body = {
        tipo: formState.tipo,
        fecha: formState.fecha,
        estado,
        motivo: formState.motivo,
        observaciones: formState.observaciones,
        envio: formState.envio,
        codigo_seguimiento: formState.codigo_seguimiento,
        lineas,
      };
      if (formState.tipo === 'traslado') {
        body.ubicacion_origen_id = Number(formState.origen_id);
        body.ubicacion_destino_id = Number(formState.destino_id);
        if (Number(formState.contacto_id)) body.contacto_id = Number(formState.contacto_id);
        if (formState.numero) body.numero = formState.numero;
      } else if (formState.tipo === 'ajuste') {
        if (!virtAjuste?.id) { toast('Falta ubicación virtual VIRT-AJUSTE', true); return; }
        const ubId = Number(formState.ubicacion_id);
        body.ubicacion_origen_id = formState.ajuste_dir === '1' ? virtAjuste.id : ubId;
        body.ubicacion_destino_id = formState.ajuste_dir === '1' ? ubId : virtAjuste.id;
      } else {
        body.contacto_id = Number(formState.contacto_id);
      }
      try {
        const res = await api('/api/operaciones-stock', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        toast(estado === 'Confirmado' ? 'Operación confirmada y stock actualizado' : 'Borrador guardado');
        navigate(res?.id ? `/operaciones-stock/${res.id}` : '/operaciones-stock');
      } catch (err) { toast(err.message, true); }
    };

    root.querySelector('#btn-op-draft').addEventListener('click', () => submitOp('Borrador'));
    root.querySelector('#form-op-stock').addEventListener('submit', (e) => {
      e.preventDefault();
      submitOp('Confirmado');
    });
  };
  draw();
}

export async function renderOperacionStockDetalleView({ id }) {
  const root = document.getElementById('app-view');
  const [data, empresa] = await Promise.all([
    api(`/api/operaciones-stock/${id}`),
    api('/api/empresa'),
  ]);
  const op = data?.operacion;
  const lineas = data?.lineas || [];
  if (!op) {
    root.innerHTML = `<div class="card"><div class="card-body"><p>Operación no encontrada.</p><a href="/traslados" data-link class="btn">Volver</a></div></div>`;
    return;
  }

  let refLink = '';
  if (op.referencia_tipo === 'venta' && op.referencia_id) refLink = `/ventas/${op.referencia_id}`;
  else if (op.referencia_tipo === 'orden' && op.referencia_id) refLink = `/ordenes/${op.referencia_id}`;

  const totalUnidades = lineas.reduce((s, l) => s + Number(l.cantidad || 0), 0);
  const tipoLabel = TIPO_LABELS[op.tipo] || op.tipo || 'Operación';

  const datosHtml = `
    <div class="card">
      <div class="card-header"><h2>Datos de la Operación</h2></div>
      <div class="form-grid">
        <label><span>Fecha</span><input type="text" readonly value="${esc(op.fecha || '')}" /></label>
        <label><span>Origen → Destino</span><input type="text" readonly value="${esc(`${op.origen_nombre || '-'} → ${op.destino_nombre || '-'}`)}" /></label>
        <label>
          <span>Contacto</span>
          ${op.contacto_id
            ? `<div style="padding:8px 0;"><a href="/contactos/${op.contacto_id}" data-link class="link-primary"><strong>${esc(op.contacto_nombre || op.contacto_razon_social || '-')}</strong></a></div>`
            : `<input type="text" readonly value="-" />`}
        </label>
        <label>
          <span>Documento Origen</span>
          ${refLink
            ? `<div style="padding:8px 0;"><a href="${refLink}" data-link class="link-primary"><strong>${esc(`${op.referencia_tipo} #${op.referencia_id}`)}</strong></a></div>`
            : `<input type="text" readonly value="${esc(op.referencia_tipo ? `${op.referencia_tipo} #${op.referencia_id}` : '-')}" />`}
        </label>
        <label><span>Motivo</span><input type="text" readonly value="${esc(op.motivo || '-')}" /></label>
        <label><span>Observaciones</span><input type="text" readonly value="${esc(op.observaciones || '-')}" /></label>
        <label>
          <span>Transporte</span>
          <input type="text" id="opd-envio" value="${esc(op.envio || '')}" placeholder="Ej: Andreani, Correo Argentino..." />
        </label>
        <label>
          <span>Código de Seguimiento</span>
          <div style="display:flex;gap:8px;align-items:center;">
            <input type="text" id="opd-seg" value="${esc(op.codigo_seguimiento || '')}" placeholder="Ej: AR123456789" style="flex:1;" />
            <button type="button" id="btn-opd-save-envio" class="btn btn-sm">Guardar envío</button>
          </div>
        </label>
      </div>
    </div>
  `;

  const isBorrador = op.estado === 'Borrador';
  const itemsHtml = `
    <div class="card">
      <div class="card-header">
        <div>
          <h2>Ítems (${lineas.length})</h2>
          ${isBorrador ? `<span class="muted" style="font-size:0.82rem;">Podés ajustar la cantidad a procesar hoy; si es menor al total pedido se generará automáticamente un documento en Borrador por el saldo pendiente.</span>` : ''}
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Producto</th>
              <th>SKU</th>
              <th>Lote</th>
              ${isBorrador ? '<th class="num">Pedido</th><th class="num">A Procesar</th>' : '<th class="num">Cantidad</th>'}
              <th>Unidad</th>
            </tr>
          </thead>
          <tbody>
            ${lineas.length === 0 ? `<tr><td colspan="${isBorrador ? 6 : 5}" class="muted">Sin líneas registradas.</td></tr>` : lineas.map(l => `
              <tr>
                <td><strong>${esc(l.item_nombre || l.descripcion || '-')}</strong></td>
                <td class="muted">${esc(l.sku || '-')}</td>
                <td>
                  ${isBorrador
                    ? `<input type="text" class="opd-line-lote" data-lid="${l.id}" value="${esc(l.lote_codigo || l.lote || '')}" placeholder="Lote" style="width:130px;" />`
                    : (l.lote_codigo || l.lote ? `<span class="badge badge-muted">${esc(l.lote_codigo || l.lote)}</span>` : '<span class="muted">-</span>')}
                </td>
                ${isBorrador ? `
                  <td class="num muted">${fmtNum(l.cantidad)}</td>
                  <td class="num">
                    <input type="number" step="0.0001" min="0" max="${l.cantidad}" class="opd-line-qty num" data-lid="${l.id}" data-pid="${l.producto_id}" value="${l.cantidad}" style="width:110px;text-align:right;font-weight:600;" />
                  </td>
                ` : `
                  <td class="num"><strong>${fmtNum(l.cantidad)}</strong></td>
                `}
                <td>${esc(l.udm || 'unidades')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  const actions = [
    {
      label: 'Imprimir Remito',
      onClick: async () => {
        try { await imprimirOperacionById(id, empresa); }
        catch (err) { toast(err.message, true); }
      },
    },
  ];
  if (op.estado === 'Borrador') {
    actions.push({
      label: 'Confirmar',
      primary: true,
      onClick: async () => {
        try {
          const partialLines = Array.from(root.querySelectorAll('.opd-line-qty')).map(inp => {
            const lid = Number(inp.dataset.lid);
            const loteInp = root.querySelector(`.opd-line-lote[data-lid="${lid}"]`);
            return {
              id: lid,
              producto_id: Number(inp.dataset.pid),
              cantidad: Number(inp.value) || 0,
              lote: loteInp ? loteInp.value.trim() : undefined,
            };
          });
          const res = await api(`/api/operaciones-stock/${id}/confirmar`, {
            method: 'POST',
            body: { lineas: partialLines, generar_backorder: true },
          });
          if (res?.backorder_id) {
            toast(`Confirmado parcialmente. Se generó el Borrador #${res.backorder_id} por el saldo pendiente.`);
          } else {
            toast('Documento confirmado y stock actualizado');
          }
          await renderOperacionStockDetalleView({ id });
        } catch (err) { toast(err.message, true); }
      },
    });
    actions.push({
      label: 'Eliminar',
      className: 'btn btn-danger',
      onClick: async () => {
        if (!(await showConfirmModal('¿Eliminar este borrador?'))) return;
        try {
          await api(`/api/operaciones-stock/${id}`, { method: 'DELETE' });
          toast('Borrador eliminado');
          navigate('/operaciones-stock');
        } catch (err) { toast(err.message, true); }
      },
    });
  } else if (op.estado === 'Confirmado') {
    actions.push({
      label: 'Anular',
      onClick: async () => {
        if (!(await showConfirmModal('¿Anular este documento? Se generarán movimientos inversos para revertir el stock.'))) return;
        try {
          await api(`/api/operaciones-stock/${id}/anular`, { method: 'POST' });
          toast('Documento anulado');
          await renderOperacionStockDetalleView({ id });
        } catch (err) { toast(err.message, true); }
      },
    });
  }

  const smartButtons = [{ label: 'Ítems', count: lineas.length, icon: '📦' }];
  if (refLink) {
    smartButtons.push({ label: `${op.referencia_tipo} #${op.referencia_id}`, count: '↗', icon: '🔗', href: refLink });
  }

  mountDetailView(root, {
    breadcrumb: { label: 'Volver a Operaciones', href: '/operaciones-stock' },
    title: `${op.numero || '#' + op.id} — ${tipoLabel}`,
    subtitle: `${esc(op.origen_nombre || '-')} → ${esc(op.destino_nombre || '-')} · Fecha: ${esc(op.fecha || '-')}`,
    badge: {
      text: op.estado,
      className: op.estado === 'Confirmado' ? 'badge-ok' : op.estado === 'Anulado' ? 'badge-danger' : 'badge-muted',
    },
    actions,
    steps: [
      { key: 'Borrador', label: 'Borrador' },
      { key: 'Confirmado', label: 'Confirmado' },
      ...(op.estado === 'Anulado' ? [{ key: 'Anulado', label: 'Anulado' }] : []),
    ],
    currentStep: op.estado,
    smartButtons,
    kpis: [
      { label: 'Tipo', value: esc(tipoLabel) },
      { label: 'Fecha', value: esc(op.fecha || '-') },
      { label: 'Ítems', value: String(lineas.length) },
      { label: 'Total Unidades', value: fmtNum(totalUnidades) },
    ],
    tabs: [
      { id: 'items', label: 'Ítems', badge: lineas.length, html: itemsHtml },
      { id: 'datos', label: 'Datos y Envío', html: datosHtml },
    ],
    defaultTab: 'items',
    sidebarHtml: '<div id="opd-meta-panel"></div>',
    onMountSidebar: (sidebarEl) => {
      renderMetaPanel(sidebarEl.querySelector('#opd-meta-panel'), {
        entidadTipo: 'operacion_stock',
        entidadId: id,
        titulo: `Operación ${op.numero || '#' + id}`,
        record: op,
      });
    },
    onAfterMount: (container) => {
      container.querySelector('#btn-opd-save-envio')?.addEventListener('click', async () => {
        try {
          const envio = container.querySelector('#opd-envio')?.value || '';
          const codigo_seguimiento = container.querySelector('#opd-seg')?.value || '';
          await api(`/api/operaciones-stock/${id}`, {
            method: 'PATCH',
            body: { envio, codigo_seguimiento },
          });
          toast('Datos de envío y seguimiento guardados');
        } catch (err) { toast(err.message, true); }
      });
    },
  });
}
