import {
  ubicacionRepo,
  loteRepo,
  stockQuantRepo,
  movimientoStockRepo,
  isInternalTipo,
  resolveLoteEnRepo,
  registrarMovimientoStock,
  computeStockReservadoPorOrdenes,
  getInventarioResumen,
} from './stockQuantHelper.js';
import { getFlujoStockMatriz } from './stockProyeccionHelper.js';

export {
  ubicacionRepo,
  loteRepo,
  stockQuantRepo,
  registrarMovimientoStock,
  computeStockReservadoPorOrdenes,
  getInventarioResumen,
  getFlujoStockMatriz,
};

const SYSTEM_UBIC_CODES = new Set([
  'DEP-CENTRAL', 'TALLER-EXT', 'PROD-TERM',
  'VIRT-PROV', 'VIRT-CLI', 'VIRT-PROD', 'VIRT-AJUSTE',
]);

export function listUbicaciones() {
  const rows = ubicacionRepo.query('u')
    .select('u.*, p.nombre as parent_nombre, p.codigo as parent_codigo')
    .leftJoin('ubicaciones', 'p', 'p.id', 'u.parent_id')
    .orderBy('u.tipo', 'ASC')
    .orderBy('u.es_default', 'DESC')
    .orderBy('u.nombre', 'ASC')
    .all();
  return rows.sort((a, b) => {
    if (a.tipo !== b.tipo) return String(a.tipo || '').localeCompare(String(b.tipo || ''));
    if (Number(a.es_default) !== Number(b.es_default)) return Number(b.es_default) - Number(a.es_default);
    const pa = a.parent_nombre || '';
    const pb = b.parent_nombre || '';
    if (pa !== pb) return pa.localeCompare(pb);
    return String(a.nombre || '').localeCompare(String(b.nombre || ''));
  });
}

/**
 * Servicio base de Ubicaciones y Lotes (SOLID: SRP + DIP/LSP).
 */
export class InventarioBaseService {
  constructor({
    ubicacionRepo: uRepo = ubicacionRepo,
    loteRepo: lRepo = loteRepo,
    stockQuantRepo: qRepo = stockQuantRepo,
  } = {}) {
    this.ubicacionRepo = uRepo;
    this.loteRepo = lRepo;
    this.stockQuantRepo = qRepo;
  }

  createUbicacion(b) {
    const nombre = (b.nombre || '').trim();
    if (!nombre) throw new Error('El nombre de la ubicación es obligatorio');
    const codigo = (b.codigo || nombre.toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 20)).trim();
    const tipo = ['interna', 'virtual', 'dedicada'].includes(b.tipo) ? b.tipo : 'interna';
    const parentId = b.parent_id ? Number(b.parent_id) : null;
    if (parentId) {
      const parent = this.ubicacionRepo.findById(parentId);
      if (!parent) throw new Error('Ubicación padre no encontrada');
      if (tipo === 'dedicada' && !isInternalTipo(parent.tipo)) {
        throw new Error('Una ubicación dedicada debe depender de una ubicación interna');
      }
    }
    return this.ubicacionRepo.create({
      codigo,
      nombre,
      tipo,
      parent_id: parentId,
      es_default: 0,
      es_sistema: 0,
      activa: 1,
    });
  }

  updateUbicacion(id, b) {
    const ex = this.ubicacionRepo.findById(id);
    if (!ex) return false;
    const isSys = Boolean(ex.es_sistema || ex.es_default || SYSTEM_UBIC_CODES.has(ex.codigo));
    const nextTipo = (!isSys && ['interna', 'virtual', 'dedicada'].includes(b.tipo)) ? b.tipo : ex.tipo;
    const nextParent = (!isSys && b.parent_id !== undefined) ? (b.parent_id ? Number(b.parent_id) : null) : ex.parent_id;
    if (nextParent && Number(nextParent) === Number(id)) {
      throw new Error('Una ubicación no puede ser padre de sí misma');
    }
    return this.ubicacionRepo.update(id, {
      nombre: b.nombre !== undefined ? (b.nombre.trim() || ex.nombre) : ex.nombre,
      tipo: nextTipo,
      parent_id: nextParent,
      activa: isSys ? ex.activa : (b.activa !== undefined ? (b.activa ? 1 : 0) : ex.activa),
    });
  }

  deleteUbicacion(id) {
    const ex = this.ubicacionRepo.findById(id);
    if (!ex) return false;
    if (ex.es_sistema || ex.es_default || SYSTEM_UBIC_CODES.has(ex.codigo)) {
      throw new Error('No se puede eliminar una ubicación protegida del sistema');
    }
    const quants = this.stockQuantRepo.findWhere({ ubicacion_id: Number(id) });
    if (quants.some(q => Number(q.cantidad || 0) !== 0)) {
      throw new Error('No se puede eliminar una ubicación con stock activo');
    }
    const children = this.ubicacionRepo.findWhere({ parent_id: Number(id) }, { limit: 1 });
    if (children.length > 0) {
      throw new Error('Primero reasigná o eliminá las sub-ubicaciones dependientes');
    }
    return this.ubicacionRepo.delete(id);
  }

  resolveOrCreateLote({ producto_id, lote = '', lote_id = null }) {
    return resolveLoteEnRepo(this.loteRepo, { producto_id, lote, lote_id });
  }
}

