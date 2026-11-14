import { db } from '../../db.js';
import { BaseRepository } from '../../core/BaseRepository.js';
import { convertUnitFromDb } from '../config/configService.js';
import { listProductosFabricablesConCurva } from './curvaService.js';
import { resolveVariantForPlantilla } from './presupuestoService.js';
import { applicableQtyForLine, getActiveRecetaForPlantilla } from './recetaService.js';

class PedidoRepository extends BaseRepository {
  constructor() {
    super({
      table: 'pedidos',
      defaultOrder: 'pedido DESC',
      columns: ['pedido', 'fecha', 'fecha_est', 'estado', 'contacto_id', 'plantilla_id', 'receta_id', 'compl', 'r_num', 'observaciones', 'armado'],
    });
  }
}

class EntregaRepository extends BaseRepository {
  constructor() {
    super({
      table: 'entregas',
      defaultOrder: 'nro_entrega DESC, id DESC',
      columns: ['nro_entrega', 'fecha', 'lote', 'pedido_id', 'observaciones'],
    });
  }
}

export const pedidoRepo = new PedidoRepository();
export const entregaRepo = new EntregaRepository();

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
  const diff = Math.round((b.getTime() - a.getTime()) / 86400000);
  return diff >= 0 ? diff : null;
}

function sanitizeLineas(lineas) {
  return (Array.isArray(lineas) ? lineas : [])
    .map(l => ({
      producto_id: Number(l.producto_id),
      cantidad: Math.max(0, Number(l.cantidad) || 0),
    }))
    .filter(l => l.producto_id > 0 && l.cantidad > 0);
}

export function snapshotInsumosForPedido(pedidoId, plantillaId, lineas, explicitRecetaId = null) {
  db.prepare('DELETE FROM pedido_insumos WHERE pedido_id = ?').run(pedidoId);
  const plantillaRow = plantillaId
    ? db.prepare('SELECT * FROM producto_plantillas WHERE id = ?').get(Number(plantillaId))
    : null;

  let recetaId = explicitRecetaId ? Number(explicitRecetaId) : null;
  if (!recetaId && plantillaRow) {
    recetaId = getActiveRecetaForPlantilla(plantillaRow.id)?.id || null;
  }

  const prodIds = lineas.map(l => l.producto_id);
  const prodRows = prodIds.length
    ? db.prepare(`SELECT * FROM productos WHERE id IN (${prodIds.map(() => '?').join(',')})`).all(...prodIds)
    : [];
  const prodMap = new Map(prodRows.map(p => [p.id, p]));

  const agg = new Map();
  const usedPlantillasOrProds = new Set();

  if (recetaId) {
    const rLineas = db.prepare(`
      SELECT p.id as producto_id, p.plantilla_id, p.nombre, pt.tipo, pt.categoria, pt.udm,
             p.precio, p.minimo_compra, COALESCE(c.nombre, '') as proveedor_nombre,
             rl.coeficiente, rl.udm_receta, rl.variantes_json
      FROM receta_lineas rl
      JOIN productos p ON p.id = rl.producto_id
      JOIN v_plantillas pt ON pt.id = p.plantilla_id
      LEFT JOIN contactos c ON c.id = pt.proveedor_id
      WHERE rl.receta_id = ? AND rl.coeficiente > 0
      ORDER BY pt.categoria ASC, p.nombre ASC
    `).all(recetaId);

    for (const r of rLineas) {
      usedPlantillasOrProds.add(r.producto_id);
      usedPlantillasOrProds.add(`plt:${r.plantilla_id}`);
      let vars = [];
      try { vars = JSON.parse(r.variantes_json || '[]'); } catch { vars = []; }

      let paresAplicables = 0;
      for (const l of lineas) {
        const pRow = prodMap.get(l.producto_id);
        if (!pRow) continue;
        paresAplicables += applicableQtyForLine(pRow, l.cantidad, vars);
      }
      if (paresAplicables <= 0) continue;

      const coefConv = convertUnitFromDb(r.coeficiente, r.udm_receta || r.udm, r.udm);
      const cantReq = paresAplicables * coefConv;
      if (!agg.has(r.producto_id)) {
        agg.set(r.producto_id, {
          producto_id: r.producto_id,
          nombre: r.nombre,
          tipo: r.tipo || 'almacenable',
          categoria: r.categoria,
          proveedor_nombre: r.proveedor_nombre,
          udm: r.udm,
          precio: r.precio,
          minimo_compra: r.tipo === 'servicio' ? 0 : Number(r.minimo_compra || 0),
          cantReq: 0,
        });
      }
      agg.get(r.producto_id).cantReq += cantReq;
    }
  }

  const totalParesPedido = lineas.reduce((s, l) => s + l.cantidad, 0) || 1;



  const insert = db.prepare(`
    INSERT INTO pedido_insumos (
      pedido_id, producto_id, nombre, tipo, categoria, proveedor_nombre, udm, precio_unitario, minimo_compra,
      coeficiente, cantidad_requerida, cantidad_a_comprar, subtotal, comprado
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `);

  for (const item of agg.values()) {
    const cantReq = Number(item.cantReq.toFixed(4));
    const min = item.minimo_compra;
    const cantComprar = (cantReq > 0 && min > 0) ? Math.max(cantReq, min) : cantReq;
    const subtotal = Number((cantComprar * item.precio).toFixed(2));
    insert.run(
      pedidoId, item.producto_id, item.nombre, item.tipo, item.categoria,
      item.proveedor_nombre, item.udm, item.precio, min,
      Number((cantReq / totalParesPedido).toFixed(6)),
      cantReq, Number(cantComprar.toFixed(4)), subtotal
    );
  }
}

