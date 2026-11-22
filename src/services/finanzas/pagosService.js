import { BaseRepository } from '../../core/BaseRepository.js';
import { createStateMachine } from '../../core/stateMachine.js';
import { MODELS } from '../../db/models.js';

const PAGO_SM = createStateMachine({
  Borrador: ['Confirmado'],
  Confirmado: ['Anulado'],
  Anulado: [],
}, { label: 'Pago' });
import { getNextNumeroDocumento, resolveNumeroDocumento } from '../config/configService.js';
import { defaultChequeService } from './chequeService.js';
import { defaultAsientoService } from './asientoService.js';
import { crearImputacion, getFacturaImputado } from './imputacionService.js';
import {
  asientoRepo,
  cuentaRepo,
  pagoRepo,
  pagoLineaRepo,
  registrarAsiento,
  recalcCuentaSaldo,
  sanitizeTesoreriaLineas,
  validateCuentaMetodoLineas,
} from './cuentasService.js';

const pagoRetencionRepo = new BaseRepository({ model: MODELS.pago_retenciones });
const impuestoConfigRepo = new BaseRepository({ table: 'impuestos_config' });
const metodoPagoRepo = new BaseRepository({ table: 'metodos_pago' });
const planCuentaRepo = new BaseRepository({ model: MODELS.plan_cuentas });
const compraRepo = new BaseRepository({ model: MODELS.compras });
const imputacionRepo = new BaseRepository({ table: 'imputaciones' });

export function listPagos({ cuenta_id, contacto_id, proveedor_id } = {}) {
  const qb = pagoRepo.query('p')
    .select("p.*, COALESCE(c.nombre, '') as cuenta_nombre, COALESCE(co.nombre, '') as proveedor_nombre, COALESCE(co.nombre, '') as contacto_nombre")
    .leftJoin('cuentas', 'c', 'c.id', 'p.cuenta_id')
    .leftJoin('contactos', 'co', 'co.id', 'p.contacto_id');
  const filterContacto = contacto_id || proveedor_id;
  if (cuenta_id) qb.where('p.cuenta_id', Number(cuenta_id));
  if (filterContacto) qb.where('p.contacto_id', Number(filterContacto));
  const rows = qb.orderBy('p.fecha', 'DESC').orderBy('p.id', 'DESC').all();
  const asientos = asientoRepo.query().select('id, origen_id').where('tipo_origen', 'pago').all();
  const asientoByOrigen = new Map(asientos.map(a => [Number(a.origen_id), a.id]));
  return rows.map(r => ({ ...r, asiento_id: asientoByOrigen.get(Number(r.id)) || null }));
}

export function getPagoById(id) {
  const pago = pagoRepo.query('p')
    .select(
      'p.*',
      "COALESCE(c.nombre, '') as cuenta_nombre",
      "COALESCE(co.nombre, '') as proveedor_nombre",
      "COALESCE(co.nombre, '') as contacto_nombre",
      "COALESCE(NULLIF(co.razon_social, ''), co.nombre, '') as contacto_razon_social",
      "COALESCE(co.tipo_documento, 'CUIT') as contacto_tipo_documento",
      "COALESCE(co.cuit, '') as contacto_cuit",
      "COALESCE(co.condicion_iva, '') as contacto_condicion_iva",
      "COALESCE(NULLIF(co.direccion_fiscal, ''), co.direccion, '') as contacto_direccion",
      "COALESCE(co.localidad, '') as contacto_localidad",
      "COALESCE(co.provincia, '') as contacto_provincia",
      "COALESCE(cmp.numero, '') as compra_numero"
    )
    .leftJoin('cuentas', 'c', 'c.id', 'p.cuenta_id')
    .leftJoin('contactos', 'co', 'co.id', 'p.contacto_id')
    .leftJoin('compras', 'cmp', 'cmp.id', 'p.compra_id')
    .where('p.id', Number(id))
    .get();
  if (!pago) return null;
  const lineas = pagoLineaRepo.query('pl')
    .select("pl.*, COALESCE(c.nombre, '') as cuenta_nombre")
    .leftJoin('cuentas', 'c', 'c.id', 'pl.cuenta_id')
    .where('pl.pago_id', Number(id))
    .orderBy('pl.id', 'ASC')
    .all();
  const retenciones = pagoRetencionRepo.query('pr')
    .select("pr.*, COALESCE(ic.codigo, '') as impuesto_codigo")
    .leftJoin('impuestos_config', 'ic', 'ic.id', 'pr.impuesto_id')
    .where('pr.pago_id', Number(id))
    .orderBy('pr.id', 'ASC')
    .all();
  return { pago, lineas, retenciones };
}

