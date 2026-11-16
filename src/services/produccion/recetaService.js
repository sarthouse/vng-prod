import { db } from '../../db.js';
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
  const targets = variantesArr.map(v => String(v).trim().toLowerCase()).filter(Boolean);
  if (targets.length === 0) return qty;

  const matched = targets.some(t => comboVals.includes(t) || String(productoRow.id) === t);
  return matched ? qty : 0;
}

export function listRecetas() {
  const recetas = db.prepare(`
    SELECT r.*, pt.nombre as plantilla_nombre,
      pv.nombre as producto_nombre, pv.combinacion_json as producto_combinacion,
      (SELECT COUNT(*) FROM receta_lineas rl WHERE rl.receta_id = r.id) as lineas_count,
      COALESCE((SELECT SUM(COALESCE(re.costo_unidad, 0)) FROM receta_etapas re WHERE re.receta_id = r.id), 0) as costo_procesos
    FROM recetas r
    JOIN producto_plantillas pt ON pt.id = r.plantilla_id
    LEFT JOIN productos pv ON pv.id = r.producto_id
    ORDER BY pt.nombre ASC, r.producto_id IS NOT NULL ASC, r.activa DESC, r.id DESC
  `).all();

  const matRows = db.prepare(`
    SELECT rl.receta_id, rl.coeficiente, rl.udm_receta,
           COALESCE(NULLIF(p.costo, 0), p.precio, 0) as precio,
           pt.udm
    FROM receta_lineas rl
    JOIN productos p ON p.id = rl.producto_id
    JOIN v_plantillas pt ON pt.id = p.plantilla_id
  `).all();
  const matByReceta = new Map();
  for (const row of matRows) {
    const coef = convertUnitFromDb(row.coeficiente, row.udm_receta || row.udm, row.udm);
    const prev = matByReceta.get(row.receta_id) || 0;
    matByReceta.set(row.receta_id, prev + coef * (Number(row.precio) || 0));
  }

  return recetas.map(r => {
    const costoMateriales = Number((matByReceta.get(r.id) || 0).toFixed(2));
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
  const receta = db.prepare(`
    SELECT r.*, pt.nombre as plantilla_nombre,
      pv.nombre as producto_nombre, pv.combinacion_json as producto_combinacion
    FROM recetas r
    JOIN producto_plantillas pt ON pt.id = r.plantilla_id
    LEFT JOIN productos pv ON pv.id = r.producto_id
    WHERE r.id = ?
  `).get(id);
  if (!receta) return null;

  let etapas = db.prepare('SELECT * FROM receta_etapas WHERE receta_id = ? ORDER BY orden ASC, id ASC').all(id);
  if (etapas.length === 0) {
    cloneDefaultEtapasToReceta(id);
    etapas = db.prepare('SELECT * FROM receta_etapas WHERE receta_id = ? ORDER BY orden ASC, id ASC').all(id);
  }

  const rawLineas = db.prepare(`
    SELECT rl.*, p.nombre as producto_nombre, p.sku as producto_sku,
           COALESCE(NULLIF(p.costo, 0), p.precio, 0) as precio,
           p.minimo_compra,
           pt.categoria, pt.udm,
           COALESCE(c.nombre, '') as proveedor_nombre,
           COALESCE(re.nombre, ec.nombre, '') as etapa_nombre
    FROM receta_lineas rl
    JOIN productos p ON p.id = rl.producto_id
    JOIN v_plantillas pt ON pt.id = p.plantilla_id
    LEFT JOIN contactos c ON c.id = pt.proveedor_id
    LEFT JOIN receta_etapas re ON re.id = rl.receta_etapa_id
    LEFT JOIN etapas_config ec ON ec.id = rl.etapa_id
    WHERE rl.receta_id = ?
    ORDER BY COALESCE(re.orden, ec.orden, 999) ASC, pt.categoria ASC, p.nombre ASC, rl.id ASC
  `).all(id);

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

  const costoMateriales = Number(lineas.reduce((s, l) => s + (Number(l.costo_par) || 0), 0).toFixed(2));
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

export function createReceta({ plantilla_id, producto_id, nombre, referencia, activa, notas }) {
  const pltId = Number(plantilla_id);
  const prodId = producto_id ? Number(producto_id) : null;
  const isActiva = activa ? 1 : 0;
  return recetaRepo.transaction(() => {
    if (isActiva) {
      if (prodId) {
        db.prepare('UPDATE recetas SET activa = 0 WHERE plantilla_id = ? AND producto_id = ?').run(pltId, prodId);
      } else {
        db.prepare('UPDATE recetas SET activa = 0 WHERE plantilla_id = ? AND producto_id IS NULL').run(pltId);
      }
    }
    const recId = recetaRepo.create({
      plantilla_id: pltId,
      producto_id: prodId,
      nombre: (nombre || '').trim(),
      referencia: (referencia || '').trim(),
      activa: isActiva,
      notas: (notas || '').trim(),
    });
    cloneDefaultEtapasToReceta(recId);
    return recId;
  });
}

export function updateReceta(id, { plantilla_id, producto_id, nombre, referencia, activa, notas }) {
  const existing = recetaRepo.findById(id);
  if (!existing) return false;
  const pltId = plantilla_id !== undefined ? Number(plantilla_id) : existing.plantilla_id;
  const prodId = producto_id !== undefined ? (producto_id ? Number(producto_id) : null) : existing.producto_id;
  const isActiva = activa !== undefined ? (activa ? 1 : 0) : existing.activa;
  return recetaRepo.transaction(() => {
    if (isActiva) {
      if (prodId) {
        db.prepare('UPDATE recetas SET activa = 0 WHERE plantilla_id = ? AND producto_id = ? AND id != ?').run(pltId, prodId, id);
      } else {
        db.prepare('UPDATE recetas SET activa = 0 WHERE plantilla_id = ? AND producto_id IS NULL AND id != ?').run(pltId, id);
      }
    }
    db.prepare('UPDATE recetas SET plantilla_id=?, producto_id=?, nombre=?, referencia=?, activa=?, notas=? WHERE id=?').run(
      pltId,
      prodId,
      nombre !== undefined ? nombre.trim() : existing.nombre,
      referencia !== undefined ? referencia.trim() : existing.referencia,
      isActiva,
      notas !== undefined ? notas.trim() : existing.notas,
      id
    );
    return true;
  });
}

export function deleteReceta(id) {
  return recetaRepo.delete(id);
}

export function addRecetaEtapa(recetaId, { nombre, descripcion = '', orden, dias_estimados, costo_unidad, taller_id, plan_cuenta_id, depende_de_id }) {
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
  });
}

export function updateRecetaEtapa(id, { nombre, descripcion, orden, dias_estimados, costo_unidad, taller_id, plan_cuenta_id, depende_de_id }) {
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
  });
}

