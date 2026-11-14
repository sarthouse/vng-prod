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
    if (!vProdCols.some(c => c.name === 'costo')) {
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

    // Asegurar secuencias diferenciadas para Ventas (A, B, C y X internas) en bases existentes
    const seqVentaExtra = [
      ['venta_b', 'Facturas de Venta B', 'ventas', 'FB'],
      ['venta_c', 'Facturas de Venta C', 'ventas', 'FC'],
      ['venta_x', 'Facturas de Venta X (Internas)', 'ventas', 'FX'],
      ['nc_venta_b', 'Notas de Crédito Venta B', 'ventas', 'NCB'],
      ['nc_venta_c', 'Notas de Crédito Venta C', 'ventas', 'NCC'],
      ['nc_venta_x', 'Notas de Crédito Venta X (Internas)', 'ventas', 'NCX'],
      ['nd_venta_b', 'Notas de Débito Venta B', 'ventas', 'NDB'],
      ['nd_venta_c', 'Notas de Débito Venta C', 'ventas', 'NDC'],
      ['nd_venta_x', 'Notas de Débito Venta X (Internas)', 'ventas', 'NDX'],
    ];
    const insSeq = db.prepare(`
      INSERT OR IGNORE INTO secuencias (codigo, nombre, dominio, prefijo, sufijo, padding, siguiente_numero, usa_punto_venta, activo)
      VALUES (?, ?, ?, ?, '', 8, 1, 1, 1)
    `);
    for (const row of seqVentaExtra) insSeq.run(...row);

    const insTerm = db.prepare(`
      INSERT OR IGNORE INTO terminos_pago (nombre, dias, cuotas_json, descripcion, activo)
      VALUES (?, ?, ?, ?, 1)
    `);
    for (const [n, d, c, desc] of [
      ['Contado', 0, '[]', 'Pago inmediato al emitir comprobante'],
      ['15 días', 15, '[{"dias":15,"porcentaje":100}]', 'Vencimiento a 15 días fecha factura'],
      ['30 días', 30, '[{"dias":30,"porcentaje":100}]', 'Cuenta corriente 30 días'],
      ['60 días', 60, '[{"dias":60,"porcentaje":100}]', 'Cuenta corriente 60 días'],
      ['30 / 60 días', 30, '[{"dias":30,"porcentaje":50},{"dias":60,"porcentaje":50}]', '50% a 30 días y 50% a 60 días'],
    ]) insTerm.run(n, d, c, desc);

    const insMet = db.prepare(`
      INSERT OR IGNORE INTO metodos_pago (nombre, tipo, requiere_referencia, activo)
      VALUES (?, ?, ?, 1)
    `);
    for (const [n, t, reqRef] of [
      ['Efectivo', 'efectivo', 0],
      ['Transferencia', 'banco', 1],
      ['Cheque', 'cheque', 1],
      ['MercadoPago', 'digital', 1],
      ['Tarjeta de Débito', 'banco', 1],
      ['Tarjeta de Crédito', 'banco', 1],
    ]) insMet.run(n, t, reqRef);

    const insLista = db.prepare(`
      INSERT OR IGNORE INTO listas_precios (nombre, moneda, descuento_pct, recargo_pct, es_default, activo, observaciones)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `);
    insLista.run('Lista Base (Minorista)', 'ARS', 0, 0, 1, 'Precio estándar de catálogo');
    insLista.run('Lista Mayorista', 'ARS', 15, 0, 0, '15% de descuento por defecto sobre catálogo');

    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore rollback error */ }
    throw err;
  }
}
