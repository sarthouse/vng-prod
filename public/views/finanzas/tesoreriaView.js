import { api, toast } from '../../lib/api.js';
import { esc, fmtMoney, fmtDate, renderPuntoVentaOptions, bindPuntoVentaSeq, getMetodosForCuenta } from '../../lib/format.js';
import { renderMetaPanel } from '../../lib/metaPanel.js';
import { printOrdenPago, printReciboCobro } from '../../lib/tesoreriaPrint.js';
import { navigate } from '../../router.js';
import {
  mountPageView,
  renderDataTable,
  showConfirmModal,
} from '../../lib/engine/index.js';

export async function renderTesoreriaView() {
  const root = document.getElementById('app-view');

  const loadAndRender = async () => {
    const [op, cuentas, cobros, pagos, cheques] = await Promise.all([
      api('/api/tesoreria/flujo-operativo').catch(() => ({})),
      api('/api/tesoreria/cuentas').catch(() => []),
      api('/api/tesoreria/cobros').catch(() => []),
      api('/api/tesoreria/pagos').catch(() => []),
      api('/api/tesoreria/cheques').catch(() => []),
    ]);

    const enCartera = cheques.filter(c => c.origen === 'terceros' && c.estado === 'En Cartera');

    const cuentasTabHtml = `
      <div class="card">
        <div class="card-header">
          <div>
            <h2>Cuentas de Tesorería</h2>
            <span class="muted" style="font-size:0.82rem;">Saldos actuales conciliados por partida doble.</span>
          </div>
          <a href="/tesoreria/cuentas" data-link class="btn btn-sm btn-primary">Gestionar Cuentas</a>
        </div>
        <div id="tes-cuentas-table"></div>
      </div>
    `;

    const cobrosTabHtml = `
      <div class="card">
        <div class="card-header">
          <div>
            <h2>Cobros</h2>
            <span class="muted" style="font-size:0.82rem;">Recibos de cobro a clientes e ingresos de tesorería.</span>
          </div>
          <a href="/tesoreria/cobros/nuevo" data-link class="btn btn-sm btn-primary">+ Nuevo Cobro</a>
        </div>
        <div id="tes-cobros-table"></div>
      </div>
      <div id="tes-cobro-meta"></div>
    `;

    const pagosTabHtml = `
      <div class="card">
        <div class="card-header">
          <div>
            <h2>Pagos</h2>
            <span class="muted" style="font-size:0.82rem;">Órdenes de pago a proveedores, talleres y gastos operativos.</span>
          </div>
          <a href="/tesoreria/pagos/nuevo" data-link class="btn btn-sm btn-primary">+ Nuevo Pago</a>
        </div>
        <div id="tes-pagos-table"></div>
      </div>
      <div id="tes-pago-meta"></div>
    `;

    mountPageView(root, {
      title: 'Tesorería',
      subtitle: 'Cuentas, recibos de cobro y órdenes de pago.',
      actions: [
        { label: 'Flujo de Caja', href: '/tesoreria/flujo-caja' },
        { label: `Cheques (${enCartera.length})`, href: '/tesoreria/cheques' },
        { label: 'Cuentas', href: '/tesoreria/cuentas' },
        { label: '+ Nuevo Pago', href: '/tesoreria/pagos/nuevo' },
        { label: '+ Nuevo Cobro', href: '/tesoreria/cobros/nuevo', primary: true },
      ],
      kpis: [
        { label: 'Caja Disponible', value: fmtMoney(op.caja_disponible ?? 0), tone: 'ok', href: '/tesoreria/cuentas' },
        { label: 'Por Cobrar', value: fmtMoney(op.cuentas_por_cobrar ?? 0), href: '/ventas' },
        { label: 'Por Pagar', value: fmtMoney(op.cuentas_por_pagar ?? 0), tone: (op.cuentas_por_pagar ?? 0) > 0 ? 'danger' : 'default', href: '/compras' },
        { label: 'Posición Neta', value: fmtMoney(op.posicion_neta_proyectada ?? 0), href: '/tesoreria/flujo-caja' },
        { label: 'Cheques en Cartera', value: fmtMoney(enCartera.reduce((s, c) => s + Number(c.monto || 0), 0)), hint: `${enCartera.length} cheque(s)`, href: '/tesoreria/cheques' },
      ],
      tabs: [
        {
          id: 'cuentas',
          label: 'Cuentas',
          badge: cuentas.length,
          html: cuentasTabHtml,
          onMount: (panelEl) => {
            renderDataTable(panelEl.querySelector('#tes-cuentas-table'), {
              rows: cuentas,
              selectable: false,
              emptyText: 'No hay cuentas de tesorería configuradas.',
              columns: [
                { label: 'Cuenta', render: c => `<strong>${esc(c.nombre)}</strong>` },
                { label: 'Tipo', render: c => `<span class="badge badge-muted">${esc(c.tipo)}</span>` },
                { label: 'Moneda', render: c => esc(c.moneda || 'ARS') },
                { label: 'Cuenta Contable', render: c => esc(c.plan_cuenta_codigo ? `${c.plan_cuenta_codigo} — ${c.plan_cuenta_nombre}` : '-') },
                {
                  label: 'Saldo Actual',
                  align: 'right',
                  render: c => `<strong style="color:${Number(c.saldo_actual) >= 0 ? 'var(--color-primary)' : 'var(--color-accent)'};">${fmtMoney(c.saldo_actual)}</strong>`,
                  sum: rows => `<strong>${fmtMoney(rows.reduce((s, r) => s + (Number(r.saldo_actual) || 0), 0))}</strong>`,
                },
                {
                  label: 'Estado',
                  render: c => `<span class="badge ${c.activa !== 0 ? 'badge-ok' : 'badge-muted'}">${c.activa !== 0 ? 'Activa' : 'Inactiva'}</span>`,
                },
              ],
            });
          },
        },
        {
          id: 'cobros',
          label: 'Cobros',
          badge: cobros.length,
          html: cobrosTabHtml,
          onMount: (panelEl) => {
            renderDataTable(panelEl.querySelector('#tes-cobros-table'), {
              rows: cobros,
              emptyText: 'Sin cobros registrados.',
              exportFilename: `cobros_${new Date().toISOString().slice(0, 10)}.csv`,
              columns: [
                { label: 'Fecha', render: c => esc(c.fecha) },
                { label: 'Comprobante', render: c => `<strong>${esc(c.numero || '#' + c.id)}</strong>` },
                { label: 'Cuenta', render: c => esc(c.cuenta_nombre || '-') },
                {
                  label: 'Cliente / Contraparte',
                  render: c => c.cliente_id
                    ? `<a href="/contactos/${c.cliente_id}" data-link class="link-primary">${esc(c.cliente_nombre || '-')}</a>`
                    : esc(c.proveedor_nombre || '-'),
                },
                { label: 'Concepto', render: c => esc(c.concepto || '-') },
                { label: 'Método', render: c => esc(c.metodo) },
                {
                  label: 'Monto',
                  align: 'right',
                  render: c => `<strong style="color:#15803d;">${fmtMoney(c.monto)}</strong>`,
                  sum: rows => `<strong>${fmtMoney(rows.reduce((s, r) => s + (Number(r.monto) || 0), 0))}</strong>`,
                },
                {
                  label: 'Acciones',
                  render: c => `
                    <div class="actions">
                      <button type="button" class="btn btn-sm" data-print-cobro="${c.id}">PDF</button>
                      <button type="button" class="btn btn-sm" data-meta-cobro="${c.id}">Notas</button>
                      <button type="button" class="btn btn-sm btn-danger" data-del-cobro="${c.id}">Eliminar</button>
                    </div>
                  `,
                },
              ],
            });

            panelEl.querySelectorAll('[data-print-cobro]').forEach(btn => btn.addEventListener('click', async () => {
              try {
                const data = await api(`/api/tesoreria/cobros/${btn.dataset.printCobro}`);
                await printReciboCobro({ cobro: data.cobro || {}, lineas: data.lineas || [] });
              } catch (err) { toast(err.message, true); }
            }));

            panelEl.querySelectorAll('[data-meta-cobro]').forEach(btn => btn.addEventListener('click', () => {
              const c = cobros.find(x => String(x.id) === String(btn.dataset.metaCobro));
              const metaEl = panelEl.querySelector('#tes-cobro-meta');
              renderMetaPanel(metaEl, {
                entidadTipo: 'cobro',
                entidadId: btn.dataset.metaCobro,
                titulo: `Cobro ${c?.numero || '#' + btn.dataset.metaCobro}`,
                record: c || null,
                onClose: () => {},
              });
              metaEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }));

            panelEl.querySelectorAll('[data-del-cobro]').forEach(btn => btn.addEventListener('click', async () => {
              if (!(await showConfirmModal('¿Eliminar este cobro?'))) return;
              try {
                await api(`/api/tesoreria/cobros/${btn.dataset.delCobro}`, { method: 'DELETE' });
                toast('Cobro eliminado');
                await loadAndRender();
              } catch (err) { toast(err.message, true); }
            }));
          },
        },
        {
          id: 'pagos',
          label: 'Órdenes de Pago',
          badge: pagos.length,
          html: pagosTabHtml,
          onMount: (panelEl) => {
            renderDataTable(panelEl.querySelector('#tes-pagos-table'), {
              rows: pagos,
              emptyText: 'Sin pagos registrados.',
              exportFilename: `pagos_${new Date().toISOString().slice(0, 10)}.csv`,
              columns: [
                { label: 'Fecha', render: p => esc(p.fecha) },
                { label: 'Comprobante', render: p => `<strong>${esc(p.numero || '#' + p.id)}</strong>` },
                { label: 'Cuenta', render: p => esc(p.cuenta_nombre || '-') },
                {
                  label: 'Proveedor / Categoría',
                  render: p => p.proveedor_id
                    ? `<a href="/contactos/${p.proveedor_id}" data-link class="link-primary">${esc(p.proveedor_nombre || '-')}</a>`
                    : esc(p.categoria_gasto || '-'),
                },
                { label: 'Concepto', render: p => esc(p.concepto || '-') },
                { label: 'Método', render: p => esc(p.metodo) },
                {
                  label: 'Monto',
                  align: 'right',
                  render: p => `<strong style="color:var(--color-accent);">${fmtMoney(p.monto)}</strong>`,
                  sum: rows => `<strong>${fmtMoney(rows.reduce((s, r) => s + (Number(r.monto) || 0), 0))}</strong>`,
                },
                {
                  label: 'Acciones',
                  render: p => `
                    <div class="actions">
                      <button type="button" class="btn btn-sm" data-print-pago="${p.id}">PDF</button>
                      <button type="button" class="btn btn-sm" data-meta-pago="${p.id}">Notas</button>
                      <button type="button" class="btn btn-sm btn-danger" data-del-pago="${p.id}">Eliminar</button>
                    </div>
                  `,
                },
              ],
            });

            panelEl.querySelectorAll('[data-print-pago]').forEach(btn => btn.addEventListener('click', async () => {
              try {
                const data = await api(`/api/tesoreria/pagos/${btn.dataset.printPago}`);
                await printOrdenPago({ pago: data.pago || {}, lineas: data.lineas || [] });
              } catch (err) { toast(err.message, true); }
            }));

            panelEl.querySelectorAll('[data-meta-pago]').forEach(btn => btn.addEventListener('click', () => {
              const p = pagos.find(x => String(x.id) === String(btn.dataset.metaPago));
              const metaEl = panelEl.querySelector('#tes-pago-meta');
              renderMetaPanel(metaEl, {
                entidadTipo: 'pago',
                entidadId: btn.dataset.metaPago,
                titulo: `Pago ${p?.numero || '#' + btn.dataset.metaPago}`,
                record: p || null,
                onClose: () => {},
              });
              metaEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }));

            panelEl.querySelectorAll('[data-del-pago]').forEach(btn => btn.addEventListener('click', async () => {
              if (!(await showConfirmModal('¿Eliminar este pago?'))) return;
              try {
                await api(`/api/tesoreria/pagos/${btn.dataset.delPago}`, { method: 'DELETE' });
                toast('Pago eliminado');
                await loadAndRender();
              } catch (err) { toast(err.message, true); }
            }));
          },
        },
      ],
    });
  };

  await loadAndRender();
}

