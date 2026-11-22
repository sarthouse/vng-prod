import { domainBus } from '../core/eventBus.js';
import { BaseRepository } from '../core/BaseRepository.js';
import { MODELS } from '../db/models.js';
import { defaultAsientoService } from './finanzas/asientoService.js';
import { operacionStockRepo } from './inventario/operacionStockService.js';
import {
  createVentaOperacion,
  dispararAbastecimientoVenta,
  generarYGuardarAsientoVenta,
  anularEfectosVenta,
  confirmarOperacionesPendientesVenta,
} from './comercial/ventaEfectosHelper.js';
import {
  createCompraOperacion,
  generarYGuardarAsientoCompra,
  anularEfectosCompra,
  syncUltimoCostoProductos,
} from './comercial/compraEfectosHelper.js';
import { generarAsientoNomina } from './finanzas/nominaService.js';
import { getCurrentDbName, runWithDatabase } from '../db.js';
import { syncStockProductosPostCommit } from './comercial/wooService.js';

const productoEvtRepo = new BaseRepository({ model: MODELS.productos });
const ventaEvtRepo = new BaseRepository({ model: MODELS.ventas });

let registered = false;

/**
 * Registra de forma idempotente los suscriptores de eventos de dominio cross-domain.
 * Todos los listeners se ejecutan síncronamente dentro de la transacción activa del emisor.
 */
