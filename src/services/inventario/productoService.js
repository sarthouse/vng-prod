import { db } from '../../db.js';
import { BaseRepository } from '../../core/BaseRepository.js';
import { MODELS } from '../../db/models.js';

class PlantillaRepository extends BaseRepository {
  constructor() {
    super({ model: MODELS.producto_plantillas });
  }
}

class ProductoRepository extends BaseRepository {
  constructor() {
    super({ model: MODELS.productos });
  }
}

export const plantillaRepo = new PlantillaRepository();
export const productoRepo = new ProductoRepository();

function parseJson(str, fallback) {
  try { return JSON.parse(str || ''); } catch { return fallback; }
}

function cartesianCombinations(atributos) {
  const valid = (atributos || [])
    .filter(a => a && a.atributo && Array.isArray(a.valores) && a.valores.length > 0);
  if (valid.length === 0) return [{}];
  let acc = [{}];
  for (const attr of valid) {
    const next = [];
    for (const prev of acc) {
      for (const val of attr.valores) {
        next.push({ ...prev, [attr.atributo]: String(val) });
      }
    }
    acc = next;
  }
  return acc;
}

function comboKey(obj) {
  const keys = Object.keys(obj || {}).sort();
  return JSON.stringify(Object.fromEntries(keys.map(k => [k, obj[k]])));
}

function resolveCategoriaId(categoriaId, categoriaNombre, fallbackNombre = 'Otros insumos') {
  if (categoriaId) return Number(categoriaId);
  const name = (categoriaNombre || fallbackNombre).trim();
  const row = db.prepare('SELECT id FROM categorias WHERE LOWER(nombre) = LOWER(?)').get(name);
  if (row) return row.id;
  const info = db.prepare('INSERT INTO categorias (nombre) VALUES (?)').run(name);
  return Number(info.lastInsertRowid);
}

function resolveUnidadId(unidadId, udmNombre, fallbackNombre = 'unidades') {
  if (unidadId) return Number(unidadId);
  const name = (udmNombre || fallbackNombre).trim();
  const row = db.prepare('SELECT id FROM unidades_medida WHERE LOWER(nombre) = LOWER(?)').get(name);
  if (row) return row.id;
  const info = db.prepare("INSERT INTO unidades_medida (nombre, grupo, factor) VALUES (?, 'unidad', 1)").run(name);
  return Number(info.lastInsertRowid);
}

function syncProductoVariantesJoin(productoId, combo) {
  db.prepare('DELETE FROM producto_variantes WHERE producto_id = ?').run(productoId);
  const insVar = db.prepare('INSERT OR IGNORE INTO variantes (atributo, valor) VALUES (?, ?)');
  const getVar = db.prepare('SELECT id FROM variantes WHERE atributo = ? AND valor = ?');
  const insJoin = db.prepare('INSERT OR IGNORE INTO producto_variantes (producto_id, variante_id) VALUES (?, ?)');
  for (const [atributo, valor] of Object.entries(combo || {})) {
    insVar.run(String(atributo).trim(), String(valor).trim());
    const v = getVar.get(String(atributo).trim(), String(valor).trim());
    if (v) insJoin.run(productoId, v.id);
  }
}

