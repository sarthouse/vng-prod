import { BaseRepository } from '../../core/BaseRepository.js';
import { MODELS } from '../../db/models.js';
import { listProductos } from '../inventario/productoService.js';
import { listOrdenes } from '../produccion/produccionService.js';
import {
  asientoLineaRepo,
  cobroRepo,
  pagoRepo,
  listCuentas,
} from './cuentasService.js';
import { listPagos } from './pagosService.js';
import { listCobros } from './cobrosService.js';

export {
  registrarAsiento,
  listAsientos,
  recalcCuentaSaldo,
  listCuentas,
  createCuenta,
  ajustarSaldoCuenta,
  updateCuenta,
  deleteCuenta,
  createTransferencia,
} from './cuentasService.js';

export {
  listPagos,
  getPagoById,
  createPago,
  confirmarPago,
  deletePago,
  anularPago,
  archivarPago,
} from './pagosService.js';

export {
  listCobros,
  getCobroById,
  createCobro,
  confirmarCobro,
  deleteCobro,
  anularCobro,
  archivarCobro,
} from './cobrosService.js';

const compraRepo = new BaseRepository({ model: MODELS.compras });
const ventaRepo = new BaseRepository({ model: MODELS.ventas });
const ordenRepo = new BaseRepository({ model: MODELS.ordenes_produccion });
const productoRepo = new BaseRepository({ table: 'productos' });
const chequeRepo = new BaseRepository({ table: 'cheques' });
const proyeccionRepo = new BaseRepository({ model: MODELS.flujo_proyecciones });

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

  const transfQb = asientoLineaRepo.query('al')
    .select("al.id, a.fecha, a.numero, al.cuenta_id, COALESCE(c.nombre, '') as cuenta_nombre, a.concepto, al.debe, al.haber")
    .innerJoin('asientos', 'a', 'a.id', 'al.asiento_id')
    .leftJoin('cuentas', 'c', 'c.id', 'al.cuenta_id')
    .where('a.tipo_origen', 'transferencia')
    .whereNotNull('al.cuenta_id');
  if (cuenta_id) transfQb.where('al.cuenta_id', Number(cuenta_id));
  const transferencias = transfQb.all().map(t => ({
    ...t,
    monto: Number(t.debe || 0) - Number(t.haber || 0),
  }));

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

  const comprasTotal = compraRepo.query().where('estado', 'Confirmado').sum('total');
  const pagosProveedores = pagoRepo.query().where('estado', 'Confirmado').whereNotNull('contacto_id').sum('monto');
  const pagosOtros = pagoRepo.query().where('estado', 'Confirmado').whereNull('contacto_id').sum('monto');

  const ventasTotal = ventaRepo.query().whereIn('estado', ['Confirmada', 'Entregada']).sum('total');
  const cobrosClientes = cobroRepo.query().where('estado', 'Confirmado').whereNotNull('contacto_id').sum('monto');

  const ordenesActivas = ordenRepo.query().whereIn('estado', ['Planificada', 'En Proceso']).count();
  const ordenesCompletadas = ordenRepo.query().where('estado', 'Completada').count();
  const valorStock = productoRepo.query()
    .select('stock, precio')
    .where('activo', 1)
    .where('stock', '>', 0)
    .all()
    .reduce((s, p) => s + Number(p.stock || 0) * Number(p.precio || 0), 0);

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

export function listProyecciones() {
  return proyeccionRepo.query('fp')
    .select("fp.*, COALESCE(pc.codigo || ' ' || pc.nombre, '') as plan_cuenta_nombre, COALESCE(c.nombre, '') as cuenta_nombre")
    .leftJoin('plan_cuentas', 'pc', 'pc.id', 'fp.plan_cuenta_id')
    .leftJoin('cuentas', 'c', 'c.id', 'fp.cuenta_id')
    .orderBy('fp.activo', 'DESC')
    .orderBy('fp.fecha_inicio', 'ASC')
    .orderBy('fp.id', 'ASC')
    .all();
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
    const ventasPend = ventaRepo.query('v')
      .select("v.id, v.numero, v.fecha, v.fecha_vencimiento, v.fecha_entrega_est, v.total, COALESCE(co.nombre, '') as contacto_nombre")
      .leftJoin('contactos', 'co', 'co.id', 'v.contacto_id')
      .whereIn('v.estado', ['Confirmada', 'Entregada'])
      .where('v.clase_documento', '!=', 'nota_credito')
      .all();
    const cobrosPorVenta = new Map();
    for (const cb of cobroRepo.query().select('venta_id, monto').where('estado', 'Confirmado').whereNotNull('venta_id').all()) {
      cobrosPorVenta.set(cb.venta_id, (cobrosPorVenta.get(cb.venta_id) || 0) + Number(cb.monto || 0));
    }

    for (const v of ventasPend) {
      const cobrado = cobrosPorVenta.get(v.id) || 0;
      const pendiente = Number((Number(v.total || 0) - cobrado).toFixed(2));
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

    const comprasPend = compraRepo.query('c')
      .select("c.id, c.numero, c.fecha, c.fecha_vencimiento, c.total, COALESCE(co.nombre, '') as contacto_nombre")
      .leftJoin('contactos', 'co', 'co.id', 'c.contacto_id')
      .where('c.estado', 'Confirmado')
      .where('c.clase_documento', '!=', 'nota_credito')
      .all();
    const pagosPorCompra = new Map();
    for (const p of pagoRepo.query().select('compra_id, total_bruto, monto').where('estado', 'Confirmado').whereNotNull('compra_id').all()) {
      const val = Number(p.total_bruto) > 0 ? Number(p.total_bruto) : Number(p.monto || 0);
      pagosPorCompra.set(p.compra_id, (pagosPorCompra.get(p.compra_id) || 0) + val);
    }

    for (const c of comprasPend) {
      const pagado = pagosPorCompra.get(c.id) || 0;
      const pendiente = Number((Number(c.total || 0) - pagado).toFixed(2));
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

  const chequesActivos = chequeRepo.query('ch')
    .select("ch.*, COALESCE(co.nombre, '') as contacto_nombre")
    .leftJoin('contactos', 'co', 'co.id', 'ch.contacto_origen_id')
    .all()
    .filter(ch => (ch.origen === 'terceros' && ['En Cartera', 'Depositado'].includes(ch.estado))
      || (ch.origen === 'propio' && ch.estado === 'Emitido'));
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
    if (f < hoyIso) {
      const cur = periods.find(p => p.isCurrent);
      if (cur && f >= firstStart) return periods[0].key;
      if (cur) return cur.key;
    }
    return null;
  };

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

  const curPeriod = periods.find(p => p.isCurrent) || periods[0];
  for (const ev of (proyData.eventos || [])) {
    const f = String(ev.fecha || hoyIso).slice(0, 10);
    let pk = periods.find(p => f >= p.start && f <= p.end)?.key || null;
    if (!pk && f < hoyIso) pk = curPeriod.key;
    if (!pk) continue;
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
