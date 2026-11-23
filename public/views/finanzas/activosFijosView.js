import { api, toast } from '../../lib/api.js';
import { esc, fmtMoney, fmtDate } from '../../lib/format.js';
import {
  mountPageView,
  renderKpiStrip,
  renderSpreadsheetTable,
  renderDataTable,
  showFormModal,
  showConfirmModal,
} from '../../lib/engine/index.js';

function estadoBadge(estado) {
  if (estado === 'Activo') return '<span class="badge badge-ok">Activo</span>';
  if (estado === 'Amortizado') return '<span class="badge badge-parcial">Amortizado</span>';
  return '<span class="badge badge-muted">Dado de Baja</span>';
}

export async function renderActivosFijosView() {
  const root = document.getElementById('app-view');

  const draw = async () => {
    const [activos, amortizaciones] = await Promise.all([
      api('/api/activos').catch(() => []),
      api('/api/activos/amortizaciones').catch(() => []),
    ]);

    const vigentes = activos.filter(a => a.estado !== 'Dado de Baja');
    const totalOrigen = vigentes.reduce((s, a) => s + Number(a.valor_origen || 0), 0);
    const totalAcum = vigentes.reduce((s, a) => s + Number(a.amortizacion_acumulada || 0), 0);
    const totalNeto = vigentes.reduce((s, a) => s + Number(a.valor_neto_contable || 0), 0);

    const openRunAmortModal = () => {
      const defaultPeriodo = new Date().toISOString().slice(0, 7);
      const hoy = new Date().toISOString().slice(0, 10);
      showFormModal({
        title: 'Ejecutar Amortización del Período',
        submitText: 'Confirmar y Contabilizar',
        initialState: { periodo: defaultPeriodo, fecha: hoy },
        fields: [
          { name: 'periodo', label: 'Período (YYYY-MM) *', type: 'text', required: true, placeholder: '2026-11' },
          { name: 'fecha', label: 'Fecha del Asiento *', type: 'date', required: true },
        ],
        onSubmit: async (data) => {
          const ok = await showConfirmModal(
            `¿Ejecutar la amortización mensual del período ${data.periodo} para todos los bienes en estado Activo? Se generará un asiento contable consolidado.`,
          );
          if (!ok) return false;
          try {
            const res = await api('/api/activos/amortizar', {
              method: 'POST',
              body: JSON.stringify({ periodo: data.periodo, fecha: data.fecha }),
            });
            toast(`Amortizados ${res.amortizados} bienes por ${fmtMoney(res.total_monto)}`);
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
      title: 'Activos Fijos (Bienes de Uso)',
      subtitle: 'Control patrimonial, cálculo de cuotas de amortización mensual y bajas contables.',
      actions: [{ label: 'Ejecutar Amortización del Período', primary: true, onClick: openRunAmortModal }],
      kpis: [
        { label: 'Bienes Vigentes', value: String(vigentes.length), tone: 'success' },
        { label: 'Valor de Origen', value: fmtMoney(totalOrigen) },
        { label: 'Amort. Acumulada', value: fmtMoney(totalAcum) },
        { label: 'Valor Neto Contable', value: fmtMoney(totalNeto), tone: 'accent' },
      ],
      tabs: [
        {
          id: 'bienes',
          label: 'Bienes de Uso',
          badge: activos.length,
          html: `
            <div class="card">
              <div class="card-header">
                <div>
                  <h2>Listado de Activos Fijos</h2>
                  <span class="muted text-sm">Click en una celda para editar · Completá la fila inferior para dar de alta un nuevo bien.</span>
                </div>
              </div>
              <div id="af-sheet-host"></div>
            </div>
          `,
        },
        {
          id: 'amortizaciones',
          label: 'Historial de Amortizaciones',
          badge: amortizaciones.length,
          html: `
            <div class="card">
              <div class="card-header">
                <h2>Corridas de Amortización Registradas</h2>
              </div>
              <div id="af-amort-table"></div>
            </div>
          `,
        },
      ],
      onAfterMount: () => {
        renderSpreadsheetTable(root.querySelector('#af-sheet-host'), {
          rows: activos,
          emptyText: 'No hay activos fijos registrados.',
          compact: true,
          defaultNewRow: () => ({
            codigo: '',
            nombre: '',
            categoria: 'Maquinaria y Equipos',
            fecha_alta: new Date().toISOString().slice(0, 10),
            valor_origen: 0,
            valor_residual: 0,
            vida_util_meses: 60,
            amortizacion_acumulada: 0,
            valor_neto_contable: 0,
            cuota_mensual: 0,
            estado: 'Activo',
          }),
          onCreateRow: async ({ row }) => {
            if (!String(row.nombre || '').trim()) return false;
            try {
              await api('/api/activos', {
                method: 'POST',
                body: JSON.stringify({
                  codigo: row.codigo || '',
                  nombre: String(row.nombre).trim(),
                  categoria: row.categoria || 'Maquinaria y Equipos',
                  fecha_alta: row.fecha_alta || new Date().toISOString().slice(0, 10),
                  valor_origen: Number(row.valor_origen || 0),
                  valor_residual: Number(row.valor_residual || 0),
                  vida_util_meses: Math.max(1, Number(row.vida_util_meses || 60)),
                }),
              });
              toast('Activo fijo registrado');
              await draw();
              return false;
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
              editable: a => a.estado !== 'Dado de Baja',
              render: a => (a.codigo ? `<code>${esc(a.codigo)}</code>` : '<span class="muted">Auto</span>'),
            },
            {
              key: 'nombre',
              label: 'Nombre del Bien',
              type: 'text',
              editable: a => a.estado !== 'Dado de Baja',
              render: a => (a.nombre ? `<strong>${esc(a.nombre)}</strong>` : '<span class="muted">Nuevo activo fijo...</span>'),
            },
            {
              key: 'categoria',
              label: 'Categoría',
              type: 'select',
              editable: a => a.estado !== 'Dado de Baja',
              options: [
                { value: 'Maquinaria y Equipos', label: 'Maquinaria y Equipos' },
                { value: 'Rodados', label: 'Rodados' },
                { value: 'Muebles y Útiles', label: 'Muebles y Útiles' },
                { value: 'Equipos de Computación', label: 'Equipos de Computación' },
                { value: 'Inmuebles', label: 'Inmuebles' },
              ],
            },
            {
              key: 'fecha_alta',
              label: 'Fecha Alta',
              type: 'date',
              editable: a => a.estado !== 'Dado de Baja',
              render: a => fmtDate(a.fecha_alta),
            },
            {
              key: 'valor_origen',
              label: 'Valor Origen',
              type: 'number',
              min: 0,
              step: 0.01,
              align: 'right',
              editable: a => a.estado !== 'Dado de Baja',
              parse: v => Number(v) || 0,
              render: a => fmtMoney(a.valor_origen || 0),
            },
            {
              key: 'valor_residual',
              label: 'Valor Residual',
              type: 'number',
              min: 0,
              step: 0.01,
              align: 'right',
              editable: a => a.estado !== 'Dado de Baja',
              parse: v => Number(v) || 0,
              render: a => fmtMoney(a.valor_residual || 0),
            },
            {
              key: 'vida_util_meses',
              label: 'Vida Útil (m)',
              type: 'number',
              min: 1,
              align: 'right',
              editable: a => a.estado !== 'Dado de Baja',
              parse: v => Math.max(1, Math.round(Number(v) || 1)),
            },
            {
              key: 'cuota_mensual',
              label: 'Cuota/Mes',
              align: 'right',
              editable: () => false,
              render: a => (a.__isNew ? '<span class="muted">-</span>' : fmtMoney(a.cuota_mensual || 0)),
            },
            {
              key: 'amortizacion_acumulada',
              label: 'Amort. Acum.',
              align: 'right',
              editable: () => false,
              render: a => (a.__isNew ? '<span class="muted">-</span>' : fmtMoney(a.amortizacion_acumulada || 0)),
            },
            {
              key: 'valor_neto_contable',
              label: 'Valor Neto',
              align: 'right',
              editable: () => false,
              render: a => (a.__isNew ? '<span class="muted">-</span>' : `<strong>${fmtMoney(a.valor_neto_contable || 0)}</strong>`),
            },
            {
              key: 'estado',
              label: 'Estado',
              editable: () => false,
              render: a => (a.__isNew ? '<span class="muted">Nuevo</span>' : estadoBadge(a.estado)),
            },
          ],
          onCellChange: async ({ row, key, value }) => {
            try {
              await api(`/api/activos/${row.id}`, {
                method: 'PUT',
                body: JSON.stringify({ [key]: value }),
              });
              toast('Activo fijo actualizado');
              await draw();
            } catch (err) {
              toast(err.message, true);
              throw err;
            }
          },
          canDeleteRow: a => !a.__isNew && Number(a.amortizacion_acumulada || 0) === 0,
          onDeleteRow: async (a) => {
            if (!(await showConfirmModal(`¿Eliminar "${a.nombre}"?`))) return;
            try {
              await api(`/api/activos/${a.id}`, { method: 'DELETE' });
              toast('Activo eliminado');
              await draw();
            } catch (err) { toast(err.message, true); }
          },
          extraActions: a => (a.estado !== 'Dado de Baja'
            ? `<button type="button" class="btn btn-sm btn-danger" data-baja-activo="${a.id}">Baja</button>`
            : ''),
        });

        renderDataTable(root.querySelector('#af-amort-table'), {
          emptyText: 'Aún no se ejecutaron corridas de amortización.',
          rows: amortizaciones,
          columns: [
            { label: 'Período', render: r => `<code>${esc(r.periodo)}</code>` },
            { label: 'Activo Fijo', render: r => `<strong>${esc(r.activo_codigo || '')}</strong> ${esc(r.activo_nombre || '')}` },
            { label: 'Fecha', render: r => fmtDate(r.fecha) },
            { label: 'Monto Amortizado', align: 'right', render: r => `<strong>${fmtMoney(r.monto)}</strong>` },
            {
              label: 'Asiento',
              render: r => (r.asiento_id
                ? `<a href="/contabilidad" data-link class="badge badge-ok">Asiento #${r.asiento_id}</a>`
                : '<span class="muted">-</span>'),
            },
          ],
        });

        root.querySelectorAll('[data-baja-activo]').forEach(btn => {
          btn.addEventListener('click', () => {
            const act = activos.find(a => String(a.id) === String(btn.dataset.bajaActivo));
            if (!act) return;
            const hoy = new Date().toISOString().slice(0, 10);
            showFormModal({
              title: `Dar de Baja — ${act.codigo} ${act.nombre}`,
              submitText: 'Confirmar Baja Contable',
              initialState: { fecha: hoy, motivo: '' },
              fields: [
                { name: 'fecha', label: 'Fecha de Baja *', type: 'date', required: true },
                { name: 'motivo', label: 'Motivo de Baja', type: 'text', placeholder: 'Venta, rotura u obsolescencia', full: true },
              ],
              onSubmit: async (data) => {
                try {
                  const res = await api(`/api/activos/${act.id}/baja`, {
                    method: 'POST',
                    body: JSON.stringify(data),
                  });
                  toast(`Activo dado de baja (Valor residual contable: ${fmtMoney(res.valor_residual_contable)})`);
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
      },
    });
  };

  await draw();
}
