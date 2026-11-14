import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { QueryBuilder } from '../src/core/QueryBuilder.js';
import { ContactoService } from '../src/services/comercial/contactoService.js';
import { AsientoService } from '../src/services/finanzas/asientoService.js';
import { InventarioBaseService } from '../src/services/inventario/inventarioService.js';

/**
 * Repositorio en memoria (Liskov Substitution + Dependency Inversion):
 * Implementa el mismo contrato que BaseRepository sin depender de SQLite.
 */
class InMemoryRepository {
  constructor(initialRows = []) {
    this._rows = initialRows.map((r, i) => ({ id: r.id ?? i + 1, ...r }));
    this._nextId = this._rows.reduce((max, r) => Math.max(max, Number(r.id) || 0), 0) + 1;
  }

  findAll() {
    return this._rows.map(r => ({ ...r }));
  }

  findById(id) {
    const found = this._rows.find(r => Number(r.id) === Number(id));
    return found ? { ...found } : null;
  }

  findWhere(filters = {}, { limit } = {}) {
    let res = this._rows.filter(r =>
      Object.entries(filters).every(([k, v]) => r[k] === v)
    );
    if (limit) res = res.slice(0, Number(limit));
    return res.map(r => ({ ...r }));
  }

  validate(data) {
    return data;
  }

  create(data) {
    const row = { id: this._nextId++, ...data };
    this._rows.push(row);
    return row.id;
  }

  update(id, data) {
    const idx = this._rows.findIndex(r => Number(r.id) === Number(id));
    if (idx === -1) return false;
    this._rows[idx] = { ...this._rows[idx], ...data, id: this._rows[idx].id };
    return true;
  }

  delete(id) {
    const before = this._rows.length;
    this._rows = this._rows.filter(r => Number(r.id) !== Number(id));
    return this._rows.length < before;
  }

  transaction(fn) {
    return fn();
  }
}

test('QueryBuilder: ejecuta CRUD, joins, filtros, agregaciones y bloquea inyección SQL', () => {
  const memDb = new DatabaseSync(':memory:');
  memDb.exec(`
    CREATE TABLE categorias (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL);
    CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, categoria_id INTEGER, precio REAL DEFAULT 0);
  `);

  const catId1 = new QueryBuilder(memDb, 'categorias').insert({ nombre: 'Cuero' });
  const catId2 = new QueryBuilder(memDb, 'categorias').insert({ nombre: 'Suela' });

  new QueryBuilder(memDb, 'items').insert({ nombre: 'Cuero Vacuno', categoria_id: catId1, precio: 1500 });
  new QueryBuilder(memDb, 'items').insert({ nombre: 'Suela TR', categoria_id: catId2, precio: 800 });
  new QueryBuilder(memDb, 'items').insert({ nombre: 'Forro Badana', categoria_id: catId1, precio: 500 });

  const joined = new QueryBuilder(memDb, 'items', 'i')
    .select('i.id', 'i.nombre', 'i.precio', 'c.nombre as categoria_nombre')
    .leftJoin('categorias', 'c', 'i.categoria_id', 'c.id')
    .where('c.nombre', 'Cuero')
    .orderBy('i.precio', 'DESC')
    .all();

  assert.equal(joined.length, 2);
  assert.equal(joined[0].nombre, 'Cuero Vacuno');
  assert.equal(joined[0].categoria_nombre, 'Cuero');

  const inResult = new QueryBuilder(memDb, 'items')
    .whereIn('nombre', ['Suela TR', 'Forro Badana'])
    .orderBy('precio', 'ASC')
    .all();
  assert.equal(inResult.length, 2);
  assert.equal(inResult[0].nombre, 'Forro Badana');

  const totalCount = new QueryBuilder(memDb, 'items').count();
  const totalSum = new QueryBuilder(memDb, 'items').sum('precio');
  assert.equal(totalCount, 3);
  assert.equal(totalSum, 2800);

  new QueryBuilder(memDb, 'items').where('nombre', 'Suela TR').update({ precio: 950 });
  const updated = new QueryBuilder(memDb, 'items').where('nombre', 'Suela TR').get();
  assert.equal(updated.precio, 950);

  new QueryBuilder(memDb, 'items').where('nombre', 'Forro Badana').delete();
  assert.equal(new QueryBuilder(memDb, 'items').count(), 2);

  assert.throws(() => new QueryBuilder(memDb, 'items; DROP TABLE items'), /Identificador inválido/);
  assert.throws(() => new QueryBuilder(memDb, 'items').where('precio', 'OR 1=1', 10), /Operador SQL no permitido/);

  memDb.close();
});

