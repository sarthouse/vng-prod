import { api, toast } from '../../lib/api.js';
import { esc } from '../../lib/format.js';
import { showConfirmModal } from '../../lib/engine/index.js';

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
      <form id="form-add-impuesto" class="toolbar" style="margin-bottom:14px;flex-wrap:wrap;gap:8px;">
        <input type="text" name="nombre" required placeholder="Nombre" style="min-width:210px;" />
        <input type="text" name="codigo" placeholder="Código" style="width:140px;" />
        <select name="tipo" style="width:140px;">
          <option value="iva">IVA</option>
          <option value="percepcion">Percepción</option>
          <option value="retencion">Retención</option>
          <option value="otro">Otro</option>
        </select>
        <select name="aplica_a" style="width:140px;">
          <option value="ambos">Compras y Ventas</option>
          <option value="compras">Solo Compras</option>
          <option value="ventas">Solo Ventas</option>
        </select>
        <input type="number" step="0.01" min="0" max="100" name="alicuota_defecto" placeholder="% Defecto" value="0" style="width:110px;" />
        <select name="base_calculo" style="width:140px;">
          <option value="neto">Sobre Neto</option>
          <option value="total">Sobre Total</option>
          <option value="fijo">Monto Fijo</option>
        </select>
        <select name="jurisdiccion_codigo" style="width:170px;">
          <option value="">Nacional / Sin Jur.</option>
          ${jurisdicciones.map(j => `<option value="${esc(j.codigo)}">${esc(j.codigo)} · ${esc(j.nombre)}</option>`).join('')}
        </select>
        <input type="text" name="codigo_regimen" placeholder="Cód. Rég. (SICORE)" style="width:140px;" />
        <button type="submit" class="btn btn-primary">+ Agregar Impuesto</button>
      </form>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Código</th>
              <th>Tipo</th>
              <th>Aplica a</th>
              <th>Jurisdicción / Rég.</th>
              <th class="num">Alícuota</th>
              <th>Base</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${impuestos.length ? impuestos.map(imp => `
              <tr>
                <td><strong>${esc(imp.nombre)}</strong></td>
                <td><code>${esc(imp.codigo || '-')}</code></td>
                <td>${esc(imp.tipo)}</td>
                <td>${esc(imp.aplica_a)}</td>
                <td>${imp.jurisdiccion_codigo ? `<code>${esc(imp.jurisdiccion_codigo)}</code> ${esc(jurMap.get(imp.jurisdiccion_codigo) || '')}` : 'Nacional'}${imp.codigo_regimen ? ` · Rég. <code>${esc(imp.codigo_regimen)}</code>` : ''}</td>
                <td class="num">${Number(imp.alicuota_defecto || 0)}%</td>
                <td>${esc(imp.base_calculo || 'neto')}</td>
                <td><span class="badge ${imp.activo ? 'badge-ok' : 'badge-muted'}">${imp.activo ? 'Activo' : 'Inactivo'}</span></td>
                <td>
                  <div class="actions">
                    <button type="button" class="btn btn-sm" data-toggle-imp="${imp.id}" data-activo="${imp.activo ? 1 : 0}">${imp.activo ? 'Desactivar' : 'Activar'}</button>
                    <button type="button" class="btn btn-sm btn-danger" data-del-imp="${imp.id}">Eliminar</button>
                  </div>
                </td>
              </tr>
            `).join('') : '<tr><td colspan="9" class="muted" style="text-align:center;">Sin impuestos configurados.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;

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
