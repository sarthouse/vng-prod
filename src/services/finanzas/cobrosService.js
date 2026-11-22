import { BaseRepository } from '../../core/BaseRepository.js';
import { createStateMachine } from '../../core/stateMachine.js';
import { MODELS } from '../../db/models.js';

const COBRO_SM = createStateMachine({
  Borrador: ['Confirmado'],
  Confirmado: ['Anulado'],
  Anulado: [],
}, { label: 'Cobro' });
import { resolveNumeroDocumento } from '../config/configService.js';
import { defaultChequeService } from './chequeService.js';
import { defaultAsientoService } from './asientoService.js';
import { crearImputacion, getFacturaImputado } from './imputacionService.js';
import {
  asientoRepo,
  cuentaRepo,
  cobroRepo,
  cobroLineaRepo,
  registrarAsiento,
  recalcCuentaSaldo,
  sanitizeTesoreriaLineas,
  validateCuentaMetodoLineas,
} from './cuentasService.js';

const metodoPagoRepo = new BaseRepository({ table: 'metodos_pago' });
const ventaRepo = new BaseRepository({ model: MODELS.ventas });
const imputacionRepo = new BaseRepository({ table: 'imputaciones' });

export function listCobros({ cuenta_id, contacto_id, cliente_id } = {}) {
  const qb = cobroRepo.query('co')
    .select("co.*, COALESCE(c.nombre, '') as cuenta_nombre, COALESCE(ct.nombre, '') as cliente_nombre, COALESCE(ct.nombre, '') as contacto_nombre")
    .leftJoin('cuentas', 'c', 'c.id', 'co.cuenta_id')
    .leftJoin('contactos', 'ct', 'ct.id', 'co.contacto_id');
  const filterContacto = contacto_id || cliente_id;
  if (cuenta_id) qb.where('co.cuenta_id', Number(cuenta_id));
  if (filterContacto) qb.where('co.contacto_id', Number(filterContacto));
  const rows = qb.orderBy('co.fecha', 'DESC').orderBy('co.id', 'DESC').all();
  const asientos = asientoRepo.query().select('id, origen_id').where('tipo_origen', 'cobro').all();
  const asientoByOrigen = new Map(asientos.map(a => [Number(a.origen_id), a.id]));
  return rows.map(r => ({ ...r, asiento_id: asientoByOrigen.get(Number(r.id)) || null }));
}

export function getCobroById(id) {
  const cobro = cobroRepo.query('co')
    .select(
      'co.*',
      "COALESCE(c.nombre, '') as cuenta_nombre",
      "COALESCE(ct.nombre, '') as cliente_nombre",
      "COALESCE(ct.nombre, '') as contacto_nombre",
      "COALESCE(NULLIF(ct.razon_social, ''), ct.nombre, '') as contacto_razon_social",
      "COALESCE(ct.tipo_documento, 'CUIT') as contacto_tipo_documento",
      "COALESCE(ct.cuit, '') as contacto_cuit",
      "COALESCE(ct.condicion_iva, '') as contacto_condicion_iva",
      "COALESCE(NULLIF(ct.direccion_fiscal, ''), ct.direccion, '') as contacto_direccion",
      "COALESCE(ct.localidad, '') as contacto_localidad",
      "COALESCE(ct.provincia, '') as contacto_provincia",
      "COALESCE(v.numero, '') as venta_numero"
    )
    .leftJoin('cuentas', 'c', 'c.id', 'co.cuenta_id')
    .leftJoin('contactos', 'ct', 'ct.id', 'co.contacto_id')
    .leftJoin('ventas', 'v', 'v.id', 'co.venta_id')
    .where('co.id', Number(id))
    .get();
  if (!cobro) return null;
  const lineas = cobroLineaRepo.query('cl')
    .select("cl.*, COALESCE(c.nombre, '') as cuenta_nombre")
    .leftJoin('cuentas', 'c', 'c.id', 'cl.cuenta_id')
    .where('cl.cobro_id', Number(id))
    .orderBy('cl.id', 'ASC')
    .all();
  return { cobro, lineas };
}