export function syncVariantesForPlantilla(plantillaId, defaults = {}) {
  const plantilla = plantillaRepo.findById(plantillaId);
  if (!plantilla) return [];

  const atributos = parseJson(plantilla.atributos_json, []);
  const combos = cartesianCombinations(atributos);
  const existing = db.prepare('SELECT * FROM productos WHERE plantilla_id = ?').all(plantillaId);
  const byKey = new Map(existing.map(p => [comboKey(parseJson(p.combinacion_json, {})), p]));

  const seenIds = new Set();
  for (const combo of combos) {
    const key = comboKey(combo);
    const vals = Object.values(combo);
    const nombre = vals.length > 0 ? `${plantilla.nombre} (${vals.join(' · ')})` : plantilla.nombre;
    const prev = byKey.get(key);
    if (prev) {
      db.prepare("UPDATE productos SET nombre = ?, activo = 1, updated_at = datetime('now') WHERE id = ?").run(nombre, prev.id);
      syncProductoVariantesJoin(prev.id, combo);
      seenIds.add(prev.id);
    } else {
      const autoSku = plantilla.codigo
        ? (vals.length > 0 ? `${plantilla.codigo}-${vals.join('-')}` : plantilla.codigo)
        : '';
      const newId = productoRepo.create({
        plantilla_id: plantillaId,
        sku: autoSku,
        nombre,
        combinacion_json: key,
        costo: Number(defaults.costo ?? 0),
        precio: Number(defaults.precio ?? 0),
        minimo_compra: Number(defaults.minimo_compra ?? 0),
        stock: Number(defaults.stock ?? 0),
        stock_minimo: Number(defaults.stock_minimo ?? 0),
        activo: 1,
      });
      syncProductoVariantesJoin(newId, combo);
      seenIds.add(newId);
    }
  }

  for (const p of existing) {
    if (!seenIds.has(p.id)) {
      if (Number(p.stock) === 0) {
        productoRepo.delete(p.id);
      } else {
        db.prepare("UPDATE productos SET activo = 0, updated_at = datetime('now') WHERE id = ?").run(p.id);
      }
    }
  }

  return db.prepare('SELECT * FROM v_productos WHERE plantilla_id = ? AND activo = 1 ORDER BY id ASC').all(plantillaId);
}

export function listPlantillas({ se_fabrica, se_compra, se_vende, tipo, categoria, search } = {}) {
  const rows = db.prepare(`
    SELECT pt.*,
           COALESCE(c.nombre, '') as proveedor_nombre,
           COUNT(CASE WHEN p.activo = 1 THEN 1 END) as variantes_count,
           COALESCE(SUM(CASE WHEN p.activo = 1 THEN p.stock ELSE 0 END), 0) as stock_total,
           COALESCE(MIN(CASE WHEN p.activo = 1 THEN p.costo END), 0) as costo_min,
           COALESCE(MAX(CASE WHEN p.activo = 1 THEN p.costo END), 0) as costo_max,
           COALESCE(MIN(CASE WHEN p.activo = 1 THEN p.precio END), 0) as precio_min,
           COALESCE(MAX(CASE WHEN p.activo = 1 THEN p.precio END), 0) as precio_max
    FROM v_plantillas pt
    LEFT JOIN contactos c ON c.id = pt.proveedor_id
    LEFT JOIN v_productos p ON p.plantilla_id = pt.id
    GROUP BY pt.id
    ORDER BY pt.nombre ASC
  `).all();

  return rows.filter(r => {
    if (se_fabrica !== undefined && Number(r.se_fabrica) !== Number(se_fabrica)) return false;
    if (se_compra !== undefined && Number(r.se_compra) !== Number(se_compra)) return false;
    if (se_vende !== undefined && Number(r.se_vende) !== Number(se_vende)) return false;
    if (tipo && r.tipo !== tipo) return false;
    if (categoria && r.categoria !== categoria) return false;
    if (search) {
      const q = search.toLowerCase();
      const hit = r.nombre.toLowerCase().includes(q)
        || (r.codigo || '').toLowerCase().includes(q)
        || (r.categoria || '').toLowerCase().includes(q)
        || (r.proveedor_nombre || '').toLowerCase().includes(q);
      if (!hit) return false;
    }
    return true;
  });
}

