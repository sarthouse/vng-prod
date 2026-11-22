import { BaseRepository } from '../../core/BaseRepository.js';
import { convertUnitFromDb } from '../config/configService.js';
import { resolveVariantForPlantilla } from '../produccion/presupuestoService.js';
import { applicableQtyForLine, getActiveRecetaForPlantilla } from '../produccion/recetaService.js';
import {
  movimientoStockRepo,
  isInternalTipo,
  getInventarioResumen,
} from './stockQuantHelper.js';

const ordenRepo = new BaseRepository({ table: 'ordenes_produccion' });
const ordenEtapaRepo = new BaseRepository({ table: 'orden_etapas' });
const ordenLineaRepo = new BaseRepository({ table: 'orden_lineas' });
const recetaLineaRepo = new BaseRepository({ table: 'receta_lineas' });
const operacionStockRepo = new BaseRepository({ table: 'operaciones_stock' });
const compraRepo = new BaseRepository({ table: 'compras' });

function addDaysStockIso(iso, days) {
  if (!iso || typeof iso !== 'string') return new Date().toISOString().slice(0, 10);
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + (Number(days) || 0)));
  return dt.toISOString().slice(0, 10);
}

function buildStockPeriods(granularidad = 'semana', histCount = 4, proyCount = 6, hoyIso = new Date().toISOString().slice(0, 10)) {
  const periods = [];
  const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  if (granularidad === 'mes') {
    const [y, m] = hoyIso.split('-').map(Number);
    const curYm = hoyIso.slice(0, 7);
    for (let i = -histCount; i <= proyCount; i++) {
      const dt = new Date(Date.UTC(y, m - 1 + i, 1));
      const py = dt.getUTCFullYear();
      const pm = dt.getUTCMonth() + 1;
      const key = `${py}-${String(pm).padStart(2, '0')}`;
      const start = `${key}-01`;
      const lastDay = new Date(Date.UTC(py, pm, 0)).getUTCDate();
      const end = `${key}-${String(lastDay).padStart(2, '0')}`;
      periods.push({
        key,
        label: `${monthNames[pm - 1]} ${py}`,
        sublabel: i < 0 ? 'Histórico' : i === 0 ? 'Mes Actual' : 'Proyectado',
        kind: i < 0 ? 'historico' : i === 0 ? 'actual' : 'proyectado',
        start,
        end,
        isCurrent: key === curYm,
      });
    }
    return periods;
  }

  const [y, m, d] = hoyIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const offsetToMonday = (dt.getUTCDay() + 6) % 7;
  const curMonday = new Date(Date.UTC(y, m - 1, d - offsetToMonday));
  const fmt = (x) => `${String(x.getUTCDate()).padStart(2, '0')}/${String(x.getUTCMonth() + 1).padStart(2, '0')}`;

  for (let i = -histCount; i <= proyCount; i++) {
    const mon = new Date(Date.UTC(curMonday.getUTCFullYear(), curMonday.getUTCMonth(), curMonday.getUTCDate() + i * 7));
    const sun = new Date(Date.UTC(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate() + 6));
    const key = mon.toISOString().slice(0, 10);
    periods.push({
      key,
      label: `${fmt(mon)} – ${fmt(sun)}`,
      sublabel: i < 0 ? 'Histórico' : i === 0 ? 'Semana Actual' : `Sem +${i}`,
      kind: i < 0 ? 'historico' : i === 0 ? 'actual' : 'proyectado',
      start: key,
      end: sun.toISOString().slice(0, 10),
      isCurrent: i === 0,
    });
  }
  return periods;
}

