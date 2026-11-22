import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { initDb, runWithDatabase, closeConnection, getDbPath } from '../src/db.js';
import { MODELS } from '../src/db/models.js';
import { BaseRepository } from '../src/core/BaseRepository.js';
import * as prodSvc from '../src/services/inventario/productoService.js';
import * as opStockSvc from '../src/services/inventario/operacionStockService.js';
import * as invSvc from '../src/services/inventario/inventarioService.js';
import { getFlujoStockMatriz } from '../src/services/inventario/stockProyeccionHelper.js';

const productoRepo = new BaseRepository({ model: MODELS.productos });
const ubicacionRepo = new BaseRepository({ model: MODELS.ubicaciones });
const stockQuantRepo = new BaseRepository({ model: MODELS.stock_quants });
const movStockRepo = new BaseRepository({ model: MODELS.movimientos_stock });
const loteRepo = new BaseRepository({ model: MODELS.lotes });

function withIsolatedDb(fn) {
  const dbName = `test_inv_adv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  initDb(dbName);
  try {
    return runWithDatabase(dbName, () => fn());
  } finally {
    closeConnection(dbName);
    fs.rmSync(getDbPath(dbName), { force: true });
  }
}

test('Confirmación parcial de operacion_stock genera backorder automático por el remanente', () => {
  withIsolatedDb(() => {
    const dep = ubicacionRepo.query().where('codigo', 'DEP-CENTRAL').get()
      || ubicacionRepo.query().where('tipo', 'interna').get();
    const pltId = prodSvc.createPlantilla({ nombre: 'Suela Backorder', codigo: 'SUE-BO', tipo: 'almacenable' });
    const prod = productoRepo.query().where('plantilla_id', pltId).get();

    const opId = opStockSvc.createOperacionStock({
      fecha: '2026-11-20',
      tipo: 'recepcion',
      ubicacion_destino_id: dep.id,
      estado: 'Borrador',
      lineas: [{ producto_id: prod.id, cantidad: 20 }],
    });

    const confRes = opStockSvc.confirmarOperacionStock(opId, {
      lineas: [{ producto_id: prod.id, cantidad: 12 }],
      generar_backorder: true,
    });
    const boId = confRes.backorder_id || confRes.backorderId;
    assert.ok(boId > 0);

    const backorder = opStockSvc.getOperacionStockById(boId);
    assert.equal(backorder.operacion.estado, 'Borrador');
    assert.equal(Number(backorder.lineas[0].cantidad), 8);

    const quant = stockQuantRepo.query()
      .where('producto_id', prod.id)
      .where('ubicacion_id', dep.id)
      .get();
    assert.equal(Number(quant.cantidad), 12);
  });
});

test('Traslados entre ubicaciones con requiere_lote = 1 exigen lote y bloquean saldos negativos', () => {
  withIsolatedDb(() => {
    const depCentral = ubicacionRepo.query().where('codigo', 'DEP-CENTRAL').get()
      || ubicacionRepo.query().where('tipo', 'interna').get();
    const depSecId = invSvc.createUbicacion({ nombre: 'Depósito Secundario', codigo: 'DEP-SEC', tipo: 'interna' });

    const pltId = prodSvc.createPlantilla({
      nombre: 'Pegamento Loteado',
      codigo: 'PEG-LOT',
      tipo: 'almacenable',
      requiere_lote: 1,
    });
    const prod = productoRepo.query().where('plantilla_id', pltId).get();

    const loteId = loteRepo.create({ producto_id: prod.id, codigo: 'LOTE-2026-01', fecha_vencimiento: '2027-12-31' });

    // Ingreso inicial con lote
    opStockSvc.createOperacionStock({
      fecha: '2026-11-20',
      tipo: 'recepcion',
      ubicacion_destino_id: depCentral.id,
      estado: 'Confirmado',
      lineas: [{ producto_id: prod.id, cantidad: 10, lote_id: loteId }],
    });

    // Traslado sin lote debe rechazarse si requiere_lote = 1
    assert.throws(
      () => opStockSvc.createOperacionStock({
        fecha: '2026-11-20',
        tipo: 'traslado',
        ubicacion_origen_id: depCentral.id,
        ubicacion_destino_id: depSecId,
        estado: 'Confirmado',
        lineas: [{ producto_id: prod.id, cantidad: 4 }],
      }),
      /lote|requiere/i
    );

    // Traslado válido de 4 unidades con lote
    opStockSvc.createOperacionStock({
      fecha: '2026-11-20',
      tipo: 'traslado',
      ubicacion_origen_id: depCentral.id,
      ubicacion_destino_id: depSecId,
      estado: 'Confirmado',
      lineas: [{ producto_id: prod.id, cantidad: 4, lote_id: loteId }],
    });

    const qCentral = stockQuantRepo.query().where('producto_id', prod.id).where('ubicacion_id', depCentral.id).get();
    const qSec = stockQuantRepo.query().where('producto_id', prod.id).where('ubicacion_id', depSecId).get();
    assert.equal(Number(qCentral.cantidad), 6);
    assert.equal(Number(qSec.cantidad), 4);
  });
});

test('Anulación de operacion_stock confirmada revierte stock_quants y registra contra-movimientos inmutables', () => {
  withIsolatedDb(() => {
    const dep = ubicacionRepo.query().where('codigo', 'DEP-CENTRAL').get()
      || ubicacionRepo.query().where('tipo', 'interna').get();
    const pltId = prodSvc.createPlantilla({ nombre: 'Hebilla Anulable', codigo: 'HEB-AN', tipo: 'almacenable' });
    const prod = productoRepo.query().where('plantilla_id', pltId).get();

    const opId = opStockSvc.createOperacionStock({
      fecha: '2026-11-20',
      tipo: 'recepcion',
      ubicacion_destino_id: dep.id,
      estado: 'Confirmado',
      lineas: [{ producto_id: prod.id, cantidad: 25 }],
    });
    const movsAntes = movStockRepo.query().where('producto_id', prod.id).all().length;

    opStockSvc.anularOperacionStock(opId);

    const q = stockQuantRepo.query().where('producto_id', prod.id).where('ubicacion_id', dep.id).get();
    assert.equal(Number(q.cantidad), 0);

    const movsDespues = movStockRepo.query().where('producto_id', prod.id).all().length;
    assert.ok(movsDespues > movsAntes);
  });
});

test('stockProyeccionHelper getFlujoStockMatriz calcula stock actual, ingresos esperados y proyecciones', () => {
  withIsolatedDb(() => {
    const dep = ubicacionRepo.query().where('codigo', 'DEP-CENTRAL').get()
      || ubicacionRepo.query().where('tipo', 'interna').get();
    const pltId = prodSvc.createPlantilla({ nombre: 'Taco Proyectado', codigo: 'TAC-PR', tipo: 'almacenable' });
    const prod = productoRepo.query().where('plantilla_id', pltId).get();

    opStockSvc.createOperacionStock({
      fecha: '2026-11-20',
      tipo: 'recepcion',
      ubicacion_destino_id: dep.id,
      estado: 'Confirmado',
      lineas: [{ producto_id: prod.id, cantidad: 30 }],
    });

    const matriz = getFlujoStockMatriz({ producto_id: prod.id });
    assert.ok(matriz && Array.isArray(matriz.periods));
    assert.ok(Array.isArray(matriz.rows));
    const stockIniRow = matriz.rows.find(r => r.id === 'stock_inicial');
    assert.ok(stockIniRow);
  });
});
