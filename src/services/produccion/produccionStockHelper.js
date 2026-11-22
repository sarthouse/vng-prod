import { BaseRepository } from '../../core/BaseRepository.js';
import { convertUnitFromDb } from '../config/configService.js';
import { resolveVariantForPlantilla } from './presupuestoService.js';
import { applicableQtyForLine, getActiveRecetaForPlantilla } from './recetaService.js';
import { createOperacionStock, deleteOperacionStock } from '../inventario/operacionStockService.js';
import { createOrdenCompra } from '../comercial/ordenCompraService.js';

const recetaLineaRepo = new BaseRepository({ table: 'receta_lineas' });
const ordenLineaRepo = new BaseRepository({ table: 'orden_lineas' });
const vProductoRepo = new BaseRepository({ table: 'v_productos' });
const ubicacionRepo = new BaseRepository({ table: 'ubicaciones' });
const stockQuantRepo = new BaseRepository({ table: 'stock_quants' });
const operacionStockRepo = new BaseRepository({ table: 'operaciones_stock' });
const opLineaRepo = new BaseRepository({ table: 'operacion_stock_lineas' });

/**
 * Prorratea una cantidad total entre las líneas de una orden de producción.
 */
export function distribuirCantidadEnLineas(oLineas, totalQty) {
  const result = new Map();
  const qty = Math.max(0, Number(totalQty) || 0);
  if (!oLineas.length || qty <= 0) return result;
  if (oLineas.length === 1) {
    result.set(Number(oLineas[0].producto_id), Number(qty.toFixed(4)));
    return result;
  }
  const sumOrden = oLineas.reduce((s, ol) => s + Math.max(0, Number(ol.cantidad || 0)), 0);
  if (sumOrden <= 0) return result;
  let restante = qty;
  oLineas.forEach((ol, idx) => {
    const prodId = Number(ol.producto_id);
    const share = idx === oLineas.length - 1
      ? restante
      : Number(Math.min(restante, (qty * Number(ol.cantidad || 0)) / sumOrden).toFixed(4));
    restante = Number(Math.max(0, restante - share).toFixed(4));
    if (share > 0) result.set(prodId, (result.get(prodId) || 0) + share);
  });
  return result;
}

/**
 * Explota una línea de receta según las variantes de la orden de producción.
 */
export function explodeRecetaLineForOrden(line, ordenLineas, udmCompra) {
  let vars = [];
  try { vars = JSON.parse(line.variantes_json || '[]'); } catch { vars = []; }
  const conv = convertUnitFromDb(line.coeficiente, line.udm_receta || udmCompra, udmCompra);

  if (Number(line.emparejar_variante) !== 1) {
    let pares = 0;
    for (const ol of ordenLineas) pares += applicableQtyForLine(ol, ol.cantidad, vars);
    if (pares <= 0) return [];
    return [{
      producto_id: line.producto_id,
      producto_nombre: line.producto_nombre,
      stock: line.stock,
      qty: Number((conv * pares).toFixed(4)),
    }];
  }

  const byProd = new Map();
  for (const ol of ordenLineas) {
    const pares = applicableQtyForLine(ol, ol.cantidad, vars);
    if (pares <= 0) continue;
    let combo = {};
    try { combo = JSON.parse(ol.combinacion_json || '{}'); } catch { combo = {}; }
    const matched = line.prod_plantilla_id ? resolveVariantForPlantilla(line.prod_plantilla_id, combo) : null;
    const targetId = matched ? matched.id : line.producto_id;
    const prev = byProd.get(targetId);
    const addQty = conv * pares;
    if (prev) {
      prev.qty += addQty;
    } else {
      byProd.set(targetId, {
        producto_id: targetId,
        producto_nombre: matched ? matched.nombre : line.producto_nombre,
        stock: matched ? matched.stock : line.stock,
        qty: addQty,
      });
    }
  }
  return Array.from(byProd.values()).map(r => ({ ...r, qty: Number(r.qty.toFixed(4)) }));
}

/**
 * Planifica remitos a taller en Borrador y compras en Borrador por faltantes al crear una orden.
 */
