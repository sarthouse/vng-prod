import { JURISDICCIONES_AR, PROVINCIAS_AR, getJurisdiccionByProvincia } from './jurisdicciones.js';

export { JURISDICCIONES_AR, PROVINCIAS_AR, getJurisdiccionByProvincia };

export function fmtMoney(n) {
  return '$' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function fmtMoneyInput(n) {
  return '$ ' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const MONEY_INCLUDE_RE = /(costo|precio|price|monto|importe|saldo|tarifa|limite_credito|minimo_no_imponible|debe|haber|subtotal|total|fijo|efectivo|base)/i;
const MONEY_EXCLUDE_RE = /(pct|porcentaje|alicuota|cantidad|stock|dias|orden|padding|punto_venta|peso|coeficiente|tipo_cambio|cotizacion|moneda|minimo_compra|min_compra|no-money)/i;

function isMoneyNumberInput(el) {
  if (!el || el.tagName !== 'INPUT' || el.type !== 'number') return false;
  if (el.dataset.moneyInit === '1' || el.hasAttribute('data-no-money')) return false;
  if (el.dataset.money === '1') return true;
  const sig = [
    el.name || '',
    el.id || '',
    el.className || '',
    el.placeholder || '',
    el.title || '',
    ...Object.keys(el.dataset || {}),
  ].join(' ');
  if (MONEY_EXCLUDE_RE.test(sig)) return false;
  return MONEY_INCLUDE_RE.test(sig);
}

const valueDesc = typeof HTMLInputElement !== 'undefined'
  ? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  : null;

function enhanceMoneyInput(input) {
  if (!isMoneyNumberInput(input) || !input.parentNode) return;
  input.dataset.moneyInit = '1';
  input.classList.add('money-input');

  const wrap = document.createElement('span');
  wrap.className = 'money-wrap';
  if (input.style.width) {
    wrap.style.width = input.style.width;
    input.style.width = '100%';
  }
  if (input.style.minWidth) {
    wrap.style.minWidth = input.style.minWidth;
    input.style.minWidth = '0';
  }
  if (input.style.flex) {
    wrap.style.flex = input.style.flex;
  }

  const display = document.createElement('span');
  display.className = 'money-display';
  const isRight = input.style.textAlign === 'right' || input.closest('td.num, th.num');
  display.style.justifyContent = isRight ? 'flex-end' : 'flex-start';

  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  wrap.appendChild(display);

  const syncDisplay = () => {
    const raw = valueDesc ? valueDesc.get.call(input) : input.value;
    if (raw === '' || raw === null || raw === undefined) {
      display.textContent = '';
      display.classList.add('is-empty');
    } else {
      display.textContent = fmtMoneyInput(Number(raw) || 0);
      display.classList.remove('is-empty');
    }
  };

  if (valueDesc && valueDesc.configurable) {
    Object.defineProperty(input, 'value', {
      configurable: true,
      get() { return valueDesc.get.call(this); },
      set(v) {
        valueDesc.set.call(this, v);
        syncDisplay();
      },
    });
  }

  input.addEventListener('input', syncDisplay);
  input.addEventListener('change', syncDisplay);
  input.addEventListener('blur', syncDisplay);
  syncDisplay();
}

export function observeMoneyInputs(root = document.body) {
  if (!root || typeof MutationObserver === 'undefined') return;
  const scan = (node) => {
    if (!node || node.nodeType !== 1) return;
    if (node.tagName === 'INPUT') enhanceMoneyInput(node);
    node.querySelectorAll?.('input[type="number"]').forEach(enhanceMoneyInput);
  };
  scan(root);
  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const added of m.addedNodes) scan(added);
    }
  });
  obs.observe(root, { childList: true, subtree: true });
}

export function fmtNum(n, dec = 3) {
  const v = Number(n || 0);
  if (Number.isInteger(v)) return v.toLocaleString('es-AR');
  return v.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: dec });
}

