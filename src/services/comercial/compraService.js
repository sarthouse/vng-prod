import { BaseRepository } from '../../core/BaseRepository.js';
import { createStateMachine } from '../../core/stateMachine.js';
import { domainBus } from '../../core/eventBus.js';
import { MODELS } from '../../db/models.js';
import { getNextNumeroDocumento, resolveNumeroDocumento } from '../config/configService.js';
import { crearImputacion, getFacturaImputado } from '../finanzas/imputacionService.js';
import { calcularFechaVencimiento, getContactoCondiciones, resolverPrecioCompra } from './condicionesComercialesService.js';
import { sanitizeDocumentoLineas, computeDocumentoTotales } from './documentoComercialHelper.js';
import { registerDomainSubscribers } from '../domainEvents.js';
import { getPlantillaForProducto } from './compraEfectosHelper.js';

export const COMPRA_SM = createStateMachine({
  Borrador: ['Confirmado', 'Anulada'],
  Confirmado: ['Anulada'],
  Anulada: [],
}, { label: 'Compra' });

export const compraRepo = new BaseRepository({
  model: MODELS.compras,
  defaultOrder: 'fecha DESC, id DESC',
});
const compraLineaRepo = new BaseRepository({ model: MODELS.compra_lineas });
const compraImpuestoRepo = new BaseRepository({ model: MODELS.compra_impuestos });
const pagoRepo = new BaseRepository({ model: MODELS.pagos });

function sanitizeCompraLineas(lineas, caracter = 'fiscal', tipoComp = 'FA-A') {
  return sanitizeDocumentoLineas(lineas, {
    caracter,
    tipoComprobante: tipoComp,
    defaultUdm: 'unidades',
    allowTiposLinea: false,
  });
}

export function listCompras({ contacto_id, proveedor_id } = {}) {
  const qb = compraRepo.query('c')
    .select('c.*', 'co.nombre as proveedor_nombre', 'co.nombre as contacto_nombre')
    .innerJoin('contactos', 'co', 'co.id', 'c.contacto_id')
    .orderBy('c.fecha', 'DESC')
    .orderBy('c.id', 'DESC');

  const filterId = contacto_id || proveedor_id;
  if (filterId) qb.where('c.contacto_id', Number(filterId));

  return qb.all().map(c => {
    const pagado = getFacturaImputado('compras', c.id);
    return {
      ...c,
      pagado: Number(pagado.toFixed(2)),
      saldo_pendiente: Number(Math.max(0, (Number(c.total) || 0) - pagado).toFixed(2)),
    };
  });
}

export function getCompraById(id) {
  const compra = compraRepo.query('c')
    .select(
      'c.*',
      'co.nombre as proveedor_nombre',
      'co.nombre as contacto_nombre',
      'co.cuit as proveedor_cuit',
      "COALESCE(NULLIF(co.direccion_fiscal, ''), co.direccion, '') as proveedor_direccion",
      'co.localidad as proveedor_localidad',
      'co.provincia as proveedor_provincia',
      'co.codigo_postal as proveedor_codigo_postal',
      'co.telefono as proveedor_telefono',
      'co.email as proveedor_email',
    )
    .innerJoin('contactos', 'co', 'co.id', 'c.contacto_id')
    .where('c.id', Number(id))
    .get();
  if (!compra) return null;

  const lineas = compraLineaRepo.query('cl')
    .select('cl.*', 'COALESCE(p.nombre, cl.descripcion) as item_nombre')
    .leftJoin('productos', 'p', 'p.id', 'cl.producto_id')
    .where('cl.compra_id', Number(id))
    .orderBy('cl.id', 'ASC')
    .all();

  const pagos = pagoRepo.query('p')
    .select('p.*', "COALESCE(cu.nombre, '') as cuenta_nombre")
    .leftJoin('cuentas', 'cu', 'cu.id', 'p.cuenta_id')
    .where('p.compra_id', Number(id))
    .orderBy('p.fecha', 'DESC')
    .orderBy('p.id', 'DESC')
    .all();

  const impuestos = compraImpuestoRepo.findWhere({ compra_id: Number(id) }, { orderBy: 'id ASC' });
  const pagadoFromPagos = pagos.filter(p => p.estado === 'Confirmado').reduce((s, p) => s + Number(p.monto || 0), 0);
  const pagado = Math.max(pagadoFromPagos, getFacturaImputado('compras', id));
  return {
    compra: {
      ...compra,
      pagado: Number(pagado.toFixed(2)),
      saldo_pendiente: Number(Math.max(0, (Number(compra.total) || 0) - pagado).toFixed(2)),
    },
    lineas,
    impuestos,
    pagos,
  };
}

