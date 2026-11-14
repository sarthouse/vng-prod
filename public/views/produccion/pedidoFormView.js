import { api, toast, refreshKPIs } from '../../lib/api.js';
import { esc } from '../../lib/format.js';
import { navigate } from '../../router.js';

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
          <div style="margin-bottom:6px;">
            <a href="${isEdit ? `/pedidos/${id}` : '/pedidos'}" data-link class="muted" style="font-size:0.85rem;">← Volver</a>
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
            <select name="contacto_id">
              <option value="">-- Sin cliente / Stock interno --</option>
              ${contactos.map(c => `<option value="${c.id}" ${String(c.id) === String(pedido.contacto_id || '') ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}
            </select>
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
            <span style="display:block; font-size:0.82rem; font-weight:600; color:var(--color-secondary); margin-bottom:6px;">
              Cantidades por Variante
            </span>
            <div class="sizes-grid">
              ${variantes.length
                ? variantes.map(v => `
                    <label class="size-box">
                      <span title="${esc(v.nombre)}">${esc(v.combinacion || v.sku || v.nombre)}</span>
                      <input type="number" min="0" class="pedido-var-qty" data-producto-id="${v.id}" value="${existingQtyMap.get(v.id) || 0}" />
                    </label>
                  `).join('')
                : `<div class="muted">Este producto no tiene variantes activas.</div>`
              }
            </div>
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

    root.querySelector('#pedido-plantilla-select')?.addEventListener('change', (e) => {
      selectedPlantillaId = e.target.value;
      render();
    });

    root.querySelector('#form-pedido').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const lineas = Array.from(root.querySelectorAll('.pedido-var-qty'))
        .map(inp => ({ producto_id: Number(inp.dataset.productoId), cantidad: Number(inp.value) || 0 }))
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
