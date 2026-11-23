import { api, toast } from '../../lib/api.js';
import { esc, fmtMoney, fmtDate } from '../../lib/format.js';
import { navigate } from '../../router.js';
import { openPdfFromEndpoint } from '../../lib/print/index.js';
import {
  mountPageView,
  renderDataTable,
  renderSpreadsheetTable,
  showConfirmModal,
} from '../../lib/engine/index.js';

function liqEstadoBadge(estado) {
  if (estado === 'Confirmada') return '<span class="badge badge-ok">Confirmada</span>';
  if (estado === 'Anulada') return '<span class="badge badge-muted">Anulada</span>';
  return '<span class="badge badge-parcial">Borrador</span>';
}

export async function renderLiquidacionDetalleView(params = {}) {
  const root = document.getElementById('app-view');
  const isNew = Boolean(params.isNew) || params.id === 'nueva';
  const liqId = isNew ? null : Number(params.id);

  if (isNew) {
    const [empleados, paramsPrev] = await Promise.all([
      api('/api/nomina/empleados?activos=1').catch(() => []),
      api('/api/nomina/parametros').catch(() => ({})),
    ]);
    const hoy = new Date().toISOString().slice(0, 10);
    const periodoDef = hoy.slice(0, 7);

    mountPageView(root, {
      breadcrumb: { href: '/rrhh/liquidaciones', label: 'Liquidaciones' },
      title: 'Nueva Liquidación de Haberes',
      subtitle: 'Configurá el período, tipo de liquidación y elegí si liquidar de forma masiva o a empleados específicos.',
      bodyHtml: `
        <div class="card mb-md">
          <div class="card-header"><h2>Parámetros de la Liquidación</h2></div>
          <form id="form-new-liq" class="form-grid">
            <label><span>Período (YYYY-MM) *</span><input type="text" name="periodo" value="${esc(periodoDef)}" required /></label>
            <label><span>Tipo de Liquidación</span>
              <select name="tipo_liquidacion">
                ${['Mensual', 'Primera Quincena', 'Segunda Quincena', 'SAC / Aguinaldo', 'Vacaciones', 'Liquidación Final'].map(v => `<option value="${v}">${v}</option>`).join('')}
              </select>
            </label>
            <label><span>Fecha de Liquidación *</span><input type="date" name="fecha_liquidacion" value="${hoy}" required /></label>
            <label><span>Fecha de Pago *</span><input type="date" name="fecha_pago" value="${hoy}" required /></label>
            <label><span>Banco Depósito Aportes</span><input type="text" name="banco_deposito_aportes" value="${esc(paramsPrev.nomina_ultimo_dep_banco || '')}" /></label>
            <label><span>Alcance</span>
              <select name="alcance" id="new-liq-alcance">
                <option value="masiva">Masiva — Todos los empleados activos (${empleados.length})</option>
                <option value="seleccion">Individual / Selección manual de empleados</option>
              </select>
            </label>
            <label class="full"><span>Observaciones</span><input type="text" name="observaciones" placeholder="Ej: Liquidación mensual, vacaciones, ajuste..." /></label>

            <div class="full hidden" id="new-liq-emp-box">
              <div class="card">
                <div class="card-header">
                  <h2>Seleccionar Empleados a Liquidar</h2>
                </div>
                <div class="checkbox-group">
                  ${empleados.length ? empleados.map(e => `
                    <label class="checkbox-field">
                      <input type="checkbox" name="empleado_ids" value="${e.id}" checked />
                      <span>${e.legajo ? `<code>${esc(e.legajo)}</code> · ` : ''}${esc(e.apellido || '')} ${esc(e.nombre || '')} (${esc(e.sector || '')} — ${fmtMoney(e.sueldo_basico || 0)})</span>
                    </label>
                  `).join('') : '<div class="empty-state">No hay empleados activos en el padrón.</div>'}
                </div>
              </div>
            </div>

            <div class="actions full">
              <a href="/rrhh/liquidaciones" data-link class="btn">Cancelar</a>
              <button type="submit" class="btn btn-primary">Generar Liquidación (Borrador)</button>
            </div>
          </form>
        </div>
      `,
      onAfterMount: () => {
        const alcanceEl = root.querySelector('#new-liq-alcance');
        const empBoxEl = root.querySelector('#new-liq-emp-box');
        alcanceEl?.addEventListener('change', () => {
          empBoxEl?.classList.toggle('hidden', alcanceEl.value !== 'seleccion');
        });

        root.querySelector('#form-new-liq')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const payload = {
            periodo: fd.get('periodo'),
            tipo_liquidacion: fd.get('tipo_liquidacion'),
            fecha_liquidacion: fd.get('fecha_liquidacion'),
            fecha_pago: fd.get('fecha_pago'),
            banco_deposito_aportes: fd.get('banco_deposito_aportes'),
            observaciones: fd.get('observaciones'),
          };
          if (fd.get('alcance') === 'seleccion') {
            const ids = fd.getAll('empleado_ids').map(Number).filter(Boolean);
            if (!ids.length) {
              toast('Seleccioná al menos un empleado para liquidar.', true);
              return;
            }
            payload.empleado_ids = ids;
          }
          try {
            const res = await api('/api/nomina/liquidaciones', {
              method: 'POST',
              body: JSON.stringify(payload),
            });
            toast('Liquidación generada en Borrador');
            navigate(`/rrhh/liquidaciones/${res.id}`);
          } catch (err) {
            toast(err.message, true);
          }
        });
      },
    });
    return;
  }

  let selectedReciboId = null;

  const draw = async () => {
    const [det, conceptos, f931] = await Promise.all([
      api(`/api/nomina/liquidaciones/${liqId}`).catch(() => null),
      api('/api/nomina/conceptos').catch(() => []),
      api(`/api/nomina/liquidaciones/${liqId}/f931`).catch(() => null),
    ]);

    if (!det || !det.liquidacion) {
      mountPageView(root, {
        breadcrumb: { href: '/rrhh/liquidaciones', label: 'Liquidaciones' },
        title: 'Liquidación no encontrada',
        bodyHtml: '<div class="empty-state">La liquidación solicitada no existe.</div>',
      });
      return;
    }

    const { liquidacion: liq, recibos = [] } = det;
    const isBorrador = liq.estado === 'Borrador';
    if (!selectedReciboId || !recibos.some(r => Number(r.id) === Number(selectedReciboId))) {
      selectedReciboId = recibos[0]?.id || null;
    }
    const selRecibo = recibos.find(r => Number(r.id) === Number(selectedReciboId)) || null;
    const conceptosActivos = (conceptos || []).filter(c => Number(c.activo) !== 0);

    const actions = [
      { label: 'TXT LSD (ARCA)', onClick: () => window.open(`/api/nomina/liquidaciones/${liq.id}/lsd.txt`, '_blank') },
      { label: 'Imprimir Recibos (Lote)', onClick: () => openPdfFromEndpoint(`/api/nomina/liquidaciones/${liq.id}/recibos-pdf`, { title: `Recibos LCT — ${liq.numero}` }) },
    ];
    if (isBorrador) {
      actions.push({
        label: 'Confirmar y Contabilizar',
        primary: true,
        onClick: async () => {
          if (!(await showConfirmModal(`¿Confirmar la liquidación ${liq.numero}? Se generará el asiento contable y quedará cerrada.`))) return;
          try {
            await api(`/api/nomina/liquidaciones/${liq.id}/confirmar`, { method: 'POST' });
            toast('Liquidación confirmada y contabilizada');
            await draw();
          } catch (err) { toast(err.message, true); }
        },
      });
    } else if (liq.estado === 'Confirmada') {
      actions.push({
        label: 'Anular Liquidación',
        onClick: async () => {
          if (!(await showConfirmModal(`¿Anular la liquidación ${liq.numero}? Se generará el contra-asiento contable.`))) return;
          try {
            await api(`/api/nomina/liquidaciones/${liq.id}/anular`, { method: 'POST' });
            toast('Liquidación anulada');
            await draw();
          } catch (err) { toast(err.message, true); }
        },
      });
    }

    mountPageView(root, {
      breadcrumb: { href: '/rrhh/liquidaciones', label: 'Liquidaciones' },
      title: `${liq.numero || `Liquidación #${liq.id}`} — ${liq.periodo}`,
      subtitle: `${liq.tipo_liquidacion || 'Mensual'} · Fecha Liq: ${fmtDate(liq.fecha_liquidacion)} · Pago: ${fmtDate(liq.fecha_pago)} · Estado: ${liq.estado}`,
      actions,
      kpis: [
        { label: 'Estado', value: liq.estado, tone: liq.estado === 'Confirmada' ? 'success' : 'accent' },
        { label: 'Total Remunerativo', value: fmtMoney(liq.total_remunerativo || 0) },
        { label: 'Retenciones', value: fmtMoney(liq.total_retenciones || 0) },
        { label: 'Contribuciones Patronales', value: fmtMoney(liq.total_contribuciones || 0) },
        { label: 'Neto a Pagar', value: fmtMoney(liq.total_neto || 0), tone: 'accent' },
      ],
      tabs: [
        {
          id: 'recibos',
          label: 'Recibos y Novedades',
          badge: recibos.length,
          html: `
            <div class="card mb-md">
              <div class="card-header">
                <div>
                  <h2>Recibos Incluidos en la Liquidación</h2>
                  <span class="muted text-sm">${isBorrador ? 'Editá días trabajados o forma de pago, y seleccioná un recibo para cargar novedades/conceptos abajo.' : 'Liquidación cerrada (solo lectura).'}</span>
                </div>
                <div class="actions">
                  ${liqEstadoBadge(liq.estado)}
                  ${liq.asiento_id ? `<a href="/contabilidad" data-link class="badge badge-ok">Asiento #${liq.asiento_id}</a>` : ''}
                </div>
              </div>
              <div id="liq-recibos-sheet"></div>
            </div>
            <div class="card">
              <div class="card-header">
                <div>
                  <h2>Líneas y Novedades del Recibo ${selRecibo ? `— ${esc(selRecibo.nombre_completo)}` : ''}</h2>
                  <span class="muted text-sm">${isBorrador ? 'Completá la fila inferior para agregar horas extra, vacaciones, premios o deducciones al recibo seleccionado.' : 'Detalle calculado de conceptos.'}</span>
                </div>
                <div class="actions">
                  ${selRecibo ? `<button type="button" class="btn btn-sm" id="btn-print-sel-recibo">Imprimir Recibo PDF</button>` : ''}
                </div>
              </div>
              <div id="liq-lineas-sheet"></div>
            </div>
          `,
        },
        {
          id: 'f931',
          label: 'Papel de Trabajo F.931',
          html: `
            <div class="card">
              <div class="card-header">
                <div>
                  <h2>Resumen Previsional F.931 (ARCA)</h2>
                  <span class="muted text-sm">Bases imponibles topeadas y contribuciones calculadas.</span>
                </div>
              </div>
              <div id="liq-f931-table"></div>
            </div>
          `,
        },
      ],
      onAfterMount: () => {
        renderSpreadsheetTable(root.querySelector('#liq-recibos-sheet'), {
          rows: recibos,
          emptyText: 'Esta liquidación no tiene recibos.',
          compact: true,
          columns: [
            { key: 'legajo', label: 'Legajo', readOnly: true, render: r => `<code>${esc(r.legajo || '-')}</code>` },
            {
              key: 'nombre_completo',
              label: 'Trabajador',
              readOnly: true,
              render: r => `<a href="/rrhh/empleados/${r.empleado_id}" data-link class="link-primary">${esc(r.nombre_completo)}</a>`,
            },
            { key: 'sector', label: 'Sector', readOnly: true, render: r => `<span class="badge badge-muted">${esc(r.sector || '-')}</span>` },
            { key: 'dias_trabajados', label: 'Días Trab.', type: 'number', align: 'right', readOnly: !isBorrador },
            { key: 'total_remunerativo', label: 'Remun.', align: 'right', readOnly: true, render: r => fmtMoney(r.total_remunerativo) },
            { key: 'total_no_remunerativo', label: 'No Rem.', align: 'right', readOnly: true, render: r => fmtMoney(r.total_no_remunerativo) },
            { key: 'total_descuentos', label: 'Retenc.', align: 'right', readOnly: true, render: r => fmtMoney(r.total_descuentos) },
            { key: 'neto_a_pagar', label: 'Neto', align: 'right', readOnly: true, render: r => `<strong>${fmtMoney(r.neto_a_pagar)}</strong>` },
            {
              key: 'forma_pago',
              label: 'Forma Pago',
              type: 'select',
              readOnly: !isBorrador,
              options: ['Transferencia CBU', 'Efectivo', 'Cheque'].map(v => ({ value: v, label: v })),
            },
            {
              key: '_sel',
              label: 'Novedades',
              readOnly: true,
              render: r => `<button type="button" class="btn btn-sm ${Number(r.id) === Number(selectedReciboId) ? 'btn-primary' : ''}" data-sel-recibo="${r.id}">${Number(r.id) === Number(selectedReciboId) ? 'Viendo' : 'Editar'}</button>`,
            },
          ],
          onCellChange: async ({ row, key, value }) => {
            if (!isBorrador) return;
            try {
              await api(`/api/nomina/recibos/${row.id}`, {
                method: 'PUT',
                body: JSON.stringify({ [key]: key === 'dias_trabajados' ? Number(value) : value }),
              });
              toast('Recibo recalculado');
              await draw();
            } catch (err) {
              toast(err.message, true);
              throw err;
            }
          },
        });

        root.querySelectorAll('[data-sel-recibo]').forEach(btn => {
          btn.addEventListener('click', async () => {
            selectedReciboId = Number(btn.dataset.selRecibo);
            await draw();
          });
        });

        root.querySelector('#btn-print-sel-recibo')?.addEventListener('click', () => {
          if (selRecibo) {
            openPdfFromEndpoint(`/api/nomina/liquidaciones/${liq.id}/recibos-pdf?recibo_id=${selRecibo.id}`, {
              title: `Recibo LCT — ${selRecibo.nombre_completo}`,
            });
          }
        });

        if (selRecibo) {
          renderSpreadsheetTable(root.querySelector('#liq-lineas-sheet'), {
            rows: selRecibo.lineas || [],
            emptyText: 'Sin líneas en este recibo.',
            compact: true,
            defaultNewRow: isBorrador ? () => ({
              concepto_id: '',
              descripcion: '',
              cantidad: 1,
              importe_haber: 0,
              importe_descuento: 0,
            }) : null,
            onCreateRow: isBorrador ? async ({ row }) => {
              if (!row.concepto_id && !String(row.descripcion || '').trim()) return false;
              try {
                await api(`/api/nomina/recibos/${selRecibo.id}/novedades`, {
                  method: 'POST',
                  body: JSON.stringify({
                    concepto_id: row.concepto_id ? Number(row.concepto_id) : null,
                    descripcion: row.descripcion || '',
                    cantidad: Number(row.cantidad || 1),
                    importe_haber: Number(row.importe_haber || 0),
                    importe_descuento: Number(row.importe_descuento || 0),
                  }),
                });
                toast('Novedad agregada al recibo');
                await draw();
                return false;
              } catch (err) {
                toast(err.message, true);
                throw err;
              }
            } : null,
            onCellChange: isBorrador ? async ({ row, key, value }) => {
              try {
                const payload = {
                  [key]: ['cantidad', 'importe_haber', 'importe_descuento'].includes(key)
                    ? Number(value || 0)
                    : (key === 'concepto_id' ? (value ? Number(value) : null) : value),
                };
                await api(`/api/nomina/recibo-lineas/${row.id}`, {
                  method: 'PUT',
                  body: JSON.stringify(payload),
                });
                toast('Línea actualizada');
                await draw();
              } catch (err) {
                toast(err.message, true);
                throw err;
              }
            } : null,
            onDeleteRow: isBorrador ? async (line) => {
              try {
                await api(`/api/nomina/recibo-lineas/${line.id}`, { method: 'DELETE' });
                toast('Línea quitada');
                await draw();
              } catch (err) { toast(err.message, true); }
            } : null,
            columns: [
              { key: 'codigo_afip_lsd', label: 'Cód. ARCA', readOnly: true, render: l => `<code>${esc(l.codigo_afip_lsd || '-')}</code>` },
              {
                key: 'concepto_id',
                label: 'Concepto',
                type: 'select',
                readOnly: !isBorrador,
                options: [
                  { value: '', label: 'Seleccionar concepto...' },
                  ...conceptosActivos.map(c => ({ value: String(c.id), label: `${c.codigo_afip_lsd} · ${c.descripcion}` })),
                ],
                render: l => l.__isNew
                  ? (l.concepto_id ? esc(conceptosActivos.find(c => String(c.id) === String(l.concepto_id))?.descripcion || '-') : '<span class="muted">+ Elegir concepto...</span>')
                  : esc(l.descripcion || '-'),
              },
              { key: 'descripcion', label: 'Detalle / Descripción', type: 'text', readOnly: !isBorrador },
              { key: 'cantidad', label: 'Cant.', type: 'number', align: 'right', readOnly: !isBorrador },
              { key: 'base_calculo', label: 'Base Cálc.', align: 'right', readOnly: true, render: l => fmtMoney(l.base_calculo || 0) },
              { key: 'importe_haber', label: 'Haber ($)', type: 'number', align: 'right', readOnly: !isBorrador, render: l => fmtMoney(l.importe_haber || 0) },
              { key: 'importe_descuento', label: 'Descuento ($)', type: 'number', align: 'right', readOnly: !isBorrador, render: l => fmtMoney(l.importe_descuento || 0) },
              { key: 'importe_contribucion', label: 'Contrib. ($)', align: 'right', readOnly: true, render: l => fmtMoney(l.importe_contribucion || 0) },
            ],
          });
        }

        const f931Host = root.querySelector('#liq-f931-table');
        if (f931Host && f931) {
          const rows = [
            { concepto: 'Cantidad de Empleados', valor: String(f931.cantidad_empleados || 0) },
            { concepto: 'Total Remunerativo', valor: fmtMoney(f931.total_remunerativo || 0) },
            { concepto: 'Total No Remunerativo', valor: fmtMoney(f931.total_no_remunerativo || 0) },
            { concepto: 'Base Imponible 1 (SIPA Topeada)', valor: fmtMoney(f931.base_imponible_1 || 0) },
            { concepto: 'Base Imponible 2 (SIPA Contrib.)', valor: fmtMoney(f931.base_imponible_2 || 0) },
            { concepto: 'Total Aportes + Contribuciones F.931 ARCA', valor: fmtMoney(f931.total_f931_arca || 0) },
            { concepto: 'Total Sindicato', valor: fmtMoney(f931.total_sindicato || 0) },
          ];
          renderDataTable(f931Host, {
            rows,
            columns: [
              { label: 'Concepto F.931', render: r => esc(r.concepto) },
              { label: 'Importe / Valor', align: 'right', render: r => `<strong>${esc(r.valor)}</strong>` },
            ],
          });
        }
      },
    });
  };

  await draw();
}
