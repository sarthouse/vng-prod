import { api, toast } from '../../lib/api.js';
import { esc } from '../../lib/format.js';
import { showConfirmModal, renderSpreadsheetTable } from '../../lib/engine/index.js';

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
      <form id="form-add-etapa" class="toolbar sx-410c97">
        <input type="number" name="orden" min="1" value="${etapas.length + 1}" placeholder="Orden" class="w-70" required />
        <input type="text" name="nombre" required placeholder="Nombre etapa" class="mw-170" />
        <input type="text" name="descripcion" placeholder="Descripción" class="sx-af01f7" />
        <input type="number" name="dias_estimados" min="0" value="3" placeholder="Días est." class="w-85" required />
        <input type="number" name="costo_unidad" min="0" step="0.01" value="0" placeholder="Costo/u ($)" class="sx-9c41f6" title="Costo estimado de proceso por unidad" />
        <select name="taller_id" class="sx-a629a3">${tallerOpts(null)}</select>
        <select name="plan_cuenta_id" class="sx-923e95">${cuentaOpts(null)}</select>
        <select name="depende_de_id" class="mw-170">
          <option value="">-- Sin dependencia --</option>
          ${etapas.map(e => `<option value="${e.id}">Depende de: ${esc(e.nombre)}</option>`).join('')}
        </select>
        <button type="submit" class="btn btn-primary">+ Agregar Etapa</button>
      </form>
      <div id="etapas-sheet-host"></div>
    </div>
  `;

  renderSpreadsheetTable(root.querySelector('#etapas-sheet-host'), {
    rows: etapas,
    emptyText: 'Sin etapas configuradas.',
    compact: true,
    columns: [
      { key: 'orden', label: 'Orden', type: 'number', min: 1, step: 1, align: 'right', parse: (v) => Math.max(1, Number(v) || 1) },
      { key: 'nombre', label: 'Etapa', type: 'text', parse: (v) => String(v || '').trim() },
      { key: 'descripcion', label: 'Descripción', type: 'text', render: (et) => et.descripcion ? esc(et.descripcion) : '<span class="muted">Sin descripción</span>' },
      { key: 'dias_estimados', label: 'Días Est.', type: 'number', min: 0, step: 1, align: 'right', nowrap: true, render: (et) => `${et.dias_estimados} días`, parse: (v) => Math.max(0, Number(v) || 0) },
      { key: 'costo_unidad', label: 'Costo / u.', type: 'number', min: 0, step: 0.01, align: 'right', nowrap: true, parse: (v) => Math.max(0, Number(v) || 0) },
      {
        key: 'taller_id',
        label: 'Taller',
        type: 'select',
        options: [{ value: '', label: '-- Sin taller --' }, ...talleres.map(t => ({ value: String(t.id), label: t.nombre }))],
        getValue: (et) => (et.taller_id ? String(et.taller_id) : ''),
        parse: (v) => (v ? Number(v) : null),
      },
      {
        key: 'plan_cuenta_id',
        label: 'Cuenta Contable',
        type: 'select',
        options: [{ value: '', label: '-- Cuenta por defecto --' }, ...cuentasEgreso.map(c => ({ value: String(c.id), label: `${c.codigo} · ${c.nombre}` }))],
        getValue: (et) => (et.plan_cuenta_id ? String(et.plan_cuenta_id) : ''),
        parse: (v) => (v ? Number(v) : null),
      },
      {
        key: 'depende_de_id',
        label: 'Depende de',
        type: 'select',
        options: (et) => [{ value: '', label: '-- Ninguna --' }, ...etapas.filter(o => o.id !== et.id).map(o => ({ value: String(o.id), label: o.nombre }))],
        getValue: (et) => (et.depende_de_id ? String(et.depende_de_id) : ''),
        parse: (v) => (v ? Number(v) : null),
      },
    ],
    onDeleteRow: async (et) => {
      if (!(await showConfirmModal('¿Eliminar esta etapa de la plantilla?'))) return;
      try {
        await api(`/api/etapas/${et.id}`, { method: 'DELETE' });
        toast('Etapa eliminada');
        await renderEtapasView();
      } catch (err) {
        toast(err.message, true);
      }
    },
    onCellChange: async ({ row, key, value }) => {
      try {
        await api(`/api/etapas/${row.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            orden: key === 'orden' ? value : (Number(row.orden) || 1),
            nombre: key === 'nombre' ? value : row.nombre,
            descripcion: key === 'descripcion' ? value : (row.descripcion || ''),
            dias_estimados: key === 'dias_estimados' ? value : (Number(row.dias_estimados) || 0),
            costo_unidad: key === 'costo_unidad' ? value : (Number(row.costo_unidad) || 0),
            taller_id: key === 'taller_id' ? value : (row.taller_id || null),
            plan_cuenta_id: key === 'plan_cuenta_id' ? value : (row.plan_cuenta_id || null),
            depende_de_id: key === 'depende_de_id' ? value : (row.depende_de_id || null),
          }),
        });
        toast('Etapa actualizada');
      } catch (err) {
        toast(err.message, true);
        throw err;
      }
    },
  });

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
