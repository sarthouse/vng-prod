import { BaseRepository } from '../../core/BaseRepository.js';
import { MODELS } from '../../db/models.js';
import {
  anularOperacionStock,
  confirmarOperacionStock,
  createOperacionStock,
  deleteOperacionStock,
  operacionStockRepo,
} from '../inventario/operacionStockService.js';
import { defaultAsientoService } from '../finanzas/asientoService.js';
import { crearImputacion, getFacturaImputado } from '../finanzas/imputacionService.js';
import { resolverPrecioCompra } from './condicionesComercialesService.js';
import { createOrdenCompra } from './ordenCompraService.js';
import { listProductos } from '../inventario/productoService.js';

const ventaRepo = new BaseRepository({ model: MODELS.ventas });
const productoRepo = new BaseRepository({ model: MODELS.productos });
const prodProvRepo = new BaseRepository({ model: MODELS.producto_proveedores });
const ubicacionRepo = new BaseRepository({ model: MODELS.ubicaciones });

export function getPlantillaForProducto(productoId) {
  return productoRepo.query('p')
    .select('pt.tipo', 'pt.cuenta_venta_id', 'pt.cuenta_compra_id')
    .innerJoin('producto_plantillas', 'pt', 'pt.id', 'p.plantilla_id')
    .where('p.id', Number(productoId))
    .get();
}

export function createVentaOperacion(venta, lineas, confirmar = false, user = null) {
  const stockLines = (lineas || []).filter(l => {
    if (!l.producto_id || l.cantidad <= 0) return false;
    if (l.tipo_linea && l.tipo_linea !== 'producto') return false;
    const row = getPlantillaForProducto(l.producto_id);
    return !row || row.tipo !== 'servicio';
  });
  if (stockLines.length === 0) return null;

  const isNC = venta.clase_documento === 'nota_credito';
  const prodTermId = venta.ubicacion_id
    || ubicacionRepo.query().select('id').where('codigo', 'PROD-TERM').get()?.id
    || ubicacionRepo.query().select('id').where('codigo', 'DEP-CENTRAL').get()?.id
    || null;
  const cliUbiId = ubicacionRepo.query().select('id').where('codigo', 'VIRT-CLI').get()?.id || null;

  return createOperacionStock({
    fecha: venta.fecha,
    tipo: isNC ? 'recepcion' : 'entrega',
    ubicacion_origen_id: isNC ? cliUbiId : prodTermId,
    ubicacion_destino_id: isNC ? prodTermId : cliUbiId,
    contacto_id: venta.contacto_id,
    referencia_tipo: 'venta',
    referencia_id: venta.id,
    estado: confirmar ? 'Confirmado' : 'Borrador',
    motivo: `${isNC ? 'Devolución NC' : 'Entrega'} ${venta.numero || `Venta #${venta.id}`}`,
    lineas: stockLines.map(l => ({
      producto_id: l.producto_id,
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      udm: l.udm,
    })),
  }, user);
}

export function dispararAbastecimientoVenta(venta, lineas, user = null) {
  if (venta.clase_documento === 'nota_credito') return [];
  const prodMap = new Map(listProductos().map(p => [p.id, p]));
  const comprasPorProveedor = new Map();

  for (const l of (lineas || [])) {
    if (!l.producto_id || l.cantidad <= 0) continue;
    const prod = prodMap.get(Number(l.producto_id));
    if (!prod || prod.tipo === 'servicio') continue;

    const disponible = Math.max(0, Number(prod.stock) || 0);
    const faltante = Number(l.cantidad) - disponible;
    if (faltante > 0 && Number(prod.se_compra) === 1 && Number(prod.se_fabrica) === 0) {
      let provId = prod.proveedor_id ? Number(prod.proveedor_id) : 0;
      if (!provId) {
        const pp = prodProvRepo.query()
          .select('contacto_id')
          .where('producto_id', prod.id)
          .where('activo', 1)
          .orderBy('prioridad', 'ASC')
          .orderBy('id', 'ASC')
          .limit(1)
          .get()
          || prodProvRepo.query()
            .select('contacto_id')
            .whereNull('producto_id')
            .where('plantilla_id', prod.plantilla_id || 0)
            .where('activo', 1)
            .orderBy('prioridad', 'ASC')
            .orderBy('id', 'ASC')
            .limit(1)
            .get();
        if (pp?.contacto_id) provId = Number(pp.contacto_id);
      }
      if (!provId) continue;
      const cantComprar = Math.max(faltante, Number(prod.minimo_compra) || 0);
      const resuelto = resolverPrecioCompra({
        contacto_id: provId,
        producto_id: prod.id,
        cantidad: cantComprar,
        precio_base: Number(prod.costo || prod.precio) || 0,
      });
      if (!comprasPorProveedor.has(provId)) comprasPorProveedor.set(provId, []);
      comprasPorProveedor.get(provId).push({
        producto_id: prod.id,
        descripcion: prod.nombre,
        cantidad: Number(cantComprar.toFixed(2)),
        udm: prod.udm || l.udm || 'unidades',
        precio_unitario: Number(resuelto.precio_unitario || prod.costo || prod.precio) || 0,
        alicuota_iva: Number(prod.alicuota_iva ?? 21),
      });
    }
  }

  const createdIds = [];
  for (const [provId, cmpLineas] of comprasPorProveedor.entries()) {
    const ocId = createOrdenCompra({
      proveedor_id: provId,
      origen_tipo: 'venta',
      origen_id: venta.id,
      fecha: venta.fecha,
      estado: 'Borrador',
      observaciones: `Abastecimiento Retail por Venta ${venta.numero || `#${venta.id}`}`,
      lineas: cmpLineas,
    }, user);
    createdIds.push(ocId);
  }
  return createdIds;
}

