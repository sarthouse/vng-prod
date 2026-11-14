import { BaseRepository } from '../../core/BaseRepository.js';
import { MODELS } from '../../db/models.js';

const presupuestoRepo = new BaseRepository({ model: MODELS.presupuestos, defaultOrder: 'id DESC' });
const lineaRepo = new BaseRepository({ model: MODELS.presupuesto_lineas, defaultOrder: 'id ASC' });
const productoRepo = new BaseRepository({ model: MODELS.productos });

function parseJson(str, fallback) {
  try { return JSON.parse(str || ''); } catch { return fallback; }
}

export function getActiveDraftPresupuestoId() {
  const row = presupuestoRepo.query()
    .select('id')
    .where('estado', 'Borrador')
    .orderBy('id', 'DESC')
    .limit(1)
    .get();
  return row ? row.id : null;
}

export function getOrCreateDraftPresupuesto({ titulo, usuario_id } = {}) {
  const existingId = getActiveDraftPresupuestoId();
  if (existingId) return existingId;
  const fecha = new Date().toISOString().slice(0, 10);
  return presupuestoRepo.create({
    titulo: (titulo || 'Planificación en curso').trim(),
    fecha,
    estado: 'Borrador',
    usuario_id: usuario_id ? Number(usuario_id) : null,
    total_pares: 0,
    total_monto: 0,
    observaciones: '',
  });
}

export function listProductosFabricablesConCurva(presupuestoId = null) {
  const targetId = presupuestoId ? Number(presupuestoId) : getActiveDraftPresupuestoId();

  const rows = productoRepo.query('p')
    .select(
      'p.id as producto_id',
      'p.plantilla_id',
      'p.sku',
      'p.nombre as producto_nombre',
      'p.combinacion_json',
      'pt.nombre as plantilla_nombre',
      'pt.codigo as plantilla_codigo',
      'pt.udm'
    )
    .innerJoin('v_plantillas', 'pt', 'pt.id', 'p.plantilla_id')
    .where('p.activo', 1)
    .where('pt.se_fabrica', 1)
    .orderBy('pt.nombre', 'ASC')
    .orderBy('p.id', 'ASC')
    .all();

  const qtyByProd = new Map();
  if (targetId) {
    const lineas = lineaRepo.findWhere({ presupuesto_id: targetId });
    for (const l of lineas) {
      qtyByProd.set(Number(l.producto_id), Number(l.cantidad || 0));
    }
  }

  return rows.map(r => ({
    ...r,
    presupuesto_id: targetId,
    cantidad: qtyByProd.get(Number(r.producto_id)) || 0,
    combinacion: parseJson(r.combinacion_json, {}),
  }));
}

export function updateCurva(items, opts = {}) {
  const presupuestoId = opts?.presupuesto_id
    ? Number(opts.presupuesto_id)
    : getOrCreateDraftPresupuesto({ usuario_id: opts?.usuario_id });

  return presupuestoRepo.transaction(() => {
    for (const item of items || []) {
      const prodId = Number(item.producto_id);
      if (!prodId) continue;
      const qty = Math.max(0, Number(item.cantidad) || 0);

      const existing = lineaRepo.query()
        .where('presupuesto_id', presupuestoId)
        .where('producto_id', prodId)
        .get();

      if (qty <= 0) {
        if (existing) lineaRepo.delete(existing.id);
      } else if (existing) {
        lineaRepo.update(existing.id, { cantidad: qty });
      } else {
        lineaRepo.create({ presupuesto_id: presupuestoId, producto_id: prodId, cantidad: qty });
      }
    }

    const totalPares = lineaRepo.query()
      .where('presupuesto_id', presupuestoId)
      .sum('cantidad');

    presupuestoRepo.update(presupuestoId, { total_pares: Math.round(totalPares) });
    return presupuestoId;
  });
}

export function clearCurva(presupuestoId = null) {
  const targetId = presupuestoId ? Number(presupuestoId) : getActiveDraftPresupuestoId();
  if (!targetId) return;

  presupuestoRepo.transaction(() => {
    lineaRepo.query().where('presupuesto_id', targetId).delete();
    presupuestoRepo.update(targetId, { total_pares: 0, total_monto: 0, curva_json: '[]' });
  });
}

export function computeCurvaSummary(presupuestoId = null) {
  const targetId = presupuestoId ? Number(presupuestoId) : getActiveDraftPresupuestoId();
  const rows = listProductosFabricablesConCurva(targetId);

  const plantillasMap = new Map();
  let totalPares = 0;

  for (const r of rows) {
    totalPares += r.cantidad;

    if (!plantillasMap.has(r.plantilla_id)) {
      plantillasMap.set(r.plantilla_id, {
        id: r.plantilla_id,
        nombre: r.plantilla_nombre,
        codigo: r.plantilla_codigo,
        total: 0,
        variantes: [],
      });
    }
    const pGroup = plantillasMap.get(r.plantilla_id);
    pGroup.total += r.cantidad;
    pGroup.variantes.push({
      producto_id: r.producto_id,
      sku: r.sku,
      nombre: r.producto_nombre,
      combinacion: r.combinacion,
      cantidad: r.cantidad,
    });
  }

  return {
    presupuesto_id: targetId,
    plantillas: [...plantillasMap.values()],
    totalPares,
    totalEtiquetas: totalPares * 2,
  };
}
