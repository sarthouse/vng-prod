const SAFE_IDENT = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;
const ALLOWED_OPS = new Set(['=', '!=', '<>', '<', '<=', '>', '>=', 'LIKE', 'NOT LIKE', 'IS', 'IS NOT']);
const SYSTEM_COLS = new Set(['id', 'created_at', 'updated_at', 'autor_id', 'autor_nombre', 'actualizado_por_id', 'actualizado_por_nombre']);

function safeIdent(id) {
  const s = String(id || '').trim();
  if (!SAFE_IDENT.test(s)) throw new Error(`Identificador inválido en QueryBuilder: "${s}"`);
  return s;
}

export class QueryBuilder {
  constructor(db, table = null, alias = null, model = null) {
    this.db = db;
    this._table = table ? safeIdent(table) : null;
    this._alias = alias ? safeIdent(alias) : null;
    this._model = model || null;
    const schemaCols = model?.fields || model?.columns;
    this._allowedCols = schemaCols
      ? new Set([...SYSTEM_COLS, ...Object.keys(schemaCols)])
      : null;
    this._selects = ['*'];
    this._joins = [];
    this._wheres = [];
    this._params = [];
    this._groups = [];
    this._orders = [];
    this._limit = null;
  }

  _safeCol(col) {
    const c = safeIdent(col);
    if (!this._allowedCols) return c;
    if (c.includes('.')) {
      const [prefix, field] = c.split('.');
      if (prefix === this._table || (this._alias && prefix === this._alias)) {
        if (!this._allowedCols.has(field)) {
          throw new Error(`Columna no permitida en ${this._table}: "${c}"`);
        }
      }
      return c;
    }
    if (!this._joins.length && !this._allowedCols.has(c)) {
      throw new Error(`Columna no permitida en ${this._table}: "${c}"`);
    }
    return c;
  }

  from(table, alias = null) {
    this._table = safeIdent(table);
    this._alias = alias ? safeIdent(alias) : null;
    return this;
  }

  select(...cols) {
    const flat = cols.flat().filter(Boolean);
    if (flat.length) this._selects = flat;
    return this;
  }

  leftJoin(table, alias, leftCol, rightCol) {
    this._joins.push(`LEFT JOIN ${safeIdent(table)} ${safeIdent(alias)} ON ${safeIdent(leftCol)} = ${safeIdent(rightCol)}`);
    return this;
  }

  innerJoin(table, alias, leftCol, rightCol) {
    this._joins.push(`INNER JOIN ${safeIdent(table)} ${safeIdent(alias)} ON ${safeIdent(leftCol)} = ${safeIdent(rightCol)}`);
    return this;
  }

  _buildCondition(col, opOrVal, maybeVal) {
    const c = this._safeCol(col);
    if (maybeVal === undefined) {
      if (opOrVal === null) {
        return { clause: `${c} IS NULL`, params: [] };
      }
      return { clause: `${c} = ?`, params: [opOrVal] };
    }
    const op = String(opOrVal).toUpperCase().trim();
    if (!ALLOWED_OPS.has(op)) throw new Error(`Operador SQL no permitido: ${op}`);
    if (maybeVal === null && (op === 'IS' || op === 'IS NOT')) {
      return { clause: `${c} ${op} NULL`, params: [] };
    }
    return { clause: `${c} ${op} ?`, params: [maybeVal] };
  }

  where(col, opOrVal, maybeVal) {
    const { clause, params } = this._buildCondition(col, opOrVal, maybeVal);
    this._wheres.push(clause);
    this._params.push(...params);
    return this;
  }

  orWhere(col, opOrVal, maybeVal) {
    const { clause, params } = this._buildCondition(col, opOrVal, maybeVal);
    if (this._wheres.length === 0) {
      this._wheres.push(clause);
    } else {
      const prev = this._wheres.join(' AND ');
      this._wheres = [`(${prev} OR ${clause})`];
    }
    this._params.push(...params);
    return this;
  }

  whereBetween(col, range) {
    const c = this._safeCol(col);
    if (!Array.isArray(range) || range.length !== 2) {
      throw new Error('whereBetween requiere un arreglo [min, max]');
    }
    this._wheres.push(`${c} BETWEEN ? AND ?`);
    this._params.push(range[0], range[1]);
    return this;
  }

  whereIn(col, values = []) {
    const c = this._safeCol(col);
    if (!Array.isArray(values) || values.length === 0) {
      this._wheres.push('1 = 0');
      return this;
    }
    this._wheres.push(`${c} IN (${values.map(() => '?').join(', ')})`);
    this._params.push(...values);
    return this;
  }

