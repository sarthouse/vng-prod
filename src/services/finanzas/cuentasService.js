import { BaseRepository } from '../../core/BaseRepository.js';
import { MODELS } from '../../db/models.js';
import { defaultAsientoService } from './asientoService.js';

export const asientoRepo = new BaseRepository({ model: MODELS.asientos });
export const asientoLineaRepo = new BaseRepository({ model: MODELS.asiento_lineas });
export const cuentaRepo = new BaseRepository({ model: MODELS.cuentas });
export const cobroRepo = new BaseRepository({ model: MODELS.cobros });
export const cobroLineaRepo = new BaseRepository({ model: MODELS.cobro_lineas });
export const pagoRepo = new BaseRepository({ model: MODELS.pagos });
export const pagoLineaRepo = new BaseRepository({ model: MODELS.pago_lineas });

function resolveCuentaPlanContable(cuenta) {
  if (cuenta?.cuenta_contable_id) {
    const explicit = defaultAsientoService.resolvePlanCuenta(Number(cuenta.cuenta_contable_id));
    if (explicit) return explicit;
  }
  const isBanco = cuenta?.tipo === 'banco' || cuenta?.tipo === 'billetera';
  const cod = isBanco ? '1.1.02' : '1.1.01';
  return defaultAsientoService.resolvePlanCuenta(cod);
}

function resolveDiarioCuenta(cuenta) {
  const isBanco = cuenta?.tipo === 'banco' || cuenta?.tipo === 'billetera';
  return defaultAsientoService.resolveDiario({ tipo: isBanco ? 'banco' : 'caja' })
    || defaultAsientoService.resolveDiario({ tipo: 'general' });
}

export function registrarAsiento({ fecha, tipo_origen, origen_id = null, concepto = '', lineas = [] }) {
  if (!Array.isArray(lineas) || lineas.length < 2) {
    throw new Error('Un asiento de doble entrada requiere al menos 2 líneas');
  }
  const sumDebe = lineas.reduce((s, l) => s + (Number(l.debe) || 0), 0);
  const sumHaber = lineas.reduce((s, l) => s + (Number(l.haber) || 0), 0);
  if (Math.abs(sumDebe - sumHaber) > 0.01) {
    throw new Error(`Asiento desbalanceado: Debe (${sumDebe.toFixed(2)}) != Haber (${sumHaber.toFixed(2)})`);
  }
  return asientoRepo.transaction(() => {
    const asientoId = asientoRepo.create({
      fecha: fecha || new Date().toISOString().slice(0, 10),
      tipo_origen,
      origen_id,
      concepto,
    });
    for (const l of lineas) {
      asientoLineaRepo.create({
        asiento_id: asientoId,
        plan_cuenta_id: l.plan_cuenta_id ? Number(l.plan_cuenta_id) : null,
        cuenta_id: l.cuenta_id ? Number(l.cuenta_id) : null,
        contacto_id: l.contacto_id ? Number(l.contacto_id) : null,
        cuenta_contable: l.cuenta_contable,
        debe: Number((Number(l.debe) || 0).toFixed(2)),
        haber: Number((Number(l.haber) || 0).toFixed(2)),
      });
    }
    return asientoId;
  });
}

export function listAsientos({ limit = 60 } = {}) {
  const asientos = asientoRepo.query()
    .orderBy('fecha', 'DESC')
    .orderBy('id', 'DESC')
    .limit(limit)
    .all();
  if (!asientos.length) return [];
  const allLines = asientoLineaRepo.query()
    .whereIn('asiento_id', asientos.map(a => a.id))
    .orderBy('id', 'ASC')
    .all();
  const linesMap = new Map();
  for (const l of allLines) {
    if (!linesMap.has(l.asiento_id)) linesMap.set(l.asiento_id, []);
    linesMap.get(l.asiento_id).push(l);
  }
  return asientos.map(a => ({ ...a, lineas: linesMap.get(a.id) || [] }));
}

