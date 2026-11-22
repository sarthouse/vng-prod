import { api, toast } from '../../lib/api.js';
import { navigate } from '../../router.js';
import { esc, fmtMoney, fmtNum, compressImageToDataUrl, mountRichEditor } from '../../lib/format.js';
import { showConfirmModal, showFormModal, renderSpreadsheetTable } from '../../lib/engine/index.js';
import { renderMetaPanel } from '../../lib/metaPanel.js';
import { openPdfFromEndpoint } from '../../lib/print/index.js';
import { mountDetailView } from '../../lib/engine/detailEngine.js';

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
          <div>
            <h2>Etapas de Producción</h2>
            <span class="muted text-sm">Orden y días estimados propios de esta receta. Click en celda para editar o completá la fila inferior.</span>
          </div>
        </div>
        <div id="receta-etapas-sheet"></div>
      </div>
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
        <div id="receta-insumos-sheet"></div>
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

        const etapasSheetHost = container.querySelector('#receta-etapas-sheet');
        if (etapasSheetHost) {
          const tallerMap = new Map(talleres.map(t => [String(t.id), t.nombre]));
          const cuentaMap = new Map(cuentasEgreso.map(c => [String(c.id), `${c.codigo} · ${c.nombre}`]));
          const etapaNameMap = new Map(etapas.map(e => [String(e.id), e.nombre]));

          renderSpreadsheetTable(etapasSheetHost, {
            rows: etapas,
            emptyText: 'No hay etapas configuradas.',
            compact: true,
            defaultNewRow: () => ({
              orden: (etapas[etapas.length - 1]?.orden || 0) + 1,
              nombre: '',
              descripcion: '',
              dias_estimados: 1,
              costo_unidad: 0,
              taller_id: '',
              plan_cuenta_id: '',
              depende_de_id: '',
              imagen_data: '',
            }),
            onCreateRow: async ({ row }) => {
              if (!String(row.nombre || '').trim()) return false;
              try {
                await api(`/api/recetas/${id}/etapas`, {
                  method: 'POST',
                  body: JSON.stringify({
                    orden: Number(row.orden) || 1,
                    nombre: String(row.nombre).trim(),
                    descripcion: row.descripcion || '',
                    dias_estimados: Number(row.dias_estimados) || 1,
                    costo_unidad: Number(row.costo_unidad) || 0,
                    taller_id: row.taller_id ? Number(row.taller_id) : null,
                    plan_cuenta_id: row.plan_cuenta_id ? Number(row.plan_cuenta_id) : null,
                    depende_de_id: row.depende_de_id ? Number(row.depende_de_id) : null,
                  }),
                });
                toast('Etapa agregada a la receta');
                await renderRecetaDetalleView({ id });
                return false;
              } catch (err) {
                toast(err.message, true);
                throw err;
              }
            },
            columns: [
              {
                key: 'orden',
                label: 'Orden',
                type: 'number',
                min: 1,
                align: 'right',
                parse: v => Number(v) || 1,
              },
              {
                key: 'nombre',
                label: 'Etapa',
                type: 'text',
                parse: v => String(v || '').trim(),
                render: et => (et.nombre ? `<strong>${esc(et.nombre)}</strong>` : '<span class="muted">Nueva etapa...</span>'),
              },
              {
                key: 'descripcion',
                label: 'Descripción',
                type: 'text',
                parse: v => String(v || '').trim(),
                render: et => (et.descripcion ? esc(et.descripcion) : '<span class="muted">Sin descripción</span>'),
              },
              {
                key: 'dias_estimados',
                label: 'Días Est.',
                type: 'number',
                min: 1,
                align: 'right',
                parse: v => Math.max(1, Number(v) || 1),
              },
              {
                key: 'costo_unidad',
                label: 'Costo / u ($)',
                type: 'number',
                min: 0,
                step: 0.01,
                align: 'right',
                parse: v => Math.max(0, Number(v) || 0),
                render: et => fmtMoney(et.costo_unidad || 0),
              },
              {
                key: 'taller_id',
                label: 'Taller',
                type: 'select',
                options: [{ value: '', label: '-- Sin taller --' }, ...talleres.map(t => ({ value: String(t.id), label: t.nombre }))],
                getValue: et => (et.taller_id ? String(et.taller_id) : ''),
                parse: v => (v ? Number(v) : null),
                render: et => (et.taller_id ? esc(tallerMap.get(String(et.taller_id)) || '-') : '<span class="muted">-- Sin taller --</span>'),
              },
              {
                key: 'plan_cuenta_id',
                label: 'Cuenta Contable',
                type: 'select',
                options: [{ value: '', label: '-- Por defecto --' }, ...cuentasEgreso.map(c => ({ value: String(c.id), label: `${c.codigo} · ${c.nombre}` }))],
                getValue: et => (et.plan_cuenta_id ? String(et.plan_cuenta_id) : ''),
                parse: v => (v ? Number(v) : null),
                render: et => (et.plan_cuenta_id ? esc(cuentaMap.get(String(et.plan_cuenta_id)) || '-') : '<span class="muted">-- Por defecto --</span>'),
              },
              {
                key: 'depende_de_id',
                label: 'Depende de',
                type: 'select',
                options: et => [
                  { value: '', label: '-- Ninguna --' },
                  ...etapas.filter(o => o.id !== et.id).map(o => ({ value: String(o.id), label: o.nombre })),
                ],
                getValue: et => (et.depende_de_id ? String(et.depende_de_id) : ''),
                parse: v => (v ? Number(v) : null),
                render: et => (et.depende_de_id ? esc(etapaNameMap.get(String(et.depende_de_id)) || '-') : '<span class="muted">-- Ninguna --</span>'),
              },
              {
                key: 'imagen_data',
                label: 'Imagen',
                editable: () => false,
                render: et => (et.__isNew
                  ? '<span class="muted text-xs">-</span>'
                  : `<div class="sx-c59ad0" data-receta-etapa-row="${et.id}">
                      <img src="${esc(et.imagen_data || '')}" class="img-thumb et-img-prev ${et.imagen_data ? '' : 'hidden'} sx-4684e7" alt="Etapa" />
                      <label class="btn btn-sm sx-b76a9b">
                        Foto
                        <input type="file" class="et-img-file sx-cb4589" data-et-id="${et.id}" accept="image/jpeg,image/png,image/webp" />
                      </label>
                      <button type="button" class="btn btn-sm btn-danger et-img-clear ${et.imagen_data ? '' : 'hidden'}" data-et-id="${et.id}" title="Quitar foto">×</button>
                    </div>`),
              },
            ],
            onCellChange: async ({ row, key, value }) => {
              try {
                await api(`/api/receta-etapas/${row.id}`, {
                  method: 'PUT',
                  body: JSON.stringify({
                    orden: key === 'orden' ? Number(value) : (Number(row.orden) || 1),
                    nombre: key === 'nombre' ? String(value).trim() : row.nombre,
                    descripcion: key === 'descripcion' ? value : (row.descripcion || ''),
                    dias_estimados: key === 'dias_estimados' ? Number(value) : (Number(row.dias_estimados) || 1),
                    costo_unidad: key === 'costo_unidad' ? Number(value) : (Number(row.costo_unidad) || 0),
                    taller_id: key === 'taller_id' ? (value ? Number(value) : null) : (row.taller_id ? Number(row.taller_id) : null),
                    plan_cuenta_id: key === 'plan_cuenta_id' ? (value ? Number(value) : null) : (row.plan_cuenta_id ? Number(row.plan_cuenta_id) : null),
                    depende_de_id: key === 'depende_de_id' ? (value ? Number(value) : null) : (row.depende_de_id ? Number(row.depende_de_id) : null),
                    imagen_data: row.imagen_data || '',
                  }),
                });
                toast('Etapa actualizada');
              } catch (err) {
                toast(err.message, true);
                throw err;
              }
            },
            onDeleteRow: async (et) => {
              if (!(await showConfirmModal('¿Eliminar esta etapa de la receta?'))) return;
              try {
                await api(`/api/receta-etapas/${et.id}`, { method: 'DELETE' });
                toast('Etapa eliminada');
                await renderRecetaDetalleView({ id });
              } catch (err) {
                toast(err.message, true);
              }
            },
          });
        }

        const sheetHost = container.querySelector('#receta-insumos-sheet');
        if (sheetHost) {
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
              {
                key: 'costo_par',
                label: 'Costo / u.',
                align: 'right',
                editable: () => false,
                render: (l) => (l.__isNew ? '<span class="muted">-</span>' : `<strong>${fmtMoney(l.costo_par || 0)}</strong>`),
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

        container.querySelectorAll('.et-img-file').forEach(inp => {
          inp.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            const etId = inp.dataset.etId;
            if (!file || !etId) return;
            try {
              const dataUrl = await compressImageToDataUrl(file);
              await api(`/api/receta-etapas/${etId}`, {
                method: 'PUT',
                body: JSON.stringify({ imagen_data: dataUrl }),
              });
              toast('Imagen de etapa guardada');
              await renderRecetaDetalleView({ id });
            } catch (err) { toast(err.message, true); }
          });
        });
        container.querySelectorAll('.et-img-clear').forEach(btn => {
          btn.addEventListener('click', async () => {
            const etId = btn.dataset.etId;
            if (!etId) return;
            try {
              await api(`/api/receta-etapas/${etId}`, {
                method: 'PUT',
                body: JSON.stringify({ imagen_data: '' }),
              });
              toast('Imagen quitada');
              await renderRecetaDetalleView({ id });
            } catch (err) { toast(err.message, true); }
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
      },
    });
  };

  render();
}
