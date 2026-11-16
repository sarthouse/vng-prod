import { esc } from './format.js';
import { api, toast } from './api.js';
import { showFormModal } from './engine/modalEngine.js';

/**
 * Convierte un contenedor en un input buscador con dropdown y creación dinámica.
 * @param {HTMLElement} container
 * @param {Object} opts
 * @param {Array<{value:string|number, label:string, sublabel?:string, raw?:any}>} opts.items
 * @param {string|number} [opts.value]
 * @param {string} [opts.name]
 * @param {string} [opts.placeholder]
 * @param {boolean} [opts.required]
 * @param {(item: any) => void} [opts.onSelect]
 * @param {(query: string) => Promise<{value:string|number, label:string, sublabel?:string, raw?:any}|null>} [opts.onCreate]
 */
function normText(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

export function mountCombobox(container, opts) {
  if (!container) return null;
  const items = opts.items || [];
  let selectedValue = opts.value !== undefined && opts.value !== null ? String(opts.value) : '';
  const currentItem = () => items.find(i => String(i.value) === selectedValue) || null;

  container.classList.add('combo-wrap');
  const initialLabel = currentItem()?.label ?? (opts.allowFreeText && selectedValue ? selectedValue : '');
  container.innerHTML = `
    ${opts.name ? `<input type="hidden" name="${esc(opts.name)}" value="${esc(selectedValue)}" ${opts.required ? 'required' : ''} />` : ''}
    <input type="text" class="combo-input" role="combobox" autocomplete="off" data-bwignore="true" data-lpignore="true" data-1p-ignore="true" data-form-type="other" placeholder="${esc(opts.placeholder || 'Buscar...')}" value="${esc(initialLabel)}" />
  `;

  const hiddenEl = opts.name ? container.querySelector('input[type="hidden"]') : null;
  const inputEl = container.querySelector('.combo-input');

  // Limpiar menús huérfanos cuyo input ya fue removido del DOM
  document.querySelectorAll('body > .combo-menu').forEach(m => {
    if (m.__comboInput && !document.body.contains(m.__comboInput)) {
      m.remove();
    }
  });

  const menuEl = document.createElement('div');
  menuEl.className = 'combo-menu hidden';
  menuEl.__comboInput = inputEl;
  document.body.appendChild(menuEl);

  let activeIdx = -1;
  let visibleEntries = [];
  let isOpen = false;
  let creating = false;

  const positionMenu = () => {
    const rect = inputEl.getBoundingClientRect();
    menuEl.style.left = `${rect.left}px`;
    menuEl.style.top = `${rect.bottom + 4}px`;
    menuEl.style.width = `${Math.max(rect.width, 220)}px`;
  };

  const close = () => {
    if (!isOpen) return;
    isOpen = false;
    menuEl.classList.add('hidden');
    activeIdx = -1;
  };

  const selectItem = (item) => {
    selectedValue = item ? String(item.value) : '';
    if (hiddenEl) hiddenEl.value = selectedValue;
    inputEl.value = item ? item.label : '';
    close();
    opts.onSelect?.(item || null);
  };

  const buildEntries = (query) => {
    const q = normText(query);
    const filtered = q
      ? items.filter(i =>
          normText(i.label).includes(q) ||
          (i.sublabel && normText(i.sublabel).includes(q))
        )
      : items.slice(0, 50);

    const list = filtered.slice(0, 40).map(item => ({ type: 'item', item }));
    const rawQ = (query || '').trim();
    const exact = rawQ && items.some(i => normText(i.label) === normText(rawQ));
    if (opts.onCreate && rawQ && !exact) {
      list.push({ type: 'create', query: rawQ });
    }
    return list;
  };

  const renderMenu = (showAll = false) => {
    visibleEntries = buildEntries(showAll ? '' : inputEl.value);
    if (!visibleEntries.length) {
      menuEl.innerHTML = `<div class="combo-empty">Sin resultados</div>`;
      return;
    }
    if (activeIdx >= visibleEntries.length) activeIdx = visibleEntries.length - 1;

    menuEl.innerHTML = visibleEntries.map((entry, idx) => {
      const cls = idx === activeIdx ? ' active' : '';
      if (entry.type === 'create') {
        return `<button type="button" class="combo-option combo-create${cls}" data-idx="${idx}">+ Crear "${esc(entry.query)}"</button>`;
      }
      return `
        <button type="button" class="combo-option${cls}" data-idx="${idx}">
          <span>${esc(entry.item.label)}</span>
          ${entry.item.sublabel ? `<small class="muted">${esc(entry.item.sublabel)}</small>` : ''}
        </button>
      `;
    }).join('');

    menuEl.querySelectorAll('.combo-option').forEach(btn => {
      btn.addEventListener('mousedown', async (e) => {
        e.preventDefault();
        await handlePick(Number(btn.dataset.idx));
      });
    });
  };

  const handlePick = async (idx) => {
    const entry = visibleEntries[idx];
    if (!entry) return;
    if (entry.type === 'item') {
      selectItem(entry.item);
      return;
    }
    if (entry.type === 'create' && opts.onCreate && !creating) {
      creating = true;
      inputEl.disabled = true;
      try {
        const created = await opts.onCreate(entry.query);
        if (created) {
          items.push(created);
          selectItem(created);
        }
      } finally {
        creating = false;
        inputEl.disabled = false;
      }
    }
  };

  const open = (showAll = false) => {
    if (!document.body.contains(inputEl)) {
      menuEl.remove();
      return;
    }
    isOpen = true;
    activeIdx = 0;
    positionMenu();
    renderMenu(showAll);
    menuEl.classList.remove('hidden');
  };

  inputEl.addEventListener('focus', () => {
    inputEl.select();
    open(Boolean(selectedValue));
  });

  inputEl.addEventListener('input', () => {
    const raw = inputEl.value.trim();
    if (!raw && selectedValue) {
      selectedValue = '';
      if (hiddenEl) hiddenEl.value = '';
      opts.onSelect?.(null);
    } else if (opts.allowFreeText && raw) {
      const exactMatch = items.find(i => normText(i.label) === normText(raw));
      if (exactMatch) {
        selectedValue = String(exactMatch.value);
        if (hiddenEl) hiddenEl.value = selectedValue;
        opts.onSelect?.(exactMatch);
      } else {
        selectedValue = raw;
        if (hiddenEl) hiddenEl.value = raw;
        opts.onSelect?.({ value: raw, label: raw });
      }
    }
    if (!isOpen) open();
    else {
      activeIdx = 0;
      positionMenu();
      renderMenu();
    }
  });

  inputEl.addEventListener('keydown', async (e) => {
    if (!isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      open();
      return;
    }
    if (!isOpen) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (visibleEntries.length) {
        activeIdx = (activeIdx + 1) % visibleEntries.length;
        renderMenu();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (visibleEntries.length) {
        activeIdx = (activeIdx - 1 + visibleEntries.length) % visibleEntries.length;
        renderMenu();
      }
    } else if (e.key === 'Enter') {
      if (visibleEntries.length && activeIdx >= 0) {
        e.preventDefault();
        await handlePick(activeIdx);
      }
    } else if (e.key === 'Escape') {
      close();
    }
  });

  inputEl.addEventListener('blur', () => {
    setTimeout(() => {
      close();
      const cur = currentItem();
      if (cur && inputEl.value.trim() !== cur.label) {
        inputEl.value = cur.label;
      } else if (!cur && !opts.allowFreeText && inputEl.value.trim()) {
        inputEl.value = '';
      }
    }, 120);
  });

  const onReposition = () => {
    if (!document.body.contains(inputEl)) {
      menuEl.remove();
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
      return;
    }
    if (isOpen) positionMenu();
  };
  window.addEventListener('scroll', onReposition, true);
  window.addEventListener('resize', onReposition);

  return { selectItem, close, destroy: () => menuEl.remove() };
}

/**
 * Selector múltiple 1-N con chips/tags buscables (estilo Odoo / ERP).
 * @param {HTMLElement} container
 * @param {Object} opts
 * @param {Array<{value:string|number, label:string, sublabel?:string, raw?:any}>} opts.items
 * @param {Array<string|number>} [opts.values]
 * @param {string} [opts.placeholder]
 * @param {(values: string[], selectedItems: any[]) => void} [opts.onChange]
 */
export function mountMultiSelect(container, opts = {}) {
  if (!container) return null;
  const items = opts.items || [];
  let selectedSet = new Set((opts.values || []).map(v => String(v)));

  container.classList.add('ve-multiselect');
  container.innerHTML = `
    <div class="ve-ms-control">
      <div class="ve-ms-chips"></div>
      <input type="text" class="ve-ms-input" autocomplete="off" placeholder="${esc(opts.placeholder || 'Seleccionar...')}" />
    </div>
  `;

  const controlEl = container.querySelector('.ve-ms-control');
  const chipsEl = container.querySelector('.ve-ms-chips');
  const inputEl = container.querySelector('.ve-ms-input');

  const menuEl = document.createElement('div');
  menuEl.className = 'combo-menu hidden';
  menuEl.__comboInput = inputEl;
  document.body.appendChild(menuEl);

  let isOpen = false;
  let activeIdx = 0;
  let visibleItems = [];

  const getSelectedObjects = () => items.filter(i => selectedSet.has(String(i.value)));

  const renderChips = () => {
    const sel = getSelectedObjects();
    chipsEl.innerHTML = sel.map(it => `
      <span class="ve-ms-chip" data-val="${esc(it.value)}">
        <span>${esc(it.label)}</span>
        <button type="button" class="ve-ms-chip-rm" data-rm="${esc(it.value)}" aria-label="Quitar">×</button>
      </span>
    `).join('');
    inputEl.placeholder = sel.length ? '' : (opts.placeholder || 'Seleccionar...');
    chipsEl.querySelectorAll('[data-rm]').forEach(btn => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        selectedSet.delete(String(btn.dataset.rm));
        emitChange();
        renderChips();
        if (isOpen) renderMenu();
      });
    });
  };

  const emitChange = () => {
    const vals = Array.from(selectedSet);
    opts.onChange?.(vals, getSelectedObjects());
  };

  const positionMenu = () => {
    const rect = controlEl.getBoundingClientRect();
    menuEl.style.left = `${rect.left}px`;
    menuEl.style.top = `${rect.bottom + 4}px`;
    menuEl.style.width = `${Math.max(rect.width, 220)}px`;
  };

  const close = () => {
    if (!isOpen) return;
    isOpen = false;
    menuEl.classList.add('hidden');
  };

  const renderMenu = () => {
    const q = normText(inputEl.value);
    visibleItems = items.filter(i => {
      if (selectedSet.has(String(i.value))) return false;
      if (!q) return true;
      return normText(i.label).includes(q) || (i.sublabel && normText(i.sublabel).includes(q));
    });

    if (!visibleItems.length) {
      menuEl.innerHTML = `<div class="combo-empty">${items.length && selectedSet.size === items.length ? 'Todos seleccionados' : 'Sin resultados'}</div>`;
      return;
    }
    if (activeIdx >= visibleItems.length) activeIdx = 0;

    menuEl.innerHTML = visibleItems.map((it, idx) => `
      <button type="button" class="combo-option${idx === activeIdx ? ' active' : ''}" data-idx="${idx}">
        <span>${esc(it.label)}</span>
        ${it.sublabel ? `<small class="muted">${esc(it.sublabel)}</small>` : ''}
      </button>
    `).join('');

    menuEl.querySelectorAll('.combo-option').forEach(btn => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const picked = visibleItems[Number(btn.dataset.idx)];
        if (picked) {
          selectedSet.add(String(picked.value));
          inputEl.value = '';
          emitChange();
          renderChips();
          positionMenu();
          renderMenu();
        }
      });
    });
  };

  const open = () => {
    if (!document.body.contains(inputEl)) {
      menuEl.remove();
      return;
    }
    isOpen = true;
    activeIdx = 0;
    positionMenu();
    renderMenu();
    menuEl.classList.remove('hidden');
  };

  controlEl.addEventListener('click', () => {
    inputEl.focus();
    open();
  });
  inputEl.addEventListener('focus', () => open());
  inputEl.addEventListener('input', () => {
    if (!isOpen) open();
    else {
      activeIdx = 0;
      positionMenu();
      renderMenu();
    }
  });
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !inputEl.value && selectedSet.size > 0) {
      const last = Array.from(selectedSet).pop();
      selectedSet.delete(last);
      emitChange();
      renderChips();
      if (isOpen) renderMenu();
      return;
    }
    if (!isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      open();
      return;
    }
    if (!isOpen) return;
    if (e.key === 'ArrowDown' && visibleItems.length) {
      e.preventDefault();
      activeIdx = (activeIdx + 1) % visibleItems.length;
      renderMenu();
    } else if (e.key === 'ArrowUp' && visibleItems.length) {
      e.preventDefault();
      activeIdx = (activeIdx - 1 + visibleItems.length) % visibleItems.length;
      renderMenu();
    } else if (e.key === 'Enter' && visibleItems.length && activeIdx >= 0) {
      e.preventDefault();
      const picked = visibleItems[activeIdx];
      if (picked) {
        selectedSet.add(String(picked.value));
        inputEl.value = '';
        emitChange();
        renderChips();
        positionMenu();
        renderMenu();
      }
    } else if (e.key === 'Escape') {
      close();
    }
  });
  inputEl.addEventListener('blur', () => {
    setTimeout(() => {
      close();
      inputEl.value = '';
    }, 120);
  });

  const onReposition = () => {
    if (!document.body.contains(inputEl)) {
      menuEl.remove();
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
      return;
    }
    if (isOpen) positionMenu();
  };
  window.addEventListener('scroll', onReposition, true);
  window.addEventListener('resize', onReposition);

  renderChips();

  return {
    getValues: () => Array.from(selectedSet),
    setValues: (vals) => {
      selectedSet = new Set((vals || []).map(v => String(v)));
      renderChips();
    },
    destroy: () => menuEl.remove(),
  };
}

