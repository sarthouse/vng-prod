import fs from 'node:fs';
import * as metaSvc from '../services/auth/metaService.js';
import { json, parseBody } from './http.js';

export async function handleMetaRoutes(req, res, pathname, user) {
  const metaMatch = pathname.match(/^\/api\/meta\/(compra|venta|movimiento|pago|cobro|orden|operacion_stock)\/(\d+)$/);
  if (metaMatch && req.method === 'GET') {
    json(res, 200, metaSvc.getMetaBundle(metaMatch[1], Number(metaMatch[2])));
    return true;
  }
  const notaEntityMatch = pathname.match(/^\/api\/notas\/(compra|venta|movimiento|pago|cobro|orden|operacion_stock)\/(\d+)$/);
  if (notaEntityMatch && req.method === 'POST') {
    const b = await parseBody(req);
    try {
      json(res, 201, { id: metaSvc.addNota({ tipo: notaEntityMatch[1], id: Number(notaEntityMatch[2]), contenido: b.contenido, user }) });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const notaIdMatch = pathname.match(/^\/api\/notas\/(\d+)$/);
  if (notaIdMatch && req.method === 'DELETE') {
    metaSvc.deleteNota(Number(notaIdMatch[1]));
    json(res, 200, { ok: true });
    return true;
  }
  const adjEntityMatch = pathname.match(/^\/api\/adjuntos\/(compra|venta|movimiento|pago|cobro|orden|operacion_stock)\/(\d+)$/);
  if (adjEntityMatch && req.method === 'POST') {
    const b = await parseBody(req, 15e6);
    try {
      json(res, 201, {
        id: metaSvc.saveAdjunto({
          tipo: adjEntityMatch[1],
          id: Number(adjEntityMatch[2]),
          nombre: b.nombre,
          mime_type: b.mime_type,
          data_base64: b.data_base64,
          user,
        }),
      });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const adjDownloadMatch = pathname.match(/^\/api\/adjuntos\/(\d+)\/download$/);
  if (adjDownloadMatch && req.method === 'GET') {
    const adj = metaSvc.getAdjunto(Number(adjDownloadMatch[1]));
    if (!adj || !fs.existsSync(adj.fullPath)) { json(res, 404, { error: 'Archivo no encontrado' }); return true; }
    const safeInline = /^(image\/(png|jpeg|jpg|webp|gif)|application\/pdf|text\/plain)$/i.test(adj.mime_type || '');
    res.writeHead(200, {
      'Content-Type': safeInline ? adj.mime_type : 'application/octet-stream',
      'Content-Disposition': `${safeInline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(adj.nombre_original)}"`,
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(adj.fullPath).pipe(res);
    return true;
  }
  const adjIdMatch = pathname.match(/^\/api\/adjuntos\/(\d+)$/);
  if (adjIdMatch && req.method === 'DELETE') {
    metaSvc.deleteAdjunto(Number(adjIdMatch[1]));
    json(res, 200, { ok: true });
    return true;
  }
  return false;
}
