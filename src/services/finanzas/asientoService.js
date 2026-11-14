import { BaseRepository } from '../../core/BaseRepository.js';
import { db } from '../../db.js';
import { MODELS } from '../../db/models.js';
import { getNextNumeroDocumento } from '../config/configService.js';

export const asientoRepo = new BaseRepository({ model: MODELS.asientos, defaultOrder: 'fecha DESC, id DESC' });
export const asientoLineaRepo = new BaseRepository({ model: MODELS.asiento_lineas, defaultOrder: 'id ASC' });
export const planCuentaRepo = new BaseRepository({ model: MODELS.plan_cuentas, defaultOrder: 'codigo ASC' });
export const diarioRepo = new BaseRepository({ model: MODELS.diarios, defaultOrder: 'codigo ASC' });

function round2(n) {
  return Number((Number(n) || 0).toFixed(2));
}

export class AsientoService {
  constructor({
    asientos = asientoRepo,
    lineas = asientoLineaRepo,
    planCuentas = planCuentaRepo,
    diarios = diarioRepo,
    nextNumeroFn = (codigo) => getNextNumeroDocumento(codigo).numero,
  } = {}) {
    this.asientos = asientos;
    this.lineas = lineas;
    this.planCuentas = planCuentas;
    this.diarios = diarios;
    this.nextNumeroFn = nextNumeroFn;
  }

  resolvePlanCuenta(codigoOrId) {
    if (!codigoOrId) return null;
    if (typeof codigoOrId === 'number' || /^\d+$/.test(String(codigoOrId))) {
      return this.planCuentas.findById(Number(codigoOrId));
    }
    return this.planCuentas.query().where('codigo', String(codigoOrId).trim()).get() || null;
  }

  resolveDiario({ codigo, tipo, caracter } = {}) {
    if (codigo) return this.diarios.query().where('codigo', codigo).get() || null;
    const q = this.diarios.query().where('activo', 1);
    if (tipo) q.where('tipo', tipo);
    if (caracter) q.where('caracter', caracter);
    return q.limit(1).get() || null;
  }

  createAsiento({
    diario_id = null,
    numero = '',
    fecha,
    tipo_origen = 'manual',
    origen_id = null,
    concepto = '',
    estado = 'Confirmado',
    lineas = [],
  }) {
    if (fecha && tipo_origen !== 'cierre_ejercicio') {
      let closed = null;
      try {
        closed = db.prepare(
          "SELECT id, descripcion, fecha_desde, fecha_hasta FROM cierres_ejercicio WHERE estado = 'cerrado' AND ? >= fecha_desde AND ? <= fecha_hasta LIMIT 1"
        ).get(fecha, fecha);
      } catch (_) { /* En tests unitarios en memoria sin SQLite activo */ }
      if (closed) {
        throw new Error(`El período ${closed.fecha_desde} a ${closed.fecha_hasta} está cerrado (${closed.descripcion || 'Cierre de ejercicio'}).`);
      }
    }
    if (!Array.isArray(lineas) || lineas.length < 2) {
      throw new Error('Un asiento contable requiere al menos 2 líneas (Debe y Haber)');
    }

    const normalized = [];
    let totalDebe = 0;
    let totalHaber = 0;

    for (const l of lineas) {
      const debe = round2(l.debe);
      const haber = round2(l.haber);
      if (debe < 0 || haber < 0) throw new Error('Los importes de Debe y Haber no pueden ser negativos');
      if (debe > 0 && haber > 0) throw new Error('Una línea contable no puede tener Debe y Haber simultáneamente');
      if (debe === 0 && haber === 0) continue;

      const plan = l.plan_cuenta_id
        ? this.planCuentas.findById(Number(l.plan_cuenta_id))
        : (l.plan_cuenta_codigo ? this.resolvePlanCuenta(l.plan_cuenta_codigo) : null);

      const cuentaNombre = (l.cuenta_contable || (plan ? `${plan.codigo} ${plan.nombre}` : '')).trim();
      if (!cuentaNombre) throw new Error('Cada línea del asiento debe indicar cuenta_contable o plan_cuenta');

      totalDebe = round2(totalDebe + debe);
      totalHaber = round2(totalHaber + haber);
      normalized.push({
        plan_cuenta_id: plan ? plan.id : (l.plan_cuenta_id ? Number(l.plan_cuenta_id) : null),
        cuenta_id: l.cuenta_id ? Number(l.cuenta_id) : null,
        contacto_id: l.contacto_id ? Number(l.contacto_id) : null,
        cuenta_contable: cuentaNombre,
        debe,
        haber,
      });
    }

    if (normalized.length < 2) {
      throw new Error('El asiento debe tener al menos 2 líneas con importe mayor a 0');
    }
    if (Math.abs(totalDebe - totalHaber) >= 0.01) {
      throw new Error(`Asiento desbalanceado: Debe (${totalDebe}) != Haber (${totalHaber})`);
    }

    const f = fecha || new Date().toISOString().slice(0, 10);
    const num = (numero || '').trim() || (estado === 'Confirmado' ? this.nextNumeroFn('asiento') : '');

    return this.asientos.transaction(() => {
      const asientoId = this.asientos.create({
        diario_id: diario_id ? Number(diario_id) : null,
        numero: num,
        fecha: f,
        estado,
        tipo_origen,
        origen_id: origen_id ? Number(origen_id) : null,
        concepto: (concepto || '').trim(),
      });

      for (const l of normalized) {
        this.lineas.create({ asiento_id: asientoId, ...l });
      }
      return asientoId;
    });
  }

