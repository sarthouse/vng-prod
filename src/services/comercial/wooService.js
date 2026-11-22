import { BaseRepository } from '../../core/BaseRepository.js';
import { MODELS } from '../../db/models.js';
import { createLogger } from '../../core/logger.js';
import { getCurrentDbName, runWithDatabase } from '../../db.js';
import { listDatabases } from '../auth/dbManagerService.js';
import { createVenta } from './ventaService.js';
import { createCobro } from '../finanzas/cobrosService.js';
import { resolverPrecioLista } from './condicionesComercialesService.js';

const log = createLogger('WOO');

export const wooConfigRepo = new BaseRepository({ model: MODELS.woo_config });
export const wooClienteRepo = new BaseRepository({ model: MODELS.woo_clientes });
export const wooProductoRepo = new BaseRepository({ model: MODELS.woo_productos });
export const wooPedidoRepo = new BaseRepository({ model: MODELS.woo_pedidos });
export const wooCuponRepo = new BaseRepository({ model: MODELS.woo_cupones });
export const wooDescuentoRepo = new BaseRepository({ model: MODELS.woo_descuentos });
export const wooMetodoEnvioRepo = new BaseRepository({ model: MODELS.woo_metodos_envio });
export const wooMetodoPagoRepo = new BaseRepository({ model: MODELS.woo_metodos_pago });
export const wooSyncLogRepo = new BaseRepository({ model: MODELS.woo_sync_logs });

const contactoRepo = new BaseRepository({ model: MODELS.contactos });
const jurisdiccionRepo = new BaseRepository({ model: MODELS.jurisdicciones });
const plantillaRepo = new BaseRepository({ model: MODELS.producto_plantillas });
const productoRepo = new BaseRepository({ model: MODELS.productos });
const stockQuantRepo = new BaseRepository({ model: MODELS.stock_quants });
const ubicacionRepo = new BaseRepository({ model: MODELS.ubicaciones });
const listaPrecioItemRepo = new BaseRepository({ model: MODELS.lista_precio_items });
const cuentaTesoreriaRepo = new BaseRepository({ model: MODELS.cuentas });
const metodoPagoRepo = new BaseRepository({ model: MODELS.metodos_pago });

const pollingLocks = new Map();
const lastPolledAt = new Map();
let pollingTimer = null;

function nowIso() {
  return new Date().toISOString();
}

function normalizeUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

export function maskSecret(val) {
  const s = String(val || '').trim();
  if (!s) return '';
  if (s.includes('****')) return s;
  if (s.length <= 4) return '****';
  const prefixMatch = s.match(/^(ck_|cs_)/i);
  const prefix = prefixMatch ? prefixMatch[1] : '';
  return `${prefix}****${s.slice(-4)}`;
}

function isMaskedValue(val) {
  return String(val || '').includes('****');
}

export function logWooSync({ direccion = 'inbound', entidad = '', referencia = '', estado = 'ok', mensaje = '', payload = null } = {}) {
  try {
    wooSyncLogRepo.create({
      direccion,
      entidad: String(entidad || ''),
      referencia: String(referencia || ''),
      estado,
      mensaje: String(mensaje || '').slice(0, 1000),
      payload_json: payload ? JSON.stringify(payload).slice(0, 8000) : '{}',
    });
  } catch (err) {
    log.warn('No se pudo guardar woo_sync_logs', { error: err.message });
  }
}

export function getWooConfig({ unmask = false } = {}) {
  const row = wooConfigRepo.query().orderBy('id', 'ASC').get();
  const base = row || {
    id: null,
    store_url: '',
    consumer_key: '',
    consumer_secret: '',
    activo: 0,
    polling_activo: 0,
    polling_intervalo_min: 3,
    ultimo_sync_pedidos_at: '',
    sync_stock_auto: 1,
    ubicacion_stock_id: null,
    lista_precio_normal_id: null,
    lista_precio_oferta_id: null,
    diario_venta_id: null,
    termino_pago_id: null,
    meta_key_dni: 'billing_dni',
    auto_confirmar_venta: 1,
    auto_registrar_cobro: 1,
  };
  if (unmask) return base;
  return {
    ...base,
    consumer_key: maskSecret(base.consumer_key),
    consumer_secret: maskSecret(base.consumer_secret),
  };
}

