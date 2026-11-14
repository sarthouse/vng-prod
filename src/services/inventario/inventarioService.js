import { db } from '../../db.js';
import { BaseRepository } from '../../core/BaseRepository.js';
import { convertUnitFromDb } from '../config/configService.js';
import { resolveVariantForPlantilla } from '../produccion/presupuestoService.js';
import { applicableQtyForLine, getActiveRecetaForPlantilla } from '../produccion/recetaService.js';

class UbicacionRepository extends BaseRepository {
  constructor() {
    super({
      table: 'ubicaciones',
      defaultOrder: 'tipo ASC, es_default DESC, nombre ASC',
      columns: ['codigo', 'nombre', 'tipo', 'parent_id', 'es_default', 'es_sistema', 'activa'],
    });
  }
}

class LoteRepository extends BaseRepository {
  constructor() {
    super({
      table: 'lotes',
      defaultOrder: 'created_at DESC, codigo ASC',
      columns: ['codigo', 'producto_id', 'fecha_alta', 'notas'],
    });
  }
}

class StockQuantRepository extends BaseRepository {
  constructor() {
    super({
      table: 'stock_quants',
      columns: ['ubicacion_id', 'producto_id', 'lote_id', 'lote', 'cantidad'],
    });
  }
}

export const ubicacionRepo = new UbicacionRepository();
export const loteRepo = new LoteRepository();
export const stockQuantRepo = new StockQuantRepository();

function getUbicacionByCodigo(codigo) {
  return db.prepare('SELECT * FROM ubicaciones WHERE codigo = ?').get(codigo);
}

const SYSTEM_UBIC_CODES = new Set([
  'DEP-CENTRAL', 'TALLER-EXT', 'PROD-TERM',
  'VIRT-PROV', 'VIRT-CLI', 'VIRT-PROD', 'VIRT-AJUSTE',
]);

function isInternalTipo(tipo) {
  return tipo === 'interna' || tipo === 'dedicada';
}

export function listUbicaciones() {
  return db.prepare(`
    SELECT u.*, p.nombre as parent_nombre, p.codigo as parent_codigo
    FROM ubicaciones u
    LEFT JOIN ubicaciones p ON p.id = u.parent_id
    ORDER BY u.tipo ASC, u.es_default DESC, COALESCE(p.nombre, ''), u.nombre ASC
  `).all();
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
    if (lote_id) {
      const found = this.loteRepo.findById(Number(lote_id));
      if (found) return found;
    }
    const clean = String(lote || '').trim();
    const prodId = producto_id ? Number(producto_id) : null;
    if (!clean || !prodId) return null;
    const matches = this.loteRepo.findWhere({ producto_id: prodId, codigo: clean }, { limit: 1 });
    let existing = matches[0] || null;
    if (!existing) {
      const newId = this.loteRepo.create({ codigo: clean, producto_id: prodId });
      existing = this.loteRepo.findById(newId);
    }
    return existing;
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
  const where = ['1=1'];
  const params = [];
  if (producto_id) {
    where.push('l.producto_id = ?');
    params.push(Number(producto_id));
  }
  if (ubicacion_id) {
    return db.prepare(`
      SELECT l.*,
             COALESCE(sq.cantidad, 0) as cantidad_ubicacion,
             COALESCE(sq.cantidad_reservada, 0) as reservada_ubicacion,
             COALESCE(sq.cantidad, 0) - COALESCE(sq.cantidad_reservada, 0) as disponible_ubicacion
      FROM lotes l
      LEFT JOIN stock_quants sq ON sq.lote_id = l.id AND sq.ubicacion_id = ?
      WHERE ${where.join(' AND ')}
      ORDER BY disponible_ubicacion DESC, l.codigo ASC
    `).all(Number(ubicacion_id), ...params);
  }
  return db.prepare(`
    SELECT l.*,
           COALESCE((
             SELECT SUM(sq.cantidad)
             FROM stock_quants sq
             JOIN ubicaciones u ON u.id = sq.ubicacion_id
             WHERE sq.lote_id = l.id AND u.tipo IN ('interna', 'dedicada')
           ), 0) as stock_total
    FROM lotes l
    WHERE ${where.join(' AND ')}
    ORDER BY l.created_at DESC, l.codigo ASC
  `).all(...params);
}

export function createLote(b) {
  const codigo = (b.codigo || '').trim();
  if (!codigo) throw new Error('El código de lote es obligatorio');
  const prodId = b.producto_id ? Number(b.producto_id) : null;
  if (!prodId) throw new Error('El lote debe asociarse a un producto');
  const existing = db.prepare('SELECT id FROM lotes WHERE producto_id = ? AND codigo = ?').get(prodId, codigo);
  if (existing) return existing.id;
  return loteRepo.create({
    codigo,
    producto_id: prodId,
    notas: (b.notas || '').trim(),
  });
}