export function recalcCuentaSaldo(cuentaId) {
  if (!cuentaId) return 0;
  const cuenta = cuentaRepo.findById(Number(cuentaId));
  if (!cuenta) return 0;
  const ingresosLineas = cobroLineaRepo.query('cl')
    .innerJoin('cobros', 'co', 'co.id', 'cl.cobro_id')
    .where('cl.cuenta_id', cuenta.id)
    .where('co.estado', 'Confirmado')
    .whereNull('cl.cheque_id')
    .sum('cl.monto');
  const cobrosCta = cobroRepo.query()
    .select('id, monto')
    .where('cuenta_id', cuenta.id)
    .where('estado', 'Confirmado')
    .all();
  const cobroIdsWithLines = cobrosCta.length
    ? new Set(cobroLineaRepo.query().select('cobro_id').whereIn('cobro_id', cobrosCta.map(c => c.id)).all().map(r => r.cobro_id))
    : new Set();
  const ingresosLegacy = cobrosCta
    .filter(c => !cobroIdsWithLines.has(c.id))
    .reduce((s, c) => s + Number(c.monto || 0), 0);

  const egresosLineas = pagoLineaRepo.query('pl')
    .innerJoin('pagos', 'p', 'p.id', 'pl.pago_id')
    .where('pl.cuenta_id', cuenta.id)
    .where('p.estado', 'Confirmado')
    .whereNull('pl.cheque_id')
    .sum('pl.monto');
  const pagosCta = pagoRepo.query()
    .select('id, monto')
    .where('cuenta_id', cuenta.id)
    .where('estado', 'Confirmado')
    .all();
  const pagoIdsWithLines = pagosCta.length
    ? new Set(pagoLineaRepo.query().select('pago_id').whereIn('pago_id', pagosCta.map(p => p.id)).all().map(r => r.pago_id))
    : new Set();
  const egresosLegacy = pagosCta
    .filter(p => !pagoIdsWithLines.has(p.id))
    .reduce((s, p) => s + Number(p.monto || 0), 0);

  const transf = asientoLineaRepo.query('al')
    .select('al.debe, al.haber')
    .innerJoin('asientos', 'a', 'a.id', 'al.asiento_id')
    .where('al.cuenta_id', cuenta.id)
    .where('a.estado', 'Confirmado')
    .whereIn('a.tipo_origen', ['transferencia', 'ajuste_saldo', 'cheque_deposito', 'cheque_acreditacion', 'cheque_debito', 'cheque_rechazo'])
    .all()
    .reduce((s, al) => s + Number(al.debe || 0) - Number(al.haber || 0), 0);

  const ingresos = Number(ingresosLineas || 0) + Number(ingresosLegacy || 0);
  const egresos = Number(egresosLineas || 0) + Number(egresosLegacy || 0);
  const saldo = Number(((Number(cuenta.saldo_inicial) || 0) + ingresos - egresos + Number(transf || 0)).toFixed(2));
  cuentaRepo.update(cuenta.id, { saldo_actual: saldo });
  return saldo;
}

export function listCuentas() {
  const cuentas = cuentaRepo.query('c')
    .select("c.*, COALESCE(pc.codigo, '') as plan_cuenta_codigo, COALESCE(pc.nombre, '') as plan_cuenta_nombre")
    .leftJoin('plan_cuentas', 'pc', 'pc.id', 'c.cuenta_contable_id')
    .orderBy('c.id', 'ASC')
    .all();
  return cuentas.map(c => ({ ...c, saldo_actual: recalcCuentaSaldo(c.id) }));
}

export function createCuenta(b) {
  const nombre = (b.nombre || '').trim();
  if (!nombre) throw new Error('El nombre de la cuenta es obligatorio');
  const tipo = b.tipo || 'efectivo';
  const moneda = b.moneda || 'ARS';
  const saldoInicial = Number((Number(b.saldo_inicial) || 0).toFixed(2));
  const fecha = b.fecha || new Date().toISOString().slice(0, 10);
  const planCuenta = b.cuenta_contable_id
    ? defaultAsientoService.resolvePlanCuenta(Number(b.cuenta_contable_id))
    : resolveCuentaPlanContable({ tipo });
  const cuentaContableId = planCuenta?.id || (b.cuenta_contable_id ? Number(b.cuenta_contable_id) : null);

  return cuentaRepo.transaction(() => {
    const id = cuentaRepo.create({
      nombre,
      tipo,
      moneda,
      cuenta_contable_id: cuentaContableId,
      saldo_inicial: saldoInicial,
      saldo_actual: saldoInicial,
      activa: 1,
    });

    if (Math.abs(saldoInicial) >= 0.01) {
      const planContra = b.plan_cuenta_contrapartida_id
        ? defaultAsientoService.resolvePlanCuenta(Number(b.plan_cuenta_contrapartida_id))
        : defaultAsientoService.resolvePlanCuenta('3.1.01');
      const diario = defaultAsientoService.resolveDiario({ tipo: 'general' }) || resolveDiarioCuenta({ tipo });
      const absMonto = Math.abs(saldoInicial);
      const lineCuenta = {
        plan_cuenta_id: planCuenta?.id || null,
        cuenta_id: id,
        cuenta_contable: planCuenta ? `${planCuenta.codigo} ${planCuenta.nombre}` : nombre,
        debe: saldoInicial > 0 ? absMonto : 0,
        haber: saldoInicial < 0 ? absMonto : 0,
      };
      const lineContra = {
        plan_cuenta_id: planContra?.id || null,
        cuenta_id: null,
        cuenta_contable: planContra ? `${planContra.codigo} ${planContra.nombre}` : '3.1.01 Capital Social / Apertura',
        debe: saldoInicial < 0 ? absMonto : 0,
        haber: saldoInicial > 0 ? absMonto : 0,
      };
      defaultAsientoService.createAsiento({
        diario_id: diario?.id || null,
        fecha,
        tipo_origen: 'apertura_cuenta',
        origen_id: id,
        concepto: `Saldo inicial cuenta ${nombre}`,
        lineas: saldoInicial > 0 ? [lineCuenta, lineContra] : [lineContra, lineCuenta],
      });
    }
    return id;
  });
}

