import { api, toast } from '../../lib/api.js';
import { esc, fmtMoney } from '../../lib/format.js';
import { showConfirmModal } from '../../lib/modal.js';

export async function renderComercialReglasView() {
  const root = document.getElementById('app-view');

  const draw = async () => {
    const [envios, cupones, recargos] = await Promise.all([
      api('/api/ventas/envios').catch(() => []),
      api('/api/ventas/cupones').catch(() => []),
      api('/api/ventas/recargos').catch(() => []),
    ]);

    root.innerHTML = `
      <div class="page-header">
        <div>
          <div style="margin-bottom:6px;"><a href="/ventas" data-link class="muted" style="font-size:0.85rem;">← Volver a Ventas</a></div>
          <h1>Envíos, Cupones y Recargos</h1>
          <p class="muted">Reglas comerciales que se agregan como líneas facturables (sin mover stock ni salir en remito) y mapean directo a WooCommerce.</p>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h2>Tipos de Envío</h2></div>
        <form id="form-add-envio" class="form-grid" style="margin-bottom:1rem;">
          <label><span>Nombre *</span><input type="text" name="nombre" placeholder="Ej: Correo Argentino / Moto CABA" required /></label>
          <label><span>Tarifa</span>
            <select name="tipo_tarifa">
              <option value="fijo">Precio fijo</option>
              <option value="gratis_desde">Gratis desde monto mínimo</option>
            </select>
          </label>
          <label><span>Precio Neto</span><input type="number" step="0.01" min="0" name="precio" value="0" required /></label>
          <label><span>Gratis desde ($)</span><input type="number" step="0.01" min="0" name="monto_minimo_gratis" value="0" /></label>
          <label><span>IVA %</span><input type="number" step="0.5" min="0" name="alicuota_iva" value="21" /></label>
          <div style="display:flex; align-items:flex-end;">
            <button type="submit" class="btn btn-primary btn-sm">+ Agregar Envío</button>
          </div>
        </form>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Nombre</th><th>Modalidad</th><th class="num">Precio</th><th class="num">Gratis desde</th><th class="num">IVA</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              ${envios.length === 0 ? '<tr><td colspan="7" class="muted">Sin métodos de envío cargados.</td></tr>' : envios.map(e => `
                <tr>
                  <td><strong>${esc(e.nombre)}</strong></td>
                  <td>${e.tipo_tarifa === 'gratis_desde' ? 'Gratis desde mínimo' : 'Fijo'}</td>
                  <td class="num">${fmtMoney(e.precio)}</td>
                  <td class="num">${e.tipo_tarifa === 'gratis_desde' ? fmtMoney(e.monto_minimo_gratis) : '-'}</td>
                  <td class="num">${e.alicuota_iva}%</td>
                  <td><span class="badge ${e.activo !== 0 ? 'badge-ok' : 'badge-muted'}">${e.activo !== 0 ? 'Activo' : 'Inactivo'}</span></td>
                  <td class="num">
                    <button type="button" class="btn btn-sm" data-tog-env="${e.id}" data-act="${e.activo !== 0 ? 1 : 0}">${e.activo !== 0 ? 'Desactivar' : 'Activar'}</button>
                    <button type="button" class="btn btn-sm btn-danger" data-del-env="${e.id}">Eliminar</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h2>Cupones de Descuento</h2></div>
        <form id="form-add-cupon" class="form-grid" style="margin-bottom:1rem;">
          <label><span>Código *</span><input type="text" name="codigo" placeholder="Ej: VERANO10" required style="text-transform:uppercase;" /></label>
          <label><span>Descripción</span><input type="text" name="descripcion" placeholder="Promo lanzamiento..." /></label>
          <label><span>Tipo</span>
            <select name="tipo">
              <option value="porcentaje">% Descuento</option>
              <option value="fijo">Monto fijo ($)</option>
              <option value="envio_gratis">Envío gratis</option>
            </select>
          </label>
          <label><span>Valor</span><input type="number" step="0.01" min="0" name="valor" value="10" required /></label>
          <label><span>IVA %</span><input type="number" step="0.5" min="0" name="alicuota_iva" value="21" /></label>
          <label><span>Vigencia Hasta</span><input type="date" name="vigencia_hasta" /></label>
          <label><span>Usos Máx. (0 = ilimitado)</span><input type="number" min="0" name="usos_maximos" value="0" /></label>
          <div style="display:flex; align-items:flex-end;">
            <button type="submit" class="btn btn-primary btn-sm">+ Agregar Cupón</button>
          </div>
        </form>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Código</th><th>Tipo</th><th class="num">Valor</th><th>Vigencia</th><th class="num">Usos</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              ${cupones.length === 0 ? '<tr><td colspan="7" class="muted">Sin cupones cargados.</td></tr>' : cupones.map(c => `
                <tr>
                  <td><code>${esc(c.codigo)}</code> ${c.descripcion ? `<span class="muted">${esc(c.descripcion)}</span>` : ''}</td>
                  <td>${esc(c.tipo)}</td>
                  <td class="num">${c.tipo === 'porcentaje' ? `${c.valor}%` : c.tipo === 'fijo' ? fmtMoney(c.valor) : 'Envío $0'}</td>
                  <td>${c.vigencia_hasta ? `Hasta ${esc(c.vigencia_hasta)}` : 'Sin vencimiento'}</td>
                  <td class="num">${c.usos_actuales}${c.usos_maximos > 0 ? ` / ${c.usos_maximos}` : ''}</td>
                  <td><span class="badge ${c.activo !== 0 ? 'badge-ok' : 'badge-muted'}">${c.activo !== 0 ? 'Activo' : 'Inactivo'}</span></td>
                  <td class="num">
                    <button type="button" class="btn btn-sm" data-tog-cup="${c.id}" data-act="${c.activo !== 0 ? 1 : 0}">${c.activo !== 0 ? 'Desactivar' : 'Activar'}</button>
                    <button type="button" class="btn btn-sm btn-danger" data-del-cup="${c.id}">Eliminar</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h2>Recargos Financieros / Medios de Pago</h2></div>
        <form id="form-add-recargo" class="form-grid" style="margin-bottom:1rem;">
          <label><span>Nombre *</span><input type="text" name="nombre" placeholder="Ej: Recargo 3 cuotas / MercadoPago" required /></label>
          <label><span>Tipo</span>
            <select name="tipo">
              <option value="porcentaje">% sobre neto</option>
              <option value="fijo">Monto fijo ($)</option>
            </select>
          </label>
          <label><span>Valor</span><input type="number" step="0.01" min="0" name="valor" value="0" required /></label>
          <label><span>IVA %</span><input type="number" step="0.5" min="0" name="alicuota_iva" value="21" /></label>
          <div style="display:flex; align-items:flex-end;">
            <button type="submit" class="btn btn-primary btn-sm">+ Agregar Recargo</button>
          </div>
        </form>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Nombre</th><th>Tipo</th><th class="num">Valor</th><th class="num">IVA</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              ${recargos.length === 0 ? '<tr><td colspan="6" class="muted">Sin recargos configurados.</td></tr>' : recargos.map(r => `
                <tr>
                  <td><strong>${esc(r.nombre)}</strong></td>
                  <td>${r.tipo === 'porcentaje' ? 'Porcentaje' : 'Fijo'}</td>
                  <td class="num">${r.tipo === 'porcentaje' ? `${r.valor}%` : fmtMoney(r.valor)}</td>
                  <td class="num">${r.alicuota_iva}%</td>
                  <td><span class="badge ${r.activo !== 0 ? 'badge-ok' : 'badge-muted'}">${r.activo !== 0 ? 'Activo' : 'Inactivo'}</span></td>
                  <td class="num">
                    <button type="button" class="btn btn-sm" data-tog-rec="${r.id}" data-act="${r.activo !== 0 ? 1 : 0}">${r.activo !== 0 ? 'Desactivar' : 'Activar'}</button>
                    <button type="button" class="btn btn-sm btn-danger" data-del-rec="${r.id}">Eliminar</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    root.querySelector('#form-add-envio')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api('/api/ventas/envios', {
          method: 'POST',
          body: JSON.stringify({
            nombre: fd.get('nombre'),
            tipo_tarifa: fd.get('tipo_tarifa'),
            precio: Number(fd.get('precio')) || 0,
            monto_minimo_gratis: Number(fd.get('monto_minimo_gratis')) || 0,
            alicuota_iva: Number(fd.get('alicuota_iva')) || 21,
            activo: 1,
          }),
        });
        toast('Método de envío creado');
        await draw();
      } catch (err) { toast(err.message, true); }
    });

    root.querySelector('#form-add-cupon')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api('/api/ventas/cupones', {
          method: 'POST',
          body: JSON.stringify({
            codigo: String(fd.get('codigo') || '').trim().toUpperCase(),
            descripcion: fd.get('descripcion'),
            tipo: fd.get('tipo'),
            valor: Number(fd.get('valor')) || 0,
            alicuota_iva: Number(fd.get('alicuota_iva')) || 21,
            vigencia_hasta: fd.get('vigencia_hasta') || '',
            usos_maximos: Number(fd.get('usos_maximos')) || 0,
            activo: 1,
          }),
        });
        toast('Cupón creado');
        await draw();
      } catch (err) { toast(err.message, true); }
    });

    root.querySelector('#form-add-recargo')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api('/api/ventas/recargos', {
          method: 'POST',
          body: JSON.stringify({
            nombre: fd.get('nombre'),
            tipo: fd.get('tipo'),
            valor: Number(fd.get('valor')) || 0,
            alicuota_iva: Number(fd.get('alicuota_iva')) || 21,
            activo: 1,
          }),
        });
        toast('Recargo creado');
        await draw();
      } catch (err) { toast(err.message, true); }
    });

    const bindToggleDel = (togAttr, delAttr, basePath) => {
      root.querySelectorAll(`[${togAttr}]`).forEach(btn => btn.addEventListener('click', async () => {
        const id = btn.getAttribute(togAttr);
        const activo = btn.dataset.act === '1' ? 0 : 1;
        await api(`${basePath}/${id}`, { method: 'PUT', body: JSON.stringify({ activo }) });
        await draw();
      }));
      root.querySelectorAll(`[${delAttr}]`).forEach(btn => btn.addEventListener('click', async () => {
        if (!(await showConfirmModal('¿Eliminar este registro?'))) return;
        await api(`${basePath}/${btn.getAttribute(delAttr)}`, { method: 'DELETE' });
        await draw();
      }));
    };
    bindToggleDel('data-tog-env', 'data-del-env', '/api/ventas/envios');
    bindToggleDel('data-tog-cup', 'data-del-cup', '/api/ventas/cupones');
    bindToggleDel('data-tog-rec', 'data-del-rec', '/api/ventas/recargos');
  };

  await draw();
}