  whereNotIn(col, values = []) {
    const c = this._safeCol(col);
    if (!Array.isArray(values) || values.length === 0) return this;
    this._wheres.push(`${c} NOT IN (${values.map(() => '?').join(', ')})`);
    this._params.push(...values);
    return this;
  }

  whereNull(col) {
    this._wheres.push(`${this._safeCol(col)} IS NULL`);
    return this;
  }

  whereNotNull(col) {
    this._wheres.push(`${this._safeCol(col)} IS NOT NULL`);
    return this;
  }

  groupBy(...cols) {
    for (const c of cols.flat()) this._groups.push(this._safeCol(c));
    return this;
  }

  orderBy(col, dir = 'ASC') {
    const d = String(dir).toUpperCase().trim();
    if (d !== 'ASC' && d !== 'DESC') {
      throw new Error(`Dirección de orden inválida en QueryBuilder: "${dir}"`);
    }
    this._orders.push(`${this._safeCol(col)} ${d}`);
    return this;
  }

  limit(n) {
    this._limit = Math.max(0, Number(n) || 0);
    return this;
  }

  toSelectSql() {
    if (!this._table) throw new Error('QueryBuilder requiere tabla (.from)');
    const fromClause = this._alias ? `${this._table} ${this._alias}` : this._table;
    const parts = [
      `SELECT ${this._selects.join(', ')}`,
      `FROM ${fromClause}`,
    ];
    if (this._joins.length) parts.push(this._joins.join(' '));
    if (this._wheres.length) parts.push(`WHERE ${this._wheres.join(' AND ')}`);
    if (this._groups.length) parts.push(`GROUP BY ${this._groups.join(', ')}`);
    if (this._orders.length) parts.push(`ORDER BY ${this._orders.join(', ')}`);
    if (this._limit !== null) parts.push(`LIMIT ${this._limit}`);
    return { sql: parts.join(' '), params: [...this._params] };
  }

  all() {
    const { sql, params } = this.toSelectSql();
    return this.db.prepare(sql).all(...params);
  }

  get() {
    const { sql, params } = this.toSelectSql();
    return this.db.prepare(sql).get(...params) ?? null;
  }

  first() {
    const prevLimit = this._limit;
    this._limit = 1;
    try {
      return this.get();
    } finally {
      this._limit = prevLimit;
    }
  }

  pluck(col) {
    const c = this._safeCol(col);
    const key = c.includes('.') ? c.split('.').pop() : c;
    const prev = this._selects;
    this._selects = [c];
    try {
      return this.all().map(r => r[key]);
    } finally {
      this._selects = prev;
    }
  }

  exists() {
    const prevSelects = this._selects;
    const prevLimit = this._limit;
    this._selects = ['1 as _ok'];
    this._limit = 1;
    try {
      return Boolean(this.get());
    } finally {
      this._selects = prevSelects;
      this._limit = prevLimit;
    }
  }

  count(col = '*') {
    const prev = this._selects;
    this._selects = [`COUNT(${col === '*' ? '*' : safeIdent(col)}) as total`];
    const row = this.get();
    this._selects = prev;
    return Number(row?.total || 0);
  }

  sum(col) {
    const prev = this._selects;
    this._selects = [`COALESCE(SUM(${safeIdent(col)}), 0) as total`];
    const row = this.get();
    this._selects = prev;
    return Number(row?.total || 0);
  }

  insert(data) {
    const keys = Object.keys(data || {}).map(safeIdent);
    if (!keys.length) throw new Error('insert() requiere al menos un campo');
    const sql = `INSERT INTO ${this._table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
    const info = this.db.prepare(sql).run(...keys.map(k => data[k]));
    return Number(info.lastInsertRowid);
  }

  update(data) {
    const keys = Object.keys(data || {}).map(safeIdent);
    if (!keys.length) return 0;
    const setSql = keys.map(k => `${k} = ?`).join(', ');
    const whereSql = this._wheres.length ? ` WHERE ${this._wheres.join(' AND ')}` : '';
    const sql = `UPDATE ${this._table} SET ${setSql}${whereSql}`;
    const info = this.db.prepare(sql).run(...keys.map(k => data[k]), ...this._params);
    return info.changes;
  }

  delete() {
    const whereSql = this._wheres.length ? ` WHERE ${this._wheres.join(' AND ')}` : '';
    const info = this.db.prepare(`DELETE FROM ${this._table}${whereSql}`).run(...this._params);
    return info.changes;
  }
}