function upsertQuant({ producto_id, ubicacion_id, lote = '', lote_id = null, delta = 0 }) {
  if (!ubicacion_id || !delta || !producto_id) return;
  const loteRow = resolveOrCreateLote({ producto_id, lote, lote_id });
  const cleanLote = loteRow ? loteRow.codigo : String(lote || '').trim();
  const resolvedLoteId = loteRow ? loteRow.id : null;
  const existing = db.prepare(`
    SELECT id, cantidad FROM stock_quants
    WHERE producto_id = ? AND ubicacion_id = ? AND lote = ?
  `).get(producto_id, ubicacion_id, cleanLote);
  if (existing) {
    const nextQty = Number(((Number(existing.cantidad) || 0) + delta).toFixed(4));
    db.prepare("UPDATE stock_quants SET cantidad = ?, lote_id = COALESCE(lote_id, ?), updated_at = datetime('now') WHERE id = ?").run(
      nextQty, resolvedLoteId, existing.id
    );
  } else {
    db.prepare('INSERT INTO stock_quants (producto_id, ubicacion_id, lote_id, lote, cantidad) VALUES (?, ?, ?, ?, ?)').run(
      producto_id, ubicacion_id, resolvedLoteId, cleanLote, Number(delta.toFixed(4))
    );
  }
}

function getInternalStockTotal(producto_id) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(sq.cantidad), 0) as total
    FROM stock_quants sq
    JOIN ubicaciones u ON u.id = sq.ubicacion_id
    WHERE u.tipo IN ('interna', 'dedicada') AND sq.producto_id = ?
  `).get(producto_id);
  return Number((Number(row?.total) || 0).toFixed(4));
}

function resolveOrigenDestino({ tipo, cantidad, ubicacion_origen_id, ubicacion_destino_id }) {
  if (ubicacion_origen_id && ubicacion_destino_id) {
    return { origenId: Number(ubicacion_origen_id), destinoId: Number(ubicacion_destino_id), qty: Math.abs(cantidad) };
  }
  const depCentral = getUbicacionByCodigo('DEP-CENTRAL')?.id || null;
  const tallerExt = getUbicacionByCodigo('TALLER-EXT')?.id || depCentral;
  const prodTerm = getUbicacionByCodigo('PROD-TERM')?.id || depCentral;
  const virtProv = getUbicacionByCodigo('VIRT-PROV')?.id || null;
  const virtCli = getUbicacionByCodigo('VIRT-CLI')?.id || null;
  const virtProd = getUbicacionByCodigo('VIRT-PROD')?.id || null;
  const virtAjuste = getUbicacionByCodigo('VIRT-AJUSTE')?.id || null;

  const isPos = cantidad > 0;
  const t = String(tipo || 'ajuste').toLowerCase();
  if (t === 'compra') {
    return isPos
      ? { origenId: virtProv, destinoId: ubicacion_destino_id || depCentral, qty: Math.abs(cantidad) }
      : { origenId: ubicacion_origen_id || depCentral, destinoId: virtProv, qty: Math.abs(cantidad) };
  }
  if (t === 'remito_taller') {
    return !isPos
      ? { origenId: ubicacion_origen_id || depCentral, destinoId: ubicacion_destino_id || tallerExt, qty: Math.abs(cantidad) }
      : { origenId: ubicacion_origen_id || tallerExt, destinoId: ubicacion_destino_id || depCentral, qty: Math.abs(cantidad) };
  }
  if (t === 'venta') {
    return !isPos
      ? { origenId: ubicacion_origen_id || prodTerm, destinoId: virtCli, qty: Math.abs(cantidad) }
      : { origenId: virtCli, destinoId: ubicacion_destino_id || prodTerm, qty: Math.abs(cantidad) };
  }
  if (t.includes('consumo') || t === 'produccion') {
    return !isPos
      ? { origenId: ubicacion_origen_id || depCentral, destinoId: virtProd, qty: Math.abs(cantidad) }
      : { origenId: virtProd, destinoId: ubicacion_destino_id || prodTerm, qty: Math.abs(cantidad) };
  }
  return isPos
    ? { origenId: ubicacion_origen_id || virtAjuste, destinoId: ubicacion_destino_id || depCentral, qty: Math.abs(cantidad) }
    : { origenId: ubicacion_origen_id || depCentral, destinoId: ubicacion_destino_id || virtAjuste, qty: Math.abs(cantidad) };
}

export function registrarMovimientoStock({
  producto_id,
  tipo,
  cantidad,
  fecha,
  referencia_tipo = '',
  referencia_id = null,
  nota = '',
  ubicacion_origen_id = null,
  ubicacion_destino_id = null,
  lote = '',
  lote_id = null,
  user = null,
}) {
  const prod = producto_id
    ? db.prepare(`
        SELECT p.id, p.sku, p.nombre, p.stock, pt.tipo, pt.udm, pt.categoria
        FROM v_productos p
        JOIN v_plantillas pt ON pt.id = p.plantilla_id
        WHERE p.id = ?
      `).get(Number(producto_id))
    : null;
  if (!prod || prod.tipo === 'servicio') return null;

  const rawQty = Number(cantidad) || 0;
  if (rawQty === 0) return null;

  const { origenId, destinoId, qty } = resolveOrigenDestino({
    tipo,
    cantidad: rawQty,
    ubicacion_origen_id,
    ubicacion_destino_id,
  });

  const prodId = prod.id;
  const loteRow = resolveOrCreateLote({ producto_id: prodId, lote, lote_id });
  const cleanLote = loteRow ? loteRow.codigo : String(lote || '').trim();
  const resolvedLoteId = loteRow ? loteRow.id : null;

  if (origenId) upsertQuant({ producto_id: prodId, ubicacion_id: origenId, lote: cleanLote, lote_id: resolvedLoteId, delta: -qty });
  if (destinoId) upsertQuant({ producto_id: prodId, ubicacion_id: destinoId, lote: cleanLote, lote_id: resolvedLoteId, delta: qty });

  const nuevoStock = getInternalStockTotal(prodId);
  db.prepare(`UPDATE productos SET stock = ?, updated_at = datetime('now') WHERE id = ?`).run(nuevoStock, prodId);

  const origenTipo = origenId ? db.prepare('SELECT tipo FROM ubicaciones WHERE id = ?').get(origenId)?.tipo : null;
  const destinoTipo = destinoId ? db.prepare('SELECT tipo FROM ubicaciones WHERE id = ?').get(destinoId)?.tipo : null;
  let signedDelta = rawQty;
  if (origenTipo === 'virtual' && isInternalTipo(destinoTipo)) signedDelta = qty;
  else if (isInternalTipo(origenTipo) && destinoTipo === 'virtual') signedDelta = -qty;
  else if (isInternalTipo(origenTipo) && isInternalTipo(destinoTipo)) signedDelta = qty;

  const info = db.prepare(`
    INSERT INTO movimientos_stock (
      fecha, producto_id, ubicacion_origen_id, ubicacion_destino_id, lote_id, lote,
      tipo, cantidad, stock_resultante, referencia_tipo, referencia_id, nota,
      autor_id, autor_nombre, actualizado_por_id, actualizado_por_nombre, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    fecha || new Date().toISOString().slice(0, 10),
    prodId,
    origenId,
    destinoId,
    resolvedLoteId,
    cleanLote,
    tipo,
    Number(signedDelta.toFixed(4)),
    nuevoStock,
    referencia_tipo,
    referencia_id ? Number(referencia_id) : null,
    nota,
    user?.id || null,
    user?.nombre || 'Sistema',
    user?.id || null,
    user?.nombre || 'Sistema'
  );
  return Number(info.lastInsertRowid);
}

