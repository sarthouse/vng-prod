import { api, toast } from '../../lib/api.js';
import { esc, fmtMoney } from '../../lib/format.js';
import { mountFormFields, renderDataTable, renderKpiStrip, renderFilterBar, renderSpreadsheetTable } from '../../lib/engine/index.js';
import { showConfirmModal, createModal } from '../../lib/engine/index.js';
import { navigate } from '../../router.js';

export async function renderLibroDiarioView() {
  const root = document.getElementById('app-view');
  let search = '';
  let filtroDiario = '';
  let filtroEstado = '';
  let desde = '';
  let hasta = '';
  let viewMode = 'asientos'; // 'asientos' (1 fila por documento) | 'diario' (líneas expandidas)

  const [diarios, planCuentas] = await Promise.all([
    api('/api/tesoreria/diarios').catch(() => []),
    api('/api/tesoreria/plan-cuentas').catch(() => []),
  ]);

  const draw = async () => {
    const qs = new URLSearchParams();
    if (filtroDiario) qs.set('diario_id', filtroDiario);
    if (filtroEstado) qs.set('estado', filtroEstado);
    if (desde) qs.set('desde', desde);
    if (hasta) qs.set('hasta', hasta);

    const allAsientos = await api(`/api/tesoreria/asientos?${qs.toString()}`);
    const q = search.trim().toLowerCase();
    const asientos = q
      ? allAsientos.filter(a =>
          (a.numero || '').toLowerCase().includes(q)
          || (a.concepto || '').toLowerCase().includes(q)
          || (a.lineas || []).some(l => (l.cuenta_contable || '').toLowerCase().includes(q))
        )
      : allAsientos;

    const totalDebe = asientos.filter(a => a.estado === 'Confirmado').reduce((s, a) => s + a.lineas.reduce((sl, l) => sl + (Number(l.debe) || 0), 0), 0);
    const confirmados = asientos.filter(a => a.estado === 'Confirmado').length;

    root.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Libro Diario</h1>
          <p class="muted">Asientos automáticos y manuales de partida doble.</p>
        </div>
        <div class="actions">
          <a href="/contabilidad/asientos/nuevo" data-link class="btn btn-primary">+ Nuevo Asiento</a>
        </div>
      </div>

      <div id="ld-kpis"></div>

      <div class="card">
        <div class="card-header">
          <h2>${viewMode === 'asientos' ? 'Asientos Contables' : 'Detalle por Línea'}</h2>
          <div class="pill-group">
            <button type="button" class="pill ${viewMode === 'asientos' ? 'active' : ''}" data-ld-mode="asientos">Por Asiento</button>
            <button type="button" class="pill ${viewMode === 'diario' ? 'active' : ''}" data-ld-mode="diario">Líneas Expandidas</button>
          </div>
        </div>
        <div id="ld-filterbar"></div>
        <div class="toolbar sx-1e3191">
          <input type="date" id="ld-f-desde" value="${esc(desde)}" title="Desde" />
          <input type="date" id="ld-f-hasta" value="${esc(hasta)}" title="Hasta" />
          <button type="button" id="btn-ld-fechas" class="btn btn-sm btn-primary">Aplicar Fechas</button>
        </div>
        <div id="ld-table"></div>
      </div>
    `;

    renderKpiStrip(root.querySelector('#ld-kpis'), [
      { label: 'Asientos en Período', value: String(asientos.length) },
      { label: 'Confirmados', value: String(confirmados), tone: 'success' },
      { label: 'Volumen Contabilizado', value: fmtMoney(totalDebe) },
      { label: 'Cuentas Activas', value: String(planCuentas.filter(p => p.activo !== 0).length), href: '/contabilidad/plan-cuentas' },
    ]);

    renderFilterBar(root.querySelector('#ld-filterbar'), {
      searchValue: search,
      searchPlaceholder: 'Buscar número, concepto o cuenta...',
      filters: [
        {
          name: 'diario_id',
          value: filtroDiario,
          options: [
            { value: '', label: 'Todos los diarios' },
            ...diarios.map(d => ({ value: d.id, label: `${d.codigo} — ${d.nombre}` })),
          ],
        },
        {
          name: 'estado',
          value: filtroEstado,
          options: [
            { value: '', label: 'Todos los estados' },
            { value: 'Confirmado', label: 'Confirmado' },
            { value: 'Revertido', label: 'Revertido' },
          ],
        },
      ],
      onChange: (st) => {
        const needFetch = st.diario_id !== filtroDiario || st.estado !== filtroEstado;
        search = st.search;
        filtroDiario = st.diario_id;
        filtroEstado = st.estado;
        if (needFetch) draw();
        else drawTable();
      },
    });

    const openAsientoDetail = (a) => {
      const sumD = (a.lineas || []).reduce((s, l) => s + (Number(l.debe) || 0), 0);
      const sumH = (a.lineas || []).reduce((s, l) => s + (Number(l.haber) || 0), 0);
      const originLink = a.tipo_origen === 'venta' && a.origen_id
        ? `<a href="/ventas/${a.origen_id}" data-link class="btn btn-sm" id="ld-modal-orig-link">Ir a Venta #${a.origen_id}</a>`
        : '';
      const { close } = createModal({
        title: `Asiento ${a.numero || `#${a.id}`}`,
        bodyHtml: `
          <div class="detail-meta sx-04f840">
            <div><span>Fecha</span><strong>${esc(a.fecha)}</strong></div>
            <div><span>Diario</span><strong>${esc(a.diario_codigo || a.tipo_origen)}</strong></div>
            <div><span>Estado</span><strong>${esc(a.estado)}</strong></div>
            <div><span>Origen</span><strong>${esc(a.tipo_origen)}</strong></div>
          </div>
          <p class="sx-04f840"><strong>Concepto:</strong> ${esc(a.concepto || '-')}</p>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Cuenta Contable</th>
                  <th class="num w-130">Debe</th>
                  <th class="num w-130">Haber</th>
                </tr>
              </thead>
              <tbody>
                ${(a.lineas || []).map(l => `
                  <tr>
                    <td>${esc(l.cuenta_contable)}</td>
                    <td class="num">${l.debe > 0 ? fmtMoney(l.debe) : '-'}</td>
                    <td class="num">${l.haber > 0 ? fmtMoney(l.haber) : '-'}</td>
                  </tr>
                `).join('')}
              </tbody>
              <tfoot>
                <tr>
                  <td><strong>Totales</strong></td>
                  <td class="num"><strong>${fmtMoney(sumD)}</strong></td>
                  <td class="num"><strong>${fmtMoney(sumH)}</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>
        `,
        footerHtml: `
          ${originLink}
          <button type="button" class="btn btn-primary" id="ld-modal-close">Cerrar</button>
        `,
        onMount: (modalEl) => {
          modalEl.querySelector('#ld-modal-close')?.addEventListener('click', () => close());
          modalEl.querySelector('#ld-modal-orig-link')?.addEventListener('click', () => close());
        },
      });
    };

    const drawTable = () => {
      const filtered = search.trim()
        ? allAsientos.filter(a => {
            const ql = search.trim().toLowerCase();
            return (a.numero || '').toLowerCase().includes(ql)
              || (a.concepto || '').toLowerCase().includes(ql)
              || (a.lineas || []).some(l => (l.cuenta_contable || '').toLowerCase().includes(ql));
          })
        : allAsientos;

      if (viewMode === 'asientos') {
        renderDataTable(root.querySelector('#ld-table'), {
          emptyText: 'Sin asientos registrados en el período.',
          columns: [
            { label: 'Fecha', render: a => esc(a.fecha) },
            { label: 'Número', render: a => `<strong>${esc(a.numero || `#${a.id}`)}</strong>` },
            { label: 'Diario', render: a => `<span class="badge badge-muted">${esc(a.diario_codigo || a.tipo_origen)}</span>` },
            { label: 'Concepto', render: a => esc(a.concepto) },
            {
              label: 'Debe',
              align: 'right',
              render: a => fmtMoney((a.lineas || []).reduce((s, l) => s + (Number(l.debe) || 0), 0)),
            },
            {
              label: 'Haber',
              align: 'right',
              render: a => fmtMoney((a.lineas || []).reduce((s, l) => s + (Number(l.haber) || 0), 0)),
            },
            {
              label: 'Estado',
              render: a => `<span class="badge ${a.estado === 'Confirmado' ? 'badge-ok' : 'badge-warn'}">${esc(a.estado)}</span>`,
            },
            {
              label: '',
              align: 'right',
              render: a => `
                <div class="actions justify-end">
                  <button type="button" class="btn btn-sm" data-ld-det="${a.id}">Detalle</button>
                  ${a.estado === 'Confirmado' ? `<button type="button" class="btn btn-sm btn-danger" data-ld-rev="${a.id}">Revertir</button>` : ''}
                </div>
              `,
            },
          ],
          rows: filtered,
        });
      } else {
        const flatRows = filtered.flatMap(a =>
          a.lineas.map((l, idx) => ({ ...l, _asiento: a, _first: idx === 0 }))
        );

        renderDataTable(root.querySelector('#ld-table'), {
          emptyText: 'Sin asientos registrados en el período.',
          columns: [
            { label: 'Fecha', render: r => (r._first ? esc(r._asiento.fecha) : '') },
            {
              label: 'Número / Diario',
              render: r => (r._first
                ? `<strong>${esc(r._asiento.numero || `#${r._asiento.id}`)}</strong> <span class="badge badge-muted">${esc(r._asiento.diario_codigo || r._asiento.tipo_origen)}</span>${r._asiento.estado === 'Revertido' ? ' <span class="badge badge-warn">Revertido</span>' : ''}`
                : ''),
            },
            { label: 'Concepto', render: r => (r._first ? esc(r._asiento.concepto) : '') },
            { label: 'Cuenta Contable', render: r => esc(r.cuenta_contable) },
            { label: 'Debe', align: 'right', render: r => (r.debe > 0 ? fmtMoney(r.debe) : '-') },
            { label: 'Haber', align: 'right', render: r => (r.haber > 0 ? fmtMoney(r.haber) : '-') },
            {
              label: '',
              align: 'right',
              render: r => (r._first && r._asiento.estado === 'Confirmado'
                ? `<button type="button" class="btn btn-sm btn-danger" data-ld-rev="${r._asiento.id}">Revertir</button>`
                : ''),
            },
          ],
          rows: flatRows,
        });
      }

      root.querySelectorAll('[data-ld-det]').forEach(btn => btn.addEventListener('click', () => {
        const found = filtered.find(a => String(a.id) === String(btn.dataset.ldDet));
        if (found) openAsientoDetail(found);
      }));

      root.querySelectorAll('[data-ld-rev]').forEach(btn => btn.addEventListener('click', async () => {
        if (!(await showConfirmModal('¿Generar contra-asiento de reversión?'))) return;
        try {
          await api(`/api/tesoreria/asientos/${btn.dataset.ldRev}/revertir`, { method: 'POST', body: JSON.stringify({}) });
          toast('Asiento revertido');
          await draw();
        } catch (err) { toast(err.message, true); }
      }));
    };

    drawTable();

    root.querySelectorAll('[data-ld-mode]').forEach(btn => btn.addEventListener('click', () => {
      viewMode = btn.dataset.ldMode;
      draw();
    }));

    root.querySelector('#btn-ld-fechas')?.addEventListener('click', () => {
      desde = root.querySelector('#ld-f-desde')?.value || '';
      hasta = root.querySelector('#ld-f-hasta')?.value || '';
      draw();
    });
  };

  await draw();
}

