import { db } from '../../db.js';
import { BaseRepository } from '../../core/BaseRepository.js';
import { MODELS } from '../../db/models.js';
import { anularOperacionStock, createOperacionStock, deleteOperacionStock, operacionStockRepo } from '../inventario/operacionStockService.js';
import { getNextNumeroDocumento } from '../config/configService.js';
import { defaultAsientoService } from '../finanzas/asientoService.js';
import { crearImputacion, getFacturaImputado } from '../finanzas/imputacionService.js';
import { calcularFechaVencimiento, getContactoCondiciones, resolverPrecioCompra } from './condicionesComercialesService.js';

export const compraRepo = new BaseRepository({
  model: MODELS.compras,
  defaultOrder: 'fecha DESC, id DESC',
});
const compraLineaRepo = new BaseRepository({ model: MODELS.compra_lineas });
const compraImpuestoRepo = new BaseRepository({ model: MODELS.compra_impuestos });

function sanitizeCompraLineas(lineas, caracter = 'fiscal', tipoComp = 'FA-A') {
  if (!Array.isArray(lineas)) return [];
  const noIva = caracter === 'interno' || tipoComp === 'FA-C';
  return lineas.map(l => {
    const cantidad = Number(l.cantidad) || 0;
    const precio_unitario = Number(l.precio_unitario) || 0;
    const subtotal = l.subtotal !== undefined && l.subtotal !== '' ? Number(l.subtotal) : Number((cantidad * precio_unitario).toFixed(2));
    const alicuota_iva = noIva ? 0 : Math.max(0, Number(l.alicuota_iva ?? 21));
    const iva_monto = Number((subtotal * alicuota_iva / 100).toFixed(2));
    return {
      producto_id: l.producto_id ? Number(l.producto_id) : null,
      plan_cuenta_id: l.plan_cuenta_id ? Number(l.plan_cuenta_id) : null,
      descripcion: (l.descripcion || '').trim(),
      cantidad,
      udm: (l.udm || 'unidades').trim(),
      precio_unitario,
      alicuota_iva,
      iva_monto,
      subtotal: Number(subtotal.toFixed(2)),
    };
  }).filter(l => l.producto_id || l.descripcion || l.cantidad > 0);
}

function sanitizeImpuestos(impuestos, neto) {
  if (!Array.isArray(impuestos)) return [];
  return impuestos.map(imp => {
    const nombre = (imp.nombre || '').trim();
    const tipo = ['percepcion', 'retencion', 'otro'].includes(imp.tipo) ? imp.tipo : 'percepcion';
    const base = imp.base !== undefined && imp.base !== '' ? Number(imp.base) : neto;
    const alicuota = Math.max(0, Number(imp.alicuota) || 0);
    const monto = imp.monto !== undefined && imp.monto !== '' ? Number(imp.monto) : Number((base * alicuota / 100).toFixed(2));
    return {
      impuesto_id: imp.impuesto_id ? Number(imp.impuesto_id) : null,
      nombre,
      tipo,
      base: Number(base.toFixed(2)),
      alicuota,
      monto: Number(monto.toFixed(2)),
    };
  }).filter(imp => imp.nombre && imp.monto !== 0);
}

function createCompraOperacion(compra, lineas, recibirInmediato = false, user = null) {
  const getTipo = db.prepare(`
    SELECT pp.tipo FROM productos p
    JOIN producto_plantillas pp ON pp.id = p.plantilla_id
    WHERE p.id = ?
  `);
  const stockLines = (lineas || []).filter(l => {
    if (!l.producto_id || l.cantidad <= 0) return false;
    const row = getTipo.get(Number(l.producto_id));
    return row?.tipo !== 'servicio';
  });
  if (stockLines.length === 0) return null;

  const isNC = compra.clase_documento === 'nota_credito';
  const ubiRepo = new BaseRepository({ model: MODELS.ubicaciones });
  const depId = compra.ubicacion_id || ubiRepo.query().select('id').where('codigo', 'DEP-CENTRAL').get()?.id || null;
  const provUbiId = ubiRepo.query().select('id').where('codigo', 'VIRT-PROV').get()?.id || null;

  return createOperacionStock({
    fecha: compra.fecha,
    tipo: isNC ? 'entrega' : 'recepcion',
    ubicacion_origen_id: isNC ? depId : provUbiId,
    ubicacion_destino_id: isNC ? provUbiId : depId,
    contacto_id: compra.contacto_id,
    referencia_tipo: 'compra',
    referencia_id: compra.id,
    estado: recibirInmediato ? 'Confirmado' : 'Borrador',
    motivo: `${isNC ? 'Devolución NC' : 'Recepción'} ${compra.numero || `Compra #${compra.id}`}`,
    lineas: stockLines.map(l => ({
      producto_id: l.producto_id,
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      udm: l.udm,
    })),
  }, user);
}