function mountMediosLines(container, cuentas, initialLines, { mode = 'cobro', chequesEnCartera = [] } = {}) {
  const firstCta = cuentas[0];
  const firstMetodo = getMetodosForCuenta(firstCta)[0];
  const hoy = new Date().toISOString().slice(0, 10);
  const newDefaultLine = () => ({
    cuenta_id: firstCta?.id ? String(firstCta.id) : '',
    metodo: firstMetodo,
    referencia: '',
    monto: '',
    cheque_id: '',
    ch_numero: '',
    ch_banco: '',
    ch_modalidad: 'diferido',
    ch_fecha_pago: hoy,
    ch_librador: '',
    ch_cuit: '',
    ch_echeq: false,
  });

  let lineas = initialLines && initialLines.length
    ? initialLines.map(l => ({ ...newDefaultLine(), ...l }))
    : [newDefaultLine()];

  const drawMedios = () => {
    const total = lineas.reduce((s, l) => s + (Number(l.monto) || 0), 0);
    container.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Cuenta / Origen *</th><th>Método</th><th>Referencia</th><th class="num" style="width:130px;">Monto *</th><th style="width:50px;"></th></tr></thead>
          <tbody>
            ${lineas.map((l, idx) => {
              const isCartera = mode === 'cobro' && l.cuenta_id === '__CARTERA__';
              const isEndoso = mode === 'pago' && l.cuenta_id === '__ENDOSO__';
              const ctaObj = (!isCartera && !isEndoso) ? cuentas.find(c => String(c.id) === String(l.cuenta_id)) : null;
              const allowed = isCartera ? ['Cheque'] : isEndoso ? ['Endoso Cheque'] : getMetodosForCuenta(ctaObj);
              if (!allowed.includes(l.metodo)) l.metodo = allowed[0];
              const showChequeForm = l.metodo === 'Cheque';
              return `
              <tr>
                <td>
                  <select class="ml-cta" data-idx="${idx}" required>
                    ${cuentas.map(c => `<option value="${c.id}" ${String(l.cuenta_id) === String(c.id) ? 'selected' : ''}>${esc(c.nombre)} (${fmtMoney(c.saldo_actual)})</option>`).join('')}
                    ${mode === 'cobro' ? `<option value="__CARTERA__" ${isCartera ? 'selected' : ''}>Cartera de Cheques (Terceros)</option>` : ''}
                    ${mode === 'pago' && chequesEnCartera.length > 0 ? `<option value="__ENDOSO__" ${isEndoso ? 'selected' : ''}>Endosar Cheque de Tercero (${chequesEnCartera.length})</option>` : ''}
                  </select>
                </td>
                <td>
                  <select class="ml-met" data-idx="${idx}">
                    ${allowed.map(m => `<option value="${m}" ${l.metodo === m ? 'selected' : ''}>${m}</option>`).join('')}
                  </select>
                </td>
                <td><input type="text" class="ml-ref" data-idx="${idx}" value="${esc(l.referencia || '')}" placeholder="Nro cheque / ref..." /></td>
                <td><input type="number" step="0.01" min="0.01" class="ml-monto num" data-idx="${idx}" value="${l.monto}" ${isEndoso ? 'readonly' : ''} required placeholder="0.00" /></td>
                <td>${lineas.length > 1 ? `<button type="button" class="btn btn-sm btn-danger ml-del" data-idx="${idx}">×</button>` : ''}</td>
              </tr>
              ${showChequeForm ? `
                <tr style="background:rgba(15,23,42,0.03);">
                  <td colspan="5">
                    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:4px 0;">
                      <input type="text" class="ml-ch-num" data-idx="${idx}" value="${esc(l.ch_numero || '')}" placeholder="N° Cheque *" required style="width:130px;" />
                      ${mode === 'cobro' ? `<input type="text" class="ml-ch-banco" data-idx="${idx}" value="${esc(l.ch_banco || '')}" placeholder="Banco emisor" style="width:140px;" />` : ''}
                      <select class="ml-ch-mod" data-idx="${idx}" style="width:120px;">
                        <option value="diferido" ${l.ch_modalidad === 'diferido' ? 'selected' : ''}>Diferido</option>
                        <option value="comun" ${l.ch_modalidad === 'comun' ? 'selected' : ''}>Común</option>
                      </select>
                      <label style="display:flex;align-items:center;gap:4px;font-size:0.8rem;">
                        <span>Vto:</span>
                        <input type="date" class="ml-ch-fpago" data-idx="${idx}" value="${esc(l.ch_fecha_pago || hoy)}" required />
                      </label>
                      ${mode === 'cobro' ? `
                        <input type="text" class="ml-ch-lib" data-idx="${idx}" value="${esc(l.ch_librador || '')}" placeholder="Librador" style="width:140px;" />
                        <input type="text" class="ml-ch-cuit" data-idx="${idx}" value="${esc(l.ch_cuit || '')}" placeholder="CUIT librador" style="width:120px;" />
                      ` : ''}
                      <label style="display:flex;align-items:center;gap:4px;font-size:0.82rem;cursor:pointer;">
                        <input type="checkbox" class="ml-ch-echeq" data-idx="${idx}" ${l.ch_echeq ? 'checked' : ''} />
                        <span>E-Cheq</span>
                      </label>
                    </div>
                  </td>
                </tr>
              ` : ''}
              ${isEndoso ? `
                <tr style="background:rgba(15,23,42,0.03);">
                  <td colspan="5">
                    <div style="display:flex;gap:8px;align-items:center;padding:4px 0;">
                      <span style="font-size:0.82rem;font-weight:600;">Cheque a endosar:</span>
                      <select class="ml-ch-endoso" data-idx="${idx}" required style="flex:1;">
                        <option value="">-- Seleccionar cheque en cartera --</option>
                        ${chequesEnCartera.map(ch => `<option value="${ch.id}" ${String(l.cheque_id) === String(ch.id) ? 'selected' : ''}>N° ${esc(ch.numero)} · ${esc(ch.banco || 'Sin banco')} · Vto ${esc(ch.fecha_pago)} · ${fmtMoney(ch.monto)}</option>`).join('')}
                      </select>
                    </div>
                  </td>
                </tr>
              ` : ''}
            `;
            }).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3"><button type="button" class="btn btn-sm ml-add">+ Agregar medio</button></td>
              <td class="num"><strong class="ml-total">${fmtMoney(total)}</strong></td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
    container.querySelectorAll('.ml-cta').forEach(el => el.addEventListener('change', () => {
      const idx = Number(el.dataset.idx);
      lineas[idx].cuenta_id = el.value;
      if (el.value === '__CARTERA__') {
        lineas[idx].metodo = 'Cheque';
      } else if (el.value === '__ENDOSO__') {
        lineas[idx].metodo = 'Endoso Cheque';
      } else {
        const ctaObj = cuentas.find(c => String(c.id) === String(el.value));
        const allowed = getMetodosForCuenta(ctaObj);
        if (!allowed.includes(lineas[idx].metodo)) lineas[idx].metodo = allowed[0];
      }
      drawMedios();
    }));
    container.querySelectorAll('.ml-met').forEach(el => el.addEventListener('change', () => {
      lineas[Number(el.dataset.idx)].metodo = el.value;
      drawMedios();
    }));
    container.querySelectorAll('.ml-ref').forEach(el => el.addEventListener('input', () => { lineas[Number(el.dataset.idx)].referencia = el.value; }));
    container.querySelectorAll('.ml-monto').forEach(el => el.addEventListener('input', () => {
      lineas[Number(el.dataset.idx)].monto = el.value;
      const t = lineas.reduce((s, l) => s + (Number(l.monto) || 0), 0);
      const tEl = container.querySelector('.ml-total');
      if (tEl) tEl.textContent = fmtMoney(t);
    }));
    container.querySelectorAll('.ml-ch-num').forEach(el => el.addEventListener('input', () => { lineas[Number(el.dataset.idx)].ch_numero = el.value; }));
    container.querySelectorAll('.ml-ch-banco').forEach(el => el.addEventListener('input', () => { lineas[Number(el.dataset.idx)].ch_banco = el.value; }));
    container.querySelectorAll('.ml-ch-mod').forEach(el => el.addEventListener('change', () => { lineas[Number(el.dataset.idx)].ch_modalidad = el.value; }));
    container.querySelectorAll('.ml-ch-fpago').forEach(el => el.addEventListener('change', () => { lineas[Number(el.dataset.idx)].ch_fecha_pago = el.value; }));
    container.querySelectorAll('.ml-ch-lib').forEach(el => el.addEventListener('input', () => { lineas[Number(el.dataset.idx)].ch_librador = el.value; }));
    container.querySelectorAll('.ml-ch-cuit').forEach(el => el.addEventListener('input', () => { lineas[Number(el.dataset.idx)].ch_cuit = el.value; }));
    container.querySelectorAll('.ml-ch-echeq').forEach(el => el.addEventListener('change', () => { lineas[Number(el.dataset.idx)].ch_echeq = el.checked; }));
    container.querySelectorAll('.ml-ch-endoso').forEach(el => el.addEventListener('change', () => {
      const idx = Number(el.dataset.idx);
      const ch = chequesEnCartera.find(x => String(x.id) === String(el.value));
      lineas[idx].cheque_id = el.value;
      if (ch) {
        lineas[idx].monto = String(ch.monto);
        lineas[idx].referencia = `Endoso Ch. ${ch.numero}`;
      } else {
        lineas[idx].monto = '';
      }
      drawMedios();
    }));
    container.querySelector('.ml-add')?.addEventListener('click', () => {
      lineas.push(newDefaultLine());
      drawMedios();
    });
    container.querySelectorAll('.ml-del').forEach(btn => btn.addEventListener('click', () => {
      lineas.splice(Number(btn.dataset.idx), 1);
      drawMedios();
    }));
  };
  drawMedios();
  return () => lineas.map(l => {
    const isEndoso = mode === 'pago' && l.cuenta_id === '__ENDOSO__';
    const isCartera = mode === 'cobro' && l.cuenta_id === '__CARTERA__';
    const base = {
      cuenta_id: (isEndoso || isCartera || !l.cuenta_id) ? null : Number(l.cuenta_id),
      metodo: isEndoso ? 'Endoso Cheque' : l.metodo,
      referencia: l.referencia,
      monto: Number(l.monto) || 0,
    };
    if (isEndoso && l.cheque_id) {
      base.cheque_id = Number(l.cheque_id);
    } else if (l.metodo === 'Cheque' && l.ch_numero) {
      base.cheque = {
        numero: l.ch_numero.trim(),
        banco: (l.ch_banco || '').trim(),
        modalidad: l.ch_modalidad || 'diferido',
        fecha_pago: l.ch_fecha_pago || hoy,
        librador_nombre: (l.ch_librador || '').trim(),
        cuit_librador: (l.ch_cuit || '').trim(),
        echeq: !!l.ch_echeq,
      };
    }
    return base;
  }).filter(l => l.monto > 0);
}

export async function renderPagosView() {
  const root = document.getElementById('app-view');
  const pagos = await api('/api/tesoreria/pagos');

  mountPageView(root, {
    breadcrumb: { label: 'Tesorería', href: '/tesoreria' },
    title: 'Órdenes de Pago',
    subtitle: 'Historial de pagos a proveedores, talleres y gastos operativos.',
    actions: [
      { label: '+ Nuevo Pago', href: '/tesoreria/pagos/nuevo', primary: true },
    ],
    bodyHtml: `
      <div class="card">
        <div class="card-header"><h2>Historial de Pagos</h2></div>
        <div id="pagos-table-wrap"></div>
      </div>
      <div id="pago-meta-panel"></div>
    `,
    onAfterMount: () => {
      renderDataTable(root.querySelector('#pagos-table-wrap'), {
        rows: pagos,
        emptyText: 'Sin pagos registrados.',
        exportFilename: `pagos_${new Date().toISOString().slice(0, 10)}.csv`,
        bulkActions: [
          {
            id: 'eliminar',
            label: 'Eliminar seleccionados',
            variant: 'danger',
            confirm: (sel) => `¿Eliminar ${sel.length} pago(s) seleccionado(s)?`,
            onClick: async (sel) => {
              let ok = 0; let errs = 0;
              for (const p of sel) {
                try { await api(`/api/tesoreria/pagos/${p.id}`, { method: 'DELETE' }); ok++; }
                catch { errs++; }
              }
              toast(`${ok} pago(s) eliminado(s)${errs ? `, ${errs} con error` : ''}`, errs > 0 && ok === 0);
              await renderPagosView();
            },
          },
        ],
        columns: [
          { label: 'Fecha', render: p => esc(p.fecha) },
          { label: 'Comprobante', render: p => `<strong>${esc(p.numero || '#' + p.id)}</strong>` },
          { label: 'Cuenta', render: p => esc(p.cuenta_nombre || '-') },
          { label: 'Proveedor / Categoría', render: p => p.proveedor_id ? `<a href="/contactos/${p.proveedor_id}" data-link class="link-primary">${esc(p.proveedor_nombre || '-')}</a>` : esc(p.categoria_gasto || '-') },
          { label: 'Método', render: p => esc(p.metodo) },
          { label: 'Monto', align: 'right', render: p => `<strong>${fmtMoney(p.monto)}</strong>` },
          {
            label: 'Acciones',
            render: p => `
              <div class="actions">
                <button type="button" class="btn btn-sm" data-print-pago="${p.id}">PDF</button>
                <button type="button" class="btn btn-sm" data-meta-pago="${p.id}">Notas / Adj.</button>
                <button type="button" class="btn btn-sm btn-danger" data-del-pago="${p.id}">Eliminar</button>
              </div>
            `,
          },
        ],
      });

      root.querySelectorAll('[data-print-pago]').forEach(btn => btn.addEventListener('click', async () => {
        try {
          const data = await api(`/api/tesoreria/pagos/${btn.dataset.printPago}`);
          await printOrdenPago({ pago: data.pago || {}, lineas: data.lineas || [] });
        } catch (err) { toast(err.message, true); }
      }));

      root.querySelectorAll('[data-meta-pago]').forEach(btn => btn.addEventListener('click', () => {
        const p = pagos.find(x => String(x.id) === String(btn.dataset.metaPago));
        const panel = root.querySelector('#pago-meta-panel');
        renderMetaPanel(panel, {
          entidadTipo: 'pago',
          entidadId: btn.dataset.metaPago,
          titulo: `Pago ${p?.numero || '#' + btn.dataset.metaPago}`,
          record: p || null,
          onClose: () => {},
        });
        panel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }));

      root.querySelectorAll('[data-del-pago]').forEach(btn => btn.addEventListener('click', async () => {
        if (!(await showConfirmModal('¿Eliminar este pago?'))) return;
        try {
          await api(`/api/tesoreria/pagos/${btn.dataset.delPago}`, { method: 'DELETE' });
          toast('Pago eliminado');
          await renderPagosView();
        } catch (err) { toast(err.message, true); }
      }));
    },
  });
}

export async function renderPagoFormView() {
  const root = document.getElementById('app-view');
  const [cuentas, proveedores, puntosVenta, nextPagoSeq, planCuentas, chequesEnCartera, retencionesConfig] = await Promise.all([
    api('/api/tesoreria/cuentas'),
    api('/api/contactos?es_proveedor=1'),
    api('/api/puntos-venta'),
    api('/api/secuencias/siguiente?tipo=pago'),
    api('/api/tesoreria/plan-cuentas').catch(() => []),
    api('/api/tesoreria/cheques?origen=terceros&estado=En+Cartera').catch(() => []),
    api('/api/impuestos?tipo=retencion').catch(() => []),
  ]);
  const cuentasEgreso = planCuentas.filter(pc => pc.activo !== 0 && pc.imputable !== 0 && pc.tipo === 'egreso');

  mountPageView(root, {
    breadcrumb: { label: 'Volver a Pagos', href: '/tesoreria/pagos' },
    title: 'Nuevo Pago',
    subtitle: 'Registrar orden de pago a proveedor o gasto operativo.',
    bodyHtml: `
      <div class="card">
        <form id="form-nuevo-pago" class="form-grid">
          <label><span>Fecha *</span><input type="date" name="fecha" required value="${new Date().toISOString().slice(0, 10)}" /></label>
          <label>
            <span>Proveedor / Taller</span>
            <select name="proveedor_id">
              <option value="">-- Gasto operativo / Sin proveedor --</option>
              ${proveedores.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}
            </select>
          </label>
          <label><span>Categoría</span><input type="text" name="categoria_gasto" value="Proveedores" /></label>
          <label>
            <span>Cuenta Contable (Gasto)</span>
            <select name="plan_cuenta_id">
              <option value="">-- Automática --</option>
              ${cuentasEgreso.map(pc => `<option value="${pc.id}">${esc(pc.codigo)} — ${esc(pc.nombre)}</option>`).join('')}
            </select>
          </label>
          <label>
            <span>Punto de Venta</span>
            <select name="punto_venta" id="pag-pv">${renderPuntoVentaOptions(puntosVenta, nextPagoSeq?.punto_venta)}</select>
          </label>
          <label><span>Comprobante</span><input type="text" name="numero" id="pag-num" value="${esc(nextPagoSeq?.numero || '')}" /></label>
          <label class="full"><span>Concepto</span><input type="text" name="concepto" placeholder="Detalle del pago..." /></label>
          <div class="full" id="pag-medios-box"></div>
          <div class="full" id="pag-imputar-box"></div>
          <div class="full card" style="margin:6px 0;padding:12px;background:var(--bg-soft, #f8fafc);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <strong>Retenciones Practicadas (Opcional)</strong>
              <button type="button" class="btn btn-sm" id="btn-add-retencion">+ Agregar Retención</button>
            </div>
            <div id="pag-retenciones-list" style="display:flex;flex-direction:column;gap:8px;"></div>
          </div>
          <div class="full modal-footer">
            <a href="/tesoreria/pagos" data-link class="btn">Cancelar</a>
            <button type="submit" class="btn btn-primary">Registrar Pago</button>
          </div>
        </form>
      </div>
    `,
    onAfterMount: () => {
      const getPagoLineas = mountMediosLines(root.querySelector('#pag-medios-box'), cuentas, null, { mode: 'pago', chequesEnCartera });
      bindPuntoVentaSeq(root.querySelector('#pag-pv'), root.querySelector('#pag-num'), 'pago', api);
      const getPagoImputaciones = mountFacturasImputarBox(
        root.querySelector('#pag-imputar-box'),
        root.querySelector('#form-nuevo-pago select[name="proveedor_id"]'),
        'compras',
      );

      const retListEl = root.querySelector('#pag-retenciones-list');
      const activeRets = (retencionesConfig || []).filter(r => r.activo !== 0);
      root.querySelector('#btn-add-retencion')?.addEventListener('click', () => {
        const row = document.createElement('div');
        row.className = 'ret-row';
        row.style.cssText = 'display:grid;grid-template-columns:2fr 1fr 1fr 1fr auto;gap:8px;align-items:center;';
        row.innerHTML = `
          <select class="ret-imp">
            <option value="">-- Retención --</option>
            ${activeRets.map(r => `<option value="${r.id}" data-alic="${Number(r.alicuota_defecto || 0)}" data-nombre="${esc(r.nombre)}">${esc(r.nombre)} (${Number(r.alicuota_defecto || 0)}%)</option>`).join('')}
          </select>
          <input type="number" step="0.01" min="0" class="ret-base" placeholder="Base Imp." />
          <input type="number" step="0.01" min="0" class="ret-alic" placeholder="Alíc %" />
          <input type="number" step="0.01" min="0" class="ret-monto" placeholder="Monto Ret." />
          <button type="button" class="btn btn-sm btn-danger ret-del">✕</button>
        `;
        const sel = row.querySelector('.ret-imp');
        const baseIn = row.querySelector('.ret-base');
        const alicIn = row.querySelector('.ret-alic');
        const montoIn = row.querySelector('.ret-monto');
        const recalc = () => {
          const b = Number(baseIn.value) || 0;
          const a = Number(alicIn.value) || 0;
          if (b > 0 && a > 0) montoIn.value = ((b * a) / 100).toFixed(2);
        };
        sel.addEventListener('change', () => {
          const opt = sel.selectedOptions[0];
          if (opt?.dataset?.alic) alicIn.value = opt.dataset.alic;
          recalc();
        });
        baseIn.addEventListener('input', recalc);
        alicIn.addEventListener('input', recalc);
        row.querySelector('.ret-del').addEventListener('click', () => row.remove());
        retListEl.appendChild(row);
      });

      root.querySelector('#form-nuevo-pago').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const lineas = getPagoLineas();
        if (!lineas.length) { toast('Ingresá al menos un medio de pago válido', true); return; }
        const retenciones = Array.from(retListEl.querySelectorAll('.ret-row')).map(row => {
          const sel = row.querySelector('.ret-imp');
          const opt = sel.selectedOptions[0];
          return {
            impuesto_id: sel.value ? Number(sel.value) : null,
            nombre: opt?.dataset?.nombre || 'Retención',
            base_imponible: Number(row.querySelector('.ret-base').value) || 0,
            alicuota: Number(row.querySelector('.ret-alic').value) || 0,
            monto: Number(row.querySelector('.ret-monto').value) || 0,
          };
        }).filter(r => r.monto > 0);
        try {
          await api('/api/tesoreria/pagos', {
            method: 'POST',
            body: {
              fecha: fd.get('fecha'),
              proveedor_id: fd.get('proveedor_id') ? Number(fd.get('proveedor_id')) : null,
              plan_cuenta_id: fd.get('plan_cuenta_id') ? Number(fd.get('plan_cuenta_id')) : null,
              categoria_gasto: fd.get('categoria_gasto'),
              numero: fd.get('numero'),
              concepto: fd.get('concepto'),
              lineas,
              retenciones,
              imputaciones: getPagoImputaciones(),
            },
          });
          toast('Pago registrado');
          navigate('/tesoreria');
        } catch (err) { toast(err.message, true); }
      });
    },
  });
}

