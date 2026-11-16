import { PdfDocument, PAGE_SIZES_MM, fmtDateAr, fmtNumAr, wrapTextMm } from './pdfBuilder.js';

function fmtMoneyAr(n) {
  return '$' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function generatePresupuestoPdf(presupuesto = {}, emp = {}) {
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
  const baseSz = 8.2;

  doc.rect(m, yTop, w, yBottom - yTop, { stroke: borderCol, lineWidth: 0.85 });

  // Franja superior
  const topBarH = 6.5;
  doc.rect(m, yTop, w, topBarH, { stroke: borderCol, fill: fillHeader, lineWidth: 0.6 });
  doc.text('PRESUPUESTO DE PRODUCCIÓN / SNAPSHOT DE INSUMOS', midX, yTop + 1.6, {
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
  doc.text('P', midX, headerTop + 2.2, { size: 19, bold: true, align: 'center' });
  doc.text('INTERNO', midX, headerTop + letterH - 4.2, { size: 6, bold: true, align: 'center' });

  const emisorBrand = emp.nombre_fantasia || emp.razon_social || 'Vanguard Production';
  const leftMaxW = letterX - m - 4;
  let ly = headerTop + 3;
  ly = doc.textBlock(emisorBrand, m + 3, ly, leftMaxW, { size: 12, bold: true, lineHeight: 1.15 });
  if (emp.razon_social && emp.razon_social !== emisorBrand) {
    ly = doc.textBlock(`Razón Social: ${emp.razon_social}`, m + 3, ly + 0.5, leftMaxW, { size: baseSz - 0.5, color: mutedCol });
  }
  if (emp.cuit) {
    ly = doc.textBlock(`CUIT: ${emp.cuit}${emp.condicion_iva ? ` (${emp.condicion_iva})` : ''}`, m + 3, ly + 0.4, leftMaxW, { size: baseSz - 0.5, color: mutedCol });
  }
  const dir = [emp.direccion, emp.localidad, emp.provincia].filter(Boolean).join(', ');
  if (dir) {
    doc.textBlock(`Domicilio: ${dir}`, m + 3, ly + 0.4, leftMaxW, { size: baseSz - 0.7, color: mutedCol });
  }

  const rightX = letterX + letterW + 4;
  const rightMaxW = (m + w) - rightX - 3;
  let ry = headerTop + 3;
  doc.text('PRESUPUESTO TÉCNICO', rightX, ry, { size: 11.5, bold: true, color: borderCol });
  ry += 5.8;
  ry = doc.textBlock(`Número: #${presupuesto.id || '-'}`, rightX, ry, rightMaxW, { size: baseSz + 0.5, bold: true });
  ry = doc.textBlock(`Fecha: ${fmtDateAr(presupuesto.fecha) || '-'}`, rightX, ry + 0.6, rightMaxW, { size: baseSz });
  doc.textBlock(`Total Pares / Unid.: ${fmtNumAr(presupuesto.total_pares || 0)}`, rightX, ry + 0.6, rightMaxW, { size: baseSz, bold: true });

  // Datos del Presupuesto
  let curY = headerTop + headerH;
  const metaH = 14;
  doc.rect(m, curY, w, metaH, { stroke: borderCol, fill: eco ? '#FFFFFF' : '#F8FAFC', lineWidth: 0.6 });
  doc.textBlock(`Título / Referencia: ${presupuesto.titulo || '-'}`, m + 3, curY + 2.5, w - 6, { size: baseSz + 0.5, bold: true });
  if (presupuesto.observaciones) {
    doc.textBlock(`Observaciones: ${presupuesto.observaciones}`, m + 3, curY + 7.5, w - 6, { size: baseSz - 0.3, color: mutedCol });
  }
  curY += metaH;

  // Pie de totales
  const items = Array.isArray(presupuesto.items) ? presupuesto.items : [];
  const summaryH = 10;
  const footerTop = yBottom - summaryH;
  doc.rect(m, footerTop, w, summaryH, { stroke: borderCol, fill: fillHeader, lineWidth: 0.7 });
  doc.text(`Total de Insumos: ${items.length} ítem(s) · Pares calculados: ${fmtNumAr(presupuesto.total_pares || 0)}`, m + 3, footerTop + 3, { size: baseSz + 0.3, bold: true });
  doc.text(`TOTAL PRESUPUESTO: ${fmtMoneyAr(presupuesto.total_monto || 0)}`, m + w - 3, footerTop + 3, { size: 10, bold: true, align: 'right' });

  // Tabla de Insumos
  const thH = 7;
  doc.rect(m, curY, w, thH, { stroke: borderCol, fill: fillHeader, lineWidth: 0.6 });

  const cProdW = 62;
  const cCatW = 28;
  const cProvW = 30;
  const cPreW = 22;
  const cCantW = 22;
  const cSubW = w - cProdW - cCatW - cProvW - cPreW - cCantW;

  const xProd = m;
  const xCat = xProd + cProdW;
  const xProv = xCat + cCatW;
  const xPre = xProv + cProvW;
  const xCant = xPre + cPreW;
  const xSub = xCant + cCantW;

  doc.text('Insumo / Producto', xProd + 2, curY + 2, { size: baseSz, bold: true });
  doc.text('Categoría', xCat + 2, curY + 2, { size: baseSz, bold: true });
  doc.text('Proveedor', xProv + 2, curY + 2, { size: baseSz, bold: true });
  doc.text('Precio Unit.', xPre + cPreW - 2, curY + 2, { size: baseSz, bold: true, align: 'right' });
  doc.text('A Comprar', xCant + cCantW - 2, curY + 2, { size: baseSz, bold: true, align: 'right' });
  doc.text('Subtotal', xSub + cSubW - 2, curY + 2, { size: baseSz, bold: true, align: 'right' });

  curY += thH;
  for (const it of items) {
    const rowH = 6.2;
    if (curY + rowH > footerTop - 2) break;
    const nomLines = wrapTextMm(it.nombre || '-', cProdW - 3, baseSz - 0.4, true);
    doc.text(nomLines[0] || '-', xProd + 2, curY + 1.5, { size: baseSz - 0.4, bold: true });
    doc.text(String(it.categoria || '-').slice(0, 18), xCat + 2, curY + 1.5, { size: baseSz - 0.5, color: mutedCol });
    doc.text(String(it.proveedor_nombre || '-').slice(0, 18), xProv + 2, curY + 1.5, { size: baseSz - 0.5, color: mutedCol });
    doc.text(fmtMoneyAr(it.precio_unitario), xPre + cPreW - 2, curY + 1.5, { size: baseSz - 0.4, align: 'right' });
    doc.text(`${fmtNumAr(it.a_comprar ?? it.cantidad, 3)} ${it.udm || ''}`, xCant + cCantW - 2, curY + 1.5, { size: baseSz - 0.4, align: 'right' });
    doc.text(fmtMoneyAr(it.subtotal), xSub + cSubW - 2, curY + 1.5, { size: baseSz - 0.4, bold: true, align: 'right' });
    curY += rowH;
    doc.line(m, curY, m + w, curY, { color: '#E2E8F0', lineWidth: 0.35 });
  }

  return doc.toBuffer();
}