export function listCompras({ contacto_id, proveedor_id } = {}) {
  let sql = `
    SELECT c.*, co.nombre as proveedor_nombre, co.nombre as contacto_nombre,
           (
             COALESCE((SELECT SUM(i.monto_imputado) FROM imputaciones i WHERE i.dominio = 'compras' AND i.factura_id = c.id), 0)
             + COALESCE((SELECT SUM(COALESCE(NULLIF(p.total_bruto, 0), p.monto)) FROM pagos p WHERE p.compra_id = c.id AND p.estado = 'Confirmado'
               AND NOT EXISTS (SELECT 1 FROM imputaciones i2 WHERE i2.dominio = 'compras' AND i2.comprobante_tipo = 'pago' AND i2.comprobante_id = p.id)), 0)
           ) as pagado
    FROM compras c
    JOIN contactos co ON co.id = c.contacto_id
    WHERE 1=1
  `;
  const args = [];
  const filterId = contacto_id || proveedor_id;
  if (filterId) { sql += ' AND c.contacto_id = ?'; args.push(Number(filterId)); }
  sql += ' ORDER BY c.fecha DESC, c.id DESC';
  return db.prepare(sql).all(...args).map(c => ({
    ...c,
    pagado: Number(Number(c.pagado || 0).toFixed(2)),
    saldo_pendiente: Number(Math.max(0, (Number(c.total) || 0) - (Number(c.pagado) || 0)).toFixed(2)),
  }));
}

