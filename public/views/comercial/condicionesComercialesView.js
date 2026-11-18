import { api, toast } from '../../lib/api.js';
import { esc, fmtMoney, fmtNum } from '../../lib/format.js';
import { mountPageView, renderSpreadsheetTable } from '../../lib/engine/index.js';
import { renderComercialReglasView } from './comercialReglasView.js';

export async function renderCondicionesComercialesView() {
  const root = document.getElementById('app-view');
  const [cuentas, productos, plantillas, proveedores] = await Promise.all([
    api('/api/tesoreria/cuentas').catch(() => []),
    api('/api/productos').catch(() => []),
    api('/api/plantillas').catch(() => []),
    api('/api/contactos?es_proveedor=1').catch(() => []),
  ]);

  let selectedListaId = null;

  async function loadAndRender() {
    const [terminos, metodos, listas, tarifasCompra] = await Promise.all([
      api('/api/terminos-pago'),
      api('/api/metodos-pago'),
      api('/api/listas-precios'),
      api('/api/producto-proveedores').catch(() => []),
    ]);
    if (!selectedListaId && listas.length) selectedListaId = listas[0].id;
    const listaDet = selectedListaId
      ? await api(`/api/listas-precios/${selectedListaId}`).catch(() => null)
      : null;

    const terminosHtml = `
      <div class="card">
        <div class="card-header">
          <div>
            <h2>Términos de Pago</h2>
            <span class="muted text-sm">Plazos de vencimiento asignables a clientes, proveedores y comprobantes.</span>
          </div>
        </div>
        <div id="tp-sheet-host"></div>
      </div>
    `;

    const metodosHtml = `
      <div class="card">
        <div class="card-header">
          <div>
            <h2>Métodos de Pago</h2>
            <span class="muted text-sm">Medios de cobro y pago vinculados a las cuentas de tesorería.</span>
          </div>
        </div>
        <div id="mp-sheet-host"></div>
      </div>
    `;

    const listasHtml = `
      <div class="card">
        <div class="card-header">
          <div>
            <h2>Listas de Precios</h2>
            <span class="muted text-sm">Tarifarios generales y reglas por volumen, plantilla o variante.</span>
          </div>
        </div>
        <div id="lp-sheet-host"></div>
      </div>

      ${listaDet ? `
        <div class="card">
          <div class="card-header">
            <div>
              <h2>Reglas específicas de: ${esc(listaDet.nombre)}</h2>
              <span class="muted text-sm">Tienen prioridad sobre el descuento/recargo global de la lista.</span>
            </div>
          </div>
          <div id="lp-items-sheet-host"></div>
        </div>
      ` : ''}
    `;

    const tarifasHtml = `
      <div class="card">
        <div class="card-header">
          <div>
            <h2>Tarifas de Compra por Proveedor</h2>
            <span class="muted text-sm">Acuerdos de costos, códigos de proveedor, cantidades mínimas y plazos de entrega. Click en celda para editar o "+ Agregar Tarifa".</span>
          </div>
        </div>
        <div id="tarifas-sheet-host"></div>
      </div>
    `;

    mountPageView(root, {
      title: 'Condiciones',
      subtitle: 'Términos de pago, métodos de pago, listas de precios para clientes y tarifas de compra a proveedores.',
      tabs: [
        { id: 'terminos', label: 'Términos de Pago', badge: terminos.length, html: terminosHtml },
        { id: 'metodos', label: 'Métodos de Pago', badge: metodos.length, html: metodosHtml },
        { id: 'listas', label: 'Listas de Precios (Clientes)', badge: listas.length, html: listasHtml },
        { id: 'tarifas', label: 'Tarifas de Compra (Proveedores)', badge: (tarifasCompra || []).length, html: tarifasHtml },
        {
          id: 'reglas',
          label: 'Envíos, Cupones y Recargos',
          html: '<div id="cc-reglas-host"></div>',
          onMount: (tabRoot) => {
            const host = tabRoot.querySelector('#cc-reglas-host');
            if (host) renderComercialReglasView({ embedded: true, container: host });
          },
        },
      ],
      onAfterMount: () => {
        renderSpreadsheetTable(root.querySelector('#tp-sheet-host'), {
          rows: terminos,
          compact: true,
          defaultNewRow: () => ({ nombre: '', dias: 30, descripcion: '', activo: 1 }),
          onCreateRow: async ({ row }) => {
            if (!String(row.nombre || '').trim()) return false;
            const res = await api('/api/terminos-pago', {
              method: 'POST',
              body: { nombre: row.nombre, dias: Number(row.dias || 0), descripcion: row.descripcion || '' },
            });
            if (res?.id) row.id = res.id;
            toast('Término de pago creado');
            return true;
          },
          columns: [
            { key: 'nombre', label: 'Nombre', type: 'text', parse: (v) => String(v || '').trim(), render: (t) => t.nombre ? esc(t.nombre) : '<span class="muted">Nuevo término...</span>' },
            { key: 'dias', label: 'Días', type: 'number', min: 0, step: 1, align: 'right', nowrap: true, render: (t) => `${t.dias} días`, parse: (v) => Math.max(0, Number(v) || 0) },
            { key: 'descripcion', label: 'Descripción', type: 'text', render: (t) => `<span class="muted">${esc(t.descripcion || '-')}</span>` },
            { key: 'activo', label: 'Activo', type: 'checkbox', align: 'center' },
          ],
          onDeleteRow: async (t) => {
            await api(`/api/terminos-pago/${t.id}`, { method: 'DELETE' });
            toast('Término eliminado');
            await loadAndRender();
          },
          onCellChange: async ({ row, key, value }) => {
            await api(`/api/terminos-pago/${row.id}`, {
              method: 'PUT',
              body: {
                nombre: key === 'nombre' ? value : row.nombre,
                dias: key === 'dias' ? value : Number(row.dias || 0),
                descripcion: key === 'descripcion' ? value : (row.descripcion || ''),
                activo: key === 'activo' ? Boolean(Number(value)) : Boolean(row.activo),
              },
            });
            toast('Término actualizado');
          },
        });

        renderSpreadsheetTable(root.querySelector('#mp-sheet-host'), {
          rows: metodos,
          compact: true,
          defaultNewRow: () => ({ nombre: '', tipo: 'banco', cuenta_id: '', requiere_referencia: 1, activo: 1 }),
          onCreateRow: async ({ row }) => {
            if (!String(row.nombre || '').trim()) return false;
            const res = await api('/api/metodos-pago', {
              method: 'POST',
              body: {
                nombre: row.nombre,
                tipo: row.tipo || 'banco',
                cuenta_id: row.cuenta_id || null,
                requiere_referencia: Boolean(Number(row.requiere_referencia)),
              },
            });
            if (res?.id) row.id = res.id;
            toast('Método de pago creado');
            return true;
          },
          columns: [
            { key: 'nombre', label: 'Nombre', type: 'text', parse: (v) => String(v || '').trim(), render: (m) => m.nombre ? esc(m.nombre) : '<span class="muted">Nuevo método...</span>' },
            {
              key: 'tipo',
              label: 'Tipo',
              type: 'select',
              options: [
                { value: 'efectivo', label: 'Efectivo' },
                { value: 'banco', label: 'Banco / Transferencia / Tarjeta' },
                { value: 'cheque', label: 'Cheque' },
                { value: 'digital', label: 'Billetera Digital' },
                { value: 'otro', label: 'Otro' },
              ],
            },
            {
              key: 'cuenta_id',
              label: 'Cuenta por defecto',
              type: 'select',
              options: [{ value: '', label: '-- Sin cuenta fija --' }, ...(cuentas || []).map(c => ({ value: String(c.id), label: `${c.nombre} (${c.tipo})` }))],
              getValue: (m) => (m.cuenta_id ? String(m.cuenta_id) : ''),
              parse: (v) => (v ? Number(v) : null),
            },
            { key: 'requiere_referencia', label: 'Req. Ref.', type: 'checkbox', align: 'center' },
            { key: 'activo', label: 'Activo', type: 'checkbox', align: 'center' },
          ],
          onDeleteRow: async (m) => {
            await api(`/api/metodos-pago/${m.id}`, { method: 'DELETE' });
            toast('Método eliminado');
            await loadAndRender();
          },
          onCellChange: async ({ row, key, value }) => {
            await api(`/api/metodos-pago/${row.id}`, {
              method: 'PUT',
              body: {
                nombre: key === 'nombre' ? value : row.nombre,
                tipo: key === 'tipo' ? value : row.tipo,
                cuenta_id: key === 'cuenta_id' ? value : (row.cuenta_id || null),
                requiere_referencia: key === 'requiere_referencia' ? Boolean(Number(value)) : Boolean(row.requiere_referencia),
                activo: key === 'activo' ? Boolean(Number(value)) : Boolean(row.activo),
              },
            });
            toast('Método actualizado');
          },
        });

        renderSpreadsheetTable(root.querySelector('#lp-sheet-host'), {
          rows: listas,
          compact: true,
          defaultNewRow: () => ({ nombre: '', moneda: 'ARS', descuento_pct: 0, recargo_pct: 0, cantidad_items: 0, es_default: 0 }),
          onCreateRow: async ({ row }) => {
            if (!String(row.nombre || '').trim()) return false;
            const res = await api('/api/listas-precios', {
              method: 'POST',
              body: {
                nombre: row.nombre,
                moneda: row.moneda || 'ARS',
                descuento_pct: Number(row.descuento_pct || 0),
                recargo_pct: Number(row.recargo_pct || 0),
                es_default: Boolean(Number(row.es_default)),
              },
            });
            if (res?.id) { row.id = res.id; selectedListaId = res.id; }
            toast('Lista de precios creada');
            return true;
          },
          columns: [
            { key: 'nombre', label: 'Nombre', type: 'text', parse: (v) => String(v || '').trim(), render: (l) => l.nombre ? esc(l.nombre) : '<span class="muted">Nueva lista...</span>' },
            { key: 'moneda', label: 'Moneda', type: 'select', options: [{ value: 'ARS', label: 'ARS' }, { value: 'USD', label: 'USD' }] },
            { key: 'descuento_pct', label: 'Dto. Global %', type: 'number', step: 0.01, align: 'right', render: (l) => `${fmtNum(l.descuento_pct)}%`, parse: (v) => Number(v) || 0 },
            { key: 'recargo_pct', label: 'Recargo %', type: 'number', step: 0.01, align: 'right', render: (l) => `${fmtNum(l.recargo_pct)}%`, parse: (v) => Number(v) || 0 },
            { key: 'cantidad_items', label: 'Reglas', type: 'readonly', align: 'right', render: (l) => String(l.cantidad_items || 0) },
            { key: 'es_default', label: 'Default', type: 'checkbox', align: 'center' },
          ],
          extraActions: (l) => `<button type="button" class="btn btn-sm btn-lp-select" data-id="${l.id}">Reglas</button>`,
          onDeleteRow: async (l) => {
            await api(`/api/listas-precios/${l.id}`, { method: 'DELETE' });
            if (Number(selectedListaId) === Number(l.id)) selectedListaId = null;
            toast('Lista eliminada');
            await loadAndRender();
          },
          onCellChange: async ({ row, key, value }) => {
            await api(`/api/listas-precios/${row.id}`, {
              method: 'PUT',
              body: {
                nombre: key === 'nombre' ? value : row.nombre,
                moneda: key === 'moneda' ? value : row.moneda,
                descuento_pct: key === 'descuento_pct' ? value : Number(row.descuento_pct || 0),
                recargo_pct: key === 'recargo_pct' ? value : Number(row.recargo_pct || 0),
                es_default: key === 'es_default' ? Boolean(Number(value)) : Boolean(row.es_default),
              },
            });
            toast('Lista actualizada');
          },
        });
        root.querySelectorAll('.btn-lp-select').forEach(b => b.addEventListener('click', () => {
          selectedListaId = Number(b.dataset.id);
          loadAndRender();
        }));
        const lpItems = (listaDet?.items || []).map(it => ({ ...it }));
        const prodOpts = (productos || []).map(p => ({ value: String(p.id), label: `${p.nombre}${p.sku ? ` [${p.sku}]` : ''}`, raw: p }));
        const ptOpts = [{ value: '', label: '-- Ninguna --' }, ...(plantillas || []).map(pt => ({ value: String(pt.id), label: pt.nombre }))];

        const renderLpItemsSheet = () => {
          const host = root.querySelector('#lp-items-sheet-host');
          if (!host || !listaDet) return;
          renderSpreadsheetTable(host, {
            rows: lpItems,
            compact: true,
            defaultNewRow: () => ({ producto_id: null, plantilla_id: null, precio_fijo: null, descuento_pct: 0, cantidad_minima: 1 }),
            onCreateRow: async ({ row }) => {
              if (!row.producto_id && !row.plantilla_id) return false;
              const res = await api(`/api/listas-precios/${selectedListaId}/items`, {
                method: 'POST',
                body: {
                  producto_id: row.producto_id || null,
                  plantilla_id: row.plantilla_id || null,
                  precio_fijo: row.precio_fijo ?? null,
                  descuento_pct: Number(row.descuento_pct || 0),
                  cantidad_minima: Number(row.cantidad_minima || 1),
                },
              });
              if (res?.id) row.id = res.id;
              toast('Regla agregada');
              return true;
            },
            columns: [
              {
                key: 'producto_id',
                label: 'Producto (variante)',
                type: 'combobox',
                placeholder: 'Buscar producto...',
                options: prodOpts,
                getValue: (it) => (it.producto_id ? String(it.producto_id) : ''),
                onPickItem: (it, p) => {
                  it.producto_id = p?.id || null;
                  it.producto_nombre = p?.nombre || '';
                  it.precio_catalogo = p?.precio || 0;
                  if (it.producto_id) { it.plantilla_id = null; it.plantilla_nombre = ''; }
                },
                render: (it) => it.producto_id ? `<strong>${esc(it.producto_nombre)}</strong>` : '<span class="muted">-</span>',
              },
              {
                key: 'plantilla_id',
                label: 'Plantilla',
                type: 'select',
                options: ptOpts,
                getValue: (it) => (it.plantilla_id ? String(it.plantilla_id) : ''),
                parse: (v) => (v ? Number(v) : null),
                render: (it) => it.plantilla_id ? `<span class="badge badge-muted">${esc(it.plantilla_nombre || `#${it.plantilla_id}`)}</span>` : '<span class="muted">-</span>',
              },
              {
                key: 'precio_catalogo',
                label: 'Catálogo',
                type: 'readonly',
                align: 'right',
                nowrap: true,
                render: (it) => (it.producto_id ? fmtMoney(it.precio_catalogo) : '-'),
              },
              {
                key: 'precio_fijo',
                label: 'Precio Fijo',
                type: 'number',
                step: 0.01,
                min: 0,
                align: 'right',
                parse: (v) => (v === '' || v === null ? null : Number(v)),
                render: (it) => (it.precio_fijo !== null && it.precio_fijo !== undefined ? `<strong>${fmtMoney(it.precio_fijo)}</strong>` : '<span class="muted">-</span>'),
              },
              {
                key: 'descuento_pct',
                label: 'Dto. %',
                type: 'number',
                step: 0.01,
                align: 'right',
                parse: (v) => Number(v) || 0,
                render: (it) => `${fmtNum(it.descuento_pct || 0)}%`,
              },
              {
                key: 'cantidad_minima',
                label: 'Cant. Mín.',
                type: 'number',
                step: 1,
                min: 1,
                align: 'right',
                parse: (v) => Math.max(1, Number(v) || 1),
              },
            ],
            onDeleteRow: async (it, idx) => {
              if (it.id) await api(`/api/listas-precios/items/${it.id}`, { method: 'DELETE' });
              lpItems.splice(idx, 1);
              toast('Regla quitada');
              renderLpItemsSheet();
            },
            onCellChange: async ({ row }) => {
              if (!row.producto_id && !row.plantilla_id) return;
              const res = await api(`/api/listas-precios/${selectedListaId}/items`, {
                method: 'POST',
                body: {
                  producto_id: row.producto_id || null,
                  plantilla_id: row.plantilla_id || null,
                  precio_fijo: row.precio_fijo ?? null,
                  descuento_pct: Number(row.descuento_pct || 0),
                  cantidad_minima: Number(row.cantidad_minima || 1),
                },
              });
              if (res?.id) row.id = res.id;
              toast('Regla guardada');
            },
          });
        };
        renderLpItemsSheet();

        const tarifasRows = (tarifasCompra || []).map(t => ({ ...t }));
        const provOpts = (proveedores || []).map(pr => ({ value: String(pr.id), label: pr.nombre, raw: pr }));
        const ptCompraOpts = [{ value: '', label: '-- Por variante --' }, ...plantillas.filter(pt => pt.se_compra).map(pt => ({ value: String(pt.id), label: pt.nombre }))];

        const renderTarifasSheet = () => {
          const host = root.querySelector('#tarifas-sheet-host');
          if (!host) return;
          renderSpreadsheetTable(host, {
            rows: tarifasRows,
            compact: true,
            defaultNewRow: () => ({ contacto_id: null, plantilla_id: null, producto_id: null, codigo_proveedor: '', precio: 0, cantidad_minima: 1, lead_time_dias: 0 }),
            onCreateRow: async ({ row }) => {
              if (!row.contacto_id || (!row.producto_id && !row.plantilla_id)) return false;
              const res = await api('/api/producto-proveedores', {
                method: 'POST',
                body: {
                  contacto_id: Number(row.contacto_id),
                  plantilla_id: row.plantilla_id ? Number(row.plantilla_id) : null,
                  producto_id: row.producto_id ? Number(row.producto_id) : null,
                  codigo_proveedor: row.codigo_proveedor || '',
                  precio: Number(row.precio || 0),
                  cantidad_minima: Number(row.cantidad_minima || 1),
                  lead_time_dias: Number(row.lead_time_dias || 0),
                },
              });
              if (res?.id) row.id = res.id;
              toast('Tarifa guardada');
              return true;
            },
            columns: [
              {
                key: 'contacto_id',
                label: 'Proveedor *',
                type: 'combobox',
                placeholder: 'Buscar proveedor...',
                options: provOpts,
                getValue: (t) => (t.contacto_id ? String(t.contacto_id) : ''),
                onPickItem: (t, pr) => {
                  t.contacto_id = pr?.id ? Number(pr.id) : null;
                  t.proveedor_nombre = pr?.nombre || '';
                },
                render: (t) => t.contacto_id ? `<strong>${esc(t.proveedor_nombre)}</strong>` : '<span class="muted">Elegir proveedor...</span>',
              },
              {
                key: 'plantilla_id',
                label: 'Plantilla',
                type: 'select',
                options: ptCompraOpts,
                getValue: (t) => (t.plantilla_id ? String(t.plantilla_id) : ''),
                parse: (v) => (v ? Number(v) : null),
                render: (t) => t.plantilla_id ? `<span class="badge badge-muted">${esc(t.plantilla_nombre || `#${t.plantilla_id}`)}</span>` : '<span class="muted">-</span>',
              },
              {
                key: 'producto_id',
                label: 'Variante / Producto',
                type: 'combobox',
                placeholder: 'Buscar variante...',
                options: prodOpts,
                getValue: (t) => (t.producto_id ? String(t.producto_id) : ''),
                onPickItem: (t, p) => {
                  t.producto_id = p?.id ? Number(p.id) : null;
                  t.producto_nombre = p?.nombre || '';
                },
                render: (t) => t.producto_id ? esc(t.producto_nombre) : '<span class="muted">-</span>',
              },
              { key: 'codigo_proveedor', label: 'Cód. Prov.', type: 'text', render: (t) => esc(t.codigo_proveedor || '-') },
              {
                key: 'precio',
                label: 'Costo *',
                type: 'number',
                step: 0.01,
                min: 0,
                align: 'right',
                parse: (v) => Math.max(0, Number(v) || 0),
                render: (t) => `<strong>${fmtMoney(t.precio || 0)}</strong>`,
              },
              { key: 'cantidad_minima', label: 'Mín.', type: 'number', step: 1, min: 1, align: 'right', parse: (v) => Math.max(1, Number(v) || 1) },
              { key: 'lead_time_dias', label: 'Plazo (d)', type: 'number', step: 1, min: 0, align: 'right', parse: (v) => Math.max(0, Number(v) || 0) },
            ],
            onDeleteRow: async (t, idx) => {
              if (t.id) await api(`/api/producto-proveedores/${t.id}`, { method: 'DELETE' });
              tarifasRows.splice(idx, 1);
              toast('Tarifa quitada');
              renderTarifasSheet();
            },
            onCellChange: async ({ row }) => {
              if (!row.contacto_id || (!row.producto_id && !row.plantilla_id)) return;
              const res = await api('/api/producto-proveedores', {
                method: 'POST',
                body: {
                  contacto_id: Number(row.contacto_id),
                  plantilla_id: row.plantilla_id ? Number(row.plantilla_id) : null,
                  producto_id: row.producto_id ? Number(row.producto_id) : null,
                  codigo_proveedor: row.codigo_proveedor || '',
                  precio: Number(row.precio || 0),
                  cantidad_minima: Number(row.cantidad_minima || 1),
                  lead_time_dias: Number(row.lead_time_dias || 0),
                },
              });
              if (res?.id) row.id = res.id;
              toast('Tarifa guardada');
            },
          });
        };
        renderTarifasSheet();
      },
    });
  }

  await loadAndRender();
}