export function ajustarSaldoCuenta(id, b = {}) {
  const cuenta = cuentaRepo.findById(Number(id));
  if (!cuenta) throw new Error('Cuenta no encontrada');

  const saldoActual = recalcCuentaSaldo(cuenta.id);
  const diferencia = b.nuevo_saldo !== undefined && b.nuevo_saldo !== ''
    ? Number((Number(b.nuevo_saldo) - saldoActual).toFixed(2))
    : Number((Number(b.monto_ajuste) || 0).toFixed(2));

  if (Math.abs(diferencia) < 0.01) {
    throw new Error('El saldo indicado coincide con el saldo actual (diferencia 0)');
  }

  const fecha = b.fecha || new Date().toISOString().slice(0, 10);
  const motivo = (b.motivo || `Ajuste / Arqueo de saldo: ${cuenta.nombre}`).trim();
  const isBanco = cuenta.tipo === 'banco' || cuenta.tipo === 'billetera';
  const planCuenta = resolveCuentaPlanContable(cuenta);
  const defaultContraCode = diferencia < 0 ? (isBanco ? '5.2.04' : '5.2.07') : '4.1.01';
  const planContra = b.plan_cuenta_contrapartida_id
    ? defaultAsientoService.resolvePlanCuenta(Number(b.plan_cuenta_contrapartida_id))
    : defaultAsientoService.resolvePlanCuenta(defaultContraCode);
  const diario = resolveDiarioCuenta(cuenta);
  const absDif = Math.abs(diferencia);

  const lineCuenta = {
    plan_cuenta_id: planCuenta?.id || null,
    cuenta_id: cuenta.id,
    cuenta_contable: planCuenta ? `${planCuenta.codigo} ${planCuenta.nombre} (${cuenta.nombre})` : cuenta.nombre,
    debe: diferencia > 0 ? absDif : 0,
    haber: diferencia < 0 ? absDif : 0,
  };
  const lineContra = {
    plan_cuenta_id: planContra?.id || null,
    cuenta_id: null,
    cuenta_contable: planContra ? `${planContra.codigo} ${planContra.nombre}` : 'Ajuste de Saldo',
    debe: diferencia < 0 ? absDif : 0,
    haber: diferencia > 0 ? absDif : 0,
  };

  return cuentaRepo.transaction(() => {
    const asientoId = defaultAsientoService.createAsiento({
      diario_id: diario?.id || null,
      fecha,
      tipo_origen: 'ajuste_saldo',
      origen_id: cuenta.id,
      concepto: motivo,
      lineas: diferencia > 0 ? [lineCuenta, lineContra] : [lineContra, lineCuenta],
    });
    const saldoNuevo = recalcCuentaSaldo(cuenta.id);
    return { asiento_id: asientoId, saldo_anterior: saldoActual, saldo_nuevo: saldoNuevo, diferencia };
  });
}

export function updateCuenta(id, b) {
  const ex = cuentaRepo.findById(id);
  if (!ex) return false;
  const cuentaContableId = b.cuenta_contable_id !== undefined
    ? (b.cuenta_contable_id ? Number(b.cuenta_contable_id) : null)
    : ex.cuenta_contable_id;
  cuentaRepo.update(id, {
    nombre: b.nombre !== undefined ? b.nombre.trim() : ex.nombre,
    tipo: b.tipo !== undefined ? b.tipo : ex.tipo,
    moneda: b.moneda !== undefined ? b.moneda : ex.moneda,
    cuenta_contable_id: cuentaContableId,
    saldo_inicial: b.saldo_inicial !== undefined ? Number(b.saldo_inicial) : ex.saldo_inicial,
    activa: b.activa !== undefined ? (b.activa ? 1 : 0) : ex.activa,
  });
  recalcCuentaSaldo(id);
  return true;
}