export function listPedidos() {
  const rows = db.prepare(`
    SELECT ped.*,
           COALESCE(pt.nombre, '') as plantilla_nombre,
           COALESCE(c.nombre, '') as contacto_nombre,
           COALESCE((SELECT SUM(pl.cantidad) FROM pedido_lineas pl WHERE pl.pedido_id = ped.id), 0) as cantidad
    FROM pedidos ped
    LEFT JOIN producto_plantillas pt ON pt.id = ped.plantilla_id
    LEFT JOIN contactos c ON c.id = ped.contacto_id
    ORDER BY ped.pedido DESC
  `).all();
  return rows.map(p => ({
    ...p,
    dias: diffDaysISO(p.fecha, p.compl),
  }));
}

export function getPedidoDetalle(id) {
  const pedido = db.prepare(`
    SELECT ped.*,
           COALESCE(pt.nombre, '') as plantilla_nombre,
           COALESCE(c.nombre, '') as contacto_nombre
    FROM pedidos ped
    LEFT JOIN producto_plantillas pt ON pt.id = ped.plantilla_id
    LEFT JOIN contactos c ON c.id = ped.contacto_id
    WHERE ped.id = ?
  `).get(id);
  if (!pedido) return null;

  const lineas = db.prepare(`
    SELECT pl.*, p.nombre as producto_nombre, p.sku, pt.udm
    FROM pedido_lineas pl
    JOIN productos p ON p.id = pl.producto_id
    JOIN v_plantillas pt ON pt.id = p.plantilla_id
    WHERE pl.pedido_id = ?
    ORDER BY pl.id ASC
  `).all(id);
  pedido.cantidad = lineas.reduce((s, l) => s + Number(l.cantidad || 0), 0);
  pedido.dias = diffDaysISO(pedido.fecha, pedido.compl);

  const snapshot = db.prepare(
    'SELECT * FROM pedido_insumos WHERE pedido_id = ? ORDER BY categoria ASC, nombre ASC'
  ).all(id);
  const entregas = db.prepare(`
    SELECT e.*, COALESCE((SELECT SUM(el.cantidad) FROM entrega_lineas el WHERE el.entrega_id = e.id), 0) as total
    FROM entregas e WHERE e.lote = ? ORDER BY e.nro_entrega DESC
  `).all(pedido.pedido);
  const pendiente = computePendientes().find(x => x.id === Number(id)) || null;

  return { pedido, lineas, snapshot, entregas, pendiente };
}

