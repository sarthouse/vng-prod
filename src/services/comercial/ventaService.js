import { db } from '../../db.js';
import { BaseRepository } from '../../core/BaseRepository.js';
import { createStateMachine } from '../../core/stateMachine.js';
import { domainBus } from '../../core/eventBus.js';
import { MODELS } from '../../db/models.js';
import { resolveNumeroDocumento } from '../config/configService.js';
import { operacionStockRepo } from '../inventario/operacionStockService.js';
import { defaultAsientoService } from '../finanzas/asientoService.js';
import { getFacturaImputado } from '../finanzas/imputacionService.js';
import { validateComprobanteFiscal } from '../afip/fiscalRules.js';
import { incrementarUsoCupon } from './comercialReglasService.js';
import { calcularFechaVencimiento, getContactoCondiciones, resolverPrecioLista } from './condicionesComercialesService.js';
import { sanitizeDocumentoLineas, computeDocumentoTotales } from './documentoComercialHelper.js';
import { registerDomainSubscribers } from '../domainEvents.js';
import {
  aplicarImputacionNotaCreditoVenta,
  syncUltimoPrecioProductos,
} from './ventaEfectosHelper.js';

export const VENTA_SM = createStateMachine({
  Presupuesto: ['Borrador', 'Confirmada', 'Entregada', 'Anulada'],
  Borrador: ['Presupuesto', 'Confirmada', 'Entregada', 'Anulada'],
  Confirmada: ['Entregada', 'Anulada'],
  Entregada: ['Anulada'],
  Anulada: [],
}, { label: 'Venta' });

export const ventaRepo = new BaseRepository({
  model: MODELS.ventas,
  defaultOrder: 'fecha DESC, id DESC',
});
const ventaLineaRepo = new BaseRepository({ model: MODELS.venta_lineas });
const ventaImpuestoRepo = new BaseRepository({ model: MODELS.venta_impuestos });
const productoRepo = new BaseRepository({ model: MODELS.productos });
const plantillaRepo = new BaseRepository({ model: MODELS.producto_plantillas });
const contactoRepo = new BaseRepository({ model: MODELS.contactos });
const empresaRepo = new BaseRepository({ model: MODELS.empresa_config });
const diarioRepo = new BaseRepository({ model: MODELS.diarios });
const puntoVentaRepo = new BaseRepository({ model: MODELS.puntos_venta });
const cobroRepo = new BaseRepository({ model: MODELS.cobros });

function sanitizeVentaLineas(lineas, caracter = 'fiscal', tipoComp = 'FA-B') {
  return sanitizeDocumentoLineas(lineas, {
    caracter,
    tipoComprobante: tipoComp,
    defaultUdm: 'pares',
    allowTiposLinea: true,
  });
}

export function listVentas({ contacto_id, cliente_id, estado } = {}) {
  const qb = ventaRepo.query('v')
    .select(
      'v.*',
      'c.nombre as cliente_nombre',
      'c.nombre as contacto_nombre',
    )
    .innerJoin('contactos', 'c', 'c.id', 'v.contacto_id')
    .orderBy('v.fecha', 'DESC')
    .orderBy('v.id', 'DESC');

  const filterId = contacto_id || cliente_id;
  if (filterId) qb.where('v.contacto_id', Number(filterId));
  if (estado) qb.where('v.estado', estado);

  return qb.all().map(v => {
    const cobrado = getFacturaImputado('ventas', v.id);
    return {
      ...v,
      cobrado: Number(cobrado.toFixed(2)),
    };
  });
}

