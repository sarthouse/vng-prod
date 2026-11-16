import { api, toast } from '../../lib/api.js';
import { navigate } from '../../router.js';
import { esc, fmtMoney } from '../../lib/format.js';
import { renderDataTable } from '../../lib/engine/index.js';
import { showConfirmModal } from '../../lib/engine/index.js';

export async function renderRecetasView() {
  const root = document.getElementById('app-view');
  const [recetas, plantillas] = await Promise.all([
    api('/api/recetas'),
    api('/api/plantillas?se_fabrica=1'),
  ]);

  let filterPlantilla = '';
  let search = '';

  const draw = () => {
    const filtered = recetas.filter(r => {
      if (filterPlantilla && String(r.plantilla_id) !== String(filterPlantilla)) return false;
      if (search) {
        const hay = `${r.nombre} ${r.referencia} ${r.plantilla_nombre}`.toLowerCase();
        if (!hay.includes(search.toLowerCase())) return false;
      }
      return true;
    });

    root.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Recetas</h1>
          <p class="muted">Cada producto fabricable puede tener múltiples recetas; marcá una como activa para calcular el presupuesto y la producción.</p>
        </div>
        <div class="actions">
          <a href="/recetas/nueva" data-link class="btn btn-primary">+ Nueva Receta</a>
        </div>
      </div>

      <div class="card">
        <div class="toolbar">
          <input type="search" id="rec-search" placeholder="Buscar receta o producto..." value="${esc(search)}" />
          <select id="rec-filter-plantilla">
            <option value="">Todos los productos</option>
            ${plantillas.map(p => `<option value="${p.id}" ${String(p.id) === String(filterPlantilla) ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}
          </select>
        </div>

        <div id="recetas-table-wrap"></div>
      </div>
    `;

    renderDataTable(root.querySelector('#recetas-table-wrap'), {
      rows: filtered,
      exportFilename: `recetas_${new Date().toISOString().slice(0, 10)}.csv`,
      bulkActions: [
        {
          id: 'eliminar',
          label: 'Eliminar seleccionadas',
          variant: 'danger',
          confirm: (sel) => `¿Eliminar ${sel.length} receta(s) seleccionada(s)?`,
          onClick: async (sel) => {
            let ok = 0; let errs = 0;
            for (const r of sel) {
              try { await api(`/api/recetas/${r.id}`, { method: 'DELETE' }); ok++; }
              catch { errs++; }
            }
            toast(`${ok} receta(s) eliminada(s)${errs ? `, ${errs} con error` : ''}`, errs > 0 && ok === 0);
            await renderRecetasView();
          },
        },
      ],
      emptyText: recetas.length === 0
        ? 'Todavía no hay recetas cargadas. Creá una nueva receta para definir los insumos de tus productos.'
        : 'No se encontraron recetas con ese filtro.',
      columns: [
        {
          label: 'Receta',
          render: r => `<a href="/recetas/${r.id}" data-link class="link-primary"><strong>${esc(r.nombre)}</strong></a>`,
        },
        {
          label: 'Estado',
          render: r => r.activa
            ? '<span class="badge badge-ok">Activa</span>'
            : '<span class="badge badge-muted">Borrador</span>',
        },
        {
          label: 'Producto',
          render: r => `<a href="/plantillas/${r.plantilla_id}" data-link class="link-primary"><strong>${esc(r.plantilla_nombre)}</strong></a>`,
        },
        { label: 'Referencia', render: r => esc(r.referencia || '-') },
        { label: 'Insumos', align: 'right', key: 'lineas_count' },
        {
          label: 'Costo Total / u',
          align: 'right',
          render: r => `
            <strong>${fmtMoney(r.costo_total_unidad ?? 0)}</strong>
            <div class="muted" style="font-size:0.75rem;">Mat: ${fmtMoney(r.costo_materiales ?? 0)} · Proc: ${fmtMoney(r.costo_procesos ?? 0)}</div>
          `,
        },
        {
          label: 'Acciones',
          render: r => `
            <div class="actions">
              <a href="/recetas/${r.id}" data-link class="btn btn-sm">Editar</a>
              ${!r.activa ? `<button class="btn btn-sm btn-secondary" data-activate="${r.id}">Activar</button>` : ''}
              <button class="btn btn-sm btn-danger" data-del="${r.id}">Borrar</button>
            </div>
          `,
        },
      ],
    });

    root.querySelector('#rec-search').addEventListener('input', (e) => {
      search = e.target.value;
      draw();
      const inp = root.querySelector('#rec-search');
      inp.focus();
      inp.setSelectionRange(inp.value.length, inp.value.length);
    });

    root.querySelector('#rec-filter-plantilla').addEventListener('change', (e) => {
      filterPlantilla = e.target.value;
      draw();
    });

    root.querySelectorAll('[data-activate]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await api(`/api/recetas/${btn.dataset.activate}`, {
            method: 'PUT',
            body: JSON.stringify({ activa: true }),
          });
          toast('Receta marcada como activa');
          await renderRecetasView();
        } catch (err) {
          toast(err.message, true);
        }
      });
    });

    root.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!(await showConfirmModal('¿Eliminar esta receta técnica y todas sus líneas?'))) return;
        try {
          await api(`/api/recetas/${btn.dataset.del}`, { method: 'DELETE' });
          toast('Receta eliminada');
          await renderRecetasView();
        } catch (err) {
          toast(err.message, true);
        }
      });
    });
  };

  draw();
}

