import { BaseRepository } from '../../core/BaseRepository.js';
import { MODELS } from '../../db/models.js';

export const secuenciaRepo = new BaseRepository({ model: MODELS.secuencias });
export const etapaConfigRepo = new BaseRepository({ model: MODELS.etapas_config });
export const empresaRepo = new BaseRepository({ model: MODELS.empresa_config });

const categoriaRepo = new BaseRepository({
  table: 'categorias',
  columns: ['nombre', 'padre_id', 'descripcion'],
});
const unidadRepo = new BaseRepository({
  table: 'unidades_medida',
  columns: ['nombre', 'grupo', 'factor'],
});
const varianteRepo = new BaseRepository({
  table: 'variantes',
  columns: ['atributo', 'valor'],
});
const impuestoConfigRepo = new BaseRepository({
  table: 'impuestos_config',
  columns: [
    'nombre', 'codigo', 'tipo', 'aplica_a', 'alicuota_defecto', 'base_calculo',
    'jurisdiccion_codigo', 'codigo_regimen', 'minimo_no_imponible', 'cuenta_contable_id', 'activo',
  ],
});
const jurisdiccionRepo = new BaseRepository({ table: 'jurisdicciones' });
const recetaLineaRepo = new BaseRepository({ table: 'receta_lineas', columns: ['udm_receta'] });
const puntoVentaRepo = new BaseRepository({
  table: 'puntos_venta',
  columns: ['numero', 'nombre', 'es_default', 'es_electronica', 'cai', 'cai_vto', 'activo'],
});

export function getEmpresaConfig() {
  const row = empresaRepo.findById(1);
  if (!row) {
    return {
      id: 1,
      alicuota_iva_defecto: 21,
      alicuota_iva_compras_defecto: 21,
      alicuota_iva_ventas_defecto: 21,
      dias_entrega_defecto: 7,
    };
  }
  const { afip_private_key, afip_ta_wsfe, afip_ta_padron, afip_ta_wscdc, ...safe } = row;
  return { ...safe, afip_has_key: Boolean(afip_private_key) };
}

