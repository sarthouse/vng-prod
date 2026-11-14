import * as invSvc from '../services/inventario/inventarioService.js';
import * as prodCatSvc from '../services/inventario/productoService.js';
import * as opStockSvc from '../services/inventario/operacionStockService.js';
import * as cfgSvc from '../services/config/configService.js';
import { json, parseBody } from './http.js';

export async function handleInventarioRoutes(req, res, pathname, user) {
  if (pathname === '/api/inventario' && req.method === 'GET') {
    json(res, 200, invSvc.getInventarioResumen());
    return true;
  }
  if (pathname === '/api/ubicaciones' && req.method === 'GET') {
    json(res, 200, invSvc.listUbicaciones());
    return true;
  }
  if (pathname === '/api/ubicaciones' && req.method === 'POST') {
    const b = await parseBody(req);
    try { json(res, 201, { id: invSvc.createUbicacion(b) }); }
    catch (e) {
      if (String(e.message).includes('UNIQUE')) json(res, 409, { error: 'Ya existe una ubicación con ese código.' });
      else json(res, 400, { error: e.message });
    }
    return true;
  }
  const ubicMatch = pathname.match(/^\/api\/ubicaciones\/(\d+)$/);
  if (ubicMatch && req.method === 'PUT') {
    try {
      if (!invSvc.updateUbicacion(Number(ubicMatch[1]), await parseBody(req))) json(res, 404, { error: 'Ubicación no encontrada' });
      else json(res, 200, { ok: true });
    } catch (e) {
      json(res, 400, { error: e.message });
    }
    return true;
  }
  if (ubicMatch && req.method === 'DELETE') {
    try {
      if (!invSvc.deleteUbicacion(Number(ubicMatch[1]))) json(res, 404, { error: 'Ubicación no encontrada' });
      else json(res, 200, { ok: true });
    } catch (e) {
      json(res, 400, { error: e.message });
    }
    return true;
  }
  if (pathname === '/api/lotes' && req.method === 'GET') {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    json(res, 200, invSvc.listLotes({
      producto_id: qs.get('producto_id') || undefined,
      ubicacion_id: qs.get('ubicacion_id') || undefined,
    }));
    return true;
  }
  if (pathname === '/api/lotes' && req.method === 'POST') {
    try { json(res, 201, { id: invSvc.createLote(await parseBody(req)) }); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (pathname === '/api/stock-quants' && req.method === 'GET') {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    json(res, 200, invSvc.listStockQuants({
      ubicacion_id: qs.get('ubicacion_id') || undefined,
      solo_internas: qs.get('solo_internas') === '1',
    }));
    return true;
  }
  if (pathname === '/api/movimientos-stock' && req.method === 'GET') {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    json(res, 200, invSvc.listMovimientosStock({
      producto_id: qs.get('producto_id') || undefined,
      tipo: qs.get('tipo') || undefined,
    }));
    return true;
  }
  if (pathname === '/api/movimientos-stock' && req.method === 'POST') {
    const b = await parseBody(req);
    const id = invSvc.registrarMovimientoStock({
      producto_id: b.producto_id,
      tipo: b.tipo || 'ajuste',
      cantidad: b.cantidad,
      fecha: b.fecha,
      ubicacion_origen_id: b.ubicacion_origen_id ? Number(b.ubicacion_origen_id) : null,
      ubicacion_destino_id: b.ubicacion_destino_id ? Number(b.ubicacion_destino_id) : null,
      lote: b.lote || '',
      referencia_tipo: 'manual',
      nota: b.nota || 'Movimiento manual',
      user,
    });
    if (!id) json(res, 400, { error: 'Producto inválido o cantidad cero' });
    else json(res, 201, { id });
    return true;
  }

  if (pathname === '/api/plantillas' && req.method === 'GET') {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    json(res, 200, prodCatSvc.listPlantillas({
      se_fabrica: qs.get('se_fabrica') ?? undefined,
      se_compra: qs.get('se_compra') ?? undefined,
      se_vende: qs.get('se_vende') ?? undefined,
      tipo: qs.get('tipo') || undefined,
      categoria: qs.get('categoria') || undefined,
      search: qs.get('search') || undefined,
    }));
    return true;
  }
  if (pathname === '/api/plantillas' && req.method === 'POST') {
    const b = await parseBody(req);
    try { json(res, 201, { id: prodCatSvc.createPlantilla(b) }); }
    catch (e) {
      if (String(e.message).includes('UNIQUE')) json(res, 409, { error: 'Ya existe una plantilla con ese nombre.' });
      else json(res, 400, { error: e.message });
    }
    return true;
  }
  const plantMatch = pathname.match(/^\/api\/plantillas\/(\d+)$/);
  if (plantMatch && req.method === 'GET') {
    const data = prodCatSvc.getPlantillaById(Number(plantMatch[1]));
    if (!data) json(res, 404, { error: 'Plantilla no encontrada' });
    else json(res, 200, data);
    return true;
  }
  if (plantMatch && req.method === 'PUT') {
    if (!prodCatSvc.updatePlantilla(Number(plantMatch[1]), await parseBody(req))) json(res, 404, { error: 'Plantilla no encontrada' });
    else json(res, 200, { ok: true });
    return true;
  }
  if (plantMatch && req.method === 'DELETE') {
    prodCatSvc.deletePlantilla(Number(plantMatch[1]));
    json(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/productos' && req.method === 'GET') {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    json(res, 200, prodCatSvc.listProductos({
      plantilla_id: qs.get('plantilla_id') || undefined,
      se_compra: qs.get('se_compra') ?? undefined,
      se_fabrica: qs.get('se_fabrica') ?? undefined,
      se_vende: qs.get('se_vende') ?? undefined,
      tipo: qs.get('tipo') || undefined,
    }));
    return true;
  }
  const prodItemMatch = pathname.match(/^\/api\/productos\/(\d+)$/);
  if (prodItemMatch && req.method === 'PUT') {
    if (!prodCatSvc.updateProducto(Number(prodItemMatch[1]), await parseBody(req))) json(res, 404, { error: 'Producto no encontrado' });
    else json(res, 200, { ok: true });
    return true;
  }

  const mapOpToRemito = (op) => ({
    ...op,
    taller_id: op.contacto_id,
    taller_nombre: op.contacto_nombre || '',
    orden_id: op.referencia_tipo === 'orden' ? op.referencia_id : null,
  });

  if (pathname === '/api/remitos' && req.method === 'GET') {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    const tallerId = qs.get('taller_id') || undefined;
    const rows = opStockSvc.listOperacionesStock({ tipo: 'remito_taller', contacto_id: tallerId }).map(mapOpToRemito);
    json(res, 200, rows);
    return true;
  }
  if (pathname === '/api/remitos' && req.method === 'POST') {
    try {
      const b = await parseBody(req);
      const tallerId = Number(b.taller_id || b.contacto_id);
      if (!tallerId) throw new Error('Debe seleccionar un taller o destinatario');
      const rawNum = (b.numero || '').trim();
      const numero = (!rawNum || rawNum.endsWith('-')) ? cfgSvc.getNextNumeroDocumento('remito', b.punto_venta).numero : rawNum;
      const id = opStockSvc.createOperacionStock({
        numero,
        fecha: b.fecha,
        tipo: 'remito_taller',
        ubicacion_origen_id: b.ubicacion_origen_id,
        ubicacion_destino_id: b.ubicacion_destino_id,
        contacto_id: tallerId,
        referencia_tipo: b.orden_id ? 'orden' : '',
        referencia_id: b.orden_id ? Number(b.orden_id) : null,
        estado: b.estado || 'Confirmado',
        motivo: 'Remito a taller',
        observaciones: b.observaciones || '',
        lineas: b.lineas,
      }, user);
      json(res, 201, { id });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const remMatch = pathname.match(/^\/api\/remitos\/(\d+)$/);
  if (remMatch && req.method === 'GET') {
    const d = opStockSvc.getOperacionStockById(Number(remMatch[1]));
    if (!d || d.operacion.tipo !== 'remito_taller') json(res, 404, { error: 'Remito no encontrado' });
    else json(res, 200, { remito: mapOpToRemito(d.operacion), lineas: d.lineas });
    return true;
  }
  if (remMatch && req.method === 'DELETE') {
    const id = Number(remMatch[1]);
    const d = opStockSvc.getOperacionStockById(id);
    if (d && d.operacion.tipo === 'remito_taller') {
      if (d.operacion.estado === 'Confirmado') opStockSvc.anularOperacionStock(id, user);
      else opStockSvc.deleteOperacionStock(id);
    }
    json(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/operaciones-stock' && req.method === 'GET') {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    json(res, 200, opStockSvc.listOperacionesStock({
      tipo: qs.get('tipo') || undefined,
      estado: qs.get('estado') || undefined,
    }));
    return true;
  }
  if (pathname === '/api/operaciones-stock' && req.method === 'POST') {
    try { json(res, 201, { id: opStockSvc.createOperacionStock(await parseBody(req), user) }); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const opMatch = pathname.match(/^\/api\/operaciones-stock\/(\d+)$/);
  if (opMatch && req.method === 'GET') {
    const d = opStockSvc.getOperacionStockById(Number(opMatch[1]));
    if (!d) json(res, 404, { error: 'Operación no encontrada' });
    else json(res, 200, d);
    return true;
  }
  if (opMatch && req.method === 'PATCH') {
    try {
      const ok = opStockSvc.updateOperacionStockMeta(Number(opMatch[1]), await parseBody(req), user);
      if (!ok) json(res, 404, { error: 'Operación no encontrada' });
      else json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (opMatch && req.method === 'DELETE') {
    try {
      if (!opStockSvc.deleteOperacionStock(Number(opMatch[1]))) json(res, 404, { error: 'Operación no encontrada' });
      else json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const opConfMatch = pathname.match(/^\/api\/operaciones-stock\/(\d+)\/confirmar$/);
  if (opConfMatch && req.method === 'POST') {
    try {
      if (!opStockSvc.confirmarOperacionStock(Number(opConfMatch[1]), user)) json(res, 404, { error: 'Operación no encontrada' });
      else json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const opAnulMatch = pathname.match(/^\/api\/operaciones-stock\/(\d+)\/anular$/);
  if (opAnulMatch && req.method === 'POST') {
    try {
      if (!opStockSvc.anularOperacionStock(Number(opAnulMatch[1]), user)) json(res, 404, { error: 'Operación no encontrada' });
      else json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  return false;
}
