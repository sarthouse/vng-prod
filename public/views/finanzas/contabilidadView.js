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
  const formState = { codigo: '', nombre: '', tipo: 'egreso', naturaleza: 'deudora' };
  const diarioState = { codigo: '', nombre: '', tipo: 'ventas', caracter: 'fiscal', es_fiscal: 1, punto_venta_id: '', cuenta_contable_id: '' };

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
        <div class="card-header"><h2>Nueva Cuenta Contable</h2></div>
        <form id="form-add-pc">
          <div id="pc-fields" class="form-grid"></div>
          <div class="modal-footer">
            <button type="submit" class="btn btn-primary btn-sm">+ Agregar Cuenta</button>
          </div>
        </form>
      </div>

      <div class="card">
        <div class="card-header"><h2>Plan de Cuentas</h2></div>
        <div id="pc-table"></div>
      </div>

      <div class="card">
        <div class="card-header"><h2>Diarios Contables</h2></div>
        <form id="form-add-diario">
          <div id="pc-diario-fields" class="form-grid"></div>
          <div class="modal-footer">
            <button type="submit" class="btn btn-primary btn-sm">+ Agregar Diario</button>
          </div>
        </form>
        <div id="pc-diarios-table"></div>
      </div>
    `;

    renderKpiStrip(root.querySelector('#pc-kpis'), [
      { label: 'Total Cuentas', value: String(planCuentas.length) },
      { label: 'Activas', value: String(planCuentas.filter(p => p.activo !== 0).length), tone: 'success' },
      { label: 'Cuentas de Egreso', value: String(planCuentas.filter(p => p.tipo === 'egreso').length) },
      { label: 'Diarios Configurados', value: String(diarios.length) },
    ]);

    mountFormFields(root.querySelector('#pc-fields'), [
      { name: 'codigo', label: 'Código', type: 'text', required: true, placeholder: 'Ej: 5.2.08' },
      { name: 'nombre', label: 'Nombre', type: 'text', required: true, placeholder: 'Ej: Publicidad y Marketing' },
      {
        name: 'tipo',
        label: 'Tipo',
        type: 'select',
        options: [
          { value: 'egreso', label: 'Egreso' },
          { value: 'ingreso', label: 'Ingreso' },
          { value: 'activo', label: 'Activo' },
          { value: 'pasivo', label: 'Pasivo' },
          { value: 'patrimonio', label: 'Patrimonio' },
        ],
      },
      {
        name: 'naturaleza',
        label: 'Naturaleza',
        type: 'select',
        options: [
          { value: 'deudora', label: 'Deudora' },
          { value: 'acreedora', label: 'Acreedora' },
        ],
      },
    ], formState);

    renderSpreadsheetTable(root.querySelector('#pc-table'), {
      rows: planCuentas,
      emptyText: 'No hay cuentas contables.',
      compact: true,
      columns: [
        { key: 'codigo', label: 'Código', type: 'text', nowrap: true, render: r => `<strong>${esc(r.codigo)}</strong>` },
        { key: 'nombre', label: 'Nombre', type: 'text' },
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
          render: r => `<span class="badge badge-muted">${esc(r.tipo)}</span>`,
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
          key: 'activo',
          label: 'Activa',
          type: 'checkbox',
          align: 'center',
          getValue: r => (r.activo !== 0 ? 1 : 0),
        },
      ],
      extraActions: r => `<button type="button" class="btn btn-sm" data-edit-pc="${r.id}">Detalle</button>`,
      onCellChange: async ({ row, key, value }) => {
        try {
          await api(`/api/tesoreria/plan-cuentas/${row.id}`, {
            method: 'PUT',
            body: JSON.stringify({
              codigo: key === 'codigo' ? value : row.codigo,
              nombre: key === 'nombre' ? value : row.nombre,
              tipo: key === 'tipo' ? value : row.tipo,
              naturaleza: key === 'naturaleza' ? value : row.naturaleza,
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

    mountFormFields(root.querySelector('#pc-diario-fields'), [
      { name: 'codigo', label: 'Código', type: 'text', required: true, placeholder: 'Ej: VTA-A' },
      { name: 'nombre', label: 'Nombre', type: 'text', required: true, placeholder: 'Nombre del diario...' },
      {
        name: 'tipo',
        label: 'Tipo',
        type: 'select',
        options: [
          { value: 'ventas', label: 'Ventas' },
          { value: 'compras', label: 'Compras' },
          { value: 'caja', label: 'Caja' },
          { value: 'banco', label: 'Banco' },
          { value: 'general', label: 'General' },
        ],
      },
      {
        name: 'caracter',
        label: 'Carácter',
        type: 'select',
        options: [
          { value: 'fiscal', label: 'Fiscal' },
          { value: 'interno', label: 'Interno' },
          { value: 'ambos', label: 'Ambos' },
        ],
      },
      {
        name: 'es_fiscal',
        label: 'Es Fiscal (AFIP/ARCA)',
        type: 'select',
        options: [
          { value: 1, label: 'Sí (Facturas A/B/C)' },
          { value: 0, label: 'No (Solo X / Interno)' },
        ],
      },
      {
        name: 'punto_venta_id',
        label: 'Punto de Venta AFIP',
        type: 'select',
        options: [
          { value: '', label: '-- Ninguno --' },
          ...puntosVenta.map(pv => ({ value: pv.id, label: `${String(pv.numero).padStart(4, '0')} — ${pv.nombre}${pv.es_electronica ? ' (WSFE)' : ''}` })),
        ],
      },
      {
        name: 'cuenta_contable_id',
        label: 'Cuenta Contable',
        type: 'select',
        options: [
          { value: '', label: '-- Ninguna --' },
          ...planCuentas.map(pc => ({ value: pc.id, label: `${pc.codigo} — ${pc.nombre}` })),
        ],
      },
    ], diarioState);

    renderDataTable(root.querySelector('#pc-diarios-table'), {
      emptyText: 'No hay diarios configurados.',
      columns: [
        { label: 'Código', render: r => `<strong>${esc(r.codigo)}</strong>` },
        { label: 'Nombre', key: 'nombre' },
        { label: 'Tipo', render: r => `<span class="badge badge-muted">${esc(r.tipo)}</span>` },
        {
          label: 'Fiscal',
          render: r => (Number(r.es_fiscal) === 1 || r.caracter === 'fiscal'
            ? '<span class="badge badge-ok">Fiscal (ARCA)</span>'
            : '<span class="badge badge-muted">No fiscal (X)</span>'),
        },
        {
          label: 'PV AFIP',
          render: r => {
            const pv = puntosVenta.find(p => String(p.id) === String(r.punto_venta_id));
            return pv ? `<code>${String(pv.numero).padStart(4, '0')}</code>` : '-';
          },
        },
        {
          label: 'Cuenta Contable',
          render: r => {
            const pc = planCuentas.find(p => String(p.id) === String(r.cuenta_contable_id));
            return pc ? `${esc(pc.codigo)} — ${esc(pc.nombre)}` : '-';
          },
        },
        { label: 'Estado', render: r => `<span class="badge ${r.activo !== 0 ? 'badge-ok' : 'badge-muted'}">${r.activo !== 0 ? 'Activo' : 'Inactivo'}</span>` },
        {
          label: '',
          align: 'right',
          render: r => `
            <div class="actions justify-end">
              <button type="button" class="btn btn-sm" data-edit-diario="${r.id}">Editar</button>
              <button type="button" class="btn btn-sm" data-toggle-diario="${r.id}" data-activo="${r.activo !== 0 ? 1 : 0}">${r.activo !== 0 ? 'Desactivar' : 'Activar'}</button>
            </div>
          `,
        },
      ],
      rows: diarios,
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

    root.querySelector('#form-add-diario')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/api/tesoreria/diarios', {
          method: 'POST',
          body: JSON.stringify({
            ...diarioState,
            es_fiscal: Number(diarioState.es_fiscal) ? 1 : 0,
            punto_venta_id: diarioState.punto_venta_id ? Number(diarioState.punto_venta_id) : null,
            cuenta_contable_id: diarioState.cuenta_contable_id ? Number(diarioState.cuenta_contable_id) : null,
          }),
        });
        toast('Diario contable creado');
        diarioState.codigo = '';
        diarioState.nombre = '';
        await draw();
      } catch (err) { toast(err.message, true); }
    });

    root.querySelector('#form-add-pc')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/api/tesoreria/plan-cuentas', {
          method: 'POST',
          body: JSON.stringify({ ...formState, imputable: 1, activo: 1 }),
        });
        toast('Cuenta contable creada');
        formState.codigo = '';
        formState.nombre = '';
        await draw();
      } catch (err) { toast(err.message, true); }
    });

    root.querySelectorAll('[data-edit-pc]').forEach(btn => btn.addEventListener('click', () => {
      const pc = planCuentas.find(p => String(p.id) === String(btn.dataset.editPc));
      if (!pc) return;
      const editState = {
        codigo: pc.codigo || '',
        nombre: pc.nombre || '',
        tipo: pc.tipo || 'egreso',
        naturaleza: pc.naturaleza || 'deudora',
        imputable: pc.imputable !== 0 ? 1 : 0,
        activo: pc.activo !== 0 ? 1 : 0,
      };
      const { close } = createModal({
        title: `Editar Cuenta — ${pc.codigo}`,
        bodyHtml: `<form id="form-edit-pc"><div id="edit-pc-fields" class="form-grid"></div></form>`,
        footerHtml: `
          <button type="button" class="btn" id="btn-cancel-edit-pc">Cancelar</button>
          <button type="submit" form="form-edit-pc" class="btn btn-primary">Guardar Cambios</button>
        `,
        onMount: (modalEl) => {
          mountFormFields(modalEl.querySelector('#edit-pc-fields'), [
            { name: 'codigo', label: 'Código *', type: 'text', required: true },
            { name: 'nombre', label: 'Nombre *', type: 'text', required: true },
            {
              name: 'tipo',
              label: 'Tipo',
              type: 'select',
              options: [
                { value: 'activo', label: 'Activo' },
                { value: 'pasivo', label: 'Pasivo' },
                { value: 'patrimonio', label: 'Patrimonio' },
                { value: 'ingreso', label: 'Ingreso' },
                { value: 'egreso', label: 'Egreso' },
              ],
            },
            {
              name: 'naturaleza',
              label: 'Naturaleza',
              type: 'select',
              options: [
                { value: 'deudora', label: 'Deudora' },
                { value: 'acreedora', label: 'Acreedora' },
              ],
            },
            {
              name: 'imputable',
              label: 'Imputable',
              type: 'select',
              options: [
                { value: 1, label: 'Sí' },
                { value: 0, label: 'No (Título/Agrupadora)' },
              ],
            },
            {
              name: 'activo',
              label: 'Estado',
              type: 'select',
              options: [
                { value: 1, label: 'Activa' },
                { value: 0, label: 'Inactiva' },
              ],
            },
          ], editState);
          modalEl.querySelector('#btn-cancel-edit-pc')?.addEventListener('click', () => close());
          modalEl.querySelector('#form-edit-pc')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
              await api(`/api/tesoreria/plan-cuentas/${pc.id}`, {
                method: 'PUT',
                body: JSON.stringify({
                  ...editState,
                  imputable: Number(editState.imputable) ? 1 : 0,
                  activo: Number(editState.activo) ? 1 : 0,
                }),
              });
              toast('Cuenta contable actualizada');
              close();
              await draw();
            } catch (err) { toast(err.message, true); }
          });
        },
      });
    }));

    root.querySelectorAll('[data-toggle-pc]').forEach(btn => btn.addEventListener('click', async () => {
      try {
        const activo = btn.dataset.activo === '1' ? 0 : 1;
        await api(`/api/tesoreria/plan-cuentas/${btn.dataset.togglePc}`, {
          method: 'PUT',
          body: JSON.stringify({ activo }),
        });
        toast(activo ? 'Cuenta activada' : 'Cuenta desactivada');
        await draw();
      } catch (err) { toast(err.message, true); }
    }));

    root.querySelectorAll('[data-edit-diario]').forEach(btn => btn.addEventListener('click', () => {
      const d = diarios.find(x => String(x.id) === String(btn.dataset.editDiario));
      if (!d) return;
      const editD = {
        codigo: d.codigo || '',
        nombre: d.nombre || '',
        tipo: d.tipo || 'ventas',
        caracter: d.caracter || 'ambos',
        es_fiscal: Number(d.es_fiscal) === 1 ? 1 : 0,
        punto_venta_id: d.punto_venta_id || '',
        cuenta_contable_id: d.cuenta_contable_id || '',
        activo: d.activo !== 0 ? 1 : 0,
      };
      const { close } = createModal({
        title: `Editar Diario — ${d.codigo}`,
        bodyHtml: `<form id="form-edit-diario"><div id="edit-diario-fields" class="form-grid"></div></form>`,
        footerHtml: `
          <button type="button" class="btn" id="btn-cancel-edit-diario">Cancelar</button>
          <button type="submit" form="form-edit-diario" class="btn btn-primary">Guardar Cambios</button>
        `,
        onMount: (modalEl) => {
          mountFormFields(modalEl.querySelector('#edit-diario-fields'), [
            { name: 'codigo', label: 'Código *', type: 'text', required: true },
            { name: 'nombre', label: 'Nombre *', type: 'text', required: true },
            {
              name: 'tipo',
              label: 'Tipo',
              type: 'select',
              options: [
                { value: 'ventas', label: 'Ventas' },
                { value: 'compras', label: 'Compras' },
                { value: 'caja', label: 'Caja' },
                { value: 'banco', label: 'Banco' },
                { value: 'general', label: 'General' },
              ],
            },
            {
              name: 'caracter',
              label: 'Carácter',
              type: 'select',
              options: [
                { value: 'fiscal', label: 'Fiscal' },
                { value: 'interno', label: 'Interno' },
                { value: 'ambos', label: 'Ambos' },
              ],
            },
            {
              name: 'es_fiscal',
              label: 'Es Fiscal (AFIP/ARCA)',
              type: 'select',
              options: [
                { value: 1, label: 'Sí (Facturas A/B/C)' },
                { value: 0, label: 'No (Solo X / Interno)' },
              ],
            },
            {
              name: 'punto_venta_id',
              label: 'Punto de Venta AFIP',
              type: 'select',
              options: [
                { value: '', label: '-- Ninguno --' },
                ...puntosVenta.map(pv => ({ value: pv.id, label: `${String(pv.numero).padStart(4, '0')} — ${pv.nombre}${pv.es_electronica ? ' (WSFE)' : ''}` })),
              ],
            },
            {
              name: 'cuenta_contable_id',
              label: 'Cuenta Contable',
              type: 'select',
              options: [
                { value: '', label: '-- Ninguna --' },
                ...planCuentas.map(pc => ({ value: pc.id, label: `${pc.codigo} — ${pc.nombre}` })),
              ],
            },
            {
              name: 'activo',
              label: 'Estado',
              type: 'select',
              options: [
                { value: 1, label: 'Activo' },
                { value: 0, label: 'Inactivo' },
              ],
            },
          ], editD);
          modalEl.querySelector('#btn-cancel-edit-diario')?.addEventListener('click', () => close());
          modalEl.querySelector('#form-edit-diario')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
              await api(`/api/tesoreria/diarios/${d.id}`, {
                method: 'PUT',
                body: JSON.stringify({
                  ...editD,
                  es_fiscal: Number(editD.es_fiscal) ? 1 : 0,
                  punto_venta_id: editD.punto_venta_id ? Number(editD.punto_venta_id) : null,
                  cuenta_contable_id: editD.cuenta_contable_id ? Number(editD.cuenta_contable_id) : null,
                  activo: Number(editD.activo) ? 1 : 0,
                }),
              });
              toast('Diario contable actualizado');
              close();
              await draw();
            } catch (err) { toast(err.message, true); }
          });
        },
      });
    }));

    root.querySelectorAll('[data-toggle-diario]').forEach(btn => btn.addEventListener('click', async () => {
      try {
        const activo = btn.dataset.activo === '1' ? 0 : 1;
        await api(`/api/tesoreria/diarios/${btn.dataset.toggleDiario}`, {
          method: 'PUT',
          body: JSON.stringify({ activo }),
        });
        toast(activo ? 'Diario activado' : 'Diario desactivado');
        await draw();
      } catch (err) { toast(err.message, true); }
    }));
  };

  await draw();
}