  revertirAsiento(id, { fecha, motivo } = {}) {
    const orig = this.getAsientoById(id);
    if (!orig) throw new Error('Asiento no encontrado');
    if (orig.asiento.estado !== 'Confirmado') {
      throw new Error('Solo se pueden revertir asientos en estado Confirmado');
    }

    const revLineas = orig.lineas.map(l => ({
      plan_cuenta_id: l.plan_cuenta_id,
      cuenta_id: l.cuenta_id,
      contacto_id: l.contacto_id,
      cuenta_contable: l.cuenta_contable,
      debe: l.haber,
      haber: l.debe,
    }));

    return this.asientos.transaction(() => {
      const contraId = this.createAsiento({
        diario_id: orig.asiento.diario_id,
        fecha: fecha || new Date().toISOString().slice(0, 10),
        tipo_origen: 'reversion',
        origen_id: orig.asiento.id,
        concepto: motivo || `Reversión de ${orig.asiento.numero || `Asiento #${orig.asiento.id}`}`,
        estado: 'Confirmado',
        lineas: revLineas,
      });

      this.asientos.update(orig.asiento.id, {
        estado: 'Revertido',
        asiento_reversion_id: contraId,
      });

      return contraId;
    });
  }

  listAsientos({ diario_id, estado, desde, hasta } = {}) {
    const q = this.asientos.query('a')
      .select('a.*', "COALESCE(d.nombre, '') as diario_nombre", "COALESCE(d.codigo, '') as diario_codigo")
      .leftJoin('diarios', 'd', 'd.id', 'a.diario_id');
    if (diario_id) q.where('a.diario_id', Number(diario_id));
    if (estado) q.where('a.estado', estado);
    if (desde) q.where('a.fecha', '>=', desde);
    if (hasta) q.where('a.fecha', '<=', hasta);
    const rows = q.orderBy('a.fecha', 'DESC').orderBy('a.id', 'DESC').all();
    return rows.map(a => ({
      ...a,
      lineas: this.lineas.findWhere({ asiento_id: Number(a.id) }, { orderBy: 'id ASC' }),
    }));
  }

  getAsientoById(id) {
    const asiento = this.asientos.findById(id);
    if (!asiento) return null;
    const lineas = this.lineas.findWhere({ asiento_id: Number(id) }, { orderBy: 'id ASC' });
    return { asiento, lineas };
  }

