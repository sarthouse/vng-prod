import { api, toast, refreshKPIs } from '../../lib/api.js';
import { esc, fmtMoney, fmtDate } from '../../lib/format.js';
import { mountPageView, showConfirmModal, renderSpreadsheetTable } from '../../lib/engine/index.js';

function currentMonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
  return { desde: `${y}-${m}-01`, hasta: `${y}-${m}-${String(lastDay).padStart(2, '0')}` };
}

export async function renderPosicionIvaView() {
  const root = document.getElementById('app-view');
  const def = currentMonthRange();
  const state = { desde: def.desde, hasta: def.hasta, saldoTecAnt: 0, saldoLibAnt: 0 };

  async function render() {
    const qs = new URLSearchParams({
      desde: state.desde,
      hasta: state.hasta,
      saldo_tecnico_anterior: String(state.saldoTecAnt),
      saldo_libre_anterior: String(state.saldoLibAnt),
    });
    const d = await api(`/api/fiscal/posicion-iva?${qs.toString()}`);

    mountPageView(root, {
      title: 'Posición IVA',
      subtitle: 'Cruce automático de Débito Fiscal, Crédito Fiscal y Percepciones de IVA.',
      kpis: [
        { label: 'Débito Fiscal', value: fmtMoney(d.debito_fiscal) },
        { label: 'Crédito Fiscal', value: fmtMoney(d.credito_fiscal) },
        { label: 'Percepciones Sufridas', value: fmtMoney(d.percepciones_iva_sufridas) },
        {
          label: d.saldo_a_pagar > 0 ? 'IVA a Pagar' : 'Saldo a Favor',
          value: fmtMoney(d.saldo_a_pagar > 0 ? d.saldo_a_pagar : d.saldo_libre_a_favor),
          tone: d.saldo_a_pagar > 0 ? 'danger' : 'ok',
        },
      ],
      bodyHtml: `
        <div class="card">
          <form id="form-pos-iva" class="toolbar sx-94decf">
            <div><label class="block-label">Desde</label><input type="date" name="desde" value="${esc(state.desde)}" /></div>
            <div><label class="block-label">Hasta</label><input type="date" name="hasta" value="${esc(state.hasta)}" /></div>
            <div><label class="block-label">Saldo Téc. Ant.</label><input type="number" step="0.01" min="0" name="saldoTecAnt" value="${state.saldoTecAnt}" class="w-130" /></div>
            <div><label class="block-label">Saldo Libre Ant.</label><input type="number" step="0.01" min="0" name="saldoLibAnt" value="${state.saldoLibAnt}" class="w-130" /></div>
            <button type="submit" class="btn btn-primary">Calcular</button>
            <button type="button" class="btn sx-834563" id="btn-contabilizar-iva">Contabilizar Liquidación</button>
          </form>

          <div class="table-wrap">
            <table class="data-table">
              <tbody>
                <tr><td>Neto Gravado Ventas</td><td class="num">${fmtMoney(d.ventas_neto)}</td></tr>
                <tr><td><strong>IVA Débito Fiscal</strong></td><td class="num"><strong>${fmtMoney(d.debito_fiscal)}</strong></td></tr>
                <tr><td>Neto Gravado Compras</td><td class="num">${fmtMoney(d.compras_neto)}</td></tr>
                <tr><td>(-) IVA Crédito Fiscal</td><td class="num">${fmtMoney(d.credito_fiscal)}</td></tr>
                <tr><td>(-) Saldo Técnico Período Anterior</td><td class="num">${fmtMoney(d.saldo_tecnico_anterior)}</td></tr>
                <tr><td><strong>Saldo Técnico del Período</strong></td><td class="num"><strong>${d.saldo_tecnico_a_pagar > 0 ? `${fmtMoney(d.saldo_tecnico_a_pagar)} (A Pagar)` : `${fmtMoney(d.saldo_tecnico_a_favor)} (A Favor)`}</strong></td></tr>
                <tr><td>(-) Percepciones de IVA Sufridas</td><td class="num">${fmtMoney(d.percepciones_iva_sufridas)}</td></tr>
                <tr><td>(-) Saldo de Libre Disponibilidad Anterior</td><td class="num">${fmtMoney(d.saldo_libre_anterior)}</td></tr>
                <tr><td><strong>Resultado Final F.2002</strong></td><td class="num"><strong>${d.saldo_a_pagar > 0 ? `${fmtMoney(d.saldo_a_pagar)} A PAGAR` : `${fmtMoney(d.saldo_libre_a_favor)} LIBRE DISPONIBILIDAD`}</strong></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      `,
    });

    root.querySelector('#form-pos-iva')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      state.desde = fd.get('desde') || '';
      state.hasta = fd.get('hasta') || '';
      state.saldoTecAnt = Number(fd.get('saldoTecAnt')) || 0;
      state.saldoLibAnt = Number(fd.get('saldoLibAnt')) || 0;
      render();
    });

    root.querySelector('#btn-contabilizar-iva')?.addEventListener('click', async () => {
      if (!(await showConfirmModal('¿Generar el asiento contable de liquidación mensual de IVA?'))) return;
      try {
        const res = await api('/api/fiscal/posicion-iva/contabilizar', {
          method: 'POST',
          body: JSON.stringify({
            fecha: state.hasta,
            desde: state.desde,
            hasta: state.hasta,
            saldo_tecnico_anterior: state.saldoTecAnt,
            saldo_libre_anterior: state.saldoLibAnt,
          }),
        });
        toast(`Asiento de liquidación #${res.asiento_id} generado`);
      } catch (err) { toast(err.message, true); }
    });
  }

  await render();
}

