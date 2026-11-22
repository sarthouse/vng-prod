import { api, toast } from '../../lib/api.js';
import { esc } from '../../lib/format.js';
import { showConfirmModal, renderSpreadsheetTable } from '../../lib/engine/index.js';

export async function renderImpuestosView() {
  const root = document.getElementById('app-view');
  const config = await api('/api/config');
  const impuestos = config.impuestos || [];
  const jurisdicciones = config.jurisdicciones || [];
  const jurMap = new Map(jurisdicciones.map(j => [j.codigo, j.nombre]));

  root.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Impuestos</h1>
        <p class="muted">IVA, IIBB, percepciones, retenciones y otros tributos aplicables en compras y ventas.</p>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div>
          <h2>Impuestos</h2>
          <span class="muted text-sm">Click en una celda para editar · Completá la fila inferior para agregar un nuevo impuesto.</span>
        </div>
      </div>
      <div id="impuestos-sheet-host"></div>
    </div>
  `;

  renderSpreadsheetTable(root.querySelector('#impuestos-sheet-host'), {
    rows: impuestos,
    emptyText: 'Sin impuestos configurados.',
    compact: true,
    defaultNewRow: () => ({
      nombre: '',
      codigo: '',
      tipo: 'iva',
      aplica_a: 'ambos',
      jurisdiccion_codigo: '',
      codigo_regimen: '',
      alicuota_defecto: 0,
      base_calculo: 'neto',
      activo: 1,
    }),
    onCreateRow: async ({ row }) => {
      if (!String(row.nombre || '').trim()) return false;
      try {
        const res = await api('/api/impuestos', {
          method: 'POST',
          body: JSON.stringify({
            nombre: String(row.nombre).trim(),
            codigo: row.codigo || '',
            tipo: row.tipo || 'iva',
            aplica_a: row.aplica_a || 'ambos',
            alicuota_defecto: Number(row.alicuota_defecto) || 0,
            base_calculo: row.base_calculo || 'neto',
            jurisdiccion_codigo: row.jurisdiccion_codigo || '',
            codigo_regimen: row.codigo_regimen || '',
          }),
        });
        if (res?.id) row.id = res.id;
        toast('Impuesto agregado');
        return true;
      } catch (err) {
        toast(err.message, true);
        throw err;
      }
    },
    columns: [
      {
        key: 'nombre',
        label: 'Nombre',
        type: 'text',
        parse: (v) => String(v || '').trim(),
        render: (imp) => imp.nombre ? esc(imp.nombre) : '<span class="muted">Nuevo impuesto...</span>',
      },
      { key: 'codigo', label: 'Código', type: 'text', nowrap: true, render: (imp) => `<code>${esc(imp.codigo || '-')}</code>` },
      {
        key: 'tipo',
        label: 'Tipo',
        type: 'select',
        options: [
          { value: 'iva', label: 'IVA' },
          { value: 'percepcion', label: 'Percepción' },
          { value: 'retencion', label: 'Retención' },
          { value: 'impuesto_interno', label: 'Imp. Interno' },
          { value: 'otro', label: 'Otro' },
        ],
      },
      {
        key: 'aplica_a',
        label: 'Aplica a',
        type: 'select',
        options: [
          { value: 'ambos', label: 'Ambos' },
          { value: 'ventas', label: 'Ventas' },
          { value: 'compras', label: 'Compras' },
        ],
      },
      {
        key: 'jurisdiccion_codigo',
        label: 'Jurisdicción',
        type: 'select',
        options: [{ value: '', label: 'Nacional / Sin Jur.' }, ...jurisdicciones.map(j => ({ value: j.codigo, label: `${j.codigo} · ${j.nombre}` }))],
        getValue: (imp) => imp.jurisdiccion_codigo || '',
        render: (imp) => imp.jurisdiccion_codigo ? `<code>${esc(imp.jurisdiccion_codigo)}</code> ${esc(jurMap.get(imp.jurisdiccion_codigo) || '')}` : 'Nacional',
      },
      { key: 'codigo_regimen', label: 'Cód. Rég.', type: 'text', nowrap: true, render: (imp) => imp.codigo_regimen ? `<code>${esc(imp.codigo_regimen)}</code>` : '<span class="muted">-</span>' },
      { key: 'alicuota_defecto', label: 'Alícuota %', type: 'number', step: 0.01, min: 0, align: 'right', render: (imp) => `${Number(imp.alicuota_defecto || 0)}%`, parse: (v) => Number(v) || 0 },
      {
        key: 'base_calculo',
        label: 'Base',
        type: 'select',
        options: [{ value: 'neto', label: 'Neto' }, { value: 'total', label: 'Total' }, { value: 'fijo', label: 'Fijo' }],
      },
      { key: 'activo', label: 'Activo', type: 'checkbox', align: 'center' },
    ],
    onDeleteRow: async (imp) => {
      if (!(await showConfirmModal('¿Eliminar este impuesto?'))) return;
      try {
        await api(`/api/impuestos/${imp.id}`, { method: 'DELETE' });
        toast('Impuesto eliminado');
        await renderImpuestosView();
      } catch (err) { toast(err.message, true); }
    },
    onCellChange: async ({ row, key, value }) => {
      try {
        await api(`/api/impuestos/${row.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            nombre: key === 'nombre' ? value : row.nombre,
            codigo: key === 'codigo' ? value : (row.codigo || ''),
            tipo: key === 'tipo' ? value : row.tipo,
            aplica_a: key === 'aplica_a' ? value : row.aplica_a,
            jurisdiccion_codigo: key === 'jurisdiccion_codigo' ? value : (row.jurisdiccion_codigo || ''),
            codigo_regimen: key === 'codigo_regimen' ? value : (row.codigo_regimen || ''),
            alicuota_defecto: key === 'alicuota_defecto' ? value : Number(row.alicuota_defecto || 0),
            base_calculo: key === 'base_calculo' ? value : (row.base_calculo || 'neto'),
            activo: key === 'activo' ? Boolean(Number(value)) : Boolean(row.activo),
          }),
        });
        toast('Impuesto actualizado');
      } catch (err) {
        toast(err.message, true);
        throw err;
      }
    },
  });
}
