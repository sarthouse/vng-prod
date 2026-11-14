import { api } from './api.js';
import { esc, fmtDateAr } from './format.js';

export async function loadEmpresaConfig(empresa) {
  if (empresa) return empresa;
  try {
    const cfg = await api('/api/config');
    return cfg?.empresa || {};
  } catch {
    return {};
  }
}

export function buildEmpresaHeaderInfo(emp = {}) {
  const empresaNombre = emp.razon_social || emp.nombre_fantasia || 'Vanguard Production';
  const empresaLogo = (typeof emp.logo_data === 'string' && emp.logo_data.startsWith('data:image/'))
    ? `<img src="${emp.logo_data}" alt="Logo" class="company-logo" />`
    : '';
  const empresaSub = [
    emp.nombre_fantasia && emp.razon_social && emp.nombre_fantasia !== emp.razon_social ? emp.nombre_fantasia : '',
    emp.cuit ? `CUIT: ${emp.cuit}` : '',
    emp.condicion_iva || '',
  ].filter(Boolean).join(' · ');
  const empresaFiscalExtra = [
    emp.iibb ? `IIBB: ${emp.iibb}` : '',
    emp.inicio_actividades ? `Inicio Act.: ${fmtDateAr(emp.inicio_actividades)}` : '',
  ].filter(Boolean).join(' · ');
  const empresaDir = [emp.direccion, emp.localidad, emp.provincia].filter(Boolean).join(', ');
  const empresaContact = [emp.telefono ? `Tel: ${emp.telefono}` : '', emp.email].filter(Boolean).join(' · ');
  return { empresaNombre, empresaLogo, empresaSub, empresaFiscalExtra, empresaDir, empresaContact };
}

const COPY_LABELS = {
  original: ['ORIGINAL'],
  duplicado: ['ORIGINAL', 'DUPLICADO'],
  triplicado: ['ORIGINAL', 'DUPLICADO', 'TRIPLICADO'],
};

const PAGE_CSS = {
  A4: '@page { size: A4; margin: 12mm; }',
  A5: '@page { size: A5; margin: 8mm; }',
  ticket80: '@page { size: 80mm auto; margin: 2mm; }',
  ticket58: '@page { size: 58mm auto; margin: 1.5mm; }',
};

