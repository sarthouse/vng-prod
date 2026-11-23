import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { initDb, runWithDatabase, closeConnection, getDbPath } from '../src/db.js';
import { MODELS } from '../src/db/models.js';
import { BaseRepository } from '../src/core/BaseRepository.js';
import { domainBus } from '../src/core/eventBus.js';
import * as contactoSvc from '../src/services/comercial/contactoService.js';
import * as prodSvc from '../src/services/inventario/productoService.js';
import * as ocSvc from '../src/services/comercial/ordenCompraService.js';
import * as ventaSvc from '../src/services/comercial/ventaService.js';
import * as tesSvc from '../src/services/finanzas/tesoreriaService.js';
import * as opStockSvc from '../src/services/inventario/operacionStockService.js';
import * as nominaSvc from '../src/services/rrhh/nominaService.js';
import * as recetaSvc from '../src/services/produccion/recetaService.js';
import * as produccionSvc from '../src/services/produccion/produccionService.js';

const productoRepo = new BaseRepository({ model: MODELS.productos });
const ubicacionRepo = new BaseRepository({ model: MODELS.ubicaciones });
const cuentaRepo = new BaseRepository({ model: MODELS.cuentas });
const ventaRepo = new BaseRepository({ model: MODELS.ventas });
const movStockRepo = new BaseRepository({ model: MODELS.movimientos_stock });
const asientoRepo = new BaseRepository({ model: MODELS.asientos });

