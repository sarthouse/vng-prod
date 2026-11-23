import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { MODELS } from '../src/db/models.js';
import { BaseRepository } from '../src/core/BaseRepository.js';
import { QueryBuilder } from '../src/core/QueryBuilder.js';
import { sanitizeRichHtml } from '../src/core/sanitize.js';
import { initDb, runWithDatabase, closeConnection, getDbPath } from '../src/db.js';
import * as importSvc from '../src/services/config/importService.js';
import * as jsonExSvc from '../src/services/config/jsonExchangeService.js';

const contactoRepo = new BaseRepository({ model: MODELS.contactos });
const productoRepo = new BaseRepository({ model: MODELS.productos });
const opStockRepo = new BaseRepository({ model: MODELS.operaciones_stock });
const categoriaRepo = new BaseRepository({ model: MODELS.categorias });
const planCuentaRepo = new BaseRepository({ model: MODELS.plan_cuentas });

function withIsolatedDb(fn) {
  const dbName = `test_impexp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
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

test('Importación CSV atómica: rollback completo si falla una fila y stock inicial vía operaciones_stock', () => {
  withIsolatedDb(() => {
    const beforeContactos = contactoRepo.query().count();
    assert.throws(
      () => importSvc.importContactos([
        { nombre: 'Cliente Válido SA', cuit: '30-71111111-9', es_cliente: '1' },
        { nombre: '', cuit: '20-12345678-9' }, // falta nombre -> debe revertir todo
      ]),
      /Importación abortada.*Fila 2.*nombre/i,
    );
    const afterContactos = contactoRepo.query().count();
    assert.equal(afterContactos, beforeContactos);

    // Importación de producto con stock inicial debe generar operaciones_stock tipo ajuste
    const resProd = importSvc.importProductos([
      { codigo: 'CSV-STK-1', nombre: 'Insumo con Stock CSV', se_fabrica: '0', se_compra: '1', stock: '15', costo: '100', precio: '150' },
    ]);
    assert.equal(resProd.created, 1);
    const prod = productoRepo.query().where('sku', 'LIKE', 'CSV-STK-1%').get();
    assert.equal(Number(prod.stock), 15);
    const op = opStockRepo.query().where('referencia_tipo', 'importacion').orderBy('id', 'DESC').limit(1).get();
    assert.equal(op?.tipo, 'ajuste');
    assert.equal(op?.estado, 'Confirmado');
  });
});

test('JSON Exchange: rollback atómico, sanitización HTML y round-trip de Plan de Cuentas y Contactos', () => {
  withIsolatedDb(() => {
    // 1. Rollback atómico en importEntityJson
    const beforeCats = categoriaRepo.query().count();
    assert.throws(
      () => jsonExSvc.importEntityJson('categorias', {
        items: [
          { nombre: 'Categoría Temporal Rollback' },
          { nombre: '' }, // error -> rollback completo
        ],
      }),
      /Importación JSON abortada.*Registro #2/i,
    );
    assert.equal(categoriaRepo.query().count(), beforeCats);

    // 2. Sanitización backend de HTML enriquecido
    const dirty = '<p>Especificación</p><script>alert(1)</script><img src="javascript:alert(2)" onerror="alert(3)" /><a href="https://ejemplo.com" onclick="evil()">Link</a>';
    const clean = sanitizeRichHtml(dirty);
    assert.ok(!clean.includes('<script'));
    assert.ok(!clean.includes('onerror'));
    assert.ok(!clean.includes('onclick'));
    assert.ok(!clean.includes('javascript:'));
    assert.ok(clean.includes('https://ejemplo.com'));

    // 3. Round-trip de cuentas_contables (hija antes que padre) y contactos (CUIT sin guiones)
    const rtCuentas = jsonExSvc.importEntityJson('cuentas_contables', {
      items: [
        { codigo: '5.9.01', nombre: 'Subcuenta Hija', tipo: 'egreso', padre_codigo: '5.9', imputable: 1 },
        { codigo: '5.9', nombre: 'Rubro Padre Nuevo', tipo: 'egreso', imputable: 0 },
      ],
    });
    assert.equal(rtCuentas.created, 2);
    const padre = planCuentaRepo.query().where('codigo', '5.9').get();
    const hija = planCuentaRepo.query().where('codigo', '5.9.01').get();
    assert.equal(hija.padre_id, padre.id);

    jsonExSvc.importEntityJson('contactos', {
      items: [{ nombre: 'Contacto RoundTrip', cuit: '30-79999999-1', es_cliente: 1 }],
    });
    // Re-importar mismo CUIT sin guiones debe actualizar (idempotencia), no duplicar
    const rtUpd = jsonExSvc.importEntityJson('contactos', {
      items: [{ nombre: 'Contacto RoundTrip Editado', cuit: '30799999991', es_cliente: 1 }],
    });
    assert.equal(rtUpd.updated, 1);
    assert.equal(rtUpd.created, 0);
  });
});

test('QueryBuilder: whitelisting de columnas contra MODELS y validación estricta de orderBy', () => {
  const memDb = new DatabaseSync(':memory:');
  memDb.exec('CREATE TABLE contactos (id INTEGER PRIMARY KEY, nombre TEXT, cuit TEXT);');
  const qb = new QueryBuilder(memDb, 'contactos', null, MODELS.contactos);
  qb.insert({ nombre: 'Test', cuit: '20-12345678-9' });

  assert.equal(qb.where('nombre', 'Test').orderBy('id', 'DESC').count(), 1);
  assert.throws(() => new QueryBuilder(memDb, 'contactos', null, MODELS.contactos).where('columna_inexistente', 'x'), /Columna no permitida/);
  assert.throws(() => new QueryBuilder(memDb, 'contactos', null, MODELS.contactos).orderBy('nombre', 'ASC; DROP TABLE contactos'), /Dirección de orden inválida/);
});
