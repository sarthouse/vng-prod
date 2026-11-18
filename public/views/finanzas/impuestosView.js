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
        <h2>Impuestos</h2>
      </div>
      <form id="form-add-impuesto" class="toolbar sx-410c97">
        <input type="text" name="nombre" required placeholder="Nombre" class="sx-59af4e" />
        <input type="text" name="codigo" placeholder="Código" class="w-140" />
        <select name="tipo" class="w-140">
          <option value="iva">IVA</option>
          <option value="percepcion">Percepción</option>
          <option value="retencion">Retención</option>
          <option value="otro">Otro</option>
        </select>
        <select name="aplica_a" class="w-140">
          <option value="ambos">Compras y Ventas</option>
          <option value="compras">Solo Compras</option>
          <option value="ventas">Solo Ventas</option>
        </select>
        <input type="number" step="0.01" min="0" max="100" name="alicuota_defecto" placeholder="% Defecto" value="0" class="sx-1a3055" />
        <select name="base_calculo" class="w-140">
          <option value="neto">Sobre Neto</option>
          <option value="total">Sobre Total</option>
          <option value="fijo">Monto Fijo</option>
        </select>
        <select name="jurisdiccion_codigo" class="sx-39248f">
          <option value="">Nacional / Sin Jur.</option>
          ${jurisdicciones.map(j => `<option value="${esc(j.codigo)}">${esc(j.codigo)} · ${esc(j.nombre)}</option>`).join('')}
        </select>
        <input type="text" name="codigo_regimen" placeholder="Cód. Rég. (SICORE)" class="w-140" />
        <button type="submit" class="btn btn-primary">+ Agregar Impuesto</button>
      </form>
      <div id="impuestos-sheet-host"></div>
    </div>
  `;

  renderSpreadsheetTable(root.querySelector('#impuestos-sheet-host'), {
    rows: impuestos,
    emptyText: 'Sin impuestos configurados.',
    compact: true,
    columns: [
      { key: 'nombre', label: 'Nombre', type: 'text', parse: (v) => String(v || '').trim() },
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
          { value: 'venta', label: 'Ventas' },
          { value: 'compra', label: 'Compras' },
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

  root.querySelector('#form-add-impuesto')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/impuestos', {
        method: 'POST',
        body: JSON.stringify({
          nombre: fd.get('nombre'),
          codigo: fd.get('codigo'),
          tipo: fd.get('tipo'),
          aplica_a: fd.get('aplica_a'),
          alicuota_defecto: Number(fd.get('alicuota_defecto')) || 0,
          base_calculo: fd.get('base_calculo'),
          jurisdiccion_codigo: fd.get('jurisdiccion_codigo') || '',
          codigo_regimen: fd.get('codigo_regimen') || '',
        }),
      });
      toast('Impuesto agregado');
      await renderImpuestosView();
    } catch (err) { toast(err.message, true); }
  });

  root.querySelectorAll('[data-toggle-imp]').forEach(btn => btn.addEventListener('click', async () => {
    try {
      await api(`/api/impuestos/${btn.dataset.toggleImp}`, { method: 'PUT', body: JSON.stringify({ activo: btn.dataset.activo !== '1' }) });
      await renderImpuestosView();
    } catch (err) { toast(err.message, true); }
  }));

  root.querySelectorAll('[data-del-imp]').forEach(btn => btn.addEventListener('click', async () => {
    if (!(await showConfirmModal('¿Eliminar este impuesto?'))) return;
    try {
      await api(`/api/impuestos/${btn.dataset.delImp}`, { method: 'DELETE' });
      toast('Impuesto eliminado');
      await renderImpuestosView();
    } catch (err) { toast(err.message, true); }
  }));
}
