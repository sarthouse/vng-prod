import { db } from '../../db.js';
import { BaseRepository } from '../../core/BaseRepository.js';
import { MODELS } from '../../db/models.js';

export const secuenciaRepo = new BaseRepository({ model: MODELS.secuencias });

export function getEmpresaConfig() {
  const row = db.prepare('SELECT * FROM empresa_config WHERE id = 1').get();
  if (!row) {
    return {
      id: 1,
      alicuota_iva_defecto: 21,
      alicuota_iva_compras_defecto: 21,
      alicuota_iva_ventas_defecto: 21,
      dias_entrega_defecto: 7,
    };
  }
  const { afip_private_key, afip_ta_wsfe, afip_ta_padron, afip_ta_wscdc, ...safe } = row;
  return { ...safe, afip_has_key: Boolean(afip_private_key) };
}

export function updateEmpresaConfig(b) {
  const cur = getEmpresaConfig();
  const proxInt = (val, fallback) => Math.max(1, parseInt(val ?? fallback ?? 1, 10) || 1);
  const ivaCompras = b.alicuota_iva_compras_defecto !== undefined ? Number(b.alicuota_iva_compras_defecto) : (cur.alicuota_iva_compras_defecto ?? cur.alicuota_iva_defecto ?? 21);
  const ivaVentas = b.alicuota_iva_ventas_defecto !== undefined ? Number(b.alicuota_iva_ventas_defecto) : (cur.alicuota_iva_ventas_defecto ?? cur.alicuota_iva_defecto ?? 21);
  const ivaGeneral = b.alicuota_iva_defecto !== undefined ? Number(b.alicuota_iva_defecto) : ivaVentas;
  db.prepare(`
    UPDATE empresa_config SET
      razon_social=?, nombre_fantasia=?, cuit=?, condicion_iva=?, direccion=?, localidad=?, provincia=?, codigo_postal=?, pais=?, telefono=?, email=?,
      iibb=?, inicio_actividades=?, alicuota_iva_defecto=?, alicuota_iva_compras_defecto=?, alicuota_iva_ventas_defecto=?,
      prefijo_compra=?, prefijo_remito=?, prefijo_pago=?, prefijo_venta=?, prefijo_cobro=?,
      prox_num_compra=?, prox_num_remito=?, prox_num_pago=?, prox_num_venta=?, prox_num_cobro=?,
      logo_data=?, dias_entrega_defecto=?,
      print_formato=?, print_copias=?, print_mostrar_logo=?, print_modo_economico=?, print_pie_comprobante=?
    WHERE id = 1
  `).run(
    b.razon_social ?? cur.razon_social ?? '',
    b.nombre_fantasia ?? cur.nombre_fantasia ?? '',
    b.cuit ?? cur.cuit ?? '',
    b.condicion_iva ?? cur.condicion_iva ?? 'Responsable Inscripto',
    b.direccion ?? cur.direccion ?? '',
    b.localidad ?? cur.localidad ?? '',
    b.provincia ?? cur.provincia ?? '',
    b.codigo_postal ?? cur.codigo_postal ?? '',
    (b.pais !== undefined ? (String(b.pais).trim() || 'Argentina') : (cur.pais || 'Argentina')),
    b.telefono ?? cur.telefono ?? '',
    b.email ?? cur.email ?? '',
    b.iibb ?? cur.iibb ?? '',
    b.inicio_actividades ?? cur.inicio_actividades ?? '',
    ivaGeneral,
    ivaCompras,
    ivaVentas,
    b.prefijo_compra ?? cur.prefijo_compra ?? 'FC',
    b.prefijo_remito ?? cur.prefijo_remito ?? 'REM',
    b.prefijo_pago ?? cur.prefijo_pago ?? 'OP',
    b.prefijo_venta ?? cur.prefijo_venta ?? 'FA',
    b.prefijo_cobro ?? cur.prefijo_cobro ?? 'RC',
    proxInt(b.prox_num_compra, cur.prox_num_compra),
    proxInt(b.prox_num_remito, cur.prox_num_remito),
    proxInt(b.prox_num_pago, cur.prox_num_pago),
    proxInt(b.prox_num_venta, cur.prox_num_venta),
    proxInt(b.prox_num_cobro, cur.prox_num_cobro),
    b.logo_data !== undefined ? String(b.logo_data || '') : (cur.logo_data || ''),
    b.dias_entrega_defecto !== undefined ? Math.max(0, Number(b.dias_entrega_defecto)) : (cur.dias_entrega_defecto ?? 7),
    ['A4', 'A5', 'ticket80', 'ticket58'].includes(b.print_formato) ? b.print_formato : (cur.print_formato || 'A4'),
    ['original', 'duplicado', 'triplicado'].includes(b.print_copias) ? b.print_copias : (cur.print_copias || 'original'),
    b.print_mostrar_logo !== undefined ? (b.print_mostrar_logo ? 1 : 0) : (cur.print_mostrar_logo ?? 1),
    b.print_modo_economico !== undefined ? (b.print_modo_economico ? 1 : 0) : (cur.print_modo_economico ?? 0),
    b.print_pie_comprobante !== undefined ? String(b.print_pie_comprobante) : (cur.print_pie_comprobante ?? ''),
  );
  return getEmpresaConfig();
}

