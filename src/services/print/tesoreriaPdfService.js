import { PdfDocument, PAGE_SIZES_MM, fmtDateAr } from './pdfBuilder.js';
import { getPrintTheme, drawEmpresaBlock, stampUnifiedFooter, fmtMoneyAr } from './printLayout.js';
import { numeroALetrasPesos } from './reciboSueldoPdfService.js';

export function generateTesoreriaPdf(payload = {}, emp = {}) {
  const spec = PAGE_SIZES_MM.A4;
  const doc = new PdfDocument();
  doc.addPage(spec.w, spec.h);

  const theme = getPrintTheme(emp);
  const { fillHeader, borderCol, mutedCol, fillTotal, totalTextCol } = theme;
  const m = spec.margin;
  const w = spec.w - m * 2;
  const yTop = m;
  const yBottom = spec.h - m;

  const titulo = payload.titulo || 'COMPROBANTE DE TESORERÍA';
  const docData = payload.doc || {};
  const numero = docData.numero || `#${docData.id || ''}`;
  const letra = String(payload.letra || (titulo.toUpperCase().includes('PAGO') ? 'OP' : 'RC')).slice(0, 2);
  const contraparteLabel = payload.contraparteLabel || 'Destinatario / Contacto';
  const contraparteFallback = payload.contraparteFallback || '-';
  const docRefLabel = payload.docRefLabel || 'Comprobante Ref.';
  const docRefNumero = payload.docRefNumero || '';
  const lineas = Array.isArray(payload.lineas) && payload.lineas.length > 0
    ? payload.lineas
    : [{
        cuenta_nombre: docData.cuenta_nombre || '-',
        metodo: docData.metodo || '-',
        referencia: docData.referencia || '',
        monto: docData.monto || 0,
      }];

  // Marco exterior y barra superior
  doc.rect(m, yTop, w, yBottom - yTop, { stroke: borderCol, lineWidth: 0.85 });
  const topBarH = 6.5;
  doc.rect(m, yTop, w, topBarH, { stroke: borderCol, fill: fillHeader, lineWidth: 0.65 });
  doc.text('ORIGINAL · COMPROBANTE DE TESORERÍA', m + w / 2, yTop + 1.6, { size: 8.5, bold: true, align: 'center' });

  // Encabezado dual con recuadro de letra central
  const headerTop = yTop + topBarH;
  const headerH = 40;
  const midX = m + w / 2;
  const letterW = 17;
  const letterH = 15;
  doc.line(midX, headerTop + letterH, midX, headerTop + headerH, { color: borderCol, lineWidth: 0.55 });
  doc.line(m, headerTop + headerH, m + w, headerTop + headerH, { color: borderCol, lineWidth: 0.7 });

  doc.rect(midX - letterW / 2, headerTop, letterW, letterH, { stroke: borderCol, fill: fillHeader, lineWidth: 0.8 });
  doc.text(letra, midX, headerTop + 2.8, { size: 15, bold: true, align: 'center' });
  doc.text('TES', midX, headerTop + letterH - 4, { size: 6.5, bold: true, align: 'center', color: mutedCol });

  drawEmpresaBlock(doc, emp, { x: m + 3, y: headerTop + 2.5, maxW: midX - m - letterW / 2 - 5, isCompact: true });

  const rightX = midX + letterW / 2 + 4;
  let ry = headerTop + 3;
  doc.text(titulo, rightX, ry, { size: 10.5, bold: true });
  ry += 5.5;
  doc.text(`N°: ${numero}`, rightX, ry, { size: 9.5, bold: true });
  ry += 4.8;
  doc.text(`Fecha: ${fmtDateAr(docData.fecha || new Date().toISOString().slice(0, 10))}`, rightX, ry, { size: 8 });
  ry += 4.5;
  doc.text(`Estado: ${docData.estado || 'Confirmado'}`, rightX, ry, { size: 8, color: mutedCol });
  if (docRefNumero) {
    ry += 4.5;
    doc.text(`${docRefLabel}: ${docRefNumero}`, rightX, ry, { size: 7.5, color: mutedCol });
  }

  // Bloque Contraparte
  let curY = headerTop + headerH;
  const cpBoxH = 21;
  doc.rect(m, curY, w, cpBoxH, { stroke: borderCol, lineWidth: 0.55 });
  const cpNombre = docData.contacto_razon_social || docData.contacto_nombre || docData.cliente_nombre || docData.proveedor_nombre || contraparteFallback;
  const cpDoc = docData.contacto_cuit ? `${docData.contacto_tipo_documento || 'CUIT'}: ${docData.contacto_cuit}` : '';
  const cpMeta = [cpDoc, docData.contacto_condicion_iva].filter(Boolean).join(' · ');
  const cpDir = [docData.contacto_direccion, docData.contacto_localidad, docData.contacto_provincia].filter(Boolean).join(', ');

  doc.text(`${contraparteLabel}:`, m + 3, curY + 2.5, { size: 7.5, bold: true, color: mutedCol });
  doc.text(cpNombre, m + 3, curY + 6.8, { size: 9.5, bold: true, maxWidth: w - 6 });
  if (cpMeta) doc.text(cpMeta, m + 3, curY + 11.5, { size: 7.5, color: mutedCol });
  if (cpDir) doc.text(cpDir, m + 3, curY + 15.5, { size: 7.5, color: mutedCol, maxWidth: w - 6 });
  curY += cpBoxH + 3;

  // Tabla de medios de pago / cobro
  const thH = 6.5;
  doc.rect(m, curY, w, thH, { stroke: borderCol, fill: fillHeader, lineWidth: 0.6 });
  doc.text('Cuenta / Caja / Banco', m + 3, curY + 1.8, { size: 7.8, bold: true });
  doc.text('Medio', m + 75, curY + 1.8, { size: 7.8, bold: true });
  doc.text('Referencia / Cheque', m + 112, curY + 1.8, { size: 7.8, bold: true });
  doc.text('Importe', m + w - 3, curY + 1.8, { size: 7.8, bold: true, align: 'right' });
  curY += thH;

  let total = 0;
  for (const l of lineas) {
    const monto = Number(l.monto || 0);
    total += monto;
    doc.rect(m, curY, w, 7, { stroke: '#CBD5E1', lineWidth: 0.4 });
    doc.text(String(l.cuenta_nombre || '-'), m + 3, curY + 2, { size: 8, maxWidth: 69 });
    doc.text(String(l.metodo || '-'), m + 75, curY + 2, { size: 8, maxWidth: 34 });
    doc.text(String(l.referencia || '-'), m + 112, curY + 2, { size: 8, maxWidth: 42 });
    doc.text(fmtMoneyAr(monto), m + w - 3, curY + 2, { size: 8, bold: true, align: 'right' });
    curY += 7;
  }

  const totalFinal = Number(docData.monto || total || 0);
  curY += 4;
  const letras = numeroALetrasPesos(totalFinal);
  doc.rect(m, curY, w, 12, { stroke: borderCol, fill: fillHeader, lineWidth: 0.55 });
  doc.text('Son pesos:', m + 3, curY + 2, { size: 7.5, bold: true, color: mutedCol });
  doc.textBlock(letras, m + 3, curY + 5.8, w - 6, { size: 8, bold: true });
  curY += 15;

  if (docData.concepto || docData.observaciones) {
    doc.text(`Concepto / Observaciones: ${docData.concepto || docData.observaciones}`, m + 3, curY, { size: 8, color: mutedCol, maxWidth: w - 6 });
    curY += 7;
  }

  // Pie de totales y firmas anclado al fondo
  const signH = 26;
  const totH = 10;
  const footerTop = yBottom - signH - totH - 4;
  doc.rect(m, footerTop, w, totH, { stroke: borderCol, fill: fillTotal, lineWidth: 0.7 });
  doc.text('TOTAL COMPROBANTE:', m + 4, footerTop + 2.8, { size: 9.5, bold: true, color: totalTextCol });
  doc.text(fmtMoneyAr(totalFinal), m + w - 4, footerTop + 2.8, { size: 10.5, bold: true, align: 'right', color: totalTextCol });

  const signY = footerTop + totH + 2;
  doc.rect(m, signY, w, signH, { stroke: borderCol, lineWidth: 0.6 });
  doc.line(midX, signY, midX, signY + signH, { color: borderCol, lineWidth: 0.5 });
  doc.text('Recibí conforme / Firma:', m + 4, signY + 3, { size: 7.5, bold: true, color: mutedCol });
  doc.line(m + 8, signY + 17, midX - 8, signY + 17, { color: '#94A3B8', lineWidth: 0.5 });
  doc.text('Aclaración y DNI:', m + 8, signY + 19, { size: 7, color: mutedCol });

  doc.text('Por la Empresa / Tesorería:', midX + 4, signY + 3, { size: 7.5, bold: true, color: mutedCol });
  doc.line(midX + 8, signY + 17, m + w - 8, signY + 17, { color: '#94A3B8', lineWidth: 0.5 });
  doc.text('Firma autorizada', midX + 8, signY + 19, { size: 7, color: mutedCol });

  stampUnifiedFooter(doc, emp, { margin: m });
  return doc.toBuffer();
}
