import { PdfDocument, PAGE_SIZES_MM, fmtDateAr, fmtNumAr, wrapTextMm } from './pdfBuilder.js';
import { stampUnifiedFooter, fmtMoneyAr } from './printLayout.js';

export function generateOrdenPdf(detail = {}, emp = {}) {
  const orden = detail.orden || detail || {};
  const lineas = Array.isArray(detail.lineas) ? detail.lineas : [];
  const etapas = Array.isArray(detail.etapas) ? detail.etapas : [];
  const insumos = Array.isArray(detail.insumos) ? detail.insumos : [];

  const doc = new PdfDocument();
  const spec = PAGE_SIZES_MM.A4;
  const eco = Number(emp.print_modo_economico ?? 0) === 1;
  doc.addPage(spec.w, spec.h);

  const m = spec.margin;
  const w = spec.w - m * 2;
  const yTop = m;
  const yBottom = spec.h - m;
  const midX = m + w / 2;

  const fillHeader = eco ? '#FFFFFF' : '#F1F5F9';
  const borderCol = '#0F1F2A';
  const mutedCol = '#475569';
  const baseSz = 8.0;

  doc.rect(m, yTop, w, yBottom - yTop, { stroke: borderCol, lineWidth: 0.85 });

  // Franja superior
  const topBarH = 6.5;
  doc.rect(m, yTop, w, topBarH, { stroke: borderCol, fill: fillHeader, lineWidth: 0.6 });
  doc.text('ORDEN DE PRODUCCIÓN / HOJA DE RUTA DE TALLER', midX, yTop + 1.6, {
    size: 8.5,
    bold: true,
    align: 'center',
  });

  // Encabezado
  const headerTop = yTop + topBarH;
  const headerH = 34;
  const letterW = 17;
  const letterH = 15;
  const letterX = midX - letterW / 2;

  doc.line(m, headerTop + headerH, m + w, headerTop + headerH, { color: borderCol, lineWidth: 0.8 });
  doc.line(midX, headerTop + letterH + 3, midX, headerTop + headerH, { color: borderCol, lineWidth: 0.6 });

  doc.rect(letterX, headerTop, letterW, letterH, { stroke: borderCol, fill: '#FFFFFF', lineWidth: 0.9 });
  doc.text('OP', midX, headerTop + 2.5, { size: 16, bold: true, align: 'center' });
  doc.text('FÁBRICA', midX, headerTop + letterH - 4.2, { size: 5.8, bold: true, align: 'center' });

  const emisorBrand = emp.nombre_fantasia || emp.razon_social || 'Vanguard Production';
  const leftMaxW = letterX - m - 4;
  let ly = headerTop + 3;
  ly = doc.textBlock(emisorBrand, m + 3, ly, leftMaxW, { size: 12, bold: true, lineHeight: 1.15 });
  if (emp.razon_social && emp.razon_social !== emisorBrand) {
    ly = doc.textBlock(`Razón Social: ${emp.razon_social}`, m + 3, ly + 0.5, leftMaxW, { size: baseSz - 0.4, color: mutedCol });
  }
  if (emp.cuit) {
    ly = doc.textBlock(`CUIT: ${emp.cuit}`, m + 3, ly + 0.4, leftMaxW, { size: baseSz - 0.4, color: mutedCol });
  }

  const rightX = letterX + letterW + 4;
  const rightMaxW = (m + w) - rightX - 3;
  let ry = headerTop + 3;
  doc.text(`ORDEN ${orden.codigo || '#' + (orden.id || '')}`, rightX, ry, { size: 11.5, bold: true, color: borderCol });
  ry += 5.5;
  ry = doc.textBlock(`Modelo: ${orden.plantilla_nombre || '-'}`, rightX, ry, rightMaxW, { size: baseSz + 0.4, bold: true });
  ry = doc.textBlock(`Estado: ${orden.estado || '-'} · Total: ${fmtNumAr(orden.cantidad || 0)} u.`, rightX, ry + 0.5, rightMaxW, { size: baseSz });
  doc.textBlock(`Inicio: ${fmtDateAr(orden.fecha_inicio) || '-'} · Objetivo: ${fmtDateAr(orden.fecha_objetivo) || '-'}`, rightX, ry + 0.5, rightMaxW, { size: baseSz - 0.3, color: mutedCol });

  let curY = headerTop + headerH;

  // Sección 1: Curva de Cantidades / Variantes
  doc.rect(m, curY, w, 6.2, { stroke: borderCol, fill: fillHeader, lineWidth: 0.6 });
  doc.text('1. CURVA DE VARIANTES / TALLES A PRODUCIR', m + 3, curY + 1.6, { size: baseSz, bold: true });
  curY += 6.2;

  const curvaSummary = lineas.length
    ? lineas.map(l => `${l.combinacion || l.sku || l.producto_nombre}: ${fmtNumAr(l.cantidad)}`).join('   |   ') + `   =>   TOTAL: ${fmtNumAr(orden.cantidad)} u.`
    : `Cantidad total planificada: ${fmtNumAr(orden.cantidad)} u.`;
  const curvaLines = wrapTextMm(curvaSummary, w - 6, baseSz, true);
  const curvaH = Math.max(9, curvaLines.length * 4 + 3);
  doc.rect(m, curY, w, curvaH, { stroke: borderCol, fill: '#FFFFFF', lineWidth: 0.5 });
  doc.textBlock(curvaSummary, m + 3, curY + 2, w - 6, { size: baseSz, bold: true });
  curY += curvaH;

  // Sección 2: Etapas de Producción y Talleres
  doc.rect(m, curY, w, 6.2, { stroke: borderCol, fill: fillHeader, lineWidth: 0.6 });
  doc.text('2. HOJA DE RUTA — ETAPAS Y TALLERES ASIGNADOS', m + 3, curY + 1.6, { size: baseSz, bold: true });
  curY += 6.2;

  const thEtH = 6;
  doc.rect(m, curY, w, thEtH, { stroke: borderCol, fill: '#F8FAFC', lineWidth: 0.5 });
  doc.text('# / Etapa', m + 2, curY + 1.4, { size: baseSz - 0.3, bold: true });
  doc.text('Taller / Responsable', m + 52, curY + 1.4, { size: baseSz - 0.3, bold: true });
  doc.text('Fechas Est.', m + 105, curY + 1.4, { size: baseSz - 0.3, bold: true });
  doc.text('Avance', m + 145, curY + 1.4, { size: baseSz - 0.3, bold: true });
  doc.text('Estado', m + w - 2, curY + 1.4, { size: baseSz - 0.3, bold: true, align: 'right' });
  curY += thEtH;

  for (const et of etapas) {
    const rH = 6;
    doc.text(`${et.orden}. ${et.nombre}`, m + 2, curY + 1.4, { size: baseSz - 0.3, bold: true });
    doc.text(String(et.taller_nombre || 'Sin asignar').slice(0, 28), m + 52, curY + 1.4, { size: baseSz - 0.3 });
    doc.text(`${fmtDateAr(et.fecha_inicio_est) || '-'} al ${fmtDateAr(et.fecha_fin_est) || '-'}`, m + 105, curY + 1.4, { size: baseSz - 0.5, color: mutedCol });
    doc.text(`${fmtNumAr(et.cantidad_completada || 0)}/${fmtNumAr(orden.cantidad || 0)}`, m + 145, curY + 1.4, { size: baseSz - 0.3 });
    doc.text(et.estado || 'Pendiente', m + w - 2, curY + 1.4, { size: baseSz - 0.3, bold: true, align: 'right' });
    curY += rH;
    doc.line(m, curY, m + w, curY, { color: '#E2E8F0', lineWidth: 0.35 });
  }

  // Sección 3: Insumos y Materiales Requeridos
  curY += 2;
  doc.rect(m, curY, w, 6.2, { stroke: borderCol, fill: fillHeader, lineWidth: 0.6 });
  doc.text('3. INSUMOS Y MATERIALES REQUERIDOS POR RECETA', m + 3, curY + 1.6, { size: baseSz, bold: true });
  curY += 6.2;

  doc.rect(m, curY, w, thEtH, { stroke: borderCol, fill: '#F8FAFC', lineWidth: 0.5 });
  doc.text('Etapa', m + 2, curY + 1.4, { size: baseSz - 0.3, bold: true });
  doc.text('Insumo / Material', m + 36, curY + 1.4, { size: baseSz - 0.3, bold: true });
  doc.text('Categoría', m + 115, curY + 1.4, { size: baseSz - 0.3, bold: true });
  doc.text('Cant. Requerida', m + 162, curY + 1.4, { size: baseSz - 0.3, bold: true, align: 'right' });
  doc.text('Stock Act.', m + w - 2, curY + 1.4, { size: baseSz - 0.3, bold: true, align: 'right' });
  curY += thEtH;

  const signH = 22;
  const footerTop = yBottom - signH;

  for (const ins of insumos) {
    const rH = 5.8;
    if (curY + rH > footerTop - 2) {
      doc.addPage(spec.w, spec.h);
      doc.rect(m, yTop, w, yBottom - yTop, { stroke: borderCol, lineWidth: 0.85 });
      doc.rect(m, yTop, w, 6.5, { stroke: borderCol, fill: fillHeader, lineWidth: 0.6 });
      doc.text('ORDEN DE PRODUCCIÓN · INSUMOS (CONTINUACIÓN)', midX, yTop + 1.6, { size: 8.5, bold: true, align: 'center' });
      curY = yTop + 8.5;
      doc.rect(m, curY, w, thEtH, { stroke: borderCol, fill: fillHeader, lineWidth: 0.55 });
      doc.text('Etapa', m + 2, curY + 1.4, { size: baseSz - 0.3, bold: true });
      doc.text('Insumo / Material', m + 36, curY + 1.4, { size: baseSz - 0.3, bold: true });
      doc.text('Categoría', m + 115, curY + 1.4, { size: baseSz - 0.3, bold: true });
      doc.text('Cant. Requerida', m + 162, curY + 1.4, { size: baseSz - 0.3, bold: true, align: 'right' });
      doc.text('Stock Act.', m + w - 2, curY + 1.4, { size: baseSz - 0.3, bold: true, align: 'right' });
      curY += thEtH;
    }
    doc.text(String(ins.etapa_nombre || 'General').slice(0, 16), m + 2, curY + 1.3, { size: baseSz - 0.5, color: mutedCol });
    doc.text(String(ins.producto_nombre || '-').slice(0, 42), m + 36, curY + 1.3, { size: baseSz - 0.3, bold: true });
    doc.text(String(ins.categoria || '-').slice(0, 18), m + 115, curY + 1.3, { size: baseSz - 0.5, color: mutedCol });
    doc.text(`${fmtNumAr(ins.cantidad_requerida, 2)} ${ins.udm || ''}`, m + 162, curY + 1.3, { size: baseSz - 0.3, bold: true, align: 'right' });
    doc.text(`${fmtNumAr(ins.stock_actual, 2)}`, m + w - 2, curY + 1.3, { size: baseSz - 0.4, color: mutedCol, align: 'right' });
    curY += rH;
    doc.line(m, curY, m + w, curY, { color: '#E2E8F0', lineWidth: 0.35 });
  }

  // Pie de firmas y control de calidad
  doc.rect(m, footerTop, w, signH, { stroke: borderCol, fill: '#FFFFFF', lineWidth: 0.6 });
  doc.rect(m, footerTop, w, 5.2, { stroke: borderCol, fill: fillHeader, lineWidth: 0.5 });
  doc.text('CONTROL DE TALLER Y RECEPCIÓN DE ORDEN', m + 3, footerTop + 1.2, { size: baseSz - 0.2, bold: true });
  doc.text(
    `Costo Procesos Est.: ${fmtMoneyAr(orden.costo_procesos_est || 0)} · Costo Real: ${fmtMoneyAr(orden.costo_procesos_real || 0)}`,
    m + w - 3,
    footerTop + 1.2,
    { size: baseSz - 0.4, align: 'right', color: mutedCol },
  );

  const lineY = footerTop + 15.5;
  doc.text('Responsable Producción:', m + 4, footerTop + 8.5, { size: baseSz - 0.3, bold: true });
  doc.line(m + 42, lineY, midX - 8, lineY, { color: '#334155', lineWidth: 0.5 });
  doc.text('Conformidad Taller / Control:', midX + 4, footerTop + 8.5, { size: baseSz - 0.3, bold: true });
  doc.line(midX + 48, lineY, m + w - 6, lineY, { color: '#334155', lineWidth: 0.5 });

  stampUnifiedFooter(doc, emp, { margin: m });
  return doc.toBuffer();
}
