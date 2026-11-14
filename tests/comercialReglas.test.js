import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { db, initDb, runWithDatabase, closeConnection } from '../src/db.js';
import * as contactoSvc from '../src/services/comercial/contactoService.js';
import * as prodSvc from '../src/services/inventario/productoService.js';
import * as ventaSvc from '../src/services/comercial/ventaService.js';
import { envioRepo, cuponRepo, recargoRepo, validarCupon } from '../src/services/comercial/comercialReglasService.js';

const TEST_DB = 'test_suite_comercial_reglas';

function cleanupDb() {
  closeConnection(TEST_DB);
  for (const ext of ['', '-shm', '-wal']) {
    const f = `./db/${TEST_DB}.sqlite${ext}`;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

test('Envíos, Cupones y Recargos: facturan en venta_lineas sin mover stock ni salir en remito', (t) => {
  cleanupDb();
  initDb(TEST_DB);
  t.after(() => cleanupDb());

  runWithDatabase(TEST_DB, () => {
    const cliId = contactoSvc.createContacto({ nombre: 'Cliente Woo Test', es_cliente: true, condicion_iva: 'Consumidor Final' });
    const pltId = prodSvc.createPlantilla({ nombre: 'Zapatilla Urbana', tipo: 'almacenable', se_vende: 1, se_compra: 0 });
    const prod = db.prepare('SELECT id FROM productos WHERE plantilla_id = ?').get(pltId);

    envioRepo.create({ nombre: 'Correo Argentino', tipo_tarifa: 'fijo', precio: 500, alicuota_iva: 21, activo: 1 });
    cuponRepo.create({ codigo: 'PROMO10', tipo: 'porcentaje', valor: 10, alicuota_iva: 21, usos_maximos: 5, activo: 1 });
    recargoRepo.create({ nombre: '3 Cuotas', tipo: 'porcentaje', valor: 5, alicuota_iva: 21, activo: 1 });

    const val = validarCupon({ codigo: 'promo10', subtotal: 1000 });
    assert.equal(val.descuento, 100);

    const vtaId = ventaSvc.createVenta({
      contacto_id: cliId,
      caracter: 'fiscal',
      tipo_comprobante: 'FA-B',
      fecha: '2026-11-14',
      cupon_codigo: 'PROMO10',
      external_source: 'woocommerce',
      external_id: 'WC-1001',
      lineas: [
        { producto_id: prod.id, tipo_linea: 'producto', descripcion: 'Zapatilla Urbana', cantidad: 1, precio_unitario: 1000, alicuota_iva: 21 },
        { tipo_linea: 'envio', descripcion: 'Envío: Correo Argentino', cantidad: 1, precio_unitario: 500, alicuota_iva: 21 },
        { tipo_linea: 'descuento', descripcion: 'Descuento Cupón PROMO10', cantidad: 1, precio_unitario: -100, alicuota_iva: 21 },
        { tipo_linea: 'recargo', descripcion: 'Recargo: 3 Cuotas', cantidad: 1, precio_unitario: 70, alicuota_iva: 21 },
      ],
    });

    const vta = ventaSvc.getVentaById(vtaId);
    assert.equal(vta.venta.neto, 1470);
    assert.equal(vta.venta.external_source, 'woocommerce');
    assert.equal(vta.venta.external_id, 'WC-1001');
    assert.equal(vta.lineas.length, 4);

    // El cupón debe incrementar usos_actuales
    const cup = db.prepare("SELECT usos_actuales FROM cupones WHERE codigo = 'PROMO10'").get();
    assert.equal(cup.usos_actuales, 1);

    // La operación de stock / remito solo debe contener el producto físico (1 línea)
    const op = db.prepare("SELECT id FROM operaciones_stock WHERE referencia_tipo = 'venta' AND referencia_id = ?").get(vtaId);
    assert.ok(op);
    const opLineas = db.prepare('SELECT * FROM operacion_stock_lineas WHERE operacion_id = ?').all(op.id);
    assert.equal(opLineas.length, 1);
    assert.equal(opLineas[0].producto_id, prod.id);
  });
});
