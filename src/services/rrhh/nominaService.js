import { BaseRepository } from '../../core/BaseRepository.js';
import { createStateMachine } from '../../core/stateMachine.js';
import { domainBus } from '../../core/eventBus.js';
import { MODELS } from '../../db/models.js';
import { defaultAsientoService } from '../finanzas/asientoService.js';
import { getNextNumeroDocumento } from '../config/configService.js';
import { registerDomainSubscribers } from '../domainEvents.js';

export const empleadoRepo = new BaseRepository({ model: MODELS.empleados });
export const licenciaRepo = new BaseRepository({ model: MODELS.empleado_licencias });
export const conceptoRepo = new BaseRepository({ model: MODELS.nomina_conceptos });
export const liquidacionRepo = new BaseRepository({ model: MODELS.liquidaciones_sueldos });
export const reciboRepo = new BaseRepository({ model: MODELS.liquidacion_recibos });
export const reciboLineaRepo = new BaseRepository({ model: MODELS.liquidacion_recibo_lineas });
const empresaRepo = new BaseRepository({ model: MODELS.empresa_config });
const planCuentaRepo = new BaseRepository({ model: MODELS.plan_cuentas });

export const NOMINA_SM = createStateMachine({
  Borrador: ['Confirmada'],
  Confirmada: ['Anulada'],
  Anulada: [],
}, { label: 'Liquidación de Sueldos' });

function ensureCuenta(codigo, def) {
  const found = planCuentaRepo.query().where('codigo', codigo).get();
  if (found) return found;
  const id = planCuentaRepo.create({
    codigo,
    nombre: def.nombre,
    tipo: def.tipo,
    naturaleza: def.naturaleza,
    imputable: 1,
    activo: 1,
  });
  return planCuentaRepo.findById(id);
}

function formatCuil(raw) {
  const digits = String(raw || '').replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.length === 11) {
    return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
  }
  return String(raw || '').trim();
}

function validateCbu(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const digits = s.replace(/\D+/g, '');
  if (digits.length !== 22) {
    throw new Error('El CBU debe tener exactamente 22 dígitos.');
  }
  return digits;
}

// ── Parámetros Previsionales ──────────────────────────────────────────────────

export function getParametrosPrevisionales() {
  const emp = empresaRepo.query().where('id', 1).get() || {};
  return {
    nomina_base_min: Number(emp.nomina_base_min ?? 100000),
    nomina_base_max: Number(emp.nomina_base_max ?? 3200000),
    nomina_art_fija: Number(emp.nomina_art_fija ?? 1500),
    nomina_art_pct: Number(emp.nomina_art_pct ?? 2.5),
    nomina_scvo_monto: Number(emp.nomina_scvo_monto ?? 1200),
    nomina_ultimo_dep_periodo: emp.nomina_ultimo_dep_periodo || '',
    nomina_ultimo_dep_fecha: emp.nomina_ultimo_dep_fecha || '',
    nomina_ultimo_dep_banco: emp.nomina_ultimo_dep_banco || '',
  };
}

export function updateParametrosPrevisionales(b = {}) {
  const patch = {};
  if (b.nomina_base_min !== undefined) patch.nomina_base_min = Math.max(0, Number(b.nomina_base_min || 0));
  if (b.nomina_base_max !== undefined) patch.nomina_base_max = Math.max(0, Number(b.nomina_base_max || 0));
  if (b.nomina_art_fija !== undefined) patch.nomina_art_fija = Math.max(0, Number(b.nomina_art_fija || 0));
  if (b.nomina_art_pct !== undefined) patch.nomina_art_pct = Math.max(0, Number(b.nomina_art_pct || 0));
  if (b.nomina_scvo_monto !== undefined) patch.nomina_scvo_monto = Math.max(0, Number(b.nomina_scvo_monto || 0));
  if (b.nomina_ultimo_dep_periodo !== undefined) patch.nomina_ultimo_dep_periodo = String(b.nomina_ultimo_dep_periodo || '').trim();
  if (b.nomina_ultimo_dep_fecha !== undefined) patch.nomina_ultimo_dep_fecha = String(b.nomina_ultimo_dep_fecha || '').trim();
  if (b.nomina_ultimo_dep_banco !== undefined) patch.nomina_ultimo_dep_banco = String(b.nomina_ultimo_dep_banco || '').trim();

  if (Object.keys(patch).length > 0) {
    empresaRepo.query().where('id', 1).update(patch);
  }
  return getParametrosPrevisionales();
}

// ── Conceptos ARCA LSD ────────────────────────────────────────────────────────

export function listConceptos({ soloActivos = false } = {}) {
  const q = conceptoRepo.query().orderBy('codigo_interno', 'ASC');
  if (soloActivos) q.where('activo', 1);
  return q.all();
}

export function createConcepto(b, user = null) {
  const payload = {
    codigo_interno: String(b.codigo_interno || '').trim().toUpperCase(),
    descripcion: String(b.descripcion || '').trim(),
    tipo: b.tipo || 'remunerativo',
    codigo_afip_lsd: String(b.codigo_afip_lsd || '110000').trim(),
    formula_tipo: b.formula_tipo || 'manual',
    valor_default: Number(b.valor_default || 0),
    aporta_sipa: b.aporta_sipa ? 1 : 0,
    aporta_inssjp: b.aporta_inssjp ? 1 : 0,
    aporta_os: b.aporta_os ? 1 : 0,
    aporta_fsr: b.aporta_fsr ? 1 : 0,
    aporta_lrt: b.aporta_lrt ? 1 : 0,
    base_sac: b.base_sac ? 1 : 0,
    cuenta_contable_id: b.cuenta_contable_id ? Number(b.cuenta_contable_id) : null,
    activo: b.activo === undefined ? 1 : (Number(b.activo) ? 1 : 0),
  };
  conceptoRepo.validate(payload);
  return conceptoRepo.create(payload, user);
}