export function createCompra(b, user = null) {
  const contactoId = Number(b.contacto_id || b.proveedor_id || 0);
  if (!contactoId) throw new Error('Debe seleccionar un proveedor');

  const estado = b.estado || 'Confirmado';
  const caracter = b.caracter === 'interno' ? 'interno' : 'fiscal';
  const claseDocumento = ['factura', 'nota_credito', 'nota_debito'].includes(b.clase_documento)
    ? b.clase_documento
    : 'factura';
  const defaultTipo = claseDocumento === 'nota_credito' ? 'NC-A' : claseDocumento === 'nota_debito' ? 'ND-A' : 'FA-A';
  const tipoComprobante = caracter === 'interno' ? 'INT' : ((b.tipo_comprobante || defaultTipo).trim() || defaultTipo);
  const rawLineas = Array.isArray(b.lineas)
    ? b.lineas.map(l => {
        const next = { ...l };
        if (next.producto_id) {
          if (next.precio_unitario === undefined || next.precio_unitario === null || next.precio_unitario === '') {
            const pr = resolverPrecioCompra({
              contacto_id: contactoId,
              producto_id: next.producto_id,
              cantidad: Number(next.cantidad) || 1,
            });
            next.precio_unitario = pr.precio_unitario;
          }
          if (!next.plan_cuenta_id) {
            const ptCta = getPlantillaForProducto(next.producto_id);
            if (ptCta?.cuenta_compra_id) next.plan_cuenta_id = ptCta.cuenta_compra_id;
          }
        }
        return next;
      })
    : [];
  const lineas = sanitizeCompraLineas(rawLineas, caracter, tipoComprobante);
  const { neto, ivaMonto, alicuotaIva, impuestos, otrosImpuestosMonto, total } = computeDocumentoTotales(
    lineas,
    b.impuestos,
    { fallbackNeto: Number(b.neto) || Number(b.total) || 0, fallbackAlicuotaIva: b.alicuota_iva ?? 0 },
  );

  const fecha = b.fecha || new Date().toISOString().slice(0, 10);
  const condContacto = getContactoCondiciones(contactoId);
  const terminoPagoId = b.termino_pago_id ? Number(b.termino_pago_id) : (condContacto?.termino_pago_compra_id || condContacto?.termino_pago_id || null);
  const metodoPagoId = b.metodo_pago_id ? Number(b.metodo_pago_id) : (condContacto?.metodo_pago_id || null);
  const fechaVencimiento = (b.fecha_vencimiento || '').trim() || (terminoPagoId ? calcularFechaVencimiento(fecha, terminoPagoId) : '');
  const seqCode = claseDocumento === 'nota_credito' ? 'nc_compra' : claseDocumento === 'nota_debito' ? 'nd_compra' : 'compra';
  const rawNum = (b.numero || '').trim();
  const numero = caracter === 'interno'
    ? resolveNumeroDocumento(seqCode, rawNum, b.punto_venta)
    : rawNum;
  if (caracter === 'fiscal' && estado === 'Confirmado' && !numero) {
    throw new Error('Ingresá el número de comprobante del proveedor');
  }

  return compraRepo.transaction(() => {
    const id = compraRepo.create({
      numero,
      clase_documento: claseDocumento,
      comprobante_origen_id: b.comprobante_origen_id ? Number(b.comprobante_origen_id) : null,
      diario_id: b.diario_id ? Number(b.diario_id) : null,
      caracter,
      tipo_comprobante: tipoComprobante,
      punto_venta: String(b.punto_venta || '').trim(),
      cae: (b.cae || '').trim(),
      cae_vto: (b.cae_vto || '').trim(),
      fecha,
      fecha_vencimiento: fechaVencimiento,
      contacto_id: contactoId,
      termino_pago_id: terminoPagoId,
      metodo_pago_id: metodoPagoId,
      jurisdiccion_codigo: (b.jurisdiccion_codigo || '').trim(),
      orden_id: b.orden_id ? Number(b.orden_id) : null,
      orden_compra_id: b.orden_compra_id ? Number(b.orden_compra_id) : null,
      ubicacion_id: b.ubicacion_id ? Number(b.ubicacion_id) : null,
      estado,
      neto,
      alicuota_iva: alicuotaIva,
      iva_monto: ivaMonto,
      otros_impuestos_monto: otrosImpuestosMonto,
      total,
      moneda: (b.moneda || 'ARS').toUpperCase(),
      tipo_cambio: Number(b.tipo_cambio) > 0 ? Number(b.tipo_cambio) : 1,
      observaciones: (b.observaciones || '').trim(),
    }, user);

    for (const l of lineas) {
      compraLineaRepo.create({
        compra_id: id,
        producto_id: l.producto_id,
        plan_cuenta_id: l.plan_cuenta_id,
        descripcion: l.descripcion,
        cantidad: l.cantidad,
        udm: l.udm,
        precio_unitario: l.precio_unitario,
        alicuota_iva: l.alicuota_iva,
        iva_monto: l.iva_monto,
        subtotal: l.subtotal,
      });
    }
    for (const imp of impuestos) {
      compraImpuestoRepo.create({
        compra_id: id,
        impuesto_id: imp.impuesto_id,
        nombre: imp.nombre,
        tipo: imp.tipo,
        base: imp.base,
        alicuota: imp.alicuota,
        monto: imp.monto,
      });
    }

    if (estado === 'Confirmado') {
      if (claseDocumento === 'nota_credito' && b.comprobante_origen_id) {
        const facOrig = compraRepo.findById(Number(b.comprobante_origen_id));
        if (facOrig) {
          const pend = Math.max(0, Number(facOrig.total || 0) - getFacturaImputado('compras', facOrig.id));
          const aImputar = Number(Math.min(total, pend).toFixed(2));
          if (aImputar > 0) {
            crearImputacion({
              fecha,
              dominio: 'compras',
              comprobante_tipo: 'nota_credito',
              comprobante_id: id,
              factura_id: facOrig.id,
              monto_imputado: aImputar,
            });
          }
        }
      }
      registerDomainSubscribers();
      domainBus.emit('compra.confirmada', {
        compra: {
          id,
          numero,
          fecha,
          clase_documento: claseDocumento,
          diario_id: b.diario_id ? Number(b.diario_id) : null,
          caracter,
          tipo_comprobante: tipoComprobante,
          contacto_id: contactoId,
          neto,
          iva_monto: ivaMonto,
          total,
        },
        impuestos,
        lineas,
        recibirInmediato: Boolean(b.recibir_inmediato),
        syncCosto: true,
        user,
      });
    }
    return id;
  });
}

