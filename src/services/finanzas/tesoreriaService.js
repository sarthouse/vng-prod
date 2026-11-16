import { db } from '../../db.js';
import { BaseRepository } from '../../core/BaseRepository.js';
import { MODELS } from '../../db/models.js';
import { getNextNumeroDocumento } from '../config/configService.js';
import { listProductos } from '../inventario/productoService.js';
import { listOrdenes } from '../produccion/produccionService.js';
import { defaultChequeService } from './chequeService.js';
import { defaultAsientoService } from './asientoService.js';
import { crearImputacion, getFacturaImputado } from './imputacionService.js';

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
  const info = db.prepare(`
    INSERT INTO asientos (fecha, tipo_origen, origen_id, concepto)
    VALUES (?, ?, ?, ?)
  `).run(fecha || new Date().toISOString().slice(0, 10), tipo_origen, origen_id, concepto);
  const asientoId = Number(info.lastInsertRowid);
  const ins = db.prepare(`
    INSERT INTO asiento_lineas (asiento_id, plan_cuenta_id, cuenta_id, contacto_id, cuenta_contable, debe, haber)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const l of lineas) {
    ins.run(
      asientoId,
      l.plan_cuenta_id ? Number(l.plan_cuenta_id) : null,
      l.cuenta_id ? Number(l.cuenta_id) : null,
      l.contacto_id ? Number(l.contacto_id) : null,
      l.cuenta_contable,
      Number((Number(l.debe) || 0).toFixed(2)),
      Number((Number(l.haber) || 0).toFixed(2))
    );
  }
  return asientoId;
}

export function listAsientos({ limit = 60 } = {}) {
  const asientos = db.prepare('SELECT * FROM asientos ORDER BY fecha DESC, id DESC LIMIT ?').all(limit);
  const getLines = db.prepare('SELECT * FROM asiento_lineas WHERE asiento_id = ? ORDER BY id ASC');
  return asientos.map(a => ({ ...a, lineas: getLines.all(a.id) }));
}

export function recalcCuentaSaldo(cuentaId) {
  if (!cuentaId) return 0;
  const cuenta = db.prepare('SELECT * FROM cuentas WHERE id = ?').get(Number(cuentaId));
  if (!cuenta) return 0;
  const ingresosLineas = db.prepare(`
    SELECT COALESCE(SUM(cl.monto), 0) as t
    FROM cobro_lineas cl
    JOIN cobros co ON co.id = cl.cobro_id
    WHERE cl.cuenta_id = ? AND co.estado = 'Confirmado' AND cl.cheque_id IS NULL
  `).get(cuenta.id).t;
  const ingresosLegacy = db.prepare(`
    SELECT COALESCE(SUM(co.monto), 0) as t
    FROM cobros co
    WHERE co.cuenta_id = ? AND co.estado = 'Confirmado'
      AND NOT EXISTS (SELECT 1 FROM cobro_lineas cl WHERE cl.cobro_id = co.id)
  `).get(cuenta.id).t;
  const egresosLineas = db.prepare(`
    SELECT COALESCE(SUM(pl.monto), 0) as t
    FROM pago_lineas pl
    JOIN pagos p ON p.id = pl.pago_id
    WHERE pl.cuenta_id = ? AND p.estado = 'Confirmado' AND pl.cheque_id IS NULL
  `).get(cuenta.id).t;
  const egresosLegacy = db.prepare(`
    SELECT COALESCE(SUM(p.monto), 0) as t
    FROM pagos p
    WHERE p.cuenta_id = ? AND p.estado = 'Confirmado'
      AND NOT EXISTS (SELECT 1 FROM pago_lineas pl WHERE pl.pago_id = p.id)
  `).get(cuenta.id).t;
  const transf = db.prepare(`
    SELECT COALESCE(SUM(al.debe - al.haber), 0) as t
    FROM asiento_lineas al
    JOIN asientos a ON a.id = al.asiento_id
    WHERE al.cuenta_id = ? AND a.estado = 'Confirmado'
      AND a.tipo_origen IN ('transferencia', 'ajuste_saldo', 'cheque_deposito', 'cheque_acreditacion', 'cheque_debito', 'cheque_rechazo')
  `).get(cuenta.id).t;
  const ingresos = Number(ingresosLineas || 0) + Number(ingresosLegacy || 0);
  const egresos = Number(egresosLineas || 0) + Number(egresosLegacy || 0);
  const saldo = Number(((Number(cuenta.saldo_inicial) || 0) + ingresos - egresos + Number(transf || 0)).toFixed(2));
  db.prepare('UPDATE cuentas SET saldo_actual = ? WHERE id = ?').run(saldo, cuenta.id);
  return saldo;
}

export function listCuentas() {
  const cuentas = db.prepare(`
    SELECT c.*,
           COALESCE(pc.codigo, '') as plan_cuenta_codigo,
           COALESCE(pc.nombre, '') as plan_cuenta_nombre
    FROM cuentas c
    LEFT JOIN plan_cuentas pc ON pc.id = c.cuenta_contable_id
    ORDER BY c.id ASC
  `).all();
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

  db.exec('BEGIN');
  try {
    const info = db.prepare(`
      INSERT INTO cuentas (nombre, tipo, moneda, cuenta_contable_id, saldo_inicial, saldo_actual, activa)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(nombre, tipo, moneda, cuentaContableId, saldoInicial, saldoInicial);
    const id = Number(info.lastInsertRowid);

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
    db.exec('COMMIT');
    return id;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function ajustarSaldoCuenta(id, b = {}) {
  const cuenta = db.prepare('SELECT * FROM cuentas WHERE id = ?').get(Number(id));
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

  db.exec('BEGIN');
  try {
    const asientoId = defaultAsientoService.createAsiento({
      diario_id: diario?.id || null,
      fecha,
      tipo_origen: 'ajuste_saldo',
      origen_id: cuenta.id,
      concepto: motivo,
      lineas: diferencia > 0 ? [lineCuenta, lineContra] : [lineContra, lineCuenta],
    });
    const saldoNuevo = recalcCuentaSaldo(cuenta.id);
    db.exec('COMMIT');
    return { asiento_id: asientoId, saldo_anterior: saldoActual, saldo_nuevo: saldoNuevo, diferencia };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function updateCuenta(id, b) {
  const ex = db.prepare('SELECT * FROM cuentas WHERE id = ?').get(id);
  if (!ex) return false;
  const cuentaContableId = b.cuenta_contable_id !== undefined
    ? (b.cuenta_contable_id ? Number(b.cuenta_contable_id) : null)
    : ex.cuenta_contable_id;
  db.prepare(`
    UPDATE cuentas SET nombre=?, tipo=?, moneda=?, cuenta_contable_id=?, saldo_inicial=?, activa=? WHERE id=?
  `).run(
    b.nombre !== undefined ? b.nombre.trim() : ex.nombre,
    b.tipo !== undefined ? b.tipo : ex.tipo,
    b.moneda !== undefined ? b.moneda : ex.moneda,
    cuentaContableId,
    b.saldo_inicial !== undefined ? Number(b.saldo_inicial) : ex.saldo_inicial,
    b.activa !== undefined ? (b.activa ? 1 : 0) : ex.activa,
    id
  );
  recalcCuentaSaldo(id);
  return true;
}

export function deleteCuenta(id) {
  db.prepare('DELETE FROM cuentas WHERE id = ?').run(id);
}

export function listPagos({ cuenta_id, contacto_id, proveedor_id } = {}) {
  let sql = `
    SELECT p.*, COALESCE(c.nombre, '') as cuenta_nombre, COALESCE(co.nombre, '') as proveedor_nombre, COALESCE(co.nombre, '') as contacto_nombre
    FROM pagos p
    LEFT JOIN cuentas c ON c.id = p.cuenta_id
    LEFT JOIN contactos co ON co.id = p.contacto_id
    WHERE 1=1
  `;
  const args = [];
  const filterContacto = contacto_id || proveedor_id;
  if (cuenta_id) { sql += ' AND p.cuenta_id = ?'; args.push(Number(cuenta_id)); }
  if (filterContacto) { sql += ' AND p.contacto_id = ?'; args.push(Number(filterContacto)); }
  sql += ' ORDER BY p.fecha DESC, p.id DESC';
  return db.prepare(sql).all(...args);
}

export function getPagoById(id) {
  const pago = db.prepare(`
    SELECT p.*,
           COALESCE(c.nombre, '') as cuenta_nombre,
           COALESCE(co.nombre, '') as proveedor_nombre,
           COALESCE(co.nombre, '') as contacto_nombre,
           COALESCE(NULLIF(co.razon_social, ''), co.nombre, '') as contacto_razon_social,
           COALESCE(co.tipo_documento, 'CUIT') as contacto_tipo_documento,
           COALESCE(co.cuit, '') as contacto_cuit,
           COALESCE(co.condicion_iva, '') as contacto_condicion_iva,
           COALESCE(NULLIF(co.direccion_fiscal, ''), co.direccion, '') as contacto_direccion,
           COALESCE(co.localidad, '') as contacto_localidad,
           COALESCE(co.provincia, '') as contacto_provincia,
           COALESCE(cmp.numero, '') as compra_numero
    FROM pagos p
    LEFT JOIN cuentas c ON c.id = p.cuenta_id
    LEFT JOIN contactos co ON co.id = p.contacto_id
    LEFT JOIN compras cmp ON cmp.id = p.compra_id
    WHERE p.id = ?
  `).get(Number(id));
  if (!pago) return null;
  const lineas = db.prepare(`
    SELECT pl.*, COALESCE(c.nombre, '') as cuenta_nombre
    FROM pago_lineas pl
    LEFT JOIN cuentas c ON c.id = pl.cuenta_id
    WHERE pl.pago_id = ?
    ORDER BY pl.id ASC
  `).all(Number(id));
  const retenciones = db.prepare(`
    SELECT pr.*, COALESCE(ic.codigo, '') as impuesto_codigo
    FROM pago_retenciones pr
    LEFT JOIN impuestos_config ic ON ic.id = pr.impuesto_id
    WHERE pr.pago_id = ?
    ORDER BY pr.id ASC
  `).all(Number(id));
  return { pago, lineas, retenciones };
}

function sanitizeTesoreriaLineas(b) {
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

const METODOS_POR_TIPO_CUENTA = {
  efectivo: ['Efectivo'],
  banco: ['Transferencia', 'Cheque'],
  billetera: ['MercadoPago', 'Transferencia', 'Otro'],
};

function validateCuentaMetodoLineas(cuentaRepo, lineas) {
  for (const l of lineas) {
    if (!l.cuenta_id) continue;
    const cta = cuentaRepo.findById(l.cuenta_id);
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

export function createPago(b, user = null) {
  const lineas = sanitizeTesoreriaLineas(b);
  const monto = Number(lineas.reduce((s, l) => s + l.monto, 0).toFixed(2));
  if (monto <= 0 || lineas.length === 0) throw new Error('El monto del pago debe ser mayor a 0');

  const rawRets = Array.isArray(b.retenciones) ? b.retenciones : [];
  const retenciones = rawRets
    .map(r => {
      const imp = r.impuesto_id ? db.prepare('SELECT * FROM impuestos_config WHERE id = ?').get(Number(r.impuesto_id)) : null;
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
  const rawNum = (b.numero || '').trim();
  const numero = (!rawNum || rawNum.endsWith('-'))
    ? getNextNumeroDocumento('pago', b.punto_venta).numero
    : rawNum;

  const pagoRepo = new BaseRepository({ model: MODELS.pagos });
  const pagoLineaRepo = new BaseRepository({ model: MODELS.pago_lineas });
  const cuentaRepo = new BaseRepository({ model: MODELS.cuentas });
  validateCuentaMetodoLineas(cuentaRepo, lineas);

  return pagoRepo.transaction(() => {
    const metodoPagoId = b.metodo_pago_id
      ? Number(b.metodo_pago_id)
      : (db.prepare('SELECT id FROM metodos_pago WHERE LOWER(nombre) = LOWER(?) LIMIT 1').get(metodoCab)?.id || null);
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
      const retRepo = new BaseRepository({ model: MODELS.pago_retenciones });
      const ctaRetDefault = db.prepare("SELECT id, codigo, nombre FROM plan_cuentas WHERE codigo = '2.1.03' LIMIT 1").get();
      for (const ret of retenciones) {
        let certNro = ret.numero_certificado;
        if (!certNro) {
          try {
            certNro = getNextNumeroDocumento('retencion').numero;
          } catch (_) {
            certNro = `RET-${String(pagoId).padStart(6, '0')}`;
          }
        }
        retRepo.create({
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
          ? db.prepare('SELECT id, codigo, nombre FROM plan_cuentas WHERE id = ?').get(ret.plan_cuenta_id)
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

    if ((b.estado || 'Confirmado') === 'Confirmado' && (hasChequeOrCuenta || retenciones.length > 0) && asientoLineas.length > 0) {
      let planCta = planCuentaId ? db.prepare('SELECT id, codigo, nombre FROM plan_cuentas WHERE id = ?').get(planCuentaId) : null;
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

    if ((b.estado || 'Confirmado') === 'Confirmado') {
      if (Array.isArray(b.imputaciones) && b.imputaciones.length > 0) {
        for (const imp of b.imputaciones) {
          crearImputacion({
            fecha,
            dominio: 'compras',
            comprobante_tipo: 'pago',
            comprobante_id: pagoId,
            factura_id: imp.factura_id,
            monto_imputado: imp.monto_imputado,
          });
        }
      } else if (b.compra_id) {
        const cmp = db.prepare('SELECT id, total FROM compras WHERE id = ?').get(Number(b.compra_id));
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
    return pagoId;
  });
}

export function deletePago(id) {
  const pagoRepo = new BaseRepository({ model: MODELS.pagos });
  const pagoLineaRepo = new BaseRepository({ model: MODELS.pago_lineas });
  const asientoRepo = new BaseRepository({ model: MODELS.asientos });
  const ex = pagoRepo.findById(id);
  const lineas = pagoLineaRepo.findWhere({ pago_id: Number(id) });
  const cuentasAfectadas = new Set(lineas.map(l => l.cuenta_id).filter(Boolean));
  if (ex?.cuenta_id) cuentasAfectadas.add(ex.cuenta_id);
  asientoRepo.query().where('tipo_origen', 'pago').where('origen_id', Number(id)).delete();
  db.prepare("DELETE FROM imputaciones WHERE dominio = 'compras' AND comprobante_tipo = 'pago' AND comprobante_id = ?").run(Number(id));
  pagoRepo.delete(id);
  for (const cid of cuentasAfectadas) recalcCuentaSaldo(cid);
}

export function listCobros({ cuenta_id, contacto_id, cliente_id } = {}) {
  let sql = `
    SELECT co.*, COALESCE(c.nombre, '') as cuenta_nombre,
           COALESCE(ct.nombre, '') as cliente_nombre,
           COALESCE(ct.nombre, '') as contacto_nombre
    FROM cobros co
    LEFT JOIN cuentas c ON c.id = co.cuenta_id
    LEFT JOIN contactos ct ON ct.id = co.contacto_id
    WHERE 1=1
  `;
  const args = [];
  const filterContacto = contacto_id || cliente_id;
  if (cuenta_id) { sql += ' AND co.cuenta_id = ?'; args.push(Number(cuenta_id)); }
  if (filterContacto) { sql += ' AND co.contacto_id = ?'; args.push(Number(filterContacto)); }
  sql += ' ORDER BY co.fecha DESC, co.id DESC';
  return db.prepare(sql).all(...args);
}

export function getCobroById(id) {
  const cobro = db.prepare(`
    SELECT co.*,
           COALESCE(c.nombre, '') as cuenta_nombre,
           COALESCE(ct.nombre, '') as cliente_nombre,
           COALESCE(ct.nombre, '') as contacto_nombre,
           COALESCE(NULLIF(ct.razon_social, ''), ct.nombre, '') as contacto_razon_social,
           COALESCE(ct.tipo_documento, 'CUIT') as contacto_tipo_documento,
           COALESCE(ct.cuit, '') as contacto_cuit,
           COALESCE(ct.condicion_iva, '') as contacto_condicion_iva,
           COALESCE(NULLIF(ct.direccion_fiscal, ''), ct.direccion, '') as contacto_direccion,
           COALESCE(ct.localidad, '') as contacto_localidad,
           COALESCE(ct.provincia, '') as contacto_provincia,
           COALESCE(v.numero, '') as venta_numero
    FROM cobros co
    LEFT JOIN cuentas c ON c.id = co.cuenta_id
    LEFT JOIN contactos ct ON ct.id = co.contacto_id
    LEFT JOIN ventas v ON v.id = co.venta_id
    WHERE co.id = ?
  `).get(Number(id));
  if (!cobro) return null;
  const lineas = db.prepare(`
    SELECT cl.*, COALESCE(c.nombre, '') as cuenta_nombre
    FROM cobro_lineas cl
    LEFT JOIN cuentas c ON c.id = cl.cuenta_id
    WHERE cl.cobro_id = ?
    ORDER BY cl.id ASC
  `).all(Number(id));
  return { cobro, lineas };
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
  const rawNum = (b.numero || '').trim();
  const numero = (!rawNum || rawNum.endsWith('-'))
    ? getNextNumeroDocumento('cobro', b.punto_venta).numero
    : rawNum;

  const cobroRepo = new BaseRepository({ model: MODELS.cobros });
  const cobroLineaRepo = new BaseRepository({ model: MODELS.cobro_lineas });
  const cuentaRepo = new BaseRepository({ model: MODELS.cuentas });
  validateCuentaMetodoLineas(cuentaRepo, lineas);

  return cobroRepo.transaction(() => {
    const metodoPagoId = b.metodo_pago_id
      ? Number(b.metodo_pago_id)
      : (db.prepare('SELECT id FROM metodos_pago WHERE LOWER(nombre) = LOWER(?) LIMIT 1').get(metodoCab)?.id || null);
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

    if ((b.estado || 'Confirmado') === 'Confirmado' && hasChequeOrCuenta && asientoLineas.length > 0) {
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

    if ((b.estado || 'Confirmado') === 'Confirmado') {
      if (Array.isArray(b.imputaciones) && b.imputaciones.length > 0) {
        for (const imp of b.imputaciones) {
          crearImputacion({
            fecha,
            dominio: 'ventas',
            comprobante_tipo: 'cobro',
            comprobante_id: cobroId,
            factura_id: imp.factura_id,
            monto_imputado: imp.monto_imputado,
          });
        }
      } else if (b.venta_id) {
        const vta = db.prepare('SELECT id, total FROM ventas WHERE id = ?').get(Number(b.venta_id));
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
    return cobroId;
  });
}

export function deleteCobro(id) {
  const cobroRepo = new BaseRepository({ model: MODELS.cobros });
  const cobroLineaRepo = new BaseRepository({ model: MODELS.cobro_lineas });
  const asientoRepo = new BaseRepository({ model: MODELS.asientos });
  const ex = cobroRepo.findById(id);
  const lineas = cobroLineaRepo.findWhere({ cobro_id: Number(id) });
  const cuentasAfectadas = new Set(lineas.map(l => l.cuenta_id).filter(Boolean));
  if (ex?.cuenta_id) cuentasAfectadas.add(ex.cuenta_id);
  asientoRepo.query().where('tipo_origen', 'cobro').where('origen_id', Number(id)).delete();
  db.prepare("DELETE FROM imputaciones WHERE dominio = 'ventas' AND comprobante_tipo = 'cobro' AND comprobante_id = ?").run(Number(id));
  cobroRepo.delete(id);
  for (const cid of cuentasAfectadas) recalcCuentaSaldo(cid);
}

export function createTransferencia(b) {
  const origenId = Number(b.cuenta_origen_id);
  const destinoId = Number(b.cuenta_destino_id);
  const monto = Number(b.monto) || 0;
  if (!origenId || !destinoId || origenId === destinoId) {
    throw new Error('Seleccioná dos cuentas distintas para transferir');
  }
  if (monto <= 0) throw new Error('El monto debe ser mayor a 0');
  const ori = db.prepare('SELECT * FROM cuentas WHERE id = ?').get(origenId);
  const des = db.prepare('SELECT * FROM cuentas WHERE id = ?').get(destinoId);
  if (!ori || !des) throw new Error('Cuenta no encontrada');

  const fecha = b.fecha || new Date().toISOString().slice(0, 10);
  const concepto = (b.concepto || `Transferencia ${ori.nombre} → ${des.nombre}`).trim();
  const planOri = resolveCuentaPlanContable(ori);
  const planDes = resolveCuentaPlanContable(des);
  const diario = (ori.tipo === 'banco' || des.tipo === 'banco')
    ? resolveDiarioCuenta({ tipo: 'banco' })
    : resolveDiarioCuenta({ tipo: 'efectivo' });

  db.exec('BEGIN');
  try {
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
    db.exec('COMMIT');
    return asientoId;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function getPeriodoInfo(isoDate, granularidad = 'semana') {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}/.test(isoDate)) {
    return { key: 'Sin fecha', label: 'Sin fecha' };
  }
  const clean = isoDate.slice(0, 10);
  if (granularidad === 'mes') {
    const ym = clean.slice(0, 7);
    return { key: ym, label: ym };
  }
  const [y, m, d] = clean.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const offsetToMonday = (dt.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(y, m - 1, d - offsetToMonday));
  const sunday = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + 6));
  const fmt = (x) => `${String(x.getUTCDate()).padStart(2, '0')}/${String(x.getUTCMonth() + 1).padStart(2, '0')}`;
  return {
    key: monday.toISOString().slice(0, 10),
    label: `Sem ${fmt(monday)} – ${fmt(sunday)}`,
  };
}

export function getFlujoCaja({ desde, hasta, cuenta_id, granularidad = 'semana' } = {}) {
  const cuentas = listCuentas();
  const cobros = listCobros({ cuenta_id }).filter(c => c.estado === 'Confirmado');
  const pagos = listPagos({ cuenta_id }).filter(p => p.estado === 'Confirmado');

  let transfSql = `
    SELECT al.id, a.fecha, a.numero, al.cuenta_id, COALESCE(c.nombre, '') as cuenta_nombre,
           a.concepto, (al.debe - al.haber) as monto
    FROM asiento_lineas al
    JOIN asientos a ON a.id = al.asiento_id
    LEFT JOIN cuentas c ON c.id = al.cuenta_id
    WHERE a.tipo_origen = 'transferencia' AND al.cuenta_id IS NOT NULL
  `;
  const transfArgs = [];
  if (cuenta_id) { transfSql += ' AND al.cuenta_id = ?'; transfArgs.push(Number(cuenta_id)); }
  const transferencias = db.prepare(transfSql).all(...transfArgs);

  const allMovs = [
    ...cobros.map(c => ({
      tipo: 'ingreso',
      id: c.id,
      fecha: c.fecha,
      numero: c.numero,
      cuenta_id: c.cuenta_id,
      cuenta_nombre: c.cuenta_nombre,
      contraparte: c.cliente_nombre || c.proveedor_nombre || '-',
      concepto: c.concepto || 'Cobro',
      metodo: c.metodo,
      monto: Number(c.monto) || 0,
    })),
    ...pagos.map(p => ({
      tipo: 'egreso',
      id: p.id,
      fecha: p.fecha,
      numero: p.numero,
      cuenta_id: p.cuenta_id,
      cuenta_nombre: p.cuenta_nombre,
      contraparte: p.proveedor_nombre || p.categoria_gasto || '-',
      concepto: p.concepto || p.categoria_gasto || 'Pago',
      metodo: p.metodo,
      monto: -(Number(p.monto) || 0),
    })),
    ...transferencias.map(t => ({
      tipo: 'transferencia',
      id: t.id,
      fecha: t.fecha,
      numero: t.numero || '',
      cuenta_id: t.cuenta_id,
      cuenta_nombre: t.cuenta_nombre,
      contraparte: 'Transferencia Interna',
      concepto: t.concepto || 'Transferencia entre cuentas',
      metodo: 'Transferencia',
      monto: Number(t.monto) || 0,
    })),
  ].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id);

  const saldoInicialBase = cuentas
    .filter(c => !cuenta_id || Number(c.id) === Number(cuenta_id))
    .reduce((s, c) => s + Number(c.saldo_inicial || 0), 0);

  const previo = desde ? allMovs.filter(m => m.fecha < desde).reduce((s, m) => s + m.monto, 0) : 0;
  const saldoApertura = Number((saldoInicialBase + previo).toFixed(2));

  const movs = allMovs.filter(m => {
    if (desde && m.fecha < desde) return false;
    if (hasta && m.fecha > hasta) return false;
    return true;
  });

  let saldo = saldoApertura;
  const timeline = movs.map(m => {
    saldo = Number((saldo + m.monto).toFixed(2));
    return { ...m, saldo_acumulado: saldo };
  });

  const porPeriodoMap = new Map();
  for (const m of timeline) {
    const { key, label } = getPeriodoInfo(m.fecha, granularidad);
    if (!porPeriodoMap.has(key)) {
      porPeriodoMap.set(key, { periodo: key, periodo_label: label, ingresos: 0, egresos: 0, transferencias_neto: 0, flujo_neto: 0, saldo_cierre: m.saldo_acumulado });
    }
    const row = porPeriodoMap.get(key);
    if (m.tipo === 'ingreso') row.ingresos += m.monto;
    else if (m.tipo === 'egreso') row.egresos += Math.abs(m.monto);
    else if (m.tipo === 'transferencia') row.transferencias_neto += m.monto;
    row.flujo_neto = Number((row.ingresos - row.egresos + row.transferencias_neto).toFixed(2));
    row.saldo_cierre = m.saldo_acumulado;
  }
  const por_periodo = [...porPeriodoMap.values()]
    .sort((a, b) => a.periodo.localeCompare(b.periodo))
    .map(r => ({
      ...r,
      ingresos: Number(r.ingresos.toFixed(2)),
      egresos: Number(r.egresos.toFixed(2)),
      transferencias_neto: Number(r.transferencias_neto.toFixed(2)),
    }));

  const timelineDesc = [...timeline].reverse();

  const totalIngresos = movs.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + m.monto, 0);
  const totalEgresos = movs.filter(m => m.tipo === 'egreso').reduce((s, m) => s + Math.abs(m.monto), 0);
  const saldoTotalCuentas = cuentas.reduce((s, c) => s + Number(c.saldo_actual || 0), 0);

  return {
    cuentas,
    resumen: {
      saldo_apertura: saldoApertura,
      saldo_cierre: Number(saldo.toFixed(2)),
      saldo_total_cuentas: Number(saldoTotalCuentas.toFixed(2)),
      total_ingresos: Number(totalIngresos.toFixed(2)),
      total_egresos: Number(totalEgresos.toFixed(2)),
      flujo_neto: Number((totalIngresos - totalEgresos).toFixed(2)),
    },
    granularidad,
    por_periodo,
    movimientos: timelineDesc,
  };
}

export function getFlujoOperativo() {
  const cuentas = listCuentas();
  const cajaTotal = cuentas.reduce((s, c) => s + Number(c.saldo_actual || 0), 0);

  const comprasTotal = db.prepare("SELECT COALESCE(SUM(total), 0) as t FROM compras WHERE estado = 'Confirmado'").get().t;
  const pagosProveedores = db.prepare("SELECT COALESCE(SUM(monto), 0) as t FROM pagos WHERE estado = 'Confirmado' AND contacto_id IS NOT NULL").get().t;
  const pagosOtros = db.prepare("SELECT COALESCE(SUM(monto), 0) as t FROM pagos WHERE estado = 'Confirmado' AND contacto_id IS NULL").get().t;

  const ventasTotal = db.prepare("SELECT COALESCE(SUM(total), 0) as t FROM ventas WHERE estado IN ('Confirmada', 'Entregada')").get().t;
  const cobrosClientes = db.prepare("SELECT COALESCE(SUM(monto), 0) as t FROM cobros WHERE estado = 'Confirmado' AND contacto_id IS NOT NULL").get().t;

  const ordenesActivas = db.prepare("SELECT COUNT(*) as c FROM ordenes_produccion WHERE estado IN ('Planificada', 'En Proceso')").get().c;
  const ordenesCompletadas = db.prepare("SELECT COUNT(*) as c FROM ordenes_produccion WHERE estado = 'Completada'").get().c;
  const valorStock = db.prepare("SELECT COALESCE(SUM(stock * precio), 0) as t FROM productos WHERE activo = 1 AND stock > 0").get().t;

  const porCobrar = Math.max(0, Number(ventasTotal) - Number(cobrosClientes));
  const porPagar = Math.max(0, Number(comprasTotal) - Number(pagosProveedores));

  return {
    caja_disponible: Number(cajaTotal.toFixed(2)),
    cuentas_por_cobrar: Number(porCobrar.toFixed(2)),
    cuentas_por_pagar: Number(porPagar.toFixed(2)),
    posicion_neta_proyectada: Number((cajaTotal + porCobrar - porPagar).toFixed(2)),
    valor_inventario: Number(Number(valorStock).toFixed(2)),
    compras_totales: Number(Number(comprasTotal).toFixed(2)),
    ventas_totales: Number(Number(ventasTotal).toFixed(2)),
    gastos_operativos: Number(Number(pagosOtros).toFixed(2)),
    ordenes_activas: Number(ordenesActivas),
    ordenes_completadas: Number(ordenesCompletadas),
    cuentas,
  };
}

export function getDashboardSummary() {
  const flujo = getFlujoOperativo();
  const cmpRepo = new BaseRepository({ model: MODELS.compras });
  const opRepo = new BaseRepository({ model: MODELS.operaciones_stock });
  const vtaRepo = new BaseRepository({ model: MODELS.ventas });

  const borradores = {
    compras: cmpRepo.query().where('estado', 'Borrador').count(),
    recepciones: opRepo.query().where('estado', 'Borrador').where('tipo', 'recepcion').count(),
    entregas: opRepo.query().where('estado', 'Borrador').where('tipo', 'entrega').count(),
    remitos_taller: opRepo.query().where('estado', 'Borrador').where('tipo', 'remito_taller').count(),
    presupuestos_venta: vtaRepo.query().whereIn('estado', ['Presupuesto', 'Borrador']).count(),
  };

  const stock_bajo_minimo = listProductos()
    .filter(p => Number(p.stock_minimo) > 0 && Number(p.stock) <= Number(p.stock_minimo))
    .sort((a, b) => (Number(b.stock_minimo) - Number(b.stock)) - (Number(a.stock_minimo) - Number(a.stock)))
    .slice(0, 10);

  const ordenes_activas_list = listOrdenes()
    .filter(o => o.estado !== 'Completada' && o.estado !== 'Cancelada')
    .slice(0, 8)
    .map(o => ({
      id: o.id,
      codigo: o.codigo,
      estado: o.estado,
      fecha_inicio: o.fecha_inicio,
      fecha_objetivo: o.fecha_objetivo,
      cantidad: o.cantidad,
      modelo_nombre: o.plantilla_nombre || '',
    }));

  return {
    ...flujo,
    borradores,
    stock_bajo_minimo,
    ordenes_activas_list,
  };
}

const proyeccionRepo = new BaseRepository({ model: MODELS.flujo_proyecciones });

export function listProyecciones() {
  return db.prepare(`
    SELECT fp.*,
           COALESCE(pc.codigo || ' ' || pc.nombre, '') as plan_cuenta_nombre,
           COALESCE(c.nombre, '') as cuenta_nombre
    FROM flujo_proyecciones fp
    LEFT JOIN plan_cuentas pc ON pc.id = fp.plan_cuenta_id
    LEFT JOIN cuentas c ON c.id = fp.cuenta_id
    ORDER BY fp.activo DESC, fp.fecha_inicio ASC, fp.id ASC
  `).all();
}

export function createProyeccion(b) {
  const payload = {
    concepto: (b.concepto || '').trim(),
    tipo: b.tipo === 'ingreso' ? 'ingreso' : 'egreso',
    categoria: (b.categoria || 'Servicios').trim(),
    plan_cuenta_id: b.plan_cuenta_id ? Number(b.plan_cuenta_id) : null,
    cuenta_id: b.cuenta_id ? Number(b.cuenta_id) : null,
    monto: Number(b.monto) || 0,
    frecuencia: b.frecuencia || 'mensual',
    fecha_inicio: b.fecha_inicio || new Date().toISOString().slice(0, 10),
    fecha_fin: (b.fecha_fin || '').trim(),
    activo: b.activo !== undefined ? (b.activo ? 1 : 0) : 1,
    observaciones: (b.observaciones || '').trim(),
  };
  if (!payload.concepto) throw new Error('El concepto de la proyección es obligatorio');
  if (payload.monto <= 0) throw new Error('El monto proyectado debe ser mayor a 0');
  proyeccionRepo.validate(payload);
  return proyeccionRepo.create(payload);
}

export function updateProyeccion(id, b) {
  const ex = proyeccionRepo.findById(Number(id));
  if (!ex) return false;
  const payload = {
    concepto: b.concepto !== undefined ? String(b.concepto).trim() : ex.concepto,
    tipo: b.tipo !== undefined ? (b.tipo === 'ingreso' ? 'ingreso' : 'egreso') : ex.tipo,
    categoria: b.categoria !== undefined ? String(b.categoria).trim() : ex.categoria,
    plan_cuenta_id: b.plan_cuenta_id !== undefined ? (b.plan_cuenta_id ? Number(b.plan_cuenta_id) : null) : ex.plan_cuenta_id,
    cuenta_id: b.cuenta_id !== undefined ? (b.cuenta_id ? Number(b.cuenta_id) : null) : ex.cuenta_id,
    monto: b.monto !== undefined ? Number(b.monto) : ex.monto,
    frecuencia: b.frecuencia !== undefined ? b.frecuencia : ex.frecuencia,
    fecha_inicio: b.fecha_inicio !== undefined ? b.fecha_inicio : ex.fecha_inicio,
    fecha_fin: b.fecha_fin !== undefined ? String(b.fecha_fin || '').trim() : ex.fecha_fin,
    activo: b.activo !== undefined ? (b.activo ? 1 : 0) : ex.activo,
    observaciones: b.observaciones !== undefined ? String(b.observaciones || '').trim() : ex.observaciones,
  };
  proyeccionRepo.validate(payload, { partial: true });
  proyeccionRepo.update(Number(id), payload);
  return true;
}

export function deleteProyeccion(id) {
  proyeccionRepo.delete(Number(id));
}

function addDaysIso(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function addMonthsIso(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(d, lastDay));
  return dt.toISOString().slice(0, 10);
}

function advanceProyeccionDate(iso, frecuencia) {
  switch (frecuencia) {
    case 'semanal': return addDaysIso(iso, 7);
    case 'quincenal': return addDaysIso(iso, 15);
    case 'mensual': return addMonthsIso(iso, 1);
    case 'bimestral': return addMonthsIso(iso, 2);
    case 'trimestral': return addMonthsIso(iso, 3);
    case 'anual': return addMonthsIso(iso, 12);
    default: return null;
  }
}

export function getFlujoProyectado({ desde, hasta, dias = 30, meses, cuenta_id, granularidad = 'semana' } = {}) {
  const hoy = desde || new Date().toISOString().slice(0, 10);
  const limite = hasta || (meses && !dias
    ? addMonthsIso(hoy, Math.max(1, Math.min(3, Number(meses) || 1)))
    : addDaysIso(hoy, Math.max(7, Math.min(90, Number(dias) || 30))));
  const cuentas = listCuentas().filter(c => !cuenta_id || Number(c.id) === Number(cuenta_id));
  const cajaActual = Number(cuentas.reduce((s, c) => s + Number(c.saldo_actual || 0), 0).toFixed(2));

  const eventos = [];

  if (!cuenta_id) {
    const ventasPend = db.prepare(`
      SELECT v.id, v.numero, v.fecha, v.fecha_vencimiento, v.fecha_entrega_est, v.total,
             COALESCE(co.nombre, '') as contacto_nombre,
             COALESCE((SELECT SUM(cb.monto) FROM cobros cb WHERE cb.venta_id = v.id AND cb.estado = 'Confirmado'), 0) as cobrado
      FROM ventas v
      LEFT JOIN contactos co ON co.id = v.contacto_id
      WHERE v.estado IN ('Confirmada', 'Entregada') AND v.clase_documento != 'nota_credito'
    `).all();

    for (const v of ventasPend) {
      const pendiente = Number((Number(v.total || 0) - Number(v.cobrado || 0)).toFixed(2));
      if (pendiente <= 0.01) continue;
      const fechaEst = (v.fecha_vencimiento || v.fecha_entrega_est || v.fecha || hoy).trim();
      if (fechaEst > limite) continue;
      eventos.push({
        fecha: fechaEst,
        vencido: fechaEst < hoy,
        tipo: 'ingreso',
        origen: 'venta',
        origen_id: v.id,
        estado_flujo: 'Comprometido',
        contraparte: v.contacto_nombre || '-',
        concepto: `Cobro Venta ${v.numero || '#' + v.id}`,
        monto: pendiente,
      });
    }

    const comprasPend = db.prepare(`
      SELECT c.id, c.numero, c.fecha, c.fecha_vencimiento, c.total,
             COALESCE(co.nombre, '') as contacto_nombre,
             COALESCE((SELECT SUM(COALESCE(NULLIF(p.total_bruto, 0), p.monto)) FROM pagos p WHERE p.compra_id = c.id AND p.estado = 'Confirmado'), 0) as pagado
      FROM compras c
      LEFT JOIN contactos co ON co.id = c.contacto_id
      WHERE c.estado = 'Confirmado' AND c.clase_documento != 'nota_credito'
    `).all();

    for (const c of comprasPend) {
      const pendiente = Number((Number(c.total || 0) - Number(c.pagado || 0)).toFixed(2));
      if (pendiente <= 0.01) continue;
      const fechaEst = (c.fecha_vencimiento || c.fecha || hoy).trim();
      if (fechaEst > limite) continue;
      eventos.push({
        fecha: fechaEst,
        vencido: fechaEst < hoy,
        tipo: 'egreso',
        origen: 'compra',
        origen_id: c.id,
        estado_flujo: 'Comprometido',
        contraparte: c.contacto_nombre || '-',
        concepto: `Pago Compra ${c.numero || '#' + c.id}`,
        monto: -pendiente,
      });
    }
  }

  const proyecciones = listProyecciones().filter(p => p.activo !== 0 && (!cuenta_id || !p.cuenta_id || Number(p.cuenta_id) === Number(cuenta_id)));
  for (const p of proyecciones) {
    const endCap = p.fecha_fin && p.fecha_fin < limite ? p.fecha_fin : limite;
    let cur = p.fecha_inicio;
    let guard = 0;
    while (cur && cur <= endCap && guard < 120) {
      guard++;
      if (cur >= hoy) {
        const signo = p.tipo === 'ingreso' ? 1 : -1;
        eventos.push({
          fecha: cur,
          vencido: false,
          tipo: p.tipo,
          origen: 'recurrente',
          origen_id: p.id,
          estado_flujo: 'Estimado',
          contraparte: p.plan_cuenta_nombre || p.categoria || '-',
          concepto: p.concepto,
          monto: Number((signo * Number(p.monto || 0)).toFixed(2)),
        });
      }
      if (p.frecuencia === 'unico') break;
      cur = advanceProyeccionDate(cur, p.frecuencia);
    }
  }

  const chequesActivos = db.prepare(`
    SELECT ch.*, COALESCE(co.nombre, '') as contacto_nombre
    FROM cheques ch
    LEFT JOIN contactos co ON co.id = ch.contacto_origen_id
    WHERE (ch.origen = 'terceros' AND ch.estado IN ('En Cartera', 'Depositado'))
       OR (ch.origen = 'propio' AND ch.estado = 'Emitido')
  `).all();
  for (const ch of chequesActivos) {
    const fechaCh = (ch.fecha_pago || ch.fecha_emision || hoy).trim();
    if (fechaCh > limite) continue;
    if (cuenta_id && Number(ch.cuenta_bancaria_id || 0) !== Number(cuenta_id)) continue;
    const esIngreso = ch.origen === 'terceros';
    eventos.push({
      fecha: fechaCh,
      vencido: fechaCh < hoy,
      tipo: esIngreso ? 'ingreso' : 'egreso',
      origen: esIngreso ? 'cheque_tercero' : 'cheque_propio',
      origen_id: ch.id,
      estado_flujo: ch.estado,
      contraparte: ch.librador_nombre || ch.contacto_nombre || ch.banco || '-',
      concepto: `${esIngreso ? 'Cheque 3°' : 'Cheque Propio'} N° ${ch.numero}${ch.echeq ? ' (E-Cheq)' : ''}`,
      monto: Number(((esIngreso ? 1 : -1) * Number(ch.monto || 0)).toFixed(2)),
    });
  }

  eventos.sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.origen > b.origen ? 1 : -1));

  let saldo = cajaActual;
  const timeline = eventos.map(ev => {
    saldo = Number((saldo + ev.monto).toFixed(2));
    return { ...ev, saldo_acumulado: saldo };
  });

  const porMesMap = new Map();
  let runningMonthSaldo = cajaActual;
  for (const ev of timeline) {
    const { key: periodo, label: periodo_label } = getPeriodoInfo(ev.fecha || hoy, granularidad);
    if (!porMesMap.has(periodo)) {
      porMesMap.set(periodo, {
        periodo,
        periodo_label,
        ingresos_comprometidos: 0,
        ingresos_estimados: 0,
        egresos_comprometidos: 0,
        egresos_estimados: 0,
        flujo_neto: 0,
        saldo_cierre: runningMonthSaldo,
      });
    }
    const row = porMesMap.get(periodo);
    if (ev.tipo === 'ingreso') {
      if (ev.estado_flujo === 'Comprometido') row.ingresos_comprometidos += ev.monto;
      else row.ingresos_estimados += ev.monto;
    } else {
      const absM = Math.abs(ev.monto);
      if (ev.estado_flujo === 'Comprometido') row.egresos_comprometidos += absM;
      else row.egresos_estimados += absM;
    }
    row.flujo_neto = Number((
      row.ingresos_comprometidos + row.ingresos_estimados - row.egresos_comprometidos - row.egresos_estimados
    ).toFixed(2));
    runningMonthSaldo = ev.saldo_acumulado;
    row.saldo_cierre = runningMonthSaldo;
  }

  const por_mes = [...porMesMap.values()]
    .sort((a, b) => a.periodo.localeCompare(b.periodo))
    .map(r => ({
      ...r,
      ingresos_comprometidos: Number(r.ingresos_comprometidos.toFixed(2)),
      ingresos_estimados: Number(r.ingresos_estimados.toFixed(2)),
      egresos_comprometidos: Number(r.egresos_comprometidos.toFixed(2)),
      egresos_estimados: Number(r.egresos_estimados.toFixed(2)),
    }));

  const ingProj = timeline.filter(e => e.monto > 0).reduce((s, e) => s + e.monto, 0);
  const egrProj = timeline.filter(e => e.monto < 0).reduce((s, e) => s + Math.abs(e.monto), 0);

  return {
    desde: hoy,
    hasta: limite,
    granularidad,
    caja_actual: cajaActual,
    resumen: {
      ingresos_proyectados: Number(ingProj.toFixed(2)),
      egresos_proyectados: Number(egrProj.toFixed(2)),
      flujo_neto_proyectado: Number((ingProj - egrProj).toFixed(2)),
      saldo_final_proyectado: Number(saldo.toFixed(2)),
    },
    por_periodo: por_mes,
    por_mes,
    eventos: timeline,
  };
}

function buildContinuousPeriods(granularidad = 'semana', histCount = 4, proyCount = 4, refDate = null) {
  const hoyIso = refDate || new Date().toISOString().slice(0, 10);
  const periods = [];
  if (granularidad === 'mes') {
    const [y, m] = hoyIso.split('-').map(Number);
    const curYm = `${y}-${String(m).padStart(2, '0')}`;
    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    for (let i = -histCount; i <= proyCount; i++) {
      const dt = new Date(Date.UTC(y, m - 1 + i, 1));
      const py = dt.getUTCFullYear();
      const pm = dt.getUTCMonth() + 1;
      const key = `${py}-${String(pm).padStart(2, '0')}`;
      const start = `${key}-01`;
      const lastDay = new Date(Date.UTC(py, pm, 0)).getUTCDate();
      const end = `${key}-${String(lastDay).padStart(2, '0')}`;
      periods.push({
        key,
        label: `${monthNames[pm - 1]} ${py}`,
        sublabel: i < 0 ? 'Histórico' : i === 0 ? 'Mes Actual' : 'Proyectado',
        kind: i < 0 ? 'historico' : i === 0 ? 'actual' : 'proyectado',
        start,
        end,
        isCurrent: key === curYm,
      });
    }
    return periods;
  }

  const [y, m, d] = hoyIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const offsetToMonday = (dt.getUTCDay() + 6) % 7;
  const curMonday = new Date(Date.UTC(y, m - 1, d - offsetToMonday));
  const fmt = (x) => `${String(x.getUTCDate()).padStart(2, '0')}/${String(x.getUTCMonth() + 1).padStart(2, '0')}`;

  for (let i = -histCount; i <= proyCount; i++) {
    const mon = new Date(Date.UTC(curMonday.getUTCFullYear(), curMonday.getUTCMonth(), curMonday.getUTCDate() + i * 7));
    const sun = new Date(Date.UTC(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate() + 6));
    const key = mon.toISOString().slice(0, 10);
    const start = key;
    const end = sun.toISOString().slice(0, 10);
    periods.push({
      key,
      label: `${fmt(mon)} – ${fmt(sun)}`,
      sublabel: i < 0 ? 'Histórico' : i === 0 ? 'Semana Actual' : `Sem +${i}`,
      kind: i < 0 ? 'historico' : i === 0 ? 'actual' : 'proyectado',
      start,
      end,
      isCurrent: i === 0,
    });
  }
  return periods;
}

export function getFlujoMatriz({
  granularidad = 'semana',
  hist_periodos = 4,
  proy_periodos = 6,
  cuenta_id = null,
} = {}) {
  const histCount = Math.max(1, Math.min(12, Number(hist_periodos) || 4));
  const proyCount = Math.max(1, Math.min(16, Number(proy_periodos) || 6));
  const hoyIso = new Date().toISOString().slice(0, 10);
  const periods = buildContinuousPeriods(granularidad, histCount, proyCount, hoyIso);
  const firstStart = periods[0].start;
  const lastEnd = periods[periods.length - 1].end;

  const histData = getFlujoCaja({
    desde: firstStart,
    hasta: lastEnd,
    cuenta_id,
    granularidad,
  });

  const proyDays = granularidad === 'mes' ? (proyCount + 1) * 31 : (proyCount + 1) * 7;
  const proyData = getFlujoProyectado({
    desde: hoyIso,
    hasta: lastEnd,
    dias: proyDays,
    cuenta_id,
    granularidad,
  });

  const rowDefs = [
    { id: 'saldo_inicial', label: 'Saldo Inicial', type: 'balance_start' },
    { id: 'ingresos_total', label: '(+) Ingresos', type: 'group_in', children: ['ing_cobros_reales', 'ing_ventas_vencer', 'ing_cheques_cartera', 'ing_proyecciones'] },
    { id: 'ing_cobros_reales', label: 'Cobros Confirmados', type: 'item_in', parent: 'ingresos_total' },
    { id: 'ing_ventas_vencer', label: 'Ventas por Cobrar', type: 'item_in', parent: 'ingresos_total' },
    { id: 'ing_cheques_cartera', label: 'Cheques en Cartera', type: 'item_in', parent: 'ingresos_total' },
    { id: 'ing_proyecciones', label: 'Ingresos Recurrentes', type: 'item_in', parent: 'ingresos_total' },
    { id: 'egresos_total', label: '(-) Egresos', type: 'group_out', children: ['egr_pagos_reales', 'egr_compras_vencer', 'egr_cheques_propios', 'egr_proyecciones'] },
    { id: 'egr_pagos_reales', label: 'Pagos Confirmados', type: 'item_out', parent: 'egresos_total' },
    { id: 'egr_compras_vencer', label: 'Compras por Pagar', type: 'item_out', parent: 'egresos_total' },
    { id: 'egr_cheques_propios', label: 'Cheques Emitidos', type: 'item_out', parent: 'egresos_total' },
    { id: 'egr_proyecciones', label: 'Gastos Recurrentes', type: 'item_out', parent: 'egresos_total' },
    { id: 'transferencias_neto', label: 'Transferencias', type: 'neutral' },
    { id: 'flujo_neto', label: '(=) Flujo Neto', type: 'net' },
    { id: 'saldo_final', label: '(=) Saldo Final', type: 'balance_end' },
  ];

  const values = {};
  const details = {};
  for (const r of rowDefs) {
    values[r.id] = {};
    details[r.id] = {};
    for (const p of periods) {
      values[r.id][p.key] = 0;
      details[r.id][p.key] = [];
    }
  }

  const findPeriodKey = (fecha) => {
    const f = String(fecha || hoyIso).slice(0, 10);
    const match = periods.find(p => f >= p.start && f <= p.end);
    if (match) return match.key;
    // Si es un vencimiento atrasado (< hoyIso) lo imputamos al período actual
    if (f < hoyIso) {
      const cur = periods.find(p => p.isCurrent);
      if (cur && f >= firstStart) return periods[0].key;
      if (cur) return cur.key;
    }
    return null;
  };

  // Cargar movimientos reales históricos (incluye los de la semana/mes actual ya ejecutados)
  for (const m of (histData.movimientos || [])) {
    const pk = findPeriodKey(m.fecha);
    if (!pk) continue;
    if (m.tipo === 'ingreso') {
      values.ing_cobros_reales[pk] = Number((values.ing_cobros_reales[pk] + m.monto).toFixed(2));
      details.ing_cobros_reales[pk].push({
        fecha: m.fecha,
        origen: 'Cobro Real',
        contraparte: m.contraparte,
        concepto: `${m.numero ? m.numero + ' · ' : ''}${m.concepto}`,
        monto: m.monto,
      });
    } else if (m.tipo === 'egreso') {
      const absM = Math.abs(m.monto);
      values.egr_pagos_reales[pk] = Number((values.egr_pagos_reales[pk] + absM).toFixed(2));
      details.egr_pagos_reales[pk].push({
        fecha: m.fecha,
        origen: 'Pago Real',
        contraparte: m.contraparte,
        concepto: `${m.numero ? m.numero + ' · ' : ''}${m.concepto}`,
        monto: -absM,
      });
    } else if (m.tipo === 'transferencia') {
      values.transferencias_neto[pk] = Number((values.transferencias_neto[pk] + m.monto).toFixed(2));
      details.transferencias_neto[pk].push({
        fecha: m.fecha,
        origen: 'Transferencia',
        contraparte: m.cuenta_nombre || 'Interna',
        concepto: m.concepto,
        monto: m.monto,
      });
    }
  }

  // Cargar eventos proyectados (comprometidos y estimados) desde el período actual hacia adelante
  const curPeriod = periods.find(p => p.isCurrent) || periods[0];
  for (const ev of (proyData.eventos || [])) {
    const f = String(ev.fecha || hoyIso).slice(0, 10);
    let pk = periods.find(p => f >= p.start && f <= p.end)?.key || null;
    if (!pk && f < hoyIso) pk = curPeriod.key;
    if (!pk) continue;
    // No proyectar en columnas cerradas del pasado
    const pObj = periods.find(p => p.key === pk);
    if (pObj && pObj.kind === 'historico') pk = curPeriod.key;

    if (ev.tipo === 'ingreso') {
      const rowId = ev.origen === 'venta'
        ? 'ing_ventas_vencer'
        : ev.origen === 'cheque_tercero'
          ? 'ing_cheques_cartera'
          : 'ing_proyecciones';
      values[rowId][pk] = Number((values[rowId][pk] + ev.monto).toFixed(2));
      details[rowId][pk].push({
        fecha: ev.fecha,
        vencido: ev.vencido,
        origen: ev.estado_flujo || ev.origen,
        contraparte: ev.contraparte,
        concepto: ev.concepto,
        monto: ev.monto,
      });
    } else {
      const absM = Math.abs(ev.monto);
      const rowId = ev.origen === 'compra'
        ? 'egr_compras_vencer'
        : ev.origen === 'cheque_propio'
          ? 'egr_cheques_propios'
          : 'egr_proyecciones';
      values[rowId][pk] = Number((values[rowId][pk] + absM).toFixed(2));
      details[rowId][pk].push({
        fecha: ev.fecha,
        vencido: ev.vencido,
        origen: ev.estado_flujo || ev.origen,
        contraparte: ev.contraparte,
        concepto: ev.concepto,
        monto: -absM,
      });
    }
  }

  // Calcular subtotales, flujo neto y arrastrar saldo inicial -> saldo final período a período
  let runningBalance = Number(histData.resumen?.saldo_apertura ?? 0);
  const totals = {};
  for (const r of rowDefs) totals[r.id] = 0;
  totals.saldo_inicial = runningBalance;

  for (const p of periods) {
    const pk = p.key;
    values.saldo_inicial[pk] = Number(runningBalance.toFixed(2));

    const ingTotal = Number((
      values.ing_cobros_reales[pk] +
      values.ing_ventas_vencer[pk] +
      values.ing_cheques_cartera[pk] +
      values.ing_proyecciones[pk]
    ).toFixed(2));
    values.ingresos_total[pk] = ingTotal;
    details.ingresos_total[pk] = [
      ...details.ing_cobros_reales[pk],
      ...details.ing_ventas_vencer[pk],
      ...details.ing_cheques_cartera[pk],
      ...details.ing_proyecciones[pk],
    ];

    const egrTotal = Number((
      values.egr_pagos_reales[pk] +
      values.egr_compras_vencer[pk] +
      values.egr_cheques_propios[pk] +
      values.egr_proyecciones[pk]
    ).toFixed(2));
    values.egresos_total[pk] = egrTotal;
    details.egresos_total[pk] = [
      ...details.egr_pagos_reales[pk],
      ...details.egr_compras_vencer[pk],
      ...details.egr_cheques_propios[pk],
      ...details.egr_proyecciones[pk],
    ];

    const transf = values.transferencias_neto[pk];
    const neto = Number((ingTotal - egrTotal + transf).toFixed(2));
    values.flujo_neto[pk] = neto;
    details.flujo_neto[pk] = [...details.ingresos_total[pk], ...details.egresos_total[pk], ...details.transferencias_neto[pk]];

    runningBalance = Number((runningBalance + neto).toFixed(2));
    values.saldo_final[pk] = runningBalance;
  }

  for (const r of rowDefs) {
    if (r.id === 'saldo_inicial') continue;
    if (r.id === 'saldo_final') {
      totals[r.id] = runningBalance;
      continue;
    }
    totals[r.id] = Number(periods.reduce((s, p) => s + (Number(values[r.id][p.key]) || 0), 0).toFixed(2));
  }

  return {
    granularidad,
    hoy: hoyIso,
    cuentas: histData.cuentas,
    caja_actual: proyData.caja_actual,
    saldo_apertura: totals.saldo_inicial,
    saldo_final_proyectado: runningBalance,
    periods,
    rows: rowDefs.map(r => ({
      ...r,
      values: values[r.id],
      details: details[r.id],
      total: totals[r.id],
    })),
  };
}