export function getFlujoStockMatriz({
  granularidad = 'semana',
  hist_periodos = 4,
  proy_periodos = 6,
  producto_id = null,
  categoria = null,
  rol = null,
} = {}) {
  const histCount = Math.max(1, Math.min(12, Number(hist_periodos) || 4));
  const proyCount = Math.max(1, Math.min(16, Number(proy_periodos) || 6));
  const hoyIso = new Date().toISOString().slice(0, 10);
  const periods = buildStockPeriods(granularidad, histCount, proyCount, hoyIso);
  const firstStart = periods[0].start;
  const lastEnd = periods[periods.length - 1].end;
  const curPeriod = periods.find(p => p.isCurrent) || periods[0];

  const allProds = getInventarioResumen();
  const filteredProds = allProds.filter(p => {
    if (producto_id && Number(p.id) !== Number(producto_id)) return false;
    if (categoria && p.categoria !== categoria) return false;
    if (rol === 'insumos' && Number(p.se_compra) !== 1) return false;
    if (rol === 'fabricados' && Number(p.se_fabrica) !== 1) return false;
    return true;
  });

  const prodIds = new Set(filteredProds.map(p => Number(p.id)));
  const prodMap = new Map(filteredProds.map(p => [Number(p.id), p]));

  const rowDefs = [
    { id: 'stock_inicial', label: 'Stock Inicial', type: 'balance_start' },
    { id: 'entradas_total', label: '(+) Entradas', type: 'group_in', children: ['in_reales', 'in_compras_proy', 'in_produccion_proy'] },
    { id: 'in_reales', label: 'Entradas Confirmadas', type: 'item_in', parent: 'entradas_total' },
    { id: 'in_compras_proy', label: 'Recepciones Pendientes', type: 'item_in', parent: 'entradas_total' },
    { id: 'in_produccion_proy', label: 'Producción Prevista', type: 'item_in', parent: 'entradas_total' },
    { id: 'salidas_total', label: '(-) Salidas', type: 'group_out', children: ['out_reales', 'out_consumo_op_proy', 'out_entregas_proy'] },
    { id: 'out_reales', label: 'Salidas Confirmadas', type: 'item_out', parent: 'salidas_total' },
    { id: 'out_consumo_op_proy', label: 'Consumo de Producción', type: 'item_out', parent: 'salidas_total' },
    { id: 'out_entregas_proy', label: 'Entregas Pendientes', type: 'item_out', parent: 'salidas_total' },
    { id: 'flujo_neto', label: '(=) Variación Neta', type: 'net' },
    { id: 'stock_final', label: '(=) Stock Final', type: 'balance_end' },
  ];

  const values = {};
  const details = {};
  for (const r of rowDefs) {
    values[r.id] = {};
    details[r.id] = {};
    for (const p of periods) {
      values[r.id][p.key] = 0;
      details[r.id][p.key] = [];
    }
  }

  const prodPeriodNet = new Map();
  const prodPeriodDetails = new Map();
  const prodAfterFirstDelta = new Map();

  for (const p of filteredProds) {
    const pNet = {};
    const pDet = {};
    for (const per of periods) {
      pNet[per.key] = 0;
      pDet[per.key] = [];
    }
    prodPeriodNet.set(p.id, pNet);
    prodPeriodDetails.set(p.id, pDet);
    prodAfterFirstDelta.set(p.id, 0);
  }

  const findHistPeriodKey = (fecha) => {
    const f = String(fecha || hoyIso).slice(0, 10);
    const match = periods.find(p => f >= p.start && f <= p.end);
    return match ? match.key : null;
  };

  const findProyPeriodKey = (fecha) => {
    const f = String(fecha || hoyIso).slice(0, 10);
    if (f < hoyIso) return curPeriod.key;
    const match = periods.find(p => f >= p.start && f <= p.end);
    if (match) return match.kind === 'historico' ? curPeriod.key : match.key;
    return null;
  };

  const movs = movimientoStockRepo.query('ms')
    .select('ms.*, p.nombre as producto_nombre, pt.udm, uo.tipo as origen_tipo, ud.tipo as destino_tipo')
    .innerJoin('productos', 'p', 'p.id', 'ms.producto_id')
    .innerJoin('v_plantillas', 'pt', 'pt.id', 'p.plantilla_id')
    .leftJoin('ubicaciones', 'uo', 'uo.id', 'ms.ubicacion_origen_id')
    .leftJoin('ubicaciones', 'ud', 'ud.id', 'ms.ubicacion_destino_id')
    .where('ms.fecha', '>=', firstStart)
    .orderBy('ms.fecha', 'ASC')
    .orderBy('ms.id', 'ASC')
    .all();

  for (const m of movs) {
    const pid = Number(m.producto_id);
    if (!prodIds.has(pid)) continue;
    const oInt = isInternalTipo(m.origen_tipo);
    const dInt = isInternalTipo(m.destino_tipo);
    if (oInt && dInt) continue;

    let signed = Number(m.cantidad || 0);
    if (oInt && !dInt && signed > 0) signed = -signed;
    if (!oInt && dInt && signed < 0) signed = Math.abs(signed);
    if (Math.abs(signed) < 0.0001) continue;

    prodAfterFirstDelta.set(pid, (prodAfterFirstDelta.get(pid) || 0) + signed);

    const pk = findHistPeriodKey(m.fecha);
    if (!pk) continue;

    const pInfo = prodMap.get(pid);
    const itemDetail = {
      fecha: m.fecha,
      origen: `Real (${m.tipo})`,
      contraparte: pInfo?.nombre || m.producto_nombre,
      concepto: m.nota || `Mov. #${m.id} (${pInfo?.udm || m.udm})`,
      monto: Number(signed.toFixed(4)),
    };

    prodPeriodNet.get(pid)[pk] = Number((prodPeriodNet.get(pid)[pk] + signed).toFixed(4));
    prodPeriodDetails.get(pid)[pk].push(itemDetail);

    if (signed > 0) {
      values.in_reales[pk] = Number((values.in_reales[pk] + signed).toFixed(4));
      details.in_reales[pk].push(itemDetail);
    } else {
      const absQ = Math.abs(signed);
      values.out_reales[pk] = Number((values.out_reales[pk] + absQ).toFixed(4));
      details.out_reales[pk].push(itemDetail);
    }
  }

  const opsBorrador = operacionStockRepo.query('os')
    .select("os.id, os.numero, os.fecha, os.tipo, os.referencia_tipo, os.referencia_id, COALESCE(co.nombre, '') as contacto_nombre, osl.producto_id, osl.cantidad")
    .innerJoin('operacion_stock_lineas', 'osl', 'osl.operacion_id', 'os.id')
    .leftJoin('contactos', 'co', 'co.id', 'os.contacto_id')
    .where('os.estado', 'Borrador')
    .whereIn('os.tipo', ['recepcion', 'recepcion_compra', 'entrega', 'entrega_venta'])
    .all();

  const comprasConRecepcionBorrador = new Set();
  for (const op of opsBorrador) {
    if (op.referencia_tipo === 'compra' && op.referencia_id) {
      comprasConRecepcionBorrador.add(Number(op.referencia_id));
    }
    const pid = Number(op.producto_id);
    if (!prodIds.has(pid)) continue;
    const qty = Number(op.cantidad || 0);
    if (qty <= 0) continue;
    const pInfo = prodMap.get(pid);
    const leadDays = (op.tipo === 'recepcion' || op.tipo === 'recepcion_compra') ? Number(pInfo?.lead_time_dias || 0) : 0;
    const estDate = addDaysStockIso(op.fecha || hoyIso, leadDays);
    if (estDate > lastEnd) continue;
    const pk = findProyPeriodKey(estDate);
    if (!pk) continue;

    const isIn = op.tipo === 'recepcion' || op.tipo === 'recepcion_compra';
    const signed = isIn ? qty : -qty;
    const itemDetail = {
      fecha: estDate,
      vencido: estDate < hoyIso,
      origen: isIn ? 'Recepción Pendiente' : 'Entrega Pendiente',
      contraparte: pInfo?.nombre || '-',
      concepto: `${op.numero || '#' + op.id}${op.contacto_nombre ? ' · ' + op.contacto_nombre : ''}`,
      monto: Number(signed.toFixed(4)),
    };

    prodPeriodNet.get(pid)[pk] = Number((prodPeriodNet.get(pid)[pk] + signed).toFixed(4));
    prodPeriodDetails.get(pid)[pk].push(itemDetail);

    if (isIn) {
      values.in_compras_proy[pk] = Number((values.in_compras_proy[pk] + qty).toFixed(4));
      details.in_compras_proy[pk].push(itemDetail);
    } else {
      values.out_entregas_proy[pk] = Number((values.out_entregas_proy[pk] + qty).toFixed(4));
      details.out_entregas_proy[pk].push(itemDetail);
    }
  }

  const comprasBorrador = compraRepo.query('c')
    .select("c.id, c.numero, c.fecha, COALESCE(co.nombre, '') as proveedor_nombre, cl.producto_id, cl.cantidad")
    .innerJoin('compra_lineas', 'cl', 'cl.compra_id', 'c.id')
    .leftJoin('contactos', 'co', 'co.id', 'c.contacto_id')
    .where('c.estado', 'Borrador')
    .whereNotNull('cl.producto_id')
    .all();

  for (const cb of comprasBorrador) {
    if (comprasConRecepcionBorrador.has(Number(cb.id))) continue;
    const pid = Number(cb.producto_id);
    if (!prodIds.has(pid)) continue;
    const qty = Number(cb.cantidad || 0);
    if (qty <= 0) continue;
    const pInfo = prodMap.get(pid);
    const estDate = addDaysStockIso(cb.fecha || hoyIso, Number(pInfo?.lead_time_dias || 0));
    if (estDate > lastEnd) continue;
    const pk = findProyPeriodKey(estDate);
    if (!pk) continue;

    const itemDetail = {
      fecha: estDate,
      vencido: estDate < hoyIso,
      origen: 'OC Borrador',
      contraparte: pInfo?.nombre || '-',
      concepto: `Compra ${cb.numero || '#' + cb.id}${cb.proveedor_nombre ? ' · ' + cb.proveedor_nombre : ''}`,
      monto: Number(qty.toFixed(4)),
    };
    prodPeriodNet.get(pid)[pk] = Number((prodPeriodNet.get(pid)[pk] + qty).toFixed(4));
    prodPeriodDetails.get(pid)[pk].push(itemDetail);
    values.in_compras_proy[pk] = Number((values.in_compras_proy[pk] + qty).toFixed(4));
    details.in_compras_proy[pk].push(itemDetail);
  }

  const ordenesActivas = ordenRepo.query('op')
    .select('op.*')
    .whereIn('op.estado', ['Planificada', 'En Proceso'])
    .all();

  for (const op of ordenesActivas) {
    const rawOpLineas = ordenLineaRepo.query('ol')
      .select('ol.*, p.nombre as producto_nombre, p.combinacion_json')
      .innerJoin('productos', 'p', 'p.id', 'ol.producto_id')
      .where('ol.orden_id', op.id)
      .all();
    const ingresosOp = movimientoStockRepo.query('ms')
      .select('ms.producto_id, ms.cantidad')
      .where('ms.referencia_tipo', 'orden_produccion')
      .where('ms.referencia_id', op.id)
      .where('ms.tipo', 'ingreso_produccion')
      .all();
    const ingresadaMap = new Map();
    for (const ing of ingresosOp) {
      ingresadaMap.set(Number(ing.producto_id), (ingresadaMap.get(Number(ing.producto_id)) || 0) + Number(ing.cantidad || 0));
    }
    const opLineas = rawOpLineas.map(ol => ({
      ...ol,
      ingresada: ingresadaMap.get(Number(ol.producto_id)) || 0,
    }));

    const fechaObj = op.fecha_objetivo || addDaysStockIso(op.fecha_inicio || hoyIso, 7);
    if (fechaObj <= lastEnd) {
      const pkObj = findProyPeriodKey(fechaObj);
      if (pkObj) {
        for (const ol of opLineas) {
          const pid = Number(ol.producto_id);
          if (!prodIds.has(pid)) continue;
          const pend = Number(Math.max(0, Number(ol.cantidad || 0) - Number(ol.ingresada || 0)).toFixed(4));
          if (pend <= 0) continue;
          const pInfo = prodMap.get(pid);
          const itemDetail = {
            fecha: fechaObj,
            vencido: fechaObj < hoyIso,
            origen: 'Fin OP Previsto',
            contraparte: pInfo?.nombre || ol.producto_nombre,
            concepto: `Orden ${op.codigo} (${op.estado})`,
            monto: pend,
          };
          prodPeriodNet.get(pid)[pkObj] = Number((prodPeriodNet.get(pid)[pkObj] + pend).toFixed(4));
          prodPeriodDetails.get(pid)[pkObj].push(itemDetail);
          values.in_produccion_proy[pkObj] = Number((values.in_produccion_proy[pkObj] + pend).toFixed(4));
          details.in_produccion_proy[pkObj].push(itemDetail);
        }
      }
    }

    const etapasPend = ordenEtapaRepo.query()
      .where('orden_id', op.id)
      .where('stock_consumido', 0)
      .orderBy('orden_num', 'ASC')
      .orderBy('id', 'ASC')
      .all();
    if (!etapasPend.length) continue;

    const recetaId = op.receta_id || getActiveRecetaForPlantilla(op.plantilla_id)?.id;
    if (!recetaId) continue;

    const rLineas = recetaLineaRepo.query('rl')
      .select('rl.*, p.plantilla_id as prod_plantilla_id, pt.udm')
      .innerJoin('productos', 'p', 'p.id', 'rl.producto_id')
      .innerJoin('v_plantillas', 'pt', 'pt.id', 'p.plantilla_id')
      .where('rl.receta_id', recetaId)
      .where('pt.tipo', '!=', 'servicio')
      .all();

    for (const l of rLineas) {
      let targetEtapa = null;
      if (l.receta_etapa_id) {
        targetEtapa = etapasPend.find(e => Number(e.receta_etapa_id) === Number(l.receta_etapa_id));
        if (!targetEtapa) continue;
      } else if (l.etapa_id) {
        targetEtapa = etapasPend.find(e => Number(e.etapa_id) === Number(l.etapa_id));
        if (!targetEtapa) continue;
      } else {
        targetEtapa = etapasPend[0];
      }

      const fechaConsumo = targetEtapa?.fecha_inicio_est || op.fecha_inicio || hoyIso;
      if (fechaConsumo > lastEnd) continue;
      const pkCons = findProyPeriodKey(fechaConsumo);
      if (!pkCons) continue;

      let vars = [];
      try { vars = JSON.parse(l.variantes_json || '[]'); } catch { vars = []; }
      const conv = convertUnitFromDb(l.coeficiente, l.udm_receta || l.udm, l.udm);

      if (Number(l.emparejar_variante) === 1 && l.prod_plantilla_id) {
        for (const ol of opLineas) {
          const pares = applicableQtyForLine(ol, ol.cantidad, vars);
          if (pares <= 0) continue;
          let combo = {};
          try { combo = JSON.parse(ol.combinacion_json || '{}'); } catch { combo = {}; }
          const matched = resolveVariantForPlantilla(l.prod_plantilla_id, combo);
          const insId = Number(matched ? matched.id : l.producto_id);
          if (!prodIds.has(insId)) continue;
          const reqQty = Number((conv * pares).toFixed(4));
          if (reqQty <= 0) continue;
          const pInfo = prodMap.get(insId);
          const itemDetail = {
            fecha: fechaConsumo,
            vencido: fechaConsumo < hoyIso,
            origen: `Consumo OP (${targetEtapa?.nombre || 'Etapa'})`,
            contraparte: pInfo?.nombre || '-',
            concepto: `Orden ${op.codigo}`,
            monto: -reqQty,
          };
          prodPeriodNet.get(insId)[pkCons] = Number((prodPeriodNet.get(insId)[pkCons] - reqQty).toFixed(4));
          prodPeriodDetails.get(insId)[pkCons].push(itemDetail);
          values.out_consumo_op_proy[pkCons] = Number((values.out_consumo_op_proy[pkCons] + reqQty).toFixed(4));
          details.out_consumo_op_proy[pkCons].push(itemDetail);
        }
      } else {
        const insId = Number(l.producto_id);
        if (!prodIds.has(insId)) continue;
        let pares = 0;
        for (const ol of opLineas) pares += applicableQtyForLine(ol, ol.cantidad, vars);
        if (pares <= 0) continue;
        const reqQty = Number((conv * pares).toFixed(4));
        if (reqQty <= 0) continue;
        const pInfo = prodMap.get(insId);
        const itemDetail = {
          fecha: fechaConsumo,
          vencido: fechaConsumo < hoyIso,
          origen: `Consumo OP (${targetEtapa?.nombre || 'Etapa'})`,
          contraparte: pInfo?.nombre || '-',
          concepto: `Orden ${op.codigo}`,
          monto: -reqQty,
        };
        prodPeriodNet.get(insId)[pkCons] = Number((prodPeriodNet.get(insId)[pkCons] - reqQty).toFixed(4));
        prodPeriodDetails.get(insId)[pkCons].push(itemDetail);
        values.out_consumo_op_proy[pkCons] = Number((values.out_consumo_op_proy[pkCons] + reqQty).toFixed(4));
        details.out_consumo_op_proy[pkCons].push(itemDetail);
      }
    }
  }

  const stockActualTotal = Number(filteredProds.reduce((s, p) => s + Number(p.stock || 0), 0).toFixed(4));
  const deltaTotalDesdeInicio = Number(Array.from(prodAfterFirstDelta.values()).reduce((s, v) => s + v, 0).toFixed(4));
  let runningStock = Number((stockActualTotal - deltaTotalDesdeInicio).toFixed(4));

  const totals = {};
  for (const r of rowDefs) totals[r.id] = 0;
  totals.stock_inicial = runningStock;

  for (const p of periods) {
    const pk = p.key;
    values.stock_inicial[pk] = Number(runningStock.toFixed(4));

    const inTotal = Number((
      values.in_reales[pk] +
      values.in_compras_proy[pk] +
      values.in_produccion_proy[pk]
    ).toFixed(4));
    values.entradas_total[pk] = inTotal;
    details.entradas_total[pk] = [
      ...details.in_reales[pk],
      ...details.in_compras_proy[pk],
      ...details.in_produccion_proy[pk],
    ];

    const outTotal = Number((
      values.out_reales[pk] +
      values.out_consumo_op_proy[pk] +
      values.out_entregas_proy[pk]
    ).toFixed(4));
    values.salidas_total[pk] = outTotal;
    details.salidas_total[pk] = [
      ...details.out_reales[pk],
      ...details.out_consumo_op_proy[pk],
      ...details.out_entregas_proy[pk],
    ];

    const neto = Number((inTotal - outTotal).toFixed(4));
    values.flujo_neto[pk] = neto;
    details.flujo_neto[pk] = [...details.entradas_total[pk], ...details.salidas_total[pk]];

    runningStock = Number((runningStock + neto).toFixed(4));
    values.stock_final[pk] = runningStock;
  }

  for (const r of rowDefs) {
    if (r.id === 'stock_inicial') continue;
    if (r.id === 'stock_final') {
      totals[r.id] = runningStock;
      continue;
    }
    totals[r.id] = Number(periods.reduce((s, p) => s + (Number(values[r.id][p.key]) || 0), 0).toFixed(4));
  }

  const productRows = [];
  let quiebresProyectados = 0;

  for (const prod of filteredProds) {
    const pid = Number(prod.id);
    const pOpen = Number((Number(prod.stock || 0) - (prodAfterFirstDelta.get(pid) || 0)).toFixed(4));
    let pRun = pOpen;
    const pValues = {};
    const pNetByPer = prodPeriodNet.get(pid);
    const pDetByPer = prodPeriodDetails.get(pid);
    let minProjected = pRun;

    for (const per of periods) {
      pRun = Number((pRun + (pNetByPer[per.key] || 0)).toFixed(4));
      pValues[per.key] = pRun;
      if (per.kind !== 'historico' && pRun < minProjected) {
        minProjected = pRun;
      }
    }
    const minReq = Number(prod.stock_minimo || 0);
    const tieneQuiebre = minProjected < 0 || (minReq > 0 && minProjected <= minReq);
    if (tieneQuiebre) quiebresProyectados++;

    productRows.push({
      id: `prod_${pid}`,
      producto_id: pid,
      label: `${prod.nombre} (${prod.udm || 'un.'})`,
      categoria: prod.categoria,
      udm: prod.udm || 'unidades',
      stock_actual: Number(prod.stock || 0),
      stock_minimo: minReq,
      tiene_quiebre: tieneQuiebre,
      type: tieneQuiebre ? 'net' : 'neutral',
      values: pValues,
      details: pDetByPer,
      total: pRun,
    });
  }

  const stockMinimoRef = Number(filteredProds.reduce((s, p) => s + Number(p.stock_minimo || 0), 0).toFixed(4));

  const chartSeries = periods.map(p => ({
    key: p.key,
    label: p.label,
    sublabel: p.sublabel,
    kind: p.kind,
    isCurrent: p.isCurrent,
    entradas: values.entradas_total[p.key],
    salidas: values.salidas_total[p.key],
    neto: values.flujo_neto[p.key],
    saldo: values.stock_final[p.key],
    minimo: stockMinimoRef,
  }));

  return {
    granularidad,
    hoy: hoyIso,
    producto_seleccionado: producto_id ? (prodMap.get(Number(producto_id)) || null) : null,
    resumen: {
      productos_analizados: filteredProds.length,
      stock_apertura: totals.stock_inicial,
      stock_actual: stockActualTotal,
      entradas_proyectadas: Number(periods.filter(p => p.kind !== 'historico').reduce((s, p) => s + values.in_compras_proy[p.key] + values.in_produccion_proy[p.key], 0).toFixed(4)),
      salidas_proyectadas: Number(periods.filter(p => p.kind !== 'historico').reduce((s, p) => s + values.out_consumo_op_proy[p.key] + values.out_entregas_proy[p.key], 0).toFixed(4)),
      stock_final_proyectado: runningStock,
      stock_minimo_ref: stockMinimoRef,
      quiebres_proyectados: quiebresProyectados,
    },
    periods,
    rows: rowDefs.map(r => ({
      ...r,
      values: values[r.id],
      details: details[r.id],
      total: totals[r.id],
    })),
    product_rows: productRows,
    chart_series: chartSeries,
  };
}
