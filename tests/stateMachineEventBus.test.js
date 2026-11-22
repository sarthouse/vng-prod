import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { initDb, runWithDatabase, closeConnection } from '../src/db.js';
import { createStateMachine } from '../src/core/stateMachine.js';
import { createEventBus, domainBus } from '../src/core/eventBus.js';
import * as contactoSvc from '../src/services/comercial/contactoService.js';
import * as compraSvc from '../src/services/comercial/compraService.js';
import * as ventaSvc from '../src/services/comercial/ventaService.js';
import * as tesSvc from '../src/services/finanzas/tesoreriaService.js';

const TEST_DB = 'test_suite_sm_eventbus';

function cleanupDb() {
  closeConnection(TEST_DB);
  for (const ext of ['', '-shm', '-wal']) {
    const f = `./db/${TEST_DB}.sqlite${ext}`;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

describe('StateMachine & EventBus Transaccional', () => {
  before(() => {
    cleanupDb();
    initDb(TEST_DB);
  });

  after(() => {
    cleanupDb();
  });

  it('StateMachine valida transiciones permitidas y bloquea inválidas con error 400', () => {
    const sm = createStateMachine({
      Borrador: ['Confirmado'],
      Confirmado: ['Anulada'],
      Anulada: [],
    }, { label: 'Compra' });

    assert.equal(sm.canTransition('Borrador', 'Confirmado'), true);
    assert.equal(sm.canTransition('Anulada', 'Confirmado'), false);
    assert.equal(sm.assertTransition('Borrador', 'Confirmado'), true);
    assert.throws(
      () => sm.assertTransition('Anulada', 'Confirmado'),
      (err) => err.status === 400 && /Transición inválida en Compra/i.test(err.message),
    );
  });

  it('Bloquea Anulada -> Confirmado, borrado de Anulada y anulación de Pagos/Cobros en Borrador', () => {
    runWithDatabase(TEST_DB, () => {
      const provId = contactoSvc.createContacto({ nombre: 'Prov SM Test', es_proveedor: true, condicion_iva: 'Responsable Inscripto' });
      const cliId = contactoSvc.createContacto({ nombre: 'Cli SM Test', es_cliente: true, condicion_iva: 'Consumidor Final' });
      const ctaId = tesSvc.createCuenta({ nombre: 'Caja SM', tipo: 'efectivo', saldo_inicial: 1000 });

      const cmpId = compraSvc.createCompra({
        contacto_id: provId,
        fecha: '2026-11-20',
        numero: '0001-00000123',
        estado: 'Confirmado',
        lineas: [{ descripcion: 'Servicio prueba', cantidad: 1, precio_unitario: 100, alicuota_iva: 21 }],
      });
      compraSvc.anularCompra(cmpId);
      assert.throws(() => compraSvc.confirmarCompra(cmpId), /Transición inválida en Compra/i);
      assert.throws(() => compraSvc.deleteCompra(cmpId), /Solo se pueden eliminar compras en estado Borrador/i);

      const vtaId = ventaSvc.createVenta({
        contacto_id: cliId,
        fecha: '2026-11-20',
        caracter: 'interno',
        tipo_comprobante: 'FX',
        estado: 'Confirmada',
        lineas: [{ descripcion: 'Item prueba', cantidad: 1, precio_unitario: 100, alicuota_iva: 0 }],
      });
      ventaSvc.updateVenta(vtaId, { estado: 'Anulada' });
      assert.throws(() => ventaSvc.updateVenta(vtaId, { estado: 'Confirmada' }), /Transición inválida en Venta/i);
      assert.throws(() => ventaSvc.deleteVenta(vtaId), /No se puede eliminar/i);

      const pagoBorradorId = tesSvc.createPago({
        cuenta_id: ctaId,
        contacto_id: provId,
        fecha: '2026-11-20',
        metodo: 'Efectivo',
        monto: 50,
        estado: 'Borrador',
      });
      assert.throws(() => tesSvc.anularPago(pagoBorradorId), /Transición inválida en Pago/i);

      const cobroBorradorId = tesSvc.createCobro({
        cuenta_id: ctaId,
        contacto_id: cliId,
        fecha: '2026-11-20',
        metodo: 'Efectivo',
        monto: 50,
        estado: 'Borrador',
      });
      assert.throws(() => tesSvc.anularCobro(cobroBorradorId), /Transición inválida en Cobro/i);
    });
  });

  it('EventBus ejecuta síncronamente por prioridad, es idempotente por id y detecta ciclos', () => {
    const bus = createEventBus({ maxDepth: 4 });
    const order = [];
    bus.on('demo.evt', () => order.push('low'), { id: 'l1', priority: 5 });
    bus.on('demo.evt', () => order.push('high'), { id: 'h1', priority: 20 });
    bus.on('demo.evt', () => order.push('dup'), { id: 'h1', priority: 99 }); // mismo id: ignorado

    bus.emit('demo.evt', {});
    assert.deepEqual(order, ['high', 'low']);
    assert.equal(bus.listenerCount('demo.evt'), 2);

    bus.on('loop.evt', () => bus.emit('loop.evt', {}), { id: 'loop' });
    assert.throws(() => bus.emit('loop.evt', {}), /Ciclo detectado en EventBus/i);
  });

  it('Rollback atómico cuando un listener secundario falla dentro de repo.transaction', () => {
    runWithDatabase(TEST_DB, () => {
      const provId = contactoSvc.createContacto({ nombre: 'Prov Rollback', es_proveedor: true, condicion_iva: 'Responsable Inscripto' });
      const beforeCount = compraSvc.listCompras({ proveedor_id: provId }).length;

      domainBus.on('compra.confirmada', ({ compra }) => {
        if (compra.numero === '0001-99999999') {
          throw new Error('Fallo simulado en listener secundario');
        }
      }, { id: 'test.rollback.compra', priority: 1 });

      assert.throws(() => {
        compraSvc.createCompra({
          contacto_id: provId,
          fecha: '2026-11-20',
          numero: '0001-99999999',
          estado: 'Confirmado',
          lineas: [{ descripcion: 'Item rollback', cantidad: 1, precio_unitario: 100, alicuota_iva: 21 }],
        });
      }, /Fallo simulado en listener secundario/);

      const afterCount = compraSvc.listCompras({ proveedor_id: provId }).length;
      assert.equal(afterCount, beforeCount, 'La cabecera de compra debe haberse revertido por el rollback');
    });
  });
});
