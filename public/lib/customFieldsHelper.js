import { api } from './api.js';
import { esc, fmtDate } from './format.js';

export const CF_PREFIX = '__cf_';

export async function fetchCustomFieldDefs(entidad) {
  if (!entidad) return [];
  return api(`/api/custom-fields?entidad=${encodeURIComponent(entidad)}&activos=1`).catch(() => []);
}

export function parseCustomFieldOpciones(raw) {
  if (Array.isArray(raw)) return raw.map(v => String(v).trim()).filter(Boolean);
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(v => String(v).trim()).filter(Boolean);
  } catch {
    return raw.split(',').map(v => v.trim()).filter(Boolean);
  }
  return [];
}

export function isCustomFieldKey(key) {
  return String(key || '').startsWith(CF_PREFIX);
}

export function extractCustomFieldPatch(key, value) {
  const k = String(key || '').slice(CF_PREFIX.length);
  return { [k]: value };
}

export function withCustomFieldColumns(entidad, baseColumns = [], defs = [], onSaveCustomField = null) {
  const activeDefs = (defs || [])
    .filter(d => (!entidad || d.entidad === entidad) && Number(d.activo) !== 0 && Number(d.visible_en_grilla) !== 0);
  if (!activeDefs.length) return baseColumns;

  const cfCols = activeDefs.map(d => {
    const colKey = `${CF_PREFIX}${d.nombre_tecnico}`;
    const opciones = parseCustomFieldOpciones(d.opciones_json);
    const getVal = (row) => {
      if (row && row[colKey] !== undefined) return row[colKey];
      const val = (row?.custom_fields || {})[d.nombre_tecnico];
      if (d.tipo === 'boolean') return Boolean(val);
      return val ?? '';
    };
    return {
      key: colKey,
      label: d.etiqueta,
      type: d.tipo === 'select' ? 'select' : d.tipo === 'boolean' ? 'boolean' : d.tipo === 'number' ? 'number' : d.tipo === 'date' ? 'date' : 'text',
      options: d.tipo === 'select' ? [{ value: '', label: '-' }, ...opciones.map(o => ({ value: o, label: o }))] : undefined,
      readOnly: typeof onSaveCustomField !== 'function',
      getValue: getVal,
      render: (row) => {
        const v = getVal(row);
        if (d.tipo === 'boolean') {
          return v ? '<span class="badge badge-ok">Sí</span>' : '<span class="badge badge-muted">No</span>';
        }
        if (d.tipo === 'date' && v) return esc(fmtDate(v));
        if (v === '' || v === null || v === undefined) return '<span class="muted">-</span>';
        return esc(String(v));
      },
    };
  });

  return [...baseColumns, ...cfCols];
}

export function renderCustomFieldsSection(container, defs = [], currentValues = {}) {
  if (!container) return () => ({});
  const activeDefs = (defs || []).filter(d => Number(d.activo) !== 0);
  if (!activeDefs.length) {
    container.innerHTML = '';
    return () => ({});
  }

  const values = currentValues && typeof currentValues === 'object' ? currentValues : {};
  container.innerHTML = `
    <div class="form-grid">
      ${activeDefs.map(d => {
        const k = d.nombre_tecnico;
        const val = values[k];
        const req = Number(d.requerido) ? 'required' : '';
        const star = Number(d.requerido) ? ' *' : '';
        if (d.tipo === 'boolean') {
          return `
            <label class="checkbox-label">
              <input type="checkbox" data-cf-key="${esc(k)}" data-cf-type="boolean" ${val ? 'checked' : ''} />
              <span>${esc(d.etiqueta)}</span>
            </label>
          `;
        }
        if (d.tipo === 'select') {
          const opciones = parseCustomFieldOpciones(d.opciones_json);
          return `
            <label>
              <span>${esc(d.etiqueta)}${star}</span>
              <select data-cf-key="${esc(k)}" data-cf-type="select" ${req}>
                <option value="">-- Seleccionar --</option>
                ${opciones.map(o => `<option value="${esc(o)}" ${String(val ?? '') === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}
              </select>
            </label>
          `;
        }
        const inputType = d.tipo === 'number' ? 'number' : d.tipo === 'date' ? 'date' : 'text';
        const stepAttr = d.tipo === 'number' ? 'step="any"' : '';
        return `
          <label>
            <span>${esc(d.etiqueta)}${star}</span>
            <input type="${inputType}" ${stepAttr} data-cf-key="${esc(k)}" data-cf-type="${esc(d.tipo)}" value="${esc(val ?? '')}" ${req} />
          </label>
        `;
      }).join('')}
    </div>
  `;

  return () => {
    const out = {};
    container.querySelectorAll('[data-cf-key]').forEach(el => {
      const k = el.dataset.cfKey;
      const t = el.dataset.cfType;
      if (t === 'boolean') out[k] = el.checked;
      else if (t === 'number') out[k] = el.value === '' ? null : Number(el.value);
      else out[k] = el.value;
    });
    return out;
  };
}