export async function renderRecetaNuevaView() {
  const root = document.getElementById('app-view');
  const [plantillas, productos] = await Promise.all([
    api('/api/plantillas?se_fabrica=1'),
    api('/api/productos'),
  ]);
  const params = new URLSearchParams(window.location.search);
  const prePlantillaId = params.get('plantilla_id') || (plantillas[0]?.id ?? '');

  const buildVarOptions = (pltId) => {
    const vars = productos.filter(p => String(p.plantilla_id) === String(pltId));
    return `<option value="">Todas las variantes de la plantilla</option>` +
      vars.map(v => `<option value="${v.id}">${esc(v.nombre || v.combinacion_json)}</option>`).join('');
  };

  root.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Nueva Receta Técnica</h1>
        <p class="muted">Luego de crear la receta podrás cargarle los insumos y variantes.</p>
      </div>
      <div class="actions">
        <a href="/recetas" data-link class="btn">← Volver a Recetas</a>
      </div>
    </div>

    <div class="card">
      <form id="form-nueva-receta" class="form-grid">
        <label>
          <span>Producto *</span>
          <select name="plantilla_id" id="new-rec-plt-select" required>
            <option value="">Seleccionar producto...</option>
            ${plantillas.map(p => `<option value="${p.id}" ${String(p.id) === String(prePlantillaId) ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}
          </select>
        </label>
        <label>
          <span>Variante específica</span>
          <select name="producto_id" id="new-rec-prod-select">
            ${buildVarOptions(prePlantillaId)}
          </select>
        </label>
        <label>
          <span>Nombre de la Receta *</span>
          <input type="text" name="nombre" required placeholder="Ej: Receta Base / Invierno" />
        </label>
        <label>
          <span>Referencia / Código</span>
          <input type="text" name="referencia" placeholder="Ej: BOM-001" />
        </label>
        <label class="checkbox-field" style="align-self:end; padding-bottom:8px;">
          <input type="checkbox" name="activa" checked />
          <span>Marcar como receta activa del producto</span>
        </label>
        <label class="full">
          <span>Notas</span>
          <textarea name="notas" rows="3" placeholder="Observaciones técnicas de esta versión de receta..."></textarea>
        </label>
        <div class="full modal-footer">
          <a href="/recetas" data-link class="btn">Cancelar</a>
          <button type="submit" class="btn btn-primary">Crear y Cargar Insumos</button>
        </div>
      </form>
    </div>
  `;

  root.querySelector('#new-rec-plt-select').addEventListener('change', (e) => {
    root.querySelector('#new-rec-prod-select').innerHTML = buildVarOptions(e.target.value);
  });

  root.querySelector('#form-nueva-receta').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const res = await api('/api/recetas', {
        method: 'POST',
        body: JSON.stringify({
          plantilla_id: Number(fd.get('plantilla_id')),
          producto_id: fd.get('producto_id') ? Number(fd.get('producto_id')) : null,
          nombre: fd.get('nombre'),
          referencia: fd.get('referencia'),
          activa: fd.get('activa') === 'on',
          notas: fd.get('notas'),
        }),
      });
      toast('Receta creada');
      navigate(`/recetas/${res.id}`);
    } catch (err) {
      toast(err.message, true);
    }
  });
}
