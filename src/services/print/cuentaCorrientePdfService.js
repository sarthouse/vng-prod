import { fmtDateAr } from './pdfBuilder.js';
import { createReportContext, fmtMoneyAr } from './reportLayout.js';

function drawSectionMovs(ctx, titulo, subtitulo, movs, saldoLabel, saldoVal) {
  const { doc, m, w, borderCol, mutedCol } = ctx;
  ctx.ensureSpace(18);

  doc.text(titulo, m + 3, ctx.y, { size: 9.5, bold: true });
  doc.text(`${saldoLabel}: ${fmtMoneyAr(saldoVal)}`, m + w - 3, ctx.y, { size: 9.2, bold: true, align: 'right' });
  ctx.y += 4.2;
  if (subtitulo) {
    doc.text(subtitulo, m + 3, ctx.y, { size: 7.4, color: mutedCol });
    ctx.y += 4.2;
  }

  const cols = [
    { label: 'Fecha', w: 22 },
    { label: 'Comprobante', w: 46 },
    { label: 'Número', w: 38 },
    { label: 'Debe', w: 26, align: 'right' },
    { label: 'Haber', w: 26, align: 'right' },
    { label: 'Saldo', w: w - 7 - 22 - 46 - 38 - 26 - 26, align: 'right' },
  ];

  ctx.drawTableHeaders(cols);

  if (!movs || movs.length === 0) {
    doc.text('Sin movimientos confirmados.', m + 4, ctx.y + 2, { size: 7.8, color: mutedCol });
    ctx.y += 8;
    return;
  }

  for (const mv of movs) {
    ctx.ensureSpace(6, () => ctx.drawTableHeaders(cols));
    let x = m + 3.5;
    const rowY = ctx.y + 1.2;
    const vals = [
      fmtDateAr(mv.fecha || ''),
      mv.tipo || '-',
      mv.numero || '-',
      mv.debe > 0 ? fmtMoneyAr(mv.debe) : '-',
      mv.haber > 0 ? fmtMoneyAr(mv.haber) : '-',
      fmtMoneyAr(mv.saldo || 0),
    ];
    vals.forEach((val, idx) => {
      const c = cols[idx];
      const tx = c.align === 'right' ? x + c.w - 2 : x;
      doc.text(String(val), tx, rowY, {
        size: 7.4,
        bold: idx === 5,
        align: c.align || 'left',
        maxWidth: c.w - 2,
      });
      x += c.w;
    });
    ctx.y += 5;
    doc.line(m + 2, ctx.y, m + w - 2, ctx.y, { color: '#CBD5E1', lineWidth: 0.25 });
  }
  ctx.y += 4;
  doc.line(m + 2, ctx.y - 2, m + w - 2, ctx.y - 2, { color: borderCol, lineWidth: 0.4 });
}

export function generateCuentaCorrientePdf(payload = {}, emp = {}) {
  const contacto = payload.contacto || {};
  const movsCliente = Array.isArray(payload.movsCliente) ? payload.movsCliente : [];
  const movsProveedor = Array.isArray(payload.movsProveedor) ? payload.movsProveedor : [];
  const saldoCliente = Number(payload.saldoCliente ?? contacto.saldo_cliente ?? 0);
  const saldoProveedor = Number(payload.saldoProveedor ?? contacto.saldo_proveedor ?? 0);

  const ctx = createReportContext('EXTRACTO DE CUENTA CORRIENTE', emp);
  const { doc, m, w, fillHeader, borderCol, mutedCol } = ctx;

  // Ficha del contacto
  const boxH = 14;
  doc.rect(m + 2, ctx.y, w - 4, boxH, { fill: fillHeader, stroke: borderCol, lineWidth: 0.45 });
  doc.text('CONTACTO', m + 4, ctx.y + 1.8, { size: 6.8, bold: true, color: mutedCol });
  doc.text(contacto.razon_social || contacto.nombre || '-', m + 4, ctx.y + 5.2, { size: 9.2, bold: true, maxWidth: w / 2 - 6 });
  const fiscalTxt = [
    contacto.cuit ? `${contacto.tipo_documento || 'CUIT'}: ${contacto.cuit}` : '',
    contacto.condicion_iva || '',
  ].filter(Boolean).join(' · ');
  if (fiscalTxt) doc.text(fiscalTxt, m + 4, ctx.y + 9.6, { size: 7.4, color: mutedCol, maxWidth: w / 2 - 6 });

  const rightX = m + w / 2 + 2;
  doc.text('DOMICILIO / CONTACTO', rightX, ctx.y + 1.8, { size: 6.8, bold: true, color: mutedCol });
  const dirTxt = [contacto.direccion || contacto.direccion_fiscal || '', contacto.localidad || '', contacto.provincia || ''].filter(Boolean).join(', ') || '-';
  doc.text(dirTxt, rightX, ctx.y + 5.2, { size: 8, maxWidth: w / 2 - 6 });
  const telMail = [contacto.telefono || '', contacto.email || ''].filter(Boolean).join(' · ');
  if (telMail) doc.text(telMail, rightX, ctx.y + 9.6, { size: 7.4, color: mutedCol, maxWidth: w / 2 - 6 });

  ctx.y += boxH + 5;

  const mostrarCli = Boolean(contacto.es_cliente) || movsCliente.length > 0;
  const mostrarProv = Boolean(contacto.es_proveedor) || Boolean(contacto.es_taller) || movsProveedor.length > 0;

  if (mostrarCli) {
    drawSectionMovs(ctx, 'Cuenta Corriente Cliente', 'Ventas confirmadas (+) vs. Cobros y Notas de Crédito (-)', movsCliente, 'Saldo a Cobrar', saldoCliente);
  }
  if (mostrarProv) {
    drawSectionMovs(ctx, 'Cuenta Corriente Proveedor', 'Compras confirmadas (+) vs. Pagos y Notas de Crédito (-)', movsProveedor, 'Saldo a Pagar', saldoProveedor);
  }
  if (!mostrarCli && !mostrarProv) {
    doc.text('Este contacto no registra movimientos de cuenta corriente.', m + 4, ctx.y + 4, { size: 8, color: mutedCol });
  }

  return ctx.finish();
}
