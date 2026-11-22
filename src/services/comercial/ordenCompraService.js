import { BaseRepository } from '../../core/BaseRepository.js';
import { createStateMachine } from '../../core/stateMachine.js';
import { MODELS } from '../../db/models.js';
import { getNextNumeroDocumento } from '../config/configService.js';
import { createCompra } from './compraService.js';

export const ocRepo = new BaseRepository({ model: MODELS.ordenes_compra });
export const ocLineaRepo = new BaseRepository({ model: MODELS.orden_compra_lineas });

export const OC_SM = createStateMachine({
  Borrador: ['Enviada', 'Facturada', 'Cancelada'],
  Enviada: ['Recibida Parcial', 'Facturada', 'Cancelada'],
  'Recibida Parcial': ['Facturada', 'Cancelada'],
  Facturada: [],
  Cancelada: [],
}, { label: 'Orden de Compra' });

function resolveOcNumero(manualNumero) {
  const m = String(manualNumero || '').trim();
  if (m) return m;
  try {
    return getNextNumeroDocumento('orden_compra').numero;
  } catch {
    const count = ocRepo.query().count();
    return `OC-${String(count + 1).padStart(6, '0')}`;
  }
}

function calcTotalEstimado(lineas = []) {
  return Number(
    lineas.reduce((s, l) => s + (Number(l.cantidad || 0) * Number(l.precio_unitario || 0)), 0).toFixed(2),
  );
}

export function listOrdenesCompra({ proveedor_id, estado } = {}) {
  const q = ocRepo.query('oc')
    .select(
      'oc.*',
      "COALESCE(c.nombre, '') as proveedor_nombre",
      '(SELECT COUNT(*) FROM orden_compra_lineas l WHERE l.orden_compra_id = oc.id) as cantidad_items',
    )
    .leftJoin('contactos', 'c', 'c.id', 'oc.proveedor_id')
    .orderBy('oc.fecha', 'DESC')
    .orderBy('oc.id', 'DESC');

  if (proveedor_id) q.where('oc.proveedor_id', Number(proveedor_id));
  if (estado) q.where('oc.estado', estado);
  return q.all();
}

export function getOrdenCompraById(id) {
  const orden = ocRepo.query('oc')
    .select('oc.*', "COALESCE(c.nombre, '') as proveedor_nombre")
    .leftJoin('contactos', 'c', 'c.id', 'oc.proveedor_id')
    .where('oc.id', Number(id))
    .get();
  if (!orden) return null;

  const lineas = ocLineaRepo.query('l')
    .select('l.*', "COALESCE(p.nombre, l.descripcion, '') as producto_nombre", "COALESCE(p.sku, '') as sku")
    .leftJoin('productos', 'p', 'p.id', 'l.producto_id')
    .where('l.orden_compra_id', Number(id))
    .orderBy('l.id', 'ASC')
    .all();

  return { orden, lineas };
}

export function createOrdenCompra(b, user = null) {
  const proveedorId = Number(b.proveedor_id || b.contacto_id || 0);
  if (!proveedorId) throw new Error('Debe especificar un proveedor para la Orden de Compra.');
  const fecha = b.fecha || new Date().toISOString().slice(0, 10);
  const rawLineas = Array.isArray(b.lineas) ? b.lineas : [];
  const lineas = rawLineas
    .map(l => ({
      producto_id: l.producto_id ? Number(l.producto_id) : null,
      descripcion: String(l.descripcion || '').trim(),
      cantidad: Math.max(0, Number(l.cantidad || 0)),
      cantidad_recibida: Math.max(0, Number(l.cantidad_recibida || 0)),
      precio_unitario: Math.max(0, Number(l.precio_unitario || 0)),
      udm: String(l.udm || 'unidades').trim(),
      alicuota_iva: Number(l.alicuota_iva ?? 21),
    }))
    .filter(l => l.cantidad > 0 || l.producto_id || l.descripcion);

  const estado = b.estado || 'Borrador';
  const totalEstimado = calcTotalEstimado(lineas);

  return ocRepo.transaction(() => {
    const numero = resolveOcNumero(b.numero);
    const payload = {
      numero,
      proveedor_id: proveedorId,
      fecha,
      fecha_entrega_est: b.fecha_entrega_est || '',
      estado,
      origen_tipo: String(b.origen_tipo || '').trim(),
      origen_id: b.origen_id ? Number(b.origen_id) : null,
      observaciones: String(b.observaciones || '').trim(),
      total_estimado: totalEstimado,
    };
    ocRepo.validate(payload);
    const ocId = ocRepo.create(payload, user);

    for (const l of lineas) {
      ocLineaRepo.create({
        orden_compra_id: ocId,
        ...l,
      });
    }
    return ocId;
  });
}

