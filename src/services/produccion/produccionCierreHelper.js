import { BaseRepository } from '../../core/BaseRepository.js';
import { createOperacionStock } from '../inventario/operacionStockService.js';
import { distribuirCantidadEnLineas } from './produccionStockHelper.js';

const movimientoStockRepo = new BaseRepository({ table: 'movimientos_stock' });
const opLineaRepo = new BaseRepository({ table: 'operacion_stock_lineas' });
const ubicacionRepo = new BaseRepository({ table: 'ubicaciones' });
const vProductoRepo = new BaseRepository({ table: 'v_productos' });
const ordenLineaRepo = new BaseRepository({ table: 'orden_lineas' });
const ordenEtapaRepo = new BaseRepository({ table: 'orden_etapas' });

/**
 * Obtiene el mapa de cantidades ya ingresadas a stock para una orden (legacy + operaciones confirmadas).
 */
export function getIngresadoPorOrdenMap(ordenId) {
  const ingresadaMap = new Map();
  const ingresosLegacy = movimientoStockRepo.query('ms')
    .select('ms.producto_id, ms.cantidad')
    .where('ms.referencia_tipo', 'orden_produccion')
    .where('ms.referencia_id', ordenId)
    .where('ms.tipo', 'ingreso_produccion')
    .all();
  for (const ing of ingresosLegacy) {
    ingresadaMap.set(Number(ing.producto_id), (ingresadaMap.get(Number(ing.producto_id)) || 0) + Number(ing.cantidad || 0));
  }
  const ingresosOps = opLineaRepo.query('ol')
    .select('ol.producto_id, ol.cantidad')
    .innerJoin('operaciones_stock', 'os', 'os.id', 'ol.operacion_id')
    .where('os.referencia_tipo', 'orden')
    .where('os.referencia_id', ordenId)
    .where('os.tipo', 'recepcion')
    .where('os.estado', 'Confirmado')
    .all();
  for (const ing of ingresosOps) {
    ingresadaMap.set(Number(ing.producto_id), (ingresadaMap.get(Number(ing.producto_id)) || 0) + Number(ing.cantidad || 0));
  }
  return ingresadaMap;
}

/**
 * SSOT del cálculo de remanente neto disponible para ingresar a PROD-TERM:
 * ol.cantidad - mermasAcumuladas - yaIngresado.
 */
export function getRemanenteIngresoOrden(ordenId, { ordenLineas = null, etapas = null } = {}) {
  const oLineas = ordenLineas || ordenLineaRepo.query().select('producto_id, cantidad').where('orden_id', Number(ordenId)).all();
  const etapasList = etapas || ordenEtapaRepo.query().select('estado, cantidad_merma').where('orden_id', Number(ordenId)).all();
  const ingresadaMap = getIngresadoPorOrdenMap(Number(ordenId));
  const totalMerma = etapasList.reduce((s, e) => s + Math.max(0, Number(e.cantidad_merma || 0)), 0);
  const mermaPorProd = distribuirCantidadEnLineas(oLineas, totalMerma);

  return oLineas
    .map(ol => {
      const pid = Number(ol.producto_id);
      const cantNeto = Number(ol.cantidad || 0) - Number(mermaPorProd.get(pid) || 0) - Number(ingresadaMap.get(pid) || 0);
      return {
        producto_id: ol.producto_id,
        cantidad: Number(Math.max(0, cantNeto).toFixed(4)),
      };
    })
    .filter(it => it.cantidad > 0);
}

/**
 * Crea y confirma la operación de recepción de producto terminado (VIRT-PROD -> PROD-TERM).
 */
export function createIngresoTerminadoOperacion(orden, items, { fecha, destUbi = null, lote = '', motivo = '', user = null } = {}) {
  const validItems = (items || []).filter(it => Number(it.cantidad) > 0);
  if (validItems.length === 0) return null;
  const origId = ubicacionRepo.query().select('id').where('codigo', 'VIRT-PROD').get()?.id
    || ubicacionRepo.query().select('id').where('codigo', 'VIRT-PROV').get()?.id
    || null;
  const destId = destUbi
    ? Number(destUbi)
    : (ubicacionRepo.query().select('id').where('codigo', 'PROD-TERM').get()?.id
      || ubicacionRepo.query().select('id').where('codigo', 'DEP-CENTRAL').get()?.id
      || null);
  return createOperacionStock({
    fecha: fecha || new Date().toISOString().slice(0, 10),
    tipo: 'recepcion',
    ubicacion_origen_id: origId,
    ubicacion_destino_id: destId,
    referencia_tipo: 'orden',
    referencia_id: orden.id,
    estado: 'Confirmado',
    motivo: motivo || `Ingreso Prod. Terminado ${orden.codigo}`,
    lineas: validItems.map(it => {
      const pInfo = vProductoRepo.query('p')
        .select('pt.udm')
        .innerJoin('v_plantillas', 'pt', 'pt.id', 'p.plantilla_id')
        .where('p.id', Number(it.producto_id))
        .get();
      return {
        producto_id: it.producto_id,
        cantidad: Number(it.cantidad),
        udm: pInfo?.udm || 'unidades',
        lote: lote || orden.codigo || '',
      };
    }),
  }, user);
}

/**
 * Ingresa automáticamente el remanente neto de producto terminado al completar todas las etapas de la orden.
 */
export function ingresarRemanenteAlCompletarOrden({ orden, etapas, fecha, user = null }) {
  const remItems = getRemanenteIngresoOrden(orden.id, { etapas });
  if (remItems.length === 0) return null;
  return createIngresoTerminadoOperacion(orden, remItems, {
    fecha,
    lote: orden.codigo,
    motivo: `Ingreso Prod. Terminado ${orden.codigo}`,
    user,
  });
}

/**
 * Registra un ingreso parcial explícito de producto terminado para la orden.
 */
export function ingresarParcialOrden({ orden, lineas, reqMap, fecha, destUbi, lote, nota, user = null }) {
  const items = [];
  let totalIngresadoAhora = 0;
  for (const ol of lineas) {
    const cant = reqMap.has(Number(ol.producto_id))
      ? Math.max(0, Number(reqMap.get(Number(ol.producto_id))) || 0)
      : 0;
    if (cant <= 0) continue;
    items.push({ producto_id: ol.producto_id, cantidad: cant });
    totalIngresadoAhora += cant;
  }

  if (totalIngresadoAhora <= 0) {
    throw new Error('Ingresá una cantidad mayor a 0 en al menos una variante');
  }

  const opId = createIngresoTerminadoOperacion(orden, items, {
    fecha,
    destUbi,
    lote,
    motivo: nota ? `${orden.codigo} · ${nota}` : `Ingreso parcial Prod. Terminado ${orden.codigo}`,
    user,
  });
  return { ingresado: totalIngresadoAhora, operacion_id: opId };
}
