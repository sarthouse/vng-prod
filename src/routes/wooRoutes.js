import { json, parseBody } from './http.js';
import {
  getWooConfig,
  saveWooConfig,
  testWooConnection,
  importarPedidos,
  importarClientes,
  importarProductos,
  importarCupones,
  importarMetodosEnvio,
  importarMetodosPago,
  exportarProductoAWoo,
  syncStockWoo,
  syncPreciosWoo,
  runWooPollingCycleForCurrentDb,
  listWooPedidos,
  listWooProductos,
  listWooClientes,
  listWooCupones,
  listWooDescuentos,
  listWooMetodosEnvio,
  updateWooMetodoEnvio,
  listWooMetodosPago,
  updateWooMetodoPago,
  listWooSyncLogs,
} from '../services/comercial/wooService.js';

export async function handleWooRoutes(req, res, pathname, user) {
  if (!pathname.startsWith('/api/woo')) return false;

  const send = (status, data) => {
    json(res, status, data);
    return true;
  };

  try {
    if (pathname === '/api/woo/config' && req.method === 'GET') {
      return send(200, getWooConfig({ unmask: false }));
    }
    if (pathname === '/api/woo/config' && req.method === 'PUT') {
      const b = await parseBody(req);
      return send(200, saveWooConfig(b, user));
    }
    if (pathname === '/api/woo/config/test' && req.method === 'POST') {
      return send(200, await testWooConnection());
    }

    if (pathname === '/api/woo/sync/pedidos' && req.method === 'POST') {
      const b = await parseBody(req);
      if (b?.polling) {
        return send(200, await runWooPollingCycleForCurrentDb({ force: true }));
      }
      return send(200, await importarPedidos(b || {}, user));
    }
    if (pathname === '/api/woo/sync/clientes' && req.method === 'POST') {
      const b = await parseBody(req);
      return send(200, await importarClientes(b || {}, user));
    }
    if (pathname === '/api/woo/sync/productos' && req.method === 'POST') {
      const b = await parseBody(req);
      return send(200, await importarProductos(b || {}, user));
    }
    if (pathname === '/api/woo/sync/stock' && req.method === 'POST') {
      const b = await parseBody(req);
      return send(200, await syncStockWoo(b?.producto_ids || null, user));
    }
    if (pathname === '/api/woo/sync/precios' && req.method === 'POST') {
      const b = await parseBody(req);
      return send(200, await syncPreciosWoo(b?.producto_ids || null, user));
    }
    if (pathname === '/api/woo/sync/cupones' && req.method === 'POST') {
      const b = await parseBody(req);
      return send(200, await importarCupones(b || {}, user));
    }
    if (pathname === '/api/woo/sync/metodos-envio' && req.method === 'POST') {
      return send(200, await importarMetodosEnvio(user));
    }
    if (pathname === '/api/woo/sync/metodos-pago' && req.method === 'POST') {
      return send(200, await importarMetodosPago(user));
    }

    const expMatch = pathname.match(/^\/api\/woo\/productos\/(\d+)\/exportar$/);
    if (expMatch && req.method === 'POST') {
      return send(200, await exportarProductoAWoo(Number(expMatch[1]), user));
    }

    if (pathname === '/api/woo/pedidos' && req.method === 'GET') {
      return send(200, listWooPedidos());
    }
    if (pathname === '/api/woo/productos' && req.method === 'GET') {
      return send(200, listWooProductos());
    }
    if (pathname === '/api/woo/clientes' && req.method === 'GET') {
      return send(200, listWooClientes());
    }
    if (pathname === '/api/woo/cupones' && req.method === 'GET') {
      return send(200, listWooCupones());
    }
    if (pathname === '/api/woo/descuentos' && req.method === 'GET') {
      return send(200, listWooDescuentos());
    }

    if (pathname === '/api/woo/metodos-envio' && req.method === 'GET') {
      return send(200, listWooMetodosEnvio());
    }
    const envioMatch = pathname.match(/^\/api\/woo\/metodos-envio\/(\d+)$/);
    if (envioMatch && req.method === 'PUT') {
      const b = await parseBody(req);
      return send(200, updateWooMetodoEnvio(Number(envioMatch[1]), b, user));
    }

    if (pathname === '/api/woo/metodos-pago' && req.method === 'GET') {
      return send(200, listWooMetodosPago());
    }
    const pagoMatch = pathname.match(/^\/api\/woo\/metodos-pago\/(\d+)$/);
    if (pagoMatch && req.method === 'PUT') {
      const b = await parseBody(req);
      return send(200, updateWooMetodoPago(Number(pagoMatch[1]), b, user));
    }

    if (pathname === '/api/woo/logs' && req.method === 'GET') {
      return send(200, listWooSyncLogs());
    }

    return send(404, { error: 'Endpoint WooCommerce no encontrado' });
  } catch (err) {
    return send(400, { error: err.message || 'Error en operación WooCommerce' });
  }
}
