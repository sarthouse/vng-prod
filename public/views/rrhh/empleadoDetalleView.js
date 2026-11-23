import { api, toast } from '../../lib/api.js';
import { esc, fmtMoney, fmtDate } from '../../lib/format.js';
import { openPdfFromEndpoint } from '../../lib/print/index.js';
import { fetchCustomFieldDefs, renderCustomFieldsSection } from '../../lib/customFieldsHelper.js';
import {
  mountPageView,
  renderSpreadsheetTable,
  renderDataTable,
  showFormModal,
} from '../../lib/engine/index.js';

const TIPOS_LICENCIA = [
  'Vacaciones',
  'Ausencia Injustificada',
  'Ausencia Justificada',
  'Licencia Médica',
  'Licencia Maternidad',
  'Permiso Especial',
  'Otro',
];

export async function renderEmpleadoDetalleView(params = {}) {
  const root = document.getElementById('app-view');
  const empId = Number(params.id);

  const draw = async () => {
    const [det, planCuentas, empCfDefs] = await Promise.all([
      api(`/api/nomina/empleados/${empId}`).catch(() => null),
      api('/api/tesoreria/plan-cuentas').catch(() => []),
      fetchCustomFieldDefs('empleados'),
    ]);

    if (!det || !det.empleado) {
      mountPageView(root, {
        breadcrumb: { href: '/rrhh/empleados', label: 'Empleados' },
        title: 'Empleado no encontrado',
        bodyHtml: '<div class="empty-state">El legajo solicitado no existe.</div>',
      });
      return;
    }

    const { empleado: emp, licencias = [], recibos = [] } = det;
    const nombreCompleto = `${emp.apellido || ''} ${emp.nombre || ''}`.trim();
    const cuentasEgreso = (planCuentas || []).filter(c => Number(c.activo) !== 0 && Number(c.imputable) !== 0 && c.tipo === 'egreso');
    const diasVacaciones = licencias.filter(l => l.tipo === 'Vacaciones' && l.estado !== 'Rechazada').reduce((s, l) => s + Number(l.dias || 0), 0);
    const diasAusencias = licencias.filter(l => l.tipo.startsWith('Ausencia') && l.estado !== 'Rechazada').reduce((s, l) => s + Number(l.dias || 0), 0);

    const openLiquidarEmpleadoModal = () => {
      showFormModal({
        title: `Nueva Liquidación — ${nombreCompleto}`,
        submitText: 'Generar Liquidación Individual',
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
            await api('/api/nomina/liquidaciones', {
              method: 'POST',
              body: JSON.stringify({ ...data, empleado_ids: [emp.id] }),
            });
            toast(`Liquidación generada para ${nombreCompleto}`);
            await draw();
            return true;
          } catch (err) {
            toast(err.message, true);
            throw err;
          }
        },
      });
    };

    mountPageView(root, {
      breadcrumb: { href: '/rrhh/empleados', label: 'Padrón de Empleados' },
      title: `${nombreCompleto}${emp.legajo ? ` (${emp.legajo})` : ''}`,
      subtitle: `${emp.puesto || emp.categoria_laboral || 'Empleado'} · ${emp.sector} · CUIL: ${emp.cuil || 'Sin informar'}`,
      actions: [
        { label: '+ Liquidar Empleado', primary: true, onClick: openLiquidarEmpleadoModal },
      ],
      kpis: [
        { label: 'Sueldo Básico', value: fmtMoney(emp.sueldo_basico || 0), tone: 'accent' },
        { label: 'Recibos Emitidos', value: String(recibos.length) },
        { label: 'Días Vacaciones', value: String(diasVacaciones), tone: 'success' },
        { label: 'Días Ausencias', value: String(diasAusencias) },
      ],
      tabs: [
        {
          id: 'licencias',
          label: 'Vacaciones, Ausencias y Licencias',
          badge: licencias.length,
          html: `
            <div class="card">
              <div class="card-header">
                <div>
                  <h2>Registro de Vacaciones, Ausencias y Licencias</h2>
                  <span class="muted text-sm">Las ausencias aprobadas sin goce de sueldo se descuentan automáticamente al generar la liquidación del período.</span>
                </div>
              </div>
              <div id="emp-licencias-sheet"></div>
            </div>
          `,
        },
        {
          id: 'recibos',
          label: 'Liquidaciones y Recibos',
          badge: recibos.length,
          html: `
            <div class="card">
              <div class="card-header">
                <h2>Historial de Recibos de Haberes</h2>
              </div>
              <div id="emp-recibos-table"></div>
            </div>
          `,
        },
        {
          id: 'legajo',
          label: 'Datos Laborales, Observaciones y Notas',
          html: `
            <div class="card">
              <div class="card-header">
                <h2>Legajo, Datos SICOSS/ARCA y Notas Internas</h2>
              </div>
              <form id="form-emp-detalle" class="form-grid">
                <label><span>Legajo</span><input type="text" name="legajo" value="${esc(emp.legajo || '')}" /></label>
                <label><span>CUIL</span><input type="text" name="cuil" value="${esc(emp.cuil || '')}" /></label>
                <label><span>Apellido</span><input type="text" name="apellido" value="${esc(emp.apellido || '')}" /></label>
                <label><span>Nombre *</span><input type="text" name="nombre" value="${esc(emp.nombre || '')}" required /></label>
                <label><span>Fecha Ingreso</span><input type="date" name="fecha_ingreso" value="${esc(emp.fecha_ingreso || '')}" /></label>
                <label><span>Fecha Egreso</span><input type="date" name="fecha_egreso" value="${esc(emp.fecha_egreso || '')}" /></label>
                <label><span>Puesto</span><input type="text" name="puesto" value="${esc(emp.puesto || '')}" /></label>
                <label><span>Sector</span>
                  <select name="sector">
                    ${['Producción', 'Administración', 'Comercial'].map(s => `<option value="${s}" ${emp.sector === s ? 'selected' : ''}>${s}</option>`).join('')}
                  </select>
                </label>
                <label><span>Convenio CCT</span><input type="text" name="convenio_cct" value="${esc(emp.convenio_cct || '')}" /></label>
                <label><span>Categoría</span><input type="text" name="categoria_laboral" value="${esc(emp.categoria_laboral || '')}" /></label>
                <label><span>Sueldo Básico ($)</span><input type="number" step="0.01" min="0" name="sueldo_basico" value="${Number(emp.sueldo_basico || 0)}" /></label>
                <label><span>CBU (22 dígitos)</span><input type="text" name="cbu" value="${esc(emp.cbu || '')}" /></label>
                <label><span>Cuenta Sueldos</span>
                  <select name="cuenta_sueldos_id">
                    <option value="">Por defecto del sector</option>
                    ${cuentasEgreso.map(c => `<option value="${c.id}" ${Number(emp.cuenta_sueldos_id) === Number(c.id) ? 'selected' : ''}>${esc(c.codigo)} · ${esc(c.nombre)}</option>`).join('')}
                  </select>
                </label>
                <label><span>Cód. Modalidad AFIP</span><input type="text" name="modalidad_contrato_afip" value="${esc(emp.modalidad_contrato_afip || '008')}" /></label>
                <label><span>Cód. Situación Revista</span><input type="text" name="situacion_revista_afip" value="${esc(emp.situacion_revista_afip || '01')}" /></label>
                <label class="full"><span>Observaciones</span><textarea name="observaciones" rows="2">${esc(emp.observaciones || '')}</textarea></label>
                <label class="full"><span>Notas de Legajo / Seguimiento</span><textarea name="notas" rows="3">${esc(emp.notas || '')}</textarea></label>
                <div id="emp-custom-fields-host" class="full"></div>
                <div class="actions full">
                  <button type="submit" class="btn btn-primary">Guardar Cambios del Legajo</button>
                </div>
              </form>
            </div>
          `,
        },
      ],
      onAfterMount: () => {
        renderSpreadsheetTable(root.querySelector('#emp-licencias-sheet'), {
          rows: licencias,
          emptyText: 'Sin vacaciones, ausencias ni licencias registradas.',
          compact: true,
          defaultNewRow: () => ({
            tipo: 'Vacaciones',
            fecha_desde: new Date().toISOString().slice(0, 10),
            fecha_hasta: new Date().toISOString().slice(0, 10),
            dias: 1,
            con_goce: 1,
            estado: 'Aprobada',
            observaciones: '',
          }),
          onCreateRow: async ({ row }) => {
            if (!row.fecha_desde) return false;
            try {
              await api('/api/nomina/licencias', {
                method: 'POST',
                body: JSON.stringify({
                  ...row,
                  empleado_id: emp.id,
                  dias: Number(row.dias || 0),
                  con_goce: Number(row.con_goce) ? 1 : 0,
                }),
              });
              toast('Novedad / licencia registrada');
              await draw();
              return false;
            } catch (err) {
              toast(err.message, true);
              throw err;
            }
          },
          onCellChange: async ({ row, key, value }) => {
            try {
              await api(`/api/nomina/licencias/${row.id}`, {
                method: 'PUT',
                body: JSON.stringify({
                  [key]: ['con_goce'].includes(key) ? (Number(value) ? 1 : 0) : (key === 'dias' ? Number(value) : value),
                }),
              });
              toast('Licencia actualizada');
              await draw();
            } catch (err) {
              toast(err.message, true);
              throw err;
            }
          },
          onDeleteRow: async (row) => {
            try {
              await api(`/api/nomina/licencias/${row.id}`, { method: 'DELETE' });
              toast('Registro eliminado');
              await draw();
            } catch (err) {
              toast(err.message, true);
            }
          },
          columns: [
            { key: 'tipo', label: 'Tipo', type: 'select', options: TIPOS_LICENCIA.map(v => ({ value: v, label: v })) },
            { key: 'periodo', label: 'Período', type: 'text', readOnly: true },
            { key: 'fecha_desde', label: 'Desde', type: 'date', render: r => fmtDate(r.fecha_desde) },
            { key: 'fecha_hasta', label: 'Hasta', type: 'date', render: r => fmtDate(r.fecha_hasta) },
            { key: 'dias', label: 'Días', type: 'number', align: 'right' },
            { key: 'con_goce', label: 'Con Goce', type: 'checkbox', align: 'center', getValue: r => (Number(r.con_goce) ? 1 : 0) },
            { key: 'estado', label: 'Estado', type: 'select', options: ['Pendiente', 'Aprobada', 'Rechazada', 'Liquidada'].map(v => ({ value: v, label: v })) },
            { key: 'observaciones', label: 'Observaciones', type: 'text' },
          ],
        });

        renderDataTable(root.querySelector('#emp-recibos-table'), {
          rows: recibos,
          emptyText: 'Este empleado aún no tiene recibos liquidados.',
          columns: [
            { label: 'Liquidación', render: r => `<a href="/rrhh/liquidaciones/${r.liquidacion_id}" data-link class="link-primary">${esc(r.liquidacion_numero || '')}</a> <span class="muted">${esc(r.periodo)}</span>` },
            { label: 'Tipo', render: r => esc(r.tipo_liquidacion || 'Mensual') },
            { label: 'Estado', render: r => `<span class="badge ${r.liquidacion_estado === 'Confirmada' ? 'badge-ok' : 'badge-parcial'}">${esc(r.liquidacion_estado)}</span>` },
            { label: 'Días Trab.', align: 'right', render: r => String(r.dias_trabajados) },
            { label: 'Remunerativo', align: 'right', render: r => fmtMoney(r.total_remunerativo || 0) },
            { label: 'Deducciones', align: 'right', render: r => fmtMoney(r.total_descuentos || 0) },
            { label: 'Neto', align: 'right', render: r => `<strong>${fmtMoney(r.neto_a_pagar || 0)}</strong>` },
            {
              label: 'Recibo LCT',
              render: r => `<button type="button" class="btn btn-sm" data-print-rec="${r.id}" data-liq-id="${r.liquidacion_id}">PDF</button>`,
            },
          ],
        });

        root.querySelectorAll('[data-print-rec]').forEach(btn => {
          btn.addEventListener('click', () => {
            openPdfFromEndpoint(`/api/nomina/liquidaciones/${btn.dataset.liqId}/recibos-pdf?recibo_id=${btn.dataset.printRec}`, {
              title: `Recibo LCT — ${nombreCompleto}`,
            });
          });
        });

        const getEmpCustomFields = renderCustomFieldsSection(
          root.querySelector('#emp-custom-fields-host'),
          empCfDefs,
          emp.custom_fields || {},
        );

        root.querySelector('#form-emp-detalle')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const payload = Object.fromEntries(fd.entries());
          payload.sueldo_basico = Number(payload.sueldo_basico || 0);
          payload.cuenta_sueldos_id = payload.cuenta_sueldos_id ? Number(payload.cuenta_sueldos_id) : null;
          payload.custom_fields = getEmpCustomFields();
          try {
            await api(`/api/nomina/empleados/${emp.id}`, { method: 'PUT', body: JSON.stringify(payload) });
            toast('Legajo actualizado');
            await draw();
          } catch (err) {
            toast(err.message, true);
          }
        });
      },
    });
  };

  await draw();
}