export async function renderCobrosView() {
  const root = document.getElementById('app-view');
  const cobros = await api('/api/tesoreria/cobros');

  mountPageView(root, {
    breadcrumb: { label: 'Tesorería', href: '/tesoreria' },
    title: 'Recibos de Cobro',
    subtitle: 'Historial de cobros a clientes e ingresos de tesorería.',
    actions: [
      { label: '+ Nuevo Cobro', href: '/tesoreria/cobros/nuevo', primary: true },
    ],
    bodyHtml: `
      <div class="card">
        <div class="card-header"><h2>Historial de Cobros</h2></div>
        <div id="cobros-table-wrap"></div>
      </div>
      <div id="cobro-meta-panel"></div>
    `,
    onAfterMount: () => {
      renderDataTable(root.querySelector('#cobros-table-wrap'), {
        rows: cobros,
        emptyText: 'Sin cobros registrados.',
        exportFilename: `cobros_${new Date().toISOString().slice(0, 10)}.csv`,
        bulkActions: [
          {
            id: 'eliminar',
            label: 'Eliminar seleccionados',
            variant: 'danger',
            confirm: (sel) => `¿Eliminar ${sel.length} cobro(s) seleccionado(s)?`,
            onClick: async (sel) => {
              let ok = 0; let errs = 0;
              for (const c of sel) {
                try { await api(`/api/tesoreria/cobros/${c.id}`, { method: 'DELETE' }); ok++; }
                catch { errs++; }
              }
              toast(`${ok} cobro(s) eliminado(s)${errs ? `, ${errs} con error` : ''}`, errs > 0 && ok === 0);
              await renderCobrosView();
            },
          },
        ],
        columns: [
          { label: 'Fecha', render: c => esc(c.fecha) },
          { label: 'Comprobante', render: c => `<strong>${esc(c.numero || '#' + c.id)}</strong>` },
          { label: 'Cuenta', render: c => esc(c.cuenta_nombre || '-') },
          { label: 'Cliente / Contraparte', render: c => c.cliente_id ? `<a href="/contactos/${c.cliente_id}" data-link class="link-primary">${esc(c.cliente_nombre || '-')}</a>` : esc(c.proveedor_nombre || '-') },
          { label: 'Método', render: c => esc(c.metodo) },
          { label: 'Monto', align: 'right', render: c => `<strong>${fmtMoney(c.monto)}</strong>` },
          {
            label: 'Acciones',
            render: c => `
              <div class="actions">
                <button type="button" class="btn btn-sm" data-print-cobro="${c.id}">PDF</button>
                <button type="button" class="btn btn-sm" data-meta-cobro="${c.id}">Notas / Adj.</button>
                <button type="button" class="btn btn-sm btn-danger" data-del-cobro="${c.id}">Eliminar</button>
              </div>
            `,
          },
        ],
      });

      root.querySelectorAll('[data-print-cobro]').forEach(btn => btn.addEventListener('click', async () => {
        try {
          const data = await api(`/api/tesoreria/cobros/${btn.dataset.printCobro}`);
          await printReciboCobro({ cobro: data.cobro || {}, lineas: data.lineas || [] });
        } catch (err) { toast(err.message, true); }
      }));

      root.querySelectorAll('[data-meta-cobro]').forEach(btn => btn.addEventListener('click', () => {
        const c = cobros.find(x => String(x.id) === String(btn.dataset.metaCobro));
        const panel = root.querySelector('#cobro-meta-panel');
        renderMetaPanel(panel, {
          entidadTipo: 'cobro',
          entidadId: btn.dataset.metaCobro,
          titulo: `Cobro ${c?.numero || '#' + btn.dataset.metaCobro}`,
          record: c || null,
          onClose: () => {},
        });
        panel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }));

      root.querySelectorAll('[data-del-cobro]').forEach(btn => btn.addEventListener('click', async () => {
        if (!(await showConfirmModal('¿Eliminar este cobro?'))) return;
        try {
          await api(`/api/tesoreria/cobros/${btn.dataset.delCobro}`, { method: 'DELETE' });
          toast('Cobro eliminado');
          await renderCobrosView();
        } catch (err) { toast(err.message, true); }
      }));
    },
  });
}

