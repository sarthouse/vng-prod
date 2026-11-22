import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { initDb, runWithDatabase, closeConnection, getDbPath } from '../src/db.js';
import * as authSvc from '../src/services/auth/authService.js';
import * as tareaSvc from '../src/services/tareas/tareaService.js';
import { generateCuentaCorrientePdf } from '../src/services/print/cuentaCorrientePdfService.js';
import { generateExistenciasPdf } from '../src/services/print/existenciasPdfService.js';
import { generateNominaPdf } from '../src/services/print/nominaPdfService.js';
import { generateTesoreriaPdf } from '../src/services/print/tesoreriaPdfService.js';
import { generateRecibosSueldoPdf } from '../src/services/print/reciboSueldoPdfService.js';
import { generateRemitoPdf } from '../src/services/print/remitoPdfService.js';
import { encodeQrMatrix } from '../src/services/print/qrEncoder.js';
import { MODELS } from '../src/db/models.js';
import { BaseRepository } from '../src/core/BaseRepository.js';

function withIsolatedDb(fn) {
  const dbName = `test_pdf_tar_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  initDb(dbName);
  try {
    return runWithDatabase(dbName, () => fn());
  } finally {
    closeConnection(dbName);
    fs.rmSync(getDbPath(dbName), { force: true });
  }
}

function assertValidPdf(buf, label) {
  assert.ok(Buffer.isBuffer(buf), `${label} debe devolver Buffer`);
  assert.ok(buf.length > 500, `${label} no debe estar vacío`);
  const head = buf.subarray(0, 8).toString('latin1');
  const tail = buf.subarray(Math.max(0, buf.length - 32)).toString('latin1');
  assert.ok(head.startsWith('%PDF-'), `${label} debe comenzar con %PDF-`);
  assert.ok(tail.includes('%%EOF'), `${label} debe terminar con %%EOF`);
}

test('Impresión PDF nativa: Cuenta Corriente, Existencias (multipágina), Nómina y Tesorería generan PDFs válidos', () => {
  const emp = { nombre: 'Vanguard Calzados SA', cuit: '30-71234567-9', condicion_iva: 'Responsable Inscripto' };

  const ccPdf = generateCuentaCorrientePdf({
    contacto: { nombre: 'Cliente Mayorista', cuit: '30-70999888-1', tipo_documento: 'CUIT' },
    movimientos: Array.from({ length: 45 }, (_, i) => ({
      fecha: '2026-11-20',
      tipo: i % 2 === 0 ? 'Factura' : 'Cobro',
      numero: `0001-000000${i + 1}`,
      debe: i % 2 === 0 ? 15000 : 0,
      haber: i % 2 === 0 ? 0 : 15000,
      saldo: i % 2 === 0 ? 15000 : 0,
    })),
    saldo_actual: 0,
  }, emp);
  assertValidPdf(ccPdf, 'CuentaCorrientePdf');

  const exPdf = generateExistenciasPdf({
    filtros: { search: 'Bota' },
    items: Array.from({ length: 50 }, (_, i) => ({
      nombre: `Artículo Prueba #${i + 1}`,
      categoria: 'Calzado',
      stock_fisico: 20,
      stock_reservado: 5,
      stock_disponible: 15,
      stock_minimo: 10,
      costo: 12500,
    })),
  }, emp);
  assertValidPdf(exPdf, 'ExistenciasPdf');

  const nomPdf = generateNominaPdf({
    liquidacion: { periodo: '2026-11', fecha: '2026-11-30', estado: 'Confirmada', asiento_id: 10 },
    items: [
      { legajo: '001', nombre: 'Juan Pérez', sector: 'Producción', remunerativo: 800000, no_remunerativo: 0, retenciones: 136000, contribuciones: 192000, neto: 664000 },
    ],
  }, emp);
  assertValidPdf(nomPdf, 'NominaPdf');

  const tesPdf = generateTesoreriaPdf({
    titulo: 'RECIBO DE COBRO',
    doc: { id: 1, numero: 'RC-0001-00000001', fecha: '2026-11-20', estado: 'Confirmado', contacto_nombre: 'Cliente Uno', monto: 50000 },
    lineas: [{ cuenta_nombre: 'Banco Galicia', metodo: 'Transferencia', referencia: 'OP-991', monto: 50000 }],
  }, { ...emp, print_modo_economico: 1 });
  assertValidPdf(tesPdf, 'TesoreriaPdf');
  const tesStr = tesPdf.toString('latin1');
  assert.ok(tesStr.includes('Son pesos'), 'Tesorería debe incluir importe en letras');
  assert.ok(tesStr.includes('Recibí conforme') || tesStr.includes('Firma'), 'Tesorería debe incluir espacio de firma');

  // Recibo de sueldo LCT tomando datos de último depósito directamente desde empresa_config
  const recPdf = generateRecibosSueldoPdf({
    liquidacion: { periodo: '2026-11', fecha_pago: '2026-11-30' },
    recibos: [{
      id: 1,
      legajo: '001',
      nombre_completo: 'María López',
      cuil: '27-31555666-4',
      total_remunerativo: 500000,
      total_no_remunerativo: 0,
      total_descuentos: 85000,
      neto_a_pagar: 415000,
      lineas: [{ codigo_afip_lsd: '110000', descripcion: 'Sueldo Básico', cantidad: 30, importe_haber: 500000, importe_descuento: 0 }],
    }],
  }, {
    ...emp,
    print_modo_economico: 1,
    lct_ultimo_deposito_periodo: '2026-10',
    lct_ultimo_deposito_fecha: '2026-11-07',
    lct_ultimo_deposito_banco: 'Banco Nación',
  });
  assertValidPdf(recPdf, 'RecibosSueldoLctPdf');
  const recStr = recPdf.toString('latin1');
  assert.ok(recStr.includes('Banco Naci'), 'Recibo debe tomar banco de depósito LCT desde empresa_config');
  assert.ok(recStr.includes('2026-10'), 'Recibo debe tomar período de depósito LCT desde empresa_config');
});

