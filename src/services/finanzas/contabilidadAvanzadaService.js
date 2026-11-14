import { db } from '../../db.js';
import { BaseRepository } from '../../core/BaseRepository.js';
import { MODELS } from '../../db/models.js';
import { getLibroIva, getLibroAuxiliar } from '../afip/libroIvaService.js';
import { defaultAsientoService } from './asientoService.js';

const cotizRepo = new BaseRepository({ model: MODELS.cotizaciones_moneda });
const extractoRepo = new BaseRepository({ model: MODELS.extracto_movimientos });
const cierreRepo = new BaseRepository({ model: MODELS.cierres_ejercicio });

// ═══════════════════════════════════════════════════════════════════════════════
// 1. POSICIÓN MENSUAL DE IVA (F.2002)
// ═══════════════════════════════════════════════════════════════════════════════

export function getPosicionMensualIva({ desde = '', hasta = '', saldo_tecnico_anterior = 0, saldo_libre_anterior = 0 } = {}) {
  const vtas = getLibroIva({ tipo: 'ventas', desde, hasta, incluir_no_fiscales: false });
  const cmps = getLibroIva({ tipo: 'compras', desde, hasta, incluir_no_fiscales: false });
  const auxPerc = getLibroAuxiliar({ categoria: 'percepciones', desde, hasta });

  const vt = vtas.totales || {};
  const ct = cmps.totales || {};

  const debitoFiscal = Number(((vt.iva_21 || 0) + (vt.iva_10_5 || 0) + (vt.iva_27 || 0) + (vt.iva_otros || 0)).toFixed(2));
  const creditoFiscal = Number(((ct.iva_21 || 0) + (ct.iva_10_5 || 0) + (ct.iva_27 || 0) + (ct.iva_otros || 0)).toFixed(2));
  const percIvaSufridas = Number((auxPerc.rows || [])
    .filter(r => r.origen === 'compra' && String(r.impuesto_nombre || '').toLowerCase().includes('iva'))
    .reduce((s, r) => s + Number(r.monto_neto ?? r.monto ?? 0), 0)
    .toFixed(2));

  const saldoTecAnt = Math.max(0, Number(saldo_tecnico_anterior || 0));
  const saldoLibAnt = Math.max(0, Number(saldo_libre_anterior || 0));

  const netoTecnico = Number((debitoFiscal - creditoFiscal - saldoTecAnt).toFixed(2));
  const saldoTecnicoAPagar = netoTecnico > 0 ? netoTecnico : 0;
  const saldoTecnicoAFavor = netoTecnico < 0 ? Math.abs(netoTecnico) : 0;

  const pagosACuenta = Number((percIvaSufridas + saldoLibAnt).toFixed(2));
  const netoFinal = Number((saldoTecnicoAPagar - pagosACuenta).toFixed(2));
  const saldoAPagar = netoFinal > 0 ? netoFinal : 0;
  const saldoLibreAFavor = netoFinal < 0 ? Math.abs(netoFinal) : 0;

  return {
    desde,
    hasta,
    ventas_neto: Number(((vt.neto_21 || 0) + (vt.neto_10_5 || 0) + (vt.neto_27 || 0) + (vt.neto_otros || 0)).toFixed(2)),
    compras_neto: Number(((ct.neto_21 || 0) + (ct.neto_10_5 || 0) + (ct.neto_27 || 0) + (ct.neto_otros || 0)).toFixed(2)),
    debito_fiscal: debitoFiscal,
    credito_fiscal: creditoFiscal,
    saldo_tecnico_anterior: saldoTecAnt,
    saldo_tecnico_a_pagar: saldoTecnicoAPagar,
    saldo_tecnico_a_favor: saldoTecnicoAFavor,
    percepciones_iva_sufridas: percIvaSufridas,
    saldo_libre_anterior: saldoLibAnt,
    pagos_a_cuenta: pagosACuenta,
    saldo_a_pagar: saldoAPagar,
    saldo_libre_a_favor: saldoLibreAFavor,
  };
}