export function getVentaById(id) {
  const venta = ventaRepo.query('v')
    .select(
      'v.*',
      'c.nombre as cliente_nombre',
      'c.nombre as contacto_nombre',
      'c.razon_social as cliente_razon_social',
      'c.tipo_documento as cliente_tipo_documento',
      'c.cuit as cliente_cuit',
      'c.condicion_iva as cliente_condicion_iva',
      "COALESCE(NULLIF(c.direccion_fiscal, ''), c.direccion, '') as cliente_direccion",
      'c.localidad as cliente_localidad',
      'c.provincia as cliente_provincia',
      'c.codigo_postal as cliente_codigo_postal',
      'c.telefono as cliente_telefono',
      'c.email as cliente_email',
    )
    .innerJoin('contactos', 'c', 'c.id', 'v.contacto_id')
    .where('v.id', Number(id))
    .get();
  if (!venta) return null;

  const lineas = ventaLineaRepo.query('vl')
    .select('vl.*', 'COALESCE(p.nombre, vl.descripcion) as producto_nombre')
    .leftJoin('productos', 'p', 'p.id', 'vl.producto_id')
    .where('vl.venta_id', Number(id))
    .orderBy('vl.id', 'ASC')
    .all();

  const cobros = cobroRepo.query('cb')
    .select('cb.*', 'ct.nombre as cuenta_nombre')
    .leftJoin('cuentas', 'ct', 'ct.id', 'cb.cuenta_id')
    .where('cb.venta_id', Number(id))
    .orderBy('cb.fecha', 'DESC')
    .orderBy('cb.id', 'DESC')
    .all();

  const impuestos = ventaImpuestoRepo.findWhere({ venta_id: Number(id) }, { orderBy: 'id ASC' });
  const cobrado = getFacturaImputado('ventas', id);
  return {
    venta: {
      ...venta,
      cobrado: Number(cobrado.toFixed(2)),
      saldo_pendiente: Number(Math.max(0, (Number(venta.total) || 0) - cobrado).toFixed(2)),
    },
    lineas,
    impuestos,
    cobros,
  };
}

