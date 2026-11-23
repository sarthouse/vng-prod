import { PdfDocument, PAGE_SIZES_MM, fmtDateAr } from './pdfBuilder.js';
import { getPrintTheme, stampUnifiedFooter, fmtMoneyAr } from './printLayout.js';

function numeroALetrasEntero(n) {
  const num = Math.floor(Math.abs(Number(n) || 0));
  if (num === 0) return 'cero';
  const unidades = ['', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiún', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
  const decenas = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
  const centenas = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

  function menorMil(x) {
    if (x === 0) return '';
    if (x === 100) return 'cien';
    const c = Math.floor(x / 100);
    const resto = x % 100;
    const cTxt = c > 0 ? centenas[c] : '';
    let rTxt = '';
    if (resto > 0 && resto < 30) {
      rTxt = unidades[resto];
    } else if (resto >= 30) {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      rTxt = u > 0 ? `${decenas[d]} y ${unidades[u]}` : decenas[d];
    }
    return [cTxt, rTxt].filter(Boolean).join(' ');
  }

  const millones = Math.floor(num / 1000000);
  const miles = Math.floor((num % 1000000) / 1000);
  const resto = num % 1000;
  const parts = [];
  if (millones > 0) parts.push(millones === 1 ? 'un millón' : `${menorMil(millones)} millones`);
  if (miles > 0) parts.push(miles === 1 ? 'mil' : `${menorMil(miles)} mil`);
  if (resto > 0) parts.push(menorMil(resto));
  return parts.join(' ');
}

export function numeroALetrasPesos(monto) {
  const val = Math.max(0, Number(monto || 0));
  const ent = Math.floor(val);
  const dec = Math.round((val - ent) * 100);
  const decStr = String(dec).padStart(2, '0');
  return `Son pesos ${numeroALetrasEntero(ent)} con ${decStr}/100`;
}

function calcAntiguedadAnios(fechaIngreso, fechaRef) {
  if (!fechaIngreso) return 0;
  const d1 = new Date(fechaIngreso);
  const d2 = fechaRef ? new Date(fechaRef) : new Date();
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return 0;
  let years = d2.getFullYear() - d1.getFullYear();
  const mDiff = d2.getMonth() - d1.getMonth();
  if (mDiff < 0 || (mDiff === 0 && d2.getDate() < d1.getDate())) years -= 1;
  return Math.max(0, years);
}

function drawReciboHojaA4(doc, { ejemplar, liq, rec, emp, params }) {
  doc.addPage(PAGE_SIZES_MM.A4.w, PAGE_SIZES_MM.A4.h);
  const theme = getPrintTheme(emp);
  const m = 10;
  const w = 190;
  const yTop = 10;
  const yBottom = 282;
  const borderCol = theme.borderCol;
  const mutedCol = theme.mutedCol;
  const fillBand = theme.eco ? '#FFFFFF' : '#E2E8F0';
  const fillSub = theme.eco ? '#FFFFFF' : '#F1F5F9';

  // Marco exterior completo A4
  doc.rect(m, yTop, w, yBottom - yTop, { stroke: borderCol, lineWidth: 0.7 });

  // ── 1. CABECERA EMPLEADOR + TÍTULO LEGAL ────────────────────────────────────
  const hdrH = 22;
  doc.rect(m, yTop, w, hdrH, { stroke: borderCol, lineWidth: 0.6 });
  doc.line(m + 34, yTop, m + 34, yTop + hdrH, { color: borderCol, lineWidth: 0.45 });
  doc.line(m + 132, yTop, m + 132, yTop + hdrH, { color: borderCol, lineWidth: 0.45 });

  if (theme.showLogo) {
    try {
      doc.image(theme.logoData, m + 2, yTop + 2, { maxWMm: 30, maxHMm: 18 });
    } catch {
      doc.text('LOGO', m + 17, yTop + 9, { size: 7.5, bold: true, align: 'center', color: mutedCol });
    }
  } else {
    doc.rect(m + 2, yTop + 2, 30, 18, { fill: fillSub, stroke: '#CBD5E1', lineWidth: 0.35 });
    doc.text('EMPLEADOR', m + 17, yTop + 9.5, { size: 6.5, bold: true, align: 'center', color: mutedCol });
  }

  doc.text('Empleador:', m + 36, yTop + 3, { size: 7.2, bold: true });
  doc.text(theme.empresaNombre, m + 56, yTop + 3, { size: 8.5, bold: true, maxWidth: 74 });
  doc.text('Dirección:', m + 36, yTop + 8.5, { size: 7, bold: true });
  doc.textBlock(theme.direccionFull || '-', m + 56, yTop + 8.5, 74, { size: 6.8, color: mutedCol });
  doc.rect(m + 56, yTop + 15.5, 48, 5, { stroke: borderCol, lineWidth: 0.4 });
  doc.text('CUIT N°:', m + 36, yTop + 16.5, { size: 7, bold: true });
  doc.text(emp.cuit || '-', m + 80, yTop + 16.5, { size: 7.5, bold: true, align: 'center' });

  doc.rect(m + 132, yTop, 58, 9, { fill: fillBand, stroke: borderCol, lineWidth: 0.45 });
  doc.text('RECIBO DE HABERES LEY N° 20.744', m + 161, yTop + 2.2, { size: 6.6, bold: true, align: 'center' });
  doc.text('Y 27.802', m + 161, yTop + 5.6, { size: 6.6, bold: true, align: 'center' });
  doc.text(ejemplar, m + 161, yTop + 13, { size: 9, bold: true, align: 'center' });

  // ── 2. BANDAS DE DATOS DEL TRABAJADOR ───────────────────────────────────────
  let y = yTop + hdrH;
  const [anioStr, mesStr] = String(liq.periodo || '').split('-');
  const quincenaStr = liq.tipo_liquidacion === 'Primera Quincena' ? '1°' : liq.tipo_liquidacion === 'Segunda Quincena' ? '2°' : '-';
  const antig = calcAntiguedadAnios(rec.fecha_ingreso, liq.fecha_liquidacion);
  const sueldoBruto = Number(rec.total_remunerativo || 0) + Number(rec.total_no_remunerativo || 0);

  const drawGridBand = (cols, curY) => {
    const hLab = 4.8;
    const hVal = 5.6;
    doc.rect(m, curY, w, hLab, { fill: fillBand, stroke: borderCol, lineWidth: 0.4 });
    doc.rect(m, curY + hLab, w, hVal, { stroke: borderCol, lineWidth: 0.4 });
    let cx = m;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (i > 0) doc.line(cx, curY, cx, curY + hLab + hVal, { color: borderCol, lineWidth: 0.35 });
      doc.text(c.label, cx + c.w / 2, curY + 1.3, { size: 5.3, bold: true, align: 'center', maxWidth: c.w - 1.5 });
      doc.text(String(c.val ?? '-'), cx + c.w / 2, curY + hLab + 1.6, { size: 6.8, bold: Boolean(c.bold), align: 'center', maxWidth: c.w - 2 });
      cx += c.w;
    }
    return curY + hLab + hVal;
  };

  y = drawGridBand([
    { label: 'QUINCENA', w: 16, val: quincenaStr },
    { label: 'MES', w: 16, val: mesStr || '-' },
    { label: 'AÑO', w: 18, val: anioStr || '-' },
    { label: 'APELLIDO Y NOMBRE', w: 66, val: rec.nombre_completo || rec.empleado_nombre || '-', bold: true },
    { label: 'N° LEGAJO', w: 24, val: rec.legajo || '-' },
    { label: 'SUELDO BRUTO', w: 28, val: fmtMoneyAr(sueldoBruto), bold: true },
    { label: 'ANTIGÜEDAD', w: 22, val: `${antig} año(s)` },
  ], y);

  const depPeriodo = emp.lct_ultimo_deposito_periodo || params?.nomina_ultimo_dep_periodo || '';
  const depFecha = emp.lct_ultimo_deposito_fecha || params?.nomina_ultimo_dep_fecha || liq.fecha_pago || '';
  const depBanco = emp.lct_ultimo_deposito_banco || params?.nomina_ultimo_dep_banco || liq.banco_deposito_aportes || '';
  const ultDepTxt = [depPeriodo ? `Per. ${depPeriodo}` : '', depFecha ? fmtDateAr(depFecha) : '', depBanco].filter(Boolean).join(' · ');
  const lugarPago = emp.localidad || emp.provincia || '-';
  y = drawGridBand([
    { label: 'FECHA INGRESO', w: 22, val: fmtDateAr(rec.fecha_ingreso) || '-' },
    { label: 'ANTIG. RECONOC.', w: 23, val: `${antig} año(s)` },
    { label: 'CATEGORÍA LABORAL', w: 42, val: `${rec.categoria_laboral || '-'} (${rec.puesto || rec.sector || '-'})` },
    { label: 'C.U.I.L.', w: 27, val: rec.cuil || '-', bold: true },
    { label: 'PERÍODO DE PAGO', w: 22, val: liq.periodo || '-' },
    { label: 'LUGAR DE PAGO', w: 27, val: lugarPago },
    { label: 'F. PAGO APORTES', w: 27, val: fmtDateAr(depFecha) || '-' },
  ], y);

  // ── 3. BLOQUE COSTO TOTAL EMPLEADOR (CONTRIBUCIONES) ────────────────────────
  const allLineas = Array.isArray(rec.lineas) ? rec.lineas : [];
  const contribLineas = allLineas.filter(l => Number(l.importe_contribucion || 0) > 0);
  const costoTotalEmpleador = Number((sueldoBruto + Number(rec.total_contribuciones || 0)).toFixed(2));

  doc.rect(m, y, w, 5.5, { fill: fillBand, stroke: borderCol, lineWidth: 0.45 });
  doc.text('COSTO TOTAL EMPLEADOR', m + 82, y + 1.4, { size: 7.5, bold: true, align: 'center' });
  doc.text(fmtMoneyAr(costoTotalEmpleador), m + w - 3, y + 1.4, { size: 8, bold: true, align: 'right' });
  y += 5.5;

  const drawTableHead = (cols, curY) => {
    doc.rect(m, curY, w, 5, { fill: fillSub, stroke: borderCol, lineWidth: 0.4 });
    let cx = m;
    for (let i = 0; i < cols.length; i++) {
      if (i > 0) doc.line(cx, curY, cx, curY + 5, { color: borderCol, lineWidth: 0.3 });
      doc.text(cols[i].label, cx + cols[i].w / 2, curY + 1.2, { size: 6.4, bold: true, align: 'center' });
      cx += cols[i].w;
    }
    return curY + 5;
  };

  const cCols = [
    { label: 'CONCEPTO', w: 94 },
    { label: 'UNIDAD', w: 24 },
    { label: 'BASE', w: 36 },
    { label: 'MONTO', w: 36 },
  ];
  y = drawTableHead(cCols, y);

  const contribBoxStart = y;
  const maxContribRows = Math.max(4, Math.min(6, contribLineas.length));
  for (let i = 0; i < maxContribRows; i++) {
    const l = contribLineas[i];
    if (l) {
      doc.text(`${l.codigo_afip_lsd || ''} · ${l.descripcion || '-'}`, m + 3, y + 0.8, { size: 6.4, maxWidth: 89 });
      doc.text(l.cantidad ? `${l.cantidad}%` : '-', m + 116, y + 0.8, { size: 6.4, align: 'right' });
      doc.text(fmtMoneyAr(l.base_calculo || 0), m + 152, y + 0.8, { size: 6.4, align: 'right' });
      doc.text(fmtMoneyAr(l.importe_contribucion || 0), m + w - 3, y + 0.8, { size: 6.4, bold: true, align: 'right' });
    }
    y += 4.2;
  }
  doc.rect(m, contribBoxStart, w, y - contribBoxStart, { stroke: borderCol, lineWidth: 0.4 });
  doc.line(m + 94, contribBoxStart, m + 94, y, { color: '#CBD5E1', lineWidth: 0.3 });
  doc.line(m + 118, contribBoxStart, m + 118, y, { color: '#CBD5E1', lineWidth: 0.3 });
  doc.line(m + 154, contribBoxStart, m + 154, y, { color: '#CBD5E1', lineWidth: 0.3 });

  doc.rect(m, y, w, 5.2, { fill: fillBand, stroke: borderCol, lineWidth: 0.45 });
  doc.text('SUB TOTAL CONTRIBUCIONES EMPLEADOR', m + 82, y + 1.3, { size: 7, bold: true, align: 'center' });
  doc.text(fmtMoneyAr(rec.total_contribuciones || 0), m + w - 3, y + 1.3, { size: 7.5, bold: true, align: 'right' });
  y += 5.2;

  // ── 4. BLOQUE REMUNERACIONES Y DEDUCCIONES ──────────────────────────────────
  doc.rect(m, y, w, 5.2, { fill: fillBand, stroke: borderCol, lineWidth: 0.45 });
  doc.text('REMUNERACIONES / SUELDO BRUTO', m + 82, y + 1.3, { size: 7.2, bold: true, align: 'center' });
  doc.text(fmtMoneyAr(sueldoBruto), m + w - 3, y + 1.3, { size: 7.5, bold: true, align: 'right' });
  y += 5.2;

  const rCols = [
    { label: 'CONCEPTO', w: 80 },
    { label: 'UNIDAD', w: 20 },
    { label: 'BASE', w: 30 },
    { label: 'NO REM', w: 30 },
    { label: 'MONTO REM / DED', w: 30 },
  ];
  y = drawTableHead(rCols, y);

  const trabLineas = allLineas.filter(l => Number(l.importe_haber || 0) > 0 || Number(l.importe_descuento || 0) > 0);
  const remBoxStart = y;
  const compTopY = 190;
  const maxRemRows = Math.max(trabLineas.length, Math.floor((compTopY - remBoxStart) / 4.3));

  for (let i = 0; i < maxRemRows; i++) {
    if (y + 4.3 > compTopY) break;
    const l = trabLineas[i];
    if (l) {
      const isNoRem = l.concepto_tipo === 'no_remunerativo';
      const isDesc = Number(l.importe_descuento || 0) > 0;
      const haber = Number(l.importe_haber || 0);
      const desc = Number(l.importe_descuento || 0);
      doc.text(`${l.codigo_afip_lsd || ''} · ${l.descripcion || '-'}`, m + 3, y + 0.8, { size: 6.4, maxWidth: 75 });
      doc.text(l.cantidad ? String(l.cantidad) : '-', m + 98, y + 0.8, { size: 6.4, align: 'right' });
      doc.text(l.base_calculo ? fmtMoneyAr(l.base_calculo) : '', m + 128, y + 0.8, { size: 6.4, align: 'right' });
      doc.text(isNoRem && haber > 0 ? fmtMoneyAr(haber) : '', m + 158, y + 0.8, { size: 6.4, align: 'right' });
      doc.text(
        isDesc ? `-${fmtMoneyAr(desc)}` : (!isNoRem && haber > 0 ? fmtMoneyAr(haber) : ''),
        m + w - 3,
        y + 0.8,
        { size: 6.4, bold: true, align: 'right', color: isDesc ? '#B91C1C' : borderCol }
      );
    }
    y += 4.3;
  }
  y = compTopY;
  doc.rect(m, remBoxStart, w, y - remBoxStart, { stroke: borderCol, lineWidth: 0.4 });
  for (const vx of [m + 80, m + 100, m + 130, m + 160]) {
    doc.line(vx, remBoxStart, vx, y, { color: '#CBD5E1', lineWidth: 0.3 });
  }

  // ── 5. COMPOSICIÓN SALARIAL, NETO EN LETRAS Y LUGAR DE PAGO ─────────────────
  doc.rect(m, y, w, 6, { fill: fillSub, stroke: borderCol, lineWidth: 0.45 });
  doc.text('COMPOSICIÓN SALARIAL:', m + 3, y + 1.8, { size: 6.5, bold: true });
  doc.text(`REMUNERATIVO: ${fmtMoneyAr(rec.total_remunerativo || 0)}`, m + 42, y + 1.8, { size: 6.6, bold: true });
  doc.text(`NO REM.: ${fmtMoneyAr(rec.total_no_remunerativo || 0)}`, m + 98, y + 1.8, { size: 6.6 });
  doc.text(`DESCUENTOS: ${fmtMoneyAr(rec.total_descuentos || 0)}`, m + 136, y + 1.8, { size: 6.6, color: '#B91C1C' });
  y += 6;

  doc.rect(m, y, w, 7, { stroke: borderCol, lineWidth: 0.45 });
  doc.rect(m + 152, y, 38, 7, { fill: fillBand, stroke: borderCol, lineWidth: 0.5 });
  doc.text('NETO A PERCIBIR:', m + 3, y + 2, { size: 6.4, bold: true });
  doc.text(numeroALetrasPesos(rec.neto_a_pagar), m + 32, y + 2, { size: 6.8, bold: true, maxWidth: 118 });
  doc.text(fmtMoneyAr(rec.neto_a_pagar || 0), m + w - 3, y + 2, { size: 8.5, bold: true, align: 'right' });
  y += 7;

  doc.rect(m, y, w, 5.5, { stroke: borderCol, lineWidth: 0.4 });
  doc.text(`LUGAR Y FECHA DE PAGO: ${lugarPago}, ${fmtDateAr(liq.fecha_pago || liq.fecha_liquidacion) || '-'}`, m + 3, y + 1.5, { size: 6.5 });
  doc.text(`ACREDITADO EN: ${rec.cbu ? `CBU ${rec.cbu}` : (rec.forma_pago || 'Efectivo')}`, m + w - 3, y + 1.5, { size: 6.5, align: 'right', bold: true });
  y += 6.5;

  // ── 6. DETALLE DE COMPOSICIÓN SALARIAL + BARRA COSTO EMPLEADOR + FIRMA ──────
  const sumByCode = (codes, field) => allLineas
    .filter(l => codes.some(c => String(l.codigo_afip_lsd || '').startsWith(c) || String(l.descripcion || '').toLowerCase().includes(c)))
    .reduce((s, l) => s + Number(l[field] || 0), 0);

  const sindTrab = sumByCode(['sindicato', 'cuota sindical', '810006'], 'importe_descuento');
  const sipaTrab = sumByCode(['jubilaci', '810001'], 'importe_descuento');
  const sipaEmp = sumByCode(['sipa', 'jubilaci', '820001'], 'importe_contribucion');
  const osTrab = sumByCode(['obra social', '810003'], 'importe_descuento');
  const osEmp = sumByCode(['obra social', 'oo.ss', '820002'], 'importe_contribucion');
  const pamiTrab = sumByCode(['19032', 'pami', '810002'], 'importe_descuento');
  const artEmp = sumByCode(['art', 'riesgos', '820003'], 'importe_contribucion');
  const scvoEmp = sumByCode(['scvo', 'seguro de vida', '820004'], 'importe_contribucion');

  doc.text('Detalle de la composición salarial', m + 42, y, { size: 7.5, bold: true, align: 'center' });
  const detY = y + 3.5;
  doc.rect(m + 2, detY, 114, 34, { stroke: borderCol, lineWidth: 0.45 });
  const drawDetRow = (lbl, val, xPos, yPos, bold = false) => {
    doc.text(lbl, xPos, yPos, { size: 6.2, bold });
    doc.text(fmtMoneyAr(val), xPos + 50, yPos, { size: 6.2, bold, align: 'right' });
  };

  drawDetRow('Total Costo Sindical', sindTrab, m + 4, detY + 2, true);
  drawDetRow('Trabajador', sindTrab, m + 4, detY + 5.5);
  drawDetRow('Total Seguridad Social', sipaTrab + sipaEmp, m + 4, detY + 11, true);
  drawDetRow('Empleador / Trabajador', sipaTrab + sipaEmp, m + 4, detY + 14.5);
  drawDetRow('Total Obra Social', osTrab + osEmp, m + 4, detY + 20, true);
  drawDetRow('Empleador / Trabajador', osTrab + osEmp, m + 4, detY + 23.5);

  drawDetRow('Total Costo INSSJP', pamiTrab, m + 60, detY + 2, true);
  drawDetRow('Trabajador', pamiTrab, m + 60, detY + 5.5);
  drawDetRow('Total Costo ART', artEmp, m + 60, detY + 11, true);
  drawDetRow('Empleador', artEmp, m + 60, detY + 14.5);
  drawDetRow('Total Costo SCVO', scvoEmp, m + 60, detY + 20, true);
  drawDetRow('Empleador', scvoEmp, m + 60, detY + 23.5);
  doc.text(`Últ. Dep. Aportes: ${ultDepTxt || 'Sin informar'}`, m + 4, detY + 30, { size: 5.5, color: mutedCol, maxWidth: 110 });

  // Bloque gráfico de barras proporcionales Costo Total Empleador (derecha)
  const chartX = m + 120;
  const chartW = 68;
  doc.rect(chartX, detY, chartW, 34, { stroke: borderCol, lineWidth: 0.45 });
  doc.text('COSTO TOTAL EMPLEADOR', chartX + chartW / 2, detY + 2, { size: 6.5, bold: true, align: 'center' });
  const segs = [
    { label: 'Neto Trabajador', val: Number(rec.neto_a_pagar || 0), color: theme.eco ? '#CBD5E1' : '#3B82F6' },
    { label: 'Retenciones', val: Number(rec.total_descuentos || 0), color: theme.eco ? '#94A3B8' : '#EF4444' },
    { label: 'Contrib. Patronales', val: Number(rec.total_contribuciones || 0), color: theme.eco ? '#64748B' : '#10B981' },
  ];
  const baseChart = Math.max(1, costoTotalEmpleador);
  let barY = detY + 7;
  for (const seg of segs) {
    const pct = Math.round((seg.val / baseChart) * 100);
    doc.text(`${seg.label} (${pct}%)`, chartX + 3, barY, { size: 5.8 });
    doc.text(fmtMoneyAr(seg.val), chartX + chartW - 3, barY, { size: 5.8, align: 'right', bold: true });
    barY += 3.3;
    doc.rect(chartX + 3, barY, chartW - 6, 2.5, { fill: '#F1F5F9', stroke: '#CBD5E1', lineWidth: 0.25 });
    const fillW = Math.max(0, Math.min(chartW - 6, ((chartW - 6) * seg.val) / baseChart));
    if (fillW > 0.5) doc.rect(chartX + 3, barY, fillW, 2.5, { fill: seg.color });
    barY += 5.2;
  }

  // Pie legal y firma al fondo de la hoja
  const sigY = yBottom - 11;
  const notaLegal = ejemplar.startsWith('ORIGINAL')
    ? 'RECIBO ORIGINAL PARA EL EMPLEADOR FIRMADO POR EL EMPLEADO.'
    : 'RECIBO DUPLICADO PARA EL EMPLEADO FIRMADO POR EL EMPLEADOR.';
  doc.text(notaLegal, m + 4, sigY + 4, { size: 6.2, bold: true, color: '#92400E' });
  doc.line(m + 126, sigY + 3, m + w - 6, sigY + 3, { color: borderCol, lineWidth: 0.45 });
  doc.text(ejemplar.startsWith('ORIGINAL') ? 'FIRMA DEL EMPLEADO' : 'FIRMA DEL EMPLEADOR', m + 156, sigY + 4.5, { size: 6.2, bold: true, align: 'center' });
}

/**
 * Genera el PDF legal de Recibos de Sueldo LCT Art. 140 / Ley 27.802:
 * Hoja 1: ORIGINAL (Empleador) / Hoja 2: DUPLICADO (Trabajador) por cada recibo.
 */
export function generateRecibosSueldoPdf(det = {}, emp = {}, { reciboId = null, params = {} } = {}) {
  const doc = new PdfDocument({ size: 'A4' });
  const liq = det.liquidacion || {};
  const recibos = reciboId
    ? (det.recibos || []).filter(r => Number(r.id) === Number(reciboId))
    : (det.recibos || []);

  if (!recibos.length) {
    doc.addPage();
    doc.text('No hay recibos para imprimir en esta liquidación.', 15, 20, { size: 10 });
    return doc.toBuffer();
  }

  for (const rec of recibos) {
    drawReciboHojaA4(doc, { ejemplar: 'ORIGINAL', liq, rec, emp, params });
    drawReciboHojaA4(doc, { ejemplar: 'DUPLICADO', liq, rec, emp, params });
  }

  stampUnifiedFooter(doc, emp, { margin: 10 });
  return doc.toBuffer();
}
