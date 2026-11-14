import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { db, initDb, runWithDatabase, closeConnection } from '../src/db.js';
import * as contactoSvc from '../src/services/comercial/contactoService.js';
import * as prodSvc from '../src/services/inventario/productoService.js';
import * as ventaSvc from '../src/services/comercial/ventaService.js';
import * as compraSvc from '../src/services/comercial/compraService.js';
import * as tesSvc from '../src/services/finanzas/tesoreriaService.js';
import * as impSvc from '../src/services/finanzas/imputacionService.js';
import * as contAvSvc from '../src/services/finanzas/contabilidadAvanzadaService.js';
import { defaultAsientoService } from '../src/services/finanzas/asientoService.js';

const TEST_DB = 'test_suite_contabilidad_avanzada';

function cleanupDb() {
  closeConnection(TEST_DB);
  for (const ext of ['', '-shm', '-wal']) {
    const f = `./db/${TEST_DB}.sqlite${ext}`;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

test('Imputaciones N-a-N, Multimoneda (Dif. Cambio), Posición IVA, Conciliación Bancaria y Cierre de Ejercicio', (t) => {
  cleanupDb();
  initDb(TEST_DB);
  t.after(() => cleanupDb());

  runWithDatabase(TEST_DB, () => {
    const cliId = contactoSvc.createContacto({
      nombre: 'Zapatería Multi SA',
      cuit: '30-71111111-9',
      condicion_iva: 'Responsable Inscripto',
      es_cliente: true,
    });
    const provId = contactoSvc.createContacto({
      nombre: 'Insumos Sur SRL',
      cuit: '30-72222222-8',
      condicion_iva: 'Responsable Inscripto',
      es_proveedor: true,
    });
    const pltId = prodSvc.createPlantilla({ nombre: 'Zapato Test', tipo: 'almacenable', se_vende: 1, se_compra: 1 });
    const prod = db.prepare('SELECT id FROM productos WHERE plantilla_id = ?').get(pltId);
    const banco = db.prepare("SELECT id FROM cuentas WHERE tipo = 'banco' LIMIT 1").get();

    // 1. Imputaciones N-a-N: 2 facturas + 1 cobro a cuenta imputado a ambas
    const v1Id = ventaSvc.createVenta({
      contacto_id: cliId,
      fecha: '2026-11-05',
      caracter: 'fiscal',
      tipo_comprobante: 'FA-A',
      numero: 'FA 0001-00000001',
      estado: 'Confirmada',
      lineas: [{ producto_id: prod.id, descripcion: 'Zapato', cantidad: 1, precio_unitario: 1000, alicuota_iva: 21 }],
    }); // Total 1210
    const v2Id = ventaSvc.createVenta({
      contacto_id: cliId,
      fecha: '2026-11-06',
      caracter: 'fiscal',
      tipo_comprobante: 'FA-A',
      numero: 'FA 0001-00000002',
      estado: 'Confirmada',
      lineas: [{ producto_id: prod.id, descripcion: 'Zapato', cantidad: 1, precio_unitario: 1000, alicuota_iva: 21 }],
    }); // Total 1210

    const cobroId = tesSvc.createCobro({
      fecha: '2026-11-07',
      contacto_id: cliId,
      lineas: [{ cuenta_id: banco.id, metodo: 'Transferencia', monto: 2000 }],
    });

    impSvc.crearImputacion({ fecha: '2026-11-07', dominio: 'ventas', comprobante_tipo: 'cobro', comprobante_id: cobroId, factura_id: v1Id, monto_imputado: 1210 });
    impSvc.crearImputacion({ fecha: '2026-11-07', dominio: 'ventas', comprobante_tipo: 'cobro', comprobante_id: cobroId, factura_id: v2Id, monto_imputado: 790 });

    const v1 = ventaSvc.getVentaById(v1Id);
    const v2 = ventaSvc.getVentaById(v2Id);
    assert.equal(v1.venta.cobrado, 1210);
    assert.equal(v1.venta.saldo_pendiente, 0);
    assert.equal(v2.venta.cobrado, 790);
    assert.equal(v2.venta.saldo_pendiente, 420);

    // 2. Multimoneda + Diferencia de Cambio al imputar
    contAvSvc.upsertCotizacion({ moneda: 'USD', fecha: '2026-11-08', cotizacion: 1050 });
    assert.equal(contAvSvc.getCotizacionVigente('USD', '2026-11-08'), 1050);

    const vUsdId = ventaSvc.createVenta({
      contacto_id: cliId,
      fecha: '2026-11-08',
      caracter: 'fiscal',
      tipo_comprobante: 'FA-A',
      numero: 'FA 0001-00000003',
      estado: 'Confirmada',
      moneda: 'USD',
      tipo_cambio: 1000,
      lineas: [{ producto_id: prod.id, descripcion: 'Zapato USD', cantidad: 1, precio_unitario: 100, alicuota_iva: 0 }],
    });
    const cbUsdId = tesSvc.createCobro({
      fecha: '2026-11-09',
      contacto_id: cliId,
      moneda: 'USD',
      tipo_cambio: 1050,
      lineas: [{ cuenta_id: banco.id, metodo: 'Transferencia', monto: 100 }],
    });
    const impDcId = impSvc.crearImputacion({
      fecha: '2026-11-09',
      dominio: 'ventas',
      comprobante_tipo: 'cobro',
      comprobante_id: cbUsdId,
      factura_id: vUsdId,
      monto_imputado: 100,
    });
    const dcAsiento = db.prepare("SELECT * FROM asientos WHERE tipo_origen = 'diferencia_cambio' AND origen_id = ?").get(impDcId);
    assert.ok(dcAsiento);
    const dcLineas = db.prepare('SELECT debe, haber FROM asiento_lineas WHERE asiento_id = ?').all(dcAsiento.id);
    assert.equal(dcLineas.reduce((s, l) => s + l.debe, 0), 5000);
    assert.equal(dcLineas.reduce((s, l) => s + l.haber, 0), 5000);

    // 3. Posición Mensual de IVA (F.2002)
    const percIva = db.prepare("SELECT id, nombre FROM impuestos_config WHERE codigo = 'PERC-IVA' LIMIT 1").get();
    compraSvc.createCompra({
      contacto_id: provId,
      fecha: '2026-11-10',
      caracter: 'fiscal',
      tipo_comprobante: 'FA-A',
      numero: 'FC 0001-00000001',
      estado: 'Confirmado',
      lineas: [{ producto_id: prod.id, descripcion: 'Cuero', cantidad: 1, precio_unitario: 1000, alicuota_iva: 21 }],
      impuestos: [{ impuesto_id: percIva.id, nombre: percIva.nombre, tipo: 'percepcion', alicuota: 3, monto: 30 }],
    });

    const posIva = contAvSvc.getPosicionMensualIva({ desde: '2026-11-01', hasta: '2026-11-30' });
    assert.equal(posIva.debito_fiscal, 420);
    assert.equal(posIva.credito_fiscal, 210);
    assert.equal(posIva.saldo_tecnico_a_pagar, 210);
    assert.equal(posIva.percepciones_iva_sufridas, 30);
    assert.equal(posIva.saldo_a_pagar, 180);

    const liqRes = contAvSvc.contabilizarPosicionIva({ fecha: '2026-11-30', desde: '2026-11-01', hasta: '2026-11-30' });
    assert.ok(liqRes.asiento_id > 0);

    // 4. Conciliación Bancaria
    const impExt = contAvSvc.importarExtractoCsv({
      cuenta_id: banco.id,
      contenido: '2026-11-08;Acreditacion Transf;TRF-1;2000\n2026-11-10;Comision Banco;COM;-500',
    });
    assert.equal(impExt.imported, 2);
    const autoRes = contAvSvc.autoConciliarExtracto(banco.id);
    assert.equal(autoRes.matched, 1);
    const pendientesExt = contAvSvc.listExtractoMovimientos({ cuenta_id: banco.id, estado: 'pendiente' });
    assert.equal(pendientesExt.length, 1);

    // 5. Cierre de Ejercicio + Bloqueo de fechas cerradas + Reapertura
    const cierreOut = contAvSvc.ejecutarCierreEjercicio({
      fecha_desde: '2026-11-01',
      fecha_hasta: '2026-11-30',
      descripcion: 'Cierre Nov 2026',
    });
    assert.ok(cierreOut.id > 0);
    assert.ok(cierreOut.asiento_id > 0);

    const ctaCaja = db.prepare("SELECT id, codigo, nombre FROM plan_cuentas WHERE codigo = '1.1.01'").get();
    const ctaCap = db.prepare("SELECT id, codigo, nombre FROM plan_cuentas WHERE codigo = '3.1.01'").get();
    assert.throws(() => {
      defaultAsientoService.createAsiento({
        fecha: '2026-11-15',
        tipo_origen: 'manual',
        concepto: 'Intento en periodo cerrado',
        lineas: [
          { plan_cuenta_id: ctaCaja.id, cuenta_contable: '1.1.01 Caja', debe: 100, haber: 0 },
          { plan_cuenta_id: ctaCap.id, cuenta_contable: '3.1.01 Capital', debe: 0, haber: 100 },
        ],
      });
    }, /está cerrado/);

    contAvSvc.reabrirCierreEjercicio(cierreOut.id);
    const asIdAfter = defaultAsientoService.createAsiento({
      fecha: '2026-11-15',
      tipo_origen: 'manual',
      concepto: 'Asiento tras reapertura',
      lineas: [
        { plan_cuenta_id: ctaCaja.id, cuenta_contable: '1.1.01 Caja', debe: 100, haber: 0 },
        { plan_cuenta_id: ctaCap.id, cuenta_contable: '3.1.01 Capital', debe: 0, haber: 100 },
      ],
    });
    assert.ok(asIdAfter > 0);

    // 6. Auto-imputación de Nota de Crédito + Cuadre Contable (Cta. Cte. vs Balance) + Aging
    const ncId = ventaSvc.createVenta({
      contacto_id: cliId,
      fecha: '2026-11-16',
      caracter: 'fiscal',
      clase_documento: 'nota_credito',
      comprobante_origen_id: v2Id,
      tipo_comprobante: 'NC-A',
      numero: 'NCA 0001-00000001',
      estado: 'Confirmada',
      lineas: [{ producto_id: prod.id, descripcion: 'Desc.', cantidad: 1, precio_unitario: 100, alicuota_iva: 21 }],
    });
    assert.ok(ncId > 0);
    const v2AfterNc = ventaSvc.getVentaById(v2Id);
    assert.equal(v2AfterNc.venta.saldo_pendiente, 299); // 420 - 121 = 299

    // Verificar que el cobro tenga plan_cuenta_id 1.1.03 y contacto_id en asiento_lineas
    const cobroAsientoLinea = db.prepare(`
      SELECT al.plan_cuenta_id, al.contacto_id, pc.codigo
      FROM asiento_lineas al
      JOIN asientos a ON a.id = al.asiento_id
      LEFT JOIN plan_cuentas pc ON pc.id = al.plan_cuenta_id
      WHERE a.tipo_origen = 'cobro' AND a.origen_id = ? AND al.haber > 0
    `).get(cobroId);
    assert.equal(cobroAsientoLinea.codigo, '1.1.03');
    assert.equal(cobroAsientoLinea.contacto_id, cliId);

    const cuadre = impSvc.getCuadreCuentasCorrientes({ fecha_corte: '2026-12-20' });
    assert.equal(cuadre.clientes.saldo_operativo, 299);
    assert.ok(cuadre.clientes.aging.d31_60 >= 299);
    assert.equal(cuadre.proveedores.saldo_operativo, 1240);
    assert.equal(cuadre.proveedores.cuadrado, true);
  });
});