export function listStockQuants({ ubicacion_id, solo_internas } = {}) {
  const where = ['sq.cantidad != 0'];
  const params = [];
  if (ubicacion_id) {
    where.push('sq.ubicacion_id = ?');
    params.push(Number(ubicacion_id));
  }
  if (solo_internas) {
    where.push("u.tipo IN ('interna', 'dedicada')");
  }
  return db.prepare(`
    SELECT sq.*,
           u.codigo as ubicacion_codigo, u.nombre as ubicacion_nombre, u.tipo as ubicacion_tipo,
           p.nombre as item_nombre,
           COALESCE(pt.udm, 'unidades') as udm,
           COALESCE(pt.categoria, '') as categoria
    FROM stock_quants sq
    JOIN ubicaciones u ON u.id = sq.ubicacion_id
    JOIN v_productos p ON p.id = sq.producto_id
    JOIN v_plantillas pt ON pt.id = p.plantilla_id
    WHERE ${where.join(' AND ')}
    ORDER BY u.tipo ASC, u.nombre ASC, item_nombre ASC, sq.lote ASC
  `).all(...params);
}

export function computeStockReservadoPorOrdenes() {
  const ordenes = db.prepare(`
    SELECT op.*
    FROM ordenes_produccion op
    WHERE op.estado IN ('Planificada', 'En Proceso')
  `).all();

  const reservado = new Map();
  for (const op of ordenes) {
    const etapasPendientes = db.prepare(`
      SELECT * FROM orden_etapas WHERE orden_id = ? AND stock_consumido = 0
    `).all(op.id);
    if (etapasPendientes.length === 0) continue;

    const pendingEtapaIds = new Set(etapasPendientes.map(e => e.etapa_id).filter(Boolean));
    const pendingRecetaEtapaIds = new Set(etapasPendientes.map(e => e.receta_etapa_id).filter(Boolean));
    const recetaId = op.receta_id || getActiveRecetaForPlantilla(op.plantilla_id)?.id;
    const usedPlantillas = new Set();

    const ordenLineas = db.prepare(`
      SELECT ol.*, p.combinacion_json
      FROM orden_lineas ol
      JOIN productos p ON p.id = ol.producto_id
      WHERE ol.orden_id = ?
    `).all(op.id);

    if (recetaId) {
      const lineas = db.prepare(`
        SELECT rl.*, p.plantilla_id as prod_plantilla_id, pt.udm
        FROM receta_lineas rl
        JOIN productos p ON p.id = rl.producto_id
        JOIN v_plantillas pt ON pt.id = p.plantilla_id
        WHERE rl.receta_id = ? AND pt.tipo != 'servicio'
      `).all(recetaId);

      for (const l of lineas) {
        usedPlantillas.add(`plt:${l.prod_plantilla_id}`);
        if (l.receta_etapa_id && !pendingRecetaEtapaIds.has(l.receta_etapa_id)) continue;
        if (l.etapa_id && !l.receta_etapa_id && !pendingEtapaIds.has(l.etapa_id)) continue;
        let vars = [];
        try { vars = JSON.parse(l.variantes_json || '[]'); } catch { vars = []; }
        let pares = 0;
        for (const ol of ordenLineas) pares += applicableQtyForLine(ol, ol.cantidad, vars);
        if (pares <= 0) continue;
        const conv = convertUnitFromDb(l.coeficiente, l.udm_receta || l.udm, l.udm);
        reservado.set(l.producto_id, (reservado.get(l.producto_id) || 0) + conv * pares);
      }
    }
  }
  return reservado;
}

