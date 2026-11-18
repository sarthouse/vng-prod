import { api, toast } from '../../lib/api.js';
import { esc, fmtMoney } from '../../lib/format.js';
import { showConfirmModal, renderSpreadsheetTable } from '../../lib/engine/index.js';

export async function renderComercialReglasView({ embedded = false, container = null } = {}) {
  const root = container || document.getElementById('app-view');

  const draw = async () => {
    const [envios, cupones, recargos] = await Promise.all([
      api('/api/ventas/envios').catch(() => []),
      api('/api/ventas/cupones').catch(() => []),
      api('/api/ventas/recargos').catch(() => []),
    ]);

    root.innerHTML = `
      ${embedded ? '' : `
        <div class="page-header">
          <div>
            <div class="mb-xs"><a href="/ventas" data-link class="muted text-md">← Volver a Ventas</a></div>
            <h1>Envíos, Cupones y Recargos</h1>
            <p class="muted">Reglas comerciales que se agregan como líneas facturables (sin mover stock ni salir en remito) y mapean directo a WooCommerce.</p>
          </div>
        </div>
      `}

      <div class="card">
        <div class="card-header"><h2>Tipos de Envío</h2></div>
        <div id="reglas-envios-sheet"></div>
      </div>

      <div class="card">
        <div class="card-header"><h2>Cupones de Descuento</h2></div>
        <div id="reglas-cupones-sheet"></div>
      </div>

      <div class="card">
        <div class="card-header"><h2>Recargos Financieros / Medios de Pago</h2></div>
        <div id="reglas-recargos-sheet"></div>
      </div>
    `;

    renderSpreadsheetTable(root.querySelector('#reglas-envios-sheet'), {
      rows: envios,
      compact: true,
      defaultNewRow: () => ({ nombre: '', tipo_tarifa: 'fijo', precio: 0, monto_minimo_gratis: 0, alicuota_iva: 21, activo: 1 }),
      onCreateRow: async ({ row }) => {
        if (!String(row.nombre || '').trim()) return false;
        const res = await api('/api/ventas/envios', {
          method: 'POST',
          body: JSON.stringify({
            nombre: row.nombre,
            tipo_tarifa: row.tipo_tarifa || 'fijo',
            precio: Number(row.precio) || 0,
            monto_minimo_gratis: Number(row.monto_minimo_gratis) || 0,
            alicuota_iva: Number(row.alicuota_iva ?? 21),
            activo: 1,
          }),
        });
        if (res?.id) row.id = res.id;
        toast('Método de envío creado');
        return true;
      },
      columns: [
        { key: 'nombre', label: 'Nombre', type: 'text', parse: (v) => String(v || '').trim(), render: (e) => e.nombre ? `<strong>${esc(e.nombre)}</strong>` : '<span class="muted">Nuevo envío...</span>' },
        {
          key: 'tipo_tarifa',
          label: 'Modalidad',
          type: 'select',
          options: [
            { value: 'fijo', label: 'Precio fijo' },
            { value: 'gratis_desde', label: 'Gratis desde $' },
          ],
        },
        { key: 'precio', label: 'Precio Neto', type: 'number', step: 0.01, min: 0, align: 'right', render: (e) => fmtMoney(e.precio || 0), parse: (v) => Math.max(0, Number(v) || 0) },
        { key: 'monto_minimo_gratis', label: 'Gratis desde ($)', type: 'number', step: 0.01, min: 0, align: 'right', render: (e) => Number(e.monto_minimo_gratis || 0) > 0 ? fmtMoney(e.monto_minimo_gratis) : '-', parse: (v) => Math.max(0, Number(v) || 0) },
        { key: 'alicuota_iva', label: 'IVA %', type: 'number', step: 0.01, min: 0, align: 'right', render: (e) => `${Number(e.alicuota_iva ?? 21)}%`, parse: (v) => Number(v) || 0 },
        { key: 'activo', label: 'Activo', type: 'checkbox', align: 'center' },
      ],
      onDeleteRow: async (e) => {
        if (!(await showConfirmModal('¿Eliminar este método de envío?'))) return;
        await api(`/api/ventas/envios/${e.id}`, { method: 'DELETE' });
        toast('Envío eliminado');
        await draw();
      },
      onCellChange: async ({ row, key, value }) => {
        await api(`/api/ventas/envios/${row.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            nombre: key === 'nombre' ? value : row.nombre,
            tipo_tarifa: key === 'tipo_tarifa' ? value : row.tipo_tarifa,
            precio: key === 'precio' ? value : Number(row.precio || 0),
            monto_minimo_gratis: key === 'monto_minimo_gratis' ? value : Number(row.monto_minimo_gratis || 0),
            alicuota_iva: key === 'alicuota_iva' ? value : Number(row.alicuota_iva ?? 21),
            activo: key === 'activo' ? Number(value) : (row.activo ? 1 : 0),
          }),
        });
        toast('Envío actualizado');
      },
    });

    renderSpreadsheetTable(root.querySelector('#reglas-cupones-sheet'), {
      rows: cupones,
      compact: true,
      defaultNewRow: () => ({ codigo: '', descripcion: '', tipo: 'porcentaje', valor: 10, alicuota_iva: 21, vigencia_hasta: '', usos_maximos: 0, usos_actuales: 0, activo: 1 }),
      onCreateRow: async ({ row }) => {
        const codigo = String(row.codigo || '').trim().toUpperCase();
        if (!codigo) return false;
        row.codigo = codigo;
        const res = await api('/api/ventas/cupones', {
          method: 'POST',
          body: JSON.stringify({
            codigo,
            descripcion: row.descripcion || '',
            tipo: row.tipo || 'porcentaje',
            valor: Number(row.valor) || 0,
            alicuota_iva: Number(row.alicuota_iva ?? 21),
            vigencia_hasta: row.vigencia_hasta || '',
            usos_maximos: Number(row.usos_maximos) || 0,
            activo: 1,
          }),
        });
        if (res?.id) row.id = res.id;
        toast('Cupón creado');
        return true;
      },
      columns: [
        { key: 'codigo', label: 'Código', type: 'text', nowrap: true, parse: (v) => String(v || '').trim().toUpperCase(), render: (c) => c.codigo ? `<code>${esc(c.codigo)}</code>` : '<span class="muted">Nuevo código...</span>' },
        { key: 'descripcion', label: 'Descripción', type: 'text', render: (c) => c.descripcion ? esc(c.descripcion) : '<span class="muted">-</span>' },
        {
          key: 'tipo',
          label: 'Tipo',
          type: 'select',
          options: [
            { value: 'porcentaje', label: '% Descuento' },
            { value: 'fijo', label: '$ Monto fijo' },
          ],
        },
        { key: 'valor', label: 'Valor', type: 'number', step: 0.01, min: 0, align: 'right', render: (c) => c.tipo === 'porcentaje' ? `${Number(c.valor || 0)}%` : fmtMoney(c.valor || 0), parse: (v) => Math.max(0, Number(v) || 0) },
        { key: 'alicuota_iva', label: 'IVA %', type: 'number', step: 0.01, min: 0, align: 'right', render: (c) => `${Number(c.alicuota_iva ?? 21)}%`, parse: (v) => Number(v) || 0 },
        { key: 'vigencia_hasta', label: 'Vigencia (YYYY-MM-DD)', type: 'text', nowrap: true, render: (c) => esc(c.vigencia_hasta || 'Sin límite') },
        { key: 'usos_maximos', label: 'Usos Máx.', type: 'number', step: 1, min: 0, align: 'right', render: (c) => `${c.usos_actuales || 0} / ${c.usos_maximos || '∞'}`, parse: (v) => Math.max(0, Number(v) || 0) },
        { key: 'activo', label: 'Activo', type: 'checkbox', align: 'center' },
      ],
      onDeleteRow: async (c) => {
        if (!(await showConfirmModal('¿Eliminar este cupón?'))) return;
        await api(`/api/ventas/cupones/${c.id}`, { method: 'DELETE' });
        toast('Cupón eliminado');
        await draw();
      },
      onCellChange: async ({ row, key, value }) => {
        await api(`/api/ventas/cupones/${row.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            codigo: key === 'codigo' ? value : row.codigo,
            descripcion: key === 'descripcion' ? value : (row.descripcion || ''),
            tipo: key === 'tipo' ? value : row.tipo,
            valor: key === 'valor' ? value : Number(row.valor || 0),
            alicuota_iva: key === 'alicuota_iva' ? value : Number(row.alicuota_iva ?? 21),
            vigencia_hasta: key === 'vigencia_hasta' ? value : (row.vigencia_hasta || ''),
            usos_maximos: key === 'usos_maximos' ? value : Number(row.usos_maximos || 0),
            activo: key === 'activo' ? Number(value) : (row.activo ? 1 : 0),
          }),
        });
        toast('Cupón actualizado');
      },
    });

    renderSpreadsheetTable(root.querySelector('#reglas-recargos-sheet'), {
      rows: recargos,
      compact: true,
      defaultNewRow: () => ({ nombre: '', tipo: 'porcentaje', valor: 0, alicuota_iva: 21, activo: 1 }),
      onCreateRow: async ({ row }) => {
        if (!String(row.nombre || '').trim()) return false;
        const res = await api('/api/ventas/recargos', {
          method: 'POST',
          body: JSON.stringify({
            nombre: row.nombre,
            tipo: row.tipo || 'porcentaje',
            valor: Number(row.valor) || 0,
            alicuota_iva: Number(row.alicuota_iva ?? 21),
            activo: 1,
          }),
        });
        if (res?.id) row.id = res.id;
        toast('Recargo creado');
        return true;
      },
      columns: [
        { key: 'nombre', label: 'Nombre', type: 'text', parse: (v) => String(v || '').trim(), render: (r) => r.nombre ? `<strong>${esc(r.nombre)}</strong>` : '<span class="muted">Nuevo recargo...</span>' },
        {
          key: 'tipo',
          label: 'Tipo',
          type: 'select',
          options: [
            { value: 'porcentaje', label: '% sobre neto' },
            { value: 'fijo', label: '$ Monto fijo' },
          ],
        },
        { key: 'valor', label: 'Valor', type: 'number', step: 0.01, min: 0, align: 'right', render: (r) => r.tipo === 'porcentaje' ? `${Number(r.valor || 0)}%` : fmtMoney(r.valor || 0), parse: (v) => Math.max(0, Number(v) || 0) },
        { key: 'alicuota_iva', label: 'IVA %', type: 'number', step: 0.01, min: 0, align: 'right', render: (r) => `${Number(r.alicuota_iva ?? 21)}%`, parse: (v) => Number(v) || 0 },
        { key: 'activo', label: 'Activo', type: 'checkbox', align: 'center' },
      ],
      onDeleteRow: async (r) => {
        if (!(await showConfirmModal('¿Eliminar este recargo?'))) return;
        await api(`/api/ventas/recargos/${r.id}`, { method: 'DELETE' });
        toast('Recargo eliminado');
        await draw();
      },
      onCellChange: async ({ row, key, value }) => {
        await api(`/api/ventas/recargos/${row.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            nombre: key === 'nombre' ? value : row.nombre,
            tipo: key === 'tipo' ? value : row.tipo,
            valor: key === 'valor' ? value : Number(row.valor || 0),
            alicuota_iva: key === 'alicuota_iva' ? value : Number(row.alicuota_iva ?? 21),
            activo: key === 'activo' ? Number(value) : (row.activo ? 1 : 0),
          }),
        });
        toast('Recargo actualizado');
      },
    });
  };

  await draw();
}