export function getConfig() {
  return {
    categorias: db.prepare('SELECT * FROM categorias ORDER BY nombre ASC').all(),
    unidades: db.prepare('SELECT * FROM unidades_medida ORDER BY grupo ASC, factor ASC, nombre ASC').all(),
    variantes: db.prepare('SELECT * FROM variantes ORDER BY atributo ASC, valor ASC').all(),
    etapas: db.prepare('SELECT * FROM etapas_config ORDER BY orden ASC, id ASC').all(),
    impuestos: db.prepare('SELECT * FROM impuestos_config ORDER BY tipo ASC, alicuota_defecto DESC, nombre ASC').all(),
    jurisdicciones: db.prepare('SELECT * FROM jurisdicciones WHERE activo = 1 ORDER BY codigo ASC').all(),
    empresa: getEmpresaConfig(),
  };
}

export function convertUnitFromDb(value, fromUnit, toUnit) {
  const v = Number(value) || 0;
  if (!fromUnit || !toUnit || fromUnit === toUnit) return v;
  const fromRow = db.prepare('SELECT grupo, factor FROM unidades_medida WHERE nombre = ?').get(fromUnit);
  const toRow = db.prepare('SELECT grupo, factor FROM unidades_medida WHERE nombre = ?').get(toUnit);
  if (!fromRow || !toRow || fromRow.grupo !== toRow.grupo || !toRow.factor) {
    return v;
  }
  return (v * fromRow.factor) / toRow.factor;
}

function normalizeCategoriaPayload(data, selfId = null) {
  const payload = typeof data === 'string' ? { nombre: data } : (data || {});
  const nombre = String(payload.nombre || '').trim();
  const rawPadre = payload.padre_id;
  let padreId = rawPadre !== undefined && rawPadre !== null && rawPadre !== '' ? Number(rawPadre) : null;
  if (Number.isNaN(padreId) || (selfId !== null && padreId === Number(selfId))) {
    padreId = null;
  }
  const descripcion = String(payload.descripcion || '').trim();
  return { nombre, padreId, descripcion };
}

export function createCategoria(data) {
  const { nombre, padreId, descripcion } = normalizeCategoriaPayload(data);
  const info = db
    .prepare('INSERT INTO categorias (nombre, padre_id, descripcion) VALUES (?, ?, ?)')
    .run(nombre, padreId, descripcion);
  return Number(info.lastInsertRowid);
}