test('SOLID (DIP & LSP): ContactoService funciona con repositorios en memoria sin SQLite', () => {
  const contactoRepo = new InMemoryRepository();
  const compraRepo = new InMemoryRepository([
    { id: 1, contacto_id: 1, total: 1000, estado: 'Confirmado', fecha: '2026-11-10' },
    { id: 2, contacto_id: 1, total: 500, estado: 'Borrador', fecha: '2026-11-11' },
  ]);
  const pagoRepo = new InMemoryRepository([
    { id: 1, contacto_id: 1, monto: 350, estado: 'Confirmado', fecha: '2026-11-12' },
  ]);
  const ventaRepo = new InMemoryRepository([
    { id: 1, contacto_id: 2, total: 2400, estado: 'Confirmada', fecha: '2026-11-12' },
  ]);
  const cobroRepo = new InMemoryRepository([
    { id: 1, contacto_id: 2, monto: 900, estado: 'Confirmado', fecha: '2026-11-13' },
  ]);
  const remitoRepo = new InMemoryRepository();

  const service = new ContactoService({
    contactoRepo,
    compraRepo,
    pagoRepo,
    ventaRepo,
    cobroRepo,
    remitoRepo,
  });

  assert.throws(() => service.createContacto({ nombre: '   ' }), /obligatorio/);

  const provId = service.createContacto({ nombre: 'Curtiembre Mock', es_proveedor: true });
  const cliId = service.createContacto({ nombre: 'Zapatería Mock', es_cliente: true });
  const emptyId = service.createContacto({ nombre: 'Sin Movimientos' });

  const proveedores = service.listContactos({ es_proveedor: true });
  assert.equal(proveedores.length, 1);
  assert.equal(proveedores[0].id, provId);
  assert.equal(proveedores[0].saldo_proveedor, 650);

  const clientes = service.listContactos({ search: 'zapatería' });
  assert.equal(clientes.length, 1);
  assert.equal(clientes[0].id, cliId);
  assert.equal(clientes[0].saldo_cliente, 1500);

  const detalle = service.getContactoById(provId);
  assert.equal(detalle.contacto.nombre, 'Curtiembre Mock');
  assert.equal(detalle.saldo_proveedor, 650);

  assert.equal(service.updateContacto(cliId, { telefono: '11-5555-0000' }), true);
  assert.equal(service.getContactoById(cliId).contacto.telefono, '11-5555-0000');

  assert.throws(() => service.deleteContacto(provId), /comprobantes asociados/);
  assert.throws(() => service.deleteContacto(cliId), /comprobantes asociados/);
  assert.equal(service.deleteContacto(emptyId), true);
  assert.equal(service.getContactoById(emptyId), null);
});

