import { api, toast } from '../../lib/api.js';
import { esc, fmtMoney, fmtDate } from '../../lib/format.js';
import { openPdfFromEndpoint } from '../../lib/print/index.js';
import {
  mountPageView,
  renderKpiStrip,
  renderSpreadsheetTable,
  renderDataTable,
  createModal,
  showFormModal,
  showConfirmModal,
} from '../../lib/engine/index.js';

function liqEstadoBadge(estado) {
  if (estado === 'Confirmada') return '<span class="badge badge-ok">Confirmada</span>';
  if (estado === 'Anulada') return '<span class="badge badge-muted">Anulada</span>';
  return '<span class="badge badge-parcial">Borrador</span>';
}

export async function renderNominaView() {
  const root = document.getElementById('app-view');
  let selectedLiqId = null;

  const draw = async () => {
    const [liquidaciones, empleados, conceptos, params, planCuentas] = await Promise.all([
      api('/api/nomina/liquidaciones').catch(() => []),
      api('/api/nomina/empleados').catch(() => []),
      api('/api/nomina/conceptos').catch(() => []),
      api('/api/nomina/parametros').catch(() => ({})),
      api('/api/tesoreria/plan-cuentas').catch(() => []),
    ]);

    if (!selectedLiqId && liquidaciones.length > 0) {
      selectedLiqId = liquidaciones[0].id;
    }
    const detalle = selectedLiqId
      ? await api(`/api/nomina/liquidaciones/${selectedLiqId}`).catch(() => null)
      : null;

    const activosCount = empleados.filter(e => Number(e.activo) !== 0).length;
    const masaSalarial = empleados
      .filter(e => Number(e.activo) !== 0)
      .reduce((s, e) => s + Number(e.sueldo_basico || 0), 0);
    const cuentasEgreso = (planCuentas || []).filter(c => Number(c.activo) !== 0 && Number(c.imputable) !== 0 && c.tipo === 'egreso');

    mountPageView(root, {
      title: 'Nómina Argentina (ARCA / LSD / F.931)',
      subtitle: 'Liquidación de haberes con topes previsionales, exportación Libro de Sueldos Digital, Papel de Trabajo F.931 y Recibos LCT Art. 140.',
      actionsHtml: '<button type="button" class="btn btn-primary" id="btn-nueva-liq">+ Nueva Liquidación</button>',
      kpisHtml: '<div id="nomina-kpis"></div>',
      tabs: [
        {
          id: 'liquidaciones',
          label: 'Liquidaciones',
          badge: liquidaciones.length,
          html: `
            <div class="card mb-md">
              <div class="card-header"><h2>Historial de Liquidaciones</h2></div>
              <div id="nomina-liq-table"></div>
            </div>
            <div class="card">
              <div class="card-header">
                <div>
                  <h2>Recibos de la Liquidación ${detalle ? `— ${esc(detalle.liquidacion.numero || detalle.liquidacion.periodo)}` : ''}</h2>
                  <span class="muted text-sm">${detalle?.liquidacion.estado === 'Borrador' ? 'Editá días trabajados / forma de pago inline o cargá novedades por recibo antes de confirmar.' : 'Liquidación cerrada (solo lectura).'}</span>
                </div>
                <div class="actions">
                  ${detalle ? `<button type="button" class="btn btn-sm" id="btn-lsd-liq">Descargar TXT LSD (ARCA)</button>` : ''}
                  ${detalle ? `<button type="button" class="btn btn-sm" id="btn-f931-liq">Papel de Trabajo F.931</button>` : ''}
                  ${detalle ? `<button type="button" class="btn btn-sm btn-primary" id="btn-recibos-lote">Imprimir Recibos LCT (Lote)</button>` : ''}
                </div>
              </div>
              <div id="nomina-det-sheet"></div>
            </div>
          `,
        },
        {
          id: 'empleados',
          label: 'Padrón de Empleados',
          badge: empleados.length,
          html: `
            <div class="card">
              <div class="card-header">
                <div>
                  <h2>Padrón de Empleados (Datos SICOSS / ARCA)</h2>
                  <span class="muted text-sm">Click en celda para editar · Completá la fila inferior para dar de alta un trabajador.</span>
                </div>
              </div>
              <div id="nomina-emp-sheet"></div>
            </div>
          `,
        },
        {
          id: 'conceptos',
          label: 'Conceptos y Topes Previsionales',
          badge: conceptos.length,
          html: `
            <div class="card mb-md">
              <div class="card-header">
                <div>
                  <h2>Topes Previsionales y Último Depósito (Art. 9 Ley 24.241 / Art. 140 LCT)</h2>
                  <span class="muted text-sm">Parámetros vigentes aplicados al cálculo automático de F.931 y recibos legales.</span>
                </div>
                <a href="/api/nomina/lsd/conceptos.txt" class="btn btn-sm" target="_blank">Descargar TXT Conceptos ARCA</a>
              </div>
              <form id="form-nomina-params" class="form-grid">
                <label><span>Base Imponible Mínima ($)</span><input type="number" step="0.01" min="0" name="nomina_base_min" value="${Number(params.nomina_base_min || 0)}" /></label>
                <label><span>Base Imponible Máxima ($)</span><input type="number" step="0.01" min="0" name="nomina_base_max" value="${Number(params.nomina_base_max || 0)}" /></label>
                <label><span>ART Cuota Fija ($)</span><input type="number" step="0.01" min="0" name="nomina_art_fija" value="${Number(params.nomina_art_fija || 0)}" /></label>
                <label><span>ART Alícuota Variable (%)</span><input type="number" step="0.01" min="0" name="nomina_art_pct" value="${Number(params.nomina_art_pct || 0)}" /></label>
                <label><span>SCVO por Empleado ($)</span><input type="number" step="0.01" min="0" name="nomina_scvo_monto" value="${Number(params.nomina_scvo_monto || 0)}" /></label>
                <label><span>Últ. Depósito Período</span><input type="text" name="nomina_ultimo_dep_periodo" placeholder="2026-10" value="${esc(params.nomina_ultimo_dep_periodo || '')}" /></label>
                <label><span>Últ. Depósito Fecha</span><input type="date" name="nomina_ultimo_dep_fecha" value="${esc(params.nomina_ultimo_dep_fecha || '')}" /></label>
                <label><span>Banco Depósito Aportes</span><input type="text" name="nomina_ultimo_dep_banco" placeholder="Banco Nación / Galicia" value="${esc(params.nomina_ultimo_dep_banco || '')}" /></label>
                <div class="full modal-footer"><button type="submit" class="btn btn-primary">Guardar Parámetros Previsionales</button></div>
              </form>
            </div>
            <div class="card">
              <div class="card-header">
                <div>
                  <h2>Catálogo de Conceptos (Nomenclador ARCA LSD)</h2>
                  <span class="muted text-sm">Click en celda para editar o completá la fila inferior para crear un nuevo concepto.</span>
                </div>
              </div>
              <div id="nomina-conc-sheet"></div>
            </div>
          `,
        },
      ],
      onAfterMount: () => {
        renderKpiStrip(root.querySelector('#nomina-kpis'), [
          { label: 'Empleados Activos', value: String(activosCount), tone: 'success' },
          { label: 'Masa Básica Mensual', value: fmtMoney(masaSalarial) },
          { label: 'Tope Máx. Previsional', value: fmtMoney(params.nomina_base_max || 0) },
          { label: 'Último Neto Liquidado', value: fmtMoney(liquidaciones[0]?.total_neto || 0), tone: 'accent' },
        ]);

        renderDataTable(root.querySelector('#nomina-liq-table'), {
          emptyText: 'No hay liquidaciones registradas.',
          rows: liquidaciones,
          columns: [
            { label: 'Número / Período', render: l => `<strong>${esc(l.numero || '')}</strong> <span class="muted">${esc(l.periodo)}</span>` },
            { label: 'Tipo', render: l => esc(l.tipo_liquidacion || 'Mensual') },
            { label: 'Fecha', render: l => fmtDate(l.fecha_liquidacion) },
            { label: 'Estado', render: l => liqEstadoBadge(l.estado) },
            { label: 'Remun.', align: 'right', render: l => fmtMoney(l.total_remunerativo) },
            { label: 'Retenc.', align: 'right', render: l => fmtMoney(l.total_descuentos) },
            { label: 'Contrib.', align: 'right', render: l => fmtMoney(l.total_contribuciones) },
            { label: 'Neto a Pagar', align: 'right', render: l => `<strong>${fmtMoney(l.total_neto)}</strong>` },
            {
              label: 'Asiento',
              render: l => (l.asiento_id
                ? `<a href="/contabilidad" data-link class="badge badge-ok">Asiento #${l.asiento_id}</a>`
                : '<span class="muted">-</span>'),
            },
            {
              label: 'Acciones',
              align: 'right',
              render: l => `
                <div class="actions justify-end">
                  <button type="button" class="btn btn-sm" data-sel-liq="${l.id}">Recibos</button>
                  ${l.estado === 'Borrador' ? `<button type="button" class="btn btn-sm btn-primary" data-conf-liq="${l.id}">Confirmar</button>` : ''}
                  ${l.estado === 'Borrador' ? `<button type="button" class="btn btn-sm btn-danger" data-del-liq="${l.id}">Eliminar</button>` : ''}
                  ${l.estado === 'Confirmada' ? `<button type="button" class="btn btn-sm btn-danger" data-anul-liq="${l.id}">Anular</button>` : ''}
                </div>
              `,
            },
          ],
        });

        const detHost = root.querySelector('#nomina-det-sheet');
        if (detalle) {
          const editable = detalle.liquidacion.estado === 'Borrador';
          renderSpreadsheetTable(detHost, {
            rows: detalle.recibos,
            emptyText: 'Sin recibos en esta liquidación.',
            compact: true,
            columns: [
              { key: 'legajo', label: 'Legajo', editable: () => false, render: r => `<code>${esc(r.legajo || '-')}</code>` },
              { key: 'nombre_completo', label: 'Trabajador', editable: () => false, render: r => `<strong>${esc(r.nombre_completo)}</strong><div class="muted text-xs">${esc(r.cuil || '')}</div>` },
              { key: 'sector', label: 'Sector', editable: () => false, render: r => `<span class="badge badge-muted">${esc(r.sector)}</span>` },
              {
                key: 'dias_trabajados',
                label: 'Días',
                type: 'number',
                min: 0,
                max: 30,
                align: 'right',
                editable: () => editable,
                parse: v => Math.max(0, Math.min(30, Math.round(Number(v) || 0))),
              },
              { key: 'total_remunerativo', label: 'Remun.', align: 'right', editable: () => false, render: r => fmtMoney(r.total_remunerativo) },
              { key: 'total_no_remunerativo', label: 'No Rem.', align: 'right', editable: () => false, render: r => fmtMoney(r.total_no_remunerativo) },
              { key: 'total_descuentos', label: 'Retenc.', align: 'right', editable: () => false, render: r => fmtMoney(r.total_descuentos) },
              { key: 'base_imponible_1', label: 'Base 1 (SIPA)', align: 'right', editable: () => false, render: r => fmtMoney(r.base_imponible_1) },
              { key: 'neto_a_pagar', label: 'Neto a Pagar', align: 'right', editable: () => false, render: r => `<strong>${fmtMoney(r.neto_a_pagar)}</strong>` },
              {
                key: 'forma_pago',
                label: 'Forma Pago',
                type: 'select',
                editable: () => editable,
                options: [
                  { value: 'Transferencia CBU', label: 'Transferencia CBU' },
                  { value: 'Efectivo', label: 'Efectivo' },
                  { value: 'Cheque', label: 'Cheque' },
                ],
              },
            ],
            extraActions: r => `
              ${editable ? `<button type="button" class="btn btn-sm" data-nov-rec="${r.id}">+ Novedad</button>` : ''}
              <button type="button" class="btn btn-sm" data-pdf-rec="${r.id}">Recibo PDF</button>
            `,
            onCellChange: async ({ row, key, value }) => {
              try {
                await api(`/api/nomina/recibos/${row.id}`, {
                  method: 'PUT',
                  body: JSON.stringify({ [key]: value }),
                });
                toast('Recibo recalculado');
                await draw();
              } catch (err) {
                toast(err.message, true);
                throw err;
              }
            },
          });
        } else if (detHost) {
          detHost.innerHTML = '<p class="muted">Seleccioná o creá una liquidación para ver sus recibos.</p>';
        }

        renderSpreadsheetTable(root.querySelector('#nomina-emp-sheet'), {
          rows: empleados,
          emptyText: 'No hay empleados cargados.',
          compact: true,
          defaultNewRow: () => ({
            legajo: '',
            apellido: '',
            nombre: '',
            cuil: '',
            fecha_ingreso: new Date().toISOString().slice(0, 10),
            convenio_cct: 'CCT Calzado (UTICRA)',
            categoria_laboral: 'Oficial',
            sector: 'Producción',
            cbu: '',
            sueldo_basico: 0,
            cuenta_sueldos_id: '',
            activo: 1,
          }),
          onCreateRow: async ({ row }) => {
            if (!String(row.nombre || '').trim()) return false;
            try {
              await api('/api/nomina/empleados', {
                method: 'POST',
                body: JSON.stringify({
                  ...row,
                  sueldo_basico: Number(row.sueldo_basico || 0),
                  cuenta_sueldos_id: row.cuenta_sueldos_id ? Number(row.cuenta_sueldos_id) : null,
                }),
              });
              toast('Empleado registrado');
              await draw();
              return false;
            } catch (err) {
              toast(err.message, true);
              throw err;
            }
          },
          columns: [
            { key: 'legajo', label: 'Legajo', type: 'text', nowrap: true, render: e => (e.legajo ? `<code>${esc(e.legajo)}</code>` : '<span class="muted">Auto</span>') },
            { key: 'apellido', label: 'Apellido', type: 'text' },
            { key: 'nombre', label: 'Nombre', type: 'text', render: e => (e.nombre ? `<strong>${esc(e.nombre)}</strong>` : '<span class="muted">Nuevo...</span>') },
            { key: 'cuil', label: 'CUIL', type: 'text', nowrap: true },
            { key: 'fecha_ingreso', label: 'Ingreso', type: 'date', render: e => fmtDate(e.fecha_ingreso) },
            { key: 'convenio_cct', label: 'CCT', type: 'text' },
            { key: 'categoria_laboral', label: 'Categoría', type: 'text' },
            {
              key: 'sector',
              label: 'Sector',
              type: 'select',
              options: [
                { value: 'Producción', label: 'Producción' },
                { value: 'Administración', label: 'Administración' },
                { value: 'Comercial', label: 'Comercial' },
              ],
            },
            { key: 'cbu', label: 'CBU (22 díg.)', type: 'text', nowrap: true },
            { key: 'sueldo_basico', label: 'Básico', type: 'number', min: 0, step: 0.01, align: 'right', parse: v => Math.max(0, Number(v) || 0), render: e => fmtMoney(e.sueldo_basico || 0) },
            {
              key: 'cuenta_sueldos_id',
              label: 'Cuenta Contable',
              type: 'select',
              options: [{ value: '', label: '-- Según Sector --' }, ...cuentasEgreso.map(c => ({ value: String(c.id), label: `${c.codigo} — ${c.nombre}` }))],
              getValue: e => (e.cuenta_sueldos_id ? String(e.cuenta_sueldos_id) : ''),
              parse: v => (v ? Number(v) : null),
              render: e => (e.cuenta_nombre ? esc(e.cuenta_nombre) : '<span class="muted">Según sector</span>'),
            },
            { key: 'activo', label: 'Activo', type: 'checkbox', align: 'center', getValue: e => (Number(e.activo) !== 0 ? 1 : 0) },
          ],
          onCellChange: async ({ row, key, value }) => {
            try {
              await api(`/api/nomina/empleados/${row.id}`, {
                method: 'PUT',
                body: JSON.stringify({ [key]: value }),
              });
              toast('Empleado actualizado');
            } catch (err) {
              toast(err.message, true);
              throw err;
            }
          },
          onDeleteRow: async (e) => {
            if (!(await showConfirmModal(`¿Eliminar a "${e.nombre}"?`))) return;
            try {
              await api(`/api/nomina/empleados/${e.id}`, { method: 'DELETE' });
              toast('Empleado eliminado');
              await draw();
            } catch (err) { toast(err.message, true); }
          },
        });

        renderSpreadsheetTable(root.querySelector('#nomina-conc-sheet'), {
          rows: conceptos,
          emptyText: 'Sin conceptos configurados.',
          compact: true,
          defaultNewRow: () => ({
            codigo_interno: '',
            descripcion: '',
            tipo: 'remunerativo',
            codigo_afip_lsd: '110000',
            formula_tipo: 'manual',
            valor_default: 0,
            aporta_sipa: 1,
            aporta_inssjp: 1,
            aporta_os: 1,
            aporta_lrt: 1,
            activo: 1,
          }),
          onCreateRow: async ({ row }) => {
            if (!String(row.codigo_interno || '').trim() || !String(row.descripcion || '').trim()) return false;
            try {
              await api('/api/nomina/conceptos', { method: 'POST', body: JSON.stringify(row) });
              toast('Concepto creado');
              await draw();
              return false;
            } catch (err) {
              toast(err.message, true);
              throw err;
            }
          },
          columns: [
            { key: 'codigo_interno', label: 'Cód. Interno', type: 'text', nowrap: true, render: c => (c.codigo_interno ? `<code>${esc(c.codigo_interno)}</code>` : '<span class="muted">Ej: PREMIO</span>') },
            { key: 'codigo_afip_lsd', label: 'Cód. ARCA LSD', type: 'text', nowrap: true },
            { key: 'descripcion', label: 'Descripción', type: 'text' },
            {
              key: 'tipo',
              label: 'Tipo',
              type: 'select',
              options: [
                { value: 'remunerativo', label: 'Remunerativo' },
                { value: 'no_remunerativo', label: 'No Remunerativo' },
                { value: 'descuento_retencion', label: 'Descuento / Retención' },
                { value: 'contribucion_patronal', label: 'Contribución Patronal' },
              ],
            },
            {
              key: 'formula_tipo',
              label: 'Fórmula',
              type: 'select',
              options: [
                { value: 'manual', label: 'Manual' },
                { value: 'fijo', label: 'Monto Fijo' },
                { value: 'porcentaje_basico', label: '% Básico' },
                { value: 'porcentaje_remunerativo', label: '% Remunerativo' },
              ],
            },
            { key: 'valor_default', label: 'Valor / %', type: 'number', step: 0.01, align: 'right', parse: v => Number(v) || 0 },
            { key: 'aporta_sipa', label: 'SIPA', type: 'checkbox', align: 'center', getValue: c => (Number(c.aporta_sipa) ? 1 : 0) },
            { key: 'aporta_os', label: 'OS', type: 'checkbox', align: 'center', getValue: c => (Number(c.aporta_os) ? 1 : 0) },
            { key: 'activo', label: 'Activo', type: 'checkbox', align: 'center', getValue: c => (Number(c.activo) !== 0 ? 1 : 0) },
          ],
          onCellChange: async ({ row, key, value }) => {
            try {
              await api(`/api/nomina/conceptos/${row.id}`, {
                method: 'PUT',
                body: JSON.stringify({ [key]: value }),
              });
              toast('Concepto actualizado');
            } catch (err) {
              toast(err.message, true);
              throw err;
            }
          },
        });

        root.querySelector('#form-nomina-params')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          try {
            await api('/api/nomina/parametros', {
              method: 'PUT',
              body: JSON.stringify(Object.fromEntries(fd.entries())),
            });
            toast('Parámetros previsionales guardados');
            await draw();
          } catch (err) { toast(err.message, true); }
        });

        root.querySelector('#btn-nueva-liq')?.addEventListener('click', () => {
          showFormModal({
            title: 'Nueva Liquidación de Haberes',
            submitText: 'Generar Liquidación (Borrador)',
            initialState: {
              periodo: new Date().toISOString().slice(0, 7),
              tipo_liquidacion: 'Mensual',
              fecha_liquidacion: new Date().toISOString().slice(0, 10),
              fecha_pago: new Date().toISOString().slice(0, 10),
            },
            fields: [
              { name: 'periodo', label: 'Período (YYYY-MM) *', type: 'text', required: true },
              {
                name: 'tipo_liquidacion',
                label: 'Tipo de Liquidación',
                type: 'select',
                options: ['Mensual', 'Primera Quincena', 'Segunda Quincena', 'SAC / Aguinaldo', 'Vacaciones', 'Liquidación Final'].map(v => ({ value: v, label: v })),
              },
              { name: 'fecha_liquidacion', label: 'Fecha Liquidación *', type: 'date', required: true },
              { name: 'fecha_pago', label: 'Fecha Pago *', type: 'date', required: true },
            ],
            onSubmit: async (data) => {
              try {
                const res = await api('/api/nomina/liquidaciones', { method: 'POST', body: JSON.stringify(data) });
                selectedLiqId = res.id;
                toast('Liquidación generada con cálculos previsionales');
                await draw();
                return true;
              } catch (err) {
                toast(err.message, true);
                throw err;
              }
            },
          });
        });

        root.querySelector('#btn-lsd-liq')?.addEventListener('click', () => {
          if (selectedLiqId) window.open(`/api/nomina/liquidaciones/${selectedLiqId}/lsd.txt`, '_blank');
        });
        root.querySelector('#btn-recibos-lote')?.addEventListener('click', () => {
          if (selectedLiqId) openPdfFromEndpoint(`/api/nomina/liquidaciones/${selectedLiqId}/recibos-pdf`, {}, `Recibos_Liq_${selectedLiqId}.pdf`);
        });
        root.querySelector('#btn-f931-liq')?.addEventListener('click', async () => {
          if (!selectedLiqId) return;
          try {
            const f931 = await api(`/api/nomina/liquidaciones/${selectedLiqId}/f931`);
            createModal({
              title: `Papel de Trabajo F.931 ARCA — Período ${esc(f931.periodo)}`,
              bodyHtml: `
                <div class="ve-detail-kpis mb-md">
                  <div class="ve-kpi-card"><div class="ve-kpi-label">Empleados</div><div class="ve-kpi-value">${f931.cantidad_empleados}</div></div>
                  <div class="ve-kpi-card"><div class="ve-kpi-label">Total Remun.</div><div class="ve-kpi-value">${fmtMoney(f931.total_remunerativo)}</div></div>
                  <div class="ve-kpi-card"><div class="ve-kpi-label">Total F.931 ARCA</div><div class="ve-kpi-value">${fmtMoney(f931.total_f931_arca)}</div></div>
                  <div class="ve-kpi-card"><div class="ve-kpi-label">Sindicato</div><div class="ve-kpi-value">${fmtMoney(f931.total_sindicato)}</div></div>
                </div>
                <p class="muted text-sm mb-sm"><strong>Bases Imponibles:</strong> Base 1 (SIPA Ap.): ${fmtMoney(f931.bases_totales.base_1)} · Base 2 (SIPA Cont.): ${fmtMoney(f931.bases_totales.base_2)} · Base 4 (OS Ap.): ${fmtMoney(f931.bases_totales.base_4)} · Base 9 (LRT): ${fmtMoney(f931.bases_totales.base_9)}</p>
                <p class="muted text-sm"><strong>Aportes Trabajador:</strong> Jubilación ${fmtMoney(f931.aportes_trabajador.jubilacion_sipa)} · PAMI ${fmtMoney(f931.aportes_trabajador.inssjp_pami)} · OS ${fmtMoney(f931.aportes_trabajador.obra_social)}</p>
                <p class="muted text-sm"><strong>Contribuciones Empleador:</strong> SIPA/FNE ${fmtMoney(f931.contribuciones_empleador.sipa_inssjp_fne)} · OS ${fmtMoney(f931.contribuciones_empleador.obra_social)} · ART/SCVO ${fmtMoney(f931.contribuciones_empleador.art_lrt_scvo)}</p>
              `,
              footerHtml: '<button type="button" class="btn btn-primary" data-close-modal>Cerrar</button>',
              onMount: (el) => el.querySelector('[data-close-modal]')?.addEventListener('click', () => el.closest('.modal-backdrop')?.remove()),
            });
          } catch (err) { toast(err.message, true); }
        });

        root.querySelectorAll('[data-sel-liq]').forEach(btn => {
          btn.addEventListener('click', async () => {
            selectedLiqId = Number(btn.dataset.selLiq);
            await draw();
          });
        });
        root.querySelectorAll('[data-pdf-rec]').forEach(btn => {
          btn.addEventListener('click', () => {
            openPdfFromEndpoint(`/api/nomina/liquidaciones/${selectedLiqId}/recibos-pdf?recibo_id=${btn.dataset.pdfRec}`, {}, `Recibo_${btn.dataset.pdfRec}.pdf`);
          });
        });
        root.querySelectorAll('[data-nov-rec]').forEach(btn => {
          btn.addEventListener('click', () => {
            const haberesConc = conceptos.filter(c => c.tipo === 'remunerativo' || c.tipo === 'no_remunerativo');
            showFormModal({
              title: 'Agregar Novedad al Recibo',
              submitText: 'Agregar y Recalcular',
              initialState: {
                concepto_id: haberesConc[0]?.id ? String(haberesConc[0].id) : '',
                descripcion: '',
                cantidad: 1,
                importe_haber: 0,
                importe_descuento: 0,
              },
              fields: [
                { name: 'concepto_id', label: 'Concepto ARCA', type: 'select', options: haberesConc.map(c => ({ value: String(c.id), label: `${c.codigo_afip_lsd} · ${c.descripcion}` })) },
                { name: 'descripcion', label: 'Descripción (opcional)', type: 'text' },
                { name: 'cantidad', label: 'Cantidad', type: 'number', step: 0.01 },
                { name: 'importe_haber', label: 'Importe Haber ($)', type: 'number', step: 0.01, min: 0 },
                { name: 'importe_descuento', label: 'Importe Descuento ($)', type: 'number', step: 0.01, min: 0 },
              ],
              onSubmit: async (data) => {
                try {
                  await api(`/api/nomina/recibos/${btn.dataset.novRec}/novedades`, {
                    method: 'POST',
                    body: JSON.stringify(data),
                  });
                  toast('Novedad agregada y recibo recalculado');
                  await draw();
                  return true;
                } catch (err) {
                  toast(err.message, true);
                  throw err;
                }
              },
            });
          });
        });
        root.querySelectorAll('[data-conf-liq]').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (!(await showConfirmModal('¿Confirmar esta liquidación? Se generará el asiento contable de devengamiento.'))) return;
            try {
              await api(`/api/nomina/liquidaciones/${btn.dataset.confLiq}/confirmar`, { method: 'POST', body: '{}' });
              toast('Liquidación confirmada y contabilizada');
              await draw();
            } catch (err) { toast(err.message, true); }
          });
        });
        root.querySelectorAll('[data-anul-liq]').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (!(await showConfirmModal('¿Anular esta liquidación? Se revertirá el asiento contable.', { danger: true }))) return;
            try {
              await api(`/api/nomina/liquidaciones/${btn.dataset.anulLiq}/anular`, { method: 'POST', body: '{}' });
              toast('Liquidación anulada');
              await draw();
            } catch (err) { toast(err.message, true); }
          });
        });
        root.querySelectorAll('[data-del-liq]').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (!(await showConfirmModal('¿Eliminar este borrador de liquidación?', { danger: true }))) return;
            try {
              await api(`/api/nomina/liquidaciones/${btn.dataset.delLiq}`, { method: 'DELETE' });
              if (Number(selectedLiqId) === Number(btn.dataset.delLiq)) selectedLiqId = null;
              toast('Liquidación eliminada');
              await draw();
            } catch (err) { toast(err.message, true); }
          });
        });
      },
    });
  };

  await draw();
}