export function updateCategoria(id, data) {
  const old = db.prepare('SELECT id FROM categorias WHERE id = ?').get(id);
  if (!old) return false;
  const { nombre, padreId, descripcion } = normalizeCategoriaPayload(data, id);
  db.prepare('UPDATE categorias SET nombre = ?, padre_id = ?, descripcion = ? WHERE id = ?')
    .run(nombre, padreId, descripcion, id);
  return true;
}

export function deleteCategoria(id) {
  db.prepare('DELETE FROM categorias WHERE id = ?').run(id);
}

export function createUnidad({ nombre, grupo, factor }) {
  const info = db.prepare('INSERT INTO unidades_medida (nombre, grupo, factor) VALUES (?, ?, ?)').run(
    nombre.trim(),
    grupo.trim(),
    Number(factor) || 1
  );
  return Number(info.lastInsertRowid);
}

export function updateUnidad(id, { nombre, grupo, factor }) {
  const old = db.prepare('SELECT nombre FROM unidades_medida WHERE id = ?').get(id);
  if (!old) return false;
  const newName = nombre.trim();
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE unidades_medida SET nombre=?, grupo=?, factor=? WHERE id=?').run(
      newName,
      grupo.trim(),
      Number(factor) || 1,
      id
    );
    if (newName !== old.nombre) {
      db.prepare('UPDATE receta_lineas SET udm_receta = ? WHERE udm_receta = ?').run(newName, old.nombre);
    }
    db.exec('COMMIT');
    return true;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function deleteUnidad(id) {
  db.prepare('DELETE FROM unidades_medida WHERE id = ?').run(id);
}

export function createVariante({ atributo, valor }) {
  const info = db.prepare('INSERT INTO variantes (atributo, valor) VALUES (?, ?)').run(
    atributo.trim(),
    valor.trim()
  );
  return Number(info.lastInsertRowid);
}

export function seedTallesVariantes() {
  const ins = db.prepare('INSERT OR IGNORE INTO variantes (atributo, valor) VALUES (?, ?)');
  for (const s of ['35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45']) ins.run('Talle', s);
}

export function deleteVariante(id) {
  db.prepare('DELETE FROM variantes WHERE id = ?').run(id);
}

export function deleteVarianteAtributo(atributo) {
  db.prepare('DELETE FROM variantes WHERE atributo = ?').run(atributo);
}

export function createEtapa({ nombre, orden, dias_estimados, costo_unidad, depende_de_id }) {
  const info = db.prepare('INSERT INTO etapas_config (nombre, orden, dias_estimados, costo_unidad, depende_de_id) VALUES (?, ?, ?, ?, ?)').run(
    nombre.trim(),
    Number(orden) || 1,
    Math.max(0, Number(dias_estimados) || 0),
    Math.max(0, Number(costo_unidad) || 0),
    depende_de_id ? Number(depende_de_id) : null
  );
  return Number(info.lastInsertRowid);
}

export function updateEtapa(id, { nombre, orden, dias_estimados, costo_unidad, depende_de_id }) {
  const existing = db.prepare('SELECT * FROM etapas_config WHERE id = ?').get(id);
  if (!existing) return false;
  const nextDep = depende_de_id !== undefined
    ? (depende_de_id && Number(depende_de_id) !== Number(id) ? Number(depende_de_id) : null)
    : existing.depende_de_id;
  db.prepare('UPDATE etapas_config SET nombre=?, orden=?, dias_estimados=?, costo_unidad=?, depende_de_id=? WHERE id=?').run(
    nombre !== undefined ? nombre.trim() : existing.nombre,
    orden !== undefined ? Number(orden) : existing.orden,
    dias_estimados !== undefined ? Math.max(0, Number(dias_estimados)) : existing.dias_estimados,
    costo_unidad !== undefined ? Math.max(0, Number(costo_unidad) || 0) : (existing.costo_unidad ?? 0),
    nextDep,
    id
  );
  return true;
}

