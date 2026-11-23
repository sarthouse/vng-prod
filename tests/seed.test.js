import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { initDb, runWithDatabase, closeConnection, getConnection, getDbPath } from '../src/db.js';
import { MODELS } from '../src/db/models.js';
import { BaseRepository } from '../src/core/BaseRepository.js';
import { runSeeds } from '../src/db/seed.js';

function withIsolatedDb(fn) {
  const dbName = `test_seed_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  initDb(dbName);
  try {
    return runWithDatabase(dbName, () => fn(getConnection(dbName)));
  } finally {
    closeConnection(dbName);
    for (const ext of ['', '-shm', '-wal']) {
      fs.rmSync(`${getDbPath(dbName)}${ext}`, { force: true });
    }
  }
}

test('Seed idempotente: no duplica registros, no pisa ediciones del usuario, agrega faltantes y separa datos demo', () => {
  withIsolatedDb((conn) => {
    const planRepo = new BaseRepository({ model: MODELS.plan_cuentas, db: conn });
    const impRepo = new BaseRepository({ model: MODELS.impuestos_config, db: conn });
    const seqRepo = new BaseRepository({ model: MODELS.secuencias, db: conn });
    const diarioRepo = new BaseRepository({ model: MODELS.diarios, db: conn });
    const contactoRepo = new BaseRepository({ model: MODELS.contactos, db: conn });

    // Base productiva nueva: no debe contener contactos demo
    assert.equal(contactoRepo.query().count(), 0);

    const countPlan1 = planRepo.query().count();
    const countImp1 = impRepo.query().count();
    const countSeq1 = seqRepo.query().count();
    const countDiario1 = diarioRepo.query().count();

    // Edición manual del usuario sobre registros existentes
    const caja = planRepo.query().where('codigo', '1.1.01').get();
    planRepo.update(caja.id, { nombre: 'Caja Principal Editada' });

    const iva21 = impRepo.query().where('codigo', 'IVA-21').get();
    impRepo.update(iva21.id, { alicuota_defecto: 22.5 });

    // Simular cuenta nueva faltante (eliminando una para verificar reposición)
    const amort = planRepo.query().where('codigo', '5.2.09').get();
    planRepo.delete(amort.id);
    assert.equal(planRepo.query().count(), countPlan1 - 1);

    // Segunda ejecución de runSeeds(conn)
    runSeeds(conn);

    // No duplica ni pierde registros; repone el faltante
    assert.equal(planRepo.query().count(), countPlan1);
    assert.equal(impRepo.query().count(), countImp1);
    assert.equal(seqRepo.query().count(), countSeq1);
    assert.equal(diarioRepo.query().count(), countDiario1);

    // Preserva intactas las ediciones manuales del usuario
    assert.equal(planRepo.findById(caja.id).nombre, 'Caja Principal Editada');
    assert.equal(impRepo.findById(iva21.id).alicuota_defecto, 22.5);

    // Datos demo solo si se solicita explícitamente
    runSeeds(conn, { includeDemo: true });
    assert.ok(contactoRepo.query().count() >= 2);
  });
});
