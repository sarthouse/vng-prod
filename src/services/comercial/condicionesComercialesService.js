import { db } from '../../db.js';
import { BaseRepository } from '../../core/BaseRepository.js';
import { MODELS } from '../../db/models.js';

export const terminoPagoRepo = new BaseRepository({ model: MODELS.terminos_pago, defaultOrder: 'dias ASC, nombre ASC' });
export const metodoPagoRepo = new BaseRepository({ model: MODELS.metodos_pago, defaultOrder: 'nombre ASC' });
export const listaPrecioRepo = new BaseRepository({ model: MODELS.listas_precios, defaultOrder: 'es_default DESC, nombre ASC' });
export const listaPrecioItemRepo = new BaseRepository({ model: MODELS.lista_precio_items, defaultOrder: 'id ASC' });
export const productoProveedorRepo = new BaseRepository({ model: MODELS.producto_proveedores, defaultOrder: 'prioridad ASC, id ASC' });

// ── Términos de Pago ──────────────────────────────────────────────────────────

export function listTerminosPago({ solo_activos = false } = {}) {
  const q = terminoPagoRepo.query();
  if (solo_activos) q.where('activo', 1);
  return q.orderBy('dias', 'ASC').orderBy('nombre', 'ASC').all();
}

export function createTerminoPago(b = {}) {
  const nombre = String(b.nombre || '').trim();
  if (!nombre) throw new Error('El nombre del término de pago es obligatorio');
  const dias = Math.max(0, Math.round(Number(b.dias) || 0));
  let cuotasJson = '[]';
  if (Array.isArray(b.cuotas)) cuotasJson = JSON.stringify(b.cuotas);
  else if (typeof b.cuotas_json === 'string' && b.cuotas_json.trim()) cuotasJson = b.cuotas_json.trim();
  return terminoPagoRepo.create({
    nombre,
    dias,
    cuotas_json: cuotasJson,
    descripcion: String(b.descripcion || '').trim(),
    activo: b.activo === false || b.activo === 0 ? 0 : 1,
  });
}

export function updateTerminoPago(id, b = {}) {
  const row = terminoPagoRepo.findById(id);
  if (!row) return false;
  const patch = {};
  if (b.nombre !== undefined) patch.nombre = String(b.nombre || '').trim() || row.nombre;
  if (b.dias !== undefined) patch.dias = Math.max(0, Math.round(Number(b.dias) || 0));
  if (Array.isArray(b.cuotas)) patch.cuotas_json = JSON.stringify(b.cuotas);
  else if (b.cuotas_json !== undefined) patch.cuotas_json = String(b.cuotas_json || '[]');
  if (b.descripcion !== undefined) patch.descripcion = String(b.descripcion || '').trim();
  if (b.activo !== undefined) patch.activo = b.activo ? 1 : 0;
  terminoPagoRepo.update(id, patch);
  return true;
}

export function deleteTerminoPago(id) {
  return terminoPagoRepo.delete(id);
}

