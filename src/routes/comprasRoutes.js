import * as compraSvc from '../services/comercial/compraService.js';
import * as afipSvc from '../services/afip/afipService.js';
import { contactoRepo } from '../services/comercial/contactoService.js';
import { json, parseBody } from './http.js';

export async function handleComprasRoutes(req, res, pathname, user) {
  if (pathname === '/api/compras' && req.method === 'GET') {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    json(res, 200, compraSvc.listCompras({ contacto_id: qs.get('contacto_id') || qs.get('proveedor_id') || undefined }));
    return true;
  }
  if (pathname === '/api/compras' && req.method === 'POST') {
    try { json(res, 201, { id: compraSvc.createCompra(await parseBody(req), user) }); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (pathname === '/api/compras/constatar' && req.method === 'POST') {
    try {
      const b = await parseBody(req);
      let cuitEmisor = b.cuit_emisor || b.cuit || '';
      if (!cuitEmisor && b.contacto_id) {
        cuitEmisor = contactoRepo.findById(Number(b.contacto_id))?.cuit || '';
      }
      json(res, 200, await afipSvc.constatarComprobanteAfip({
        cuitEmisor,
        tipoComprobante: b.tipo_comprobante,
        numero: b.numero,
        puntoVenta: b.punto_venta,
        fecha: b.fecha,
        total: b.total,
        cae: b.cae,
        cbteModo: b.cbte_modo || 'CAE',
      }));
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const cmpConstMatch = pathname.match(/^\/api\/compras\/(\d+)\/constatar$/);
  if (cmpConstMatch && req.method === 'POST') {
    try { json(res, 200, await afipSvc.constatarCompraAfip(Number(cmpConstMatch[1]))); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const cmpConfMatch = pathname.match(/^\/api\/compras\/(\d+)\/confirmar$/);
  if (cmpConfMatch && req.method === 'POST') {
    try {
      const ok = compraSvc.confirmarCompra(Number(cmpConfMatch[1]), await parseBody(req).catch(() => ({})), user);
      if (!ok) json(res, 404, { error: 'Compra no encontrada' });
      else json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const cmpArchMatch = pathname.match(/^\/api\/compras\/(\d+)\/archivar$/);
  if (cmpArchMatch && req.method === 'POST') {
    const b = await parseBody(req).catch(() => ({}));
    const ok = compraSvc.archivarCompra(Number(cmpArchMatch[1]), b.archivado !== false, user);
    if (!ok) json(res, 404, { error: 'Compra no encontrada' });
    else json(res, 200, { ok: true });
    return true;
  }
  const cmpAnulMatch = pathname.match(/^\/api\/compras\/(\d+)\/anular$/);
  if (cmpAnulMatch && req.method === 'POST') {
    try {
      const ok = compraSvc.anularCompra(Number(cmpAnulMatch[1]), user);
      if (!ok) json(res, 404, { error: 'Compra no encontrada' });
      else json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const cmpMatch = pathname.match(/^\/api\/compras\/(\d+)$/);
  if (cmpMatch && req.method === 'GET') {
    const d = compraSvc.getCompraById(Number(cmpMatch[1]));
    if (!d) json(res, 404, { error: 'Compra no encontrada' });
    else json(res, 200, d);
    return true;
  }
  if (cmpMatch && req.method === 'PUT') {
    try {
      const ok = compraSvc.updateCompra(Number(cmpMatch[1]), await parseBody(req), user);
      if (!ok) json(res, 404, { error: 'Compra no encontrada' });
      else json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (cmpMatch && req.method === 'DELETE') {
    compraSvc.deleteCompra(Number(cmpMatch[1]));
    json(res, 200, { ok: true });
    return true;
  }
  return false;
}