export function deleteEtapa(id) {
  db.prepare('DELETE FROM etapas_config WHERE id = ?').run(id);
}

// --- PUNTOS DE VENTA Y SECUENCIAS FISCALES ---
export function listPuntosVenta() {
  return db.prepare('SELECT * FROM puntos_venta ORDER BY numero ASC').all();
}

export function createPuntoVenta(b) {
  const numero = Math.max(1, Math.min(9999, parseInt(b.numero, 10) || 0));
  if (!numero) throw new Error('El número de punto de venta debe estar entre 1 y 9999');
  const nombre = (b.nombre || `Punto de Venta ${String(numero).padStart(4, '0')}`).trim();
  const esDefault = b.es_default ? 1 : 0;
  const esElectronica = b.es_electronica ? 1 : 0;
  if (esDefault) db.prepare('UPDATE puntos_venta SET es_default = 0').run();
  const info = db.prepare('INSERT INTO puntos_venta (numero, nombre, es_default, es_electronica, activo) VALUES (?, ?, ?, ?, 1)').run(
    numero, nombre, esDefault, esElectronica
  );
  return Number(info.lastInsertRowid);
}

export function updatePuntoVenta(id, b) {
  const ex = db.prepare('SELECT * FROM puntos_venta WHERE id = ?').get(id);
  if (!ex) return false;
  const numero = b.numero !== undefined ? Math.max(1, Math.min(9999, parseInt(b.numero, 10) || ex.numero)) : ex.numero;
  const nombre = b.nombre !== undefined ? b.nombre.trim() : ex.nombre;
  const esDefault = b.es_default !== undefined ? (b.es_default ? 1 : 0) : ex.es_default;
  const esElectronica = b.es_electronica !== undefined ? (b.es_electronica ? 1 : 0) : (ex.es_electronica ? 1 : 0);
  const activo = b.activo !== undefined ? (b.activo ? 1 : 0) : ex.activo;
  if (esDefault) db.prepare('UPDATE puntos_venta SET es_default = 0').run();
  db.prepare('UPDATE puntos_venta SET numero=?, nombre=?, es_default=?, es_electronica=?, activo=? WHERE id=?').run(
    numero, nombre, esDefault, esElectronica, activo, id
  );
  return true;
}

export function deletePuntoVenta(id) {
  const total = db.prepare('SELECT COUNT(*) as c FROM puntos_venta').get().c;
  if (total <= 1) throw new Error('Debe existir al menos un punto de venta.');
  const ex = db.prepare('SELECT * FROM puntos_venta WHERE id = ?').get(id);
  db.prepare('DELETE FROM puntos_venta WHERE id = ?').run(id);
  if (ex?.es_default) {
    const first = db.prepare('SELECT id FROM puntos_venta ORDER BY numero ASC LIMIT 1').get();
    if (first) db.prepare('UPDATE puntos_venta SET es_default = 1 WHERE id = ?').run(first.id);
  }
}

export function listSecuencias({ dominio } = {}) {
  if (dominio) {
    return secuenciaRepo.findAll({ where: 'dominio = ?', params: [dominio] });
  }
  return secuenciaRepo.findAll();
}

export function createSecuencia(b) {
  const valid = secuenciaRepo.validate({
    codigo: b.codigo,
    nombre: b.nombre,
    dominio: b.dominio || 'general',
    prefijo: b.prefijo ?? '',
    sufijo: b.sufijo ?? '',
    padding: b.padding ?? 8,
    siguiente_numero: b.siguiente_numero ?? 1,
    usa_punto_venta: b.usa_punto_venta ?? true,
    activo: b.activo ?? true,
  });
  return secuenciaRepo.create(valid);
}

export function updateSecuencia(id, b) {
  const valid = secuenciaRepo.validate(b, { partial: true });
  return secuenciaRepo.update(id, valid);
}

