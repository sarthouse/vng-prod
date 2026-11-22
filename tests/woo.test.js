import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { initDb, runWithDatabase, closeConnection, getDbPath } from '../src/db.js';
import { MODELS } from '../src/db/models.js';
import { BaseRepository } from '../src/core/BaseRepository.js';
import * as prodSvc from '../src/services/inventario/productoService.js';
import * as opStockSvc from '../src/services/inventario/operacionStockService.js';
import * as condSvc from '../src/services/comercial/condicionesComercialesService.js';
import * as wooSvc from '../src/services/comercial/wooService.js';

const contactoRepo = new BaseRepository({ model: MODELS.contactos });
const productoRepo = new BaseRepository({ model: MODELS.productos });
const ventaRepo = new BaseRepository({ model: MODELS.ventas });
const cobroRepo = new BaseRepository({ model: MODELS.cobros });
const ubicacionRepo = new BaseRepository({ model: MODELS.ubicaciones });
const listaPrecioItemRepo = new BaseRepository({ model: MODELS.lista_precio_items });
const planCuentaRepo = new BaseRepository({ model: MODELS.plan_cuentas });

async function withIsolatedDb(fn) {
  const dbName = `test_woo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
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

test('WooCommerce config enmascara credenciales y preserva secretos si se reenvía valor enmascarado', async () => {
  await withIsolatedDb(() => {
    const saved = wooSvc.saveWooConfig({
      store_url: 'https://tienda.ejemplo.com/',
      consumer_key: 'ck_1234567890abcdef3456',
      consumer_secret: 'cs_abcdef12345678907890',
      activo: 1,
      polling_activo: 1,
      polling_intervalo_min: 5,
    });

    assert.equal(saved.store_url, 'https://tienda.ejemplo.com');
    assert.equal(saved.consumer_key, 'ck_****3456');
    assert.equal(saved.consumer_secret, 'cs_****7890');

    // Reenviar valor enmascarado NO pisa el secreto real en DB
    wooSvc.saveWooConfig({
      store_url: 'https://tienda.ejemplo.com',
      consumer_key: saved.consumer_key,
      consumer_secret: saved.consumer_secret,
      meta_key_dni: '_billing_dni',
    });

    const raw = wooSvc.getWooConfig({ unmask: true });
    assert.equal(raw.consumer_key, 'ck_1234567890abcdef3456');
    assert.equal(raw.consumer_secret, 'cs_abcdef12345678907890');
    assert.equal(raw.meta_key_dni, '_billing_dni');
  });
});

test('WooCommerce extrae meta_key_dni, mapea provincia a jurisdicciones.letra y resuelve clientes idempotentemente', async () => {
  await withIsolatedDb(() => {
    const cfg = wooSvc.saveWooConfig({
      store_url: 'https://tienda.ejemplo.com',
      consumer_key: 'ck_test1234',
      consumer_secret: 'cs_test5678',
      meta_key_dni: 'billing_dni',
      activo: 1,
    });

    const c1 = wooSvc.resolveOrUpsertContactoFromWoo({
      id: 77,
      email: 'juan@ejemplo.com',
      first_name: 'Juan',
      last_name: 'Pérez',
      billing: {
        first_name: 'Juan',
        last_name: 'Pérez',
        email: 'juan@ejemplo.com',
        state: 'C',
        city: 'CABA',
        address_1: 'Av. Corrientes 1234',
      },
      meta_data: [{ key: 'billing_dni', value: '30.123.456' }],
    }, cfg);

    assert.equal(c1.woo_id, 77);
    assert.equal(c1.cuit, '30123456');
    assert.equal(c1.tipo_documento, 'DNI');
    assert.equal(c1.jurisdiccion_codigo, '901'); // C -> CABA 901

    // Segundo llamado sin woo_id pero mismo DNI debe resolver al mismo contacto sin duplicar
    const c2 = wooSvc.resolveOrUpsertContactoFromWoo({
      customer_id: 0,
      billing: {
        first_name: 'Juan',
        last_name: 'Pérez',
        email: 'otro@ejemplo.com',
        state: 'C',
      },
      meta_data: [{ key: 'billing_dni', value: '30123456' }],
    }, cfg);

    assert.equal(c2.id, c1.id);
    const allWithDni = contactoRepo.query().where('cuit', '30123456').all();
    assert.equal(allWithDni.length, 1);
  });
});

test('WooCommerce importa catálogo con variaciones, procesa pedidos atómicamente (Venta + Cobro) y garantiza idempotencia', async () => {
  await withIsolatedDb(async () => {
    wooSvc.saveWooConfig({
      store_url: 'https://tienda.ejemplo.com',
      consumer_key: 'ck_test1234',
      consumer_secret: 'cs_test5678',
      activo: 1,
      polling_activo: 1,
      auto_confirmar_venta: 1,
      auto_registrar_cobro: 1,
    });

    const pltId = prodSvc.createPlantilla({
      nombre: 'Borcego Urbano',
      codigo: 'BOR-URB',
      tipo: 'almacenable',
    });
    const prod = productoRepo.query().where('plantilla_id', pltId).get();
    productoRepo.update(prod.id, { sku: 'BOR-URB-42', precio: 50000 });

    const caja = planCuentaRepo.query().where('codigo', '1.1.1.01').get()
      || planCuentaRepo.query().where('imputable', 1).where('tipo', 'activo').get();
    assert.ok(caja?.id);

    const mockOrder = {
      id: 9001,
      number: '9001',
      status: 'processing',
      currency: 'ARS',
      date_created: '2026-11-20T12:00:00',
      date_modified_gmt: '2026-11-20T12:05:00Z',
      date_paid: '2026-11-20T12:01:00',
      customer_id: 55,
      payment_method: 'bacs',
      payment_method_title: 'Transferencia Bancaria',
      shipping_total: '5000',
      discount_total: '2000',
      total: '53000',
      billing: {
        first_name: 'Ana',
        last_name: 'Gómez',
        email: 'ana@ejemplo.com',
        state: 'B',
      },
      meta_data: [{ key: 'billing_dni', value: '27999888' }],
      line_items: [
        {
          id: 1,
          product_id: 500,
          variation_id: 501,
          sku: 'BOR-URB-42',
          name: 'Borcego Urbano - 42',
          quantity: 1,
          subtotal: '50000',
          total: '48000',
        },
      ],
      shipping_lines: [
        { method_id: 'flat_rate', method_title: 'Correo Argentino', total: '5000' },
      ],
      coupon_lines: [
        { code: 'BIENVENIDA', discount: '2000' },
      ],
      fee_lines: [],
    };

    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/products/500/variations')) {
        return makeMockResponse([{ id: 501, sku: 'BOR-URB-42', regular_price: '50000', stock_quantity: 10, manage_stock: true, attributes: [{ name: 'Talle', option: '42' }] }]);
      }
      if (u.includes('/products')) {
        return makeMockResponse([{ id: 500, type: 'variable', sku: 'BOR-URB', name: 'Borcego Urbano', status: 'publish' }]);
      }
      if (u.includes('/orders')) {
        return makeMockResponse([mockOrder]);
      }
      return makeMockResponse([]);
    };

    try {
      const catRes = await wooSvc.importarProductos();
      assert.equal(catRes.count, 2);

      const prodAfter = productoRepo.findById(prod.id);
      assert.equal(prodAfter.woo_id, 501);

      // Primera corrida de polling: crea venta + cobro
      const poll1 = await wooSvc.runWooPollingCycleForCurrentDb({ force: true });
      assert.equal(poll1.count, 1);
      assert.equal(poll1.created, 1);

      const pedidos = wooSvc.listWooPedidos();
      assert.equal(pedidos.length, 1);
      assert.ok(pedidos[0].venta_id > 0);
      assert.ok(pedidos[0].cobro_id > 0);
      assert.equal(pedidos[0].sync_estado, 'procesado');

      const venta = ventaRepo.findById(pedidos[0].venta_id);
      assert.equal(venta.woo_id, 9001);
      assert.equal(venta.cupon_codigo, 'BIENVENIDA');

      const cobro = cobroRepo.findById(pedidos[0].cobro_id);
      assert.equal(cobro.venta_id, venta.id);
      assert.equal(Number(cobro.monto), 53000);

      // Segunda corrida de polling con el mismo pedido: idempotente (no duplica venta ni cobro)
      const poll2 = await wooSvc.runWooPollingCycleForCurrentDb({ force: true });
      assert.equal(poll2.created, 0);
      assert.equal(ventaRepo.query().where('woo_id', 9001).all().length, 1);
      assert.equal(cobroRepo.query().where('venta_id', venta.id).all().length, 1);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

test('WooCommerce calcula stock desde stock_quants y precios desde listas_precios al sincronizar saliente', async () => {
  await withIsolatedDb(async () => {
    const dep = ubicacionRepo.query().where('codigo', 'DEP-CENTRAL').get()
      || ubicacionRepo.query().where('tipo', 'interna').get();
    assert.ok(dep?.id);

    const listaNormalId = condSvc.createListaPrecio({ nombre: 'Web Normal', activo: 1 });
    const listaOfertaId = condSvc.createListaPrecio({ nombre: 'Web Oferta', activo: 1 });

    wooSvc.saveWooConfig({
      store_url: 'https://tienda.ejemplo.com',
      consumer_key: 'ck_test1234',
      consumer_secret: 'cs_test5678',
      activo: 1,
      ubicacion_stock_id: dep.id,
      lista_precio_normal_id: listaNormalId,
      lista_precio_oferta_id: listaOfertaId,
    });

    const pltId = prodSvc.createPlantilla({ nombre: 'Zapato Clásico', codigo: 'ZAP-1', tipo: 'almacenable' });
    const prod = productoRepo.query().where('plantilla_id', pltId).get();
    productoRepo.update(prod.id, { sku: 'ZAP-1', precio: 10000, woo_id: 888 });

    // Ingresar stock vía operación de stock confirmada (15 unidades)
    opStockSvc.createOperacionStock({
      fecha: '2026-11-20',
      tipo: 'recepcion',
      ubicacion_destino_id: dep.id,
      estado: 'Confirmado',
      lineas: [{ producto_id: prod.id, cantidad: 15 }],
    });

    listaPrecioItemRepo.create({ lista_precio_id: listaNormalId, producto_id: prod.id, precio_fijo: 12000, cantidad_minima: 1 });
    listaPrecioItemRepo.create({ lista_precio_id: listaOfertaId, producto_id: prod.id, precio_fijo: 9500, cantidad_minima: 1 });

    wooSvc.wooProductoRepo.create({
      woo_id: 888,
      woo_parent_id: 0,
      tipo: 'simple',
      plantilla_id: pltId,
      producto_id: prod.id,
      sku: 'ZAP-1',
      name: 'Zapato Clásico',
    });

    const calls = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      calls.push({ url: String(url), method: opts?.method, body: opts?.body ? JSON.parse(opts.body) : null });
      return makeMockResponse({ id: 888 });
    };

    try {
      await wooSvc.syncStockWoo([prod.id]);
      await wooSvc.syncPreciosWoo([prod.id]);

      assert.equal(calls.length, 2);
      assert.equal(calls[0].body.stock_quantity, 15);
      assert.equal(calls[0].body.manage_stock, true);
      assert.equal(calls[1].body.regular_price, '12000');
      assert.equal(calls[1].body.sale_price, '9500');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