export function getInventarioResumen() {
  const productos = db.prepare(`
    SELECT p.*, pt.tipo, pt.categoria, pt.udm, pt.alicuota_iva, pt.se_compra, pt.se_fabrica,
           COALESCE(pt.lead_time_dias, 0) as lead_time_dias,
           pt.proveedor_id, COALESCE(c.nombre, '') as proveedor_nombre
    FROM v_productos p
    JOIN v_plantillas pt ON pt.id = p.plantilla_id
    LEFT JOIN contactos c ON c.id = pt.proveedor_id
    WHERE p.activo = 1 AND pt.tipo != 'servicio'
    ORDER BY pt.categoria ASC, p.nombre ASC
  `).all();

  const reservadoMap = computeStockReservadoPorOrdenes();

  return productos.map(p => {
    const stock = Number(p.stock || 0);
    const reservado = Number((reservadoMap.get(p.id) || 0).toFixed(4));
    const disponible = Number((stock - reservado).toFixed(4));
    const stock_minimo = Number(p.stock_minimo || 0);
    const minimo_compra = Number(p.minimo_compra || 0);
    const alerta_minimo = disponible <= stock_minimo && (stock_minimo > 0 || reservado > 0 || disponible < 0);
    const faltante_bruto = Math.max(0, stock_minimo - disponible);
    const a_comprar = faltante_bruto > 0 && minimo_compra > 0
      ? Math.max(faltante_bruto, minimo_compra)
      : faltante_bruto;

    return {
      ...p,
      stock,
      reservado,
      disponible,
      stock_minimo,
      minimo_compra,
      alerta_minimo,
      a_comprar: Number(a_comprar.toFixed(4)),
    };
  });
}

export function listMovimientosStock({ producto_id, tipo } = {}) {
  const where = [];
  const params = [];
  if (producto_id) {
    where.push('ms.producto_id = ?');
    params.push(Number(producto_id));
  }
  if (tipo) {
    where.push('ms.tipo = ?');
    params.push(tipo);
  }
  const sqlWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db.prepare(`
    SELECT ms.*,
           p.nombre as producto_nombre,
           pt.udm,
           uo.nombre as origen_nombre, uo.tipo as origen_tipo,
           ud.nombre as destino_nombre, ud.tipo as destino_tipo
    FROM movimientos_stock ms
    JOIN productos p ON p.id = ms.producto_id
    JOIN v_plantillas pt ON pt.id = p.plantilla_id
    LEFT JOIN ubicaciones uo ON uo.id = ms.ubicacion_origen_id
    LEFT JOIN ubicaciones ud ON ud.id = ms.ubicacion_destino_id
    ${sqlWhere}
    ORDER BY ms.fecha DESC, ms.id DESC
    LIMIT 300
  `).all(...params);
}