export function getPlantillaById(id) {
  const plantilla = db.prepare(`
    SELECT pt.*,
           COALESCE(c.nombre, '') as proveedor_nombre
    FROM v_plantillas pt
    LEFT JOIN contactos c ON c.id = pt.proveedor_id
    WHERE pt.id = ?
  `).get(id);
  if (!plantilla) return null;

  const variantes = db.prepare('SELECT * FROM v_productos WHERE plantilla_id = ? AND activo = 1 ORDER BY id ASC').all(id);
  const recetas = db.prepare(`
    SELECT r.*, COUNT(rl.id) as lineas_count
    FROM recetas r
    LEFT JOIN receta_lineas rl ON rl.receta_id = r.id
    WHERE r.plantilla_id = ?
    GROUP BY r.id
    ORDER BY r.activa DESC, r.id DESC
  `).all(id);

  return {
    plantilla: {
      ...plantilla,
      atributos: parseJson(plantilla.atributos_json, []),
    },
    variantes,
    recetas,
  };
}

export function createPlantilla(b) {
  const nombre = (b.nombre || '').trim();
  if (!nombre) throw new Error('El nombre de la plantilla es obligatorio');
  const atributos = Array.isArray(b.atributos) ? b.atributos : [];
  const seFabrica = b.se_fabrica ? 1 : 0;
  const seCompra = b.se_compra !== undefined ? (b.se_compra ? 1 : 0) : (seFabrica ? 0 : 1);
  const seVende = b.se_vende !== undefined ? (b.se_vende ? 1 : 0) : 1;

  return plantillaRepo.transaction(() => {
    const id = plantillaRepo.create({
      nombre,
      codigo: (b.codigo || '').trim(),
      descripcion: (b.descripcion || '').trim(),
      tipo: b.tipo || 'almacenable',
      categoria_id: resolveCategoriaId(b.categoria_id, b.categoria, seFabrica ? 'Calzado' : 'Otros insumos'),
      unidad_id: resolveUnidadId(b.unidad_id, b.udm, seFabrica ? 'pares' : 'unidades'),
      unidad_compra_id: (b.unidad_compra_id || b.udm_compra) ? resolveUnidadId(b.unidad_compra_id, b.udm_compra) : null,
      requiere_lote: b.requiere_lote ? 1 : 0,
      alicuota_iva: Number(b.alicuota_iva ?? 21),
      proveedor_id: b.proveedor_id ? Number(b.proveedor_id) : null,
      lead_time_dias: Math.max(0, Number(b.lead_time_dias) || 0),
      se_fabrica: seFabrica,
      se_compra: seCompra,
      se_vende: seVende,
      cuenta_venta_id: b.cuenta_venta_id ? Number(b.cuenta_venta_id) : null,
      cuenta_compra_id: b.cuenta_compra_id ? Number(b.cuenta_compra_id) : null,
      atributos_json: JSON.stringify(atributos),
    });

    syncVariantesForPlantilla(id, {
      costo: b.costo || 0,
      precio: b.precio || 0,
      minimo_compra: b.minimo_compra || 0,
      stock: b.stock || 0,
      stock_minimo: b.stock_minimo || 0,
    });

    return id;
  });
}

