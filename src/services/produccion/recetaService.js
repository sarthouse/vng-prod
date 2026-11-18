import { BaseRepository } from '../../core/BaseRepository.js';
import { MODELS } from '../../db/models.js';
import { convertUnitFromDb } from '../config/configService.js';
import { productoRepo, registrarHistorialCostoPrecio } from '../inventario/productoService.js';

class RecetaRepository extends BaseRepository {
  constructor() {
    super({ model: MODELS.recetas });
  }
}

export const recetaRepo = new RecetaRepository();
export const etapaConfigRepo = new BaseRepository({ model: MODELS.etapas_config });
export const recetaEtapaRepo = new BaseRepository({ model: MODELS.receta_etapas });
export const recetaLineaRepo = new BaseRepository({ model: MODELS.receta_lineas });
const recetaLineaVarianteRepo = new BaseRepository({ model: MODELS.receta_linea_variantes });
const varianteRepo = new BaseRepository({ model: MODELS.variantes });

export function applicableQtyForLine(productoRow, cantidad, variantesArr) {
  const qty = Number(cantidad) || 0;
  if (qty <= 0) return 0;
  if (!variantesArr || variantesArr.length === 0) return qty;

  let combo = {};
  try {
    combo = typeof productoRow.combinacion_json === 'string'
      ? JSON.parse(productoRow.combinacion_json || '{}')
      : (productoRow.combinacion || {});
  } catch {
    combo = {};
  }

  const comboVals = Object.values(combo).map(v => String(v).trim().toLowerCase());
  const targets = variantesArr
    .map(v => {
      if (v && typeof v === 'object') return String(v.valor ?? v.value ?? '').trim().toLowerCase();
      const s = String(v).trim().toLowerCase();
      return s.includes(':') ? s.split(':').slice(1).join(':').trim() : s;
    })
    .filter(Boolean);
  if (targets.length === 0) return qty;

  const matched = targets.some(t => comboVals.includes(t) || String(productoRow.id) === t);
  return matched ? qty : 0;
}

function computeRecetaMaterialesCost(receta, lineas, targetsByPlantilla = null) {
  const baseComun = lineas
    .filter(l => !l.variantes || l.variantes.length === 0)
    .reduce((s, l) => s + (Number(l.costo_par) || 0), 0);

  const hasVariantLines = lineas.some(l => l.variantes && l.variantes.length > 0);
  if (!hasVariantLines) return Number(baseComun.toFixed(2));

  let targets = [];
  if (receta.producto_id) {
    const p = productoRepo.findById(Number(receta.producto_id));
    if (p) targets = [p];
  } else if (targetsByPlantilla && targetsByPlantilla.has(Number(receta.plantilla_id))) {
    targets = targetsByPlantilla.get(Number(receta.plantilla_id));
  } else {
    targets = productoRepo.findWhere({ plantilla_id: Number(receta.plantilla_id) });
  }

  if (!targets.length) return Number(baseComun.toFixed(2));

  const variantCosts = [];
  for (const p of targets) {
    let specificSum = 0;
    let matchedAny = false;
    for (const l of lineas) {
      if (!l.variantes || l.variantes.length === 0) continue;
      if (applicableQtyForLine(p, 1, l.variantes) > 0) {
        specificSum += Number(l.costo_par) || 0;
        matchedAny = true;
      }
    }
    if (matchedAny) variantCosts.push(baseComun + specificSum);
  }

  if (!variantCosts.length) return Number(baseComun.toFixed(2));
  const avg = variantCosts.reduce((a, b) => a + b, 0) / variantCosts.length;
  return Number(avg.toFixed(2));
}