export function planificarDocumentosOrden({ ordenId, codigo, fechaInicio, insumos = [], user = null }) {
  if (!insumos || insumos.length === 0) return;

  const remitoLineas = [];
  const comprasPorProveedor = new Map();

  for (const ins of insumos) {
    if (ins.producto_tipo === 'servicio') continue;
    const req = Number(ins.cantidad_requerida || 0);
    if (req <= 0) continue;

    const prod = vProductoRepo.query('p')
      .select('p.id, p.costo, p.precio, p.minimo_compra, p.stock, pt.proveedor_id, pt.alicuota_iva')
      .innerJoin('producto_plantillas', 'pt', 'pt.id', 'p.plantilla_id')
      .where('p.id', ins.producto_id)
      .get();
    if (!prod) continue;

    const disponible = Math.max(0, Number(prod.stock ?? ins.stock_actual ?? 0));
    const aEntregar = Number(Math.min(req, disponible).toFixed(4));
    const faltante = Number(Math.max(0, req - disponible).toFixed(4));

    if (aEntregar > 0) {
      remitoLineas.push({
        producto_id: ins.producto_id,
        descripcion: ins.producto_nombre,
        cantidad: aEntregar,
        udm: ins.udm || 'unidades',
      });
    }

    if (faltante > 0 && prod.proveedor_id) {
      const minimo = Number(prod.minimo_compra || 0);
      const qtyComprar = minimo > 0 ? Math.max(faltante, minimo) : faltante;
      if (!comprasPorProveedor.has(prod.proveedor_id)) {
        comprasPorProveedor.set(prod.proveedor_id, []);
      }
      comprasPorProveedor.get(prod.proveedor_id).push({
        producto_id: ins.producto_id,
        descripcion: ins.producto_nombre,
        cantidad: qtyComprar,
        udm: ins.udm || 'unidades',
        precio_unitario: Number(prod.costo || prod.precio || 0),
        alicuota_iva: Number(prod.alicuota_iva ?? 21),
      });
    }
  }

  if (remitoLineas.length > 0) {
    createOperacionStock({
      fecha: fechaInicio,
      tipo: 'remito_taller',
      referencia_tipo: 'orden',
      referencia_id: ordenId,
      estado: 'Borrador',
      motivo: `Entrega materiales ${codigo}`,
      lineas: remitoLineas,
    }, user);
  }

  for (const [proveedorId, cLineas] of comprasPorProveedor.entries()) {
    createOrdenCompra({
      proveedor_id: proveedorId,
      origen_tipo: 'orden',
      origen_id: ordenId,
      fecha: fechaInicio,
      estado: 'Borrador',
      observaciones: `Generado automáticamente por faltante en ${codigo}`,
      lineas: cLineas,
    }, user);
  }
}

/**
 * Descuenta de los remitos a taller en Borrador los insumos ya consumidos directamente desde DEP-CENTRAL.
 */
export function reconciliarRemitosTallerBorrador(ordenId, depItems) {
  if (!depItems || depItems.length === 0) return;
  const remitos = operacionStockRepo.query()
    .where('referencia_tipo', 'orden')
    .where('referencia_id', Number(ordenId))
    .where('tipo', 'remito_taller')
    .where('estado', 'Borrador')
    .all();
  if (remitos.length === 0) return;

  const porDescontar = new Map();
  for (const it of depItems) {
    const pid = Number(it.producto_id);
    porDescontar.set(pid, (porDescontar.get(pid) || 0) + Number(it.cantidad || 0));
  }

  for (const rem of remitos) {
    const lineas = opLineaRepo.query().where('operacion_id', rem.id).all();
    let quedanLineas = false;
    for (const rl of lineas) {
      const pid = Number(rl.producto_id);
      const pend = porDescontar.get(pid) || 0;
      if (pend <= 0) {
        if (Number(rl.cantidad || 0) > 0) quedanLineas = true;
        continue;
      }
      const origQty = Number(rl.cantidad || 0);
      const descontado = Math.min(origQty, pend);
      const nuevaQty = Number((origQty - descontado).toFixed(4));
      porDescontar.set(pid, Number((pend - descontado).toFixed(4)));
      if (nuevaQty > 0.0001) {
        opLineaRepo.update(rl.id, { cantidad: nuevaQty });
        quedanLineas = true;
      } else {
        opLineaRepo.delete(rl.id);
      }
    }
    if (!quedanLineas) {
      deleteOperacionStock(rem.id);
    }
  }
}

/**
 * Consume los insumos de una etapa completada desde TALLER-EXT (prioridad) y DEP-CENTRAL.
 */
