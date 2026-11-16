import { db } from '../../db.js';
import { BaseRepository } from '../../core/BaseRepository.js';
import { MODELS } from '../../db/models.js';
import { convertUnitFromDb } from '../config/configService.js';
import { resolveVariantForPlantilla } from './presupuestoService.js';
import { applicableQtyForLine, getActiveRecetaForPlantilla } from './recetaService.js';
import { getInventarioResumen, registrarMovimientoStock } from '../inventario/inventarioService.js';
import { createOperacionStock } from '../inventario/operacionStockService.js';
import { createCompra } from '../comercial/compraService.js';

class OrdenRepository extends BaseRepository {
  constructor() {
    super({
      table: 'ordenes_produccion',
      defaultOrder: 'id DESC',
      audit: true,
      columns: ['codigo', 'pedido_id', 'plantilla_id', 'receta_id', 'estado', 'fecha_inicio', 'fecha_objetivo', 'notas'],
    });
  }
}

export const ordenRepo = new OrdenRepository();
export const ordenEtapaRepo = new BaseRepository({ model: MODELS.orden_etapas });
export const ordenLineaRepo = new BaseRepository({ model: MODELS.orden_lineas });
export const planCuentaRepo = new BaseRepository({ model: MODELS.plan_cuentas });

function explodeRecetaLineForOrden(line, ordenLineas, udmCompra) {
  let vars = [];
  try { vars = JSON.parse(line.variantes_json || '[]'); } catch { vars = []; }
  const conv = convertUnitFromDb(line.coeficiente, line.udm_receta || udmCompra, udmCompra);

  if (Number(line.emparejar_variante) !== 1) {
    let pares = 0;
    for (const ol of ordenLineas) pares += applicableQtyForLine(ol, ol.cantidad, vars);
    if (pares <= 0) return [];
    return [{
      producto_id: line.producto_id,
      producto_nombre: line.producto_nombre,
      stock: line.stock,
      qty: Number((conv * pares).toFixed(4)),
    }];
  }

  const byProd = new Map();
  for (const ol of ordenLineas) {
    const pares = applicableQtyForLine(ol, ol.cantidad, vars);
    if (pares <= 0) continue;
    let combo = {};
    try { combo = JSON.parse(ol.combinacion_json || '{}'); } catch { combo = {}; }
    const matched = line.prod_plantilla_id ? resolveVariantForPlantilla(line.prod_plantilla_id, combo) : null;
    const targetId = matched ? matched.id : line.producto_id;
    const prev = byProd.get(targetId);
    const addQty = conv * pares;
    if (prev) {
      prev.qty += addQty;
    } else {
      byProd.set(targetId, {
        producto_id: targetId,
        producto_nombre: matched ? matched.nombre : line.producto_nombre,
        stock: matched ? matched.stock : line.stock,
        qty: addQty,
      });
    }
  }
  return Array.from(byProd.values()).map(r => ({ ...r, qty: Number(r.qty.toFixed(4)) }));
}

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
  const rows = db.prepare(`
    SELECT op.*, pt.nombre as plantilla_nombre, r.nombre as receta_nombre, ped.pedido as pedido_numero,
           COALESCE((SELECT SUM(ol.cantidad) FROM orden_lineas ol WHERE ol.orden_id = op.id), 0) as cantidad
    FROM ordenes_produccion op
    JOIN producto_plantillas pt ON pt.id = op.plantilla_id
    LEFT JOIN recetas r ON r.id = op.receta_id
    LEFT JOIN pedidos ped ON ped.id = op.pedido_id
    ORDER BY op.id DESC
  `).all();

  return rows.map(op => {
    const etapas = db.prepare(`
      SELECT oe.*, COALESCE(c.nombre, '') as taller_nombre
      FROM orden_etapas oe
      LEFT JOIN contactos c ON c.id = oe.taller_id
      WHERE oe.orden_id = ?
      ORDER BY oe.orden_num ASC, oe.id ASC
    `).all(op.id);
    const completadas = etapas.filter(e => e.estado === 'Completada').length;
    return {
      ...op,
      etapas_total: etapas.length,
      etapas_completadas: completadas,
      etapas,
    };
  });
}