export function listRecetas() {
  const recetas = recetaRepo.query('r')
    .select(
      'r.*',
      'pt.nombre as plantilla_nombre',
      'pv.nombre as producto_nombre',
      'pv.combinacion_json as producto_combinacion',
      '(SELECT COUNT(*) FROM receta_lineas rl WHERE rl.receta_id = r.id) as lineas_count',
      'COALESCE((SELECT SUM(COALESCE(re.costo_unidad, 0)) FROM receta_etapas re WHERE re.receta_id = r.id), 0) as costo_procesos'
    )
    .innerJoin('producto_plantillas', 'pt', 'pt.id', 'r.plantilla_id')
    .leftJoin('productos', 'pv', 'pv.id', 'r.producto_id')
    .orderBy('pt.nombre', 'ASC')
    .orderBy('r.activa', 'DESC')
    .orderBy('r.id', 'DESC')
    .all()
    .sort((a, b) => (a.plantilla_nombre || '').localeCompare(b.plantilla_nombre || '') || (Number(Boolean(a.producto_id)) - Number(Boolean(b.producto_id))));

  const matRows = recetaLineaRepo.query('rl')
    .select(
      'rl.receta_id',
      'rl.coeficiente',
      'rl.udm_receta',
      'rl.variantes_json',
      'COALESCE(NULLIF(p.costo, 0), p.precio, 0) as precio',
      'pt.udm'
    )
    .innerJoin('productos', 'p', 'p.id', 'rl.producto_id')
    .innerJoin('v_plantillas', 'pt', 'pt.id', 'p.plantilla_id')
    .all();
  const lineasByReceta = new Map();
  for (const row of matRows) {
    const coef = convertUnitFromDb(row.coeficiente, row.udm_receta || row.udm, row.udm);
    let variantes = [];
    try { variantes = JSON.parse(row.variantes_json || '[]'); } catch { variantes = []; }
    const arr = lineasByReceta.get(row.receta_id) || [];
    arr.push({
      costo_par: coef * (Number(row.precio) || 0),
      variantes: Array.isArray(variantes) ? variantes : [],
    });
    lineasByReceta.set(row.receta_id, arr);
  }

  const targetsByPlantilla = new Map();
  for (const p of productoRepo.query().all()) {
    const pid = Number(p.plantilla_id);
    if (!targetsByPlantilla.has(pid)) targetsByPlantilla.set(pid, []);
    targetsByPlantilla.get(pid).push(p);
  }

  return recetas.map(r => {
    const costoMateriales = computeRecetaMaterialesCost(r, lineasByReceta.get(r.id) || [], targetsByPlantilla);
    const costoProcesos = Number((Number(r.costo_procesos) || 0).toFixed(2));
    return {
      ...r,
      costo_materiales: costoMateriales,
      costo_procesos: costoProcesos,
      costo_total_unidad: Number((costoMateriales + costoProcesos).toFixed(2)),
    };
  });
}

function cloneDefaultEtapasToReceta(recetaId) {
  const defaults = etapaConfigRepo.findWhere({}, { orderBy: 'orden ASC, id ASC' });
  const idMap = new Map();
  for (const d of defaults) {
    const newId = recetaEtapaRepo.create({
      receta_id: recetaId,
      nombre: d.nombre,
      descripcion: d.descripcion || '',
      orden: d.orden,
      dias_estimados: d.dias_estimados,
      costo_unidad: Number(d.costo_unidad) || 0,
      taller_id: d.taller_id || null,
      plan_cuenta_id: d.plan_cuenta_id || null,
    });
    idMap.set(d.id, newId);
  }
  for (const d of defaults) {
    if (d.depende_de_id && idMap.has(d.depende_de_id)) {
      recetaEtapaRepo.update(idMap.get(d.id), { depende_de_id: idMap.get(d.depende_de_id) });
    }
  }
}

