import { BaseRepository } from '../../core/BaseRepository.js';
import { createStateMachine } from '../../core/stateMachine.js';
import { MODELS } from '../../db/models.js';
import { defaultAsientoService } from './asientoService.js';

export const activoRepo = new BaseRepository({ model: MODELS.activos_fijos });
export const amortRepo = new BaseRepository({ model: MODELS.activo_amortizaciones });
const planCuentaRepo = new BaseRepository({ model: MODELS.plan_cuentas });

export const ACTIVO_SM = createStateMachine({
  Activo: ['Amortizado', 'Dado de Baja'],
  Amortizado: ['Dado de Baja'],
  'Dado de Baja': [],
}, { label: 'Activo Fijo' });

function ensureCuenta(codigo, def) {
  return planCuentaRepo.findOrCreate(
    { codigo },
    {
      nombre: def.nombre,
      tipo: def.tipo,
      naturaleza: def.naturaleza,
      imputable: 1,
      activo: 1,
    }
  );
}

function getDefaultCuentasActivo() {
  const ctaActivo = defaultAsientoService.resolveDefaultCuenta('cta_bienes_uso_id', '1.2.01')
    || ensureCuenta('1.2.01', { nombre: 'Bienes de Uso (Maquinaria y Equipos)', tipo: 'activo', naturaleza: 'deudora' });
  const ctaAmortAcum = defaultAsientoService.resolveDefaultCuenta('cta_amort_acum_id', '1.2.02')
    || ensureCuenta('1.2.02', { nombre: 'Amortizaciones Acumuladas Bienes de Uso', tipo: 'activo', naturaleza: 'acreedora' });
  const ctaGasto = defaultAsientoService.resolveDefaultCuenta('cta_amort_gasto_id', '5.2.09')
    || ensureCuenta('5.2.09', { nombre: 'Amortizaciones del Ejercicio', tipo: 'egreso', naturaleza: 'deudora' });
  return { ctaActivo, ctaAmortAcum, ctaGasto };
}

function enrichActivo(a) {
  if (!a) return null;
  const vo = Number(a.valor_origen || 0);
  const vr = Number(a.valor_residual || 0);
  const acum = Number(a.amortizacion_acumulada || 0);
  const vida = Math.max(1, Number(a.vida_util_meses || 1));
  const amortizable = Math.max(0, vo - vr);
  const cuota = Number((amortizable / vida).toFixed(2));
  const valorNeto = Number(Math.max(0, vo - acum).toFixed(2));
  return {
    ...a,
    cuota_mensual: cuota,
    valor_amortizable: Number(amortizable.toFixed(2)),
    valor_neto_contable: valorNeto,
  };
}

export function listActivosFijos({ estado } = {}) {
  const q = activoRepo.query().orderBy('id', 'DESC');
  if (estado) q.where('estado', estado);
  return q.all().map(enrichActivo);
}

export function listAmortizacionesPeriodo(periodo = null) {
  const q = amortRepo.query('am')
    .select('am.*', 'af.codigo as activo_codigo', 'af.nombre as activo_nombre')
    .leftJoin('activos_fijos', 'af', 'af.id', 'am.activo_id')
    .orderBy('am.periodo', 'DESC')
    .orderBy('am.id', 'DESC');
  if (periodo) q.where('am.periodo', String(periodo));
  return q.all();
}

export function getActivoFijoById(id) {
  const activo = activoRepo.findById(id);
  if (!activo) return null;
  const amortizaciones = amortRepo.query()
    .where('activo_id', Number(id))
    .orderBy('periodo', 'DESC')
    .all();
  return { activo: enrichActivo(activo), amortizaciones };
}

export function createActivoFijo(b, user = null) {
  const { ctaActivo, ctaAmortAcum, ctaGasto } = getDefaultCuentasActivo();
  const valorOrigen = Number(b.valor_origen || 0);
  const valorResidual = Number(b.valor_residual || 0);
  if (valorResidual > valorOrigen) {
    throw new Error('El valor residual no puede superar al valor de origen.');
  }
  const vidaMeses = Math.max(1, Math.round(Number(b.vida_util_meses || 60)));
  const count = activoRepo.query().count();
  const codigo = String(b.codigo || '').trim() || `AF-${String(count + 1).padStart(4, '0')}`;

  const payload = {
    codigo,
    nombre: String(b.nombre || '').trim(),
    categoria: String(b.categoria || 'Maquinaria y Equipos').trim(),
    fecha_alta: b.fecha_alta || new Date().toISOString().slice(0, 10),
    valor_origen: valorOrigen,
    valor_residual: valorResidual,
    vida_util_meses: vidaMeses,
    amortizacion_acumulada: Number(b.amortizacion_acumulada || 0),
    cuenta_activo_id: b.cuenta_activo_id ? Number(b.cuenta_activo_id) : ctaActivo.id,
    cuenta_amort_acum_id: b.cuenta_amort_acum_id ? Number(b.cuenta_amort_acum_id) : ctaAmortAcum.id,
    cuenta_gasto_id: b.cuenta_gasto_id ? Number(b.cuenta_gasto_id) : ctaGasto.id,
    compra_id: b.compra_id ? Number(b.compra_id) : null,
    estado: 'Activo',
    observaciones: String(b.observaciones || '').trim(),
  };

  activoRepo.validate(payload);
  return activoRepo.create(payload, user);
}