function aplicarAsientoEImputacionesPago(pagoId, {
  fecha, contactoId, planCuentaId, categoriaGasto, concepto, totalBruto,
  compraId = null, imputaciones = null, asientoLineas = [], cuentasAfectadas = new Set(),
  hasChequeOrCuenta = false, retencionesCount = 0,
}) {
  if ((hasChequeOrCuenta || retencionesCount > 0) && asientoLineas.length > 0) {
    let planCta = planCuentaId ? planCuentaRepo.query().select('id, codigo, nombre').where('id', planCuentaId).get() : null;
    if (!planCta && contactoId) {
      planCta = defaultAsientoService.resolvePlanCuenta('2.1.01');
    }
    const contrapartida = planCta
      ? `${planCta.codigo} ${planCta.nombre}`
      : (contactoId ? 'Proveedores por Pagar' : `Gastos · ${categoriaGasto}`);
    asientoLineas.unshift({
      plan_cuenta_id: planCta?.id || null,
      cuenta_id: null,
      contacto_id: contactoId,
      cuenta_contable: contrapartida,
      debe: totalBruto,
      haber: 0,
    });
    registrarAsiento({
      fecha,
      tipo_origen: 'pago',
      origen_id: pagoId,
      concepto: concepto || contrapartida,
      lineas: asientoLineas,
    });
    for (const cid of cuentasAfectadas) recalcCuentaSaldo(cid);
  }

  if (Array.isArray(imputaciones) && imputaciones.length > 0) {
    for (const imp of imputaciones) {
      crearImputacion({
        fecha,
        dominio: 'compras',
        comprobante_tipo: 'pago',
        comprobante_id: pagoId,
        factura_id: imp.factura_id,
        monto_imputado: imp.monto_imputado,
      });
    }
  } else if (compraId) {
    const cmp = compraRepo.query().select('id, total').where('id', Number(compraId)).get();
    if (cmp) {
      const pend = Math.max(0, Number(cmp.total || 0) - getFacturaImputado('compras', cmp.id));
      const aImputar = Number(Math.min(totalBruto, pend).toFixed(2));
      if (aImputar > 0) {
        crearImputacion({
          fecha,
          dominio: 'compras',
          comprobante_tipo: 'pago',
          comprobante_id: pagoId,
          factura_id: cmp.id,
          monto_imputado: aImputar,
        });
      }
    }
  }
}

