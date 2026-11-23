import {
  buildTablesSql,
  buildAllIndexesSql,
  buildViewsSql,
  buildSchemaSql,
  syncModelColumns,
} from '../core/schemaBuilder.js';
import { MODELS, VIEWS } from './models.js';

export function applySchema(db) {
  const models = Object.values(MODELS);
  db.exec('BEGIN');
  try {
    db.exec(buildTablesSql(models));
    syncModelColumns(db, models);
    db.exec(buildAllIndexesSql(models));
    db.exec(buildViewsSql(VIEWS));
    db.exec("UPDATE diarios SET es_fiscal = 1 WHERE caracter = 'fiscal' AND es_fiscal = 0");

    const vProdCols = db.prepare('PRAGMA table_info(v_productos)').all();
    if (!vProdCols.some(c => c.name === 'costo') || !vProdCols.some(c => c.name === 'custom_fields_json')) {
      db.exec('DROP VIEW IF EXISTS v_productos');
      db.exec(buildSchemaSql([], VIEWS.filter(v => v.name === 'v_productos')));
    }

    // Normalizar permisos legacy de grupos (compras.*/ventas.* -> comercial.*)
    const grupos = db.prepare('SELECT id, permisos_json FROM grupos').all();
    const updGrupo = db.prepare('UPDATE grupos SET permisos_json = ? WHERE id = ?');
    for (const g of grupos) {
      let perms;
      try { perms = JSON.parse(g.permisos_json || '[]'); } catch { continue; }
      if (!Array.isArray(perms)) continue;
      let changed = false;
      const next = [];
      const seen = new Set();
      for (const p of perms) {
        let mapped = p;
        if (p === 'compras.ver' || p === 'ventas.ver') { mapped = 'comercial.ver'; changed = true; }
        else if (p === 'compras.editar' || p === 'ventas.editar') { mapped = 'comercial.editar'; changed = true; }
        if (!seen.has(mapped)) { seen.add(mapped); next.push(mapped); }
      }
      if (changed) updGrupo.run(JSON.stringify(next), g.id);
    }

    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore rollback error */ }
    throw err;
  }
}
