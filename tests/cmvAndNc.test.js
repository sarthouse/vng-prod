import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb, runWithDatabase, closeConnection } from '../src/db.js';
import { MODELS } from '../src/db/models.js';
import { BaseRepository } from '../src/core/BaseRepository.js';
import * as contactoSvc from '../src/services/comercial/contactoService.js';
import * as prodSvc from '../src/services/inventario/productoService.js';
import * as ventaSvc from '../src/services/comercial/ventaService.js';
import * as compraSvc from '../src/services/comercial/compraService.js';
import * as opStockSvc from '../src/services/inventario/operacionStockService.js';
import { getAsientoById } from '../src/services/finanzas/asientoService.js';
import { getFacturaImputado } from '../src/services/finanzas/imputacionService.js';

const productoRepo = new BaseRepository({ model: MODELS.productos });
const ubicacionRepo = new BaseRepository({ model: MODELS.ubicaciones });
const opStockRepo = new BaseRepository({ model: MODELS.operaciones_stock });
const ventaRepo = new BaseRepository({ model: MODELS.ventas });

function withIsolatedDb(fn) {
  const dbName = `test_cmv_nc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  initDb(dbName);
  try {
    return runWithDatabase(dbName, () => fn());
  } finally {
    closeConnection(dbName);
  }
}

test('CMV automático al confirmar entrega de venta y reversión al anular', () => {
  withIsolatedDb(() => {
    const cliId = contactoSvc.createContacto({ nombre: 'Cliente CMV SA', cuit: '30-71111111-9', es_cliente: 1 });
    const pltRes = prodSvc.createPlantilla({
      nombre: 'Zapatilla CMV',
      codigo: 'ZAP-CMV',
      se_fabrica: false,
      se_compra: true,
      se_vende: true,
      costo: 1200,
      precio: 3000,
      udm: 'pares',
    });
    const pltId = typeof pltRes === 'object' ? (pltRes.id ?? pltRes.plantilla_id) : pltRes;
    const prod = productoRepo.query().where('plantilla_id', pltId).get();

    // Ingresar stock inicial vía ajuste confirmado para tener existencia
    const virtAjuste = ubicacionRepo.query().where('codigo', 'VIRT-AJUSTE').get().id;
    const prodTerm = ubicacionRepo.query().where('codigo', 'PROD-TERM').get().id;
    opStockSvc.createOperacionStock({
      tipo: 'ajuste',
      estado: 'Confirmado',
      ubicacion_origen_id: virtAjuste,
      ubicacion_destino_id: prodTerm,
      lineas: [{ producto_id: prod.id, cantidad: 10 }],
    });

    // Crear venta Confirmada (crea entrega Borrador) y luego entregarla
    const ventaId = ventaSvc.createVenta({
      contacto_id: cliId,
      caracter: 'interno',
      tipo_comprobante: 'FC-X',
      estado: 'Confirmada',
      lineas: [{ producto_id: prod.id, cantidad: 4, precio_unitario: 3000, alicuota_iva: 0 }],
    });

    const opEntrega = opStockRepo.query()
      .where('referencia_tipo', 'venta')
      .where('referencia_id', ventaId)
      .get();
    assert.ok(opEntrega);
    assert.equal(opEntrega.tipo, 'entrega');
    assert.equal(opEntrega.estado, 'Borrador');

    opStockSvc.confirmarOperacionStock(opEntrega.id);

    const opAfter = opStockRepo.findById(opEntrega.id);
    assert.ok(opAfter.cmv_asiento_id, 'Debe generar cmv_asiento_id en la operación de entrega');
    const vtaAfter = ventaRepo.findById(ventaId);
    assert.equal(vtaAfter.cmv_asiento_id, opAfter.cmv_asiento_id);

    const cmvAsiento = getAsientoById(opAfter.cmv_asiento_id);
    assert.equal(cmvAsiento.asiento.tipo_origen, 'operacion_stock_cmv');
    const totalDebe = cmvAsiento.lineas.reduce((s, l) => s + Number(l.debe || 0), 0);
    const totalHaber = cmvAsiento.lineas.reduce((s, l) => s + Number(l.haber || 0), 0);
    assert.equal(totalDebe, 4800); // 4 * 1200
    assert.equal(totalHaber, 4800);

    // Anular entrega debe revertir el asiento de CMV
    opStockSvc.anularOperacionStock(opEntrega.id);
    const cmvOrigAfter = getAsientoById(opAfter.cmv_asiento_id);
    assert.equal(cmvOrigAfter.asiento.estado, 'Revertido');
    assert.ok(cmvOrigAfter.asiento.asiento_reversion_id, 'Debe existir contra-asiento de reversión de CMV');
  });
});

test('Notas de Crédito vinculadas en Ventas y Compras: stock inverso, asiento invertido e imputación automática', () => {
  withIsolatedDb(() => {
    const cliId = contactoSvc.createContacto({ nombre: 'Cliente NC SA', cuit: '30-72222222-9', es_cliente: 1 });
    const provId = contactoSvc.createContacto({ nombre: 'Proveedor NC SA', cuit: '30-73333333-9', es_proveedor: 1 });

    const pltRes = prodSvc.createPlantilla({
      nombre: 'Insumo NC',
      codigo: 'INS-NC',
      se_fabrica: false,
      se_compra: true,
      se_vende: true,
      costo: 500,
      precio: 1000,
      udm: 'unidades',
    });
    const pltId = typeof pltRes === 'object' ? (pltRes.id ?? pltRes.plantilla_id) : pltRes;
    const prod = productoRepo.query().where('plantilla_id', pltId).get();

    // 1. Compra Confirmada con recepción inmediata (5 unidades a $500)
    const cmpId = compraSvc.createCompra({
      contacto_id: provId,
      caracter: 'interno',
      tipo_comprobante: 'FC-X',
      estado: 'Confirmado',
      recibir_inmediato: true,
      lineas: [{ producto_id: prod.id, cantidad: 5, precio_unitario: 500, alicuota_iva: 0 }],
    });
    assert.equal(Number(productoRepo.findById(prod.id).stock), 5);

    // Emitir NC parcial desde Compra (devuelve 2 unidades = $1000)
    const ncCmpId = compraSvc.generarNotaCreditoDesdeCompra(cmpId, {
      lineas: [{ producto_id: prod.id, cantidad: 2 }],
    });
    const ncCmp = compraSvc.getCompraById(ncCmpId);
    assert.equal(ncCmp.compra.clase_documento, 'nota_credito');
    assert.equal(ncCmp.compra.comprobante_origen_id, cmpId);
    assert.equal(ncCmp.compra.tipo_comprobante, 'INT');
    assert.equal(Number(productoRepo.findById(prod.id).stock), 3); // 5 - 2 = 3
    assert.equal(getFacturaImputado('compras', cmpId), 1000);
    assert.ok(ncCmp.compra.asiento_id);

    // 2. Venta Entregada desde DEP-CENTRAL (3 unidades a $1000 = $3000)
    const depCentralId = ubicacionRepo.query().where('codigo', 'DEP-CENTRAL').get().id;
    const vtaId = ventaSvc.createVenta({
      contacto_id: cliId,
      caracter: 'interno',
      tipo_comprobante: 'FC-X',
      ubicacion_id: depCentralId,
      estado: 'Entregada',
      lineas: [{ producto_id: prod.id, cantidad: 3, udm: 'unidades', precio_unitario: 1000, alicuota_iva: 0 }],
    });
    assert.equal(Number(productoRepo.findById(prod.id).stock), 0);

    // Emitir NC parcial desde Venta (devuelve 1 unidad = $1000)
    const ncVtaId = ventaSvc.generarNotaCreditoDesdeVenta(vtaId, {
      lineas: [{ producto_id: prod.id, cantidad: 1 }],
    });
    const ncVta = ventaSvc.getVentaById(ncVtaId);
    assert.equal(ncVta.venta.clase_documento, 'nota_credito');
    assert.equal(ncVta.venta.comprobante_origen_id, vtaId);
    assert.equal(ncVta.venta.tipo_comprobante, 'NC-X');
    assert.equal(Number(productoRepo.findById(prod.id).stock), 1); // 0 + 1 = 1
    assert.equal(getFacturaImputado('ventas', vtaId), 1000);
    assert.ok(ncVta.venta.asiento_id);
  });
});