export function createPago(b, user = null) {
  const lineas = sanitizeTesoreriaLineas(b);
  const monto = Number(lineas.reduce((s, l) => s + l.monto, 0).toFixed(2));
  if (monto <= 0 || lineas.length === 0) throw new Error('El monto del pago debe ser mayor a 0');

  const rawRets = Array.isArray(b.retenciones) ? b.retenciones : [];
  const retenciones = rawRets
    .map(r => {
      const imp = r.impuesto_id ? impuestoConfigRepo.findById(Number(r.impuesto_id)) : null;
      const base = Number(Number(r.base_imponible || 0).toFixed(2));
      const alic = Number(Number(r.alicuota ?? imp?.alicuota_defecto ?? 0).toFixed(4));
      const m = r.monto !== undefined && Number(r.monto) > 0
        ? Number(Number(r.monto).toFixed(2))
        : Number(((base * alic) / 100).toFixed(2));
      return {
        impuesto_id: imp?.id || (r.impuesto_id ? Number(r.impuesto_id) : null),
        nombre: (r.nombre || imp?.nombre || 'Retención').trim(),
        codigo_regimen: (r.codigo_regimen || imp?.codigo_regimen || '').trim(),
        jurisdiccion_codigo: (r.jurisdiccion_codigo || imp?.jurisdiccion_codigo || '').trim(),
        numero_certificado: (r.numero_certificado || '').trim(),
        base_imponible: base,
        alicuota: alic,
        monto: m,
        plan_cuenta_id: r.plan_cuenta_id ? Number(r.plan_cuenta_id) : (imp?.cuenta_contable_id || null),
      };
    })
    .filter(r => r.monto > 0);
  const totalRetenciones = Number(retenciones.reduce((s, r) => s + r.monto, 0).toFixed(2));
  const totalBruto = Number((monto + totalRetenciones).toFixed(2));
  const cuentaId = lineas[0].cuenta_id || (b.cuenta_id ? Number(b.cuenta_id) : null);
  const metodoCab = lineas.length > 1 ? 'Mixto' : lineas[0].metodo;
  const contactoId = (b.contacto_id || b.proveedor_id) ? Number(b.contacto_id || b.proveedor_id) : null;
  const planCuentaId = b.plan_cuenta_id ? Number(b.plan_cuenta_id) : null;
  const fecha = b.fecha || new Date().toISOString().slice(0, 10);
  const categoriaGasto = (b.categoria_gasto || (contactoId ? 'Proveedores' : 'Gastos operativos')).trim();
  const concepto = (b.concepto || '').trim();
  const numero = resolveNumeroDocumento('pago', b.numero, b.punto_venta);

  validateCuentaMetodoLineas(cuentaRepo, lineas);

  return pagoRepo.transaction(() => {
    const metodoPagoId = b.metodo_pago_id
      ? Number(b.metodo_pago_id)
      : (metodoPagoRepo.query().select('id, nombre').all().find(m => String(m.nombre || '').toLowerCase() === metodoCab.toLowerCase())?.id || null);
    const pagoId = pagoRepo.create({
      numero,
      fecha,
      cuenta_id: cuentaId,
      contacto_id: contactoId,
      compra_id: b.compra_id ? Number(b.compra_id) : null,
      plan_cuenta_id: planCuentaId,
      categoria_gasto: categoriaGasto,
      concepto,
      metodo_pago_id: metodoPagoId,
      metodo: metodoCab,
      monto,
      total_retenciones: totalRetenciones,
      total_bruto: totalBruto,
      moneda: (b.moneda || 'ARS').toUpperCase(),
      tipo_cambio: Number(b.tipo_cambio) > 0 ? Number(b.tipo_cambio) : 1,
      estado: b.estado || 'Confirmado',
      observaciones: (b.observaciones || '').trim(),
    }, user);

    const hasChequeOrCuenta = lineas.some(l => l.cuenta_id || l.cheque_id || (l.metodo === 'Cheque' && l.cheque?.numero));
    const asientoLineas = [];
    const cuentasAfectadas = new Set();

    for (const l of lineas) {
      let lineChequeId = l.cheque_id || null;
      let lineRef = l.referencia;

      if (l.cheque_id) {
        const endosado = defaultChequeService.endosarCheque(l.cheque_id, {
          contacto_destino_id: contactoId,
          pago_id: pagoId,
          fecha,
          generar_asiento: false,
        });
        lineChequeId = endosado.id;
        if (!lineRef) lineRef = `Endoso Ch. ${endosado.numero}`;
        asientoLineas.push(defaultChequeService._buildCuentaLine('1.1.07', 'Valores a Depositar (Cheques de Terceros)', l.monto, 'haber'));
      } else if (l.metodo === 'Cheque' && l.cheque?.numero) {
        const chId = defaultChequeService.registrarChequePropio({
          ...l.cheque,
          cuenta_bancaria_id: l.cuenta_id || l.cheque.cuenta_bancaria_id,
          monto: l.monto,
          contacto_origen_id: contactoId,
          pago_id: pagoId,
          fecha_emision: l.cheque.fecha_emision || fecha,
          generar_asiento: false,
        }, user);
        lineChequeId = chId;
        if (!lineRef) lineRef = `Ch. ${l.cheque.numero}`;
        asientoLineas.push(defaultChequeService._buildCuentaLine('2.1.04', 'Cheques Diferidos a Pagar', l.monto, 'haber'));
      } else if (l.cuenta_id) {
        const cta = cuentaRepo.findById(l.cuenta_id);
        cuentasAfectadas.add(l.cuenta_id);
        asientoLineas.push({
          cuenta_id: l.cuenta_id,
          cuenta_contable: cta?.nombre || l.metodo || 'Cuenta Tesorería',
          debe: 0,
          haber: l.monto,
        });
      }

      pagoLineaRepo.create({
        pago_id: pagoId,
        cuenta_id: l.cheque_id ? null : l.cuenta_id,
        metodo: l.cheque_id ? 'Endoso Cheque' : l.metodo,
        referencia: lineRef,
        monto: l.monto,
        cheque_id: lineChequeId,
      });
    }

    if (retenciones.length > 0) {
      const ctaRetDefault = planCuentaRepo.query().select('id, codigo, nombre').where('codigo', '2.1.03').limit(1).get();
      for (const ret of retenciones) {
        let certNro = ret.numero_certificado;
        if (!certNro) {
          try {
            certNro = getNextNumeroDocumento('retencion', null, { advance: true }).numero;
          } catch (_) {
            certNro = `RET-${String(pagoId).padStart(6, '0')}`;
          }
        }
        pagoRetencionRepo.create({
          pago_id: pagoId,
          impuesto_id: ret.impuesto_id,
          nombre: ret.nombre,
          codigo_regimen: ret.codigo_regimen,
          jurisdiccion_codigo: ret.jurisdiccion_codigo,
          numero_certificado: certNro,
          base_imponible: ret.base_imponible,
          alicuota: ret.alicuota,
          monto: ret.monto,
          plan_cuenta_id: ret.plan_cuenta_id || ctaRetDefault?.id || null,
        });
        const ctaRet = ret.plan_cuenta_id
          ? planCuentaRepo.query().select('id, codigo, nombre').where('id', ret.plan_cuenta_id).get()
          : ctaRetDefault;
        asientoLineas.push({
          plan_cuenta_id: ctaRet?.id || null,
          cuenta_id: null,
          cuenta_contable: ctaRet ? `${ctaRet.codigo} ${ctaRet.nombre}` : `2.1.03 ${ret.nombre}`,
          debe: 0,
          haber: ret.monto,
        });
      }
    }

    if ((b.estado || 'Confirmado') === 'Confirmado') {
      aplicarAsientoEImputacionesPago(pagoId, {
        fecha,
        contactoId,
        planCuentaId,
        categoriaGasto,
        concepto,
        totalBruto,
        compraId: b.compra_id ? Number(b.compra_id) : null,
        imputaciones: b.imputaciones,
        asientoLineas,
        cuentasAfectadas,
        hasChequeOrCuenta,
        retencionesCount: retenciones.length,
      });
    }
    return pagoId;
  });
}

