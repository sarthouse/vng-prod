import { BaseRepository } from '../../core/BaseRepository.js';
import { MODELS } from '../../db/models.js';
import { convertUnitFromDb } from '../config/configService.js';
import { listProductos } from '../inventario/productoService.js';
import { computeCurvaSummary, getActiveDraftPresupuestoId, listProductosFabricablesConCurva } from './curvaService.js';
import { applicableQtyForLine, getActiveRecetaForPlantilla } from './recetaService.js';

export const presupuestoRepo = new BaseRepository({
  model: MODELS.presupuestos,
  defaultOrder: 'id DESC',
});
const presupuestoItemRepo = new BaseRepository({ model: MODELS.presupuesto_items });
const presupuestoLineaRepo = new BaseRepository({ model: MODELS.presupuesto_lineas });
const productoRepo = new BaseRepository({ model: MODELS.productos });
const recetaLineaRepo = new BaseRepository({ model: MODELS.receta_lineas });

export function resolveVariantForPlantilla(targetPlantillaId, sourceCombo = {}) {
  const candidates = productoRepo.findWhere({ plantilla_id: Number(targetPlantillaId), activo: 1 }, { orderBy: 'id ASC' });
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const sourceVals = Object.values(sourceCombo || {}).map(v => String(v).trim().toLowerCase()).filter(Boolean);
  if (sourceVals.length > 0) {
    const match = candidates.find(c => {
      try {
        const cc = JSON.parse(c.combinacion_json || '{}');
        const cVals = Object.values(cc).map(v => String(v).trim().toLowerCase());
        return sourceVals.some(sv => cVals.includes(sv));
      } catch {
        return false;
      }
    });
    if (match) return match;
  }
  return candidates[0];
}

export function computePresupuestoLive(presupuestoId = null) {
  const targetId = presupuestoId ? Number(presupuestoId) : getActiveDraftPresupuestoId();
  const curvaRows = listProductosFabricablesConCurva(targetId);
  const allProductos = listProductos();
  const totalPares = curvaRows.reduce((acc, r) => acc + r.cantidad, 0);

  const prodById = new Map(allProductos.map(p => [p.id, p]));
  const cantPorProd = new Map();

  for (const row of curvaRows) {
    if (row.cantidad <= 0) continue;

    const usedPlantillasOrProds = new Set();
    const receta = getActiveRecetaForPlantilla(row.plantilla_id, row.producto_id);
    if (receta) {
      const lineas = recetaLineaRepo.findWhere({ receta_id: receta.id });
      for (const line of lineas) {
        let prod = prodById.get(line.producto_id);
        if (!prod) continue;
        if (Number(line.emparejar_variante) === 1 && row.combinacion) {
          const matched = resolveVariantForPlantilla(prod.plantilla_id, row.combinacion);
          if (matched) prod = prodById.get(matched.id) || prod;
        }
        usedPlantillasOrProds.add(prod.id);
        usedPlantillasOrProds.add(`plt:${prod.plantilla_id}`);
        let vars = [];
        try { vars = JSON.parse(line.variantes_json || '[]'); } catch { vars = []; }
        const qty = applicableQtyForLine(row, row.cantidad, vars);
        if (qty <= 0) continue;
        const coefConv = convertUnitFromDb(line.coeficiente, line.udm_receta || prod.udm, prod.udm);
        cantPorProd.set(prod.id, (cantPorProd.get(prod.id) || 0) + coefConv * qty);
      }
    }


  }

  const categorias = {};
  let totalGeneral = 0;

  const items = allProductos
    .filter(p => Number(p.se_compra) === 1 || cantPorProd.has(p.id))
    .map(p => {
      const tipo = p.tipo || 'almacenable';
      const isServicio = tipo === 'servicio';
      const cant = cantPorProd.get(p.id) || 0;
      const stock = isServicio ? 0 : Number(p.stock || 0);
      const minimo = isServicio ? 0 : Number(p.minimo_compra || 0);
      const faltante = Math.max(0, cant - stock);
      const a_comprar = (faltante > 0 && minimo > 0) ? Math.max(faltante, minimo) : faltante;
      const subtotal = a_comprar * Number(p.precio || 0);

      totalGeneral += subtotal;
      categorias[p.categoria] = (categorias[p.categoria] || 0) + subtotal;

      return {
        id: p.id,
        nombre: p.nombre,
        tipo,
        categoria: p.categoria,
        proveedor_id: p.proveedor_id,
        proveedor_nombre: p.proveedor_nombre || '',
        udm: p.udm,
        precio: Number(p.precio || 0),
        minimo_compra: minimo,
        stock,
        cant: Number(cant.toFixed(4)),
        a_comprar: Number(a_comprar.toFixed(4)),
        subtotal: Number(subtotal.toFixed(2)),
      };
    });

  return {
    presupuesto_id: targetId,
    totalPares,
    totalGeneral: Number(totalGeneral.toFixed(2)),
    categorias,
    items,
  };
}

export function listPresupuestos({ estado } = {}) {
  if (estado) return presupuestoRepo.findWhere({ estado });
  return presupuestoRepo.findAll();
}

export function getPresupuestoById(id) {
  const pres = presupuestoRepo.findById(id);
  if (!pres) return null;
  const items = presupuestoItemRepo.query()
    .where('presupuesto_id', id)
    .orderBy('categoria', 'ASC')
    .orderBy('nombre', 'ASC')
    .all();
  const lineas = presupuestoLineaRepo.findWhere({ presupuesto_id: Number(id) });
  const curva = computeCurvaSummary(Number(id)).plantillas.filter(m => m.total > 0);
  return { ...pres, curva, lineas, items };
}

export function savePresupuestoSnapshot({ presupuesto_id, titulo, fecha, observaciones } = {}) {
  const targetId = presupuesto_id ? Number(presupuesto_id) : getActiveDraftPresupuestoId();
  const live = computePresupuestoLive(targetId);
  if (live.totalPares <= 0) {
    throw new Error('La curva actual está en 0.');
  }
  const f = fecha || new Date().toISOString().slice(0, 10);
  const t = (titulo || `Presupuesto ${f}`).trim();

  return presupuestoRepo.transaction(() => {
    const existing = targetId ? presupuestoRepo.findById(targetId) : null;
    let presId;
    const payload = {
      titulo: t,
      fecha: f,
      estado: 'Confirmado',
      total_pares: live.totalPares,
      total_monto: live.totalGeneral,
      observaciones: observaciones || '',
    };

    if (existing && existing.estado === 'Borrador') {
      presupuestoRepo.update(existing.id, payload);
      presId = existing.id;
      presupuestoItemRepo.query().where('presupuesto_id', presId).delete();
    } else {
      presId = presupuestoRepo.create(payload);
    }

    for (const it of live.items) {
      if (it.cant > 0 || it.subtotal > 0) {
        presupuestoItemRepo.create({
          presupuesto_id: presId,
          producto_id: it.id,
          nombre: it.nombre,
          tipo: it.tipo || 'almacenable',
          categoria: it.categoria,
          proveedor_nombre: it.proveedor_nombre,
          udm: it.udm,
          precio_unitario: it.precio,
          minimo_compra: it.minimo_compra,
          cantidad: it.cant,
          a_comprar: it.a_comprar,
          subtotal: it.subtotal,
        });
      }
    }
    return presId;
  });
}

export function deletePresupuesto(id) {
  return presupuestoRepo.delete(id);
}