export function updateEmpresaConfig(b) {
  const cur = getEmpresaConfig();
  const proxInt = (val, fallback) => Math.max(1, parseInt(val ?? fallback ?? 1, 10) || 1);
  const ivaCompras = b.alicuota_iva_compras_defecto !== undefined ? Number(b.alicuota_iva_compras_defecto) : (cur.alicuota_iva_compras_defecto ?? cur.alicuota_iva_defecto ?? 21);
  const ivaVentas = b.alicuota_iva_ventas_defecto !== undefined ? Number(b.alicuota_iva_ventas_defecto) : (cur.alicuota_iva_ventas_defecto ?? cur.alicuota_iva_defecto ?? 21);
  const ivaGeneral = b.alicuota_iva_defecto !== undefined ? Number(b.alicuota_iva_defecto) : ivaVentas;
  const ctaField = (k) => (b[k] !== undefined ? (b[k] ? Number(b[k]) : null) : (cur[k] ?? null));
  empresaRepo.update(1, {
    razon_social: b.razon_social ?? cur.razon_social ?? '',
    nombre_fantasia: b.nombre_fantasia ?? cur.nombre_fantasia ?? '',
    cuit: b.cuit ?? cur.cuit ?? '',
    condicion_iva: b.condicion_iva ?? cur.condicion_iva ?? 'Responsable Inscripto',
    direccion: b.direccion ?? cur.direccion ?? '',
    localidad: b.localidad ?? cur.localidad ?? '',
    provincia: b.provincia ?? cur.provincia ?? '',
    codigo_postal: b.codigo_postal ?? cur.codigo_postal ?? '',
    pais: b.pais !== undefined ? (String(b.pais).trim() || 'Argentina') : (cur.pais || 'Argentina'),
    telefono: b.telefono ?? cur.telefono ?? '',
    email: b.email ?? cur.email ?? '',
    iibb: b.iibb ?? cur.iibb ?? '',
    inicio_actividades: b.inicio_actividades ?? cur.inicio_actividades ?? '',
    alicuota_iva_defecto: ivaGeneral,
    alicuota_iva_compras_defecto: ivaCompras,
    alicuota_iva_ventas_defecto: ivaVentas,
    prefijo_compra: b.prefijo_compra ?? cur.prefijo_compra ?? 'FC',
    prefijo_remito: b.prefijo_remito ?? cur.prefijo_remito ?? 'REM',
    prefijo_pago: b.prefijo_pago ?? cur.prefijo_pago ?? 'OP',
    prefijo_venta: b.prefijo_venta ?? cur.prefijo_venta ?? 'FA',
    prefijo_cobro: b.prefijo_cobro ?? cur.prefijo_cobro ?? 'RC',
    prox_num_compra: proxInt(b.prox_num_compra, cur.prox_num_compra),
    prox_num_remito: proxInt(b.prox_num_remito, cur.prox_num_remito),
    prox_num_pago: proxInt(b.prox_num_pago, cur.prox_num_pago),
    prox_num_venta: proxInt(b.prox_num_venta, cur.prox_num_venta),
    prox_num_cobro: proxInt(b.prox_num_cobro, cur.prox_num_cobro),
    logo_data: b.logo_data !== undefined ? String(b.logo_data || '') : (cur.logo_data || ''),
    dias_entrega_defecto: b.dias_entrega_defecto !== undefined ? Math.max(0, Number(b.dias_entrega_defecto)) : (cur.dias_entrega_defecto ?? 7),
    print_formato: ['A4', 'A5', 'ticket80', 'ticket58'].includes(b.print_formato) ? b.print_formato : (cur.print_formato || 'A4'),
    print_copias: ['original', 'duplicado', 'triplicado'].includes(b.print_copias) ? b.print_copias : (cur.print_copias || 'original'),
    print_mostrar_logo: b.print_mostrar_logo !== undefined ? (b.print_mostrar_logo ? 1 : 0) : (cur.print_mostrar_logo ?? 1),
    print_modo_economico: b.print_modo_economico !== undefined ? (b.print_modo_economico ? 1 : 0) : (cur.print_modo_economico ?? 0),
    print_pie_comprobante: b.print_pie_comprobante !== undefined ? String(b.print_pie_comprobante) : (cur.print_pie_comprobante ?? ''),
    lct_ultimo_deposito_fecha: b.lct_ultimo_deposito_fecha !== undefined ? String(b.lct_ultimo_deposito_fecha || '') : (cur.lct_ultimo_deposito_fecha ?? ''),
    lct_ultimo_deposito_banco: b.lct_ultimo_deposito_banco !== undefined ? String(b.lct_ultimo_deposito_banco || '') : (cur.lct_ultimo_deposito_banco ?? ''),
    lct_ultimo_deposito_periodo: b.lct_ultimo_deposito_periodo !== undefined ? String(b.lct_ultimo_deposito_periodo || '') : (cur.lct_ultimo_deposito_periodo ?? ''),
    cta_clientes_id: ctaField('cta_clientes_id'),
    cta_proveedores_id: ctaField('cta_proveedores_id'),
    cta_ventas_id: ctaField('cta_ventas_id'),
    cta_compras_id: ctaField('cta_compras_id'),
    cta_mano_obra_id: ctaField('cta_mano_obra_id'),
    cta_iva_credito_id: ctaField('cta_iva_credito_id'),
    cta_iva_debito_id: ctaField('cta_iva_debito_id'),
    cta_perc_sufridas_id: ctaField('cta_perc_sufridas_id'),
    cta_ret_depositar_id: ctaField('cta_ret_depositar_id'),
  });
  return getEmpresaConfig();
}

export function getConfig() {
  const rawCats = categoriaRepo.query('c')
    .select("c.*, COALESCE(p.nombre, '') as padre_nombre")
    .leftJoin('categorias', 'p', 'p.id', 'c.padre_id')
    .all();
  const categorias = rawCats
    .map(c => ({
      ...c,
      display_name: c.padre_nombre ? `${c.padre_nombre} / ${c.nombre}` : c.nombre,
    }))
    .sort((a, b) => {
      const ka = a.padre_nombre || a.nombre || '';
      const kb = b.padre_nombre || b.nombre || '';
      const cmp = ka.localeCompare(kb);
      return cmp !== 0 ? cmp : String(a.nombre || '').localeCompare(String(b.nombre || ''));
    });

  return {
    categorias,
    unidades: unidadRepo.query().orderBy('grupo', 'ASC').orderBy('factor', 'ASC').orderBy('nombre', 'ASC').all(),
    variantes: varianteRepo.query().orderBy('atributo', 'ASC').orderBy('valor', 'ASC').all(),
    etapas: etapaConfigRepo.query().orderBy('orden', 'ASC').orderBy('id', 'ASC').all(),
    impuestos: impuestoConfigRepo.query().orderBy('tipo', 'ASC').orderBy('alicuota_defecto', 'DESC').orderBy('nombre', 'ASC').all(),
    jurisdicciones: jurisdiccionRepo.query().where('activo', 1).orderBy('codigo', 'ASC').all(),
    empresa: getEmpresaConfig(),
  };
}

