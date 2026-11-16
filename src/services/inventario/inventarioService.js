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
           p.nombre as componente_nombre,
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

function addDaysStockIso(iso, days) {
  if (!iso || typeof iso !== 'string') return new Date().toISOString().slice(0, 10);
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + (Number(days) || 0)));
  return dt.toISOString().slice(0, 10);
}

function buildStockPeriods(granularidad = 'semana', histCount = 4, proyCount = 6, hoyIso = new Date().toISOString().slice(0, 10)) {
  const periods = [];
  const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  if (granularidad === 'mes') {
    const [y, m] = hoyIso.split('-').map(Number);
    const curYm = hoyIso.slice(0, 7);
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
    periods.push({
      key,
      label: `${fmt(mon)} – ${fmt(sun)}`,
      sublabel: i < 0 ? 'Histórico' : i === 0 ? 'Semana Actual' : `Sem +${i}`,
      kind: i < 0 ? 'historico' : i === 0 ? 'actual' : 'proyectado',
      start: key,
      end: sun.toISOString().slice(0, 10),
      isCurrent: i === 0,
    });
  }
  return periods;
}

export function getFlujoStockMatriz({
  granularidad = 'semana',
  hist_periodos = 4,
  proy_periodos = 6,
  producto_id = null,
  categoria = null,
  rol = null, // 'insumos' | 'fabricados' | null
} = {}) {
  const histCount = Math.max(1, Math.min(12, Number(hist_periodos) || 4));
  const proyCount = Math.max(1, Math.min(16, Number(proy_periodos) || 6));
  const hoyIso = new Date().toISOString().slice(0, 10);
  const periods = buildStockPeriods(granularidad, histCount, proyCount, hoyIso);
  const firstStart = periods[0].start;
  const lastEnd = periods[periods.length - 1].end;
  const curPeriod = periods.find(p => p.isCurrent) || periods[0];

  const allProds = getInventarioResumen();
  const filteredProds = allProds.filter(p => {
    if (producto_id && Number(p.id) !== Number(producto_id)) return false;
    if (categoria && p.categoria !== categoria) return false;
    if (rol === 'insumos' && Number(p.se_compra) !== 1) return false;
    if (rol === 'fabricados' && Number(p.se_fabrica) !== 1) return false;
    return true;
  });

  const prodIds = new Set(filteredProds.map(p => Number(p.id)));
  const prodMap = new Map(filteredProds.map(p => [Number(p.id), p]));

  const rowDefs = [
    { id: 'stock_inicial', label: 'Stock Inicial', type: 'balance_start' },
    { id: 'entradas_total', label: '(+) Entradas', type: 'group_in', children: ['in_reales', 'in_compras_proy', 'in_produccion_proy'] },
    { id: 'in_reales', label: 'Entradas Confirmadas', type: 'item_in', parent: 'entradas_total' },
    { id: 'in_compras_proy', label: 'Recepciones Pendientes', type: 'item_in', parent: 'entradas_total' },
    { id: 'in_produccion_proy', label: 'Producción Prevista', type: 'item_in', parent: 'entradas_total' },
    { id: 'salidas_total', label: '(-) Salidas', type: 'group_out', children: ['out_reales', 'out_consumo_op_proy', 'out_entregas_proy'] },
    { id: 'out_reales', label: 'Salidas Confirmadas', type: 'item_out', parent: 'salidas_total' },
    { id: 'out_consumo_op_proy', label: 'Consumo de Producción', type: 'item_out', parent: 'salidas_total' },
    { id: 'out_entregas_proy', label: 'Entregas Pendientes', type: 'item_out', parent: 'salidas_total' },
    { id: 'flujo_neto', label: '(=) Variación Neta', type: 'net' },
    { id: 'stock_final', label: '(=) Stock Final', type: 'balance_end' },
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

  // Delta por producto y por período para la matriz multi-producto
  const prodPeriodNet = new Map();
  const prodPeriodDetails = new Map();
  const prodAfterFirstDelta = new Map();

  for (const p of filteredProds) {
    const pNet = {};
    const pDet = {};
    for (const per of periods) {
      pNet[per.key] = 0;
      pDet[per.key] = [];
    }
    prodPeriodNet.set(p.id, pNet);
    prodPeriodDetails.set(p.id, pDet);
    prodAfterFirstDelta.set(p.id, 0);
  }

  const findHistPeriodKey = (fecha) => {
    const f = String(fecha || hoyIso).slice(0, 10);
    const match = periods.find(p => f >= p.start && f <= p.end);
    return match ? match.key : null;
  };

  const findProyPeriodKey = (fecha) => {
    const f = String(fecha || hoyIso).slice(0, 10);
    if (f < hoyIso) return curPeriod.key;
    const match = periods.find(p => f >= p.start && f <= p.end);
    if (match) return match.kind === 'historico' ? curPeriod.key : match.key;
    return null;
  };

  // 1. Movimientos históricos reales (que cambian el stock interno total)
  const movs = db.prepare(`
    SELECT ms.*, p.nombre as producto_nombre, pt.udm,
           uo.tipo as origen_tipo, ud.tipo as destino_tipo
    FROM movimientos_stock ms
    JOIN productos p ON p.id = ms.producto_id
    JOIN v_plantillas pt ON pt.id = p.plantilla_id
    LEFT JOIN ubicaciones uo ON uo.id = ms.ubicacion_origen_id
    LEFT JOIN ubicaciones ud ON ud.id = ms.ubicacion_destino_id
    WHERE ms.fecha >= ?
    ORDER BY ms.fecha ASC, ms.id ASC
  `).all(firstStart);

  for (const m of movs) {
    const pid = Number(m.producto_id);
    if (!prodIds.has(pid)) continue;
    const oInt = isInternalTipo(m.origen_tipo);
    const dInt = isInternalTipo(m.destino_tipo);
    // Ignorar traslados entre dos ubicaciones internas (ej. DEP-CENTRAL -> TALLER-EXT) porque no alteran el stock total disponible
    if (oInt && dInt) continue;

    let signed = Number(m.cantidad || 0);
    if (oInt && !dInt && signed > 0) signed = -signed;
    if (!oInt && dInt && signed < 0) signed = Math.abs(signed);
    if (Math.abs(signed) < 0.0001) continue;

    prodAfterFirstDelta.set(pid, (prodAfterFirstDelta.get(pid) || 0) + signed);

    const pk = findHistPeriodKey(m.fecha);
    if (!pk) continue;

    const pInfo = prodMap.get(pid);
    const itemDetail = {
      fecha: m.fecha,
      origen: `Real (${m.tipo})`,
      contraparte: pInfo?.nombre || m.producto_nombre,
      concepto: m.nota || `Mov. #${m.id} (${pInfo?.udm || m.udm})`,
      monto: Number(signed.toFixed(4)),
    };

    prodPeriodNet.get(pid)[pk] = Number((prodPeriodNet.get(pid)[pk] + signed).toFixed(4));
    prodPeriodDetails.get(pid)[pk].push(itemDetail);

    if (signed > 0) {
      values.in_reales[pk] = Number((values.in_reales[pk] + signed).toFixed(4));
      details.in_reales[pk].push(itemDetail);
    } else {
      const absQ = Math.abs(signed);
      values.out_reales[pk] = Number((values.out_reales[pk] + absQ).toFixed(4));
      details.out_reales[pk].push(itemDetail);
    }
  }

  // 2. Proyecciones: Operaciones de Stock en Borrador (recepciones de compra y entregas de venta)
  const opsBorrador = db.prepare(`
    SELECT os.id, os.numero, os.fecha, os.tipo, os.referencia_tipo, os.referencia_id,
           COALESCE(co.nombre, '') as contacto_nombre,
           osl.producto_id, osl.cantidad
    FROM operaciones_stock os
    JOIN operacion_stock_lineas osl ON osl.operacion_id = os.id
    LEFT JOIN contactos co ON co.id = os.contacto_id
    WHERE os.estado = 'Borrador' AND os.tipo IN ('recepcion', 'recepcion_compra', 'entrega', 'entrega_venta')
  `).all();

  const comprasConRecepcionBorrador = new Set();
  for (const op of opsBorrador) {
    if (op.referencia_tipo === 'compra' && op.referencia_id) {
      comprasConRecepcionBorrador.add(Number(op.referencia_id));
    }
    const pid = Number(op.producto_id);
    if (!prodIds.has(pid)) continue;
    const qty = Number(op.cantidad || 0);
    if (qty <= 0) continue;
    const pInfo = prodMap.get(pid);
    const leadDays = (op.tipo === 'recepcion' || op.tipo === 'recepcion_compra') ? Number(pInfo?.lead_time_dias || 0) : 0;
    const estDate = addDaysStockIso(op.fecha || hoyIso, leadDays);
    if (estDate > lastEnd) continue;
    const pk = findProyPeriodKey(estDate);
    if (!pk) continue;

    const isIn = op.tipo === 'recepcion' || op.tipo === 'recepcion_compra';
    const signed = isIn ? qty : -qty;
    const itemDetail = {
      fecha: estDate,
      vencido: estDate < hoyIso,
      origen: isIn ? 'Recepción Pendiente' : 'Entrega Pendiente',
      contraparte: pInfo?.nombre || '-',
      concepto: `${op.numero || '#' + op.id}${op.contacto_nombre ? ' · ' + op.contacto_nombre : ''}`,
      monto: Number(signed.toFixed(4)),
    };

    prodPeriodNet.get(pid)[pk] = Number((prodPeriodNet.get(pid)[pk] + signed).toFixed(4));
    prodPeriodDetails.get(pid)[pk].push(itemDetail);

    if (isIn) {
      values.in_compras_proy[pk] = Number((values.in_compras_proy[pk] + qty).toFixed(4));
      details.in_compras_proy[pk].push(itemDetail);
    } else {
      values.out_entregas_proy[pk] = Number((values.out_entregas_proy[pk] + qty).toFixed(4));
      details.out_entregas_proy[pk].push(itemDetail);
    }
  }

  // 2b. Compras en Borrador (aún sin operación de recepción emitida)
  const comprasBorrador = db.prepare(`
    SELECT c.id, c.numero, c.fecha, COALESCE(co.nombre, '') as proveedor_nombre,
           cl.producto_id, cl.cantidad
    FROM compras c
    JOIN compra_lineas cl ON cl.compra_id = c.id
    LEFT JOIN contactos co ON co.id = c.contacto_id
    WHERE c.estado = 'Borrador' AND cl.producto_id IS NOT NULL
  `).all();

  for (const cb of comprasBorrador) {
    if (comprasConRecepcionBorrador.has(Number(cb.id))) continue;
    const pid = Number(cb.producto_id);
    if (!prodIds.has(pid)) continue;
    const qty = Number(cb.cantidad || 0);
    if (qty <= 0) continue;
    const pInfo = prodMap.get(pid);
    const estDate = addDaysStockIso(cb.fecha || hoyIso, Number(pInfo?.lead_time_dias || 0));
    if (estDate > lastEnd) continue;
    const pk = findProyPeriodKey(estDate);
    if (!pk) continue;

    const itemDetail = {
      fecha: estDate,
      vencido: estDate < hoyIso,
      origen: 'OC Borrador',
      contraparte: pInfo?.nombre || '-',
      concepto: `Compra ${cb.numero || '#' + cb.id}${cb.proveedor_nombre ? ' · ' + cb.proveedor_nombre : ''}`,
      monto: Number(qty.toFixed(4)),
    };
    prodPeriodNet.get(pid)[pk] = Number((prodPeriodNet.get(pid)[pk] + qty).toFixed(4));
    prodPeriodDetails.get(pid)[pk].push(itemDetail);
    values.in_compras_proy[pk] = Number((values.in_compras_proy[pk] + qty).toFixed(4));
    details.in_compras_proy[pk].push(itemDetail);
  }

  // 3. Órdenes de Producción activas:
  //    a) Ingreso proyectado de producto terminado (cantidad_pendiente en fecha_objetivo)
  //    b) Consumo proyectado de insumos por etapa pendiente (en fecha_inicio_est de la etapa)
  const ordenesActivas = db.prepare(`
    SELECT op.*
    FROM ordenes_produccion op
    WHERE op.estado IN ('Planificada', 'En Proceso')
  `).all();

  for (const op of ordenesActivas) {
    const opLineas = db.prepare(`
      SELECT ol.*, p.nombre as producto_nombre, p.combinacion_json,
             COALESCE((
               SELECT SUM(ms.cantidad)
               FROM movimientos_stock ms
               WHERE ms.referencia_tipo = 'orden_produccion'
                 AND ms.referencia_id = ol.orden_id
                 AND ms.tipo = 'ingreso_produccion'
                 AND ms.producto_id = ol.producto_id
             ), 0) as ingresada
      FROM orden_lineas ol
      JOIN productos p ON p.id = ol.producto_id
      WHERE ol.orden_id = ?
    `).all(op.id);

    const fechaObj = op.fecha_objetivo || addDaysStockIso(op.fecha_inicio || hoyIso, 7);
    if (fechaObj <= lastEnd) {
      const pkObj = findProyPeriodKey(fechaObj);
      if (pkObj) {
        for (const ol of opLineas) {
          const pid = Number(ol.producto_id);
          if (!prodIds.has(pid)) continue;
          const pend = Number(Math.max(0, Number(ol.cantidad || 0) - Number(ol.ingresada || 0)).toFixed(4));
          if (pend <= 0) continue;
          const pInfo = prodMap.get(pid);
          const itemDetail = {
            fecha: fechaObj,
            vencido: fechaObj < hoyIso,
            origen: 'Fin OP Previsto',
            contraparte: pInfo?.nombre || ol.producto_nombre,
            concepto: `Orden ${op.codigo} (${op.estado})`,
            monto: pend,
          };
          prodPeriodNet.get(pid)[pkObj] = Number((prodPeriodNet.get(pid)[pkObj] + pend).toFixed(4));
          prodPeriodDetails.get(pid)[pkObj].push(itemDetail);
          values.in_produccion_proy[pkObj] = Number((values.in_produccion_proy[pkObj] + pend).toFixed(4));
          details.in_produccion_proy[pkObj].push(itemDetail);
        }
      }
    }

    // Consumos por etapa pendiente
    const etapasPend = db.prepare(`
      SELECT * FROM orden_etapas WHERE orden_id = ? AND stock_consumido = 0 ORDER BY orden_num ASC, id ASC
    `).all(op.id);
    if (!etapasPend.length) continue;

    const recetaId = op.receta_id || getActiveRecetaForPlantilla(op.plantilla_id)?.id;
    if (!recetaId) continue;

    const rLineas = db.prepare(`
      SELECT rl.*, p.plantilla_id as prod_plantilla_id, pt.udm
      FROM receta_lineas rl
      JOIN productos p ON p.id = rl.producto_id
      JOIN v_plantillas pt ON pt.id = p.plantilla_id
      WHERE rl.receta_id = ? AND pt.tipo != 'servicio'
    `).all(recetaId);

    for (const l of rLineas) {
      let targetEtapa = null;
      if (l.receta_etapa_id) {
        targetEtapa = etapasPend.find(e => Number(e.receta_etapa_id) === Number(l.receta_etapa_id));
        if (!targetEtapa) continue;
      } else if (l.etapa_id) {
        targetEtapa = etapasPend.find(e => Number(e.etapa_id) === Number(l.etapa_id));
        if (!targetEtapa) continue;
      } else {
        targetEtapa = etapasPend[0];
      }

      const fechaConsumo = targetEtapa?.fecha_inicio_est || op.fecha_inicio || hoyIso;
      if (fechaConsumo > lastEnd) continue;
      const pkCons = findProyPeriodKey(fechaConsumo);
      if (!pkCons) continue;

      let vars = [];
      try { vars = JSON.parse(l.variantes_json || '[]'); } catch { vars = []; }
      const conv = convertUnitFromDb(l.coeficiente, l.udm_receta || l.udm, l.udm);

      if (Number(l.emparejar_variante) === 1 && l.prod_plantilla_id) {
        for (const ol of opLineas) {
          const pares = applicableQtyForLine(ol, ol.cantidad, vars);
          if (pares <= 0) continue;
          let combo = {};
          try { combo = JSON.parse(ol.combinacion_json || '{}'); } catch { combo = {}; }
          const matched = resolveVariantForPlantilla(l.prod_plantilla_id, combo);
          const insId = Number(matched ? matched.id : l.producto_id);
          if (!prodIds.has(insId)) continue;
          const reqQty = Number((conv * pares).toFixed(4));
          if (reqQty <= 0) continue;
          const pInfo = prodMap.get(insId);
          const itemDetail = {
            fecha: fechaConsumo,
            vencido: fechaConsumo < hoyIso,
            origen: `Consumo OP (${targetEtapa?.nombre || 'Etapa'})`,
            contraparte: pInfo?.nombre || '-',
            concepto: `Orden ${op.codigo}`,
            monto: -reqQty,
          };
          prodPeriodNet.get(insId)[pkCons] = Number((prodPeriodNet.get(insId)[pkCons] - reqQty).toFixed(4));
          prodPeriodDetails.get(insId)[pkCons].push(itemDetail);
          values.out_consumo_op_proy[pkCons] = Number((values.out_consumo_op_proy[pkCons] + reqQty).toFixed(4));
          details.out_consumo_op_proy[pkCons].push(itemDetail);
        }
      } else {
        const insId = Number(l.producto_id);
        if (!prodIds.has(insId)) continue;
        let pares = 0;
        for (const ol of opLineas) pares += applicableQtyForLine(ol, ol.cantidad, vars);
        if (pares <= 0) continue;
        const reqQty = Number((conv * pares).toFixed(4));
        if (reqQty <= 0) continue;
        const pInfo = prodMap.get(insId);
        const itemDetail = {
          fecha: fechaConsumo,
          vencido: fechaConsumo < hoyIso,
          origen: `Consumo OP (${targetEtapa?.nombre || 'Etapa'})`,
          contraparte: pInfo?.nombre || '-',
          concepto: `Orden ${op.codigo}`,
          monto: -reqQty,
        };
        prodPeriodNet.get(insId)[pkCons] = Number((prodPeriodNet.get(insId)[pkCons] - reqQty).toFixed(4));
        prodPeriodDetails.get(insId)[pkCons].push(itemDetail);
        values.out_consumo_op_proy[pkCons] = Number((values.out_consumo_op_proy[pkCons] + reqQty).toFixed(4));
        details.out_consumo_op_proy[pkCons].push(itemDetail);
      }
    }
  }

  // 4. Calcular apertura al inicio del primer período (stock_actual - movimientos reales desde firstStart)
  const stockActualTotal = Number(filteredProds.reduce((s, p) => s + Number(p.stock || 0), 0).toFixed(4));
  const deltaTotalDesdeInicio = Number(Array.from(prodAfterFirstDelta.values()).reduce((s, v) => s + v, 0).toFixed(4));
  let runningStock = Number((stockActualTotal - deltaTotalDesdeInicio).toFixed(4));

  const totals = {};
  for (const r of rowDefs) totals[r.id] = 0;
  totals.stock_inicial = runningStock;

  for (const p of periods) {
    const pk = p.key;
    values.stock_inicial[pk] = Number(runningStock.toFixed(4));

    const inTotal = Number((
      values.in_reales[pk] +
      values.in_compras_proy[pk] +
      values.in_produccion_proy[pk]
    ).toFixed(4));
    values.entradas_total[pk] = inTotal;
    details.entradas_total[pk] = [
      ...details.in_reales[pk],
      ...details.in_compras_proy[pk],
      ...details.in_produccion_proy[pk],
    ];

    const outTotal = Number((
      values.out_reales[pk] +
      values.out_consumo_op_proy[pk] +
      values.out_entregas_proy[pk]
    ).toFixed(4));
    values.salidas_total[pk] = outTotal;
    details.salidas_total[pk] = [
      ...details.out_reales[pk],
      ...details.out_consumo_op_proy[pk],
      ...details.out_entregas_proy[pk],
    ];

    const neto = Number((inTotal - outTotal).toFixed(4));
    values.flujo_neto[pk] = neto;
    details.flujo_neto[pk] = [...details.entradas_total[pk], ...details.salidas_total[pk]];

    runningStock = Number((runningStock + neto).toFixed(4));
    values.stock_final[pk] = runningStock;
  }

  for (const r of rowDefs) {
    if (r.id === 'stock_inicial') continue;
    if (r.id === 'stock_final') {
      totals[r.id] = runningStock;
      continue;
    }
    totals[r.id] = Number(periods.reduce((s, p) => s + (Number(values[r.id][p.key]) || 0), 0).toFixed(4));
  }

  // 5. Construir Matriz Multi-Producto (filas = productos, celdas = saldo al cierre de cada semana/mes)
  const productRows = [];
  let quiebresProyectados = 0;

  for (const prod of filteredProds) {
    const pid = Number(prod.id);
    const pOpen = Number((Number(prod.stock || 0) - (prodAfterFirstDelta.get(pid) || 0)).toFixed(4));
    let pRun = pOpen;
    const pValues = {};
    const pNetByPer = prodPeriodNet.get(pid);
    const pDetByPer = prodPeriodDetails.get(pid);
    let minProjected = pRun;

    for (const per of periods) {
      pRun = Number((pRun + (pNetByPer[per.key] || 0)).toFixed(4));
      pValues[per.key] = pRun;
      if (per.kind !== 'historico' && pRun < minProjected) {
        minProjected = pRun;
      }
    }
    const minReq = Number(prod.stock_minimo || 0);
    const tieneQuiebre = minProjected < 0 || (minReq > 0 && minProjected <= minReq);
    if (tieneQuiebre) quiebresProyectados++;

    productRows.push({
      id: `prod_${pid}`,
      producto_id: pid,
      label: `${prod.nombre} (${prod.udm || 'un.'})`,
      categoria: prod.categoria,
      udm: prod.udm || 'unidades',
      stock_actual: Number(prod.stock || 0),
      stock_minimo: minReq,
      tiene_quiebre: tieneQuiebre,
      type: tieneQuiebre ? 'net' : 'neutral',
      values: pValues,
      details: pDetByPer,
      total: pRun,
    });
  }

  const stockMinimoRef = Number(filteredProds.reduce((s, p) => s + Number(p.stock_minimo || 0), 0).toFixed(4));

  const chartSeries = periods.map(p => ({
    key: p.key,
    label: p.label,
    sublabel: p.sublabel,
    kind: p.kind,
    isCurrent: p.isCurrent,
    entradas: values.entradas_total[p.key],
    salidas: values.salidas_total[p.key],
    neto: values.flujo_neto[p.key],
    saldo: values.stock_final[p.key],
    minimo: stockMinimoRef,
  }));

  return {
    granularidad,
    hoy: hoyIso,
    producto_seleccionado: producto_id ? (prodMap.get(Number(producto_id)) || null) : null,
    resumen: {
      productos_analizados: filteredProds.length,
      stock_apertura: totals.stock_inicial,
      stock_actual: stockActualTotal,
      entradas_proyectadas: Number(periods.filter(p => p.kind !== 'historico').reduce((s, p) => s + values.in_compras_proy[p.key] + values.in_produccion_proy[p.key], 0).toFixed(4)),
      salidas_proyectadas: Number(periods.filter(p => p.kind !== 'historico').reduce((s, p) => s + values.out_consumo_op_proy[p.key] + values.out_entregas_proy[p.key], 0).toFixed(4)),
      stock_final_proyectado: runningStock,
      stock_minimo_ref: stockMinimoRef,
      quiebres_proyectados: quiebresProyectados,
    },
    periods,
    rows: rowDefs.map(r => ({
      ...r,
      values: values[r.id],
      details: details[r.id],
      total: totals[r.id],
    })),
    product_rows: productRows,
    chart_series: chartSeries,
  };
}