export function getOrdenDetalle(id) {
  const orden = db.prepare(`
    SELECT op.*, pt.nombre as plantilla_nombre,
           r.nombre as receta_nombre, ped.pedido as pedido_numero
    FROM ordenes_produccion op
    JOIN producto_plantillas pt ON pt.id = op.plantilla_id
    LEFT JOIN recetas r ON r.id = op.receta_id
    LEFT JOIN pedidos ped ON ped.id = op.pedido_id
    WHERE op.id = ?
  `).get(id);
  if (!orden) return null;

  const lineas = db.prepare(`
    SELECT ol.*, p.nombre as producto_nombre, p.sku, p.combinacion_json,
           COALESCE((
             SELECT SUM(ms.cantidad)
             FROM movimientos_stock ms
             WHERE ms.referencia_tipo = 'orden_produccion'
               AND ms.referencia_id = ol.orden_id
               AND ms.tipo = 'ingreso_produccion'
               AND ms.producto_id = ol.producto_id
           ), 0) as cantidad_ingresada
    FROM orden_lineas ol
    JOIN productos p ON p.id = ol.producto_id
    WHERE ol.orden_id = ?
    ORDER BY ol.id ASC
  `).all(id).map(l => {
    const pedida = Number(l.cantidad || 0);
    const ingresada = Number(l.cantidad_ingresada || 0);
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
    const rLineas = db.prepare(`
      SELECT rl.*, p.plantilla_id as prod_plantilla_id, p.nombre as producto_nombre, pt.tipo as producto_tipo,
             pt.udm, p.stock, COALESCE(re.nombre, ec.nombre, 'General') as etapa_nombre,
             COALESCE(c.nombre, '') as proveedor_nombre
      FROM receta_lineas rl
      JOIN v_productos p ON p.id = rl.producto_id
      JOIN v_plantillas pt ON pt.id = p.plantilla_id
      LEFT JOIN receta_etapas re ON re.id = rl.receta_etapa_id
      LEFT JOIN etapas_config ec ON ec.id = rl.etapa_id
      LEFT JOIN contactos c ON c.id = pt.proveedor_id
      WHERE rl.receta_id = ?
      ORDER BY COALESCE(re.orden, ec.orden, 999) ASC, p.nombre ASC
    `).all(recetaId);

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

  const movimientos = db.prepare(`
    SELECT ms.*, p.nombre as producto_nombre, pt.udm
    FROM movimientos_stock ms
    JOIN productos p ON p.id = ms.producto_id
    JOIN v_plantillas pt ON pt.id = p.plantilla_id
    WHERE ms.referencia_tipo = 'orden_produccion' AND ms.referencia_id = ?
    ORDER BY ms.id DESC
  `).all(id);

  return { orden, lineas, etapas, insumos: insumosPorEtapa, movimientos };
}

function planificarDocumentosOrden(ordenId, codigo, fechaInicio, user = null) {
  const det = getOrdenDetalle(ordenId);
  if (!det || !det.insumos || det.insumos.length === 0) return;

  const remitoLineas = [];
  const comprasPorProveedor = new Map();

  for (const ins of det.insumos) {
    if (ins.producto_tipo === 'servicio') continue;
    const req = Number(ins.cantidad_requerida || 0);
    if (req <= 0) continue;

    const prod = db.prepare(`
      SELECT p.id, p.costo, p.precio, p.minimo_compra, p.stock, pt.proveedor_id, pt.alicuota_iva
      FROM v_productos p
      JOIN producto_plantillas pt ON pt.id = p.plantilla_id
      WHERE p.id = ?
    `).get(ins.producto_id);
    if (!prod) continue;

    const disponible = Math.max(0, Number(prod.stock ?? ins.stock_actual ?? 0));
    const aEntregar = Number(Math.min(req, disponible).toFixed(4));
    const faltante = Number(Math.max(0, req - disponible).toFixed(4));

    if (aEntregar > 0) {
      remitoLineas.push({
        producto_id: ins.producto_id,
        descripcion: ins.producto_nombre,
        cantidad: aEntregar,
        udm: ins.udm || 'unidades',
      });
    }

    if (faltante > 0 && prod.proveedor_id) {
      const minimo = Number(prod.minimo_compra || 0);
      const qtyComprar = minimo > 0 ? Math.max(faltante, minimo) : faltante;
      if (!comprasPorProveedor.has(prod.proveedor_id)) {
        comprasPorProveedor.set(prod.proveedor_id, []);
      }
      comprasPorProveedor.get(prod.proveedor_id).push({
        producto_id: ins.producto_id,
        descripcion: ins.producto_nombre,
        cantidad: qtyComprar,
        udm: ins.udm || 'unidades',
        precio_unitario: Number(prod.costo || prod.precio || 0),
        alicuota_iva: Number(prod.alicuota_iva ?? 21),
      });
    }
  }

  if (remitoLineas.length > 0) {
    createOperacionStock({
      fecha: fechaInicio,
      tipo: 'remito_taller',
      referencia_tipo: 'orden',
      referencia_id: ordenId,
      estado: 'Borrador',
      motivo: `Entrega materiales ${codigo}`,
      lineas: remitoLineas,
    }, user);
  }

  for (const [proveedorId, cLineas] of comprasPorProveedor.entries()) {
    createCompra({
      contacto_id: proveedorId,
      orden_id: ordenId,
      fecha: fechaInicio,
      estado: 'Borrador',
      caracter: 'fiscal',
      observaciones: `Generado automáticamente por faltante en ${codigo}`,
      lineas: cLineas,
    }, user);
  }
}

export function createOrden(b, user = null) {
  const plantillaId = Number(b.plantilla_id);
  if (!plantillaId) throw new Error('Debe seleccionar un producto fabricable');

  const nextNum = (db.prepare('SELECT MAX(id) as m FROM ordenes_produccion').get().m || 0) + 1;
  const codigo = (b.codigo || `OP-${String(nextNum).padStart(4, '0')}`).trim();
  const fechaInicio = b.fecha_inicio || new Date().toISOString().slice(0, 10);
  let lineas = (Array.isArray(b.lineas) ? b.lineas : [])
    .map(l => ({ producto_id: Number(l.producto_id), cantidad: Math.max(0, Number(l.cantidad) || 0) }))
    .filter(l => l.producto_id > 0 && l.cantidad > 0);

  if (b.pedido_id && lineas.length === 0) {
    lineas = db.prepare('SELECT producto_id, cantidad FROM pedido_lineas WHERE pedido_id = ?').all(Number(b.pedido_id));
  }

  const recetaId = b.receta_id ? Number(b.receta_id) : (getActiveRecetaForPlantilla(plantillaId, lineas.length === 1 ? lineas[0].producto_id : null)?.id || null);

  const recetaEtapas = recetaId
    ? db.prepare('SELECT * FROM receta_etapas WHERE receta_id = ? ORDER BY orden ASC, id ASC').all(recetaId)
    : [];
  const usingRecetaEtapas = recetaEtapas.length > 0;
  const etapasSource = usingRecetaEtapas
    ? recetaEtapas
    : db.prepare('SELECT * FROM etapas_config ORDER BY orden ASC, id ASC').all();

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
      planificarDocumentosOrden(ordenId, codigo, fechaInicio, user);
    }

    return ordenId;
  });
}

