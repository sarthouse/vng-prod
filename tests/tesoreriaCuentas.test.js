import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { db, initDb, runWithDatabase, closeConnection } from '../src/db.js';
import * as tesSvc from '../src/services/finanzas/tesoreriaService.js';

const TEST_DB = 'test_suite_tes_cuentas';

function cleanupDb() {
  closeConnection(TEST_DB);
  for (const ext of ['', '-shm', '-wal']) {
    const f = `./db/${TEST_DB}.sqlite${ext}`;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

test('Tesorería Cuentas: apertura, ajuste de saldo y transferencia generan asientos con plan_cuenta_id', (t) => {
  cleanupDb();
  initDb(TEST_DB);
  t.after(() => cleanupDb());

  runWithDatabase(TEST_DB, () => {
    // 1. Alta con saldo inicial -> asiento apertura_cuenta sin duplicar saldo
    const ctaId = tesSvc.createCuenta({
      nombre: 'Banco Galicia Test',
      tipo: 'banco',
      saldo_inicial: 25000,
      fecha: '2026-11-14',
    });
    const cta = db.prepare('SELECT * FROM cuentas WHERE id = ?').get(ctaId);
    assert.equal(cta.saldo_inicial, 25000);
    assert.equal(tesSvc.recalcCuentaSaldo(ctaId), 25000);

    const asientoAp = db.prepare("SELECT * FROM asientos WHERE tipo_origen = 'apertura_cuenta' AND origen_id = ?").get(ctaId);
    assert.ok(asientoAp, 'Debe generar asiento de apertura_cuenta');
    const linesAp = db.prepare('SELECT * FROM asiento_lineas WHERE asiento_id = ?').all(asientoAp.id);
    assert.equal(linesAp.length, 2);
    assert.ok(linesAp.every(l => l.plan_cuenta_id !== null), 'Las líneas de apertura deben tener plan_cuenta_id');
    assert.equal(linesAp.reduce((s, l) => s + l.debe, 0), 25000);
    assert.equal(linesAp.reduce((s, l) => s + l.haber, 0), 25000);

    // 2. Ajuste / arqueo de saldo -> asiento ajuste_saldo sin pisar saldo_inicial
    const aj = tesSvc.ajustarSaldoCuenta(ctaId, {
      nuevo_saldo: 24500,
      fecha: '2026-11-14',
      motivo: 'Comisión bancaria',
    });
    assert.equal(aj.diferencia, -500);
    assert.equal(aj.saldo_nuevo, 24500);
    const ctaAfterAj = db.prepare('SELECT * FROM cuentas WHERE id = ?').get(ctaId);
    assert.equal(ctaAfterAj.saldo_inicial, 25000);
    assert.equal(ctaAfterAj.saldo_actual, 24500);

    // 3. Transferencia entre cuentas -> asiento con diario_id y plan_cuenta_id
    const cajaId = tesSvc.createCuenta({ nombre: 'Caja Chica Test', tipo: 'efectivo', saldo_inicial: 0 });
    const trAsientoId = tesSvc.createTransferencia({
      fecha: '2026-11-14',
      cuenta_origen_id: ctaId,
      cuenta_destino_id: cajaId,
      monto: 4500,
      concepto: 'Extracción para caja chica',
    });
    const trAsiento = db.prepare('SELECT * FROM asientos WHERE id = ?').get(trAsientoId);
    assert.equal(trAsiento.tipo_origen, 'transferencia');
    assert.ok(trAsiento.diario_id !== null, 'La transferencia debe asociarse a un diario');
    assert.equal(tesSvc.recalcCuentaSaldo(ctaId), 20000);
    assert.equal(tesSvc.recalcCuentaSaldo(cajaId), 4500);
  });
});