const defaultInventarioBase = new InventarioBaseService();

export function createUbicacion(b) {
  return defaultInventarioBase.createUbicacion(b);
}

export function updateUbicacion(id, b) {
  return defaultInventarioBase.updateUbicacion(id, b);
}

export function deleteUbicacion(id) {
  return defaultInventarioBase.deleteUbicacion(id);
}

export function resolveOrCreateLote(params) {
  return defaultInventarioBase.resolveOrCreateLote(params);
}

export function listLotes({ producto_id, ubicacion_id } = {}) {
  const qb = loteRepo.query('l').select('l.*');
  if (producto_id) qb.where('l.producto_id', Number(producto_id));

  if (ubicacion_id) {
    const lotes = qb.all();
    const quants = stockQuantRepo.query('sq')
      .select('sq.lote_id, sq.cantidad, sq.cantidad_reservada')
      .where('sq.ubicacion_id', Number(ubicacion_id))
      .whereNotNull('sq.lote_id')
      .all();
    const qMap = new Map();
    for (const q of quants) {
      const prev = qMap.get(q.lote_id) || { cantidad: 0, reservada: 0 };
      prev.cantidad += Number(q.cantidad || 0);
      prev.reservada += Number(q.cantidad_reservada || 0);
      qMap.set(q.lote_id, prev);
    }
    return lotes.map(l => {
      const q = qMap.get(l.id) || { cantidad: 0, reservada: 0 };
      return {
        ...l,
        cantidad_ubicacion: q.cantidad,
        reservada_ubicacion: q.reservada,
        disponible_ubicacion: q.cantidad - q.reservada,
      };
    }).sort((a, b) => {
      if (b.disponible_ubicacion !== a.disponible_ubicacion) {
        return b.disponible_ubicacion - a.disponible_ubicacion;
      }
      return String(a.codigo || '').localeCompare(String(b.codigo || ''));
    });
  }

  const lotes = qb.orderBy('l.created_at', 'DESC').orderBy('l.codigo', 'ASC').all();
  const intQuants = stockQuantRepo.query('sq')
    .select('sq.lote_id, sq.cantidad')
    .innerJoin('ubicaciones', 'u', 'u.id', 'sq.ubicacion_id')
    .whereIn('u.tipo', ['interna', 'dedicada'])
    .whereNotNull('sq.lote_id')
    .all();
  const totalMap = new Map();
  for (const q of intQuants) {
    totalMap.set(q.lote_id, (totalMap.get(q.lote_id) || 0) + Number(q.cantidad || 0));
  }
  return lotes.map(l => ({
    ...l,
    stock_total: totalMap.get(l.id) || 0,
  }));
}

export function createLote(b) {
  const codigo = (b.codigo || '').trim();
  if (!codigo) throw new Error('El código de lote es obligatorio');
  const prodId = b.producto_id ? Number(b.producto_id) : null;
  if (!prodId) throw new Error('El lote debe asociarse a un producto');
  const existing = loteRepo.query().select('id').where('producto_id', prodId).where('codigo', codigo).get();
  if (existing) return existing.id;
  return loteRepo.create({
    codigo,
    producto_id: prodId,
    notas: (b.notas || '').trim(),
  });
}

export function listStockQuants({ ubicacion_id, solo_internas } = {}) {
  const qb = stockQuantRepo.query('sq')
    .select("sq.*, u.codigo as ubicacion_codigo, u.nombre as ubicacion_nombre, u.tipo as ubicacion_tipo, p.nombre as item_nombre, COALESCE(pt.udm, 'unidades') as udm, COALESCE(pt.categoria, '') as categoria")
    .innerJoin('ubicaciones', 'u', 'u.id', 'sq.ubicacion_id')
    .innerJoin('v_productos', 'p', 'p.id', 'sq.producto_id')
    .innerJoin('v_plantillas', 'pt', 'pt.id', 'p.plantilla_id')
    .where('sq.cantidad', '!=', 0);
  if (ubicacion_id) qb.where('sq.ubicacion_id', Number(ubicacion_id));
  if (solo_internas) qb.whereIn('u.tipo', ['interna', 'dedicada']);
  return qb.orderBy('u.tipo', 'ASC').orderBy('u.nombre', 'ASC').orderBy('item_nombre', 'ASC').orderBy('sq.lote', 'ASC').all();
}

export function listMovimientosStock({ producto_id, tipo } = {}) {
  const qb = movimientoStockRepo.query('ms')
    .select('ms.*, p.nombre as producto_nombre, p.nombre as componente_nombre, pt.udm, uo.nombre as origen_nombre, uo.tipo as origen_tipo, ud.nombre as destino_nombre, ud.tipo as destino_tipo')
    .innerJoin('productos', 'p', 'p.id', 'ms.producto_id')
    .innerJoin('v_plantillas', 'pt', 'pt.id', 'p.plantilla_id')
    .leftJoin('ubicaciones', 'uo', 'uo.id', 'ms.ubicacion_origen_id')
    .leftJoin('ubicaciones', 'ud', 'ud.id', 'ms.ubicacion_destino_id');
  if (producto_id) qb.where('ms.producto_id', Number(producto_id));
  if (tipo) qb.where('ms.tipo', tipo);
  return qb.orderBy('ms.fecha', 'DESC').orderBy('ms.id', 'DESC').limit(300).all();
}