export function convertUnitFromDb(value, fromUnit, toUnit) {
  const v = Number(value) || 0;
  if (!fromUnit || !toUnit || fromUnit === toUnit) return v;
  const fromRow = unidadRepo.query().select('grupo, factor').where('nombre', fromUnit).get();
  const toRow = unidadRepo.query().select('grupo, factor').where('nombre', toUnit).get();
  if (!fromRow || !toRow || fromRow.grupo !== toRow.grupo || !toRow.factor) {
    return v;
  }
  return (v * fromRow.factor) / toRow.factor;
}

function normalizeCategoriaPayload(data, selfId = null) {
  const payload = typeof data === 'string' ? { nombre: data } : (data || {});
  const nombre = String(payload.nombre || '').trim();
  const rawPadre = payload.padre_id;
  let padreId = rawPadre !== undefined && rawPadre !== null && rawPadre !== '' ? Number(rawPadre) : null;
  if (Number.isNaN(padreId) || (selfId !== null && padreId === Number(selfId))) {
    padreId = null;
  }
  const descripcion = String(payload.descripcion || '').trim();
  return { nombre, padreId, descripcion };
}

export function createCategoria(data) {
  const { nombre, padreId, descripcion } = normalizeCategoriaPayload(data);
  return categoriaRepo.create({ nombre, padre_id: padreId, descripcion });
}

export function updateCategoria(id, data) {
  const old = categoriaRepo.query().select('id').where('id', id).get();
  if (!old) return false;
  const { nombre, padreId, descripcion } = normalizeCategoriaPayload(data, id);
  categoriaRepo.update(id, { nombre, padre_id: padreId, descripcion });
  return true;
}

export function deleteCategoria(id) {
  categoriaRepo.delete(id);
}

export function createUnidad({ nombre, grupo, factor }) {
  return unidadRepo.create({
    nombre: nombre.trim(),
    grupo: grupo.trim(),
    factor: Number(factor) || 1,
  });
}

export function updateUnidad(id, { nombre, grupo, factor }) {
  const old = unidadRepo.query().select('nombre').where('id', id).get();
  if (!old) return false;
  const newName = nombre.trim();
  return unidadRepo.transaction(() => {
    unidadRepo.update(id, {
      nombre: newName,
      grupo: grupo.trim(),
      factor: Number(factor) || 1,
    });
    if (newName !== old.nombre) {
      recetaLineaRepo.query().where('udm_receta', old.nombre).update({ udm_receta: newName });
    }
    return true;
  });
}

export function deleteUnidad(id) {
  unidadRepo.delete(id);
}

export function createVariante({ atributo, valor }) {
  return varianteRepo.create({
    atributo: atributo.trim(),
    valor: valor.trim(),
  });
}

export function seedTallesVariantes() {
  const existing = new Set(
    varianteRepo.query().select('valor').where('atributo', 'Talle').all().map(r => String(r.valor))
  );
  for (const s of ['35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45']) {
    if (!existing.has(s)) varianteRepo.create({ atributo: 'Talle', valor: s });
  }
}

export function deleteVariante(id) {
  varianteRepo.delete(id);
}

export function deleteVarianteAtributo(atributo) {
  varianteRepo.query().where('atributo', atributo).delete();
}

export function createEtapa({ nombre, descripcion = '', orden, dias_estimados, costo_unidad, taller_id, plan_cuenta_id, depende_de_id }) {
  return etapaConfigRepo.create({
    nombre: nombre.trim(),
    descripcion: String(descripcion || '').trim(),
    orden: Number(orden) || 1,
    dias_estimados: Math.max(0, Number(dias_estimados) || 0),
    costo_unidad: Math.max(0, Number(costo_unidad) || 0),
    taller_id: taller_id ? Number(taller_id) : null,
    plan_cuenta_id: plan_cuenta_id ? Number(plan_cuenta_id) : null,
    depende_de_id: depende_de_id ? Number(depende_de_id) : null,
  });
}

