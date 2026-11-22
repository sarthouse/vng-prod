import { BaseRepository } from '../../core/BaseRepository.js';
import { createStateMachine } from '../../core/stateMachine.js';
import { MODELS } from '../../db/models.js';

export const ORDEN_SM = createStateMachine({
  Borrador: ['Planificada', 'En Proceso', 'Completada', 'Cancelada'],
  Planificada: ['En Proceso', 'Completada', 'Cancelada'],
  'En Proceso': ['Completada', 'Cancelada'],
  Completada: [],
  Cancelada: [],
}, { label: 'Orden de Producción' });

export const ETAPA_SM = createStateMachine({
  Pendiente: ['En Proceso', 'Completada'],
  'En Proceso': ['Completada', 'Pendiente'],
  Completada: [],
}, { label: 'Etapa de Producción' });
import { getEmpresaConfig, resolveNumeroDocumento } from '../config/configService.js';
import { getActiveRecetaForPlantilla } from './recetaService.js';
import { getInventarioResumen } from '../inventario/inventarioService.js';
import { anularOperacionStock, deleteOperacionStock } from '../inventario/operacionStockService.js';
import { createCompra, deleteCompra } from '../comercial/compraService.js';
import {
  explodeRecetaLineForOrden,
  planificarDocumentosOrden,
  consumirInsumosEtapa,
  registrarMermaEtapa,
} from './produccionStockHelper.js';
import {
  getIngresadoPorOrdenMap,
  ingresarRemanenteAlCompletarOrden,
  ingresarParcialOrden,
} from './produccionCierreHelper.js';

class OrdenRepository extends BaseRepository {
  constructor() {
    super({
      table: 'ordenes_produccion',
      defaultOrder: 'id DESC',
      audit: true,
      columns: ['codigo', 'pedido_id', 'plantilla_id', 'receta_id', 'estado', 'fecha_inicio', 'fecha_objetivo', 'notas', 'archivado'],
    });
  }
}

export const ordenRepo = new OrdenRepository();
export const ordenEtapaRepo = new BaseRepository({ model: MODELS.orden_etapas });
export const ordenLineaRepo = new BaseRepository({ model: MODELS.orden_lineas });
export const planCuentaRepo = new BaseRepository({ model: MODELS.plan_cuentas });

const recetaLineaRepo = new BaseRepository({ table: 'receta_lineas' });
const recetaEtapaRepo = new BaseRepository({ table: 'receta_etapas' });
const etapaConfigRepo = new BaseRepository({ table: 'etapas_config' });
const movimientoStockRepo = new BaseRepository({ table: 'movimientos_stock' });
const vProductoRepo = new BaseRepository({ table: 'v_productos' });
const pedidoRepo = new BaseRepository({ table: 'pedidos' });
const pedidoLineaRepo = new BaseRepository({ table: 'pedido_lineas' });
const ubicacionRepo = new BaseRepository({ table: 'ubicaciones' });
const entregaRepo = new BaseRepository({ table: 'entregas' });
const compraRepo = new BaseRepository({ table: 'compras' });
const empresaConfigRepo = new BaseRepository({ table: 'empresa_config' });
const operacionStockRepo = new BaseRepository({ table: 'operaciones_stock' });
const operacionStockLineaRepo = new BaseRepository({ table: 'operacion_stock_lineas' });

