import { PdfDocument, PAGE_SIZES_MM, fmtDateAr } from './pdfBuilder.js';

export function fmtMoneyAr(n) {
  return '$' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function createReportContext(title, emp = {}, { subtitle = '' } = {}) {
  const doc = new PdfDocument();
  const spec = PAGE_SIZES_MM.A4;
  const eco = Number(emp.print_modo_economico ?? 0) === 1;
  const m = spec.margin;
  const w = spec.w - m * 2;
  const yBottom = spec.h - m;
  const fillHeader = eco ? '#FFFFFF' : '#F1F5F9';
  const borderCol = '#0F1F2A';
  const mutedCol = '#475569';

  const ctx = {
    doc,
    spec,
    m,
    w,
    yBottom,
    fillHeader,
    borderCol,
    mutedCol,
    y: m,
    pageNum: 0,
  };

  const startPage = (isFirst = false) => {
    doc.addPage(spec.w, spec.h);
    ctx.pageNum += 1;
    doc.rect(m, m, w, yBottom - m, { stroke: borderCol, lineWidth: 0.75 });

    const topBarH = 6.5;
    doc.rect(m, m, w, topBarH, { stroke: borderCol, fill: fillHeader, lineWidth: 0.55 });
    doc.text(title, m + w / 2, m + 1.6, { size: 8.5, bold: true, align: 'center' });

    if (isFirst) {
      const empNombre = emp.razon_social || emp.nombre_fantasia || 'Empresa';
      doc.text(empNombre, m + 3, m + topBarH + 2.5, { size: 10.5, bold: true });
      const metaParts = [
        emp.cuit ? `CUIT: ${emp.cuit}` : '',
        emp.condicion_iva || '',
        emp.direccion || '',
      ].filter(Boolean);
      if (metaParts.length) {
        doc.text(metaParts.join(' · '), m + 3, m + topBarH + 7.2, { size: 7.5, color: mutedCol, maxWidth: w - 52 });
      }
      const hoy = fmtDateAr(new Date().toISOString().slice(0, 10));
      doc.text(`Emitido: ${hoy}`, m + w - 3, m + topBarH + 2.8, { size: 7.5, align: 'right', color: mutedCol });
      if (subtitle) {
        doc.text(subtitle, m + w - 3, m + topBarH + 7.2, { size: 7.5, align: 'right', color: mutedCol });
      }
      const hdrBottom = m + topBarH + 12.5;
      doc.line(m, hdrBottom, m + w, hdrBottom, { color: borderCol, lineWidth: 0.6 });
      ctx.y = hdrBottom + 3;
    } else {
      ctx.y = m + topBarH + 3;
    }

    doc.text(`Página ${ctx.pageNum}`, m + w - 3, yBottom - 4, { size: 7, align: 'right', color: mutedCol });
  };

  ctx.ensureSpace = (neededMm, onNewPage) => {
    if (ctx.y + neededMm > yBottom - 7) {
      startPage(false);
      if (typeof onNewPage === 'function') onNewPage();
    }
  };

  ctx.drawTableHeaders = (cols) => {
    const rowH = 5.5;
    ctx.ensureSpace(rowH + 4);
    doc.rect(m + 2, ctx.y, w - 4, rowH, { fill: fillHeader, stroke: borderCol, lineWidth: 0.4 });
    let x = m + 3.5;
    for (const c of cols) {
      const tx = c.align === 'right' ? x + c.w - 2 : x;
      doc.text(c.label, tx, ctx.y + 1.4, {
        size: 7.2,
        bold: true,
        align: c.align || 'left',
        maxWidth: c.w - 2,
      });
      x += c.w;
    }
    ctx.y += rowH;
  };

  startPage(true);
  return ctx;
}