export async function renderCobroFormView() {
  const root = document.getElementById('app-view');
  const [cuentas, clientes, puntosVenta, nextCobroSeq] = await Promise.all([
    api('/api/tesoreria/cuentas'),
    api('/api/contactos?es_cliente=1'),
    api('/api/puntos-venta'),
    api('/api/secuencias/siguiente?tipo=cobro'),
  ]);

  mountPageView(root, {
    breadcrumb: { label: 'Volver a Cobros', href: '/tesoreria/cobros' },
    title: 'Nuevo Cobro',
    subtitle: 'Registrar recibo de cobro a cliente u otro ingreso.',
    bodyHtml: `
      <div class="card">
        <form id="form-nuevo-cobro" class="form-grid">
          <label><span>Fecha *</span><input type="date" name="fecha" required value="${new Date().toISOString().slice(0, 10)}" /></label>
          <label>
            <span>Cliente</span>
            <select name="cliente_id">
              <option value="">-- Otro ingreso / Sin cliente --</option>
              ${clientes.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('')}
            </select>
          </label>
          <label>
            <span>Punto de Venta</span>
            <select name="punto_venta" id="cob-pv">${renderPuntoVentaOptions(puntosVenta, nextCobroSeq?.punto_venta)}</select>
          </label>
          <label><span>Comprobante</span><input type="text" name="numero" id="cob-num" value="${esc(nextCobroSeq?.numero || '')}" /></label>
          <label class="full"><span>Concepto</span><input type="text" name="concepto" placeholder="Detalle del cobro..." /></label>
          <div class="full" id="cob-medios-box"></div>
          <div class="full" id="cob-imputar-box"></div>
          <div class="full modal-footer">
            <a href="/tesoreria/cobros" data-link class="btn">Cancelar</a>
            <button type="submit" class="btn btn-primary">Registrar Cobro</button>
          </div>
        </form>
      </div>
    `,
    onAfterMount: () => {
      const getCobroLineas = mountMediosLines(root.querySelector('#cob-medios-box'), cuentas, null, { mode: 'cobro' });
      bindPuntoVentaSeq(root.querySelector('#cob-pv'), root.querySelector('#cob-num'), 'cobro', api);
      const getCobroImputaciones = mountFacturasImputarBox(
        root.querySelector('#cob-imputar-box'),
        root.querySelector('#form-nuevo-cobro select[name="cliente_id"]'),
        'ventas',
      );
      root.querySelector('#form-nuevo-cobro').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const lineas = getCobroLineas();
        if (!lineas.length) { toast('Ingresá al menos un medio de cobro válido', true); return; }
        try {
          await api('/api/tesoreria/cobros', {
            method: 'POST',
            body: {
              fecha: fd.get('fecha'),
              cliente_id: fd.get('cliente_id') ? Number(fd.get('cliente_id')) : null,
              numero: fd.get('numero'),
              concepto: fd.get('concepto'),
              lineas,
              imputaciones: getCobroImputaciones(),
            },
          });
          toast('Cobro registrado');
          navigate('/tesoreria');
        } catch (err) { toast(err.message, true); }
      });
    },
  });
}