export function updateConcepto(id, b, user = null) {
  const ex = conceptoRepo.findById(id);
  if (!ex) return false;
  const patch = {};
  for (const k of ['codigo_interno', 'descripcion', 'tipo', 'codigo_afip_lsd', 'formula_tipo']) {
    if (b[k] !== undefined) patch[k] = String(b[k] || '').trim();
  }
  if (patch.codigo_interno) patch.codigo_interno = patch.codigo_interno.toUpperCase();
  if (b.valor_default !== undefined) patch.valor_default = Number(b.valor_default || 0);
  for (const boolKey of ['aporta_sipa', 'aporta_inssjp', 'aporta_os', 'aporta_fsr', 'aporta_lrt', 'base_sac', 'activo']) {
    if (b[boolKey] !== undefined) patch[boolKey] = Number(b[boolKey]) ? 1 : 0;
  }
  if (b.cuenta_contable_id !== undefined) patch.cuenta_contable_id = b.cuenta_contable_id ? Number(b.cuenta_contable_id) : null;
  conceptoRepo.validate(patch, { partial: true });
  return conceptoRepo.update(id, patch, user);
}

export function deleteConcepto(id) {
  const usado = reciboLineaRepo.query().where('concepto_id', Number(id)).count() > 0;
  if (usado) {
    throw new Error('El concepto ya fue utilizado en recibos; desactivalo en lugar de eliminarlo.');
  }
  return conceptoRepo.delete(id);
}

// ── Empleados ─────────────────────────────────────────────────────────────────

export function listEmpleados({ soloActivos = false } = {}) {
  const q = empleadoRepo.query('e')
    .select('e.*', "COALESCE(pc.codigo || ' — ' || pc.nombre, '') as cuenta_nombre")
    .leftJoin('plan_cuentas', 'pc', 'pc.id', 'e.cuenta_sueldos_id')
    .orderBy('e.apellido', 'ASC')
    .orderBy('e.nombre', 'ASC')
    .orderBy('e.id', 'ASC');
  if (soloActivos) q.where('e.activo', 1);
  return q.all();
}

export function createEmpleado(b, user = null) {
  const payload = {
    legajo: String(b.legajo || '').trim() || getNextNumeroDocumento('legajo', null, { advance: true }).numero,
    cuil: formatCuil(b.cuil),
    nombre: String(b.nombre || '').trim(),
    apellido: String(b.apellido || '').trim(),
    fecha_ingreso: b.fecha_ingreso || new Date().toISOString().slice(0, 10),
    fecha_egreso: b.fecha_egreso || '',
    modalidad_contrato_afip: String(b.modalidad_contrato_afip || '008').trim(),
    situacion_revista_afip: String(b.situacion_revista_afip || '01').trim(),
    condicion_afip: String(b.condicion_afip || '01').trim(),
    actividad_afip: String(b.actividad_afip || '049').trim(),
    obra_social_codigo: String(b.obra_social_codigo || '104309').trim(),
    convenio_cct: String(b.convenio_cct || 'CCT Calzado (UTICRA)').trim(),
    categoria_laboral: String(b.categoria_laboral || 'Oficial').trim(),
    puesto: String(b.puesto || '').trim(),
    sector: b.sector || 'Producción',
    obra_social_adherentes: Math.max(0, Math.round(Number(b.obra_social_adherentes || 0))),
    cbu: validateCbu(b.cbu),
    sueldo_basico: Math.max(0, Number(b.sueldo_basico || 0)),
    cuenta_sueldos_id: b.cuenta_sueldos_id ? Number(b.cuenta_sueldos_id) : null,
    observaciones: String(b.observaciones || '').trim(),
    notas: String(b.notas || '').trim(),
    activo: b.activo === undefined ? 1 : (Number(b.activo) ? 1 : 0),
    ...(b.custom_fields !== undefined ? { custom_fields: b.custom_fields } : {}),
  };
  empleadoRepo.validate(payload);
  return empleadoRepo.create(payload, user);
}

export function updateEmpleado(id, b, user = null) {
  const ex = empleadoRepo.findById(id);
  if (!ex) return false;
  const patch = {};
  const strFields = [
    'legajo', 'nombre', 'apellido', 'fecha_ingreso', 'fecha_egreso',
    'modalidad_contrato_afip', 'situacion_revista_afip', 'condicion_afip',
    'actividad_afip', 'obra_social_codigo', 'convenio_cct', 'categoria_laboral',
    'puesto', 'sector', 'observaciones', 'notas',
  ];
  for (const k of strFields) {
    if (b[k] !== undefined) patch[k] = String(b[k] || '').trim();
  }
  if (b.cuil !== undefined) patch.cuil = formatCuil(b.cuil);
  if (b.cbu !== undefined) patch.cbu = validateCbu(b.cbu);
  if (b.obra_social_adherentes !== undefined) patch.obra_social_adherentes = Math.max(0, Math.round(Number(b.obra_social_adherentes || 0)));
  if (b.sueldo_basico !== undefined) patch.sueldo_basico = Math.max(0, Number(b.sueldo_basico || 0));
  if (b.cuenta_sueldos_id !== undefined) patch.cuenta_sueldos_id = b.cuenta_sueldos_id ? Number(b.cuenta_sueldos_id) : null;
  if (b.activo !== undefined) patch.activo = Number(b.activo) ? 1 : 0;
  if (b.custom_fields !== undefined) patch.custom_fields = b.custom_fields;
  empleadoRepo.validate(patch, { partial: true });
  return empleadoRepo.update(id, patch, user);
}

export function deleteEmpleado(id) {
  const usado = reciboRepo.query().where('empleado_id', Number(id)).count() > 0;
  if (usado) {
    throw new Error('El empleado tiene recibos asociados; desactivalo en lugar de eliminarlo.');
  }
  return empleadoRepo.delete(id);
}