export function createVenta(b, user = null) {
  const contactoId = Number(b.contacto_id || b.cliente_id || 0);
  if (!contactoId) throw new Error('Debe seleccionar un cliente');

  const estado = b.estado || 'Confirmada';
  const caracter = b.caracter === 'interno' ? 'interno' : 'fiscal';
  const claseDocumento = ['factura', 'nota_credito', 'nota_debito'].includes(b.clase_documento)
    ? b.clase_documento
    : 'factura';
  const defaultTipo = claseDocumento === 'nota_credito' ? 'NC-B' : claseDocumento === 'nota_debito' ? 'ND-B' : 'FA-B';
  const defaultInterno = claseDocumento === 'nota_credito' ? 'NCX' : claseDocumento === 'nota_debito' ? 'NDX' : 'FX';
  const tipoComprobante = caracter === 'interno'
    ? ((b.tipo_comprobante && b.tipo_comprobante !== 'INT' ? b.tipo_comprobante : defaultInterno).trim())
    : ((b.tipo_comprobante || defaultTipo).trim() || defaultTipo);

  const empIva = empresaRepo.findById(1)?.condicion_iva || '';
  const cliRow = contactoRepo.findById(contactoId);
  if (!cliRow) throw new Error('Cliente no encontrado');
  if (b.validar_fiscal !== false) {
    validateComprobanteFiscal({
      caracter,
      tipoComprobante,
      emisorCondIva: empIva,
      receptorCondIva: cliRow.condicion_iva || 'Consumidor Final',
      estado,
    });
  }

  const diarioId = b.diario_id
    ? Number(b.diario_id)
    : (defaultAsientoService.resolveDiario({ tipo: 'ventas', caracter })?.id || null);

  const diarioRow = diarioId ? diarioRepo.findById(diarioId) : null;
  if (diarioRow && estado !== 'Presupuesto' && estado !== 'Borrador') {
    const diarioEsFiscal = Number(diarioRow.es_fiscal) === 1 || diarioRow.caracter === 'fiscal';
    if (!diarioEsFiscal && caracter === 'fiscal') {
      throw new Error(`El diario "${diarioRow.nombre}" no es fiscal: solo permite comprobantes internos X (FX, NCX, NDX).`);
    }
    if (diarioEsFiscal && caracter === 'interno') {
      throw new Error(`El diario "${diarioRow.nombre}" es fiscal: solo permite comprobantes fiscales (A, B, C).`);
    }
  }
  const puntoVentaFinal = (b.punto_venta !== undefined && b.punto_venta !== null && String(b.punto_venta).trim() !== '')
    ? String(b.punto_venta).trim()
    : (diarioRow?.punto_venta_id
      ? String(puntoVentaRepo.findById(diarioRow.punto_venta_id)?.numero || '')
      : '');

  const condContacto = getContactoCondiciones(contactoId);
  const terminoPagoId = b.termino_pago_id ? Number(b.termino_pago_id) : (condContacto?.termino_pago_id || null);
  const metodoPagoId = b.metodo_pago_id ? Number(b.metodo_pago_id) : (condContacto?.metodo_pago_id || null);
  const listaPrecioId = b.lista_precio_id ? Number(b.lista_precio_id) : (condContacto?.lista_precio_id || null);

  const rawLineas = Array.isArray(b.lineas)
    ? b.lineas.map(l => {
        if ((!l.tipo_linea || l.tipo_linea === 'producto') && l.producto_id && (l.precio_unitario === undefined || l.precio_unitario === null || l.precio_unitario === '')) {
          const res = resolverPrecioLista({
            lista_precio_id: listaPrecioId,
            contacto_id: contactoId,
            producto_id: l.producto_id,
            cantidad: Number(l.cantidad) || 1,
          });
          return { ...l, precio_unitario: res.precio_unitario };
        }
        return l;
      })
    : [];
  const lineas = sanitizeVentaLineas(rawLineas, caracter, tipoComprobante);
  const { neto, ivaMonto, alicuotaIva, impuestos, otrosImpuestosMonto, total } = computeDocumentoTotales(
    lineas,
    b.impuestos,
    { fallbackNeto: Number(b.neto) || Number(b.total) || 0, fallbackAlicuotaIva: b.alicuota_iva ?? 0 },
  );

  const fecha = b.fecha || new Date().toISOString().slice(0, 10);
  const fechaVencimiento = (b.fecha_vencimiento || '').trim() || (terminoPagoId ? calcularFechaVencimiento(fecha, terminoPagoId) : '');
  const seqBase = claseDocumento === 'nota_credito' ? 'nc_venta' : claseDocumento === 'nota_debito' ? 'nd_venta' : 'venta';
  let seqCode = seqBase;
  if (caracter === 'interno') {
    seqCode = `${seqBase}_x`;
  } else {
    const letra = String(tipoComprobante || '').split('-').pop()?.toUpperCase();
    if (letra === 'B' || letra === 'C') seqCode = `${seqBase}_${letra.toLowerCase()}`;
  }
  const numero = resolveNumeroDocumento(seqCode, b.numero, puntoVentaFinal);

  return ventaRepo.transaction(() => {
    const id = ventaRepo.create({
      numero,
      clase_documento: claseDocumento,
      comprobante_origen_id: b.comprobante_origen_id ? Number(b.comprobante_origen_id) : null,
      diario_id: diarioId,
      caracter,
      tipo_comprobante: tipoComprobante,
      punto_venta: puntoVentaFinal,
      cae: (b.cae || '').trim(),
      cae_vto: (b.cae_vto || '').trim(),
      fecha,
      fecha_vencimiento: fechaVencimiento,
      fecha_entrega_est: (b.fecha_entrega_est || '').trim(),
      contacto_id: contactoId,
      termino_pago_id: terminoPagoId,
      metodo_pago_id: metodoPagoId,
      lista_precio_id: listaPrecioId,
      jurisdiccion_codigo: (b.jurisdiccion_codigo || '').trim(),
      ubicacion_id: b.ubicacion_id ? Number(b.ubicacion_id) : null,
      estado,
      neto,
      alicuota_iva: alicuotaIva,
      iva_monto: ivaMonto,
      otros_impuestos_monto: otrosImpuestosMonto,
      total,
      moneda: (b.moneda || 'ARS').toUpperCase(),
      tipo_cambio: Number(b.tipo_cambio) > 0 ? Number(b.tipo_cambio) : 1,
      cupon_codigo: (b.cupon_codigo || '').trim().toUpperCase(),
      external_source: (b.external_source || '').trim(),
      external_id: (b.external_id || '').trim(),
      woo_id: b.woo_id ? Number(b.woo_id) : null,
      observaciones: (b.observaciones || '').trim(),
    }, user);

    for (const l of lineas) {
      ventaLineaRepo.create({
        venta_id: id,
        producto_id: l.producto_id,
        plantilla_id: l.plantilla_id,
        tipo_linea: l.tipo_linea || 'producto',
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
      ventaImpuestoRepo.create({
        venta_id: id,
        impuesto_id: imp.impuesto_id,
        nombre: imp.nombre,
        tipo: imp.tipo,
        base: imp.base,
        alicuota: imp.alicuota,
        monto: imp.monto,
      });
    }

    if (estado === 'Confirmada' || estado === 'Entregada') {
      if (b.cupon_codigo) incrementarUsoCupon(b.cupon_codigo);
      syncUltimoPrecioProductos(lineas);
      if (claseDocumento === 'nota_credito' && b.comprobante_origen_id) {
        aplicarImputacionNotaCreditoVenta({ id, fecha, total, comprobanteOrigenId: b.comprobante_origen_id });
      }
      const eventName = estado === 'Entregada' ? 'venta.entregada' : 'venta.confirmada';
      registerDomainSubscribers();
      domainBus.emit(eventName, {
        venta: {
          id,
          numero,
          fecha,
          clase_documento: claseDocumento,
          caracter,
          tipo_comprobante: tipoComprobante,
          contacto_id: contactoId,
          neto,
          iva_monto: ivaMonto,
          total,
          asiento_id: null,
        },
        lineas,
        impuestos,
        diarioId,
        crearOperacion: true,
        user,
      });
    }
    return id;
  });
}

export function updateVenta(id, b, user = null) {
  const ex = getVentaById(id);
  if (!ex) return false;
  const prev = ex.venta;
  const prevLineas = ex.lineas;
  const estado = b.estado !== undefined ? b.estado : prev.estado;
  if (prev.estado !== estado) {
    VENTA_SM.assertTransition(prev.estado, estado);
  }
  if (prev.estado !== 'Anulada' && estado === 'Anulada') {
    if ((prev.cae || '').trim()) {
      throw new Error('No se puede anular directamente una venta con CAE emitido; emití una Nota de Crédito.');
    }
    if (getFacturaImputado('ventas', Number(id)) > 0) {
      throw new Error('No se puede anular directamente una venta con cobros o notas de crédito imputadas; emití una Nota de Crédito.');
    }
  }
  const claseDocumento = ['factura', 'nota_credito', 'nota_debito'].includes(b.clase_documento)
    ? b.clase_documento
    : (prev.clase_documento || 'factura');
  const caracter = b.caracter !== undefined ? (b.caracter === 'interno' ? 'interno' : 'fiscal') : (prev.caracter || 'fiscal');
  const defaultIntComp = claseDocumento === 'nota_credito' ? 'NCX' : claseDocumento === 'nota_debito' ? 'NDX' : 'FX';
  const tipoComprobante = caracter === 'interno'
    ? (b.tipo_comprobante || prev.tipo_comprobante || defaultIntComp)
    : (b.tipo_comprobante !== undefined ? b.tipo_comprobante : (prev.tipo_comprobante || 'FA-B'));
  const lineas = b.lineas !== undefined ? sanitizeVentaLineas(b.lineas, caracter, tipoComprobante) : prevLineas;
  const { neto, ivaMonto, alicuotaIva, impuestos, otrosImpuestosMonto, total } = computeDocumentoTotales(
    lineas,
    b.impuestos !== undefined ? b.impuestos : ex.impuestos,
    {
      fallbackNeto: b.neto !== undefined ? Number(b.neto) : prev.neto,
      fallbackAlicuotaIva: b.alicuota_iva !== undefined ? b.alicuota_iva : prev.alicuota_iva,
    },
  );

  return ventaRepo.transaction(() => {
    registerDomainSubscribers();
    if (prev.estado !== 'Anulada' && estado === 'Anulada') {
      domainBus.emit('venta.anulada', { id, asientoId: prev.asiento_id, user });
    }
    ventaRepo.update(id, {
      numero: b.numero !== undefined ? b.numero.trim() : prev.numero,
      caracter,
      tipo_comprobante: tipoComprobante,
      punto_venta: b.punto_venta !== undefined ? String(b.punto_venta).trim() : (prev.punto_venta || ''),
      cae: b.cae !== undefined ? b.cae.trim() : (prev.cae || ''),
      cae_vto: b.cae_vto !== undefined ? b.cae_vto.trim() : (prev.cae_vto || ''),
      fecha: b.fecha || prev.fecha,
      fecha_vencimiento: b.fecha_vencimiento !== undefined ? b.fecha_vencimiento.trim() : (prev.fecha_vencimiento || ''),
      fecha_entrega_est: b.fecha_entrega_est !== undefined ? b.fecha_entrega_est.trim() : prev.fecha_entrega_est,
      contacto_id: (b.contacto_id || b.cliente_id) ? Number(b.contacto_id || b.cliente_id) : prev.contacto_id,
      termino_pago_id: b.termino_pago_id !== undefined ? (b.termino_pago_id ? Number(b.termino_pago_id) : null) : (prev.termino_pago_id || null),
      metodo_pago_id: b.metodo_pago_id !== undefined ? (b.metodo_pago_id ? Number(b.metodo_pago_id) : null) : (prev.metodo_pago_id || null),
      lista_precio_id: b.lista_precio_id !== undefined ? (b.lista_precio_id ? Number(b.lista_precio_id) : null) : (prev.lista_precio_id || null),
      estado,
      neto,
      alicuota_iva: alicuotaIva,
      iva_monto: ivaMonto,
      otros_impuestos_monto: otrosImpuestosMonto,
      total,
      observaciones: b.observaciones !== undefined ? b.observaciones.trim() : prev.observaciones,
    }, user);

    if (b.lineas !== undefined) {
      ventaLineaRepo.query().where('venta_id', Number(id)).delete();
      for (const l of lineas) {
        ventaLineaRepo.create({
          venta_id: Number(id),
          producto_id: l.producto_id,
          plantilla_id: l.plantilla_id,
          tipo_linea: l.tipo_linea || 'producto',
          descripcion: l.descripcion,
          cantidad: l.cantidad,
          udm: l.udm,
          precio_unitario: l.precio_unitario,
          alicuota_iva: l.alicuota_iva,
          iva_monto: l.iva_monto,
          subtotal: l.subtotal,
        });
      }
    }
    if (b.impuestos !== undefined) {
      ventaImpuestoRepo.query().where('venta_id', Number(id)).delete();
      for (const imp of impuestos) {
        ventaImpuestoRepo.create({
          venta_id: Number(id),
          impuesto_id: imp.impuesto_id,
          nombre: imp.nombre,
          tipo: imp.tipo,
          base: imp.base,
          alicuota: imp.alicuota,
          monto: imp.monto,
        });
      }
    }
    if (estado === 'Confirmada' || estado === 'Entregada') {
      if (b.cupon_codigo) incrementarUsoCupon(b.cupon_codigo);
      syncUltimoPrecioProductos(lineas);
      const nextNum = b.numero !== undefined ? b.numero.trim() : prev.numero;
      const nextFecha = b.fecha || prev.fecha;
      if (claseDocumento === 'nota_credito' && b.comprobante_origen_id) {
        aplicarImputacionNotaCreditoVenta({ id, fecha: nextFecha, total, comprobanteOrigenId: b.comprobante_origen_id });
      }
      const existingOps = operacionStockRepo.query()
        .where('referencia_tipo', 'venta')
        .where('referencia_id', Number(id))
        .all();
      const nextContactoId = (b.contacto_id || b.cliente_id) ? Number(b.contacto_id || b.cliente_id) : prev.contacto_id;
      const nextDiarioId = b.diario_id ? Number(b.diario_id) : (prev.diario_id || defaultAsientoService.resolveDiario({ tipo: 'ventas', caracter })?.id || null);

      const ventaPayload = {
        id: Number(id),
        numero: nextNum,
        fecha: nextFecha,
        clase_documento: claseDocumento,
        caracter,
        tipo_comprobante: tipoComprobante,
        contacto_id: nextContactoId,
        neto,
        iva_monto: ivaMonto,
        total,
        asiento_id: prev.asiento_id,
      };

      if (estado === 'Confirmada' && existingOps.length === 0) {
        domainBus.emit('venta.confirmada', { venta: ventaPayload, lineas, impuestos, diarioId: nextDiarioId, user });
      } else if (estado === 'Entregada') {
        domainBus.emit('venta.entregada', {
          venta: ventaPayload,
          lineas,
          impuestos,
          diarioId: nextDiarioId,
          crearOperacion: existingOps.length === 0,
          confirmarPendientes: existingOps.length > 0,
          user,
        });
      }
    }
    return true;
  });
}

export function deleteVenta(id, user = null) {
  const ex = getVentaById(id);
  if (!ex) return;
  if (!['Presupuesto', 'Borrador'].includes(ex.venta.estado)) {
    throw new Error('No se puede eliminar una venta confirmada, entregada o anulada; emití una Nota de Crédito para revertirla.');
  }
  ventaRepo.transaction(() => {
    registerDomainSubscribers();
    domainBus.emit('venta.anulada', { id, asientoId: null, user });
    ventaRepo.delete(id);
  });
}

export function archivarVenta(id, archivado = true, user = null) {
  return ventaRepo.setArchivado(id, archivado, user);
}

function mapTipoComprobanteNc(tipo) {
  const t = String(tipo || '').toUpperCase();
  if (t.endsWith('-A') || t === 'FA-A') return 'NC-A';
  if (t.endsWith('-B') || t === 'FA-B') return 'NC-B';
  if (t.endsWith('-C') || t === 'FA-C') return 'NC-C';
  return 'NC-X';
}

export function generarNotaCreditoDesdeVenta(ventaId, b = {}, user = null) {
  const ex = getVentaById(ventaId);
  if (!ex) throw new Error('Venta original no encontrada');
  const orig = ex.venta;
  if (!['Confirmada', 'Entregada'].includes(orig.estado)) {
    throw new Error('Solo se puede emitir Nota de Crédito desde una venta Confirmada o Entregada.');
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
        throw new Error(`La cantidad a devolver (${cant}) supera la facturada (${match.cantidad}) para ${match.descripcion || 'el ítem'}.`);
      }
      ncLineas.push({
        producto_id: reqL.producto_id ?? match?.producto_id ?? null,
        tipo_linea: reqL.tipo_linea || match?.tipo_linea || 'producto',
        descripcion: reqL.descripcion ?? match?.descripcion ?? '',
        cantidad: cant,
        udm: reqL.udm || match?.udm || 'unidades',
        precio_unitario: reqL.precio_unitario !== undefined ? Number(reqL.precio_unitario) : Number(match?.precio_unitario || 0),
        alicuota_iva: reqL.alicuota_iva !== undefined ? Number(reqL.alicuota_iva) : Number(match?.alicuota_iva ?? 21),
        descuento_pct: reqL.descuento_pct !== undefined ? Number(reqL.descuento_pct) : Number(match?.descuento_pct || 0),
      });
    }
  } else {
    ncLineas = origLines.map(ol => ({
      producto_id: ol.producto_id,
      tipo_linea: ol.tipo_linea || 'producto',
      descripcion: ol.descripcion,
      cantidad: Number(ol.cantidad || 0),
      udm: ol.udm || 'unidades',
      precio_unitario: Number(ol.precio_unitario || 0),
      alicuota_iva: Number(ol.alicuota_iva ?? 21),
      descuento_pct: Number(ol.descuento_pct || 0),
    })).filter(l => l.cantidad > 0);
  }

  if (ncLineas.length === 0) {
    throw new Error('Debe incluir al menos un ítem con cantidad mayor a 0 para emitir la Nota de Crédito.');
  }

  return createVenta({
    contacto_id: orig.contacto_id,
    diario_id: b.diario_id ?? orig.diario_id,
    caracter: b.caracter || orig.caracter || 'fiscal',
    tipo_comprobante: b.tipo_comprobante || mapTipoComprobanteNc(orig.tipo_comprobante),
    clase_documento: 'nota_credito',
    comprobante_origen_id: orig.id,
    punto_venta: b.punto_venta ?? orig.punto_venta,
    fecha: b.fecha || new Date().toISOString().slice(0, 10),
    moneda: orig.moneda || 'ARS',
    tipo_cambio: Number(orig.tipo_cambio || 1),
    jurisdiccion_codigo: orig.jurisdiccion_codigo || '',
    ubicacion_id: orig.ubicacion_id || null,
    estado: b.estado || 'Confirmada',
    observaciones: b.observaciones || `NC por devolución sobre ${orig.numero || `Venta #${orig.id}`}`,
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
