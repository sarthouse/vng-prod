import { api, toast, refreshKPIs } from '../../lib/api.js';
import { esc } from '../../lib/format.js';
import { navigate } from '../../router.js';

export async function renderEntregaFormView({ id } = {}) {
  const root = document.getElementById('app-view');
  const isEdit = Boolean(id);
  const params = new URLSearchParams(window.location.search);
  const preLote = params.get('lote') || '';

  const [pedidos, productos, existing] = await Promise.all([
    api('/api/pedidos'),
    api('/api/productos'),
    isEdit ? api(`/api/entregas/${id}`) : Promise.resolve(null),
  ]);

  const entrega = existing || {
    lote: preLote || (pedidos[0]?.pedido ?? ''),
    fecha: new Date().toISOString().slice(0, 10),
    observaciones: '',
    lineas: [],
  };

  const qtyMap = new Map((entrega.lineas || []).map(l => [Number(l.producto_id), Number(l.cantidad || 0)]));
  let selectedLote = String(entrega.lote || '');

  const render = () => {
    const ped = pedidos.find(p => String(p.pedido) === String(selectedLote));
    const variantes = ped
      ? productos.filter(pr => Number(pr.plantilla_id) === Number(ped.plantilla_id))
      : [];

    root.innerHTML = `
      <div class="page-header">
        <div>
          <div style="margin-bottom:6px;">
            <a href="/entregas" data-link class="muted" style="font-size:0.85rem;">← Volver a Entregas</a>
          </div>
          <h1>${isEdit ? `Editar Entrega #${entrega.nro_entrega}` : 'Registrar Nueva Entrega'}</h1>
          <p class="muted">Al guardar se recalculan automáticamente los pendientes y el estado del pedido.</p>
        </div>
      </div>

      <div class="card">
        <form id="form-entrega" class="form-grid">
          <label>
            <span>Pedido / Lote *</span>
            <select name="lote" id="entrega-lote-select" required>
              <option value="">-- Seleccionar pedido --</option>
              ${pedidos.map(p => `
                <option value="${p.pedido}" ${String(p.pedido) === String(selectedLote) ? 'selected' : ''}>
                  #${p.pedido} — ${esc(p.plantilla_nombre)} (${p.cantidad} u. · ${esc(p.estado)})
                </option>
              `).join('')}
            </select>
          </label>

          <label>
            <span>Fecha de Entrega *</span>
            <input type="date" name="fecha" required value="${esc(entrega.fecha || '')}" />
          </label>

          <div class="full">
            <span style="display:block; font-size:0.82rem; font-weight:600; color:var(--color-secondary); margin-bottom:6px;">
              Cantidades Entregadas por Variante
            </span>
            <div class="sizes-grid">
              ${variantes.length
                ? variantes.map(v => `
                    <label class="size-box">
                      <span title="${esc(v.nombre)}">${esc(v.combinacion || v.sku || v.nombre)}</span>
                      <input type="number" min="0" class="entrega-var-qty" data-producto-id="${v.id}" value="${qtyMap.get(v.id) || 0}" />
                    </label>
                  `).join('')
                : `<div class="muted">Seleccioná un pedido para cargar sus variantes.</div>`
              }
            </div>
          </div>

          <label class="full">
            <span>Observaciones</span>
            <textarea name="observaciones" rows="2" placeholder="Observaciones de la entrega...">${esc(entrega.observaciones || '')}</textarea>
          </label>

          <div class="full modal-footer">
            <a href="/entregas" data-link class="btn">Cancelar</a>
            <button type="submit" class="btn btn-primary">${isEdit ? 'Guardar Cambios' : 'Registrar Entrega'}</button>
          </div>
        </form>
      </div>
    `;

    root.querySelector('#entrega-lote-select').addEventListener('change', (e) => {
      selectedLote = e.target.value;
      render();
    });

    root.querySelector('#form-entrega').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const lineas = Array.from(root.querySelectorAll('.entrega-var-qty'))
        .map(inp => ({ producto_id: Number(inp.dataset.productoId), cantidad: Number(inp.value) || 0 }))
        .filter(l => l.cantidad > 0);

      const payload = {
        lote: Number(fd.get('lote')),
        fecha: fd.get('fecha'),
        observaciones: fd.get('observaciones') || '',
        lineas,
      };

      try {
        if (isEdit) {
          await api(`/api/entregas/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
          toast('Entrega actualizada');
        } else {
          await api('/api/entregas', { method: 'POST', body: JSON.stringify(payload) });
          toast('Entrega registrada');
        }
        await refreshKPIs();
        navigate('/entregas');
      } catch (err) {
        toast(err.message, true);
      }
    });
  };

  render();
}
