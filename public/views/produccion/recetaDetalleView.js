import { api, toast } from '../../lib/api.js';
import { navigate } from '../../router.js';
import { esc, fmtMoney, fmtNum } from '../../lib/format.js';
import { showConfirmModal } from '../../lib/modal.js';

export async function renderRecetaDetalleView({ id }) {
  const root = document.getElementById('app-view');
  const [detalle, plantillas, productos, unidades, variantes] = await Promise.all([
    api(`/api/recetas/${id}`),
    api('/api/plantillas?se_fabrica=1'),
    api('/api/productos'),
    api('/api/unidades'),
    api('/api/variantes'),
  ]);

  const { receta, lineas, costoBase } = detalle;
  const etapas = detalle.etapas || [];

  const variantesByAttr = new Map();
  for (const v of variantes) {
    if (!variantesByAttr.has(v.atributo)) variantesByAttr.set(v.atributo, []);
    variantesByAttr.get(v.atributo).push(v);
  }

  let editingLineId = null;
  let selectedProdId = productos[0]?.id ?? '';
  let formEtapaId = etapas[0]?.id ?? '';
  let formCoef = '1';
  let formUdmReceta = productos[0]?.udm || unidades[0]?.nombre || 'unidades';
  let formVariantes = new Set();
  let formEmparejar = false;

  const buildHdrVarOptions = (pltId, selectedVarId) => {
    const vars = productos.filter(p => String(p.plantilla_id) === String(pltId));
    return `<option value="">Todas las variantes de la plantilla</option>` +
      vars.map(v => `<option value="${v.id}" ${String(v.id) === String(selectedVarId || '') ? 'selected' : ''}>${esc(v.nombre || v.combinacion_json)}</option>`).join('');
  };

  const compatibleUnits = (prodUdm) => {
    const base = unidades.find(u => u.nombre === prodUdm);
    if (!base) return unidades;
    return unidades.filter(u => u.categoria === base.categoria);
  };

  const render = () => {
    const currentProd = productos.find(p => String(p.id) === String(selectedProdId)) || productos[0];
    const prodUnits = currentProd ? compatibleUnits(currentProd.udm) : unidades;
    if (currentProd && !prodUnits.some(u => u.nombre === formUdmReceta)) {
      formUdmReceta = currentProd.udm;
    }

    root.innerHTML = `
      <div class="page-header">
        <div>
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <h1>${esc(receta.nombre)}</h1>
            ${receta.activa
              ? '<span class="badge badge-ok">Receta Activa</span>'
              : '<span class="badge badge-muted">Borrador</span>'}
          </div>
          <p class="muted">
            Producto: <strong>${esc(receta.plantilla_nombre)}</strong>
            ${receta.producto_id ? ` · Variante: <strong>${esc(receta.producto_nombre || receta.producto_combinacion)}</strong>` : ''}
            ${receta.referencia ? ` · Ref: <strong>${esc(receta.referencia)}</strong>` : ''}
            · Materiales: <strong>${fmtMoney(receta.costo_materiales ?? costoBase)}</strong>
            · Procesos: <strong>${fmtMoney(receta.costo_procesos ?? 0)}</strong>
            · Costo total / unidad: <strong>${fmtMoney(receta.costo_total_unidad ?? costoBase)}</strong>
          </p>
        </div>
        <div class="actions">
          <a href="/recetas" data-link class="btn">← Volver a Recetas</a>
          ${!receta.activa ? `<button type="button" id="btn-activar-receta" class="btn btn-secondary">Marcar como Activa</button>` : ''}
          <button type="button" id="btn-eliminar-receta" class="btn btn-danger">Eliminar Receta</button>
        </div>
      </div>

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

      <div class="card">
        <div class="card-header">
          <h2>Etapas de Producción</h2>
          <span class="muted" style="font-size:0.85rem;">Orden y días estimados propios de esta receta</span>
        </div>
        <form id="form-add-receta-etapa" class="inline-form" style="margin-bottom:12px;">
          <input type="number" name="orden" min="1" value="${(etapas[etapas.length - 1]?.orden || 0) + 1}" style="width:70px;" title="Orden" />
          <input type="text" name="nombre" required placeholder="Nombre de etapa" style="flex:1; min-width:180px;" />
          <input type="number" name="dias_estimados" min="1" value="1" style="width:80px;" title="Días estimados" />
          <input type="number" name="costo_unidad" min="0" step="0.01" value="0" style="width:100px;" title="Costo proceso por unidad ($)" placeholder="Costo/u" />
          <select name="depende_de_id" style="min-width:170px;">
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
                  <th style="width:80px;">Orden</th>
                  <th>Etapa</th>
                  <th style="width:110px;">Días Est.</th>
                  <th style="width:120px;">Costo / u ($)</th>
                  <th style="width:190px;">Depende de</th>
                  <th style="width:170px;">Acciones</th>
                </tr>
              </thead>
              <tbody>
                ${etapas.map(et => `
                  <tr data-receta-etapa-row="${et.id}">
                    <td><input type="number" class="et-orden" min="1" value="${et.orden}" style="width:65px;" /></td>
                    <td><input type="text" class="et-nombre" value="${esc(et.nombre)}" /></td>
                    <td><input type="number" class="et-dias" min="1" value="${et.dias_estimados}" style="width:80px;" /></td>
                    <td><input type="number" class="et-costo" min="0" step="0.01" value="${Number(et.costo_unidad || 0)}" style="width:95px;" /></td>
                    <td>
                      <select class="et-depende" style="min-width:165px;">
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
                    <td class="muted">${fmtNum(l.coef_convertido)} ${esc(l.udm_compra)}</td>
                    <td>
                      ${Number(l.emparejar_variante) === 1 ? '<span class="badge badge-ok" style="margin-right:4px;">Emparejar variante</span>' : ''}
                      ${l.variantes && l.variantes.length
                        ? l.variantes.map(v => {
                            const label = typeof v === 'string' ? v : `${v.atributo}: ${v.valor}`;
                            return `<span class="badge badge-warn" style="margin-right:3px;">${esc(label)}</span>`;
                          }).join('')
                        : (Number(l.emparejar_variante) === 1 ? '' : '<span class="muted">Todas las variantes</span>')}
                    </td>
                    <td class="num">${fmtMoney(l.precio)} / ${esc(l.udm_compra)}</td>
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
        ${productos.length === 0 ? `
          <div class="empty-state">
            No hay productos cargados en el catálogo. <a href="/plantillas/nueva" data-link class="link-primary">Crear un producto primero</a>.
          </div>
        ` : `
          <form id="form-receta-linea" class="form-grid">
            <label>
              <span>Insumo / Producto *</span>
              <select id="line-prod-select" name="producto_id" required>
                ${productos.map(p => `
                  <option value="${p.id}" ${String(p.id) === String(selectedProdId) ? 'selected' : ''}>
                    ${esc(p.nombre)} (${esc(p.categoria)}${p.proveedor_nombre ? ' · ' + esc(p.proveedor_nombre) : ''}) — ${fmtMoney(p.precio)}/${esc(p.udm)}
                  </option>
                `).join('')}
              </select>
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
        `}
      </div>
    `;

    root.querySelector('#btn-activar-receta')?.addEventListener('click', async () => {
      try {
        await api(`/api/recetas/${id}`, { method: 'PUT', body: JSON.stringify({ activa: true }) });
        toast('Receta activada');
        await renderRecetaDetalleView({ id });
      } catch (err) {
        toast(err.message, true);
      }
    });

    root.querySelector('#btn-eliminar-receta')?.addEventListener('click', async () => {
      if (!(await showConfirmModal('¿Eliminar esta receta técnica?'))) return;
      try {
        await api(`/api/recetas/${id}`, { method: 'DELETE' });
        toast('Receta eliminada');
        navigate('/recetas');
      } catch (err) {
        toast(err.message, true);
      }
    });

    root.querySelector('#hdr-plt-select')?.addEventListener('change', (e) => {
      root.querySelector('#hdr-prod-select').innerHTML = buildHdrVarOptions(e.target.value, null);
    });

    root.querySelector('#form-receta-header').addEventListener('submit', async (e) => {
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

    root.querySelector('#line-prod-select')?.addEventListener('change', (e) => {
      selectedProdId = e.target.value;
      const prod = productos.find(p => String(p.id) === String(selectedProdId));
      if (prod) formUdmReceta = prod.udm;
      formCoef = root.querySelector('#line-coef-input')?.value || formCoef;
      render();
    });

    root.querySelector('#btn-cancel-edit-line')?.addEventListener('click', () => {
      editingLineId = null;
      formCoef = '1';
      formVariantes = new Set();
      formEmparejar = false;
      render();
    });

    root.querySelectorAll('[data-edit-line]').forEach(btn => {
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
        render();
        root.querySelector('#line-editor-card')?.scrollIntoView({ behavior: 'smooth' });
      });
    });

    root.querySelectorAll('[data-del-line]').forEach(btn => {
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

    root.querySelector('#form-add-receta-etapa')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api(`/api/recetas/${id}/etapas`, {
          method: 'POST',
          body: JSON.stringify({
            orden: Number(fd.get('orden')) || 1,
            nombre: fd.get('nombre'),
            dias_estimados: Number(fd.get('dias_estimados')) || 1,
            costo_unidad: Number(fd.get('costo_unidad')) || 0,
            depende_de_id: fd.get('depende_de_id') ? Number(fd.get('depende_de_id')) : null,
          }),
        });
        toast('Etapa agregada a la receta');
        await renderRecetaDetalleView({ id });
      } catch (err) {
        toast(err.message, true);
      }
    });

    root.querySelectorAll('[data-save-etapa]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row = root.querySelector(`[data-receta-etapa-row="${btn.dataset.saveEtapa}"]`);
        const depVal = row.querySelector('.et-depende')?.value;
        try {
          await api(`/api/receta-etapas/${btn.dataset.saveEtapa}`, {
            method: 'PUT',
            body: JSON.stringify({
              orden: Number(row.querySelector('.et-orden').value) || 1,
              nombre: row.querySelector('.et-nombre').value.trim(),
              dias_estimados: Number(row.querySelector('.et-dias').value) || 1,
              costo_unidad: Number(row.querySelector('.et-costo')?.value) || 0,
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

    root.querySelectorAll('[data-del-etapa]').forEach(btn => {
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

    root.querySelector('#form-receta-linea')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const vars = Array.from(root.querySelectorAll('.line-var-cb:checked')).map(cb => cb.dataset.key);
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
  };

  render();
}