export function updateCompra(id, b, user = null) {
  const ex = getCompraById(id);
  if (!ex) return false;
  if (ex.compra.estado !== 'Borrador') {
    throw new Error('Solo se pueden editar compras en estado Borrador');
  }

  const contactoId = Number(b.contacto_id || b.proveedor_id || ex.compra.contacto_id || 0);
  if (!contactoId) throw new Error('Debe seleccionar un proveedor');

  const caracter = b.caracter !== undefined
    ? (b.caracter === 'interno' ? 'interno' : 'fiscal')
    : (ex.compra.caracter || 'fiscal');
  const claseDocumento = ['factura', 'nota_credito', 'nota_debito'].includes(b.clase_documento)
    ? b.clase_documento
    : (ex.compra.clase_documento || 'factura');
  const defaultTipo = claseDocumento === 'nota_credito' ? 'NC-A' : claseDocumento === 'nota_debito' ? 'ND-A' : 'FA-A';
  const tipoComprobante = caracter === 'interno'
    ? 'INT'
    : ((b.tipo_comprobante ?? ex.compra.tipo_comprobante ?? defaultTipo).trim() || defaultTipo);

  const lineas = sanitizeCompraLineas(b.lineas !== undefined ? b.lineas : ex.lineas, caracter, tipoComprobante);
  const { neto, ivaMonto, alicuotaIva, impuestos, otrosImpuestosMonto, total } = computeDocumentoTotales(
    lineas,
    b.impuestos !== undefined ? b.impuestos : ex.impuestos,
    {
      fallbackNeto: Number(b.neto ?? ex.compra.neto ?? b.total ?? ex.compra.total ?? 0),
      fallbackAlicuotaIva: b.alicuota_iva ?? ex.compra.alicuota_iva ?? 0,
    },
  );
  const fecha = b.fecha || ex.compra.fecha || new Date().toISOString().slice(0, 10);
  const numero = b.numero !== undefined ? String(b.numero).trim() : (ex.compra.numero || '');

  return compraRepo.transaction(() => {
    compraRepo.update(id, {
      numero,
      clase_documento: claseDocumento,
      comprobante_origen_id: b.comprobante_origen_id !== undefined ? (b.comprobante_origen_id ? Number(b.comprobante_origen_id) : null) : ex.compra.comprobante_origen_id,
      diario_id: b.diario_id !== undefined ? (b.diario_id ? Number(b.diario_id) : null) : ex.compra.diario_id,
      caracter,
      tipo_comprobante: tipoComprobante,
      punto_venta: b.punto_venta !== undefined ? String(b.punto_venta || '').trim() : (ex.compra.punto_venta || ''),
      cae: b.cae !== undefined ? String(b.cae || '').trim() : (ex.compra.cae || ''),
      cae_vto: b.cae_vto !== undefined ? String(b.cae_vto || '').trim() : (ex.compra.cae_vto || ''),
      fecha,
      fecha_vencimiento: b.fecha_vencimiento !== undefined ? String(b.fecha_vencimiento || '').trim() : (ex.compra.fecha_vencimiento || ''),
      contacto_id: contactoId,
      neto,
      alicuota_iva: alicuotaIva,
      iva_monto: ivaMonto,
      otros_impuestos_monto: otrosImpuestosMonto,
      total,
      observaciones: b.observaciones !== undefined ? String(b.observaciones || '').trim() : (ex.compra.observaciones || ''),
    }, user);

    compraLineaRepo.query().where('compra_id', id).delete();
    compraImpuestoRepo.query().where('compra_id', id).delete();

    for (const l of lineas) {
      compraLineaRepo.create({
        compra_id: id,
        producto_id: l.producto_id,
        plan_cuenta_id: l.plan_cuenta_id,
        descripcion: l.descripcion,
        cantidad: l.cantidad,
        udm: l.udm,
        precio_unitario: l.precio_unitario,
        alicuota_iva: l.alicuota_iva,
        iva_monto: l.iva_monto,
        subtotal: l.subtotal,
      });
    }
    for (const imp of impuestos) {
      compraImpuestoRepo.create({
        compra_id: id,
        impuesto_id: imp.impuesto_id,
        nombre: imp.nombre,
        tipo: imp.tipo,
        base: imp.base,
        alicuota: imp.alicuota,
        monto: imp.monto,
      });
    }

    return true;
  });
}