export function saveWooConfig(b = {}, user = null) {
  const existing = wooConfigRepo.query().orderBy('id', 'ASC').get();
  const nextConsumerKey = b.consumer_key !== undefined
    ? (isMaskedValue(b.consumer_key) ? (existing?.consumer_key || '') : String(b.consumer_key || '').trim())
    : (existing?.consumer_key || '');
  const nextConsumerSecret = b.consumer_secret !== undefined
    ? (isMaskedValue(b.consumer_secret) ? (existing?.consumer_secret || '') : String(b.consumer_secret || '').trim())
    : (existing?.consumer_secret || '');

  const payload = {
    store_url: b.store_url !== undefined ? normalizeUrl(b.store_url) : (existing?.store_url || ''),
    consumer_key: nextConsumerKey,
    consumer_secret: nextConsumerSecret,
    activo: b.activo !== undefined ? (Number(b.activo) ? 1 : 0) : (existing?.activo ?? 0),
    polling_activo: b.polling_activo !== undefined ? (Number(b.polling_activo) ? 1 : 0) : (existing?.polling_activo ?? 0),
    polling_intervalo_min: b.polling_intervalo_min !== undefined ? Math.max(1, Number(b.polling_intervalo_min) || 3) : (existing?.polling_intervalo_min ?? 3),
    ultimo_sync_pedidos_at: b.ultimo_sync_pedidos_at !== undefined ? String(b.ultimo_sync_pedidos_at || '') : (existing?.ultimo_sync_pedidos_at || ''),
    sync_stock_auto: b.sync_stock_auto !== undefined ? (Number(b.sync_stock_auto) ? 1 : 0) : (existing?.sync_stock_auto ?? 1),
    ubicacion_stock_id: b.ubicacion_stock_id !== undefined ? (b.ubicacion_stock_id ? Number(b.ubicacion_stock_id) : null) : (existing?.ubicacion_stock_id || null),
    lista_precio_normal_id: b.lista_precio_normal_id !== undefined ? (b.lista_precio_normal_id ? Number(b.lista_precio_normal_id) : null) : (existing?.lista_precio_normal_id || null),
    lista_precio_oferta_id: b.lista_precio_oferta_id !== undefined ? (b.lista_precio_oferta_id ? Number(b.lista_precio_oferta_id) : null) : (existing?.lista_precio_oferta_id || null),
    diario_venta_id: b.diario_venta_id !== undefined ? (b.diario_venta_id ? Number(b.diario_venta_id) : null) : (existing?.diario_venta_id || null),
    termino_pago_id: b.termino_pago_id !== undefined ? (b.termino_pago_id ? Number(b.termino_pago_id) : null) : (existing?.termino_pago_id || null),
    meta_key_dni: b.meta_key_dni !== undefined ? (String(b.meta_key_dni || '').trim() || 'billing_dni') : (existing?.meta_key_dni || 'billing_dni'),
    auto_confirmar_venta: b.auto_confirmar_venta !== undefined ? (Number(b.auto_confirmar_venta) ? 1 : 0) : (existing?.auto_confirmar_venta ?? 1),
    auto_registrar_cobro: b.auto_registrar_cobro !== undefined ? (Number(b.auto_registrar_cobro) ? 1 : 0) : (existing?.auto_registrar_cobro ?? 1),
  };

  if (existing) {
    wooConfigRepo.update(existing.id, payload, user);
  } else {
    wooConfigRepo.create(payload, user);
  }
  return getWooConfig({ unmask: false });
}

export async function wooFetch(endpoint, { method = 'GET', body = null, query = null, cfg = null } = {}) {
  const conf = cfg || getWooConfig({ unmask: true });
  const baseUrl = normalizeUrl(conf?.store_url);
  if (!baseUrl) throw new Error('Debe configurar store_url de WooCommerce');
  if (!conf?.consumer_key || !conf?.consumer_secret) {
    throw new Error('Debe configurar consumer_key y consumer_secret de WooCommerce');
  }

  const cleanEp = String(endpoint || '').startsWith('/') ? endpoint : `/${endpoint}`;
  const url = new URL(`${baseUrl}/wp-json/wc/v3${cleanEp}`);
  if (query && typeof query === 'object') {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') {
        url.searchParams.set(k, String(v));
      }
    }
  }

  const auth = Buffer.from(`${conf.consumer_key}:${conf.consumer_secret}`, 'utf8').toString('base64');
  const headers = {
    Authorization: `Basic ${auth}`,
    Accept: 'application/json',
  };
  const opts = {
    method,
    headers,
    signal: AbortSignal.timeout(30000),
  };
  if (body !== null && body !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const res = await globalThis.fetch(url.toString(), opts);
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    const errMsg = parsed?.message || parsed?.error || (typeof parsed === 'string' ? parsed : '') || `HTTP ${res.status}`;
    throw new Error(`WooCommerce API (${res.status}): ${errMsg}`);
  }
  return parsed;
}

export async function testWooConnection() {
  const cfg = getWooConfig({ unmask: true });
  try {
    const status = await wooFetch('/system_status', { cfg });
    const storeName = status?.settings?.general?.blogname || status?.environment?.site_url || cfg.store_url;
    const wcVersion = status?.environment?.version || '';
    logWooSync({
      direccion: 'outbound',
      entidad: 'conexion',
      estado: 'ok',
      mensaje: `Conexión exitosa (${storeName}${wcVersion ? ' · WC ' + wcVersion : ''})`,
    });
    return { ok: true, store_name: storeName, wc_version: wcVersion };
  } catch (err) {
    logWooSync({
      direccion: 'outbound',
      entidad: 'conexion',
      estado: 'error',
      mensaje: err.message,
    });
    throw err;
  }
}

export function extractDniFromMeta(metaData, metaKey = 'billing_dni') {
  if (!Array.isArray(metaData)) return '';
  const targetKey = String(metaKey || 'billing_dni').trim();
  const entry = metaData.find(m => String(m?.key || '').trim() === targetKey);
  if (!entry) return '';
  return String(entry.value || '').replace(/\D+/g, '');
}

export function mapProvinciaToJurisdiccion(stateCode) {
  const letra = String(stateCode || '').trim().toUpperCase();
  if (!letra) return '';
  const jur = jurisdiccionRepo.query().where('letra', letra).get();
  return jur?.codigo || '';
}

function normalizeDigits(val) {
  return String(val || '').replace(/\D+/g, '');
}