export function confirmarPago(id, b = {}, user = null) {
  const ex = pagoRepo.findById(id);
  if (!ex) return false;
  PAGO_SM.assertTransition(ex.estado, 'Confirmado');
  const lineas = pagoLineaRepo.findWhere({ pago_id: Number(id) });
  const retenciones = pagoRetencionRepo.findWhere({ pago_id: Number(id) });
  const asientoLineas = [];
  const cuentasAfectadas = new Set();
  let hasChequeOrCuenta = false;

  for (const l of lineas) {
    if (l.cheque_id && l.metodo === 'Endoso Cheque') {
      hasChequeOrCuenta = true;
      asientoLineas.push(defaultChequeService._buildCuentaLine('1.1.07', 'Valores a Depositar (Cheques de Terceros)', l.monto, 'haber'));
    } else if (l.cheque_id) {
      hasChequeOrCuenta = true;
      asientoLineas.push(defaultChequeService._buildCuentaLine('2.1.04', 'Cheques Diferidos a Pagar', l.monto, 'haber'));
    } else if (l.cuenta_id) {
      hasChequeOrCuenta = true;
      const cta = cuentaRepo.findById(l.cuenta_id);
      cuentasAfectadas.add(l.cuenta_id);
      asientoLineas.push({
        cuenta_id: l.cuenta_id,
        cuenta_contable: cta?.nombre || l.metodo || 'Cuenta Tesorería',
        debe: 0,
        haber: l.monto,
      });
    }
  }

  const ctaRetDefault = retenciones.length > 0
    ? planCuentaRepo.query().select('id, codigo, nombre').where('codigo', '2.1.03').limit(1).get()
    : null;
  for (const ret of retenciones) {
    const ctaRet = ret.plan_cuenta_id
      ? planCuentaRepo.query().select('id, codigo, nombre').where('id', ret.plan_cuenta_id).get()
      : ctaRetDefault;
    asientoLineas.push({
      plan_cuenta_id: ctaRet?.id || null,
      cuenta_id: null,
      cuenta_contable: ctaRet ? `${ctaRet.codigo} ${ctaRet.nombre}` : `2.1.03 ${ret.nombre}`,
      debe: 0,
      haber: ret.monto,
    });
  }

  return pagoRepo.transaction(() => {
    pagoRepo.update(id, { estado: 'Confirmado' }, user);
    aplicarAsientoEImputacionesPago(Number(id), {
      fecha: b.fecha || ex.fecha,
      contactoId: ex.contacto_id,
      planCuentaId: ex.plan_cuenta_id,
      categoriaGasto: ex.categoria_gasto,
      concepto: ex.concepto,
      totalBruto: Number(ex.total_bruto || ex.monto || 0),
      compraId: b.compra_id || ex.compra_id,
      imputaciones: b.imputaciones,
      asientoLineas,
      cuentasAfectadas,
      hasChequeOrCuenta,
      retencionesCount: retenciones.length,
    });
    return true;
  });
}