export async function renderAsientoNuevoView() {
  const root = document.getElementById('app-view');
  const [planCuentas, diarios] = await Promise.all([
    api('/api/tesoreria/plan-cuentas').catch(() => []),
    api('/api/tesoreria/diarios').catch(() => []),
  ]);

  const asientoState = {
    fecha: new Date().toISOString().slice(0, 10),
    diario_id: '',
    concepto: '',
  };
  const asientoLineas = [
    { plan_cuenta_id: '', cuenta_contable: '', debe: 0, haber: 0 },
    { plan_cuenta_id: '', cuenta_contable: '', debe: 0, haber: 0 },
  ];

  const draw = () => {
    const sumD = asientoLineas.reduce((s, l) => s + (Number(l.debe) || 0), 0);
    const sumH = asientoLineas.reduce((s, l) => s + (Number(l.haber) || 0), 0);
    const diff = Math.abs(sumD - sumH);

    root.innerHTML = `
      <div class="page-header">
        <div>
          <div class="mb-xs"><a href="/contabilidad" data-link class="muted text-md">← Volver al Libro Diario</a></div>
          <h1>Nuevo Asiento Contable</h1>
          <p class="muted">Asiento manual de partida doble.</p>
        </div>
      </div>

      <div class="card">
        <form id="form-ld-asiento">
          <div id="ld-asiento-fields" class="form-grid sx-402564"></div>
          <div id="ld-asiento-sheet"></div>
          <div class="actions sx-852493">
            <a href="/contabilidad" data-link class="btn">Cancelar</a>
            <button type="submit" class="btn btn-primary">Registrar Asiento</button>
          </div>
        </form>
      </div>
    `;

    mountFormFields(root.querySelector('#ld-asiento-fields'), [
      { name: 'fecha', label: 'Fecha', type: 'date', required: true },
      {
        name: 'diario_id',
        label: 'Diario',
        type: 'select',
        options: [
          { value: '', label: 'General / Sin diario' },
          ...diarios.map(d => ({ value: d.id, label: `${d.codigo} — ${d.nombre}` })),
        ],
      },
      { name: 'concepto', label: 'Concepto', type: 'text', required: true, full: true, placeholder: 'Ej: Ajuste / Devengamiento...' },
    ], asientoState);

    const syncTotals = () => {
      const sD = asientoLineas.reduce((s, l) => s + (Number(l.debe) || 0), 0);
      const sH = asientoLineas.reduce((s, l) => s + (Number(l.haber) || 0), 0);
      const df = Math.abs(sD - sH);
      const dEl = root.querySelector('#ld-sum-debe');
      const hEl = root.querySelector('#ld-sum-haber');
      const mEl = root.querySelector('#ld-balance-msg');
      if (dEl) dEl.textContent = fmtMoney(sD);
      if (hEl) hEl.textContent = fmtMoney(sH);
      if (mEl) {
        mEl.textContent = df < 0.01 && sD > 0 ? 'Balanceado' : `Diferencia: ${fmtMoney(df)}`;
        mEl.style.color = df < 0.01 && sD > 0 ? 'var(--color-success)' : 'var(--color-accent)';
      }
    };

    const cuentaOpts = planCuentas
      .filter(pc => pc.activo !== 0)
      .map(pc => ({ value: String(pc.id), label: `${pc.codigo} — ${pc.nombre} (${pc.tipo})`, raw: pc }));

    const renderAsientoSheet = () => {
      const sheetHost = root.querySelector('#ld-asiento-sheet');
      if (!sheetHost) return;
      const sD = asientoLineas.reduce((s, l) => s + (Number(l.debe) || 0), 0);
      const sH = asientoLineas.reduce((s, l) => s + (Number(l.haber) || 0), 0);
      const df = Math.abs(sD - sH);
      renderSpreadsheetTable(sheetHost, {
        rows: asientoLineas,
        compact: true,
        showDirty: false,
        addRowLabel: '+ Línea',
        tfootHtml: `
          <tr>
            <td>
              <span id="ld-balance-msg" class="text-sm" style="color:${df < 0.01 && sD > 0 ? 'var(--color-success)' : 'var(--color-accent)'};">
                ${df < 0.01 && sD > 0 ? 'Balanceado' : `Diferencia: ${fmtMoney(df)}`}
              </span>
            </td>
            <td class="num"><strong id="ld-sum-debe">${fmtMoney(sD)}</strong></td>
            <td class="num"><strong id="ld-sum-haber">${fmtMoney(sH)}</strong></td>
            <td></td>
          </tr>
        `,
        columns: [
          {
            key: 'plan_cuenta_id',
            label: 'Cuenta Contable',
            type: 'combobox',
            placeholder: 'Buscar cuenta...',
            options: cuentaOpts,
            onPickItem: (l, pc) => {
              l.plan_cuenta_id = pc?.id ? Number(pc.id) : '';
              l.cuenta_contable = pc ? `${pc.codigo} ${pc.nombre}` : '';
            },
            render: (l) => l.cuenta_contable ? esc(l.cuenta_contable) : '<span class="muted">Elegir cuenta...</span>',
          },
          {
            key: 'debe',
            label: 'Debe',
            type: 'number',
            step: 0.01,
            min: 0,
            align: 'right',
            render: (l) => (Number(l.debe) ? fmtMoney(l.debe) : '<span class="muted">$0,00</span>'),
            parse: (v) => Math.max(0, Number(v) || 0),
          },
          {
            key: 'haber',
            label: 'Haber',
            type: 'number',
            step: 0.01,
            min: 0,
            align: 'right',
            render: (l) => (Number(l.haber) ? fmtMoney(l.haber) : '<span class="muted">$0,00</span>'),
            parse: (v) => Math.max(0, Number(v) || 0),
          },
        ],
        onAddRow: () => {
          asientoLineas.push({ plan_cuenta_id: '', cuenta_contable: '', debe: 0, haber: 0 });
          renderAsientoSheet();
        },
        onDeleteRow: (_row, idx) => {
          if (asientoLineas.length <= 2) { toast('Un asiento debe tener al menos 2 líneas', true); return; }
          asientoLineas.splice(idx, 1);
          renderAsientoSheet();
        },
        onCellChange: () => syncTotals(),
      });
    };
    renderAsientoSheet();
    root.querySelector('#form-ld-asiento')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const validLines = asientoLineas.filter(l => (Number(l.debe) > 0 || Number(l.haber) > 0) && (l.plan_cuenta_id || l.cuenta_contable));
      if (validLines.length < 2) { toast('Ingresá al menos 2 líneas con cuenta e importe', true); return; }
      try {
        await api('/api/tesoreria/asientos', {
          method: 'POST',
          body: JSON.stringify({
            fecha: asientoState.fecha,
            diario_id: asientoState.diario_id ? Number(asientoState.diario_id) : null,
            concepto: asientoState.concepto,
            lineas: validLines,
          }),
        });
        toast('Asiento registrado');
        navigate('/contabilidad');
      } catch (err) { toast(err.message, true); }
    });
  };

  draw();
}