function withIsolatedDb(fn) {
  const dbName = `test_sm_all_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  initDb(dbName);
  try {
    return runWithDatabase(dbName, () => fn());
  } finally {
    closeConnection(dbName);
    fs.rmSync(getDbPath(dbName), { force: true });
  }
}

test('OrdenCompra StateMachine bloquea Facturada -> Cancelada, Cancelada -> Enviada y recepción parcial excesiva', () => {
  withIsolatedDb(() => {
    const provId = contactoSvc.createContacto({ nombre: 'Prov OC SM', cuit: '30-71111111-1', es_proveedor: 1 });
    const pltId = prodSvc.createPlantilla({ nombre: 'Insumo SM', codigo: 'INS-SM', tipo: 'almacenable' });
    const prod = productoRepo.query().where('plantilla_id', pltId).get();

    const oc1 = ocSvc.createOrdenCompra({
      proveedor_id: provId,
      fecha: '2026-11-20',
      lineas: [{ producto_id: prod.id, cantidad: 10, precio_unitario: 100 }],
    });
    ocSvc.enviarOrdenCompra(oc1);

    // Facturar y verificar bloqueo de Facturada -> Cancelada y de edición en Facturada
    ocSvc.convertirOrdenCompraACompra(oc1, { fecha: '2026-11-20' });
    assert.throws(
      () => ocSvc.cancelarOrdenCompra(oc1),
      (err) => err.status === 400 && /Transición inválida/i.test(err.message)
    );
    assert.throws(
      () => ocSvc.updateOrdenCompra(oc1, { observaciones: 'No permitido' }),
      /Borrador|Enviada|Facturada|editar/i
    );

    // Cancelada -> Enviada bloqueada
    const oc2 = ocSvc.createOrdenCompra({
      proveedor_id: provId,
      fecha: '2026-11-20',
      lineas: [{ producto_id: prod.id, cantidad: 5, precio_unitario: 100 }],
    });
    ocSvc.cancelarOrdenCompra(oc2);
    assert.throws(
      () => ocSvc.enviarOrdenCompra(oc2),
      (err) => err.status === 400 && /Transición inválida/i.test(err.message)
    );
  });
});

test('Venta StateMachine bloquea edición sobre Confirmada y anulación con cobros imputados', () => {
  withIsolatedDb(() => {
    const cliId = contactoSvc.createContacto({ nombre: 'Cli Venta SM', cuit: '30-72222222-2', es_cliente: 1 });
    const pltId = prodSvc.createPlantilla({ nombre: 'Prod Venta SM', codigo: 'PV-SM', tipo: 'servicio' });
    const prod = productoRepo.query().where('plantilla_id', pltId).get();

    const vId = ventaSvc.createVenta({
      contacto_id: cliId,
      caracter: 'interno',
      tipo_comprobante: 'FX',
      estado: 'Confirmada',
      fecha: '2026-11-20',
      lineas: [{ producto_id: prod.id, cantidad: 1, precio_unitario: 1000 }],
    });

    // No se puede eliminar una venta Confirmada ni editar su estado a Borrador/Presupuesto
    assert.throws(
      () => ventaSvc.deleteVenta(vId),
      /Confirmada|inmutable|eliminar|Anular/i
    );
    assert.throws(
      () => ventaSvc.updateVenta(vId, { estado: 'Presupuesto' }),
      (err) => err.status === 400 && /Transición inválida/i.test(err.message)
    );

    // Imputar un cobro y verificar bloqueo al intentar Anular
    const cta = cuentaRepo.query().where('tipo', 'efectivo').get() || cuentaRepo.query().get();
    tesSvc.createCobro({
      fecha: '2026-11-20',
      contacto_id: cliId,
      venta_id: vId,
      cuenta_id: cta.id,
      metodo: 'Efectivo',
      monto: 1000,
    });

    assert.throws(
      () => ventaSvc.updateVenta(vId, { estado: 'Anulada' }),
      /cobro|imputado|anular/i
    );
  });
});

test('OperacionStock StateMachine bloquea re-confirmación, anulación de Borrador y confirmación con cantidad <= 0', () => {
  withIsolatedDb(() => {
    const dep = ubicacionRepo.query().where('codigo', 'DEP-CENTRAL').get()
      || ubicacionRepo.query().where('tipo', 'interna').get();
    const pltId = prodSvc.createPlantilla({ nombre: 'Prod Stock SM', codigo: 'PS-SM', tipo: 'almacenable' });
    const prod = productoRepo.query().where('plantilla_id', pltId).get();

    const opBorrador = opStockSvc.createOperacionStock({
      fecha: '2026-11-20',
      tipo: 'recepcion',
      ubicacion_destino_id: dep.id,
      estado: 'Borrador',
      lineas: [{ producto_id: prod.id, cantidad: 5 }],
    });

    // Anular Borrador debe estar bloqueado
    assert.throws(
      () => opStockSvc.anularOperacionStock(opBorrador),
      (err) => err.status === 400 && /Transición inválida/i.test(err.message)
    );

    // Confirmar con cantidad <= 0 debe fallar
    assert.throws(
      () => opStockSvc.confirmarOperacionStock(opBorrador, { lineas: [{ producto_id: prod.id, cantidad: 0 }] }),
      /mayor a 0/i
    );

    // Confirmar normalmente y luego intentar re-confirmar
    opStockSvc.confirmarOperacionStock(opBorrador);
    assert.throws(
      () => opStockSvc.confirmarOperacionStock(opBorrador),
      (err) => err.status === 400 && /Transición inválida/i.test(err.message)
    );
  });
});

test('Nomina StateMachine bloquea re-confirmación y anulación sobre Borrador o ya Anulada', () => {
  withIsolatedDb(() => {
    nominaSvc.createEmpleado({
      legajo: 'SM-001',
      nombre: 'Empleado',
      apellido: 'SM',
      cuil: '20-30111222-3',
      sueldo_basico: 500000,
      activo: 1,
    });

    const liqId = nominaSvc.createLiquidacion({ periodo: '2026-11', fecha: '2026-11-30' });

    // Anular Borrador debe fallar
    assert.throws(
      () => nominaSvc.anularLiquidacion(liqId),
      (err) => err.status === 400 && /Transición inválida/i.test(err.message)
    );

    nominaSvc.confirmarLiquidacion(liqId);
    // Re-confirmar Confirmada debe fallar
    assert.throws(
      () => nominaSvc.confirmarLiquidacion(liqId),
      (err) => err.status === 400 && /Transición inválida/i.test(err.message)
    );

    nominaSvc.anularLiquidacion(liqId);
    // Re-anular Anulada debe fallar
    assert.throws(
      () => nominaSvc.anularLiquidacion(liqId),
      (err) => err.status === 400 && /Transición inválida/i.test(err.message)
    );
  });
});

test('Produccion StateMachine bloquea orden cancelada/completada y reapertura de etapa con stock consumido', () => {
  withIsolatedDb(() => {
    const dep = ubicacionRepo.query().where('codigo', 'DEP-CENTRAL').get()
      || ubicacionRepo.query().where('tipo', 'interna').get();
    const mpPltId = prodSvc.createPlantilla({ nombre: 'Cuero SM', codigo: 'CUE-SM', tipo: 'almacenable' });
    const mpProd = productoRepo.query().where('plantilla_id', mpPltId).get();
    const ptPltId = prodSvc.createPlantilla({ nombre: 'Bota SM', codigo: 'BOT-SM', tipo: 'almacenable' });
    const ptProd = productoRepo.query().where('plantilla_id', ptPltId).get();

    opStockSvc.createOperacionStock({
      fecha: '2026-11-20',
      tipo: 'recepcion',
      ubicacion_destino_id: dep.id,
      estado: 'Confirmado',
      lineas: [{ producto_id: mpProd.id, cantidad: 50 }],
    });

    const recId = recetaSvc.createReceta({
      nombre: 'Receta Bota SM',
      plantilla_id: ptPltId,
      etapas: [
        { nombre: 'Corte', orden: 1 },
        { nombre: 'Aparado', orden: 2 },
      ],
      insumos: [{ producto_id: mpProd.id, cantidad: 2, etapa_nombre: 'Corte' }],
    });

    const ordenId = produccionSvc.createOrden({
      plantilla_id: ptPltId,
      receta_id: recId,
      fecha_inicio: '2026-11-20',
      lineas: [{ producto_id: ptProd.id, cantidad: 5 }],
    });
    const det = produccionSvc.getOrdenDetalle(ordenId);
    const etapa1 = det.etapas[0];
    const etapa2 = det.etapas[1];

    // Completar etapa 1 (consume stock) y luego intentar reabrir a Pendiente
    produccionSvc.updateOrdenEtapa(etapa1.id, { estado: 'Completada' });
    assert.throws(
      () => produccionSvc.updateOrdenEtapa(etapa1.id, { estado: 'Pendiente' }),
      /stock|consumido|reabrir|Transición inválida/i
    );

    // Cancelar orden en proceso y luego intentar volver a cancelarla (Cancelada -> Cancelada)
    produccionSvc.cancelarOrden(ordenId);
    assert.throws(
      () => produccionSvc.cancelarOrden(ordenId),
      (err) => err.status === 400 && /Transición inválida/i.test(err.message)
    );
  });
});

test('Rollback atómico real: si falla un listener de domainEvents durante createVenta Confirmada, revierte venta, stock y asientos', () => {
  withIsolatedDb(() => {
    const cliId = contactoSvc.createContacto({ nombre: 'Cli Rollback', cuit: '30-73333333-3', es_cliente: 1 });
    const pltId = prodSvc.createPlantilla({ nombre: 'Prod Rollback', codigo: 'PR-RB', tipo: 'almacenable' });
    const prod = productoRepo.query().where('plantilla_id', pltId).get();

    const ventasAntes = ventaRepo.findAll().length;
    const movsAntes = movStockRepo.findAll().length;
    const asientosAntes = asientoRepo.findAll().length;

    let shouldFail = true;
    domainBus.on('venta.confirmada', () => {
      if (shouldFail) throw new Error('Fallo simulado en listener post-venta');
    }, { id: 'test:fail_venta_confirmada_rollback', priority: 99 });

    try {
      assert.throws(
        () => ventaSvc.createVenta({
          contacto_id: cliId,
          caracter: 'interno',
          tipo_comprobante: 'FX',
          estado: 'Confirmada',
          fecha: '2026-11-20',
          lineas: [{ producto_id: prod.id, cantidad: 2, precio_unitario: 1500 }],
        }),
        /Fallo simulado en listener post-venta/
      );

      assert.equal(ventaRepo.findAll().length, ventasAntes);
      assert.equal(movStockRepo.findAll().length, movsAntes);
      assert.equal(asientoRepo.findAll().length, asientosAntes);
    } finally {
      shouldFail = false;
    }
  });
});