export function getRecetaById(id) {
  const receta = recetaRepo.query('r')
    .select(
      'r.*',
      'pt.nombre as plantilla_nombre',
      'pt.codigo as plantilla_codigo',
      "COALESCE(pt.imagen_data, '') as plantilla_imagen",
      'pv.nombre as producto_nombre',
      'pv.combinacion_json as producto_combinacion'
    )
    .innerJoin('producto_plantillas', 'pt', 'pt.id', 'r.plantilla_id')
    .leftJoin('productos', 'pv', 'pv.id', 'r.producto_id')
    .where('r.id', Number(id))
    .get();
  if (!receta) return null;

  const fetchEtapas = () => recetaEtapaRepo.query('re')
    .select('re.*', "COALESCE(c.nombre, '') as taller_nombre")
    .leftJoin('contactos', 'c', 'c.id', 're.taller_id')
    .where('re.receta_id', Number(id))
    .orderBy('re.orden', 'ASC')
    .orderBy('re.id', 'ASC')
    .all();

  let etapas = fetchEtapas();
  if (etapas.length === 0) {
    cloneDefaultEtapasToReceta(id);
    etapas = fetchEtapas();
  }

  const rawLineas = recetaLineaRepo.query('rl')
    .select(
      'rl.*',
      'p.nombre as producto_nombre',
      'p.sku as producto_sku',
      'COALESCE(NULLIF(p.costo, 0), p.precio, 0) as precio',
      'p.minimo_compra',
      'pt.categoria',
      'pt.udm',
      "COALESCE(c.nombre, '') as proveedor_nombre",
      "COALESCE(re.nombre, ec.nombre, '') as etapa_nombre",
      'COALESCE(re.orden, ec.orden, 999) as etapa_orden'
    )
    .innerJoin('productos', 'p', 'p.id', 'rl.producto_id')
    .innerJoin('v_plantillas', 'pt', 'pt.id', 'p.plantilla_id')
    .leftJoin('contactos', 'c', 'c.id', 'pt.proveedor_id')
    .leftJoin('receta_etapas', 're', 're.id', 'rl.receta_etapa_id')
    .leftJoin('etapas_config', 'ec', 'ec.id', 'rl.etapa_id')
    .where('rl.receta_id', Number(id))
    .orderBy('pt.categoria', 'ASC')
    .orderBy('p.nombre', 'ASC')
    .orderBy('rl.id', 'ASC')
    .all()
    .sort((a, b) => (a.etapa_orden - b.etapa_orden) || String(a.categoria || '').localeCompare(String(b.categoria || '')) || String(a.producto_nombre || '').localeCompare(String(b.producto_nombre || '')) || (a.id - b.id));

  const lineas = rawLineas.map(l => {
    const udmReceta = l.udm_receta || l.udm;
    const coefConvertido = convertUnitFromDb(l.coeficiente, udmReceta, l.udm);
    let variantes = [];
    try { variantes = JSON.parse(l.variantes_json || '[]'); } catch { variantes = []; }
    return {
      ...l,
      udm_receta: udmReceta,
      coef_convertido: Number(coefConvertido.toFixed(6)),
      costo_par: Number((coefConvertido * l.precio).toFixed(2)),
      variantes,
    };
  });

  const costoMateriales = computeRecetaMaterialesCost(receta, lineas);
  const costoProcesos = Number(etapas.reduce((s, e) => s + (Number(e.costo_unidad) || 0), 0).toFixed(2));
  const costoTotalUnidad = Number((costoMateriales + costoProcesos).toFixed(2));

  return {
    receta: {
      ...receta,
      costo_materiales: costoMateriales,
      costo_procesos: costoProcesos,
      costo_total_unidad: costoTotalUnidad,
    },
    etapas,
    lineas,
  };
}

export function createReceta({ plantilla_id, producto_id, nombre, referencia, activa, notas, ficha_tecnica_html }) {
  const pltId = Number(plantilla_id);
  const prodId = producto_id ? Number(producto_id) : null;
  const isActiva = activa ? 1 : 0;
  return recetaRepo.transaction(() => {
    if (isActiva) {
      const qb = recetaRepo.query().where('plantilla_id', pltId);
      if (prodId) qb.where('producto_id', prodId);
      else qb.whereNull('producto_id');
      qb.update({ activa: 0 });
    }
    const recId = recetaRepo.create({
      plantilla_id: pltId,
      producto_id: prodId,
      nombre: (nombre || '').trim(),
      referencia: (referencia || '').trim(),
      activa: isActiva,
      notas: (notas || '').trim(),
      ficha_tecnica_html: String(ficha_tecnica_html || ''),
    });
    cloneDefaultEtapasToReceta(recId);
    return recId;
  });
}

