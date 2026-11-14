import { db } from '../../db.js';
import { BaseRepository } from '../../core/BaseRepository.js';
import { MODELS } from '../../db/models.js';
import { defaultAsientoService } from './asientoService.js';

const impRepo = new BaseRepository({ model: MODELS.imputaciones });

export function getFacturaImputado(dominio, facturaId) {
  const fId = Number(facturaId);
  const impSum = db.prepare(
    'SELECT COALESCE(SUM(monto_imputado), 0) AS t FROM imputaciones WHERE dominio = ? AND factura_id = ?'
  ).get(dominio, fId).t;

  // Compatibilidad con registros anteriores que usaban compra_id / venta_id sin fila en imputaciones
  let legacySum = 0;
  if (dominio === 'compras') {
    legacySum = db.prepare(`
      SELECT COALESCE(SUM(COALESCE(NULLIF(p.total_bruto, 0), p.monto)), 0) AS t
      FROM pagos p
      WHERE p.compra_id = ? AND p.estado = 'Confirmado'
        AND NOT EXISTS (SELECT 1 FROM imputaciones i WHERE i.dominio = 'compras' AND i.comprobante_tipo = 'pago' AND i.comprobante_id = p.id)
    `).get(fId).t;
  } else {
    legacySum = db.prepare(`
      SELECT COALESCE(SUM(cb.monto), 0) AS t
      FROM cobros cb
      WHERE cb.venta_id = ? AND cb.estado = 'Confirmado'
        AND NOT EXISTS (SELECT 1 FROM imputaciones i WHERE i.dominio = 'ventas' AND i.comprobante_tipo = 'cobro' AND i.comprobante_id = cb.id)
    `).get(fId).t;
  }
  return Number((Number(impSum || 0) + Number(legacySum || 0)).toFixed(2));
}

export function getComprobanteDisponible(dominio, tipo, comprobanteId) {
  const cId = Number(comprobanteId);
  let totalDoc = 0;
  let moneda = 'ARS';
  let tipoCambio = 1;
  let contactoId = null;

  if (tipo === 'pago') {
    const p = db.prepare('SELECT id, contacto_id, compra_id, monto, total_bruto, moneda, tipo_cambio, estado FROM pagos WHERE id = ?').get(cId);
    if (!p || p.estado !== 'Confirmado') return { total: 0, imputado: 0, disponible: 0 };
    totalDoc = Number(p.total_bruto || p.monto || 0);
    moneda = p.moneda || 'ARS';
    tipoCambio = Number(p.tipo_cambio || 1);
    contactoId = p.contacto_id;
    const impSum = db.prepare(
      "SELECT COALESCE(SUM(monto_imputado), 0) AS t FROM imputaciones WHERE dominio = 'compras' AND comprobante_tipo = 'pago' AND comprobante_id = ?"
    ).get(cId).t;
    const imputado = impSum > 0 ? impSum : (p.compra_id ? totalDoc : 0);
    return {
      total: Number(totalDoc.toFixed(2)),
      imputado: Number(imputado.toFixed(2)),
      disponible: Number(Math.max(0, totalDoc - imputado).toFixed(2)),
      moneda,
      tipo_cambio: tipoCambio,
      contacto_id: contactoId,
    };
  }

  if (tipo === 'cobro') {
    const cb = db.prepare('SELECT id, contacto_id, venta_id, monto, moneda, tipo_cambio, estado FROM cobros WHERE id = ?').get(cId);
    if (!cb || cb.estado !== 'Confirmado') return { total: 0, imputado: 0, disponible: 0 };
    totalDoc = Number(cb.monto || 0);
    moneda = cb.moneda || 'ARS';
    tipoCambio = Number(cb.tipo_cambio || 1);
    contactoId = cb.contacto_id;
    const impSum = db.prepare(
      "SELECT COALESCE(SUM(monto_imputado), 0) AS t FROM imputaciones WHERE dominio = 'ventas' AND comprobante_tipo = 'cobro' AND comprobante_id = ?"
    ).get(cId).t;
    const imputado = impSum > 0 ? impSum : (cb.venta_id ? totalDoc : 0);
    return {
      total: Number(totalDoc.toFixed(2)),
      imputado: Number(imputado.toFixed(2)),
      disponible: Number(Math.max(0, totalDoc - imputado).toFixed(2)),
      moneda,
      tipo_cambio: tipoCambio,
      contacto_id: contactoId,
    };
  }

  // nota_credito
  const table = dominio === 'compras' ? 'compras' : 'ventas';
  const nc = db.prepare(`SELECT id, contacto_id, total, moneda, tipo_cambio, clase_documento, estado FROM ${table} WHERE id = ?`).get(cId);
  if (!nc || nc.clase_documento !== 'nota_credito' || ['Borrador', 'Presupuesto', 'Anulada', 'Cancelado'].includes(nc.estado)) {
    return { total: 0, imputado: 0, disponible: 0 };
  }
  totalDoc = Number(nc.total || 0);
  const impSum = db.prepare(
    "SELECT COALESCE(SUM(monto_imputado), 0) AS t FROM imputaciones WHERE dominio = ? AND comprobante_tipo = 'nota_credito' AND comprobante_id = ?"
  ).get(dominio, cId).t;
  return {
    total: Number(totalDoc.toFixed(2)),
    imputado: Number(impSum.toFixed(2)),
    disponible: Number(Math.max(0, totalDoc - impSum).toFixed(2)),
    moneda: nc.moneda || 'ARS',
    tipo_cambio: Number(nc.tipo_cambio || 1),
    contacto_id: nc.contacto_id,
  };
}

