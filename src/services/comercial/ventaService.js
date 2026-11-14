import { db } from '../../db.js';
import { BaseRepository } from '../../core/BaseRepository.js';
import { MODELS } from '../../db/models.js';
import { getNextNumeroDocumento } from '../config/configService.js';
import {
  anularOperacionStock,
  confirmarOperacionStock,
  createOperacionStock,
  deleteOperacionStock,
  operacionStockRepo,
} from '../inventario/operacionStockService.js';
import { defaultAsientoService } from '../finanzas/asientoService.js';
import { crearImputacion, getFacturaImputado } from '../finanzas/imputacionService.js';
import { validateComprobanteFiscal } from '../afip/fiscalRules.js';
import { incrementarUsoCupon } from './comercialReglasService.js';
import { calcularFechaVencimiento, getContactoCondiciones, resolverPrecioLista } from './condicionesComercialesService.js';
import { createCompra } from './compraService.js';
import { listProductos } from '../inventario/productoService.js';

function sanitizeVentaLineas(lineas, caracter = 'fiscal', tipoComp = 'FA-B') {
  if (!Array.isArray(lineas)) return [];
  const noIva = caracter === 'interno' || /-C$/i.test(String(tipoComp || ''));
  return lineas.map(l => {
    const tipo_linea = ['producto', 'envio', 'descuento', 'recargo'].includes(l.tipo_linea) ? l.tipo_linea : 'producto';
    const cantidad = Number(l.cantidad) || 0;
    const precio_unitario = Number(l.precio_unitario) || 0;
    const subtotal = l.subtotal !== undefined && l.subtotal !== '' ? Number(l.subtotal) : Number((cantidad * precio_unitario).toFixed(2));
    const alicuota_iva = noIva ? 0 : Math.max(0, Number(l.alicuota_iva ?? 21));
    const iva_monto = Number((subtotal * alicuota_iva / 100).toFixed(2));
    return {
      producto_id: l.producto_id ? Number(l.producto_id) : null,
      plantilla_id: l.plantilla_id ? Number(l.plantilla_id) : null,
      tipo_linea,
      descripcion: (l.descripcion || '').trim(),
      cantidad,
      udm: (l.udm || 'pares').trim(),
      precio_unitario,
      alicuota_iva,
      iva_monto,
      subtotal: Number(subtotal.toFixed(2)),
    };
  }).filter(l => l.producto_id || l.descripcion || l.cantidad > 0 || l.subtotal !== 0);
}