export function generarYGuardarAsientoVenta({
  id, numero, fecha, claseDocumento, diarioId, caracter, tipoComprobante,
  contactoId, neto, ivaMonto, total, impuestos, lineas, user = null,
}) {
  if (!(total > 0)) return null;
  const lineasConCuenta = (lineas || []).map(l => {
    if (l.producto_id) {
      const ptCta = getPlantillaForProducto(l.producto_id);
      if (ptCta?.cuenta_venta_id) return { ...l, plan_cuenta_id: ptCta.cuenta_venta_id };
    }
    return l;
  });
  const asientoId = defaultAsientoService.generarAsientoVenta({
    id: Number(id),
    numero,
    fecha,
    clase_documento: claseDocumento,
    diario_id: diarioId,
    caracter,
    tipo_comprobante: tipoComprobante,
    contacto_id: contactoId,
    neto,
    iva_monto: ivaMonto,
    total,
  }, impuestos, lineasConCuenta);
  if (asientoId) ventaRepo.update(Number(id), { asiento_id: asientoId }, user);
  return asientoId;
}

export function aplicarImputacionNotaCreditoVenta({ id, fecha, total, comprobanteOrigenId }) {
  if (!comprobanteOrigenId) return;
  const facOrig = ventaRepo.findById(Number(comprobanteOrigenId));
  if (!facOrig) return;
  const pend = Math.max(0, Number(facOrig.total || 0) - getFacturaImputado('ventas', facOrig.id));
  const aImputar = Number(Math.min(total, pend).toFixed(2));
  if (aImputar > 0) {
    crearImputacion({
      fecha,
      dominio: 'ventas',
      comprobante_tipo: 'nota_credito',
      comprobante_id: id,
      factura_id: facOrig.id,
      monto_imputado: aImputar,
    });
  }
}

export function anularEfectosVenta({ id, asientoId = null, user = null }) {
  const ops = operacionStockRepo.query()
    .where('referencia_tipo', 'venta')
    .where('referencia_id', Number(id))
    .all();
  for (const op of ops) {
    if (op.estado === 'Confirmado') anularOperacionStock(op.id, user);
    else if (op.estado === 'Borrador') deleteOperacionStock(op.id);
  }
  if (asientoId) {
    try { defaultAsientoService.revertirAsiento(asientoId, { motivo: 'Anulación de venta' }); }
    catch { /* si ya fue revertido o no existe, continuar */ }
  }
}

export function confirmarOperacionesPendientesVenta(id, user = null) {
  const existingOps = operacionStockRepo.query()
    .where('referencia_tipo', 'venta')
    .where('referencia_id', Number(id))
    .all();
  for (const op of existingOps) {
    if (op.estado === 'Borrador') confirmarOperacionStock(op.id, user);
  }
  return existingOps;
}

export function syncUltimoPrecioProductos(lineas) {
  for (const l of lineas || []) {
    const pid = Number(l.producto_id || 0);
    const precio = Number(l.precio_unitario || 0);
    if (pid > 0 && precio > 0) productoRepo.update(pid, { precio });
  }
}