export function resolveOrUpsertContactoFromWoo(wooObj, cfg = null, user = null) {
  const conf = cfg || getWooConfig({ unmask: true });
  const billing = wooObj?.billing || {};
  const shipping = wooObj?.shipping || {};
  const wooCustomerId = Number(wooObj?.customer_id !== undefined ? wooObj.customer_id : wooObj?.id) || 0;
  const email = String(wooObj?.email || billing.email || '').trim();
  const dni = extractDniFromMeta(wooObj?.meta_data, conf.meta_key_dni || 'billing_dni');
  const fullName = [billing.first_name || wooObj?.first_name || '', billing.last_name || wooObj?.last_name || '']
    .map(s => String(s || '').trim())
    .filter(Boolean)
    .join(' ') || billing.company || email || (wooCustomerId ? `Cliente Woo #${wooCustomerId}` : 'Cliente WooCommerce');

  const jurisdiccionCodigo = mapProvinciaToJurisdiccion(billing.state || shipping.state || '');
  const direccion = [billing.address_1, billing.address_2].filter(Boolean).join(' ').trim();

  let contacto = null;
  if (wooCustomerId > 0) {
    contacto = contactoRepo.query().where('woo_id', wooCustomerId).get();
  }
  if (!contacto && dni) {
    const candidatos = contactoRepo.query().where('cuit', '!=', '').all();
    contacto = candidatos.find(c => normalizeDigits(c.cuit) === dni) || null;
  }
  if (!contacto && email) {
    const emailLower = email.toLowerCase();
    const candidatos = contactoRepo.query().where('email', '!=', '').all();
    contacto = candidatos.find(c => String(c.email || '').trim().toLowerCase() === emailLower) || null;
  }

  if (!contacto) {
    const tipoDoc = dni.length === 11 ? 'CUIT' : dni.length >= 7 ? 'DNI' : 'Otro';
    const newId = contactoRepo.create({
      nombre: fullName,
      razon_social: billing.company || fullName,
      tipo_documento: tipoDoc,
      cuit: dni,
      condicion_iva: 'Consumidor Final',
      direccion,
      direccion_fiscal: direccion,
      localidad: String(billing.city || '').trim(),
      provincia: String(billing.state || '').trim(),
      jurisdiccion_codigo: jurisdiccionCodigo,
      codigo_postal: String(billing.postcode || '').trim(),
      pais: billing.country === 'AR' || !billing.country ? 'Argentina' : String(billing.country),
      telefono: String(billing.phone || '').trim(),
      email,
      es_cliente: 1,
      woo_id: wooCustomerId > 0 ? wooCustomerId : null,
      activo: 1,
    }, user);
    contacto = contactoRepo.findById(newId);
  } else {
    const patch = {};
    if (wooCustomerId > 0 && !contacto.woo_id) patch.woo_id = wooCustomerId;
    if (jurisdiccionCodigo && !contacto.jurisdiccion_codigo) patch.jurisdiccion_codigo = jurisdiccionCodigo;
    if (dni && !contacto.cuit) {
      patch.cuit = dni;
      patch.tipo_documento = dni.length === 11 ? 'CUIT' : dni.length >= 7 ? 'DNI' : contacto.tipo_documento;
    }
    if (email && !contacto.email) patch.email = email;
    if (!Number(contacto.es_cliente)) patch.es_cliente = 1;
    if (Object.keys(patch).length > 0) {
      contactoRepo.update(contacto.id, patch, user);
      contacto = contactoRepo.findById(contacto.id);
    }
  }

  if (wooCustomerId > 0) {
    const mirror = wooClienteRepo.query().where('woo_id', wooCustomerId).get();
    const mirrorData = {
      woo_id: wooCustomerId,
      contacto_id: contacto.id,
      email,
      username: String(wooObj?.username || ''),
      first_name: String(wooObj?.first_name || billing.first_name || ''),
      last_name: String(wooObj?.last_name || billing.last_name || ''),
      dni,
      billing_json: JSON.stringify(billing || {}),
      shipping_json: JSON.stringify(shipping || {}),
      date_modified: String(wooObj?.date_modified_gmt || wooObj?.date_modified || ''),
      last_sync_at: nowIso(),
    };
    if (mirror) wooClienteRepo.update(mirror.id, mirrorData, user);
    else wooClienteRepo.create(mirrorData, user);
  }

  return contacto;
}

function upsertWooProductoMirror({ wooId, wooParentId = 0, tipo = 'simple', plantillaId = null, productoId = null, data = {} }, user = null) {
  const existing = wooProductoRepo.query()
    .where('woo_id', wooId)
    .where('woo_parent_id', wooParentId)
    .get();

  const payload = {
    woo_id: wooId,
    woo_parent_id: wooParentId,
    tipo,
    plantilla_id: plantillaId,
    producto_id: productoId,
    sku: String(data.sku || ''),
    name: String(data.name || ''),
    regular_price: Number(data.regular_price || data.price || 0) || 0,
    sale_price: data.sale_price !== '' && data.sale_price !== null && data.sale_price !== undefined ? Number(data.sale_price) : null,
    stock_quantity: data.stock_quantity !== null && data.stock_quantity !== undefined ? Number(data.stock_quantity) : null,
    manage_stock: data.manage_stock ? 1 : 0,
    status: String(data.status || 'publish'),
    attributes_json: JSON.stringify(data.attributes || []),
    raw_json: JSON.stringify(data || {}),
    last_sync_at: nowIso(),
  };

  if (existing) {
    wooProductoRepo.update(existing.id, payload, user);
    return existing.id;
  }
  return wooProductoRepo.create(payload, user);
}

function resolveLocalProducto({ wooId = 0, sku = '' }) {
  let prod = null;
  if (Number(wooId) > 0) {
    prod = productoRepo.query().where('woo_id', Number(wooId)).get();
  }
  if (!prod && String(sku || '').trim()) {
    const cleanSku = String(sku || '').trim();
    prod = productoRepo.query().where('sku', cleanSku).get();
  }
  return prod;
}

export async function importarClientes({ page = 1, per_page = 50 } = {}, user = null) {
  const cfg = getWooConfig({ unmask: true });
  const customers = await wooFetch('/customers', { cfg, query: { page, per_page, role: 'all' } });
  const list = Array.isArray(customers) ? customers : [];

  wooClienteRepo.transaction(() => {
    for (const c of list) {
      resolveOrUpsertContactoFromWoo(c, cfg, user);
    }
  });

  logWooSync({
    direccion: 'inbound',
    entidad: 'clientes',
    estado: 'ok',
    mensaje: `Importados ${list.length} clientes (página ${page})`,
  });
  return { count: list.length };
}

