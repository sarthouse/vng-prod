import * as curvaSvc from '../services/produccion/curvaService.js';
import * as recSvc from '../services/produccion/recetaService.js';
import * as presSvc from '../services/produccion/presupuestoService.js';
import * as pedSvc from '../services/produccion/pedidoService.js';
import * as prodSvc from '../services/produccion/produccionService.js';
import { buildRecetaFichaPdf } from '../services/print/recetaPdfService.js';
import { json, parseBody } from './http.js';

export async function handleProduccionRoutes(req, res, pathname, user) {
  // --- ORDENES DE PRODUCCION Y CRONOGRAMA ---
  if (pathname === '/api/ordenes' && req.method === 'GET') {
    json(res, 200, prodSvc.listOrdenes());
    return true;
  }
  if (pathname === '/api/ordenes' && req.method === 'POST') {
    const b = await parseBody(req);
    try { json(res, 201, { id: prodSvc.createOrden(b, user) }); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const ordenMatch = pathname.match(/^\/api\/ordenes\/(\d+)$/);
  if (ordenMatch && req.method === 'GET') {
    const det = prodSvc.getOrdenDetalle(Number(ordenMatch[1]));
    if (!det) json(res, 404, { error: 'Orden no encontrada' });
    else json(res, 200, det);
    return true;
  }
  if (ordenMatch && req.method === 'DELETE') {
    prodSvc.deleteOrden(Number(ordenMatch[1]));
    json(res, 200, { ok: true });
    return true;
  }
  const ordenIngresoMatch = pathname.match(/^\/api\/ordenes\/(\d+)\/ingresar$/);
  if (ordenIngresoMatch && req.method === 'POST') {
    try {
      const b = await parseBody(req);
      json(res, 200, prodSvc.registrarIngresoParcialOrden(Number(ordenIngresoMatch[1]), b, user));
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const ordenEtapaMatch = pathname.match(/^\/api\/orden-etapas\/(\d+)$/);
  if (ordenEtapaMatch && req.method === 'PUT') {
    try {
      const b = await parseBody(req);
      if (!prodSvc.updateOrdenEtapa(Number(ordenEtapaMatch[1]), b, user)) json(res, 404, { error: 'Etapa de orden no encontrada' });
      else json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (pathname === '/api/cronograma-compras' && req.method === 'GET') {
    json(res, 200, prodSvc.computeCronogramaCompras());
    return true;
  }

  // --- CURVA (respaldada por Presupuesto Borrador) ---
  if (pathname === '/api/curva' && req.method === 'GET') {
    const presId = new URL(req.url, 'http://localhost').searchParams.get('presupuesto_id');
    json(res, 200, curvaSvc.computeCurvaSummary(presId ? Number(presId) : null));
    return true;
  }
  if (pathname === '/api/curva' && req.method === 'PUT') {
    const b = await parseBody(req);
    const presId = curvaSvc.updateCurva(b.items || [], {
      presupuesto_id: b.presupuesto_id ? Number(b.presupuesto_id) : null,
      usuario_id: user?.id || null,
    });
    json(res, 200, curvaSvc.computeCurvaSummary(presId));
    return true;
  }
  if (pathname === '/api/curva/clear' && req.method === 'POST') {
    const b = await parseBody(req).catch(() => ({}));
    curvaSvc.clearCurva(b?.presupuesto_id ? Number(b.presupuesto_id) : null);
    json(res, 200, curvaSvc.computeCurvaSummary(b?.presupuesto_id ? Number(b.presupuesto_id) : null));
    return true;
  }
  if (pathname === '/api/curva/to-pedidos' && req.method === 'POST') {
    const created = pedSvc.createPedidosFromCurva(await parseBody(req).catch(() => ({})));
    json(res, 201, { created });
    return true;
  }

  // --- RECETAS ---
  if (pathname === '/api/recetas' && req.method === 'GET') {
    json(res, 200, recSvc.listRecetas());
    return true;
  }
  if (pathname === '/api/recetas' && req.method === 'POST') {
    const b = await parseBody(req);
    if (!b.plantilla_id || !b.nombre?.trim()) { json(res, 400, { error: 'Producto y nombre de receta son obligatorios' }); return true; }
    json(res, 201, { id: recSvc.createReceta(b) });
    return true;
  }
  const recMatch = pathname.match(/^\/api\/recetas\/(\d+)$/);
  if (recMatch && req.method === 'GET') {
    const data = recSvc.getRecetaById(Number(recMatch[1]));
    if (!data) json(res, 404, { error: 'Receta no encontrada' });
    else json(res, 200, data);
    return true;
  }
  if (recMatch && req.method === 'PUT') {
    if (!recSvc.updateReceta(Number(recMatch[1]), await parseBody(req))) json(res, 404, { error: 'Receta no encontrada' });
    else json(res, 200, { ok: true });
    return true;
  }
  if (recMatch && req.method === 'DELETE') {
    recSvc.deleteReceta(Number(recMatch[1]));
    json(res, 200, { ok: true });
    return true;
  }
  const recPdfMatch = pathname.match(/^\/api\/recetas\/(\d+)\/pdf$/);
  if (recPdfMatch && (req.method === 'GET' || req.method === 'POST')) {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    const conCostos = qs.get('con_costos') !== '0';
    const pdfBuf = buildRecetaFichaPdf(Number(recPdfMatch[1]), { conCostos });
    if (!pdfBuf) {
      json(res, 404, { error: 'Receta no encontrada' });
      return true;
    }
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="ficha-receta-${recPdfMatch[1]}.pdf"`,
      'Content-Length': pdfBuf.length,
    });
    res.end(pdfBuf);
    return true;
  }
  const recCostoMatch = pathname.match(/^\/api\/recetas\/(\d+)\/calcular-costo$/);
  if (recCostoMatch && req.method === 'POST') {
    const b = await parseBody(req).catch(() => ({}));
    const resCosto = recSvc.calcularCostoDesdeReceta(Number(recCostoMatch[1]), { aplicar: b?.aplicar !== false, user });
    if (!resCosto) json(res, 404, { error: 'Receta no encontrada' });
    else json(res, 200, resCosto);
    return true;
  }
  const recLinePostMatch = pathname.match(/^\/api\/recetas\/(\d+)\/lineas$/);
  if (recLinePostMatch && req.method === 'POST') {
    json(res, 201, { id: recSvc.addRecetaLinea(Number(recLinePostMatch[1]), await parseBody(req)) });
    return true;
  }
  const recEtapaPostMatch = pathname.match(/^\/api\/recetas\/(\d+)\/etapas$/);
  if (recEtapaPostMatch && req.method === 'POST') {
    const b = await parseBody(req);
    if (!b.nombre?.trim()) { json(res, 400, { error: 'El nombre de la etapa es obligatorio' }); return true; }
    json(res, 201, { id: recSvc.addRecetaEtapa(Number(recEtapaPostMatch[1]), b) });
    return true;
  }
  const recEtapaMatch = pathname.match(/^\/api\/receta-etapas\/(\d+)$/);
  if (recEtapaMatch && req.method === 'PUT') {
    if (!recSvc.updateRecetaEtapa(Number(recEtapaMatch[1]), await parseBody(req))) json(res, 404, { error: 'Etapa de receta no encontrada' });
    else json(res, 200, { ok: true });
    return true;
  }
  if (recEtapaMatch && req.method === 'DELETE') {
    recSvc.deleteRecetaEtapa(Number(recEtapaMatch[1]));
    json(res, 200, { ok: true });
    return true;
  }
  const recLineMatch = pathname.match(/^\/api\/receta-lineas\/(\d+)$/);
  if (recLineMatch && req.method === 'PUT') {
    if (!recSvc.updateRecetaLinea(Number(recLineMatch[1]), await parseBody(req))) json(res, 404, { error: 'Línea de receta no encontrada' });
    else json(res, 200, { ok: true });
    return true;
  }
  if (recLineMatch && req.method === 'DELETE') {
    recSvc.deleteRecetaLinea(Number(recLineMatch[1]));
    json(res, 200, { ok: true });
    return true;
  }

  // --- PRESUPUESTOS ---
  if (pathname === '/api/presupuesto' && req.method === 'GET') {
    const presId = new URL(req.url, 'http://localhost').searchParams.get('presupuesto_id');
    json(res, 200, presSvc.computePresupuestoLive(presId ? Number(presId) : null));
    return true;
  }
  if (pathname === '/api/presupuestos' && req.method === 'GET') {
    const estado = new URL(req.url, 'http://localhost').searchParams.get('estado');
    json(res, 200, presSvc.listPresupuestos({ estado: estado || undefined }));
    return true;
  }
  if (pathname === '/api/presupuestos' && req.method === 'POST') {
    json(res, 201, { id: presSvc.savePresupuestoSnapshot(await parseBody(req)) });
    return true;
  }
  const presToPedidosMatch = pathname.match(/^\/api\/presupuestos\/(\d+)\/to-pedidos$/);
  if (presToPedidosMatch && req.method === 'POST') {
    const b = await parseBody(req).catch(() => ({}));
    const created = pedSvc.createPedidosFromCurva({ ...b, presupuesto_id: Number(presToPedidosMatch[1]) });
    json(res, 201, { created });
    return true;
  }
  const presMatch = pathname.match(/^\/api\/presupuestos\/(\d+)$/);
  if (presMatch && req.method === 'GET') {
    const p = presSvc.getPresupuestoById(Number(presMatch[1]));
    if (!p) json(res, 404, { error: 'Presupuesto no encontrado' });
    else json(res, 200, p);
    return true;
  }
  if (presMatch && req.method === 'DELETE') {
    presSvc.deletePresupuesto(Number(presMatch[1]));
    json(res, 200, { ok: true });
    return true;
  }

  // --- PEDIDOS, ENTREGAS Y PENDIENTES ---
  if (pathname === '/api/pedidos' && req.method === 'GET') {
    json(res, 200, pedSvc.listPedidos());
    return true;
  }
  if (pathname === '/api/pedidos' && req.method === 'POST') {
    const b = await parseBody(req);
    if (!b.plantilla_id && (!Array.isArray(b.lineas) || !b.lineas.length)) {
      json(res, 400, { error: 'El producto es obligatorio' });
      return true;
    }
    try { json(res, 201, pedSvc.createPedido(b)); }
    catch (e) {
      if (String(e.message).includes('UNIQUE')) { json(res, 409, { error: 'Ese número de lote/pedido ya existe.' }); return true; }
      throw e;
    }
    return true;
  }
  const pedMatch = pathname.match(/^\/api\/pedidos\/(\d+)$/);
  if (pedMatch && req.method === 'GET') {
    const det = pedSvc.getPedidoDetalle(Number(pedMatch[1]));
    if (!det) json(res, 404, { error: 'Pedido no encontrado' });
    else json(res, 200, det);
    return true;
  }
  if (pedMatch && req.method === 'PUT') {
    if (!pedSvc.updatePedido(Number(pedMatch[1]), await parseBody(req))) json(res, 404, { error: 'Pedido no encontrado' });
    else json(res, 200, { ok: true });
    return true;
  }
  if (pedMatch && req.method === 'DELETE') {
    pedSvc.deletePedido(Number(pedMatch[1]));
    json(res, 200, { ok: true });
    return true;
  }
  const snapMatch = pathname.match(/^\/api\/pedido-insumos\/(\d+)$/);
  if (snapMatch && req.method === 'PATCH') {
    const b = await parseBody(req);
    pedSvc.toggleSnapshotComprado(Number(snapMatch[1]), b.comprado);
    json(res, 200, { ok: true });
    return true;
  }
  if (pathname === '/api/entregas' && req.method === 'GET') {
    json(res, 200, pedSvc.listEntregas());
    return true;
  }
  if (pathname === '/api/entregas' && req.method === 'POST') {
    const b = await parseBody(req);
    if (!Number(b.lote)) { json(res, 400, { error: 'El número de Lote es obligatorio' }); return true; }
    json(res, 201, pedSvc.createEntrega(b));
    return true;
  }
  const entMatch = pathname.match(/^\/api\/entregas\/(\d+)$/);
  if (entMatch && req.method === 'GET') {
    const e = pedSvc.getEntregaById(Number(entMatch[1]));
    if (!e) json(res, 404, { error: 'Entrega no encontrada' });
    else json(res, 200, e);
    return true;
  }
  if (entMatch && req.method === 'PUT') {
    if (!pedSvc.updateEntrega(Number(entMatch[1]), await parseBody(req))) json(res, 404, { error: 'Entrega no encontrada' });
    else json(res, 200, { ok: true });
    return true;
  }
  if (entMatch && req.method === 'DELETE') {
    pedSvc.deleteEntrega(Number(entMatch[1]));
    json(res, 200, { ok: true });
    return true;
  }
  if (pathname === '/api/pendientes' && req.method === 'GET') {
    json(res, 200, prodSvc.getPendientesOperativos());
    return true;
  }
  return false;
}
