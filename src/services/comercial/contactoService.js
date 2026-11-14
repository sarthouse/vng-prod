import { db } from '../../db.js';
import { BaseRepository } from '../../core/BaseRepository.js';
import { MODELS } from '../../db/models.js';

class ContactoRepository extends BaseRepository {
  constructor() {
    super({ model: MODELS.contactos });
  }
}

export const contactoRepo = new ContactoRepository();

function normalizeContactoPayload(b, fallback = {}) {
  return {
    nombre: b.nombre !== undefined ? (b.nombre || '').trim() : fallback.nombre,
    razon_social: b.razon_social !== undefined ? (b.razon_social || '').trim() : (fallback.razon_social || ''),
    tipo_documento: b.tipo_documento !== undefined ? (b.tipo_documento || 'CUIT') : (fallback.tipo_documento || 'CUIT'),
    cuit: b.cuit !== undefined ? (b.cuit || '').trim() : (fallback.cuit || ''),
    condicion_iva: b.condicion_iva !== undefined ? (b.condicion_iva || 'Consumidor Final') : (fallback.condicion_iva || 'Consumidor Final'),
    direccion: b.direccion !== undefined ? (b.direccion || '').trim() : (fallback.direccion || ''),
    direccion_fiscal: b.direccion_fiscal !== undefined ? (b.direccion_fiscal || '').trim() : (fallback.direccion_fiscal || ''),
    localidad: b.localidad !== undefined ? (b.localidad || '').trim() : (fallback.localidad || ''),
    provincia: b.provincia !== undefined ? (b.provincia || '').trim() : (fallback.provincia || ''),
    pais: b.pais !== undefined ? (b.pais || 'Argentina').trim() : (fallback.pais || 'Argentina'),
    contacto_nombre: b.contacto_nombre !== undefined ? (b.contacto_nombre || '').trim() : (fallback.contacto_nombre || ''),
    telefono: b.telefono !== undefined ? (b.telefono || '').trim() : (fallback.telefono || ''),
    email: b.email !== undefined ? (b.email || '').trim() : (fallback.email || ''),
    web: b.web !== undefined ? (b.web || '').trim() : (fallback.web || ''),
    banco: b.banco !== undefined ? (b.banco || '').trim() : (fallback.banco || ''),
    cbu_cvu: b.cbu_cvu !== undefined ? (b.cbu_cvu || '').trim() : (fallback.cbu_cvu || ''),
    alias: b.alias !== undefined ? (b.alias || '').trim() : (fallback.alias || ''),
    titular_cuenta: b.titular_cuenta !== undefined ? (b.titular_cuenta || '').trim() : (fallback.titular_cuenta || ''),
    es_proveedor: b.es_proveedor !== undefined ? (b.es_proveedor ? 1 : 0) : (fallback.es_proveedor ?? 0),
    es_cliente: b.es_cliente !== undefined ? (b.es_cliente ? 1 : 0) : (fallback.es_cliente ?? 0),
    es_taller: b.es_taller !== undefined ? (b.es_taller ? 1 : 0) : (fallback.es_taller ?? 0),
    termino_pago_id: b.termino_pago_id !== undefined ? (b.termino_pago_id ? Number(b.termino_pago_id) : null) : (fallback.termino_pago_id ?? null),
    termino_pago_compra_id: b.termino_pago_compra_id !== undefined ? (b.termino_pago_compra_id ? Number(b.termino_pago_compra_id) : null) : (fallback.termino_pago_compra_id ?? null),
    metodo_pago_id: b.metodo_pago_id !== undefined ? (b.metodo_pago_id ? Number(b.metodo_pago_id) : null) : (fallback.metodo_pago_id ?? null),
    lista_precio_id: b.lista_precio_id !== undefined ? (b.lista_precio_id ? Number(b.lista_precio_id) : null) : (fallback.lista_precio_id ?? null),
    observaciones: b.observaciones !== undefined ? (b.observaciones || '').trim() : (fallback.observaciones || ''),
    activo: b.activo !== undefined ? (b.activo ? 1 : 0) : (fallback.activo ?? 1),
  };
}

function sumByContacto(rows, field, predicate = () => true, signFn = () => 1) {
  const totals = new Map();
  for (const row of rows) {
    if (!predicate(row)) continue;
    const key = Number(row.contacto_id);
    const val = (Number(row[field]) || 0) * signFn(row);
    totals.set(key, (totals.get(key) || 0) + val);
  }
  return totals;
}

/**
 * Servicio de Contactos (SOLID):
 * - SRP: encapsula reglas de negocio de contactos y cálculo de saldos.
 * - DIP / LSP: depende de repositorios inyectables (BaseRepository o mocks en memoria).
 */
export class ContactoService {
  constructor({
    contactoRepo: cRepo = contactoRepo,
    compraRepo = new BaseRepository({ model: MODELS.compras }),
    pagoRepo = new BaseRepository({ model: MODELS.pagos }),
    ventaRepo = new BaseRepository({ model: MODELS.ventas }),
    cobroRepo = new BaseRepository({ model: MODELS.cobros }),
    remitoRepo = new BaseRepository({ model: MODELS.operaciones_stock }),
  } = {}) {
    this.contactoRepo = cRepo;
    this.compraRepo = compraRepo;
    this.pagoRepo = pagoRepo;
    this.ventaRepo = ventaRepo;
    this.cobroRepo = cobroRepo;
    this.remitoRepo = remitoRepo;
  }

