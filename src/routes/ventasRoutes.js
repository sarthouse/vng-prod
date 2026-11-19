import * as ventaSvc from '../services/comercial/ventaService.js';
import * as condSvc from '../services/comercial/condicionesComercialesService.js';
import * as afipSvc from '../services/afip/afipService.js';
import { envioRepo, cuponRepo, recargoRepo, validarCupon } from '../services/comercial/comercialReglasService.js';
import { json, parseBody } from './http.js';

export async function handleVentasRoutes(req, res, pathname, user) {
  if (pathname === '/api/ventas/envios' && req.method === 'GET') {
    json(res, 200, envioRepo.findAll());
    return true;
  }
  if (pathname === '/api/ventas/envios' && req.method === 'POST') {
    try {
      const b = await parseBody(req);
      envioRepo.validate(b);
      json(res, 201, { id: envioRepo.create(b) });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const envMatch = pathname.match(/^\/api\/ventas\/envios\/(\d+)$/);
  if (envMatch && req.method === 'PUT') {
    try {
      const b = await parseBody(req);
      envioRepo.validate(b, { partial: true });
      const ok = envioRepo.update(Number(envMatch[1]), b);
      if (!ok) json(res, 404, { error: 'Método de envío no encontrado' });
      else json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (envMatch && req.method === 'DELETE') {
    envioRepo.delete(Number(envMatch[1]));
    json(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/ventas/cupones' && req.method === 'GET') {
    json(res, 200, cuponRepo.findAll());
    return true;
  }
  if (pathname === '/api/ventas/cupones/validar' && req.method === 'POST') {
    try { json(res, 200, validarCupon(await parseBody(req))); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (pathname === '/api/ventas/cupones' && req.method === 'POST') {
    try {
      const b = await parseBody(req);
      if (b.codigo) b.codigo = String(b.codigo).trim().toUpperCase();
      cuponRepo.validate(b);
      json(res, 201, { id: cuponRepo.create(b) });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const cupMatch = pathname.match(/^\/api\/ventas\/cupones\/(\d+)$/);
  if (cupMatch && req.method === 'PUT') {
    try {
      const b = await parseBody(req);
      if (b.codigo) b.codigo = String(b.codigo).trim().toUpperCase();
      cuponRepo.validate(b, { partial: true });
      const ok = cuponRepo.update(Number(cupMatch[1]), b);
      if (!ok) json(res, 404, { error: 'Cupón no encontrado' });
      else json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (cupMatch && req.method === 'DELETE') {
    cuponRepo.delete(Number(cupMatch[1]));
    json(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/ventas/recargos' && req.method === 'GET') {
    json(res, 200, recargoRepo.findAll());
    return true;
  }
  if (pathname === '/api/ventas/recargos' && req.method === 'POST') {
    try {
      const b = await parseBody(req);
      recargoRepo.validate(b);
      json(res, 201, { id: recargoRepo.create(b) });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const recMatch = pathname.match(/^\/api\/ventas\/recargos\/(\d+)$/);
  if (recMatch && req.method === 'PUT') {
    try {
      const b = await parseBody(req);
      recargoRepo.validate(b, { partial: true });
      const ok = recargoRepo.update(Number(recMatch[1]), b);
      if (!ok) json(res, 404, { error: 'Recargo no encontrado' });
      else json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (recMatch && req.method === 'DELETE') {
    recargoRepo.delete(Number(recMatch[1]));
    json(res, 200, { ok: true });
    return true;
  }
  if (pathname === '/api/ventas' && req.method === 'GET') {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    json(res, 200, ventaSvc.listVentas({ contacto_id: qs.get('contacto_id') || qs.get('cliente_id') || undefined, estado: qs.get('estado') || undefined }));
    return true;
  }
  if (pathname === '/api/ventas' && req.method === 'POST') {
    try { json(res, 201, { id: ventaSvc.createVenta(await parseBody(req), user) }); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const caeMatch = pathname.match(/^\/api\/ventas\/(\d+)\/cae$/);
  if (caeMatch && req.method === 'POST') {
    try { json(res, 200, await afipSvc.emitirFacturaAfip(Number(caeMatch[1]))); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const vtaArchMatch = pathname.match(/^\/api\/ventas\/(\d+)\/archivar$/);
  if (vtaArchMatch && req.method === 'POST') {
    const b = await parseBody(req).catch(() => ({}));
    if (!ventaSvc.archivarVenta(Number(vtaArchMatch[1]), b.archivado !== false, user)) json(res, 404, { error: 'Venta no encontrada' });
    else json(res, 200, { ok: true });
    return true;
  }
  const vtaMatch = pathname.match(/^\/api\/ventas\/(\d+)$/);
  if (vtaMatch && req.method === 'GET') {
    const d = ventaSvc.getVentaById(Number(vtaMatch[1]));
    if (!d) json(res, 404, { error: 'Venta no encontrada' });
    else json(res, 200, d);
    return true;
  }
  if (vtaMatch && req.method === 'PUT') {
    try {
      if (!ventaSvc.updateVenta(Number(vtaMatch[1]), await parseBody(req), user)) json(res, 404, { error: 'Venta no encontrada' });
      else json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (vtaMatch && req.method === 'DELETE') {
    try {
      ventaSvc.deleteVenta(Number(vtaMatch[1]));
      json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }

  // ── Términos de Pago ──────────────────────────────────────────────────────
  if (pathname === '/api/terminos-pago' && req.method === 'GET') {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    json(res, 200, condSvc.listTerminosPago({ solo_activos: qs.get('solo_activos') === '1' }));
    return true;
  }
  if (pathname === '/api/terminos-pago' && req.method === 'POST') {
    try { json(res, 201, { id: condSvc.createTerminoPago(await parseBody(req)) }); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const tpMatch = pathname.match(/^\/api\/terminos-pago\/(\d+)$/);
  if (tpMatch && req.method === 'PUT') {
    try {
      if (!condSvc.updateTerminoPago(Number(tpMatch[1]), await parseBody(req))) json(res, 404, { error: 'Término no encontrado' });
      else json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (tpMatch && req.method === 'DELETE') {
    if (!condSvc.deleteTerminoPago(Number(tpMatch[1]))) json(res, 404, { error: 'Término no encontrado' });
    else json(res, 200, { ok: true });
    return true;
  }

  // ── Métodos de Pago ───────────────────────────────────────────────────────
  if (pathname === '/api/metodos-pago' && req.method === 'GET') {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    json(res, 200, condSvc.listMetodosPago({ solo_activos: qs.get('solo_activos') === '1' }));
    return true;
  }
  if (pathname === '/api/metodos-pago' && req.method === 'POST') {
    try { json(res, 201, { id: condSvc.createMetodoPago(await parseBody(req)) }); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const mpMatch = pathname.match(/^\/api\/metodos-pago\/(\d+)$/);
  if (mpMatch && req.method === 'PUT') {
    try {
      if (!condSvc.updateMetodoPago(Number(mpMatch[1]), await parseBody(req))) json(res, 404, { error: 'Método no encontrado' });
      else json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (mpMatch && req.method === 'DELETE') {
    if (!condSvc.deleteMetodoPago(Number(mpMatch[1]))) json(res, 404, { error: 'Método no encontrado' });
    else json(res, 200, { ok: true });
    return true;
  }

  // ── Listas de Precios ─────────────────────────────────────────────────────
  if (pathname === '/api/listas-precios/resolver' && req.method === 'GET') {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    json(res, 200, condSvc.resolverPrecioLista({
      lista_precio_id: qs.get('lista_precio_id') ? Number(qs.get('lista_precio_id')) : null,
      contacto_id: qs.get('contacto_id') ? Number(qs.get('contacto_id')) : null,
      producto_id: qs.get('producto_id') ? Number(qs.get('producto_id')) : null,
      cantidad: qs.get('cantidad') ? Number(qs.get('cantidad')) : 1,
      precio_base: qs.get('precio_base') !== null ? Number(qs.get('precio_base')) : null,
    }));
    return true;
  }
  if (pathname === '/api/listas-precios' && req.method === 'GET') {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    json(res, 200, condSvc.listListasPrecios({ solo_activos: qs.get('solo_activos') === '1' }));
    return true;
  }
  if (pathname === '/api/listas-precios' && req.method === 'POST') {
    try { json(res, 201, { id: condSvc.createListaPrecio(await parseBody(req)) }); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const lpItemsMatch = pathname.match(/^\/api\/listas-precios\/(\d+)\/items$/);
  if (lpItemsMatch && req.method === 'POST') {
    try { json(res, 201, { id: condSvc.addListaPrecioItem(Number(lpItemsMatch[1]), await parseBody(req)) }); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const lpItemDelMatch = pathname.match(/^\/api\/listas-precios\/items\/(\d+)$/);
  if (lpItemDelMatch && req.method === 'DELETE') {
    if (!condSvc.deleteListaPrecioItem(Number(lpItemDelMatch[1]))) json(res, 404, { error: 'Regla no encontrada' });
    else json(res, 200, { ok: true });
    return true;
  }
  const lpMatch = pathname.match(/^\/api\/listas-precios\/(\d+)$/);
  if (lpMatch && req.method === 'GET') {
    const d = condSvc.getListaPrecioById(Number(lpMatch[1]));
    if (!d) json(res, 404, { error: 'Lista no encontrada' });
    else json(res, 200, d);
    return true;
  }
  if (lpMatch && req.method === 'PUT') {
    try {
      if (!condSvc.updateListaPrecio(Number(lpMatch[1]), await parseBody(req))) json(res, 404, { error: 'Lista no encontrada' });
      else json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (lpMatch && req.method === 'DELETE') {
    if (!condSvc.deleteListaPrecio(Number(lpMatch[1]))) json(res, 404, { error: 'Lista no encontrada' });
    else json(res, 200, { ok: true });
    return true;
  }

  // ── Tarifas de Compra por Variante / Proveedor ────────────────────────────
  if (pathname === '/api/producto-proveedores/resolver' && req.method === 'GET') {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    json(res, 200, condSvc.resolverPrecioCompra({
      contacto_id: qs.get('contacto_id') ? Number(qs.get('contacto_id')) : null,
      producto_id: qs.get('producto_id') ? Number(qs.get('producto_id')) : null,
      cantidad: qs.get('cantidad') ? Number(qs.get('cantidad')) : 1,
      precio_base: qs.get('precio_base') !== null ? Number(qs.get('precio_base')) : null,
    }));
    return true;
  }
  if (pathname === '/api/producto-proveedores' && req.method === 'GET') {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    json(res, 200, condSvc.listProductoProveedores({
      plantilla_id: qs.get('plantilla_id') ? Number(qs.get('plantilla_id')) : null,
      producto_id: qs.get('producto_id') ? Number(qs.get('producto_id')) : null,
      contacto_id: qs.get('contacto_id') ? Number(qs.get('contacto_id')) : null,
    }));
    return true;
  }
  if (pathname === '/api/producto-proveedores' && req.method === 'POST') {
    try { json(res, 201, { id: condSvc.createProductoProveedor(await parseBody(req)) }); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const ppDelMatch = pathname.match(/^\/api\/producto-proveedores\/(\d+)$/);
  if (ppDelMatch && req.method === 'DELETE') {
    if (!condSvc.deleteProductoProveedor(Number(ppDelMatch[1]))) json(res, 404, { error: 'Tarifa no encontrada' });
    else json(res, 200, { ok: true });
    return true;
  }
  return false;
}
