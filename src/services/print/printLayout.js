import { fmtDateAr } from './pdfBuilder.js';

export const COPY_LABELS = {
  original: ['ORIGINAL'],
  duplicado: ['ORIGINAL', 'DUPLICADO'],
  triplicado: ['ORIGINAL', 'DUPLICADO', 'TRIPLICADO'],
};

export function resolveCopyLabels(reqCopias, empCopias) {
  const mode = ['original', 'duplicado', 'triplicado'].includes(reqCopias || empCopias)
    ? (reqCopias || empCopias)
    : 'original';
  return COPY_LABELS[mode] || ['ORIGINAL'];
}

export function resolvePrintFormat(reqFmt, empFmt, allowed = ['A4', 'A5', 'ticket80', 'ticket58']) {
  const candidate = reqFmt || empFmt;
  return allowed.includes(candidate) ? candidate : 'A4';
}

export function fmtMoneyAr(n) {
  return '$' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function getPrintTheme(emp = {}) {
  const eco = Number(emp.print_modo_economico ?? 0) === 1;
  const showLogo = Number(emp.print_mostrar_logo ?? 1) === 1 && Boolean(emp.logo_data);
  const direccionFull = [emp.direccion, emp.localidad, emp.provincia].filter(Boolean).join(', ');
  const telEmail = [emp.telefono ? `Tel: ${emp.telefono}` : '', emp.email || ''].filter(Boolean).join(' · ');
  return {
    eco,
    showLogo,
    logoData: showLogo ? String(emp.logo_data) : '',
    fillHeader: eco ? '#FFFFFF' : '#F1F5F9',
    fillTotal: eco ? '#FFFFFF' : '#0F1F2A',
    totalTextCol: eco ? '#0F1F2A' : '#FFFFFF',
    borderCol: '#0F1F2A',
    mutedCol: '#475569',
    pieTexto: String(emp.print_pie_comprobante || '').trim(),
    empresaNombre: emp.razon_social || emp.nombre_fantasia || 'Empresa',
    nombreFantasia: emp.nombre_fantasia && emp.nombre_fantasia !== emp.razon_social ? emp.nombre_fantasia : '',
    cuit: emp.cuit ? `CUIT: ${emp.cuit}` : '',
    condicionIva: emp.condicion_iva || '',
    iibb: emp.iibb ? `IIBB: ${emp.iibb}` : '',
    inicioAct: emp.inicio_actividades ? `Inicio Act.: ${fmtDateAr(emp.inicio_actividades)}` : '',
    direccionFull,
    telEmail,
  };
}

export function drawEmpresaBlock(doc, emp = {}, { x, y, maxW, isCompact = false } = {}) {
  const theme = getPrintTheme(emp);
  let curY = y;
  if (theme.showLogo) {
    try {
      const drawn = doc.image(theme.logoData, x, curY, { maxWMm: isCompact ? 28 : 36, maxHMm: isCompact ? 10 : 12 });
      if (drawn?.hMm) curY += drawn.hMm + 1.5;
    } catch { /* formato de imagen no soportado en PDF nativo */ }
  }
  const brandSize = isCompact ? 9.5 : 11;
  const metaSize = isCompact ? 6.8 : 7.5;
  curY = doc.textBlock(theme.empresaNombre, x, curY, maxW, { size: brandSize, bold: true });
  curY += 0.5;
  if (theme.nombreFantasia) {
    curY = doc.textBlock(theme.nombreFantasia, x, curY, maxW, { size: metaSize, color: theme.mutedCol });
  }
  const fiscalLine = [theme.cuit, theme.condicionIva].filter(Boolean).join(' · ');
  if (fiscalLine) {
    curY = doc.textBlock(fiscalLine, x, curY, maxW, { size: metaSize, color: theme.mutedCol });
  }
  const regLine = [theme.iibb, theme.inicioAct].filter(Boolean).join(' · ');
  if (regLine) {
    curY = doc.textBlock(regLine, x, curY, maxW, { size: metaSize, color: theme.mutedCol });
  }
  if (theme.direccionFull) {
    curY = doc.textBlock(theme.direccionFull, x, curY, maxW, { size: metaSize, color: theme.mutedCol });
  }
  if (theme.telEmail) {
    curY = doc.textBlock(theme.telEmail, x, curY, maxW, { size: metaSize, color: theme.mutedCol });
  }
  return curY;
}

export function stampUnifiedFooter(doc, emp = {}, { margin = 10, extraText = '' } = {}) {
  const theme = getPrintTheme(emp);
  const hoy = fmtDateAr(new Date().toISOString().slice(0, 10));
  doc.stampAllPages((pageNum, totalPages, page) => {
    const w = page.w - margin * 2;
    const y = page.h - margin + 2.2;
    const leftParts = [theme.pieTexto, extraText].filter(Boolean).join(' · ');
    if (leftParts) {
      doc.text(leftParts, margin, y, { size: 6.8, color: theme.mutedCol, maxWidth: w - 48 });
    }
    doc.text(`Emitido: ${hoy} · Página ${pageNum} de ${totalPages}`, margin + w, y, {
      size: 6.8,
      align: 'right',
      color: theme.mutedCol,
    });
  });
}

export function drawFiscalSheetHeader(doc, {
  m, w, yTop, isA5, copyLabel,
  letra, codAfip, subLetra, titulo, ptoVta, cbteNro, nroLabel = 'Comp. Nro', fecha,
  extraRightLines = [], emp = {},
}) {
  const theme = getPrintTheme(emp);
  const midX = m + w / 2;
  const baseSz = isA5 ? 7.2 : 8.2;
  const topBarH = isA5 ? 5.5 : 6.5;

  doc.rect(m, yTop, w, topBarH, { stroke: theme.borderCol, fill: theme.fillHeader, lineWidth: 0.6 });
  doc.text(copyLabel, midX, yTop + (isA5 ? 1.3 : 1.6), { size: isA5 ? 7.5 : 8.5, bold: true, align: 'center' });

  const headerTop = yTop + topBarH;
  const headerH = isA5 ? 36 : 41;
  const letterW = isA5 ? 15 : 17;
  const letterH = isA5 ? 14 : 16;
  const letterX = midX - letterW / 2;

  doc.line(m, headerTop + headerH, m + w, headerTop + headerH, { color: theme.borderCol, lineWidth: 0.8 });
  doc.line(midX, headerTop + letterH + 5.5, midX, headerTop + headerH, { color: theme.borderCol, lineWidth: 0.6 });

  doc.rect(letterX, headerTop, letterW, letterH, { stroke: theme.borderCol, fill: '#FFFFFF', lineWidth: 0.9 });
  doc.text(letra, midX, headerTop + (isA5 ? 1.8 : 2.2), { size: isA5 ? 16 : 20, bold: true, align: 'center' });
  doc.text(codAfip, midX, headerTop + letterH - (isA5 ? 3.8 : 4.3), { size: isA5 ? 5.8 : 6.5, bold: true, align: 'center' });
  doc.text(subLetra, midX, headerTop + letterH + 1.2, { size: 5.2, bold: true, align: 'center', color: theme.mutedCol });

  // Columna Izquierda: Emisor
  const emisorBrand = emp.nombre_fantasia || emp.razon_social || 'Vanguard Production';
  const razonSocial = emp.razon_social || '';
  const leftMaxW = letterX - m - 4;
  let ly = headerTop + 2.5;
  ly = doc.textBlock(emisorBrand, m + 3, ly, leftMaxW, { size: isA5 ? 10.5 : 12.5, bold: true, lineHeight: 1.15 });
  if (razonSocial && emisorBrand !== razonSocial) {
    ly = doc.textBlock(`Razón Social: ${razonSocial}`, m + 3, ly + 0.4, leftMaxW, { size: baseSz - 0.5, color: theme.mutedCol, lineHeight: 1.18 });
  }
  const dirComercial = [emp.direccion, emp.localidad, emp.provincia, emp.codigo_postal ? `(CP ${emp.codigo_postal})` : ''].filter(Boolean).join(', ');
  if (dirComercial) {
    ly = doc.textBlock(`Domicilio Comercial: ${dirComercial}`, m + 3, ly + 0.4, leftMaxW, { size: baseSz - 0.7, color: theme.mutedCol, lineHeight: 1.18 });
  }
  if (emp.condicion_iva) {
    ly = doc.textBlock(`Condición frente al IVA: ${emp.condicion_iva}`, m + 3, ly + 0.4, leftMaxW, { size: baseSz - 0.6, color: theme.mutedCol, lineHeight: 1.18 });
  }
  const telEmailEmp = [emp.telefono ? `Teléfono: ${emp.telefono}` : '', emp.email].filter(Boolean).join(' · ');
  if (telEmailEmp) {
    doc.textBlock(telEmailEmp, m + 3, ly + 0.4, leftMaxW, { size: baseSz - 0.7, color: theme.mutedCol, lineHeight: 1.18 });
  }

  // Columna Derecha: Datos del Comprobante + CUIT / IIBB / Inicio Act.
  const rightX = letterX + letterW + 4;
  const rightMaxW = (m + w) - rightX - 3;
  let ry = headerTop + 3;
  doc.text(titulo, rightX, ry, { size: isA5 ? 10 : 12, bold: true, color: theme.borderCol });
  ry += isA5 ? 5.2 : 6.2;
  ry = doc.textBlock(`Punto de Venta: ${ptoVta}    ${nroLabel}: ${cbteNro}`, rightX, ry, rightMaxW, { size: baseSz, bold: true, lineHeight: 1.2 });
  ry = doc.textBlock(`Fecha de Emisión: ${fmtDateAr(fecha) || '-'}`, rightX, ry + 0.4, rightMaxW, { size: baseSz, lineHeight: 1.2 });
  for (const line of extraRightLines) {
    if (line) ry = doc.textBlock(line, rightX, ry + 0.4, rightMaxW, { size: baseSz - 0.5, color: theme.mutedCol, lineHeight: 1.2 });
  }
  if (emp.cuit) ry = doc.textBlock(`CUIT: ${emp.cuit}`, rightX, ry + 0.4, rightMaxW, { size: baseSz - 0.5, color: theme.mutedCol, lineHeight: 1.2 });
  if (emp.iibb) ry = doc.textBlock(`Ingresos Brutos: ${emp.iibb}`, rightX, ry + 0.4, rightMaxW, { size: baseSz - 0.5, color: theme.mutedCol, lineHeight: 1.2 });
  if (emp.inicio_actividades) doc.textBlock(`Inicio de Actividades: ${fmtDateAr(emp.inicio_actividades)}`, rightX, ry + 0.4, rightMaxW, { size: baseSz - 0.5, color: theme.mutedCol, lineHeight: 1.2 });

  return { headerTop, headerH, topBarH, curY: headerTop + headerH };
}

export function drawTicketHeader(doc, { wMm, m, copyLabel, titulo, letra, codAfip, ptoVta, cbteNro, fecha, emp = {} }) {
  const is58 = wMm <= 60;
  const sz = is58 ? 6.8 : 7.8;
  const w = wMm - m * 2;
  const cx = wMm / 2;
  const theme = getPrintTheme(emp);
  let y = m + 1;

  doc.text(copyLabel, cx, y, { size: sz, bold: true, align: 'center' });
  y += 3.8;
  doc.text(theme.empresaNombre, cx, y, { size: sz + 1.2, bold: true, align: 'center', maxWidth: w });
  y += 3.8;
  if (emp.cuit) { doc.text(`CUIT: ${emp.cuit}`, cx, y, { size: sz - 0.6, align: 'center' }); y += 3.2; }
  if (emp.condicion_iva) { doc.text(emp.condicion_iva, cx, y, { size: sz - 0.6, align: 'center' }); y += 3.2; }
  const regLine = [emp.iibb ? `IIBB: ${emp.iibb}` : '', emp.inicio_actividades ? `Ini: ${fmtDateAr(emp.inicio_actividades)}` : ''].filter(Boolean).join(' · ');
  if (regLine) { doc.text(regLine, cx, y, { size: sz - 0.8, align: 'center', maxWidth: w }); y += 3.2; }
  if (theme.direccionFull) {
    y = doc.textBlock(theme.direccionFull, m, y, w, { size: sz - 0.8, align: 'center', lineHeight: 1.15 });
  }

  doc.line(m, y + 0.5, wMm - m, y + 0.5, { color: '#0F1F2A', lineWidth: 0.5 });
  y += 2.4;
  doc.text(`${titulo} [${letra}] (${codAfip})`, cx, y, { size: sz + 0.2, bold: true, align: 'center' });
  y += 3.8;
  doc.text(`PV: ${ptoVta} · N°: ${cbteNro}`, cx, y, { size: sz, bold: true, align: 'center' });
  y += 3.5;
  doc.text(`Fecha: ${fmtDateAr(fecha) || '-'}`, cx, y, { size: sz - 0.3, align: 'center' });
  y += 3.5;
  doc.line(m, y, wMm - m, y, { color: '#0F1F2A', lineWidth: 0.4 });
  return { y: y + 2.2, sz, w };
}