export async function openPrintWindow({
  title = 'Comprobante',
  empresa = null,
  allowCopies = true,
  extraCss = '',
  renderCopyHtml,
  renderTicketHtml = null,
}) {
  const emp = await loadEmpresaConfig(empresa);
  const win = window.open('', '_blank', 'width=960,height=780');
  if (!win) {
    alert('Permití las ventanas emergentes para imprimir o guardar el PDF.');
    return;
  }

  const defFormato = ['A4', 'A5', 'ticket80', 'ticket58'].includes(emp.print_formato) ? emp.print_formato : 'A4';
  const defCopias = ['original', 'duplicado', 'triplicado'].includes(emp.print_copias) ? emp.print_copias : 'original';
  const defLogo = Number(emp.print_mostrar_logo ?? 1) === 1;
  const defEco = Number(emp.print_modo_economico ?? 0) === 1;
  const pieTexto = (emp.print_pie_comprobante || '').trim();

  const copyKeys = ['original', 'duplicado', 'triplicado'];
  const sheetCopiesByMode = {};
  const ticketCopiesByMode = {};

  for (const mode of copyKeys) {
    const labels = allowCopies ? COPY_LABELS[mode] : ['ORIGINAL'];
    sheetCopiesByMode[mode] = labels.map((copyLabel, idx) => {
      const inner = renderCopyHtml({ emp, copyLabel, copyIndex: idx, totalCopies: labels.length });
      const pieHtml = pieTexto ? `<div class="pie-comprobante">${esc(pieTexto)}</div>` : '';
      return `<div class="sheet">${inner}${pieHtml}</div>`;
    }).join('');

    const tkRenderer = renderTicketHtml || renderCopyHtml;
    ticketCopiesByMode[mode] = labels.map((copyLabel, idx) => {
      const inner = tkRenderer({ emp, copyLabel, copyIndex: idx, totalCopies: labels.length });
      const pieHtml = pieTexto ? `<div class="tk-pie">${esc(pieTexto)}</div>` : '';
      return `<div class="sheet ticket-sheet">${inner}${pieHtml}</div>`;
    }).join('');
  }

  const isTicketInit = defFormato === 'ticket80' || defFormato === 'ticket58';
  const initHtml = (isTicketInit ? ticketCopiesByMode : sheetCopiesByMode)[allowCopies ? defCopias : 'original'];

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>${esc(title)}</title>
  <style id="page-size-style">${PAGE_CSS[defFormato]}</style>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #0F1F2A;
      margin: 0;
      padding: 20px;
      background: #F7FAFC;
      font-size: 13px;
      line-height: 1.42;
    }
    .toolbar {
      max-width: 860px;
      margin: 0 auto 16px;
      padding: 10px 14px;
      background: #fff;
      border: 1px solid #C1CCDD;
      border-radius: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
    }
    .toolbar-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; font-size: 12px; }
    .toolbar-controls label { display: inline-flex; align-items: center; gap: 5px; font-weight: 600; color: #2D3748; }
    .toolbar-controls select { border: 1px solid #C1CCDD; border-radius: 6px; padding: 5px 8px; font-size: 12px; background: #fff; }
    .toolbar-actions { display: flex; gap: 8px; }
    .btn {
      border: 1px solid #C1CCDD;
      background: #fff;
      color: #0F1F2A;
      padding: 7px 13px;
      border-radius: 7px;
      font-weight: 600;
      cursor: pointer;
      font-size: 12.5px;
    }
    .btn-primary { background: #2B6CB0; border-color: #2B6CB0; color: #fff; }
    .sheets-wrap { display: flex; flex-direction: column; gap: 18px; align-items: center; }
    .sheet {
      width: 100%;
      max-width: 820px;
      background: #fff;
      border: 1px solid #C1CCDD;
      border-radius: 8px;
      padding: 26px 30px;
    }
    .company-logo { max-height: 54px; max-width: 170px; object-fit: contain; margin-bottom: 6px; display: block; }
    .copy-pill {
      display: inline-block;
      border: 1px solid #0F1F2A;
      padding: 1px 7px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.6px;
      margin-bottom: 4px;
    }
    .doc-header {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      gap: 16px;
      align-items: start;
      border-bottom: 2px solid #0F1F2A;
      padding-bottom: 14px;
      margin-bottom: 16px;
    }
    .doc-letter {
      width: 48px;
      height: 48px;
      border: 2px solid #0F1F2A;
      border-radius: 8px;
      display: grid;
      place-items: center;
      font-size: 22px;
      font-weight: 800;
      margin: 0 auto;
    }
    .doc-letter-sub { text-align: center; font-size: 9.5px; color: #4A5568; margin-top: 4px; text-transform: uppercase; }
    .doc-title { text-align: right; }
    .doc-badge {
      display: inline-block;
      background: #0F1F2A;
      color: #FFC241;
      padding: 4px 10px;
      border-radius: 5px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      margin-bottom: 5px;
    }
    .doc-num { font-size: 18px; font-weight: 700; }
    .muted { color: #4A5568; font-size: 12px; }
    .meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 16px;
      padding: 10px 14px;
      background: #F7FAFC;
      border: 1px solid #EDF2F7;
      border-radius: 6px;
    }
    .meta-item span { display: block; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.4px; color: #718096; font-weight: 600; }
    .meta-item strong { font-size: 13px; color: #0F1F2A; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    th {
      text-align: left;
      padding: 7px 9px;
      background: #EDF2F7;
      border-bottom: 2px solid #C1CCDD;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }
    td { padding: 7px 9px; border-bottom: 1px solid #EDF2F7; vertical-align: top; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .bottom-grid { display: grid; grid-template-columns: 1fr 270px; gap: 18px; align-items: start; margin-top: 6px; }
    .note-box { padding: 9px 12px; background: #F7FAFC; border: 1px solid #EDF2F7; border-radius: 6px; font-size: 12px; }
    .totals-box { border: 1px solid #C1CCDD; border-radius: 6px; padding: 10px 14px; background: #F7FAFC; }
    .tot-row { display: flex; justify-content: space-between; align-items: center; padding: 3px 0; font-size: 12.5px; }
    .tot-row.grand { border-top: 2px solid #0F1F2A; margin-top: 6px; padding-top: 7px; font-size: 16px; font-weight: 800; }
    .cae-box { margin-top: 16px; padding-top: 10px; border-top: 1px dashed #C1CCDD; display: flex; justify-content: space-between; align-items: center; font-size: 12px; }
    .sign-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 32px; }
    .sign-box { border-top: 1px solid #718096; padding-top: 6px; text-align: center; font-size: 11px; color: #4A5568; }
    .pie-comprobante { margin-top: 14px; padding-top: 8px; border-top: 1px solid #EDF2F7; text-align: center; font-size: 11px; color: #4A5568; }

    /* A5 */
    body.fmt-A5 { font-size: 11px; }
    body.fmt-A5 .sheet { max-width: 540px; padding: 16px 18px; }
    body.fmt-A5 .doc-header { gap: 10px; padding-bottom: 10px; margin-bottom: 12px; }
    body.fmt-A5 .doc-letter { width: 38px; height: 38px; font-size: 18px; }
    body.fmt-A5 .doc-num { font-size: 14.5px; }
    body.fmt-A5 .meta-grid { padding: 8px 10px; gap: 8px; margin-bottom: 12px; }
    body.fmt-A5 th, body.fmt-A5 td { padding: 5px 6px; font-size: 10.5px; }
    body.fmt-A5 .bottom-grid { grid-template-columns: 1fr 210px; gap: 12px; }
    body.fmt-A5 .tot-row.grand { font-size: 13.5px; }

    /* Formato Ticket Térmico Simple (80mm / 58mm) */
    .ticket-sheet {
      font-family: ui-monospace, "Cascadia Mono", "Consolas", monospace;
      color: #000;
      background: #fff;
      border-radius: 0;
      border: 1px dashed #94A3B8;
      line-height: 1.32;
    }
    body.fmt-ticket80 .ticket-sheet { max-width: 80mm; padding: 4mm; font-size: 11px; }
    body.fmt-ticket58 .ticket-sheet { max-width: 58mm; padding: 2.5mm; font-size: 9.5px; }
    .ticket-sheet .company-logo { margin: 0 auto 4px; max-height: 34px; max-width: 110px; }
    .tk-center { text-align: center; }
    .tk-title { font-weight: 700; font-size: 1.15em; text-transform: uppercase; }
    .tk-sub { font-size: 0.9em; }
    .tk-hr { border-top: 1px dashed #000; margin: 6px 0; }
    .tk-row { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
    .tk-item { margin-bottom: 4px; }
    .tk-item-name { font-weight: 600; word-break: break-word; }
    .tk-item-sub { display: flex; justify-content: space-between; gap: 6px; font-size: 0.92em; }
    .tk-total { display: flex; justify-content: space-between; font-weight: 800; font-size: 1.25em; margin-top: 4px; }
    .tk-sign { margin-top: 22px; border-top: 1px solid #000; padding-top: 3px; text-align: center; font-size: 0.9em; }
    .tk-pie { margin-top: 8px; padding-top: 5px; border-top: 1px dashed #000; text-align: center; font-size: 0.9em; }

    /* Opciones */
    body.hide-logo .company-logo { display: none !important; }
    body.eco-mode .doc-badge { background: #fff !important; color: #000 !important; border: 1px solid #000; }
    body.eco-mode .meta-grid,
    body.eco-mode .totals-box,
    body.eco-mode .note-box,
    body.eco-mode th,
    body.eco-mode .saldo-pill {
      background: #fff !important;
      color: #000 !important;
      border-color: #000 !important;
    }

    ${extraCss}

    @media print {
      body { background: #fff; padding: 0; }
      .toolbar { display: none !important; }
      .sheets-wrap { gap: 0; display: block; }
      .sheet {
        border: none;
        border-radius: 0;
        padding: 0;
        max-width: 100% !important;
        page-break-after: always;
      }
      .sheet:last-child { page-break-after: auto; }
      .ticket-sheet {
        page-break-after: auto;
        border-bottom: 1px dashed #000;
        padding: 0 0 8px 0;
        margin-bottom: 10px;
      }
      .ticket-sheet:last-child { border-bottom: none; margin-bottom: 0; }
    }
  </style>
</head>
<body class="fmt-${esc(defFormato)}${defLogo ? '' : ' hide-logo'}${defEco ? ' eco-mode' : ''}">
  <div class="toolbar">
    <div class="toolbar-controls">
      <label>Formato
        <select id="opt-formato">
          <option value="A4" ${defFormato === 'A4' ? 'selected' : ''}>A4</option>
          <option value="A5" ${defFormato === 'A5' ? 'selected' : ''}>A5</option>
          <option value="ticket80" ${defFormato === 'ticket80' ? 'selected' : ''}>Ticket 80mm</option>
          <option value="ticket58" ${defFormato === 'ticket58' ? 'selected' : ''}>Ticket 58mm</option>
        </select>
      </label>
      ${allowCopies ? `
        <label>Copias
          <select id="opt-copias">
            <option value="original" ${defCopias === 'original' ? 'selected' : ''}>Original</option>
            <option value="duplicado" ${defCopias === 'duplicado' ? 'selected' : ''}>Original + Duplicado</option>
            <option value="triplicado" ${defCopias === 'triplicado' ? 'selected' : ''}>Original + Duplicado + Triplicado</option>
          </select>
        </label>
      ` : ''}
      <label><input type="checkbox" id="opt-logo" ${defLogo ? 'checked' : ''} /> Logo</label>
      <label><input type="checkbox" id="opt-eco" ${defEco ? 'checked' : ''} /> B/N Económico</label>
    </div>
    <div class="toolbar-actions">
      <button type="button" class="btn" onclick="window.close()">Cerrar</button>
      <button type="button" class="btn btn-primary" onclick="window.print()">Imprimir / Guardar PDF</button>
    </div>
  </div>

  <div class="sheets-wrap" id="sheets-wrap">${initHtml}</div>

  <script>
    (function() {
      const sheetCopies = ${JSON.stringify(sheetCopiesByMode)};
      const ticketCopies = ${JSON.stringify(ticketCopiesByMode)};
      const pageCss = ${JSON.stringify(PAGE_CSS)};
      const fmtSel = document.getElementById('opt-formato');
      const copSel = document.getElementById('opt-copias');
      const logoCb = document.getElementById('opt-logo');
      const ecoCb = document.getElementById('opt-eco');
      const wrap = document.getElementById('sheets-wrap');
      const pageStyle = document.getElementById('page-size-style');

      const syncContent = () => {
        if (!wrap) return;
        const fmt = fmtSel ? fmtSel.value : 'A4';
        const cop = copSel ? copSel.value : 'original';
        const isTk = fmt === 'ticket80' || fmt === 'ticket58';
        const map = isTk ? ticketCopies : sheetCopies;
        wrap.innerHTML = map[cop] || map.original;
      };

      if (fmtSel) {
        fmtSel.addEventListener('change', () => {
          document.body.classList.remove('fmt-A4', 'fmt-A5', 'fmt-ticket80', 'fmt-ticket58');
          document.body.classList.add('fmt-' + fmtSel.value);
          if (pageStyle) pageStyle.textContent = pageCss[fmtSel.value] || pageCss.A4;
          syncContent();
        });
      }
      if (copSel) {
        copSel.addEventListener('change', syncContent);
      }
      if (logoCb) {
        logoCb.addEventListener('change', () => document.body.classList.toggle('hide-logo', !logoCb.checked));
      }
      if (ecoCb) {
        ecoCb.addEventListener('change', () => document.body.classList.toggle('eco-mode', ecoCb.checked));
      }
    })();
  </script>
</body>
</html>`;

  win.document.open();
  win.document.write(html);
  win.document.close();
}
