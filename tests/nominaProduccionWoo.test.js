import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { initDb, runWithDatabase, closeConnection, getDbPath } from '../src/db.js';
import { MODELS } from '../src/db/models.js';
import { BaseRepository } from '../src/core/BaseRepository.js';
import * as nominaSvc from '../src/services/rrhh/nominaService.js';
import { getAsientoById } from '../src/services/finanzas/asientoService.js';
import * as contactoSvc from '../src/services/comercial/contactoService.js';
import * as prodSvc from '../src/services/inventario/productoService.js';
import * as opStockSvc from '../src/services/inventario/operacionStockService.js';
import * as recetaSvc from '../src/services/produccion/recetaService.js';
import * as produccionSvc from '../src/services/produccion/produccionService.js';
import * as pedidoSvc from '../src/services/produccion/pedidoService.js';
import * as wooSvc from '../src/services/comercial/wooService.js';

const productoRepo = new BaseRepository({ model: MODELS.productos });
const ubicacionRepo = new BaseRepository({ model: MODELS.ubicaciones });
const stockQuantRepo = new BaseRepository({ model: MODELS.stock_quants });
const asientoRepo = new BaseRepository({ model: MODELS.asientos });

async function withIsolatedDb(fn) {
  const dbName = `test_npw_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  initDb(dbName);
  try {
    return await runWithDatabase(dbName, () => fn());
  } finally {
    closeConnection(dbName);
    fs.rmSync(getDbPath(dbName), { force: true });
  }
}

function makeMockResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
  };
}

test('Nómina: anulación genera contra-asiento contable y recibos calculan novedades múltiples', async () => {
  await withIsolatedDb(() => {
    const empId = nominaSvc.createEmpleado({
      legajo: 'NOV-001',
      nombre: 'María',
      apellido: 'López',
      cuil: '27-31555666-4',
      sueldo_basico: 800000,
      activo: 1,
    });

    const conceptos = nominaSvc.listConceptos({ soloActivos: true });
    const conceptoExtra = conceptos.find(c => c.tipo === 'remunerativo') || conceptos[0];
    assert.ok(conceptoExtra?.id);

    const liqId = nominaSvc.createLiquidacion({ periodo: '2026-11', fecha: '2026-11-30' });
    const det1 = nominaSvc.getLiquidacionById(liqId);
    const recibo = det1.recibos.find(r => r.empleado_id === empId);
    assert.ok(recibo);

    // Agregar novedad remunerativa (ej. horas extra / presentismo)
    nominaSvc.addReciboNovedad(recibo.id, {
      concepto_id: conceptoExtra.id,
      descripcion: 'Presentismo / Horas Extra',
      cantidad: 1,
      importe_haber: 50000,
    });

    const det2 = nominaSvc.getLiquidacionById(liqId);
    const rec2 = det2.recibos.find(r => r.id === recibo.id);
    assert.ok(Number(rec2.total_remunerativo) > 800000);

    nominaSvc.confirmarLiquidacion(liqId);
    const detConf = nominaSvc.getLiquidacionById(liqId);
    assert.ok(detConf.liquidacion.asiento_id > 0);
    const asientoOrig = getAsientoById(detConf.liquidacion.asiento_id);
    assert.equal(asientoOrig.asiento.estado, 'Confirmado');

    const asientosAntes = asientoRepo.findAll().length;
    nominaSvc.anularLiquidacion(liqId);
    const detAnul = nominaSvc.getLiquidacionById(liqId);
    assert.equal(detAnul.liquidacion.estado, 'Anulada');
    assert.ok(asientoRepo.findAll().length > asientosAntes);
  });
});

test('Producción: ingreso parcial y CRUD de pedidoService con cálculo de pendientes', async () => {
  await withIsolatedDb(() => {
    const dep = ubicacionRepo.query().where('codigo', 'DEP-CENTRAL').get()
      || ubicacionRepo.query().where('tipo', 'interna').get();
    const cliId = contactoSvc.createContacto({ nombre: 'Zapatería Sur', cuit: '30-79999888-7', es_cliente: 1 });
    const ptPltId = prodSvc.createPlantilla({ nombre: 'Zapatilla Runner', codigo: 'ZAP-RUN', tipo: 'almacenable' });
    const ptProd = productoRepo.query().where('plantilla_id', ptPltId).get();

    // CRUD pedidoService + entrega + pendientes
    const pedCreated = pedidoSvc.createPedido({
      contacto_id: cliId,
      plantilla_id: ptPltId,
      fecha: '2026-11-20',
      lineas: [{ producto_id: ptProd.id, cantidad: 10 }],
    });
    const pedidoId = typeof pedCreated === 'object' ? pedCreated.id : pedCreated;
    const pedDet = pedidoSvc.getPedidoDetalle(pedidoId);
    assert.equal(pedDet.pedido?.estado || pedDet.estado, 'Borrador');

    const pend1 = pedidoSvc.computePendientes();
    assert.ok(Array.isArray(pend1));

    // Receta + Orden con ingreso parcial
    const recId = recetaSvc.createReceta({
      nombre: 'Receta Runner',
      plantilla_id: ptPltId,
      etapas: [{ nombre: 'Armado', orden: 1 }],
    });
    const ordenId = produccionSvc.createOrden({
      plantilla_id: ptPltId,
      receta_id: recId,
      fecha_inicio: '2026-11-20',
      lineas: [{ producto_id: ptProd.id, cantidad: 10 }],
    });
    produccionSvc.registrarIngresoParcialOrden(ordenId, {
      fecha: '2026-11-20',
      ubicacion_destino_id: dep.id,
      lineas: [{ producto_id: ptProd.id, cantidad: 6 }],
    });

    const quant = stockQuantRepo.query().where('producto_id', ptProd.id).where('ubicacion_id', dep.id).get();
    assert.equal(Number(quant.cantidad), 6);

    pedidoSvc.cancelarPedido(pedidoId);
    const pedAnul = pedidoSvc.getPedidoDetalle(pedidoId);
    assert.equal(pedAnul.pedido?.estado || pedAnul.estado, 'Cancelado');
  });
});

test('WooCommerce extendido: exportarProductoAWoo, importarClientes/Cupones/Envios/Pagos, testWooConnection y fallo 500 no revierte stock local', async () => {
  await withIsolatedDb(async () => {
    const dep = ubicacionRepo.query().where('codigo', 'DEP-CENTRAL').get()
      || ubicacionRepo.query().where('tipo', 'interna').get();
    wooSvc.saveWooConfig({
      store_url: 'https://tienda.ejemplo.com',
      consumer_key: 'ck_test1234',
      consumer_secret: 'cs_test5678',
      activo: 1,
      sync_stock_auto: 1,
      ubicacion_stock_id: dep.id,
    });

    const pltId = prodSvc.createPlantilla({ nombre: 'Mocasín Export', codigo: 'MOC-EXP', tipo: 'almacenable' });
    const prod = productoRepo.query().where('plantilla_id', pltId).get();
    productoRepo.update(prod.id, { sku: 'MOC-EXP-1', precio: 25000 });

    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      const u = String(url);
      if (u.includes('/system_status')) return makeMockResponse({ environment: { version: '9.0.0' }, settings: { general: { blogname: 'Tienda Test' } } });
      if (u.includes('/customers')) return makeMockResponse([{ id: 301, email: 'cli@woo.com', first_name: 'Carlos', last_name: 'Ruiz', billing: { state: 'X' }, meta_data: [{ key: 'billing_dni', value: '28111222' }] }]);
      if (u.includes('/coupons')) return makeMockResponse([{ id: 401, code: 'PROMO10', discount_type: 'percent', amount: '10', usage_count: 2 }]);
      if (u.includes('/shipping_methods')) return makeMockResponse([{ id: 'flat_rate', title: 'Envío Fijo' }]);
      if (u.includes('/payment_gateways')) return makeMockResponse([{ id: 'mercadopago', title: 'Mercado Pago', enabled: true }]);
      if (u.includes('/products') && opts?.method === 'POST') return makeMockResponse({ id: 777, sku: 'MOC-EXP-1', regular_price: '25000', stock_quantity: 0 });
      if (u.includes('/products/777') && opts?.method === 'PUT') return makeMockResponse({ message: 'Internal Server Error' }, 500);
      return makeMockResponse([]);
    };

    try {
      const conn = await wooSvc.testWooConnection();
      assert.equal(conn.ok, true);
      assert.equal(conn.store_name, 'Tienda Test');

      const cRes = await wooSvc.importarClientes();
      assert.equal(cRes.count, 1);
      assert.equal(wooSvc.listWooClientes().length, 1);

      const cupRes = await wooSvc.importarCupones();
      assert.equal(cupRes.count, 1);
      assert.equal(wooSvc.listWooCupones().length, 1);

      await wooSvc.importarMetodosEnvio();
      await wooSvc.importarMetodosPago();
      assert.equal(wooSvc.listWooMetodosEnvio().length, 1);
      assert.equal(wooSvc.listWooMetodosPago().length, 1);

      const expRes = await wooSvc.exportarProductoAWoo(pltId);
      assert.equal(expRes.woo_id, 777);

      // Operación de stock local + error HTTP 500 en syncStockProductosPostCommit NO debe revertir el stock local
      opStockSvc.createOperacionStock({
        fecha: '2026-11-20',
        tipo: 'recepcion',
        ubicacion_destino_id: dep.id,
        estado: 'Confirmado',
        lineas: [{ producto_id: prod.id, cantidad: 9 }],
      });
      await wooSvc.syncStockProductosPostCommit([prod.id]);

      const quant = stockQuantRepo.query().where('producto_id', prod.id).where('ubicacion_id', dep.id).get();
      assert.equal(Number(quant.cantidad), 9);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