export function quickCreateProveedor(nombre, { es_taller = false } = {}) {
  const labelTipo = es_taller ? 'Destinatario / Taller' : 'Proveedor';
  return showFormModal({
    title: `Nuevo ${labelTipo}`,
    submitText: `Crear ${labelTipo}`,
    initialState: {
      nombre: nombre || '',
      cuit: '',
      condicion_iva: 'Responsable Inscripto',
      telefono: '',
      email: '',
      direccion: '',
    },
    fields: [
      { name: 'nombre', label: 'Nombre / Razón Social', type: 'text', required: true, full: true },
      { name: 'cuit', label: 'CUIT / DNI', type: 'text', placeholder: '20-12345678-9' },
      {
        name: 'condicion_iva',
        label: 'Condición IVA',
        type: 'select',
        searchable: false,
        options: [
          { value: 'Responsable Inscripto', label: 'Responsable Inscripto' },
          { value: 'Monotributo', label: 'Monotributo' },
          { value: 'Exento', label: 'Exento' },
          { value: 'Consumidor Final', label: 'Consumidor Final' },
        ],
      },
      { name: 'telefono', label: 'Teléfono', type: 'text', placeholder: 'Opcional' },
      { name: 'email', label: 'Email', type: 'email', placeholder: 'Opcional' },
      { name: 'direccion', label: 'Dirección', type: 'text', placeholder: 'Opcional', full: true },
    ],
    onSubmit: async (data) => {
      const nom = String(data.nombre || '').trim();
      if (!nom) return false;
      try {
        const payload = {
          nombre: nom,
          cuit: String(data.cuit || '').trim(),
          condicion_iva: String(data.condicion_iva || 'Responsable Inscripto'),
          telefono: String(data.telefono || '').trim(),
          email: String(data.email || '').trim(),
          direccion: String(data.direccion || '').trim(),
          es_proveedor: true,
          es_taller,
        };
        const res = await api('/api/contactos', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        toast(`${labelTipo} "${nom}" creado`);
        return {
          value: String(res.id),
          label: nom,
          raw: { id: res.id, ...payload, es_proveedor: 1, es_taller: es_taller ? 1 : 0 },
        };
      } catch (err) {
        toast(err.message, true);
        throw err;
      }
    },
  });
}

export async function quickCreateCliente(nombre) {
  try {
    const res = await api('/api/contactos', {
      method: 'POST',
      body: JSON.stringify({ nombre, es_cliente: true }),
    });
    const item = { id: res.id, nombre, es_cliente: 1 };
    toast(`Cliente "${nombre}" creado`);
    return { value: String(res.id), label: nombre, raw: item };
  } catch (err) {
    toast(err.message, true);
    return null;
  }
}

export async function quickCreateCategoria(nombre) {
  try {
    const res = await api('/api/categorias', {
      method: 'POST',
      body: JSON.stringify({ nombre }),
    });
    const item = { id: res.id, nombre };
    toast(`Categoría "${nombre}" creada`);
    return { value: nombre, label: nombre, raw: item };
  } catch (err) {
    toast(err.message, true);
    return null;
  }
}

export async function quickCreateProducto(nombre, { se_fabrica = false, se_compra = true, se_vende = true, udm = 'unidades' } = {}) {
  let categorias = [];
  let unidades = [];
  try {
    const cfg = await api('/api/config');
    categorias = cfg?.categorias || [];
    unidades = cfg?.unidades || [];
  } catch { /* fallback to defaults */ }

  const catOptions = categorias.length
    ? categorias.map(c => ({ value: c.nombre, label: c.nombre }))
    : [{ value: 'Otros insumos', label: 'Otros insumos' }];
  const udmList = unidades.length ? unidades.map(u => u.nombre) : [udm || 'unidades'];
  if (udm && !udmList.includes(udm)) udmList.unshift(udm);

  return showFormModal({
    title: 'Nuevo Producto',
    submitText: 'Crear Producto',
    initialState: {
      nombre: nombre || '',
      codigo: '',
      tipo: 'almacenable',
      categoria: catOptions[0].value,
      udm: udm || udmList[0],
      costo: '0',
      precio: '0',
      se_compra: Boolean(se_compra),
      se_vende: Boolean(se_vende),
      se_fabrica: Boolean(se_fabrica),
    },
    fields: [
      { name: 'nombre', label: 'Nombre', type: 'text', required: true },
      { name: 'codigo', label: 'Código / SKU', type: 'text', placeholder: 'Opcional' },
      {
        name: 'tipo',
        label: 'Tipo',
        type: 'select',
        searchable: false,
        options: [
          { value: 'almacenable', label: 'Almacenable' },
          { value: 'consumible', label: 'Consumible' },
          { value: 'servicio', label: 'Servicio' },
        ],
      },
      { name: 'categoria', label: 'Categoría', type: 'select', searchable: false, options: catOptions },
      {
        name: 'udm',
        label: 'Unidad de Medida',
        type: 'select',
        required: true,
        searchable: false,
        options: udmList.map(u => ({ value: u, label: u })),
      },
      { name: 'costo', label: 'Costo (Compra)', type: 'number', step: '0.01', min: '0' },
      { name: 'precio', label: 'Precio (Venta)', type: 'number', step: '0.01', min: '0' },
      { name: 'se_compra', label: 'Se compra', type: 'checkbox' },
      { name: 'se_vende', label: 'Se vende', type: 'checkbox' },
      { name: 'se_fabrica', label: 'Se fabrica', type: 'checkbox' },
    ],
    onSubmit: async (data) => {
      const nom = String(data.nombre || '').trim();
      if (!nom) return false;
      const udmSel = String(data.udm || udm || 'unidades');
      try {
        const res = await api('/api/plantillas', {
          method: 'POST',
          body: JSON.stringify({
            nombre: nom,
            codigo: String(data.codigo || '').trim(),
            tipo: String(data.tipo || 'almacenable'),
            categoria: String(data.categoria || ''),
            udm: udmSel,
            costo: Number(data.costo) || 0,
            precio: Number(data.precio) || 0,
            se_fabrica: data.se_fabrica ? 1 : 0,
            se_compra: data.se_compra ? 1 : 0,
            se_vende: data.se_vende ? 1 : 0,
          }),
        });
        const prods = await api(`/api/productos?plantilla_id=${res.id}`);
        const prod = prods[0];
        if (!prod) return null;
        toast(`Producto "${nom}" creado`);
        return { value: String(prod.id), label: prod.nombre, sublabel: prod.codigo || prod.udm, raw: prod };
      } catch (err) {
        toast(err.message, true);
        throw err;
      }
    },
  });
}

/**
 * Convierte un <select> nativo en un input buscador sin creación dinámica.
 * Mantiene el <select> oculto en el DOM para preservar FormData, required y listeners existentes.
 */
export function enhanceSelect(selectEl) {
  if (!selectEl || selectEl.tagName !== 'SELECT') return null;
  if (selectEl.multiple || selectEl.dataset.comboEnhanced === '1' || selectEl.dataset.noSearch === '1') return null;
  if (!selectEl.parentNode) return null;

  selectEl.dataset.comboEnhanced = '1';
  selectEl.classList.add('select-sr-hidden');

  const wrap = document.createElement('div');
  wrap.className = 'combo-wrap combo-from-select';
  if (selectEl.style.width) wrap.style.width = selectEl.style.width;
  if (selectEl.style.minWidth) wrap.style.minWidth = selectEl.style.minWidth;
  selectEl.insertAdjacentElement('afterend', wrap);

  let items = [];
  let syncingFromSelect = false;
  let combo = null;

  const readOptions = () => Array.from(selectEl.options)
    .filter(opt => !opt.disabled)
    .map(opt => ({ value: opt.value, label: opt.textContent.trim() }));

  const getEmptyPlaceholder = () => {
    const emptyOpt = Array.from(selectEl.options).find(o => o.value === '');
    return emptyOpt ? emptyOpt.textContent.trim() : 'Buscar...';
  };

  const syncInputDisplay = () => {
    const inputEl = wrap.querySelector('.combo-input');
    if (!inputEl) return;
    const curVal = String(selectEl.value ?? '');
    const match = items.find(i => String(i.value) === curVal);
    inputEl.placeholder = getEmptyPlaceholder();
    inputEl.disabled = Boolean(selectEl.disabled);
    if (!match || match.value === '') {
      inputEl.value = '';
    } else {
      inputEl.value = match.label;
    }
  };

  const mountOrRefresh = () => {
    items = readOptions();
    if (combo?.destroy) combo.destroy();
    combo = mountCombobox(wrap, {
      items,
      value: selectEl.value,
      placeholder: getEmptyPlaceholder(),
      onSelect: (item) => {
        if (syncingFromSelect) return;
        if (!item && !Array.from(selectEl.options).some(o => o.value === '')) return;
        const nextVal = item ? String(item.value) : '';
        if (selectEl.value !== nextVal) {
          selectEl.value = nextVal;
          selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
        syncInputDisplay();
      },
    });
    syncInputDisplay();
  };

  mountOrRefresh();

  selectEl.addEventListener('change', () => {
    syncingFromSelect = true;
    syncInputDisplay();
    syncingFromSelect = false;
  });

  const optObserver = new MutationObserver(() => {
    mountOrRefresh();
  });
  optObserver.observe(selectEl, { childList: true, attributes: true, attributeFilter: ['disabled'] });

  return combo;
}

export function enhanceAllSelects(rootEl = document.body) {
  if (!rootEl) return;
  rootEl.querySelectorAll('select:not([data-combo-enhanced="1"]):not([data-no-search="1"]):not([multiple])').forEach(enhanceSelect);
}

export function observeSelects(rootEl = document.body) {
  if (!rootEl) return;
  enhanceAllSelects(rootEl);
  if (rootEl.__selectObserverAttached) return;
  rootEl.__selectObserverAttached = true;

  let pending = false;
  const observer = new MutationObserver((mutations) => {
    let hasRelevant = false;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.classList?.contains('combo-wrap') || node.classList?.contains('combo-menu')) continue;
        if (node.tagName === 'SELECT' || node.querySelector?.('select:not([data-combo-enhanced="1"]):not([data-no-search="1"]):not([multiple])')) {
          hasRelevant = true;
          break;
        }
      }
      if (hasRelevant) break;
    }
    if (!hasRelevant || pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      enhanceAllSelects(rootEl);
    });
  });
  observer.observe(rootEl, { childList: true, subtree: true });
}