export function updateReceta(id, { plantilla_id, producto_id, nombre, referencia, activa, notas, ficha_tecnica_html }) {
  const existing = recetaRepo.findById(id);
  if (!existing) return false;
  const pltId = plantilla_id !== undefined ? Number(plantilla_id) : existing.plantilla_id;
  const prodId = producto_id !== undefined ? (producto_id ? Number(producto_id) : null) : existing.producto_id;
  const isActiva = activa !== undefined ? (activa ? 1 : 0) : existing.activa;
  return recetaRepo.transaction(() => {
    if (isActiva) {
      const qb = recetaRepo.query().where('plantilla_id', pltId).where('id', '!=', Number(id));
      if (prodId) qb.where('producto_id', prodId);
      else qb.whereNull('producto_id');
      qb.update({ activa: 0 });
    }
    recetaRepo.update(id, {
      plantilla_id: pltId,
      producto_id: prodId,
      nombre: nombre !== undefined ? nombre.trim() : existing.nombre,
      referencia: referencia !== undefined ? referencia.trim() : existing.referencia,
      activa: isActiva,
      notas: notas !== undefined ? notas.trim() : existing.notas,
      ficha_tecnica_html: ficha_tecnica_html !== undefined ? String(ficha_tecnica_html || '') : (existing.ficha_tecnica_html || ''),
    });
    return true;
  });
}

export function deleteReceta(id) {
  return recetaRepo.delete(id);
}

export function addRecetaEtapa(recetaId, { nombre, descripcion = '', orden, dias_estimados, costo_unidad, taller_id, plan_cuenta_id, depende_de_id, imagen_data = '' }) {
  return recetaEtapaRepo.create({
    receta_id: recetaId,
    nombre: nombre.trim(),
    descripcion: String(descripcion || '').trim(),
    orden: Number(orden) || 1,
    dias_estimados: Math.max(0, Number(dias_estimados) || 0),
    costo_unidad: Math.max(0, Number(costo_unidad) || 0),
    taller_id: taller_id ? Number(taller_id) : null,
    plan_cuenta_id: plan_cuenta_id ? Number(plan_cuenta_id) : null,
    depende_de_id: depende_de_id ? Number(depende_de_id) : null,
    imagen_data: String(imagen_data || ''),
  });
}

export function updateRecetaEtapa(id, { nombre, descripcion, orden, dias_estimados, costo_unidad, taller_id, plan_cuenta_id, depende_de_id, imagen_data }) {
  const existing = recetaEtapaRepo.findById(id);
  if (!existing) return false;
  const nextDep = depende_de_id !== undefined
    ? (depende_de_id && Number(depende_de_id) !== Number(id) ? Number(depende_de_id) : null)
    : existing.depende_de_id;
  return recetaEtapaRepo.update(id, {
    nombre: nombre !== undefined ? nombre.trim() : existing.nombre,
    descripcion: descripcion !== undefined ? String(descripcion || '').trim() : (existing.descripcion ?? ''),
    orden: orden !== undefined ? Number(orden) : existing.orden,
    dias_estimados: dias_estimados !== undefined ? Math.max(0, Number(dias_estimados)) : existing.dias_estimados,
    costo_unidad: costo_unidad !== undefined ? Math.max(0, Number(costo_unidad) || 0) : (existing.costo_unidad ?? 0),
    taller_id: taller_id !== undefined ? (taller_id ? Number(taller_id) : null) : (existing.taller_id ?? null),
    plan_cuenta_id: plan_cuenta_id !== undefined ? (plan_cuenta_id ? Number(plan_cuenta_id) : null) : (existing.plan_cuenta_id ?? null),
    depende_de_id: nextDep,
    imagen_data: imagen_data !== undefined ? String(imagen_data || '') : (existing.imagen_data || ''),
  });
}

export function deleteRecetaEtapa(id) {
  recetaEtapaRepo.delete(id);
}

function syncRecetaLineaVariantes(recetaLineaId, vars = []) {
  recetaLineaVarianteRepo.query().where('receta_linea_id', Number(recetaLineaId)).delete();
  for (const v of vars) {
    let attr = '';
    let val = '';
    if (typeof v === 'string' && v.includes(':')) {
      const idx = v.indexOf(':');
      attr = v.slice(0, idx).trim();
      val = v.slice(idx + 1).trim();
    } else if (v && typeof v === 'object' && v.atributo && v.valor) {
      attr = String(v.atributo).trim();
      val = String(v.valor).trim();
    }
    if (!attr || !val) continue;
    let row = varianteRepo.query().select('id').where('atributo', attr).where('valor', val).get();
    if (!row) {
      row = { id: varianteRepo.create({ atributo: attr, valor: val }) };
    }
    const existsJoin = recetaLineaVarianteRepo.query()
      .select('id')
      .where('receta_linea_id', Number(recetaLineaId))
      .where('variante_id', row.id)
      .get();
    if (!existsJoin) {
      recetaLineaVarianteRepo.create({ receta_linea_id: Number(recetaLineaId), variante_id: row.id });
    }
  }
}