export function updateActivoFijo(id, b, user = null) {
  const existing = activoRepo.findById(id);
  if (!existing) return false;
  if (existing.estado === 'Dado de Baja') {
    throw new Error('No se puede modificar un activo fijo dado de baja.');
  }

  const nextVo = b.valor_origen !== undefined ? Number(b.valor_origen) : Number(existing.valor_origen);
  const nextVr = b.valor_residual !== undefined ? Number(b.valor_residual) : Number(existing.valor_residual);
  if (nextVr > nextVo) {
    throw new Error('El valor residual no puede superar al valor de origen.');
  }

  const patch = {};
  if (b.codigo !== undefined) patch.codigo = String(b.codigo).trim();
  if (b.nombre !== undefined) patch.nombre = String(b.nombre).trim();
  if (b.categoria !== undefined) patch.categoria = String(b.categoria).trim();
  if (b.fecha_alta !== undefined) patch.fecha_alta = b.fecha_alta;
  if (b.valor_origen !== undefined) patch.valor_origen = nextVo;
  if (b.valor_residual !== undefined) patch.valor_residual = nextVr;
  if (b.vida_util_meses !== undefined) patch.vida_util_meses = Math.max(1, Math.round(Number(b.vida_util_meses)));
  if (b.cuenta_activo_id !== undefined) patch.cuenta_activo_id = b.cuenta_activo_id ? Number(b.cuenta_activo_id) : null;
  if (b.cuenta_amort_acum_id !== undefined) patch.cuenta_amort_acum_id = b.cuenta_amort_acum_id ? Number(b.cuenta_amort_acum_id) : null;
  if (b.cuenta_gasto_id !== undefined) patch.cuenta_gasto_id = b.cuenta_gasto_id ? Number(b.cuenta_gasto_id) : null;
  if (b.observaciones !== undefined) patch.observaciones = String(b.observaciones).trim();

  activoRepo.validate(patch, { partial: true });
  return activoRepo.update(id, patch, user);
}

export function deleteActivoFijo(id) {
  const existing = activoRepo.find(id);
  if (!existing) return false;
  if (amortRepo.exists({ activo_id: Number(id) }) || Number(existing.amortizacion_acumulada || 0) > 0) {
    throw new Error('No se puede eliminar un activo fijo que ya tiene amortizaciones; utilizá Dar de Baja.');
  }
  return activoRepo.delete(id);
}

