import { api, toast } from '../../lib/api.js';
import { esc, fmtMoney, fmtNum } from '../../lib/format.js';
import { mountPageView, renderSpreadsheetTable } from '../../lib/engine/index.js';

export async function renderWooView() {
  const root = document.getElementById('app-view');

  const [
    config,
    pedidos,
    productos,
    clientes,
    cupones,
    descuentos,
    metodosEnvio,
    metodosPago,
    logs,
    ubicaciones,
    listas,
    diarios,
    terminos,
    localProductos,
    localMetodosPago,
    cuentas,
  ] = await Promise.all([
    api('/api/woo/config').catch(() => ({})),
    api('/api/woo/pedidos').catch(() => []),
    api('/api/woo/productos').catch(() => []),
    api('/api/woo/clientes').catch(() => []),
    api('/api/woo/cupones').catch(() => []),
    api('/api/woo/descuentos').catch(() => []),
    api('/api/woo/metodos-envio').catch(() => []),
    api('/api/woo/metodos-pago').catch(() => []),
    api('/api/woo/logs').catch(() => []),
    api('/api/ubicaciones').catch(() => []),
    api('/api/listas-precios').catch(() => []),
    api('/api/tesoreria/diarios').catch(() => []),
    api('/api/terminos-pago').catch(() => []),
    api('/api/productos').catch(() => []),
    api('/api/metodos-pago').catch(() => []),
    api('/api/tesoreria/cuentas').catch(() => []),
  ]);

  const prodOptions = [{ value: '', label: '— Sin mapear —' }].concat(
    (localProductos || []).map(p => ({ value: String(p.id), label: `${p.sku ? p.sku + ' · ' : ''}${p.nombre}` }))
  );
  const mpOptions = [{ value: '', label: '— Sin mapear —' }].concat(
    (localMetodosPago || []).map(m => ({ value: String(m.id), label: m.nombre }))
  );
  const cuentaOptions = [{ value: '', label: '— Sin mapear —' }].concat(
    (cuentas || []).map(c => ({ value: String(c.id), label: `${c.nombre}${c.tipo ? ' (' + c.tipo + ')' : ''}` }))
  );

  const pedidosHtml = `
    <div class="card">
      <div class="card-header">
        <div>
          <h2>Pedidos WooCommerce</h2>
          <span class="muted text-sm">Espejo de pedidos recibidos por polling saliente e importación manual, vinculados a Ventas y Cobros.</span>
        </div>
        <div class="actions">
          <button type="button" class="btn btn-secondary" id="woo-btn-polling">Ejecutar Polling Ahora</button>
          <button type="button" class="btn btn-primary" id="woo-btn-sync-pedidos">Sincronizar Pedidos</button>
        </div>
      </div>
      <div id="woo-pedidos-sheet"></div>
    </div>
  `;

  const productosHtml = `
    <div class="card">
      <div class="card-header">
        <div>
          <h2>Catálogo WooCommerce</h2>
          <span class="muted text-sm">Productos simples, variables y variaciones mapeados por woo_id y SKU.</span>
        </div>
        <div class="actions">
          <button type="button" class="btn btn-secondary" id="woo-btn-sync-stock">Sincronizar Stock → Woo</button>
          <button type="button" class="btn btn-secondary" id="woo-btn-sync-precios">Sincronizar Precios → Woo</button>
          <button type="button" class="btn btn-primary" id="woo-btn-import-productos">Importar Productos</button>
        </div>
      </div>
      <div id="woo-productos-sheet"></div>
    </div>
  `;

  const clientesHtml = `
    <div class="card">
      <div class="card-header">
        <div>
          <h2>Clientes WooCommerce</h2>
          <span class="muted text-sm">Resolución idempotente por woo_id, DNI/CUIT (meta_key_dni) y email, con provincia mapeada a jurisdicciones.</span>
        </div>
        <div class="actions">
          <button type="button" class="btn btn-primary" id="woo-btn-import-clientes">Importar Clientes</button>
        </div>
      </div>
      <div id="woo-clientes-sheet"></div>
    </div>
  `;

  const cuponesHtml = `
    <div class="card">
      <div class="card-header">
        <div>
          <h2>Cupones WooCommerce</h2>
          <span class="muted text-sm">Cupones sincronizados desde la tienda.</span>
        </div>
        <div class="actions">
          <button type="button" class="btn btn-primary" id="woo-btn-import-cupones">Importar Cupones</button>
        </div>
      </div>
      <div id="woo-cupones-sheet"></div>
    </div>
    <div class="card">
      <div class="card-header">
        <div>
          <h2>Descuentos Aplicados en Pedidos</h2>
          <span class="muted text-sm">Detalle de cupones y cargos aplicados en ventas originadas en WooCommerce.</span>
        </div>
      </div>
      <div id="woo-descuentos-sheet"></div>
    </div>
  `;

  const mapeoHtml = `
    <div class="card">
      <div class="card-header">
        <div>
          <h2>Métodos de Envío</h2>
          <span class="muted text-sm">Mapeá cada método de envío de WooCommerce a un producto/servicio del ERP.</span>
        </div>
        <div class="actions">
          <button type="button" class="btn btn-secondary" id="woo-btn-import-envios">Importar Envíos</button>
        </div>
      </div>
      <div id="woo-envios-sheet"></div>
    </div>
    <div class="card">
      <div class="card-header">
        <div>
          <h2>Pasarelas de Pago</h2>
          <span class="muted text-sm">Mapeá cada gateway de WooCommerce a un método de pago y cuenta contable para cobros automáticos.</span>
        </div>
        <div class="actions">
          <button type="button" class="btn btn-secondary" id="woo-btn-import-pagos">Importar Pasarelas</button>
        </div>
      </div>
      <div id="woo-pagos-sheet"></div>
    </div>
  `;

  const logsHtml = `
    <div class="card">
      <div class="card-header">
        <div>
          <h2>Logs de Sincronización</h2>
          <span class="muted text-sm">Últimos 200 eventos de polling saliente, importación y push de stock/precios.</span>
        </div>
      </div>
      <div id="woo-logs-sheet"></div>
    </div>
  `;

  const configHtml = `
    <div class="card">
      <div class="card-header">
        <div>
          <h2>Configuración WooCommerce (Cero Exposición)</h2>
          <span class="muted text-sm">Comunicación 100% saliente HTTPS hacia la API REST v3 de WooCommerce mediante Polling Incremental.</span>
        </div>
        <div class="actions">
          <button type="button" class="btn btn-secondary" id="woo-btn-test">Probar Conexión</button>
        </div>
      </div>
      <form id="woo-config-form" class="form-grid">
        <label>URL Tienda
          <input type="url" name="store_url" value="${esc(config.store_url || '')}" placeholder="https://mitienda.com" />
        </label>
        <label>Consumer Key
          <input type="text" name="consumer_key" value="${esc(config.consumer_key || '')}" placeholder="ck_..." autocomplete="off" />
        </label>
        <label>Consumer Secret
          <input type="password" name="consumer_secret" value="${esc(config.consumer_secret || '')}" placeholder="cs_..." autocomplete="off" />
        </label>
        <label>Meta Key DNI/CUIT
          <input type="text" name="meta_key_dni" value="${esc(config.meta_key_dni || 'billing_dni')}" />
        </label>
        <label>Intervalo Polling (min)
          <input type="number" min="1" name="polling_intervalo_min" value="${esc(String(config.polling_intervalo_min || 3))}" />
        </label>
        <label>Último Sync Pedidos
          <input type="text" name="ultimo_sync_pedidos_at" value="${esc(config.ultimo_sync_pedidos_at || '')}" readonly />
        </label>
        <label>Ubicación Stock Saliente
          <select name="ubicacion_stock_id">
            <option value="">Todas las internas/dedicadas</option>
            ${(ubicaciones || []).map(u => `<option value="${u.id}" ${Number(config.ubicacion_stock_id) === Number(u.id) ? 'selected' : ''}>${esc(u.nombre)}</option>`).join('')}
          </select>
        </label>
        <label>Lista Precio Normal
          <select name="lista_precio_normal_id">
            <option value="">Precio base producto</option>
            ${(listas || []).map(l => `<option value="${l.id}" ${Number(config.lista_precio_normal_id) === Number(l.id) ? 'selected' : ''}>${esc(l.nombre)}</option>`).join('')}
          </select>
        </label>
        <label>Lista Precio Oferta
          <select name="lista_precio_oferta_id">
            <option value="">Sin lista de oferta</option>
            ${(listas || []).map(l => `<option value="${l.id}" ${Number(config.lista_precio_oferta_id) === Number(l.id) ? 'selected' : ''}>${esc(l.nombre)}</option>`).join('')}
          </select>
        </label>
        <label>Diario Venta por Defecto
          <select name="diario_venta_id">
            <option value="">Automático</option>
            ${(diarios || []).filter(d => d.tipo === 'ventas').map(d => `<option value="${d.id}" ${Number(config.diario_venta_id) === Number(d.id) ? 'selected' : ''}>${esc(d.nombre)}</option>`).join('')}
          </select>
        </label>
        <label>Término de Pago
          <select name="termino_pago_id">
            <option value="">Por defecto</option>
            ${(terminos || []).map(t => `<option value="${t.id}" ${Number(config.termino_pago_id) === Number(t.id) ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('')}
          </select>
        </label>
        <div class="checkbox-group">
          <label><input type="checkbox" name="activo" ${Number(config.activo) ? 'checked' : ''} /> Integración Activa</label>
          <label><input type="checkbox" name="polling_activo" ${Number(config.polling_activo) ? 'checked' : ''} /> Polling Automático Activo</label>
          <label><input type="checkbox" name="sync_stock_auto" ${Number(config.sync_stock_auto) ? 'checked' : ''} /> Sync Stock Automático al Confirmar</label>
          <label><input type="checkbox" name="auto_confirmar_venta" ${Number(config.auto_confirmar_venta) ? 'checked' : ''} /> Auto-Confirmar Ventas</label>
          <label><input type="checkbox" name="auto_registrar_cobro" ${Number(config.auto_registrar_cobro) ? 'checked' : ''} /> Auto-Registrar Cobros</label>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Guardar Configuración</button>
        </div>
      </form>
    </div>
  `;

  mountPageView(root, {
    title: 'WooCommerce',
    subtitle: 'Integración Cero Exposición por Polling Saliente: pedidos, catálogo, stock, precios, cupones y pasarelas.',
    tabs: [
      { id: 'pedidos', label: 'Pedidos', badge: pedidos.length, html: pedidosHtml },
      { id: 'productos', label: 'Productos', badge: productos.length, html: productosHtml },
      { id: 'clientes', label: 'Clientes', badge: clientes.length, html: clientesHtml },
      { id: 'cupones', label: 'Cupones y Descuentos', badge: cupones.length, html: cuponesHtml },
      { id: 'mapeo', label: 'Envíos y Pagos', badge: metodosEnvio.length + metodosPago.length, html: mapeoHtml },
      { id: 'logs', label: 'Logs', badge: logs.length, html: logsHtml },
      { id: 'config', label: 'Configuración', html: configHtml },
    ],
    onAfterMount: () => {
      renderSpreadsheetTable(root.querySelector('#woo-pedidos-sheet'), {
        rows: pedidos,
        compact: true,
        readOnly: true,
        columns: [
          { key: 'woo_id', label: 'Woo ID', width: 80 },
          { key: 'order_number', label: 'N° Pedido', width: 100 },
          { key: 'date_created', label: 'Fecha', width: 140, render: r => esc(String(r.date_created || '').slice(0, 16).replace('T', ' ')) },
          { key: 'contacto_nombre', label: 'Cliente', width: 180 },
          { key: 'status', label: 'Estado Woo', width: 110 },
          { key: 'sync_estado', label: 'Sync', width: 100 },
          { key: 'total', label: 'Total', width: 110, align: 'right', render: r => fmtMoney(r.total) },
          {
            key: 'venta_id',
            label: 'Venta ERP',
            width: 120,
            render: r => r.venta_id ? `<a href="/ventas/${r.venta_id}" data-link class="link-primary">${esc(r.venta_numero || ('#' + r.venta_id))}</a>` : '—',
          },
          {
            key: 'cobro_id',
            label: 'Cobro ERP',
            width: 120,
            render: r => r.cobro_id ? `<a href="/tesoreria" data-link class="link-primary">${esc(r.cobro_numero || ('#' + r.cobro_id))}</a>` : '—',
          },
        ],
      });

      renderSpreadsheetTable(root.querySelector('#woo-productos-sheet'), {
        rows: productos,
        compact: true,
        readOnly: true,
        columns: [
          { key: 'woo_id', label: 'Woo ID', width: 80 },
          { key: 'tipo', label: 'Tipo', width: 90 },
          { key: 'sku', label: 'SKU', width: 120 },
          { key: 'name', label: 'Nombre Woo', width: 220 },
          { key: 'local_nombre', label: 'Producto ERP', width: 200 },
          { key: 'regular_price', label: 'Precio Normal', width: 110, align: 'right', render: r => fmtMoney(r.regular_price) },
          { key: 'sale_price', label: 'Precio Oferta', width: 110, align: 'right', render: r => r.sale_price !== null && r.sale_price !== undefined ? fmtMoney(r.sale_price) : '—' },
          { key: 'stock_quantity', label: 'Stock Woo', width: 90, align: 'right', render: r => r.stock_quantity !== null && r.stock_quantity !== undefined ? fmtNum(r.stock_quantity) : '—' },
        ],
      });

      renderSpreadsheetTable(root.querySelector('#woo-clientes-sheet'), {
        rows: clientes,
        compact: true,
        readOnly: true,
        columns: [
          { key: 'woo_id', label: 'Woo ID', width: 80 },
          { key: 'email', label: 'Email', width: 200 },
          { key: 'dni', label: 'DNI/CUIT', width: 120 },
          { key: 'first_name', label: 'Nombre', width: 130 },
          { key: 'last_name', label: 'Apellido', width: 130 },
          { key: 'contacto_nombre', label: 'Contacto ERP', width: 200 },
        ],
      });

      renderSpreadsheetTable(root.querySelector('#woo-cupones-sheet'), {
        rows: cupones,
        compact: true,
        readOnly: true,
        columns: [
          { key: 'woo_id', label: 'Woo ID', width: 80 },
          { key: 'code', label: 'Código', width: 150 },
          { key: 'discount_type', label: 'Tipo', width: 140 },
          { key: 'amount', label: 'Monto / %', width: 110, align: 'right', render: r => fmtNum(r.amount) },
          { key: 'usage_count', label: 'Usos', width: 80, align: 'right' },
          { key: 'date_expires', label: 'Vencimiento', width: 150 },
        ],
      });

      renderSpreadsheetTable(root.querySelector('#woo-descuentos-sheet'), {
        rows: descuentos,
        compact: true,
        readOnly: true,
        columns: [
          { key: 'woo_order_number', label: 'Pedido Woo', width: 110 },
          { key: 'venta_numero', label: 'Venta ERP', width: 120 },
          { key: 'tipo', label: 'Tipo', width: 90 },
          { key: 'codigo', label: 'Código', width: 140 },
          { key: 'descripcion', label: 'Descripción', width: 220 },
          { key: 'monto', label: 'Monto', width: 110, align: 'right', render: r => fmtMoney(r.monto) },
        ],
      });

      renderSpreadsheetTable(root.querySelector('#woo-envios-sheet'), {
        rows: metodosEnvio,
        compact: true,
        columns: [
          { key: 'method_id', label: 'Method ID', width: 160, readOnly: true },
          { key: 'title', label: 'Título Woo', width: 200, readOnly: true },
          { key: 'producto_servicio_id', label: 'Producto / Servicio ERP', width: 260, type: 'select', options: prodOptions },
        ],
        onUpdateRow: async (id, patch) => {
          await api(`/api/woo/metodos-envio/${id}`, { method: 'PUT', body: patch });
          toast('Método de envío actualizado', 'success');
        },
      });

      renderSpreadsheetTable(root.querySelector('#woo-pagos-sheet'), {
        rows: metodosPago,
        compact: true,
        columns: [
          { key: 'gateway_id', label: 'Gateway ID', width: 160, readOnly: true },
          { key: 'title', label: 'Título Woo', width: 200, readOnly: true },
          { key: 'metodo_pago_id', label: 'Método Pago ERP', width: 200, type: 'select', options: mpOptions },
          { key: 'cuenta_id', label: 'Cuenta Contable', width: 240, type: 'select', options: cuentaOptions },
        ],
        onUpdateRow: async (id, patch) => {
          await api(`/api/woo/metodos-pago/${id}`, { method: 'PUT', body: patch });
          toast('Pasarela de pago actualizada', 'success');
        },
      });

      renderSpreadsheetTable(root.querySelector('#woo-logs-sheet'), {
        rows: logs,
        compact: true,
        readOnly: true,
        columns: [
          { key: 'created_at', label: 'Fecha', width: 160 },
          { key: 'direccion', label: 'Dirección', width: 90 },
          { key: 'entidad', label: 'Entidad', width: 100 },
          { key: 'referencia', label: 'Ref', width: 90 },
          { key: 'estado', label: 'Estado', width: 80 },
          { key: 'mensaje', label: 'Mensaje', width: 420 },
        ],
      });

      const runAction = async (btnId, endpoint, body = {}, msgOk = 'Sincronización completada') => {
        const btn = root.querySelector(btnId);
        if (!btn) return;
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            const res = await api(endpoint, { method: 'POST', body });
            toast(`${msgOk}${res?.count !== undefined ? ` (${res.count})` : ''}`, 'success');
            await renderWooView();
          } catch (err) {
            toast(err.message || 'Error en sincronización', 'error');
          } finally {
            btn.disabled = false;
          }
        });
      };

      runAction('#woo-btn-polling', '/api/woo/sync/pedidos', { polling: true }, 'Polling ejecutado');
      runAction('#woo-btn-sync-pedidos', '/api/woo/sync/pedidos', {}, 'Pedidos sincronizados');
      runAction('#woo-btn-import-productos', '/api/woo/sync/productos', {}, 'Productos importados');
      runAction('#woo-btn-sync-stock', '/api/woo/sync/stock', {}, 'Stock enviado a WooCommerce');
      runAction('#woo-btn-sync-precios', '/api/woo/sync/precios', {}, 'Precios enviados a WooCommerce');
      runAction('#woo-btn-import-clientes', '/api/woo/sync/clientes', {}, 'Clientes importados');
      runAction('#woo-btn-import-cupones', '/api/woo/sync/cupones', {}, 'Cupones importados');
      runAction('#woo-btn-import-envios', '/api/woo/sync/metodos-envio', {}, 'Métodos de envío importados');
      runAction('#woo-btn-import-pagos', '/api/woo/sync/metodos-pago', {}, 'Pasarelas importadas');
      runAction('#woo-btn-test', '/api/woo/config/test', {}, 'Conexión exitosa con WooCommerce');

      const form = root.querySelector('#woo-config-form');
      if (form) {
        form.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const fd = new FormData(form);
          const payload = {
            store_url: fd.get('store_url'),
            consumer_key: fd.get('consumer_key'),
            consumer_secret: fd.get('consumer_secret'),
            meta_key_dni: fd.get('meta_key_dni'),
            polling_intervalo_min: Number(fd.get('polling_intervalo_min') || 3),
            ubicacion_stock_id: fd.get('ubicacion_stock_id') || null,
            lista_precio_normal_id: fd.get('lista_precio_normal_id') || null,
            lista_precio_oferta_id: fd.get('lista_precio_oferta_id') || null,
            diario_venta_id: fd.get('diario_venta_id') || null,
            termino_pago_id: fd.get('termino_pago_id') || null,
            activo: form.querySelector('[name="activo"]').checked ? 1 : 0,
            polling_activo: form.querySelector('[name="polling_activo"]').checked ? 1 : 0,
            sync_stock_auto: form.querySelector('[name="sync_stock_auto"]').checked ? 1 : 0,
            auto_confirmar_venta: form.querySelector('[name="auto_confirmar_venta"]').checked ? 1 : 0,
            auto_registrar_cobro: form.querySelector('[name="auto_registrar_cobro"]').checked ? 1 : 0,
          };
          try {
            await api('/api/woo/config', { method: 'PUT', body: payload });
            toast('Configuración WooCommerce guardada', 'success');
            await renderWooView();
          } catch (err) {
            toast(err.message || 'Error guardando configuración', 'error');
          }
        });
      }
    },
  });
}