export function addRecetaLinea(recetaId, { producto_id, receta_etapa_id, etapa_id, coeficiente, udm_receta, variantes, emparejar_variante }) {
  const prod = productoRepo.query('p')
    .select('p.id', 'pt.udm')
    .innerJoin('v_plantillas', 'pt', 'pt.id', 'p.plantilla_id')
    .where('p.id', Number(producto_id))
    .get();
  if (!prod) throw new Error('Producto no encontrado');
  const vars = Array.isArray(variantes) ? variantes : [];
  const emparejar = Number(emparejar_variante) ? 1 : 0;
  const newLineId = recetaLineaRepo.create({
    receta_id: recetaId,
    producto_id: Number(producto_id),
    receta_etapa_id: receta_etapa_id ? Number(receta_etapa_id) : null,
    etapa_id: etapa_id ? Number(etapa_id) : null,
    coeficiente: Number(coeficiente) || 0,
    udm_receta: (udm_receta || prod.udm).trim(),
    variantes_json: JSON.stringify(vars),
    emparejar_variante: emparejar,
  });
  syncRecetaLineaVariantes(newLineId, vars);
  return newLineId;
}

export function updateRecetaLinea(lineId, { producto_id, receta_etapa_id, etapa_id, coeficiente, udm_receta, variantes, emparejar_variante }) {
  const existing = recetaLineaRepo.findById(lineId);
  if (!existing) return false;
  const vars = Array.isArray(variantes) ? variantes : JSON.parse(existing.variantes_json || '[]');
  const emparejar = emparejar_variante !== undefined ? (Number(emparejar_variante) ? 1 : 0) : (existing.emparejar_variante || 0);
  recetaLineaRepo.update(lineId, {
    producto_id: producto_id !== undefined ? Number(producto_id) : existing.producto_id,
    receta_etapa_id: receta_etapa_id !== undefined ? (receta_etapa_id ? Number(receta_etapa_id) : null) : existing.receta_etapa_id,
    etapa_id: etapa_id !== undefined ? (etapa_id ? Number(etapa_id) : null) : existing.etapa_id,
    coeficiente: coeficiente !== undefined ? Number(coeficiente) : existing.coeficiente,
    udm_receta: udm_receta ?? existing.udm_receta,
    variantes_json: JSON.stringify(vars),
    emparejar_variante: emparejar,
  });
  syncRecetaLineaVariantes(lineId, vars);
  return true;
}

export function deleteRecetaLinea(lineId) {
  recetaLineaRepo.delete(lineId);
}

export function getActiveRecetaForPlantilla(plantillaId, productoId = null) {
  if (productoId) {
    const specific =
      recetaRepo.query().where('plantilla_id', Number(plantillaId)).where('producto_id', Number(productoId)).where('activa', 1).orderBy('id', 'DESC').limit(1).get() ||
      recetaRepo.query().where('plantilla_id', Number(plantillaId)).where('producto_id', Number(productoId)).orderBy('id', 'DESC').limit(1).get();
    if (specific) return specific;
  }
  return (
    recetaRepo.query().where('plantilla_id', Number(plantillaId)).whereNull('producto_id').where('activa', 1).orderBy('id', 'DESC').limit(1).get() ||
    recetaRepo.query().where('plantilla_id', Number(plantillaId)).whereNull('producto_id').orderBy('id', 'DESC').limit(1).get()
  );
}