export function contabilizarPosicionIva({ fecha, desde, hasta, saldo_tecnico_anterior = 0, saldo_libre_anterior = 0 } = {}) {
  const pos = getPosicionMensualIva({ desde, hasta, saldo_tecnico_anterior, saldo_libre_anterior });
  const fch = fecha || hasta || new Date().toISOString().slice(0, 10);
  const lineas = [];

  const ctaDeb = defaultAsientoService.resolvePlanCuenta('2.1.02');
  const ctaCred = defaultAsientoService.resolvePlanCuenta('1.1.06');
  const ctaPagar = defaultAsientoService.resolvePlanCuenta('2.1.05');
  const ctaFavor = defaultAsientoService.resolvePlanCuenta('1.1.08');

  if (pos.debito_fiscal > 0) {
    lineas.push({
      plan_cuenta_id: ctaDeb?.id || null,
      cuenta_contable: ctaDeb ? `${ctaDeb.codigo} ${ctaDeb.nombre}` : '2.1.02 IVA Débito Fiscal',
      debe: pos.debito_fiscal,
      haber: 0,
    });
  }
  if (pos.credito_fiscal > 0) {
    lineas.push({
      plan_cuenta_id: ctaCred?.id || null,
      cuenta_contable: ctaCred ? `${ctaCred.codigo} ${ctaCred.nombre}` : '1.1.06 IVA Crédito Fiscal',
      debe: 0,
      haber: pos.credito_fiscal,
    });
  }

  const diff = Number((pos.debito_fiscal - pos.credito_fiscal).toFixed(2));
  if (diff > 0) {
    lineas.push({
      plan_cuenta_id: ctaPagar?.id || null,
      cuenta_contable: ctaPagar ? `${ctaPagar.codigo} ${ctaPagar.nombre}` : '2.1.05 IVA a Pagar',
      debe: 0,
      haber: diff,
    });
  } else if (diff < 0) {
    lineas.push({
      plan_cuenta_id: ctaFavor?.id || null,
      cuenta_contable: ctaFavor ? `${ctaFavor.codigo} ${ctaFavor.nombre}` : '1.1.08 IVA Saldo a Favor',
      debe: Math.abs(diff),
      haber: 0,
    });
  }

  if (lineas.length < 2) throw new Error('No hay movimientos de IVA suficientes para generar asiento de liquidación');

  const asientoId = defaultAsientoService.createAsiento({
    fecha: fch,
    tipo_origen: 'liquidacion_iva',
    origen_id: null,
    concepto: `Posición Mensual IVA (${desde || ''} a ${hasta || fch})`,
    lineas,
  });

  return { asiento_id: asientoId, posicion: pos };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. CONCILIACIÓN BANCARIA
// ═══════════════════════════════════════════════════════════════════════════════

export function listExtractoMovimientos({ cuenta_id, estado, desde, hasta } = {}) {
  const where = ['1=1'];
  const args = [];
  if (cuenta_id) { where.push('e.cuenta_id = ?'); args.push(Number(cuenta_id)); }
  if (estado) { where.push('e.estado = ?'); args.push(estado); }
  if (desde) { where.push('e.fecha >= ?'); args.push(desde); }
  if (hasta) { where.push('e.fecha <= ?'); args.push(hasta); }
  return db.prepare(`
    SELECT e.*, c.nombre AS cuenta_nombre
    FROM extracto_movimientos e
    JOIN cuentas c ON c.id = e.cuenta_id
    WHERE ${where.join(' AND ')}
    ORDER BY e.fecha DESC, e.id DESC
  `).all(...args);
}

export function importarExtractoCsv({ cuenta_id, contenido } = {}) {
  const ctaId = Number(cuenta_id);
  if (!ctaId) throw new Error('Seleccioná una cuenta bancaria');
  const lines = String(contenido || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let imported = 0;

  for (const line of lines) {
    const cols = line.split(/[;\t,]/).map(c => c.trim());
    if (cols.length < 3) continue;
    const rawFecha = cols[0];
    let fecha = '';
    const dmy = rawFecha.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (dmy) fecha = `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(rawFecha)) fecha = rawFecha;
    else continue;

    const descripcion = cols[1] || 'Movimiento bancario';
    let referencia = '';
    let monto = 0;
    if (cols.length >= 4 && !Number.isNaN(Number(cols[2].replace(',', '.'))) && !Number.isNaN(Number(cols[3].replace(',', '.')))) {
      // formato: fecha;descripcion;debito;credito
      const deb = Number(cols[2].replace(',', '.')) || 0;
      const cred = Number(cols[3].replace(',', '.')) || 0;
      monto = Number((cred - deb).toFixed(2));
    } else {
      referencia = cols.length >= 4 ? cols[2] : '';
      const rawMonto = cols[cols.length - 1].replace(/\./g, '').replace(',', '.');
      monto = Number(rawMonto);
      if (!Number.isFinite(monto)) {
        monto = Number(cols[cols.length - 1].replace(',', '.'));
      }
    }
    if (!Number.isFinite(monto) || monto === 0) continue;

    extractoRepo.create({
      cuenta_id: ctaId,
      fecha,
      descripcion,
      referencia,
      monto: Number(monto.toFixed(2)),
      estado: 'pendiente',
    });
    imported++;
  }
  return { imported };
}

export function listMovimientosSistemaCuenta(cuenta_id) {
  const ctaId = Number(cuenta_id);
  const cobros = db.prepare(`
    SELECT 'cobro' AS entidad_tipo, c.id AS entidad_id, c.fecha, c.numero, c.concepto, c.monto AS monto
    FROM cobros c
    WHERE c.cuenta_id = ? AND c.estado = 'Confirmado'
      AND NOT EXISTS (SELECT 1 FROM extracto_movimientos e WHERE e.entidad_tipo = 'cobro' AND e.entidad_id = c.id AND e.estado = 'conciliado')
  `).all(ctaId);

  const pagos = db.prepare(`
    SELECT 'pago' AS entidad_tipo, p.id AS entidad_id, p.fecha, p.numero, p.concepto, -p.monto AS monto
    FROM pagos p
    WHERE p.cuenta_id = ? AND p.estado = 'Confirmado'
      AND NOT EXISTS (SELECT 1 FROM extracto_movimientos e WHERE e.entidad_tipo = 'pago' AND e.entidad_id = p.id AND e.estado = 'conciliado')
  `).all(ctaId);

  const asientosCta = db.prepare(`
    SELECT 'asiento_linea' AS entidad_tipo, al.id AS entidad_id, a.fecha, a.numero, a.concepto, (al.debe - al.haber) AS monto
    FROM asiento_lineas al
    JOIN asientos a ON a.id = al.asiento_id
    WHERE al.cuenta_id = ? AND a.tipo_origen IN ('transferencia', 'ajuste_saldo', 'cheque_deposito', 'cheque_debito')
      AND NOT EXISTS (SELECT 1 FROM extracto_movimientos e WHERE e.entidad_tipo = 'asiento_linea' AND e.entidad_id = al.id AND e.estado = 'conciliado')
  `).all(ctaId);

  return [...cobros, ...pagos, ...asientosCta].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
}

function diffDays(f1, f2) {
  const d1 = new Date(f1);
  const d2 = new Date(f2);
  return Math.abs((d1 - d2) / 86400000);
}

export function autoConciliarExtracto(cuenta_id) {
  const ctaId = Number(cuenta_id);
  const pendientes = extractoRepo.findWhere({ cuenta_id: ctaId, estado: 'pendiente' });
  const sisMovs = listMovimientosSistemaCuenta(ctaId);
  const usedKeys = new Set();
  const hoy = new Date().toISOString().slice(0, 10);
  let matched = 0;

  for (const ext of pendientes) {
    const match = sisMovs.find(m => {
      const key = `${m.entidad_tipo}:${m.entidad_id}`;
      if (usedKeys.has(key)) return false;
      if (Math.abs(Number(m.monto) - Number(ext.monto)) > 0.01) return false;
      return diffDays(m.fecha, ext.fecha) <= 3;
    });
    if (match) {
      usedKeys.add(`${match.entidad_tipo}:${match.entidad_id}`);
      extractoRepo.update(ext.id, {
        estado: 'conciliado',
        entidad_tipo: match.entidad_tipo,
        entidad_id: match.entidad_id,
        fecha_conciliacion: hoy,
      });
      matched++;
    }
  }
  return { matched };
}

export function conciliarExtractoItem(extractoId, { entidad_tipo, entidad_id }) {
  const hoy = new Date().toISOString().slice(0, 10);
  return extractoRepo.update(Number(extractoId), {
    estado: 'conciliado',
    entidad_tipo: entidad_tipo || 'manual',
    entidad_id: entidad_id ? Number(entidad_id) : null,
    fecha_conciliacion: hoy,
  });
}

export function ignorarExtractoItem(extractoId) {
  return extractoRepo.update(Number(extractoId), { estado: 'ignorado' });
}

export function desconciliarExtractoItem(extractoId) {
  return extractoRepo.update(Number(extractoId), {
    estado: 'pendiente',
    entidad_tipo: '',
    entidad_id: null,
    fecha_conciliacion: '',
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. MULTIMONEDA Y COTIZACIONES
// ═══════════════════════════════════════════════════════════════════════════════

export function listCotizaciones({ moneda } = {}) {
  if (moneda) {
    return db.prepare('SELECT * FROM cotizaciones_moneda WHERE moneda = ? ORDER BY fecha DESC, id DESC LIMIT 100').all(moneda.toUpperCase());
  }
  return db.prepare('SELECT * FROM cotizaciones_moneda ORDER BY fecha DESC, id DESC LIMIT 100').all();
}

export function upsertCotizacion({ moneda = 'USD', fecha, cotizacion, fuente = 'manual' }) {
  const mon = String(moneda || 'USD').toUpperCase().trim();
  const fch = fecha || new Date().toISOString().slice(0, 10);
  const val = Number(cotizacion);
  if (!Number.isFinite(val) || val <= 0) throw new Error('La cotización debe ser mayor a 0');
  const existing = db.prepare('SELECT id FROM cotizaciones_moneda WHERE moneda = ? AND fecha = ?').get(mon, fch);
  if (existing) {
    cotizRepo.update(existing.id, { cotizacion: val, fuente });
    return existing.id;
  }
  return cotizRepo.create({ moneda: mon, fecha: fch, cotizacion: val, fuente });
}

export function getCotizacionVigente(moneda = 'ARS', fecha = '') {
  const mon = String(moneda || 'ARS').toUpperCase().trim();
  if (mon === 'ARS' || mon === 'PES') return 1;
  const fch = fecha || new Date().toISOString().slice(0, 10);
  const row = db.prepare('SELECT cotizacion FROM cotizaciones_moneda WHERE moneda = ? AND fecha <= ? ORDER BY fecha DESC, id DESC LIMIT 1').get(mon, fch);
  return row ? Number(row.cotizacion) : 1;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. CIERRE DE EJERCICIO Y REFUNDICIÓN DE RESULTADOS
// ═══════════════════════════════════════════════════════════════════════════════

export function assertFechaAbierta(fecha) {
  if (!fecha) return;
  const closed = db.prepare(
    "SELECT id, descripcion, fecha_desde, fecha_hasta FROM cierres_ejercicio WHERE estado = 'cerrado' AND ? >= fecha_desde AND ? <= fecha_hasta LIMIT 1"
  ).get(fecha, fecha);
  if (closed) {
    throw new Error(`El período ${closed.fecha_desde} a ${closed.fecha_hasta} está cerrado (${closed.descripcion || 'Cierre de ejercicio'}). Reabrilo para registrar movimientos.`);
  }
}

export function listCierresEjercicio() {
  return db.prepare(`
    SELECT ce.*, a.numero AS asiento_numero
    FROM cierres_ejercicio ce
    LEFT JOIN asientos a ON a.id = ce.asiento_id
    ORDER BY ce.fecha_hasta DESC, ce.id DESC
  `).all();
}

export function previewCierreEjercicio({ fecha_desde, fecha_hasta }) {
  if (!fecha_desde || !fecha_hasta) throw new Error('Indicá fecha_desde y fecha_hasta');
  const cuentasRes = db.prepare(`
    SELECT pc.id, pc.codigo, pc.nombre, pc.tipo,
           COALESCE(SUM(al.debe), 0) AS total_debe,
           COALESCE(SUM(al.haber), 0) AS total_haber
    FROM asiento_lineas al
    JOIN asientos a ON a.id = al.asiento_id
    JOIN plan_cuentas pc ON pc.id = al.plan_cuenta_id
    WHERE LOWER(a.estado) = 'confirmado'
      AND a.tipo_origen != 'cierre_ejercicio'
      AND a.fecha >= ? AND a.fecha <= ?
      AND pc.tipo IN ('ingreso', 'egreso')
    GROUP BY pc.id, pc.codigo, pc.nombre, pc.tipo
    ORDER BY pc.codigo ASC
  `).all(fecha_desde, fecha_hasta);

  let totalIngresos = 0;
  let totalEgresos = 0;
  const detalle = [];
  for (const c of cuentasRes) {
    const saldoAcreedor = Number((c.total_haber - c.total_debe).toFixed(2));
    if (Math.abs(saldoAcreedor) < 0.01) continue;
    if (c.tipo === 'ingreso') totalIngresos += saldoAcreedor;
    else totalEgresos += -saldoAcreedor;
    detalle.push({ ...c, saldo: saldoAcreedor });
  }
  const resultadoNeto = Number((totalIngresos - totalEgresos).toFixed(2));
  return {
    fecha_desde,
    fecha_hasta,
    total_ingresos: Number(totalIngresos.toFixed(2)),
    total_egresos: Number(totalEgresos.toFixed(2)),
    resultado_neto: resultadoNeto,
    detalle,
  };
}

export function ejecutarCierreEjercicio({ fecha_desde, fecha_hasta, descripcion = '' }) {
  const prev = previewCierreEjercicio({ fecha_desde, fecha_hasta });
  const ctaResultado = defaultAsientoService.resolvePlanCuenta('3.2.01');
  const lineas = [];

  for (const d of prev.detalle) {
    if (d.saldo > 0) {
      // Saldo acreedor (ingreso) -> se debita para dejar en 0
      lineas.push({
        plan_cuenta_id: d.id,
        cuenta_contable: `${d.codigo} ${d.nombre}`,
        debe: d.saldo,
        haber: 0,
      });
    } else if (d.saldo < 0) {
      // Saldo deudor (egreso) -> se acredita para dejar en 0
      lineas.push({
        plan_cuenta_id: d.id,
        cuenta_contable: `${d.codigo} ${d.nombre}`,
        debe: 0,
        haber: Math.abs(d.saldo),
      });
    }
  }

  if (prev.resultado_neto > 0) {
    lineas.push({
      plan_cuenta_id: ctaResultado?.id || null,
      cuenta_contable: ctaResultado ? `${ctaResultado.codigo} ${ctaResultado.nombre}` : '3.2.01 Resultado del Ejercicio',
      debe: 0,
      haber: prev.resultado_neto,
    });
  } else if (prev.resultado_neto < 0) {
    lineas.push({
      plan_cuenta_id: ctaResultado?.id || null,
      cuenta_contable: ctaResultado ? `${ctaResultado.codigo} ${ctaResultado.nombre}` : '3.2.01 Resultado del Ejercicio',
      debe: Math.abs(prev.resultado_neto),
      haber: 0,
    });
  }

  let asientoId = null;
  if (lineas.length >= 2) {
    asientoId = defaultAsientoService.createAsiento({
      fecha: fecha_hasta,
      tipo_origen: 'cierre_ejercicio',
      origen_id: null,
      concepto: descripcion || `Refundición Cuentas de Resultado (${fecha_desde} a ${fecha_hasta})`,
      lineas,
    });
  }

  const cierreId = cierreRepo.create({
    fecha_desde,
    fecha_hasta,
    descripcion: descripcion || `Ejercicio ${fecha_desde.slice(0, 4)}`,
    asiento_id: asientoId,
    resultado_neto: prev.resultado_neto,
    estado: 'cerrado',
  });

  return { id: cierreId, asiento_id: asientoId, ...prev };
}

export function reabrirCierreEjercicio(id) {
  const cierre = cierreRepo.findById(Number(id));
  if (!cierre) throw new Error('Cierre no encontrado');
  if (cierre.asiento_id) {
    new BaseRepository({ model: MODELS.asientos }).delete(cierre.asiento_id);
  }
  cierreRepo.update(cierre.id, { estado: 'reabierto', asiento_id: null });
  return true;
}