export function crearImputacion({ fecha, dominio, comprobante_tipo, comprobante_id, factura_id, monto_imputado, generar_asiento_dc = true } = {}) {
  if (!['compras', 'ventas'].includes(dominio)) throw new Error('Dominio inválido (compras/ventas)');
  if (!['pago', 'cobro', 'nota_credito'].includes(comprobante_tipo)) throw new Error('Tipo de comprobante inválido');

  const monto = Number(Number(monto_imputado || 0).toFixed(2));
  if (monto <= 0) throw new Error('El monto a imputar debe ser mayor a 0');

  const table = dominio === 'compras' ? 'compras' : 'ventas';
  const factura = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(factura_id));
  if (!factura) throw new Error('Factura no encontrada');
  if (factura.clase_documento === 'nota_credito') throw new Error('No se puede imputar sobre una Nota de Crédito');

  const compInfo = getComprobanteDisponible(dominio, comprobante_tipo, comprobante_id);
  if (monto > compInfo.disponible + 0.01) {
    throw new Error(`El monto (${monto}) supera el saldo sin imputar del comprobante (${compInfo.disponible})`);
  }

  const yaImputadoFac = getFacturaImputado(dominio, factura.id);
  const pendienteFac = Number(Math.max(0, Number(factura.total || 0) - yaImputadoFac).toFixed(2));
  if (monto > pendienteFac + 0.01) {
    throw new Error(`El monto (${monto}) supera el saldo pendiente de la factura (${pendienteFac})`);
  }

  const fch = fecha || new Date().toISOString().slice(0, 10);
  const id = impRepo.create({
    fecha: fch,
    dominio,
    comprobante_tipo,
    comprobante_id: Number(comprobante_id),
    factura_id: factura.id,
    monto_imputado: monto,
  });

  // Diferencia de cambio automática si es moneda extranjera con distinto tipo de cambio
  if (generar_asiento_dc && (factura.moneda || 'ARS') !== 'ARS') {
    const tcFac = Number(factura.tipo_cambio || 1);
    const tcComp = Number(compInfo.tipo_cambio || 1);
    const diffArs = Number((monto * (tcComp - tcFac)).toFixed(2));
    if (Math.abs(diffArs) >= 0.01) {
      const ctaDeudores = db.prepare("SELECT id, codigo, nombre FROM plan_cuentas WHERE codigo = '1.1.03' LIMIT 1").get();
      const ctaProv = db.prepare("SELECT id, codigo, nombre FROM plan_cuentas WHERE codigo = '2.1.01' LIMIT 1").get();
      const ctaDcPos = db.prepare("SELECT id, codigo, nombre FROM plan_cuentas WHERE codigo = '4.2.01' LIMIT 1").get();
      const ctaDcNeg = db.prepare("SELECT id, codigo, nombre FROM plan_cuentas WHERE codigo = '5.2.08' LIMIT 1").get();
      const absDiff = Math.abs(diffArs);

      const lineasDc = [];
      if (dominio === 'ventas') {
        if (diffArs > 0) {
          lineasDc.push({ plan_cuenta_id: ctaDeudores?.id || null, cuenta_contable: '1.1.03 Deudores por Ventas', debe: absDiff, haber: 0 });
          lineasDc.push({ plan_cuenta_id: ctaDcPos?.id || null, cuenta_contable: '4.2.01 Diferencia de Cambio Positiva', debe: 0, haber: absDiff });
        } else {
          lineasDc.push({ plan_cuenta_id: ctaDcNeg?.id || null, cuenta_contable: '5.2.08 Diferencia de Cambio Negativa', debe: absDiff, haber: 0 });
          lineasDc.push({ plan_cuenta_id: ctaDeudores?.id || null, cuenta_contable: '1.1.03 Deudores por Ventas', debe: 0, haber: absDiff });
        }
      } else {
        if (diffArs > 0) {
          lineasDc.push({ plan_cuenta_id: ctaDcNeg?.id || null, cuenta_contable: '5.2.08 Diferencia de Cambio Negativa', debe: absDiff, haber: 0 });
          lineasDc.push({ plan_cuenta_id: ctaProv?.id || null, cuenta_contable: '2.1.01 Proveedores', debe: 0, haber: absDiff });
        } else {
          lineasDc.push({ plan_cuenta_id: ctaProv?.id || null, cuenta_contable: '2.1.01 Proveedores', debe: absDiff, haber: 0 });
          lineasDc.push({ plan_cuenta_id: ctaDcPos?.id || null, cuenta_contable: '4.2.01 Diferencia de Cambio Positiva', debe: 0, haber: absDiff });
        }
      }
      defaultAsientoService.createAsiento({
        fecha: fch,
        tipo_origen: 'diferencia_cambio',
        origen_id: id,
        concepto: `Dif. de cambio ${factura.moneda} (${factura.numero || `#${factura.id}`})`,
        lineas: lineasDc,
      });
    }
  }

  return id;
}