  getBalanceSumasYSaldos({ desde, hasta } = {}) {
    const q = this.lineas.query('al')
      .select(
        'al.plan_cuenta_id',
        'al.cuenta_contable',
        "COALESCE(pc.codigo, '') as codigo",
        "COALESCE(pc.nombre, al.cuenta_contable) as nombre",
        "COALESCE(pc.tipo, '') as tipo",
        'SUM(al.debe) as total_debe',
        'SUM(al.haber) as total_haber'
      )
      .innerJoin('asientos', 'a', 'a.id', 'al.asiento_id')
      .leftJoin('plan_cuentas', 'pc', 'pc.id', 'al.plan_cuenta_id')
      .where('a.estado', 'Confirmado');

    if (desde) q.where('a.fecha', '>=', desde);
    if (hasta) q.where('a.fecha', '<=', hasta);

    return q.groupBy('al.plan_cuenta_id', 'al.cuenta_contable')
      .orderBy('codigo', 'ASC')
      .all()
      .map(r => {
        const debe = round2(r.total_debe);
        const haber = round2(r.total_haber);
        return {
          ...r,
          total_debe: debe,
          total_haber: haber,
          saldo: round2(debe - haber),
        };
      });
  }

  getLibroMayor({ plan_cuenta_id, desde, hasta } = {}) {
    if (!plan_cuenta_id) return { cuenta: null, movimientos: [], total_debe: 0, total_haber: 0, saldo_final: 0 };
    const cuenta = this.planCuentas.findById(Number(plan_cuenta_id));
    if (!cuenta) return { cuenta: null, movimientos: [], total_debe: 0, total_haber: 0, saldo_final: 0 };

    const q = this.lineas.query('al')
      .select(
        'al.id',
        'al.asiento_id',
        'al.debe',
        'al.haber',
        'al.cuenta_contable',
        'a.fecha',
        'a.numero as asiento_numero',
        'a.tipo_origen',
        'a.concepto',
        "COALESCE(d.codigo, '') as diario_codigo"
      )
      .innerJoin('asientos', 'a', 'a.id', 'al.asiento_id')
      .leftJoin('diarios', 'd', 'd.id', 'a.diario_id')
      .where('a.estado', 'Confirmado')
      .where('al.plan_cuenta_id', Number(plan_cuenta_id));

    if (desde) q.where('a.fecha', '>=', desde);
    if (hasta) q.where('a.fecha', '<=', hasta);

    const rows = q.orderBy('a.fecha', 'ASC').orderBy('al.asiento_id', 'ASC').orderBy('al.id', 'ASC').all();
    let saldo = 0;
    let totalDebe = 0;
    let totalHaber = 0;
    const isAcreedora = cuenta.naturaleza === 'acreedora';
    const movimientos = rows.map(r => {
      const debe = round2(r.debe);
      const haber = round2(r.haber);
      totalDebe = round2(totalDebe + debe);
      totalHaber = round2(totalHaber + haber);
      saldo = round2(saldo + (isAcreedora ? (haber - debe) : (debe - haber)));
      return { ...r, debe, haber, saldo_acumulado: saldo };
    });

    return {
      cuenta,
      movimientos,
      total_debe: totalDebe,
      total_haber: totalHaber,
      saldo_final: saldo,
    };
  }

  getEstadoResultados({ desde, hasta } = {}) {
    const balance = this.getBalanceSumasYSaldos({ desde, hasta });
    const ingresos = balance
      .filter(r => r.tipo === 'ingreso')
      .map(r => ({ ...r, importe: round2(r.total_haber - r.total_debe) }));
    const egresos = balance
      .filter(r => r.tipo === 'egreso')
      .map(r => ({ ...r, importe: round2(r.total_debe - r.total_haber) }));
    const total_ingresos = round2(ingresos.reduce((s, r) => s + r.importe, 0));
    const total_egresos = round2(egresos.reduce((s, r) => s + r.importe, 0));
    return {
      ingresos,
      egresos,
      total_ingresos,
      total_egresos,
      resultado_neto: round2(total_ingresos - total_egresos),
    };
  }