export function deletePago(id) {
  const ex = pagoRepo.findById(id);
  if (!ex) return false;
  if (ex.estado !== 'Borrador') {
    throw new Error('No se puede eliminar un pago confirmado o anulado; usá Anular para revertir con contra-asiento.');
  }
  const lineas = pagoLineaRepo.findWhere({ pago_id: Number(id) });
  const cuentasAfectadas = new Set(lineas.map(l => l.cuenta_id).filter(Boolean));
  if (ex.cuenta_id) cuentasAfectadas.add(ex.cuenta_id);
  pagoRepo.transaction(() => {
    imputacionRepo.query().where('dominio', 'compras').where('comprobante_tipo', 'pago').where('comprobante_id', Number(id)).delete();
    pagoRepo.delete(id);
    for (const cid of cuentasAfectadas) recalcCuentaSaldo(cid);
  });
  return true;
}

export function anularPago(id, user = null) {
  const ex = pagoRepo.findById(id);
  if (!ex) return false;
  PAGO_SM.assertTransition(ex.estado || 'Confirmado', 'Anulado');
  const lineas = pagoLineaRepo.findWhere({ pago_id: Number(id) });
  const cuentasAfectadas = new Set(lineas.map(l => l.cuenta_id).filter(Boolean));
  if (ex.cuenta_id) cuentasAfectadas.add(ex.cuenta_id);
  return pagoRepo.transaction(() => {
    const asientos = asientoRepo.query()
      .where('tipo_origen', 'pago')
      .where('origen_id', Number(id))
      .where('estado', 'Confirmado')
      .all();
    for (const a of asientos) {
      try { defaultAsientoService.revertirAsiento(a.id, { motivo: 'Anulación de pago' }); }
      catch { /* ignore */ }
    }
    imputacionRepo.query().where('dominio', 'compras').where('comprobante_tipo', 'pago').where('comprobante_id', Number(id)).delete();
    pagoRepo.update(id, { estado: 'Anulado' }, user);
    for (const cid of cuentasAfectadas) recalcCuentaSaldo(cid);
    return true;
  });
}

export function archivarPago(id, archivado = true, user = null) {
  return pagoRepo.setArchivado(id, archivado, user);
}
