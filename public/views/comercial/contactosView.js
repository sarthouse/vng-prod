import { api, toast } from '../../lib/api.js';
import { esc, fmtMoney, renderProvinciaOptions, exportRowsToCSV } from '../../lib/format.js';
import { navigate } from '../../router.js';
import { renderKpiStrip, renderFilterBar, renderDataTable } from '../../lib/engine/index.js';
import { printCuentaCorriente, buildCuentaCorrienteMovimientos } from '../../lib/cuentaCorrientePrint.js';
import { showConfirmModal } from '../../lib/engine/index.js';

export async function renderContactosView() {
  const root = document.getElementById('app-view');
  const contactos = await api('/api/contactos');
  let filterRole = 'all';
  let filterSaldo = '';
  let search = '';

  const getFiltered = () => {
    const q = search.trim().toLowerCase();
    return contactos.filter(c => {
      if (filterRole === 'prov' && !c.es_proveedor) return false;
      if (filterRole === 'taller' && !c.es_taller) return false;
      if (filterRole === 'cli' && !c.es_cliente) return false;
      if (filterSaldo === 'con_saldo' && Number(c.saldo_proveedor || 0) <= 0 && Number(c.saldo_cliente || 0) <= 0) return false;
      if (q) {
        const hay = `${c.nombre || ''} ${c.razon_social || ''} ${c.cuit || ''} ${c.localidad || ''} ${c.email || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  };

  root.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Contactos</h1>
        <p class="muted">Modelo unificado de clientes, proveedores y talleres.</p>
      </div>
      <div class="actions">
        <button type="button" id="btn-export-contactos" class="btn">Exportar CSV</button>
        <a href="/contactos/nuevo" data-link class="btn btn-primary">+ Nuevo Contacto</a>
      </div>
    </div>

    <div id="con-kpis"></div>

    <div class="card">
      <div id="con-filters"></div>
      <div id="con-table-wrap"></div>
    </div>
  `;

  const totalProvSaldo = contactos.reduce((s, c) => s + (c.es_proveedor ? Number(c.saldo_proveedor || 0) : 0), 0);
  const totalCliSaldo = contactos.reduce((s, c) => s + (c.es_cliente ? Number(c.saldo_cliente || 0) : 0), 0);
  renderKpiStrip(root.querySelector('#con-kpis'), [
    { label: 'Total Contactos', value: String(contactos.length) },
    { label: 'Clientes / Proveedores / Talleres', value: `${contactos.filter(c => c.es_cliente).length} / ${contactos.filter(c => c.es_proveedor).length} / ${contactos.filter(c => c.es_taller).length}` },
    { label: 'Saldo Proveedores', value: fmtMoney(totalProvSaldo), tone: totalProvSaldo > 0 ? 'accent' : 'default' },
    { label: 'Saldo Clientes', value: fmtMoney(totalCliSaldo), tone: totalCliSaldo > 0 ? 'success' : 'default' },
  ]);

  const drawTable = () => {
    const filtered = getFiltered();
    renderDataTable(root.querySelector('#con-table-wrap'), {
      rows: filtered,
      emptyText: 'No hay contactos para mostrar.',
      exportFilename: `contactos_${new Date().toISOString().slice(0, 10)}.csv`,
      bulkActions: [
        {
          id: 'eliminar',
          label: 'Eliminar seleccionados',
          variant: 'danger',
          confirm: (sel) => `¿Eliminar ${sel.length} contacto(s) seleccionado(s)?`,
          onClick: async (sel) => {
            let ok = 0; let errs = 0;
            for (const c of sel) {
              try { await api(`/api/contactos/${c.id}`, { method: 'DELETE' }); ok++; }
              catch { errs++; }
            }
            toast(`${ok} contacto(s) eliminado(s)${errs ? `, ${errs} con error` : ''}`, errs > 0 && ok === 0);
            await renderContactosView();
          },
        },
      ],
      columns: [
        {
          label: 'Nombre',
          render: c => `<a href="/contactos/${c.id}" data-link class="link-primary"><strong>${esc(c.nombre)}</strong></a>${c.razon_social ? `<div class="muted" style="font-size:11px;">${esc(c.razon_social)}</div>` : ''}`,
        },
        {
          label: 'Roles',
          render: c => `
            <div class="actions" style="gap:4px;">
              ${c.es_proveedor ? '<span class="badge badge-confirmado">Proveedor</span>' : ''}
              ${c.es_taller ? '<span class="badge badge-parcial">Taller</span>' : ''}
              ${c.es_cliente ? '<span class="badge badge-ok">Cliente</span>' : ''}
            </div>
          `,
        },
        { label: 'Documento', render: c => c.cuit ? `<span class="badge badge-muted">${esc(c.tipo_documento || 'CUIT')}</span> ${esc(c.cuit)}` : '-' },
        { label: 'Cond. IVA', render: c => esc(c.condicion_iva || '-') },
        { label: 'Teléfono / Email', render: c => esc(c.telefono || c.email || '-') },
        { label: 'Saldo Prov.', align: 'right', render: c => c.es_proveedor ? fmtMoney(c.saldo_proveedor) : '—' },
        { label: 'Saldo Cli.', align: 'right', render: c => c.es_cliente ? fmtMoney(c.saldo_cliente) : '—' },
        {
          label: 'Acciones',
          render: c => `
            <div class="actions">
              <button type="button" class="btn btn-sm" data-print-cc="${c.id}">Cta. Cte.</button>
              <a href="/contactos/${c.id}" data-link class="btn btn-sm">Editar</a>
              <button type="button" class="btn btn-sm btn-danger" data-del-con="${c.id}">Eliminar</button>
            </div>
          `,
        },
      ],
    });
    root.querySelectorAll('[data-print-cc]').forEach(btn => btn.addEventListener('click', async () => {
      try {
        const data = await api(`/api/contactos/${btn.dataset.printCc}`);
        await printCuentaCorriente(data);
      } catch (err) { toast(err.message, true); }
    }));
    root.querySelectorAll('[data-del-con]').forEach(btn => btn.addEventListener('click', async () => {
      if (!(await showConfirmModal('¿Eliminar este contacto?'))) return;
      try {
        await api(`/api/contactos/${btn.dataset.delCon}`, { method: 'DELETE' });
        toast('Contacto eliminado');
        await renderContactosView();
      } catch (err) { toast(err.message, true); }
    }));
  };

  root.querySelector('#btn-export-contactos').addEventListener('click', () => {
    const rows = getFiltered();
    if (!rows.length) { toast('No hay contactos para exportar', true); return; }
    exportRowsToCSV(
      ['nombre', 'razon_social', 'tipo_documento', 'cuit', 'condicion_iva', 'jurisdiccion_codigo', 'es_cliente', 'es_proveedor', 'es_taller', 'telefono', 'email', 'direccion', 'localidad', 'provincia', 'codigo_postal', 'observaciones', 'saldo_cliente', 'saldo_proveedor'],
      rows.map(c => [
        c.nombre, c.razon_social || '', c.tipo_documento || 'CUIT', c.cuit || '', c.condicion_iva || '',
        c.jurisdiccion_codigo || '', c.es_cliente ? 1 : 0, c.es_proveedor ? 1 : 0, c.es_taller ? 1 : 0,
        c.telefono || '', c.email || '', c.direccion || c.direccion_fiscal || '', c.localidad || '', c.provincia || '',
        c.codigo_postal || '', c.observaciones || '',
        Number(c.saldo_cliente || 0), Number(c.saldo_proveedor || 0),
      ]),
      `contactos_${new Date().toISOString().slice(0, 10)}.csv`
    );
  });

  renderFilterBar(root.querySelector('#con-filters'), {
    searchValue: search,
    searchPlaceholder: 'Buscar nombre, razón social, CUIT o localidad...',
    filters: [
      {
        name: 'rol',
        value: filterRole,
        options: [
          { value: 'all', label: `Todos los roles (${contactos.length})` },
          { value: 'cli', label: 'Clientes' },
          { value: 'prov', label: 'Proveedores' },
          { value: 'taller', label: 'Talleres' },
        ],
      },
      {
        name: 'saldo',
        value: filterSaldo,
        options: [
          { value: '', label: 'Todos los saldos' },
          { value: 'con_saldo', label: 'Con saldo pendiente' },
        ],
      },
    ],
    onChange: (st) => {
      search = st.search;
      filterRole = st.rol || 'all';
      filterSaldo = st.saldo || '';
      drawTable();
    },
  });

  drawTable();
}

export async function renderContactoFormView({ id } = {}) {
  const root = document.getElementById('app-view');
  const isEdit = Boolean(id);
  const [existing, terminosPago, metodosPago, listasPrecios] = await Promise.all([
    isEdit ? api(`/api/contactos/${id}`) : Promise.resolve(null),
    api('/api/terminos-pago?solo_activos=1').catch(() => []),
    api('/api/metodos-pago?solo_activos=1').catch(() => []),
    api('/api/listas-precios?solo_activos=1').catch(() => []),
  ]);
  const c = existing?.contacto || {
    nombre: '', razon_social: '', tipo_documento: 'CUIT', cuit: '', condicion_iva: 'Consumidor Final',
    direccion: '', direccion_fiscal: '', localidad: '', provincia: '', pais: 'Argentina',
    contacto_nombre: '', telefono: '', email: '', web: '',
    banco: '', cbu_cvu: '', alias: '', titular_cuenta: '',
    es_proveedor: 0, es_cliente: 1, es_taller: 0, observaciones: '',
  };

  root.innerHTML = `
    <div class="page-header">
      <div>
        <div style="margin-bottom:6px;"><a href="/contactos" data-link class="muted" style="font-size:0.85rem;">← Volver a Contactos</a></div>
        <h1>${isEdit ? esc(c.nombre) : 'Nuevo Contacto'}</h1>
      </div>
      ${isEdit ? `<div class="actions"><button type="button" id="btn-con-print-cc" class="btn">Imprimir Cta. Cte. / PDF</button></div>` : ''}
    </div>

    <form id="form-contacto" class="card">
      <div class="card-header"><h2>Datos del Contacto</h2></div>
      <div class="card-body">
        <div class="form-grid">
          <div class="full" style="display:flex;gap:16px;flex-wrap:wrap;padding:8px 12px;background:var(--color-bg);border-radius:8px;border:1px solid var(--color-border);">
            <label class="checkbox-field"><input type="checkbox" name="es_proveedor" ${c.es_proveedor ? 'checked' : ''} /> <strong>Es Proveedor</strong></label>
            <label class="checkbox-field"><input type="checkbox" name="es_taller" ${c.es_taller ? 'checked' : ''} /> <strong>Es Taller Productivo</strong></label>
            <label class="checkbox-field"><input type="checkbox" name="es_cliente" ${c.es_cliente ? 'checked' : ''} /> <strong>Es Cliente</strong></label>
          </div>
          <label><span>Nombre *</span><input type="text" name="nombre" required value="${esc(c.nombre)}" /></label>
          <label><span>Razón Social</span><input type="text" name="razon_social" value="${esc(c.razon_social || '')}" /></label>
          <label>
            <span>Tipo Documento</span>
            <select name="tipo_documento">
              ${['CUIT', 'CUIL', 'DNI', 'CDI', 'Pasaporte', 'Otro'].map(opt =>
                `<option value="${opt}" ${(c.tipo_documento || 'CUIT') === opt ? 'selected' : ''}>${opt}</option>`
              ).join('')}
            </select>
          </label>
          <label style="min-width:0;">
            <span>Nº Documento</span>
            <div style="display:flex;gap:6px;align-items:center;min-width:0;">
              <input type="text" name="cuit" value="${esc(c.cuit || '')}" style="flex:1;min-width:0;width:auto;" />
              <button type="button" class="btn btn-sm" id="btn-con-padron" title="Consultar datos fiscales en AFIP Padrón A5" style="flex-shrink:0;white-space:nowrap;">Padrón AFIP</button>
            </div>
          </label>
          <label>
            <span>Condición IVA</span>
            <select name="condicion_iva">
              ${['Consumidor Final', 'Responsable Inscripto', 'Monotributo', 'Exento'].map(opt =>
                `<option value="${opt}" ${c.condicion_iva === opt ? 'selected' : ''}>${opt}</option>`
              ).join('')}
            </select>
          </label>
          <label><span>Teléfono</span><input type="text" name="telefono" value="${esc(c.telefono || '')}" /></label>
          <label><span>Email</span><input type="email" name="email" value="${esc(c.email || '')}" /></label>
          <label><span>Dirección</span><input type="text" name="direccion" value="${esc(c.direccion || c.direccion_fiscal || '')}" /></label>
          <label><span>Localidad</span><input type="text" name="localidad" value="${esc(c.localidad || '')}" /></label>
          <label><span>Provincia</span><select name="provincia">${renderProvinciaOptions(c.provincia || '')}</select></label>
          <label><span>Código Postal (CP)</span><input type="text" name="codigo_postal" value="${esc(c.codigo_postal || '')}" /></label>
          <label><span>Banco</span><input type="text" name="banco" value="${esc(c.banco || '')}" /></label>
          <label><span>CBU / CVU</span><input type="text" name="cbu_cvu" value="${esc(c.cbu_cvu || '')}" /></label>
          <label><span>Alias</span><input type="text" name="alias" value="${esc(c.alias || '')}" /></label>
          <label>
            <span>Término de Pago (Ventas)</span>
            <select name="termino_pago_id">
              <option value="">-- Sin definir --</option>
              ${(terminosPago || []).map(t => `<option value="${t.id}" ${Number(c.termino_pago_id) === Number(t.id) ? 'selected' : ''}>${esc(t.nombre)} (${t.dias} días)</option>`).join('')}
            </select>
          </label>
          <label>
            <span>Término de Pago (Compras)</span>
            <select name="termino_pago_compra_id">
              <option value="">-- Igual a Ventas / Sin definir --</option>
              ${(terminosPago || []).map(t => `<option value="${t.id}" ${Number(c.termino_pago_compra_id) === Number(t.id) ? 'selected' : ''}>${esc(t.nombre)} (${t.dias} días)</option>`).join('')}
            </select>
          </label>
          <label>
            <span>Método de Pago Preferido</span>
            <select name="metodo_pago_id">
              <option value="">-- Sin definir --</option>
              ${(metodosPago || []).map(m => `<option value="${m.id}" ${Number(c.metodo_pago_id) === Number(m.id) ? 'selected' : ''}>${esc(m.nombre)}</option>`).join('')}
            </select>
          </label>
          <label>
            <span>Lista de Precios Asignada</span>
            <select name="lista_precio_id">
              <option value="">-- Lista por defecto --</option>
              ${(listasPrecios || []).map(l => `<option value="${l.id}" ${Number(c.lista_precio_id) === Number(l.id) ? 'selected' : ''}>${esc(l.nombre)}</option>`).join('')}
            </select>
          </label>
          <label><span>N.º Inscripción IIBB</span><input type="text" name="iibb_numero" value="${esc(c.iibb_numero || '')}" placeholder="Ej: 901-123456-7" /></label>
          <label>
            <span>Régimen IIBB</span>
            <select name="regimen_iibb">
              <option value="">-- Sin especificar --</option>
              ${[
                ['local', 'Contribuyente Local'],
                ['convenio_multilateral', 'Convenio Multilateral'],
                ['simplificado', 'Régimen Simplificado'],
                ['exento', 'Exento'],
              ].map(([val, lbl]) => `<option value="${val}" ${c.regimen_iibb === val ? 'selected' : ''}>${lbl}</option>`).join('')}
            </select>
          </label>
          <label><span>Límite de Crédito</span><input type="number" step="0.01" min="0" name="limite_credito" value="${Number(c.limite_credito || 0)}" /></label>
          <label><span>Vto. Certificado No Retención</span><input type="date" name="exento_retenciones_vto" value="${esc(c.exento_retenciones_vto || '')}" /></label>
          <label class="checkbox-inline" style="align-self:end;padding-bottom:6px;">
            <input type="checkbox" name="exento_retenciones" ${c.exento_retenciones ? 'checked' : ''} />
            <span>Exento de Retenciones</span>
          </label>
          <label class="full"><span>Observaciones</span><input type="text" name="observaciones" value="${esc(c.observaciones || '')}" /></label>
        </div>
        <div class="modal-footer">
          <a href="/contactos" data-link class="btn">Cancelar</a>
          <button type="submit" class="btn btn-primary">Guardar Contacto</button>
        </div>
      </div>
    </form>
    ${isEdit ? `<div id="con-cc-section" style="margin-top:16px;"></div><div id="con-imputaciones-section" style="margin-top:16px;"></div>` : ''}
  `;

  if (isEdit && existing) {
    root.querySelector('#btn-con-print-cc')?.addEventListener('click', async () => {
      try {
        await printCuentaCorriente(existing);
      } catch (err) { toast(err.message, true); }
    });

    const { movsCliente, movsProveedor } = buildCuentaCorrienteMovimientos(existing);
    const renderCcCard = (titulo, movs, saldo, saldoLabel) => `
      <div class="card" style="margin-bottom:14px;">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;">
          <h2 style="margin:0;">${esc(titulo)}</h2>
          <span class="badge ${saldo > 0 ? 'badge-parcial' : 'badge-ok'}">${esc(saldoLabel)}: <strong>${fmtMoney(saldo)}</strong></span>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Fecha</th><th>Comprobante</th><th>Número</th><th class="num">Debe</th><th class="num">Haber</th><th class="num">Saldo</th></tr></thead>
            <tbody>
              ${movs.length === 0
                ? '<tr><td colspan="6" class="muted" style="text-align:center;padding:14px;">Sin movimientos confirmados.</td></tr>'
                : movs.map(m => `
                    <tr>
                      <td>${esc(m.fecha)}</td>
                      <td>${esc(m.tipo)}</td>
                      <td><strong>${esc(m.numero)}</strong></td>
                      <td class="num">${m.debe > 0 ? fmtMoney(m.debe) : '—'}</td>
                      <td class="num">${m.haber > 0 ? fmtMoney(m.haber) : '—'}</td>
                      <td class="num"><strong>${fmtMoney(m.saldo)}</strong></td>
                    </tr>
                  `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    const ccHtml = [
      (c.es_cliente || movsCliente.length > 0) ? renderCcCard('Cuenta Corriente Cliente', movsCliente, existing.saldo_cliente || 0, 'Saldo a Cobrar') : '',
      (c.es_proveedor || c.es_taller || movsProveedor.length > 0) ? renderCcCard('Cuenta Corriente Proveedor', movsProveedor, existing.saldo_proveedor || 0, 'Saldo a Pagar') : '',
    ].filter(Boolean).join('');
    const ccBox = root.querySelector('#con-cc-section');
    if (ccBox) ccBox.innerHTML = ccHtml;

    const impBox = root.querySelector('#con-imputaciones-section');
    const renderImputacionesBox = async () => {
      if (!impBox) return;
      const dominios = [];
      if (c.es_cliente || movsCliente.length > 0) dominios.push({ dom: 'ventas', label: 'Imputación Ventas (Cobros / NC ↔ Facturas)' });
      if (c.es_proveedor || c.es_taller || movsProveedor.length > 0) dominios.push({ dom: 'compras', label: 'Imputación Compras (Pagos / NC ↔ Facturas)' });
      if (!dominios.length) return;

      const blocks = await Promise.all(dominios.map(async ({ dom, label }) => {
        const est = await api(`/api/tesoreria/imputaciones/estado-cuenta?contacto_id=${existing.id}&dominio=${dom}`);
        const facsPend = (est.facturas || []).filter(f => f.pendiente > 0.01);
        const compsDisp = (est.comprobantes || []).filter(cm => cm.disponible > 0.01);
        const imps = est.imputaciones || [];

        return `
          <div class="card" style="margin-bottom:14px;">
            <div class="card-header"><h2>${esc(label)}</h2></div>
            <form class="form-imputar-cc toolbar" data-dom="${dom}" style="gap:8px;flex-wrap:wrap;margin-bottom:12px;">
              <select name="comprobante" style="min-width:220px;" ${compsDisp.length ? '' : 'disabled'}>
                <option value="">${compsDisp.length ? '-- Elegir Cobro/Pago/NC con saldo --' : 'Sin comprobantes sin imputar'}</option>
                ${compsDisp.map(cm => `<option value="${esc(cm.comprobante_tipo)}:${cm.id}" data-disp="${cm.disponible}">${esc(cm.comprobante_tipo.toUpperCase())} ${esc(cm.numero || `#${cm.id}`)} · Disp: ${fmtMoney(cm.disponible)}</option>`).join('')}
              </select>
              <select name="factura_id" style="min-width:220px;" ${facsPend.length ? '' : 'disabled'}>
                <option value="">${facsPend.length ? '-- Elegir Factura pendiente --' : 'Sin facturas pendientes'}</option>
                ${facsPend.map(f => `<option value="${f.id}" data-pend="${f.pendiente}">${esc(f.numero || `#${f.id}`)} · Pend: ${fmtMoney(f.pendiente)}</option>`).join('')}
              </select>
              <input type="number" step="0.01" min="0.01" name="monto_imputado" placeholder="Monto a imputar" style="width:140px;" />
              <button type="submit" class="btn btn-primary" ${compsDisp.length && facsPend.length ? '' : 'disabled'}>Imputar</button>
            </form>
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>Fecha</th><th>Tipo</th><th>Comprobante ID</th><th>Factura</th><th class="num">Monto Imputado</th><th></th></tr></thead>
                <tbody>
                  ${imps.length ? imps.map(im => `
                    <tr>
                      <td>${esc(im.fecha)}</td>
                      <td><code>${esc(im.comprobante_tipo)}</code></td>
                      <td>#${im.comprobante_id}</td>
                      <td><strong>${esc(im.factura_numero || `#${im.factura_id}`)}</strong></td>
                      <td class="num"><strong>${fmtMoney(im.monto_imputado)}</strong></td>
                      <td><button type="button" class="btn btn-sm btn-danger btn-del-imp" data-id="${im.id}">Desimputar</button></td>
                    </tr>
                  `).join('') : '<tr><td colspan="6" class="muted" style="text-align:center;">Sin imputaciones registradas.</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>
        `;
      }));

      impBox.innerHTML = blocks.join('');
      impBox.querySelectorAll('.form-imputar-cc').forEach(form => {
        const compSel = form.querySelector('select[name="comprobante"]');
        const facSel = form.querySelector('select[name="factura_id"]');
        const montoIn = form.querySelector('input[name="monto_imputado"]');
        const autoFill = () => {
          const disp = Number(compSel?.selectedOptions[0]?.dataset?.disp || 0);
          const pend = Number(facSel?.selectedOptions[0]?.dataset?.pend || 0);
          if (disp > 0 && pend > 0) montoIn.value = Math.min(disp, pend).toFixed(2);
        };
        compSel?.addEventListener('change', autoFill);
        facSel?.addEventListener('change', autoFill);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(form);
          const compVal = String(fd.get('comprobante') || '');
          const [comprobante_tipo, comprobante_id] = compVal.split(':');
          try {
            await api('/api/tesoreria/imputaciones', {
              method: 'POST',
              body: JSON.stringify({
                dominio: form.dataset.dom,
                comprobante_tipo,
                comprobante_id: Number(comprobante_id),
                factura_id: Number(fd.get('factura_id')),
                monto_imputado: Number(fd.get('monto_imputado')),
              }),
            });
            toast('Imputación registrada');
            await renderImputacionesBox();
          } catch (err) { toast(err.message, true); }
        });
      });
      impBox.querySelectorAll('.btn-del-imp').forEach(btn => btn.addEventListener('click', async () => {
        try {
          await api(`/api/tesoreria/imputaciones/${btn.dataset.id}`, { method: 'DELETE' });
          toast('Imputación eliminada');
          await renderImputacionesBox();
        } catch (err) { toast(err.message, true); }
      }));
    };
    renderImputacionesBox();
  }

  root.querySelector('#btn-con-padron')?.addEventListener('click', async () => {
    const form = root.querySelector('#form-contacto');
    const cuitInput = form.querySelector('input[name="cuit"]');
    const digits = String(cuitInput?.value || '').replace(/\D/g, '');
    if (digits.length !== 11) {
      toast('Ingresá un CUIT de 11 dígitos para consultar el Padrón AFIP', true);
      return;
    }
    const btn = root.querySelector('#btn-con-padron');
    btn.disabled = true;
    btn.textContent = 'Consultando...';
    try {
      const p = await api(`/api/afip/padron/${digits}`);
      const setVal = (name, val) => {
        const el = form.querySelector(`[name="${name}"]`);
        if (el && val) el.value = val;
      };
      setVal('tipo_documento', 'CUIT');
      setVal('cuit', p.cuit);
      setVal('razon_social', p.razon_social);
      const nomEl = form.querySelector('input[name="nombre"]');
      if (nomEl && !nomEl.value.trim() && p.nombre) nomEl.value = p.nombre;
      setVal('condicion_iva', p.condicion_iva);
      setVal('direccion', p.direccion);
      setVal('localidad', p.localidad);
      if (p.codigo_postal) setVal('codigo_postal', p.codigo_postal);
      if (p.provincia) {
        const provSel = form.querySelector('select[name="provincia"]');
        if (provSel) {
          const match = Array.from(provSel.options).find(o => o.value.toLowerCase() === p.provincia.toLowerCase());
          if (match) provSel.value = match.value;
        }
      }
      toast(`Datos obtenidos de Padrón AFIP (${p.condicion_iva})`);
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Padrón AFIP';
    }
  });

  root.querySelector('#form-contacto').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      nombre: fd.get('nombre'),
      razon_social: fd.get('razon_social'),
      tipo_documento: fd.get('tipo_documento'),
      cuit: fd.get('cuit'),
      condicion_iva: fd.get('condicion_iva'),
      telefono: fd.get('telefono'),
      email: fd.get('email'),
      direccion: fd.get('direccion'),
      direccion_fiscal: fd.get('direccion'),
      localidad: fd.get('localidad'),
      provincia: fd.get('provincia'),
      codigo_postal: fd.get('codigo_postal') || '',
      banco: fd.get('banco'),
      cbu_cvu: fd.get('cbu_cvu'),
      alias: fd.get('alias'),
      termino_pago_id: fd.get('termino_pago_id') ? Number(fd.get('termino_pago_id')) : null,
      termino_pago_compra_id: fd.get('termino_pago_compra_id') ? Number(fd.get('termino_pago_compra_id')) : null,
      metodo_pago_id: fd.get('metodo_pago_id') ? Number(fd.get('metodo_pago_id')) : null,
      lista_precio_id: fd.get('lista_precio_id') ? Number(fd.get('lista_precio_id')) : null,
      iibb_numero: fd.get('iibb_numero') || '',
      regimen_iibb: fd.get('regimen_iibb') || '',
      limite_credito: Math.max(0, Number(fd.get('limite_credito')) || 0),
      exento_retenciones: fd.get('exento_retenciones') === 'on',
      exento_retenciones_vto: fd.get('exento_retenciones_vto') || '',
      observaciones: fd.get('observaciones'),
      es_proveedor: fd.get('es_proveedor') === 'on',
      es_taller: fd.get('es_taller') === 'on',
      es_cliente: fd.get('es_cliente') === 'on',
    };
    try {
      if (isEdit) {
        await api(`/api/contactos/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast('Contacto actualizado');
      } else {
        const res = await api('/api/contactos', { method: 'POST', body: JSON.stringify(payload) });
        toast('Contacto creado');
        navigate(`/contactos/${res.id}`);
        return;
      }
      navigate('/contactos');
    } catch (err) { toast(err.message, true); }
  });
}