export function updateOrdenEtapa(etapaRowId, b, user = null) {
  const etapa = db.prepare('SELECT * FROM orden_etapas WHERE id = ?').get(etapaRowId);
  if (!etapa) return false;
  const orden = ordenRepo.findById(etapa.orden_id);
  if (!orden) return false;

  const newEstado = b.estado ?? etapa.estado;
  const today = new Date().toISOString().slice(0, 10);

  if ((newEstado === 'En Proceso' || newEstado === 'Completada') && etapa.depende_de_orden_etapa_id) {
    const pred = db.prepare('SELECT id, nombre, estado FROM orden_etapas WHERE id = ?').get(etapa.depende_de_orden_etapa_id);
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
      const obj = Number(etapa.cantidad_objetivo) || Number(db.prepare('SELECT COALESCE(SUM(cantidad), 0) as c FROM orden_lineas WHERE orden_id = ?').get(orden.id)?.c || 0);
      nextProducida = Math.max(0, obj - nextMerma);
    }
    const nextCostoReal = b.costo_real !== undefined ? Math.max(0, Number(b.costo_real) || 0) : (Number(etapa.costo_real) || 0);
    const nextNotas = b.notas !== undefined ? String(b.notas || '').trim() : (etapa.notas || '');

    let stockConsumido = etapa.stock_consumido;
    if (newEstado === 'Completada' && !stockConsumido) {
      const ordenLineas = db.prepare(`
        SELECT ol.*, p.combinacion_json
        FROM orden_lineas ol
        JOIN productos p ON p.id = ol.producto_id
        WHERE ol.orden_id = ?
      `).all(orden.id);
      const recetaId = orden.receta_id || getActiveRecetaForPlantilla(orden.plantilla_id, ordenLineas.length === 1 ? ordenLineas[0].producto_id : null)?.id;

      if (recetaId && (etapa.receta_etapa_id || etapa.etapa_id)) {
        const rLineas = db.prepare(`
          SELECT rl.*, p.plantilla_id as prod_plantilla_id, p.nombre as producto_nombre, p.stock, pt.udm, pt.tipo
          FROM receta_lineas rl
          JOIN v_productos p ON p.id = rl.producto_id
          JOIN v_plantillas pt ON pt.id = p.plantilla_id
          WHERE rl.receta_id = ? AND pt.tipo != 'servicio'
            AND ((? IS NOT NULL AND rl.receta_etapa_id = ?) OR (? IS NOT NULL AND rl.etapa_id = ?))
        `).all(recetaId, etapa.receta_etapa_id || null, etapa.receta_etapa_id || null, etapa.etapa_id || null, etapa.etapa_id || null);

        const tallerExtId = db.prepare("SELECT id FROM ubicaciones WHERE codigo = 'TALLER-EXT'").get()?.id || null;
        const depCentralId = db.prepare("SELECT id FROM ubicaciones WHERE codigo = 'DEP-CENTRAL'").get()?.id || null;

        for (const l of rLineas) {
          const exploded = explodeRecetaLineForOrden(l, ordenLineas, l.udm);
          for (const item of exploded) {
            if (item.qty > 0) {
              // Si los materiales fueron enviados a TALLER-EXT mediante remito_taller, consumir desde TALLER-EXT primero
              let qtyTaller = 0;
              if (tallerExtId) {
                const qRow = db.prepare('SELECT COALESCE(SUM(cantidad), 0) as c FROM stock_quants WHERE producto_id = ? AND ubicacion_id = ?').get(item.producto_id, tallerExtId);
                qtyTaller = Math.max(0, Number(qRow?.c || 0));
              }
              const fromTaller = Math.min(item.qty, qtyTaller);
              const fromDep = Number((item.qty - fromTaller).toFixed(4));

              if (fromTaller > 0) {
                registrarMovimientoStock({
                  producto_id: item.producto_id,
                  tipo: 'consumo_produccion',
                  cantidad: -fromTaller,
                  fecha: today,
                  ubicacion_origen_id: tallerExtId,
                  referencia_tipo: 'orden_produccion',
                  referencia_id: orden.id,
                  nota: `${orden.codigo} · Etapa ${etapa.nombre} (Taller)`,
                  user,
                });
              }
              if (fromDep > 0) {
                registrarMovimientoStock({
                  producto_id: item.producto_id,
                  tipo: 'consumo_produccion',
                  cantidad: -fromDep,
                  fecha: today,
                  ubicacion_origen_id: depCentralId,
                  referencia_tipo: 'orden_produccion',
                  referencia_id: orden.id,
                  nota: `${orden.codigo} · Etapa ${etapa.nombre}`,
                  user,
                });
              }
            }
          }
        }
      }
      stockConsumido = 1;
    }

    const nextTallerId = b.taller_id !== undefined ? (b.taller_id ? Number(b.taller_id) : null) : etapa.taller_id;
    const nextPlanCuentaId = b.plan_cuenta_id !== undefined ? (b.plan_cuenta_id ? Number(b.plan_cuenta_id) : null) : (etapa.plan_cuenta_id || null);
    let nextCompraId = etapa.compra_id || null;

    if (newEstado === 'Completada' && nextTallerId && nextCostoReal > 0 && !nextCompraId) {
      const defaultManoObra = planCuentaRepo.query().select('id').where('codigo', '5.1.02').where('activo', 1).get()?.id || null;
      nextCompraId = createCompra({
        contacto_id: nextTallerId,
        orden_id: orden.id,
        fecha: fechaFinReal || today,
        caracter: 'interno',
        tipo_comprobante: 'INT',
        estado: 'Confirmado',
        observaciones: `Imputación automática etapa "${etapa.nombre}" (${orden.codigo})`,
        lineas: [{
          descripcion: `${orden.codigo} · Etapa ${etapa.nombre}`,
          cantidad: 1,
          udm: 'servicio',
          precio_unitario: nextCostoReal,
          alicuota_iva: 0,
          plan_cuenta_id: nextPlanCuentaId || defaultManoObra,
        }],
      }, user);
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

    const allEtapas = db.prepare('SELECT estado FROM orden_etapas WHERE orden_id = ?').all(orden.id);
    if (allEtapas.length > 0 && allEtapas.every(e => e.estado === 'Completada')) {
      ordenRepo.update(orden.id, { estado: 'Completada' }, user);
      const destUbi = db.prepare("SELECT id FROM ubicaciones WHERE codigo = 'PROD-TERM'").get()?.id
        || db.prepare("SELECT id FROM ubicaciones WHERE codigo = 'DEP-CENTRAL'").get()?.id
        || null;
      const oLineas = db.prepare('SELECT producto_id, cantidad FROM orden_lineas WHERE orden_id = ?').all(orden.id);
      for (const ol of oLineas) {
        const yaIngresado = Number(db.prepare(`
          SELECT COALESCE(SUM(cantidad), 0) as c FROM movimientos_stock
          WHERE referencia_tipo = 'orden_produccion' AND referencia_id = ? AND tipo = 'ingreso_produccion' AND producto_id = ?
        `).get(orden.id, ol.producto_id)?.c || 0);
        const rem = Number((Number(ol.cantidad || 0) - yaIngresado).toFixed(4));
        if (rem > 0) {
          registrarMovimientoStock({
            producto_id: ol.producto_id,
            tipo: 'ingreso_produccion',
            cantidad: rem,
            fecha: today,
            ubicacion_destino_id: destUbi,
            lote: orden.codigo,
            referencia_tipo: 'orden_produccion',
            referencia_id: orden.id,
            nota: `Ingreso Prod. Terminado ${orden.codigo}`,
            user,
          });
        }
      }
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
    : (db.prepare("SELECT id FROM ubicaciones WHERE codigo = 'PROD-TERM'").get()?.id
      || db.prepare("SELECT id FROM ubicaciones WHERE codigo = 'DEP-CENTRAL'").get()?.id
      || null);
  const lote = (b.lote || orden.codigo || '').trim();
  const reqMap = new Map((Array.isArray(b.lineas) ? b.lineas : []).map(l => [Number(l.producto_id), Number(l.cantidad) || 0]));

  return ordenRepo.transaction(() => {
    let totalIngresadoAhora = 0;
    for (const ol of lineas) {
      const cant = reqMap.has(Number(ol.producto_id))
        ? Math.max(0, Number(reqMap.get(Number(ol.producto_id))) || 0)
        : 0;
      if (cant <= 0) continue;
      registrarMovimientoStock({
        producto_id: ol.producto_id,
        tipo: 'ingreso_produccion',
        cantidad: cant,
        fecha,
        ubicacion_destino_id: destUbi,
        lote,
        referencia_tipo: 'orden_produccion',
        referencia_id: orden.id,
        nota: b.nota ? `${orden.codigo} · ${b.nota}` : `Ingreso parcial Prod. Terminado ${orden.codigo}`,
        user,
      });
      totalIngresadoAhora += cant;
    }

    if (totalIngresadoAhora <= 0) {
      throw new Error('Ingresá una cantidad mayor a 0 en al menos una variante');
    }

    if (orden.estado === 'Planificada') {
      ordenRepo.update(orden.id, { estado: 'En Proceso' }, user);
    }
    return { ok: true, ingresado: totalIngresadoAhora };
  });
}

export function deleteOrden(id) {
  return ordenRepo.delete(id);
}

export function computeCronogramaCompras() {
  const histRows = db.prepare(`
    SELECT ped.plantilla_id, ped.fecha as fecha_pedido, e.fecha as fecha_entrega
    FROM entregas e
    JOIN pedidos ped ON (e.pedido_id = ped.id OR e.lote = ped.pedido)
    WHERE ped.fecha IS NOT NULL AND e.fecha IS NOT NULL
  `).all();

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
  const empresaCfg = db.prepare('SELECT dias_entrega_defecto FROM empresa_config WHERE id = 1').get();
  const leadTimeDefault = Number(empresaCfg?.dias_entrega_defecto) || 7;
  const leadTimeGlobal = avg(todosDias) ?? leadTimeDefault;

  const invList = getInventarioResumen();
  const invMap = new Map(invList.map(i => [i.id, i]));

  const ordenes = db.prepare(`
    SELECT op.*, pt.nombre as plantilla_nombre
    FROM ordenes_produccion op
    JOIN producto_plantillas pt ON pt.id = op.plantilla_id
    WHERE op.estado IN ('Planificada', 'En Proceso')
    ORDER BY op.fecha_inicio ASC
  `).all();

  const today = new Date().toISOString().slice(0, 10);
  const requerimientos = [];

  for (const op of ordenes) {
    const etapas = db.prepare('SELECT * FROM orden_etapas WHERE orden_id = ? ORDER BY orden_num ASC').all(op.id);
    const etapaById = new Map(etapas.filter(e => e.etapa_id).map(e => [e.etapa_id, e]));
    const etapaByRecetaId = new Map(etapas.filter(e => e.receta_etapa_id).map(e => [e.receta_etapa_id, e]));
    const ordenLineas = db.prepare(`
      SELECT ol.*, p.combinacion_json
      FROM orden_lineas ol
      JOIN productos p ON p.id = ol.producto_id
      WHERE ol.orden_id = ?
    `).all(op.id);
    const recetaId = op.receta_id || getActiveRecetaForPlantilla(op.plantilla_id, ordenLineas.length === 1 ? ordenLineas[0].producto_id : null)?.id;
    const pltLead = avg(diasPorPlantilla.get(op.plantilla_id) || []) ?? leadTimeGlobal;
    const usedPlantillasOrProds = new Set();

    if (recetaId) {
      const lineas = db.prepare(`
        SELECT rl.*, p.plantilla_id as prod_plantilla_id, p.nombre as producto_nombre, pt.tipo as producto_tipo,
               pt.udm, p.precio, p.minimo_compra, p.stock, COALESCE(c.nombre, '') as proveedor_nombre
        FROM receta_lineas rl
        JOIN v_productos p ON p.id = rl.producto_id
        JOIN v_plantillas pt ON pt.id = p.plantilla_id
        LEFT JOIN contactos c ON c.id = pt.proveedor_id
        WHERE rl.receta_id = ? AND pt.tipo != 'servicio'
      `).all(recetaId);

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
  const entregas = db.prepare(`
    SELECT os.id, os.numero, os.fecha, os.estado, os.contacto_id, os.referencia_tipo, os.referencia_id, os.motivo,
           COALESCE(c.nombre, 'Sin cliente') as contacto_nombre
    FROM operaciones_stock os
    LEFT JOIN contactos c ON c.id = os.contacto_id
    WHERE os.tipo = 'entrega' AND os.estado = 'Borrador'
    ORDER BY os.fecha ASC, os.id ASC
  `).all();

  const entLineas = entregas.length > 0
    ? db.prepare(`
        SELECT osl.operacion_id, osl.producto_id, osl.cantidad, osl.udm,
               COALESCE(p.nombre, osl.descripcion, 'Ítem') as producto_nombre, COALESCE(p.sku, '') as sku
        FROM operacion_stock_lineas osl
        LEFT JOIN productos p ON p.id = osl.producto_id
        WHERE osl.operacion_id IN (${entregas.map(() => '?').join(',')})
      `).all(...entregas.map(e => e.id))
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

  const ordenes = db.prepare(`
    SELECT op.id, op.codigo, op.fecha_inicio, op.fecha_objetivo, op.estado,
           COALESCE(pt.nombre, '') as plantilla_nombre
    FROM ordenes_produccion op
    JOIN producto_plantillas pt ON pt.id = op.plantilla_id
    WHERE op.estado IN ('Planificada', 'En Proceso')
    ORDER BY op.fecha_objetivo ASC, op.id DESC
  `).all();

  const ordLineas = ordenes.length > 0
    ? db.prepare(`
        SELECT ol.orden_id, ol.producto_id, ol.cantidad,
               p.nombre as producto_nombre, COALESCE(p.sku, '') as sku
        FROM orden_lineas ol
        JOIN productos p ON p.id = ol.producto_id
        WHERE ol.orden_id IN (${ordenes.map(() => '?').join(',')})
      `).all(...ordenes.map(o => o.id))
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
