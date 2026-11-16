import { esc } from '../format.js';
import { mountCombobox, mountMultiSelect } from '../autocomplete.js';

/**
 * Motor declarativo de campos de formulario
 * Soporta: text, number, date, email, select, combobox, checkbox, textarea,
 * además de disabled, readonly, help y showIf(state) para visibilidad condicional.
 */
export function mountFormFields(container, fields, state, { onChange } = {}) {
  if (!container) return;

  container.innerHTML = fields.map(f => {
    const val = state[f.name] ?? '';
    const req = f.required ? 'required' : '';
    const dis = f.disabled ? 'disabled' : '';
    const ro = f.readonly ? 'readonly' : '';
    const visible = typeof f.showIf === 'function' ? Boolean(f.showIf(state)) : true;
    const hideAttr = visible ? '' : 'hidden';
    const cls = f.full ? 'class="full"' : '';
    const helpHtml = f.help ? `<small class="ve-field-help">${esc(f.help)}</small>` : '';

    if (f.type === 'combobox') {
      return `
        <label ${cls} data-field-wrap="${esc(f.name)}" ${hideAttr}>
          <span>${esc(f.label)}${f.required ? ' *' : ''}</span>
          <div class="ve-combo" data-field="${esc(f.name)}"></div>
          ${helpHtml}
        </label>
      `;
    }
    if (f.type === 'multiselect') {
      return `
        <label ${cls} data-field-wrap="${esc(f.name)}" ${hideAttr}>
          <span>${esc(f.label)}${f.required ? ' *' : ''}</span>
          <div class="ve-multiselect-wrap" data-field="${esc(f.name)}"></div>
          ${helpHtml}
        </label>
      `;
    }
    if (f.type === 'select') {
      const noSearch = f.searchable === false ? 'data-no-search="1"' : '';
      return `
        <label ${cls} data-field-wrap="${esc(f.name)}" ${hideAttr}>
          <span>${esc(f.label)}${f.required ? ' *' : ''}</span>
          <select name="${esc(f.name)}" data-field="${esc(f.name)}" ${noSearch} ${req} ${dis}>
            ${(f.options || []).map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(val) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
          </select>
          ${helpHtml}
        </label>
      `;
    }
    if (f.type === 'checkbox') {
      return `
        <label class="checkbox-field ${f.full ? 'full' : ''}" data-field-wrap="${esc(f.name)}" ${hideAttr}>
          <input type="checkbox" name="${esc(f.name)}" data-field="${esc(f.name)}" ${val ? 'checked' : ''} ${dis} />
          <span>${esc(f.label)}</span>
          ${helpHtml}
        </label>
      `;
    }
    if (f.type === 'textarea') {
      return `
        <label ${cls} data-field-wrap="${esc(f.name)}" ${hideAttr}>
          <span>${esc(f.label)}${f.required ? ' *' : ''}</span>
          <textarea name="${esc(f.name)}" data-field="${esc(f.name)}" rows="${Number(f.rows) || 2}" placeholder="${esc(f.placeholder || '')}" ${req} ${dis} ${ro}>${esc(val)}</textarea>
          ${helpHtml}
        </label>
      `;
    }
    const extraAttrs = [
      f.step !== undefined ? `step="${esc(f.step)}"` : '',
      f.min !== undefined ? `min="${esc(f.min)}"` : '',
      f.max !== undefined ? `max="${esc(f.max)}"` : '',
    ].filter(Boolean).join(' ');
    return `
      <label ${cls} data-field-wrap="${esc(f.name)}" ${hideAttr}>
        <span>${esc(f.label)}${f.required ? ' *' : ''}</span>
        <input type="${esc(f.type || 'text')}" name="${esc(f.name)}" data-field="${esc(f.name)}" value="${esc(val)}" placeholder="${esc(f.placeholder || '')}" ${extraAttrs} ${req} ${dis} ${ro} />
        ${helpHtml}
      </label>
    `;
  }).join('');

  const syncConditionalVisibility = () => {
    for (const f of fields) {
      if (typeof f.showIf !== 'function') continue;
      const wrap = container.querySelector(`[data-field-wrap="${f.name}"]`);
      if (!wrap) continue;
      const show = Boolean(f.showIf(state));
      wrap.hidden = !show;
      wrap.querySelectorAll('input, select, textarea').forEach(inp => {
        if (!show) inp.removeAttribute('required');
        else if (f.required) inp.setAttribute('required', '');
      });
    }
  };

  const notifyChange = (name, val) => {
    syncConditionalVisibility();
    onChange?.(name, val, state);
  };

  for (const f of fields) {
    if (f.type === 'combobox') {
      const el = container.querySelector(`.ve-combo[data-field="${f.name}"]`);
      mountCombobox(el, {
        name: f.name,
        value: state[f.name] ?? '',
        required: !!f.required,
        allowFreeText: !!f.allowFreeText,
        placeholder: f.placeholder || 'Buscar...',
        items: typeof f.items === 'function' ? f.items() : (f.items || []),
        onSelect: (it) => {
          state[f.name] = it ? String(it.value) : '';
          f.onSelect?.(it, state);
          notifyChange(f.name, state[f.name]);
        },
        onCreate: f.onCreate || null,
      });
    } else if (f.type === 'multiselect') {
      const el = container.querySelector(`.ve-multiselect-wrap[data-field="${f.name}"]`);
      mountMultiSelect(el, {
        values: Array.isArray(state[f.name]) ? state[f.name] : [],
        placeholder: f.placeholder || 'Seleccionar...',
        items: typeof f.items === 'function' ? f.items() : (f.items || []),
        onChange: (vals, objs) => {
          state[f.name] = vals;
          f.onSelect?.(objs, state);
          notifyChange(f.name, vals);
        },
      });
    } else if (f.type === 'checkbox') {
      const el = container.querySelector(`[data-field="${f.name}"]`);
      el?.addEventListener('change', (e) => {
        state[f.name] = Boolean(e.target.checked);
        notifyChange(f.name, state[f.name]);
      });
    } else {
      const el = container.querySelector(`[data-field="${f.name}"]`);
      const sync = (e) => {
        state[f.name] = e.target.value;
        notifyChange(f.name, state[f.name]);
      };
      el?.addEventListener('change', sync);
      if (f.type !== 'select') el?.addEventListener('input', sync);
    }
  }
}