export function deleteRecetaEtapa(id) {
  db.prepare('DELETE FROM receta_etapas WHERE id = ?').run(id);
}

function syncRecetaLineaVariantes(recetaLineaId, vars = []) {
  db.prepare('DELETE FROM receta_linea_variantes WHERE receta_linea_id = ?').run(recetaLineaId);
  const insVar = db.prepare('INSERT OR IGNORE INTO variantes (atributo, valor) VALUES (?, ?)');
  const getVar = db.prepare('SELECT id FROM variantes WHERE atributo = ? AND valor = ?');
  const insJoin = db.prepare('INSERT OR IGNORE INTO receta_linea_variantes (receta_linea_id, variante_id) VALUES (?, ?)');
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
    insVar.run(attr, val);
    const row = getVar.get(attr, val);
    if (row) insJoin.run(recetaLineaId, row.id);
  }
}

export function addRecetaLinea(recetaId, { producto_id, receta_etapa_id, etapa_id, coeficiente, udm_receta, variantes, emparejar_variante }) {
  const prod = db.prepare(`
    SELECT p.id, pt.udm
    FROM productos p
    JOIN v_plantillas pt ON pt.id = p.plantilla_id
    WHERE p.id = ?
  `).get(Number(producto_id));
  if (!prod) throw new Error('Producto no encontrado');
  const vars = Array.isArray(variantes) ? variantes : [];
  const emparejar = Number(emparejar_variante) ? 1 : 0;
  const info = db.prepare(`
    INSERT INTO receta_lineas (receta_id, producto_id, receta_etapa_id, etapa_id, coeficiente, udm_receta, variantes_json, emparejar_variante)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    recetaId,
    Number(producto_id),
    receta_etapa_id ? Number(receta_etapa_id) : null,
    etapa_id ? Number(etapa_id) : null,
    Number(coeficiente) || 0,
    (udm_receta || prod.udm).trim(),
    JSON.stringify(vars),
    emparejar
  );
  const newLineId = Number(info.lastInsertRowid);
  syncRecetaLineaVariantes(newLineId, vars);
  return newLineId;
}

export function updateRecetaLinea(lineId, { producto_id, receta_etapa_id, etapa_id, coeficiente, udm_receta, variantes, emparejar_variante }) {
  const existing = db.prepare('SELECT * FROM receta_lineas WHERE id = ?').get(lineId);
  if (!existing) return false;
  const vars = Array.isArray(variantes) ? variantes : JSON.parse(existing.variantes_json || '[]');
  const emparejar = emparejar_variante !== undefined ? (Number(emparejar_variante) ? 1 : 0) : (existing.emparejar_variante || 0);
  db.prepare(`
    UPDATE receta_lineas SET producto_id=?, receta_etapa_id=?, etapa_id=?, coeficiente=?, udm_receta=?, variantes_json=?, emparejar_variante=?
    WHERE id=?
  `).run(
    producto_id !== undefined ? Number(producto_id) : existing.producto_id,
    receta_etapa_id !== undefined ? (receta_etapa_id ? Number(receta_etapa_id) : null) : existing.receta_etapa_id,
    etapa_id !== undefined ? (etapa_id ? Number(etapa_id) : null) : existing.etapa_id,
    coeficiente !== undefined ? Number(coeficiente) : existing.coeficiente,
    udm_receta ?? existing.udm_receta,
    JSON.stringify(vars),
    emparejar,
    lineId
  );
  syncRecetaLineaVariantes(lineId, vars);
  return true;
}

export function deleteRecetaLinea(lineId) {
  db.prepare('DELETE FROM receta_lineas WHERE id = ?').run(lineId);
}

export function getActiveRecetaForPlantilla(plantillaId, productoId = null) {
  if (productoId) {
    const specific =
      db.prepare('SELECT * FROM recetas WHERE plantilla_id = ? AND producto_id = ? AND activa = 1 ORDER BY id DESC LIMIT 1').get(plantillaId, productoId) ||
      db.prepare('SELECT * FROM recetas WHERE plantilla_id = ? AND producto_id = ? ORDER BY id DESC LIMIT 1').get(plantillaId, productoId);
    if (specific) return specific;
  }
  return (
    db.prepare('SELECT * FROM recetas WHERE plantilla_id = ? AND producto_id IS NULL AND activa = 1 ORDER BY id DESC LIMIT 1').get(plantillaId) ||
    db.prepare('SELECT * FROM recetas WHERE plantilla_id = ? AND producto_id IS NULL ORDER BY id DESC LIMIT 1').get(plantillaId)
  );
}

export function calcularCostoDesdeReceta(recetaId, { aplicar = false, user = null } = {}) {
  const receta = db.prepare('SELECT * FROM recetas WHERE id = ?').get(Number(recetaId));
  if (!receta) return null;

  const lineas = db.prepare(`
    SELECT rl.coeficiente, rl.udm_receta, rl.producto_id,
           COALESCE(p.costo, 0) as insumo_costo,
           COALESCE(um.nombre, 'unidades') as insumo_udm
    FROM receta_lineas rl
    LEFT JOIN productos p ON p.id = rl.producto_id
    LEFT JOIN producto_plantillas pt ON pt.id = p.plantilla_id
    LEFT JOIN unidades_medida um ON um.id = pt.unidad_id
    WHERE rl.receta_id = ?
  `).all(Number(recetaId));

  let costoInsumos = 0;
  for (const l of lineas) {
    const coef = Number(l.coeficiente) || 0;
    const udmReceta = l.udm_receta || l.insumo_udm || 'unidades';
    const qtyStock = convertUnitFromDb(coef, udmReceta, l.insumo_udm || udmReceta);
    costoInsumos += qtyStock * (Number(l.insumo_costo) || 0);
  }
  costoInsumos = Number(costoInsumos.toFixed(2));

  const etapasRow = db.prepare(`
    SELECT COALESCE(SUM(costo_unidad), 0) as total_etapas
    FROM receta_etapas
    WHERE receta_id = ?
  `).get(Number(recetaId));
  const costoEtapas = Number((Number(etapasRow?.total_etapas) || 0).toFixed(2));
  const costoTotal = Number((costoInsumos + costoEtapas).toFixed(2));

  let aplicados = 0;
  if (aplicar) {
    const targets = receta.producto_id
      ? [productoRepo.findById(Number(receta.producto_id))].filter(Boolean)
      : productoRepo.findWhere({ plantilla_id: Number(receta.plantilla_id) });
    for (const p of targets) {
      productoRepo.update(p.id, { costo: costoTotal });
      registrarHistorialCostoPrecio({
        producto_id: p.id,
        plantilla_id: p.plantilla_id,
        costo_anterior: p.costo ?? 0,
        costo_nuevo: costoTotal,
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
