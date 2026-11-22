import { BaseRepository } from '../../core/BaseRepository.js';
import { convertUnitFromDb } from '../config/configService.js';
import { applicableQtyForLine, getActiveRecetaForPlantilla } from '../produccion/recetaService.js';

export class UbicacionRepository extends BaseRepository {
  constructor() {
    super({
      table: 'ubicaciones',
      defaultOrder: 'tipo ASC, es_default DESC, nombre ASC',
      columns: ['codigo', 'nombre', 'tipo', 'parent_id', 'es_default', 'es_sistema', 'activa'],
    });
  }
}

export class LoteRepository extends BaseRepository {
  constructor() {
    super({
      table: 'lotes',
      defaultOrder: 'created_at DESC, codigo ASC',
      columns: ['codigo', 'producto_id', 'fecha_alta', 'notas'],
    });
  }
}

export class StockQuantRepository extends BaseRepository {
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

export const movimientoStockRepo = new BaseRepository({
  table: 'movimientos_stock',
  columns: [
    'fecha', 'producto_id', 'ubicacion_origen_id', 'ubicacion_destino_id',
    'lote_id', 'lote', 'tipo', 'cantidad', 'stock_resultante',
    'referencia_tipo', 'referencia_id', 'nota',
    'autor_id', 'autor_nombre', 'actualizado_por_id', 'actualizado_por_nombre',
  ],
});

const productoRepo = new BaseRepository({ table: 'productos', columns: ['stock'] });
const vProductoRepo = new BaseRepository({ table: 'v_productos' });
const ordenRepo = new BaseRepository({ table: 'ordenes_produccion' });
const ordenEtapaRepo = new BaseRepository({ table: 'orden_etapas' });
const ordenLineaRepo = new BaseRepository({ table: 'orden_lineas' });
const recetaLineaRepo = new BaseRepository({ table: 'receta_lineas' });

export function getUbicacionByCodigo(codigo) {
  return ubicacionRepo.query().where('codigo', codigo).get();
}

export function isInternalTipo(tipo) {
  return tipo === 'interna' || tipo === 'dedicada';
}

export function resolveLoteEnRepo(repoLote, { producto_id, lote = '', lote_id = null }) {
  if (lote_id) {
    const found = repoLote.findById(Number(lote_id));
    if (found) return found;
  }
  const clean = String(lote || '').trim();
  const prodId = producto_id ? Number(producto_id) : null;
  if (!clean || !prodId) return null;
  const matches = repoLote.findWhere({ producto_id: prodId, codigo: clean }, { limit: 1 });
  let existing = matches[0] || null;
  if (!existing) {
    const newId = repoLote.create({ codigo: clean, producto_id: prodId });
    existing = repoLote.findById(newId);
  }
  return existing;
}

export function upsertQuant({ producto_id, ubicacion_id, lote = '', lote_id = null, delta = 0 }) {
  if (!ubicacion_id || !delta || !producto_id) return;
  const loteRow = resolveLoteEnRepo(loteRepo, { producto_id, lote, lote_id });
  const cleanLote = loteRow ? loteRow.codigo : String(lote || '').trim();
  const resolvedLoteId = loteRow ? loteRow.id : null;
  const existing = stockQuantRepo.query()
    .select('id, cantidad, lote_id')
    .where('producto_id', producto_id)
    .where('ubicacion_id', ubicacion_id)
    .where('lote', cleanLote)
    .get();
  if (existing) {
    const nextQty = Number(((Number(existing.cantidad) || 0) + delta).toFixed(4));
    stockQuantRepo.update(existing.id, {
      cantidad: nextQty,
      lote_id: existing.lote_id ?? resolvedLoteId,
    });
  } else {
    stockQuantRepo.create({
      producto_id,
      ubicacion_id,
      lote_id: resolvedLoteId,
      lote: cleanLote,
      cantidad: Number(delta.toFixed(4)),
    });
  }
}

export function getInternalStockTotal(producto_id) {
  const total = stockQuantRepo.query('sq')
    .innerJoin('ubicaciones', 'u', 'u.id', 'sq.ubicacion_id')
    .whereIn('u.tipo', ['interna', 'dedicada'])
    .where('sq.producto_id', producto_id)
    .sum('sq.cantidad');
  return Number((Number(total) || 0).toFixed(4));
}

export function resolveOrigenDestino({ tipo, cantidad, ubicacion_origen_id, ubicacion_destino_id }) {
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
    ? vProductoRepo.query('p')
        .select('p.id, p.sku, p.nombre, p.stock, pt.tipo, pt.udm, pt.categoria')
        .innerJoin('v_plantillas', 'pt', 'pt.id', 'p.plantilla_id')
        .where('p.id', Number(producto_id))
        .get()
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
  const loteRow = resolveLoteEnRepo(loteRepo, { producto_id: prodId, lote, lote_id });
  const cleanLote = loteRow ? loteRow.codigo : String(lote || '').trim();
  const resolvedLoteId = loteRow ? loteRow.id : null;

  if (origenId) upsertQuant({ producto_id: prodId, ubicacion_id: origenId, lote: cleanLote, lote_id: resolvedLoteId, delta: -qty });
  if (destinoId) upsertQuant({ producto_id: prodId, ubicacion_id: destinoId, lote: cleanLote, lote_id: resolvedLoteId, delta: qty });

  const nuevoStock = getInternalStockTotal(prodId);
  productoRepo.update(prodId, { stock: nuevoStock });

  const origenTipo = origenId ? ubicacionRepo.query().select('tipo').where('id', origenId).get()?.tipo : null;
  const destinoTipo = destinoId ? ubicacionRepo.query().select('tipo').where('id', destinoId).get()?.tipo : null;
  let signedDelta = rawQty;
  if (origenTipo === 'virtual' && isInternalTipo(destinoTipo)) signedDelta = qty;
  else if (isInternalTipo(origenTipo) && destinoTipo === 'virtual') signedDelta = -qty;
  else if (isInternalTipo(origenTipo) && isInternalTipo(destinoTipo)) signedDelta = qty;

  return movimientoStockRepo.create({
    fecha: fecha || new Date().toISOString().slice(0, 10),
    producto_id: prodId,
    ubicacion_origen_id: origenId,
    ubicacion_destino_id: destinoId,
    lote_id: resolvedLoteId,
    lote: cleanLote,
    tipo,
    cantidad: Number(signedDelta.toFixed(4)),
    stock_resultante: nuevoStock,
    referencia_tipo,
    referencia_id: referencia_id ? Number(referencia_id) : null,
    nota,
    autor_id: user?.id || null,
    autor_nombre: user?.nombre || 'Sistema',
    actualizado_por_id: user?.id || null,
    actualizado_por_nombre: user?.nombre || 'Sistema',
  });
}

export function computeStockReservadoPorOrdenes() {
  const ordenes = ordenRepo.query('op')
    .select('op.*')
    .whereIn('op.estado', ['Planificada', 'En Proceso'])
    .all();

  const reservado = new Map();
  for (const op of ordenes) {
    const etapasPendientes = ordenEtapaRepo.query()
      .where('orden_id', op.id)
      .where('stock_consumido', 0)
      .all();
    if (etapasPendientes.length === 0) continue;

    const pendingEtapaIds = new Set(etapasPendientes.map(e => e.etapa_id).filter(Boolean));
    const pendingRecetaEtapaIds = new Set(etapasPendientes.map(e => e.receta_etapa_id).filter(Boolean));
    const recetaId = op.receta_id || getActiveRecetaForPlantilla(op.plantilla_id)?.id;

    const ordenLineas = ordenLineaRepo.query('ol')
      .select('ol.*, p.combinacion_json')
      .innerJoin('productos', 'p', 'p.id', 'ol.producto_id')
      .where('ol.orden_id', op.id)
      .all();

    if (recetaId) {
      const lineas = recetaLineaRepo.query('rl')
        .select('rl.*, p.plantilla_id as prod_plantilla_id, pt.udm')
        .innerJoin('productos', 'p', 'p.id', 'rl.producto_id')
        .innerJoin('v_plantillas', 'pt', 'pt.id', 'p.plantilla_id')
        .where('rl.receta_id', recetaId)
        .where('pt.tipo', '!=', 'servicio')
        .all();

      for (const l of lineas) {
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
  const productos = vProductoRepo.query('p')
    .select("p.*, pt.nombre as plantilla_nombre, pt.tipo, pt.categoria, pt.udm, pt.alicuota_iva, pt.se_compra, pt.se_fabrica, COALESCE(pt.lead_time_dias, 0) as lead_time_dias, pt.proveedor_id, COALESCE(c.nombre, '') as proveedor_nombre")
    .innerJoin('v_plantillas', 'pt', 'pt.id', 'p.plantilla_id')
    .leftJoin('contactos', 'c', 'c.id', 'pt.proveedor_id')
    .where('p.activo', 1)
    .where('pt.tipo', '!=', 'servicio')
    .orderBy('pt.categoria', 'ASC')
    .orderBy('p.nombre', 'ASC')
    .all();

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
