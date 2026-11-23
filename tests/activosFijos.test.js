import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { initDb, runWithDatabase, closeConnection, getDbPath } from '../src/db.js';
import * as activoSvc from '../src/services/finanzas/activoFijoService.js';
import { getAsientoById } from '../src/services/finanzas/asientoService.js';

function withIsolatedDb(fn) {
  const dbName = `test_activos_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
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

test('Activos Fijos: cálculo de cuota, asiento consolidado, prevención de doble amortización y transición a Amortizado', () => {
  withIsolatedDb(() => {
    const id1 = activoSvc.createActivoFijo({
      codigo: 'MAQ-01',
      nombre: 'Prensa Hidráulica',
      categoria: 'Maquinaria y Equipos',
      fecha_alta: '2026-01-01',
      valor_origen: 120000,
      valor_residual: 0,
      vida_util_meses: 12,
    });
    const id2 = activoSvc.createActivoFijo({
      codigo: 'PC-01',
      nombre: 'Notebook Diseño',
      categoria: 'Equipos de Computación',
      fecha_alta: '2026-01-01',
      valor_origen: 5000,
      valor_residual: 1000,
      vida_util_meses: 2, // cuota = (5000 - 1000)/2 = 2000/mes
    });

    const det1 = activoSvc.getActivoFijoById(id1);
    assert.equal(det1.activo.cuota_mensual, 10000);

    // Primera corrida período 2026-11: debe consolidar 10000 + 2000 = 12000 en un solo asiento
    const run1 = activoSvc.amortizarPeriodo('2026-11', { fecha: '2026-11-30' });
    assert.equal(run1.amortizados, 2);
    assert.equal(run1.total_monto, 12000);
    assert.ok(run1.asiento_id);

    const asiento = getAsientoById(run1.asiento_id);
    assert.equal(asiento.asiento.tipo_origen, 'amortizacion');
    const debe = asiento.lineas.reduce((s, l) => s + Number(l.debe || 0), 0);
    const haber = asiento.lineas.reduce((s, l) => s + Number(l.haber || 0), 0);
    assert.equal(debe, 12000);
    assert.equal(haber, 12000);

    // Re-ejecutar mismo período 2026-11 no debe duplicar amortización
    const runDup = activoSvc.amortizarPeriodo('2026-11', { fecha: '2026-11-30' });
    assert.equal(runDup.amortizados, 0);
    assert.equal(runDup.total_monto, 0);
    assert.equal(runDup.asiento_id, null);

    // Período 2026-12: PC-01 completa su vida útil (2/2) y pasa a 'Amortizado'
    const run2 = activoSvc.amortizarPeriodo('2026-12', { fecha: '2026-12-31' });
    assert.equal(run2.amortizados, 2);
    const det2After = activoSvc.getActivoFijoById(id2);
    assert.equal(det2After.activo.amortizacion_acumulada, 4000);
    assert.equal(det2After.activo.estado, 'Amortizado');
    assert.equal(det2After.activo.valor_neto_contable, 1000);
  });
});

test('Activos Fijos: baja contable con valor residual y bloqueo de doble baja por StateMachine', () => {
  withIsolatedDb(() => {
    const id = activoSvc.createActivoFijo({
      codigo: 'ROD-01',
      nombre: 'Utilitario Reparto',
      categoria: 'Rodados',
      fecha_alta: '2026-01-01',
      valor_origen: 100000,
      valor_residual: 10000,
      vida_util_meses: 10, // cuota = 9000/mes
    });

    activoSvc.amortizarPeriodo('2026-11', { fecha: '2026-11-30' });
    const baja = activoSvc.darDeBajaActivo(id, { fecha: '2026-12-05', motivo: 'Venta de unidad' });
    assert.equal(baja.ok, true);
    assert.equal(baja.valor_residual_contable, 91000); // 100000 - 9000
    assert.ok(baja.asiento_id);

    const asientoBaja = getAsientoById(baja.asiento_id);
    assert.equal(asientoBaja.asiento.tipo_origen, 'baja_activo');
    const debe = asientoBaja.lineas.reduce((s, l) => s + Number(l.debe || 0), 0);
    const haber = asientoBaja.lineas.reduce((s, l) => s + Number(l.haber || 0), 0);
    assert.equal(debe, 100000); // 9000 amort acum + 91000 residual
    assert.equal(haber, 100000); // 100000 valor origen

    const detAfter = activoSvc.getActivoFijoById(id);
    assert.equal(detAfter.activo.estado, 'Dado de Baja');

    assert.throws(
      () => activoSvc.darDeBajaActivo(id, { fecha: '2026-12-06' }),
      /Transición inválida/,
    );
  });
});
