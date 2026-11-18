import { api, toast } from '../../lib/api.js';
import { navigate } from '../../router.js';
import { esc, fmtMoney, fmtNum, compressImageToDataUrl, mountRichEditor } from '../../lib/format.js';
import { showConfirmModal, showFormModal, renderSpreadsheetTable } from '../../lib/engine/index.js';
import { renderMetaPanel } from '../../lib/metaPanel.js';
import { openPdfFromEndpoint } from '../../lib/print/index.js';
import { mountDetailView } from '../../lib/engine/detailEngine.js';
import { mountCombobox, mountMultiSelect, quickCreateProducto } from '../../lib/autocomplete.js';

export async function renderRecetaDetalleView({ id }) {
  const root = document.getElementById('app-view');
  const [detalle, plantillas, productos, unidades, variantes, talleres, planCuentas] = await Promise.all([
    api(`/api/recetas/${id}`),
    api('/api/plantillas?se_fabrica=1'),
    api('/api/productos'),
    api('/api/unidades'),
    api('/api/variantes'),
    api('/api/contactos?es_taller=1').catch(() => []),
    api('/api/tesoreria/plan-cuentas').catch(() => []),
  ]);

  const { receta, lineas } = detalle;
  const costoBase = Number(detalle.costoBase ?? receta.costo_materiales ?? 0);
  const etapas = detalle.etapas || [];
  const insumoProductos = productos.filter(p => Number(p.plantilla_id) !== Number(receta.plantilla_id));
  const cuentasEgreso = (planCuentas || []).filter(c => Number(c.activo) !== 0 && Number(c.imputable) !== 0 && (c.tipo === 'egreso' || c.tipo === 'activo'));
  const tallerOpts = (selectedId) => [
    '<option value="">-- Sin taller --</option>',
    ...talleres.map(t => `<option value="${t.id}" ${Number(selectedId) === Number(t.id) ? 'selected' : ''}>${esc(t.nombre)}</option>`),
  ].join('');
  const cuentaOpts = (selectedId) => [
    '<option value="">-- Cuenta por defecto --</option>',
    ...cuentasEgreso.map(c => `<option value="${c.id}" ${Number(selectedId) === Number(c.id) ? 'selected' : ''}>${esc(c.codigo)} · ${esc(c.nombre)}</option>`),
  ].join('');

  const targetVariantesMap = new Map();
  for (const p of productos) {
    if (Number(p.plantilla_id) !== Number(receta.plantilla_id)) continue;
    let combo = {};
    try { combo = typeof p.combinacion_json === 'string' ? JSON.parse(p.combinacion_json || '{}') : (p.combinacion || {}); } catch { combo = {}; }
    for (const [k, v] of Object.entries(combo)) {
      const key = `${k}: ${v}`;
      if (!targetVariantesMap.has(key)) targetVariantesMap.set(key, { atributo: k, valor: String(v) });
    }
  }
  const targetVariantes = targetVariantesMap.size > 0
    ? Array.from(targetVariantesMap.values())
    : variantes;
  const targetAttrs = new Set(targetVariantes.map(v => String(v.atributo).trim().toLowerCase()));

  let editingLineId = null;
  let selectedProdId = insumoProductos[0]?.id ?? '';
  let formEtapaId = etapas[0]?.id ?? '';
  let formCoef = '1';
  let formUdmReceta = insumoProductos[0]?.udm || unidades[0]?.nombre || 'unidades';
  let formVariantes = new Set();
  let formEmparejar = false;
  let activeTab = 'insumos';

  const buildHdrVarOptions = (pltId, selectedVarId) => {
    const vars = productos.filter(p => String(p.plantilla_id) === String(pltId));
    return `<option value="">Todas las variantes de la plantilla</option>` +
      vars.map(v => `<option value="${v.id}" ${String(v.id) === String(selectedVarId || '') ? 'selected' : ''}>${esc(v.nombre || v.combinacion_json)}</option>`).join('');
  };

  const compatibleUnits = (prodUdm) => {
    const base = unidades.find(u => u.nombre === prodUdm);
    if (!base) return unidades;
    const grp = base.grupo || base.categoria;
    if (!grp) return unidades;
    return unidades.filter(u => (u.grupo || u.categoria) === grp);
  };

  const render = () => {
    const currentProd = insumoProductos.find(p => String(p.id) === String(selectedProdId)) || insumoProductos[0];
    const prodUnits = currentProd ? compatibleUnits(currentProd.udm) : unidades;
    if (currentProd && !prodUnits.some(u => u.nombre === formUdmReceta)) {
      formUdmReceta = currentProd.udm;
    }

    const headerFormHtml = `
      <div class="card">
        <div class="card-header"><h2>Datos de la Receta</h2></div>
        <form id="form-receta-header" class="form-grid">
          <label>
            <span>Producto *</span>
            <select name="plantilla_id" id="hdr-plt-select" required>
              ${plantillas.map(p => `<option value="${p.id}" ${p.id === receta.plantilla_id ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}
            </select>
          </label>
          <label>
            <span>Variante específica</span>
            <select name="producto_id" id="hdr-prod-select">
              ${buildHdrVarOptions(receta.plantilla_id, receta.producto_id)}
            </select>
          </label>
          <label>
            <span>Nombre de la Receta *</span>
            <input type="text" name="nombre" required value="${esc(receta.nombre)}" />
          </label>
          <label>
            <span>Referencia / Código</span>
            <input type="text" name="referencia" value="${esc(receta.referencia)}" />
          </label>
          <label class="checkbox-field sx-b2a07a">
            <input type="checkbox" name="activa" ${receta.activa ? 'checked' : ''} />
            <span>Receta activa</span>
          </label>
          <label class="full">
            <span>Notas</span>
            <textarea name="notas" rows="2">${esc(receta.notas)}</textarea>
          </label>
          <div class="full modal-footer">
            <button type="submit" class="btn btn-primary">Guardar Cabecera</button>
          </div>
        </form>
      </div>
    `;

    const etapasHtml = `
      <div class="card">
        <div class="card-header">
          <h2>Etapas de Producción</h2>
          <span class="muted text-md">Orden y días estimados propios de esta receta</span>
        </div>
        <form id="form-add-receta-etapa"></form>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th class="w-70">Orden</th>
                <th>Etapa</th>
                <th>Descripción</th>
                <th class="w-85">Días Est.</th>
                <th class="sx-9c41f6">Costo / u ($)</th>
                <th>Taller</th>
                <th>Cuenta Contable</th>
                <th class="w-160">Depende de</th>
                <th>Imagen</th>
                <th class="sx-25ccdc">Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${etapas.map(et => `
                <tr data-receta-etapa-row="${et.id}" data-img-data="${esc(et.imagen_data || '')}">
                  <td><input type="number" class="et-orden w-60" min="1" value="${et.orden}" /></td>
                  <td><input type="text" class="et-nombre sx-307c3d" value="${esc(et.nombre)}" /></td>
                  <td><input type="text" class="et-desc mw-140" value="${esc(et.descripcion || '')}" placeholder="Sin descripción" /></td>
                  <td><input type="number" class="et-dias sx-afd60f" min="1" value="${et.dias_estimados}" /></td>
                  <td><input type="number" class="et-costo sx-41f7c3" min="0" step="0.01" value="${Number(et.costo_unidad || 0)}" /></td>
                  <td><select class="et-taller sx-bd123a">${tallerOpts(et.taller_id)}</select></td>
                  <td><select class="et-cta mw-150">${cuentaOpts(et.plan_cuenta_id)}</select></td>
                  <td>
                    <select class="et-depende mw-140">
                      <option value="">-- Ninguna --</option>
                      ${etapas.filter(o => o.id !== et.id).map(o => `<option value="${o.id}" ${Number(et.depende_de_id) === Number(o.id) ? 'selected' : ''}>${esc(o.nombre)}</option>`).join('')}
                    </select>
                  </td>
                  <td>
                    <div class="sx-c59ad0">
                      <img src="${esc(et.imagen_data || '')}" class="img-thumb et-img-prev ${et.imagen_data ? '' : 'hidden'} sx-4684e7" alt="Etapa" />
                      <label class="btn btn-sm sx-b76a9b">
                        Foto
                        <input type="file" class="et-img-file sx-cb4589" accept="image/jpeg,image/png,image/webp" />
                      </label>
                      <button type="button" class="btn btn-sm btn-danger et-img-clear ${et.imagen_data ? '' : 'hidden'}" title="Quitar foto">×</button>
                    </div>
                  </td>
                  <td>
                    <div class="actions">
                      <button type="button" class="btn btn-sm" data-save-etapa="${et.id}">Guardar</button>
                      <button type="button" class="btn btn-sm btn-danger" data-del-etapa="${et.id}">Eliminar</button>
                    </div>
                  </td>
                </tr>
              `).join('')}
              <tr class="sx-682310">
                <td><input type="number" name="orden" form="form-add-receta-etapa" min="1" value="${(etapas[etapas.length - 1]?.orden || 0) + 1}" class="w-60" title="Orden" /></td>
                <td><input type="text" name="nombre" form="form-add-receta-etapa" required placeholder="Nueva etapa..." class="sx-307c3d" /></td>
                <td><input type="text" name="descripcion" form="form-add-receta-etapa" placeholder="Descripción" class="mw-140" /></td>
                <td><input type="number" name="dias_estimados" form="form-add-receta-etapa" min="1" value="1" class="sx-afd60f" title="Días estimados" /></td>
                <td><input type="number" name="costo_unidad" form="form-add-receta-etapa" min="0" step="0.01" value="0" class="sx-41f7c3" title="Costo proceso por unidad ($)" /></td>
                <td><select name="taller_id" form="form-add-receta-etapa" class="sx-bd123a">${tallerOpts(null)}</select></td>
                <td><select name="plan_cuenta_id" form="form-add-receta-etapa" class="mw-150">${cuentaOpts(null)}</select></td>
                <td>
                  <select name="depende_de_id" form="form-add-receta-etapa" class="mw-140">
                    <option value="">-- Ninguna --</option>
                    ${etapas.map(e => `<option value="${e.id}">${esc(e.nombre)}</option>`).join('')}
                  </select>
                </td>
                <td class="muted text-xs">-</td>
                <td><button type="submit" form="form-add-receta-etapa" class="btn btn-primary btn-sm">+ Agregar</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;

    const renderInsumoEditorRow = () => `
      <tr id="line-editor-card" class="sx-682310">
        <td><div id="line-prod-combo" class="mw-220"></div></td>
        <td>
          <select name="receta_etapa_id" form="form-receta-linea" class="sx-bd123a">
            <option value="">General</option>
            ${etapas.map(et => `<option value="${et.id}" ${String(et.id) === String(formEtapaId || '') ? 'selected' : ''}>${et.orden}. ${esc(et.nombre)} (${et.dias_estimados}d)</option>`).join('')}
          </select>
        </td>
        <td class="num">
          <input type="number" step="0.0001" min="0" name="coeficiente" id="line-coef-input" form="form-receta-linea" required value="${esc(formCoef)}" class="sx-b2cc2e" />
        </td>
        <td>
          <select name="udm_receta" id="line-udm-select" form="form-receta-linea" required class="sx-fdeecb">
            ${prodUnits.map(u => `<option value="${esc(u.nombre)}" ${u.nombre === formUdmReceta ? 'selected' : ''}>${esc(u.nombre)}</option>`).join('')}
          </select>
        </td>
        <td><div id="line-variantes-multi" class="mw-170"></div></td>
        <td>
          <div class="actions">
            <button type="submit" form="form-receta-linea" class="btn btn-sm btn-primary">${editingLineId ? 'Guardar' : '+ Agregar'}</button>
            ${editingLineId ? '<button type="button" id="btn-cancel-edit-line" class="btn btn-sm">Cancelar</button>' : ''}
          </div>
        </td>
      </tr>
    `;

    const insumosHtml = `
      <div class="card">
        <div class="card-header">
          <div>
            <h2>Insumos de la Receta</h2>
            <span class="text-sm-muted">Click en una celda para editar · Tab/Enter navega · Ctrl+V pega desde Excel · Costo base: <strong>${fmtMoney(costoBase)} / u.</strong></span>
          </div>
          <button type="button" class="btn btn-sm" id="btn-map-plantilla-variantes">+ Mapear por variante</button>
        </div>
        <form id="form-receta-linea"></form>
        ${editingLineId ? `
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Insumo / Producto</th>
                  <th>Etapa</th>
                  <th class="num">Cantidad</th>
                  <th>UdM</th>
                  <th>Equiv.</th>
                  <th>Variantes</th>
                  <th title="Emparejar variante automáticamente">Emparejar</th>
                  <th class="num">Precio Unit.</th>
                  <th class="num">Costo / u.</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                ${lineas.map(l => {
                  if (Number(editingLineId) === Number(l.id)) return renderInsumoEditorRow();
                  return `
                    <tr>
                      <td>
                        <strong>${esc(l.producto_nombre)}</strong>
                        <div class="muted text-xs">${esc(l.categoria)}${l.proveedor_nombre ? ` · ${esc(l.proveedor_nombre)}` : ''}</div>
                      </td>
                      <td><span class="badge badge-muted">${esc(l.etapa_nombre || 'General')}</span></td>
                      <td class="num">${fmtNum(l.coeficiente)}</td>
                      <td class="nowrap">${esc(l.udm_receta)}</td>
                      <td class="muted nowrap">${fmtNum(l.coef_convertido)} ${esc(l.udm)}</td>
                      <td>
                        ${l.variantes && l.variantes.length
                          ? l.variantes.map(v => {
                              const label = typeof v === 'string' ? v : `${v.atributo}: ${v.valor}`;
                              return `<span class="badge badge-warn sx-4aa43e">${esc(label)}</span>`;
                            }).join('')
                          : '<span class="muted">Todas</span>'}
                      </td>
                      <td class="text-center">${Number(l.emparejar_variante) === 1 ? '<span class="badge badge-ok">Sí</span>' : '<span class="muted">-</span>'}</td>
                      <td class="num nowrap">${fmtMoney(l.precio)} / ${esc(l.udm)}</td>
                      <td class="num nowrap"><strong>${fmtMoney(l.costo_par)}</strong></td>
                      <td>
                        <div class="actions">
                          <button type="button" class="btn btn-sm" data-edit-line="${l.id}">Editar</button>
                          <button type="button" class="btn btn-sm btn-danger" data-del-line="${l.id}">Quitar</button>
                        </div>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        ` : `<div id="receta-insumos-sheet"></div>`}
      </div>
      ${(() => {
        const comunes = lineas.filter(l => !l.variantes || l.variantes.length === 0);
        const costoComunes = comunes.reduce((s, l) => s + (Number(l.costo_par) || 0), 0);
        const costoEtapas = etapas.reduce((s, e) => s + (Number(e.costo_unidad) || 0), 0);
        const costoGlobal = costoComunes + costoEtapas;
        const byVar = new Map();
        for (const l of lineas) {
          if (!l.variantes || l.variantes.length === 0) continue;
          for (const v of l.variantes) {
            const label = typeof v === 'string' ? v : `${v.atributo}: ${v.valor}`;
            byVar.set(label, (byVar.get(label) || 0) + (Number(l.costo_par) || 0));
          }
        }
        return `
          <div class="card mt-md">
            <div class="card-header">
              <h2>Desglose de Costos</h2>
              <span class="text-sm-muted">Base común (sin variantes específicas) + procesos + adicionales por variante</span>
            </div>
            <div class="ve-detail-kpis mb-md">
              <div class="ve-kpi-card">
                <div class="ve-kpi-label">Insumos Comunes</div>
                <div class="ve-kpi-value">${fmtMoney(costoComunes)}</div>
              </div>
              <div class="ve-kpi-card">
                <div class="ve-kpi-label">Procesos / Etapas</div>
                <div class="ve-kpi-value">${fmtMoney(costoEtapas)}</div>
              </div>
              <div class="ve-kpi-card tone-ok">
                <div class="ve-kpi-label">Costo Base Global</div>
                <div class="ve-kpi-value">${fmtMoney(costoGlobal)}</div>
              </div>
            </div>
            ${byVar.size > 0 ? `
              <div class="table-wrap">
                <table class="data-table no-bulk">
                  <thead>
                    <tr>
                      <th>Variante</th>
                      <th class="num">Insumos Comunes</th>
                      <th class="num">Insumos Variante</th>
                      <th class="num">Procesos</th>
                      <th class="num">Costo Total / u.</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${Array.from(byVar.entries()).map(([varLabel, varCost]) => `
                      <tr>
                        <td><span class="badge badge-warn">${esc(varLabel)}</span></td>
                        <td class="num">${fmtMoney(costoComunes)}</td>
                        <td class="num">${fmtMoney(varCost)}</td>
                        <td class="num">${fmtMoney(costoEtapas)}</td>
                        <td class="num"><strong>${fmtMoney(costoGlobal + varCost)}</strong></td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            ` : ''}
          </div>
        `;
      })()}
    `;

    const actions = [
      {
        label: 'Calcular y Aplicar Costo',
        primary: true,
        onClick: async () => {
          try {
            const res = await api(`/api/recetas/${id}/calcular-costo`, {
              method: 'POST',
              body: { aplicar: true },
            });
            toast(`Costo aplicado ($${res.costo_total.toLocaleString('es-AR')} = Insumos $${res.costo_insumos.toLocaleString('es-AR')} + Etapas $${res.costo_etapas.toLocaleString('es-AR')}) en ${res.aplicados} variante(s)`);
          } catch (err) { toast(err.message, true); }
        },
      },
    ];
    if (!receta.activa) {
      actions.push({
        label: 'Marcar como Activa',
        className: 'btn btn-secondary',
        onClick: async () => {
          try {
            await api(`/api/recetas/${id}`, { method: 'PUT', body: JSON.stringify({ activa: true }) });
            toast('Receta activada');
            await renderRecetaDetalleView({ id });
          } catch (err) {
            toast(err.message, true);
          }
        },
      });
    }
    const fichaHtml = `
      <div class="card">
        <div class="card-header">
          <div>
            <h2>Ficha Técnica</h2>
            <span class="muted sx-a3099f">Especificaciones, instrucciones de confección, terminaciones y tolerancias. Se incluye al exportar a PDF.</span>
          </div>
          <div class="actions">
            ${receta.plantilla_imagen ? `<img src="${esc(receta.plantilla_imagen)}" class="img-thumb" alt="Producto" />` : ''}
            <button type="button" class="btn btn-primary" id="btn-save-ficha">Guardar Ficha Técnica</button>
          </div>
        </div>
        <div class="card-body">
          <div id="receta-rich-editor"></div>
        </div>
      </div>
    `;

    actions.push({
      label: 'PDF Ficha (Con Costos)',
      className: 'btn',
      onClick: () => openPdfFromEndpoint(`/api/recetas/${id}/pdf?con_costos=1`, `ficha-receta-${id}.pdf`),
    });
    actions.push({
      label: 'PDF Ficha (Taller)',
      className: 'btn',
      onClick: () => openPdfFromEndpoint(`/api/recetas/${id}/pdf?con_costos=0`, `ficha-taller-${id}.pdf`),
    });
    actions.push({
      label: 'Eliminar Receta',
      className: 'btn btn-danger',
      onClick: async () => {
        if (!(await showConfirmModal('¿Eliminar esta receta técnica?'))) return;
        try {
          await api(`/api/recetas/${id}`, { method: 'DELETE' });
          toast('Receta eliminada');
          navigate('/recetas');
        } catch (err) {
          toast(err.message, true);
        }
      },
    });

    mountDetailView(root, {
      breadcrumb: { label: 'Volver a Recetas', href: '/recetas' },
      title: receta.nombre,
      subtitle: `Producto: <strong>${esc(receta.plantilla_nombre)}</strong>${receta.producto_id ? ` · Variante: <strong>${esc(receta.producto_nombre || receta.producto_combinacion)}</strong>` : ''}${receta.referencia ? ` · Ref: <strong>${esc(receta.referencia)}</strong>` : ''}`,
      badge: {
        text: receta.activa ? 'Activa' : 'Inactiva',
        className: receta.activa ? 'badge-ok' : 'badge-muted',
      },
      actions,
      smartButtons: [
        { label: 'Insumos', count: lineas.length, onClick: () => root.querySelector('[data-tab-id="insumos"]')?.click() },
        { label: 'Etapas', count: etapas.length, onClick: () => root.querySelector('[data-tab-id="etapas"]')?.click() },
      ],
      kpis: [
        { label: 'Materiales / u.', value: fmtMoney(receta.costo_materiales ?? costoBase) },
        { label: 'Procesos / u.', value: fmtMoney(receta.costo_procesos ?? 0) },
        { label: 'Costo Total / u.', value: fmtMoney(receta.costo_total_unidad ?? costoBase), tone: 'ok' },
        { label: 'Etapas / Insumos', value: `${etapas.length} / ${lineas.length}` },
      ],
      tabs: [
        { id: 'insumos', label: 'Insumos', badge: lineas.length, html: insumosHtml, onMount: () => { activeTab = 'insumos'; } },
        { id: 'etapas', label: 'Etapas', badge: etapas.length, html: etapasHtml, onMount: () => { activeTab = 'etapas'; } },
        { id: 'ficha', label: 'Ficha Técnica', html: fichaHtml, onMount: () => { activeTab = 'ficha'; } },
        { id: 'cabecera', label: 'Cabecera', html: headerFormHtml, onMount: () => { activeTab = 'cabecera'; } },
      ],
      defaultTab: activeTab,
      sidebarPosition: 'bottom',
      sidebarHtml: '<div id="receta-meta-panel"></div>',
      onMountSidebar: (sidebarEl) => {
        renderMetaPanel(sidebarEl.querySelector('#receta-meta-panel'), {
          entidadTipo: 'receta',
          entidadId: id,
          titulo: `Receta ${receta.nombre}`,
          record: receta,
        });
      },
      onAfterMount: (container) => {
        container.querySelector('#hdr-plt-select')?.addEventListener('change', (e) => {
          container.querySelector('#hdr-prod-select').innerHTML = buildHdrVarOptions(e.target.value, null);
        });

        container.querySelector('#form-receta-header')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          try {
            await api(`/api/recetas/${id}`, {
              method: 'PUT',
              body: JSON.stringify({
                plantilla_id: Number(fd.get('plantilla_id')),
                producto_id: fd.get('producto_id') ? Number(fd.get('producto_id')) : null,
                nombre: fd.get('nombre'),
                referencia: fd.get('referencia'),
                activa: fd.get('activa') === 'on',
                notas: fd.get('notas'),
              }),
            });
            toast('Cabecera actualizada');
            await renderRecetaDetalleView({ id });
          } catch (err) {
            toast(err.message, true);
          }
        });

        const sheetHost = container.querySelector('#receta-insumos-sheet');
        if (sheetHost && !editingLineId) {
          const etapaOptions = [
            { value: '', label: 'General' },
            ...etapas.map(et => ({ value: String(et.id), label: `${et.orden}. ${et.nombre}` })),
          ];
          const usedIds = new Set(lineas.map(l => String(l.producto_id)));
          const availInsumoOpts = insumoProductos
            .filter(p => !usedIds.has(String(p.id)))
            .map(p => ({ value: String(p.id), label: p.nombre, raw: p }));

          renderSpreadsheetTable(sheetHost, {
            rows: lineas,
            compact: true,
            defaultNewRow: () => ({
              producto_id: '',
              producto_nombre: '',
              receta_etapa_id: etapas[0]?.id || null,
              etapa_nombre: etapas[0]?.nombre || 'General',
              coeficiente: 1,
              udm: 'unidades',
              udm_receta: 'unidades',
              variantes: [],
            }),
            onCreateRow: async ({ row }) => {
              if (!row.producto_id) return false;
              await api(`/api/recetas/${id}/lineas`, {
                method: 'POST',
                body: {
                  producto_id: Number(row.producto_id),
                  receta_etapa_id: row.receta_etapa_id ? Number(row.receta_etapa_id) : null,
                  coeficiente: Number(row.coeficiente) || 1,
                  udm_receta: row.udm_receta || 'unidades',
                  variantes: Array.isArray(row.variantes) ? row.variantes : [],
                  emparejar_variante: 0,
                },
              });
              toast('Insumo agregado');
              await renderRecetaDetalleView({ id });
              return false;
            },
            columns: [
              {
                key: 'producto_id',
                label: 'Insumo / Producto',
                type: 'combobox',
                editable: (l) => Boolean(l.__isNew),
                placeholder: 'Buscar insumo...',
                options: availInsumoOpts,
                onPickItem: (l, p) => {
                  if (!p) return;
                  l.producto_id = p.id;
                  l.producto_nombre = p.nombre;
                  l.udm = p.udm || 'unidades';
                  l.udm_receta = p.udm || 'unidades';
                },
                render: (l) => l.producto_nombre
                  ? `<strong>${esc(l.producto_nombre)}</strong><div class="muted text-xs">${esc(l.categoria || '')}${l.proveedor_nombre ? ` · ${esc(l.proveedor_nombre)}` : ''}</div>`
                  : '<span class="muted">Seleccionar insumo...</span>',
              },
              {
                key: 'receta_etapa_id',
                label: 'Etapa',
                type: 'select',
                options: etapaOptions,
                getValue: (l) => l.receta_etapa_id || '',
                parse: (v) => (v ? Number(v) : null),
                render: (l) => `<span class="badge badge-muted">${esc(l.etapa_nombre || 'General')}</span>`,
              },
              {
                key: 'coeficiente',
                label: 'Cantidad',
                type: 'number',
                step: 0.0001,
                min: 0,
                align: 'right',
                parse: (v) => Math.max(0, Number(v) || 0),
                render: (l) => fmtNum(l.coeficiente),
              },
              {
                key: 'udm_receta',
                label: 'UdM',
                type: 'select',
                nowrap: true,
                options: (l) => compatibleUnits(l.udm).map(u => ({ value: u.nombre, label: u.nombre })),
              },
              {
                key: 'variantes',
                label: 'Variantes',
                type: 'chips',
                placeholder: 'Todas las variantes...',
                options: targetVariantes.map(v => {
                  const key = `${v.atributo}: ${v.valor}`;
                  return { value: key, label: key };
                }),
                getValue: (l) => (l.variantes || []).map(v => typeof v === 'string' ? v : `${v.atributo}: ${v.valor}`),
                render: (l) => (l.variantes && l.variantes.length
                  ? l.variantes.map(v => {
                      const label = typeof v === 'string' ? v : `${v.atributo}: ${v.valor}`;
                      return `<span class="badge badge-warn sx-4aa43e">${esc(label)}</span>`;
                    }).join('')
                  : '<span class="muted">Todas</span>'),
              },
            ],
            onDeleteRow: async (l) => {
              if (!(await showConfirmModal('¿Quitar insumo de esta receta?'))) return;
              try {
                await api(`/api/receta-lineas/${l.id}`, { method: 'DELETE' });
                toast('Línea quitada');
                await renderRecetaDetalleView({ id });
              } catch (err) {
                toast(err.message, true);
              }
            },
            onCellChange: async ({ row, key, value }) => {
              try {
                const currentVars = (row.variantes || []).map(v => typeof v === 'string' ? v : `${v.atributo}: ${v.valor}`);
                await api(`/api/receta-lineas/${row.id}`, {
                  method: 'PUT',
                  body: {
                    receta_etapa_id: key === 'receta_etapa_id' ? value : (row.receta_etapa_id || null),
                    coeficiente: key === 'coeficiente' ? value : Number(row.coeficiente),
                    udm_receta: key === 'udm_receta' ? value : row.udm_receta,
                    emparejar_variante: key === 'emparejar_variante' ? Number(value) : Number(row.emparejar_variante || 0),
                    variantes: key === 'variantes' ? value : currentVars,
                  },
                });
                toast('Línea actualizada');
                await renderRecetaDetalleView({ id });
              } catch (err) {
                toast(err.message, true);
                throw err;
              }
            },
          });
        }

        container.querySelector('#btn-map-plantilla-variantes')?.addEventListener('click', async () => {
          const plantillasMap = new Map();
          for (const p of insumoProductos) {
            if (!p.plantilla_id) continue;
            let combo = {};
            try { combo = typeof p.combinacion_json === 'string' ? JSON.parse(p.combinacion_json || '{}') : (p.combinacion || {}); } catch { combo = {}; }
            const matchingEntries = Object.entries(combo).filter(([k]) => targetAttrs.has(String(k).trim().toLowerCase()));
            if (!matchingEntries.length) continue;
            const alreadyLoaded = lineas.some(l => Number(l.producto_id) === Number(p.id));
            if (alreadyLoaded) continue;
            if (!plantillasMap.has(p.plantilla_id)) {
              plantillasMap.set(p.plantilla_id, {
                id: p.plantilla_id,
                nombre: p.plantilla_nombre || p.nombre.replace(/\s*\([^)]*\)\s*$/, ''),
                items: [],
              });
            }
            plantillasMap.get(p.plantilla_id).items.push({ ...p, _matchingEntries: matchingEntries });
          }
          const multiPlantillas = Array.from(plantillasMap.values()).filter(pt => pt.items.length > 0);
          if (!multiPlantillas.length) {
            toast('No hay plantillas pendientes con atributos compatibles con este producto.', true);
            return;
          }
          const defaultPtId = String(multiPlantillas[0].id);
          const defaultEtId = formEtapaId ? String(formEtapaId) : '';
          const vals = await showFormModal({
            title: 'Mapear plantilla de insumo por variante',
            submitText: 'Generar líneas',
            initialState: {
              plantilla_id: defaultPtId,
              receta_etapa_id: defaultEtId,
              coeficiente: '1',
            },
            fields: [
              {
                name: 'plantilla_id',
                label: 'Plantilla de Insumo',
                type: 'select',
                required: true,
                options: multiPlantillas.map(pt => ({ value: String(pt.id), label: `${pt.nombre} (${pt.items.length} variantes)` })),
              },
              {
                name: 'receta_etapa_id',
                label: 'Etapa',
                type: 'select',
                options: [{ value: '', label: 'General' }, ...etapas.map(et => ({ value: String(et.id), label: `${et.orden}. ${et.nombre}` }))],
              },
              { name: 'coeficiente', label: 'Cantidad', type: 'number', step: '0.0001', min: '0', required: true },
            ],
          });
          if (!vals) return;
          const pt = plantillasMap.get(Number(vals.plantilla_id || defaultPtId));
          if (!pt) { toast('No se encontró la plantilla seleccionada.', true); return; }
          let creadas = 0;
          for (const p of pt.items) {
            const varList = (p._matchingEntries || []).map(([k, v]) => `${k}: ${v}`);
            if (!varList.length) continue;
            const exists = lineas.some(l => Number(l.producto_id) === Number(p.id) && String(l.receta_etapa_id || '') === String(vals.receta_etapa_id || ''));
            if (exists) continue;
            await api(`/api/recetas/${id}/lineas`, {
              method: 'POST',
              body: {
                producto_id: p.id,
                receta_etapa_id: vals.receta_etapa_id ? Number(vals.receta_etapa_id) : null,
                coeficiente: Number(vals.coeficiente) || 1,
                udm_receta: p.udm || 'unidades',
                variantes: varList,
                emparejar_variante: 0,
              },
            });
            creadas++;
          }
          toast(creadas ? `Se agregaron ${creadas} líneas mapeadas por variante.` : 'Todas las variantes de esa plantilla ya estaban cargadas.');
          await renderRecetaDetalleView({ id });
        });

        const otherLines = lineas.filter(l => Number(l.id) !== Number(editingLineId));
        const usedProdIds = new Set(otherLines.map(l => String(l.producto_id)));
        const availableInsumos = insumoProductos.filter(p => !usedProdIds.has(String(p.id)) || String(p.id) === String(selectedProdId));

        const prodComboEl = container.querySelector('#line-prod-combo');
        if (prodComboEl) {
          mountCombobox(prodComboEl, {
            name: 'producto_id',
            form: 'form-receta-linea',
            required: true,
            value: selectedProdId ? String(selectedProdId) : '',
            placeholder: 'Buscar o crear insumo...',
            items: availableInsumos.map(p => ({
              value: String(p.id),
              label: p.nombre,
              raw: p,
            })),
            getDetailUrl: (it) => it.raw?.plantilla_id ? `/plantillas/${it.raw.plantilla_id}` : null,
            onSelect: (it) => {
              if (!it) { selectedProdId = ''; return; }
              selectedProdId = it.value;
              const prod = it.raw || insumoProductos.find(p => String(p.id) === String(selectedProdId));
              if (prod) formUdmReceta = prod.udm;
              formCoef = container.querySelector('#line-coef-input')?.value || formCoef;
              const udmSel = container.querySelector('#line-udm-select');
              if (udmSel && prod) {
                const units = compatibleUnits(prod.udm);
                udmSel.innerHTML = units.map(u => `<option value="${esc(u.nombre)}" ${u.nombre === formUdmReceta ? 'selected' : ''}>${esc(u.nombre)}</option>`).join('');
              }
            },
            onCreate: async (q) => {
              const created = await quickCreateProducto(q, { se_compra: true, se_fabrica: false });
              if (created) {
                productos.push(created.raw);
                insumoProductos.push(created.raw);
                selectedProdId = created.value;
                formUdmReceta = created.raw.udm || 'unidades';
                const udmSel = container.querySelector('#line-udm-select');
                if (udmSel) {
                  const units = compatibleUnits(formUdmReceta);
                  udmSel.innerHTML = units.map(u => `<option value="${esc(u.nombre)}" ${u.nombre === formUdmReceta ? 'selected' : ''}>${esc(u.nombre)}</option>`).join('');
                }
              }
              return created;
            },
          });
        }

        // Solo excluir variantes ya asignadas al MISMO insumo en la misma etapa
        const usedVarKeys = new Set();
        for (const l of otherLines) {
          if (String(l.producto_id) !== String(selectedProdId)) continue;
          if (String(l.receta_etapa_id || '') !== String(formEtapaId || '')) continue;
          for (const v of (l.variantes || [])) {
            usedVarKeys.add(typeof v === 'string' ? v : `${v.atributo}: ${v.valor}`);
          }
        }
        const availableVariantes = targetVariantes.filter(v => {
          const key = `${v.atributo}: ${v.valor}`;
          return !usedVarKeys.has(key) || formVariantes.has(key);
        });

        const varMultiEl = container.querySelector('#line-variantes-multi');
        const lineVariantesMulti = varMultiEl
          ? mountMultiSelect(varMultiEl, {
              name: 'variantes',
              values: Array.from(formVariantes),
              placeholder: 'Todas las variantes...',
              items: availableVariantes.map(v => {
                const key = `${v.atributo}: ${v.valor}`;
                return { value: key, label: key };
              }),
              onChange: (vals) => { formVariantes = new Set(vals); },
            })
          : null;

        container.querySelector('#btn-cancel-edit-line')?.addEventListener('click', () => {
          editingLineId = null;
          formCoef = '1';
          formVariantes = new Set();
          formEmparejar = false;
          activeTab = 'insumos';
          render();
        });

        container.querySelectorAll('[data-edit-line]').forEach(btn => {
          btn.addEventListener('click', () => {
            const line = lineas.find(l => String(l.id) === String(btn.dataset.editLine));
            if (!line) return;
            editingLineId = line.id;
            selectedProdId = String(line.producto_id);
            formEtapaId = line.receta_etapa_id ? String(line.receta_etapa_id) : (line.etapa_id ? String(line.etapa_id) : '');
            formCoef = String(line.coeficiente);
            formUdmReceta = line.udm_receta;
            formVariantes = new Set((line.variantes || []).map(v => typeof v === 'string' ? v : `${v.atributo}: ${v.valor}`));
            formEmparejar = Number(line.emparejar_variante) === 1;
            activeTab = 'insumos';
            render();
            root.querySelector('#line-editor-card')?.scrollIntoView({ behavior: 'smooth' });
          });
        });

        container.querySelectorAll('[data-del-line]').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (!(await showConfirmModal('¿Quitar insumo de esta receta?'))) return;
            try {
              await api(`/api/receta-lineas/${btn.dataset.delLine}`, { method: 'DELETE' });
              toast('Línea quitada');
              await renderRecetaDetalleView({ id });
            } catch (err) {
              toast(err.message, true);
            }
          });
        });

        container.querySelector('#form-add-receta-etapa')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          try {
            await api(`/api/recetas/${id}/etapas`, {
              method: 'POST',
              body: JSON.stringify({
                orden: Number(fd.get('orden')) || 1,
                nombre: fd.get('nombre'),
                descripcion: fd.get('descripcion') || '',
                dias_estimados: Number(fd.get('dias_estimados')) || 1,
                costo_unidad: Number(fd.get('costo_unidad')) || 0,
                taller_id: fd.get('taller_id') ? Number(fd.get('taller_id')) : null,
                plan_cuenta_id: fd.get('plan_cuenta_id') ? Number(fd.get('plan_cuenta_id')) : null,
                depende_de_id: fd.get('depende_de_id') ? Number(fd.get('depende_de_id')) : null,
              }),
            });
            toast('Etapa agregada a la receta');
            await renderRecetaDetalleView({ id });
          } catch (err) {
            toast(err.message, true);
          }
        });

        container.querySelectorAll('.et-img-file').forEach(inp => {
          inp.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const row = inp.closest('[data-receta-etapa-row]');
            try {
              const dataUrl = await compressImageToDataUrl(file);
              row.dataset.imgData = dataUrl;
              const prev = row.querySelector('.et-img-prev');
              const clr = row.querySelector('.et-img-clear');
              if (prev) { prev.src = dataUrl; prev.classList.remove('hidden'); }
              if (clr) clr.classList.remove('hidden');
            } catch (err) { toast(err.message, true); }
          });
        });
        container.querySelectorAll('.et-img-clear').forEach(btn => {
          btn.addEventListener('click', () => {
            const row = btn.closest('[data-receta-etapa-row]');
            row.dataset.imgData = '';
            const prev = row.querySelector('.et-img-prev');
            const f = row.querySelector('.et-img-file');
            if (prev) { prev.src = ''; prev.classList.add('hidden'); }
            if (f) f.value = '';
            btn.classList.add('hidden');
          });
        });

        const richEd = mountRichEditor(container.querySelector('#receta-rich-editor'), {
          value: receta.ficha_tecnica_html || '',
        });
        container.querySelector('#btn-save-ficha')?.addEventListener('click', async () => {
          try {
            await api(`/api/recetas/${id}`, {
              method: 'PUT',
              body: JSON.stringify({ ficha_tecnica_html: richEd?.getHtml() || '' }),
            });
            toast('Ficha técnica guardada');
            await renderRecetaDetalleView({ id });
          } catch (err) { toast(err.message, true); }
        });

        container.querySelectorAll('[data-save-etapa]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const row = container.querySelector(`[data-receta-etapa-row="${btn.dataset.saveEtapa}"]`);
            const depVal = row.querySelector('.et-depende')?.value;
            const tallerVal = row.querySelector('.et-taller')?.value;
            const ctaVal = row.querySelector('.et-cta')?.value;
            try {
              await api(`/api/receta-etapas/${btn.dataset.saveEtapa}`, {
                method: 'PUT',
                body: JSON.stringify({
                  orden: Number(row.querySelector('.et-orden').value) || 1,
                  nombre: row.querySelector('.et-nombre').value.trim(),
                  descripcion: row.querySelector('.et-desc')?.value.trim() || '',
                  dias_estimados: Number(row.querySelector('.et-dias').value) || 1,
                  costo_unidad: Number(row.querySelector('.et-costo')?.value) || 0,
                  taller_id: tallerVal ? Number(tallerVal) : null,
                  plan_cuenta_id: ctaVal ? Number(ctaVal) : null,
                  depende_de_id: depVal ? Number(depVal) : null,
                  imagen_data: row.dataset.imgData || '',
                }),
              });
              toast('Etapa actualizada');
              await renderRecetaDetalleView({ id });
            } catch (err) {
              toast(err.message, true);
            }
          });
        });

        container.querySelectorAll('[data-del-etapa]').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (!(await showConfirmModal('¿Eliminar esta etapa de la receta?'))) return;
            try {
              await api(`/api/receta-etapas/${btn.dataset.delEtapa}`, { method: 'DELETE' });
              toast('Etapa eliminada');
              await renderRecetaDetalleView({ id });
            } catch (err) {
              toast(err.message, true);
            }
          });
        });

        container.querySelector('#form-receta-linea')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const vars = lineVariantesMulti ? lineVariantesMulti.getValues() : Array.from(formVariantes);
          const prodIdVal = Number(fd.get('producto_id') || selectedProdId);
          const payload = {
            producto_id: prodIdVal,
            receta_etapa_id: fd.get('receta_etapa_id') ? Number(fd.get('receta_etapa_id')) : null,
            coeficiente: Number(fd.get('coeficiente')),
            udm_receta: fd.get('udm_receta'),
            variantes: vars,
            emparejar_variante: fd.get('emparejar_variante') === 'on' ? 1 : 0,
          };
          try {
            if (editingLineId) {
              await api(`/api/receta-lineas/${editingLineId}`, { method: 'PUT', body: JSON.stringify(payload) });
              toast('Línea actualizada');
            } else {
              await api(`/api/recetas/${id}/lineas`, { method: 'POST', body: JSON.stringify(payload) });
              toast('Insumo agregado a la receta');
            }
            await renderRecetaDetalleView({ id });
          } catch (err) {
            toast(err.message, true);
          }
        });
      },
    });
  };

  render();
}