export async function renderLibroMayorView() {
  const root = document.getElementById('app-view');
  const planCuentas = await api('/api/tesoreria/plan-cuentas').catch(() => []);
  const filterState = {
    plan_cuenta_id: planCuentas[0]?.id ? String(planCuentas[0].id) : '',
    desde: '',
    hasta: '',
  };

  const draw = async () => {
    const qs = new URLSearchParams();
    if (filterState.plan_cuenta_id) qs.set('plan_cuenta_id', filterState.plan_cuenta_id);
    if (filterState.desde) qs.set('desde', filterState.desde);
    if (filterState.hasta) qs.set('hasta', filterState.hasta);
    const mayor = await api(`/api/tesoreria/libro-mayor?${qs.toString()}`).catch(() => ({ cuenta: null, movimientos: [], total_debe: 0, total_haber: 0, saldo_final: 0 }));

    root.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Libro Mayor</h1>
          <p class="muted">Movimientos y saldo acumulado por cuenta del Plan de Cuentas.</p>
        </div>
      </div>

      <div class="card">
        <div id="lm-fields" class="form-grid sx-3b2074"></div>
      </div>

      <div id="lm-kpis"></div>

      <div class="card">
        <div class="card-header"><h2>Movimientos</h2></div>
        <div id="lm-table"></div>
      </div>
    `;

    mountFormFields(root.querySelector('#lm-fields'), [
      {
        name: 'plan_cuenta_id',
        label: 'Cuenta Contable',
        type: 'combobox',
        items: planCuentas.map(pc => ({ value: String(pc.id), label: `${pc.codigo} — ${pc.nombre}`, sublabel: pc.tipo })),
      },
      { name: 'desde', label: 'Desde', type: 'date' },
      { name: 'hasta', label: 'Hasta', type: 'date' },
    ], filterState, { onChange: () => draw() });

    if (mayor.cuenta) {
      renderKpiStrip(root.querySelector('#lm-kpis'), [
        { label: 'Cuenta', value: `${mayor.cuenta.codigo} — ${mayor.cuenta.nombre}`, sublabel: `Naturaleza: ${mayor.cuenta.naturaleza}` },
        { label: 'Total Debe', value: fmtMoney(mayor.total_debe) },
        { label: 'Total Haber', value: fmtMoney(mayor.total_haber) },
        { label: 'Saldo Final', value: fmtMoney(mayor.saldo_final), tone: mayor.saldo_final >= 0 ? 'success' : 'accent' },
      ]);
    }

    renderDataTable(root.querySelector('#lm-table'), {
      emptyText: 'Sin movimientos confirmados para esta cuenta en el período.',
      columns: [
        { label: 'Fecha', key: 'fecha' },
        { label: 'Asiento', render: r => `<strong>${esc(r.asiento_numero || `#${r.asiento_id}`)}</strong>` },
        { label: 'Origen', render: r => `<span class="badge badge-muted">${esc(r.diario_codigo || r.tipo_origen)}</span>` },
        { label: 'Concepto', key: 'concepto' },
        { label: 'Debe', align: 'right', render: r => (r.debe > 0 ? fmtMoney(r.debe) : '-') },
        { label: 'Haber', align: 'right', render: r => (r.haber > 0 ? fmtMoney(r.haber) : '-') },
        { label: 'Saldo Acum.', align: 'right', render: r => `<strong>${fmtMoney(r.saldo_acumulado)}</strong>` },
      ],
      rows: mayor.movimientos,
    });
  };

  await draw();
}

export async function renderBalanceResultadosView() {
  const root = document.getElementById('app-view');
  const periodState = { desde: '', hasta: '' };

  const draw = async () => {
    const qs = new URLSearchParams();
    if (periodState.desde) qs.set('desde', periodState.desde);
    if (periodState.hasta) qs.set('hasta', periodState.hasta);

    const [balance, er] = await Promise.all([
      api(`/api/tesoreria/balance?${qs.toString()}`).catch(() => []),
      api(`/api/tesoreria/estado-resultados?${qs.toString()}`).catch(() => ({ ingresos: [], egresos: [], total_ingresos: 0, total_egresos: 0, resultado_neto: 0 })),
    ]);

    const totDebe = balance.reduce((s, r) => s + Number(r.total_debe || 0), 0);
    const totHaber = balance.reduce((s, r) => s + Number(r.total_haber || 0), 0);

    root.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Balance</h1>
          <p class="muted">Estado de Resultados y Balance de Sumas y Saldos.</p>
        </div>
      </div>

      <div class="card">
        <div id="br-fields" class="form-grid mb-0"></div>
      </div>

      <div id="br-kpis"></div>

      <div class="dashboard-grid sx-dff70c">
        <div class="card mb-0">
          <div class="card-header"><h2>Ingresos</h2></div>
          <div id="br-ingresos"></div>
        </div>
        <div class="card mb-0">
          <div class="card-header"><h2>Costos y Gastos</h2></div>
          <div id="br-egresos"></div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h2>Balance de Sumas y Saldos</h2>
          <span class="muted text-sm">Debe: <strong>${fmtMoney(totDebe)}</strong> · Haber: <strong>${fmtMoney(totHaber)}</strong></span>
        </div>
        <div id="br-balance"></div>
      </div>
    `;

    mountFormFields(root.querySelector('#br-fields'), [
      { name: 'desde', label: 'Período Desde', type: 'date' },
      { name: 'hasta', label: 'Período Hasta', type: 'date' },
    ], periodState, { onChange: () => draw() });

    renderKpiStrip(root.querySelector('#br-kpis'), [
      { label: 'Total Ingresos', value: fmtMoney(er.total_ingresos), tone: 'success' },
      { label: 'Total Egresos / Costos', value: fmtMoney(er.total_egresos), tone: 'accent' },
      { label: 'Resultado Neto', value: fmtMoney(er.resultado_neto), tone: er.resultado_neto >= 0 ? 'success' : 'accent' },
      { label: 'Cuadre Sumas (D - H)', value: fmtMoney(totDebe - totHaber) },
    ]);

    renderDataTable(root.querySelector('#br-ingresos'), {
      emptyText: 'Sin ingresos imputados.',
      columns: [
        { label: 'Cuenta', render: r => `${esc(r.codigo)} ${esc(r.nombre)}` },
        { label: 'Importe', align: 'right', render: r => `<strong>${fmtMoney(r.importe)}</strong>` },
      ],
      rows: er.ingresos,
    });

    renderDataTable(root.querySelector('#br-egresos'), {
      emptyText: 'Sin egresos imputados.',
      columns: [
        { label: 'Cuenta', render: r => `${esc(r.codigo)} ${esc(r.nombre)}` },
        { label: 'Importe', align: 'right', render: r => `<strong>${fmtMoney(r.importe)}</strong>` },
      ],
      rows: er.egresos,
    });

    renderDataTable(root.querySelector('#br-balance'), {
      emptyText: 'Sin movimientos contables en el período.',
      columns: [
        { label: 'Código', render: r => `<strong>${esc(r.codigo || '-')}</strong>` },
        { label: 'Cuenta', key: 'nombre' },
        { label: 'Tipo', render: r => `<span class="badge badge-muted">${esc(r.tipo || 'otra')}</span>` },
        { label: 'Suma Debe', align: 'right', render: r => fmtMoney(r.total_debe) },
        { label: 'Suma Haber', align: 'right', render: r => fmtMoney(r.total_haber) },
        { label: 'Saldo', align: 'right', render: r => `<strong>${fmtMoney(r.saldo)}</strong>` },
      ],
      rows: balance,
    });
  };

  await draw();
}

