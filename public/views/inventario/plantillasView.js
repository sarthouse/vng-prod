import { api, toast } from '../../lib/api.js';
import { esc, fmtMoney, fmtNum, badgeForTipo, exportRowsToCSV } from '../../lib/format.js';
import { renderDataTable, renderKpiStrip } from '../../lib/engine/index.js';
import { showConfirmModal } from '../../lib/engine/index.js';

export async function renderPlantillasView() {
  const root = document.getElementById('app-view');
  const [plantillas, config] = await Promise.all([
    api('/api/plantillas'),
    api('/api/config'),
  ]);

  let filterRol = '';
  let filterTipo = '';
  let filterCat = '';
  let search = '';

  const draw = () => {
    const filtered = plantillas.filter(p => {
      if (filterRol === 'fabrica' && !p.se_fabrica) return false;
      if (filterRol === 'compra' && !p.se_compra) return false;
      if (filterRol === 'vende' && !p.se_vende) return false;
      if (filterTipo && p.tipo !== filterTipo) return false;
      if (filterCat && p.categoria !== filterCat) return false;
      if (search) {
        const q = search.toLowerCase();
        const hit = p.nombre.toLowerCase().includes(q)
          || (p.codigo || '').toLowerCase().includes(q)
          || (p.categoria || '').toLowerCase().includes(q)
          || (p.proveedor_nombre || '').toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });

    root.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Productos</h1>
          <p class="muted">Catálogo unificado de modelos fabricables, insumos, consumibles y servicios con sus variantes.</p>
        </div>
        <div class="actions">
          <button type="button" id="btn-export-productos" class="btn">Exportar CSV</button>
          <a href="/plantillas/nueva" data-link class="btn btn-primary">+ Nuevo Producto</a>
        </div>
      </div>

      <div id="pt-kpis"></div>

      <div class="card">
        <div class="toolbar">
          <div class="pill-group">
            <button type="button" class="pill ${filterRol === '' ? 'active' : ''}" data-rol="">Todos</button>
            <button type="button" class="pill ${filterRol === 'fabrica' ? 'active' : ''}" data-rol="fabrica">Fabricables</button>
            <button type="button" class="pill ${filterRol === 'compra' ? 'active' : ''}" data-rol="compra">Comprables</button>
            <button type="button" class="pill ${filterRol === 'vende' ? 'active' : ''}" data-rol="vende">Vendibles</button>
          </div>
          <select id="filter-pt-tipo">
            <option value="">Todos los tipos</option>
            <option value="almacenable" ${filterTipo === 'almacenable' ? 'selected' : ''}>Almacenable</option>
            <option value="consumible" ${filterTipo === 'consumible' ? 'selected' : ''}>Consumible</option>
            <option value="servicio" ${filterTipo === 'servicio' ? 'selected' : ''}>Servicio</option>
          </select>
          <select id="filter-pt-cat">
            <option value="">Todas las categorías</option>
            ${(config.categorias || []).map(c => {
              const lbl = c.display_name || (c.padre_nombre ? `${c.padre_nombre} / ${c.nombre}` : c.nombre);
              return `<option value="${esc(lbl)}" ${filterCat === lbl ? 'selected' : ''}>${esc(lbl)}</option>`;
            }).join('')}
          </select>
          <input type="search" id="search-pt" placeholder="Buscar por nombre, código o proveedor..." value="${esc(search)}" class="sx-aca4d0" />
        </div>

        <div id="plt-table-wrap"></div>
      </div>
    `;

    renderDataTable(root.querySelector('#plt-table-wrap'), {
      rows: filtered,
      emptyText: 'No hay plantillas que coincidan con el filtro.',
      exportFilename: `productos_${new Date().toISOString().slice(0, 10)}.csv`,
      bulkActions: [
        {
          id: 'eliminar',
          label: 'Eliminar seleccionados',
          variant: 'danger',
          confirm: (sel) => `¿Eliminar ${sel.length} producto(s) seleccionado(s)?`,
          onClick: async (sel) => {
            let ok = 0; let errs = 0;
            for (const p of sel) {
              try { await api(`/api/plantillas/${p.id}`, { method: 'DELETE' }); ok++; }
              catch { errs++; }
            }
            toast(`${ok} producto(s) eliminado(s)${errs ? `, ${errs} con error` : ''}`, errs > 0 && ok === 0);
            await renderPlantillasView();
          },
        },
      ],
      columns: [
        {
          label: 'Plantilla',
          render: p => `
            <a href="/plantillas/${p.id}" data-link class="link-primary"><strong>${esc(p.nombre)}</strong></a>
            ${p.codigo ? `<div class="muted sx-978ebc">Cód: ${esc(p.codigo)}</div>` : ''}
          `,
        },
        {
          label: 'Rol',
          render: p => `
            ${p.se_fabrica ? '<span class="badge badge-confirmado">Fabrica</span> ' : ''}
            ${p.se_compra ? '<span class="badge badge-muted">Compra</span> ' : ''}
            ${p.se_vende ? '<span class="badge badge-ok">Vende</span>' : ''}
          `,
        },
        { label: 'Tipo', render: p => badgeForTipo(p.tipo) },
        { label: 'Categoría', render: p => `<span class="badge badge-muted">${esc(p.categoria)}</span>` },
        {
          label: 'Proveedor',
          render: p => p.proveedor_id
            ? `<a href="/contactos/${p.proveedor_id}" data-link class="link-primary">${esc(p.proveedor_nombre)}</a>`
            : '<span class="muted">-</span>',
        },
        { label: 'Variantes', align: 'right', render: p => `<span class="badge badge-muted">${p.variantes_count}</span>` },
        {
          label: 'Costo',
          align: 'right',
          render: p => p.costo_min === p.costo_max
            ? fmtMoney(p.costo_min)
            : `${fmtMoney(p.costo_min)} – ${fmtMoney(p.costo_max)}`,
        },
        {
          label: 'Precio',
          align: 'right',
          render: p => p.precio_min === p.precio_max
            ? fmtMoney(p.precio_min)
            : `${fmtMoney(p.precio_min)} – ${fmtMoney(p.precio_max)}`,
        },
        {
          label: 'Margen',
          align: 'right',
          render: p => {
            const pr = Number(p.precio_min || 0);
            const ct = Number(p.costo_min || 0);
            if (pr <= 0) return '<span class="muted">-</span>';
            const pct = ((pr - ct) / pr) * 100;
            return `<span class="badge ${pct >= 20 ? 'badge-ok' : pct > 0 ? 'badge-muted' : 'badge-cancelado'}">${pct.toFixed(0)}%</span>`;
          },
        },
        {
          label: 'Stock Total',
          align: 'right',
          render: p => p.tipo === 'servicio'
            ? '<span class="muted">-</span>'
            : `<strong>${fmtNum(p.stock_total)}</strong> <span class="muted">${esc(p.udm)}</span>`,
        },
        {
          label: 'Acciones',
          render: p => `
            <div class="actions">
              <a href="/plantillas/${p.id}" data-link class="btn btn-sm">Abrir</a>
              <button type="button" class="btn btn-sm btn-danger" data-del-pt="${p.id}">Eliminar</button>
            </div>
          `,
        },
      ],
    });

    root.querySelector('#btn-export-productos').addEventListener('click', () => {
      if (!filtered.length) { toast('No hay productos para exportar', true); return; }
      exportRowsToCSV(
        ['codigo', 'nombre', 'descripcion', 'tipo', 'categoria', 'se_fabrica', 'se_compra', 'se_vende', 'requiere_lote', 'costo', 'precio', 'alicuota_iva', 'alicuota_iva_compra', 'udm', 'stock', 'stock_minimo', 'minimo_compra', 'proveedor'],
        filtered.map(p => [
          p.codigo || '', p.nombre, p.descripcion || '', p.tipo, p.categoria || '',
          p.se_fabrica ? 1 : 0, p.se_compra ? 1 : 0, p.se_vende ? 1 : 0, p.requiere_lote ? 1 : 0,
          Number(p.costo_min || 0), Number(p.precio_min || 0),
          Number(p.alicuota_iva ?? 21), Number(p.alicuota_iva_compra ?? p.alicuota_iva ?? 21),
          p.udm || '', Number(p.stock_total || 0), Number(p.stock_minimo || 0), Number(p.minimo_compra || 0),
          p.proveedor_nombre || '',
        ]),
        `productos_${new Date().toISOString().slice(0, 10)}.csv`
      );
    });

    root.querySelectorAll('[data-rol]').forEach(btn => {
      btn.addEventListener('click', () => { filterRol = btn.dataset.rol; draw(); });
    });
    root.querySelector('#filter-pt-tipo').addEventListener('change', e => { filterTipo = e.target.value; draw(); });
    root.querySelector('#filter-pt-cat').addEventListener('change', e => { filterCat = e.target.value; draw(); });
    root.querySelector('#search-pt').addEventListener('input', e => {
      search = e.target.value;
      const pos = e.target.selectionStart ?? search.length;
      draw();
      const sInput = root.querySelector('#search-pt');
      if (sInput) {
        sInput.focus();
        try { sInput.setSelectionRange(pos, pos); } catch { /* ignore */ }
      }
    });

    renderKpiStrip(root.querySelector('#pt-kpis'), [
      { label: 'Total Plantillas', value: String(plantillas.length) },
      { label: 'Fabricables', value: String(plantillas.filter(p => p.se_fabrica).length) },
      { label: 'Comprables', value: String(plantillas.filter(p => p.se_compra).length) },
      { label: 'Vendibles', value: String(plantillas.filter(p => p.se_vende).length), tone: 'success' },
    ]);

    root.querySelectorAll('[data-del-pt]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!(await showConfirmModal('¿Eliminar esta plantilla y sus variantes?'))) return;
        try {
          await api(`/api/plantillas/${btn.dataset.delPt}`, { method: 'DELETE' });
          toast('Plantilla eliminada');
          await renderPlantillasView();
        } catch (err) {
          toast(err.message, true);
        }
      });
    });
  };

  draw();
}