export function deleteSecuencia(id) {
  return secuenciaRepo.delete(id);
}

export function getNextNumeroDocumento(tipo, puntoVentaNum, { advance = false } = {}) {
  const seq = db.prepare('SELECT * FROM secuencias WHERE codigo = ? AND activo = 1').get(tipo);
  const emp = getEmpresaConfig();
  const tableMap = {
    compra: 'compras',
    nc_compra: 'compras',
    nd_compra: 'compras',
    remito: 'operaciones_stock',
    pago: 'pagos',
    venta: 'ventas',
    venta_b: 'ventas',
    venta_c: 'ventas',
    venta_x: 'ventas',
    nc_venta: 'ventas',
    nc_venta_b: 'ventas',
    nc_venta_c: 'ventas',
    nc_venta_x: 'ventas',
    nd_venta: 'ventas',
    nd_venta_b: 'ventas',
    nd_venta_c: 'ventas',
    nd_venta_x: 'ventas',
    cobro: 'cobros',
    orden: 'ordenes_produccion',
    operacion_stock: 'operaciones_stock',
    asiento: 'asientos',
  };

  const prefijo = seq
    ? String(seq.prefijo || '')
    : (String(emp[`prefijo_${tipo}`] || 'DOC').replace(/-+$/, '').trim() || 'DOC');
  const sufijo = seq ? String(seq.sufijo || '') : '';
  const padding = Math.max(1, Number(seq?.padding || 8));
  const usaPv = seq ? Boolean(seq.usa_punto_venta) : true;
  const minNext = Math.max(1, Number(seq?.siguiente_numero ?? emp[`prox_num_${tipo}`] ?? 1));

  let pvNum = parseInt(puntoVentaNum, 10);
  if (usaPv && !pvNum) {
    const def = db.prepare('SELECT numero FROM puntos_venta WHERE activo = 1 ORDER BY es_default DESC, numero ASC LIMIT 1').get();
    pvNum = def?.numero || 1;
  }

  let max = 0;
  const targetTable = tableMap[tipo];
  if (targetTable) {
    const col = tipo === 'orden' || tipo === 'operacion_stock' ? 'codigo' : 'numero';
    const pvPad = usaPv ? String(pvNum).padStart(4, '0') : '';
    const rows = usaPv
      ? db.prepare(`SELECT ${col} as num FROM ${targetTable} WHERE ${col} LIKE ?`).all(`%${pvPad}-%`)
      : db.prepare(`SELECT ${col} as num FROM ${targetTable}`).all();
    const escRx = prefijo.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escSuf = sufijo.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = usaPv
      ? new RegExp(`^${escRx}\\s*${pvPad}-(\\d+)${escSuf}$`, 'i')
      : new RegExp(`^${escRx}(\\d+)${escSuf}$`, 'i');
    for (const r of rows) {
      const m = String(r.num || '').trim().match(rx);
      if (m) {
        const n = parseInt(m[1], 10) || 0;
        if (n > max) max = n;
      }
    }
  }

  const nextNumber = Math.max(max + 1, minNext);
  if (advance && seq) {
    db.prepare('UPDATE secuencias SET siguiente_numero = ? WHERE id = ?').run(nextNumber + 1, seq.id);
  }
  const compPad = String(nextNumber).padStart(padding, '0');
  const pvPart = usaPv ? ` ${String(pvNum).padStart(4, '0')}-` : '';
  return {
    numero: `${prefijo.trim()}${pvPart}${compPad}${sufijo}`,
    punto_venta: usaPv ? pvNum : null,
    prefijo,
    sufijo,
    padding,
    dominio: seq?.dominio || 'general',
    siguiente: nextNumber,
  };
}