  generarAsientoCompra(compra, impuestos = [], lineasCompra = []) {
    const isNC = compra.clase_documento === 'nota_credito';
    const diario = compra.diario_id
      ? this.diarios.findById(Number(compra.diario_id))
      : this.resolveDiario({ tipo: 'compras', caracter: compra.caracter || 'fiscal' });

    const ctaGastoDefault = this.resolvePlanCuenta(diario?.cuenta_contable_id || '5.1.01');
    const ctaIva = this.resolvePlanCuenta('1.1.04');
    const ctaPerc = this.resolvePlanCuenta('1.1.05');
    const ctaProv = this.resolvePlanCuenta('2.1.01');

    const neto = round2(compra.neto);
    const iva = round2(compra.iva_monto);
    const perc = round2((impuestos || []).filter(i => i.tipo !== 'retencion').reduce((s, i) => s + Number(i.monto || 0), 0));
    const ret = round2((impuestos || []).filter(i => i.tipo === 'retencion').reduce((s, i) => s + Number(i.monto || 0), 0));
    const total = round2(compra.total);

    const addSide = (plan, fallbackName, monto, normalSide, contactoId = null) => {
      if (monto <= 0) return null;
      const side = isNC ? (normalSide === 'debe' ? 'haber' : 'debe') : normalSide;
      return {
        plan_cuenta_id: plan?.id || null,
        plan_cuenta_codigo: plan?.codigo || null,
        contacto_id: contactoId,
        cuenta_contable: plan ? `${plan.codigo} ${plan.nombre}` : fallbackName,
        debe: side === 'debe' ? monto : 0,
        haber: side === 'haber' ? monto : 0,
      };
    };

    const gastoLines = [];
    if (Array.isArray(lineasCompra) && lineasCompra.length > 0) {
      const grouped = new Map();
      for (const l of lineasCompra) {
        const sub = round2(l.subtotal);
        if (sub <= 0) continue;
        const key = l.plan_cuenta_id ? Number(l.plan_cuenta_id) : 'default';
        grouped.set(key, round2((grouped.get(key) || 0) + sub));
      }
      if (grouped.size > 0) {
        for (const [key, monto] of grouped.entries()) {
          const plan = key === 'default' ? ctaGastoDefault : (this.resolvePlanCuenta(key) || ctaGastoDefault);
          const line = addSide(plan, '5.1.01 Compras y Costo de Mercadería', monto, 'debe');
          if (line) gastoLines.push(line);
        }
      }
    }
    if (gastoLines.length === 0) {
      const line = addSide(ctaGastoDefault, '5.1.01 Compras y Costo de Mercadería', neto, 'debe');
      if (line) gastoLines.push(line);
    }

    const lineas = [
      ...gastoLines,
      addSide(ctaIva, '1.1.04 IVA Crédito Fiscal', iva, 'debe'),
      addSide(ctaPerc, '1.1.05 Percepciones y Retenciones Sufridas', perc, 'debe'),
      addSide(this.resolvePlanCuenta('2.1.03'), '2.1.03 Retenciones a Depositar', ret, 'haber'),
      addSide(ctaProv, '2.1.01 Proveedores', total, 'haber', compra.contacto_id),
    ].filter(Boolean);

    if (lineas.length < 2) return null;

    return this.createAsiento({
      diario_id: diario?.id || null,
      fecha: compra.fecha,
      tipo_origen: isNC ? 'nc_compra' : compra.clase_documento === 'nota_debito' ? 'nd_compra' : 'compra',
      origen_id: compra.id,
      concepto: `${compra.tipo_comprobante || 'FC'} ${compra.numero || `#${compra.id}`}`,
      estado: 'Confirmado',
      lineas,
    });
  }