  listContactos({ es_proveedor, es_cliente, es_taller, search } = {}) {
    let rows = this.contactoRepo.findAll();

    if (es_proveedor === '1' || es_proveedor === true) {
      rows = rows.filter(c => Number(c.es_proveedor) === 1 || Number(c.es_taller) === 1);
    }
    if (es_cliente === '1' || es_cliente === true) {
      rows = rows.filter(c => Number(c.es_cliente) === 1);
    }
    if (es_taller === '1' || es_taller === true) {
      rows = rows.filter(c => Number(c.es_taller) === 1);
    }
    if (search) {
      const q = String(search).toLowerCase();
      rows = rows.filter(c =>
        String(c.nombre || '').toLowerCase().includes(q) ||
        String(c.razon_social || '').toLowerCase().includes(q) ||
        String(c.cuit || '').toLowerCase().includes(q)
      );
    }

    const docSign = (r) => (r.clase_documento === 'nota_credito' ? -1 : 1);
    const comprasMap = sumByContacto(this.compraRepo.findWhere({ estado: 'Confirmado' }), 'total', () => true, docSign);
    const pagosMap = sumByContacto(this.pagoRepo.findWhere({ estado: 'Confirmado' }), 'monto');
    const ventasMap = sumByContacto(
      this.ventaRepo.findAll(),
      'total',
      v => v.estado === 'Confirmada' || v.estado === 'Entregada',
      docSign
    );
    const cobrosMap = sumByContacto(this.cobroRepo.findWhere({ estado: 'Confirmado' }), 'monto');

    return rows.map(c => {
      const id = Number(c.id);
      const total_compras = comprasMap.get(id) || 0;
      const total_pagos = pagosMap.get(id) || 0;
      const total_ventas = ventasMap.get(id) || 0;
      const total_cobros = cobrosMap.get(id) || 0;
      return {
        ...c,
        total_compras,
        total_pagos,
        total_ventas,
        total_cobros,
        saldo_proveedor: Number((total_compras - total_pagos).toFixed(2)),
        saldo_cliente: Number((total_ventas - total_cobros).toFixed(2)),
      };
    });
  }

  getContactoById(id) {
    const c = this.contactoRepo.findById(id);
    if (!c) return null;
    const compras = this.compraRepo.findWhere({ contacto_id: c.id }, { orderBy: 'fecha DESC, id DESC' });
    const pagos = this.pagoRepo.findWhere({ contacto_id: c.id }, { orderBy: 'fecha DESC, id DESC' });
    const ventas = this.ventaRepo.findWhere({ contacto_id: c.id }, { orderBy: 'fecha DESC, id DESC' });
    const cobros = this.cobroRepo.findWhere({ contacto_id: c.id }, { orderBy: 'fecha DESC, id DESC' });
    const docSign = (x) => (x.clase_documento === 'nota_credito' ? -1 : 1);
    const totalCompras = compras.filter(x => x.estado === 'Confirmado').reduce((s, x) => s + Number(x.total || 0) * docSign(x), 0);
    const totalPagos = pagos.filter(x => x.estado === 'Confirmado').reduce((s, x) => s + Number(x.monto || 0), 0);
    const totalVentas = ventas.filter(x => ['Confirmada', 'Entregada'].includes(x.estado)).reduce((s, x) => s + Number(x.total || 0) * docSign(x), 0);
    const totalCobros = cobros.filter(x => x.estado === 'Confirmado').reduce((s, x) => s + Number(x.monto || 0), 0);
    return {
      contacto: c,
      compras,
      pagos,
      ventas,
      cobros,
      saldo_proveedor: Number((totalCompras - totalPagos).toFixed(2)),
      saldo_cliente: Number((totalVentas - totalCobros).toFixed(2)),
    };
  }

  createContacto(b) {
    const nombre = (b.nombre || '').trim();
    if (!nombre) throw new Error('El nombre del contacto es obligatorio');
    const payload = normalizeContactoPayload({ ...b, nombre });
    if (typeof this.contactoRepo.validate === 'function') {
      this.contactoRepo.validate(payload);
    }
    return this.contactoRepo.create(payload);
  }

  updateContacto(id, b) {
    const ex = this.contactoRepo.findById(id);
    if (!ex) return false;
    const payload = normalizeContactoPayload(b, ex);
    if (!payload.nombre) throw new Error('El nombre del contacto es obligatorio');
    if (typeof this.contactoRepo.validate === 'function') {
      this.contactoRepo.validate(payload, { partial: true });
    }
    this.contactoRepo.update(id, payload);
    return true;
  }

  deleteContacto(id) {
    const ex = this.contactoRepo.findById(id);
    if (!ex) return false;
    const hasCompras = this.compraRepo.findWhere({ contacto_id: ex.id }, { limit: 1 }).length > 0;
    const hasVentas = this.ventaRepo.findWhere({ contacto_id: ex.id }, { limit: 1 }).length > 0;
    const hasRemitos = this.remitoRepo.findWhere({ contacto_id: ex.id }, { limit: 1 }).length > 0;
    if (hasCompras || hasVentas || hasRemitos) {
      throw new Error('No se puede eliminar el contacto porque tiene comprobantes asociados');
    }
    return this.contactoRepo.delete(id);
  }
}

export const defaultContactoService = new ContactoService();

export const listContactos = (filters) => defaultContactoService.listContactos(filters);
export const getContactoById = (id) => defaultContactoService.getContactoById(id);
export const createContacto = (b) => defaultContactoService.createContacto(b);
export const updateContacto = (id, b) => defaultContactoService.updateContacto(id, b);
export const deleteContacto = (id) => defaultContactoService.deleteContacto(id);