export function amortizarPeriodo(periodo, { fecha = null } = {}, user = null) {
  const per = String(periodo || '').trim();
  if (!/^\d{4}-\d{2}$/.test(per)) {
    throw new Error('El período debe tener formato YYYY-MM.');
  }
  const fechaAsiento = fecha || new Date().toISOString().slice(0, 10);
  const { ctaAmortAcum, ctaGasto } = getDefaultCuentasActivo();

  return activoRepo.transaction(() => {
    const activos = activoRepo.where('estado', 'Activo').all();
    const yaAmortizados = new Set(
      amortRepo.where('periodo', per).pluck('activo_id').map(Number)
    );

    const pendientes = [];
    for (const a of activos) {
      if (yaAmortizados.has(Number(a.id))) continue;
      const valorAmortizable = Math.max(0, Number(a.valor_origen || 0) - Number(a.valor_residual || 0));
      const acumActual = Number(a.amortizacion_acumulada || 0);
      const remanente = Number(Math.max(0, valorAmortizable - acumActual).toFixed(2));
      if (remanente <= 0.009) {
        activoRepo.update(a.id, { estado: 'Amortizado' }, user);
        continue;
      }
      const cuota = Number((valorAmortizable / Math.max(1, Number(a.vida_util_meses || 1))).toFixed(2));
      const monto = Number(Math.min(cuota, remanente).toFixed(2));
      if (monto > 0) {
        pendientes.push({ activo: a, monto, valorAmortizable, nuevaAcum: Number((acumActual + monto).toFixed(2)) });
      }
    }

    if (pendientes.length === 0) {
      return { periodo: per, amortizados: 0, total_monto: 0, asiento_id: null };
    }

    const debePorCta = new Map();
    const haberPorCta = new Map();
    let totalMonto = 0;

    for (const item of pendientes) {
      const gId = Number(item.activo.cuenta_gasto_id || ctaGasto.id);
      const aId = Number(item.activo.cuenta_amort_acum_id || ctaAmortAcum.id);
      debePorCta.set(gId, Number(((debePorCta.get(gId) || 0) + item.monto).toFixed(2)));
      haberPorCta.set(aId, Number(((haberPorCta.get(aId) || 0) + item.monto).toFixed(2)));
      totalMonto = Number((totalMonto + item.monto).toFixed(2));
    }

    const lineasAsiento = [];
    for (const [ctaId, m] of debePorCta.entries()) {
      lineasAsiento.push({
        plan_cuenta_id: ctaId,
        debe: m,
        haber: 0,
        descripcion: `Amortización del ejercicio (${per})`,
      });
    }
    for (const [ctaId, m] of haberPorCta.entries()) {
      lineasAsiento.push({
        plan_cuenta_id: ctaId,
        debe: 0,
        haber: m,
        descripcion: `Amortizaciones acumuladas (${per})`,
      });
    }

    const diario = defaultAsientoService.resolveDiario('general');
    const asientoId = defaultAsientoService.createAsiento({
      diario_id: diario?.id || null,
      fecha: fechaAsiento,
      tipo_origen: 'amortizacion',
      origen_id: null,
      concepto: `Amortización Bienes de Uso — Período ${per}`,
      estado: 'Confirmado',
      lineas: lineasAsiento,
    });

    for (const item of pendientes) {
      amortRepo.create({
        activo_id: item.activo.id,
        periodo: per,
        monto: item.monto,
        asiento_id: asientoId,
        fecha: fechaAsiento,
      });
      const nuevoEstado = item.nuevaAcum >= item.valorAmortizable - 0.01 ? 'Amortizado' : 'Activo';
      activoRepo.update(item.activo.id, {
        amortizacion_acumulada: item.nuevaAcum,
        estado: nuevoEstado,
      }, user);
    }

    return {
      periodo: per,
      amortizados: pendientes.length,
      total_monto: totalMonto,
      asiento_id: asientoId,
    };
  });
}

export function darDeBajaActivo(id, { fecha = null, motivo = '' } = {}, user = null) {
  const existing = activoRepo.findById(id);
  if (!existing) throw new Error('Activo fijo no encontrado');
  ACTIVO_SM.assertTransition(existing.estado, 'Dado de Baja');

  const fechaBaja = fecha || new Date().toISOString().slice(0, 10);
  const { ctaActivo, ctaAmortAcum } = getDefaultCuentasActivo();
  const ctaResultadoBaja = defaultAsientoService.resolveDefaultCuenta('cta_gastos_id', '5.2.07')
    || ensureCuenta('5.2.07', { nombre: 'Otros Gastos Operativos', tipo: 'egreso', naturaleza: 'deudora' });

  return activoRepo.transaction(() => {
    const valorOrigen = Number(Number(existing.valor_origen || 0).toFixed(2));
    const amortAcum = Number(Number(existing.amortizacion_acumulada || 0).toFixed(2));
    const valorResidualContable = Number(Math.max(0, valorOrigen - amortAcum).toFixed(2));

    let asientoId = null;
    if (valorOrigen > 0) {
      const lineas = [];
      if (amortAcum > 0) {
        lineas.push({
          plan_cuenta_id: Number(existing.cuenta_amort_acum_id || ctaAmortAcum.id),
          debe: amortAcum,
          haber: 0,
          descripcion: `Cancelación amort. acumulada ${existing.codigo}`,
        });
      }
      if (valorResidualContable > 0) {
        lineas.push({
          plan_cuenta_id: ctaResultadoBaja.id,
          debe: valorResidualContable,
          haber: 0,
          descripcion: `Valor residual contable por baja ${existing.codigo}`,
        });
      }
      lineas.push({
        plan_cuenta_id: Number(existing.cuenta_activo_id || ctaActivo.id),
        debe: 0,
        haber: valorOrigen,
        descripcion: `Baja Bien de Uso ${existing.codigo} — ${existing.nombre}`,
      });

      const diario = defaultAsientoService.resolveDiario('general');
      asientoId = defaultAsientoService.createAsiento({
        diario_id: diario?.id || null,
        fecha: fechaBaja,
        tipo_origen: 'baja_activo',
        origen_id: Number(id),
        concepto: `Baja Activo Fijo ${existing.codigo} — ${existing.nombre}${motivo ? ` (${motivo})` : ''}`,
        estado: 'Confirmado',
        lineas,
      });
    }

    const obs = motivo
      ? `${existing.observaciones ? `${existing.observaciones}\n` : ''}Baja (${fechaBaja}): ${motivo}`
      : existing.observaciones;

    activoRepo.update(id, {
      estado: 'Dado de Baja',
      observaciones: obs,
    }, user);

    return {
      ok: true,
      id: Number(id),
      valor_residual_contable: valorResidualContable,
      asiento_id: asientoId,
    };
  });
}