export function getEmpleadoDetalle(id) {
  const emp = empleadoRepo.findById(Number(id));
  if (!emp) return null;
  const licencias = licenciaRepo.where('empleado_id', emp.id).orderBy('fecha_desde', 'DESC').orderBy('id', 'DESC').all();
  const recibos = reciboRepo.query('r')
    .select('r.*', 'l.numero as liquidacion_numero', 'l.periodo', 'l.tipo_liquidacion', 'l.fecha_liquidacion', 'l.fecha_pago', 'l.estado as liquidacion_estado')
    .innerJoin('liquidaciones_sueldos', 'l', 'l.id', 'r.liquidacion_id')
    .where('r.empleado_id', emp.id)
    .orderBy('l.periodo', 'DESC')
    .orderBy('r.id', 'DESC')
    .all();
  return { empleado: emp, licencias, recibos };
}

export function listLicencias({ empleado_id, periodo, tipo, estado } = {}) {
  const qb = licenciaRepo.query('lic')
    .select('lic.*', 'e.legajo', 'e.nombre as empleado_nombre', 'e.apellido as empleado_apellido', 'e.sector')
    .innerJoin('empleados', 'e', 'e.id', 'lic.empleado_id')
    .orderBy('lic.fecha_desde', 'DESC')
    .orderBy('lic.id', 'DESC');
  if (empleado_id) qb.where('lic.empleado_id', Number(empleado_id));
  if (periodo) qb.where('lic.periodo', String(periodo).trim());
  if (tipo) qb.where('lic.tipo', String(tipo).trim());
  if (estado) qb.where('lic.estado', String(estado).trim());
  return qb.all().map(r => ({
    ...r,
    empleado_nombre_completo: `${r.empleado_apellido || ''} ${r.empleado_nombre || ''}`.trim(),
  }));
}