export function calcularCostoDesdeReceta(recetaId, { aplicar = false, user = null } = {}) {
  const receta = recetaRepo.findById(Number(recetaId));
  if (!receta) return null;

  const lineas = recetaLineaRepo.query('rl')
    .select(
      'rl.coeficiente',
      'rl.udm_receta',
      'rl.producto_id',
      'rl.variantes_json',
      'rl.emparejar_variante',
      'p.plantilla_id as insumo_plantilla_id',
      'COALESCE(NULLIF(p.costo, 0), p.precio, 0) as insumo_costo',
      "COALESCE(um.nombre, 'unidades') as insumo_udm"
    )
    .leftJoin('productos', 'p', 'p.id', 'rl.producto_id')
    .leftJoin('producto_plantillas', 'pt', 'pt.id', 'p.plantilla_id')
    .leftJoin('unidades_medida', 'um', 'um.id', 'pt.unidad_id')
    .where('rl.receta_id', Number(recetaId))
    .all()
    .map(l => {
      let vars = [];
      try { vars = JSON.parse(l.variantes_json || '[]'); } catch { vars = []; }
      const coef = Number(l.coeficiente) || 0;
      const udmReceta = l.udm_receta || l.insumo_udm || 'unidades';
      const qtyStock = convertUnitFromDb(coef, udmReceta, l.insumo_udm || udmReceta);
      return { ...l, variantes: Array.isArray(vars) ? vars : [], qtyStock };
    });

  let costoInsumos = 0;
  for (const l of lineas) {
    if (l.variantes.length === 0) {
      costoInsumos += l.qtyStock * (Number(l.insumo_costo) || 0);
    }
  }
  costoInsumos = Number(costoInsumos.toFixed(2));

  const totalEtapas = recetaEtapaRepo.query()
    .where('receta_id', Number(recetaId))
    .sum('costo_unidad');
  const costoEtapas = Number((Number(totalEtapas) || 0).toFixed(2));
  const costoTotal = Number((costoInsumos + costoEtapas).toFixed(2));

  let aplicados = 0;
  if (aplicar) {
    const targets = receta.producto_id
      ? [productoRepo.findById(Number(receta.producto_id))].filter(Boolean)
      : productoRepo.findWhere({ plantilla_id: Number(receta.plantilla_id) });
    const insumoVarsCache = new Map();
    const getMatchedInsumoCosto = (l, targetProd) => {
      if (Number(l.emparejar_variante) !== 1 || !l.insumo_plantilla_id) return Number(l.insumo_costo) || 0;
      let targetCombo = {};
      try { targetCombo = JSON.parse(targetProd.combinacion_json || '{}'); } catch { targetCombo = {}; }
      const targetEntries = Object.entries(targetCombo);
      if (!targetEntries.length) return Number(l.insumo_costo) || 0;
      if (!insumoVarsCache.has(l.insumo_plantilla_id)) {
        insumoVarsCache.set(l.insumo_plantilla_id, productoRepo.findWhere({ plantilla_id: Number(l.insumo_plantilla_id) }));
      }
      const candidates = insumoVarsCache.get(l.insumo_plantilla_id) || [];
      let best = null;
      let bestScore = 0;
      for (const c of candidates) {
        let cCombo = {};
        try { cCombo = JSON.parse(c.combinacion_json || '{}'); } catch { cCombo = {}; }
        let score = 0;
        for (const [k, v] of targetEntries) {
          if (cCombo[k] !== undefined && String(cCombo[k]).trim().toLowerCase() === String(v).trim().toLowerCase()) score++;
        }
        if (score > bestScore) { bestScore = score; best = c; }
      }
      return best ? (Number(best.costo) || Number(best.precio) || 0) : (Number(l.insumo_costo) || 0);
    };
    for (const p of targets) {
      let costoInsumosVar = 0;
      for (const l of lineas) {
        const effQty = applicableQtyForLine(p, l.qtyStock, l.variantes);
        if (effQty > 0) costoInsumosVar += effQty * getMatchedInsumoCosto(l, p);
      }
      const costoTotalVar = Number((costoInsumosVar + costoEtapas).toFixed(2));
      productoRepo.update(p.id, { costo: costoTotalVar });
      registrarHistorialCostoPrecio({
        producto_id: p.id,
        plantilla_id: p.plantilla_id,
        costo_anterior: p.costo ?? 0,
        costo_nuevo: costoTotalVar,
        precio_anterior: p.precio ?? 0,
        precio_nuevo: p.precio ?? 0,
        origen: 'receta',
        referencia_tipo: 'receta',
        referencia_id: receta.id,
        observacion: receta.nombre || `Receta #${receta.id}`,
        user,
      });
      aplicados += 1;
    }
  }

  return {
    receta_id: Number(recetaId),
    plantilla_id: receta.plantilla_id,
    producto_id: receta.producto_id || null,
    costo_insumos: costoInsumos,
    costo_etapas: costoEtapas,
    costo_total: costoTotal,
    aplicados,
  };
}
