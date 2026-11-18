import { api, toast } from '../../lib/api.js';
import { esc } from '../../lib/format.js';
import { renderHierarchyTree, renderViewSwitcher, renderSpreadsheetTable } from '../../lib/engine/index.js';
import { showConfirmModal } from '../../lib/engine/index.js';

let catViewMode = 'lista';

export async function renderCategoriasView() {
  const root = document.getElementById('app-view');
  const config = await api('/api/config');
  const categorias = config.categorias || [];

  root.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Categorías</h1>
        <p class="muted">Organizá tus productos en categorías y subcategorías jerárquicas.</p>
      </div>
      <div class="actions">
        <div id="cat-view-switch"></div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2>Categorías</h2>
      </div>
      <form id="form-add-cat" class="toolbar sx-410c97">
        <input type="text" name="nombre" required placeholder="Nueva categoría" class="mw-220" />
        <select name="padre_id" class="mw-190">
          <option value="">Sin categoría padre</option>
          ${categorias.map(p => `<option value="${p.id}">${esc(p.display_name || (p.padre_nombre ? `${p.padre_nombre} / ${p.nombre}` : p.nombre))}</option>`).join('')}
        </select>
        <input type="text" name="descripcion" placeholder="Descripción" class="sx-aca4d0" />
        <button type="submit" class="btn btn-primary">+ Agregar Categoría</button>
      </form>
      <div id="cat-list-container"></div>
    </div>
  `;

  const renderCatBody = () => {
    renderViewSwitcher(root.querySelector('#cat-view-switch'), {
      active: catViewMode,
      modes: [
        { id: 'lista', label: 'Lista Editable' },
        { id: 'arbol', label: 'Árbol Jerárquico' },
      ],
      onChange: (mode) => {
        catViewMode = mode;
        renderCatBody();
      },
    });

    const container = root.querySelector('#cat-list-container');
    if (catViewMode === 'arbol') {
      renderHierarchyTree(container, {
        rows: categorias,
        idKey: 'id',
        parentKey: 'padre_id',
        emptyText: 'No hay categorías cargadas.',
        renderNode: (c) => `
          <div>
            <strong>${esc(c.nombre)}</strong>
            ${c.descripcion ? `<span class="muted sx-04a5ff">— ${esc(c.descripcion)}</span>` : ''}
          </div>
        `,
      });
      return;
    }

    renderSpreadsheetTable(container, {
      rows: categorias,
      emptyText: 'No hay categorías cargadas.',
      compact: true,
      columns: [
        { key: 'nombre', label: 'Nombre', type: 'text', parse: (v) => String(v || '').trim() },
        {
          key: 'padre_id',
          label: 'Categoría Padre',
          type: 'select',
          options: (c) => [
            { value: '', label: '-- Ninguna --' },
            ...categorias.filter(p => p.id !== c.id).map(p => ({
              value: String(p.id),
              label: p.display_name || (p.padre_nombre ? `${p.padre_nombre} / ${p.nombre}` : p.nombre),
            })),
          ],
          getValue: (c) => (c.padre_id ? String(c.padre_id) : ''),
          parse: (v) => (v ? Number(v) : null),
          render: (c) => esc(c.padre_nombre || '-- Ninguna --'),
        },
        {
          key: 'descripcion',
          label: 'Descripción',
          type: 'text',
          render: (c) => c.descripcion ? esc(c.descripcion) : '<span class="muted">Sin descripción</span>',
        },
      ],
      onDeleteRow: async (c) => {
        if (!(await showConfirmModal('¿Eliminar esta categoría?'))) return;
        try {
          await api(`/api/categorias/${c.id}`, { method: 'DELETE' });
          toast('Categoría eliminada');
          await renderCategoriasView();
        } catch (err) {
          toast(err.message, true);
        }
      },
      onCellChange: async ({ row, key, value }) => {
        try {
          await api(`/api/categorias/${row.id}`, {
            method: 'PUT',
            body: JSON.stringify({
              nombre: key === 'nombre' ? value : row.nombre,
              padre_id: key === 'padre_id' ? value : (row.padre_id || null),
              descripcion: key === 'descripcion' ? value : (row.descripcion || ''),
            }),
          });
          toast('Categoría actualizada');
        } catch (err) {
          toast(err.message, true);
          throw err;
        }
      },
    });
  };

  renderCatBody();

  root.querySelector('#form-add-cat').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/categorias', {
        method: 'POST',
        body: JSON.stringify({
          nombre: fd.get('nombre'),
          padre_id: fd.get('padre_id') || null,
          descripcion: fd.get('descripcion') || '',
        }),
      });
      toast('Categoría agregada');
      await renderCategoriasView();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

export async function renderVariantesView() {
  const root = document.getElementById('app-view');
  const config = await api('/api/config');
  const variantes = config.variantes || [];

  const attrGroups = new Map();
  for (const v of variantes) {
    if (!attrGroups.has(v.atributo)) attrGroups.set(v.atributo, []);
    attrGroups.get(v.atributo).push(v);
  }

  root.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Variantes</h1>
        <p class="muted">Atributos y valores para clasificar productos y componentes.</p>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div>
          <h2>Variantes</h2>
        </div>
        <button type="button" id="btn-seed-talles" class="btn btn-sm">Generar Talles 35–45</button>
      </div>
      <form id="form-add-var" class="toolbar mb-lg">
        <input type="text" name="atributo" required placeholder="Nuevo Atributo" />
        <input type="text" name="valor" required placeholder="Primer Valor" />
        <button type="submit" class="btn btn-primary">+ Agregar Atributo / Valor</button>
      </form>
      ${attrGroups.size === 0 ? `
        <div class="empty-state">No hay variantes configuradas. Podés generar los talles 35–45 con un clic o agregar un atributo personalizado.</div>
      ` : `
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th class="sx-1dfda9">Atributo</th>
                <th>Valores</th>
                <th class="w-140">Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${Array.from(attrGroups.entries()).map(([attr, vals]) => `
                <tr>
                  <td><strong>${esc(attr)}</strong></td>
                  <td>
                    <div class="attr-badges">
                      ${vals.map(v => `
                        <span class="badge-pill">
                          <span>${esc(v.valor)}</span>
                          <button type="button" class="attr-badge-remove" title="Quitar ${esc(v.valor)}" data-del-var="${v.id}">×</button>
                        </span>
                      `).join('')}
                      <form class="inline-add-val" data-add-val-attr="${esc(attr)}">
                        <input type="text" name="valor" placeholder="+ valor" required />
                        <button type="submit" class="btn btn-sm">+</button>
                      </form>
                    </div>
                  </td>
                  <td>
                    <button type="button" class="btn btn-sm btn-danger" data-del-attr="${esc(attr)}">Eliminar Atributo</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;

  root.querySelector('#btn-seed-talles').addEventListener('click', async () => {
    try {
      await api('/api/variantes/seed-talles', { method: 'POST' });
      toast('Talles 35–45 generados');
      await renderVariantesView();
    } catch (err) {
      toast(err.message, true);
    }
  });

  root.querySelector('#form-add-var').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/variantes', {
        method: 'POST',
        body: JSON.stringify({ atributo: fd.get('atributo'), valor: fd.get('valor') }),
      });
      toast('Variante agregada');
      await renderVariantesView();
    } catch (err) {
      toast(err.message, true);
    }
  });

  root.querySelectorAll('[data-add-val-attr]').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const attr = form.dataset.addValAttr;
      const valor = form.querySelector('input[name="valor"]').value.trim();
      if (!valor) return;
      try {
        await api('/api/variantes', { method: 'POST', body: JSON.stringify({ atributo: attr, valor }) });
        toast(`Valor "${valor}" agregado a ${attr}`);
        await renderVariantesView();
      } catch (err) {
        toast(err.message, true);
      }
    });
  });

  root.querySelectorAll('[data-del-attr]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const attr = btn.dataset.delAttr;
      if (!(await showConfirmModal(`¿Eliminar todo el atributo "${attr}" y sus valores?`))) return;
      try {
        await api(`/api/variantes/atributo/${encodeURIComponent(attr)}`, { method: 'DELETE' });
        toast(`Atributo "${attr}" eliminado`);
        await renderVariantesView();
      } catch (err) {
        toast(err.message, true);
      }
    });
  });

  root.querySelectorAll('[data-del-var]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!(await showConfirmModal('¿Eliminar esta variante?'))) return;
      try {
        await api(`/api/variantes/${btn.dataset.delVar}`, { method: 'DELETE' });
        toast('Variante eliminada');
        await renderVariantesView();
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
}

export async function renderUnidadesView() {
  const root = document.getElementById('app-view');
  const config = await api('/api/config');
  const unidades = config.unidades || [];

  const uomGroups = new Map();
  for (const u of unidades) {
    const grp = (u.grupo || 'General').trim();
    if (!uomGroups.has(grp)) uomGroups.set(grp, []);
    uomGroups.get(grp).push(u);
  }

  root.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Unidades</h1>
        <p class="muted">Unidad base resaltada en azul; las demás muestran su factor de conversión.</p>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2>Unidades</h2>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th class="sx-1dfda9">Categoría</th>
              <th>Unidades y Ratios</th>
            </tr>
          </thead>
          <tbody>
            ${Array.from(uomGroups.entries()).map(([grp, list]) => {
              const sorted = [...list].sort((a, b) => (a.factor === 1 ? -1 : b.factor === 1 ? 1 : a.factor - b.factor));
              return `
                <tr>
                  <td><strong>${esc(grp)}</strong></td>
                  <td>
                    <div class="attr-badges">
                      ${sorted.map(u => {
                        const isBase = Number(u.factor) === 1;
                        return `
                          <span class="badge-pill uom ${isBase ? 'base' : ''}" title="Factor: ${u.factor}">
                            <span>${esc(u.nombre)}</span>
                            ${!isBase ? `<span class="uom-ratio">×${u.factor}</span>` : ''}
                            <button type="button" class="attr-badge-remove" title="Eliminar ${esc(u.nombre)}" data-del-udm="${u.id}">×</button>
                          </span>
                        `;
                      }).join('')}
                      <form class="inline-add-val" data-add-udm-group="${esc(grp)}">
                        <input type="text" name="nombre" placeholder="+ UdM" required class="w-85" />
                        <input type="number" step="0.000001" min="0.000001" name="factor" placeholder="Factor" value="1" required class="sx-63c269" />
                        <button type="submit" class="btn btn-sm">+</button>
                      </form>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  root.querySelectorAll('[data-add-udm-group]').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const grupo = form.dataset.addUdmGroup;
      const fd = new FormData(form);
      try {
        await api('/api/unidades', {
          method: 'POST',
          body: JSON.stringify({
            nombre: fd.get('nombre'),
            grupo,
            factor: Number(fd.get('factor')),
          }),
        });
        toast('Unidad agregada');
        await renderUnidadesView();
      } catch (err) {
        toast(err.message, true);
      }
    });
  });

  root.querySelectorAll('[data-del-udm]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!(await showConfirmModal('¿Eliminar esta unidad de medida?'))) return;
      try {
        await api(`/api/unidades/${btn.dataset.delUdm}`, { method: 'DELETE' });
        toast('Unidad eliminada');
        await renderUnidadesView();
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
}

export async function renderUbicacionesView() {
  const root = document.getElementById('app-view');
  const ubicaciones = await api('/api/ubicaciones').catch(() => []);
  const internasUbic = ubicaciones.filter(u => u.tipo === 'interna' && u.activa);

  root.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Ubicaciones</h1>
        <p class="muted">Ubicaciones internas, dedicadas y virtuales.</p>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2>Ubicaciones</h2>
      </div>
      <div class="card-body">
        <form id="form-add-ubicacion" class="form-grid">
          <label><span>Nombre *</span><input type="text" name="nombre" required placeholder="Ej: Estantería A / Depósito Taller" /></label>
          <label><span>Código</span><input type="text" name="codigo" placeholder="Opcional" /></label>
          <label>
            <span>Tipo *</span>
            <select name="tipo">
              <option value="interna">Interna</option>
              <option value="dedicada">Dedicada</option>
              <option value="virtual">Virtual</option>
            </select>
          </label>
          <label>
            <span>Ubicación Padre</span>
            <select name="parent_id">
              <option value="">-- Sin padre --</option>
              ${internasUbic.map(u => `<option value="${u.id}">${esc(u.nombre)} (${esc(u.codigo)})</option>`).join('')}
            </select>
          </label>
          <div class="self-end"><button type="submit" class="btn btn-primary">+ Agregar Ubicación</button></div>
        </form>

        <div id="ubic-sheet-host"></div>
      </div>
    </div>
  `;

  renderSpreadsheetTable(root.querySelector('#ubic-sheet-host'), {
    rows: ubicaciones,
    emptyText: 'Sin ubicaciones cargadas.',
    compact: true,
    columns: [
      { key: 'codigo', label: 'Código', type: 'readonly', nowrap: true, render: (u) => `<code>${esc(u.codigo)}</code>` },
      {
        key: 'nombre',
        label: 'Nombre',
        type: 'text',
        editable: (u) => !(u.es_sistema || u.es_default),
        render: (u) => `<strong>${esc(u.nombre)}</strong>`,
      },
      {
        key: 'tipo',
        label: 'Tipo',
        type: 'select',
        editable: (u) => !(u.es_sistema || u.es_default),
        options: [
          { value: 'interna', label: 'Interna' },
          { value: 'dedicada', label: 'Dedicada' },
          { value: 'virtual', label: 'Virtual' },
        ],
        render: (u) => u.tipo === 'virtual'
          ? '<span class="badge badge-muted">Virtual</span>'
          : (u.tipo === 'dedicada' ? '<span class="badge badge-parcial">Dedicada</span>' : '<span class="badge badge-confirmado">Interna</span>'),
      },
      { key: 'parent_nombre', label: 'Ubicación Padre', type: 'readonly', render: (u) => `<span class="muted">${esc(u.parent_nombre || '—')}</span>` },
      {
        key: 'activa',
        label: 'Activa',
        type: 'checkbox',
        align: 'center',
        editable: (u) => !(u.es_sistema || u.es_default),
      },
    ],
    extraActions: (u) => (u.es_sistema || u.es_default)
      ? '<span class="badge badge-muted">Protegida</span>'
      : `<button type="button" class="btn btn-sm btn-danger" data-del-ubic="${u.id}">Eliminar</button>`,
    onCellChange: async ({ row, key, value }) => {
      try {
        await api(`/api/ubicaciones/${row.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            nombre: key === 'nombre' ? value : row.nombre,
            tipo: key === 'tipo' ? value : row.tipo,
            activa: key === 'activa' ? Boolean(Number(value)) : Boolean(row.activa),
          }),
        });
        toast('Ubicación actualizada');
      } catch (err) {
        toast(err.message, true);
        throw err;
      }
    },
  });

  root.querySelector('#form-add-ubicacion')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/ubicaciones', {
        method: 'POST',
        body: JSON.stringify({
          nombre: fd.get('nombre'),
          codigo: fd.get('codigo'),
          tipo: fd.get('tipo'),
          parent_id: fd.get('parent_id') ? Number(fd.get('parent_id')) : null,
        }),
      });
      toast('Ubicación creada');
      await renderUbicacionesView();
    } catch (err) {
      toast(err.message, true);
    }
  });

  root.querySelectorAll('[data-toggle-ubic]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const activa = btn.dataset.activa !== '1';
      try {
        await api(`/api/ubicaciones/${btn.dataset.toggleUbic}`, {
          method: 'PUT',
          body: JSON.stringify({ activa }),
        });
        toast(activa ? 'Ubicación activada' : 'Ubicación desactivada');
        await renderUbicacionesView();
      } catch (err) {
        toast(err.message, true);
      }
    });
  });

  root.querySelectorAll('[data-del-ubic]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!(await showConfirmModal('¿Eliminar esta ubicación?'))) return;
      try {
        await api(`/api/ubicaciones/${btn.dataset.delUbic}`, { method: 'DELETE' });
        toast('Ubicación eliminada');
        await renderUbicacionesView();
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
}
