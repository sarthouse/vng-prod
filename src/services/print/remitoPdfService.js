import { PdfDocument, PAGE_SIZES_MM, fmtDateAr, fmtNumAr, wrapTextMm } from './pdfBuilder.js';
import {
  stampUnifiedFooter,
  resolveCopyLabels,
  resolvePrintFormat,
  drawFiscalSheetHeader,
  drawTicketHeader,
} from './printLayout.js';

export function resolveRemitoLetter(cai) {
  return String(cai || '').trim() ? 'R' : 'X';
}

export function resolveRemitoCodigo(letter) {
  return letter === 'R' ? 'COD. 91' : 'COD. 099';
}

export function splitComprobanteNumero(numero) {
  const raw = String(numero || '').trim();
  if (!raw) return { ptoVta: '0001', cbteNro: '-' };
  const m = raw.match(/^(?:[A-Za-z]+\s+)?(\d{4,5})-(\d{6,8})$/);
  if (m) return { ptoVta: m[1].padStart(4, '0'), cbteNro: m[2] };
  return { ptoVta: '-', cbteNro: raw };
}

function renderRemitoSheetPage(doc, data, emp, copyLabel, fmt) {
  const spec = PAGE_SIZES_MM[fmt] || PAGE_SIZES_MM.A4;
  const isA5 = fmt === 'A5';
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
  const baseSz = isA5 ? 7.2 : 8.2;

  // Marco exterior de hoja completa (border-box)
  doc.rect(m, yTop, w, yBottom - yTop, { stroke: borderCol, lineWidth: 0.85 });

  const letter = resolveRemitoLetter(data.cai);
  const codLetra = resolveRemitoCodigo(letter);
  const { ptoVta, cbteNro } = splitComprobanteNumero(data.numero);
  const { topBarH, curY: headerEndY } = drawFiscalSheetHeader(doc, {
    m, w, yTop, isA5, copyLabel,
    letra: letter,
    codAfip: codLetra,
    subLetra: 'NO VÁLIDO FACTURA',
    titulo: (data.tipoDoc || 'REMITO').toUpperCase(),
    ptoVta,
    cbteNro,
    nroLabel: 'Remito Nro',
    fecha: data.fecha,
    extraRightLines: [
      data.cai ? `CAI: ${data.cai}${data.caiVto ? ` · Vto: ${fmtDateAr(data.caiVto)}` : ''}` : '',
    ],
    emp,
  });

  // ── 2. DATOS DE DESTINATARIO Y ENVÍO (2 COLUMNAS) ──────────────────────────
  let curY = headerEndY;
  const leftClientRows = [
    data.contraparteNombre ? `${data.contraparteLabel || 'Razón Social / Destinatario'}: ${data.contraparteNombre}` : '',
    data.contraparteCuit ? `DNI / CUIT: ${data.contraparteCuit}${data.contraparteIva ? ` (${data.contraparteIva})` : ''}` : '',
    data.contraparteDireccion ? `Domicilio: ${data.contraparteDireccion}` : '',
    data.contraparteLocalidad ? `Localidad: ${data.contraparteLocalidad}` : '',
    data.contraparteProvincia ? `Provincia: ${data.contraparteProvincia}` : '',
    data.contraparteCp ? `CP: ${data.contraparteCp}` : '',
    data.contraparteTelefono ? `Teléfono de Contacto: ${data.contraparteTelefono}` : '',
  ].filter(Boolean);

  const rightClientRows = [
    data.motivo ? `Comprobante / Motivo: ${data.motivo}` : '',
    data.contraparteEmail ? `Email: ${data.contraparteEmail}` : '',
    data.mostrarOrigenDestino && data.origen ? `Origen: ${data.origen}` : '',
    data.mostrarOrigenDestino && data.destino ? `Destino: ${data.destino}` : '',
  ].filter(Boolean);

  if (leftClientRows.length > 0 || rightClientRows.length > 0) {
    const colW = w / 2 - 6;
    const stepMm = (baseSz * 1.28) / (72 / 25.4);
    const leftLinesCount = leftClientRows.reduce((s, r) => s + wrapTextMm(r, colW, baseSz, false).length, 0);
    const rightLinesCount = rightClientRows.reduce((s, r) => s + wrapTextMm(r, colW, baseSz, false).length, 0);
    const boxH = Math.max(14, Math.max(leftLinesCount, rightLinesCount) * stepMm + 5);

    doc.rect(m, curY, w, boxH, { stroke: borderCol, fill: eco ? '#FFFFFF' : '#F8FAFC', lineWidth: 0.6 });
    doc.line(midX, curY, midX, curY + boxH, { color: '#CBD5E1', lineWidth: 0.5 });

    let cly = curY + 2.5;
    for (let i = 0; i < leftClientRows.length; i++) {
      cly = doc.textBlock(leftClientRows[i], m + 3, cly, colW, { size: baseSz, bold: i === 0, lineHeight: 1.28 });
    }
    let cry = curY + 2.5;
    for (const r of rightClientRows) {
      cry = doc.textBlock(r, midX + 3, cry, colW, { size: baseSz, lineHeight: 1.28 });
    }
    curY += boxH;
  }

  // ── 3. PIE ANCLADO AL FONDO (BARRA RESUMEN + NOTAS + RECIBÍ CONFORME) ──────
  const lineas = Array.isArray(data.lineas) ? data.lineas : [];
  const totalUnidades = lineas.reduce((s, l) => s + (Number(l.cantidad) || 0), 0);

  const notasList = [];
  if (data.nota) notasList.push(data.nota);
  if (Array.isArray(data.notasInternas) && data.notasInternas.length) {
    for (const n of data.notasInternas) {
      if (n && !notasList.includes(n)) notasList.push(n);
    }
  } else if (typeof data.notasInternas === 'string' && data.notasInternas.trim()) {
    notasList.push(data.notasInternas.trim());
  }
  const notasText = notasList.join(' | ');

  const envioText = String(data.envio || '').trim();
  const segText = String(data.codigo_seguimiento || '').trim();
  const dispatchParts = [];
  if (envioText) dispatchParts.push(`Envío: ${envioText}`);
  if (segText) dispatchParts.push(`Seguimiento: ${segText}`);
  const dispatchText = dispatchParts.join('   |   ');

  const pieTexto = (emp.print_pie_comprobante || '').trim();
  const pieH = pieTexto ? 6.5 : 0;
  const signH = isA5 ? 25 : 29;
  const noteLines = notasText ? wrapTextMm(`Observaciones de Entrega: ${notasText}`, w - 6, baseSz - 0.5, false) : [];
  const noteH = noteLines.length ? Math.max(8, noteLines.length * 3.5 + 3.5) : 0;
  const dispatchLines = dispatchText ? wrapTextMm(dispatchText, w - 6, baseSz - 0.5, false) : [];
  const dispatchH = dispatchLines.length ? Math.max(6.5, dispatchLines.length * 3.5 + 2.5) : 0;
  const summaryH = isA5 ? 6 : 7;

  const footerTop = yBottom - pieH - signH - dispatchH - noteH - summaryH;

  // Barra resumen de ítems y unidades
  doc.rect(m, footerTop, w, summaryH, { stroke: borderCol, fill: fillHeader, lineWidth: 0.6 });
  doc.text(`Total de Ítems: ${lineas.length}`, m + 3, footerTop + 1.8, { size: baseSz, bold: true });
  doc.text(`Total de Unidades / Bultos: ${fmtNumAr(totalUnidades)} un.`, m + w - 3, footerTop + 1.8, { size: baseSz, bold: true, align: 'right' });

  // Notas / Observaciones + Envío / Seguimiento
  let signY = footerTop + summaryH;
  if (noteH > 0) {
    doc.rect(m, signY, w, noteH, { stroke: borderCol, fill: '#FFFFFF', lineWidth: 0.5 });
    doc.textBlock(`Observaciones de Entrega: ${notasText}`, m + 3, signY + 1.8, w - 6, { size: baseSz - 0.5, lineHeight: 1.25 });
    signY += noteH;
  }
  if (dispatchH > 0) {
    doc.rect(m, signY, w, dispatchH, { stroke: borderCol, fill: '#F8FAFC', lineWidth: 0.5 });
    doc.textBlock(dispatchText, m + 3, signY + 1.5, w - 6, { size: baseSz - 0.5, bold: true, lineHeight: 1.2 });
    signY += dispatchH;
  }

  // Recuadro RECIBÍ CONFORME (sin "Entregado por")
  doc.rect(m, signY, w, signH, { stroke: borderCol, fill: '#FFFFFF', lineWidth: 0.7 });
  doc.rect(m, signY, w, 5.5, { stroke: borderCol, fill: fillHeader, lineWidth: 0.6 });
  doc.text('RECIBÍ CONFORME', m + 3, signY + 1.3, { size: baseSz, bold: true });

  const innerY = signY + 8;
  const col1X = m + 4;
  const col2X = m + w * 0.45;
  const lineY1 = innerY + (isA5 ? 5.5 : 6.5);
  const lineY2 = innerY + (isA5 ? 12.5 : 15.5);

  doc.text('Firma:', col1X, innerY, { size: baseSz, bold: true });
  doc.line(col1X + 11, lineY1, col2X - 6, lineY1, { color: '#334155', lineWidth: 0.5 });

  doc.text('Aclaración:', col2X, innerY, { size: baseSz, bold: true });
  doc.line(col2X + 18, lineY1, m + w - 4, lineY1, { color: '#334155', lineWidth: 0.5 });

  doc.text('DNI:', col1X, innerY + (isA5 ? 7.5 : 9.5), { size: baseSz, bold: true });
  doc.line(col1X + 9, lineY2, col2X - 6, lineY2, { color: '#334155', lineWidth: 0.5 });

  doc.text('Fecha de recepción:', col2X, innerY + (isA5 ? 7.5 : 9.5), { size: baseSz, bold: true });
  doc.text('_____ / _____ / 20_____', col2X + 30, innerY + (isA5 ? 7.5 : 9.5), { size: baseSz, color: mutedCol });

  if (pieTexto) {
    doc.text(pieTexto, midX, yBottom - pieH + 1.8, { size: 7, color: mutedCol, align: 'center' });
  }

  // ── 4. TABLA DE PRODUCTOS (OCUPA HASTA footerTop) ──────────────────────────
  const thH = isA5 ? 6 : 7;
  doc.rect(m, curY, w, thH, { stroke: borderCol, fill: fillHeader, lineWidth: 0.6 });

  const cNumW = isA5 ? 10 : 12;
  const cLoteW = isA5 ? 26 : 32;
  const cCantW = isA5 ? 20 : 24;
  const cUdmW = isA5 ? 16 : 20;
  const cDescW = w - cNumW - cLoteW - cCantW - cUdmW;

  const xNum = m;
  const xDesc = xNum + cNumW;
  const xLote = xDesc + cDescW;
  const xCant = xLote + cLoteW;
  const xUdm = xCant + cCantW;

  const thSz = isA5 ? 7 : 8;
  doc.text('Ítem', xNum + cNumW / 2, curY + 1.8, { size: thSz, bold: true, align: 'center' });
  doc.text('Descripción del Producto', xDesc + 2, curY + 1.8, { size: thSz, bold: true });
  doc.text('Lote / Código', xLote + 2, curY + 1.8, { size: thSz, bold: true });
  doc.text('Cantidad', xCant + cCantW - 2, curY + 1.8, { size: thSz, bold: true, align: 'right' });
  doc.text('UdM', xUdm + 2, curY + 1.8, { size: thSz, bold: true });

  for (const vx of [xDesc, xLote, xCant, xUdm]) {
    doc.line(vx, curY, vx, footerTop, { color: '#CBD5E1', lineWidth: 0.45 });
  }

  let rowY = curY + thH + 1.5;
  if (lineas.length === 0) {
    doc.text('Sin ítems detallados.', midX, rowY + 4, { size: baseSz, color: mutedCol, align: 'center' });
  } else {
    for (let idx = 0; idx < lineas.length; idx++) {
      const l = lineas[idx];
      const nombre = l.nombre || l.item_nombre || l.producto_nombre || l.descripcion || 'Ítem';
      const subDesc = (l.descripcion && l.nombre && l.descripcion !== l.nombre) ? l.descripcion : '';
      const descText = subDesc ? `${nombre}\n${subDesc}` : nombre;
      const linesCount = wrapTextMm(descText, cDescW - 4, baseSz, false).length;
      const rowH = Math.max(5.5, linesCount * 3.8 + 1.5);
      if (rowY + rowH > footerTop - 2) {
        doc.addPage(spec.w, spec.h);
        doc.rect(m, yTop, w, yBottom - yTop, { stroke: borderCol, lineWidth: 0.85 });
        doc.rect(m, yTop, w, topBarH, { stroke: borderCol, fill: fillHeader, lineWidth: 0.65 });
        doc.text(`${copyLabel} · CONTINUACIÓN`, midX, yTop + (isA5 ? 1.3 : 1.6), { size: isA5 ? 7.5 : 8.5, bold: true, align: 'center' });
        const contY = yTop + topBarH + 2;
        doc.rect(m, contY, w, thH, { stroke: borderCol, fill: fillHeader, lineWidth: 0.6 });
        doc.text('Ítem', xNum + cNumW / 2, contY + 1.8, { size: thSz, bold: true, align: 'center' });
        doc.text('Descripción del Producto', xDesc + 2, contY + 1.8, { size: thSz, bold: true });
        doc.text('Lote / Código', xLote + 2, contY + 1.8, { size: thSz, bold: true });
        doc.text('Cantidad', xCant + cCantW - 2, contY + 1.8, { size: thSz, bold: true, align: 'right' });
        doc.text('UdM', xUdm + 2, contY + 1.8, { size: thSz, bold: true });
        for (const vx of [xDesc, xLote, xCant, xUdm]) {
          doc.line(vx, contY, vx, yBottom - 4, { color: '#CBD5E1', lineWidth: 0.45 });
        }
        rowY = contY + thH + 1.5;
      }

      doc.text(String(idx + 1).padStart(2, '0'), xNum + cNumW / 2, rowY, { size: baseSz, align: 'center' });
      doc.textBlock(descText, xDesc + 2, rowY, cDescW - 4, { size: baseSz, lineHeight: 1.25 });
      doc.text(String(l.lote || '—'), xLote + 2, rowY, { size: baseSz, color: l.lote ? borderCol : mutedCol });
      doc.text(fmtNumAr(l.cantidad), xCant + cCantW - 2, rowY, { size: baseSz, bold: true, align: 'right' });
      doc.text(String(l.udm || 'un.'), xUdm + 2, rowY, { size: baseSz });

      rowY += rowH;
      doc.line(m, rowY - 0.5, m + w, rowY - 0.5, { color: '#E2E8F0', lineWidth: 0.35 });
    }
  }
}