export function createLicencia(b = {}, user = null) {
  const empId = Number(b.empleado_id || 0);
  if (!empId) throw new Error('Debe seleccionar un empleado');
  const fechaDesde = String(b.fecha_desde || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const periodo = String(b.periodo || fechaDesde.slice(0, 7)).trim();
  const payload = {
    empleado_id: empId,
    tipo: b.tipo || 'Vacaciones',
    periodo,
    fecha_desde: fechaDesde,
    fecha_hasta: String(b.fecha_hasta || fechaDesde).slice(0, 10),
    dias: Math.max(0, Math.round(Number(b.dias ?? 1))),
    con_goce: b.con_goce === undefined ? (b.tipo === 'Ausencia Injustificada' ? 0 : 1) : (Number(b.con_goce) ? 1 : 0),
    estado: b.estado || 'Aprobada',
    observaciones: String(b.observaciones || '').trim(),
  };
  licenciaRepo.validate(payload);
  return licenciaRepo.create(payload, user);
}

export function updateLicencia(id, b = {}, user = null) {
  const ex = licenciaRepo.findById(Number(id));
  if (!ex) return false;
  const patch = {};
  if (b.tipo !== undefined) patch.tipo = b.tipo;
  if (b.fecha_desde !== undefined) patch.fecha_desde = String(b.fecha_desde || '').slice(0, 10);
  if (b.fecha_hasta !== undefined) patch.fecha_hasta = String(b.fecha_hasta || '').slice(0, 10);
  if (b.periodo !== undefined) patch.periodo = String(b.periodo || '').trim();
  else if (patch.fecha_desde) patch.periodo = patch.fecha_desde.slice(0, 7);
  if (b.dias !== undefined) patch.dias = Math.max(0, Math.round(Number(b.dias || 0)));
  if (b.con_goce !== undefined) patch.con_goce = Number(b.con_goce) ? 1 : 0;
  if (b.estado !== undefined) patch.estado = b.estado;
  if (b.observaciones !== undefined) patch.observaciones = String(b.observaciones || '').trim();
  licenciaRepo.validate(patch, { partial: true });
  return licenciaRepo.update(Number(id), patch, user);
}

export function deleteLicencia(id) {
  return licenciaRepo.delete(Number(id));
}

// ── Motor de Cálculo de Recibos y Topes Previsionales ─────────────────────────

function topearBase(monto, minBase, maxBase) {
  if (!(monto > 0)) return 0;
  const low = Math.max(0, Number(minBase || 0));
  const high = Number(maxBase || 0) > 0 ? Number(maxBase) : Infinity;
  return Number(Math.min(high, Math.max(low, monto)).toFixed(2));
}

function buildLineasCalculadas({ emp, diasTrabajados, conceptosByCode, manualLineas = [], params }) {
  const dias = Math.max(0, Math.min(30, Number(diasTrabajados ?? 30)));
  const basicoProp = Number(((Number(emp.sueldo_basico || 0) * dias) / 30).toFixed(2));
  const cMap = conceptosByCode;

  const lineas = [];
  const cBasico = cMap.get('BASICO');
  if (cBasico && basicoProp > 0) {
    lineas.push({
      concepto: cBasico,
      concepto_id: cBasico.id,
      codigo_afip_lsd: cBasico.codigo_afip_lsd,
      descripcion: cBasico.descripcion,
      cantidad: dias,
      base_calculo: Number(emp.sueldo_basico || 0),
      importe_haber: basicoProp,
      importe_descuento: 0,
      importe_contribucion: 0,
    });
  }

  // Novedades manuales (haberes / no rem / descuentos adicionales)
  for (const ml of manualLineas) {
    const conc = ml.concepto_id ? Array.from(cMap.values()).find(x => Number(x.id) === Number(ml.concepto_id)) : null;
    lineas.push({
      concepto: conc,
      concepto_id: conc?.id || null,
      codigo_afip_lsd: ml.codigo_afip_lsd || conc?.codigo_afip_lsd || '110000',
      descripcion: ml.descripcion || conc?.descripcion || 'Novedad',
      cantidad: Number(ml.cantidad ?? 1),
      base_calculo: Number(ml.base_calculo ?? 0),
      importe_haber: Number(ml.importe_haber || 0),
      importe_descuento: Number(ml.importe_descuento || 0),
      importe_contribucion: Number(ml.importe_contribucion || 0),
    });
  }

  // Calcular totales imponibles para F.931
  let totalRem = 0;
  let totalNoRem = 0;
  let sumSipa = 0;
  let sumInssjp = 0;
  let sumOs = 0;
  let sumLrt = 0;

  for (const l of lineas) {
    const h = Number(l.importe_haber || 0);
    if (!(h > 0)) continue;
    const tipo = l.concepto?.tipo || 'remunerativo';
    if (tipo === 'no_remunerativo') {
      totalNoRem += h;
      if (l.concepto?.aporta_os) sumOs += h;
      if (l.concepto?.aporta_lrt !== 0) sumLrt += h;
    } else if (tipo === 'remunerativo') {
      totalRem += h;
      if (l.concepto?.aporta_sipa !== 0) sumSipa += h;
      if (l.concepto?.aporta_inssjp !== 0) sumInssjp += h;
      if (l.concepto?.aporta_os !== 0) sumOs += h;
      if (l.concepto?.aporta_lrt !== 0) sumLrt += h;
    }
  }

  const base1 = topearBase(sumSipa, params.nomina_base_min, params.nomina_base_max);
  const base2 = Number(sumSipa.toFixed(2));
  const base3 = Number(sumInssjp.toFixed(2));
  const base4 = topearBase(sumOs, params.nomina_base_min, params.nomina_base_max);
  const base5 = topearBase(sumInssjp, params.nomina_base_min, params.nomina_base_max);
  const base8 = Number(sumOs.toFixed(2));
  const base9 = Number(sumLrt.toFixed(2));

  // Retenciones legales automáticas sobre bases topeadas
  const addRet = (code, base) => {
    const c = cMap.get(code);
    if (!c || Number(c.activo) === 0 || !(base > 0)) return;
    const pct = Number(c.valor_default || 0);
    const imp = Number(((base * pct) / 100).toFixed(2));
    if (imp > 0) {
      lineas.push({
        concepto: c,
        concepto_id: c.id,
        codigo_afip_lsd: c.codigo_afip_lsd,
        descripcion: c.descripcion,
        cantidad: pct,
        base_calculo: base,
        importe_haber: 0,
        importe_descuento: imp,
        importe_contribucion: 0,
      });
    }
  };
  addRet('JUBILACION', base1);
  addRet('PAMI', base5);
  addRet('OBRA_SOCIAL', base4);
  addRet('SINDICATO', totalRem);

  // Contribuciones patronales sobre bases sin tope máximo (Bases 2, 8 y 9)
  const addContrib = (code, base) => {
    const c = cMap.get(code);
    if (!c || Number(c.activo) === 0 || !(base > 0)) return;
    const pct = Number(c.valor_default || 0);
    const imp = Number(((base * pct) / 100).toFixed(2));
    if (imp > 0) {
      lineas.push({
        concepto: c,
        concepto_id: c.id,
        codigo_afip_lsd: c.codigo_afip_lsd,
        descripcion: c.descripcion,
        cantidad: pct,
        base_calculo: base,
        importe_haber: 0,
        importe_descuento: 0,
        importe_contribucion: imp,
      });
    }
  };
  addContrib('CONTRIB_SIPA', base2);
  addContrib('CONTRIB_OS', base8);

  const cArt = cMap.get('CONTRIB_ART');
  if (cArt && Number(cArt.activo) !== 0 && base9 > 0) {
    const artImp = Number((((base9 * Number(params.nomina_art_pct || 0)) / 100) + Number(params.nomina_art_fija || 0)).toFixed(2));
    if (artImp > 0) {
      lineas.push({
        concepto: cArt,
        concepto_id: cArt.id,
        codigo_afip_lsd: cArt.codigo_afip_lsd,
        descripcion: cArt.descripcion,
        cantidad: Number(params.nomina_art_pct || 0),
        base_calculo: base9,
        importe_haber: 0,
        importe_descuento: 0,
        importe_contribucion: artImp,
      });
    }
  }

  const cScvo = cMap.get('CONTRIB_SCVO');
  if (cScvo && Number(cScvo.activo) !== 0 && base9 > 0) {
    const scvoImp = Number(Number(params.nomina_scvo_monto || 0).toFixed(2));
    if (scvoImp > 0) {
      lineas.push({
        concepto: cScvo,
        concepto_id: cScvo.id,
        codigo_afip_lsd: cScvo.codigo_afip_lsd,
        descripcion: cScvo.descripcion,
        cantidad: 1,
        base_calculo: scvoImp,
        importe_haber: 0,
        importe_descuento: 0,
        importe_contribucion: scvoImp,
      });
    }
  }

  const totalDescuentos = Number(lineas.reduce((s, l) => s + Number(l.importe_descuento || 0), 0).toFixed(2));
  const totalContrib = Number(lineas.reduce((s, l) => s + Number(l.importe_contribucion || 0), 0).toFixed(2));
  const netoAPagar = Number((totalRem + totalNoRem - totalDescuentos).toFixed(2));

  return {
    dias_trabajados: dias,
    base_imponible_1: base1,
    base_imponible_2: base2,
    base_imponible_3: base3,
    base_imponible_4: base4,
    base_imponible_5: base5,
    base_imponible_6: 0,
    base_imponible_7: 0,
    base_imponible_8: base8,
    base_imponible_9: base9,
    total_remunerativo: Number(totalRem.toFixed(2)),
    total_no_remunerativo: Number(totalNoRem.toFixed(2)),
    total_descuentos: totalDescuentos,
    total_contribuciones: totalContrib,
    neto_a_pagar: netoAPagar,
    lineas,
  };
}

function syncCabeceraTotales(liqId, user = null) {
  const recibos = reciboRepo.query().where('liquidacion_id', Number(liqId)).all();
  const tot = {
    total_remunerativo: 0,
    total_no_remunerativo: 0,
    total_descuentos: 0,
    total_contribuciones: 0,
    total_neto: 0,
  };
  for (const r of recibos) {
    tot.total_remunerativo += Number(r.total_remunerativo || 0);
    tot.total_no_remunerativo += Number(r.total_no_remunerativo || 0);
    tot.total_descuentos += Number(r.total_descuentos || 0);
    tot.total_contribuciones += Number(r.total_contribuciones || 0);
    tot.total_neto += Number(r.neto_a_pagar || 0);
  }
  for (const k of Object.keys(tot)) tot[k] = Number(tot[k].toFixed(2));
  liquidacionRepo.update(Number(liqId), tot, user);
  return tot;
}

// ── Liquidaciones y Recibos ───────────────────────────────────────────────────

export function listLiquidaciones() {
  return liquidacionRepo.query()
    .orderBy('periodo', 'DESC')
    .orderBy('id', 'DESC')
    .all();
}

export function getLiquidacionById(id) {
  const liquidacion = liquidacionRepo.findById(id);
  if (!liquidacion) return null;
  const recibos = reciboRepo.query('r')
    .select(
      'r.*',
      'e.legajo',
      'e.nombre as empleado_nombre',
      'e.apellido as empleado_apellido',
      'e.cuil',
      'e.fecha_ingreso',
      'e.modalidad_contrato_afip',
      'e.situacion_revista_afip',
      'e.condicion_afip',
      'e.actividad_afip',
      'e.obra_social_codigo',
      'e.convenio_cct',
      'e.categoria_laboral',
      'e.puesto',
      'e.sector',
      'e.obra_social_adherentes',
      'e.cbu',
      'e.sueldo_basico',
      'e.cuenta_sueldos_id',
    )
    .innerJoin('empleados', 'e', 'e.id', 'r.empleado_id')
    .where('r.liquidacion_id', Number(id))
    .orderBy('e.apellido', 'ASC')
    .orderBy('e.nombre', 'ASC')
    .all();

  const reciboIds = recibos.map(r => r.id);
  const allLineas = reciboIds.length
    ? reciboLineaRepo.query('l')
        .select('l.*', 'c.codigo_interno', 'c.tipo as concepto_tipo')
        .leftJoin('nomina_conceptos', 'c', 'c.id', 'l.concepto_id')
        .whereIn('l.recibo_id', reciboIds)
        .orderBy('l.id', 'ASC')
        .all()
    : [];
  const lineasByRecibo = new Map();
  for (const l of allLineas) {
    if (!lineasByRecibo.has(l.recibo_id)) lineasByRecibo.set(l.recibo_id, []);
    lineasByRecibo.get(l.recibo_id).push(l);
  }
  for (const r of recibos) {
    r.lineas = lineasByRecibo.get(r.id) || [];
    r.nombre_completo = [r.empleado_apellido, r.empleado_nombre].filter(Boolean).join(', ') || r.empleado_nombre;
  }
  return { liquidacion, recibos };
}

export function createLiquidacion(b = {}, user = null) {
  const periodo = String(b.periodo || new Date().toISOString().slice(0, 7)).trim();
  if (!/^\d{4}-\d{2}$/.test(periodo)) {
    throw new Error('El período debe tener formato YYYY-MM.');
  }
  const fechaLiq = b.fecha_liquidacion || b.fecha || new Date().toISOString().slice(0, 10);
  const params = getParametrosPrevisionales();
  const conceptos = listConceptos();
  const conceptosByCode = new Map(conceptos.map(c => [c.codigo_interno, c]));

  return liquidacionRepo.transaction(() => {
    const count = liquidacionRepo.query().count();
    const numero = String(b.numero || `LIQ-${periodo.replace('-', '')}-${String(count + 1).padStart(3, '0')}`).trim();
    const payload = {
      numero,
      periodo,
      tipo_liquidacion: b.tipo_liquidacion || 'Mensual',
      fecha: fechaLiq,
      fecha_liquidacion: fechaLiq,
      fecha_pago: b.fecha_pago || fechaLiq,
      banco_deposito_aportes: String(b.banco_deposito_aportes || params.nomina_ultimo_dep_banco || '').trim(),
      estado: 'Borrador',
      observaciones: String(b.observaciones || '').trim(),
    };
    liquidacionRepo.validate(payload);
    const liqId = liquidacionRepo.create(payload, user);

    let activos = empleadoRepo.query().where('activo', 1).orderBy('apellido', 'ASC').orderBy('nombre', 'ASC').all();
    if (Array.isArray(b.empleado_ids) && b.empleado_ids.length > 0) {
      const allowed = new Set(b.empleado_ids.map(Number).filter(Boolean));
      activos = activos.filter(e => allowed.has(Number(e.id)));
    }
    const novedadesPorEmp = new Map();
    if (Array.isArray(b.recibos)) {
      for (const r of b.recibos) {
        novedadesPorEmp.set(Number(r.empleado_id), r);
      }
    }

    const licenciasPeriodo = licenciaRepo.where('periodo', periodo).where('estado', 'Aprobada').all();
    const licPorEmp = new Map();
    for (const lic of licenciasPeriodo) {
      const k = Number(lic.empleado_id);
      if (!licPorEmp.has(k)) licPorEmp.set(k, []);
      licPorEmp.get(k).push(lic);
    }

    for (const emp of activos) {
      const nov = novedadesPorEmp.get(Number(emp.id));
      if (Array.isArray(b.recibos) && !nov) continue;

      const empLics = licPorEmp.get(Number(emp.id)) || [];
      const diasSinGoce = empLics
        .filter(l => Number(l.con_goce) === 0)
        .reduce((s, l) => s + Number(l.dias || 0), 0);
      const defaultDias = Math.max(0, 30 - diasSinGoce);

      const calc = buildLineasCalculadas({
        emp,
        diasTrabajados: nov?.dias_trabajados ?? defaultDias,
        conceptosByCode,
        manualLineas: nov?.novedades || [],
        params,
      });

      const recId = reciboRepo.create({
        liquidacion_id: liqId,
        empleado_id: emp.id,
        dias_trabajados: calc.dias_trabajados,
        base_imponible_1: calc.base_imponible_1,
        base_imponible_2: calc.base_imponible_2,
        base_imponible_3: calc.base_imponible_3,
        base_imponible_4: calc.base_imponible_4,
        base_imponible_5: calc.base_imponible_5,
        base_imponible_6: calc.base_imponible_6,
        base_imponible_7: calc.base_imponible_7,
        base_imponible_8: calc.base_imponible_8,
        base_imponible_9: calc.base_imponible_9,
        total_remunerativo: calc.total_remunerativo,
        total_no_remunerativo: calc.total_no_remunerativo,
        total_descuentos: calc.total_descuentos,
        total_contribuciones: calc.total_contribuciones,
        neto_a_pagar: calc.neto_a_pagar,
        forma_pago: nov?.forma_pago || (emp.cbu ? 'Transferencia CBU' : 'Efectivo'),
      });

      for (const l of calc.lineas) {
        reciboLineaRepo.create({
          recibo_id: recId,
          concepto_id: l.concepto_id,
          codigo_afip_lsd: l.codigo_afip_lsd,
          descripcion: l.descripcion,
          cantidad: l.cantidad,
          base_calculo: l.base_calculo,
          importe_haber: l.importe_haber,
          importe_descuento: l.importe_descuento,
          importe_contribucion: l.importe_contribucion,
        });
      }
    }

    syncCabeceraTotales(liqId, user);
    return liqId;
  });
}

function recalcularReciboInternal(reciboId, user = null) {
  const rec = reciboRepo.findById(reciboId);
  if (!rec) return false;
  const liq = liquidacionRepo.findById(rec.liquidacion_id);
  if (!liq || liq.estado !== 'Borrador') {
    throw new Error('Solo se pueden editar recibos en estado Borrador.');
  }
  const emp = empleadoRepo.findById(rec.empleado_id);
  const params = getParametrosPrevisionales();
  const conceptos = listConceptos();
  const conceptosByCode = new Map(conceptos.map(c => [c.codigo_interno, c]));
  const autoCodes = new Set(['BASICO', 'JUBILACION', 'PAMI', 'OBRA_SOCIAL', 'SINDICATO', 'CONTRIB_SIPA', 'CONTRIB_OS', 'CONTRIB_ART', 'CONTRIB_SCVO']);

  const existingLineas = reciboLineaRepo.query('l')
    .select('l.*', 'c.codigo_interno')
    .leftJoin('nomina_conceptos', 'c', 'c.id', 'l.concepto_id')
    .where('l.recibo_id', Number(reciboId))
    .all();
  const manualLineas = existingLineas.filter(l => !autoCodes.has(l.codigo_interno));

  const calc = buildLineasCalculadas({
    emp,
    diasTrabajados: rec.dias_trabajados,
    conceptosByCode,
    manualLineas,
    params,
  });

  reciboLineaRepo.query().where('recibo_id', Number(reciboId)).delete();
  for (const l of calc.lineas) {
    reciboLineaRepo.create({
      recibo_id: Number(reciboId),
      concepto_id: l.concepto_id,
      codigo_afip_lsd: l.codigo_afip_lsd,
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      base_calculo: l.base_calculo,
      importe_haber: l.importe_haber,
      importe_descuento: l.importe_descuento,
      importe_contribucion: l.importe_contribucion,
    });
  }

  reciboRepo.update(Number(reciboId), {
    base_imponible_1: calc.base_imponible_1,
    base_imponible_2: calc.base_imponible_2,
    base_imponible_3: calc.base_imponible_3,
    base_imponible_4: calc.base_imponible_4,
    base_imponible_5: calc.base_imponible_5,
    base_imponible_6: calc.base_imponible_6,
    base_imponible_7: calc.base_imponible_7,
    base_imponible_8: calc.base_imponible_8,
    base_imponible_9: calc.base_imponible_9,
    total_remunerativo: calc.total_remunerativo,
    total_no_remunerativo: calc.total_no_remunerativo,
    total_descuentos: calc.total_descuentos,
    total_contribuciones: calc.total_contribuciones,
    neto_a_pagar: calc.neto_a_pagar,
  });

  syncCabeceraTotales(rec.liquidacion_id, user);
  return true;
}

export function updateRecibo(reciboId, patch = {}, user = null) {
  const rec = reciboRepo.findById(reciboId);
  if (!rec) return false;
  const liq = liquidacionRepo.findById(rec.liquidacion_id);
  if (!liq || liq.estado !== 'Borrador') {
    throw new Error('Solo se pueden editar recibos en estado Borrador.');
  }

  return reciboRepo.transaction(() => {
    const upd = {};
    if (patch.dias_trabajados !== undefined) upd.dias_trabajados = Math.max(0, Math.min(30, Math.round(Number(patch.dias_trabajados || 0))));
    if (patch.forma_pago !== undefined) upd.forma_pago = patch.forma_pago;
    if (Object.keys(upd).length > 0) reciboRepo.update(Number(reciboId), upd);
    if (patch.dias_trabajados !== undefined) {
      recalcularReciboInternal(reciboId, user);
    }
    return true;
  });
}

function calcAntiguedadAnios(fechaIngreso, fechaRef) {
  if (!fechaIngreso) return 0;
  const d1 = new Date(`${String(fechaIngreso).slice(0, 10)}T00:00:00`);
  const d2 = fechaRef ? new Date(`${String(fechaRef).slice(0, 10)}T00:00:00`) : new Date();
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime()) || d2 < d1) return 0;
  let years = d2.getFullYear() - d1.getFullYear();
  const mDiff = d2.getMonth() - d1.getMonth();
  if (mDiff < 0 || (mDiff === 0 && d2.getDate() < d1.getDate())) years--;
  return Math.max(0, years);
}

