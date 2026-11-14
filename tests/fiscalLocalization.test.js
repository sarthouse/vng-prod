import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { db, initDb, runWithDatabase, closeConnection } from '../src/db.js';
import * as contactoSvc from '../src/services/comercial/contactoService.js';
import * as prodSvc from '../src/services/inventario/productoService.js';
import * as ventaSvc from '../src/services/comercial/ventaService.js';
import * as tesSvc from '../src/services/finanzas/tesoreriaService.js';
import * as libroIvaSvc from '../src/services/afip/libroIvaService.js';
import { generateRetencionPdf } from '../src/services/print/retencionPdfService.js';
import { generateVentaPdf } from '../src/services/print/ventaPdfService.js';

const TEST_DB = 'test_suite_fiscal_localization';

function cleanupDb() {
  closeConnection(TEST_DB);
  for (const ext of ['', '-shm', '-wal']) {
    const f = `./db/${TEST_DB}.sqlite${ext}`;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

test('Localización Fiscal Argentina: Jurisdicciones, Padrón IIBB, Libro IVA Digital, Retenciones en Pago, SICORE/SIFERE y QR PDF', (t) => {
  cleanupDb();
  initDb(TEST_DB);
  t.after(() => cleanupDb());

  runWithDatabase(TEST_DB, () => {
    // 1. Jurisdicciones (24 provincias seeded)
    const jurs = libroIvaSvc.listJurisdicciones();
    assert.equal(jurs.length, 24);
    assert.equal(libroIvaSvc.resolveJurisdiccionCodigo('Buenos Aires', ''), '902');
    assert.equal(libroIvaSvc.resolveJurisdiccionCodigo('CABA', ''), '901');

    // 2. Padrón de alícuotas IIBB + sugerencia automática de percepciones
    const cliPbaId = contactoSvc.createContacto({
      nombre: 'Cliente PBA SA',
      razon_social: 'Cliente PBA SA',
      cuit: '30-71111111-9',
      condicion_iva: 'Responsable Inscripto',
      provincia: 'Buenos Aires',
      es_cliente: true,
    });
    const impOut = libroIvaSvc.importPadronCsv('30-71111111-9;4.25\n20-12345678-9;1.50', {
      jurisdiccion_codigo: '902',
      tipo: 'percepcion',
    });
    assert.equal(impOut.imported, 2);

    const sug = libroIvaSvc.sugerirPercepciones({
      contacto_id: cliPbaId,
      neto: 10000,
      total: 12100,
      aplica_a: 'ventas',
    });
    assert.equal(sug.jurisdiccion_codigo, '902');
    assert.ok(sug.sugerencias.length >= 1);
    const arbaSug = sug.sugerencias.find(s => s.jurisdiccion_codigo === '902');
    assert.ok(arbaSug);
    assert.equal(arbaSug.alicuota, 4.25);
    assert.equal(arbaSug.monto, 425);

    // 3. Libro IVA Digital (Ventas) + TXT ARCA + Reporte por Jurisdicción
    const pltId = prodSvc.createPlantilla({ nombre: 'Bota Cuero', tipo: 'almacenable', se_vende: 1, se_compra: 1 });
    const prod = db.prepare('SELECT id FROM productos WHERE plantilla_id = ?').get(pltId);

    const vFaId = ventaSvc.createVenta({
      contacto_id: cliPbaId,
      fecha: '2026-11-10',
      caracter: 'fiscal',
      tipo_comprobante: 'FA-A',
      numero: 'FA 0001-00000001',
      cae: '74123456789012',
      cae_vto: '2026-11-20',
      estado: 'Confirmada',
      lineas: [{ producto_id: prod.id, descripcion: 'Bota Cuero', cantidad: 1, precio_unitario: 10000, alicuota_iva: 21 }],
      impuestos: [{ impuesto_id: arbaSug.impuesto_id, nombre: arbaSug.nombre, tipo: 'percepcion', alicuota: 4.25, monto: 425 }],
    });
    assert.ok(vFaId > 0);

    // Nota de Crédito parcial
    ventaSvc.createVenta({
      contacto_id: cliPbaId,
      fecha: '2026-11-12',
      caracter: 'fiscal',
      clase_documento: 'nota_credito',
      comprobante_origen_id: vFaId,
      tipo_comprobante: 'NC-A',
      numero: 'NCA 0001-00000001',
      estado: 'Confirmada',
      lineas: [{ producto_id: prod.id, descripcion: 'Devolución', cantidad: 1, precio_unitario: 2000, alicuota_iva: 21 }],
    });

    // Comprobante no fiscal X (excluido por defecto del Libro IVA Digital)
    ventaSvc.createVenta({
      contacto_id: cliPbaId,
      fecha: '2026-11-13',
      caracter: 'interno',
      tipo_comprobante: 'FX',
      numero: 'FX 0001-00000001',
      estado: 'Confirmada',
      lineas: [{ producto_id: prod.id, descripcion: 'Interno', cantidad: 1, precio_unitario: 5000, alicuota_iva: 0 }],
    });

    const libroVtas = libroIvaSvc.getLibroIva({ tipo: 'ventas', desde: '2026-11-01', hasta: '2026-11-30' });
    assert.equal(libroVtas.rows.length, 2);
    assert.equal(libroVtas.totales.neto_21, 8000);
    assert.equal(libroVtas.totales.iva_21, 1680);
    assert.equal(libroVtas.totales.percepciones_iibb, 425);

    const txtOut = libroIvaSvc.exportLibroIvaTxt({ tipo: 'ventas', desde: '2026-11-01', hasta: '2026-11-30' });
    assert.equal(txtOut.cbteFilename, 'LIBRO_IVA_DIGITAL_VENTAS_CBTE.txt');
    assert.equal(txtOut.alicuotasFilename, 'LIBRO_IVA_DIGITAL_VENTAS_ALICUOTAS.txt');
    assert.equal(txtOut.cbteTxt.split('\r\n').length, 2);
    assert.equal(txtOut.alicuotasTxt.split('\r\n').length, 2);

    const repJur = libroIvaSvc.getReporteJurisdicciones({ tipo: 'ventas', desde: '2026-11-01', hasta: '2026-11-30' });
    assert.ok(repJur.rows.some(r => r.codigo === '902'));

    // 4. Retenciones en Orden de Pago + Asiento balanceado + Certificado PDF + SICORE/SIFERE
    const provId = contactoSvc.createContacto({
      nombre: 'Curtiduría Norte SA',
      cuit: '30-72222222-8',
      condicion_iva: 'Responsable Inscripto',
      provincia: 'Buenos Aires',
      es_proveedor: true,
    });
    const banco = db.prepare("SELECT id FROM cuentas WHERE tipo = 'banco' LIMIT 1").get();
    const retGan = db.prepare("SELECT id FROM impuestos_config WHERE codigo = 'RET-GAN' LIMIT 1").get();
    const retIibb = db.prepare("SELECT id FROM impuestos_config WHERE codigo = 'RET-IIBB-ARBA' LIMIT 1").get();

    const pagoId = tesSvc.createPago({
      fecha: '2026-11-14',
      contacto_id: provId,
      lineas: [{ cuenta_id: banco.id, metodo: 'Transferencia', monto: 9650 }],
      retenciones: [
        { impuesto_id: retGan.id, base_imponible: 10000, alicuota: 2, monto: 200 },
        { impuesto_id: retIibb.id, base_imponible: 10000, alicuota: 1.5, monto: 150 },
      ],
    });
    const pagoData = tesSvc.getPagoById(pagoId);
    assert.equal(pagoData.pago.monto, 9650);
    assert.equal(pagoData.pago.total_retenciones, 350);
    assert.equal(pagoData.pago.total_bruto, 10000);
    assert.equal(pagoData.retenciones.length, 2);
    assert.ok(pagoData.retenciones[0].numero_certificado.startsWith('RET-'));

    // Verificar asiento balanceado (Debe 10000 = Haber 9650 + 200 + 150)
    const asiento = db.prepare("SELECT * FROM asientos WHERE tipo_origen = 'pago' AND origen_id = ?").get(pagoId);
    assert.ok(asiento);
    const aLineas = db.prepare('SELECT debe, haber FROM asiento_lineas WHERE asiento_id = ?').all(asiento.id);
    const totDebe = aLineas.reduce((s, l) => s + l.debe, 0);
    const totHaber = aLineas.reduce((s, l) => s + l.haber, 0);
    assert.equal(totDebe, 10000);
    assert.equal(totHaber, 10000);

    // Certificado de Retención PDF
    const certPdf = generateRetencionPdf({ pago: pagoData.pago, retencion: pagoData.retenciones[0] }, { razon_social: 'Vanguard SA', cuit: '30-70000000-1' });
    assert.ok(certPdf.toString('ascii', 0, 5) === '%PDF-');

    // Libros Auxiliares + SICORE + SIFERE
    const auxPerc = libroIvaSvc.getLibroAuxiliar({ categoria: 'percepciones', desde: '2026-11-01', hasta: '2026-11-30' });
    assert.equal(auxPerc.rows.length, 1);
    const auxRet = libroIvaSvc.getLibroAuxiliar({ categoria: 'retenciones', desde: '2026-11-01', hasta: '2026-11-30' });
    assert.equal(auxRet.rows.length, 2);

    const sicore = libroIvaSvc.exportSicoreTxt({ desde: '2026-11-01', hasta: '2026-11-30' });
    assert.equal(sicore.cantidad, 1);
    const sifere = libroIvaSvc.exportSifereTxt({ categoria: 'percepciones', desde: '2026-11-01', hasta: '2026-11-30' });
    assert.equal(sifere.cantidad, 1);

    // 5. QR AFIP en PDF de factura
    const ventaRow = db.prepare('SELECT * FROM ventas WHERE id = ?').get(vFaId);
    const ventaPdf = generateVentaPdf({ venta: { ...ventaRow, cae_vencimiento: '2026-11-20', cliente_cuit: '30-71111111-9' }, lineas: [] }, { razon_social: 'Vanguard SA', cuit: '30-70000000-1' });
    assert.ok(ventaPdf.toString('ascii', 0, 5) === '%PDF-');
  });
});