export function confirmarCompra(id, b = {}, user = null) {
  const ex = getCompraById(id);
  if (!ex) return false;
  COMPRA_SM.assertTransition(ex.compra.estado, 'Confirmado');

  const numero = (b.numero !== undefined ? String(b.numero) : (ex.compra.numero || '')).trim();
  const caracter = ex.compra.caracter || 'fiscal';
  const seqCode = ex.compra.clase_documento === 'nota_credito' ? 'nc_compra' : ex.compra.clase_documento === 'nota_debito' ? 'nd_compra' : 'compra';
  const finalNum = (caracter === 'interno' && (!numero || numero.endsWith('-')))
    ? getNextNumeroDocumento(seqCode, ex.compra.punto_venta).numero
    : numero;
  if (caracter === 'fiscal' && !finalNum) {
    throw new Error('Ingresá el número de comprobante del proveedor para confirmar');
  }

  return compraRepo.transaction(() => {
    const fechaFinal = b.fecha || ex.compra.fecha;
    compraRepo.update(id, {
      numero: finalNum,
      fecha: fechaFinal,
      punto_venta: b.punto_venta !== undefined ? String(b.punto_venta).trim() : ex.compra.punto_venta,
      cae: b.cae !== undefined ? String(b.cae).trim() : ex.compra.cae,
      cae_vto: b.cae_vto !== undefined ? String(b.cae_vto).trim() : ex.compra.cae_vto,
      estado: 'Confirmado',
    }, user);

    registerDomainSubscribers();
    if (ex.compra.clase_documento === 'nota_credito' && ex.compra.comprobante_origen_id) {
      const facOrig = compraRepo.findById(Number(ex.compra.comprobante_origen_id));
      if (facOrig) {
        const pend = Math.max(0, Number(facOrig.total || 0) - getFacturaImputado('compras', facOrig.id));
        const aImputar = Number(Math.min(Number(ex.compra.total || 0), pend).toFixed(2));
        if (aImputar > 0) {
          crearImputacion({
            fecha: fechaFinal,
            dominio: 'compras',
            comprobante_tipo: 'nota_credito',
            comprobante_id: Number(id),
            factura_id: facOrig.id,
            monto_imputado: aImputar,
          });
        }
      }
    }

    domainBus.emit('compra.confirmada', {
      compra: {
        ...ex.compra,
        id: Number(id),
        numero: finalNum,
        fecha: fechaFinal,
      },
      impuestos: ex.impuestos,
      lineas: ex.lineas,
      recibirInmediato: Boolean(b.recibir_inmediato),
      syncCosto: true,
      user,
    });
    return true;
  });
}

