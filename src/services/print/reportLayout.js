import { PdfDocument, PAGE_SIZES_MM, fmtDateAr } from './pdfBuilder.js';
import { getPrintTheme, drawEmpresaBlock, stampUnifiedFooter, fmtMoneyAr } from './printLayout.js';

export { fmtMoneyAr };

export function createReportContext(title, emp = {}, { subtitle = '' } = {}) {
  const doc = new PdfDocument();
  const spec = PAGE_SIZES_MM.A4;
  const theme = getPrintTheme(emp);
  const m = spec.margin;
  const w = spec.w - m * 2;
  const yBottom = spec.h - m;
  const fillHeader = theme.fillHeader;
  const borderCol = theme.borderCol;
  const mutedCol = theme.mutedCol;

  const ctx = {
    doc,
    spec,
    theme,
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
      const endLeftY = drawEmpresaBlock(doc, emp, {
        x: m + 3,
        y: m + topBarH + 2,
        maxW: w - 62,
        isCompact: true,
      });
      const hoy = fmtDateAr(new Date().toISOString().slice(0, 10));
      doc.text(`Emitido: ${hoy}`, m + w - 3, m + topBarH + 2.8, { size: 7.5, align: 'right', color: mutedCol });
      if (subtitle) {
        doc.textBlock(subtitle, m + w - 58, m + topBarH + 7, 55, { size: 7.5, align: 'right', color: mutedCol });
      }
      const hdrBottom = Math.max(m + topBarH + 13, endLeftY + 2);
      doc.line(m, hdrBottom, m + w, hdrBottom, { color: borderCol, lineWidth: 0.6 });
      ctx.y = hdrBottom + 3;
    } else {
      ctx.y = m + topBarH + 3;
    }
  };

  ctx.ensureSpace = (neededMm, onNewPage) => {
    if (ctx.y + neededMm > yBottom - 4) {
      startPage(false);
      if (typeof onNewPage === 'function') onNewPage();
    }
  };

  ctx.drawTableHeaders = (cols) => {
    const thH = 6.5;
    ctx.ensureSpace(thH + 6);
    doc.rect(m, ctx.y, w, thH, { stroke: borderCol, fill: fillHeader, lineWidth: 0.55 });
    let cx = m + 3;
    for (const col of cols) {
      const tx = col.align === 'right' ? cx + col.w - 2 : cx;
      doc.text(col.label, tx, ctx.y + 1.7, { size: 7.5, bold: true, align: col.align || 'left' });
      cx += col.w;
    }
    ctx.y += thH;
  };

  ctx.finish = (extraText = '') => {
    stampUnifiedFooter(doc, emp, { margin: m, extraText });
    return doc.toBuffer();
  };

  startPage(true);
  return ctx;
}
