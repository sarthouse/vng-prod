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
    return new QueryBuilder(this.db, this.table, alias);
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
      .get(Number(id));
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