export function addReciboNovedad(reciboId, novedad = {}, user = null) {
  const rec = reciboRepo.findById(reciboId);
  if (!rec) throw new Error('Recibo no encontrado');
  const liq = liquidacionRepo.findById(rec.liquidacion_id);
  if (!liq || liq.estado !== 'Borrador') {
    throw new Error('Solo se pueden agregar novedades en estado Borrador.');
  }
  const emp = empleadoRepo.findById(rec.empleado_id);
  const conc = novedad.concepto_id ? conceptoRepo.findById(Number(novedad.concepto_id)) : null;

  let cantidad = Number(novedad.cantidad ?? 1);
  let baseCalculo = Number(novedad.base_calculo ?? 0);
  let importeHaber = Math.max(0, Number(novedad.importe_haber || 0));
  const importeDescuento = Math.max(0, Number(novedad.importe_descuento || 0));

  if (conc && importeHaber === 0 && importeDescuento === 0 && conc.formula_tipo === 'porcentaje_basico') {
    const basicoProp = Number(((Number(emp?.sueldo_basico || 0) * Number(rec.dias_trabajados ?? 30)) / 30).toFixed(2));
    baseCalculo = basicoProp;
    if (conc.codigo_interno === 'ANTIGUEDAD') {
      const anios = calcAntiguedadAnios(emp?.fecha_ingreso, liq.fecha_liquidacion);
      const cantAnios = cantidad > 1 ? cantidad : Math.max(1, anios);
      cantidad = cantAnios;
      importeHaber = Number(((basicoProp * Number(conc.valor_default || 1) * cantAnios) / 100).toFixed(2));
    } else {
      const pct = Number(conc.valor_default || 0);
      cantidad = pct;
      importeHaber = Number(((basicoProp * pct) / 100).toFixed(2));
    }
  }

  return reciboRepo.transaction(() => {
    reciboLineaRepo.create({
      recibo_id: Number(reciboId),
      concepto_id: conc?.id || null,
      codigo_afip_lsd: novedad.codigo_afip_lsd || conc?.codigo_afip_lsd || '110000',
      descripcion: String(novedad.descripcion || conc?.descripcion || 'Novedad').trim(),
      cantidad,
      base_calculo: baseCalculo,
      importe_haber: importeHaber,
      importe_descuento: importeDescuento,
      importe_contribucion: Math.max(0, Number(novedad.importe_contribucion || 0)),
    });
    recalcularReciboInternal(reciboId, user);
    return true;
  });
}

