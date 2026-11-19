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
      <div id="etapas-sheet-host"></div>
    </div>
  `;

  renderSpreadsheetTable(root.querySelector('#etapas-sheet-host'), {
    rows: etapas,
    emptyText: 'Sin etapas configuradas.',
    compact: true,
    defaultNewRow: () => ({
      orden: etapas.length + 1,
      nombre: '',
      descripcion: '',
      dias_estimados: 3,
      costo_unidad: 0,
      taller_id: null,
      plan_cuenta_id: null,
      depende_de_id: null,
    }),
    onCreateRow: async ({ row }) => {
      if (!String(row.nombre || '').trim()) return false;
      try {
        const res = await api('/api/etapas', {
          method: 'POST',
          body: JSON.stringify({
            orden: Number(row.orden) || 1,
            nombre: String(row.nombre).trim(),
            descripcion: row.descripcion || '',
            dias_estimados: Number(row.dias_estimados) || 0,
            costo_unidad: Number(row.costo_unidad) || 0,
            taller_id: row.taller_id ? Number(row.taller_id) : null,
            plan_cuenta_id: row.plan_cuenta_id ? Number(row.plan_cuenta_id) : null,
            depende_de_id: row.depende_de_id ? Number(row.depende_de_id) : null,
          }),
        });
        if (res?.id) row.id = res.id;
        toast('Etapa agregada');
        return true;
      } catch (err) {
        toast(err.message, true);
        throw err;
      }
    },
    columns: [
      { key: 'orden', label: 'Orden', type: 'number', min: 1, step: 1, align: 'right', parse: (v) => Math.max(1, Number(v) || 1) },
      { key: 'nombre', label: 'Etapa', type: 'text', parse: (v) => String(v || '').trim(), render: (et) => et.nombre ? esc(et.nombre) : '<span class="muted">Nueva etapa...</span>' },
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
}
