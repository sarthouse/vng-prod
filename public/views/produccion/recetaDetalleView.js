import { api, toast } from '../../lib/api.js';
import { navigate } from '../../router.js';
import { esc, fmtMoney, fmtNum } from '../../lib/format.js';
import { showConfirmModal } from '../../lib/engine/index.js';
import { renderMetaPanel } from '../../lib/metaPanel.js';
import { mountDetailView } from '../../lib/engine/detailEngine.js';
import { mountCombobox, quickCreateProducto } from '../../lib/autocomplete.js';

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

  const variantesByAttr = new Map();
  for (const v of variantes) {
    if (!variantesByAttr.has(v.atributo)) variantesByAttr.set(v.atributo, []);
    variantesByAttr.get(v.atributo).push(v);
  }

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
          <label class="checkbox-field" style="align-self:end; padding-bottom:8px;">
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
          <span class="muted" style="font-size:0.85rem;">Orden y días estimados propios de esta receta</span>
        </div>
        <form id="form-add-receta-etapa" class="inline-form" style="margin-bottom:12px;">
          <input type="number" name="orden" min="1" value="${(etapas[etapas.length - 1]?.orden || 0) + 1}" style="width:70px;" title="Orden" />
          <input type="text" name="nombre" required placeholder="Nombre de etapa" style="min-width:160px;" />
          <input type="text" name="descripcion" placeholder="Descripción" style="flex:1; min-width:180px;" />
          <input type="number" name="dias_estimados" min="1" value="1" style="width:80px;" title="Días estimados" />
          <input type="number" name="costo_unidad" min="0" step="0.01" value="0" style="width:100px;" title="Costo proceso por unidad ($)" placeholder="Costo/u" />
          <select name="taller_id" style="min-width:155px;">${tallerOpts(null)}</select>
          <select name="plan_cuenta_id" style="min-width:175px;">${cuentaOpts(null)}</select>
          <select name="depende_de_id" style="min-width:160px;">
            <option value="">-- Ninguna --</option>
            ${etapas.map(e => `<option value="${e.id}">Depende de: ${esc(e.nombre)}</option>`).join('')}
          </select>
          <button type="submit" class="btn btn-secondary btn-sm">+ Agregar Etapa</button>
        </form>
        ${etapas.length === 0 ? `
          <div class="empty-state">Esta receta no tiene etapas definidas. Agregá una arriba.</div>
        ` : `
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th style="width:75px;">Orden</th>
                  <th>Etapa</th>
                  <th>Descripción</th>
                  <th style="width:100px;">Días Est.</th>
                  <th style="width:110px;">Costo / u ($)</th>
                  <th>Taller</th>
                  <th>Cuenta Contable</th>
                  <th style="width:170px;">Depende de</th>
                  <th style="width:165px;">Acciones</th>
                </tr>
              </thead>
              <tbody>
                ${etapas.map(et => `
                  <tr data-receta-etapa-row="${et.id}">
                    <td><input type="number" class="et-orden" min="1" value="${et.orden}" style="width:65px;" /></td>
                    <td><input type="text" class="et-nombre" value="${esc(et.nombre)}" /></td>
                    <td><input type="text" class="et-desc" value="${esc(et.descripcion || '')}" placeholder="Sin descripción" style="min-width:160px;" /></td>
                    <td><input type="number" class="et-dias" min="1" value="${et.dias_estimados}" style="width:80px;" /></td>
                    <td><input type="number" class="et-costo" min="0" step="0.01" value="${Number(et.costo_unidad || 0)}" style="width:95px;" /></td>
                    <td><select class="et-taller" style="min-width:140px;">${tallerOpts(et.taller_id)}</select></td>
                    <td><select class="et-cta" style="min-width:165px;">${cuentaOpts(et.plan_cuenta_id)}</select></td>
                    <td>
                      <select class="et-depende" style="min-width:155px;">
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
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;

    const insumosHtml = `
      <div class="card">
        <div class="card-header">
          <h2>Insumos de la Receta</h2>
          <span class="muted" style="font-size:0.85rem;">Base y Plantilla del producto se incluyen automáticamente · Costo receta: <strong>${fmtMoney(costoBase)} / u.</strong></span>
        </div>
        ${lineas.length === 0 ? `
          <div class="empty-state">Todavía no hay insumos en esta receta. Agregalos desde el formulario de abajo.</div>
        ` : `
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Etapa</th>
                  <th>Producto / Insumo</th>
                  <th>Categoría</th>
                  <th>Proveedor</th>
                  <th class="num">Cantidad</th>
                  <th>UdM Receta</th>
                  <th>Equiv. Compra</th>
                  <th>Aplicar en Variantes</th>
                  <th class="num">Precio Unit.</th>
                  <th class="num">Costo / u.</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                ${lineas.map(l => `
                  <tr>
                    <td><span class="badge badge-muted">${esc(l.etapa_nombre || 'General')}</span></td>
                    <td><strong>${esc(l.producto_nombre)}</strong></td>
                    <td><span class="badge badge-muted">${esc(l.categoria)}</span></td>
                    <td>${esc(l.proveedor_nombre || '-')}</td>
                    <td class="num">${fmtNum(l.coeficiente)}</td>
                    <td>${esc(l.udm_receta)}</td>
                    <td class="muted">${fmtNum(l.coef_convertido)} ${esc(l.udm)}</td>
                    <td>
                      ${Number(l.emparejar_variante) === 1 ? '<span class="badge badge-ok" style="margin-right:4px;">Emparejar variante</span>' : ''}
                      ${l.variantes && l.variantes.length
                        ? l.variantes.map(v => {
                            const label = typeof v === 'string' ? v : `${v.atributo}: ${v.valor}`;
                            return `<span class="badge badge-warn" style="margin-right:3px;">${esc(label)}</span>`;
                          }).join('')
                        : (Number(l.emparejar_variante) === 1 ? '' : '<span class="muted">Todas las variantes</span>')}
                    </td>
                    <td class="num">${fmtMoney(l.precio)} / ${esc(l.udm)}</td>
                    <td class="num"><strong>${fmtMoney(l.costo_par)}</strong></td>
                    <td>
                      <div class="actions">
                        <button type="button" class="btn btn-sm" data-edit-line="${l.id}">Editar</button>
                        <button type="button" class="btn btn-sm btn-danger" data-del-line="${l.id}">Quitar</button>
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="9"><strong>Costo Base Global</strong></td>
                  <td class="num"><strong>${fmtMoney(costoBase)}</strong></td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        `}
      </div>

      <div class="card" id="line-editor-card">
        <div class="card-header">
          <h2>${editingLineId ? 'Editar Línea de Insumo' : 'Agregar Línea de Insumo'}</h2>
          ${editingLineId ? `<button type="button" id="btn-cancel-edit-line" class="btn btn-sm">Cancelar Edición</button>` : ''}
        </div>
        <form id="form-receta-linea" class="form-grid">
          <label>
            <span>Insumo / Producto *</span>
            <div id="line-prod-combo"></div>
          </label>
            <label>
              <span>Etapa de Producción</span>
              <select name="receta_etapa_id">
                <option value="">General</option>
                ${etapas.map(et => `<option value="${et.id}" ${String(et.id) === String(formEtapaId || '') ? 'selected' : ''}>${et.orden}. ${esc(et.nombre)} (${et.dias_estimados}d)</option>`).join('')}
              </select>
            </label>
            <label>
              <span>Cantidad por Unidad *</span>
              <input type="number" step="0.0001" min="0" name="coeficiente" id="line-coef-input" required value="${esc(formCoef)}" />
            </label>
            <label>
              <span>UdM en Receta *</span>
              <select name="udm_receta" id="line-udm-select" required>
                ${prodUnits.map(u => `<option value="${esc(u.nombre)}" ${u.nombre === formUdmReceta ? 'selected' : ''}>${esc(u.nombre)}</option>`).join('')}
              </select>
            </label>

            <div class="full">
              <label class="checkbox-field" style="margin-bottom:10px;">
                <input type="checkbox" name="emparejar_variante" ${formEmparejar ? 'checked' : ''} />
                <span>Emparejar variante automáticamente (busca la variante del insumo con los mismos atributos del producto fabricado)</span>
              </label>
              <span style="display:block; font-size:0.82rem; font-weight:600; color:var(--color-secondary); margin-bottom:6px;">
                Aplicar en Variantes · vacío aplica a todas
              </span>
              ${variantes.length === 0 ? `
                <p class="muted" style="font-size:0.85rem;">No hay variantes configuradas. Podés cargarlas en <a href="/configuracion" data-link class="link-primary">Configuración</a>.</p>
              ` : Array.from(variantesByAttr.entries()).map(([attr, list]) => `
                <div style="margin-bottom:8px;">
                  <strong style="font-size:0.82rem; margin-right:8px;">${esc(attr)}:</strong>
                  <div style="display:inline-flex; flex-wrap:wrap; gap:8px;">
                    ${list.map(v => {
                      const key = `${v.atributo}: ${v.valor}`;
                      return `
                        <label class="checkbox-pill">
                          <input type="checkbox" class="line-var-cb" data-key="${esc(key)}" ${formVariantes.has(key) ? 'checked' : ''} />
                          <span>${esc(v.valor)}</span>
                        </label>
                      `;
                    }).join('')}
                  </div>
                </div>
              `).join('')}
            </div>

            <div class="full modal-footer">
              <button type="submit" class="btn btn-primary">${editingLineId ? 'Guardar Cambios de Línea' : '+ Agregar Línea'}</button>
            </div>
          </form>
      </div>
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
        text: receta.activa ? 'Receta Activa' : 'Borrador',
        className: receta.activa ? 'badge-ok' : 'badge-muted',
      },
      actions,
      steps: [
        { key: 'borrador', label: 'Borrador' },
        { key: 'activa', label: 'Receta Activa' },
      ],
      currentStep: receta.activa ? 'activa' : 'borrador',
      smartButtons: [
        { label: 'Insumos', count: lineas.length, icon: '📦', onClick: () => root.querySelector('[data-tab-id="insumos"]')?.click() },
        { label: 'Etapas', count: etapas.length, icon: '⚙️', onClick: () => root.querySelector('[data-tab-id="etapas"]')?.click() },
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
        { id: 'cabecera', label: 'Cabecera', html: headerFormHtml, onMount: () => { activeTab = 'cabecera'; } },
      ],
      defaultTab: activeTab,
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

        const prodComboEl = container.querySelector('#line-prod-combo');
        if (prodComboEl) {
          mountCombobox(prodComboEl, {
            name: 'producto_id',
            required: true,
            value: selectedProdId ? String(selectedProdId) : '',
            placeholder: 'Buscar o crear insumo...',
            items: insumoProductos.map(p => ({
              value: String(p.id),
              label: `${p.nombre} (${p.categoria}${p.proveedor_nombre ? ' · ' + p.proveedor_nombre : ''}) — ${fmtMoney(p.costo || p.precio)}/${p.udm}`,
              raw: p,
            })),
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
          const vars = Array.from(container.querySelectorAll('.line-var-cb:checked')).map(cb => cb.dataset.key);
          const payload = {
            producto_id: Number(fd.get('producto_id')),
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
