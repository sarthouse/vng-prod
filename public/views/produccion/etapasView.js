import { api, toast } from '../../lib/api.js';
import { esc } from '../../lib/format.js';
import { showConfirmModal } from '../../lib/engine/index.js';

export async function renderEtapasView() {
  const root = document.getElementById('app-view');
  const [config, talleres, planCuentas] = await Promise.all([
    api('/api/config'),
    api('/api/contactos?es_taller=1').catch(() => []),
    api('/api/tesoreria/plan-cuentas').catch(() => []),
  ]);
  const etapas = config.etapas || [];
  const cuentasEgreso = (planCuentas || []).filter(c => Number(c.activo) !== 0 && Number(c.imputable) !== 0 && (c.tipo === 'egreso' || c.tipo === 'activo'));
  const tallerOpts = (selectedId) => [
    '<option value="">-- Sin taller --</option>',
    ...talleres.map(t => `<option value="${t.id}" ${Number(selectedId) === Number(t.id) ? 'selected' : ''}>${esc(t.nombre)}</option>`),
  ].join('');
  const cuentaOpts = (selectedId) => [
    '<option value="">-- Cuenta por defecto --</option>',
    ...cuentasEgreso.map(c => `<option value="${c.id}" ${Number(selectedId) === Number(c.id) ? 'selected' : ''}>${esc(c.codigo)} · ${esc(c.nombre)}</option>`),
  ].join('');

  root.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Etapas</h1>
        <p class="muted">Plantilla base de etapas para nuevas recetas.</p>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2>Etapas</h2>
      </div>
      <form id="form-add-etapa" class="toolbar" style="margin-bottom:14px;flex-wrap:wrap;gap:8px;">
        <input type="number" name="orden" min="1" value="${etapas.length + 1}" placeholder="Orden" style="width:70px;" required />
        <input type="text" name="nombre" required placeholder="Nombre etapa" style="min-width:170px;" />
        <input type="text" name="descripcion" placeholder="Descripción" style="min-width:200px;flex:1;" />
        <input type="number" name="dias_estimados" min="0" value="3" placeholder="Días est." style="width:85px;" required />
        <input type="number" name="costo_unidad" min="0" step="0.01" value="0" placeholder="Costo/u ($)" style="width:105px;" title="Costo estimado de proceso por unidad" />
        <select name="taller_id" style="min-width:160px;">${tallerOpts(null)}</select>
        <select name="plan_cuenta_id" style="min-width:180px;">${cuentaOpts(null)}</select>
        <select name="depende_de_id" style="min-width:170px;">
          <option value="">-- Sin dependencia --</option>
          ${etapas.map(e => `<option value="${e.id}">Depende de: ${esc(e.nombre)}</option>`).join('')}
        </select>
        <button type="submit" class="btn btn-primary">+ Agregar Etapa</button>
      </form>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Orden</th>
              <th>Etapa</th>
              <th>Descripción</th>
              <th class="num">Días Est.</th>
              <th class="num">Costo / Unidad</th>
              <th>Taller</th>
              <th>Cuenta Contable</th>
              <th>Depende de</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${etapas.length ? etapas.map(et => `
              <tr>
                <td><input type="number" min="1" class="input-sm" data-etapa-orden="${et.id}" value="${et.orden}" style="width:65px;" /></td>
                <td><input type="text" class="input-sm" data-etapa-nombre="${et.id}" value="${esc(et.nombre)}" style="min-width:150px;" /></td>
                <td><input type="text" class="input-sm" data-etapa-desc="${et.id}" value="${esc(et.descripcion || '')}" placeholder="Sin descripción" style="min-width:180px;" /></td>
                <td class="num"><input type="number" min="0" class="input-sm" data-etapa-dias="${et.id}" value="${et.dias_estimados}" style="width:70px;text-align:right;" /> días</td>
                <td class="num"><input type="number" min="0" step="0.01" class="input-sm" data-etapa-costo="${et.id}" value="${Number(et.costo_unidad || 0)}" style="width:95px;text-align:right;" /></td>
                <td><select class="input-sm" data-etapa-taller="${et.id}" style="min-width:140px;">${tallerOpts(et.taller_id)}</select></td>
                <td><select class="input-sm" data-etapa-cta="${et.id}" style="min-width:170px;">${cuentaOpts(et.plan_cuenta_id)}</select></td>
                <td>
                  <select class="input-sm" data-etapa-dep="${et.id}" style="min-width:150px;">
                    <option value="">-- Ninguna --</option>
                    ${etapas.filter(o => o.id !== et.id).map(o => `<option value="${o.id}" ${Number(et.depende_de_id) === Number(o.id) ? 'selected' : ''}>${esc(o.nombre)}</option>`).join('')}
                  </select>
                </td>
                <td>
                  <div class="actions">
                    <button type="button" class="btn btn-sm" data-save-etapa="${et.id}">Guardar</button>
                    <button type="button" class="btn btn-sm btn-danger" data-del-etapa="${et.id}">Eliminar</button>
                  </div>
                </td>
              </tr>
            `).join('') : '<tr><td colspan="9" class="muted" style="text-align:center;">Sin etapas configuradas.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;

  root.querySelector('#form-add-etapa').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/etapas', {
        method: 'POST',
        body: JSON.stringify({
          orden: Number(fd.get('orden')) || 1,
          nombre: fd.get('nombre'),
          descripcion: fd.get('descripcion') || '',
          dias_estimados: Number(fd.get('dias_estimados')) || 0,
          costo_unidad: Number(fd.get('costo_unidad')) || 0,
          taller_id: fd.get('taller_id') ? Number(fd.get('taller_id')) : null,
          plan_cuenta_id: fd.get('plan_cuenta_id') ? Number(fd.get('plan_cuenta_id')) : null,
          depende_de_id: fd.get('depende_de_id') ? Number(fd.get('depende_de_id')) : null,
        }),
      });
      toast('Etapa agregada');
      await renderEtapasView();
    } catch (err) {
      toast(err.message, true);
    }
  });

  root.querySelectorAll('[data-save-etapa]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.saveEtapa;
      const orden = Number(root.querySelector(`[data-etapa-orden="${id}"]`)?.value) || 1;
      const nombre = (root.querySelector(`[data-etapa-nombre="${id}"]`)?.value || '').trim();
      const descripcion = (root.querySelector(`[data-etapa-desc="${id}"]`)?.value || '').trim();
      const dias_estimados = Math.max(0, Number(root.querySelector(`[data-etapa-dias="${id}"]`)?.value) || 0);
      const costo_unidad = Math.max(0, Number(root.querySelector(`[data-etapa-costo="${id}"]`)?.value) || 0);
      const tallerVal = root.querySelector(`[data-etapa-taller="${id}"]`)?.value;
      const taller_id = tallerVal ? Number(tallerVal) : null;
      const ctaVal = root.querySelector(`[data-etapa-cta="${id}"]`)?.value;
      const plan_cuenta_id = ctaVal ? Number(ctaVal) : null;
      const depVal = root.querySelector(`[data-etapa-dep="${id}"]`)?.value;
      const depende_de_id = depVal ? Number(depVal) : null;
      if (!nombre) {
        toast('El nombre de la etapa es obligatorio', true);
        return;
      }
      try {
        await api(`/api/etapas/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ orden, nombre, descripcion, dias_estimados, costo_unidad, taller_id, plan_cuenta_id, depende_de_id }),
        });
        toast('Etapa actualizada');
        await renderEtapasView();
      } catch (err) {
        toast(err.message, true);
      }
    });
  });

  root.querySelectorAll('[data-del-etapa]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!(await showConfirmModal('¿Eliminar esta etapa?'))) return;
      try {
        await api(`/api/etapas/${btn.dataset.delEtapa}`, { method: 'DELETE' });
        toast('Etapa eliminada');
        await renderEtapasView();
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
}
