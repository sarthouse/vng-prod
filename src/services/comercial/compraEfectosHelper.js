import { BaseRepository } from '../../core/BaseRepository.js';
import { MODELS } from '../../db/models.js';
import { anularOperacionStock, createOperacionStock, deleteOperacionStock, operacionStockRepo } from '../inventario/operacionStockService.js';
import { defaultAsientoService } from '../finanzas/asientoService.js';
import { registrarHistorialCostoPrecio } from '../inventario/productoService.js';

const compraRepo = new BaseRepository({ model: MODELS.compras });
const productoRepo = new BaseRepository({ model: MODELS.productos });
const ubicacionRepo = new BaseRepository({ model: MODELS.ubicaciones });

export function getPlantillaForProducto(productoId) {
  return productoRepo.query('p')
    .select('pt.tipo', 'pt.cuenta_compra_id')
    .innerJoin('producto_plantillas', 'pt', 'pt.id', 'p.plantilla_id')
    .where('p.id', Number(productoId))
    .get();
}

export function createCompraOperacion(compra, lineas, recibirInmediato = false, user = null) {
  const stockLines = (lineas || []).filter(l => {
    if (!l.producto_id || l.cantidad <= 0) return false;
    const row = getPlantillaForProducto(l.producto_id);
    return row?.tipo !== 'servicio';
  });
  if (stockLines.length === 0) return null;

  const isNC = compra.clase_documento === 'nota_credito';
  const depId = compra.ubicacion_id || ubicacionRepo.query().select('id').where('codigo', 'DEP-CENTRAL').get()?.id || null;
  const provUbiId = ubicacionRepo.query().select('id').where('codigo', 'VIRT-PROV').get()?.id || null;

  return createOperacionStock({
    fecha: compra.fecha,
    tipo: isNC ? 'entrega' : 'recepcion',
    ubicacion_origen_id: isNC ? depId : provUbiId,
    ubicacion_destino_id: isNC ? provUbiId : depId,
    contacto_id: compra.contacto_id,
    referencia_tipo: 'compra',
    referencia_id: compra.id,
    estado: recibirInmediato ? 'Confirmado' : 'Borrador',
    motivo: `${isNC ? 'Devolución NC' : 'Recepción'} ${compra.numero || `Compra #${compra.id}`}`,
    lineas: stockLines.map(l => ({
      producto_id: l.producto_id,
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      udm: l.udm,
    })),
  }, user);
}

export function generarYGuardarAsientoCompra(compraData, impuestos, lineas, user = null) {
  if (!(Number(compraData.total) > 0)) return null;
  const asientoId = defaultAsientoService.generarAsientoCompra(compraData, impuestos, lineas);
  if (asientoId) compraRepo.update(Number(compraData.id), { asiento_id: asientoId }, user);
  return asientoId;
}

export function anularEfectosCompra({ id, asientoId = null, user = null }) {
  const ops = operacionStockRepo.query()
    .where('referencia_tipo', 'compra')
    .where('referencia_id', Number(id))
    .all();
  for (const op of ops) {
    if (op.estado === 'Confirmado') anularOperacionStock(op.id, user);
    else if (op.estado === 'Borrador') deleteOperacionStock(op.id);
  }
  if (asientoId) {
    try { defaultAsientoService.revertirAsiento(asientoId, { motivo: 'Anulación de compra' }); }
    catch { /* si ya fue revertido o no existe, continuar */ }
  }
}

export function syncUltimoCostoProductos(lineas, { compraId = null, numero = '', user = null } = {}) {
  for (const l of lineas || []) {
    const pid = Number(l.producto_id || 0);
    const costo = Number(l.precio_unitario || 0);
    if (pid > 0 && costo > 0) {
      const prev = productoRepo.findById(pid);
      if (prev) {
        productoRepo.update(pid, { costo });
        registrarHistorialCostoPrecio({
          producto_id: prev.id,
          plantilla_id: prev.plantilla_id,
          costo_anterior: prev.costo ?? 0,
          costo_nuevo: costo,
          precio_anterior: prev.precio ?? 0,
          precio_nuevo: prev.precio ?? 0,
          origen: 'compra',
          referencia_tipo: 'compra',
          referencia_id: compraId,
          observacion: numero ? `Compra ${numero}` : 'Confirmación de compra',
          user,
        });
      }
    }
  }
}