export async function importarProductos({ page = 1, per_page = 50 } = {}, user = null) {
  const cfg = getWooConfig({ unmask: true });
  const products = await wooFetch('/products', { cfg, query: { page, per_page } });
  const list = Array.isArray(products) ? products : [];

  const variationsMap = new Map();
  for (const p of list) {
    if (p.type === 'variable') {
      const vars = await wooFetch(`/products/${p.id}/variations`, { cfg, query: { per_page: 100 } });
      variationsMap.set(p.id, Array.isArray(vars) ? vars : []);
    }
  }

  let totalUpserted = 0;
  wooProductoRepo.transaction(() => {
    for (const p of list) {
      const isVar = p.type === 'variable';
      let localPlt = plantillaRepo.query().where('woo_id', p.id).get();
      if (!localPlt && p.sku) {
        localPlt = plantillaRepo.query().where('codigo', String(p.sku).trim()).get();
      }
      const localProd = isVar ? null : resolveLocalProducto({ wooId: p.id, sku: p.sku });
      if (localProd && !localProd.woo_id) {
        productoRepo.update(localProd.id, { woo_id: p.id }, user);
      }
      const pltId = localPlt?.id || localProd?.plantilla_id || null;
      if (pltId && localPlt && !localPlt.woo_id) {
        plantillaRepo.update(pltId, { woo_id: p.id }, user);
      }

      upsertWooProductoMirror({
        wooId: p.id,
        wooParentId: 0,
        tipo: isVar ? 'variable' : 'simple',
        plantillaId: pltId,
        productoId: localProd?.id || null,
        data: p,
      }, user);
      totalUpserted++;

      if (isVar) {
        const vars = variationsMap.get(p.id) || [];
        for (const v of vars) {
          const vProd = resolveLocalProducto({ wooId: v.id, sku: v.sku });
          if (vProd && !vProd.woo_id) {
            productoRepo.update(vProd.id, { woo_id: v.id }, user);
          }
          upsertWooProductoMirror({
            wooId: v.id,
            wooParentId: p.id,
            tipo: 'variation',
            plantillaId: vProd?.plantilla_id || pltId,
            productoId: vProd?.id || null,
            data: { ...v, name: `${p.name} - ${(v.attributes || []).map(a => a.option).join(' / ')}` },
          }, user);
          totalUpserted++;
        }
      }
    }
  });

  logWooSync({
    direccion: 'inbound',
    entidad: 'productos',
    estado: 'ok',
    mensaje: `Importados ${totalUpserted} registros de catálogo WooCommerce`,
  });
  return { count: totalUpserted };
}

export async function importarCupones({ page = 1, per_page = 50 } = {}, user = null) {
  const cfg = getWooConfig({ unmask: true });
  const coupons = await wooFetch('/coupons', { cfg, query: { page, per_page } });
  const list = Array.isArray(coupons) ? coupons : [];

  wooCuponRepo.transaction(() => {
    for (const c of list) {
      const ex = wooCuponRepo.query().where('woo_id', c.id).get();
      const data = {
        woo_id: c.id,
        code: String(c.code || ''),
        discount_type: String(c.discount_type || ''),
        amount: Number(c.amount || 0) || 0,
        usage_count: Number(c.usage_count || 0) || 0,
        date_expires: String(c.date_expires || ''),
        raw_json: JSON.stringify(c || {}),
        last_sync_at: nowIso(),
      };
      if (ex) wooCuponRepo.update(ex.id, data, user);
      else wooCuponRepo.create(data, user);
    }
  });

  logWooSync({
    direccion: 'inbound',
    entidad: 'cupones',
    estado: 'ok',
    mensaje: `Importados ${list.length} cupones`,
  });
  return { count: list.length };
}

export async function importarMetodosEnvio(user = null) {
  const cfg = getWooConfig({ unmask: true });
  const methods = await wooFetch('/shipping_methods', { cfg });
  const list = Array.isArray(methods) ? methods : [];

  wooMetodoEnvioRepo.transaction(() => {
    for (const m of list) {
      const methodId = String(m.id || '').trim();
      if (!methodId) continue;
      const ex = wooMetodoEnvioRepo.query().where('method_id', methodId).get();
      if (ex) {
        wooMetodoEnvioRepo.update(ex.id, { title: String(m.title || ex.title || methodId) }, user);
      } else {
        wooMetodoEnvioRepo.create({
          method_id: methodId,
          title: String(m.title || methodId),
          producto_servicio_id: null,
          activo: 1,
        }, user);
      }
    }
  });
  return { count: list.length };
}

export async function importarMetodosPago(user = null) {
  const cfg = getWooConfig({ unmask: true });
  const gateways = await wooFetch('/payment_gateways', { cfg });
  const list = Array.isArray(gateways) ? gateways : [];

  wooMetodoPagoRepo.transaction(() => {
    for (const g of list) {
      const gwId = String(g.id || '').trim();
      if (!gwId) continue;
      const ex = wooMetodoPagoRepo.query().where('gateway_id', gwId).get();
      if (ex) {
        wooMetodoPagoRepo.update(ex.id, {
          title: String(g.title || g.method_title || ex.title || gwId),
          activo: g.enabled ? 1 : 0,
        }, user);
      } else {
        wooMetodoPagoRepo.create({
          gateway_id: gwId,
          title: String(g.title || g.method_title || gwId),
          metodo_pago_id: null,
          cuenta_id: null,
          activo: g.enabled ? 1 : 0,
        }, user);
      }
    }
  });
  return { count: list.length };
}

