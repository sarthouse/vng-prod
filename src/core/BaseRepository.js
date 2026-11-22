import { db as defaultDb } from '../db.js';
import { getWritableColumns, validateAgainstModel } from './schemaBuilder.js';
import { QueryBuilder } from './QueryBuilder.js';

/**
 * BaseRepository: Clase base OOP para operaciones CRUD estandarizadas sobre SQLite.
 * Acepta un descriptor `model` (SSOT) o configuración explícita `{ table, columns, audit }`.
 */
export class BaseRepository {
  constructor({
    model = null,
    table = null,
    primaryKey = 'id',
    defaultOrder = 'id DESC',
    columns = null,
    audit = false,
    db = defaultDb,
  }) {
    this.model = model;
    this.table = model?.table || table;
    this.primaryKey = primaryKey;
    this.defaultOrder = model?.defaultOrder || defaultOrder;
    this.columns = columns || (model ? getWritableColumns(model) : null);
    this.audit = model ? Boolean(model.audit) : audit;
    this.db = db;
  }

  query(alias = null) {
    return new QueryBuilder(this.db, this.table, alias, this.model);
  }

  findWhere(filters = {}, { orderBy = null, limit = null } = {}) {
    const qb = this.query();
    for (const [k, v] of Object.entries(filters)) {
      if (v !== undefined) qb.where(k, v);
    }
    const order = orderBy || this.defaultOrder;
    if (order) {
      for (const part of String(order).split(',')) {
        const [col, dir] = part.trim().split(/\s+/);
        if (col) qb.orderBy(col, dir || 'ASC');
      }
    }
    if (limit) qb.limit(limit);
    return qb.all();
  }

  findAll({ where = '1=1', params = [], orderBy = this.defaultOrder, limit = null } = {}) {
    const limitSql = limit ? ` LIMIT ${Number(limit)}` : '';
    return this.db
      .prepare(`SELECT * FROM ${this.table} WHERE ${where} ORDER BY ${orderBy}${limitSql}`)
      .all(...params);
  }

  findById(id) {
    return this.db
      .prepare(`SELECT * FROM ${this.table} WHERE ${this.primaryKey} = ?`)
      .get(Number(id)) ?? null;
  }

  find(id) {
    return this.findById(id);
  }

  findOrFail(id, errorMessage = null) {
    const row = this.findById(id);
    if (!row) {
      const err = new Error(errorMessage || `Registro no encontrado en ${this.table} (#${id})`);
      err.status = 404;
      throw err;
    }
    return row;
  }

  _applyWhereObj(qb, whereObj = {}) {
    if (whereObj && typeof whereObj === 'object') {
      for (const [k, v] of Object.entries(whereObj)) {
        if (v !== undefined) qb.where(k, v);
      }
    }
    return qb;
  }

  findBy(whereObj = {}) {
    return this._applyWhereObj(this.query(), whereObj).first();
  }

  first(whereObj = null) {
    return this._applyWhereObj(this.query(), whereObj || {}).first();
  }

  where(col, opOrVal, maybeVal) {
    return this.query().where(col, opOrVal, maybeVal);
  }

  whereIn(col, values = []) {
    return this.query().whereIn(col, values);
  }

  whereNull(col) {
    return this.query().whereNull(col);
  }

  whereNotNull(col) {
    return this.query().whereNotNull(col);
  }

  pluck(col, whereObj = null) {
    return this._applyWhereObj(this.query(), whereObj || {}).pluck(col);
  }

  count(whereObj = null) {
    return this._applyWhereObj(this.query(), whereObj || {}).count();
  }

  exists(whereObj = null) {
    return this._applyWhereObj(this.query(), whereObj || {}).exists();
  }

  findOrCreate(uniqueWhere = {}, defaults = {}, actor = null) {
    return this.transaction(() => {
      const existing = this.findBy(uniqueWhere);
      if (existing) return existing;
      const payload = { ...uniqueWhere, ...defaults };
      this.validate(payload);
      const id = this.create(payload, actor);
      return this.findById(id);
    });
  }

  upsert(uniqueWhere = {}, data = {}, actor = null) {
    return this.transaction(() => {
      const existing = this.findBy(uniqueWhere);
      if (existing) {
        this.validate(data, { partial: true });
        this.update(existing[this.primaryKey], data, actor);
        return this.findById(existing[this.primaryKey]);
      }
      const payload = { ...uniqueWhere, ...data };
      this.validate(payload);
      const id = this.create(payload, actor);
      return this.findById(id);
    });
  }

  validate(data, { partial = false } = {}) {
    return this.model ? validateAgainstModel(this.model, data, { partial }) : data;
  }

  _filterPayload(data) {
    const out = {};
    const keys = this.columns ? this.columns : Object.keys(data || {});
    for (const k of keys) {
      if (data[k] !== undefined) out[k] = data[k];
    }
    return out;
  }

  create(data, actor = null) {
    const payload = this._filterPayload(data);
    if (this.audit && actor) {
      payload.autor_id = actor.id || null;
      payload.autor_nombre = actor.nombre || actor.username || '';
      payload.actualizado_por_id = actor.id || null;
      payload.actualizado_por_nombre = actor.nombre || actor.username || '';
    }
    const cols = Object.keys(payload);
    if (cols.length === 0) throw new Error(`No hay campos válidos para insertar en ${this.table}`);
    const placeholders = cols.map(() => '?').join(', ');
    const info = this.db
      .prepare(`INSERT INTO ${this.table} (${cols.join(', ')}) VALUES (${placeholders})`)
      .run(...cols.map(c => payload[c]));
    return Number(info.lastInsertRowid);
  }

  update(id, data, actor = null) {
    const existing = this.findById(id);
    if (!existing) return false;
    const payload = this._filterPayload(data);
    if (this.audit) {
      if (actor) {
        payload.actualizado_por_id = actor.id || null;
        payload.actualizado_por_nombre = actor.nombre || actor.username || '';
      }
      payload.updated_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
    }
    const cols = Object.keys(payload);
    if (cols.length === 0) return true;
    const setSql = cols.map(c => `${c} = ?`).join(', ');
    this.db
      .prepare(`UPDATE ${this.table} SET ${setSql} WHERE ${this.primaryKey} = ?`)
      .run(...cols.map(c => payload[c]), Number(id));
    return true;
  }

  delete(id) {
    const info = this.db
      .prepare(`DELETE FROM ${this.table} WHERE ${this.primaryKey} = ?`)
      .run(Number(id));
    return info.changes > 0;
  }

  setArchivado(id, archivado = true, actor = null) {
    return this.update(id, { archivado: archivado ? 1 : 0 }, actor);
  }

  transaction(fn) {
    if (this.db.isTransaction) {
      const sp = `sp_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      this.db.exec(`SAVEPOINT ${sp}`);
      try {
        const result = fn();
        this.db.exec(`RELEASE SAVEPOINT ${sp}`);
        return result;
      } catch (e) {
        try { this.db.exec(`ROLLBACK TO SAVEPOINT ${sp}`); } catch { /* ignore */ }
        throw e;
      }
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      try { this.db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    }
  }
}