function sanitizeVentaImpuestos(impuestos, neto) {
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

function createVentaOperacion(venta, lineas, confirmar = false, user = null) {
  const isServicio = db.prepare(`
    SELECT pp.tipo FROM productos p
    JOIN producto_plantillas pp ON pp.id = p.plantilla_id
    WHERE p.id = ?
  `);
  const stockLines = (lineas || []).filter(l => {
    if (!l.producto_id || l.cantidad <= 0) return false;
    if (l.tipo_linea && l.tipo_linea !== 'producto') return false;
    const row = isServicio.get(l.producto_id);
    return !row || row.tipo !== 'servicio';
  });
  if (stockLines.length === 0) return null;

  const isNC = venta.clase_documento === 'nota_credito';
  const ubiRepo = new BaseRepository({ model: MODELS.ubicaciones });
  const prodTermId = venta.ubicacion_id
    || ubiRepo.query().select('id').where('codigo', 'PROD-TERM').get()?.id
    || ubiRepo.query().select('id').where('codigo', 'DEP-CENTRAL').get()?.id
    || null;
  const cliUbiId = ubiRepo.query().select('id').where('codigo', 'VIRT-CLI').get()?.id || null;

  return createOperacionStock({
    fecha: venta.fecha,
    tipo: isNC ? 'recepcion' : 'entrega',
    ubicacion_origen_id: isNC ? cliUbiId : prodTermId,
    ubicacion_destino_id: isNC ? prodTermId : cliUbiId,
    contacto_id: venta.contacto_id,
    referencia_tipo: 'venta',
    referencia_id: venta.id,
    estado: confirmar ? 'Confirmado' : 'Borrador',
    motivo: `${isNC ? 'Devolución NC' : 'Entrega'} ${venta.numero || `Venta #${venta.id}`}`,
    lineas: stockLines.map(l => ({
      producto_id: l.producto_id,
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      udm: l.udm,
    })),
  }, user);
}

function dispararAbastecimientoVenta(venta, lineas, user = null) {
  if (venta.clase_documento === 'nota_credito') return [];
  const prodMap = new Map(listProductos().map(p => [p.id, p]));
  const comprasPorProveedor = new Map();

  for (const l of (lineas || [])) {
    if (!l.producto_id || l.cantidad <= 0) continue;
    const prod = prodMap.get(Number(l.producto_id));
    if (!prod || prod.tipo === 'servicio') continue;

    const disponible = Math.max(0, Number(prod.stock) || 0);
    const faltante = Number(l.cantidad) - disponible;
    // Circuito Retail: producto comprable no fabricado con proveedor asignado
    if (faltante > 0 && Number(prod.se_compra) === 1 && Number(prod.se_fabrica) === 0 && prod.proveedor_id) {
      const cantComprar = Math.max(faltante, Number(prod.minimo_compra) || 0);
      const provId = Number(prod.proveedor_id);
      if (!comprasPorProveedor.has(provId)) comprasPorProveedor.set(provId, []);
      comprasPorProveedor.get(provId).push({
        producto_id: prod.id,
        descripcion: prod.nombre,
        cantidad: Number(cantComprar.toFixed(2)),
        udm: prod.udm || l.udm || 'unidades',
        precio_unitario: Number(prod.precio) || 0,
        alicuota_iva: Number(prod.alicuota_iva ?? 21),
      });
    }
  }

  const createdIds = [];
  for (const [provId, cmpLineas] of comprasPorProveedor.entries()) {
    const cmpId = createCompra({
      contacto_id: provId,
      fecha: venta.fecha,
      caracter: 'fiscal',
      estado: 'Borrador',
      observaciones: `Abastecimiento Retail por Venta ${venta.numero || `#${venta.id}`}`,
      lineas: cmpLineas,
    }, user);
    createdIds.push(cmpId);
  }
  return createdIds;
}

export function listVentas({ contacto_id, cliente_id, estado } = {}) {
  let sql = `
    SELECT v.*, c.nombre as cliente_nombre, c.nombre as contacto_nombre,
           (
             COALESCE((SELECT SUM(i.monto_imputado) FROM imputaciones i WHERE i.dominio = 'ventas' AND i.factura_id = v.id), 0)
             + COALESCE((SELECT SUM(cb.monto) FROM cobros cb WHERE cb.venta_id = v.id AND cb.estado = 'Confirmado'
               AND NOT EXISTS (SELECT 1 FROM imputaciones i2 WHERE i2.dominio = 'ventas' AND i2.comprobante_tipo = 'cobro' AND i2.comprobante_id = cb.id)), 0)
           ) as cobrado
    FROM ventas v
    JOIN contactos c ON c.id = v.contacto_id
    WHERE 1=1
  `;
  const args = [];
  const filterId = contacto_id || cliente_id;
  if (filterId) { sql += ' AND v.contacto_id = ?'; args.push(Number(filterId)); }
  if (estado) { sql += ' AND v.estado = ?'; args.push(estado); }
  sql += ' ORDER BY v.fecha DESC, v.id DESC';
  return db.prepare(sql).all(...args);
}

export function getVentaById(id) {
  const venta = db.prepare(`
    SELECT v.*,
           c.nombre as cliente_nombre,
           c.nombre as contacto_nombre,
           c.razon_social as cliente_razon_social,
           c.tipo_documento as cliente_tipo_documento,
           c.cuit as cliente_cuit,
           c.condicion_iva as cliente_condicion_iva,
           COALESCE(NULLIF(c.direccion_fiscal, ''), c.direccion, '') as cliente_direccion,
           c.localidad as cliente_localidad,
           c.provincia as cliente_provincia,
           c.codigo_postal as cliente_codigo_postal,
           c.telefono as cliente_telefono,
           c.email as cliente_email
    FROM ventas v
    JOIN contactos c ON c.id = v.contacto_id
    WHERE v.id = ?
  `).get(id);
  if (!venta) return null;
  const lineas = db.prepare(`
    SELECT vl.*, COALESCE(p.nombre, vl.descripcion) as producto_nombre
    FROM venta_lineas vl
    LEFT JOIN productos p ON p.id = vl.producto_id
    WHERE vl.venta_id = ?
    ORDER BY vl.id ASC
  `).all(id);
  const cobros = db.prepare(`
    SELECT cb.*, ct.nombre as cuenta_nombre
    FROM cobros cb
    LEFT JOIN cuentas ct ON ct.id = cb.cuenta_id
    WHERE cb.venta_id = ?
    ORDER BY cb.fecha DESC, cb.id DESC
  `).all(id);
  const impuestos = db.prepare('SELECT * FROM venta_impuestos WHERE venta_id = ? ORDER BY id ASC').all(id);
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

  const empIva = db.prepare('SELECT condicion_iva FROM empresa_config WHERE id = 1').get()?.condicion_iva || '';
  const cliRow = db.prepare('SELECT condicion_iva FROM contactos WHERE id = ?').get(contactoId);
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

  const diarioRow = diarioId ? db.prepare('SELECT * FROM diarios WHERE id = ?').get(diarioId) : null;
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
      ? String(db.prepare('SELECT numero FROM puntos_venta WHERE id = ?').get(diarioRow.punto_venta_id)?.numero || '')
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
  const neto = lineas.length > 0
    ? Number(lineas.reduce((s, l) => s + l.subtotal, 0).toFixed(2))
    : Number((Number(b.neto) || Number(b.total) || 0).toFixed(2));
  const ivaMonto = lineas.length > 0
    ? Number(lineas.reduce((s, l) => s + l.iva_monto, 0).toFixed(2))
    : Number((neto * Math.max(0, Number(b.alicuota_iva ?? 0)) / 100).toFixed(2));
  const alicuotaIva = neto > 0 ? Number(((ivaMonto / neto) * 100).toFixed(2)) : 0;
  const impuestos = sanitizeVentaImpuestos(b.impuestos, neto);
  const otrosImpuestosMonto = Number(impuestos.reduce((s, i) => s + (i.tipo === 'retencion' ? -i.monto : i.monto), 0).toFixed(2));
  const total = Number((neto + ivaMonto + otrosImpuestosMonto).toFixed(2));
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
  const rawNum = (b.numero || '').trim();
  const numero = (!rawNum || rawNum.endsWith('-'))
    ? getNextNumeroDocumento(seqCode, puntoVentaFinal).numero
    : rawNum;

  db.exec('BEGIN');
  try {
    const info = db.prepare(`
      INSERT INTO ventas (
        numero, clase_documento, comprobante_origen_id, diario_id,
        caracter, tipo_comprobante, punto_venta, cae, cae_vto,
        fecha, fecha_vencimiento, fecha_entrega_est, contacto_id,
        termino_pago_id, metodo_pago_id, lista_precio_id,
        jurisdiccion_codigo, ubicacion_id, estado,
        neto, alicuota_iva, iva_monto, otros_impuestos_monto, total, moneda, tipo_cambio,
        cupon_codigo, external_source, external_id, observaciones,
        autor_id, autor_nombre, actualizado_por_id, actualizado_por_nombre
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      numero,
      claseDocumento,
      b.comprobante_origen_id ? Number(b.comprobante_origen_id) : null,
      diarioId,
      caracter, tipoComprobante, puntoVentaFinal, (b.cae || '').trim(), (b.cae_vto || '').trim(),
      fecha,
      fechaVencimiento,
      (b.fecha_entrega_est || '').trim(),
      contactoId,
      terminoPagoId,
      metodoPagoId,
      listaPrecioId,
      (b.jurisdiccion_codigo || '').trim(),
      b.ubicacion_id ? Number(b.ubicacion_id) : null,
      estado,
      neto,
      alicuotaIva,
      ivaMonto,
      otrosImpuestosMonto,
      total,
      (b.moneda || 'ARS').toUpperCase(),
      Number(b.tipo_cambio) > 0 ? Number(b.tipo_cambio) : 1,
      (b.cupon_codigo || '').trim().toUpperCase(),
      (b.external_source || '').trim(),
      (b.external_id || '').trim(),
      (b.observaciones || '').trim(),
      user?.id || null, user?.nombre || 'Sistema', user?.id || null, user?.nombre || 'Sistema'
    );
    const id = Number(info.lastInsertRowid);
    const ins = db.prepare(`
      INSERT INTO venta_lineas (venta_id, producto_id, plantilla_id, tipo_linea, descripcion, cantidad, udm, precio_unitario, alicuota_iva, iva_monto, subtotal)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const l of lineas) ins.run(id, l.producto_id, l.plantilla_id, l.tipo_linea || 'producto', l.descripcion, l.cantidad, l.udm, l.precio_unitario, l.alicuota_iva, l.iva_monto, l.subtotal);
    const insImp = db.prepare(`
      INSERT INTO venta_impuestos (venta_id, impuesto_id, nombre, tipo, base, alicuota, monto)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const imp of impuestos) insImp.run(id, imp.impuesto_id, imp.nombre, imp.tipo, imp.base, imp.alicuota, imp.monto);
    if (estado === 'Confirmada' || estado === 'Entregada') {
      if (b.cupon_codigo) incrementarUsoCupon(b.cupon_codigo);
      syncUltimoPrecioProductos(lineas);
      if (claseDocumento === 'nota_credito' && b.comprobante_origen_id) {
        const facOrig = db.prepare('SELECT id, total FROM ventas WHERE id = ?').get(Number(b.comprobante_origen_id));
        if (facOrig) {
          const pend = Math.max(0, Number(facOrig.total || 0) - getFacturaImputado('ventas', facOrig.id));
          const aImputar = Number(Math.min(total, pend).toFixed(2));
          if (aImputar > 0) {
            crearImputacion({
              fecha,
              dominio: 'ventas',
              comprobante_tipo: 'nota_credito',
              comprobante_id: id,
              factura_id: facOrig.id,
              monto_imputado: aImputar,
            });
          }
        }
      }
      createVentaOperacion({
        id,
        numero,
        fecha,
        contacto_id: contactoId,
        clase_documento: claseDocumento,
      }, lineas, estado === 'Entregada', user);
      if (estado === 'Confirmada') {
        dispararAbastecimientoVenta({ id, numero, fecha, clase_documento: claseDocumento }, lineas, user);
      }
    }
    if ((estado === 'Confirmada' || estado === 'Entregada') && total > 0) {
      const lineasConCuenta = lineas.map(l => {
        if (l.producto_id) {
          const ptCta = db.prepare(`
            SELECT pt.cuenta_venta_id
            FROM productos p JOIN producto_plantillas pt ON pt.id = p.plantilla_id
            WHERE p.id = ?
          `).get(Number(l.producto_id));
          if (ptCta?.cuenta_venta_id) return { ...l, plan_cuenta_id: ptCta.cuenta_venta_id };
        }
        return l;
      });
      const asientoId = defaultAsientoService.generarAsientoVenta({
        id,
        numero,
        fecha,
        clase_documento: claseDocumento,
        diario_id: diarioId,
        caracter,
        tipo_comprobante: tipoComprobante,
        contacto_id: contactoId,
        neto,
        iva_monto: ivaMonto,
        total,
      }, impuestos, lineasConCuenta);
      if (asientoId) db.prepare('UPDATE ventas SET asiento_id = ? WHERE id = ?').run(asientoId, id);
    }
    db.exec('COMMIT');
    return id;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function updateVenta(id, b, user = null) {
  const ex = getVentaById(id);
  if (!ex) return false;
  const prev = ex.venta;
  const prevLineas = ex.lineas;
  const estado = b.estado !== undefined ? b.estado : prev.estado;
  const caracter = b.caracter !== undefined ? (b.caracter === 'interno' ? 'interno' : 'fiscal') : (prev.caracter || 'fiscal');
  const tipoComprobante = caracter === 'interno' ? 'INT' : (b.tipo_comprobante !== undefined ? b.tipo_comprobante : (prev.tipo_comprobante || 'FA-B'));
  const lineas = b.lineas !== undefined ? sanitizeVentaLineas(b.lineas, caracter, tipoComprobante) : prevLineas;
  const neto = lineas.length > 0
    ? Number(lineas.reduce((s, l) => s + l.subtotal, 0).toFixed(2))
    : Number((b.neto !== undefined ? Number(b.neto) : prev.neto).toFixed(2));
  const ivaMonto = lineas.length > 0
    ? Number(lineas.reduce((s, l) => s + (Number(l.iva_monto) || 0), 0).toFixed(2))
    : Number((neto * Math.max(0, Number(b.alicuota_iva !== undefined ? b.alicuota_iva : prev.alicuota_iva)) / 100).toFixed(2));
  const alicuotaIva = neto > 0 ? Number(((ivaMonto / neto) * 100).toFixed(2)) : 0;
  const impuestos = b.impuestos !== undefined ? sanitizeVentaImpuestos(b.impuestos, neto) : ex.impuestos;
  const otrosImpuestosMonto = Number((impuestos || []).reduce((s, i) => s + (i.tipo === 'retencion' ? -Number(i.monto) : Number(i.monto)), 0).toFixed(2));
  const total = Number((neto + ivaMonto + otrosImpuestosMonto).toFixed(2));

  db.exec('BEGIN');
  try {
    if (prev.estado === 'Entregada' && estado !== 'Entregada') {
      const ops = operacionStockRepo.query()
        .where('referencia_tipo', 'venta')
        .where('referencia_id', Number(id))
        .where('estado', 'Confirmado')
        .all();
      for (const op of ops) anularOperacionStock(op.id, user);
    }
    db.prepare(`
      UPDATE ventas SET numero=?, caracter=?, tipo_comprobante=?, punto_venta=?, cae=?, cae_vto=?, fecha=?, fecha_vencimiento=?, fecha_entrega_est=?, contacto_id=?, termino_pago_id=?, metodo_pago_id=?, lista_precio_id=?, estado=?, neto=?, alicuota_iva=?, iva_monto=?, otros_impuestos_monto=?, total=?, observaciones=?,
        actualizado_por_id=?, actualizado_por_nombre=?, updated_at=datetime('now')
      WHERE id=?
    `).run(
      b.numero !== undefined ? b.numero.trim() : prev.numero,
      caracter,
      tipoComprobante,
      b.punto_venta !== undefined ? String(b.punto_venta).trim() : (prev.punto_venta || ''),
      b.cae !== undefined ? b.cae.trim() : (prev.cae || ''),
      b.cae_vto !== undefined ? b.cae_vto.trim() : (prev.cae_vto || ''),
      b.fecha || prev.fecha,
      b.fecha_vencimiento !== undefined ? b.fecha_vencimiento.trim() : (prev.fecha_vencimiento || ''),
      b.fecha_entrega_est !== undefined ? b.fecha_entrega_est.trim() : prev.fecha_entrega_est,
      (b.contacto_id || b.cliente_id) ? Number(b.contacto_id || b.cliente_id) : prev.contacto_id,
      b.termino_pago_id !== undefined ? (b.termino_pago_id ? Number(b.termino_pago_id) : null) : (prev.termino_pago_id || null),
      b.metodo_pago_id !== undefined ? (b.metodo_pago_id ? Number(b.metodo_pago_id) : null) : (prev.metodo_pago_id || null),
      b.lista_precio_id !== undefined ? (b.lista_precio_id ? Number(b.lista_precio_id) : null) : (prev.lista_precio_id || null),
      estado,
      neto,
      alicuotaIva,
      ivaMonto,
      otrosImpuestosMonto,
      total,
      b.observaciones !== undefined ? b.observaciones.trim() : prev.observaciones,
      user?.id || null,
      user?.nombre || 'Sistema',
      id
    );
    if (b.lineas !== undefined) {
      db.prepare('DELETE FROM venta_lineas WHERE venta_id = ?').run(id);
      const ins = db.prepare(`
        INSERT INTO venta_lineas (venta_id, producto_id, plantilla_id, tipo_linea, descripcion, cantidad, udm, precio_unitario, alicuota_iva, iva_monto, subtotal)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const l of lineas) ins.run(id, l.producto_id, l.plantilla_id, l.tipo_linea || 'producto', l.descripcion, l.cantidad, l.udm, l.precio_unitario, l.alicuota_iva, l.iva_monto, l.subtotal);
    }
    if (b.impuestos !== undefined) {
      db.prepare('DELETE FROM venta_impuestos WHERE venta_id = ?').run(id);
      const insImp = db.prepare(`
        INSERT INTO venta_impuestos (venta_id, impuesto_id, nombre, tipo, base, alicuota, monto)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const imp of impuestos) insImp.run(id, imp.impuesto_id, imp.nombre, imp.tipo, imp.base, imp.alicuota, imp.monto);
    }
    if (estado === 'Confirmada' || estado === 'Entregada') {
      if (b.cupon_codigo) incrementarUsoCupon(b.cupon_codigo);
      syncUltimoPrecioProductos(lineas);
      if (claseDocumento === 'nota_credito' && b.comprobante_origen_id) {
        const facOrig = db.prepare('SELECT id, total FROM ventas WHERE id = ?').get(Number(b.comprobante_origen_id));
        if (facOrig) {
          const pend = Math.max(0, Number(facOrig.total || 0) - getFacturaImputado('ventas', facOrig.id));
          const aImputar = Number(Math.min(total, pend).toFixed(2));
          if (aImputar > 0) {
            crearImputacion({
              fecha,
              dominio: 'ventas',
              comprobante_tipo: 'nota_credito',
              comprobante_id: id,
              factura_id: facOrig.id,
              monto_imputado: aImputar,
            });
          }
        }
      }
      const existingOps = operacionStockRepo.query()
        .where('referencia_tipo', 'venta')
        .where('referencia_id', Number(id))
        .all();
      const nextNum = b.numero !== undefined ? b.numero.trim() : prev.numero;
      const nextFecha = b.fecha || prev.fecha;

      if (existingOps.length === 0) {
        createVentaOperacion({
          id,
          numero: nextNum,
          fecha: nextFecha,
          contacto_id: (b.contacto_id || b.cliente_id) ? Number(b.contacto_id || b.cliente_id) : prev.contacto_id,
          clase_documento: prev.clase_documento || 'factura',
        }, lineas, estado === 'Entregada', user);
        if (estado === 'Confirmada' && (prev.estado === 'Presupuesto' || prev.estado === 'Borrador')) {
          dispararAbastecimientoVenta({ id: Number(id), numero: nextNum, fecha: nextFecha, clase_documento: prev.clase_documento || 'factura' }, lineas, user);
        }
      } else if (estado === 'Entregada') {
        for (const op of existingOps) {
          if (op.estado === 'Borrador') confirmarOperacionStock(op.id, user);
        }
      }
    }
    db.exec('COMMIT');
    return true;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function deleteVenta(id, user = null) {
  const ex = getVentaById(id);
  if (!ex) return;
  db.exec('BEGIN');
  try {
    const ops = operacionStockRepo.query()
      .where('referencia_tipo', 'venta')
      .where('referencia_id', Number(id))
      .all();
    for (const op of ops) {
      if (op.estado === 'Confirmado') anularOperacionStock(op.id, user);
      else if (op.estado === 'Borrador') deleteOperacionStock(op.id);
    }
    db.prepare('DELETE FROM ventas WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function syncUltimoPrecioProductos(lineas) {
  const upd = db.prepare("UPDATE productos SET precio = ?, updated_at = datetime('now') WHERE id = ?");
  for (const l of lineas || []) {
    const pid = Number(l.producto_id || 0);
    const precio = Number(l.precio_unitario || 0);
    if (pid > 0 && precio > 0) upd.run(precio, pid);
  }
}