function mountFacturasImputarBox(box, selectEl, dominio) {
  let facturas = [];
  const load = async () => {
    const cId = selectEl?.value;
    if (!cId) {
      facturas = [];
      box.innerHTML = '';
      return;
    }
    try {
      const est = await api(`/api/tesoreria/imputaciones/estado-cuenta?contacto_id=${cId}&dominio=${dominio}`);
      facturas = (est.facturas || []).filter(f => f.pendiente > 0.01);
      if (!facturas.length) {
        box.innerHTML = '<div class="muted" style="font-size:12px;padding:4px 0;">Este contacto no tiene facturas pendientes (el comprobante quedará a cuenta).</div>';
        return;
      }
      box.innerHTML = `
        <div class="card" style="margin:6px 0;padding:12px;background:var(--bg-soft, #f8fafc);">
          <strong style="display:block;margin-bottom:8px;">Imputar a Facturas Pendientes (Opcional)</strong>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Imputar</th><th>Fecha</th><th>Número</th><th class="num">Total</th><th class="num">Pendiente</th><th class="num">Monto a Imputar</th></tr></thead>
              <tbody>
                ${facturas.map(f => `
                  <tr>
                    <td><input type="checkbox" class="imp-chk" data-fid="${f.id}" /></td>
                    <td>${fmtDate(f.fecha)}</td>
                    <td><strong>${esc(f.numero || `#${f.id}`)}</strong></td>
                    <td class="num">${fmtMoney(f.total)}</td>
                    <td class="num">${fmtMoney(f.pendiente)}</td>
                    <td class="num"><input type="number" step="0.01" min="0" max="${f.pendiente}" class="imp-monto" data-fid="${f.id}" value="${f.pendiente.toFixed(2)}" style="width:120px;text-align:right;" disabled /></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
      box.querySelectorAll('.imp-chk').forEach(chk => {
        chk.addEventListener('change', () => {
          const mIn = box.querySelector(`.imp-monto[data-fid="${chk.dataset.fid}"]`);
          if (mIn) mIn.disabled = !chk.checked;
        });
      });
    } catch (_) {
      box.innerHTML = '';
    }
  };
  selectEl?.addEventListener('change', load);
  return () => {
    const out = [];
    box.querySelectorAll('.imp-chk:checked').forEach(chk => {
      const mIn = box.querySelector(`.imp-monto[data-fid="${chk.dataset.fid}"]`);
      const m = Number(mIn?.value || 0);
      if (m > 0) out.push({ factura_id: Number(chk.dataset.fid), monto_imputado: m });
    });
    return out;
  };
}