export function createPedido(b) {
  const nextPedido = b.pedido ? Number(b.pedido) : ((db.prepare('SELECT MAX(pedido) as m FROM pedidos').get().m || 0) + 1);
  const fecha = b.fecha || new Date().toISOString().slice(0, 10);
  const fechaEst = b.fecha_est || addDaysISO(fecha, 40);
  const plantillaId = b.plantilla_id ? Number(b.plantilla_id) : null;
  const lineas = sanitizeLineas(b.lineas);

  return pedidoRepo.transaction(() => {
    const pedidoId = pedidoRepo.create({
      pedido: nextPedido,
      fecha,
      fecha_est: fechaEst,
      estado: b.estado || 'Confirmado',
      contacto_id: b.contacto_id ? Number(b.contacto_id) : null,
      plantilla_id: plantillaId,
      receta_id: b.receta_id ? Number(b.receta_id) : null,
      compl: b.compl || null,
      r_num: b.r_num ? Number(b.r_num) : null,
      observaciones: b.observaciones || '',
      armado: b.armado || '',
    });

    const insLin = db.prepare('INSERT INTO pedido_lineas (pedido_id, producto_id, cantidad) VALUES (?, ?, ?)');
    for (const l of lineas) insLin.run(pedidoId, l.producto_id, l.cantidad);

    snapshotInsumosForPedido(pedidoId, plantillaId, lineas, b.receta_id);
    return { id: pedidoId, pedido: nextPedido };
  });
}

export function createPedidosFromCurva({ presupuesto_id, fecha, fecha_est, observaciones } = {}) {
  const f = fecha || new Date().toISOString().slice(0, 10);
  const fEst = fecha_est || addDaysISO(f, 40);
  const curvaRows = listProductosFabricablesConCurva(presupuesto_id).filter(r => r.cantidad > 0);
  if (curvaRows.length === 0) {
    throw new Error('La curva está vacía. Ingresá cantidades antes de generar pedidos.');
  }

  const byPlantilla = new Map();
  for (const r of curvaRows) {
    if (!byPlantilla.has(r.plantilla_id)) {
      byPlantilla.set(r.plantilla_id, { plantilla_id: r.plantilla_id, plantilla_nombre: r.plantilla_nombre, lineas: [] });
    }
    byPlantilla.get(r.plantilla_id).lineas.push({ producto_id: r.producto_id, cantidad: r.cantidad });
  }

  let nextPedido = (db.prepare('SELECT MAX(pedido) as m FROM pedidos').get().m || 0) + 1;
  const created = [];

  return pedidoRepo.transaction(() => {
    const insLin = db.prepare('INSERT INTO pedido_lineas (pedido_id, producto_id, cantidad) VALUES (?, ?, ?)');
    for (const grp of byPlantilla.values()) {
      const pedidoId = pedidoRepo.create({
        pedido: nextPedido,
        fecha: f,
        fecha_est: fEst,
        estado: 'Confirmado',
        plantilla_id: grp.plantilla_id,
        observaciones: observaciones || 'Generado desde Curva',
      });
      for (const l of grp.lineas) insLin.run(pedidoId, l.producto_id, l.cantidad);
      snapshotInsumosForPedido(pedidoId, grp.plantilla_id, grp.lineas);
      const cant = grp.lineas.reduce((s, l) => s + l.cantidad, 0);
      created.push({ id: pedidoId, pedido: nextPedido, plantilla_nombre: grp.plantilla_nombre, cantidad: cant });
      nextPedido++;
    }
    return created;
  });
}