export function updateOrdenCompra(id, b = {}, user = null) {
  const ex = getOrdenCompraById(id);
  if (!ex) return false;
  if (['Facturada', 'Cancelada'].includes(ex.orden.estado)) {
    throw new Error('No se puede modificar una Orden de Compra Facturada o Cancelada.');
  }

  return ocRepo.transaction(() => {
    const patch = {};
    if (b.proveedor_id !== undefined) patch.proveedor_id = Number(b.proveedor_id);
    if (b.fecha !== undefined) patch.fecha = b.fecha;
    if (b.fecha_entrega_est !== undefined) patch.fecha_entrega_est = b.fecha_entrega_est || '';
    if (b.observaciones !== undefined) patch.observaciones = String(b.observaciones || '').trim();

    if (Array.isArray(b.lineas)) {
      ocLineaRepo.where('orden_compra_id', Number(id)).delete();
      const nextLineas = b.lineas.map(l => ({
        orden_compra_id: Number(id),
        producto_id: l.producto_id ? Number(l.producto_id) : null,
        descripcion: String(l.descripcion || '').trim(),
        cantidad: Math.max(0, Number(l.cantidad || 0)),
        cantidad_recibida: Math.max(0, Number(l.cantidad_recibida || 0)),
        precio_unitario: Math.max(0, Number(l.precio_unitario || 0)),
        udm: String(l.udm || 'unidades').trim(),
        alicuota_iva: Number(l.alicuota_iva ?? 21),
      }));
      for (const l of nextLineas) ocLineaRepo.create(l);
      patch.total_estimado = calcTotalEstimado(nextLineas);
    }

    if (Object.keys(patch).length > 0) {
      ocRepo.validate(patch, { partial: true });
      ocRepo.update(id, patch, user);
    }
    return true;
  });
}

export function addOrdenCompraLinea(ocId, l = {}, user = null) {
  const ex = getOrdenCompraById(ocId);
  if (!ex) throw new Error('Orden de Compra no encontrada');
  if (['Facturada', 'Cancelada'].includes(ex.orden.estado)) {
    throw new Error('No se pueden agregar ítems a una Orden de Compra Facturada o Cancelada.');
  }
  return ocRepo.transaction(() => {
    const lineaId = ocLineaRepo.create({
      orden_compra_id: Number(ocId),
      producto_id: l.producto_id ? Number(l.producto_id) : null,
      descripcion: String(l.descripcion || '').trim(),
      cantidad: Math.max(0, Number(l.cantidad || 1)),
      cantidad_recibida: 0,
      precio_unitario: Math.max(0, Number(l.precio_unitario || 0)),
      udm: String(l.udm || 'unidades').trim(),
      alicuota_iva: Number(l.alicuota_iva ?? 21),
    });
    const all = ocLineaRepo.query().where('orden_compra_id', Number(ocId)).all();
    ocRepo.update(ocId, { total_estimado: calcTotalEstimado(all) }, user);
    return lineaId;
  });
}

export function updateOrdenCompraLinea(lineaId, patch = {}, user = null) {
  const linea = ocLineaRepo.findById(lineaId);
  if (!linea) return false;
  const oc = ocRepo.findById(linea.orden_compra_id);
  if (!oc || ['Facturada', 'Cancelada'].includes(oc.estado)) {
    throw new Error('No se puede editar una línea de Orden de Compra Facturada o Cancelada.');
  }
  return ocRepo.transaction(() => {
    const upd = {};
    if (patch.producto_id !== undefined) upd.producto_id = patch.producto_id ? Number(patch.producto_id) : null;
    if (patch.descripcion !== undefined) upd.descripcion = String(patch.descripcion || '').trim();
    if (patch.cantidad !== undefined) upd.cantidad = Math.max(0, Number(patch.cantidad || 0));
    if (patch.cantidad_recibida !== undefined) upd.cantidad_recibida = Math.max(0, Number(patch.cantidad_recibida || 0));
    if (patch.precio_unitario !== undefined) upd.precio_unitario = Math.max(0, Number(patch.precio_unitario || 0));
    if (patch.udm !== undefined) upd.udm = String(patch.udm || 'unidades').trim();
    if (patch.alicuota_iva !== undefined) upd.alicuota_iva = Number(patch.alicuota_iva ?? 21);

    ocLineaRepo.update(lineaId, upd);
    const all = ocLineaRepo.query().where('orden_compra_id', oc.id).all();
    ocRepo.update(oc.id, { total_estimado: calcTotalEstimado(all) }, user);
    return true;
  });
}

