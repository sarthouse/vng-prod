import { db } from '../../db.js';
import { BaseRepository } from '../../core/BaseRepository.js';
import { MODELS } from '../../db/models.js';
import { registrarMovimientoStock, resolveOrCreateLote } from './inventarioService.js';
import { convertUnitFromDb } from '../config/configService.js';

export const operacionStockRepo = new BaseRepository({
  model: MODELS.operaciones_stock,
  defaultOrder: 'fecha DESC, id DESC',
});
const lineaRepo = new BaseRepository({ model: MODELS.operacion_stock_lineas });
const ubicacionRepo = new BaseRepository({ model: MODELS.ubicaciones });

const VALID_TIPOS = new Set(['recepcion', 'entrega', 'traslado', 'remito_taller', 'ajuste']);

function getUbicacionIdByCodigo(codigo) {
  return ubicacionRepo.query().select('id').where('codigo', codigo).get()?.id || null;
}

function nextOperacionNumero(tipo) {
  const prefixMap = {
    recepcion: 'REC',
    entrega: 'ENT',
    remito_taller: 'REM',
    ajuste: 'AJU',
    traslado: 'TRA',
  };
  const prefix = prefixMap[tipo] || 'TRA';
  const count = operacionStockRepo.query().where('tipo', tipo).count();
  return `${prefix} 0001-${String(count + 1).padStart(8, '0')}`;
}

function sanitizeLineas(lineas) {
  if (!Array.isArray(lineas)) return [];
  return lineas.map(l => ({
    producto_id: l.producto_id ? Number(l.producto_id) : null,
    lote_id: l.lote_id ? Number(l.lote_id) : null,
    lote: String(l.lote || '').trim(),
    descripcion: (l.descripcion || '').trim(),
    cantidad: Number(l.cantidad) || 0,
    udm: (l.udm || 'unidades').trim(),
  })).filter(l => l.producto_id && l.cantidad > 0);
}

function applyOperacionMovements(op, lineas, reverse = false, user = null) {
  const origId = reverse ? op.ubicacion_destino_id : op.ubicacion_origen_id;
  const destId = reverse ? op.ubicacion_origen_id : op.ubicacion_destino_id;
  const movTipo = op.tipo === 'ajuste' ? 'ajuste' : op.tipo === 'remito_taller' ? 'remito_taller' : op.tipo === 'recepcion' ? 'entrada' : op.tipo === 'entrega' ? 'salida' : 'transferencia';
  const notaPrefix = reverse ? `Anulación ${op.numero}` : op.numero;
  const notaText = op.motivo ? `${notaPrefix} — ${op.motivo}` : notaPrefix;

  const getProdMeta = db.prepare(`
    SELECT p.nombre, pt.udm, pt.requiere_lote
    FROM productos p
    JOIN v_plantillas pt ON pt.id = p.plantilla_id
    WHERE p.id = ?
  `);

  for (const l of lineas) {
    const prod = getProdMeta.get(Number(l.producto_id));
    if (!reverse && op.tipo !== 'ajuste' && prod?.requiere_lote === 1 && !l.lote_id && !(l.lote || '').trim()) {
      throw new Error(`El producto "${prod.nombre}" requiere especificar un lote.`);
    }
    const qtyStock = prod
      ? Number(convertUnitFromDb(l.cantidad, l.udm || prod.udm, prod.udm).toFixed(4))
      : l.cantidad;
    registrarMovimientoStock({
      producto_id: l.producto_id,
      tipo: movTipo,
      cantidad: qtyStock,
      fecha: op.fecha,
      ubicacion_origen_id: origId,
      ubicacion_destino_id: destId,
      lote_id: l.lote_id || null,
      lote: l.lote || '',
      referencia_tipo: 'operacion_stock',
      referencia_id: op.id,
      nota: notaText,
      user,
    });
  }
}

export function listOperacionesStock({ tipo, estado, contacto_id } = {}) {
  const q = operacionStockRepo.query('os')
    .select(
      'os.*',
      "COALESCE(uo.nombre, '') as origen_nombre",
      "COALESCE(ud.nombre, '') as destino_nombre",
      "COALESCE(c.nombre, '') as contacto_nombre",
      '(SELECT COUNT(*) FROM operacion_stock_lineas l WHERE l.operacion_id = os.id) as cantidad_lineas'
    )
    .leftJoin('ubicaciones', 'uo', 'uo.id', 'os.ubicacion_origen_id')
    .leftJoin('ubicaciones', 'ud', 'ud.id', 'os.ubicacion_destino_id')
    .leftJoin('contactos', 'c', 'c.id', 'os.contacto_id');

  if (tipo) q.where('os.tipo', tipo);
  if (estado) q.where('os.estado', estado);
  if (contacto_id) q.where('os.contacto_id', Number(contacto_id));

  return q.orderBy('os.fecha', 'DESC').orderBy('os.id', 'DESC').all();
}

