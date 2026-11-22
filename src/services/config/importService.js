import { BaseRepository } from '../../core/BaseRepository.js';
import { MODELS } from '../../db/models.js';
import { sanitizeRichHtml } from '../../core/sanitize.js';
import { createContacto, updateContacto } from '../comercial/contactoService.js';
import { createPlantilla, updatePlantilla, updateProducto } from '../inventario/productoService.js';
import { createOperacionStock } from '../inventario/operacionStockService.js';

const contactoRepo = new BaseRepository({ model: MODELS.contactos });
const plantillaRepo = new BaseRepository({ model: MODELS.producto_plantillas });
const productoRepo = new BaseRepository({ model: MODELS.productos });
const ubicacionRepo = new BaseRepository({ model: MODELS.ubicaciones });

function importAbort(rowIdx, campo, motivo) {
  const err = new Error(`Importación abortada (rollback completo) — Fila ${rowIdx + 1}, campo "${campo}": ${motivo}`);
  err.statusCode = 400;
  throw err;
}

function parseBool(v) {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'si' || s === 'sí' || s === 'true' || s === 'x';
}

function normalizeHeaderKey(k) {
  return String(k || '')
    .replace(/^\uFEFF/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const CONTACTO_ALIASES = {
  tipo_doc: 'tipo_documento',
  documento: 'cuit',
  condicion_iva: 'condicion_iva',
  cliente: 'es_cliente',
  proveedor: 'es_proveedor',
  taller: 'es_taller',
};

const PRODUCTO_ALIASES = {
  fabrica: 'se_fabrica',
  compra: 'se_compra',
  vende: 'se_vende',
  precio_venta: 'precio',
  iva_venta: 'alicuota_iva',
  iva_compra: 'alicuota_iva_compra',
};

function normalizeRow(raw, aliases = {}) {
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) {
    const norm = normalizeHeaderKey(k);
    if (!norm) continue;
    const mapped = aliases[norm] || norm;
    if (out[mapped] === undefined || out[mapped] === '') {
      out[mapped] = v;
    }
  }
  return out;
}

export function importContactos(rows, defaults = {}) {
  return contactoRepo.transaction(() => {
    let created = 0;
    let updated = 0;
    const allContactos = contactoRepo.findAll();

    for (let i = 0; i < rows.length; i++) {
      const r = normalizeRow(rows[i], CONTACTO_ALIASES);
      const nombre = (r.nombre || '').trim();
      if (!nombre) {
        importAbort(i, 'nombre', 'falta nombre obligatorio');
      }
      try {
        const hasProv = r.es_proveedor !== undefined && String(r.es_proveedor).trim() !== '';
        const hasCli = r.es_cliente !== undefined && String(r.es_cliente).trim() !== '';
        const hasTaller = r.es_taller !== undefined && String(r.es_taller).trim() !== '';
        const cuitDigits = String(r.cuit || '').replace(/\D+/g, '');
        const emailNorm = String(r.email || '').trim().toLowerCase();

        const payload = {
          nombre,
          razon_social: r.razon_social || '',
          tipo_documento: r.tipo_documento || 'CUIT',
          cuit: r.cuit || '',
          condicion_iva: r.condicion_iva || 'Consumidor Final',
          jurisdiccion_codigo: r.jurisdiccion_codigo || '',
          direccion: r.direccion || '',
          direccion_fiscal: r.direccion_fiscal || r.direccion || '',
          localidad: r.localidad || '',
          provincia: r.provincia || '',
          codigo_postal: r.codigo_postal || '',
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
        };

        const existing = (cuitDigits && allContactos.find(c => String(c.cuit || '').replace(/\D+/g, '') === cuitDigits))
          || (emailNorm && allContactos.find(c => String(c.email || '').trim().toLowerCase() === emailNorm))
          || allContactos.find(c => String(c.nombre || '').trim().toLowerCase() === nombre.toLowerCase());

        contactoRepo.validate({
          ...payload,
          es_proveedor: payload.es_proveedor ? 1 : 0,
          es_cliente: payload.es_cliente ? 1 : 0,
          es_taller: payload.es_taller ? 1 : 0,
        }, { partial: Boolean(existing) });

        if (existing) {
          updateContacto(existing.id, payload);
          Object.assign(existing, payload);
          updated++;
        } else {
          const newId = createContacto(payload);
          allContactos.push({ id: newId, ...payload });
          created++;
        }
      } catch (e) {
        if (e.statusCode === 400 && String(e.message).includes('Importación abortada')) throw e;
        importAbort(i, 'registro', e.message);
      }
    }
    return { created, updated, errors: [] };
  });
}

export function importProductos(rows) {
  return plantillaRepo.transaction(() => {
    let created = 0;
    let updated = 0;

    const allContactos = contactoRepo.findAll();
    const provByName = new Map(
      allContactos
        .filter(c => Number(c.es_proveedor) === 1 || Number(c.es_taller) === 1)
        .map(p => [String(p.nombre || '').trim().toLowerCase(), p.id]),
    );
    const allPlantillas = plantillaRepo.findAll();
    const virtAjusteId = ubicacionRepo.query().where('codigo', 'VIRT-AJUSTE').get()?.id || null;
    const depCentralId = ubicacionRepo.query().where('codigo', 'DEP-CENTRAL').get()?.id || null;
    const prodTermId = ubicacionRepo.query().where('codigo', 'PROD-TERM').get()?.id || depCentralId;

    for (let i = 0; i < rows.length; i++) {
      const r = normalizeRow(rows[i], PRODUCTO_ALIASES);
      const nombre = (r.nombre || '').trim();
      if (!nombre) {
        importAbort(i, 'nombre', 'falta nombre obligatorio');
      }
      try {
        const codigo = (r.codigo || r.sku || '').trim();
        const provKey = (r.proveedor || '').trim().toLowerCase();
        const proveedor_id = provKey ? (provByName.get(provKey) || null) : null;
        const hasFab = r.se_fabrica !== undefined && String(r.se_fabrica).trim() !== '';
        const hasComp = r.se_compra !== undefined && String(r.se_compra).trim() !== '';
        const hasVend = r.se_vende !== undefined && String(r.se_vende).trim() !== '';
        const hasLote = r.requiere_lote !== undefined && String(r.requiere_lote).trim() !== '';

        const se_fabrica = hasFab ? parseBool(r.se_fabrica) : false;
        const se_compra = hasComp ? parseBool(r.se_compra) : !se_fabrica;
        const se_vende = hasVend ? parseBool(r.se_vende) : true;
        const requiere_lote = hasLote ? parseBool(r.requiere_lote) : false;
        const costo = r.costo !== undefined && r.costo !== '' ? Number(r.costo) || 0 : (se_compra && !se_fabrica ? Number(r.precio) || 0 : 0);
        const precio = Number(r.precio) || 0;
        const initialStock = Number(r.stock) || 0;

        const payload = {
          codigo,
          nombre,
          descripcion: sanitizeRichHtml(r.descripcion || ''),
          tipo: r.tipo || 'almacenable',
          categoria: r.categoria || (se_fabrica ? 'Calzado' : 'Otros insumos'),
          proveedor_id,
          se_fabrica,
          se_compra,
          se_vende,
          requiere_lote,
          costo,
          precio,
          alicuota_iva: r.alicuota_iva !== undefined && r.alicuota_iva !== '' ? Number(r.alicuota_iva) : 21,
          alicuota_iva_compra: r.alicuota_iva_compra !== undefined && r.alicuota_iva_compra !== ''
            ? Number(r.alicuota_iva_compra)
            : (r.alicuota_iva !== undefined && r.alicuota_iva !== '' ? Number(r.alicuota_iva) : 21),
          udm: r.udm || (se_fabrica ? 'pares' : 'unidades'),
          minimo_compra: Number(r.minimo_compra) || 0,
          stock_minimo: Number(r.stock_minimo) || 0,
        };

        const existing = (codigo && allPlantillas.find(pt => String(pt.codigo || '').trim().toLowerCase() === codigo.toLowerCase()))
          || allPlantillas.find(pt => String(pt.nombre || '').trim().toLowerCase() === nombre.toLowerCase());

        plantillaRepo.validate({
          ...payload,
          se_fabrica: payload.se_fabrica ? 1 : 0,
          se_compra: payload.se_compra ? 1 : 0,
          se_vende: payload.se_vende ? 1 : 0,
          requiere_lote: payload.requiere_lote ? 1 : 0,
        }, { partial: Boolean(existing) });

        if (existing) {
          updatePlantilla(existing.id, payload);
          const vars = productoRepo.findWhere({ plantilla_id: existing.id });
          for (const v of vars) {
            updateProducto(v.id, {
              costo,
              precio,
              minimo_compra: payload.minimo_compra,
              stock_minimo: payload.stock_minimo,
            }, { origen: 'importacion', observacion: 'Importación CSV' });
          }
          updated++;
        } else {
          const createdRes = createPlantilla(payload);
          const pltId = createdRes?.plantilla_id || createdRes?.id || createdRes;
          allPlantillas.push({ id: pltId, codigo, nombre });
          if (initialStock > 0 && virtAjusteId && (se_fabrica ? prodTermId : depCentralId)) {
            const createdVars = productoRepo.findWhere({ plantilla_id: pltId });
            const targetVar = createdVars[0];
            if (targetVar) {
              createOperacionStock({
                tipo: 'ajuste',
                estado: 'Confirmado',
                ubicacion_origen_id: virtAjusteId,
                ubicacion_destino_id: se_fabrica ? prodTermId : depCentralId,
                motivo: 'Stock inicial por importación CSV',
                referencia_tipo: 'importacion',
                referencia_id: pltId,
                lineas: [{ producto_id: targetVar.id, cantidad: initialStock }],
              });
            }
          }
          created++;
        }
      } catch (e) {
        if (e.statusCode === 400 && String(e.message).includes('Importación abortada')) throw e;
        importAbort(i, 'registro', e.message);
      }
    }
    return { created, updated, errors: [] };
  });
}