export function fmtDateAr(val) {
  const s = String(val || '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

export const fmtDate = fmtDateAr;

export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function badgeForEstado(estado) {
  const e = (estado || '').toLowerCase();
  if (e.includes('entregado')) return `<span class="badge badge-entregado">${esc(estado)}</span>`;
  if (e.includes('parcial')) return `<span class="badge badge-parcial">${esc(estado)}</span>`;
  if (e.includes('cancel')) return `<span class="badge badge-cancelado">${esc(estado)}</span>`;
  return `<span class="badge badge-confirmado">${esc(estado)}</span>`;
}

export function badgeForTipo(tipo) {
  const t = (tipo || 'almacenable').toLowerCase();
  if (t === 'servicio') return '<span class="badge badge-warn">Servicio</span>';
  if (t === 'consumible') return '<span class="badge badge-confirmado">Consumible</span>';
  return '<span class="badge badge-ok">Almacenable</span>';
}

export function renderProvinciaOptions(selected = '') {
  const cur = String(selected || '').trim();
  const list = cur && !PROVINCIAS_AR.includes(cur) ? [cur, ...PROVINCIAS_AR] : PROVINCIAS_AR;
  return `<option value="">-- Seleccionar --</option>` + list
    .map(p => `<option value="${esc(p)}" ${p === cur ? 'selected' : ''}>${esc(p)}</option>`)
    .join('');
}

export function renderPuntoVentaOptions(puntosVenta = [], selectedNum = null) {
  const activos = (puntosVenta || []).filter(pv => pv.activo !== 0);
  const def = activos.find(pv => pv.es_default) || activos[0];
  const sel = selectedNum != null ? Number(selectedNum) : (def?.numero ?? 1);
  if (activos.length === 0) return '<option value="1" selected>0001 — Casa Central</option>';
  return activos.map(pv => {
    const pad = String(pv.numero).padStart(4, '0');
    return `<option value="${pv.numero}" ${Number(pv.numero) === sel ? 'selected' : ''}>${pad} — ${esc(pv.nombre || 'PV ' + pad)}</option>`;
  }).join('');
}

export function bindPuntoVentaSeq(pvSelectEl, numInputEl, tipo, apiFn) {
  if (!pvSelectEl || !numInputEl) return;
  pvSelectEl.addEventListener('change', async () => {
    try {
      const res = await apiFn(`/api/secuencias/siguiente?tipo=${encodeURIComponent(tipo)}&pv=${encodeURIComponent(pvSelectEl.value)}`);
      if (res) {
        if (res.prefijo !== undefined) numInputEl.dataset.seqPrefijo = res.prefijo || '';
        if (res.sufijo !== undefined) numInputEl.dataset.seqSufijo = res.sufijo || '';
        if (res.padding !== undefined) numInputEl.dataset.seqPadding = String(res.padding || 8);
        if (res.numero) numInputEl.value = res.numero;
      }
    } catch (_) { /* ignore */ }
  });
}

export function formatComprobanteNumero(raw, { padding = 8, pvDefault = 1, prefijo = '', sufijo = '' } = {}) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const pad = Math.max(1, Number(padding) || 8);
  const suf = String(sufijo || '');
  const withoutSuf = suf && s.endsWith(suf) ? s.slice(0, s.length - suf.length).trim() : s;
  const m = withoutSuf.match(/^([A-Za-z-]+(?:\s+))?(\d+)(?:\s*[-/\s]\s*(\d+))?$/);
  if (!m) return s;
  const resolvedPref = m[1] ? m[1].trim() : String(prefijo || '').trim();
  const prefix = resolvedPref ? `${resolvedPref} ` : '';
  if (m[3] !== undefined) {
    const pv = String(parseInt(m[2], 10) || 0).padStart(4, '0');
    const num = String(parseInt(m[3], 10) || 0).padStart(pad, '0');
    return `${prefix}${pv}-${num}${suf}`;
  }
  const pv = String(parseInt(pvDefault, 10) || 1).padStart(4, '0');
  const num = String(parseInt(m[2], 10) || 0).padStart(pad, '0');
  return `${prefix}${pv}-${num}${suf}`;
}

export function bindNumeroPadding(numInputEl, getOpts = () => ({})) {
  if (!numInputEl || numInputEl.dataset.padBound === '1') return;
  numInputEl.dataset.padBound = '1';
  const apply = () => {
    const opts = getOpts() || {};
    const merged = {
      padding: opts.padding ?? (numInputEl.dataset.seqPadding ? Number(numInputEl.dataset.seqPadding) : undefined),
      prefijo: opts.prefijo ?? numInputEl.dataset.seqPrefijo ?? '',
      sufijo: opts.sufijo ?? numInputEl.dataset.seqSufijo ?? '',
      pvDefault: opts.pvDefault,
    };
    const formatted = formatComprobanteNumero(numInputEl.value, merged);
    if (formatted && formatted !== numInputEl.value) {
      numInputEl.value = formatted;
      numInputEl.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };
  numInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      apply();
    }
  });
  numInputEl.addEventListener('blur', apply);
  if (numInputEl.value) apply();
}