export function registerDomainSubscribers() {
  if (registered) return;
  registered = true;

  // ── Ventas ──────────────────────────────────────────────────────────────────
  domainBus.on('venta.confirmada', ({ venta, lineas, impuestos, diarioId, user }) => {
    const isNC = venta.clase_documento === 'nota_credito';
    createVentaOperacion({
      id: venta.id,
      numero: venta.numero,
      fecha: venta.fecha,
      contacto_id: venta.contacto_id,
      clase_documento: venta.clase_documento,
    }, lineas, isNC, user);
    dispararAbastecimientoVenta({
      id: venta.id,
      numero: venta.numero,
      fecha: venta.fecha,
      clase_documento: venta.clase_documento,
    }, lineas, user);
  }, { id: 'venta.confirmada:stock_y_abastecimiento', priority: 20 });

  domainBus.on('venta.confirmada', ({ venta, lineas, impuestos, diarioId, user }) => {
    if (!venta.asiento_id && Number(venta.total) > 0) {
      generarYGuardarAsientoVenta({
        id: venta.id,
        numero: venta.numero,
        fecha: venta.fecha,
        claseDocumento: venta.clase_documento,
        diarioId,
        caracter: venta.caracter,
        tipoComprobante: venta.tipo_comprobante,
        contactoId: venta.contacto_id,
        neto: venta.neto,
        ivaMonto: venta.iva_monto,
        total: venta.total,
        impuestos,
        lineas,
        user,
      });
    }
  }, { id: 'venta.confirmada:asiento', priority: 10 });

  domainBus.on('venta.entregada', ({ venta, lineas, crearOperacion = false, confirmarPendientes = false, user }) => {
    if (crearOperacion) {
      createVentaOperacion({
        id: venta.id,
        numero: venta.numero,
        fecha: venta.fecha,
        contacto_id: venta.contacto_id,
        clase_documento: venta.clase_documento,
      }, lineas, true, user);
    } else if (confirmarPendientes) {
      confirmarOperacionesPendientesVenta(venta.id, user);
    }
  }, { id: 'venta.entregada:stock', priority: 20 });

  domainBus.on('venta.entregada', ({ venta, lineas, impuestos, diarioId, user }) => {
    if (!venta.asiento_id && Number(venta.total) > 0) {
      generarYGuardarAsientoVenta({
        id: venta.id,
        numero: venta.numero,
        fecha: venta.fecha,
        claseDocumento: venta.clase_documento,
        diarioId,
        caracter: venta.caracter,
        tipoComprobante: venta.tipo_comprobante,
        contactoId: venta.contacto_id,
        neto: venta.neto,
        ivaMonto: venta.iva_monto,
        total: venta.total,
        impuestos,
        lineas,
        user,
      });
    }
  }, { id: 'venta.entregada:asiento', priority: 10 });

  domainBus.on('venta.anulada', ({ id, asientoId, user }) => {
    anularEfectosVenta({ id, asientoId, user });
  }, { id: 'venta.anulada:reversion', priority: 10 });

  // ── Compras ─────────────────────────────────────────────────────────────────
  domainBus.on('compra.confirmada', ({ compra, lineas, syncCosto = true, user }) => {
    if (syncCosto) {
      syncUltimoCostoProductos(lineas, { compraId: Number(compra.id), numero: compra.numero, user });
    }
  }, { id: 'compra.confirmada:historial_costo', priority: 30 });

  domainBus.on('compra.confirmada', ({ compra, lineas, recibirInmediato = false, user }) => {
    createCompraOperacion({
      id: Number(compra.id),
      numero: compra.numero,
      fecha: compra.fecha,
      contacto_id: compra.contacto_id,
      clase_documento: compra.clase_documento || 'factura',
    }, lineas, Boolean(recibirInmediato), user);
  }, { id: 'compra.confirmada:stock', priority: 20 });

  domainBus.on('compra.confirmada', ({ compra, impuestos, lineas, user }) => {
    generarYGuardarAsientoCompra(compra, impuestos, lineas, user);
  }, { id: 'compra.confirmada:asiento', priority: 10 });

  domainBus.on('compra.anulada', ({ id, asientoId, user }) => {
    anularEfectosCompra({ id, asientoId, user });
  }, { id: 'compra.anulada:reversion', priority: 10 });

  // ── CMV de Entregas de Venta ────────────────────────────────────────────────
  domainBus.on('entrega_venta.confirmada', ({ operacion, lineas, user }) => {
    if (!operacion?.id || operacion.tipo !== 'entrega' || operacion.referencia_tipo !== 'venta') return;
    let costoTotal = 0;
    for (const l of (lineas || [])) {
      const pid = Number(l.producto_id || 0);
      const qty = Number(l.cantidad || 0);
      if (pid > 0 && qty > 0) {
        const prod = productoEvtRepo.findById(pid);
        costoTotal += qty * Number(prod?.costo || 0);
      }
    }
    costoTotal = Number(costoTotal.toFixed(2));
    if (!(costoTotal > 0)) return;

    const cmvAsientoId = defaultAsientoService.generarAsientoCmvEntrega({
      operacionId: operacion.id,
      ventaId: operacion.referencia_id ? Number(operacion.referencia_id) : null,
      numero: operacion.numero || '',
      fecha: operacion.fecha,
      costoTotal,
    });
    if (cmvAsientoId) {
      operacionStockRepo.update(Number(operacion.id), { cmv_asiento_id: cmvAsientoId }, user);
      if (operacion.referencia_id) {
        const vta = ventaEvtRepo.findById(Number(operacion.referencia_id));
        if (vta && !vta.cmv_asiento_id) {
          ventaEvtRepo.update(vta.id, { cmv_asiento_id: cmvAsientoId }, user);
        }
      }
    }
  }, { id: 'entrega_venta.confirmada:cmv', priority: 10 });

  domainBus.on('entrega_venta.anulada', ({ operacion }) => {
    if (!operacion?.cmv_asiento_id) return;
    try {
      defaultAsientoService.revertirAsiento(operacion.cmv_asiento_id, { motivo: 'Anulación de entrega / venta' });
    } catch { /* si ya fue revertido, continuar */ }
  }, { id: 'entrega_venta.anulada:reversion_cmv', priority: 10 });

  // ── Nómina (Liquidación de Sueldos) ─────────────────────────────────────────
  domainBus.on('nomina.confirmada', ({ liquidacion, recibos, user }) => {
    generarAsientoNomina({ liquidacion, recibos }, user);
  }, { id: 'nomina.confirmada:asiento', priority: 10 });

  domainBus.on('nomina.anulada', ({ liquidacion }) => {
    if (!liquidacion?.asiento_id) return;
    try {
      defaultAsientoService.revertirAsiento(liquidacion.asiento_id, { motivo: 'Anulación de liquidación de sueldos' });
    } catch { /* si ya fue revertido, continuar */ }
  }, { id: 'nomina.anulada:reversion', priority: 10 });

  // ── WooCommerce: Sync de stock post-commit (no bloqueante) ──────────────────
  domainBus.on('operacion_stock.confirmada', ({ lineas }) => {
    const productIds = [...new Set((lineas || []).map(l => Number(l.producto_id)).filter(Boolean))];
    if (productIds.length === 0) return;
    const dbName = getCurrentDbName();
    setImmediate(() => {
      runWithDatabase(dbName, () => syncStockProductosPostCommit(productIds)).catch(() => {});
    });
  }, { id: 'operacion_stock.confirmada:woo_stock_sync', priority: 90 });
}
