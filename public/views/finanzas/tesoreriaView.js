import { api, toast } from '../../lib/api.js';
import { esc, fmtMoney, renderPuntoVentaOptions, bindPuntoVentaSeq, getMetodosForCuenta } from '../../lib/format.js';
import { renderMetaPanel } from '../../lib/metaPanel.js';
import { printOrdenPago, printReciboCobro } from '../../lib/tesoreriaPrint.js';
import { showConfirmModal, createModal } from '../../lib/modal.js';
import { navigate } from '../../router.js';
import { renderDataTable } from '../../lib/viewEngine.js';

export async function renderTesoreriaView() {
  const root = document.getElementById('app-view');
  let activeTab = 'flujo';
  let cheqFiltroOrigen = '';
  let cheqFiltroEstado = '';
  let cheqSearch = '';
  let granularidad = 'semana';
  let showHistDetalle = false;
  let showProyDetalle = false;
  let filtroCuenta = '';
  let desde = '';
  let hasta = '';
  let proyDias = 30;
  let showAsientoForm = false;
  let asientoFecha = new Date().toISOString().slice(0, 10);
  let asientoDiarioId = '';
  let asientoConcepto = '';
  let asientoLineas = [
    { plan_cuenta_id: '', cuenta_contable: '', debe: 0, haber: 0 },
    { plan_cuenta_id: '', cuenta_contable: '', debe: 0, haber: 0 },
  ];

  const loadAndRender = async () => {
    const qs = new URLSearchParams({ granularidad });
    if (filtroCuenta) qs.set('cuenta_id', filtroCuenta);
    if (desde) qs.set('desde', desde);
    if (hasta) qs.set('hasta', hasta);

    const pQs = new URLSearchParams({ dias: String(proyDias), granularidad });
    if (filtroCuenta) pQs.set('cuenta_id', filtroCuenta);

    const [flujo, op, asientos, balance, planCuentas, diarios, proyFlujo, proyecciones, cheques] = await Promise.all([
      api(`/api/tesoreria/flujo-caja?${qs.toString()}`),
      api('/api/tesoreria/flujo-operativo'),
      api('/api/tesoreria/asientos'),
      api('/api/tesoreria/balance').catch(() => []),
      api('/api/tesoreria/plan-cuentas').catch(() => []),
      api('/api/tesoreria/diarios').catch(() => []),
      api(`/api/tesoreria/flujo-proyectado?${pQs.toString()}`).catch(() => ({ caja_actual: 0, resumen: {}, por_mes: [], eventos: [] })),
      api('/api/tesoreria/proyecciones').catch(() => []),
      api('/api/tesoreria/cheques').catch(() => []),
    ]);
    const cuentasResultado = planCuentas.filter(pc => pc.activo !== 0 && pc.imputable !== 0 && (pc.tipo === 'egreso' || pc.tipo === 'ingreso'));

    root.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Tesorería — Cuentas y Flujos</h1>
          <p class="muted">Saldos por cuenta, flujo de caja y flujo operativo del negocio.</p>
        </div>
        <div class="actions">
          <a href="/tesoreria/cuentas" data-link class="btn">Cuentas, Ajustes y Transferencias</a>
          <a href="/tesoreria/pagos" data-link class="btn">+ Registrar Pago</a>
          <a href="/tesoreria/cobros" data-link class="btn btn-primary">+ Registrar Cobro</a>
        </div>
      </div>

      <div class="detail-meta">
        <div><span>Caja Disponible</span><strong>${fmtMoney(op.caja_disponible)}</strong></div>
        <div><span>Cuentas por Cobrar</span><strong>${fmtMoney(op.cuentas_por_cobrar)}</strong></div>
        <div><span>Cuentas por Pagar</span><strong style="color:var(--color-accent);">${fmtMoney(op.cuentas_por_pagar)}</strong></div>
        <div><span>Posición Neta Proyectada</span><strong>${fmtMoney(op.posicion_neta_proyectada)}</strong></div>
        <div><span>Gastos Operativos Pagados</span><strong>${fmtMoney(op.gastos_operativos)}</strong></div>
      </div>

      <div class="config-tabs" style="margin-bottom:1rem;">
        <button type="button" class="config-tab ${activeTab === 'flujo' ? 'active' : ''}" data-tes-tab="flujo">Flujo de Caja</button>
        <button type="button" class="config-tab ${activeTab === 'cheques' ? 'active' : ''}" data-tes-tab="cheques">Cartera de Cheques (${cheques.filter(c => ['En Cartera', 'Depositado', 'Emitido'].includes(c.estado)).length})</button>
        <button type="button" class="config-tab ${activeTab === 'cuentas' ? 'active' : ''}" data-tes-tab="cuentas">Proyecciones Recurrentes</button>
        <button type="button" class="config-tab ${activeTab === 'contabilidad' ? 'active' : ''}" data-tes-tab="contabilidad">Contabilidad</button>
      </div>

      ${activeTab === 'flujo' ? `
        <div class="card" style="margin-bottom:1rem;">
          <div class="toolbar" style="margin-bottom:0; justify-content:space-between; flex-wrap:wrap; gap:0.75rem;">
            <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
              <div class="pill-group">
                <button type="button" class="pill ${granularidad === 'semana' ? 'active' : ''}" data-fc-gran="semana">Por Semana</button>
                <button type="button" class="pill ${granularidad === 'mes' ? 'active' : ''}" data-fc-gran="mes">Por Mes</button>
              </div>
              <select id="fc-cuenta">
                <option value="">Todas las cuentas</option>
                ${flujo.cuentas.map(c => `<option value="${c.id}" ${String(c.id) === String(filtroCuenta) ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}
              </select>
              <input type="date" id="fc-desde" value="${esc(desde)}" title="Histórico desde" />
              <input type="date" id="fc-hasta" value="${esc(hasta)}" title="Histórico hasta" />
              <button type="button" id="btn-fc-filtrar" class="btn btn-sm btn-primary">Filtrar</button>
            </div>
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <span class="muted" style="font-size:0.82rem;">Horizonte proyección:</span>
              <select id="fc-proy-dias">
                ${[
                  { d: 14, label: '14 días (2 sem)' },
                  { d: 30, label: '30 días (4 sem)' },
                  { d: 60, label: '60 días (9 sem)' },
                  { d: 90, label: '90 días (13 sem)' },
                ].map(o => `<option value="${o.d}" ${proyDias === o.d ? 'selected' : ''}>${o.label}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <h2>Histórico — ${granularidad === 'semana' ? 'Por Semana' : 'Por Mes'}</h2>
              <span class="muted" style="font-size:0.82rem;">
                Apertura: <strong>${fmtMoney(flujo.resumen.saldo_apertura ?? 0)}</strong> ·
                Ingresos: <strong>${fmtMoney(flujo.resumen.total_ingresos)}</strong> ·
                Egresos: <strong>${fmtMoney(flujo.resumen.total_egresos)}</strong> ·
                Neto: <strong>${fmtMoney(flujo.resumen.flujo_neto)}</strong> ·
                Cierre: <strong>${fmtMoney(flujo.resumen.saldo_cierre ?? flujo.resumen.saldo_total_cuentas)}</strong>
              </span>
            </div>
            <button type="button" id="btn-toggle-hist-det" class="btn btn-sm">${showHistDetalle ? 'Ocultar detalle' : 'Ver movimientos'}</button>
          </div>
          ${(flujo.por_periodo || []).length === 0 ? '<div class="empty-state">Sin movimientos históricos en el período.</div>' : `
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>${granularidad === 'semana' ? 'Semana' : 'Mes'}</th>
                    <th class="num">Ingresos</th>
                    <th class="num">Egresos</th>
                    <th class="num">Transf.</th>
                    <th class="num">Flujo Neto</th>
                    <th class="num">Saldo Cierre</th>
                  </tr>
                </thead>
                <tbody>
                  ${flujo.por_periodo.map(r => `
                    <tr>
                      <td><strong>${esc(r.periodo_label || r.periodo)}</strong></td>
                      <td class="num" style="color:var(--color-success);">${fmtMoney(r.ingresos)}</td>
                      <td class="num" style="color:var(--color-accent);">${fmtMoney(r.egresos)}</td>
                      <td class="num">${fmtMoney(r.transferencias_neto)}</td>
                      <td class="num"><strong style="color:${r.flujo_neto >= 0 ? 'var(--color-success)' : 'var(--color-accent)'};">${fmtMoney(r.flujo_neto)}</strong></td>
                      <td class="num"><strong>${fmtMoney(r.saldo_cierre ?? 0)}</strong></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `}
          ${showHistDetalle && flujo.movimientos.length > 0 ? `
            <div class="table-wrap" style="margin-top:1rem; border-top:1px solid var(--color-border); padding-top:0.75rem;">
              <table class="data-table">
                <thead>
                  <tr><th>Fecha</th><th>Tipo</th><th>Cuenta</th><th>Contraparte</th><th>Concepto</th><th class="num">Monto</th><th class="num">Saldo Acum.</th></tr>
                </thead>
                <tbody>
                  ${flujo.movimientos.map(m => `
                    <tr>
                      <td>${esc(m.fecha)}</td>
                      <td><span class="badge ${m.tipo === 'ingreso' ? 'badge-ok' : m.tipo === 'transferencia' ? 'badge-muted' : 'badge-warn'}">${m.tipo === 'ingreso' ? 'Cobro' : m.tipo === 'transferencia' ? 'Transf.' : 'Pago'}</span></td>
                      <td>${esc(m.cuenta_nombre || '-')}</td>
                      <td>${esc(m.contraparte)}</td>
                      <td>${esc(m.concepto)}</td>
                      <td class="num"><strong style="color:${m.monto >= 0 ? 'var(--color-success)' : 'var(--color-accent)'};">${fmtMoney(m.monto)}</strong></td>
                      <td class="num">${fmtMoney(m.saldo_acumulado)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : ''}
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <h2>Proyectado — ${granularidad === 'semana' ? 'Por Semana' : 'Por Mes'} · ${esc(proyFlujo.desde || '')} → ${esc(proyFlujo.hasta || '')}</h2>
              <span class="muted" style="font-size:0.82rem;">
                Caja Hoy: <strong>${fmtMoney(proyFlujo.caja_actual ?? 0)}</strong> ·
                Ingresos Proy.: <strong>${fmtMoney(proyFlujo.resumen?.ingresos_proyectados ?? 0)}</strong> ·
                Egresos Proy.: <strong>${fmtMoney(proyFlujo.resumen?.egresos_proyectados ?? 0)}</strong> ·
                Saldo Final Proy.: <strong>${fmtMoney(proyFlujo.resumen?.saldo_final_proyectado ?? 0)}</strong>
              </span>
            </div>
            <button type="button" id="btn-toggle-proy-det" class="btn btn-sm">${showProyDetalle ? 'Ocultar detalle' : 'Ver vencimientos'}</button>
          </div>
          ${(proyFlujo.por_periodo || proyFlujo.por_mes || []).length === 0 ? '<div class="empty-state">Sin vencimientos ni proyecciones en el horizonte seleccionado.</div>' : `
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>${granularidad === 'semana' ? 'Semana' : 'Mes'}</th>
                    <th class="num">Ing. Comprometidos</th>
                    <th class="num">Ing. Estimados</th>
                    <th class="num">Egr. Comprometidos</th>
                    <th class="num">Egr. Estimados</th>
                    <th class="num">Flujo Neto</th>
                    <th class="num">Saldo Proy.</th>
                  </tr>
                </thead>
                <tbody>
                  ${(proyFlujo.por_periodo || proyFlujo.por_mes || []).map(r => `
                    <tr>
                      <td><strong>${esc(r.periodo_label || r.periodo)}</strong></td>
                      <td class="num">${fmtMoney(r.ingresos_comprometidos)}</td>
                      <td class="num">${fmtMoney(r.ingresos_estimados)}</td>
                      <td class="num">${fmtMoney(r.egresos_comprometidos)}</td>
                      <td class="num">${fmtMoney(r.egresos_estimados)}</td>
                      <td class="num"><strong style="color:${r.flujo_neto >= 0 ? 'var(--color-success)' : 'var(--color-accent)'};">${fmtMoney(r.flujo_neto)}</strong></td>
                      <td class="num"><strong>${fmtMoney(r.saldo_cierre)}</strong></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `}
          ${showProyDetalle && (proyFlujo.eventos || []).length > 0 ? `
            <div class="table-wrap" style="margin-top:1rem; border-top:1px solid var(--color-border); padding-top:0.75rem;">
              <table class="data-table">
                <thead>
                  <tr><th>Fecha Est.</th><th>Estado</th><th>Origen</th><th>Contraparte / Cat.</th><th>Concepto</th><th class="num">Monto</th><th class="num">Saldo Proy.</th></tr>
                </thead>
                <tbody>
                  ${proyFlujo.eventos.map(ev => `
                    <tr>
                      <td>${esc(ev.fecha)} ${ev.vencido ? '<span class="badge badge-warn">Vencido</span>' : ''}</td>
                      <td><span class="badge ${ev.estado_flujo === 'Comprometido' ? 'badge-ok' : 'badge-muted'}">${esc(ev.estado_flujo)}</span></td>
                      <td>${esc(ev.origen)}</td>
                      <td>${esc(ev.contraparte)}</td>
                      <td>${esc(ev.concepto)}</td>
                      <td class="num"><strong style="color:${ev.monto >= 0 ? 'var(--color-success)' : 'var(--color-accent)'};">${fmtMoney(ev.monto)}</strong></td>
                      <td class="num">${fmtMoney(ev.saldo_acumulado)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : ''}
        </div>
      ` : ''}

      ${activeTab === 'cuentas' ? `

      <div class="card">
        <div class="card-header">
          <div>
            <h2>Gastos e Ingresos Recurrentes / Estimados</h2>
            <span class="muted" style="font-size:0.82rem;">Servicios fijos, alquileres, sueldos o ingresos estimados para proyectar el flujo futuro.</span>
          </div>
        </div>
        <form id="form-add-proyeccion" class="form-grid" style="margin-bottom:1rem;">
          <label><span>Concepto *</span><input type="text" name="concepto" placeholder="Ej: Alquiler Taller / Luz / Internet" required /></label>
          <label><span>Tipo</span>
            <select name="tipo">
              <option value="egreso">Egreso (Gasto)</option>
              <option value="ingreso">Ingreso</option>
            </select>
          </label>
          <label><span>Cuenta Contable</span>
            <select name="plan_cuenta_id">
              <option value="">-- Sin cuenta --</option>
              ${cuentasResultado.map(pc => `<option value="${pc.id}">${esc(pc.codigo)} — ${esc(pc.nombre)}</option>`).join('')}
            </select>
          </label>
          <label><span>Frecuencia</span>
            <select name="frecuencia">
              <option value="mensual">Mensual</option>
              <option value="quincenal">Quincenal</option>
              <option value="semanal">Semanal</option>
              <option value="bimestral">Bimestral</option>
              <option value="trimestral">Trimestral</option>
              <option value="anual">Anual</option>
              <option value="unico">Único</option>
            </select>
          </label>
          <label><span>Inicio *</span><input type="date" name="fecha_inicio" required value="${new Date().toISOString().slice(0, 10)}" /></label>
          <label><span>Fin</span><input type="date" name="fecha_fin" /></label>
          <label><span>Monto *</span><input type="number" step="0.01" min="0.01" name="monto" required /></label>
          <div style="align-self:end;"><button type="submit" class="btn btn-primary btn-sm">+ Agregar Proyección</button></div>
        </form>
        ${proyecciones.length === 0 ? '<div class="empty-state">No hay gastos o ingresos recurrentes cargados.</div>' : `
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Concepto</th><th>Tipo</th><th>Cuenta</th><th>Frecuencia</th><th>Vigencia</th><th class="num">Monto</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                ${proyecciones.map(p => `
                  <tr>
                    <td><strong>${esc(p.concepto)}</strong></td>
                    <td><span class="badge ${p.tipo === 'ingreso' ? 'badge-ok' : 'badge-warn'}">${p.tipo === 'ingreso' ? 'Ingreso' : 'Egreso'}</span></td>
                    <td>${esc(p.plan_cuenta_nombre || p.categoria || '-')}</td>
                    <td>${esc(p.frecuencia)}</td>
                    <td>${esc(p.fecha_inicio)}${p.fecha_fin ? ` → ${esc(p.fecha_fin)}` : ''}</td>
                    <td class="num"><strong>${fmtMoney(p.monto)}</strong></td>
                    <td><span class="badge ${p.activo !== 0 ? 'badge-ok' : 'badge-muted'}">${p.activo !== 0 ? 'Activo' : 'Pausado'}</span></td>
                    <td>
                      <div class="actions">
                        <button type="button" class="btn btn-sm" data-toggle-proy="${p.id}" data-activo="${p.activo !== 0 ? 1 : 0}">${p.activo !== 0 ? 'Pausar' : 'Activar'}</button>
                        <button type="button" class="btn btn-sm btn-danger" data-del-proy="${p.id}">Eliminar</button>
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
      ` : ''}

      ${activeTab === 'contabilidad' ? `

      <div class="card">
        <div class="card-header">
          <div>
            <h2>Libro Diario — Doble Entrada</h2>
            <span class="muted" style="font-size:0.82rem;">Cada movimiento registra Debe y Haber balanceados.</span>
          </div>
          <button type="button" id="btn-toggle-asiento" class="btn btn-sm btn-primary">${showAsientoForm ? 'Cerrar' : '+ Nuevo Asiento Manual'}</button>
        </div>
        ${showAsientoForm ? (() => {
          const sumD = asientoLineas.reduce((s, l) => s + (Number(l.debe) || 0), 0);
          const sumH = asientoLineas.reduce((s, l) => s + (Number(l.haber) || 0), 0);
          const diff = Math.abs(sumD - sumH);
          return `
            <form id="form-asiento-manual" style="margin-bottom:1rem; padding:0.75rem; background:var(--color-bg-subtle, #f8fafc); border-radius:6px; border:1px solid var(--color-border);">
              <div class="form-grid" style="margin-bottom:0.75rem;">
                <label><span>Fecha</span><input type="date" id="as-fecha" value="${esc(asientoFecha)}" required /></label>
                <label><span>Diario</span>
                  <select id="as-diario">
                    <option value="">General / Sin diario</option>
                    ${diarios.map(d => `<option value="${d.id}" ${String(asientoDiarioId) === String(d.id) ? 'selected' : ''}>${esc(d.codigo)} — ${esc(d.nombre)}</option>`).join('')}
                  </select>
                </label>
                <label style="grid-column: span 2;"><span>Concepto *</span><input type="text" id="as-concepto" value="${esc(asientoConcepto)}" placeholder="Ej: Ajuste de apertura / Devengamiento..." required /></label>
              </div>
              <div class="table-wrap">
                <table class="data-table">
                  <thead><tr><th>Cuenta Contable</th><th class="num" style="width:130px;">Debe</th><th class="num" style="width:130px;">Haber</th><th style="width:60px;"></th></tr></thead>
                  <tbody>
                    ${asientoLineas.map((l, idx) => `
                      <tr>
                        <td>
                          <select class="as-cuenta" data-idx="${idx}" required>
                            <option value="">Elegir cuenta...</option>
                            ${planCuentas.filter(pc => pc.activo !== 0).map(pc => `<option value="${pc.id}" data-nombre="${esc(pc.codigo + ' ' + pc.nombre)}" ${String(l.plan_cuenta_id) === String(pc.id) ? 'selected' : ''}>${esc(pc.codigo)} — ${esc(pc.nombre)} (${esc(pc.tipo)})</option>`).join('')}
                          </select>
                        </td>
                        <td><input type="number" step="0.01" min="0" class="as-debe num" data-idx="${idx}" value="${l.debe || ''}" placeholder="0.00" /></td>
                        <td><input type="number" step="0.01" min="0" class="as-haber num" data-idx="${idx}" value="${l.haber || ''}" placeholder="0.00" /></td>
                        <td>${asientoLineas.length > 2 ? `<button type="button" class="btn btn-sm btn-danger as-del" data-idx="${idx}">×</button>` : ''}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>
                        <button type="button" id="btn-as-add-line" class="btn btn-sm">+ Línea</button>
                        <span id="as-balance-msg" class="muted" style="margin-left:0.75rem; font-size:0.82rem; color:${diff < 0.01 && sumD > 0 ? 'var(--color-success)' : 'var(--color-accent)'};">
                          ${diff < 0.01 && sumD > 0 ? 'Balanceado' : `Diferencia: ${fmtMoney(diff)}`}
                        </span>
                      </td>
                      <td class="num"><strong id="as-sum-debe">${fmtMoney(sumD)}</strong></td>
                      <td class="num"><strong id="as-sum-haber">${fmtMoney(sumH)}</strong></td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div class="actions" style="margin-top:0.75rem; justify-content:flex-end;">
                <button type="submit" class="btn btn-primary btn-sm">Registrar Asiento</button>
              </div>
            </form>
          `;
        })() : ''}
        ${asientos.length === 0 ? '<div class="empty-state">Sin asientos registrados todavía.</div>' : `
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Fecha</th><th>Asiento / Origen</th><th>Cuenta Contable</th><th class="num">Debe</th><th class="num">Haber</th><th></th></tr></thead>
              <tbody>
                ${asientos.flatMap(a => (a.lineas || []).map((l, idx) => `
                  <tr>
                    <td>${idx === 0 ? esc(a.fecha) : ''}</td>
                    <td>${idx === 0 ? `<strong>${esc(a.numero || '#' + a.id)}</strong> <span class="badge badge-muted">${esc(a.tipo_origen)}</span> ${a.estado === 'Revertido' ? '<span class="badge badge-parcial">Revertido</span>' : ''} <span class="muted">${esc(a.concepto)}</span>` : ''}</td>
                    <td>${esc(l.cuenta_contable)}</td>
                    <td class="num">${l.debe > 0 ? `<strong>${fmtMoney(l.debe)}</strong>` : '-'}</td>
                    <td class="num">${l.haber > 0 ? `<strong>${fmtMoney(l.haber)}</strong>` : '-'}</td>
                    <td>${idx === 0 && a.estado === 'Confirmado' ? `<button type="button" class="btn btn-sm" data-rev-asiento="${a.id}">Revertir</button>` : ''}</td>
                  </tr>
                `)).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>

      <div class="card">
        <div class="card-header">
          <h2>Balance de Sumas y Saldos</h2>
        </div>
        ${balance.length === 0 ? '<div class="empty-state">Sin movimientos contables confirmados.</div>' : `
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Código</th><th>Cuenta</th><th>Tipo</th><th class="num">Total Debe</th><th class="num">Total Haber</th><th class="num">Saldo</th></tr></thead>
              <tbody>
                ${balance.map(b => `
                  <tr>
                    <td><code>${esc(b.codigo || '-')}</code></td>
                    <td><strong>${esc(b.nombre)}</strong></td>
                    <td><span class="badge badge-muted">${esc(b.tipo || '-')}</span></td>
                    <td class="num">${fmtMoney(b.total_debe)}</td>
                    <td class="num">${fmtMoney(b.total_haber)}</td>
                    <td class="num"><strong>${fmtMoney(b.saldo)}</strong></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
      ` : ''}

      ${activeTab === 'cheques' ? (() => {
        const hoyIso = new Date().toISOString().slice(0, 10);
        const en7Dias = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
        const enCartera = cheques.filter(c => c.origen === 'terceros' && c.estado === 'En Cartera');
        const depositados = cheques.filter(c => c.origen === 'terceros' && c.estado === 'Depositado');
        const propiosEmitidos = cheques.filter(c => c.origen === 'propio' && c.estado === 'Emitido');
        const vencen7 = cheques.filter(c => ['En Cartera', 'Depositado', 'Emitido'].includes(c.estado) && c.fecha_pago && c.fecha_pago <= en7Dias);
        const sumMonto = (arr) => arr.reduce((s, c) => s + Number(c.monto || 0), 0);
        const qLower = cheqSearch.trim().toLowerCase();
        const filtrados = cheques.filter(c => {
          if (cheqFiltroOrigen && c.origen !== cheqFiltroOrigen) return false;
          if (cheqFiltroEstado && c.estado !== cheqFiltroEstado) return false;
          if (qLower) {
            const hay = `${c.numero} ${c.banco} ${c.librador_nombre} ${c.contacto_origen_nombre} ${c.contacto_destino_nombre}`.toLowerCase();
            if (!hay.includes(qLower)) return false;
          }
          return true;
        });
        const badgeEstado = (est) => {
          if (est === 'Acreditado' || est === 'Debitado') return 'badge-ok';
          if (est === 'Rechazado' || est === 'Anulado') return 'badge-danger';
          if (est === 'Depositado' || est === 'Endosado') return 'badge-info';
          return 'badge-warn';
        };
        return `
        <div class="detail-meta" style="margin-bottom:1rem;">
          <div><span>En Cartera (Terceros · ${enCartera.length})</span><strong>${fmtMoney(sumMonto(enCartera))}</strong></div>
          <div><span>Depositados sin Acreditar (${depositados.length})</span><strong>${fmtMoney(sumMonto(depositados))}</strong></div>
          <div><span>Propios Emitidos a Pagar (${propiosEmitidos.length})</span><strong style="color:var(--color-accent);">${fmtMoney(sumMonto(propiosEmitidos))}</strong></div>
          <div><span>Vencen en ≤ 7 días (${vencen7.length})</span><strong style="color:${vencen7.length ? 'var(--color-accent)' : 'inherit'};">${fmtMoney(sumMonto(vencen7))}</strong></div>
        </div>

        <div class="card">
          <div class="card-header">
            <h2>Cartera de Cheques (Terceros y Propios)</h2>
            <div class="actions" style="flex-wrap:wrap;">
              <select id="cheq-f-origen" style="width:auto;">
                <option value="">Todos los orígenes</option>
                <option value="terceros" ${cheqFiltroOrigen === 'terceros' ? 'selected' : ''}>Terceros</option>
                <option value="propio" ${cheqFiltroOrigen === 'propio' ? 'selected' : ''}>Propios</option>
              </select>
              <select id="cheq-f-estado" style="width:auto;">
                <option value="">Todos los estados</option>
                ${['En Cartera', 'Depositado', 'Acreditado', 'Endosado', 'Emitido', 'Debitado', 'Rechazado'].map(st => `<option value="${st}" ${cheqFiltroEstado === st ? 'selected' : ''}>${st}</option>`).join('')}
              </select>
              <input type="text" id="cheq-f-search" value="${esc(cheqSearch)}" placeholder="Buscar N°, banco, librador..." style="width:210px;" />
            </div>
          </div>

          ${filtrados.length === 0 ? '<div class="empty-state">No hay cheques que coincidan con los filtros.</div>' : `
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Origen</th>
                    <th>N° / Banco</th>
                    <th>Librador / Contraparte</th>
                    <th>Emisión</th>
                    <th>Vencimiento</th>
                    <th>Cuenta Bancaria</th>
                    <th>Estado</th>
                    <th class="num">Monto</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  ${filtrados.map(c => {
                    const vencido = ['En Cartera', 'Depositado', 'Emitido'].includes(c.estado) && c.fecha_pago && c.fecha_pago < hoyIso;
                    const pronto = !vencido && ['En Cartera', 'Depositado', 'Emitido'].includes(c.estado) && c.fecha_pago && c.fecha_pago <= en7Dias;
                    return `
                      <tr>
                        <td>
                          <span class="badge ${c.origen === 'terceros' ? 'badge-info' : 'badge-warn'}">${c.origen === 'terceros' ? 'Tercero' : 'Propio'}</span>
                          <span class="muted" style="font-size:0.75rem;">${c.modalidad === 'comun' ? 'Común' : 'Diferido'}${c.echeq ? ' · E-Cheq' : ''}</span>
                        </td>
                        <td>
                          <strong>${esc(c.numero)}</strong>
                          ${c.banco ? `<div class="muted" style="font-size:0.78rem;">${esc(c.banco)}</div>` : ''}
                        </td>
                        <td>
                          <div>${esc(c.librador_nombre || c.contacto_origen_nombre || '-')}</div>
                          ${c.cuit_librador ? `<div class="muted" style="font-size:0.75rem;">CUIT ${esc(c.cuit_librador)}</div>` : ''}
                          ${c.contacto_destino_nombre ? `<div class="muted" style="font-size:0.75rem;">Endosado a: ${esc(c.contacto_destino_nombre)}</div>` : ''}
                        </td>
                        <td>${esc(c.fecha_emision || '-')}</td>
                        <td>
                          <span style="${vencido ? 'color:var(--color-accent);font-weight:700;' : pronto ? 'color:#b45309;font-weight:600;' : ''}">${esc(c.fecha_pago || '-')}</span>
                          ${vencido ? '<div class="muted" style="font-size:0.72rem;color:var(--color-accent);">Vencido</div>' : ''}
                        </td>
                        <td>${esc(c.cuenta_bancaria_nombre || '-')}</td>
                        <td><span class="badge ${badgeEstado(c.estado)}">${esc(c.estado)}</span></td>
                        <td class="num"><strong>${fmtMoney(c.monto)}</strong></td>
                        <td>
                          <div class="actions">
                            ${c.origen === 'terceros' && c.estado === 'En Cartera' ? `<button type="button" class="btn btn-sm btn-primary" data-cheq-depositar="${c.id}">Depositar</button>` : ''}
                            ${c.origen === 'terceros' && c.estado === 'Depositado' ? `<button type="button" class="btn btn-sm btn-primary" data-cheq-acreditar="${c.id}">Acreditar</button>` : ''}
                            ${c.origen === 'propio' && c.estado === 'Emitido' ? `<button type="button" class="btn btn-sm btn-primary" data-cheq-debitar="${c.id}">Debitar</button>` : ''}
                            ${!['Rechazado', 'Anulado'].includes(c.estado) ? `<button type="button" class="btn btn-sm btn-danger" data-cheq-rechazar="${c.id}">Rechazar</button>` : ''}
                          </div>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
        `;
      })() : ''}
    `;

    root.querySelector('#btn-toggle-asiento')?.addEventListener('click', () => {
      showAsientoForm = !showAsientoForm;
      loadAndRender();
    });

    if (showAsientoForm) {
      const syncAsHeader = () => {
        asientoFecha = root.querySelector('#as-fecha')?.value || asientoFecha;
        asientoDiarioId = root.querySelector('#as-diario')?.value ?? asientoDiarioId;
        asientoConcepto = root.querySelector('#as-concepto')?.value ?? asientoConcepto;
      };
      const syncAsTotals = () => {
        const sumD = asientoLineas.reduce((s, l) => s + (Number(l.debe) || 0), 0);
        const sumH = asientoLineas.reduce((s, l) => s + (Number(l.haber) || 0), 0);
        const diff = Math.abs(sumD - sumH);
        const dEl = root.querySelector('#as-sum-debe');
        const hEl = root.querySelector('#as-sum-haber');
        const mEl = root.querySelector('#as-balance-msg');
        if (dEl) dEl.textContent = fmtMoney(sumD);
        if (hEl) hEl.textContent = fmtMoney(sumH);
        if (mEl) {
          mEl.textContent = diff < 0.01 && sumD > 0 ? 'Balanceado' : `Diferencia: ${fmtMoney(diff)}`;
          mEl.style.color = diff < 0.01 && sumD > 0 ? 'var(--color-success)' : 'var(--color-accent)';
        }
      };
      root.querySelectorAll('.as-cuenta').forEach(sel => sel.addEventListener('change', () => {
        const i = Number(sel.dataset.idx);
        const pc = planCuentas.find(p => String(p.id) === String(sel.value));
        asientoLineas[i].plan_cuenta_id = sel.value ? Number(sel.value) : '';
        asientoLineas[i].cuenta_contable = pc ? `${pc.codigo} ${pc.nombre}` : '';
      }));
      root.querySelectorAll('.as-debe').forEach(inp => inp.addEventListener('input', () => {
        asientoLineas[Number(inp.dataset.idx)].debe = Number(inp.value) || 0;
        syncAsTotals();
      }));
      root.querySelectorAll('.as-haber').forEach(inp => inp.addEventListener('input', () => {
        asientoLineas[Number(inp.dataset.idx)].haber = Number(inp.value) || 0;
        syncAsTotals();
      }));
      root.querySelector('#btn-as-add-line')?.addEventListener('click', () => {
        syncAsHeader();
        asientoLineas.push({ plan_cuenta_id: '', cuenta_contable: '', debe: 0, haber: 0 });
        loadAndRender();
      });
      root.querySelectorAll('.as-del').forEach(btn => btn.addEventListener('click', () => {
        syncAsHeader();
        asientoLineas.splice(Number(btn.dataset.idx), 1);
        loadAndRender();
      }));
      root.querySelector('#form-asiento-manual')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        syncAsHeader();
        const validLines = asientoLineas.filter(l => (Number(l.debe) > 0 || Number(l.haber) > 0) && (l.plan_cuenta_id || l.cuenta_contable));
        if (validLines.length < 2) { toast('Ingresá al menos 2 líneas con cuenta e importe', true); return; }
        const sumD = validLines.reduce((s, l) => s + (Number(l.debe) || 0), 0);
        const sumH = validLines.reduce((s, l) => s + (Number(l.haber) || 0), 0);
        if (Math.abs(sumD - sumH) > 0.01) { toast('El asiento debe balancear (Debe = Haber)', true); return; }
        try {
          await api('/api/tesoreria/asientos', {
            method: 'POST',
            body: JSON.stringify({
              fecha: asientoFecha,
              diario_id: asientoDiarioId ? Number(asientoDiarioId) : null,
              concepto: asientoConcepto,
              lineas: validLines,
            }),
          });
          toast('Asiento manual registrado');
          showAsientoForm = false;
          asientoConcepto = '';
          asientoLineas = [
            { plan_cuenta_id: '', cuenta_contable: '', debe: 0, haber: 0 },
            { plan_cuenta_id: '', cuenta_contable: '', debe: 0, haber: 0 },
          ];
          await loadAndRender();
        } catch (err) { toast(err.message, true); }
      });
    }

    root.querySelectorAll('[data-rev-asiento]').forEach(btn => btn.addEventListener('click', async () => {
      if (!(await showConfirmModal('¿Generar contra-asiento de reversión?'))) return;
      try {
        await api(`/api/tesoreria/asientos/${btn.dataset.revAsiento}/revertir`, { method: 'POST', body: JSON.stringify({}) });
        toast('Asiento revertido mediante contra-asiento');
        await loadAndRender();
      } catch (err) { toast(err.message, true); }
    }));

    root.querySelectorAll('[data-tes-tab]').forEach(btn => btn.addEventListener('click', () => {
      activeTab = btn.dataset.tesTab;
      loadAndRender();
    }));

    root.querySelector('#cheq-f-origen')?.addEventListener('change', (e) => {
      cheqFiltroOrigen = e.target.value;
      loadAndRender();
    });
    root.querySelector('#cheq-f-estado')?.addEventListener('change', (e) => {
      cheqFiltroEstado = e.target.value;
      loadAndRender();
    });
    root.querySelector('#cheq-f-search')?.addEventListener('input', (e) => {
      cheqSearch = e.target.value;
      loadAndRender();
    });

    root.querySelectorAll('[data-cheq-depositar]').forEach(btn => btn.addEventListener('click', () => {
      const ch = cheques.find(x => String(x.id) === String(btn.dataset.cheqDepositar));
      const bancos = flujo.cuentas.filter(c => c.tipo !== 'efectivo');
      if (!bancos.length) { toast('No hay cuentas bancarias o billeteras configuradas', true); return; }
      const hoy = new Date().toISOString().slice(0, 10);
      createModal({
        title: `Depositar Cheque N° ${ch?.numero || ''}`,
        bodyHtml: `
          <div class="form-grid" style="grid-template-columns:1fr;">
            <label>
              <span>Cuenta Bancaria Destino *</span>
              <select id="mod-dep-cta">
                ${bancos.map(b => `<option value="${b.id}">${esc(b.nombre)} (${fmtMoney(b.saldo_actual)})</option>`).join('')}
              </select>
            </label>
            <label><span>Fecha de Depósito *</span><input type="date" id="mod-dep-fecha" value="${hoy}" /></label>
            <label style="flex-direction:row;align-items:center;gap:8px;cursor:pointer;">
              <input type="checkbox" id="mod-dep-acreditar" checked />
              <span>Acreditar saldo inmediatamente en banco</span>
            </label>
          </div>
        `,
        footerHtml: `
          <button type="button" class="btn" data-ve-cancel>Cancelar</button>
          <button type="button" class="btn btn-primary" data-ve-ok>Depositar</button>
        `,
        onMount: (el, cleanup) => {
          el.querySelector('[data-ve-cancel]')?.addEventListener('click', cleanup);
          el.querySelector('[data-ve-ok]')?.addEventListener('click', async () => {
            try {
              await api(`/api/tesoreria/cheques/${btn.dataset.cheqDepositar}/depositar`, {
                method: 'POST',
                body: JSON.stringify({
                  cuenta_id: Number(el.querySelector('#mod-dep-cta').value),
                  fecha: el.querySelector('#mod-dep-fecha').value || hoy,
                  acreditar: el.querySelector('#mod-dep-acreditar').checked,
                }),
              });
              cleanup();
              toast('Cheque depositado');
              await loadAndRender();
            } catch (err) { toast(err.message, true); }
          });
        },
      });
    }));

    root.querySelectorAll('[data-cheq-acreditar]').forEach(btn => btn.addEventListener('click', async () => {
      if (!(await showConfirmModal('¿Confirmar acreditación del cheque en la cuenta bancaria?', { danger: false }))) return;
      try {
        await api(`/api/tesoreria/cheques/${btn.dataset.cheqAcreditar}/acreditar`, { method: 'POST', body: JSON.stringify({}) });
        toast('Cheque acreditado en banco');
        await loadAndRender();
      } catch (err) { toast(err.message, true); }
    }));

    root.querySelectorAll('[data-cheq-debitar]').forEach(btn => btn.addEventListener('click', async () => {
      if (!(await showConfirmModal('¿Confirmar débito del cheque propio en la cuenta bancaria?', { danger: false }))) return;
      try {
        await api(`/api/tesoreria/cheques/${btn.dataset.cheqDebitar}/debitar`, { method: 'POST', body: JSON.stringify({}) });
        toast('Cheque propio debitado');
        await loadAndRender();
      } catch (err) { toast(err.message, true); }
    }));

    root.querySelectorAll('[data-cheq-rechazar]').forEach(btn => btn.addEventListener('click', () => {
      const ch = cheques.find(x => String(x.id) === String(btn.dataset.cheqRechazar));
      const hoy = new Date().toISOString().slice(0, 10);
      createModal({
        title: `Rechazar Cheque N° ${ch?.numero || ''}`,
        bodyHtml: `
          <div class="form-grid" style="grid-template-columns:1fr;">
            <label><span>Fecha de Rechazo *</span><input type="date" id="mod-rej-fecha" value="${hoy}" /></label>
            <label><span>Motivo del Rechazo</span><input type="text" id="mod-rej-motivo" placeholder="Ej: Sin fondos, firma difiere..." /></label>
            <label><span>Gastos Bancarios ($)</span><input type="number" step="0.01" min="0" id="mod-rej-gastos" value="0" /></label>
          </div>
        `,
        footerHtml: `
          <button type="button" class="btn" data-ve-cancel>Cancelar</button>
          <button type="button" class="btn btn-danger" data-ve-ok>Confirmar Rechazo</button>
        `,
        onMount: (el, cleanup) => {
          el.querySelector('[data-ve-cancel]')?.addEventListener('click', cleanup);
          el.querySelector('[data-ve-ok]')?.addEventListener('click', async () => {
            try {
              await api(`/api/tesoreria/cheques/${btn.dataset.cheqRechazar}/rechazar`, {
                method: 'POST',
                body: JSON.stringify({
                  fecha: el.querySelector('#mod-rej-fecha').value || hoy,
                  motivo: el.querySelector('#mod-rej-motivo').value,
                  gastos_bancarios: Number(el.querySelector('#mod-rej-gastos').value || 0),
                }),
              });
              cleanup();
              toast('Cheque marcado como rechazado y contra-asiento generado');
              await loadAndRender();
            } catch (err) { toast(err.message, true); }
          });
        },
      });
    }));

    root.querySelectorAll('[data-fc-gran]').forEach(btn => btn.addEventListener('click', () => {
      granularidad = btn.dataset.fcGran;
      loadAndRender();
    }));

    root.querySelector('#btn-toggle-hist-det')?.addEventListener('click', () => {
      showHistDetalle = !showHistDetalle;
      loadAndRender();
    });

    root.querySelector('#btn-toggle-proy-det')?.addEventListener('click', () => {
      showProyDetalle = !showProyDetalle;
      loadAndRender();
    });

    root.querySelector('#btn-fc-filtrar')?.addEventListener('click', () => {
      filtroCuenta = root.querySelector('#fc-cuenta')?.value || '';
      desde = root.querySelector('#fc-desde')?.value || '';
      hasta = root.querySelector('#fc-hasta')?.value || '';
      loadAndRender();
    });

    root.querySelector('#fc-proy-dias')?.addEventListener('change', (e) => {
      proyDias = Number(e.target.value) || 30;
      loadAndRender();
    });

    root.querySelector('#form-add-proyeccion')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api('/api/tesoreria/proyecciones', {
          method: 'POST',
          body: JSON.stringify({
            concepto: fd.get('concepto'),
            tipo: fd.get('tipo'),
            plan_cuenta_id: fd.get('plan_cuenta_id') ? Number(fd.get('plan_cuenta_id')) : null,
            frecuencia: fd.get('frecuencia'),
            fecha_inicio: fd.get('fecha_inicio'),
            fecha_fin: fd.get('fecha_fin') || '',
            monto: Number(fd.get('monto')),
          }),
        });
        toast('Proyección agregada');
        await loadAndRender();
      } catch (err) { toast(err.message, true); }
    });

    root.querySelectorAll('[data-toggle-proy]').forEach(btn => btn.addEventListener('click', async () => {
      try {
        const activo = btn.dataset.activo === '1' ? 0 : 1;
        await api(`/api/tesoreria/proyecciones/${btn.dataset.toggleProy}`, {
          method: 'PUT',
          body: JSON.stringify({ activo }),
        });
        toast(activo ? 'Proyección activada' : 'Proyección pausada');
        await loadAndRender();
      } catch (err) { toast(err.message, true); }
    }));

    root.querySelectorAll('[data-del-proy]').forEach(btn => btn.addEventListener('click', async () => {
      if (!(await showConfirmModal('¿Eliminar esta proyección?'))) return;
      try {
        await api(`/api/tesoreria/proyecciones/${btn.dataset.delProy}`, { method: 'DELETE' });
        toast('Proyección eliminada');
        await loadAndRender();
      } catch (err) { toast(err.message, true); }
    }));
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

  root.innerHTML = `
    <div class="page-header">
      <div>
        <div style="margin-bottom:6px;"><a href="/tesoreria" data-link class="muted" style="font-size:0.85rem;">← Volver a Tesorería</a></div>
        <h1>Pagos</h1>
      </div>
      <div class="actions">
        <a href="/tesoreria/pagos/nuevo" data-link class="btn btn-primary">+ Nuevo Pago</a>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><h2>Historial de Pagos</h2></div>
      <div id="pagos-table-wrap"></div>
    </div>
    <div id="pago-meta-panel"></div>
  `;

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

  root.innerHTML = `
    <div class="page-header">
      <div>
        <div style="margin-bottom:6px;"><a href="/tesoreria/pagos" data-link class="muted" style="font-size:0.85rem;">← Volver a Pagos</a></div>
        <h1>Nuevo Pago</h1>
        <p class="muted">Registrar orden de pago a proveedor o gasto operativo.</p>
      </div>
    </div>

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
  `;

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
        body: JSON.stringify({
          fecha: fd.get('fecha'),
          proveedor_id: fd.get('proveedor_id') ? Number(fd.get('proveedor_id')) : null,
          plan_cuenta_id: fd.get('plan_cuenta_id') ? Number(fd.get('plan_cuenta_id')) : null,
          categoria_gasto: fd.get('categoria_gasto'),
          numero: fd.get('numero'),
          concepto: fd.get('concepto'),
          lineas,
          retenciones,
          imputaciones: getPagoImputaciones(),
        }),
      });
      toast('Pago registrado');
      navigate('/tesoreria/pagos');
    } catch (err) { toast(err.message, true); }
  });
}

export async function renderCobrosView() {
  const root = document.getElementById('app-view');
  const cobros = await api('/api/tesoreria/cobros');

  root.innerHTML = `
    <div class="page-header">
      <div>
        <div style="margin-bottom:6px;"><a href="/tesoreria" data-link class="muted" style="font-size:0.85rem;">← Volver a Tesorería</a></div>
        <h1>Cobros</h1>
      </div>
      <div class="actions">
        <a href="/tesoreria/cobros/nuevo" data-link class="btn btn-primary">+ Nuevo Cobro</a>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><h2>Historial de Cobros</h2></div>
      <div id="cobros-table-wrap"></div>
    </div>
    <div id="cobro-meta-panel"></div>
  `;

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
}

export async function renderCobroFormView() {
  const root = document.getElementById('app-view');
  const [cuentas, clientes, puntosVenta, nextCobroSeq] = await Promise.all([
    api('/api/tesoreria/cuentas'),
    api('/api/contactos?es_cliente=1'),
    api('/api/puntos-venta'),
    api('/api/secuencias/siguiente?tipo=cobro'),
  ]);

  root.innerHTML = `
    <div class="page-header">
      <div>
        <div style="margin-bottom:6px;"><a href="/tesoreria/cobros" data-link class="muted" style="font-size:0.85rem;">← Volver a Cobros</a></div>
        <h1>Nuevo Cobro</h1>
        <p class="muted">Registrar recibo de cobro a cliente u otro ingreso.</p>
      </div>
    </div>

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
  `;

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
        body: JSON.stringify({
          fecha: fd.get('fecha'),
          cliente_id: fd.get('cliente_id') ? Number(fd.get('cliente_id')) : null,
          numero: fd.get('numero'),
          concepto: fd.get('concepto'),
          lineas,
          imputaciones: getCobroImputaciones(),
        }),
      });
      toast('Cobro registrado');
      navigate('/tesoreria/cobros');
    } catch (err) { toast(err.message, true); }
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
