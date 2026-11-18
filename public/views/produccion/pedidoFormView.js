import { api, toast, refreshKPIs } from '../../lib/api.js';
import { esc } from '../../lib/format.js';
import { navigate } from '../../router.js';
import { mountCombobox, quickCreateCliente } from '../../lib/autocomplete.js';
import { renderSpreadsheetTable } from '../../lib/engine/index.js';

export async function renderPedidoFormView({ id } = {}) {
  const root = document.getElementById('app-view');
  const isEdit = Boolean(id);

  const [plantillas, recetas, productos, contactos, detail] = await Promise.all([
    api('/api/plantillas?se_fabrica=1'),
    api('/api/recetas'),
    api('/api/productos'),
    api('/api/contactos?es_cliente=1'),
    isEdit ? api(`/api/pedidos/${id}`) : Promise.resolve(null),
  ]);

  const pedido = detail?.pedido || {
    plantilla_id: plantillas[0]?.id || '',
    contacto_id: '',
    fecha: new Date().toISOString().slice(0, 10),
    fecha_est: '',
    estado: 'Confirmado',
    observaciones: '',
  };

  const existingQtyMap = new Map(
    (detail?.lineas || []).map(l => [Number(l.producto_id), Number(l.cantidad || 0)])
  );

  let selectedPlantillaId = String(pedido.plantilla_id || plantillas[0]?.id || '');

  const render = () => {
    const prodRecetas = recetas.filter(r => String(r.plantilla_id) === String(selectedPlantillaId));
    const variantes = productos.filter(p => String(p.plantilla_id) === String(selectedPlantillaId));

    root.innerHTML = `
      <div class="page-header">
        <div>
          <div class="mb-xs">
            <a href="${isEdit ? `/pedidos/${id}` : '/pedidos'}" data-link class="muted text-md">← Volver</a>
          </div>
          <h1>${isEdit ? `Editar Pedido #${pedido.pedido}` : 'Nuevo Pedido de Producción'}</h1>
          <p class="muted">${isEdit ? 'Editá cantidades, fechas o estado.' : 'Al registrar el pedido se guarda un snapshot de los insumos de la receta.'}</p>
        </div>
      </div>

      <div class="card">
        <form id="form-pedido" class="form-grid">
          <label>
            <span>Producto *</span>
            <select name="plantilla_id" id="pedido-plantilla-select" required>
              <option value="">-- Seleccionar producto --</option>
              ${plantillas.map(p => `<option value="${p.id}" ${String(p.id) === String(selectedPlantillaId) ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}
            </select>
          </label>

          <label>
            <span>Cliente</span>
            <div id="pedido-cli-combo"></div>
          </label>

          ${!isEdit ? `
            <label>
              <span>Receta Técnica para Snapshot</span>
              <select name="receta_id">
                <option value="">Usar receta activa del producto</option>
                ${prodRecetas.map(r => `<option value="${r.id}" ${r.activa ? 'selected' : ''}>${esc(r.nombre)}${r.activa ? ' (Activa)' : ''}</option>`).join('')}
              </select>
            </label>
          ` : `
            <label>
              <span>Estado</span>
              <select name="estado">
                ${['Confirmado', 'En Producción', 'Entrega Parcial', 'Entregado', 'Cancelado'].map(st =>
                  `<option value="${st}" ${pedido.estado === st ? 'selected' : ''}>${st}</option>`
                ).join('')}
              </select>
            </label>
          `}

          <label>
            <span>Fecha de Pedido *</span>
            <input type="date" name="fecha" required value="${esc(pedido.fecha || '')}" />
          </label>

          <label>
            <span>Fecha Estimada de Entrega</span>
            <input type="date" name="fecha_est" value="${esc(pedido.fecha_est || '')}" />
          </label>

          <div class="full">
            <span class="sx-999b07">
              Cantidades por Variante
            </span>
            <div id="pedido-var-sheet"></div>
          </div>

          <label class="full">
            <span>Observaciones</span>
            <textarea name="observaciones" rows="2" placeholder="Observaciones del pedido...">${esc(pedido.observaciones || '')}</textarea>
          </label>

          <div class="full modal-footer">
            <a href="${isEdit ? `/pedidos/${id}` : '/pedidos'}" data-link class="btn">Cancelar</a>
            <button type="submit" class="btn btn-primary">${isEdit ? 'Guardar Cambios' : 'Registrar Pedido'}</button>
          </div>
        </form>
      </div>
    `;

    mountCombobox(root.querySelector('#pedido-cli-combo'), {
      name: 'contacto_id',
      value: pedido.contacto_id ? String(pedido.contacto_id) : '',
      placeholder: 'Buscar o crear cliente (opcional)...',
      items: contactos.map(c => ({ value: String(c.id), label: c.nombre, sublabel: c.cuit || c.localidad || '', raw: c })),
      getDetailUrl: (it) => `/contactos/${it.value}`,
      onSelect: (it) => {
        pedido.contacto_id = it ? String(it.value) : '';
      },
      onCreate: async (q) => {
        const created = await quickCreateCliente(q);
        if (created) {
          contactos.push(created.raw);
          pedido.contacto_id = created.value;
        }
        return created;
      },
    });

    const pedidoVarRows = variantes.map(v => ({
      producto_id: v.id,
      variante: v.combinacion || v.nombre || '-',
      sku: v.sku || '-',
      cantidad: existingQtyMap.get(v.id) || 0,
    }));
    const varSheetHost = root.querySelector('#pedido-var-sheet');
    if (varSheetHost) {
      renderSpreadsheetTable(varSheetHost, {
        rows: pedidoVarRows,
        emptyText: 'Este producto no tiene variantes activas.',
        compact: true,
        showDirty: false,
        columns: [
          { key: 'variante', label: 'Variante', type: 'readonly' },
          { key: 'sku', label: 'SKU', type: 'readonly', nowrap: true },
          {
            key: 'cantidad',
            label: 'Cantidad',
            type: 'number',
            min: 0,
            step: 1,
            align: 'right',
            parse: (val) => Math.max(0, Number(val) || 0),
          },
        ],
        onCellChange: () => {},
      });
    }

    root.querySelector('#pedido-plantilla-select')?.addEventListener('change', (e) => {
      selectedPlantillaId = e.target.value;
      render();
    });

    root.querySelector('#form-pedido').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const lineas = pedidoVarRows
        .map(r => ({ producto_id: Number(r.producto_id), cantidad: Number(r.cantidad) || 0 }))
        .filter(l => l.cantidad > 0);

      const payload = {
        plantilla_id: Number(fd.get('plantilla_id')),
        contacto_id: fd.get('contacto_id') ? Number(fd.get('contacto_id')) : null,
        fecha: fd.get('fecha'),
        fecha_est: fd.get('fecha_est') || null,
        estado: fd.get('estado') || 'Confirmado',
        observaciones: fd.get('observaciones') || '',
        lineas,
      };
      if (fd.get('receta_id')) payload.receta_id = Number(fd.get('receta_id'));

      try {
        if (isEdit) {
          await api(`/api/pedidos/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
          toast('Pedido actualizado');
          await refreshKPIs();
          navigate(`/pedidos/${id}`);
        } else {
          const res = await api('/api/pedidos', { method: 'POST', body: JSON.stringify(payload) });
          toast('Pedido registrado con snapshot de insumos');
          await refreshKPIs();
          navigate(`/pedidos/${res.id}`);
        }
      } catch (err) {
        toast(err.message, true);
      }
    });
  };

  render();
}