function aplicarAsientoEImputacionesCobro(cobroId, {
  fecha, contactoId, concepto, monto, ventaId = null, imputaciones = null,
  asientoLineas = [], cuentasAfectadas = new Set(), hasChequeOrCuenta = false,
}) {
  if (hasChequeOrCuenta && asientoLineas.length > 0) {
    const planCta = contactoId
      ? defaultAsientoService.resolvePlanCuenta('1.1.03')
      : defaultAsientoService.resolvePlanCuenta('4.1.01');
    const contrapartida = planCta
      ? `${planCta.codigo} ${planCta.nombre}`
      : (contactoId ? 'Clientes por Cobrar' : 'Otros Ingresos');
    asientoLineas.push({
      plan_cuenta_id: planCta?.id || null,
      cuenta_id: null,
      contacto_id: contactoId,
      cuenta_contable: contrapartida,
      debe: 0,
      haber: monto,
    });
    registrarAsiento({
      fecha,
      tipo_origen: 'cobro',
      origen_id: cobroId,
      concepto: concepto || contrapartida,
      lineas: asientoLineas,
    });
    for (const cid of cuentasAfectadas) recalcCuentaSaldo(cid);
  }

  if (Array.isArray(imputaciones) && imputaciones.length > 0) {
    for (const imp of imputaciones) {
      crearImputacion({
        fecha,
        dominio: 'ventas',
        comprobante_tipo: 'cobro',
        comprobante_id: cobroId,
        factura_id: imp.factura_id,
        monto_imputado: imp.monto_imputado,
      });
    }
  } else if (ventaId) {
    const vta = ventaRepo.query().select('id, total').where('id', Number(ventaId)).get();
    if (vta) {
      const pend = Math.max(0, Number(vta.total || 0) - getFacturaImputado('ventas', vta.id));
      const aImputar = Number(Math.min(monto, pend).toFixed(2));
      if (aImputar > 0) {
        crearImputacion({
          fecha,
          dominio: 'ventas',
          comprobante_tipo: 'cobro',
          comprobante_id: cobroId,
          factura_id: vta.id,
          monto_imputado: aImputar,
        });
      }
    }
  }
}

export function createCobro(b, user = null) {
  const lineas = sanitizeTesoreriaLineas(b);
  const monto = Number(lineas.reduce((s, l) => s + l.monto, 0).toFixed(2));
  if (monto <= 0 || lineas.length === 0) throw new Error('El monto del cobro debe ser mayor a 0');
  const cuentaId = lineas[0].cuenta_id || (b.cuenta_id ? Number(b.cuenta_id) : null);
  const metodoCab = lineas.length > 1 ? 'Mixto' : lineas[0].metodo;
  const contactoId = (b.contacto_id || b.cliente_id || b.proveedor_id) ? Number(b.contacto_id || b.cliente_id || b.proveedor_id) : null;
  const fecha = b.fecha || new Date().toISOString().slice(0, 10);
  const concepto = (b.concepto || '').trim();
  const numero = resolveNumeroDocumento('cobro', b.numero, b.punto_venta);

  validateCuentaMetodoLineas(cuentaRepo, lineas);

  return cobroRepo.transaction(() => {
    const metodoPagoId = b.metodo_pago_id
      ? Number(b.metodo_pago_id)
      : (metodoPagoRepo.query().select('id, nombre').all().find(m => String(m.nombre || '').toLowerCase() === metodoCab.toLowerCase())?.id || null);
    const cobroId = cobroRepo.create({
      numero,
      fecha,
      cuenta_id: cuentaId,
      contacto_id: contactoId,
      venta_id: b.venta_id ? Number(b.venta_id) : null,
      concepto,
      metodo_pago_id: metodoPagoId,
      metodo: metodoCab,
      monto,
      moneda: (b.moneda || 'ARS').toUpperCase(),
      tipo_cambio: Number(b.tipo_cambio) > 0 ? Number(b.tipo_cambio) : 1,
      estado: b.estado || 'Confirmado',
      observaciones: (b.observaciones || '').trim(),
    }, user);

    const hasChequeOrCuenta = lineas.some(l => l.cuenta_id || (l.metodo === 'Cheque' && l.cheque?.numero));
    const asientoLineas = [];
    const cuentasAfectadas = new Set();

    for (const l of lineas) {
      let lineChequeId = l.cheque_id || null;
      let lineRef = l.referencia;
      let lineCuentaId = l.cuenta_id;

      if (l.metodo === 'Cheque' && l.cheque?.numero) {
        const chId = defaultChequeService.registrarChequeTercero({
          ...l.cheque,
          monto: l.monto,
          contacto_origen_id: contactoId,
          cobro_id: cobroId,
          fecha_emision: l.cheque.fecha_emision || fecha,
          generar_asiento: false,
        }, user);
        lineChequeId = chId;
        lineCuentaId = null;
        if (!lineRef) lineRef = `Ch. ${l.cheque.numero}`;
        asientoLineas.push(defaultChequeService._buildCuentaLine('1.1.07', 'Valores a Depositar (Cheques de Terceros)', l.monto, 'debe'));
      } else if (l.cuenta_id) {
        const cta = cuentaRepo.findById(l.cuenta_id);
        cuentasAfectadas.add(l.cuenta_id);
        asientoLineas.push({
          cuenta_id: l.cuenta_id,
          cuenta_contable: cta?.nombre || l.metodo || 'Cuenta Tesorería',
          debe: l.monto,
          haber: 0,
        });
      }

      cobroLineaRepo.create({
        cobro_id: cobroId,
        cuenta_id: lineCuentaId,
        metodo: l.metodo,
        referencia: lineRef,
        monto: l.monto,
        cheque_id: lineChequeId,
      });
    }

    if ((b.estado || 'Confirmado') === 'Confirmado') {
      aplicarAsientoEImputacionesCobro(cobroId, {
        fecha,
        contactoId,
        concepto,
        monto,
        ventaId: b.venta_id ? Number(b.venta_id) : null,
        imputaciones: b.imputaciones,
        asientoLineas,
        cuentasAfectadas,
        hasChequeOrCuenta,
      });
    }
    return cobroId;
  });
}