export function updatePlantilla(id, b) {
  const existing = plantillaRepo.findById(id);
  if (!existing) return false;

  const payload = {
    nombre: b.nombre !== undefined ? b.nombre.trim() : existing.nombre,
    codigo: b.codigo !== undefined ? b.codigo.trim() : existing.codigo,
    descripcion: b.descripcion !== undefined ? b.descripcion.trim() : existing.descripcion,
    tipo: b.tipo !== undefined ? b.tipo : existing.tipo,
    categoria_id: (b.categoria_id !== undefined || b.categoria !== undefined)
      ? resolveCategoriaId(b.categoria_id, b.categoria)
      : existing.categoria_id,
    unidad_id: (b.unidad_id !== undefined || b.udm !== undefined)
      ? resolveUnidadId(b.unidad_id, b.udm)
      : existing.unidad_id,
    unidad_compra_id: (b.unidad_compra_id !== undefined || b.udm_compra !== undefined)
      ? ((b.unidad_compra_id || b.udm_compra) ? resolveUnidadId(b.unidad_compra_id, b.udm_compra) : null)
      : existing.unidad_compra_id,
    requiere_lote: b.requiere_lote !== undefined ? (b.requiere_lote ? 1 : 0) : (existing.requiere_lote || 0),
    alicuota_iva: b.alicuota_iva !== undefined ? Number(b.alicuota_iva) : existing.alicuota_iva,
    proveedor_id: b.proveedor_id !== undefined ? (b.proveedor_id ? Number(b.proveedor_id) : null) : existing.proveedor_id,
    lead_time_dias: b.lead_time_dias !== undefined ? Math.max(0, Number(b.lead_time_dias) || 0) : (existing.lead_time_dias || 0),
    se_fabrica: b.se_fabrica !== undefined ? (b.se_fabrica ? 1 : 0) : existing.se_fabrica,
    se_compra: b.se_compra !== undefined ? (b.se_compra ? 1 : 0) : existing.se_compra,
    se_vende: b.se_vende !== undefined ? (b.se_vende ? 1 : 0) : existing.se_vende,
    cuenta_venta_id: b.cuenta_venta_id !== undefined ? (b.cuenta_venta_id ? Number(b.cuenta_venta_id) : null) : (existing.cuenta_venta_id || null),
    cuenta_compra_id: b.cuenta_compra_id !== undefined ? (b.cuenta_compra_id ? Number(b.cuenta_compra_id) : null) : (existing.cuenta_compra_id || null),
    atributos_json: b.atributos !== undefined ? JSON.stringify(b.atributos) : existing.atributos_json,
  };

  return plantillaRepo.transaction(() => {
    plantillaRepo.update(id, payload);
    syncVariantesForPlantilla(id);
    return true;
  });
}

export function deletePlantilla(id) {
  return plantillaRepo.delete(id);
}

export function listProductos({ plantilla_id, se_compra, se_fabrica, se_vende, tipo } = {}) {
  const rows = db.prepare(`
    SELECT p.*, pt.nombre as plantilla_nombre, pt.tipo, pt.categoria, pt.udm, pt.alicuota_iva,
           pt.se_compra, pt.se_fabrica, pt.se_vende, pt.proveedor_id,
           COALESCE(c.nombre, '') as proveedor_nombre
    FROM v_productos p
    JOIN v_plantillas pt ON pt.id = p.plantilla_id
    LEFT JOIN contactos c ON c.id = pt.proveedor_id
    WHERE p.activo = 1
    ORDER BY pt.nombre ASC, p.id ASC
  `).all();

  return rows.filter(r => {
    if (plantilla_id && Number(r.plantilla_id) !== Number(plantilla_id)) return false;
    if (se_compra !== undefined && Number(r.se_compra) !== Number(se_compra)) return false;
    if (se_fabrica !== undefined && Number(r.se_fabrica) !== Number(se_fabrica)) return false;
    if (se_vende !== undefined && Number(r.se_vende) !== Number(se_vende)) return false;
    if (tipo && r.tipo !== tipo) return false;
    return true;
  });
}

export function updateProducto(id, b) {
  const existing = productoRepo.findById(id);
  if (!existing) return false;
  db.prepare(`
    UPDATE productos SET
      sku=?, costo=?, precio=?, minimo_compra=?, stock=?, stock_minimo=?, updated_at=datetime('now')
    WHERE id=?
  `).run(
    b.sku !== undefined ? String(b.sku).trim() : existing.sku,
    b.costo !== undefined ? Number(b.costo) : (existing.costo ?? 0),
    b.precio !== undefined ? Number(b.precio) : existing.precio,
    b.minimo_compra !== undefined ? Number(b.minimo_compra) : existing.minimo_compra,
    b.stock !== undefined ? Number(b.stock) : existing.stock,
    b.stock_minimo !== undefined ? Number(b.stock_minimo) : existing.stock_minimo,
    id
  );
  return true;
}