  generarAsientoVenta(venta, impuestos = [], lineasVenta = []) {
    const isNC = venta.clase_documento === 'nota_credito';
    const diario = venta.diario_id
      ? this.diarios.findById(Number(venta.diario_id))
      : this.resolveDiario({ tipo: 'ventas', caracter: venta.caracter || 'fiscal' });

    const ctaCli = this.resolvePlanCuenta('1.1.03');
    const ctaVentas = this.resolvePlanCuenta(diario?.cuenta_contable_id || '4.1.01');
    const ctaIva = this.resolvePlanCuenta('2.1.02');
    const ctaPerc = this.resolvePlanCuenta('2.1.03');

    const neto = round2(venta.neto);
    const iva = round2(venta.iva_monto);
    const perc = round2((impuestos || []).filter(i => i.tipo !== 'retencion').reduce((s, i) => s + Number(i.monto || 0), 0));
    const ret = round2((impuestos || []).filter(i => i.tipo === 'retencion').reduce((s, i) => s + Number(i.monto || 0), 0));
    const total = round2(venta.total);

    const addSide = (plan, fallbackName, monto, normalSide, contactoId = null) => {
      if (monto <= 0) return null;
      const side = isNC ? (normalSide === 'debe' ? 'haber' : 'debe') : normalSide;
      return {
        plan_cuenta_id: plan?.id || null,
        plan_cuenta_codigo: plan?.codigo || null,
        contacto_id: contactoId,
        cuenta_contable: plan ? `${plan.codigo} ${plan.nombre}` : fallbackName,
        debe: side === 'debe' ? monto : 0,
        haber: side === 'haber' ? monto : 0,
      };
    };

    const ventaNetoLines = [];
    if (Array.isArray(lineasVenta) && lineasVenta.some(l => l.plan_cuenta_id)) {
      const byCuenta = new Map();
      for (const l of lineasVenta) {
        const sub = round2(l.subtotal);
        if (sub === 0) continue;
        const key = l.plan_cuenta_id ? Number(l.plan_cuenta_id) : (ctaVentas?.id || 0);
        byCuenta.set(key, round2((byCuenta.get(key) || 0) + sub));
      }
      for (const [ctaId, sub] of byCuenta.entries()) {
        if (sub <= 0) continue;
        const plan = ctaId ? this.resolvePlanCuenta(ctaId) : ctaVentas;
        ventaNetoLines.push(addSide(plan, '4.1.01 Ventas de Productos', sub, 'haber'));
      }
    } else {
      ventaNetoLines.push(addSide(ctaVentas, '4.1.01 Ventas de Productos', neto, 'haber'));
    }

    const lineas = [
      addSide(ctaCli, '1.1.03 Deudores por Ventas (Clientes)', total, 'debe', venta.contacto_id),
      addSide(this.resolvePlanCuenta('1.1.05'), '1.1.05 Retenciones Sufridas', ret, 'debe'),
      ...ventaNetoLines,
      addSide(ctaIva, '2.1.02 IVA Débito Fiscal', iva, 'haber'),
      addSide(ctaPerc, '2.1.03 Percepciones a Depositar', perc, 'haber'),
    ].filter(Boolean);

    if (lineas.length < 2) return null;

    return this.createAsiento({
      diario_id: diario?.id || null,
      fecha: venta.fecha,
      tipo_origen: isNC ? 'nc_venta' : venta.clase_documento === 'nota_debito' ? 'nd_venta' : 'venta',
      origen_id: venta.id,
      concepto: `${venta.tipo_comprobante || 'FA'} ${venta.numero || `#${venta.id}`}`,
      estado: 'Confirmado',
      lineas,
    });
  }
}

export const defaultAsientoService = new AsientoService();

export const createAsiento = (payload) => defaultAsientoService.createAsiento(payload);
export const revertirAsiento = (id, opts) => defaultAsientoService.revertirAsiento(id, opts);
export const listAsientos = (filters) => defaultAsientoService.listAsientos(filters);
export const getAsientoById = (id) => defaultAsientoService.getAsientoById(id);
export const getBalanceSumasYSaldos = (filters) => defaultAsientoService.getBalanceSumasYSaldos(filters);
export const getLibroMayor = (filters) => defaultAsientoService.getLibroMayor(filters);
export const getEstadoResultados = (filters) => defaultAsientoService.getEstadoResultados(filters);