export function updatePedido(id, b) {
  const existing = pedidoRepo.findById(id);
  if (!existing) return false;
  return pedidoRepo.transaction(() => {
    pedidoRepo.update(id, {
      pedido: b.pedido !== undefined ? Number(b.pedido) : existing.pedido,
      fecha: b.fecha !== undefined ? b.fecha : existing.fecha,
      fecha_est: b.fecha_est !== undefined ? b.fecha_est : existing.fecha_est,
      estado: b.estado ?? existing.estado,
      contacto_id: b.contacto_id !== undefined ? (b.contacto_id ? Number(b.contacto_id) : null) : existing.contacto_id,
      plantilla_id: b.plantilla_id !== undefined ? (b.plantilla_id ? Number(b.plantilla_id) : null) : existing.plantilla_id,
      compl: b.compl !== undefined ? b.compl : existing.compl,
      r_num: b.r_num !== undefined ? (b.r_num ? Number(b.r_num) : null) : existing.r_num,
      observaciones: b.observaciones ?? existing.observaciones,
      armado: b.armado ?? existing.armado,
    });
    if (Array.isArray(b.lineas)) {
      const lineas = sanitizeLineas(b.lineas);
      db.prepare('DELETE FROM pedido_lineas WHERE pedido_id = ?').run(id);
      const insLin = db.prepare('INSERT INTO pedido_lineas (pedido_id, producto_id, cantidad) VALUES (?, ?, ?)');
      for (const l of lineas) insLin.run(id, l.producto_id, l.cantidad);
    }
    return true;
  });
}

export function deletePedido(id) {
  return pedidoRepo.delete(id);
}

export function toggleSnapshotComprado(snapId, comprado) {
  db.prepare('UPDATE pedido_insumos SET comprado = ? WHERE id = ?').run(comprado ? 1 : 0, snapId);
}

export function listEntregas() {
  return db.prepare(`
    SELECT e.*,
           COALESCE(pt.nombre, '') as plantilla_nombre,
           COALESCE((SELECT SUM(el.cantidad) FROM entrega_lineas el WHERE el.entrega_id = e.id), 0) as total
    FROM entregas e
    LEFT JOIN pedidos ped ON ped.id = e.pedido_id
    LEFT JOIN producto_plantillas pt ON pt.id = ped.plantilla_id
    ORDER BY e.nro_entrega DESC, e.id DESC
  `).all();
}

export function getEntregaById(id) {
  const row = entregaRepo.findById(id);
  if (!row) return null;
  const lineas = db.prepare(`
    SELECT el.*, p.nombre as producto_nombre, p.sku
    FROM entrega_lineas el
    JOIN productos p ON p.id = el.producto_id
    WHERE el.entrega_id = ?
    ORDER BY el.id ASC
  `).all(id);
  return { ...row, lineas, total: lineas.reduce((s, l) => s + Number(l.cantidad || 0), 0) };
}

export function createEntrega(b) {
  const nextNro = b.nro_entrega ? Number(b.nro_entrega) : ((db.prepare('SELECT MAX(nro_entrega) as m FROM entregas').get().m || 0) + 1);
  const fecha = b.fecha || new Date().toISOString().slice(0, 10);
  const lote = Number(b.lote);
  const pedidoRow = db.prepare('SELECT * FROM pedidos WHERE pedido = ?').get(lote);
  const lineas = sanitizeLineas(b.lineas);

  const id = entregaRepo.transaction(() => {
    const entId = entregaRepo.create({
      nro_entrega: nextNro,
      fecha,
      lote,
      pedido_id: pedidoRow ? pedidoRow.id : null,
      observaciones: b.observaciones || '',
    });
    const insLin = db.prepare('INSERT INTO entrega_lineas (entrega_id, producto_id, cantidad) VALUES (?, ?, ?)');
    for (const l of lineas) insLin.run(entId, l.producto_id, l.cantidad);
    return entId;
  });

  syncPedidoEstadoByLote(lote, fecha);
  return { id, nro_entrega: nextNro };
}

export function updateEntrega(id, b) {
  const existing = entregaRepo.findById(id);
  if (!existing) return false;
  const lote = b.lote !== undefined ? Number(b.lote) : existing.lote;
  const fecha = b.fecha !== undefined ? b.fecha : existing.fecha;
  const pedidoRow = db.prepare('SELECT id FROM pedidos WHERE pedido = ?').get(lote);

  entregaRepo.transaction(() => {
    entregaRepo.update(id, {
      nro_entrega: b.nro_entrega !== undefined ? Number(b.nro_entrega) : existing.nro_entrega,
      fecha,
      lote,
      pedido_id: pedidoRow ? pedidoRow.id : existing.pedido_id,
      observaciones: b.observaciones ?? existing.observaciones,
    });
    if (Array.isArray(b.lineas)) {
      const lineas = sanitizeLineas(b.lineas);
      db.prepare('DELETE FROM entrega_lineas WHERE entrega_id = ?').run(id);
      const insLin = db.prepare('INSERT INTO entrega_lineas (entrega_id, producto_id, cantidad) VALUES (?, ?, ?)');
      for (const l of lineas) insLin.run(id, l.producto_id, l.cantidad);
    }
  });

  syncPedidoEstadoByLote(existing.lote, fecha);
  if (lote !== existing.lote) syncPedidoEstadoByLote(lote, fecha);
  return true;
}

