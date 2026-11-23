export function parseOpciones(raw) {
  if (Array.isArray(raw)) return raw.map(v => String(v).trim()).filter(Boolean);
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(v => String(v).trim()).filter(Boolean);
    } catch {
      return trimmed.split(',').map(v => v.trim()).filter(Boolean);
    }
  }
  return [];
}

export function parseCustomFields(rawJson) {
  if (rawJson && typeof rawJson === 'object' && !Array.isArray(rawJson)) return { ...rawJson };
  if (typeof rawJson !== 'string' || !rawJson.trim()) return {};
  try {
    const parsed = JSON.parse(rawJson);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function badRequest(msg) {
  const err = new Error(msg);
  err.status = 400;
  return err;
}

function coerceAndValidateValue(def, rawVal) {
  if (rawVal === undefined || rawVal === null || rawVal === '') return null;
  switch (def.tipo) {
    case 'number': {
      const n = Number(rawVal);
      if (!Number.isFinite(n)) {
        throw badRequest(`El campo "${def.etiqueta}" debe ser un número válido`);
      }
      return n;
    }
    case 'date': {
      const s = String(rawVal).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        throw badRequest(`El campo "${def.etiqueta}" debe tener formato YYYY-MM-DD`);
      }
      const d = new Date(`${s}T00:00:00Z`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
        throw badRequest(`El campo "${def.etiqueta}" no es una fecha válida`);
      }
      return s;
    }
    case 'boolean': {
      if (rawVal === true || rawVal === 1 || rawVal === '1' || rawVal === 'true') return true;
      if (rawVal === false || rawVal === 0 || rawVal === '0' || rawVal === 'false') return false;
      throw badRequest(`El campo "${def.etiqueta}" debe ser booleano`);
    }
    case 'select': {
      const s = String(rawVal).trim();
      const opciones = parseOpciones(def.opciones_json);
      if (!opciones.includes(s)) {
        throw badRequest(`Valor "${s}" inválido para "${def.etiqueta}". Opciones: ${opciones.join(', ')}`);
      }
      return s;
    }
    case 'text':
    default:
      return String(rawVal);
  }
}

export function validateAndMergeCustomFieldsWithDefs(defs, existingJson, patchObj, { partial = false } = {}) {
  const existing = parseCustomFields(existingJson);
  const patch = parseCustomFields(patchObj);
  const activeDefs = (defs || []).filter(d => Number(d.activo) !== 0);
  if (activeDefs.length === 0 && Object.keys(patch).length === 0) {
    return JSON.stringify(existing);
  }

  const defByKey = new Map(activeDefs.map(d => [d.nombre_tecnico, d]));
  const merged = { ...existing };

  for (const [k, v] of Object.entries(patch)) {
    const def = defByKey.get(k);
    if (!def) continue;
    const val = coerceAndValidateValue(def, v);
    if (val === null) delete merged[k];
    else merged[k] = val;
  }

  for (const def of activeDefs) {
    if (!Number(def.requerido)) continue;
    const present = merged[def.nombre_tecnico] !== undefined && merged[def.nombre_tecnico] !== null && merged[def.nombre_tecnico] !== '';
    const cleared = Object.prototype.hasOwnProperty.call(patch, def.nombre_tecnico) && !present;
    if ((!partial && !present) || cleared) {
      throw badRequest(`El campo personalizado "${def.etiqueta}" es obligatorio`);
    }
  }

  return JSON.stringify(merged);
}

export function validateAndMergeCustomFieldsForDb(db, entidad, existingJson, patchObj, { partial = false } = {}) {
  if (!db) return JSON.stringify(parseCustomFields(patchObj));
  let defs = [];
  try {
    defs = db.prepare('SELECT * FROM custom_field_defs WHERE entidad = ? AND activo = 1 ORDER BY orden ASC, id ASC').all(entidad);
  } catch {
    return JSON.stringify({ ...parseCustomFields(existingJson), ...parseCustomFields(patchObj) });
  }
  return validateAndMergeCustomFieldsWithDefs(defs, existingJson, patchObj, { partial });
}