export async function renderPlanCuentasView() {
  const root = document.getElementById('app-view');

  const draw = async () => {
    const [planCuentas, diarios, plantillas, puntosVenta] = await Promise.all([
      api('/api/tesoreria/plan-cuentas').catch(() => []),
      api('/api/tesoreria/diarios').catch(() => []),
      api('/api/tesoreria/plan-cuentas/plantillas').catch(() => []),
      api('/api/puntos-venta').catch(() => []),
    ]);

    root.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Plan de Cuentas</h1>
          <p class="muted">Estructura de cuentas contables y diarios de imputación.</p>
        </div>
      </div>

      <div id="pc-kpis"></div>

      <div class="card">
        <div class="card-header">
          <div>
            <h2>Plantilla de Plan de Cuentas</h2>
            <span class="muted text-sm">Elegí la estructura contable acorde al régimen fiscal de la empresa.</span>
          </div>
        </div>
        <form id="form-apply-tpl" class="toolbar sx-d731c2">
          <select name="plantilla_id" id="pc-tpl-select" class="sx-e7fcff">
            ${plantillas.map(t => `<option value="${esc(t.id)}">${esc(t.nombre)} (${t.cantidad_cuentas} cuentas)</option>`).join('')}
          </select>
          <button type="submit" class="btn btn-primary btn-sm">Aplicar Plantilla</button>
          <span class="muted text-sm" id="pc-tpl-desc">${esc(plantillas[0]?.descripcion || '')}</span>
        </form>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h2>Plan de Cuentas</h2>
            <span class="muted text-sm">Click en una celda para editar · Completá Código y Nombre en la fila inferior para agregar una cuenta.</span>
          </div>
        </div>
        <div id="pc-table"></div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h2>Diarios Contables</h2>
            <span class="muted text-sm">Click en una celda para editar · Completá Código y Nombre en la fila inferior para agregar un diario.</span>
          </div>
        </div>
        <div id="pc-diarios-table"></div>
      </div>
    `;

    renderKpiStrip(root.querySelector('#pc-kpis'), [
      { label: 'Total Cuentas', value: String(planCuentas.length) },
      { label: 'Activas', value: String(planCuentas.filter(p => p.activo !== 0).length), tone: 'success' },
      { label: 'Cuentas de Egreso', value: String(planCuentas.filter(p => p.tipo === 'egreso').length) },
      { label: 'Diarios Configurados', value: String(diarios.length) },
    ]);

    renderSpreadsheetTable(root.querySelector('#pc-table'), {
      rows: planCuentas,
      emptyText: 'No hay cuentas contables.',
      compact: true,
      defaultNewRow: () => ({
        codigo: '',
        nombre: '',
        tipo: 'egreso',
        naturaleza: 'deudora',
        imputable: 1,
        activo: 1,
      }),
      onCreateRow: async ({ row }) => {
        if (!String(row.codigo || '').trim() || !String(row.nombre || '').trim()) return false;
        try {
          const res = await api('/api/tesoreria/plan-cuentas', {
            method: 'POST',
            body: JSON.stringify({
              codigo: String(row.codigo).trim(),
              nombre: String(row.nombre).trim(),
              tipo: row.tipo || 'egreso',
              naturaleza: row.naturaleza || 'deudora',
              imputable: row.imputable !== 0 ? 1 : 0,
              activo: row.activo !== 0 ? 1 : 0,
            }),
          });
          if (res?.id) row.id = res.id;
          toast('Cuenta contable creada');
          return true;
        } catch (err) {
          toast(err.message, true);
          throw err;
        }
      },
      columns: [
        {
          key: 'codigo',
          label: 'Código',
          type: 'text',
          nowrap: true,
          parse: v => String(v || '').trim(),
          render: r => (r.codigo ? `<strong>${esc(r.codigo)}</strong>` : '<span class="muted">Ej: 5.2.08</span>'),
        },
        {
          key: 'nombre',
          label: 'Nombre',
          type: 'text',
          parse: v => String(v || '').trim(),
          render: r => (r.nombre ? esc(r.nombre) : '<span class="muted">Nueva cuenta...</span>'),
        },
        {
          key: 'tipo',
          label: 'Tipo',
          type: 'select',
          options: [
            { value: 'egreso', label: 'Egreso' },
            { value: 'ingreso', label: 'Ingreso' },
            { value: 'activo', label: 'Activo' },
            { value: 'pasivo', label: 'Pasivo' },
            { value: 'patrimonio', label: 'Patrimonio' },
          ],
          render: r => `<span class="badge badge-muted">${esc(r.tipo || 'egreso')}</span>`,
        },
        {
          key: 'naturaleza',
          label: 'Naturaleza',
          type: 'select',
          options: [
            { value: 'deudora', label: 'Deudora' },
            { value: 'acreedora', label: 'Acreedora' },
          ],
        },
        {
          key: 'imputable',
          label: 'Imputable',
          type: 'checkbox',
          align: 'center',
          getValue: r => (r.imputable !== 0 ? 1 : 0),
        },
        {
          key: 'activo',
          label: 'Activa',
          type: 'checkbox',
          align: 'center',
          getValue: r => (r.activo !== 0 ? 1 : 0),
        },
      ],
      onCellChange: async ({ row, key, value }) => {
        try {
          await api(`/api/tesoreria/plan-cuentas/${row.id}`, {
            method: 'PUT',
            body: JSON.stringify({
              codigo: key === 'codigo' ? value : row.codigo,
              nombre: key === 'nombre' ? value : row.nombre,
              tipo: key === 'tipo' ? value : row.tipo,
              naturaleza: key === 'naturaleza' ? value : row.naturaleza,
              imputable: key === 'imputable' ? Number(value) : (row.imputable !== 0 ? 1 : 0),
              activo: key === 'activo' ? Number(value) : (row.activo !== 0 ? 1 : 0),
            }),
          });
          toast('Cuenta contable actualizada');
        } catch (err) {
          toast(err.message, true);
          throw err;
        }
      },
    });

    renderSpreadsheetTable(root.querySelector('#pc-diarios-table'), {
      rows: diarios,
      emptyText: 'No hay diarios configurados.',
      compact: true,
      defaultNewRow: () => ({
        codigo: '',
        nombre: '',
        tipo: 'ventas',
        caracter: 'fiscal',
        es_fiscal: 1,
        punto_venta_id: '',
        cuenta_contable_id: '',
        activo: 1,
      }),
      onCreateRow: async ({ row }) => {
        if (!String(row.codigo || '').trim() || !String(row.nombre || '').trim()) return false;
        try {
          const res = await api('/api/tesoreria/diarios', {
            method: 'POST',
            body: JSON.stringify({
              codigo: String(row.codigo).trim(),
              nombre: String(row.nombre).trim(),
              tipo: row.tipo || 'ventas',
              caracter: row.caracter || 'fiscal',
              es_fiscal: Number(row.es_fiscal) ? 1 : 0,
              punto_venta_id: row.punto_venta_id ? Number(row.punto_venta_id) : null,
              cuenta_contable_id: row.cuenta_contable_id ? Number(row.cuenta_contable_id) : null,
              activo: row.activo !== 0 ? 1 : 0,
            }),
          });
          if (res?.id) row.id = res.id;
          toast('Diario contable creado');
          return true;
        } catch (err) {
          toast(err.message, true);
          throw err;
        }
      },
      columns: [
        {
          key: 'codigo',
          label: 'Código',
          type: 'text',
          nowrap: true,
          parse: v => String(v || '').trim(),
          render: r => (r.codigo ? `<strong>${esc(r.codigo)}</strong>` : '<span class="muted">Ej: VTA-A</span>'),
        },
        {
          key: 'nombre',
          label: 'Nombre',
          type: 'text',
          parse: v => String(v || '').trim(),
          render: r => (r.nombre ? esc(r.nombre) : '<span class="muted">Nombre del diario...</span>'),
        },
        {
          key: 'tipo',
          label: 'Tipo',
          type: 'select',
          options: [
            { value: 'ventas', label: 'Ventas' },
            { value: 'compras', label: 'Compras' },
            { value: 'caja', label: 'Caja' },
            { value: 'banco', label: 'Banco' },
            { value: 'general', label: 'General' },
          ],
          render: r => `<span class="badge badge-muted">${esc(r.tipo || 'ventas')}</span>`,
        },
        {
          key: 'caracter',
          label: 'Carácter',
          type: 'select',
          options: [
            { value: 'fiscal', label: 'Fiscal' },
            { value: 'interno', label: 'Interno' },
            { value: 'ambos', label: 'Ambos' },
          ],
        },
        {
          key: 'es_fiscal',
          label: 'Fiscal (ARCA)',
          type: 'checkbox',
          align: 'center',
          getValue: r => (Number(r.es_fiscal) === 1 ? 1 : 0),
        },
        {
          key: 'punto_venta_id',
          label: 'PV AFIP',
          type: 'select',
          options: [
            { value: '', label: '-- Ninguno --' },
            ...puntosVenta.map(pv => ({ value: String(pv.id), label: `${String(pv.numero).padStart(4, '0')} — ${pv.nombre}${pv.es_electronica ? ' (WSFE)' : ''}` })),
          ],
          getValue: r => (r.punto_venta_id ? String(r.punto_venta_id) : ''),
          parse: v => (v ? Number(v) : null),
          render: r => {
            const pv = puntosVenta.find(p => String(p.id) === String(r.punto_venta_id));
            return pv ? `<code>${String(pv.numero).padStart(4, '0')}</code>` : '<span class="muted">-</span>';
          },
        },
        {
          key: 'cuenta_contable_id',
          label: 'Cuenta Contable',
          type: 'select',
          options: [
            { value: '', label: '-- Ninguna --' },
            ...planCuentas.map(pc => ({ value: String(pc.id), label: `${pc.codigo} — ${pc.nombre}` })),
          ],
          getValue: r => (r.cuenta_contable_id ? String(r.cuenta_contable_id) : ''),
          parse: v => (v ? Number(v) : null),
          render: r => {
            const pc = planCuentas.find(p => String(p.id) === String(r.cuenta_contable_id));
            return pc ? `${esc(pc.codigo)} — ${esc(pc.nombre)}` : '<span class="muted">-</span>';
          },
        },
        {
          key: 'activo',
          label: 'Activo',
          type: 'checkbox',
          align: 'center',
          getValue: r => (r.activo !== 0 ? 1 : 0),
        },
      ],
      onCellChange: async ({ row, key, value }) => {
        try {
          await api(`/api/tesoreria/diarios/${row.id}`, {
            method: 'PUT',
            body: JSON.stringify({
              codigo: key === 'codigo' ? value : row.codigo,
              nombre: key === 'nombre' ? value : row.nombre,
              tipo: key === 'tipo' ? value : row.tipo,
              caracter: key === 'caracter' ? value : row.caracter,
              es_fiscal: key === 'es_fiscal' ? (Number(value) ? 1 : 0) : (Number(row.es_fiscal) ? 1 : 0),
              punto_venta_id: key === 'punto_venta_id' ? (value ? Number(value) : null) : (row.punto_venta_id ? Number(row.punto_venta_id) : null),
              cuenta_contable_id: key === 'cuenta_contable_id' ? (value ? Number(value) : null) : (row.cuenta_contable_id ? Number(row.cuenta_contable_id) : null),
              activo: key === 'activo' ? (Number(value) ? 1 : 0) : (row.activo !== 0 ? 1 : 0),
            }),
          });
          toast('Diario contable actualizado');
        } catch (err) {
          toast(err.message, true);
          throw err;
        }
      },
    });

    root.querySelector('#pc-tpl-select')?.addEventListener('change', (e) => {
      const t = plantillas.find(x => x.id === e.target.value);
      const descEl = root.querySelector('#pc-tpl-desc');
      if (descEl) descEl.textContent = t?.descripcion || '';
    });

    root.querySelector('#form-apply-tpl')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const tplId = root.querySelector('#pc-tpl-select')?.value;
      if (!tplId) return;
      if (!(await showConfirmModal('¿Aplicar esta plantilla al Plan de Cuentas? Las cuentas fuera de la plantilla se desactivarán sin borrar asientos históricos.'))) return;
      try {
        const res = await api('/api/tesoreria/plan-cuentas/aplicar-plantilla', {
          method: 'POST',
          body: JSON.stringify({ plantilla_id: tplId }),
        });
        toast(`Plantilla aplicada: ${res.creadas} creadas, ${res.actualizadas} actualizadas, ${res.desactivadas} desactivadas`);
        await draw();
      } catch (err) { toast(err.message, true); }
    });
  };

  await draw();
}