test('SOLID (SRP & DIP): AsientoService valida partida doble estricta y revierte asientos en memoria', () => {
  const asientos = new InMemoryRepository();
  const lineas = new InMemoryRepository();
  const planCuentas = new InMemoryRepository([
    { id: 1, codigo: '1.1.03', nombre: 'Deudores por Ventas', tipo: 'activo', naturaleza: 'deudora' },
    { id: 2, codigo: '4.1.01', nombre: 'Ventas de Productos', tipo: 'ingreso', naturaleza: 'acreedora' },
  ]);
  const diarios = new InMemoryRepository([{ id: 1, codigo: 'VTA-FIS', nombre: 'Diario Ventas', tipo: 'ventas', activo: 1 }]);
  let seq = 1;

  const asientoSvc = new AsientoService({
    asientos,
    lineas,
    planCuentas,
    diarios,
    nextNumeroFn: () => `ASI-${String(seq++).padStart(6, '0')}`,
  });
  asientoSvc.resolvePlanCuenta = (idOrCod) =>
    planCuentas.findAll().find(p => p.id === idOrCod || p.codigo === idOrCod) || null;

  assert.throws(() => asientoSvc.createAsiento({
    fecha: '2026-11-14',
    concepto: 'Desbalanceado',
    lineas: [
      { plan_cuenta_id: 1, debe: 1000, haber: 0 },
      { plan_cuenta_id: 2, debe: 0, haber: 900 },
    ],
  }), /desbalanceado/);

  assert.throws(() => asientoSvc.createAsiento({
    fecha: '2026-11-14',
    concepto: 'Ambos lados',
    lineas: [
      { plan_cuenta_id: 1, debe: 100, haber: 100 },
      { plan_cuenta_id: 2, debe: 0, haber: 0 },
    ],
  }), /simultáneamente/);

  const asientoId = asientoSvc.createAsiento({
    diario_id: 1,
    fecha: '2026-11-14',
    tipo_origen: 'venta',
    origen_id: 10,
    concepto: 'Factura FA-0001',
    lineas: [
      { plan_cuenta_id: 1, debe: 1210, haber: 0 },
      { plan_cuenta_id: 2, debe: 0, haber: 1210 },
    ],
  });

  const det = asientoSvc.getAsientoById(asientoId);
  assert.equal(det.asiento.numero, 'ASI-000001');
  assert.equal(det.lineas.length, 2);

  const contraId = asientoSvc.revertirAsiento(asientoId, { fecha: '2026-11-14', motivo: 'Error de carga' });
  const origAfter = asientoSvc.getAsientoById(asientoId);
  const contraAfter = asientoSvc.getAsientoById(contraId);
  assert.equal(origAfter.asiento.estado, 'Revertido');
  assert.equal(origAfter.asiento.asiento_reversion_id, contraId);
  assert.equal(contraAfter.lineas[0].haber, 1210);
  assert.equal(contraAfter.lineas[1].debe, 1210);
  assert.throws(() => asientoSvc.revertirAsiento(asientoId), /Confirmado/);
});

test('SOLID (DIP & LSP): InventarioBaseService valida ubicaciones, protección de sistema y lotes en memoria sin SQLite', () => {
  const ubicacionRepo = new InMemoryRepository([
    { id: 1, codigo: 'DEP-CENTRAL', nombre: 'Depósito Central', tipo: 'interna', es_sistema: 1, es_default: 1, activa: 1 },
    { id: 2, codigo: 'SEC-A', nombre: 'Estantería A', tipo: 'interna', parent_id: 1, es_sistema: 0, es_default: 0, activa: 1 },
  ]);
  const loteRepo = new InMemoryRepository();
  const stockQuantRepo = new InMemoryRepository([
    { id: 1, ubicacion_id: 2, producto_id: 10, cantidad: 5 },
  ]);

  const svc = new InventarioBaseService({ ubicacionRepo, loteRepo, stockQuantRepo });

  assert.throws(() => svc.createUbicacion({ nombre: '  ' }), /obligatorio/);
  assert.throws(() => svc.deleteUbicacion(1), /protegida/);
  assert.throws(() => svc.deleteUbicacion(2), /stock activo/);

  const newId = svc.createUbicacion({ nombre: 'Estantería B', tipo: 'dedicada', parent_id: 1 });
  assert.ok(newId > 2);
  assert.equal(svc.deleteUbicacion(newId), true);

  const lote1 = svc.resolveOrCreateLote({ producto_id: 10, lote: 'L-001' });
  const lote2 = svc.resolveOrCreateLote({ producto_id: 10, lote: 'L-001' });
  assert.equal(lote1.id, lote2.id);
  assert.equal(loteRepo.findAll().length, 1);
});
