import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveLetraFiscal,
  validateComprobanteFiscal,
  isFacturaAMonotributo,
} from '../src/services/afip/fiscalRules.js';
import { generateVentaPdf } from '../src/services/print/ventaPdfService.js';

test('fiscalRules: matriz Emisor x Receptor ARCA (RG 1415 / RG 5003)', () => {
  assert.equal(resolveLetraFiscal('Responsable Inscripto', 'Responsable Inscripto'), 'A');
  assert.equal(resolveLetraFiscal('Responsable Inscripto', 'Monotributo'), 'A');
  assert.equal(resolveLetraFiscal('Responsable Inscripto', 'Consumidor Final'), 'B');
  assert.equal(resolveLetraFiscal('Responsable Inscripto', 'Exento'), 'B');
  assert.equal(resolveLetraFiscal('Monotributo', 'Responsable Inscripto'), 'C');
  assert.equal(resolveLetraFiscal('Monotributo', 'Consumidor Final'), 'C');
  assert.equal(resolveLetraFiscal('IVA Sujeto Exento', 'Responsable Inscripto'), 'C');

  assert.doesNotThrow(() => validateComprobanteFiscal({
    caracter: 'fiscal',
    tipoComprobante: 'FA-A',
    emisorCondIva: 'Responsable Inscripto',
    receptorCondIva: 'Monotributista',
  }));

  assert.throws(() => validateComprobanteFiscal({
    caracter: 'fiscal',
    tipoComprobante: 'FA-B',
    emisorCondIva: 'Responsable Inscripto',
    receptorCondIva: 'Monotributista',
  }), /tipo A/i);

  assert.throws(() => validateComprobanteFiscal({
    caracter: 'fiscal',
    tipoComprobante: 'FA-A',
    emisorCondIva: 'Monotributo',
    receptorCondIva: 'Responsable Inscripto',
  }), /tipo C/i);

  // Comprobantes internos X y presupuestos no se bloquean
  assert.doesNotThrow(() => validateComprobanteFiscal({
    caracter: 'interno',
    tipoComprobante: 'FX',
    emisorCondIva: 'Monotributo',
    receptorCondIva: 'Responsable Inscripto',
  }));
});

test('fiscalRules + ventaPdfService: leyenda RG 5003/21 en Factura A a Monotributista', () => {
  assert.equal(isFacturaAMonotributo('Responsable Inscripto', 'Monotributo', 'A'), true);
  assert.equal(isFacturaAMonotributo('Responsable Inscripto', 'Responsable Inscripto', 'A'), false);

  const buf = generateVentaPdf({
    venta: {
      id: 10,
      numero: 'FA 0001-00000010',
      caracter: 'fiscal',
      clase_documento: 'factura',
      tipo_comprobante: 'FA-A',
      fecha: '2026-11-14',
      cae: '74123456789012',
      cae_vencimiento: '2026-11-24',
      cliente_nombre: 'Juan Monotributo',
      cliente_condicion_iva: 'Monotributo',
      total: 1210,
    },
    lineas: [{ descripcion: 'Servicio', cantidad: 1, udm: 'un.', precio_unitario: 1000, alicuota_iva: 21, subtotal: 1000 }],
  }, {
    razon_social: 'Mi Empresa SA',
    condicion_iva: 'Responsable Inscripto',
    cuit: '30-71234567-9',
  });
  const text = buf.toString('latin1');
  assert.match(text, /RG 5003\/21/);
});

test('diarios.es_fiscal + planCuentasTemplates: bloquea factura fiscal en diario no fiscal y aplica plantilla Monotributo', async () => {
  const fs = await import('node:fs');
  const { db, initDb, runWithDatabase, closeConnection } = await import('../src/db.js');
  const ventaSvc = await import('../src/services/comercial/ventaService.js');
  const contactoSvc = await import('../src/services/comercial/contactoService.js');
  const { applyPlanCuentasTemplate } = await import('../src/services/finanzas/planCuentasTemplates.js');

  const TEST_DB = 'test_suite_diario_tpl';
  const cleanup = () => {
    closeConnection(TEST_DB);
    for (const ext of ['', '-shm', '-wal']) {
      const f = `./db/${TEST_DB}.sqlite${ext}`;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  };
  cleanup();
  initDb(TEST_DB);

  try {
    runWithDatabase(TEST_DB, () => {
      const cliId = contactoSvc.createContacto({ nombre: 'Cli Fiscal Test', es_cliente: true, condicion_iva: 'Responsable Inscripto' });
      const diarioInt = db.prepare("SELECT id FROM diarios WHERE codigo = 'VTA-INT'").get();
      assert.ok(diarioInt);

      assert.throws(() => ventaSvc.createVenta({
        contacto_id: cliId,
        diario_id: diarioInt.id,
        caracter: 'fiscal',
        tipo_comprobante: 'FA-A',
        fecha: '2026-11-14',
        lineas: [{ descripcion: 'Item', cantidad: 1, precio_unitario: 100, alicuota_iva: 21 }],
      }), /no es fiscal/i);

      const xId = ventaSvc.createVenta({
        contacto_id: cliId,
        diario_id: diarioInt.id,
        caracter: 'interno',
        tipo_comprobante: 'FX',
        fecha: '2026-11-14',
        lineas: [{ descripcion: 'Item X', cantidad: 1, precio_unitario: 100 }],
      });
      assert.ok(xId > 0);

      const res = applyPlanCuentasTemplate(db, 'monotributo');
      assert.equal(res.plantilla, 'monotributo');
      const ivaDeb = db.prepare("SELECT activo FROM plan_cuentas WHERE codigo = '2.1.02'").get();
      assert.equal(ivaDeb.activo, 0);
    });
  } finally {
    cleanup();
  }
});