export function consumirInsumosEtapa({ orden, etapa, ordenLineas, fecha, user = null }) {
  const oLineas = ordenLineas || ordenLineaRepo.query('ol')
    .select('ol.*, p.combinacion_json')
    .innerJoin('productos', 'p', 'p.id', 'ol.producto_id')
    .where('ol.orden_id', orden.id)
    .all();

  const recetaId = orden.receta_id || getActiveRecetaForPlantilla(
    orden.plantilla_id,
    oLineas.length === 1 ? oLineas[0].producto_id : null,
  )?.id;

  if (!recetaId || (!etapa.receta_etapa_id && !etapa.etapa_id)) return;

  const allRLineas = recetaLineaRepo.query('rl')
    .select('rl.*, p.plantilla_id as prod_plantilla_id, p.nombre as producto_nombre, p.stock, pt.udm, pt.tipo')
    .innerJoin('v_productos', 'p', 'p.id', 'rl.producto_id')
    .innerJoin('v_plantillas', 'pt', 'pt.id', 'p.plantilla_id')
    .where('rl.receta_id', recetaId)
    .where('pt.tipo', '!=', 'servicio')
    .all();

  const rLineas = allRLineas.filter(l =>
    (etapa.receta_etapa_id && Number(l.receta_etapa_id) === Number(etapa.receta_etapa_id))
    || (etapa.etapa_id && Number(l.etapa_id) === Number(etapa.etapa_id))
  );

  const tallerExtId = ubicacionRepo.query().select('id').where('codigo', 'TALLER-EXT').get()?.id || null;
  const depCentralId = ubicacionRepo.query().select('id').where('codigo', 'DEP-CENTRAL').get()?.id || null;
  const virtProdId = ubicacionRepo.query().select('id').where('codigo', 'VIRT-PROD').get()?.id
    || ubicacionRepo.query().select('id').where('codigo', 'VIRT-CLI').get()?.id
    || null;

  const tallerItems = [];
  const depItems = [];

  for (const l of rLineas) {
    const exploded = explodeRecetaLineForOrden(l, oLineas, l.udm);
    for (const item of exploded) {
      if (item.qty <= 0) continue;
      let qtyTaller = 0;
      if (tallerExtId) {
        qtyTaller = Math.max(0, Number(
          stockQuantRepo.query().where('producto_id', item.producto_id).where('ubicacion_id', tallerExtId).sum('cantidad') || 0
        ));
      }
      const fromTaller = Math.min(item.qty, qtyTaller);
      const fromDep = Number((item.qty - fromTaller).toFixed(4));

      if (fromTaller > 0) {
        tallerItems.push({ producto_id: item.producto_id, cantidad: fromTaller, udm: l.udm || 'unidades', lote: orden.codigo });
      }
      if (fromDep > 0) {
        depItems.push({ producto_id: item.producto_id, cantidad: fromDep, udm: l.udm || 'unidades', lote: orden.codigo });
      }
    }
  }

  if (tallerItems.length > 0 && tallerExtId && virtProdId) {
    createOperacionStock({
      fecha,
      tipo: 'entrega',
      ubicacion_origen_id: tallerExtId,
      ubicacion_destino_id: virtProdId,
      referencia_tipo: 'orden',
      referencia_id: orden.id,
      estado: 'Confirmado',
      motivo: `Consumo ${orden.codigo} · Etapa ${etapa.nombre} (Taller)`,
      lineas: tallerItems,
    }, user);
  }

  if (depItems.length > 0 && depCentralId && virtProdId) {
    createOperacionStock({
      fecha,
      tipo: 'entrega',
      ubicacion_origen_id: depCentralId,
      ubicacion_destino_id: virtProdId,
      referencia_tipo: 'orden',
      referencia_id: orden.id,
      estado: 'Confirmado',
      motivo: `Consumo ${orden.codigo} · Etapa ${etapa.nombre}`,
      lineas: depItems,
    }, user);
    reconciliarRemitosTallerBorrador(orden.id, depItems);
  }
}

/**
 * Registra una operación de ajuste/merma confirmada (VIRT-PROD -> VIRT-AJUSTE) para trazabilidad.
 */
export function registrarMermaEtapa({ orden, etapa, ordenLineas, cantidadMerma, fecha, user = null }) {
  if (!(cantidadMerma > 0)) return null;
  const virtProdId = ubicacionRepo.query().select('id').where('codigo', 'VIRT-PROD').get()?.id || null;
  const virtAjusteId = ubicacionRepo.query().select('id').where('codigo', 'VIRT-AJUSTE').get()?.id || null;
  if (!virtProdId || !virtAjusteId) return null;

  const mermaMap = distribuirCantidadEnLineas(ordenLineas, cantidadMerma);
  const mermaLineas = Array.from(mermaMap.entries()).map(([producto_id, cantidad]) => ({
    producto_id,
    cantidad,
    lote: orden.codigo,
  }));
  if (mermaLineas.length === 0) return null;

  return createOperacionStock({
    fecha,
    tipo: 'ajuste',
    ubicacion_origen_id: virtProdId,
    ubicacion_destino_id: virtAjusteId,
    referencia_tipo: 'orden',
    referencia_id: orden.id,
    estado: 'Confirmado',
    motivo: `Merma ${orden.codigo} · Etapa ${etapa.nombre}`,
    lineas: mermaLineas,
  }, user);
}