export function deleteEntrega(id) {
  const existing = entregaRepo.findById(id);
  entregaRepo.delete(id);
  if (existing) syncPedidoEstadoByLote(existing.lote);
}

export function computePendientes() {
  const pedidos = db.prepare(`
    SELECT ped.*, COALESCE(pt.nombre, '') as plantilla_nombre
    FROM pedidos ped
    LEFT JOIN producto_plantillas pt ON pt.id = ped.plantilla_id
    ORDER BY ped.pedido DESC
  `).all();

  const pedLineas = db.prepare(`
    SELECT pl.*, p.nombre as producto_nombre, p.sku
    FROM pedido_lineas pl
    JOIN productos p ON p.id = pl.producto_id
  `).all();

  const entLineas = db.prepare(`
    SELECT e.lote, el.producto_id, SUM(el.cantidad) as cantidad
    FROM entrega_lineas el
    JOIN entregas e ON e.id = el.entrega_id
    GROUP BY e.lote, el.producto_id
  `).all();

  const entByLoteProd = new Map();
  for (const el of entLineas) {
    entByLoteProd.set(`${el.lote}:${el.producto_id}`, Number(el.cantidad || 0));
  }

  const linesByPed = new Map();
  for (const pl of pedLineas) {
    if (!linesByPed.has(pl.pedido_id)) linesByPed.set(pl.pedido_id, []);
    linesByPed.get(pl.pedido_id).push(pl);
  }

  return pedidos.map(p => {
    const pLines = linesByPed.get(p.id) || [];
    let totalPed = 0;
    let totalEnt = 0;
    const detalle = pLines.map(pl => {
      const pedCant = Number(pl.cantidad || 0);
      const entCant = entByLoteProd.get(`${p.pedido}:${pl.producto_id}`) || 0;
      totalPed += pedCant;
      totalEnt += entCant;
      return {
        producto_id: pl.producto_id,
        producto_nombre: pl.producto_nombre,
        sku: pl.sku,
        pedido: pedCant,
        entregado: entCant,
        pendiente: Number((pedCant - entCant).toFixed(4)),
      };
    });
    return {
      id: p.id,
      lote: p.pedido,
      plantilla_id: p.plantilla_id,
      plantilla_nombre: p.plantilla_nombre,
      estado: p.estado,
      fecha: p.fecha,
      fecha_est: p.fecha_est,
      lineas: detalle,
      pedido_total: totalPed,
      entregado_total: totalEnt,
      total: Number((totalPed - totalEnt).toFixed(4)),
    };
  });
}

function syncPedidoEstadoByLote(lote, fallbackFecha) {
  const pedidoRow = db.prepare('SELECT * FROM pedidos WHERE pedido = ?').get(lote);
  if (!pedidoRow) return;
  const pend = computePendientes().find(p => p.lote === lote);
  if (!pend) return;

  if (pend.total <= 0 && pend.pedido_total > 0) {
    db.prepare("UPDATE pedidos SET estado = 'Entregado', compl = COALESCE(compl, ?) WHERE pedido = ?").run(fallbackFecha || new Date().toISOString().slice(0, 10), lote);
  } else if (pend.entregado_total > 0) {
    db.prepare("UPDATE pedidos SET estado = 'Entrega Parcial' WHERE pedido = ? AND estado != 'Cancelado'").run(lote);
  } else if (pend.entregado_total === 0 && pedidoRow.estado === 'Entrega Parcial') {
    db.prepare("UPDATE pedidos SET estado = 'Confirmado' WHERE pedido = ?").run(lote);
  }
}