export function eliminarImputacion(id) {
  const impId = Number(id);
  const asientoRepo = new BaseRepository({ model: MODELS.asientos });
  asientoRepo.query().where('tipo_origen', 'diferencia_cambio').where('origen_id', impId).delete();
  impRepo.delete(impId);
}

export function getEstadoCuentaContacto(contactoId, dominio = 'ventas') {
  const cId = Number(contactoId);
  const isVentas = dominio !== 'compras';
  const table = isVentas ? 'ventas' : 'compras';

  const facturas = db.prepare(`
    SELECT id, fecha, numero, tipo_comprobante, clase_documento, moneda, tipo_cambio, total, estado
    FROM ${table}
    WHERE contacto_id = ? AND clase_documento != 'nota_credito' AND estado NOT IN ('Borrador', 'Presupuesto', 'Anulada', 'Cancelado')
    ORDER BY fecha ASC, id ASC
  `).all(cId).map(f => {
    const imputado = getFacturaImputado(dominio, f.id);
    const pendiente = Number(Math.max(0, Number(f.total || 0) - imputado).toFixed(2));
    return { ...f, imputado, pendiente };
  });

  const comprobantes = [];
  if (isVentas) {
    const cobros = db.prepare(`
      SELECT id, fecha, numero, metodo, monto, moneda, tipo_cambio
      FROM cobros WHERE contacto_id = ? AND estado = 'Confirmado'
      ORDER BY fecha ASC, id ASC
    `).all(cId);
    for (const c of cobros) {
      const disp = getComprobanteDisponible('ventas', 'cobro', c.id);
      comprobantes.push({ ...c, comprobante_tipo: 'cobro', total: disp.total, imputado: disp.imputado, disponible: disp.disponible });
    }
  } else {
    const pagos = db.prepare(`
      SELECT id, fecha, numero, metodo, monto, total_retenciones, total_bruto, moneda, tipo_cambio
      FROM pagos WHERE contacto_id = ? AND estado = 'Confirmado'
      ORDER BY fecha ASC, id ASC
    `).all(cId);
    for (const p of pagos) {
      const disp = getComprobanteDisponible('compras', 'pago', p.id);
      comprobantes.push({ ...p, comprobante_tipo: 'pago', total: disp.total, imputado: disp.imputado, disponible: disp.disponible });
    }
  }

  const ncs = db.prepare(`
    SELECT id, fecha, numero, tipo_comprobante, total, moneda, tipo_cambio
    FROM ${table}
    WHERE contacto_id = ? AND clase_documento = 'nota_credito' AND estado NOT IN ('Borrador', 'Presupuesto', 'Anulada', 'Cancelado')
    ORDER BY fecha ASC, id ASC
  `).all(cId);
  for (const nc of ncs) {
    const disp = getComprobanteDisponible(dominio, 'nota_credito', nc.id);
    comprobantes.push({ ...nc, comprobante_tipo: 'nota_credito', total: disp.total, imputado: disp.imputado, disponible: disp.disponible });
  }

  const imputaciones = db.prepare(`
    SELECT i.*, f.numero AS factura_numero, f.total AS factura_total
    FROM imputaciones i
    JOIN ${table} f ON f.id = i.factura_id
    WHERE i.dominio = ? AND f.contacto_id = ?
    ORDER BY i.fecha DESC, i.id DESC
  `).all(dominio, cId);

  return { contacto_id: cId, dominio, facturas, comprobantes, imputaciones };
}

