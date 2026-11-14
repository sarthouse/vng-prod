export function fmtMoney(n) {
  return '$' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
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

export const PROVINCIAS_AR = [
  'Buenos Aires',
  'Ciudad Autónoma de Buenos Aires',
  'Catamarca',
  'Chaco',
  'Chubut',
  'Córdoba',
  'Corrientes',
  'Entre Ríos',
  'Formosa',
  'Jujuy',
  'La Pampa',
  'La Rioja',
  'Mendoza',
  'Misiones',
  'Neuquén',
  'Río Negro',
  'Salta',
  'San Juan',
  'San Luis',
  'Santa Cruz',
  'Santa Fe',
  'Santiago del Estero',
  'Tierra del Fuego',
  'Tucumán',
];

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
      if (res?.numero) numInputEl.value = res.numero;
    } catch (_) { /* ignore */ }
  });
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