export function updateReciboLinea(lineaId, patch = {}, user = null) {
  const linea = reciboLineaRepo.findById(lineaId);
  if (!linea) return false;
  const rec = reciboRepo.findById(linea.recibo_id);
  const liq = rec ? liquidacionRepo.findById(rec.liquidacion_id) : null;
  if (!liq || liq.estado !== 'Borrador') {
    throw new Error('Solo se pueden editar líneas en estado Borrador.');
  }
  const updates = {};
  if (patch.concepto_id !== undefined) {
    const conc = patch.concepto_id ? conceptoRepo.findById(Number(patch.concepto_id)) : null;
    updates.concepto_id = conc?.id || null;
    if (conc && patch.codigo_afip_lsd === undefined) updates.codigo_afip_lsd = conc.codigo_afip_lsd;
    if (conc && patch.descripcion === undefined) updates.descripcion = conc.descripcion;
  }
  if (patch.descripcion !== undefined) updates.descripcion = String(patch.descripcion || '').trim() || linea.descripcion;
  if (patch.cantidad !== undefined) updates.cantidad = Number(patch.cantidad || 0);
  if (patch.importe_haber !== undefined) updates.importe_haber = Math.max(0, Number(patch.importe_haber || 0));
  if (patch.importe_descuento !== undefined) updates.importe_descuento = Math.max(0, Number(patch.importe_descuento || 0));
  if (Object.keys(updates).length === 0) return true;

  return reciboRepo.transaction(() => {
    reciboLineaRepo.update(Number(lineaId), updates);
    recalcularReciboInternal(rec.id, user);
    return true;
  });
}

