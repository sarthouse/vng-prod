import { api, toast } from '../../lib/api.js';
import { esc, fmtMoney, fmtNum } from '../../lib/format.js';
import { mountPageView } from '../../lib/engine/index.js';

export async function renderCondicionesComercialesView() {
  const root = document.getElementById('app-view');
  const [cuentas, productos, plantillas] = await Promise.all([
    api('/api/tesoreria/cuentas').catch(() => []),
    api('/api/productos').catch(() => []),
    api('/api/plantillas').catch(() => []),
  ]);

  let selectedListaId = null;

  async function loadAndRender() {
    const [terminos, metodos, listas] = await Promise.all([
      api('/api/terminos-pago'),
      api('/api/metodos-pago'),
      api('/api/listas-precios'),
    ]);
    if (!selectedListaId && listas.length) selectedListaId = listas[0].id;
    const listaDet = selectedListaId
      ? await api(`/api/listas-precios/${selectedListaId}`).catch(() => null)
      : null;

    const terminosHtml = `
      <div class="card">
        <div class="card-header">
          <div>
            <h2>Términos de Pago</h2>
            <span class="muted" style="font-size:0.82rem;">Plazos de vencimiento asignables a clientes, proveedores y comprobantes.</span>
          </div>
        </div>
        <form id="form-tp" class="form-grid">
          <label><span>Nombre *</span><input type="text" name="nombre" required placeholder="Ej: 45 días" /></label>
          <label><span>Días de vencimiento *</span><input type="number" name="dias" min="0" step="1" value="30" required /></label>
          <label><span>Descripción</span><input type="text" name="descripcion" placeholder="Opcional" /></label>
          <div class="actions" style="align-self:end;">
            <button type="submit" class="btn btn-primary">+ Agregar Término</button>
          </div>
        </form>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Nombre</th><th class="num">Días</th><th>Descripción</th><th>Estado</th><th>Acciones</th></tr></thead>
            <tbody>
              ${terminos.map(t => `
                <tr>
                  <td><strong>${esc(t.nombre)}</strong></td>
                  <td class="num">${t.dias} días</td>
                  <td class="muted">${esc(t.descripcion || '-')}</td>
                  <td><span class="badge ${t.activo ? 'badge-ok' : 'badge-muted'}">${t.activo ? 'Activo' : 'Inactivo'}</span></td>
                  <td>
                    <div class="actions">
                      <button type="button" class="btn btn-sm btn-tp-toggle" data-id="${t.id}" data-activo="${t.activo ? 1 : 0}">${t.activo ? 'Desactivar' : 'Activar'}</button>
                      <button type="button" class="btn btn-sm btn-danger btn-tp-del" data-id="${t.id}">Eliminar</button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const metodosHtml = `
      <div class="card">
        <div class="card-header">
          <div>
            <h2>Métodos de Pago</h2>
            <span class="muted" style="font-size:0.82rem;">Medios de cobro y pago vinculados a las cuentas de tesorería.</span>
          </div>
        </div>
        <form id="form-mp" class="form-grid">
          <label><span>Nombre *</span><input type="text" name="nombre" required placeholder="Ej: Transferencia Galicia" /></label>
          <label>
            <span>Tipo *</span>
            <select name="tipo">
              <option value="efectivo">Efectivo</option>
              <option value="banco" selected>Banco / Transferencia / Tarjeta</option>
              <option value="cheque">Cheque</option>
              <option value="digital">Billetera Digital (MP / QR)</option>
              <option value="otro">Otro</option>
            </select>
          </label>
          <label>
            <span>Cuenta Tesorería por Defecto</span>
            <select name="cuenta_id">
              <option value="">-- Sin cuenta fija --</option>
              ${(cuentas || []).map(c => `<option value="${c.id}">${esc(c.nombre)} (${esc(c.tipo)})</option>`).join('')}
            </select>
          </label>
          <label class="checkbox-inline" style="align-self:end;">
            <input type="checkbox" name="requiere_referencia" checked />
            <span>Requiere Nro. Referencia</span>
          </label>
          <div class="actions" style="align-self:end;">
            <button type="submit" class="btn btn-primary">+ Agregar Método</button>
          </div>
        </form>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Nombre</th><th>Tipo</th><th>Cuenta por defecto</th><th>Referencia</th><th>Estado</th><th>Acciones</th></tr></thead>
            <tbody>
              ${metodos.map(m => `
                <tr>
                  <td><strong>${esc(m.nombre)}</strong></td>
                  <td>${esc(m.tipo)}</td>
                  <td class="muted">${esc(m.cuenta_nombre || '-')}</td>
                  <td>${m.requiere_referencia ? 'Sí' : 'No'}</td>
                  <td><span class="badge ${m.activo ? 'badge-ok' : 'badge-muted'}">${m.activo ? 'Activo' : 'Inactivo'}</span></td>
                  <td>
                    <div class="actions">
                      <button type="button" class="btn btn-sm btn-mp-toggle" data-id="${m.id}" data-activo="${m.activo ? 1 : 0}">${m.activo ? 'Desactivar' : 'Activar'}</button>
                      <button type="button" class="btn btn-sm btn-danger btn-mp-del" data-id="${m.id}">Eliminar</button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const listasHtml = `
      <div class="card">
        <div class="card-header">
          <div>
            <h2>Listas de Precios</h2>
            <span class="muted" style="font-size:0.82rem;">Tarifarios generales y reglas por volumen, plantilla o variante.</span>
          </div>
        </div>
        <form id="form-lp" class="form-grid">
          <label><span>Nombre Lista *</span><input type="text" name="nombre" required placeholder="Ej: Lista Distribuidores" /></label>
          <label>
            <span>Moneda</span>
            <select name="moneda">
              <option value="ARS">ARS</option>
              <option value="USD">USD</option>
            </select>
          </label>
          <label><span>Descuento Global (%)</span><input type="number" step="0.01" name="descuento_pct" value="0" /></label>
          <label><span>Recargo Global (%)</span><input type="number" step="0.01" name="recargo_pct" value="0" /></label>
          <label class="checkbox-inline" style="align-self:end;">
            <input type="checkbox" name="es_default" />
            <span>Lista por defecto</span>
          </label>
          <div class="actions" style="align-self:end;">
            <button type="submit" class="btn btn-primary">+ Crear Lista</button>
          </div>
        </form>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Nombre</th><th>Moneda</th><th class="num">Dto. Global</th><th class="num">Recargo</th><th class="num">Reglas</th><th>Default</th><th>Acciones</th></tr></thead>
            <tbody>
              ${listas.map(l => `
                <tr class="${Number(l.id) === Number(selectedListaId) ? 'row-selected' : ''}">
                  <td><strong>${esc(l.nombre)}</strong></td>
                  <td>${esc(l.moneda)}</td>
                  <td class="num">${fmtNum(l.descuento_pct)}%</td>
                  <td class="num">${fmtNum(l.recargo_pct)}%</td>
                  <td class="num">${l.cantidad_items || 0}</td>
                  <td>${l.es_default ? '<span class="badge badge-ok">Por defecto</span>' : '-'}</td>
                  <td>
                    <div class="actions">
                      <button type="button" class="btn btn-sm btn-lp-select" data-id="${l.id}">Ver / Editar Reglas</button>
                      <button type="button" class="btn btn-sm btn-danger btn-lp-del" data-id="${l.id}">Eliminar</button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      ${listaDet ? `
        <div class="card">
          <div class="card-header">
            <div>
              <h2>Reglas específicas de: ${esc(listaDet.nombre)}</h2>
              <span class="muted" style="font-size:0.82rem;">Tienen prioridad sobre el descuento/recargo global de la lista.</span>
            </div>
          </div>
          <form id="form-lp-item" class="form-grid">
            <label>
              <span>Producto (variante)</span>
              <select name="producto_id">
                <option value="">-- O aplicar por plantilla --</option>
                ${(productos || []).map(p => `<option value="${p.id}">${esc(p.nombre)}${p.sku ? ` [${esc(p.sku)}]` : ''} (${fmtMoney(p.precio)})</option>`).join('')}
              </select>
            </label>
            <label>
              <span>Plantilla (todos los talles/colores)</span>
              <select name="plantilla_id">
                <option value="">-- Ninguna --</option>
                ${(plantillas || []).map(pt => `<option value="${pt.id}">${esc(pt.nombre)}</option>`).join('')}
              </select>
            </label>
            <label><span>Precio Fijo (opcional)</span><input type="number" step="0.01" min="0" name="precio_fijo" placeholder="Dejar vacío para usar %" /></label>
            <label><span>Descuento (%)</span><input type="number" step="0.01" name="descuento_pct" value="0" /></label>
            <label><span>Cant. Mínima</span><input type="number" step="1" min="1" name="cantidad_minima" value="1" /></label>
            <div class="actions" style="align-self:end;">
              <button type="submit" class="btn btn-primary">+ Agregar Regla</button>
            </div>
          </form>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Alcance</th><th class="num">Catálogo</th><th class="num">Precio Fijo</th><th class="num">Dto. %</th><th class="num">Cant. Mín.</th><th></th></tr></thead>
              <tbody>
                ${(listaDet.items || []).length === 0
                  ? '<tr><td colspan="6" class="muted">Sin reglas específicas (aplica descuento/recargo global).</td></tr>'
                  : listaDet.items.map(it => `
                    <tr>
                      <td>${it.producto_id ? `Producto: <strong>${esc(it.producto_nombre)}</strong>` : `Plantilla: <strong>${esc(it.plantilla_nombre)}</strong>`}</td>
                      <td class="num muted">${it.producto_id ? fmtMoney(it.precio_catalogo) : '-'}</td>
                      <td class="num">${it.precio_fijo !== null && it.precio_fijo !== undefined ? `<strong>${fmtMoney(it.precio_fijo)}</strong>` : '-'}</td>
                      <td class="num">${fmtNum(it.descuento_pct)}%</td>
                      <td class="num">${fmtNum(it.cantidad_minima)}</td>
                      <td><button type="button" class="btn btn-sm btn-danger btn-lp-item-del" data-id="${it.id}">Quitar</button></td>
                    </tr>
                  `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : ''}
    `;

    mountPageView(root, {
      title: 'Condiciones',
      subtitle: 'Términos de pago, métodos de pago y listas de precios asignables a contactos y comprobantes.',
      tabs: [
        { id: 'terminos', label: 'Términos de Pago', badge: terminos.length, html: terminosHtml },
        { id: 'metodos', label: 'Métodos de Pago', badge: metodos.length, html: metodosHtml },
        { id: 'listas', label: 'Listas de Precios', badge: listas.length, html: listasHtml },
      ],
      onAfterMount: () => {
        root.querySelector('#form-tp')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          try {
            await api('/api/terminos-pago', {
              method: 'POST',
              body: { nombre: fd.get('nombre'), dias: Number(fd.get('dias') || 0), descripcion: fd.get('descripcion') },
            });
            toast('Término de pago creado');
            await loadAndRender();
          } catch (err) { toast(err.message, true); }
        });
        root.querySelectorAll('.btn-tp-toggle').forEach(b => b.addEventListener('click', async () => {
          await api(`/api/terminos-pago/${b.dataset.id}`, { method: 'PUT', body: { activo: b.dataset.activo !== '1' } });
          await loadAndRender();
        }));
        root.querySelectorAll('.btn-tp-del').forEach(b => b.addEventListener('click', async () => {
          await api(`/api/terminos-pago/${b.dataset.id}`, { method: 'DELETE' });
          toast('Término eliminado');
          await loadAndRender();
        }));

        root.querySelector('#form-mp')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          try {
            await api('/api/metodos-pago', {
              method: 'POST',
              body: {
                nombre: fd.get('nombre'),
                tipo: fd.get('tipo'),
                cuenta_id: fd.get('cuenta_id') || null,
                requiere_referencia: fd.get('requiere_referencia') === 'on',
              },
            });
            toast('Método de pago creado');
            await loadAndRender();
          } catch (err) { toast(err.message, true); }
        });
        root.querySelectorAll('.btn-mp-toggle').forEach(b => b.addEventListener('click', async () => {
          await api(`/api/metodos-pago/${b.dataset.id}`, { method: 'PUT', body: { activo: b.dataset.activo !== '1' } });
          await loadAndRender();
        }));
        root.querySelectorAll('.btn-mp-del').forEach(b => b.addEventListener('click', async () => {
          await api(`/api/metodos-pago/${b.dataset.id}`, { method: 'DELETE' });
          toast('Método eliminado');
          await loadAndRender();
        }));

        root.querySelector('#form-lp')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          try {
            const res = await api('/api/listas-precios', {
              method: 'POST',
              body: {
                nombre: fd.get('nombre'),
                moneda: fd.get('moneda'),
                descuento_pct: Number(fd.get('descuento_pct') || 0),
                recargo_pct: Number(fd.get('recargo_pct') || 0),
                es_default: fd.get('es_default') === 'on',
              },
            });
            selectedListaId = res.id;
            toast('Lista de precios creada');
            await loadAndRender();
          } catch (err) { toast(err.message, true); }
        });
        root.querySelectorAll('.btn-lp-select').forEach(b => b.addEventListener('click', () => {
          selectedListaId = Number(b.dataset.id);
          loadAndRender();
        }));
        root.querySelectorAll('.btn-lp-del').forEach(b => b.addEventListener('click', async () => {
          await api(`/api/listas-precios/${b.dataset.id}`, { method: 'DELETE' });
          if (Number(selectedListaId) === Number(b.dataset.id)) selectedListaId = null;
          toast('Lista eliminada');
          await loadAndRender();
        }));
        root.querySelector('#form-lp-item')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          try {
            await api(`/api/listas-precios/${selectedListaId}/items`, {
              method: 'POST',
              body: {
                producto_id: fd.get('producto_id') || null,
                plantilla_id: fd.get('plantilla_id') || null,
                precio_fijo: fd.get('precio_fijo') || null,
                descuento_pct: Number(fd.get('descuento_pct') || 0),
                cantidad_minima: Number(fd.get('cantidad_minima') || 1),
              },
            });
            toast('Regla agregada');
            await loadAndRender();
          } catch (err) { toast(err.message, true); }
        });
        root.querySelectorAll('.btn-lp-item-del').forEach(b => b.addEventListener('click', async () => {
          await api(`/api/listas-precios/items/${b.dataset.id}`, { method: 'DELETE' });
          await loadAndRender();
        }));
      },
    });
  }

  await loadAndRender();
}
