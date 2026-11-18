import { BaseRepository } from '../../core/BaseRepository.js';
import { MODELS } from '../../db/models.js';
import { defaultAsientoService } from './asientoService.js';

const impRepo = new BaseRepository({ model: MODELS.imputaciones });
const pagoRepo = new BaseRepository({ model: MODELS.pagos });
const cobroRepo = new BaseRepository({ model: MODELS.cobros });
const compraRepo = new BaseRepository({ model: MODELS.compras });
const ventaRepo = new BaseRepository({ model: MODELS.ventas });
const planCuentaRepo = new BaseRepository({ model: MODELS.plan_cuentas });
const asientoLineaRepo = new BaseRepository({ model: MODELS.asiento_lineas });

export function getFacturaImputado(dominio, facturaId) {
  const fId = Number(facturaId);
  const impSum = impRepo.query()
    .where('dominio', dominio)
    .where('factura_id', fId)
    .sum('monto_imputado');

  // Compatibilidad con registros anteriores que usaban compra_id / venta_id sin fila en imputaciones
  let legacySum = 0;
  if (dominio === 'compras') {
    const imputedPagoIds = new Set(
      impRepo.query()
        .select('comprobante_id')
        .where('dominio', 'compras')
        .where('comprobante_tipo', 'pago')
        .all()
        .map(r => Number(r.comprobante_id))
    );
    legacySum = pagoRepo.query()
      .select('id', 'monto', 'total_bruto')
      .where('compra_id', fId)
      .where('estado', 'Confirmado')
      .all()
      .filter(p => !imputedPagoIds.has(Number(p.id)))
      .reduce((s, p) => s + Number(p.total_bruto || p.monto || 0), 0);
  } else {
    const imputedCobroIds = new Set(
      impRepo.query()
        .select('comprobante_id')
        .where('dominio', 'ventas')
        .where('comprobante_tipo', 'cobro')
        .all()
        .map(r => Number(r.comprobante_id))
    );
    legacySum = cobroRepo.query()
      .select('id', 'monto')
      .where('venta_id', fId)
      .where('estado', 'Confirmado')
      .all()
      .filter(cb => !imputedCobroIds.has(Number(cb.id)))
      .reduce((s, cb) => s + Number(cb.monto || 0), 0);
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
    const p = pagoRepo.query().select('id', 'contacto_id', 'compra_id', 'monto', 'total_bruto', 'moneda', 'tipo_cambio', 'estado').where('id', cId).get();
    if (!p || p.estado !== 'Confirmado') return { total: 0, imputado: 0, disponible: 0 };
    totalDoc = Number(p.total_bruto || p.monto || 0);
    moneda = p.moneda || 'ARS';
    tipoCambio = Number(p.tipo_cambio || 1);
    contactoId = p.contacto_id;
    const impSum = impRepo.query()
      .where('dominio', 'compras')
      .where('comprobante_tipo', 'pago')
      .where('comprobante_id', cId)
      .sum('monto_imputado');
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
    const cb = cobroRepo.query().select('id', 'contacto_id', 'venta_id', 'monto', 'moneda', 'tipo_cambio', 'estado').where('id', cId).get();
    if (!cb || cb.estado !== 'Confirmado') return { total: 0, imputado: 0, disponible: 0 };
    totalDoc = Number(cb.monto || 0);
    moneda = cb.moneda || 'ARS';
    tipoCambio = Number(cb.tipo_cambio || 1);
    contactoId = cb.contacto_id;
    const impSum = impRepo.query()
      .where('dominio', 'ventas')
      .where('comprobante_tipo', 'cobro')
      .where('comprobante_id', cId)
      .sum('monto_imputado');
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
  const docRepo = dominio === 'compras' ? compraRepo : ventaRepo;
  const nc = docRepo.query().select('id', 'contacto_id', 'total', 'moneda', 'tipo_cambio', 'clase_documento', 'estado').where('id', cId).get();
  if (!nc || nc.clase_documento !== 'nota_credito' || ['Borrador', 'Presupuesto', 'Anulada', 'Cancelado'].includes(nc.estado)) {
    return { total: 0, imputado: 0, disponible: 0 };
  }
  totalDoc = Number(nc.total || 0);
  const impSum = impRepo.query()
    .where('dominio', dominio)
    .where('comprobante_tipo', 'nota_credito')
    .where('comprobante_id', cId)
    .sum('monto_imputado');
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

  const docRepo = dominio === 'compras' ? compraRepo : ventaRepo;
  const factura = docRepo.findById(Number(factura_id));
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
      const findCta = (cod) => planCuentaRepo.query().select('id', 'codigo', 'nombre').where('codigo', cod).limit(1).get();
      const ctaDeudores = findCta('1.1.03');
      const ctaProv = findCta('2.1.01');
      const ctaDcPos = findCta('4.2.01');
      const ctaDcNeg = findCta('5.2.08');
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
  const docRepo = isVentas ? ventaRepo : compraRepo;

  const facturas = docRepo.query()
    .select('id', 'fecha', 'numero', 'tipo_comprobante', 'clase_documento', 'moneda', 'tipo_cambio', 'total', 'estado')
    .where('contacto_id', cId)
    .where('clase_documento', '!=', 'nota_credito')
    .whereNotIn('estado', ['Borrador', 'Presupuesto', 'Anulada', 'Cancelado'])
    .orderBy('fecha', 'ASC')
    .orderBy('id', 'ASC')
    .all()
    .map(f => {
      const imputado = getFacturaImputado(dominio, f.id);
      const pendiente = Number(Math.max(0, Number(f.total || 0) - imputado).toFixed(2));
      return { ...f, imputado, pendiente };
    });

  const comprobantes = [];
  if (isVentas) {
    const cobros = cobroRepo.query()
      .select('id', 'fecha', 'numero', 'metodo', 'monto', 'moneda', 'tipo_cambio')
      .where('contacto_id', cId)
      .where('estado', 'Confirmado')
      .orderBy('fecha', 'ASC')
      .orderBy('id', 'ASC')
      .all();
    for (const c of cobros) {
      const disp = getComprobanteDisponible('ventas', 'cobro', c.id);
      comprobantes.push({ ...c, comprobante_tipo: 'cobro', total: disp.total, imputado: disp.imputado, disponible: disp.disponible });
    }
  } else {
    const pagos = pagoRepo.query()
      .select('id', 'fecha', 'numero', 'metodo', 'monto', 'total_retenciones', 'total_bruto', 'moneda', 'tipo_cambio')
      .where('contacto_id', cId)
      .where('estado', 'Confirmado')
      .orderBy('fecha', 'ASC')
      .orderBy('id', 'ASC')
      .all();
    for (const p of pagos) {
      const disp = getComprobanteDisponible('compras', 'pago', p.id);
      comprobantes.push({ ...p, comprobante_tipo: 'pago', total: disp.total, imputado: disp.imputado, disponible: disp.disponible });
    }
  }

  const ncs = docRepo.query()
    .select('id', 'fecha', 'numero', 'tipo_comprobante', 'total', 'moneda', 'tipo_cambio')
    .where('contacto_id', cId)
    .where('clase_documento', 'nota_credito')
    .whereNotIn('estado', ['Borrador', 'Presupuesto', 'Anulada', 'Cancelado'])
    .orderBy('fecha', 'ASC')
    .orderBy('id', 'ASC')
    .all();
  for (const nc of ncs) {
    const disp = getComprobanteDisponible(dominio, 'nota_credito', nc.id);
    comprobantes.push({ ...nc, comprobante_tipo: 'nota_credito', total: disp.total, imputado: disp.imputado, disponible: disp.disponible });
  }

  const imputaciones = impRepo.query('i')
    .select('i.*', 'f.numero AS factura_numero', 'f.total AS factura_total')
    .innerJoin(table, 'f', 'f.id', 'i.factura_id')
    .where('i.dominio', dominio)
    .where('f.contacto_id', cId)
    .orderBy('i.fecha', 'DESC')
    .orderBy('i.id', 'DESC')
    .all();

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
    const docRepo = isVentas ? ventaRepo : compraRepo;
    const cta = planCuentaRepo.query().where('codigo', codigoCuenta).get();
    let saldoContable = 0;
    if (cta) {
      const row = asientoLineaRepo.query('al')
        .select('COALESCE(SUM(al.debe - al.haber), 0) AS neto')
        .innerJoin('asientos', 'a', 'a.id', 'al.asiento_id')
        .where('al.plan_cuenta_id', cta.id)
        .whereIn('a.estado', ['Confirmado', 'confirmado'])
        .get();
      saldoContable = Number((isVentas ? (row?.neto || 0) : -(row?.neto || 0)).toFixed(2));
    }

    const facturas = docRepo.query()
      .select('id', 'fecha', 'fecha_vencimiento', 'total')
      .where('clase_documento', '!=', 'nota_credito')
      .whereNotIn('estado', ['Borrador', 'Presupuesto', 'Anulada', 'Cancelado'])
      .all();

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
      const cobros = cobroRepo.query().select('id').where('estado', 'Confirmado').all();
      for (const c of cobros) totalSinImputar += getComprobanteDisponible('ventas', 'cobro', c.id).disponible;
    } else {
      const pagos = pagoRepo.query().select('id').where('estado', 'Confirmado').all();
      for (const p of pagos) totalSinImputar += getComprobanteDisponible('compras', 'pago', p.id).disponible;
    }
    const ncs = docRepo.query()
      .select('id')
      .where('clase_documento', 'nota_credito')
      .whereNotIn('estado', ['Borrador', 'Presupuesto', 'Anulada', 'Cancelado'])
      .all();
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
