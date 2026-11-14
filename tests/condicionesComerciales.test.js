import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { db, initDb, runWithDatabase, closeConnection } from '../src/db.js';
import { createContacto } from '../src/services/comercial/contactoService.js';
import { createPlantilla } from '../src/services/inventario/productoService.js';
import {
  createTerminoPago,
  createMetodoPago,
  createListaPrecio,
  createProductoProveedor,
  resolverPrecioLista,
  resolverPrecioCompra,
  getContactoCondiciones,
} from '../src/services/comercial/condicionesComercialesService.js';
import { createVenta, getVentaById } from '../src/services/comercial/ventaService.js';
import { createCompra, getCompraById } from '../src/services/comercial/compraService.js';
import { createCobro } from '../src/services/finanzas/tesoreriaService.js';

const TEST_DB = 'test_suite_condiciones_comerciales';

test('Términos de pago (compra/venta), Métodos de pago, Tarifas por variante y Cuentas contables por plantilla', () => {
  try { fs.unlinkSync(`data/${TEST_DB}.sqlite`); } catch { /* ignore */ }
  initDb(TEST_DB);
  try {
    runWithDatabase(TEST_DB, () => {
      const uid = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const tpVentaId = createTerminoPago({ nombre: `Test Venta 45d ${uid}`, dias: 45 });
      const tpCompraId = createTerminoPago({ nombre: `Test Compra 60d ${uid}`, dias: 60 });
      const mpId = createMetodoPago({ nombre: `Transferencia VIP ${uid}`, tipo: 'banco', requiere_referencia: true });

      const ctaVentaCustom = db.prepare("SELECT id FROM plan_cuentas WHERE tipo = 'ingreso' AND imputable = 1 ORDER BY id DESC LIMIT 1").get();
      const ctaCompraCustom = db.prepare("SELECT id FROM plan_cuentas WHERE tipo = 'egreso' AND imputable = 1 ORDER BY id DESC LIMIT 1").get();

      const ptId = createPlantilla({
        nombre: `Zapato Clásico Test ${uid}`,
        codigo: `ZCT-${uid}`,
        tipo: 'almacenable',
        se_vende: 1,
        se_compra: 1,
        precio: 1000,
        costo: 400,
        cuenta_venta_id: ctaVentaCustom?.id || null,
        cuenta_compra_id: ctaCompraCustom?.id || null,
      });
      const prod = db.prepare('SELECT id FROM productos WHERE plantilla_id = ? LIMIT 1').get(ptId);
      assert.ok(prod?.id);

      const lpId = createListaPrecio({
        nombre: `Lista Gremio Test ${uid}`,
        descuento_pct: 10,
        items: [
          { producto_id: prod.id, precio_fijo: 750, cantidad_minima: 10 },
        ],
      });

      const cliId = createContacto({
        nombre: 'Cliente/Proveedor Gremio SRL',
        es_cliente: 1,
        es_proveedor: 1,
        condicion_iva: 'Responsable Inscripto',
        termino_pago_id: tpVentaId,
        termino_pago_compra_id: tpCompraId,
        metodo_pago_id: mpId,
        lista_precio_id: lpId,
      });

      createProductoProveedor({
        plantilla_id: ptId,
        producto_id: prod.id,
        contacto_id: cliId,
        codigo_proveedor: 'PROV-ZCT-1',
        precio: 350,
        cantidad_minima: 1,
        lead_time_dias: 7,
      });
      createProductoProveedor({
        plantilla_id: ptId,
        producto_id: prod.id,
        contacto_id: cliId,
        codigo_proveedor: 'PROV-ZCT-10',
        precio: 310,
        cantidad_minima: 10,
        lead_time_dias: 5,
      });

      const cond = getContactoCondiciones(cliId);
      assert.equal(cond.termino_pago_id, tpVentaId);
      assert.equal(cond.termino_pago_compra_id, tpCompraId);
      assert.equal(cond.metodo_pago_id, mpId);
      assert.equal(cond.lista_precio_id, lpId);

      // Resolución de precio venta: qty 2 aplica 10% global ($900), qty 10 aplica regla fija ($750)
      assert.equal(resolverPrecioLista({ contacto_id: cliId, producto_id: prod.id, cantidad: 2 }).precio_unitario, 900);
      assert.equal(resolverPrecioLista({ contacto_id: cliId, producto_id: prod.id, cantidad: 10 }).precio_unitario, 750);

      // Resolución de precio compra por variante y cantidad mínima
      assert.equal(resolverPrecioCompra({ contacto_id: cliId, producto_id: prod.id, cantidad: 3 }).precio_unitario, 350);
      assert.equal(resolverPrecioCompra({ contacto_id: cliId, producto_id: prod.id, cantidad: 12 }).precio_unitario, 310);

      // Venta sin fecha_vencimiento ni precio_unitario: hereda condiciones del contacto e imputa cuenta_venta_id
      const ventaId = createVenta({
        fecha: '2026-11-01',
        contacto_id: cliId,
        caracter: 'interno',
        tipo_comprobante: 'FX',
        estado: 'Confirmada',
        lineas: [
          { producto_id: prod.id, descripcion: 'Zapato Clásico', cantidad: 10, udm: 'pares' },
        ],
      });
      const ventaData = getVentaById(ventaId);
      assert.equal(ventaData.venta.termino_pago_id, tpVentaId);
      assert.equal(ventaData.venta.metodo_pago_id, mpId);
      assert.equal(ventaData.venta.lista_precio_id, lpId);
      assert.equal(ventaData.venta.fecha_vencimiento, '2026-12-16'); // 2026-11-01 + 45 días
      assert.equal(ventaData.lineas[0].precio_unitario, 750);
      assert.equal(ventaData.venta.total, 7500);
      if (ctaVentaCustom?.id) {
        const vtaAsientoHaber = db.prepare(`
          SELECT al.plan_cuenta_id FROM asiento_lineas al
          JOIN asientos a ON a.id = al.asiento_id
          WHERE a.tipo_origen = 'venta' AND a.origen_id = ? AND al.haber > 0
        `).get(ventaId);
        assert.equal(vtaAsientoHaber.plan_cuenta_id, ctaVentaCustom.id);
      }

      // Compra sin fecha_vencimiento ni precio_unitario: hereda termino_pago_compra_id (60d) y tarifa proveedor ($310)
      const compraId = createCompra({
        fecha: '2026-11-01',
        contacto_id: cliId,
        caracter: 'interno',
        tipo_comprobante: 'FX',
        estado: 'Confirmado',
        lineas: [
          { producto_id: prod.id, descripcion: 'Zapato Clásico', cantidad: 10, udm: 'pares', alicuota_iva: 0 },
        ],
      });
      const compraData = getCompraById(compraId);
      assert.equal(compraData.compra.termino_pago_id, tpCompraId);
      assert.equal(compraData.compra.metodo_pago_id, mpId);
      assert.equal(compraData.compra.fecha_vencimiento, '2026-12-31'); // 2026-11-01 + 60 días
      assert.equal(compraData.lineas[0].precio_unitario, 310);
      assert.equal(compraData.compra.total, 3100);
      if (ctaCompraCustom?.id) {
        assert.equal(compraData.lineas[0].plan_cuenta_id, ctaCompraCustom.id);
      }

      // Cobro con metodo_pago_id
      const ctaBanco = db.prepare("SELECT id FROM cuentas WHERE tipo = 'banco' LIMIT 1").get();
      const cobroId = createCobro({
        fecha: '2026-11-05',
        contacto_id: cliId,
        venta_id: ventaId,
        cuenta_id: ctaBanco.id,
        metodo_pago_id: mpId,
        metodo: 'Transferencia',
        monto: 7500,
      });
      const cobroRow = db.prepare('SELECT metodo_pago_id, metodo FROM cobros WHERE id = ?').get(cobroId);
      assert.equal(cobroRow.metodo_pago_id, mpId);
      assert.equal(cobroRow.metodo, 'Transferencia');
    });
  } finally {
    closeConnection(TEST_DB);
    try { fs.unlinkSync(`data/${TEST_DB}.sqlite`); } catch { /* ignore */ }
  }
});