export function compressImageToDataUrl(file, { maxDim = 900, quality = 0.82 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file) { resolve(''); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Archivo de imagen inválido'));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function isSafeUrl(url, { allowData = false, allowDataImage = false, allowDataVideo = false } = {}) {
  const s = String(url || '').trim();
  if (!s) return false;
  if (/^(https?:\/\/|mailto:|\/)/i.test(s)) return true;
  if (allowData && /^data:/i.test(s) && !/^data:text\/html/i.test(s)) return true;
  if (allowDataImage && /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(s)) return true;
  if (allowDataVideo && /^data:video\/(mp4|webm|ogg);base64,/i.test(s)) return true;
  return false;
}

function toVideoEmbedUrl(url) {
  const s = String(url || '').trim();
  const yt = s.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vm = s.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return null;
}

export function sanitizeRichHtml(html) {
  if (!html) return '';
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html);
  tpl.content.querySelectorAll('script,style,object,embed').forEach(el => el.remove());
  tpl.content.querySelectorAll('iframe').forEach(el => {
    const src = el.getAttribute('src') || '';
    if (!/^https:\/\/(www\.youtube\.com\/embed\/|player\.vimeo\.com\/video\/)/i.test(src)) {
      el.remove();
    }
  });
  tpl.content.querySelectorAll('*').forEach(el => {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('on') || attr.name === 'style') el.removeAttribute(attr.name);
    }
    const tag = el.tagName;
    if (tag === 'A') {
      const href = el.getAttribute('href') || '';
      if (!isSafeUrl(href, { allowData: true })) el.removeAttribute('href');
      else {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      }
    } else if (tag === 'IMG') {
      const src = el.getAttribute('src') || '';
      if (!isSafeUrl(src, { allowDataImage: true })) el.remove();
    } else if (tag === 'VIDEO') {
      const src = el.getAttribute('src') || '';
      if (!isSafeUrl(src, { allowDataVideo: true })) el.remove();
      else el.setAttribute('controls', '');
    }
  });
  return tpl.innerHTML.trim();
}

