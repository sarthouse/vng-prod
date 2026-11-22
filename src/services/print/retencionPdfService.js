import { PdfDocument, PAGE_SIZES_MM, fmtDateAr } from './pdfBuilder.js';
import { getPrintTheme, drawEmpresaBlock, stampUnifiedFooter, fmtMoneyAr } from './printLayout.js';

export function generateRetencionPdf({ pago = {}, retencion = {} } = {}, emp = {}) {
  const spec = PAGE_SIZES_MM.A4;
  const doc = new PdfDocument();
  doc.addPage(spec.w, spec.h);

  const theme = getPrintTheme(emp);
  const { fillHeader, borderCol, mutedCol } = theme;
  const m = spec.margin;
  const w = spec.w - m * 2;

  // Marco exterior
  doc.rect(m, m, w, 130, { stroke: borderCol, lineWidth: 0.85 });

  // Encabezado
  doc.rect(m, m, w, 12, { stroke: borderCol, fill: fillHeader, lineWidth: 0.7 });
  doc.text('CERTIFICADO DE RETENCIÓN IMPOSITIVA', m + w / 2, m + 4, { size: 11, bold: true, align: 'center' });

  let y = m + 15;
  const midX = m + w / 2;
  doc.line(midX, m + 12, midX, m + 50, { color: borderCol, lineWidth: 0.5 });
  doc.line(m, m + 50, m + w, m + 50, { color: borderCol, lineWidth: 0.7 });

  // Agente de Retención (izquierda)
  doc.text('AGENTE DE RETENCIÓN', m + 3, y, { size: 7.5, bold: true, color: mutedCol });
  drawEmpresaBlock(doc, emp, { x: m + 3, y: y + 4, maxW: w / 2 - 6, isCompact: true });
  if (emp.cuit) {
    doc.text(`CUIT: ${emp.cuit}`, m + 3, y, { size: 8.5 });
    y += 4.5;
  }
  const dirEmp = [emp.direccion, emp.localidad, emp.provincia].filter(Boolean).join(', ');
  if (dirEmp) {
    doc.textBlock(`Domicilio: ${dirEmp}`, m + 3, y, w / 2 - 6, { size: 7.8, color: mutedCol });
  }

  // Datos del Certificado (derecha)
  let ry = m + 16;
  doc.text('DATOS DEL CERTIFICADO', midX + 3, ry, { size: 7.5, bold: true, color: mutedCol });
  ry += 4.5;
  doc.text(`Certificado N°: ${retencion.numero_certificado || pago.numero || '-'}`, midX + 3, ry, { size: 9.5, bold: true });
  ry += 5;
  doc.text(`Fecha de Emisión: ${fmtDateAr(pago.fecha) || '-'}`, midX + 3, ry, { size: 8.5 });
  ry += 4.5;
  doc.text(`Orden de Pago Ref.: ${pago.numero || `#${pago.id || ''}`}`, midX + 3, ry, { size: 8.5 });
  if (pago.compra_numero) {
    ry += 4.5;
    doc.text(`Comprobante Origen: ${pago.compra_numero}`, midX + 3, ry, { size: 8.2, color: mutedCol });
  }

  // Sujeto Retenido
  let sy = m + 50;
  doc.text('SUJETO RETENIDO', m + 3, sy, { size: 7.5, bold: true, color: mutedCol });
  sy += 4.5;
  const sujeto = pago.contacto_razon_social || pago.contacto_nombre || pago.proveedor_nombre || '-';
  doc.text(`Razón Social / Nombre: ${sujeto}`, m + 3, sy, { size: 9, bold: true });
  sy += 4.8;
  doc.text(`CUIT / Doc.: ${pago.contacto_cuit || '-'}    Cond. IVA: ${pago.contacto_condicion_iva || '-'}`, m + 3, sy, { size: 8.5 });
  sy += 4.8;
  const dirSuj = [pago.contacto_direccion, pago.contacto_localidad, pago.contacto_provincia].filter(Boolean).join(', ');
  if (dirSuj) {
    doc.text(`Domicilio: ${dirSuj}`, m + 3, sy, { size: 8, color: mutedCol });
    sy += 4.8;
  }

  doc.line(m, sy + 2, m + w, sy + 2, { color: borderCol, lineWidth: 0.7 });

  // Detalle de la Retención
  let dy = sy + 6;
  doc.rect(m + 3, dy, w - 6, 7, { stroke: borderCol, fill: fillHeader, lineWidth: 0.5 });
  doc.text('Impuesto / Régimen', m + 5, dy + 2, { size: 8, bold: true });
  doc.text('Jur.', m + 88, dy + 2, { size: 8, bold: true });
  doc.text('Cód. Rég.', m + 104, dy + 2, { size: 8, bold: true });
  doc.text('Base Imponible', m + 142, dy + 2, { size: 8, bold: true, align: 'right' });
  doc.text('Alíc.', m + 158, dy + 2, { size: 8, bold: true, align: 'right' });
  doc.text('Importe Retenido', m + w - 5, dy + 2, { size: 8, bold: true, align: 'right' });

  dy += 10;
  doc.text(retencion.nombre || 'Retención', m + 5, dy, { size: 8.5, bold: true });
  doc.text(retencion.jurisdiccion_codigo || 'NAC', m + 88, dy, { size: 8.5 });
  doc.text(retencion.codigo_regimen || '-', m + 104, dy, { size: 8.5 });
  doc.text(fmtMoneyAr(retencion.base_imponible), m + 142, dy, { size: 8.5, align: 'right' });
  doc.text(`${Number(retencion.alicuota || 0)}%`, m + 158, dy, { size: 8.5, align: 'right' });
  doc.text(fmtMoneyAr(retencion.monto), m + w - 5, dy, { size: 9, bold: true, align: 'right' });

  // Firma
  doc.line(m + w - 65, m + 118, m + w - 8, m + 118, { color: borderCol, lineWidth: 0.5 });
  doc.text('Firma y Sello Agente de Retención', m + w - 36.5, m + 121, { size: 7.5, color: mutedCol, align: 'center' });

  stampUnifiedFooter(doc, emp, { margin: m });
  return doc.toBuffer();
}