export function listImpuestos({ aplica_a, tipo, solo_activos } = {}) {
  const where = ['1=1'];
  const args = [];
  if (solo_activos) where.push('activo = 1');
  if (tipo) {
    where.push('tipo = ?');
    args.push(tipo);
  }
  if (aplica_a && aplica_a !== 'ambos') {
    where.push("(aplica_a = 'ambos' OR aplica_a = ?)");
    args.push(aplica_a);
  }
  return db.prepare(`SELECT * FROM impuestos_config WHERE ${where.join(' AND ')} ORDER BY tipo ASC, alicuota_defecto DESC, nombre ASC`).all(...args);
}

export function createImpuesto(b) {
  const nombre = (b.nombre || '').trim();
  if (!nombre) throw new Error('El nombre del impuesto es obligatorio');
  const tipo = ['iva', 'percepcion', 'retencion', 'otro'].includes(b.tipo) ? b.tipo : 'percepcion';
  const aplicaA = ['compras', 'ventas', 'ambos'].includes(b.aplica_a) ? b.aplica_a : 'ambos';
  const baseCalc = ['neto', 'total', 'manual', 'fijo'].includes(b.base_calculo) ? b.base_calculo : 'neto';
  const info = db.prepare(`
    INSERT INTO impuestos_config (nombre, codigo, tipo, aplica_a, alicuota_defecto, base_calculo, jurisdiccion_codigo, codigo_regimen, minimo_no_imponible, cuenta_contable_id, activo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    nombre,
    (b.codigo || '').trim().toUpperCase(),
    tipo,
    aplicaA,
    Math.max(0, Number(b.alicuota_defecto) || 0),
    baseCalc,
    (b.jurisdiccion_codigo || '').trim(),
    (b.codigo_regimen || '').trim(),
    Math.max(0, Number(b.minimo_no_imponible) || 0),
    b.cuenta_contable_id ? Number(b.cuenta_contable_id) : null
  );
  return Number(info.lastInsertRowid);
}

export function updateImpuesto(id, b) {
  const ex = db.prepare('SELECT * FROM impuestos_config WHERE id = ?').get(id);
  if (!ex) return false;
  db.prepare(`
    UPDATE impuestos_config SET nombre=?, codigo=?, tipo=?, aplica_a=?, alicuota_defecto=?, base_calculo=?, jurisdiccion_codigo=?, codigo_regimen=?, minimo_no_imponible=?, cuenta_contable_id=?, activo=?
    WHERE id=?
  `).run(
    b.nombre !== undefined ? (b.nombre.trim() || ex.nombre) : ex.nombre,
    b.codigo !== undefined ? b.codigo.trim().toUpperCase() : ex.codigo,
    ['iva', 'percepcion', 'retencion', 'otro'].includes(b.tipo) ? b.tipo : ex.tipo,
    ['compras', 'ventas', 'ambos'].includes(b.aplica_a) ? b.aplica_a : ex.aplica_a,
    b.alicuota_defecto !== undefined ? Math.max(0, Number(b.alicuota_defecto) || 0) : ex.alicuota_defecto,
    ['neto', 'total', 'manual', 'fijo'].includes(b.base_calculo) ? b.base_calculo : ex.base_calculo,
    b.jurisdiccion_codigo !== undefined ? (b.jurisdiccion_codigo || '').trim() : (ex.jurisdiccion_codigo || ''),
    b.codigo_regimen !== undefined ? (b.codigo_regimen || '').trim() : (ex.codigo_regimen || ''),
    b.minimo_no_imponible !== undefined ? Math.max(0, Number(b.minimo_no_imponible) || 0) : (ex.minimo_no_imponible || 0),
    b.cuenta_contable_id !== undefined ? (b.cuenta_contable_id ? Number(b.cuenta_contable_id) : null) : ex.cuenta_contable_id,
    b.activo !== undefined ? (b.activo ? 1 : 0) : ex.activo,
    id
  );
  return true;
}

export function deleteImpuesto(id) {
  db.prepare('DELETE FROM impuestos_config WHERE id = ?').run(id);
}
