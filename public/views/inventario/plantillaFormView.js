import { api, toast } from '../../lib/api.js';
import { esc, fmtMoney, fmtNum, compressImageToDataUrl, mountRichEditor } from '../../lib/format.js';
import { navigate } from '../../router.js';
import { mountCombobox, mountMultiSelect, quickCreateProveedor, quickCreateCategoria } from '../../lib/autocomplete.js';
import { renderMetaPanel } from '../../lib/metaPanel.js';

export async function renderPlantillaFormView({ id } = {}) {
  const root = document.getElementById('app-view');
  const isEdit = Boolean(id);

  const [config, todosImpuestos, proveedores, existing, planCuentas, tarifasCompra, listasPrecios, historialPrecios] = await Promise.all([
    api('/api/config'),
    api('/api/impuestos?solo_activos=1').catch(() => []),
    api('/api/contactos?es_proveedor=1'),
    isEdit ? api(`/api/plantillas/${id}`) : Promise.resolve(null),
    api('/api/tesoreria/plan-cuentas').catch(() => []),
    isEdit ? api(`/api/producto-proveedores?plantilla_id=${id}`).catch(() => []) : Promise.resolve([]),
    isEdit ? api('/api/listas-precios?solo_activos=1').catch(() => []) : Promise.resolve([]),
    isEdit ? api(`/api/plantillas/${id}/historial-precios`).catch(() => []) : Promise.resolve([]),
  ]);
  const cuentasImputables = (planCuentas || []).filter(c => c.activo !== 0 && c.imputable !== 0);
  const cuentasIngreso = cuentasImputables.filter(c => c.tipo === 'ingreso');
  const cuentasEgreso = cuentasImputables.filter(c => c.tipo === 'egreso' || c.tipo === 'activo');

  const categorias = config.categorias || [];
  const unidades = config.unidades || [];
  const globalVariantes = config.variantes || [];
  const defaultIva = Number(config.empresa?.alicuota_iva_ventas_defecto ?? config.empresa?.alicuota_iva_defecto ?? 21);
  const defaultIvaCompra = Number(config.empresa?.alicuota_iva_compras_defecto ?? config.empresa?.alicuota_iva_defecto ?? 21);

  const impuestosVentaOpts = (todosImpuestos || [])
    .filter(i => i.aplica_a === 'ventas' || i.aplica_a === 'ambos' || !i.aplica_a)
    .map(i => ({ value: String(i.id), label: `${i.nombre} (${i.alicuota_defecto}%)`, sublabel: i.tipo?.toUpperCase(), raw: i }));
  const impuestosCompraOpts = (todosImpuestos || [])
    .filter(i => i.aplica_a === 'compras' || i.aplica_a === 'ambos' || !i.aplica_a)
    .map(i => ({ value: String(i.id), label: `${i.nombre} (${i.alicuota_defecto}%)`, sublabel: i.tipo?.toUpperCase(), raw: i }));

  const defaultVentaIvaTax = (todosImpuestos || []).find(i => i.tipo === 'iva' && Number(i.alicuota_defecto) === defaultIva && (i.aplica_a === 'ventas' || i.aplica_a === 'ambos'));
  const defaultCompraIvaTax = (todosImpuestos || []).find(i => i.tipo === 'iva' && Number(i.alicuota_defecto) === defaultIvaCompra && (i.aplica_a === 'compras' || i.aplica_a === 'ambos'));

  const qs = new URLSearchParams(window.location.search);
  const preFabrica = qs.get('se_fabrica') === '1';
  const preProveedorId = qs.get('proveedor_id') || '';

  const pt = existing?.plantilla || {
    nombre: '',
    codigo: '',
    descripcion: '',
    tipo: 'almacenable',
    categoria: preFabrica ? (categorias.find(c => /modelo/i.test(c.nombre))?.nombre || categorias[0]?.nombre || 'Otros insumos') : (categorias[0]?.nombre || 'Otros insumos'),
    udm: preFabrica ? (unidades.find(u => /par/i.test(u.nombre))?.nombre || unidades[0]?.nombre || 'unidades') : (unidades[0]?.nombre || 'unidades'),
    alicuota_iva: defaultIva,
    alicuota_iva_compra: defaultIvaCompra,
    impuestos_venta_ids: defaultVentaIvaTax ? [defaultVentaIvaTax.id] : [],
    impuestos_compra_ids: defaultCompraIvaTax ? [defaultCompraIvaTax.id] : [],
    proveedor_id: preProveedorId,
    lead_time_dias: 0,
    se_fabrica: preFabrica ? 1 : 0,
    se_compra: preFabrica ? 0 : 1,
    se_vende: 1,
    atributos: [],
  };
  const variantes = existing?.variantes || [];
  const recetas = existing?.recetas || [];

  // Agrupar valores globales disponibles por atributo
  const globalAttrMap = new Map();
  for (const v of globalVariantes) {
    if (!globalAttrMap.has(v.atributo)) globalAttrMap.set(v.atributo, []);
    globalAttrMap.get(v.atributo).push(v.valor);
  }

  // Estado local de atributos seleccionados en esta plantilla
  const selectedAttrMap = new Map();
  for (const a of (pt.atributos || [])) {
    if (a?.atributo && Array.isArray(a.valores)) {
      selectedAttrMap.set(a.atributo, new Set(a.valores.map(String)));
      if (!globalAttrMap.has(a.atributo)) globalAttrMap.set(a.atributo, []);
      for (const val of a.valores.map(String)) {
        if (!globalAttrMap.get(a.atributo).includes(val)) globalAttrMap.get(a.atributo).push(val);
      }
    }
  }

  const render = () => {
    root.innerHTML = `
      <div class="page-header">
        <div>
          <div class="mb-xs">
            <a href="/productos" data-link class="muted text-md">← Volver a Productos</a>
          </div>
          <h1>${isEdit ? `Plantilla: ${esc(pt.nombre)}` : 'Nueva Plantilla de Producto'}</h1>
          <p class="muted">Configurá datos maestros, roles, atributos de variantes y precios/stock.</p>
        </div>
        ${isEdit ? `
          <div class="actions">
            <a href="/plantillas/nueva" data-link class="btn btn-primary">+ Nueva Plantilla</a>
          </div>
        ` : ''}
      </div>

      <div class="card">
        <div class="card-header">
          <h2>Datos Generales</h2>
        </div>
        <form id="form-plantilla" class="form-grid">
          <label>
            <span>Código / Prefijo SKU</span>
            <input type="text" name="codigo" value="${esc(pt.codigo || '')}" placeholder="Ej: MOR, CUE-VAC" />
          </label>
          <label>
            <span>Nombre *</span>
            <input type="text" name="nombre" required value="${esc(pt.nombre)}" placeholder="Ej: Moran / Base Ushuaia" />
          </label>
          <label>
            <span>Tipo *</span>
            <select name="tipo" id="pt-tipo" required>
              <option value="almacenable" ${pt.tipo === 'almacenable' ? 'selected' : ''}>Almacenable</option>
              <option value="consumible" ${pt.tipo === 'consumible' ? 'selected' : ''}>Consumible</option>
              <option value="servicio" ${pt.tipo === 'servicio' ? 'selected' : ''}>Servicio</option>
            </select>
          </label>
          <label>
            <span>Categoría *</span>
            <div id="pt-cat-combo"></div>
          </label>
          <label>
            <span>Unidad de Medida *</span>
            <select name="udm" required>
              ${unidades.map(u => `<option value="${esc(u.nombre)}" ${u.nombre === pt.udm ? 'selected' : ''}>${esc(u.nombre)}</option>`).join('')}
            </select>
          </label>
          <label class="form-field">
            <span>Impuestos de Venta</span>
            <div id="pt-imp-venta-multi"></div>
          </label>
          <label class="form-field">
            <span>Impuestos de Compra</span>
            <div id="pt-imp-compra-multi"></div>
          </label>
          <label class="form-field">
            <span>Proveedor por Defecto</span>
            <div id="pt-prov-combo"></div>
          </label>
          <label class="form-field">
            <span>Plazo de Entrega (días)</span>
            <input type="number" name="lead_time_dias" min="0" step="1" value="${esc(pt.lead_time_dias ?? 0)}" />
          </label>
          <label class="form-field">
            <span>Cuenta de Ventas</span>
            <select name="cuenta_venta_id">
              <option value="">-- Por defecto (4.1.01) --</option>
              ${cuentasIngreso.map(c => `<option value="${c.id}" ${Number(pt.cuenta_venta_id) === Number(c.id) ? 'selected' : ''}>${esc(c.codigo)} · ${esc(c.nombre)}</option>`).join('')}
            </select>
          </label>
          <label class="form-field">
            <span>Cuenta de Compras</span>
            <select name="cuenta_compra_id">
              <option value="">-- Por defecto (5.1.01) --</option>
              ${cuentasEgreso.map(c => `<option value="${c.id}" ${Number(pt.cuenta_compra_id) === Number(c.id) ? 'selected' : ''}>${esc(c.codigo)} · ${esc(c.nombre)}</option>`).join('')}
            </select>
          </label>
          <label class="form-field">
            <span>Moneda Referencia</span>
            <select name="moneda">
              <option value="ARS" ${(pt.moneda || 'ARS') === 'ARS' ? 'selected' : ''}>ARS — Peso Argentino</option>
              <option value="USD" ${pt.moneda === 'USD' ? 'selected' : ''}>USD — Dólar</option>
            </select>
          </label>
          <label class="form-field">
            <span>Peso Unitario (kg)</span>
            <input type="number" step="0.001" min="0" name="peso_kg" value="${Number(pt.peso_kg || 0)}" />
          </label>
          <div class="full sx-473234">
            <label class="checkbox-inline nowrap-m0">
              <input type="checkbox" name="se_fabrica" id="pt-se-fabrica" ${pt.se_fabrica ? 'checked' : ''} />
              <span>Se fabrica</span>
            </label>
            <label class="checkbox-inline nowrap-m0">
              <input type="checkbox" name="se_compra" id="pt-se-compra" ${pt.se_compra ? 'checked' : ''} />
              <span>Se compra</span>
            </label>
            <label class="checkbox-inline nowrap-m0">
              <input type="checkbox" name="se_vende" id="pt-se-vende" ${pt.se_vende !== 0 ? 'checked' : ''} />
              <span>Se vende</span>
            </label>
            <label class="checkbox-inline nowrap-m0">
              <input type="checkbox" name="requiere_lote" id="pt-req-lote" ${pt.requiere_lote ? 'checked' : ''} />
              <span>Requiere lote</span>
            </label>
          </div>

          ${!isEdit ? `
            <div class="full form-row-2">
              <label>
                <span>Costo Inicial</span>
                <input type="number" step="0.01" min="0" name="costo" value="0" />
              </label>
              <label>
                <span>Precio Inicial</span>
                <input type="number" step="0.01" min="0" name="precio" value="0" />
              </label>
            </div>
          ` : ''}

          <div class="full">
            <span class="field-title">Descripción</span>
            <div id="plt-descripcion-editor"></div>
          </div>

          <div class="full">
            <span class="field-title">Imagen del Producto</span>
            <div class="sx-b830ea">
              <img id="pt-img-preview" src="${esc(pt.imagen_data || '')}" class="img-thumb ${pt.imagen_data ? '' : 'hidden'}" alt="Imagen producto" />
              <input type="file" id="pt-img-file" accept="image/jpeg,image/png,image/webp" />
              <button type="button" id="btn-pt-img-clear" class="btn btn-sm ${pt.imagen_data ? '' : 'hidden'}">Quitar</button>
            </div>
          </div>

          <div class="full">
            <span class="field-title">
              Atributos de Variantes (generan productos individuales al guardar)
            </span>
            <div id="pt-attrs-box" class="sx-76c454"></div>
          </div>

          <div class="full modal-footer">
            <a href="/productos" data-link class="btn">Cancelar</a>
            <button type="submit" class="btn btn-primary">${isEdit ? 'Guardar Plantilla y Sincronizar Variantes' : 'Crear Plantilla'}</button>
          </div>
        </form>
      </div>

      ${isEdit ? `
        <div class="card">
          <div class="card-header">
            <div>
              <h2>Productos / Variantes</h2>
              <span class="muted text-sm">El stock físico es solo lectura (calculado desde Operaciones de Stock y quants por ubicación/lote).</span>
            </div>
            <a href="/operaciones-stock" data-link class="btn btn-sm">Operar Stock</a>
          </div>
          <div class="table-wrap">
            <table class="data-table no-bulk">
              <thead>
                <tr>
                  <th>Variante</th>
                  <th>SKU</th>
                  <th>Cód. Barras</th>
                  <th class="num">Costo</th>
                  <th class="num">Precio Venta</th>
                  <th class="num">Mín. Compra</th>
                  <th class="num">Stock Físico</th>
                  <th class="num">Stock Mín.</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                ${variantes.map(v => `
                  <tr data-prod-row="${v.id}">
                    <td><strong>${esc(v.nombre)}</strong></td>
                    <td><input type="text" class="pv-sku w-120" value="${esc(v.sku || '')}" /></td>
                    <td><input type="text" class="pv-barcode w-130" value="${esc(v.codigo_barras || '')}" placeholder="EAN / UPC" /></td>
                    <td class="num"><input type="number" step="0.01" min="0" class="pv-costo sx-0ebbbc" value="${Number(v.costo || 0)}" /></td>
                    <td class="num"><input type="number" step="0.01" min="0" class="pv-precio sx-0ebbbc" value="${Number(v.precio || 0)}" /></td>
                    <td class="num"><input type="number" step="0.01" min="0" class="pv-min w-90-num" value="${Number(v.minimo_compra || 0)}" /></td>
                    <td class="num"><strong>${fmtNum(v.stock || 0)}</strong> <span class="muted sx-978ebc">${esc(pt.udm || '')}</span></td>
                    <td class="num"><input type="number" step="0.01" min="0" class="pv-stock-min w-90-num" value="${Number(v.stock_minimo || 0)}" /></td>
                    <td><button type="button" class="btn btn-sm btn-primary" data-save-prod="${v.id}">Guardar</button></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : ''}

      ${isEdit && pt.se_fabrica ? `
        <div class="card">
          <div class="card-header">
            <h2>Recetas Asociadas</h2>
            ${isEdit ? `<a href="/recetas/nueva?plantilla_id=${pt.id}" data-link class="btn btn-sm btn-primary">+ Nueva Receta</a>` : ''}
          </div>
          ${recetas.length === 0 ? `
            <div class="empty-state">Sin recetas todavía.</div>
          ` : `
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Receta</th>
                    <th>Estado</th>
                    <th class="num">Líneas</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  ${recetas.map(r => `
                    <tr>
                      <td><strong>${esc(r.nombre)}</strong></td>
                      <td>${r.activa ? '<span class="badge badge-ok">Activa</span>' : '<span class="badge badge-muted">Inactiva</span>'}</td>
                      <td class="num">${r.lineas_count}</td>
                      <td><a href="/recetas/${r.id}" data-link class="btn btn-sm">Abrir Receta</a></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
      ` : ''}

      ${isEdit && pt.se_compra ? `
        <div class="card">
          <div class="card-header">
            <div>
              <h2>Tarifas de Compra por Proveedor</h2>
              <span class="muted text-sm">Costos, códigos de proveedor, cantidades mínimas y plazos por variante o plantilla.</span>
            </div>
          </div>
          <form id="form-pt-prov-tarifa" class="form-grid mb-md">
            <label>
              <span>Proveedor *</span>
              <select name="contacto_id" required>
                <option value="">-- Seleccionar proveedor --</option>
                ${(proveedores || []).map(pr => `<option value="${pr.id}">${esc(pr.nombre)}</option>`).join('')}
              </select>
            </label>
            <label>
              <span>Variantes (vacío = toda la plantilla)</span>
              <div id="pt-tarifa-vars-ms"></div>
            </label>
            <label><span>Cód. Proveedor</span><input type="text" name="codigo_proveedor" placeholder="SKU prov." /></label>
            <label><span>Costo Unitario *</span><input type="number" step="0.01" min="0" name="precio" required placeholder="0.00" /></label>
            <label><span>Cant. Mínima</span><input type="number" step="1" min="1" name="cantidad_minima" value="1" /></label>
            <label><span>Plazo (días)</span><input type="number" step="1" min="0" name="lead_time_dias" value="0" /></label>
            <div class="actions self-end">
              <button type="submit" class="btn btn-primary">+ Agregar Tarifa</button>
            </div>
          </form>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Proveedor</th><th>Alcance</th><th>Cód. Prov.</th><th class="num">Costo</th><th class="num">Mín.</th><th class="num">Plazo</th><th></th></tr></thead>
              <tbody>
                ${(tarifasCompra || []).length === 0
                  ? '<tr><td colspan="7" class="muted">Sin tarifas específicas de proveedor.</td></tr>'
                  : tarifasCompra.map(t => `
                    <tr>
                      <td><strong>${esc(t.proveedor_nombre)}</strong></td>
                      <td>${t.producto_id ? esc(t.producto_nombre) : '<span class="badge badge-muted">Toda la plantilla</span>'}</td>
                      <td class="muted">${esc(t.codigo_proveedor || '-')}</td>
                      <td class="num"><strong>${fmtMoney(t.precio)}</strong></td>
                      <td class="num">${fmtNum(t.cantidad_minima)}</td>
                      <td class="num">${t.lead_time_dias || 0} d</td>
                      <td><button type="button" class="btn btn-sm btn-danger btn-del-tarifa-prov" data-id="${t.id}">Quitar</button></td>
                    </tr>
                  `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : ''}

      ${isEdit && pt.se_vende !== 0 ? `
        <div class="card">
          <div class="card-header">
            <h2>Reglas Rápidas en Listas de Precios</h2>
            <a href="/condiciones-comerciales" data-link class="btn btn-sm">Administrar Listas</a>
          </div>
          <form id="form-pt-lp-item" class="form-grid">
            <label>
              <span>Lista de Precios *</span>
              <select name="lista_precio_id" required>
                ${(listasPrecios || []).map(l => `<option value="${l.id}">${esc(l.nombre)}</option>`).join('')}
              </select>
            </label>
            <label>
              <span>Variantes (vacío = toda la plantilla)</span>
              <div id="pt-lp-vars-ms"></div>
            </label>
            <label><span>Precio Fijo</span><input type="number" step="0.01" min="0" name="precio_fijo" placeholder="Opcional" /></label>
            <label><span>Descuento (%)</span><input type="number" step="0.01" name="descuento_pct" value="0" /></label>
            <label><span>Cant. Mínima</span><input type="number" step="1" min="1" name="cantidad_minima" value="1" /></label>
            <div class="actions self-end">
              <button type="submit" class="btn btn-primary">+ Agregar a Lista</button>
            </div>
          </form>
        </div>
      ` : ''}

      ${isEdit ? `<div id="plantilla-meta-panel" class="sx-8e8697"></div>` : ''}

      ${isEdit ? `
        <div class="card">
          <div class="card-header">
            <h2>Historial de Costos y Precios</h2>
          </div>
          ${historialPrecios.length === 0 ? `
            <div class="empty-state">Sin variaciones de costo o precio registradas.</div>
          ` : `
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Variante</th>
                    <th>Origen</th>
                    <th class="num">Costo Ant.</th>
                    <th class="num">Costo Nuevo</th>
                    <th class="num">Precio Ant.</th>
                    <th class="num">Precio Nuevo</th>
                    <th>Referencia / Usuario</th>
                  </tr>
                </thead>
                <tbody>
                  ${historialPrecios.map(h => `
                    <tr>
                      <td>${esc((h.created_at || '').slice(0, 16).replace('T', ' '))}</td>
                      <td>${esc(h.producto_nombre || '-')}</td>
                      <td><span class="badge">${esc(h.origen || 'manual')}</span></td>
                      <td class="num">${fmtMoney(h.costo_anterior)}</td>
                      <td class="num"><strong>${fmtMoney(h.costo_nuevo)}</strong></td>
                      <td class="num">${fmtMoney(h.precio_anterior)}</td>
                      <td class="num"><strong>${fmtMoney(h.precio_nuevo)}</strong></td>
                      <td>${esc([h.observacion, h.usuario].filter(Boolean).join(' · ') || '-')}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `}
        </div>
      ` : ''}
    `;

    const attrMultiSelects = new Map();
    const syncSelectedAttrsFromDom = () => {
      selectedAttrMap.clear();
      for (const [attr, ms] of attrMultiSelects.entries()) {
        const vals = ms.getValues();
        if (vals.length) selectedAttrMap.set(attr, new Set(vals));
      }
    };

    const renderAttrsBox = () => {
      const box = root.querySelector('#pt-attrs-box');
      if (!box) return;
      for (const ms of attrMultiSelects.values()) ms.destroy?.();
      attrMultiSelects.clear();

      const attrsHtml = globalAttrMap.size === 0
        ? `<div class="muted sx-6b9c17">Todavía no hay atributos cargados. Agregá uno abajo.</div>`
        : Array.from(globalAttrMap.keys()).map((attr, idx) => `
            <div class="sx-72fafc">
              <strong class="sx-205997">${esc(attr)}:</strong>
              <div class="pt-attr-ms sx-7b62ef" data-attr-idx="${idx}"></div>
            </div>
          `).join('');

      box.innerHTML = `
        ${attrsHtml}
        <div class="sx-59f2d8">
          <input type="text" id="pt-new-attr" list="pt-attr-list" placeholder="Atributo" class="sx-1dfda9" />
          <datalist id="pt-attr-list">
            ${Array.from(globalAttrMap.keys()).map(a => `<option value="${esc(a)}"></option>`).join('')}
          </datalist>
          <input type="text" id="pt-new-vals" placeholder="Valores separados por coma" class="sx-39cc94" />
          <button type="button" id="btn-pt-add-attr" class="btn btn-sm">+ Agregar Atributo / Valores</button>
        </div>
      `;

      Array.from(globalAttrMap.entries()).forEach(([attr, vals], idx) => {
        const el = box.querySelector(`.pt-attr-ms[data-attr-idx="${idx}"]`);
        const chosen = Array.from(selectedAttrMap.get(attr) || []);
        const ms = mountMultiSelect(el, {
          values: chosen,
          placeholder: `Seleccionar ${attr}...`,
          items: vals.map(v => ({ value: v, label: v })),
          onChange: (nextVals) => {
            if (nextVals.length) selectedAttrMap.set(attr, new Set(nextVals));
            else selectedAttrMap.delete(attr);
          },
        });
        attrMultiSelects.set(attr, ms);
      });

      const addAttrValues = async () => {
        const attr = box.querySelector('#pt-new-attr')?.value.trim();
        const rawVals = box.querySelector('#pt-new-vals')?.value || '';
        const vals = rawVals.split(',').map(v => v.trim()).filter(Boolean);
        if (!attr || vals.length === 0) {
          toast('Ingresá un atributo y al menos un valor separado por coma', true);
          return;
        }
        syncSelectedAttrsFromDom();
        if (!globalAttrMap.has(attr)) globalAttrMap.set(attr, []);
        if (!selectedAttrMap.has(attr)) selectedAttrMap.set(attr, new Set());
        let added = 0;
        for (const val of vals) {
          if (!globalAttrMap.get(attr).includes(val)) {
            try {
              await api('/api/variantes', { method: 'POST', body: JSON.stringify({ atributo: attr, valor: val }) });
            } catch (err) {
              if (!String(err.message || '').includes('existe')) {
                toast(err.message, true);
                continue;
              }
            }
            globalAttrMap.get(attr).push(val);
            added++;
          }
          selectedAttrMap.get(attr).add(val);
        }
        renderAttrsBox();
        if (added > 0) toast(`Atributo "${attr}" actualizado (${added} valor${added > 1 ? 'es' : ''})`);
      };

      box.querySelector('#btn-pt-add-attr')?.addEventListener('click', addAttrValues);
      box.querySelector('#pt-new-vals')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addAttrValues(); }
      });
    };

    document.querySelectorAll('.combo-menu').forEach(m => {
      if (!m.__comboInput || !document.body.contains(m.__comboInput)) m.remove();
    });
    renderAttrsBox();
    mountCombobox(root.querySelector('#pt-cat-combo'), {
      name: 'categoria',
      required: true,
      value: pt.categoria || '',
      placeholder: 'Buscar o crear categoría...',
      items: categorias.map(c => {
        const lbl = c.display_name || (c.padre_nombre ? `${c.padre_nombre} / ${c.nombre}` : c.nombre);
        return { value: lbl, label: lbl, raw: c };
      }),
      onSelect: (it) => { if (it) pt.categoria = it.value; },
      onCreate: async (q) => {
        const created = await quickCreateCategoria(q);
        if (created) {
          categorias.push(created.raw);
          pt.categoria = created.value;
        }
        return created;
      },
    });

    const descEditor = mountRichEditor(root.querySelector('#plt-descripcion-editor'), {
      value: pt.descripcion || '',
      placeholder: 'Detalles técnicos, materiales, links, imágenes, videos o archivos...',
    });

    const msVenta = mountMultiSelect(root.querySelector('#pt-imp-venta-multi'), {
      name: 'impuestos_venta_ids',
      values: pt.impuestos_venta_ids || [],
      placeholder: 'Seleccionar impuestos de venta (IVA, Internos, Percepciones)...',
      items: impuestosVentaOpts,
      onChange: (vals) => { pt.impuestos_venta_ids = vals.map(Number); },
    });

    const msCompra = mountMultiSelect(root.querySelector('#pt-imp-compra-multi'), {
      name: 'impuestos_compra_ids',
      values: pt.impuestos_compra_ids || [],
      placeholder: 'Seleccionar impuestos de compra (IVA, Percepciones, Tasas)...',
      items: impuestosCompraOpts,
      onChange: (vals) => { pt.impuestos_compra_ids = vals.map(Number); },
    });

    mountCombobox(root.querySelector('#pt-prov-combo'), {
      name: 'proveedor_id',
      value: pt.proveedor_id || '',
      placeholder: 'Buscar o crear proveedor...',
      items: proveedores.map(p => ({ value: String(p.id), label: p.nombre, sublabel: p.cuit || '', raw: p })),
      getDetailUrl: (it) => `/contactos/${it.value}`,
      onSelect: (it) => { pt.proveedor_id = it ? it.value : ''; },
      onCreate: async (q) => {
        const created = await quickCreateProveedor(q);
        if (created) {
          proveedores.push(created.raw);
          pt.proveedor_id = created.value;
        }
        return created;
      },
    });

    root.querySelector('#pt-img-file')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const dataUrl = await compressImageToDataUrl(file);
        pt.imagen_data = dataUrl;
        const prev = root.querySelector('#pt-img-preview');
        const clr = root.querySelector('#btn-pt-img-clear');
        if (prev) { prev.src = dataUrl; prev.classList.remove('hidden'); }
        if (clr) clr.classList.remove('hidden');
      } catch (err) { toast(err.message, true); }
    });
    root.querySelector('#btn-pt-img-clear')?.addEventListener('click', () => {
      pt.imagen_data = '';
      const prev = root.querySelector('#pt-img-preview');
      const clr = root.querySelector('#btn-pt-img-clear');
      const f = root.querySelector('#pt-img-file');
      if (prev) { prev.src = ''; prev.classList.add('hidden'); }
      if (clr) clr.classList.add('hidden');
      if (f) f.value = '';
    });

    root.querySelector('#form-plantilla').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      syncSelectedAttrsFromDom();
      const atributos = Array.from(selectedAttrMap.entries())
        .map(([atributo, vals]) => ({ atributo, valores: Array.from(vals) }))
        .filter(a => a.valores.length > 0);

      const impVentaIds = msVenta.getValues().map(Number).filter(n => n > 0);
      const impCompraIds = msCompra.getValues().map(Number).filter(n => n > 0);
      const selectedVentaIva = (todosImpuestos || []).find(i => impVentaIds.includes(Number(i.id)) && i.tipo === 'iva');
      const selectedCompraIva = (todosImpuestos || []).find(i => impCompraIds.includes(Number(i.id)) && i.tipo === 'iva');

      const payload = {
        codigo: fd.get('codigo'),
        nombre: fd.get('nombre'),
        descripcion: descEditor ? descEditor.getHtml() : '',
        tipo: fd.get('tipo'),
        categoria: fd.get('categoria'),
        udm: fd.get('udm'),
        requiere_lote: fd.get('requiere_lote') === 'on' ? 1 : 0,
        alicuota_iva: selectedVentaIva ? Number(selectedVentaIva.alicuota_defecto) : defaultIva,
        alicuota_iva_compra: selectedCompraIva ? Number(selectedCompraIva.alicuota_defecto) : defaultIvaCompra,
        impuestos_venta_ids: impVentaIds,
        impuestos_compra_ids: impCompraIds,
        proveedor_id: fd.get('proveedor_id') ? Number(fd.get('proveedor_id')) : null,
        lead_time_dias: Math.max(0, Number(fd.get('lead_time_dias')) || 0),
        se_fabrica: fd.get('se_fabrica') === 'on' ? 1 : 0,
        se_compra: fd.get('se_compra') === 'on' ? 1 : 0,
        se_vende: fd.get('se_vende') === 'on' ? 1 : 0,
        cuenta_venta_id: fd.get('cuenta_venta_id') ? Number(fd.get('cuenta_venta_id')) : null,
        cuenta_compra_id: fd.get('cuenta_compra_id') ? Number(fd.get('cuenta_compra_id')) : null,
        moneda: fd.get('moneda') || 'ARS',
        peso_kg: Math.max(0, Number(fd.get('peso_kg')) || 0),
        imagen_data: pt.imagen_data || '',
        atributos,
      };
      if (!isEdit) {
        payload.costo = Number(fd.get('costo')) || 0;
        payload.precio = Number(fd.get('precio')) || 0;
      }

      try {
        if (isEdit) {
          await api(`/api/plantillas/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
          toast('Plantilla y variantes actualizadas');
          await renderPlantillaFormView({ id });
        } else {
          const res = await api('/api/plantillas', { method: 'POST', body: JSON.stringify(payload) });
          toast('Plantilla creada');
          navigate(`/plantillas/${res.id}`);
        }
      } catch (err) {
        toast(err.message, true);
      }
    });

    root.querySelectorAll('[data-save-prod]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row = root.querySelector(`[data-prod-row="${btn.dataset.saveProd}"]`);
        try {
          await api(`/api/productos/${btn.dataset.saveProd}`, {
            method: 'PUT',
            body: JSON.stringify({
              sku: row.querySelector('.pv-sku').value.trim(),
              codigo_barras: row.querySelector('.pv-barcode')?.value.trim() || '',
              costo: Number(row.querySelector('.pv-costo').value) || 0,
              precio: Number(row.querySelector('.pv-precio').value) || 0,
              minimo_compra: Number(row.querySelector('.pv-min').value) || 0,
              stock_minimo: Number(row.querySelector('.pv-stock-min').value) || 0,
            }),
          });
          toast('Variante guardada');
        } catch (err) {
          toast(err.message, true);
        }
      });
    });

    const varianteItems = (variantes || []).map(v => ({
      value: String(v.id),
      label: `${v.nombre}${v.sku ? ` [${v.sku}]` : ''}`,
    }));
    const msTarifaVars = isEdit ? mountMultiSelect(root.querySelector('#pt-tarifa-vars-ms'), {
      placeholder: '-- Toda la plantilla (o elegir variantes) --',
      items: varianteItems,
    }) : null;
    const msLpVars = isEdit ? mountMultiSelect(root.querySelector('#pt-lp-vars-ms'), {
      placeholder: '-- Toda la plantilla (o elegir variantes) --',
      items: varianteItems,
    }) : null;

    root.querySelector('#form-pt-prov-tarifa')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const selectedVars = msTarifaVars ? msTarifaVars.getValues().map(Number).filter(n => n > 0) : [];
      const targets = selectedVars.length ? selectedVars : [null];
      try {
        for (const prodId of targets) {
          await api('/api/producto-proveedores', {
            method: 'POST',
            body: {
              plantilla_id: Number(id),
              producto_id: prodId,
              contacto_id: Number(fd.get('contacto_id')),
              codigo_proveedor: fd.get('codigo_proveedor') || '',
              precio: Number(fd.get('precio') || 0),
              cantidad_minima: Number(fd.get('cantidad_minima') || 1),
              lead_time_dias: Number(fd.get('lead_time_dias') || 0),
            },
          });
        }
        toast(targets.length > 1 ? `${targets.length} tarifas de proveedor agregadas` : 'Tarifa de proveedor agregada');
        await renderPlantillaFormView({ id });
      } catch (err) { toast(err.message, true); }
    });
    root.querySelectorAll('.btn-del-tarifa-prov').forEach(btn => btn.addEventListener('click', async () => {
      try {
        await api(`/api/producto-proveedores/${btn.dataset.id}`, { method: 'DELETE' });
        toast('Tarifa eliminada');
        await renderPlantillaFormView({ id });
      } catch (err) { toast(err.message, true); }
    }));
    root.querySelector('#form-pt-lp-item')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const lpId = fd.get('lista_precio_id');
      if (!lpId) return;
      const selectedVars = msLpVars ? msLpVars.getValues().map(Number).filter(n => n > 0) : [];
      const targets = selectedVars.length ? selectedVars : [null];
      try {
        for (const prodId of targets) {
          await api(`/api/listas-precios/${lpId}/items`, {
            method: 'POST',
            body: {
              plantilla_id: prodId ? null : Number(id),
              producto_id: prodId,
              precio_fijo: fd.get('precio_fijo') || null,
              descuento_pct: Number(fd.get('descuento_pct') || 0),
              cantidad_minima: Number(fd.get('cantidad_minima') || 1),
            },
          });
        }
        toast(targets.length > 1 ? `${targets.length} reglas agregadas a la lista de precios` : 'Regla agregada a la lista de precios');
        await renderPlantillaFormView({ id });
      } catch (err) { toast(err.message, true); }
    });

    if (isEdit) {
      renderMetaPanel(root.querySelector('#plantilla-meta-panel'), {
        entidadTipo: 'plantilla',
        entidadId: id,
        titulo: existing?.nombre ? `Producto ${existing.nombre}` : 'Producto',
      });
    }
  };

  render();
}