export async function renderConciliacionBancariaView() {
  const root = document.getElementById('app-view');
  const cuentas = (await api('/api/tesoreria/cuentas')).filter(c => c.tipo === 'banco' || c.tipo === 'billetera');
  const state = { cuentaId: cuentas[0]?.id || '', estado: '' };

  async function render() {
    const qs = new URLSearchParams();
    if (state.cuentaId) qs.set('cuenta_id', String(state.cuentaId));
    if (state.estado) qs.set('estado', state.estado);
    const [extractos, sisMovs] = await Promise.all([
      state.cuentaId ? api(`/api/tesoreria/conciliacion?${qs.toString()}`) : Promise.resolve([]),
      state.cuentaId ? api(`/api/tesoreria/conciliacion/sistema?cuenta_id=${state.cuentaId}`) : Promise.resolve([]),
    ]);

    root.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Conciliación</h1>
          <p class="muted">Importá el extracto bancario y conciliá movimientos contra cobros, pagos y transferencias.</p>
        </div>
      </div>

      <div class="card mb-lg">
        <div class="toolbar sx-5f4e6a">
          <div>
            <label class="block-label">Cuenta Bancaria / Billetera</label>
            <select id="conc-cuenta" class="mw-220">
              ${cuentas.length ? cuentas.map(c => `<option value="${c.id}" ${Number(state.cuentaId) === c.id ? 'selected' : ''}>${esc(c.nombre)} (${fmtMoney(c.saldo_actual)})</option>`).join('') : '<option value="">Sin cuentas bancarias</option>'}
            </select>
          </div>
          <div>
            <label class="block-label">Estado</label>
            <select id="conc-estado" class="sx-957822">
              <option value="" ${state.estado === '' ? 'selected' : ''}>Todos</option>
              <option value="pendiente" ${state.estado === 'pendiente' ? 'selected' : ''}>Pendientes</option>
              <option value="conciliado" ${state.estado === 'conciliado' ? 'selected' : ''}>Conciliados</option>
              <option value="ignorado" ${state.estado === 'ignorado' ? 'selected' : ''}>Ignorados</option>
            </select>
          </div>
          <button type="button" class="btn btn-primary" id="btn-auto-conciliar">Auto-Conciliar (±3 días)</button>
        </div>

        <form id="form-import-extracto" class="sx-85dfb4">
          <label class="sx-525124">Importar Extracto (<code>fecha;descripcion;referencia;monto</code> o <code>fecha;descripcion;debito;credito</code>)</label>
          <textarea name="contenido" rows="3" class="sx-6d5673" placeholder="2026-11-14;Transferencia Cliente A;TRF-001;50000&#10;2026-11-14;Comisión bancaria;COM;-1250"></textarea>
          <div class="sx-d43169"><button type="submit" class="btn">Importar Líneas de Extracto</button></div>
        </form>
      </div>

      <div class="card">
        <div class="card-header"><h2>Movimientos del Extracto (${extractos.length}) · Sin conciliar en sistema: ${sisMovs.length}</h2></div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Descripción Extracto</th>
                <th>Ref.</th>
                <th class="num">Monto</th>
                <th>Estado</th>
                <th>Vinculado a</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${extractos.length ? extractos.map(e => `
                <tr>
                  <td>${fmtDate(e.fecha)}</td>
                  <td><strong>${esc(e.descripcion)}</strong></td>
                  <td><code>${esc(e.referencia || '-')}</code></td>
                  <td class="num"><strong>${fmtMoney(e.monto)}</strong></td>
                  <td><span class="badge ${e.estado === 'conciliado' ? 'badge-ok' : e.estado === 'ignorado' ? 'badge-muted' : 'badge-warn'}">${esc(e.estado)}</span></td>
                  <td>${e.entidad_tipo ? `<code>${esc(e.entidad_tipo)} #${e.entidad_id || ''}</code>` : (e.estado === 'pendiente' && sisMovs.length ? `
                    <select class="conc-pick-sis sx-ac5a41" data-id="${e.id}">
                      <option value="">-- Vincular movimiento --</option>
                      ${sisMovs.map(m => `<option value="${esc(m.entidad_tipo)}:${m.entidad_id}">${fmtDate(m.fecha)} · ${esc(m.numero || m.concepto)} (${fmtMoney(m.monto)})</option>`).join('')}
                    </select>
                  ` : '-')}</td>
                  <td>
                    <div class="actions">
                      ${e.estado === 'pendiente' ? `<button type="button" class="btn btn-sm" data-ignorar="${e.id}">Ignorar</button>` : `<button type="button" class="btn btn-sm" data-desconciliar="${e.id}">Deshacer</button>`}
                    </div>
                  </td>
                </tr>
              `).join('') : '<tr><td colspan="7" class="muted text-center">Sin movimientos importados para esta cuenta.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;

    root.querySelector('#conc-cuenta')?.addEventListener('change', (e) => { state.cuentaId = e.target.value; render(); });
    root.querySelector('#conc-estado')?.addEventListener('change', (e) => { state.estado = e.target.value; render(); });

    root.querySelector('#form-import-extracto')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const res = await api('/api/tesoreria/conciliacion/importar', {
          method: 'POST',
          body: JSON.stringify({ cuenta_id: Number(state.cuentaId), contenido: fd.get('contenido') }),
        });
        toast(`Importados ${res.imported || 0} movimientos`);
        render();
      } catch (err) { toast(err.message, true); }
    });

    root.querySelector('#btn-auto-conciliar')?.addEventListener('click', async () => {
      try {
        const res = await api('/api/tesoreria/conciliacion/auto', {
          method: 'POST',
          body: JSON.stringify({ cuenta_id: Number(state.cuentaId) }),
        });
        toast(`Conciliados automáticamente: ${res.matched || 0}`);
        render();
      } catch (err) { toast(err.message, true); }
    });

    root.querySelectorAll('.conc-pick-sis').forEach(sel => sel.addEventListener('change', async () => {
      if (!sel.value) return;
      const [entidad_tipo, entidad_id] = sel.value.split(':');
      try {
        await api(`/api/tesoreria/conciliacion/${sel.dataset.id}/conciliar`, {
          method: 'POST',
          body: JSON.stringify({ entidad_tipo, entidad_id: Number(entidad_id) }),
        });
        toast('Movimiento conciliado');
        render();
      } catch (err) { toast(err.message, true); }
    }));

    root.querySelectorAll('[data-ignorar]').forEach(btn => btn.addEventListener('click', async () => {
      await api(`/api/tesoreria/conciliacion/${btn.dataset.ignorar}/ignorar`, { method: 'POST', body: '{}' });
      render();
    }));

    root.querySelectorAll('[data-desconciliar]').forEach(btn => btn.addEventListener('click', async () => {
      await api(`/api/tesoreria/conciliacion/${btn.dataset.desconciliar}/desconciliar`, { method: 'POST', body: '{}' });
      render();
    }));
  }

  await render();
}