export function updateEtapa(id, { nombre, descripcion, orden, dias_estimados, costo_unidad, taller_id, plan_cuenta_id, depende_de_id }) {
  const existing = etapaConfigRepo.findById(id);
  if (!existing) return false;
  const nextDep = depende_de_id !== undefined
    ? (depende_de_id && Number(depende_de_id) !== Number(id) ? Number(depende_de_id) : null)
    : existing.depende_de_id;
  return etapaConfigRepo.update(id, {
    nombre: nombre !== undefined ? nombre.trim() : existing.nombre,
    descripcion: descripcion !== undefined ? String(descripcion || '').trim() : (existing.descripcion ?? ''),
    orden: orden !== undefined ? Number(orden) : existing.orden,
    dias_estimados: dias_estimados !== undefined ? Math.max(0, Number(dias_estimados)) : existing.dias_estimados,
    costo_unidad: costo_unidad !== undefined ? Math.max(0, Number(costo_unidad) || 0) : (existing.costo_unidad ?? 0),
    taller_id: taller_id !== undefined ? (taller_id ? Number(taller_id) : null) : (existing.taller_id ?? null),
    plan_cuenta_id: plan_cuenta_id !== undefined ? (plan_cuenta_id ? Number(plan_cuenta_id) : null) : (existing.plan_cuenta_id ?? null),
    depende_de_id: nextDep,
  });
}

export function deleteEtapa(id) {
  etapaConfigRepo.delete(id);
}

// --- PUNTOS DE VENTA Y SECUENCIAS FISCALES ---
export function listPuntosVenta() {
  return puntoVentaRepo.query().orderBy('numero', 'ASC').all();
}

export function createPuntoVenta(b) {
  const numero = Math.max(1, Math.min(9999, parseInt(b.numero, 10) || 0));
  if (!numero) throw new Error('El número de punto de venta debe estar entre 1 y 9999');
  const nombre = (b.nombre || `Punto de Venta ${String(numero).padStart(4, '0')}`).trim();
  const esDefault = b.es_default ? 1 : 0;
  const esElectronica = b.es_electronica ? 1 : 0;
  if (esDefault) puntoVentaRepo.query().update({ es_default: 0 });
  return puntoVentaRepo.create({
    numero,
    nombre,
    es_default: esDefault,
    es_electronica: esElectronica,
    cai: String(b.cai || '').trim(),
    cai_vto: String(b.cai_vto || '').trim(),
    activo: 1,
  });
}

export function updatePuntoVenta(id, b) {
  const ex = puntoVentaRepo.findById(id);
  if (!ex) return false;
  const numero = b.numero !== undefined ? Math.max(1, Math.min(9999, parseInt(b.numero, 10) || ex.numero)) : ex.numero;
  const nombre = b.nombre !== undefined ? b.nombre.trim() : ex.nombre;
  const esDefault = b.es_default !== undefined ? (b.es_default ? 1 : 0) : ex.es_default;
  const esElectronica = b.es_electronica !== undefined ? (b.es_electronica ? 1 : 0) : (ex.es_electronica ? 1 : 0);
  const cai = b.cai !== undefined ? String(b.cai || '').trim() : (ex.cai || '');
  const caiVto = b.cai_vto !== undefined ? String(b.cai_vto || '').trim() : (ex.cai_vto || '');
  const activo = b.activo !== undefined ? (b.activo ? 1 : 0) : ex.activo;
  if (esDefault) puntoVentaRepo.query().update({ es_default: 0 });
  puntoVentaRepo.update(id, {
    numero,
    nombre,
    es_default: esDefault,
    es_electronica: esElectronica,
    cai,
    cai_vto: caiVto,
    activo,
  });
  return true;
}

export function deletePuntoVenta(id) {
  const total = puntoVentaRepo.query().count();
  if (total <= 1) throw new Error('Debe existir al menos un punto de venta.');
  const ex = puntoVentaRepo.findById(id);
  puntoVentaRepo.delete(id);
  if (ex?.es_default) {
    const first = puntoVentaRepo.query().select('id').orderBy('numero', 'ASC').limit(1).get();
    if (first) puntoVentaRepo.update(first.id, { es_default: 1 });
  }
}

export function listSecuencias({ dominio } = {}) {
  if (dominio) {
    return secuenciaRepo.findAll({ where: 'dominio = ?', params: [dominio] });
  }
  return secuenciaRepo.findAll();
}