export function getCompraById(id) {
  const compra = db.prepare(`
    SELECT c.*, co.nombre as proveedor_nombre, co.nombre as contacto_nombre,
           co.cuit as proveedor_cuit,
           COALESCE(NULLIF(co.direccion_fiscal, ''), co.direccion, '') as proveedor_direccion,
           co.localidad as proveedor_localidad,
           co.provincia as proveedor_provincia,
           co.codigo_postal as proveedor_codigo_postal,
           co.telefono as proveedor_telefono,
           co.email as proveedor_email
    FROM compras c
    JOIN contactos co ON co.id = c.contacto_id
    WHERE c.id = ?
  `).get(id);
  if (!compra) return null;
  const lineas = db.prepare(`
    SELECT cl.*, COALESCE(p.nombre, cl.descripcion) as item_nombre
    FROM compra_lineas cl
    LEFT JOIN productos p ON p.id = cl.producto_id
    WHERE cl.compra_id = ?
    ORDER BY cl.id ASC
  `).all(id);
  const pagos = db.prepare(`
    SELECT p.*, COALESCE(cu.nombre, '') as cuenta_nombre
    FROM pagos p
    LEFT JOIN cuentas cu ON cu.id = p.cuenta_id
    WHERE p.compra_id = ?
    ORDER BY p.fecha DESC, p.id DESC
  `).all(id);
  const impuestos = db.prepare('SELECT * FROM compra_impuestos WHERE compra_id = ? ORDER BY id ASC').all(id);
  const pagado = pagos.filter(p => p.estado === 'Confirmado').reduce((s, p) => s + Number(p.monto || 0), 0);
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
            const ptCta = db.prepare(`
              SELECT pt.cuenta_compra_id
              FROM productos p JOIN producto_plantillas pt ON pt.id = p.plantilla_id
              WHERE p.id = ?
            `).get(Number(next.producto_id));
            if (ptCta?.cuenta_compra_id) next.plan_cuenta_id = ptCta.cuenta_compra_id;
          }
        }
        return next;
      })
    : [];
  const lineas = sanitizeCompraLineas(rawLineas, caracter, tipoComprobante);
  const neto = lineas.length > 0
    ? Number(lineas.reduce((s, l) => s + l.subtotal, 0).toFixed(2))
    : Number((Number(b.neto) || Number(b.total) || 0).toFixed(2));
  const ivaMonto = lineas.length > 0
    ? Number(lineas.reduce((s, l) => s + l.iva_monto, 0).toFixed(2))
    : Number((neto * Math.max(0, Number(b.alicuota_iva ?? 0)) / 100).toFixed(2));
  const alicuotaIva = neto > 0 ? Number(((ivaMonto / neto) * 100).toFixed(2)) : 0;
  const impuestos = sanitizeImpuestos(b.impuestos, neto);
  const otrosImpuestosMonto = Number(impuestos.reduce((s, i) => s + (i.tipo === 'retencion' ? -i.monto : i.monto), 0).toFixed(2));
  const total = Number((neto + ivaMonto + otrosImpuestosMonto).toFixed(2));
  const fecha = b.fecha || new Date().toISOString().slice(0, 10);
  const condContacto = getContactoCondiciones(contactoId);
  const terminoPagoId = b.termino_pago_id ? Number(b.termino_pago_id) : (condContacto?.termino_pago_compra_id || condContacto?.termino_pago_id || null);
  const metodoPagoId = b.metodo_pago_id ? Number(b.metodo_pago_id) : (condContacto?.metodo_pago_id || null);
  const fechaVencimiento = (b.fecha_vencimiento || '').trim() || (terminoPagoId ? calcularFechaVencimiento(fecha, terminoPagoId) : '');
  const seqCode = claseDocumento === 'nota_credito' ? 'nc_compra' : claseDocumento === 'nota_debito' ? 'nd_compra' : 'compra';
  const rawNum = (b.numero || '').trim();
  const numero = (caracter === 'interno' && (!rawNum || rawNum.endsWith('-')))
    ? getNextNumeroDocumento(seqCode, b.punto_venta).numero
    : (rawNum || (caracter === 'interno' ? getNextNumeroDocumento(seqCode, b.punto_venta).numero : ''));
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

    const ins = db.prepare(`
      INSERT INTO compra_lineas (compra_id, producto_id, plan_cuenta_id, descripcion, cantidad, udm, precio_unitario, alicuota_iva, iva_monto, subtotal)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const l of lineas) ins.run(id, l.producto_id, l.plan_cuenta_id, l.descripcion, l.cantidad, l.udm, l.precio_unitario, l.alicuota_iva, l.iva_monto, l.subtotal);

    const insImp = db.prepare(`
      INSERT INTO compra_impuestos (compra_id, impuesto_id, nombre, tipo, base, alicuota, monto)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const imp of impuestos) insImp.run(id, imp.impuesto_id, imp.nombre, imp.tipo, imp.base, imp.alicuota, imp.monto);

    if (estado === 'Confirmado') {
      syncUltimoCostoProductos(lineas);
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
      createCompraOperacion({
        id,
        numero,
        fecha,
        contacto_id: contactoId,
        clase_documento: claseDocumento,
      }, lineas, Boolean(b.recibir_inmediato), user);

      if (total > 0) {
        const asientoId = defaultAsientoService.generarAsientoCompra({
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
        }, impuestos, lineas);
        if (asientoId) compraRepo.update(id, { asiento_id: asientoId }, user);
      }
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
  const neto = lineas.length > 0
    ? Number(lineas.reduce((s, l) => s + l.subtotal, 0).toFixed(2))
    : Number((Number(b.neto ?? ex.compra.neto ?? b.total ?? ex.compra.total ?? 0)).toFixed(2));
  const ivaMonto = lineas.length > 0
    ? Number(lineas.reduce((s, l) => s + l.iva_monto, 0).toFixed(2))
    : Number((neto * Math.max(0, Number(b.alicuota_iva ?? ex.compra.alicuota_iva ?? 0)) / 100).toFixed(2));
  const alicuotaIva = neto > 0 ? Number(((ivaMonto / neto) * 100).toFixed(2)) : 0;
  const impuestos = sanitizeImpuestos(b.impuestos !== undefined ? b.impuestos : ex.impuestos, neto);
  const otrosImpuestosMonto = Number(impuestos.reduce((s, i) => s + (i.tipo === 'retencion' ? -i.monto : i.monto), 0).toFixed(2));
  const total = Number((neto + ivaMonto + otrosImpuestosMonto).toFixed(2));
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
  if (ex.compra.estado === 'Confirmado') throw new Error('La compra ya está confirmada');

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
    compraRepo.update(id, {
      numero: finalNum,
      fecha: b.fecha || ex.compra.fecha,
      punto_venta: b.punto_venta !== undefined ? String(b.punto_venta).trim() : ex.compra.punto_venta,
      cae: b.cae !== undefined ? String(b.cae).trim() : ex.compra.cae,
      cae_vto: b.cae_vto !== undefined ? String(b.cae_vto).trim() : ex.compra.cae_vto,
      estado: 'Confirmado',
    }, user);

    syncUltimoCostoProductos(ex.lineas);

    createCompraOperacion({
      id: Number(id),
      numero: finalNum,
      fecha: b.fecha || ex.compra.fecha,
      contacto_id: ex.compra.contacto_id,
      clase_documento: ex.compra.clase_documento || 'factura',
    }, ex.lineas, Boolean(b.recibir_inmediato), user);

    if (Number(ex.compra.total) > 0) {
      const asientoId = defaultAsientoService.generarAsientoCompra({
        ...ex.compra,
        id: Number(id),
        numero: finalNum,
        fecha: b.fecha || ex.compra.fecha,
      }, ex.impuestos, ex.lineas);
      if (asientoId) compraRepo.update(id, { asiento_id: asientoId }, user);
    }
    return true;
  });
}

export function deleteCompra(id, user = null) {
  const ex = getCompraById(id);
  if (!ex) return;
  compraRepo.transaction(() => {
    const ops = operacionStockRepo.query()
      .where('referencia_tipo', 'compra')
      .where('referencia_id', Number(id))
      .all();
    for (const op of ops) {
      if (op.estado === 'Confirmado') anularOperacionStock(op.id, user);
      else if (op.estado === 'Borrador') deleteOperacionStock(op.id);
    }
    compraRepo.delete(id);
  });
}

function syncUltimoCostoProductos(lineas) {
  const upd = db.prepare("UPDATE productos SET costo = ?, updated_at = datetime('now') WHERE id = ?");
  for (const l of lineas || []) {
    const pid = Number(l.producto_id || 0);
    const costo = Number(l.precio_unitario || 0);
    if (pid > 0 && costo > 0) upd.run(costo, pid);
  }
}