export function procesarPedidoWoo(order, cfg = null, user = null) {
  const conf = cfg || getWooConfig({ unmask: true });
  if (!order || !order.id) throw new Error('Pedido WooCommerce inválido');

  return wooPedidoRepo.transaction(() => {
    const existing = wooPedidoRepo.query().where('woo_id', Number(order.id)).get();
    const couponCodes = Array.isArray(order.coupon_lines)
      ? order.coupon_lines.map(c => c.code).filter(Boolean).join(', ')
      : '';

    const pedidoBase = {
      woo_id: Number(order.id),
      order_number: String(order.number || order.id),
      status: String(order.status || ''),
      currency: String(order.currency || 'ARS'),
      date_created: String(order.date_created_gmt || order.date_created || ''),
      date_modified: String(order.date_modified_gmt || order.date_modified || ''),
      woo_customer_id: Number(order.customer_id || 0) || null,
      payment_method: String(order.payment_method || ''),
      payment_method_title: String(order.payment_method_title || ''),
      shipping_total: Number(order.shipping_total || 0) || 0,
      discount_total: Number(order.discount_total || 0) || 0,
      total: Number(order.total || 0) || 0,
      coupon_lines_json: JSON.stringify(order.coupon_lines || []),
      shipping_lines_json: JSON.stringify(order.shipping_lines || []),
      fee_lines_json: JSON.stringify(order.fee_lines || []),
      billing_json: JSON.stringify(order.billing || {}),
      shipping_json: JSON.stringify(order.shipping || {}),
      raw_json: JSON.stringify(order),
      last_sync_at: nowIso(),
    };

    let pedidoId = existing?.id;
    if (existing) {
      wooPedidoRepo.update(existing.id, pedidoBase, user);
    } else {
      pedidoId = wooPedidoRepo.create({
        ...pedidoBase,
        sync_estado: 'pendiente',
        sync_error: '',
      }, user);
    }

    // Idempotencia estricta: si ya tiene venta_id, no duplicar venta ni cobro
    if (existing?.venta_id) {
      return { created: false, pedido_id: pedidoId, venta_id: existing.venta_id, cobro_id: existing.cobro_id || null };
    }

    const skipStatuses = new Set(['trash', 'auto-draft', 'cancelled', 'failed']);
    if (skipStatuses.has(String(order.status || '').toLowerCase())) {
      wooPedidoRepo.update(pedidoId, { sync_estado: 'pendiente', sync_error: '' }, user);
      return { created: false, pedido_id: pedidoId, venta_id: null, cobro_id: null };
    }

    const contacto = resolveOrUpsertContactoFromWoo(order, conf, user);

    // Construir líneas de venta
    const lineas = [];
    for (const item of (order.line_items || [])) {
      const qty = Number(item.quantity || 0) || 1;
      const prod = resolveLocalProducto({
        wooId: Number(item.variation_id || 0) || Number(item.product_id || 0),
        sku: item.sku || '',
      });
      const itemSubtotal = Number(item.subtotal ?? item.total ?? 0);
      const precioUnit = qty > 0 ? Number((itemSubtotal / qty).toFixed(4)) : 0;
      lineas.push({
        producto_id: prod?.id || null,
        plantilla_id: prod?.plantilla_id || null,
        tipo_linea: 'producto',
        descripcion: String(item.name || prod?.nombre || 'Producto WooCommerce'),
        cantidad: qty,
        udm: 'unidades',
        precio_unitario: precioUnit,
        alicuota_iva: prod ? 21 : 0,
      });
    }

    for (const sl of (order.shipping_lines || [])) {
      const shTotal = Number(sl.total || 0);
      if (shTotal > 0) {
        const mapEnvio = wooMetodoEnvioRepo.query().where('method_id', String(sl.method_id || '')).get();
        lineas.push({
          producto_id: mapEnvio?.producto_servicio_id || null,
          tipo_linea: 'envio',
          descripcion: String(sl.method_title || sl.method_id || 'Envío WooCommerce'),
          cantidad: 1,
          udm: 'unidades',
          precio_unitario: shTotal,
          alicuota_iva: 0,
        });
      }
    }

    for (const fl of (order.fee_lines || [])) {
      const feeTotal = Number(fl.total || 0);
      if (feeTotal !== 0) {
        lineas.push({
          tipo_linea: feeTotal < 0 ? 'descuento' : 'recargo',
          descripcion: String(fl.name || 'Cargo / Ajuste WooCommerce'),
          cantidad: 1,
          udm: 'unidades',
          precio_unitario: feeTotal,
          alicuota_iva: 0,
        });
      }
    }

    const discountTotal = Number(order.discount_total || 0);
    if (discountTotal > 0) {
      lineas.push({
        tipo_linea: 'descuento',
        descripcion: couponCodes ? `Descuento cupón (${couponCodes})` : 'Descuento WooCommerce',
        cantidad: 1,
        udm: 'unidades',
        precio_unitario: -Math.abs(discountTotal),
        alicuota_iva: 0,
      });
    }

    const fecha = String(order.date_created || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
    const ventaId = createVenta({
      contacto_id: contacto.id,
      fecha,
      caracter: conf.diario_venta_id ? 'fiscal' : 'interno',
      diario_id: conf.diario_venta_id || undefined,
      termino_pago_id: conf.termino_pago_id || undefined,
      jurisdiccion_codigo: contacto.jurisdiccion_codigo || '',
      estado: conf.auto_confirmar_venta ? 'Confirmada' : 'Presupuesto',
      moneda: String(order.currency || 'ARS').toUpperCase(),
      cupon_codigo: couponCodes,
      external_source: 'woocommerce',
      external_id: String(order.id),
      woo_id: Number(order.id),
      observaciones: `Pedido WooCommerce #${order.number || order.id}`,
      validar_fiscal: false,
      lineas,
    }, user);

    // Registrar descuentos/cupones espejo
    for (const cl of (order.coupon_lines || [])) {
      wooDescuentoRepo.create({
        woo_pedido_id: pedidoId,
        venta_id: ventaId,
        tipo: 'coupon',
        codigo: String(cl.code || ''),
        descripcion: `Cupón ${cl.code || ''}`,
        monto: Number(cl.discount || 0) || 0,
      }, user);
    }

    // Registrar cobro automático si el pedido está pago/confirmado y hay mapeo de cuenta
    let cobroId = null;
    const isPaid = Boolean(order.date_paid) || ['processing', 'completed'].includes(String(order.status || '').toLowerCase());
    if (conf.auto_registrar_cobro && isPaid && Number(order.total || 0) > 0) {
      const gwMap = order.payment_method
        ? wooMetodoPagoRepo.query().where('gateway_id', String(order.payment_method)).get()
        : null;
      let cuentaId = gwMap?.cuenta_id || null;
      let cuentaRow = cuentaId ? cuentaTesoreriaRepo.findById(cuentaId) : null;
      if (!cuentaRow) {
        cuentaRow = cuentaTesoreriaRepo.query().where('tipo', 'banco').get()
          || cuentaTesoreriaRepo.query().get();
        cuentaId = cuentaRow?.id || null;
      }
      if (cuentaId) {
        const mpRow = gwMap?.metodo_pago_id ? metodoPagoRepo.findById(gwMap.metodo_pago_id) : null;
        let metodoNombre = mpRow?.nombre || '';
        if (!metodoNombre) {
          const tipoCta = String(cuentaRow?.tipo || '').toLowerCase();
          if (tipoCta === 'efectivo') metodoNombre = 'Efectivo';
          else if (tipoCta === 'cheques') metodoNombre = 'Cheque';
          else metodoNombre = 'Transferencia';
        }
        cobroId = createCobro({
          fecha,
          contacto_id: contacto.id,
          venta_id: ventaId,
          cuenta_id: cuentaId,
          metodo_pago_id: gwMap?.metodo_pago_id || undefined,
          metodo: metodoNombre,
          monto: Number(order.total),
          moneda: String(order.currency || 'ARS').toUpperCase(),
          concepto: `Cobro Pedido WooCommerce #${order.number || order.id}`,
          estado: 'Confirmado',
        }, user);
      }
    }

    wooPedidoRepo.update(pedidoId, {
      contacto_id: contacto.id,
      venta_id: ventaId,
      cobro_id: cobroId,
      sync_estado: 'procesado',
      sync_error: '',
    }, user);

    return { created: true, pedido_id: pedidoId, venta_id: ventaId, cobro_id: cobroId };
  });
}

export async function importarPedidos({ modified_after = '', page = 1, per_page = 50 } = {}, user = null) {
  const cfg = getWooConfig({ unmask: true });
  const query = { page, per_page, orderby: 'modified', order: 'asc' };
  if (modified_after) query.modified_after = modified_after;

  const orders = await wooFetch('/orders', { cfg, query });
  const list = Array.isArray(orders) ? orders : [];

  let createdCount = 0;
  let errorCount = 0;
  let maxModified = '';

  for (const order of list) {
    try {
      const res = procesarPedidoWoo(order, cfg, user);
      if (res.created) createdCount++;
      const mod = String(order.date_modified_gmt || order.date_modified || '');
      if (mod && mod > maxModified) maxModified = mod;
    } catch (err) {
      errorCount++;
      const ex = wooPedidoRepo.query().where('woo_id', Number(order.id)).get();
      if (ex) {
        wooPedidoRepo.update(ex.id, { sync_estado: 'error', sync_error: err.message }, user);
      }
      logWooSync({
        direccion: 'inbound',
        entidad: 'pedidos',
        referencia: String(order.id),
        estado: 'error',
        mensaje: err.message,
      });
    }
  }

  logWooSync({
    direccion: 'inbound',
    entidad: 'pedidos',
    estado: errorCount > 0 ? 'warning' : 'ok',
    mensaje: `Pedidos procesados: ${list.length} (${createdCount} nuevas ventas, ${errorCount} errores)`,
  });

  return { count: list.length, created: createdCount, errors: errorCount, maxModified };
}

export function calcularStockDisponibleProducto(productoId, ubicacionId = null) {
  const qb = stockQuantRepo.query('sq')
    .select('sq.cantidad', 'sq.cantidad_reservada')
    .where('sq.producto_id', Number(productoId));

  if (ubicacionId) {
    qb.where('sq.ubicacion_id', Number(ubicacionId));
  } else {
    qb.innerJoin('ubicaciones', 'u', 'u.id', 'sq.ubicacion_id')
      .whereIn('u.tipo', ['interna', 'dedicada']);
  }

  const rows = qb.all();
  const total = rows.reduce((s, r) => s + (Number(r.cantidad || 0) - Number(r.cantidad_reservada || 0)), 0);
  return Math.max(0, Math.floor(total));
}

export function calcularPreciosProducto(productoId, cfg = null) {
  const conf = cfg || getWooConfig({ unmask: true });
  const prod = productoRepo.findById(Number(productoId));
  if (!prod) return { regular_price: '0', sale_price: '' };

  let regular = Number(prod.precio || 0);
  if (conf.lista_precio_normal_id) {
    const res = resolverPrecioLista({
      lista_precio_id: Number(conf.lista_precio_normal_id),
      producto_id: prod.id,
      cantidad: 1,
    });
    if (res && Number(res.precio_unitario) > 0) regular = Number(res.precio_unitario);
  }

  let salePrice = '';
  if (conf.lista_precio_oferta_id) {
    const ofertaItem = listaPrecioItemRepo.query()
      .where('lista_precio_id', Number(conf.lista_precio_oferta_id))
      .where('producto_id', prod.id)
      .get();
    if (ofertaItem && Number(ofertaItem.precio_fijo || 0) > 0 && Number(ofertaItem.precio_fijo) < regular) {
      salePrice = String(Number(ofertaItem.precio_fijo));
    } else {
      const resOferta = resolverPrecioLista({
        lista_precio_id: Number(conf.lista_precio_oferta_id),
        producto_id: prod.id,
        cantidad: 1,
      });
      if (resOferta && Number(resOferta.precio_unitario) > 0 && Number(resOferta.precio_unitario) < regular) {
        salePrice = String(Number(resOferta.precio_unitario));
      }
    }
  }

  return {
    regular_price: String(regular),
    sale_price: salePrice,
  };
}

export async function syncStockWoo(productoIds = null, user = null) {
  const cfg = getWooConfig({ unmask: true });
  const qb = wooProductoRepo.query().where('producto_id', 'IS NOT', null);
  if (Array.isArray(productoIds) && productoIds.length > 0) {
    qb.whereIn('producto_id', productoIds.map(Number).filter(Boolean));
  }
  const mirrors = qb.all();

  let synced = 0;
  for (const m of mirrors) {
    const qty = calcularStockDisponibleProducto(m.producto_id, cfg.ubicacion_stock_id);
    const ep = m.woo_parent_id > 0
      ? `/products/${m.woo_parent_id}/variations/${m.woo_id}`
      : `/products/${m.woo_id}`;
    await wooFetch(ep, {
      cfg,
      method: 'PUT',
      body: { manage_stock: true, stock_quantity: qty },
    });
    wooProductoRepo.update(m.id, { stock_quantity: qty, last_sync_at: nowIso() }, user);
    synced++;
  }

  logWooSync({
    direccion: 'outbound',
    entidad: 'stock',
    estado: 'ok',
    mensaje: `Stock sincronizado en WooCommerce (${synced} productos)`,
  });
  return { synced };
}

export async function syncPreciosWoo(productoIds = null, user = null) {
  const cfg = getWooConfig({ unmask: true });
  const qb = wooProductoRepo.query().where('producto_id', 'IS NOT', null);
  if (Array.isArray(productoIds) && productoIds.length > 0) {
    qb.whereIn('producto_id', productoIds.map(Number).filter(Boolean));
  }
  const mirrors = qb.all();

  let synced = 0;
  for (const m of mirrors) {
    const prices = calcularPreciosProducto(m.producto_id, cfg);
    const ep = m.woo_parent_id > 0
      ? `/products/${m.woo_parent_id}/variations/${m.woo_id}`
      : `/products/${m.woo_id}`;
    await wooFetch(ep, {
      cfg,
      method: 'PUT',
      body: {
        regular_price: prices.regular_price,
        sale_price: prices.sale_price,
      },
    });
    wooProductoRepo.update(m.id, {
      regular_price: Number(prices.regular_price),
      sale_price: prices.sale_price ? Number(prices.sale_price) : null,
      last_sync_at: nowIso(),
    }, user);
    synced++;
  }

  logWooSync({
    direccion: 'outbound',
    entidad: 'precios',
    estado: 'ok',
    mensaje: `Precios sincronizados en WooCommerce (${synced} productos)`,
  });
  return { synced };
}

export async function exportarProductoAWoo(plantillaId, user = null) {
  const cfg = getWooConfig({ unmask: true });
  const plt = plantillaRepo.findById(Number(plantillaId));
  if (!plt) throw new Error('Plantilla no encontrada');
  const vars = productoRepo.query().where('plantilla_id', plt.id).where('activo', 1).all();
  if (vars.length === 0) throw new Error('La plantilla no tiene variantes activas');

  if (vars.length === 1 && !plt.woo_id) {
    const v = vars[0];
    const prices = calcularPreciosProducto(v.id, cfg);
    const stockQty = calcularStockDisponibleProducto(v.id, cfg.ubicacion_stock_id);
    const created = await wooFetch('/products', {
      cfg,
      method: 'POST',
      body: {
        name: plt.nombre,
        type: 'simple',
        sku: v.sku || plt.codigo || '',
        regular_price: prices.regular_price,
        sale_price: prices.sale_price,
        manage_stock: true,
        stock_quantity: stockQty,
        description: plt.descripcion || '',
      },
    });
    plantillaRepo.update(plt.id, { woo_id: created.id }, user);
    productoRepo.update(v.id, { woo_id: created.id }, user);
    upsertWooProductoMirror({
      wooId: created.id,
      wooParentId: 0,
      tipo: 'simple',
      plantillaId: plt.id,
      productoId: v.id,
      data: created,
    }, user);
    return { woo_id: created.id };
  }

  // Si ya existe woo_id en plantilla, sincronizar stock y precios de sus variantes
  const prodIds = vars.map(v => v.id);
  await syncStockWoo(prodIds, user);
  await syncPreciosWoo(prodIds, user);
  return { woo_id: plt.woo_id, synced_variants: prodIds.length };
}

export async function syncStockProductosPostCommit(productoIds = []) {
  try {
    const cfg = getWooConfig({ unmask: true });
    if (!cfg?.activo || !cfg?.sync_stock_auto || !cfg?.store_url) return;
    await syncStockWoo(productoIds);
  } catch (err) {
    log.warn('Error en syncStockProductosPostCommit', { error: err.message });
    logWooSync({
      direccion: 'outbound',
      entidad: 'stock',
      estado: 'error',
      mensaje: err.message,
    });
  }
}

export async function runWooPollingCycleForCurrentDb({ force = false } = {}) {
  const dbName = getCurrentDbName() || 'default';
  if (pollingLocks.get(dbName)) {
    return { skipped: true, reason: 'locked' };
  }
  pollingLocks.set(dbName, true);
  try {
    const cfg = getWooConfig({ unmask: true });
    if (!cfg || !Number(cfg.activo) || !Number(cfg.polling_activo) || !cfg.store_url) {
      return { skipped: true, reason: 'inactive' };
    }

    const intervalMs = Math.max(1, Number(cfg.polling_intervalo_min) || 3) * 60 * 1000;
    const prevRun = lastPolledAt.get(dbName) || 0;
    if (!force && prevRun > 0 && (Date.now() - prevRun) < intervalMs) {
      return { skipped: true, reason: 'interval' };
    }

    let modifiedAfter = '';
    if (cfg.ultimo_sync_pedidos_at) {
      const dt = new Date(cfg.ultimo_sync_pedidos_at);
      if (!Number.isNaN(dt.getTime())) {
        modifiedAfter = new Date(dt.getTime() - 2 * 60 * 1000).toISOString();
      }
    }

    let page = 1;
    let totalCount = 0;
    let totalCreated = 0;
    let totalErrors = 0;
    let maxMod = cfg.ultimo_sync_pedidos_at || '';

    while (true) {
      const res = await importarPedidos({ modified_after: modifiedAfter, page, per_page: 100 });
      totalCount += res.count;
      totalCreated += res.created;
      totalErrors += res.errors;
      if (res.maxModified && res.maxModified > maxMod) maxMod = res.maxModified;
      if (res.count < 100) break;
      page++;
    }

    const nextCheckpoint = maxMod || nowIso();
    const existingCfg = wooConfigRepo.query().orderBy('id', 'ASC').get();
    if (existingCfg) {
      wooConfigRepo.update(existingCfg.id, { ultimo_sync_pedidos_at: nextCheckpoint });
    }
    lastPolledAt.set(dbName, Date.now());

    logWooSync({
      direccion: 'polling',
      entidad: 'pedidos',
      estado: totalErrors > 0 ? 'warning' : 'ok',
      mensaje: `Polling completado: ${totalCount} pedidos leídos, ${totalCreated} ventas nuevas`,
    });

    return { count: totalCount, created: totalCreated, errors: totalErrors, checkpoint: nextCheckpoint };
  } catch (err) {
    log.error('Error en polling WooCommerce', err, { db: dbName });
    logWooSync({
      direccion: 'polling',
      entidad: 'pedidos',
      estado: 'error',
      mensaje: err.message,
    });
    return { error: err.message };
  } finally {
    pollingLocks.set(dbName, false);
  }
}

export async function runWooPollingAcrossDatabases({ force = false } = {}) {
  const dbs = listDatabases();
  for (const dbInfo of dbs) {
    try {
      await runWithDatabase(dbInfo.name, () => runWooPollingCycleForCurrentDb({ force }));
    } catch (err) {
      log.warn('Error ejecutando polling en base', { db: dbInfo.name, error: err.message });
    }
  }
}

export function startWooPollingWorker() {
  if (pollingTimer) return;
  // Catch-up inicial a los 5 segundos de iniciar el servidor
  setTimeout(() => {
    runWooPollingAcrossDatabases({ force: true }).catch(() => {});
  }, 5000).unref();

  pollingTimer = setInterval(() => {
    runWooPollingAcrossDatabases({ force: false }).catch(() => {});
  }, 60 * 1000);
  if (pollingTimer.unref) pollingTimer.unref();
  log.info('Worker de polling WooCommerce iniciado (Cero Exposición)');
}

export function listWooPedidos() {
  return wooPedidoRepo.query('wp')
    .select('wp.*', 'c.nombre as contacto_nombre', 'v.numero as venta_numero', 'co.numero as cobro_numero')
    .leftJoin('contactos', 'c', 'c.id', 'wp.contacto_id')
    .leftJoin('ventas', 'v', 'v.id', 'wp.venta_id')
    .leftJoin('cobros', 'co', 'co.id', 'wp.cobro_id')
    .orderBy('wp.date_created', 'DESC')
    .orderBy('wp.id', 'DESC')
    .all();
}

export function listWooProductos() {
  return wooProductoRepo.query('wp')
    .select('wp.*', 'p.nombre as local_nombre', 'p.sku as local_sku', 'p.precio as local_precio')
    .leftJoin('productos', 'p', 'p.id', 'wp.producto_id')
    .orderBy('wp.id', 'DESC')
    .all();
}

export function listWooClientes() {
  return wooClienteRepo.query('wc')
    .select('wc.*', 'c.nombre as contacto_nombre', 'c.cuit as contacto_cuit')
    .leftJoin('contactos', 'c', 'c.id', 'wc.contacto_id')
    .orderBy('wc.id', 'DESC')
    .all();
}

export function listWooCupones() {
  return wooCuponRepo.findAll();
}

export function listWooDescuentos() {
  return wooDescuentoRepo.query('wd')
    .select('wd.*', 'wp.order_number as woo_order_number', 'v.numero as venta_numero')
    .leftJoin('woo_pedidos', 'wp', 'wp.id', 'wd.woo_pedido_id')
    .leftJoin('ventas', 'v', 'v.id', 'wd.venta_id')
    .orderBy('wd.id', 'DESC')
    .all();
}

export function listWooMetodosEnvio() {
  return wooMetodoEnvioRepo.query('wme')
    .select('wme.*', 'p.nombre as producto_nombre')
    .leftJoin('productos', 'p', 'p.id', 'wme.producto_servicio_id')
    .orderBy('wme.method_id', 'ASC')
    .all();
}

export function updateWooMetodoEnvio(id, b = {}, user = null) {
  wooMetodoEnvioRepo.update(Number(id), {
    producto_servicio_id: b.producto_servicio_id ? Number(b.producto_servicio_id) : null,
    activo: b.activo !== undefined ? (Number(b.activo) ? 1 : 0) : 1,
  }, user);
  return wooMetodoEnvioRepo.findById(Number(id));
}

export function listWooMetodosPago() {
  return wooMetodoPagoRepo.query('wmp')
    .select('wmp.*', 'mp.nombre as metodo_pago_nombre', 'pc.nombre as cuenta_nombre')
    .leftJoin('metodos_pago', 'mp', 'mp.id', 'wmp.metodo_pago_id')
    .leftJoin('plan_cuentas', 'pc', 'pc.id', 'wmp.cuenta_id')
    .orderBy('wmp.gateway_id', 'ASC')
    .all();
}

export function updateWooMetodoPago(id, b = {}, user = null) {
  wooMetodoPagoRepo.update(Number(id), {
    metodo_pago_id: b.metodo_pago_id ? Number(b.metodo_pago_id) : null,
    cuenta_id: b.cuenta_id ? Number(b.cuenta_id) : null,
    activo: b.activo !== undefined ? (Number(b.activo) ? 1 : 0) : 1,
  }, user);
  return wooMetodoPagoRepo.findById(Number(id));
}

export function listWooSyncLogs() {
  return wooSyncLogRepo.query().orderBy('id', 'DESC').limit(200).all();
}
