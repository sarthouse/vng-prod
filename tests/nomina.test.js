import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { initDb, runWithDatabase, closeConnection, getDbPath } from '../src/db.js';
import * as nominaSvc from '../src/services/rrhh/nominaService.js';
import * as lsdSvc from '../src/services/afip/libroSueldosDigitalService.js';
import { getAsientoById } from '../src/services/finanzas/asientoService.js';
import { generateRecibosSueldoPdf, numeroALetrasPesos } from '../src/services/print/reciboSueldoPdfService.js';

function withIsolatedDb(fn) {
  const dbName = `test_nomina_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  initDb(dbName);
  try {
    return runWithDatabase(dbName, () => fn());
  } finally {
    closeConnection(dbName);
    for (const ext of ['', '-shm', '-wal']) {
      fs.rmSync(`${getDbPath(dbName)}${ext}`, { force: true });
    }
  }
}

test('Nómina Argentina: topes previsionales, devengamiento por sector, TXT LSD ARCA (01-04), F.931 y Recibo LCT Art. 140', () => {
  withIsolatedDb(() => {
    // Configurar tope máximo previsional en $1.000.000 para probar topeo SICOSS
    nominaSvc.updateParametrosPrevisionales({
      nomina_base_min: 100000,
      nomina_base_max: 1000000,
      nomina_art_fija: 1500,
      nomina_art_pct: 2,
      nomina_scvo_monto: 1000,
      nomina_ultimo_dep_periodo: '2026-10',
      nomina_ultimo_dep_fecha: '2026-11-10',
      nomina_ultimo_dep_banco: 'Banco Nación',
    });

    const empProd = nominaSvc.createEmpleado({
      legajo: '001',
      apellido: 'Pérez',
      nombre: 'Juan',
      cuil: '20301112223',
      fecha_ingreso: '2022-03-01',
      puesto: 'Cortador',
      sector: 'Producción',
      cbu: '0110599520000012345678',
      sueldo_basico: 500000,
    });
    const empAdmin = nominaSvc.createEmpleado({
      legajo: '002',
      apellido: 'Gómez',
      nombre: 'Ana',
      cuil: '27312223334',
      fecha_ingreso: '2021-01-15',
      puesto: 'Gerente Admin',
      sector: 'Administración',
      cbu: '0110599520000087654321',
      sueldo_basico: 1500000, // Supera tope máximo de 1.000.000
    });

    const liqId = nominaSvc.createLiquidacion({
      periodo: '2026-11',
      tipo_liquidacion: 'Mensual',
      fecha_liquidacion: '2026-11-30',
      fecha_pago: '2026-12-03',
    });

    let det = nominaSvc.getLiquidacionById(liqId);
    assert.equal(det.liquidacion.estado, 'Borrador');
    assert.equal(det.recibos.length, 2);

    const recAdmin = det.recibos.find(r => r.empleado_id === empAdmin);
    assert.equal(recAdmin.base_imponible_1, 1000000, 'Base 1 debe topearse en nomina_base_max');
    assert.equal(recAdmin.base_imponible_2, 1500000, 'Base 2 (contribuciones) no lleva tope máximo');

    // Agregar novedad no remunerativa al operario y recalcular
    const recProd = det.recibos.find(r => r.empleado_id === empProd);
    const noRemConc = nominaSvc.listConceptos().find(c => c.codigo_interno === 'NO_REM');
    nominaSvc.addReciboNovedad(recProd.id, {
      concepto_id: noRemConc.id,
      descripcion: 'Viático No Remunerativo',
      importe_haber: 50000,
    });
    det = nominaSvc.getLiquidacionById(liqId);
    assert.equal(det.liquidacion.total_no_remunerativo, 50000);

    // Confirmar -> asiento balanceado desagregado por sector
    nominaSvc.confirmarLiquidacion(liqId);
    det = nominaSvc.getLiquidacionById(liqId);
    assert.equal(det.liquidacion.estado, 'Confirmada');
    assert.ok(det.liquidacion.asiento_id);

    const asiento = getAsientoById(det.liquidacion.asiento_id);
    assert.equal(asiento.asiento.tipo_origen, 'nomina');
    const debe = asiento.lineas.reduce((s, l) => s + Number(l.debe || 0), 0);
    const haber = asiento.lineas.reduce((s, l) => s + Number(l.haber || 0), 0);
    assert.equal(Number(debe.toFixed(2)), Number(haber.toFixed(2)));
    assert.ok(asiento.lineas.filter(l => Number(l.debe) > 0).length >= 2);

    // Bloqueo de borrado físico en Confirmada
    assert.throws(() => nominaSvc.deleteLiquidacion(liqId), /No se puede eliminar físicamente/);

    // TXT ARCA LSD: Conceptos y Liquidación (Registros 01, 02, 03 y 04)
    const concTxt = lsdSvc.exportarConceptosLsdTxt();
    assert.ok(concTxt.split('\r\n').length >= 10);

    const lsdTxt = lsdSvc.exportarLiquidacionLsdTxt(liqId);
    const lsdLines = lsdTxt.split('\r\n');
    const reg01 = lsdLines.filter(l => l.startsWith('01'));
    const reg02 = lsdLines.filter(l => l.startsWith('02'));
    const reg03 = lsdLines.filter(l => l.startsWith('03'));
    const reg04 = lsdLines.filter(l => l.startsWith('04'));

    assert.equal(reg01.length, 1);
    assert.equal(reg01[0].length, 35); // 2 + 11 + 2 + 6 + 1 + 5 + 2 + 6
    assert.equal(reg02.length, 2);
    assert.equal(reg02[0].length, 135); // 2 + 11 + 10 + 50 + 22 + 3 + 8 + 8 + 1 + 2 + 2 + 3 + 6 + 2 + 3 + 2
    assert.ok(reg03.length >= 10);
    assert.equal(reg04.length, 2);
    assert.equal(reg04[0].length, 170); // 35 + 9 * 15 = 170

    // Papel de trabajo F.931
    const f931 = lsdSvc.getPapelTrabajoF931(liqId);
    assert.equal(f931.cantidad_empleados, 2);
    assert.ok(f931.total_f931_arca > 0);
    assert.ok(f931.total_sindicato > 0);

    // Recibos PDF LCT Art. 140: Hoja 1 ORIGINAL, Hoja 2 DUPLICADO
    assert.ok(numeroALetrasPesos(1250.5).includes('mil doscientos cincuenta con 50/100'));
    const pdfBuf = generateRecibosSueldoPdf(det, { razon_social: 'Vanguard SRL', cuit: '30-71111111-9' }, { reciboId: det.recibos[0].id, params: nominaSvc.getParametrosPrevisionales() });
    assert.ok(Buffer.isBuffer(pdfBuf) && pdfBuf.subarray(0, 5).toString('utf8') === '%PDF-');
    const pdfStr = pdfBuf.toString('latin1');
    assert.ok(pdfStr.includes('(ORIGINAL) Tj') && pdfStr.includes('(DUPLICADO) Tj'), 'Debe incluir ORIGINAL en hoja 1 y DUPLICADO en hoja 2');
    assert.ok(pdfStr.includes('COSTO TOTAL EMPLEADOR'), 'Debe incluir sección Costo Total Empleador');
    assert.ok(pdfStr.includes('de 2'), 'Un recibo debe generar 2 páginas (Original + Duplicado)');

    // Anulación con contra-asiento y bloqueo de borrado en Anulada
    nominaSvc.anularLiquidacion(liqId);
    assert.equal(nominaSvc.getLiquidacionById(liqId).liquidacion.estado, 'Anulada');
    const asientoAfter = getAsientoById(det.liquidacion.asiento_id);
    assert.equal(asientoAfter.asiento.estado, 'Revertido');
    assert.throws(() => nominaSvc.deleteLiquidacion(liqId), /No se puede eliminar físicamente/);
  });
});

test('RRHH: detalle de empleado, ausencias sin goce descontadas automáticamente y liquidación individual vs masiva', () => {
  withIsolatedDb(() => {
    const e1 = nominaSvc.createEmpleado({
      legajo: 'RRHH-1',
      nombre: 'Laura',
      apellido: 'Méndez',
      cuil: '27-30111222-4',
      sueldo_basico: 600000,
      observaciones: 'Turno mañana',
      notas: 'Excelente asistencia previa',
      activo: 1,
    });
    const e2 = nominaSvc.createEmpleado({
      legajo: 'RRHH-2',
      nombre: 'Pedro',
      apellido: 'Sosa',
      cuil: '20-31222333-5',
      sueldo_basico: 500000,
      activo: 1,
    });

    // Registrar vacaciones (con goce) y ausencia injustificada (sin goce, 3 días) para e1 en 2026-11
    nominaSvc.createLicencia({
      empleado_id: e1,
      tipo: 'Vacaciones',
      fecha_desde: '2026-11-02',
      fecha_hasta: '2026-11-06',
      dias: 5,
      con_goce: 1,
      estado: 'Aprobada',
    });
    nominaSvc.createLicencia({
      empleado_id: e1,
      tipo: 'Ausencia Injustificada',
      fecha_desde: '2026-11-10',
      fecha_hasta: '2026-11-12',
      dias: 3,
      con_goce: 0,
      estado: 'Aprobada',
    });

    // Liquidación individual solo para e1: debe descontar los 3 días sin goce (27 días trabajados) y guardar fecha
    const liqIndId = nominaSvc.createLiquidacion({
      periodo: '2026-11',
      tipo_liquidacion: 'Mensual',
      fecha_liquidacion: '2026-11-30',
      empleado_ids: [e1],
    });
    const detInd = nominaSvc.getLiquidacionById(liqIndId);
    assert.equal(detInd.liquidacion.fecha, '2026-11-30');
    assert.equal(detInd.recibos.length, 1);
    assert.equal(detInd.recibos[0].empleado_id, e1);
    assert.equal(detInd.recibos[0].dias_trabajados, 27);

    // Liquidación masiva (sin empleado_ids): incluye ambos empleados activos
    const liqMasId = nominaSvc.createLiquidacion({
      periodo: '2026-11',
      tipo_liquidacion: 'Vacaciones',
      fecha_liquidacion: '2026-11-30',
    });
    const detMas = nominaSvc.getLiquidacionById(liqMasId);
    assert.equal(detMas.recibos.length, 2);

    // Detalle del empleado e1 incluye licencias, recibos y notas
    const empDet = nominaSvc.getEmpleadoDetalle(e1);
    assert.equal(empDet.empleado.observaciones, 'Turno mañana');
    assert.equal(empDet.empleado.notas, 'Excelente asistencia previa');
    assert.equal(empDet.licencias.length, 2);
    assert.equal(empDet.recibos.length, 2);
  });
});