export function confirmarCobro(id, b = {}, user = null) {
  const ex = cobroRepo.findById(id);
  if (!ex) return false;
  COBRO_SM.assertTransition(ex.estado, 'Confirmado');
  const lineas = cobroLineaRepo.findWhere({ cobro_id: Number(id) });
  const asientoLineas = [];
  const cuentasAfectadas = new Set();
  let hasChequeOrCuenta = false;

  for (const l of lineas) {
    if (l.cheque_id) {
      hasChequeOrCuenta = true;
      asientoLineas.push(defaultChequeService._buildCuentaLine('1.1.07', 'Valores a Depositar (Cheques de Terceros)', l.monto, 'debe'));
    } else if (l.cuenta_id) {
      hasChequeOrCuenta = true;
      const cta = cuentaRepo.findById(l.cuenta_id);
      cuentasAfectadas.add(l.cuenta_id);
      asientoLineas.push({
        cuenta_id: l.cuenta_id,
        cuenta_contable: cta?.nombre || l.metodo || 'Cuenta Tesorería',
        debe: l.monto,
        haber: 0,
      });
    }
  }

  return cobroRepo.transaction(() => {
    cobroRepo.update(id, { estado: 'Confirmado' }, user);
    aplicarAsientoEImputacionesCobro(Number(id), {
      fecha: b.fecha || ex.fecha,
      contactoId: ex.contacto_id,
      concepto: ex.concepto,
      monto: Number(ex.monto || 0),
      ventaId: b.venta_id || ex.venta_id,
      imputaciones: b.imputaciones,
      asientoLineas,
      cuentasAfectadas,
      hasChequeOrCuenta,
    });
    return true;
  });
}

export function deleteCobro(id) {
  const ex = cobroRepo.findById(id);
  if (!ex) return false;
  if (ex.estado !== 'Borrador') {
    throw new Error('No se puede eliminar un cobro confirmado o anulado; usá Anular para revertir con contra-asiento.');
  }
  const lineas = cobroLineaRepo.findWhere({ cobro_id: Number(id) });
  const cuentasAfectadas = new Set(lineas.map(l => l.cuenta_id).filter(Boolean));
  if (ex.cuenta_id) cuentasAfectadas.add(ex.cuenta_id);
  cobroRepo.transaction(() => {
    imputacionRepo.query().where('dominio', 'ventas').where('comprobante_tipo', 'cobro').where('comprobante_id', Number(id)).delete();
    cobroRepo.delete(id);
    for (const cid of cuentasAfectadas) recalcCuentaSaldo(cid);
  });
  return true;
}

export function anularCobro(id, user = null) {
  const ex = cobroRepo.findById(id);
  if (!ex) return false;
  COBRO_SM.assertTransition(ex.estado || 'Confirmado', 'Anulado');
  const lineas = cobroLineaRepo.findWhere({ cobro_id: Number(id) });
  const cuentasAfectadas = new Set(lineas.map(l => l.cuenta_id).filter(Boolean));
  if (ex.cuenta_id) cuentasAfectadas.add(ex.cuenta_id);
  return cobroRepo.transaction(() => {
    const asientos = asientoRepo.query()
      .where('tipo_origen', 'cobro')
      .where('origen_id', Number(id))
      .where('estado', 'Confirmado')
      .all();
    for (const a of asientos) {
      try { defaultAsientoService.revertirAsiento(a.id, { motivo: 'Anulación de cobro' }); }
      catch { /* ignore */ }
    }
    imputacionRepo.query().where('dominio', 'ventas').where('comprobante_tipo', 'cobro').where('comprobante_id', Number(id)).delete();
    cobroRepo.update(id, { estado: 'Anulado' }, user);
    for (const cid of cuentasAfectadas) recalcCuentaSaldo(cid);
    return true;
  });
}

export function archivarCobro(id, archivado = true, user = null) {
  return cobroRepo.setArchivado(id, archivado, user);
}