export function deleteReciboLinea(lineaId, user = null) {
  const linea = reciboLineaRepo.findById(lineaId);
  if (!linea) return false;
  const rec = reciboRepo.findById(linea.recibo_id);
  const liq = rec ? liquidacionRepo.findById(rec.liquidacion_id) : null;
  if (!liq || liq.estado !== 'Borrador') {
    throw new Error('Solo se pueden quitar líneas en estado Borrador.');
  }
  return reciboRepo.transaction(() => {
    reciboLineaRepo.delete(lineaId);
    recalcularReciboInternal(rec.id, user);
    return true;
  });
}

// ── Contabilidad, StateMachine y EventBus ─────────────────────────────────────

export function generarAsientoNomina({ liquidacion, recibos }, user = null) {
  const ctaSueldosProd = defaultAsientoService.resolveDefaultCuenta('cta_mano_obra_id', '5.1.02')
    || ensureCuenta('5.1.02', { nombre: 'Gastos de Producción y Taller', tipo: 'egreso', naturaleza: 'deudora' });
  const ctaSueldosAdmin = defaultAsientoService.resolveDefaultCuenta('cta_sueldos_admin_id', '5.2.06')
    || ensureCuenta('5.2.06', { nombre: 'Sueldos y Cargas Sociales', tipo: 'egreso', naturaleza: 'deudora' });
  const ctaSueldosPagar = defaultAsientoService.resolveDefaultCuenta('cta_sueldos_pagar_id', '2.1.06')
    || ensureCuenta('2.1.06', { nombre: 'Sueldos y Jornales a Pagar', tipo: 'pasivo', naturaleza: 'acreedora' });
  const ctaCargasPagar = defaultAsientoService.resolveDefaultCuenta('cta_cargas_pagar_id', '2.1.07')
    || ensureCuenta('2.1.07', { nombre: 'Cargas Sociales y Retenciones a Depositar', tipo: 'pasivo', naturaleza: 'acreedora' });
  const ctaSindicatoPagar = defaultAsientoService.resolveDefaultCuenta('cta_sindicato_pagar_id', '2.1.08')
    || ensureCuenta('2.1.08', { nombre: 'Cuota Sindical a Depositar', tipo: 'pasivo', naturaleza: 'acreedora' });

  const debePorCuenta = new Map();
  let totalNeto = 0;
  let totalSindicato = 0;
  let totalF931 = 0;

  for (const r of recibos) {
    const bruto = Number(r.total_remunerativo || 0) + Number(r.total_no_remunerativo || 0);
    const contrib = Number(r.total_contribuciones || 0);
    const costoTotal = Number((bruto + contrib).toFixed(2));

    if (costoTotal > 0) {
      const ctaId = r.cuenta_sueldos_id
        ? Number(r.cuenta_sueldos_id)
        : (r.sector === 'Producción' ? ctaSueldosProd.id : ctaSueldosAdmin.id);
      debePorCuenta.set(ctaId, Number(((debePorCuenta.get(ctaId) || 0) + costoTotal).toFixed(2)));
    }

    let sindRecibo = 0;
    for (const l of (r.lineas || [])) {
      if (l.codigo_interno === 'SINDICATO' || l.codigo_afip_lsd === '810004') {
        sindRecibo += Number(l.importe_descuento || 0);
      }
    }
    const retPrevisionales = Math.max(0, Number(r.total_descuentos || 0) - sindRecibo);
    totalNeto = Number((totalNeto + Number(r.neto_a_pagar || 0)).toFixed(2));
    totalSindicato = Number((totalSindicato + sindRecibo).toFixed(2));
    totalF931 = Number((totalF931 + retPrevisionales + contrib).toFixed(2));
  }

  const lineas = [];
  for (const [ctaId, monto] of debePorCuenta.entries()) {
    if (monto > 0) {
      lineas.push({
        plan_cuenta_id: ctaId,
        debe: monto,
        haber: 0,
        descripcion: `Devengamiento Sueldos y Cargas (${liquidacion.periodo})`,
      });
    }
  }
  if (totalNeto > 0) {
    lineas.push({
      plan_cuenta_id: ctaSueldosPagar.id,
      debe: 0,
      haber: totalNeto,
      descripcion: `Sueldos netos a pagar (${liquidacion.periodo})`,
    });
  }
  if (totalF931 > 0) {
    lineas.push({
      plan_cuenta_id: ctaCargasPagar.id,
      debe: 0,
      haber: totalF931,
      descripcion: `Aportes y Contribuciones F.931 ARCA (${liquidacion.periodo})`,
    });
  }
  if (totalSindicato > 0) {
    lineas.push({
      plan_cuenta_id: ctaSindicatoPagar.id,
      debe: 0,
      haber: totalSindicato,
      descripcion: `Cuota Sindical a Depositar (${liquidacion.periodo})`,
    });
  }

  if (lineas.length < 2) return null;

  const diario = defaultAsientoService.resolveDiario('general');
  const asientoId = defaultAsientoService.createAsiento({
    diario_id: diario?.id || null,
    fecha: liquidacion.fecha_liquidacion,
    tipo_origen: 'nomina',
    origen_id: Number(liquidacion.id),
    concepto: `Devengamiento Nómina ${liquidacion.tipo_liquidacion || 'Mensual'} ${liquidacion.periodo}`,
    estado: 'Confirmado',
    lineas,
  });
  if (asientoId) {
    liquidacionRepo.update(liquidacion.id, { asiento_id: asientoId }, user);
  }
  return asientoId;
}

