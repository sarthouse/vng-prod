import { db } from '../../db.js';
import { createContacto } from '../comercial/contactoService.js';
import { createPlantilla } from '../inventario/productoService.js';

function parseBool(v) {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'si' || s === 'sí' || s === 'true' || s === 'x';
}

export function importContactos(rows, defaults = {}) {
  let created = 0;
  const errors = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const nombre = (r.nombre || '').trim();
    if (!nombre) {
      errors.push(`Fila ${i + 1}: falta nombre`);
      continue;
    }
    try {
      const hasProv = r.es_proveedor !== undefined && String(r.es_proveedor).trim() !== '';
      const hasCli = r.es_cliente !== undefined && String(r.es_cliente).trim() !== '';
      const hasTaller = r.es_taller !== undefined && String(r.es_taller).trim() !== '';
      createContacto({
        nombre,
        razon_social: r.razon_social || '',
        cuit: r.cuit || '',
        condicion_iva: r.condicion_iva || 'Consumidor Final',
        direccion: r.direccion || '',
        direccion_fiscal: r.direccion_fiscal || r.direccion || '',
        localidad: r.localidad || '',
        provincia: r.provincia || '',
        pais: r.pais || 'Argentina',
        contacto_nombre: r.contacto_nombre || '',
        telefono: r.telefono || '',
        email: r.email || '',
        banco: r.banco || '',
        cbu_cvu: r.cbu_cvu || '',
        alias: r.alias || '',
        es_proveedor: hasProv ? parseBool(r.es_proveedor) : Boolean(defaults.es_proveedor),
        es_cliente: hasCli ? parseBool(r.es_cliente) : Boolean(defaults.es_cliente),
        es_taller: hasTaller ? parseBool(r.es_taller) : Boolean(defaults.es_taller),
        observaciones: r.observaciones || '',
      });
      created++;
    } catch (e) {
      errors.push(`Fila ${i + 1} (${nombre}): ${e.message}`);
    }
  }
  return { created, errors };
}

export function importProductos(rows) {
  let created = 0;
  const errors = [];
  const provByName = new Map(
    db.prepare('SELECT id, LOWER(nombre) as ln FROM contactos WHERE es_proveedor = 1 OR es_taller = 1').all().map(p => [p.ln, p.id])
  );
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const nombre = (r.nombre || '').trim();
    if (!nombre) {
      errors.push(`Fila ${i + 1}: falta nombre`);
      continue;
    }
    try {
      const provKey = (r.proveedor || '').trim().toLowerCase();
      const proveedor_id = provKey ? (provByName.get(provKey) || null) : null;
      const hasFab = r.se_fabrica !== undefined && String(r.se_fabrica).trim() !== '';
      const hasComp = r.se_compra !== undefined && String(r.se_compra).trim() !== '';
      const se_fabrica = hasFab ? parseBool(r.se_fabrica) : false;
      const se_compra = hasComp ? parseBool(r.se_compra) : !se_fabrica;

      createPlantilla({
        codigo: (r.codigo || r.sku || '').trim(),
        nombre,
        descripcion: r.descripcion || '',
        tipo: r.tipo || 'almacenable',
        categoria: r.categoria || (se_fabrica ? 'Calzado' : 'Otros insumos'),
        proveedor_id,
        se_fabrica,
        se_compra,
        precio: Number(r.precio) || 0,
        alicuota_iva: r.alicuota_iva !== undefined && r.alicuota_iva !== '' ? Number(r.alicuota_iva) : 21,
        udm: r.udm || (se_fabrica ? 'pares' : 'unidades'),
        minimo_compra: Number(r.minimo_compra) || 0,
        stock: Number(r.stock) || 0,
        stock_minimo: Number(r.stock_minimo) || 0,
      });
      created++;
    } catch (e) {
      errors.push(`Fila ${i + 1} (${nombre}): ${e.message}`);
    }
  }
  return { created, errors };
}
