import { esc } from './format.js';
import { api, toast } from './api.js';

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
  container.innerHTML = `
    ${opts.name ? `<input type="hidden" name="${esc(opts.name)}" value="${esc(selectedValue)}" ${opts.required ? 'required' : ''} />` : ''}
    <input type="text" class="combo-input" role="combobox" autocomplete="off" data-bwignore="true" data-lpignore="true" data-1p-ignore="true" data-form-type="other" placeholder="${esc(opts.placeholder || 'Buscar...')}" value="${esc(currentItem()?.label || '')}" />
  `;

  const hiddenEl = opts.name ? container.querySelector('input[type="hidden"]') : null;
  const inputEl = container.querySelector('.combo-input');

  const menuEl = document.createElement('div');
  menuEl.className = 'combo-menu hidden';
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
    if (!inputEl.value.trim() && selectedValue) {
      selectedValue = '';
      if (hiddenEl) hiddenEl.value = '';
      opts.onSelect?.(null);
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

export async function quickCreateProveedor(nombre, { es_taller = false } = {}) {
  try {
    const res = await api('/api/contactos', {
      method: 'POST',
      body: JSON.stringify({ nombre, es_proveedor: true, es_taller }),
    });
    const item = { id: res.id, nombre, es_proveedor: 1, es_taller: es_taller ? 1 : 0 };
    toast(`${es_taller ? 'Destinatario/taller' : 'Proveedor'} "${nombre}" creado`);
    return { value: String(res.id), label: nombre, raw: item };
  } catch (err) {
    toast(err.message, true);
    return null;
  }
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
  try {
    const res = await api('/api/plantillas', {
      method: 'POST',
      body: JSON.stringify({ nombre, se_fabrica, se_compra, se_vende, udm, tipo: 'almacenable' }),
    });
    const prods = await api(`/api/productos?plantilla_id=${res.id}`);
    const prod = prods[0];
    if (!prod) return null;
    toast(`Producto "${nombre}" creado`);
    return { value: String(prod.id), label: prod.nombre, sublabel: prod.codigo || prod.udm, raw: prod };
  } catch (err) {
    toast(err.message, true);
    return null;
  }
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