export function confirmarLiquidacion(id, user = null) {
  const det = getLiquidacionById(id);
  if (!det) return false;
  NOMINA_SM.assertTransition(det.liquidacion.estado, 'Confirmada');
  if (!det.recibos.length) {
    throw new Error('La liquidación no tiene recibos cargados.');
  }

  return liquidacionRepo.transaction(() => {
    registerDomainSubscribers();
    liquidacionRepo.update(id, { estado: 'Confirmada' }, user);
    domainBus.emit('nomina.confirmada', {
      liquidacion: { ...det.liquidacion, estado: 'Confirmada' },
      recibos: det.recibos,
      user,
    });
    return true;
  });
}

export function anularLiquidacion(id, user = null) {
  const det = getLiquidacionById(id);
  if (!det) return false;
  NOMINA_SM.assertTransition(det.liquidacion.estado, 'Anulada');

  return liquidacionRepo.transaction(() => {
    registerDomainSubscribers();
    domainBus.emit('nomina.anulada', {
      liquidacion: det.liquidacion,
      user,
    });
    liquidacionRepo.update(id, { estado: 'Anulada' }, user);
    return true;
  });
}

export function deleteLiquidacion(id) {
  const liq = liquidacionRepo.findById(id);
  if (!liq) return false;
  if (liq.estado !== 'Borrador') {
    throw new Error('No se puede eliminar físicamente una liquidación Confirmada o Anulada; utilizá Anular.');
  }
  return liquidacionRepo.delete(id);
}