export function deleteOrdenCompraLinea(lineaId, user = null) {
  const linea = ocLineaRepo.findById(lineaId);
  if (!linea) return false;
  const oc = ocRepo.findById(linea.orden_compra_id);
  if (!oc || ['Facturada', 'Cancelada'].includes(oc.estado)) {
    throw new Error('No se puede eliminar una línea de Orden de Compra Facturada o Cancelada.');
  }
  return ocRepo.transaction(() => {
    ocLineaRepo.delete(lineaId);
    const all = ocLineaRepo.query().where('orden_compra_id', oc.id).all();
    ocRepo.update(oc.id, { total_estimado: calcTotalEstimado(all) }, user);
    return true;
  });
}

export function enviarOrdenCompra(id, user = null) {
  const ex = getOrdenCompraById(id);
  if (!ex) return false;
  OC_SM.assertTransition(ex.orden.estado, 'Enviada');
  if (!ex.lineas.length) {
    throw new Error('La Orden de Compra debe tener al menos un ítem para enviarse.');
  }
  ocRepo.update(id, { estado: 'Enviada' }, user);
  return true;
}

export function cancelarOrdenCompra(id, user = null) {
  const ex = getOrdenCompraById(id);
  if (!ex) return false;
  OC_SM.assertTransition(ex.orden.estado, 'Cancelada');
  ocRepo.update(id, { estado: 'Cancelada' }, user);
  return true;
}

export function deleteOrdenCompra(id) {
  const oc = ocRepo.findById(id);
  if (!oc) return false;
  if (!['Borrador', 'Cancelada'].includes(oc.estado)) {
    throw new Error('Solo se pueden eliminar Órdenes de Compra en estado Borrador o Cancelada.');
  }
  return ocRepo.delete(id);
}

export function convertirOrdenCompraACompra(ocId, datosFactura = {}, user = null) {
  const ex = getOrdenCompraById(ocId);
  if (!ex) throw new Error('Orden de Compra no encontrada');
  const oc = ex.orden;
  OC_SM.assertTransition(oc.estado, 'Facturada');
  if (!ex.lineas.length) {
    throw new Error('La Orden de Compra no tiene ítems para facturar.');
  }

  return ocRepo.transaction(() => {
    const lineasFactura = (Array.isArray(datosFactura.lineas) && datosFactura.lineas.length > 0)
      ? datosFactura.lineas
      : ex.lineas.map(l => ({
          producto_id: l.producto_id,
          descripcion: l.descripcion || l.producto_nombre,
          cantidad: Number(l.cantidad || 0),
          udm: l.udm || 'unidades',
          precio_unitario: Number(l.precio_unitario || 0),
          alicuota_iva: Number(l.alicuota_iva ?? 21),
        }));

    const compraId = createCompra({
      contacto_id: oc.proveedor_id,
      orden_id: oc.origen_tipo === 'orden' ? oc.origen_id : null,
      orden_compra_id: oc.id,
      fecha: datosFactura.fecha || new Date().toISOString().slice(0, 10),
      numero: datosFactura.numero || '',
      punto_venta: datosFactura.punto_venta || '',
      caracter: datosFactura.caracter || 'fiscal',
      tipo_comprobante: datosFactura.tipo_comprobante || 'FA-A',
      estado: datosFactura.estado || 'Borrador',
      recibir_inmediato: Boolean(datosFactura.recibir_inmediato),
      observaciones: datosFactura.observaciones || `Facturación de ${oc.numero}`,
      lineas: lineasFactura,
    }, user);

    ocRepo.update(oc.id, {
      estado: 'Facturada',
      compra_id: compraId,
    }, user);

    return {
      ok: true,
      orden_compra_id: oc.id,
      compra_id: compraId,
    };
  });
}