function addDaysISO(isoDate, days) {
  if (!isoDate) return null;
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function diffDaysISO(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const a = new Date(`${startIso}T00:00:00Z`);
  const b = new Date(`${endIso}T00:00:00Z`);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function listOrdenes() {
  const rows = ordenRepo.query('op')
    .select('op.*, pt.nombre as plantilla_nombre, r.nombre as receta_nombre, ped.pedido as pedido_numero')
    .innerJoin('producto_plantillas', 'pt', 'pt.id', 'op.plantilla_id')
    .leftJoin('recetas', 'r', 'r.id', 'op.receta_id')
    .leftJoin('pedidos', 'ped', 'ped.id', 'op.pedido_id')
    .orderBy('op.id', 'DESC')
    .all();

  const allLineas = ordenLineaRepo.query().select('orden_id, cantidad').all();
  const cantByOrden = new Map();
  for (const l of allLineas) {
    cantByOrden.set(l.orden_id, (cantByOrden.get(l.orden_id) || 0) + Number(l.cantidad || 0));
  }

  const allEtapas = ordenEtapaRepo.query('oe')
    .select("oe.*, COALESCE(c.nombre, '') as taller_nombre")
    .leftJoin('contactos', 'c', 'c.id', 'oe.taller_id')
    .orderBy('oe.orden_num', 'ASC')
    .orderBy('oe.id', 'ASC')
    .all();
  const etapasByOrden = new Map();
  for (const e of allEtapas) {
    if (!etapasByOrden.has(e.orden_id)) etapasByOrden.set(e.orden_id, []);
    etapasByOrden.get(e.orden_id).push(e);
  }

  return rows.map(op => {
    const etapas = etapasByOrden.get(op.id) || [];
    const completadas = etapas.filter(e => e.estado === 'Completada').length;
    return {
      ...op,
      cantidad: cantByOrden.get(op.id) || 0,
      etapas_total: etapas.length,
      etapas_completadas: completadas,
      etapas,
    };
  });
}

export function getOrdenDetalle(id) {
  const orden = ordenRepo.query('op')
    .select('op.*, pt.nombre as plantilla_nombre, r.nombre as receta_nombre, ped.pedido as pedido_numero')
    .innerJoin('producto_plantillas', 'pt', 'pt.id', 'op.plantilla_id')
    .leftJoin('recetas', 'r', 'r.id', 'op.receta_id')
    .leftJoin('pedidos', 'ped', 'ped.id', 'op.pedido_id')
    .where('op.id', id)
    .get();
  if (!orden) return null;

  const rawLineas = ordenLineaRepo.query('ol')
    .select('ol.*, p.nombre as producto_nombre, p.sku, p.combinacion_json')
    .innerJoin('productos', 'p', 'p.id', 'ol.producto_id')
    .where('ol.orden_id', id)
    .orderBy('ol.id', 'ASC')
    .all();
  const ingresadaMap = getIngresadoPorOrdenMap(id);
  const lineas = rawLineas.map(l => {
    const pedida = Number(l.cantidad || 0);
    const ingresada = Number(ingresadaMap.get(Number(l.producto_id)) || 0);
    return {
      ...l,
      cantidad_ingresada: Number(ingresada.toFixed(4)),
      cantidad_pendiente: Number(Math.max(0, pedida - ingresada).toFixed(4)),
    };
  });
  orden.cantidad = lineas.reduce((s, l) => s + Number(l.cantidad || 0), 0);
  orden.cantidad_ingresada = lineas.reduce((s, l) => s + Number(l.cantidad_ingresada || 0), 0);
  orden.cantidad_pendiente = lineas.reduce((s, l) => s + Number(l.cantidad_pendiente || 0), 0);

  const etapas = ordenEtapaRepo.query('oe')
    .select(
      'oe.*',
      "COALESCE(c.nombre, '') as taller_nombre",
      "COALESCE(pc.codigo || ' ' || pc.nombre, '') as plan_cuenta_nombre",
      "COALESCE(cmp.numero, '') as compra_numero",
      "COALESCE(pred.nombre, '') as depende_de_nombre",
      "COALESCE(pred.estado, '') as depende_de_estado"
    )
    .leftJoin('contactos', 'c', 'c.id', 'oe.taller_id')
    .leftJoin('plan_cuentas', 'pc', 'pc.id', 'oe.plan_cuenta_id')
    .leftJoin('compras', 'cmp', 'cmp.id', 'oe.compra_id')
    .leftJoin('orden_etapas', 'pred', 'pred.id', 'oe.depende_de_orden_etapa_id')
    .where('oe.orden_id', id)
    .orderBy('oe.orden_num', 'ASC')
    .orderBy('oe.id', 'ASC')
    .all();
  orden.costo_procesos_est = Number(etapas.reduce((s, e) => s + (Number(e.costo_estimado) || 0), 0).toFixed(2));
  orden.costo_procesos_real = Number(etapas.reduce((s, e) => s + (Number(e.costo_real) || 0), 0).toFixed(2));

  const recetaId = orden.receta_id || getActiveRecetaForPlantilla(orden.plantilla_id, lineas.length === 1 ? lineas[0].producto_id : null)?.id;
  const insumosPorEtapa = [];
  const usedPlantillasOrProds = new Set();

  if (recetaId) {
    const rLineas = recetaLineaRepo.query('rl')
      .select("rl.*, p.plantilla_id as prod_plantilla_id, p.nombre as producto_nombre, pt.tipo as producto_tipo, pt.udm, p.stock, COALESCE(re.nombre, ec.nombre, 'General') as etapa_nombre, COALESCE(c.nombre, '') as proveedor_nombre, COALESCE(re.orden, ec.orden, 999) as etapa_orden")
      .innerJoin('v_productos', 'p', 'p.id', 'rl.producto_id')
      .innerJoin('v_plantillas', 'pt', 'pt.id', 'p.plantilla_id')
      .leftJoin('receta_etapas', 're', 're.id', 'rl.receta_etapa_id')
      .leftJoin('etapas_config', 'ec', 'ec.id', 'rl.etapa_id')
      .leftJoin('contactos', 'c', 'c.id', 'pt.proveedor_id')
      .where('rl.receta_id', recetaId)
      .all()
      .sort((a, b) => {
        if (Number(a.etapa_orden) !== Number(b.etapa_orden)) return Number(a.etapa_orden) - Number(b.etapa_orden);
        return String(a.producto_nombre || '').localeCompare(String(b.producto_nombre || ''));
      });

    for (const l of rLineas) {
      usedPlantillasOrProds.add(`plt:${l.prod_plantilla_id}`);
      const exploded = explodeRecetaLineForOrden(l, lineas, l.udm);
      for (const item of exploded) {
        usedPlantillasOrProds.add(item.producto_id);
        insumosPorEtapa.push({
          producto_id: item.producto_id,
          producto_nombre: item.producto_nombre,
          producto_tipo: l.producto_tipo,
          etapa_id: l.etapa_id,
          etapa_nombre: l.etapa_nombre,
          proveedor_nombre: l.proveedor_nombre,
          cantidad_requerida: item.qty,
          udm: l.udm,
          stock_actual: item.stock,
        });
      }
    }
  }

  const opIds = operacionStockRepo.query().select('id').where('referencia_tipo', 'orden').where('referencia_id', id).all().map(o => o.id);
  const movLegacy = movimientoStockRepo.query('ms')
    .select('ms.*, p.nombre as producto_nombre, pt.udm')
    .innerJoin('productos', 'p', 'p.id', 'ms.producto_id')
    .innerJoin('v_plantillas', 'pt', 'pt.id', 'p.plantilla_id')
    .where('ms.referencia_tipo', 'orden_produccion')
    .where('ms.referencia_id', id)
    .orderBy('ms.id', 'DESC')
    .all();
  const movOps = opIds.length > 0
    ? movimientoStockRepo.query('ms')
      .select('ms.*, p.nombre as producto_nombre, pt.udm')
      .innerJoin('productos', 'p', 'p.id', 'ms.producto_id')
      .innerJoin('v_plantillas', 'pt', 'pt.id', 'p.plantilla_id')
      .where('ms.referencia_tipo', 'operacion_stock')
      .whereIn('ms.referencia_id', opIds)
      .orderBy('ms.id', 'DESC')
      .all()
    : [];
  const movimientos = [...movOps, ...movLegacy].sort((a, b) => Number(b.id) - Number(a.id));

  return { orden, lineas, etapas, insumos: insumosPorEtapa, movimientos };
}

export function createOrden(b, user = null) {
  const plantillaId = Number(b.plantilla_id);
  if (!plantillaId) throw new Error('Debe seleccionar un producto fabricable');

  const codigo = resolveNumeroDocumento('orden', b.codigo);
  const fechaInicio = b.fecha_inicio || new Date().toISOString().slice(0, 10);
  let lineas = (Array.isArray(b.lineas) ? b.lineas : [])
    .map(l => ({ producto_id: Number(l.producto_id), cantidad: Math.max(0, Number(l.cantidad) || 0) }))
    .filter(l => l.producto_id > 0 && l.cantidad > 0);

  if (b.pedido_id && lineas.length === 0) {
    lineas = pedidoLineaRepo.query().select('producto_id, cantidad').where('pedido_id', Number(b.pedido_id)).all();
  }

  const recetaId = b.receta_id ? Number(b.receta_id) : (getActiveRecetaForPlantilla(plantillaId, lineas.length === 1 ? lineas[0].producto_id : null)?.id || null);

  const recetaEtapas = recetaId
    ? recetaEtapaRepo.query().where('receta_id', recetaId).orderBy('orden', 'ASC').orderBy('id', 'ASC').all()
    : [];
  const usingRecetaEtapas = recetaEtapas.length > 0;
  const etapasSource = usingRecetaEtapas
    ? recetaEtapas
    : etapaConfigRepo.query().orderBy('orden', 'ASC').orderBy('id', 'ASC').all();

  const totalCantidadOrden = lineas.reduce((s, l) => s + Number(l.cantidad || 0), 0);
  const byId = new Map(etapasSource.map(e => [e.id, e]));
  const hasExplicitDeps = etapasSource.some(e => e.depende_de_id && byId.has(e.depende_de_id));
  const windows = new Map();

  if (hasExplicitDeps) {
    const computeWin = (ec, visiting = new Set()) => {
      if (windows.has(ec.id)) return windows.get(ec.id);
      let start = fechaInicio;
      if (ec.depende_de_id && byId.has(ec.depende_de_id) && !visiting.has(ec.id)) {
        visiting.add(ec.id);
        start = computeWin(byId.get(ec.depende_de_id), visiting).fin;
      }
      const fin = addDaysISO(start, Number(ec.dias_estimados) || 1);
      const win = { inicio: start, fin };
      windows.set(ec.id, win);
      return win;
    };
    for (const ec of etapasSource) computeWin(ec);
  } else {
    let cursorDate = fechaInicio;
    for (const ec of etapasSource) {
      const finEst = addDaysISO(cursorDate, Number(ec.dias_estimados) || 1);
      windows.set(ec.id, { inicio: cursorDate, fin: finEst });
      cursorDate = finEst;
    }
  }

  const maxFin = Array.from(windows.values()).reduce((m, w) => (w.fin > m ? w.fin : m), '');
  const fechaObjetivo = b.fecha_objetivo || maxFin || addDaysISO(fechaInicio, 14);

  return ordenRepo.transaction(() => {
    const ordenId = ordenRepo.create({
      codigo,
      pedido_id: b.pedido_id ? Number(b.pedido_id) : null,
      plantilla_id: plantillaId,
      receta_id: recetaId,
      estado: b.estado || 'Planificada',
      fecha_inicio: fechaInicio,
      fecha_objetivo: fechaObjetivo,
      notas: (b.notas || '').trim(),
    }, user);

    for (const l of lineas) ordenLineaRepo.create({ orden_id: ordenId, producto_id: l.producto_id, cantidad: l.cantidad });

    const etapaIdMap = new Map();
    for (const ec of etapasSource) {
      const win = windows.get(ec.id) || { inicio: fechaInicio, fin: addDaysISO(fechaInicio, 1) };
      const costoEst = Number(((Number(ec.costo_unidad) || 0) * totalCantidadOrden).toFixed(2));
      const newEtapaId = ordenEtapaRepo.create({
        orden_id: ordenId,
        etapa_id: usingRecetaEtapas ? null : ec.id,
        receta_etapa_id: usingRecetaEtapas ? ec.id : null,
        nombre: ec.nombre,
        descripcion: ec.descripcion || '',
        orden_num: ec.orden,
        taller_id: ec.taller_id || null,
        plan_cuenta_id: ec.plan_cuenta_id || null,
        estado: 'Pendiente',
        fecha_inicio_est: win.inicio,
        fecha_fin_est: win.fin,
        costo_estimado: costoEst,
        costo_real: costoEst,
        cantidad_objetivo: totalCantidadOrden,
      });
      etapaIdMap.set(ec.id, newEtapaId);
    }
    for (const ec of etapasSource) {
      if (ec.depende_de_id && etapaIdMap.has(ec.depende_de_id) && etapaIdMap.has(ec.id)) {
        ordenEtapaRepo.update(etapaIdMap.get(ec.id), { depende_de_orden_etapa_id: etapaIdMap.get(ec.depende_de_id) });
      }
    }

    if (b.generar_documentos !== false && lineas.length > 0) {
      const det = getOrdenDetalle(ordenId);
      planificarDocumentosOrden({ ordenId, codigo, fechaInicio, insumos: det?.insumos, user });
    }

    return ordenId;
  });
}

function imputarCompraTallerEtapa({ orden, etapa, tallerId, planCuentaId, costoReal, fecha, user = null }) {
  const cfgCtaManoObra = getEmpresaConfig()?.cta_mano_obra_id || null;
  const defaultManoObra = cfgCtaManoObra
    || planCuentaRepo.query().select('id').where('codigo', '5.1.02').where('activo', 1).get()?.id
    || null;
  return createCompra({
    contacto_id: tallerId,
    orden_id: orden.id,
    fecha,
    caracter: 'interno',
    tipo_comprobante: 'INT',
    estado: 'Confirmado',
    observaciones: `Imputación automática etapa "${etapa.nombre}" (${orden.codigo})`,
    lineas: [{
      descripcion: `${orden.codigo} · Etapa ${etapa.nombre}`,
      cantidad: 1,
      udm: 'servicio',
      precio_unitario: costoReal,
      alicuota_iva: 0,
      plan_cuenta_id: planCuentaId || defaultManoObra,
    }],
  }, user);
}

export function updateOrdenEtapa(etapaRowId, b, user = null) {
  const etapa = ordenEtapaRepo.findById(etapaRowId);
  if (!etapa) return false;
  const orden = ordenRepo.findById(etapa.orden_id);
  if (!orden) return false;

  const newEstado = b.estado ?? etapa.estado;
  const today = new Date().toISOString().slice(0, 10);

  if (etapa.estado === 'Completada' && newEstado !== 'Completada' && Number(etapa.stock_consumido) === 1) {
    throw new Error(`La etapa "${etapa.nombre}" ya consumió stock; no se puede reabrir sin revertir sus movimientos.`);
  }
  ETAPA_SM.assertTransition(etapa.estado, newEstado, { allowSame: true });

  if ((newEstado === 'En Proceso' || newEstado === 'Completada') && etapa.depende_de_orden_etapa_id) {
    const pred = ordenEtapaRepo.query().select('id, nombre, estado').where('id', etapa.depende_de_orden_etapa_id).get();
    if (pred && pred.estado !== 'Completada') {
      throw new Error(`La etapa "${etapa.nombre}" está bloqueada hasta completar "${pred.nombre}"`);
    }
  }

  return ordenRepo.transaction(() => {
    let fechaInicioReal = b.fecha_inicio_real !== undefined ? b.fecha_inicio_real : etapa.fecha_inicio_real;
    let fechaFinReal = b.fecha_fin_real !== undefined ? b.fecha_fin_real : etapa.fecha_fin_real;
    if (newEstado === 'En Proceso' && !fechaInicioReal) fechaInicioReal = today;
    if (newEstado === 'Completada' && !fechaFinReal) fechaFinReal = today;

    const nextMerma = b.cantidad_merma !== undefined ? Math.max(0, Number(b.cantidad_merma) || 0) : (Number(etapa.cantidad_merma) || 0);
    let nextProducida = b.cantidad_producida !== undefined ? Math.max(0, Number(b.cantidad_producida) || 0) : (Number(etapa.cantidad_producida) || 0);
    if (newEstado === 'Completada' && b.cantidad_producida === undefined && nextProducida === 0) {
      const obj = Number(etapa.cantidad_objetivo) || Number(ordenLineaRepo.query().where('orden_id', orden.id).sum('cantidad') || 0);
      nextProducida = Math.max(0, obj - nextMerma);
    }
    const nextCostoReal = b.costo_real !== undefined ? Math.max(0, Number(b.costo_real) || 0) : (Number(etapa.costo_real) || 0);
    const nextNotas = b.notas !== undefined ? String(b.notas || '').trim() : (etapa.notas || '');

    let stockConsumido = etapa.stock_consumido;
    if (newEstado === 'Completada' && !stockConsumido) {
      const ordenLineas = ordenLineaRepo.query('ol')
        .select('ol.*, p.combinacion_json')
        .innerJoin('productos', 'p', 'p.id', 'ol.producto_id')
        .where('ol.orden_id', orden.id)
        .all();
      consumirInsumosEtapa({ orden, etapa, ordenLineas, fecha: today, user });
      registrarMermaEtapa({ orden, etapa, ordenLineas, cantidadMerma: nextMerma, fecha: today, user });
      stockConsumido = 1;
    }

    const nextTallerId = b.taller_id !== undefined ? (b.taller_id ? Number(b.taller_id) : null) : etapa.taller_id;
    const nextPlanCuentaId = b.plan_cuenta_id !== undefined ? (b.plan_cuenta_id ? Number(b.plan_cuenta_id) : null) : (etapa.plan_cuenta_id || null);
    let nextCompraId = etapa.compra_id || null;

    if (newEstado === 'Completada' && nextTallerId && nextCostoReal > 0 && !nextCompraId) {
      nextCompraId = imputarCompraTallerEtapa({
        orden,
        etapa,
        tallerId: nextTallerId,
        planCuentaId: nextPlanCuentaId,
        costoReal: nextCostoReal,
        fecha: fechaFinReal || today,
        user,
      });
    }

    ordenEtapaRepo.update(etapaRowId, {
      taller_id: nextTallerId,
      plan_cuenta_id: nextPlanCuentaId,
      compra_id: nextCompraId,
      estado: newEstado,
      fecha_inicio_est: b.fecha_inicio_est !== undefined ? b.fecha_inicio_est : etapa.fecha_inicio_est,
      fecha_fin_est: b.fecha_fin_est !== undefined ? b.fecha_fin_est : etapa.fecha_fin_est,
      fecha_inicio_real: fechaInicioReal,
      fecha_fin_real: fechaFinReal,
      costo_real: nextCostoReal,
      cantidad_producida: nextProducida,
      cantidad_merma: nextMerma,
      notas: nextNotas,
      stock_consumido: stockConsumido,
    });

    const allEtapas = ordenEtapaRepo.query().select('estado, cantidad_merma').where('orden_id', orden.id).all();
    if (allEtapas.length > 0 && allEtapas.every(e => e.estado === 'Completada')) {
      ordenRepo.update(orden.id, { estado: 'Completada' }, user);
      ingresarRemanenteAlCompletarOrden({ orden, etapas: allEtapas, fecha: today, user });
    } else if (allEtapas.some(e => e.estado === 'En Proceso' || e.estado === 'Completada')) {
      if (orden.estado === 'Planificada') ordenRepo.update(orden.id, { estado: 'En Proceso' }, user);
    }
    return true;
  });
}

export function registrarIngresoParcialOrden(ordenId, b = {}, user = null) {
  const det = getOrdenDetalle(Number(ordenId));
  if (!det) throw new Error('Orden de producción no encontrada');
  const { orden, lineas } = det;
  const fecha = b.fecha || new Date().toISOString().slice(0, 10);
  const destUbi = b.ubicacion_destino_id
    ? Number(b.ubicacion_destino_id)
    : (ubicacionRepo.query().select('id').where('codigo', 'PROD-TERM').get()?.id
      || ubicacionRepo.query().select('id').where('codigo', 'DEP-CENTRAL').get()?.id
      || null);
  const lote = (b.lote || orden.codigo || '').trim();
  const reqMap = new Map((Array.isArray(b.lineas) ? b.lineas : []).map(l => [Number(l.producto_id), Number(l.cantidad) || 0]));

  return ordenRepo.transaction(() => {
    const res = ingresarParcialOrden({ orden, lineas, reqMap, fecha, destUbi, lote, nota: b.nota, user });
    if (orden.estado === 'Planificada') {
      ordenRepo.update(orden.id, { estado: 'En Proceso' }, user);
    }
    return { ok: true, ...res };
  });
}

export function deleteOrden(id, user = null) {
  const existing = ordenRepo.findById(id);
  if (!existing) return false;
  if (!['Borrador', 'Planificada', 'Cancelada'].includes(existing.estado)) {
    throw new Error('No se puede eliminar una orden en proceso o completada; cancelala primero.');
  }
  const opsConfirmadas = operacionStockRepo.query()
    .where('referencia_tipo', 'orden')
    .where('referencia_id', Number(id))
    .where('estado', 'Confirmado')
    .count();
  if (opsConfirmadas > 0) {
    throw new Error('No se puede eliminar una orden con operaciones de stock confirmadas; cancelala para revertirlas.');
  }
  const comprasConfirmadas = compraRepo.query()
    .where('orden_id', Number(id))
    .where('estado', 'Confirmado')
    .count();
  if (comprasConfirmadas > 0) {
    throw new Error('No se puede eliminar una orden con compras confirmadas asociadas.');
  }
  return ordenRepo.transaction(() => {
    const opsBorrador = operacionStockRepo.query()
      .where('referencia_tipo', 'orden')
      .where('referencia_id', Number(id))
      .where('estado', 'Borrador')
      .all();
    for (const op of opsBorrador) deleteOperacionStock(op.id);

    const comprasBorrador = compraRepo.query()
      .where('orden_id', Number(id))
      .where('estado', 'Borrador')
      .all();
    for (const cmp of comprasBorrador) deleteCompra(cmp.id, user);

    return ordenRepo.delete(id);
  });
}

export function cancelarOrden(id, user = null) {
  const existing = ordenRepo.findById(id);
  if (!existing) return false;
  ORDEN_SM.assertTransition(existing.estado, 'Cancelada');
  const comprasConf = compraRepo.query()
    .where('orden_id', Number(id))
    .where('estado', 'Confirmado')
    .count();
  if (comprasConf > 0) {
    throw new Error('La orden tiene compras confirmadas de talleres asociadas; anulalas antes de cancelar la orden');
  }
  return ordenRepo.transaction(() => {
    const ops = operacionStockRepo.query()
      .where('referencia_tipo', 'orden')
      .where('referencia_id', Number(id))
      .all();
    for (const op of ops) {
      if (op.estado === 'Confirmado') anularOperacionStock(op.id, user);
      else if (op.estado === 'Borrador') deleteOperacionStock(op.id);
    }
    ordenRepo.update(id, { estado: 'Cancelada' }, user);
    return true;
  });
}

export function archivarOrden(id, archivado = true, user = null) {
  return ordenRepo.setArchivado(id, archivado, user);
}

export function computeCronogramaCompras() {
  const entregasAll = entregaRepo.query().select('pedido_id, lote, fecha').whereNotNull('fecha').all();
  const pedidosAll = pedidoRepo.query().select('id, pedido, plantilla_id, fecha').whereNotNull('fecha').all();
  const pedById = new Map(pedidosAll.map(p => [p.id, p]));
  const pedByLote = new Map(pedidosAll.map(p => [p.pedido, p]));
  const histRows = [];
  for (const e of entregasAll) {
    const ped = (e.pedido_id && pedById.get(e.pedido_id)) || (e.lote && pedByLote.get(e.lote)) || null;
    if (ped) histRows.push({ plantilla_id: ped.plantilla_id, fecha_pedido: ped.fecha, fecha_entrega: e.fecha });
  }

  const diasPorPlantilla = new Map();
  const todosDias = [];
  for (const h of histRows) {
    const d = diffDaysISO(h.fecha_pedido, h.fecha_entrega);
    if (d !== null && d >= 0 && d <= 365) {
      todosDias.push(d);
      if (h.plantilla_id) {
        if (!diasPorPlantilla.has(h.plantilla_id)) diasPorPlantilla.set(h.plantilla_id, []);
        diasPorPlantilla.get(h.plantilla_id).push(d);
      }
    }
  }
  const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
  const empresaCfg = empresaConfigRepo.query().select('dias_entrega_defecto').where('id', 1).get();
  const leadTimeDefault = Number(empresaCfg?.dias_entrega_defecto) || 7;
  const leadTimeGlobal = avg(todosDias) ?? leadTimeDefault;

  const invList = getInventarioResumen();
  const invMap = new Map(invList.map(i => [i.id, i]));

  const ordenes = ordenRepo.query('op')
    .select('op.*, pt.nombre as plantilla_nombre')
    .innerJoin('producto_plantillas', 'pt', 'pt.id', 'op.plantilla_id')
    .whereIn('op.estado', ['Planificada', 'En Proceso'])
    .orderBy('op.fecha_inicio', 'ASC')
    .all();

  const today = new Date().toISOString().slice(0, 10);
  const requerimientos = [];

  for (const op of ordenes) {
    const etapas = ordenEtapaRepo.query().where('orden_id', op.id).orderBy('orden_num', 'ASC').all();
    const etapaById = new Map(etapas.filter(e => e.etapa_id).map(e => [e.etapa_id, e]));
    const etapaByRecetaId = new Map(etapas.filter(e => e.receta_etapa_id).map(e => [e.receta_etapa_id, e]));
    const ordenLineas = ordenLineaRepo.query('ol')
      .select('ol.*, p.combinacion_json')
      .innerJoin('productos', 'p', 'p.id', 'ol.producto_id')
      .where('ol.orden_id', op.id)
      .all();
    const recetaId = op.receta_id || getActiveRecetaForPlantilla(op.plantilla_id, ordenLineas.length === 1 ? ordenLineas[0].producto_id : null)?.id;
    const pltLead = avg(diasPorPlantilla.get(op.plantilla_id) || []) ?? leadTimeGlobal;
    const usedPlantillasOrProds = new Set();

    if (recetaId) {
      const lineas = recetaLineaRepo.query('rl')
        .select("rl.*, p.plantilla_id as prod_plantilla_id, p.nombre as producto_nombre, pt.tipo as producto_tipo, pt.udm, p.precio, p.minimo_compra, p.stock, COALESCE(c.nombre, '') as proveedor_nombre")
        .innerJoin('v_productos', 'p', 'p.id', 'rl.producto_id')
        .innerJoin('v_plantillas', 'pt', 'pt.id', 'p.plantilla_id')
        .leftJoin('contactos', 'c', 'c.id', 'pt.proveedor_id')
        .where('rl.receta_id', recetaId)
        .where('pt.tipo', '!=', 'servicio')
        .all();

      for (const l of lineas) {
        usedPlantillasOrProds.add(`plt:${l.prod_plantilla_id}`);
        const etapaOrden = (l.receta_etapa_id && etapaByRecetaId.get(l.receta_etapa_id))
          || (l.etapa_id && etapaById.get(l.etapa_id))
          || etapas[0];
        if (etapaOrden && etapaOrden.stock_consumido) continue;

        const exploded = explodeRecetaLineForOrden(l, ordenLineas, l.udm);
        for (const item of exploded) {
          usedPlantillasOrProds.add(item.producto_id);
          const cantReq = item.qty;
          const inv = invMap.get(item.producto_id);
          const itemLead = (inv && Number(inv.lead_time_dias) > 0) ? Number(inv.lead_time_dias) : pltLead;
          const fechaNecesaria = etapaOrden?.fecha_inicio_est || op.fecha_inicio;
          const fechaOptimaCompra = addDaysISO(fechaNecesaria, -itemLead);
          const disponible = inv ? inv.disponible : 0;
          const aComprar = disponible < 0 ? Math.min(cantReq, Math.abs(disponible)) : 0;

          requerimientos.push({
            origen: op.codigo,
            orden_id: op.id,
            modelo: op.plantilla_nombre,
            etapa: etapaOrden?.nombre || 'General',
            producto_id: item.producto_id,
            producto_nombre: item.producto_nombre,
            proveedor_nombre: l.proveedor_nombre,
            udm: l.udm,
            cantidad_necesaria: cantReq,
            stock_disponible: disponible,
            a_comprar: Number((aComprar > 0 && l.minimo_compra > 0 ? Math.max(aComprar, l.minimo_compra) : aComprar).toFixed(4)),
            fecha_necesaria: fechaNecesaria,
            lead_time_dias: itemLead,
            fecha_compra_optima: fechaOptimaCompra,
            urgencia: fechaOptimaCompra <= today ? 'Comprar Hoy' : (diffDaysISO(today, fechaOptimaCompra) <= 5 ? 'Próximo' : 'En Fecha'),
          });
        }
      }
    }
  }

  for (const inv of invList) {
    if (!inv.se_compra || inv.stock_minimo <= 0 || inv.disponible >= inv.stock_minimo) continue;
    const faltanteMin = Math.max(0, inv.stock_minimo - inv.disponible);
    const aComprarMin = faltanteMin > 0 && inv.minimo_compra > 0 ? Math.max(faltanteMin, inv.minimo_compra) : faltanteMin;
    const itemLead = Number(inv.lead_time_dias) > 0 ? Number(inv.lead_time_dias) : leadTimeGlobal;
    requerimientos.push({
      origen: 'Stock Mínimo',
      orden_id: null,
      modelo: 'Reposición automática',
      etapa: 'Punto de Reorden',
      producto_id: inv.id,
      producto_nombre: inv.nombre,
      proveedor_nombre: inv.proveedor_nombre,
      udm: inv.udm,
      cantidad_necesaria: Number(faltanteMin.toFixed(4)),
      stock_disponible: inv.disponible,
      a_comprar: Number(aComprarMin.toFixed(4)),
      fecha_necesaria: today,
      lead_time_dias: itemLead,
      fecha_compra_optima: today,
      urgencia: inv.disponible <= 0 ? 'Comprar Hoy' : 'Próximo',
    });
  }

  const urgRank = { 'Comprar Hoy': 0, 'Próximo': 1, 'En Fecha': 2 };
  const consolidadoMap = new Map();
  for (const r of requerimientos) {
    const inv = invMap.get(r.producto_id);
    const prev = consolidadoMap.get(r.producto_id);
    if (!prev) {
      const disponible = inv ? inv.disponible : r.stock_disponible;
      const stockMin = inv ? Number(inv.stock_minimo || 0) : 0;
      const minCompra = inv ? Number(inv.minimo_compra || 0) : 0;
      const deficit = stockMin > 0
        ? Math.max(0, stockMin - disponible)
        : (disponible < 0 ? Math.abs(disponible) : 0);
      const aComprar = deficit > 0 && minCompra > 0 ? Math.max(deficit, minCompra) : deficit;
      consolidadoMap.set(r.producto_id, {
        producto_id: r.producto_id,
        producto_nombre: r.producto_nombre,
        proveedor_id: inv?.proveedor_id || null,
        proveedor_nombre: r.proveedor_nombre,
        udm: r.udm,
        demanda_ordenes: r.orden_id ? r.cantidad_necesaria : 0,
        stock_disponible: disponible,
        stock_minimo: stockMin,
        minimo_compra: minCompra,
        a_comprar: Number(aComprar.toFixed(4)),
        lead_time_dias: r.lead_time_dias,
        fecha_necesaria: r.fecha_necesaria,
        fecha_compra_optima: r.fecha_compra_optima,
        urgencia: r.urgencia,
        origenes: [r.origen],
      });
    } else {
      if (r.orden_id) prev.demanda_ordenes = Number((prev.demanda_ordenes + r.cantidad_necesaria).toFixed(4));
      if (r.fecha_necesaria && (!prev.fecha_necesaria || r.fecha_necesaria < prev.fecha_necesaria)) prev.fecha_necesaria = r.fecha_necesaria;
      if (r.fecha_compra_optima && (!prev.fecha_compra_optima || r.fecha_compra_optima < prev.fecha_compra_optima)) prev.fecha_compra_optima = r.fecha_compra_optima;
      if ((urgRank[r.urgencia] ?? 9) < (urgRank[prev.urgencia] ?? 9)) prev.urgencia = r.urgencia;
      if (!prev.origenes.includes(r.origen)) prev.origenes.push(r.origen);
    }
  }
  const consolidado = Array.from(consolidadoMap.values())
    .sort((a, b) => (a.fecha_compra_optima || '').localeCompare(b.fecha_compra_optima || ''));

  const alertasStockMinimo = invList.filter(i => i.alerta_minimo);

  return {
    lead_time_global_dias: leadTimeGlobal,
    entregas_analizadas: todosDias.length,
    consolidado,
    requerimientos: requerimientos.sort((a, b) => (a.fecha_compra_optima || '').localeCompare(b.fecha_compra_optima || '')),
    alertas_stock_minimo: alertasStockMinimo,
  };
}

export function getPendientesOperativos() {
  const entregas = operacionStockRepo.query('os')
    .select("os.id, os.numero, os.fecha, os.estado, os.contacto_id, os.referencia_tipo, os.referencia_id, os.motivo, COALESCE(c.nombre, 'Sin cliente') as contacto_nombre")
    .leftJoin('contactos', 'c', 'c.id', 'os.contacto_id')
    .where('os.tipo', 'entrega')
    .where('os.estado', 'Borrador')
    .orderBy('os.fecha', 'ASC')
    .orderBy('os.id', 'ASC')
    .all();

  const entLineas = entregas.length > 0
    ? operacionStockLineaRepo.query('osl')
        .select("osl.operacion_id, osl.producto_id, osl.cantidad, osl.udm, COALESCE(p.nombre, osl.descripcion, 'Ítem') as producto_nombre, COALESCE(p.sku, '') as sku")
        .leftJoin('productos', 'p', 'p.id', 'osl.producto_id')
        .whereIn('osl.operacion_id', entregas.map(e => e.id))
        .all()
    : [];

  const entLineasMap = new Map();
  for (const l of entLineas) {
    if (!entLineasMap.has(l.operacion_id)) entLineasMap.set(l.operacion_id, []);
    entLineasMap.get(l.operacion_id).push(l);
  }
  const entregas_pendientes = entregas.map(e => {
    const lineas = entLineasMap.get(e.id) || [];
    const total = Number(lineas.reduce((s, l) => s + (Number(l.cantidad) || 0), 0).toFixed(4));
    return { ...e, lineas, total };
  });

  const ordenes = ordenRepo.query('op')
    .select("op.id, op.codigo, op.fecha_inicio, op.fecha_objetivo, op.estado, COALESCE(pt.nombre, '') as plantilla_nombre")
    .innerJoin('producto_plantillas', 'pt', 'pt.id', 'op.plantilla_id')
    .whereIn('op.estado', ['Planificada', 'En Proceso'])
    .orderBy('op.fecha_objetivo', 'ASC')
    .orderBy('op.id', 'DESC')
    .all();

  const ordLineas = ordenes.length > 0
    ? ordenLineaRepo.query('ol')
        .select("ol.orden_id, ol.producto_id, ol.cantidad, p.nombre as producto_nombre, COALESCE(p.sku, '') as sku")
        .innerJoin('productos', 'p', 'p.id', 'ol.producto_id')
        .whereIn('ol.orden_id', ordenes.map(o => o.id))
        .all()
    : [];

  const ordLineasMap = new Map();
  for (const l of ordLineas) {
    if (!ordLineasMap.has(l.orden_id)) ordLineasMap.set(l.orden_id, []);
    ordLineasMap.get(l.orden_id).push(l);
  }
  const ordenes_pendientes = ordenes.map(o => {
    const lineas = ordLineasMap.get(o.id) || [];
    const total = Number(lineas.reduce((s, l) => s + (Number(l.cantidad) || 0), 0).toFixed(4));
    return { ...o, lineas, total };
  });

  return {
    entregas_pendientes,
    ordenes_pendientes,
    total_entregas_unidades: Number(entregas_pendientes.reduce((s, e) => s + e.total, 0).toFixed(4)),
    total_ordenes_unidades: Number(ordenes_pendientes.reduce((s, o) => s + o.total, 0).toFixed(4)),
  };
}