test('Remito PDF resuelve CAI y vencimiento automáticamente desde puntos_venta cuando es letra R', () => {
  withIsolatedDb(() => {
    const pvRepo = new BaseRepository({ model: MODELS.puntos_venta });
    const pv1 = pvRepo.where('numero', 1).first();
    if (pv1) pvRepo.update(pv1.id, { cai: '74999888777666', cai_vto: '2027-06-30' });
    else pvRepo.create({ numero: 1, nombre: 'PV 0001', cai: '74999888777666', cai_vto: '2027-06-30', activo: 1 });

    const buf = generateRemitoPdf({
      numero: '0001-00000123',
      fecha: '2026-11-20',
      contraparteNombre: 'Cliente CAI DB',
      lineas: [{ nombre: 'Zapato Negro', cantidad: 3, udm: 'pares' }],
    }, { razon_social: 'Vanguard SA', cuit: '30-71234567-9' });

    assertValidPdf(buf, 'RemitoCaiDesdeDb');
    const str = buf.toString('latin1');
    assert.ok(str.includes('(R) Tj'), 'Debe emitir letra R automáticamente si PV tiene CAI');
    assert.ok(str.includes('74999888777666'), 'Debe imprimir el CAI obtenido de puntos_venta');
  });
});

test('qrEncoder genera matrices QR válidas para payloads fiscales AFIP/ARCA y strings largos/vacíos', () => {
  const payloadAfip = {
    ver: 1,
    fecha: '2026-11-20',
    cuit: 30712345679,
    ptoVta: 1,
    tipoCmp: 1,
    nroCmp: 42,
    importe: 12100.5,
    moneda: 'PES',
    ctz: 1,
    codAut: 74451234567890,
  };
  const qrUrl = `https://www.afip.gob.ar/fe/qr/?p=${Buffer.from(JSON.stringify(payloadAfip)).toString('base64')}`;
  const matrix = encodeQrMatrix(qrUrl);

  assert.ok(Array.isArray(matrix) && matrix.length >= 21);
  assert.equal(matrix.length, matrix[0].length, 'La matriz QR debe ser cuadrada');
  assert.ok(matrix.every(row => Array.from(row).every(v => v === 0 || v === 1)));

  const emptyMatrix = encodeQrMatrix('');
  assert.ok(Array.isArray(emptyMatrix) && emptyMatrix.length >= 21);

  const longMatrix = encodeQrMatrix('A'.repeat(220));
  assert.ok(Array.isArray(longMatrix) && longMatrix.length > emptyMatrix.length);

  // Superando la capacidad de versión 10 retorna null de forma controlada
  assert.equal(encodeQrMatrix('A'.repeat(400)), null);
});

test('tareaService ejecuta CRUD completo, transiciones de estado y listado filtrado', () => {
  withIsolatedDb(() => {
    const admin = authSvc.setupInitialAdmin({ username: 'admin_tar', nombre: 'Admin Tareas', password: 'Password123!' });

    const t1Id = tareaSvc.createTarea({
      titulo: 'Controlar stock de cueros',
      descripcion: 'Revisar depósito central',
      prioridad: 'Alta',
      estado: 'Pendiente',
      fecha_vencimiento: '2026-11-25',
      responsable_id: admin.user.id,
    }, admin.user);
    const t2Id = tareaSvc.createTarea({
      titulo: 'Emitir libro IVA',
      prioridad: 'Media',
      estado: 'En Progreso',
      responsable_id: admin.user.id,
    }, admin.user);

    const t1 = tareaSvc.getTareaById(t1Id);
    assert.equal(t1.titulo, 'Controlar stock de cueros');
    assert.equal(t1.prioridad, 'Alta');

    const soloAltas = tareaSvc.listTareas({ estado: 'Pendiente', q: 'cueros' });
    assert.equal(soloAltas.length, 1);
    assert.equal(soloAltas[0].id, t1Id);

    tareaSvc.updateTarea(t1Id, { estado: 'Completada', prioridad: 'Urgente' }, admin.user);
    const t1Updated = tareaSvc.getTareaById(t1Id);
    assert.equal(t1Updated.estado, 'Completada');
    assert.equal(t1Updated.prioridad, 'Urgente');
    assert.ok(t1Updated.completada_en);

    assert.equal(tareaSvc.deleteTarea(t2Id), true);
    assert.equal(tareaSvc.getTareaById(t2Id), null);
  });
});