export function deleteCompra(id, user = null) {
  const ex = getCompraById(id);
  if (!ex) return;
  if (ex.compra.estado !== 'Borrador') {
    throw new Error('Solo se pueden eliminar compras en estado Borrador; usá Anular o Nota de Crédito.');
  }
  compraRepo.transaction(() => {
    registerDomainSubscribers();
    domainBus.emit('compra.anulada', { id, asientoId: null, user });
    compraRepo.delete(id);
  });
}

export function anularCompra(id, user = null) {
  const ex = getCompraById(id);
  if (!ex) return false;
  COMPRA_SM.assertTransition(ex.compra.estado, 'Anulada');
  if (getFacturaImputado('compras', Number(id)) > 0) {
    throw new Error('No se puede anular directamente una compra con pagos o notas de crédito imputadas; emití una Nota de Crédito del proveedor.');
  }
  return compraRepo.transaction(() => {
    registerDomainSubscribers();
    domainBus.emit('compra.anulada', { id, asientoId: ex.compra.asiento_id, user });
    compraRepo.update(id, { estado: 'Anulada' }, user);
    return true;
  });
}

export function archivarCompra(id, archivado = true, user = null) {
  return compraRepo.setArchivado(id, archivado, user);
}

function mapTipoComprobanteNcCompra(tipo) {
  const t = String(tipo || '').toUpperCase();
  if (t.endsWith('-A') || t === 'FA-A') return 'NC-A';
  if (t.endsWith('-B') || t === 'FA-B') return 'NC-B';
  if (t.endsWith('-C') || t === 'FA-C') return 'NC-C';
  return 'NC-X';
}

