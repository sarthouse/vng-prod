import { fmtDateAr } from './pdfBuilder.js';
import { createReportContext, fmtMoneyAr } from './reportLayout.js';

export function generateTesoreriaPdf(payload = {}, emp = {}) {
  const titulo = payload.titulo || 'COMPROBANTE DE TESORERÍA';
  const docData = payload.doc || {};
  const numero = docData.numero || `#${docData.id || ''}`;
  const contraparteLabel = payload.contraparteLabel || 'Contacto';
  const contraparteFallback = payload.contraparteFallback || '-';
  const docRefLabel = payload.docRefLabel || 'Referencia';
  const docRefNumero = payload.docRefNumero || '';
  const lineas = Array.isArray(payload.lineas) && payload.lineas.length > 0
    ? payload.lineas
    : [{
        cuenta_nombre: docData.cuenta_nombre || '-',
        metodo: docData.metodo || '-',
        referencia: docData.referencia || '',
        monto: docData.monto || 0,
      }];

  const ctx = createReportContext(`${titulo} · ${numero}`, emp, {
    subtitle: `Fecha: ${fmtDateAr(docData.fecha || '')} · ${docData.estado || 'Confirmado'}`,
  });
  const { doc, m, w, fillHeader, borderCol, mutedCol } = ctx;

  const cpNombre = docData.contacto_razon_social || docData.contacto_nombre || docData.cliente_nombre || docData.proveedor_nombre || contraparteFallback;
  const cpDoc = docData.contacto_cuit ? `${docData.contacto_tipo_documento || 'CUIT'}: ${docData.contacto_cuit}` : '';
  const cpMeta = [cpDoc, docData.contacto_condicion_iva].filter(Boolean).join(' · ');
  const cpDir = [docData.contacto_direccion, docData.contacto_localidad, docData.contacto_provincia].filter(Boolean).join(', ');

  const boxH = 14;
  doc.rect(m + 2, ctx.y, w - 4, boxH, { fill: fillHeader, stroke: borderCol, lineWidth: 0.45 });
  doc.text(contraparteLabel.toUpperCase(), m + 4, ctx.y + 1.8, { size: 6.8, bold: true, color: mutedCol });
  doc.text(cpNombre, m + 4, ctx.y + 5.2, { size: 9, bold: true, maxWidth: w / 2 - 6 });
  if (cpMeta) doc.text(cpMeta, m + 4, ctx.y + 9.6, { size: 7.4, color: mutedCol, maxWidth: w / 2 - 6 });

  const rightX = m + w / 2 + 2;
  doc.text('REFERENCIA / IMPUTACIÓN', rightX, ctx.y + 1.8, { size: 6.8, bold: true, color: mutedCol });
  const refTxt = docRefNumero ? `${docRefLabel}: ${docRefNumero}` : (docData.categoria_gasto || 'Cuenta Corriente / Tesorería');
  doc.text(refTxt, rightX, ctx.y + 5.2, { size: 8.2, bold: true, maxWidth: w / 2 - 6 });
  if (docData.concepto) doc.text(docData.concepto, rightX, ctx.y + 9.6, { size: 7.4, color: mutedCol, maxWidth: w / 2 - 6 });
  if (cpDir && !docData.concepto) doc.text(cpDir, rightX, ctx.y + 9.6, { size: 7.4, color: mutedCol, maxWidth: w / 2 - 6 });

  ctx.y += boxH + 5;

  const cols = [
    { label: '#', w: 10 },
    { label: 'Medio', w: 34 },
    { label: 'Cuenta / Caja / Banco', w: 54 },
    { label: 'Referencia / Cheque', w: w - 7 - 10 - 34 - 54 - 30 },
    { label: 'Importe', w: 30, align: 'right' },
  ];
  ctx.drawTableHeaders(cols);

  lineas.forEach((l, idx) => {
    ctx.ensureSpace(6, () => ctx.drawTableHeaders(cols));
    let x = m + 3.5;
    const rowY = ctx.y + 1.2;
    const vals = [
      String(idx + 1),
      l.metodo || '-',
      l.cuenta_nombre || '-',
      l.referencia || '-',
      fmtMoneyAr(l.monto || 0),
    ];
    vals.forEach((val, cIdx) => {
      const c = cols[cIdx];
      const tx = c.align === 'right' ? x + c.w - 2 : x;
      doc.text(String(val), tx, rowY, {
        size: 7.6,
        bold: cIdx === 1 || cIdx === 4,
        align: c.align || 'left',
        maxWidth: c.w - 2,
      });
      x += c.w;
    });
    ctx.y += 5.2;
    doc.line(m + 2, ctx.y, m + w - 2, ctx.y, { color: '#CBD5E1', lineWidth: 0.25 });
  });

  ctx.y += 4;
  doc.line(m + 2, ctx.y, m + w - 2, ctx.y, { color: borderCol, lineWidth: 0.55 });
  ctx.y += 3;
  doc.text(`TOTAL ${titulo}`, m + 3.5, ctx.y, { size: 9.5, bold: true });
  doc.text(fmtMoneyAr(docData.monto || 0), m + w - 3.5, ctx.y, { size: 10.5, bold: true, align: 'right' });

  ctx.y += 18;
  const signW = (w - 16) / 2;
  doc.line(m + 4, ctx.y, m + 4 + signW, ctx.y, { color: borderCol, lineWidth: 0.45 });
  doc.line(m + w - 4 - signW, ctx.y, m + w - 4, ctx.y, { color: borderCol, lineWidth: 0.45 });
  doc.text('Firma y Aclaración Emisor', m + 4 + signW / 2, ctx.y + 2, { size: 7.4, align: 'center', color: mutedCol });
  doc.text('Firma y Aclaración Receptor', m + w - 4 - signW / 2, ctx.y + 2, { size: 7.4, align: 'center', color: mutedCol });

  return doc.build();
}