export function deleteCuenta(id) {
  cuentaRepo.delete(id);
}

export function createTransferencia(b) {
  const origenId = Number(b.cuenta_origen_id);
  const destinoId = Number(b.cuenta_destino_id);
  const monto = Number(b.monto) || 0;
  if (!origenId || !destinoId || origenId === destinoId) {
    throw new Error('Seleccioná dos cuentas distintas para transferir');
  }
  if (monto <= 0) throw new Error('El monto debe ser mayor a 0');
  const ori = cuentaRepo.findById(origenId);
  const des = cuentaRepo.findById(destinoId);
  if (!ori || !des) throw new Error('Cuenta no encontrada');

  const fecha = b.fecha || new Date().toISOString().slice(0, 10);
  const concepto = (b.concepto || `Transferencia ${ori.nombre} → ${des.nombre}`).trim();
  const planOri = resolveCuentaPlanContable(ori);
  const planDes = resolveCuentaPlanContable(des);
  const diario = (ori.tipo === 'banco' || des.tipo === 'banco')
    ? resolveDiarioCuenta({ tipo: 'banco' })
    : resolveDiarioCuenta({ tipo: 'efectivo' });

  return cuentaRepo.transaction(() => {
    const asientoId = defaultAsientoService.createAsiento({
      diario_id: diario?.id || null,
      fecha,
      tipo_origen: 'transferencia',
      origen_id: null,
      concepto,
      lineas: [
        {
          plan_cuenta_id: planDes?.id || null,
          cuenta_id: destinoId,
          cuenta_contable: planDes ? `${planDes.codigo} ${planDes.nombre} (${des.nombre})` : des.nombre,
          debe: monto,
          haber: 0,
        },
        {
          plan_cuenta_id: planOri?.id || null,
          cuenta_id: origenId,
          cuenta_contable: planOri ? `${planOri.codigo} ${planOri.nombre} (${ori.nombre})` : ori.nombre,
          debe: 0,
          haber: monto,
        },
      ],
    });
    recalcCuentaSaldo(origenId);
    recalcCuentaSaldo(destinoId);
    return asientoId;
  });
}

const METODOS_POR_TIPO_CUENTA = {
  efectivo: ['Efectivo'],
  banco: ['Transferencia', 'Cheque'],
  billetera: ['MercadoPago', 'Transferencia', 'Otro'],
};

export function sanitizeTesoreriaLineas(b) {
  if (Array.isArray(b.lineas) && b.lineas.length > 0) {
    return b.lineas
      .map(l => ({
        cuenta_id: l.cuenta_id ? Number(l.cuenta_id) : null,
        metodo: (l.metodo || b.metodo || 'Transferencia').trim(),
        referencia: (l.referencia || '').trim(),
        monto: Number(Number(l.monto || 0).toFixed(2)),
        cheque_id: l.cheque_id ? Number(l.cheque_id) : null,
        cheque: l.cheque && typeof l.cheque === 'object' ? l.cheque : null,
      }))
      .filter(l => l.monto > 0);
  }
  const monto = Number(Number(b.monto || 0).toFixed(2));
  if (monto <= 0) return [];
  return [{
    cuenta_id: b.cuenta_id ? Number(b.cuenta_id) : null,
    metodo: (b.metodo || 'Transferencia').trim(),
    referencia: (b.referencia || '').trim(),
    monto,
    cheque_id: b.cheque_id ? Number(b.cheque_id) : null,
    cheque: b.cheque && typeof b.cheque === 'object' ? b.cheque : null,
  }];
}

export function validateCuentaMetodoLineas(repoCuenta, lineas) {
  for (const l of lineas) {
    if (!l.cuenta_id) continue;
    const cta = repoCuenta.findById(l.cuenta_id);
    if (!cta) continue;
    const permitidos = METODOS_POR_TIPO_CUENTA[cta.tipo];
    if (!permitidos) continue;
    const metodo = String(l.metodo || '').trim();
    if (!permitidos.some(m => m.toLowerCase() === metodo.toLowerCase())) {
      throw new Error(
        `La cuenta "${cta.nombre}" (${cta.tipo}) solo admite: ${permitidos.join(', ')}.`,
      );
    }
  }
}
