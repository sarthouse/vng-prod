import { fmtDateAr } from './pdfBuilder.js';

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