export function mountRichEditor(container, { value = '', placeholder = 'Escribí especificaciones técnicas, terminaciones, costuras...' } = {}) {
  if (!container) return null;
  container.innerHTML = `
    <div class="rich-editor">
      <div class="rich-toolbar">
        <button type="button" class="btn btn-sm" data-cmd="bold" title="Negrita"><strong>B</strong></button>
        <button type="button" class="btn btn-sm" data-cmd="italic" title="Cursiva"><em>I</em></button>
        <button type="button" class="btn btn-sm" data-cmd="underline" title="Subrayado"><u>U</u></button>
        <button type="button" class="btn btn-sm" data-cmd="formatBlock" data-val="H3" title="Título">Título</button>
        <button type="button" class="btn btn-sm" data-cmd="formatBlock" data-val="P" title="Párrafo">Texto</button>
        <button type="button" class="btn btn-sm" data-cmd="insertUnorderedList" title="Lista con viñetas">• Lista</button>
        <button type="button" class="btn btn-sm" data-cmd="insertOrderedList" title="Lista numerada">1. Lista</button>
        <span class="rich-sep"></span>
        <button type="button" class="btn btn-sm" data-rich-action="link" title="Insertar enlace">🔗 Link</button>
        <button type="button" class="btn btn-sm" data-rich-action="image" title="Insertar imagen">🖼️ Imagen</button>
        <button type="button" class="btn btn-sm" data-rich-action="video" title="Insertar video">🎬 Video</button>
        <button type="button" class="btn btn-sm" data-rich-action="file" title="Adjuntar archivo">📎 Archivo</button>
        <span class="rich-sep"></span>
        <button type="button" class="btn btn-sm" data-cmd="removeFormat" title="Limpiar formato">Limpiar</button>
      </div>
      <div class="rich-popover hidden" id="rich-popover"></div>
      <input type="file" class="hidden" data-rich-file="image" accept="image/jpeg,image/png,image/webp,image/gif" />
      <input type="file" class="hidden" data-rich-file="video" accept="video/mp4,video/webm,video/ogg" />
      <input type="file" class="hidden" data-rich-file="file" />
      <div class="rich-body" contenteditable="true" data-placeholder="${esc(placeholder)}">${sanitizeRichHtml(value)}</div>
    </div>
  `;
  const bodyEl = container.querySelector('.rich-body');
  const popoverEl = container.querySelector('#rich-popover');
  const imgInput = container.querySelector('[data-rich-file="image"]');
  const vidInput = container.querySelector('[data-rich-file="video"]');
  const fileInput = container.querySelector('[data-rich-file="file"]');
  let savedRange = null;

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && bodyEl.contains(sel.anchorNode)) {
      savedRange = sel.getRangeAt(0).cloneRange();
    }
  };
  const restoreSelection = () => {
    bodyEl.focus();
    if (savedRange) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
  };
  const insertHtmlAtCursor = (html) => {
    restoreSelection();
    document.execCommand('insertHTML', false, html);
    savedRange = null;
  };
  const closePopover = () => {
    popoverEl.classList.add('hidden');
    popoverEl.innerHTML = '';
  };

  bodyEl.addEventListener('mouseup', saveSelection);
  bodyEl.addEventListener('keyup', saveSelection);

  container.querySelectorAll('[data-cmd]').forEach(btn => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      bodyEl.focus();
      document.execCommand(btn.dataset.cmd, false, btn.dataset.val || null);
    });
  });

  container.querySelectorAll('[data-rich-action]').forEach(btn => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      saveSelection();
      const action = btn.dataset.richAction;
      if (action === 'link') {
        const selectedText = savedRange ? savedRange.toString() : '';
        popoverEl.innerHTML = `
          <input type="url" class="rich-pop-url sx-d6981a" placeholder="https://ejemplo.com" />
          <input type="text" class="rich-pop-text sx-edf49a" placeholder="Texto del link (opcional)" value="${esc(selectedText)}" />
          <button type="button" class="btn btn-sm btn-primary rich-pop-ok">Insertar</button>
          <button type="button" class="btn btn-sm rich-pop-cancel">Cancelar</button>
        `;
        popoverEl.classList.remove('hidden');
        const urlIn = popoverEl.querySelector('.rich-pop-url');
        const txtIn = popoverEl.querySelector('.rich-pop-text');
        urlIn.focus();
        popoverEl.querySelector('.rich-pop-cancel').addEventListener('click', closePopover);
        popoverEl.querySelector('.rich-pop-ok').addEventListener('click', () => {
          const url = urlIn.value.trim();
          if (!isSafeUrl(url)) return;
          const label = txtIn.value.trim() || url;
          insertHtmlAtCursor(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>&nbsp;`);
          closePopover();
        });
      } else if (action === 'image') {
        popoverEl.innerHTML = `
          <input type="url" class="rich-pop-url sx-f6e081" placeholder="Pegar URL de imagen (https://...)" />
          <button type="button" class="btn btn-sm btn-primary rich-pop-ok">Insertar URL</button>
          <button type="button" class="btn btn-sm rich-pop-upload">Subir Archivo</button>
          <button type="button" class="btn btn-sm rich-pop-cancel">Cancelar</button>
        `;
        popoverEl.classList.remove('hidden');
        popoverEl.querySelector('.rich-pop-cancel').addEventListener('click', closePopover);
        popoverEl.querySelector('.rich-pop-upload').addEventListener('click', () => { closePopover(); imgInput.click(); });
        popoverEl.querySelector('.rich-pop-ok').addEventListener('click', () => {
          const url = popoverEl.querySelector('.rich-pop-url').value.trim();
          if (!isSafeUrl(url, { allowDataImage: true })) return;
          insertHtmlAtCursor(`<img src="${esc(url)}" alt="Imagen" class="rich-media-img" />`);
          closePopover();
        });
      } else if (action === 'video') {
        popoverEl.innerHTML = `
          <input type="url" class="rich-pop-url sx-28a1ea" placeholder="URL de YouTube, Vimeo o MP4" />
          <button type="button" class="btn btn-sm btn-primary rich-pop-ok">Insertar URL</button>
          <button type="button" class="btn btn-sm rich-pop-upload">Subir Video (máx. 8MB)</button>
          <button type="button" class="btn btn-sm rich-pop-cancel">Cancelar</button>
        `;
        popoverEl.classList.remove('hidden');
        popoverEl.querySelector('.rich-pop-cancel').addEventListener('click', closePopover);
        popoverEl.querySelector('.rich-pop-upload').addEventListener('click', () => { closePopover(); vidInput.click(); });
        popoverEl.querySelector('.rich-pop-ok').addEventListener('click', () => {
          const url = popoverEl.querySelector('.rich-pop-url').value.trim();
          if (!url) return;
          const embed = toVideoEmbedUrl(url);
          if (embed) {
            insertHtmlAtCursor(`<iframe src="${esc(embed)}" class="rich-media-video" allowfullscreen></iframe><p><br></p>`);
          } else if (isSafeUrl(url, { allowDataVideo: true })) {
            insertHtmlAtCursor(`<video src="${esc(url)}" class="rich-media-video" controls></video><p><br></p>`);
          }
          closePopover();
        });
      } else if (action === 'file') {
        fileInput.click();
      }
    });
  });

  imgInput.addEventListener('change', async () => {
    const f = imgInput.files?.[0];
    imgInput.value = '';
    if (!f) return;
    const dataUrl = await compressImageToDataUrl(f, { maxDim: 960, quality: 0.82 });
    if (dataUrl) insertHtmlAtCursor(`<img src="${esc(dataUrl)}" alt="${esc(f.name)}" class="rich-media-img" />`);
  });

  const readFileAsDataUrl = (file, maxBytes, label) => new Promise((resolve) => {
    if (file.size > maxBytes) {
      alert(`El ${label} supera el tamaño máximo permitido (${Math.round(maxBytes / (1024 * 1024))} MB).`);
      resolve('');
      return;
    }
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => resolve('');
    r.readAsDataURL(file);
  });

  vidInput.addEventListener('change', async () => {
    const f = vidInput.files?.[0];
    vidInput.value = '';
    if (!f) return;
    const dataUrl = await readFileAsDataUrl(f, 8 * 1024 * 1024, 'video');
    if (dataUrl) insertHtmlAtCursor(`<video src="${esc(dataUrl)}" class="rich-media-video" controls></video><p><br></p>`);
  });

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (!f) return;
    const dataUrl = await readFileAsDataUrl(f, 5 * 1024 * 1024, 'archivo');
    if (dataUrl) {
      const sizeKb = Math.max(1, Math.round(f.size / 1024));
      insertHtmlAtCursor(`<a href="${esc(dataUrl)}" download="${esc(f.name)}" class="rich-file-chip">📎 ${esc(f.name)} (${sizeKb} KB)</a>&nbsp;`);
    }
  });

  return {
    getHtml: () => sanitizeRichHtml(bodyEl.innerHTML),
    setHtml: (html) => { bodyEl.innerHTML = sanitizeRichHtml(html); },
  };
}

export function setupFileDropzones(container) {
  if (!container) return;
  container.querySelectorAll('input[type="file"]').forEach((input) => {
    if (input.dataset.dropzoneReady === '1') return;
    input.dataset.dropzoneReady = '1';

    const zone = document.createElement('div');
    zone.className = 'file-dropzone';
    zone.tabIndex = 0;

    const label = document.createElement('div');
    label.className = 'file-dropzone-label';
    label.textContent = 'Arrastrá y soltá el archivo acá, o hacé clic para elegir';

    const hint = document.createElement('div');
    hint.className = 'file-dropzone-hint';
    hint.textContent = input.accept ? `Formatos: ${input.accept}` : 'Cualquier archivo';

    input.parentNode.insertBefore(zone, input);
    zone.appendChild(input);
    zone.appendChild(label);
    zone.appendChild(hint);

    const updateLabel = (files) => {
      if (files && files.length > 0) {
        label.textContent = `Archivo cargado: ${files[0].name}`;
      }
    };

    zone.addEventListener('click', () => input.click());
    zone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        input.click();
      }
    });

    ['dragenter', 'dragover'].forEach((evt) => {
      zone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.add('dragover');
      });
    });

    ['dragleave', 'dragend'].forEach((evt) => {
      zone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove('dragover');
      });
    });

    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove('dragover');
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(f);
      input.files = dt.files;
      updateLabel(input.files);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    input.addEventListener('change', () => updateLabel(input.files));
  });
}

export function downloadCSV(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportRowsToCSV(headers, rows, filename) {
  const escCell = (v) => {
    const s = String(v ?? '').replace(/\r?\n/g, ' ');
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    headers.map(escCell).join(';'),
    ...rows.map(r => r.map(escCell).join(';')),
  ];
  downloadCSV('\uFEFF' + lines.join('\r\n'), filename);
}

const METODOS_POR_TIPO_CUENTA = {
  efectivo: ['Efectivo'],
  banco: ['Transferencia', 'Cheque'],
  billetera: ['MercadoPago', 'Transferencia', 'Otro'],
};
const ALL_METODOS_PAGO = ['Transferencia', 'Efectivo', 'Cheque', 'MercadoPago', 'Otro'];

export function getMetodosForCuenta(cuenta) {
  return METODOS_POR_TIPO_CUENTA[cuenta?.tipo] || ALL_METODOS_PAGO;
}

export function formatDocumento(raw, tipo = 'CUIT') {
  const str = String(raw || '').trim();
  if (!str) return '';
  const t = String(tipo || 'CUIT').toUpperCase();
  if (t === 'CUIT' || t === 'CUIL' || t === 'CDI') {
    const digits = str.replace(/\D/g, '').slice(0, 11);
    if (digits.length === 11) {
      return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
    }
    if (digits.length > 2 && digits.length <= 10) {
      return `${digits.slice(0, 2)}-${digits.slice(2)}`;
    }
    return digits;
  }
  if (t === 'DNI') {
    const digits = str.replace(/\D/g, '').slice(0, 9);
    if (!digits) return '';
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
  return str;
}

export function bindDocumentoInput(inputEl, tipoSelectOrGetter = 'CUIT') {
  if (!inputEl) return;
  const getTipo = typeof tipoSelectOrGetter === 'function'
    ? tipoSelectOrGetter
    : (tipoSelectOrGetter && typeof tipoSelectOrGetter === 'object'
        ? () => tipoSelectOrGetter.value
        : () => String(tipoSelectOrGetter || 'CUIT'));
  const apply = () => {
    const formatted = formatDocumento(inputEl.value, getTipo());
    if (formatted !== inputEl.value) inputEl.value = formatted;
  };
  inputEl.addEventListener('blur', apply);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') apply();
  });
  if (tipoSelectOrGetter && typeof tipoSelectOrGetter === 'object') {
    tipoSelectOrGetter.addEventListener('change', apply);
  }
  apply();
}

export function bindCuentaMetodoSync(cuentaSelect, metodoSelect, cuentas = [], onMetodoChange = null) {
  if (!cuentaSelect || !metodoSelect) return;
  const sync = () => {
    const cta = cuentas.find(c => String(c.id) === String(cuentaSelect.value));
    const allowed = getMetodosForCuenta(cta);
    const prev = metodoSelect.value;
    metodoSelect.innerHTML = allowed.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
    metodoSelect.value = allowed.includes(prev) ? prev : allowed[0];
    if (typeof onMetodoChange === 'function') onMetodoChange(metodoSelect.value);
  };
  cuentaSelect.addEventListener('change', sync);
  sync();
}

export function isDocHidden(doc) {
  return Boolean(Number(doc?.archivado || 0) === 1 || ['Anulada', 'Anulado', 'Cancelado', 'Cancelada'].includes(doc?.estado));
}

export function filterVisibleDocs(docs = [], showHidden = false) {
  return showHidden ? docs : (docs || []).filter(d => !isDocHidden(d));
}

export function renderDocEstadoBadges(doc) {
  return badgeForEstado(doc?.estado || 'Confirmado')
    + (Number(doc?.archivado || 0) === 1 ? ' <span class="badge badge-muted">Archivado</span>' : '');
}

export function buildArchivarBulkActions({ api, toast, endpointPrefix, onDone, showHidden }) {
  const actions = [
    {
      id: 'archivar',
      label: 'Archivar',
      confirm: (sel) => {
        const n = sel.filter(d => Number(d.archivado || 0) !== 1).length;
        return n ? `¿Archivar ${n} documento(s) seleccionado(s)?` : null;
      },
      onClick: async (sel) => {
        const targets = sel.filter(d => Number(d.archivado || 0) !== 1);
        if (!targets.length) { toast('No hay documentos sin archivar en la selección', true); return; }
        let ok = 0; let errs = 0;
        for (const d of targets) {
          try { await api(`${endpointPrefix}/${d.id}/archivar`, { method: 'POST', body: JSON.stringify({ archivado: true }) }); ok++; }
          catch { errs++; }
        }
        toast(`${ok} archivado(s)${errs ? `, ${errs} con error` : ''}`, errs > 0 && ok === 0);
        await onDone();
      },
    },
  ];
  if (showHidden) {
    actions.push({
      id: 'desarchivar',
      label: 'Desarchivar',
      confirm: (sel) => {
        const n = sel.filter(d => Number(d.archivado || 0) === 1).length;
        return n ? `¿Desarchivar ${n} documento(s) seleccionado(s)?` : null;
      },
      onClick: async (sel) => {
        const targets = sel.filter(d => Number(d.archivado || 0) === 1);
        if (!targets.length) { toast('No hay documentos archivados en la selección', true); return; }
        let ok = 0; let errs = 0;
        for (const d of targets) {
          try { await api(`${endpointPrefix}/${d.id}/archivar`, { method: 'POST', body: JSON.stringify({ archivado: false }) }); ok++; }
          catch { errs++; }
        }
        toast(`${ok} desarchivado(s)${errs ? `, ${errs} con error` : ''}`, errs > 0 && ok === 0);
        await onDone();
      },
    });
  }
  return actions;
}