function calcAgingBucket(fechaRef, fechaCorte) {
  const dRef = new Date(fechaRef);
  const dCorte = new Date(fechaCorte);
  const dias = Math.floor((dCorte - dRef) / 86400000);
  if (dias <= 0) return 'corriente';
  if (dias <= 30) return 'd1_30';
  if (dias <= 60) return 'd31_60';
  if (dias <= 90) return 'd61_90';
  return 'mas_90';
}

export function getCuadreCuentasCorrientes({
  fecha_corte,
  cuentaClientes = '1.1.03',
  cuentaProveedores = '2.1.01',
} = {}) {
  const corte = fecha_corte || new Date().toISOString().slice(0, 10);

  const calcDominio = (dominio, codigoCuenta) => {
    const isVentas = dominio === 'ventas';
    const table = isVentas ? 'ventas' : 'compras';
    const cta = new BaseRepository({ model: MODELS.plan_cuentas }).query().where('codigo', codigoCuenta).get();
    let saldoContable = 0;
    if (cta) {
      const row = db.prepare(`
        SELECT COALESCE(SUM(al.debe - al.haber), 0) AS neto
        FROM asiento_lineas al
        JOIN asientos a ON a.id = al.asiento_id
        WHERE al.plan_cuenta_id = ? AND LOWER(a.estado) = 'confirmado'
      `).get(cta.id);
      saldoContable = Number((isVentas ? row.neto : -row.neto).toFixed(2));
    }

    const facturas = db.prepare(`
      SELECT id, fecha, fecha_vencimiento, total
      FROM ${table}
      WHERE clase_documento != 'nota_credito' AND estado NOT IN ('Borrador', 'Presupuesto', 'Anulada', 'Cancelado')
    `).all();

    const aging = { corriente: 0, d1_30: 0, d31_60: 0, d61_90: 0, mas_90: 0 };
    let totalPendienteFacturas = 0;
    for (const f of facturas) {
      const pend = Math.max(0, Number(f.total || 0) - getFacturaImputado(dominio, f.id));
      if (pend <= 0.01) continue;
      totalPendienteFacturas += pend;
      const bucket = calcAgingBucket(f.fecha_vencimiento || f.fecha, corte);
      aging[bucket] = Number((aging[bucket] + pend).toFixed(2));
    }

    // Restar anticipos / cobros / pagos / NC sin imputar
    let totalSinImputar = 0;
    if (isVentas) {
      const cobros = db.prepare("SELECT id FROM cobros WHERE estado = 'Confirmado'").all();
      for (const c of cobros) totalSinImputar += getComprobanteDisponible('ventas', 'cobro', c.id).disponible;
    } else {
      const pagos = db.prepare("SELECT id FROM pagos WHERE estado = 'Confirmado'").all();
      for (const p of pagos) totalSinImputar += getComprobanteDisponible('compras', 'pago', p.id).disponible;
    }
    const ncs = db.prepare(`SELECT id FROM ${table} WHERE clase_documento = 'nota_credito' AND estado NOT IN ('Borrador', 'Presupuesto', 'Anulada', 'Cancelado')`).all();
    for (const nc of ncs) totalSinImputar += getComprobanteDisponible(dominio, 'nota_credito', nc.id).disponible;

    const saldoOperativo = Number((totalPendienteFacturas - totalSinImputar).toFixed(2));
    const diferencia = Number((saldoContable - saldoOperativo).toFixed(2));

    return {
      cuenta_codigo: codigoCuenta,
      cuenta_nombre: cta?.nombre || '',
      saldo_contable: saldoContable,
      pendiente_facturas: Number(totalPendienteFacturas.toFixed(2)),
      anticipos_sin_imputar: Number(totalSinImputar.toFixed(2)),
      saldo_operativo: saldoOperativo,
      diferencia,
      cuadrado: Math.abs(diferencia) < 0.05,
      aging,
    };
  };

  return {
    fecha_corte: corte,
    clientes: calcDominio('ventas', cuentaClientes),
    proveedores: calcDominio('compras', cuentaProveedores),
  };
}
