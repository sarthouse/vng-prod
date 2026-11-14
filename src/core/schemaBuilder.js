function formatDefault(val) {
  if (val === undefined) return '';
  if (val === null) return ' DEFAULT NULL';
  if (typeof val === 'number') return ` DEFAULT ${val}`;
  if (typeof val === 'string') {
    if (val.startsWith('(') && val.endsWith(')')) return ` DEFAULT ${val}`;
    return ` DEFAULT '${val.replace(/'/g, "''")}'`;
  }
  return '';
}

export function buildCreateTableSql(model) {
  const defs = [];
  if (model.primaryKey !== false) {
    defs.push('id INTEGER PRIMARY KEY AUTOINCREMENT');
  }

  for (const [name, f] of Object.entries(model.fields || {})) {
    let col = `${name} ${f.type || 'TEXT'}`;
    if (f.primaryKey) col += ' PRIMARY KEY';
    if (f.unique) col += ' UNIQUE';
    if (f.notNull) col += ' NOT NULL';
    if (f.default !== undefined) col += formatDefault(f.default);
    if (f.references) {
      col += ` REFERENCES ${f.references}`;
      if (f.onDelete) col += ` ON DELETE ${f.onDelete}`;
    }
    if (f.check) col += ` CHECK (${f.check})`;
    defs.push(col);
  }

  if (model.audit) {
    defs.push('autor_id INTEGER');
    defs.push("autor_nombre TEXT DEFAULT ''");
    defs.push('actualizado_por_id INTEGER');
    defs.push("actualizado_por_nombre TEXT DEFAULT ''");
    defs.push('updated_at TEXT');
  }

  if (model.timestamps !== false) {
    defs.push("created_at TEXT NOT NULL DEFAULT (datetime('now'))");
    if (model.updatedAt && !model.audit) {
      defs.push("updated_at TEXT NOT NULL DEFAULT (datetime('now'))");
    }
  }

  if (Array.isArray(model.constraints)) {
    defs.push(...model.constraints);
  }

  return `CREATE TABLE IF NOT EXISTS ${model.table} (\n  ${defs.join(',\n  ')}\n);`;
}

export function buildIndexesSql(model) {
  if (!Array.isArray(model.indexes) || !model.indexes.length) return '';
  return model.indexes
    .map(idx => `CREATE ${idx.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${idx.name} ON ${model.table}(${idx.columns.join(', ')});`)
    .join('\n');
}

export function buildModelsSql(models) {
  return models
    .map(m => [buildCreateTableSql(m), buildIndexesSql(m)].filter(Boolean).join('\n'))
    .join('\n\n');
}

export function buildViewSql(view) {
  const fromClause = view.alias ? `${view.from} ${view.alias}` : view.from;
  const parts = [
    `CREATE VIEW IF NOT EXISTS ${view.name} AS`,
    `SELECT ${view.select.join(', ')}`,
    `FROM ${fromClause}`,
  ];
  if (Array.isArray(view.joins) && view.joins.length) parts.push(view.joins.join('\n'));
  if (view.where) parts.push(`WHERE ${view.where}`);
  if (Array.isArray(view.groupBy) && view.groupBy.length) parts.push(`GROUP BY ${view.groupBy.join(', ')}`);
  return parts.join('\n') + ';';
}

export function buildTablesSql(models) {
  return models.map(buildCreateTableSql).join('\n\n');
}

export function buildAllIndexesSql(models) {
  return models.map(buildIndexesSql).filter(Boolean).join('\n\n');
}

export function buildViewsSql(views = []) {
  return views.map(buildViewSql).filter(Boolean).join('\n\n');
}

export function buildSchemaSql(models, views = []) {
  return [
    buildModelsSql(models),
    ...views.map(buildViewSql),
  ].filter(Boolean).join('\n\n');
}

/**
 * Sincroniza columnas faltantes definidas en MODELS sobre tablas SQLite existentes.
 * Mantiene MODELS (SSOT) alineado con bases de datos creadas en versiones previas.
 */
export function syncModelColumns(db, models) {
  for (const model of models) {
    if (!model?.table || !model?.fields) continue;
    const cols = db.prepare(`PRAGMA table_info(${model.table})`).all();
    if (!cols.length) continue;
    const existing = new Set(cols.map(c => c.name));

    for (const [name, f] of Object.entries(model.fields)) {
      if (existing.has(name)) continue;
      const type = f.type || 'TEXT';
      const isNonConstantDefault = typeof f.default === 'string' && f.default.startsWith('(') && f.default.endsWith(')');
      let ddl = type;

      if (f.default !== undefined && !isNonConstantDefault) {
        if (f.notNull && f.default !== null) {
          ddl += ' NOT NULL';
        }
        ddl += formatDefault(f.default);
      }

      db.exec(`ALTER TABLE ${model.table} ADD COLUMN ${name} ${ddl}`);
      existing.add(name);
    }
  }
}

export function getWritableColumns(model) {
  return Object.keys(model?.fields || {});
}

export function validateAgainstModel(model, data = {}, { partial = false } = {}) {
  if (!model?.fields) return data;
  const out = {};

  for (const [name, f] of Object.entries(model.fields)) {
    const hasKey = Object.prototype.hasOwnProperty.call(data, name) && data[name] !== undefined;
    if (!hasKey) {
      if (!partial && f.required) {
        throw new Error(`El campo "${f.label || name}" es obligatorio`);
      }
      continue;
    }

    let val = data[name];
    if (f.boolean) {
      out[name] = val ? 1 : 0;
      continue;
    }

    if ((f.type || 'TEXT') === 'TEXT') {
      val = val === null ? null : String(val);
      if (f.trim !== false && typeof val === 'string') val = val.trim();
      if (!partial && f.required && !val) {
        throw new Error(`El campo "${f.label || name}" es obligatorio`);
      }
      if (f.enum && val && !f.enum.includes(val)) {
        throw new Error(`Valor inválido para "${f.label || name}": ${val}`);
      }
      out[name] = val;
      continue;
    }

    if (f.type === 'INTEGER' || f.type === 'REAL') {
      if (val === '' || val === null) {
        if (!partial && f.required) {
          throw new Error(`El campo "${f.label || name}" es obligatorio`);
        }
        out[name] = f.default !== undefined ? f.default : null;
        continue;
      }
      const num = f.type === 'INTEGER' ? parseInt(val, 10) : Number(val);
      if (!Number.isFinite(num)) {
        throw new Error(`El campo "${f.label || name}" debe ser numérico`);
      }
      if (f.min !== undefined && num < f.min) {
        throw new Error(`El campo "${f.label || name}" debe ser mayor o igual a ${f.min}`);
      }
      out[name] = num;
      continue;
    }

    out[name] = val;
  }

  return out;
}