export function createSecuencia(b) {
  const valid = secuenciaRepo.validate({
    codigo: b.codigo,
    nombre: b.nombre,
    dominio: b.dominio || 'general',
    prefijo: b.prefijo ?? '',
    sufijo: b.sufijo ?? '',
    padding: b.padding ?? 8,
    siguiente_numero: b.siguiente_numero ?? 1,
    usa_punto_venta: b.usa_punto_venta ?? true,
    activo: b.activo ?? true,
  });
  return secuenciaRepo.create(valid);
}

export function updateSecuencia(id, b) {
  const valid = secuenciaRepo.validate(b, { partial: true });
  return secuenciaRepo.update(id, valid);
}

export function deleteSecuencia(id) {
  return secuenciaRepo.delete(id);
}

export function getNextNumeroDocumento(tipo, puntoVentaNum, { advance = false } = {}) {
  const seq = secuenciaRepo.query().where('codigo', tipo).where('activo', 1).get();
  const emp = getEmpresaConfig();
  const tableMap = {
    compra: 'compras',
    nc_compra: 'compras',
    nd_compra: 'compras',
    remito: 'operaciones_stock',
    pago: 'pagos',
    venta: 'ventas',
    venta_b: 'ventas',
    venta_c: 'ventas',
    venta_x: 'ventas',
    nc_venta: 'ventas',
    nc_venta_b: 'ventas',
    nc_venta_c: 'ventas',
    nc_venta_x: 'ventas',
    nd_venta: 'ventas',
    nd_venta_b: 'ventas',
    nd_venta_c: 'ventas',
    nd_venta_x: 'ventas',
    cobro: 'cobros',
    orden: 'ordenes_produccion',
    operacion_stock: 'operaciones_stock',
    asiento: 'asientos',
  };

  const prefijo = seq
    ? String(seq.prefijo || '')
    : (String(emp[`prefijo_${tipo}`] || 'DOC').replace(/-+$/, '').trim() || 'DOC');
  const sufijo = seq ? String(seq.sufijo || '') : '';
  const padding = Math.max(1, Number(seq?.padding || 8));
  const usaPv = seq ? Boolean(seq.usa_punto_venta) : true;
  const minNext = Math.max(1, Number(seq?.siguiente_numero ?? emp[`prox_num_${tipo}`] ?? 1));

  let pvNum = parseInt(puntoVentaNum, 10);
  if (usaPv && !pvNum) {
    const def = puntoVentaRepo.query().select('numero').where('activo', 1).orderBy('es_default', 'DESC').orderBy('numero', 'ASC').limit(1).get();
    pvNum = def?.numero || 1;
  }

  let max = 0;
  const targetTable = tableMap[tipo];
  if (targetTable) {
    const col = tipo === 'orden' ? 'codigo' : 'numero';
    const pvPad = usaPv ? String(pvNum).padStart(4, '0') : '';
    const targetRepo = new BaseRepository({ table: targetTable });
    const qb = targetRepo.query().select(`${col} as num`);
    if (usaPv) qb.where(col, 'LIKE', `%${pvPad}-%`);
    const rows = qb.all();
    const escRx = prefijo.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escSuf = sufijo.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = usaPv
      ? new RegExp(`^${escRx}\\s*${pvPad}-(\\d+)${escSuf}$`, 'i')
      : new RegExp(`^${escRx}(\\d+)${escSuf}$`, 'i');
    for (const r of rows) {
      const m = String(r.num || '').trim().match(rx);
      if (m) {
        const n = parseInt(m[1], 10) || 0;
        if (n > max) max = n;
      }
    }
  }

  const nextNumber = Math.max(max + 1, minNext);
  if (advance && seq) {
    secuenciaRepo.update(seq.id, { siguiente_numero: nextNumber + 1 });
  }
  const compPad = String(nextNumber).padStart(padding, '0');
  const pvPart = usaPv ? ` ${String(pvNum).padStart(4, '0')}-` : '';
  return {
    numero: `${prefijo.trim()}${pvPart}${compPad}${sufijo}`,
    punto_venta: usaPv ? pvNum : null,
    prefijo,
    sufijo,
    padding,
    dominio: seq?.dominio || 'general',
    siguiente: nextNumber,
  };
}