export function getOperacionStockById(id) {
  const operacion = db.prepare(`
    SELECT os.*,
           COALESCE(uo.nombre, '') as origen_nombre,
           COALESCE(ud.nombre, '') as destino_nombre,
           COALESCE(c.id, vc.id) as contacto_resuelto_id,
           COALESCE(c.nombre, vc.nombre, '') as contacto_nombre,
           COALESCE(c.razon_social, vc.razon_social, '') as contacto_razon_social,
           COALESCE(c.cuit, vc.cuit, '') as contacto_cuit,
           COALESCE(c.condicion_iva, vc.condicion_iva, '') as contacto_iva,
           COALESCE(c.direccion, vc.direccion, '') as contacto_direccion,
           COALESCE(c.localidad, vc.localidad, '') as contacto_localidad,
           COALESCE(c.provincia, vc.provincia, '') as contacto_provincia,
           COALESCE(c.codigo_postal, vc.codigo_postal, '') as contacto_codigo_postal,
           COALESCE(c.telefono, vc.telefono, '') as contacto_telefono,
           COALESCE(c.email, vc.email, '') as contacto_email,
           COALESCE(c.observaciones, vc.observaciones, '') as contacto_observaciones
    FROM operaciones_stock os
    LEFT JOIN ubicaciones uo ON uo.id = os.ubicacion_origen_id
    LEFT JOIN ubicaciones ud ON ud.id = os.ubicacion_destino_id
    LEFT JOIN contactos c ON c.id = os.contacto_id
    LEFT JOIN ventas v ON os.referencia_tipo = 'venta' AND v.id = os.referencia_id
    LEFT JOIN contactos vc ON vc.id = v.contacto_id
    WHERE os.id = ?
  `).get(Number(id));
  if (!operacion) return null;

  const notasRows = db.prepare(`
    SELECT contenido, created_at, autor_nombre
    FROM notas_internas
    WHERE (entidad_tipo = 'operacion_stock' AND entidad_id = ?)
       OR (? IS NOT NULL AND entidad_tipo = 'contacto' AND entidad_id = ?)
       OR (? = 'venta' AND ? IS NOT NULL AND entidad_tipo = 'venta' AND entidad_id = ?)
    ORDER BY id DESC
  `).all(
    Number(id),
    operacion.contacto_resuelto_id || null,
    operacion.contacto_resuelto_id || null,
    operacion.referencia_tipo || '',
    operacion.referencia_id || null,
    operacion.referencia_id || null,
  );
  operacion.notas_internas = notasRows.map(n => n.contenido).filter(Boolean);

  const lineas = lineaRepo.query('l')
    .select(
      'l.*',
      "COALESCE(p.nombre, l.descripcion, 'Ítem') as item_nombre",
      'COALESCE(lt.codigo, l.lote) as lote_codigo'
    )
    .leftJoin('productos', 'p', 'p.id', 'l.producto_id')
    .leftJoin('lotes', 'lt', 'lt.id', 'l.lote_id')
    .where('l.operacion_id', Number(id))
    .orderBy('l.id', 'ASC')
    .all();
  return { operacion, lineas };
}