function renderRemitoTicketPage(doc, data, emp, copyLabel, fmt) {
  const is58 = fmt === 'ticket58';
  const wMm = is58 ? 58 : 80;
  const m = is58 ? 2.5 : 3;
  const cw = wMm - m * 2;
  const letter = resolveRemitoLetter(data.cai);
  const { ptoVta, cbteNro } = splitComprobanteNumero(data.numero);

  const lineas = Array.isArray(data.lineas) ? data.lineas : [];
  const hMm = Math.max(115, 76 + lineas.length * 9 + (data.contraparteNombre ? 18 : 0) + (data.nota ? 10 : 0));
  doc.addPage(wMm, hMm);

  const { y: hdrY, sz } = drawTicketHeader(doc, {
    wMm, m, copyLabel,
    titulo: (data.tipoDoc || 'REMITO').toUpperCase(),
    letra: letter,
    codAfip: resolveRemitoCodigo(letter),
    ptoVta,
    cbteNro,
    nroLabel: 'Remito Nro',
    fecha: data.fecha,
    emp,
  });
  let y = hdrY;
  if (data.cai) {
    y = doc.textBlock(`CAI: ${data.cai}${data.caiVto ? ` (Vto ${fmtDateAr(data.caiVto)})` : ''}`, m, y, cw, { size: sz - 0.8, align: 'center', lineHeight: 1.2 });
    y += 1.5;
    doc.line(m, y, m + cw, y, { dashed: true, lineWidth: 0.4 });
    y += 2;
  }

  if (data.contraparteNombre) {
    y = doc.textBlock(`${data.contraparteLabel || 'Cliente'}: ${data.contraparteNombre}`, m, y, cw, { size: sz, bold: true, lineHeight: 1.2 });
    if (data.contraparteDireccion) y = doc.textBlock(data.contraparteDireccion, m, y, cw, { size: sz - 0.5, lineHeight: 1.2 });
    const loc = [data.contraparteLocalidad, data.contraparteProvincia, data.contraparteCp ? `CP ${data.contraparteCp}` : ''].filter(Boolean).join(', ');
    if (loc) y = doc.textBlock(loc, m, y, cw, { size: sz - 0.5, lineHeight: 1.2 });
    if (data.contraparteTelefono) y = doc.textBlock(`Tel: ${data.contraparteTelefono}`, m, y, cw, { size: sz - 0.5, lineHeight: 1.2 });
    y += 1.5;
    doc.line(m, y, m + cw, y, { dashed: true, lineWidth: 0.5 });
    y += 2;
  }

  for (const l of lineas) {
    const nombre = l.nombre || l.item_nombre || l.producto_nombre || l.descripcion || 'Ítem';
    const qty = `${fmtNumAr(l.cantidad)} ${l.udm || 'u.'}`;
    doc.text(qty, m + cw, y, { size: sz, bold: true, align: 'right' });
    y = doc.textBlock(nombre, m, y, cw - 18, { size: sz, lineHeight: 1.2 });
    if (l.lote) y = doc.textBlock(`Lote: ${l.lote}`, m + 2, y, cw - 2, { size: sz - 1, color: '#475569', lineHeight: 1.15 });
  }

  y += 2;
  doc.line(m, y, m + cw, y, { dashed: true, lineWidth: 0.5 });
  y += 3;
  if (data.envio) y = doc.textBlock(`Envío: ${data.envio}`, m, y, cw, { size: sz - 0.5, bold: true, lineHeight: 1.2 });
  if (data.codigo_seguimiento) y = doc.textBlock(`Seguimiento: ${data.codigo_seguimiento}`, m, y, cw, { size: sz - 0.5, bold: true, lineHeight: 1.2 });
  if (data.envio || data.codigo_seguimiento) y += 1.5;
  doc.text('RECIBÍ CONFORME', m, y, { size: sz, bold: true });
  y += 5;
  doc.text('Firma: ________________________', m, y, { size: sz - 0.5 });
  y += 5;
  doc.text('Aclaración: ___________________', m, y, { size: sz - 0.5 });
  y += 5;
  doc.text('DNI: __________________________', m, y, { size: sz - 0.5 });
}

export function generateRemitoPdf(data = {}, emp = {}) {
  const enrichedData = data || {};

  const fmt = resolvePrintFormat(enrichedData.formato, emp.print_formato, ['A4', 'A5', 'ticket80', 'ticket58']);
  const labels = resolveCopyLabels(enrichedData.copias, emp.print_copias);

  const doc = new PdfDocument();
  const isTicket = fmt === 'ticket80' || fmt === 'ticket58';

  for (const copyLabel of labels) {
    if (isTicket) renderRemitoTicketPage(doc, enrichedData, emp, copyLabel, fmt);
    else renderRemitoSheetPage(doc, enrichedData, emp, copyLabel, fmt);
  }
  if (!isTicket) {
    const spec = PAGE_SIZES_MM[fmt] || PAGE_SIZES_MM.A4;
    stampUnifiedFooter(doc, emp, { margin: spec.margin });
  }
  return doc.toBuffer();
}
