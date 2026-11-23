import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { initDb, runWithDatabase, closeConnection, getDbPath } from '../src/db.js';
import { MODELS } from '../src/db/models.js';
import { BaseRepository } from '../src/core/BaseRepository.js';

function withIsolatedDb(fn) {
  const dbName = `test_orm_arch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  initDb(dbName);
  try {
    return runWithDatabase(dbName, () => fn());
  } finally {
    closeConnection(dbName);
    fs.rmSync(getDbPath(dbName), { force: true });
  }
}

function walkJsFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkJsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) results.push(full);
  }
  return results;
}

test('Cumplimiento arquitectónico: cero db.prepare() o db.exec() en src/services/, src/routes/ y src/db/seed.js', () => {
  const files = [
    ...walkJsFiles(path.resolve('src/services')),
    ...walkJsFiles(path.resolve('src/routes')),
    path.resolve('src/db/seed.js'),
  ];

  const violations = [];
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (/\bdb\.(prepare|exec)\s*\(/.test(line)) {
        violations.push(`${path.relative(process.cwd(), file)}:${idx + 1}: ${line.trim()}`);
      }
    });
  }

  assert.deepEqual(violations, [], `Se detectó SQL crudo prohibido:\n${violations.join('\n')}`);
});

test('Cumplimiento SRP en src/services/print/: cero acceso a BaseRepository, MODELS o repositorios', () => {
  const printFiles = walkJsFiles(path.resolve('src/services/print'));
  const violations = [];
  for (const file of printFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (/\bBaseRepository\b|db\/models\.js|\bnew\s+\w*Repo/.test(line)) {
        violations.push(`${path.relative(process.cwd(), file)}:${idx + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(violations, [], `Se detectó acceso a repositorios en src/services/print/:\n${violations.join('\n')}`);
});

test('BaseRepository.validate() rechaza campos faltantes, tipos inválidos y enums incorrectos contra MODELS', () => {
  const contactoRepo = new BaseRepository({ model: MODELS.contactos });
  const tareaRepo = new BaseRepository({ model: MODELS.tareas });

  assert.throws(
    () => contactoRepo.validate({ es_cliente: 1 }),
    /obligatorio|requerido|nombre/i
  );

  assert.throws(
    () => contactoRepo.validate({ nombre: 'Test Enum', tipo_documento: 'DOCUMENTO_INEXISTENTE' }),
    /permitido|enum|valor/i
  );

  assert.throws(
    () => tareaRepo.validate({ titulo: 'Test Numérico', orden: 'no-es-numero' }),
    /numérico|número/i
  );
});

test('repo.transaction soporta SAVEPOINTs anidados: rollback parcial interno sin perder la transacción externa', () => {
  withIsolatedDb(() => {
    const contactoRepo = new BaseRepository({ model: MODELS.contactos });
    const antes = contactoRepo.findAll().length;

    contactoRepo.transaction(() => {
      contactoRepo.create({ nombre: 'Contacto Externo Persistido', es_cliente: 1 });

      // Transacción anidada (SAVEPOINT) que falla y es capturada por el caller
      assert.throws(() => {
        contactoRepo.transaction(() => {
          contactoRepo.create({ nombre: 'Contacto Interno Revertido', es_cliente: 1 });
          throw new Error('Fallo en savepoint interno');
        });
      }, /Fallo en savepoint interno/);
    });

    const todos = contactoRepo.findAll();
    assert.equal(todos.length, antes + 1);
    assert.ok(todos.some(c => c.nombre === 'Contacto Externo Persistido'));
    assert.ok(!todos.some(c => c.nombre === 'Contacto Interno Revertido'));
  });
});

test('API fluida ORM: find, findOrFail, first, where, orWhere, whereIn([]), whereNull, whereBetween, pluck, sum, findOrCreate, upsert y anti-SQLi', () => {
  withIsolatedDb(() => {
    const contactoRepo = new BaseRepository({ model: MODELS.contactos });

    // findOrCreate & upsert
    const c1 = contactoRepo.findOrCreate({ nombre: 'Fluido Uno' }, { es_cliente: 1, limite_credito: 1000 });
    const c1Dup = contactoRepo.findOrCreate({ nombre: 'Fluido Uno' }, { es_cliente: 1, limite_credito: 9999 });
    assert.equal(c1.id, c1Dup.id);
    assert.equal(Number(c1Dup.limite_credito), 1000);

    const c1Up = contactoRepo.upsert({ nombre: 'Fluido Uno' }, { limite_credito: 2500 });
    assert.equal(c1Up.id, c1.id);
    assert.equal(Number(c1Up.limite_credito), 2500);

    const c2 = contactoRepo.upsert({ nombre: 'Fluido Dos' }, { es_cliente: 1, limite_credito: 5000, observaciones: null });
    assert.ok(c2.id > 0);

    // find, findOrFail, findBy, first
    assert.equal(contactoRepo.find(c1.id).nombre, 'Fluido Uno');
    assert.throws(
      () => contactoRepo.findOrFail(999999),
      (err) => err.status === 404
    );
    assert.equal(contactoRepo.findBy({ nombre: 'Fluido Dos' }).id, c2.id);
    assert.equal(contactoRepo.where('nombre', 'LIKE', 'Fluido%').orderBy('id', 'ASC').first().id, c1.id);

    // whereIn([]) seguro, orWhere, whereBetween, whereNull, pluck, sum
    assert.deepEqual(contactoRepo.whereIn('id', []).all(), []);
    const ranged = contactoRepo.where('es_cliente', 1).whereBetween('limite_credito', [2000, 6000]).pluck('nombre');
    assert.ok(ranged.includes('Fluido Uno') && ranged.includes('Fluido Dos'));

    const orRes = contactoRepo.where('nombre', 'Fluido Uno').orWhere('nombre', 'Fluido Dos').all();
    assert.equal(orRes.length, 2);
    assert.ok(contactoRepo.whereNull('observaciones').exists());
    assert.ok(contactoRepo.where('nombre', 'LIKE', 'Fluido%').sum('limite_credito') >= 7500);

    // Anti-inyección SQL
    assert.throws(() => contactoRepo.where('nombre; DROP TABLE contactos;--', 'x').all());
    assert.throws(() => contactoRepo.where('nombre', 'UNION SELECT', 'x').all());
  });
});