export function calcularFechaVencimiento(fechaBase, terminoPagoId) {
  const base = String(fechaBase || '').trim() || new Date().toISOString().slice(0, 10);
  if (!terminoPagoId) return '';
  const term = terminoPagoRepo.findById(Number(terminoPagoId));
  if (!term) return '';
  let dias = Number(term.dias) || 0;
  if (dias === 0 && term.cuotas_json) {
    try {
      const cuotas = JSON.parse(term.cuotas_json);
      if (Array.isArray(cuotas) && cuotas.length) {
        dias = Math.max(...cuotas.map(c => Number(c.dias) || 0));
      }
    } catch { /* ignore */ }
  }
  const dt = new Date(`${base.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return base;
  dt.setUTCDate(dt.getUTCDate() + Math.max(0, dias));
  return dt.toISOString().slice(0, 10);
}

// ── Métodos de Pago ───────────────────────────────────────────────────────────

export function listMetodosPago({ solo_activos = false } = {}) {
  const q = metodoPagoRepo.query('mp')
    .select('mp.*', "COALESCE(c.nombre, '') as cuenta_nombre")
    .leftJoin('cuentas', 'c', 'c.id', 'mp.cuenta_id');
  if (solo_activos) q.where('mp.activo', 1);
  return q.orderBy('mp.nombre', 'ASC').all();
}

export function createMetodoPago(b = {}) {
  const nombre = String(b.nombre || '').trim();
  if (!nombre) throw new Error('El nombre del método de pago es obligatorio');
  const validTipos = new Set(['efectivo', 'banco', 'cheque', 'digital', 'otro']);
  const tipo = validTipos.has(b.tipo) ? b.tipo : 'banco';
  return metodoPagoRepo.create({
    nombre,
    tipo,
    cuenta_id: b.cuenta_id ? Number(b.cuenta_id) : null,
    requiere_referencia: b.requiere_referencia ? 1 : 0,
    activo: b.activo === false || b.activo === 0 ? 0 : 1,
  });
}

export function updateMetodoPago(id, b = {}) {
  const row = metodoPagoRepo.findById(id);
  if (!row) return false;
  const validTipos = new Set(['efectivo', 'banco', 'cheque', 'digital', 'otro']);
  const patch = {};
  if (b.nombre !== undefined) patch.nombre = String(b.nombre || '').trim() || row.nombre;
  if (b.tipo !== undefined && validTipos.has(b.tipo)) patch.tipo = b.tipo;
  if (b.cuenta_id !== undefined) patch.cuenta_id = b.cuenta_id ? Number(b.cuenta_id) : null;
  if (b.requiere_referencia !== undefined) patch.requiere_referencia = b.requiere_referencia ? 1 : 0;
  if (b.activo !== undefined) patch.activo = b.activo ? 1 : 0;
  metodoPagoRepo.update(id, patch);
  return true;
}

export function deleteMetodoPago(id) {
  return metodoPagoRepo.delete(id);
}

// ── Listas de Precios ─────────────────────────────────────────────────────────

export function listListasPrecios({ solo_activos = false } = {}) {
  let sql = `
    SELECT lp.*, (SELECT COUNT(*) FROM lista_precio_items i WHERE i.lista_precio_id = lp.id) as cantidad_items
    FROM listas_precios lp
  `;
  if (solo_activos) sql += ' WHERE lp.activo = 1';
  sql += ' ORDER BY lp.es_default DESC, lp.nombre ASC';
  return db.prepare(sql).all();
}

export function getListaPrecioById(id) {
  const lista = listaPrecioRepo.findById(id);
  if (!lista) return null;
  const items = db.prepare(`
    SELECT i.*,
           COALESCE(p.nombre, '') as producto_nombre,
           COALESCE(p.sku, '') as sku,
           COALESCE(p.precio, 0) as precio_catalogo,
           COALESCE(pt.nombre, '') as plantilla_nombre
    FROM lista_precio_items i
    LEFT JOIN productos p ON p.id = i.producto_id
    LEFT JOIN producto_plantillas pt ON pt.id = i.plantilla_id
    WHERE i.lista_precio_id = ?
    ORDER BY i.id ASC
  `).all(Number(id));
  return { ...lista, items };
}

export function createListaPrecio(b = {}) {
  const nombre = String(b.nombre || '').trim();
  if (!nombre) throw new Error('El nombre de la lista de precios es obligatorio');
  return listaPrecioRepo.transaction(() => {
    const esDefault = b.es_default ? 1 : 0;
    if (esDefault) db.prepare('UPDATE listas_precios SET es_default = 0').run();
    const id = listaPrecioRepo.create({
      nombre,
      moneda: String(b.moneda || 'ARS').trim().toUpperCase(),
      descuento_pct: Number(b.descuento_pct) || 0,
      recargo_pct: Number(b.recargo_pct) || 0,
      es_default: esDefault,
      activo: b.activo === false || b.activo === 0 ? 0 : 1,
      observaciones: String(b.observaciones || '').trim(),
    });
    if (Array.isArray(b.items)) replaceListaItems(id, b.items);
    return id;
  });
}

export function updateListaPrecio(id, b = {}) {
  const row = listaPrecioRepo.findById(id);
  if (!row) return false;
  return listaPrecioRepo.transaction(() => {
    const patch = {};
    if (b.nombre !== undefined) patch.nombre = String(b.nombre || '').trim() || row.nombre;
    if (b.moneda !== undefined) patch.moneda = String(b.moneda || 'ARS').trim().toUpperCase();
    if (b.descuento_pct !== undefined) patch.descuento_pct = Number(b.descuento_pct) || 0;
    if (b.recargo_pct !== undefined) patch.recargo_pct = Number(b.recargo_pct) || 0;
    if (b.observaciones !== undefined) patch.observaciones = String(b.observaciones || '').trim();
    if (b.activo !== undefined) patch.activo = b.activo ? 1 : 0;
    if (b.es_default !== undefined) {
      patch.es_default = b.es_default ? 1 : 0;
      if (patch.es_default) db.prepare('UPDATE listas_precios SET es_default = 0 WHERE id != ?').run(Number(id));
    }
    if (Object.keys(patch).length) listaPrecioRepo.update(id, patch);
    if (Array.isArray(b.items)) replaceListaItems(Number(id), b.items);
    return true;
  });
}

function replaceListaItems(listaId, items) {
  db.prepare('DELETE FROM lista_precio_items WHERE lista_precio_id = ?').run(Number(listaId));
  for (const it of items) {
    const prodId = it.producto_id ? Number(it.producto_id) : null;
    const ptId = it.plantilla_id ? Number(it.plantilla_id) : null;
    if (!prodId && !ptId) continue;
    const precioFijo = it.precio_fijo !== undefined && it.precio_fijo !== '' && it.precio_fijo !== null
      ? Number(it.precio_fijo)
      : null;
    listaPrecioItemRepo.create({
      lista_precio_id: Number(listaId),
      producto_id: prodId,
      plantilla_id: ptId,
      precio_fijo: precioFijo,
      descuento_pct: Number(it.descuento_pct) || 0,
      cantidad_minima: Math.max(0, Number(it.cantidad_minima) || 1),
    });
  }
}

export function addListaPrecioItem(listaId, it = {}) {
  const prodId = it.producto_id ? Number(it.producto_id) : null;
  const ptId = it.plantilla_id ? Number(it.plantilla_id) : null;
  if (!prodId && !ptId) throw new Error('Debe indicar un producto o plantilla');
  const precioFijo = it.precio_fijo !== undefined && it.precio_fijo !== '' && it.precio_fijo !== null
    ? Number(it.precio_fijo)
    : null;
  return listaPrecioItemRepo.create({
    lista_precio_id: Number(listaId),
    producto_id: prodId,
    plantilla_id: ptId,
    precio_fijo: precioFijo,
    descuento_pct: Number(it.descuento_pct) || 0,
    cantidad_minima: Math.max(0, Number(it.cantidad_minima) || 1),
  });
}

export function deleteListaPrecioItem(itemId) {
  return listaPrecioItemRepo.delete(itemId);
}

export function deleteListaPrecio(id) {
  return listaPrecioRepo.delete(id);
}

export function resolverPrecioLista({ lista_precio_id = null, contacto_id = null, producto_id = null, cantidad = 1, precio_base = null } = {}) {
  const prod = producto_id
    ? db.prepare('SELECT id, plantilla_id, precio FROM productos WHERE id = ?').get(Number(producto_id))
    : null;
  const base = precio_base !== null && precio_base !== undefined
    ? Number(precio_base) || 0
    : Number(prod?.precio || 0);

  let lpId = lista_precio_id ? Number(lista_precio_id) : null;
  if (!lpId && contacto_id) {
    const c = db.prepare('SELECT lista_precio_id FROM contactos WHERE id = ?').get(Number(contacto_id));
    if (c?.lista_precio_id) lpId = Number(c.lista_precio_id);
  }
  let lista = lpId
    ? db.prepare('SELECT * FROM listas_precios WHERE id = ? AND activo = 1').get(lpId)
    : null;
  if (!lista) {
    lista = db.prepare('SELECT * FROM listas_precios WHERE es_default = 1 AND activo = 1 LIMIT 1').get() || null;
  }
  if (!lista) {
    return {
      lista_precio_id: null,
      lista_nombre: 'Catálogo',
      precio_base: Number(base.toFixed(2)),
      precio_unitario: Number(base.toFixed(2)),
      descuento_aplicado_pct: 0,
      origen: 'catalogo',
    };
  }

  const qty = Math.max(0, Number(cantidad) || 1);
  let regla = null;
  if (prod?.id) {
    regla = db.prepare(`
      SELECT * FROM lista_precio_items
      WHERE lista_precio_id = ? AND producto_id = ? AND cantidad_minima <= ?
      ORDER BY cantidad_minima DESC, id DESC LIMIT 1
    `).get(lista.id, prod.id, qty);
  }
  if (!regla && prod?.plantilla_id) {
    regla = db.prepare(`
      SELECT * FROM lista_precio_items
      WHERE lista_precio_id = ? AND producto_id IS NULL AND plantilla_id = ? AND cantidad_minima <= ?
      ORDER BY cantidad_minima DESC, id DESC LIMIT 1
    `).get(lista.id, prod.plantilla_id, qty);
  }

  let precioFinal = base;
  let origen = 'lista_global';
  let descAplicado = 0;

  if (regla) {
    if (regla.precio_fijo !== null && regla.precio_fijo !== undefined) {
      precioFinal = Number(regla.precio_fijo) || 0;
      origen = 'regla_precio_fijo';
      descAplicado = base > 0 ? Number((((base - precioFinal) / base) * 100).toFixed(2)) : 0;
    } else {
      descAplicado = Number(regla.descuento_pct) || 0;
      precioFinal = base * (1 - descAplicado / 100);
      origen = 'regla_descuento';
    }
  } else {
    const descGlobal = Number(lista.descuento_pct) || 0;
    const recGlobal = Number(lista.recargo_pct) || 0;
    precioFinal = base * (1 - descGlobal / 100) * (1 + recGlobal / 100);
    descAplicado = Number((descGlobal - recGlobal).toFixed(2));
  }

  return {
    lista_precio_id: lista.id,
    lista_nombre: lista.nombre,
    precio_base: Number(base.toFixed(2)),
    precio_unitario: Number(Math.max(0, precioFinal).toFixed(2)),
    descuento_aplicado_pct: descAplicado,
    origen,
  };
}

export function getContactoCondiciones(contactoId) {
  if (!contactoId) return null;
  const c = db.prepare(`
    SELECT id, nombre, termino_pago_id, termino_pago_compra_id, metodo_pago_id, lista_precio_id
    FROM contactos WHERE id = ?
  `).get(Number(contactoId));
  if (!c) return null;
  const termino = c.termino_pago_id ? terminoPagoRepo.findById(c.termino_pago_id) : null;
  const terminoCompra = c.termino_pago_compra_id ? terminoPagoRepo.findById(c.termino_pago_compra_id) : null;
  const metodo = c.metodo_pago_id ? metodoPagoRepo.findById(c.metodo_pago_id) : null;
  const lista = c.lista_precio_id ? listaPrecioRepo.findById(c.lista_precio_id) : null;
  return {
    contacto_id: c.id,
    termino_pago_id: c.termino_pago_id || null,
    termino_pago_compra_id: c.termino_pago_compra_id || null,
    metodo_pago_id: c.metodo_pago_id || null,
    lista_precio_id: c.lista_precio_id || null,
    termino_pago: termino,
    termino_pago_compra: terminoCompra,
    metodo_pago: metodo,
    lista_precio: lista,
  };
}

// ── Tarifas de Compra por Variante / Plantilla y Proveedor ────────────────────

export function listProductoProveedores({ plantilla_id = null, producto_id = null, contacto_id = null } = {}) {
  let sql = `
    SELECT pp.*,
           COALESCE(c.nombre, '') as proveedor_nombre,
           COALESCE(p.nombre, '') as producto_nombre,
           COALESCE(p.sku, '') as sku,
           COALESCE(pt.nombre, '') as plantilla_nombre
    FROM producto_proveedores pp
    JOIN contactos c ON c.id = pp.contacto_id
    LEFT JOIN productos p ON p.id = pp.producto_id
    LEFT JOIN producto_plantillas pt ON pt.id = pp.plantilla_id
    WHERE 1=1
  `;
  const params = [];
  if (plantilla_id) { sql += ' AND (pp.plantilla_id = ? OR p.plantilla_id = ?)'; params.push(Number(plantilla_id), Number(plantilla_id)); }
  if (producto_id) { sql += ' AND pp.producto_id = ?'; params.push(Number(producto_id)); }
  if (contacto_id) { sql += ' AND pp.contacto_id = ?'; params.push(Number(contacto_id)); }
  sql += ' ORDER BY pp.prioridad ASC, pp.cantidad_minima ASC, pp.id ASC';
  return db.prepare(sql).all(...params);
}

export function createProductoProveedor(b = {}) {
  const contactoId = b.contacto_id ? Number(b.contacto_id) : null;
  const productoId = b.producto_id ? Number(b.producto_id) : null;
  let plantillaId = b.plantilla_id ? Number(b.plantilla_id) : null;
  if (!contactoId) throw new Error('Debe seleccionar un proveedor');
  if (!productoId && !plantillaId) throw new Error('Debe indicar una plantilla o variante');
  if (productoId && !plantillaId) {
    const p = db.prepare('SELECT plantilla_id FROM productos WHERE id = ?').get(productoId);
    plantillaId = p?.plantilla_id || null;
  }
  return productoProveedorRepo.create({
    plantilla_id: plantillaId,
    producto_id: productoId,
    contacto_id: contactoId,
    codigo_proveedor: String(b.codigo_proveedor || '').trim(),
    precio: Math.max(0, Number(b.precio) || 0),
    moneda: String(b.moneda || 'ARS').trim().toUpperCase(),
    cantidad_minima: Math.max(0, Number(b.cantidad_minima) || 1),
    lead_time_dias: Math.max(0, Math.round(Number(b.lead_time_dias) || 0)),
    prioridad: Math.max(1, Math.round(Number(b.prioridad) || 1)),
    activo: b.activo === false || b.activo === 0 ? 0 : 1,
  });
}

export function deleteProductoProveedor(id) {
  return productoProveedorRepo.delete(id);
}

export function resolverPrecioCompra({ contacto_id = null, producto_id = null, cantidad = 1, precio_base = null } = {}) {
  const prod = producto_id
    ? db.prepare('SELECT id, plantilla_id, costo FROM productos WHERE id = ?').get(Number(producto_id))
    : null;
  const base = precio_base !== null && precio_base !== undefined
    ? Number(precio_base) || 0
    : Number(prod?.costo || 0);
  const qty = Math.max(0, Number(cantidad) || 1);

  let regla = null;
  if (contacto_id && prod?.id) {
    regla = db.prepare(`
      SELECT * FROM producto_proveedores
      WHERE contacto_id = ? AND producto_id = ? AND activo = 1 AND cantidad_minima <= ?
      ORDER BY cantidad_minima DESC, prioridad ASC, id DESC LIMIT 1
    `).get(Number(contacto_id), prod.id, qty);
  }
  if (!regla && contacto_id && prod?.plantilla_id) {
    regla = db.prepare(`
      SELECT * FROM producto_proveedores
      WHERE contacto_id = ? AND producto_id IS NULL AND plantilla_id = ? AND activo = 1 AND cantidad_minima <= ?
      ORDER BY cantidad_minima DESC, prioridad ASC, id DESC LIMIT 1
    `).get(Number(contacto_id), prod.plantilla_id, qty);
  }

  return {
    precio_base: Number(base.toFixed(2)),
    precio_unitario: regla ? Number(Number(regla.precio || 0).toFixed(2)) : Number(base.toFixed(2)),
    moneda: regla?.moneda || 'ARS',
    lead_time_dias: regla ? Number(regla.lead_time_dias || 0) : 0,
    codigo_proveedor: regla?.codigo_proveedor || '',
    origen: regla ? (regla.producto_id ? 'tarifa_variante' : 'tarifa_plantilla') : 'costo_catalogo',
  };
}
