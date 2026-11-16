import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { initDb, runWithDatabase, closeConnection } from '../src/db.js';
import * as contactoSvc from '../src/services/comercial/contactoService.js';
import * as tesSvc from '../src/services/finanzas/tesoreriaService.js';
import * as chequeSvc from '../src/services/finanzas/chequeService.js';
import * as asientoSvc from '../src/services/finanzas/asientoService.js';

const TEST_DB = 'test_suite_cheques';

function cleanupDb() {
  closeConnection(TEST_DB);
  for (const ext of ['', '-shm', '-wal']) {
    const f = `./db/${TEST_DB}.sqlite${ext}`;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

test('Cartera de Cheques (Fase 1) y validación Caja Efectivo', async (t) => {
  cleanupDb();
  initDb(TEST_DB);
  t.after(() => cleanupDb());

  await t.test('restringe métodos de cobro/pago según el tipo de cuenta', () => {
    runWithDatabase(TEST_DB, () => {
      const cuentas = tesSvc.listCuentas();
      const caja = cuentas.find(c => c.tipo === 'efectivo');
      const banco = cuentas.find(c => c.tipo === 'banco');
      assert.ok(caja, 'Debe existir Caja Efectivo');
      assert.ok(banco, 'Debe existir cuenta Banco');

      assert.throws(() => {
        tesSvc.createCobro({
          fecha: '2026-11-14',
          lineas: [{ cuenta_id: caja.id, metodo: 'Transferencia', monto: 1000 }],
        });
      }, /solo admite: Efectivo/i);

      assert.throws(() => {
        tesSvc.createPago({
          fecha: '2026-11-14',
          lineas: [{ cuenta_id: caja.id, metodo: 'Cheque', monto: 500 }],
        });
      }, /solo admite: Efectivo/i);

      for (const metodoInvalido of ['Efectivo', 'MercadoPago', 'Otro']) {
        assert.throws(() => {
          tesSvc.createPago({
            fecha: '2026-11-14',
            lineas: [{ cuenta_id: banco.id, metodo: metodoInvalido, monto: 500 }],
          });
        }, /solo admite: Transferencia, Cheque/i);
      }

      const cobroCajaId = tesSvc.createCobro({
        fecha: '2026-11-14',
        lineas: [{ cuenta_id: caja.id, metodo: 'Efectivo', monto: 1000 }],
      });
      assert.ok(cobroCajaId > 0);

      const cobroBancoId = tesSvc.createCobro({
        fecha: '2026-11-14',
        lineas: [{ cuenta_id: banco.id, metodo: 'Transferencia', monto: 1500 }],
      });
      assert.ok(cobroBancoId > 0);
    });
  });

  await t.test('cheques de terceros: cartera, depósito acreditado, endoso y rechazo', () => {
    runWithDatabase(TEST_DB, () => {
      const cliId = contactoSvc.createContacto({ nombre: 'Cliente Cheques', es_cliente: true });
      const provId = contactoSvc.createContacto({ nombre: 'Proveedor Cheques', es_proveedor: true });
      const banco = tesSvc.listCuentas().find(c => c.tipo === 'banco');
      assert.ok(banco, 'Debe existir cuenta bancaria');
      const saldoInicialBanco = Number(banco.saldo_actual);

      // 1. Ingreso y depósito de cheque tercero
      const ch1Id = chequeSvc.registrarChequeTercero({
        numero: '10001234',
        banco: 'Banco Galicia',
        fecha_emision: '2026-11-14',
        fecha_pago: '2026-12-14',
        monto: 50000,
        contacto_origen_id: cliId,
      });
      let ch1 = chequeSvc.getChequeById(ch1Id);
      assert.equal(ch1.estado, 'En Cartera');

      ch1 = chequeSvc.depositarCheque(ch1Id, { cuenta_id: banco.id, fecha: '2026-12-15', acreditar: true });
      assert.equal(ch1.estado, 'Acreditado');
      const bancoPostDep = tesSvc.listCuentas().find(c => c.id === banco.id);
      assert.equal(Number(bancoPostDep.saldo_actual), saldoInicialBanco + 50000);

      // 2. Ingreso y endoso a proveedor
      const ch2Id = chequeSvc.registrarChequeTercero({
        numero: '20005678',
        banco: 'Banco Macro',
        fecha_emision: '2026-11-14',
        fecha_pago: '2026-12-20',
        monto: 30000,
        contacto_origen_id: cliId,
      });
      const ch2End = chequeSvc.endosarCheque(ch2Id, { contacto_destino_id: provId, fecha: '2026-11-15' });
      assert.equal(ch2End.estado, 'Endosado');
      assert.equal(ch2End.contacto_destino_id, provId);

      // 3. Rechazo de cheque acreditado (descuenta banco + gastos y re-imputa a cliente)
      const ch1Rech = chequeSvc.rechazarCheque(ch1Id, { fecha: '2026-12-18', motivo: 'Sin fondos', gastos_bancarios: 1500 });
      assert.equal(ch1Rech.estado, 'Rechazado');
      const bancoPostRech = tesSvc.listCuentas().find(c => c.id === banco.id);
      assert.equal(Number(bancoPostRech.saldo_actual), saldoInicialBanco - 1500);
    });
  });

  await t.test('cheques propios diferidos: emisión no toca banco hasta debitar', () => {
    runWithDatabase(TEST_DB, () => {
      const provId = contactoSvc.createContacto({ nombre: 'Curtiembre Cheques', es_proveedor: true });
      const banco = tesSvc.listCuentas().find(c => c.tipo === 'banco');
      const saldoAntes = Number(banco.saldo_actual);

      const chPropioId = chequeSvc.registrarChequePropio({
        numero: '99001122',
        modalidad: 'diferido',
        fecha_emision: '2026-11-14',
        fecha_pago: '2026-12-30',
        monto: 20000,
        cuenta_bancaria_id: banco.id,
        contacto_origen_id: provId,
      });
      let ch = chequeSvc.getChequeById(chPropioId);
      assert.equal(ch.estado, 'Emitido');

      const bancoAlEmitir = tesSvc.listCuentas().find(c => c.id === banco.id);
      assert.equal(Number(bancoAlEmitir.saldo_actual), saldoAntes, 'Emitir cheque diferido no debe descontar banco');

      ch = chequeSvc.debitarCheque(chPropioId, { fecha: '2026-12-30' });
      assert.equal(ch.estado, 'Debitado');
      const bancoAlDebitar = tesSvc.listCuentas().find(c => c.id === banco.id);
      assert.equal(Number(bancoAlDebitar.saldo_actual), saldoAntes - 20000);

      // Verificar que todos los asientos generados estén balanceados (Debe == Haber)
      const asientos = asientoSvc.listAsientos();
      assert.ok(asientos.length >= 6);
      for (const a of asientos) {
        const debe = a.lineas.reduce((s, l) => s + Number(l.debe || 0), 0);
        const haber = a.lineas.reduce((s, l) => s + Number(l.haber || 0), 0);
        assert.equal(Math.round(debe * 100), Math.round(haber * 100));
      }
    });
  });

  await t.test('Fase 2: createCobro, createPago (propio y endoso) y getFlujoProyectado integran cheques', () => {
    runWithDatabase(TEST_DB, () => {
      const cliId = contactoSvc.createContacto({ nombre: 'Zapatería Sur', es_cliente: true });
      const provId = contactoSvc.createContacto({ nombre: 'Suelas SA', es_proveedor: true });
      const banco = tesSvc.listCuentas().find(c => c.tipo === 'banco');
      const saldoInicial = Number(banco.saldo_actual);

      // 1. Cobro con cheque de tercero (entra En Cartera, no suma Banco)
      const cobroId = tesSvc.createCobro({
        fecha: '2026-11-14',
        cliente_id: cliId,
        lineas: [{
          cuenta_id: null,
          metodo: 'Cheque',
          monto: 12000,
          cheque: { numero: '555001', banco: 'BBVA', modalidad: 'diferido', fecha_pago: '2026-11-28', librador_nombre: 'Zapatería Sur' },
        }],
      });
      assert.ok(cobroId > 0);
      const cobroDet = tesSvc.getCobroById(cobroId);
      assert.ok(cobroDet.lineas[0].cheque_id, 'cobro_lineas debe enlazar cheque_id');
      let chTerc = chequeSvc.getChequeById(cobroDet.lineas[0].cheque_id);
      assert.equal(chTerc.estado, 'En Cartera');
      assert.equal(Number(tesSvc.listCuentas().find(c => c.id === banco.id).saldo_actual), saldoInicial);

      // 2. Pago emitiendo cheque propio diferido (no descuenta Banco hasta debitar)
      const pagoPropioId = tesSvc.createPago({
        fecha: '2026-11-14',
        proveedor_id: provId,
        lineas: [{
          cuenta_id: banco.id,
          metodo: 'Cheque',
          monto: 7500,
          cheque: { numero: '888001', modalidad: 'diferido', fecha_pago: '2026-12-02' },
        }],
      });
      assert.ok(pagoPropioId > 0);
      const pagoDet = tesSvc.getPagoById(pagoPropioId);
      assert.ok(pagoDet.lineas[0].cheque_id, 'pago_lineas debe enlazar cheque_id');
      const chPropio = chequeSvc.getChequeById(pagoDet.lineas[0].cheque_id);
      assert.equal(chPropio.origen, 'propio');
      assert.equal(chPropio.estado, 'Emitido');
      assert.equal(Number(tesSvc.listCuentas().find(c => c.id === banco.id).saldo_actual), saldoInicial);

      // 3. Flujo proyectado incluye el cheque de tercero En Cartera (+12000) y el propio Emitido (-7500)
      const flujo = tesSvc.getFlujoProyectado({ desde: '2026-11-14', hasta: '2026-12-10' });
      const evTerc = flujo.eventos.find(e => e.origen === 'cheque_tercero' && e.origen_id === chTerc.id);
      const evProp = flujo.eventos.find(e => e.origen === 'cheque_propio' && e.origen_id === chPropio.id);
      assert.ok(evTerc && evTerc.monto === 12000);
      assert.ok(evProp && evProp.monto === -7500);

      // 4. Pago endosando el cheque de tercero
      const pagoEndosoId = tesSvc.createPago({
        fecha: '2026-11-15',
        proveedor_id: provId,
        lineas: [{
          cuenta_id: null,
          metodo: 'Endoso Cheque',
          cheque_id: chTerc.id,
          monto: 12000,
        }],
      });
      assert.ok(pagoEndosoId > 0);
      chTerc = chequeSvc.getChequeById(chTerc.id);
      assert.equal(chTerc.estado, 'Endosado');
      assert.equal(chTerc.pago_id, pagoEndosoId);

      // 5. getFlujoMatriz devuelve siempre columnas continuas (históricas + actual + proyectadas) y arrastra saldos
      const matriz = tesSvc.getFlujoMatriz({ granularidad: 'semana', hist_periodos: 3, proy_periodos: 4 });
      assert.equal(matriz.periods.length, 8, '3 históricas + 1 actual + 4 proyectadas = 8 columnas');
      const rowIni = matriz.rows.find(r => r.id === 'saldo_inicial');
      const rowFin = matriz.rows.find(r => r.id === 'saldo_final');
      const rowNet = matriz.rows.find(r => r.id === 'flujo_neto');
      assert.ok(rowIni && rowFin && rowNet);
      for (let i = 0; i < matriz.periods.length; i++) {
        const pk = matriz.periods[i].key;
        assert.equal(
          Number((rowIni.values[pk] + rowNet.values[pk]).toFixed(2)),
          rowFin.values[pk],
          `Saldo final de ${pk} debe coincidir con Saldo Inicial + Flujo Neto`,
        );
        if (i + 1 < matriz.periods.length) {
          const nextPk = matriz.periods[i + 1].key;
          assert.equal(rowFin.values[pk], rowIni.values[nextPk], 'Saldo Final pasa a ser Saldo Inicial de la semana siguiente');
        }
      }
    });
  });
});
