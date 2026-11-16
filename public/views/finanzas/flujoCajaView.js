import { api, toast } from '../../lib/api.js';
import { esc, fmtMoney } from '../../lib/format.js';
import {
  mountPageView,
  renderMatrixTable,
  renderComboFlowChart,
  renderDataTable,
  showFormModal,
  showConfirmModal,
} from '../../lib/engine/index.js';

export async function renderFlujoCajaView() {
  const root = document.getElementById('app-view');
  let granularidad = 'semana';
  let histPeriodos = 4;
  let proyPeriodos = 6;
  let filtroCuenta = '';

  const loadAndRender = async () => {
    const qs = new URLSearchParams({
      granularidad,
      hist: String(histPeriodos),
      proy: String(proyPeriodos),
    });
    if (filtroCuenta) qs.set('cuenta_id', filtroCuenta);

    const [matriz, op, proyecciones, planCuentas] = await Promise.all([
      api(`/api/tesoreria/flujo-matriz?${qs.toString()}`),
      api('/api/tesoreria/flujo-operativo').catch(() => ({})),
      api('/api/tesoreria/proyecciones').catch(() => []),
      api('/api/tesoreria/plan-cuentas').catch(() => []),
    ]);

    const cuentasResultado = planCuentas.filter(pc => pc.activo !== 0 && pc.imputable !== 0 && (pc.tipo === 'egreso' || pc.tipo === 'ingreso'));
    const rowIngTotal = matriz.rows.find(r => r.id === 'ingresos_total');
    const rowEgrTotal = matriz.rows.find(r => r.id === 'egresos_total');
    const rowNeto = matriz.rows.find(r => r.id === 'flujo_neto');
    const rowSaldoFinal = matriz.rows.find(r => r.id === 'saldo_final');

    const chartSeries = (matriz.periods || []).map(p => ({
      key: p.key,
      label: p.label,
      sublabel: p.sublabel,
      kind: p.kind,
      isCurrent: p.isCurrent,
      entradas: Number(rowIngTotal?.values?.[p.key] || 0),
      salidas: Number(rowEgrTotal?.values?.[p.key] || 0),
      neto: Number(rowNeto?.values?.[p.key] || 0),
      saldo: Number(rowSaldoFinal?.values?.[p.key] || 0),
      minimo: 0,
    }));

    const openNuevaProyeccionModal = () => {
      const hoy = new Date().toISOString().slice(0, 10);
      showFormModal({
        title: 'Nuevo Gasto o Ingreso Recurrente / Estimado',
        submitText: '+ Agregar Proyección',
        initialState: {
          concepto: '',
          tipo: 'egreso',
          plan_cuenta_id: '',
          frecuencia: 'mensual',
          fecha_inicio: hoy,
          fecha_fin: '',
          monto: '',
        },
        fields: [
          { name: 'concepto', label: 'Concepto', type: 'text', required: true, placeholder: 'Ej: Alquiler Taller / Luz / Sueldos', full: true },
          {
            name: 'tipo',
            label: 'Tipo',
            type: 'select',
            searchable: false,
            options: [
              { value: 'egreso', label: 'Egreso (Gasto)' },
              { value: 'ingreso', label: 'Ingreso Estimado' },
            ],
          },
          {
            name: 'frecuencia',
            label: 'Frecuencia',
            type: 'select',
            searchable: false,
            options: [
              { value: 'mensual', label: 'Mensual' },
              { value: 'quincenal', label: 'Quincenal' },
              { value: 'semanal', label: 'Semanal' },
              { value: 'bimestral', label: 'Bimestral' },
              { value: 'trimestral', label: 'Trimestral' },
              { value: 'anual', label: 'Anual' },
              { value: 'unico', label: 'Único' },
            ],
          },
          {
            name: 'plan_cuenta_id',
            label: 'Cuenta Contable',
            type: 'select',
            options: [
              { value: '', label: '-- Sin cuenta asignada --' },
              ...cuentasResultado.map(pc => ({ value: String(pc.id), label: `${pc.codigo} — ${pc.nombre}` })),
            ],
          },
          { name: 'monto', label: 'Monto ($)', type: 'number', step: '0.01', min: '0.01', required: true, placeholder: '0.00' },
          { name: 'fecha_inicio', label: 'Fecha Inicio', type: 'date', required: true },
          { name: 'fecha_fin', label: 'Fecha Fin (Opcional)', type: 'date' },
        ],
        onSubmit: async (data) => {
          try {
            await api('/api/tesoreria/proyecciones', {
              method: 'POST',
              body: {
                concepto: data.concepto,
                tipo: data.tipo,
                plan_cuenta_id: data.plan_cuenta_id ? Number(data.plan_cuenta_id) : null,
                frecuencia: data.frecuencia,
                fecha_inicio: data.fecha_inicio,
                fecha_fin: data.fecha_fin || '',
                monto: Number(data.monto || 0),
              },
            });
            toast('Proyección recurrente agregada');
            await loadAndRender();
            return true;
          } catch (err) {
            toast(err.message, true);
            throw err;
          }
        },
      });
    };

    const matrizTabHtml = `
      <div class="card" style="margin-bottom:16px;">
        <div id="fc-chart-container"></div>
      </div>
      <div class="card">
        <div class="card-header">
          <div>
            <h2>Matriz de Flujo de Caja (${granularidad === 'semana' ? 'Semanal' : 'Mensual'})</h2>
            <span class="muted" style="font-size:0.82rem;">Hacé clic en cualquier monto subrayado para ver el desglose de comprobantes y vencimientos de ese período.</span>
          </div>
          <div class="actions" style="flex-wrap:wrap; gap:8px;">
            <div class="pill-group">
              <button type="button" class="pill ${granularidad === 'semana' ? 'active' : ''}" data-fc-gran="semana">Por Semana</button>
              <button type="button" class="pill ${granularidad === 'mes' ? 'active' : ''}" data-fc-gran="mes">Por Mes</button>
            </div>
            <select id="fc-cuenta" style="width:auto;">
              <option value="">Todas las cuentas</option>
              ${(matriz.cuentas || []).map(c => `<option value="${c.id}" ${String(c.id) === String(filtroCuenta) ? 'selected' : ''}>${esc(c.nombre)} (${fmtMoney(c.saldo_actual)})</option>`).join('')}
            </select>
            <select id="fc-hist-count" style="width:auto;" title="Períodos históricos hacia atrás">
              ${[2, 4, 6, 8].map(n => `<option value="${n}" ${histPeriodos === n ? 'selected' : ''}>${n} ${granularidad === 'semana' ? 'sem.' : 'meses'} hist.</option>`).join('')}
            </select>
            <select id="fc-proy-count" style="width:auto;" title="Períodos proyectados hacia adelante">
              ${[4, 6, 8, 12].map(n => `<option value="${n}" ${proyPeriodos === n ? 'selected' : ''}>+${n} ${granularidad === 'semana' ? 'sem.' : 'meses'} proy.</option>`).join('')}
            </select>
          </div>
        </div>
        <div id="fc-matrix-container"></div>
      </div>
    `;

    const recurrentesTabHtml = `
      <div class="card">
        <div class="card-header">
          <div>
            <h2>Gastos e Ingresos Recurrentes / Estimados</h2>
            <span class="muted" style="font-size:0.82rem;">Alquileres, sueldos, servicios fijos o ingresos estimados que alimentan las semanas proyectadas.</span>
          </div>
          <button type="button" id="btn-fc-new-proy" class="btn btn-primary btn-sm">+ Nueva Proyección</button>
        </div>
        <div id="fc-proy-table"></div>
      </div>
    `;

    mountPageView(root, {
      breadcrumb: { label: 'Tesorería', href: '/tesoreria' },
      title: 'Flujo de Caja',
      subtitle: 'Evolución continua de saldos, cobros, pagos comprometidos, cheques en cartera y gastos recurrentes.',
      actions: [
        { label: 'Cuentas', href: '/tesoreria/cuentas' },
        { label: 'Cheques', href: '/tesoreria/cheques' },
        { label: '+ Nuevo Pago', href: '/tesoreria/pagos/nuevo' },
        { label: '+ Nuevo Cobro', href: '/tesoreria/cobros/nuevo', primary: true },
      ],
      kpis: [
        { label: 'Caja Disponible', value: fmtMoney(matriz.caja_actual ?? op.caja_disponible ?? 0), href: '/tesoreria/cuentas' },
        { label: 'Ingresos', value: fmtMoney(rowIngTotal?.total ?? 0), tone: 'ok' },
        { label: 'Egresos', value: fmtMoney(rowEgrTotal?.total ?? 0), tone: (rowEgrTotal?.total ?? 0) > 0 ? 'danger' : 'default' },
        {
          label: 'Saldo Proyectado',
          value: fmtMoney(matriz.saldo_final_proyectado ?? 0),
          tone: (matriz.saldo_final_proyectado ?? 0) >= 0 ? 'ok' : 'danger',
        },
        {
          label: 'Posición Neta',
          value: fmtMoney(op.posicion_neta_proyectada ?? 0),
          hint: `Por cobrar ${fmtMoney(op.cuentas_por_cobrar ?? 0)} · Por pagar ${fmtMoney(op.cuentas_por_pagar ?? 0)}`,
        },
      ],
      tabs: [
        {
          id: 'matriz',
          label: 'Matriz de Flujo',
          badge: matriz.periods.length,
          html: matrizTabHtml,
          onMount: (panelEl) => {
            renderComboFlowChart(panelEl.querySelector('#fc-chart-container'), {
              series: chartSeries,
              formatValue: (v) => fmtMoney(v),
              title: 'Evolución de Saldo de Caja e Ingresos / Egresos por Período',
              subtitle: 'Línea continua: Saldo Real · Línea punteada: Saldo Proyectado · Barras: Ingresos (+) y Egresos (-)',
              showMinLine: false,
            });
            renderMatrixTable(panelEl.querySelector('#fc-matrix-container'), {
              periods: matriz.periods,
              rows: matriz.rows,
              totalColLabel: 'Total / Cierre',
            });
            panelEl.querySelectorAll('[data-fc-gran]').forEach(btn => btn.addEventListener('click', () => {
              granularidad = btn.dataset.fcGran;
              loadAndRender();
            }));
            panelEl.querySelector('#fc-cuenta')?.addEventListener('change', (e) => {
              filtroCuenta = e.target.value;
              loadAndRender();
            });
            panelEl.querySelector('#fc-hist-count')?.addEventListener('change', (e) => {
              histPeriodos = Number(e.target.value) || 4;
              loadAndRender();
            });
            panelEl.querySelector('#fc-proy-count')?.addEventListener('change', (e) => {
              proyPeriodos = Number(e.target.value) || 6;
              loadAndRender();
            });
          },
        },
        {
          id: 'recurrentes',
          label: 'Proyecciones Recurrentes',
          badge: proyecciones.length,
          html: recurrentesTabHtml,
          onMount: (panelEl) => {
            panelEl.querySelector('#btn-fc-new-proy')?.addEventListener('click', openNuevaProyeccionModal);
            renderDataTable(panelEl.querySelector('#fc-proy-table'), {
              rows: proyecciones,
              emptyText: 'No hay gastos o ingresos recurrentes configurados.',
              exportFilename: 'proyecciones_recurrentes.csv',
              columns: [
                { label: 'Concepto', render: p => `<strong>${esc(p.concepto)}</strong>` },
                {
                  label: 'Tipo',
                  render: p => `<span class="badge ${p.tipo === 'ingreso' ? 'badge-ok' : 'badge-warn'}">${p.tipo === 'ingreso' ? 'Ingreso' : 'Egreso'}</span>`,
                },
                { label: 'Cuenta Contable', render: p => esc(p.plan_cuenta_nombre || p.categoria || '-') },
                { label: 'Frecuencia', render: p => esc(p.frecuencia) },
                { label: 'Vigencia', render: p => `${esc(p.fecha_inicio)}${p.fecha_fin ? ` → ${esc(p.fecha_fin)}` : ''}` },
                { label: 'Monto', align: 'right', render: p => `<strong>${fmtMoney(p.monto)}</strong>` },
                {
                  label: 'Estado',
                  render: p => `<span class="badge ${p.activo !== 0 ? 'badge-ok' : 'badge-muted'}">${p.activo !== 0 ? 'Activo' : 'Pausado'}</span>`,
                },
                {
                  label: 'Acciones',
                  render: p => `
                    <div class="actions">
                      <button type="button" class="btn btn-sm" data-toggle-proy="${p.id}" data-activo="${p.activo !== 0 ? 1 : 0}">${p.activo !== 0 ? 'Pausar' : 'Activar'}</button>
                      <button type="button" class="btn btn-sm btn-danger" data-del-proy="${p.id}">Eliminar</button>
                    </div>
                  `,
                },
              ],
            });

            panelEl.querySelectorAll('[data-toggle-proy]').forEach(btn => btn.addEventListener('click', async () => {
              try {
                const activo = btn.dataset.activo === '1' ? 0 : 1;
                await api(`/api/tesoreria/proyecciones/${btn.dataset.toggleProy}`, {
                  method: 'PUT',
                  body: { activo },
                });
                toast(activo ? 'Proyección activada' : 'Proyección pausada');
                await loadAndRender();
              } catch (err) { toast(err.message, true); }
            }));

            panelEl.querySelectorAll('[data-del-proy]').forEach(btn => btn.addEventListener('click', async () => {
              if (!(await showConfirmModal('¿Eliminar esta proyección recurrente?'))) return;
              try {
                await api(`/api/tesoreria/proyecciones/${btn.dataset.delProy}`, { method: 'DELETE' });
                toast('Proyección eliminada');
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