export function createOperacionStock(b, user = null) {
  const tipo = VALID_TIPOS.has(b.tipo) ? b.tipo : 'traslado';
  const estado = b.estado === 'Borrador' ? 'Borrador' : 'Confirmado';

  let origId = b.ubicacion_origen_id ? Number(b.ubicacion_origen_id) : null;
  let destId = b.ubicacion_destino_id ? Number(b.ubicacion_destino_id) : null;
  if (!origId) {
    if (tipo === 'recepcion') origId = getUbicacionIdByCodigo('VIRT-PROV');
    else if (tipo === 'remito_taller' || tipo === 'traslado') origId = getUbicacionIdByCodigo('DEP-CENTRAL');
    else if (tipo === 'entrega') origId = getUbicacionIdByCodigo('PROD-TERM') || getUbicacionIdByCodigo('DEP-CENTRAL');
  }
  if (!destId) {
    if (tipo === 'recepcion') destId = getUbicacionIdByCodigo('DEP-CENTRAL');
    else if (tipo === 'remito_taller') destId = getUbicacionIdByCodigo('TALLER-EXT');
    else if (tipo === 'entrega') destId = getUbicacionIdByCodigo('VIRT-CLI');
  }

  if (!origId || !destId) throw new Error('Debe seleccionar ubicación de origen y destino');
  if (origId === destId) throw new Error('Origen y destino no pueden ser iguales');

  const lineas = sanitizeLineas(b.lineas);
  if (!lineas.length) throw new Error('Debe agregar al menos un ítem con cantidad mayor a 0');

  const fecha = b.fecha || new Date().toISOString().slice(0, 10);
  const rawNum = (b.numero || '').trim();
  const numero = rawNum || nextOperacionNumero(tipo);

  return operacionStockRepo.transaction(() => {
    const id = operacionStockRepo.create({
      numero,
      fecha,
      tipo,
      ubicacion_origen_id: origId,
      ubicacion_destino_id: destId,
      contacto_id: b.contacto_id ? Number(b.contacto_id) : null,
      referencia_tipo: (b.referencia_tipo || '').trim(),
      referencia_id: b.referencia_id ? Number(b.referencia_id) : null,
      estado,
      motivo: (b.motivo || '').trim(),
      observaciones: (b.observaciones || '').trim(),
      envio: (b.envio || '').trim(),
      codigo_seguimiento: (b.codigo_seguimiento || '').trim(),
    }, user);

    for (const l of lineas) {
      const loteRow = resolveOrCreateLote({ producto_id: l.producto_id, lote: l.lote, lote_id: l.lote_id });
      const resolvedLoteId = loteRow?.id || l.lote_id || null;
      const resolvedLoteCod = loteRow?.codigo || l.lote || '';
      l.lote_id = resolvedLoteId;
      l.lote = resolvedLoteCod;
      lineaRepo.create({
        operacion_id: id,
        producto_id: l.producto_id,
        lote_id: resolvedLoteId,
        lote: resolvedLoteCod,
        descripcion: l.descripcion,
        cantidad: l.cantidad,
        udm: l.udm,
      });
    }

    if (estado === 'Confirmado') {
      applyOperacionMovements({
        id, numero, fecha, tipo,
        ubicacion_origen_id: origId,
        ubicacion_destino_id: destId,
        motivo: (b.motivo || '').trim(),
      }, lineas, false, user);
    }
    return id;
  });
}

export function updateOperacionStockMeta(id, b = {}, user = null) {
  const op = operacionStockRepo.findById(id);
  if (!op) return false;
  const patch = {};
  if (b.envio !== undefined) patch.envio = String(b.envio || '').trim();
  if (b.codigo_seguimiento !== undefined) patch.codigo_seguimiento = String(b.codigo_seguimiento || '').trim();
  if (b.observaciones !== undefined) patch.observaciones = String(b.observaciones || '').trim();
  if (Object.keys(patch).length > 0) {
    operacionStockRepo.update(id, patch, user);
  }
  return true;
}

export function confirmarOperacionStock(id, user = null) {
  const ex = getOperacionStockById(id);
  if (!ex) return false;
  if (ex.operacion.estado !== 'Borrador') {
    throw new Error('Solo se pueden confirmar documentos en estado Borrador');
  }
  return operacionStockRepo.transaction(() => {
    operacionStockRepo.update(id, { estado: 'Confirmado' }, user);
    applyOperacionMovements(ex.operacion, ex.lineas, false, user);
    return true;
  });
}

export function anularOperacionStock(id, user = null) {
  const ex = getOperacionStockById(id);
  if (!ex) return false;
  if (ex.operacion.estado !== 'Confirmado') {
    throw new Error('Solo se pueden anular documentos Confirmados');
  }
  return operacionStockRepo.transaction(() => {
    operacionStockRepo.update(id, { estado: 'Anulado' }, user);
    applyOperacionMovements(ex.operacion, ex.lineas, true, user);
    return true;
  });
}

export function deleteOperacionStock(id) {
  const ex = operacionStockRepo.findById(id);
  if (!ex) return false;
  if (ex.estado !== 'Borrador') {
    throw new Error('Los documentos confirmados o anulados son inmutables. Usá Anular para revertir stock.');
  }
  return operacionStockRepo.delete(id);
}