export function resolveNumeroDocumento(tipo, rawNumero, puntoVentaNum = null, { advance = true } = {}) {
  const raw = String(rawNumero || '').trim();
  if (!raw || raw.endsWith('-')) {
    return getNextNumeroDocumento(tipo, puntoVentaNum, { advance }).numero;
  }
  if (advance) {
    const seq = secuenciaRepo.query().where('codigo', tipo).where('activo', 1).get();
    if (seq) {
      const m = raw.match(/(\d+)$/);
      const n = m ? parseInt(m[1], 10) : 0;
      if (n >= Number(seq.siguiente_numero || 1)) {
        secuenciaRepo.update(seq.id, { siguiente_numero: n + 1 });
      }
    }
  }
  return raw;
}

export function listImpuestos({ aplica_a, tipo, solo_activos } = {}) {
  const qb = impuestoConfigRepo.query();
  if (solo_activos) qb.where('activo', 1);
  if (tipo) qb.where('tipo', tipo);
  if (aplica_a && aplica_a !== 'ambos') qb.whereIn('aplica_a', ['ambos', aplica_a]);
  return qb.orderBy('tipo', 'ASC').orderBy('alicuota_defecto', 'DESC').orderBy('nombre', 'ASC').all();
}

export function createImpuesto(b) {
  const nombre = (b.nombre || '').trim();
  if (!nombre) throw new Error('El nombre del impuesto es obligatorio');
  const tipo = ['iva', 'percepcion', 'retencion', 'otro'].includes(b.tipo) ? b.tipo : 'percepcion';
  const aplicaA = ['compras', 'ventas', 'ambos'].includes(b.aplica_a) ? b.aplica_a : 'ambos';
  const baseCalc = ['neto', 'total', 'manual', 'fijo'].includes(b.base_calculo) ? b.base_calculo : 'neto';
  return impuestoConfigRepo.create({
    nombre,
    codigo: (b.codigo || '').trim().toUpperCase(),
    tipo,
    aplica_a: aplicaA,
    alicuota_defecto: Math.max(0, Number(b.alicuota_defecto) || 0),
    base_calculo: baseCalc,
    jurisdiccion_codigo: (b.jurisdiccion_codigo || '').trim(),
    codigo_regimen: (b.codigo_regimen || '').trim(),
    minimo_no_imponible: Math.max(0, Number(b.minimo_no_imponible) || 0),
    cuenta_contable_id: b.cuenta_contable_id ? Number(b.cuenta_contable_id) : null,
    activo: 1,
  });
}

export function updateImpuesto(id, b) {
  const ex = impuestoConfigRepo.findById(id);
  if (!ex) return false;
  impuestoConfigRepo.update(id, {
    nombre: b.nombre !== undefined ? (b.nombre.trim() || ex.nombre) : ex.nombre,
    codigo: b.codigo !== undefined ? b.codigo.trim().toUpperCase() : ex.codigo,
    tipo: ['iva', 'percepcion', 'retencion', 'otro'].includes(b.tipo) ? b.tipo : ex.tipo,
    aplica_a: ['compras', 'ventas', 'ambos'].includes(b.aplica_a) ? b.aplica_a : ex.aplica_a,
    alicuota_defecto: b.alicuota_defecto !== undefined ? Math.max(0, Number(b.alicuota_defecto) || 0) : ex.alicuota_defecto,
    base_calculo: ['neto', 'total', 'manual', 'fijo'].includes(b.base_calculo) ? b.base_calculo : ex.base_calculo,
    jurisdiccion_codigo: b.jurisdiccion_codigo !== undefined ? (b.jurisdiccion_codigo || '').trim() : (ex.jurisdiccion_codigo || ''),
    codigo_regimen: b.codigo_regimen !== undefined ? (b.codigo_regimen || '').trim() : (ex.codigo_regimen || ''),
    minimo_no_imponible: b.minimo_no_imponible !== undefined ? Math.max(0, Number(b.minimo_no_imponible) || 0) : (ex.minimo_no_imponible || 0),
    cuenta_contable_id: b.cuenta_contable_id !== undefined ? (b.cuenta_contable_id ? Number(b.cuenta_contable_id) : null) : ex.cuenta_contable_id,
    activo: b.activo !== undefined ? (b.activo ? 1 : 0) : ex.activo,
  });
  return true;
}

export function deleteImpuesto(id) {
  impuestoConfigRepo.delete(id);
}