export async function renderCierresYMonedasView() {
  const root = document.getElementById('app-view');
  const year = new Date().getFullYear();

  async function render() {
    const [cierres, cotizaciones, cuadre] = await Promise.all([
      api('/api/contabilidad/cierres'),
      api('/api/fiscal/cotizaciones'),
      api('/api/tesoreria/imputaciones/cuadre').catch(() => null),
    ]);

    root.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Cierres</h1>
          <p class="muted">Refundición de cuentas de resultado, bloqueo de períodos cerrados, cuadre de cuentas corrientes y cotizaciones.</p>
        </div>
      </div>

      ${cuadre ? `
        <div class="card mb-md">
          <div class="card-header"><h2>Cuadre Contable y Antigüedad de Saldos</h2></div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Rubro</th>
                  <th class="num">Saldo Balance</th>
                  <th class="num">Pend. Facturas</th>
                  <th class="num">Anticipos</th>
                  <th class="num">Saldo Operativo</th>
                  <th class="num">Diferencia</th>
                  <th>Estado</th>
                  <th class="num">A vencer</th>
                  <th class="num">1-30d</th>
                  <th class="num">31-60d</th>
                  <th class="num">61-90d</th>
                  <th class="num">+90d</th>
                </tr>
              </thead>
              <tbody>
                ${[
                  { label: 'Clientes', d: cuadre.clientes },
                  { label: 'Proveedores', d: cuadre.proveedores },
                ].map(({ label, d }) => `
                  <tr>
                    <td><strong>${esc(label)}</strong></td>
                    <td class="num">${fmtMoney(d.saldo_contable)}</td>
                    <td class="num">${fmtMoney(d.pendiente_facturas)}</td>
                    <td class="num">${fmtMoney(d.anticipos_sin_imputar)}</td>
                    <td class="num"><strong>${fmtMoney(d.saldo_operativo)}</strong></td>
                    <td class="num">${fmtMoney(d.diferencia)}</td>
                    <td><span class="badge ${d.cuadrado ? 'badge-ok' : 'badge-warn'}">${d.cuadrado ? 'Cuadrado' : 'Desfasado'}</span></td>
                    <td class="num">${fmtMoney(d.aging.corriente)}</td>
                    <td class="num">${fmtMoney(d.aging.d1_30)}</td>
                    <td class="num">${fmtMoney(d.aging.d31_60)}</td>
                    <td class="num">${fmtMoney(d.aging.d61_90)}</td>
                    <td class="num">${fmtMoney(d.aging.mas_90)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : ''}

      <div class="sx-da7c1b">
        <div class="card">
          <div class="card-header"><h2>Cierre de Ejercicio</h2></div>
          <form id="form-cierre-ej" class="form-grid mb-md">
            <label><span>Desde *</span><input type="date" name="fecha_desde" required value="${year}-01-01" /></label>
            <label><span>Hasta *</span><input type="date" name="fecha_hasta" required value="${year}-12-31" /></label>
            <label class="full"><span>Descripción</span><input type="text" name="descripcion" placeholder="Ejercicio Fiscal ${year}" /></label>
            <div class="full sx-9c6869">
              <button type="button" class="btn" id="btn-preview-cierre">Previsualizar Resultado</button>
              <button type="submit" class="btn btn-primary">Cerrar Período y Refundir</button>
            </div>
          </form>
          <div id="cierre-preview-box" class="mb-md"></div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Período</th><th>Descripción</th><th class="num">Resultado</th><th>Asiento</th><th>Estado</th><th>Acciones</th></tr></thead>
              <tbody>
                ${cierres.length ? cierres.map(c => `
                  <tr>
                    <td>${fmtDate(c.fecha_desde)} → ${fmtDate(c.fecha_hasta)}</td>
                    <td>${esc(c.descripcion)}</td>
                    <td class="num"><strong>${fmtMoney(c.resultado_neto)}</strong></td>
                    <td><code>${esc(c.asiento_numero || '-')}</code></td>
                    <td><span class="badge ${c.estado === 'cerrado' ? 'badge-ok' : 'badge-muted'}">${esc(c.estado)}</span></td>
                    <td>${c.estado === 'cerrado' ? `<button type="button" class="btn btn-sm" data-reabrir="${c.id}">Reabrir</button>` : '-'}</td>
                  </tr>
                `).join('') : '<tr><td colspan="6" class="muted text-center">Sin cierres registrados.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <h2>Cotizaciones Multimoneda</h2>
              <span class="muted text-sm">Click en una celda para editar o completá la fila inferior para cargar una cotización.</span>
            </div>
          </div>
          <div id="cotiz-sheet-host"></div>
        </div>
      </div>
    `;

    root.querySelector('#btn-preview-cierre')?.addEventListener('click', async () => {
      const form = root.querySelector('#form-cierre-ej');
      const fd = new FormData(form);
      try {
        const prev = await api(`/api/contabilidad/cierres/preview?fecha_desde=${fd.get('fecha_desde')}&fecha_hasta=${fd.get('fecha_hasta')}`);
        root.querySelector('#cierre-preview-box').innerHTML = `
          <div class="kpis">
            <div class="kpi-card"><span class="kpi-label">Ingresos</span><strong class="kpi-value">${fmtMoney(prev.total_ingresos)}</strong></div>
            <div class="kpi-card"><span class="kpi-label">Egresos</span><strong class="kpi-value">${fmtMoney(prev.total_egresos)}</strong></div>
            <div class="kpi-card"><span class="kpi-label">Resultado Neto</span><strong class="kpi-value accent">${fmtMoney(prev.resultado_neto)}</strong></div>
          </div>
        `;
      } catch (err) { toast(err.message, true); }
    });

    root.querySelector('#form-cierre-ej')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!(await showConfirmModal('¿Cerrar el período y generar el asiento de refundición?'))) return;
      const fd = new FormData(e.target);
      try {
        await api('/api/contabilidad/cierres', {
          method: 'POST',
          body: JSON.stringify({
            fecha_desde: fd.get('fecha_desde'),
            fecha_hasta: fd.get('fecha_hasta'),
            descripcion: fd.get('descripcion'),
          }),
        });
        toast('Período cerrado y refundido');
        render();
      } catch (err) { toast(err.message, true); }
    });

    root.querySelectorAll('[data-reabrir]').forEach(btn => btn.addEventListener('click', async () => {
      if (!(await showConfirmModal('¿Reabrir este ejercicio y eliminar su asiento de refundición?'))) return;
      try {
        await api(`/api/contabilidad/cierres/${btn.dataset.reabrir}/reabrir`, { method: 'POST', body: '{}' });
        toast('Período reabierto');
        render();
      } catch (err) { toast(err.message, true); }
    }));

    renderSpreadsheetTable(root.querySelector('#cotiz-sheet-host'), {
      rows: cotizaciones,
      emptyText: 'Sin cotizaciones cargadas.',
      compact: true,
      defaultNewRow: () => ({
        fecha: new Date().toISOString().slice(0, 10),
        moneda: 'USD',
        cotizacion: '',
        fuente: 'manual',
      }),
      onCreateRow: async ({ row }) => {
        if (!row.fecha || !(Number(row.cotizacion) > 0)) return false;
        try {
          await api('/api/fiscal/cotizaciones', {
            method: 'POST',
            body: JSON.stringify({
              moneda: row.moneda || 'USD',
              fecha: row.fecha,
              cotizacion: Number(row.cotizacion),
            }),
          });
          toast('Cotización guardada');
          refreshKPIs();
          await render();
          return false;
        } catch (err) {
          toast(err.message, true);
          throw err;
        }
      },
      columns: [
        {
          key: 'fecha',
          label: 'Fecha',
          type: 'date',
          render: c => fmtDate(c.fecha),
        },
        {
          key: 'moneda',
          label: 'Moneda',
          type: 'select',
          options: [
            { value: 'USD', label: 'USD — Dólar' },
            { value: 'EUR', label: 'EUR — Euro' },
          ],
          render: c => `<strong>${esc(c.moneda || 'USD')}</strong>`,
        },
        {
          key: 'cotizacion',
          label: 'Cotización ARS',
          type: 'number',
          step: 0.01,
          min: 0.01,
          align: 'right',
          parse: v => Number(v) || 0,
          render: c => (Number(c.cotizacion) > 0 ? fmtMoney(c.cotizacion) : '<span class="muted">Ej: 1050.00</span>'),
        },
        {
          key: 'fuente',
          label: 'Fuente',
          editable: () => false,
          render: c => esc(c.fuente || 'manual'),
        },
      ],
      onCellChange: async ({ row, key, value }) => {
        try {
          await api('/api/fiscal/cotizaciones', {
            method: 'POST',
            body: JSON.stringify({
              moneda: key === 'moneda' ? value : row.moneda,
              fecha: key === 'fecha' ? value : row.fecha,
              cotizacion: key === 'cotizacion' ? Number(value) : Number(row.cotizacion),
            }),
          });
          toast('Cotización actualizada');
          refreshKPIs();
        } catch (err) {
          toast(err.message, true);
          throw err;
        }
      },
    });
  }

  await render();
}