export function generarNotaCreditoDesdeCompra(compraId, b = {}, user = null) {
  const ex = getCompraById(compraId);
  if (!ex) throw new Error('Compra original no encontrada');
  const orig = ex.compra;
  if (orig.estado !== 'Confirmado') {
    throw new Error('Solo se puede emitir Nota de Crédito desde una compra Confirmada.');
  }
  if (orig.clase_documento === 'nota_credito') {
    throw new Error('No se puede emitir una Nota de Crédito sobre otra Nota de Crédito.');
  }

  const origLines = ex.lineas || [];
  let ncLineas = [];
  if (Array.isArray(b.lineas) && b.lineas.length > 0) {
    for (const reqL of b.lineas) {
      const cant = Number(reqL.cantidad || 0);
      if (!(cant > 0)) continue;
      const match = origLines.find(ol =>
        (reqL.id && Number(ol.id) === Number(reqL.id))
        || (reqL.producto_id && Number(ol.producto_id) === Number(reqL.producto_id))
      );
      if (match && cant > Number(match.cantidad) + 0.0001) {
        throw new Error(`La cantidad a devolver (${cant}) supera la comprada (${match.cantidad}) para ${match.descripcion || 'el ítem'}.`);
      }
      ncLineas.push({
        producto_id: reqL.producto_id ?? match?.producto_id ?? null,
        descripcion: reqL.descripcion ?? match?.descripcion ?? '',
        cantidad: cant,
        udm: reqL.udm || match?.udm || 'unidades',
        precio_unitario: reqL.precio_unitario !== undefined ? Number(reqL.precio_unitario) : Number(match?.precio_unitario || 0),
        alicuota_iva: reqL.alicuota_iva !== undefined ? Number(reqL.alicuota_iva) : Number(match?.alicuota_iva ?? 21),
      });
    }
  } else {
    ncLineas = origLines.map(ol => ({
      producto_id: ol.producto_id,
      descripcion: ol.descripcion,
      cantidad: Number(ol.cantidad || 0),
      udm: ol.udm || 'unidades',
      precio_unitario: Number(ol.precio_unitario || 0),
      alicuota_iva: Number(ol.alicuota_iva ?? 21),
    })).filter(l => l.cantidad > 0);
  }

  if (ncLineas.length === 0) {
    throw new Error('Debe incluir al menos un ítem con cantidad mayor a 0 para emitir la Nota de Crédito.');
  }

  return createCompra({
    contacto_id: orig.contacto_id,
    diario_id: b.diario_id ?? orig.diario_id,
    caracter: b.caracter || orig.caracter || 'fiscal',
    tipo_comprobante: b.tipo_comprobante || mapTipoComprobanteNcCompra(orig.tipo_comprobante),
    clase_documento: 'nota_credito',
    comprobante_origen_id: orig.id,
    numero: b.numero || '',
    punto_venta: b.punto_venta ?? orig.punto_venta,
    fecha: b.fecha || new Date().toISOString().slice(0, 10),
    moneda: orig.moneda || 'ARS',
    tipo_cambio: Number(orig.tipo_cambio || 1),
    jurisdiccion_codigo: orig.jurisdiccion_codigo || '',
    ubicacion_id: orig.ubicacion_id || null,
    estado: b.estado || 'Confirmado',
    recibir_inmediato: b.recibir_inmediato !== false,
    observaciones: b.observaciones || `NC por devolución sobre ${orig.numero || `Compra #${orig.id}`}`,
    lineas: ncLineas,
    impuestos: Array.isArray(b.impuestos) ? b.impuestos : (ex.impuestos || []).map(i => ({
      impuesto_id: i.impuesto_id,
      nombre: i.nombre,
      alicuota: i.alicuota,
      base_imponible: i.base_imponible,
      monto: i.monto,
    })),
  }, user);
}
