import { PdfDocument, PAGE_SIZES_MM, fmtDateAr, fmtNumAr, wrapTextMm } from './pdfBuilder.js';
import { splitComprobanteNumero } from './remitoPdfService.js';
import { isFacturaAMonotributo } from '../afip/fiscalRules.js';
import { encodeQrMatrix } from './qrEncoder.js';
import {
  fmtMoneyAr,
  stampUnifiedFooter,
  resolveCopyLabels,
  resolvePrintFormat,
  drawFiscalSheetHeader,
  drawTicketHeader,
} from './printLayout.js';

function resolveLetraAndTitulo(venta = {}) {
  const caracter = venta.caracter || 'fiscal';
  const tipo = String(venta.tipo_comprobante || '').toUpperCase();
  const clase = venta.clase_documento || 'factura';
  const isPresupuesto = venta.estado === 'Presupuesto' || venta.estado === 'Borrador';

  let letra = 'X';
  if (caracter === 'fiscal' && !isPresupuesto) {
    const match = tipo.match(/-(A|B|C|M)$/);
    letra = match ? match[1] : (tipo === 'INT' ? 'X' : 'B');
  }

  let titulo = 'FACTURA';
  if (clase === 'nota_credito') titulo = 'NOTA DE CRÉDITO';
  else if (clase === 'nota_debito') titulo = 'NOTA DE DÉBITO';
  else if (isPresupuesto) titulo = 'PRESUPUESTO';
  else if (caracter === 'interno' || letra === 'X') titulo = 'NOTA DE PEDIDO / VENTA';

  let codAfip = 'COD. 099';
  if (letra === 'A') codAfip = clase === 'nota_credito' ? 'COD. 003' : clase === 'nota_debito' ? 'COD. 002' : 'COD. 001';
  else if (letra === 'B') codAfip = clase === 'nota_credito' ? 'COD. 008' : clase === 'nota_debito' ? 'COD. 007' : 'COD. 006';
  else if (letra === 'C') codAfip = clase === 'nota_credito' ? 'COD. 013' : clase === 'nota_debito' ? 'COD. 012' : 'COD. 011';
  else if (letra === 'M') codAfip = clase === 'nota_credito' ? 'COD. 053' : clase === 'nota_debito' ? 'COD. 052' : 'COD. 051';

  const subLetra = letra === 'X' ? 'NO VÁLIDO FACTURA' : 'COMPROBANTE FISCAL';
  const discriminaIva = caracter === 'fiscal' && (letra === 'A' || letra === 'M');
  return { letra, codAfip, titulo, subLetra, discriminaIva, clase };
}

function renderVentaSheetPage(doc, { venta = {}, lineas = [] }, emp, copyLabel, fmt) {
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

  const { letra, codAfip, titulo, subLetra, discriminaIva, clase } = resolveLetraAndTitulo(venta);
  const numero = venta.numero || `#${venta.id || ''}`;
  const { ptoVta, cbteNro } = splitComprobanteNumero(numero);

  // Marco exterior de hoja completa
  doc.rect(m, yTop, w, yBottom - yTop, { stroke: borderCol, lineWidth: 0.85 });

  const { topBarH, curY: headerEndY } = drawFiscalSheetHeader(doc, {
    m, w, yTop, isA5, copyLabel,
    letra,
    codAfip,
    subLetra,
    titulo,
    ptoVta,
    cbteNro,
    fecha: venta.fecha,
    emp,
  });

  // ── 2. DATOS DEL CLIENTE (2 COLUMNAS) ──────────────────────────────────────
  let curY = headerEndY;
  const cliNombre = venta.cliente_razon_social || venta.cliente_nombre || '-';
  const leftClientRows = [
    `Razón Social / Cliente: ${cliNombre}`,
    venta.cliente_cuit ? `${venta.cliente_tipo_documento || 'CUIT'}: ${venta.cliente_cuit}` : 'DNI / CUIT: -',
    `Condición frente al IVA: ${venta.cliente_condicion_iva || 'Consumidor Final'}`,
    `Condición de Venta: ${venta.condicion_venta || venta.estado || 'Contado'}`,
  ];
  const rightClientRows = [
    venta.cliente_direccion ? `Domicilio: ${venta.cliente_direccion}` : '',
    venta.cliente_localidad ? `Localidad: ${venta.cliente_localidad}` : '',
    venta.cliente_provincia ? `Provincia: ${venta.cliente_provincia}` : '',
    venta.cliente_codigo_postal ? `CP: ${venta.cliente_codigo_postal}` : '',
    venta.cliente_telefono ? `Teléfono: ${venta.cliente_telefono}` : '',
    venta.cliente_email ? `Email: ${venta.cliente_email}` : '',
  ].filter(Boolean);

  const colW = w / 2 - 6;
  const stepMm = (baseSz * 1.28) / (72 / 25.4);
  const leftCount = leftClientRows.reduce((s, r) => s + wrapTextMm(r, colW, baseSz, false).length, 0);
  const rightCount = rightClientRows.reduce((s, r) => s + wrapTextMm(r, colW, baseSz, false).length, 0);
  const boxH = Math.max(16, Math.max(leftCount, rightCount) * stepMm + 5);

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

  // Franja de Comprobante Asociado (obligatorio ARCA en NC / ND)
  if ((clase === 'nota_credito' || clase === 'nota_debito') && (venta.comprobante_asociado || venta.venta_origen_numero)) {
    const asocH = isA5 ? 6 : 7;
    doc.rect(m, curY, w, asocH, { stroke: borderCol, fill: '#FFFFFF', lineWidth: 0.6 });
    const asocNum = venta.comprobante_asociado || venta.venta_origen_numero;
    doc.text(`Comprobante Asociado: ${asocNum}`, m + 3, curY + 1.8, { size: baseSz, bold: true });
    curY += asocH;
  }

  // ── 3. PIE ANCLADO AL FONDO (NOTAS + TOTALES + ARCA FOOTER) ────────────────
  let netoCalc = 0;
  for (const l of (lineas || [])) {
    netoCalc += Number(l.subtotal ?? (Number(l.cantidad || 0) * Number(l.precio_unitario || 0)));
  }
  const netoFinal = Number(venta.neto ?? netoCalc);
  const ivaTotal = Number(venta.iva_monto ?? 0);
  const otrosImpTotal = Number(venta.otros_impuestos_monto ?? 0);
  const totalFinal = Number(venta.total ?? (netoFinal + ivaTotal + otrosImpTotal));

  const pieTexto = (emp.print_pie_comprobante || '').trim();
  const pieH = pieTexto ? 6.5 : 0;
  const totalsH = isA5 ? 25 : 29;
  const noteLines = venta.observaciones ? wrapTextMm(`Observaciones: ${venta.observaciones}`, w - 6, baseSz - 0.5, false) : [];
  const noteH = noteLines.length ? Math.max(8, noteLines.length * 3.5 + 3.5) : 0;

  const footerTop = yBottom - pieH - totalsH - noteH;
  let curFootY = footerTop;

  if (noteH > 0) {
    doc.rect(m, curFootY, w, noteH, { stroke: borderCol, fill: '#FFFFFF', lineWidth: 0.5 });
    doc.textBlock(`Observaciones: ${venta.observaciones}`, m + 3, curFootY + 1.8, w - 6, { size: baseSz - 0.5, lineHeight: 1.25 });
    curFootY += noteH;
  }

  doc.rect(m, curFootY, w, totalsH, { stroke: borderCol, fill: '#FFFFFF', lineWidth: 0.7 });
  const totSplitX = m + w * 0.58;
  doc.line(totSplitX, curFootY, totSplitX, curFootY + totalsH, { color: borderCol, lineWidth: 0.6 });

  const leftColW = totSplitX - m - 6;
  if (venta.cae) {
    const isHomologacion = emp.afip_entorno === 'homologacion';
    const qrSizeMm = isA5 ? 18 : 22;
    const qrX = m + 3;
    const qrY = curFootY + 2.5;
    const recDigits = String(venta.cliente_cuit || '').replace(/\D/g, '');
    const qrPayload = {
      ver: 1,
      fecha: String(venta.fecha || '').slice(0, 10),
      cuit: Number(String(emp.cuit || '').replace(/\D/g, '')) || 0,
      ptoVta: Number(ptoVta) || 1,
      tipoCmp: Number(String(codAfip).replace(/\D/g, '')) || 6,
      nroCmp: Number(cbteNro) || 1,
      importe: Number(Number(totalFinal || 0).toFixed(2)),
      moneda: 'PES',
      ctz: 1,
      tipoDocRec: recDigits.length === 11 ? 80 : (recDigits.length >= 7 ? 96 : 99),
      nroDocRec: Number(recDigits) || 0,
      tipoCodAut: 'E',
      codAut: Number(String(venta.cae).replace(/\D/g, '')) || 0,
    };
    const qrUrl = 'https://www.afip.gob.ar/fe/qr/?p=' + Buffer.from(JSON.stringify(qrPayload), 'utf8').toString('base64');
    const qrMatrix = encodeQrMatrix(qrUrl);
    let textX = m + 3;
    let textW = leftColW;
    if (qrMatrix) {
      const modSize = qrSizeMm / qrMatrix.length;
      for (let r = 0; r < qrMatrix.length; r++) {
        for (let c = 0; c < qrMatrix.length; c++) {
          if (qrMatrix[r][c]) {
            doc.rect(qrX + c * modSize, qrY + r * modSize, modSize + 0.05, modSize + 0.05, { fill: '#000000' });
          }
        }
      }
      textX = qrX + qrSizeMm + 3;
      textW = totSplitX - textX - 3;
    }

    doc.text(`CAE N°: ${venta.cae}   ·   Vto. CAE: ${fmtDateAr(venta.cae_vencimiento) || '-'}`, textX, curFootY + 3, { size: baseSz - 0.3, bold: true });
    if (letra === 'B') {
      const ivaContenido = ivaTotal > 0 ? ivaTotal : (totalFinal - totalFinal / 1.21);
      doc.textBlock(`Régimen de Transparencia Fiscal (Ley 27.743): IVA contenido estimado ${fmtMoneyAr(ivaContenido)}.`, textX, curFootY + 8, textW, { size: baseSz - 0.9, lineHeight: 1.25 });
    } else if (letra === 'C') {
      doc.textBlock('Régimen Simplificado para Pequeños Contribuyentes (Monotributo).', textX, curFootY + 8, textW, { size: baseSz - 0.9, lineHeight: 1.25 });
    } else if (isFacturaAMonotributo(emp.condicion_iva, venta.cliente_condicion_iva, letra)) {
      doc.textBlock(
        'RG 5003/21: El crédito fiscal discriminado en el presente comprobante, sólo podrá ser computado a efectos del Régimen de Sostenimiento e Inclusión Fiscal (Ley 27.618).',
        textX,
        curFootY + 7.5,
        textW,
        { size: baseSz - 1.2, lineHeight: 1.2 },
      );
    } else {
      doc.textBlock('Comprobante Electrónico Autorizado por ARCA. Operación sujeta a la Ley del IVA.', textX, curFootY + 8, textW, { size: baseSz - 0.9, lineHeight: 1.25 });
    }
    doc.textBlock(
      isHomologacion
        ? '[ENTORNO DE HOMOLOGACIÓN / PRUEBAS - AFIP] Sin validez tributaria.'
        : 'Comprobante Autorizado por ARCA (Agencia de Recaudación y Control Aduanero).',
      textX,
      curFootY + totalsH - 6.5,
      textW,
      { size: baseSz - 1.3, bold: isHomologacion, color: isHomologacion ? '#B91C1C' : mutedCol, lineHeight: 1.2 },
    );
  } else {
    doc.text('Aviso Informativo:', m + 3, curFootY + 3, { size: baseSz - 0.5, bold: true });
    doc.textBlock(
      'Este comprobante es un documento interno emitido a efectos de control comercial.\nNo reemplaza a la factura fiscal electrónica emitida ante ARCA / AFIP.',
      m + 3,
      curFootY + 7.5,
      leftColW,
      { size: baseSz - 1, color: mutedCol, lineHeight: 1.25 },
    );
  }

  let ty = curFootY + 3;
  const rxLabel = totSplitX + 4;
  const rxVal = m + w - 4;
  if (discriminaIva || otrosImpTotal > 0) {
    doc.text('Neto Gravado:', rxLabel, ty, { size: baseSz });
    doc.text(fmtMoneyAr(netoFinal), rxVal, ty, { size: baseSz, align: 'right' });
    ty += 4.5;
    if (discriminaIva && ivaTotal > 0) {
      doc.text('IVA Débito Fiscal:', rxLabel, ty, { size: baseSz });
      doc.text(fmtMoneyAr(ivaTotal), rxVal, ty, { size: baseSz, align: 'right' });
      ty += 4.5;
    }
    if (otrosImpTotal > 0) {
      doc.text('Otros Impuestos:', rxLabel, ty, { size: baseSz });
      doc.text(fmtMoneyAr(otrosImpTotal), rxVal, ty, { size: baseSz, align: 'right' });
      ty += 4.5;
    }
  } else {
    doc.text('Subtotal:', rxLabel, ty, { size: baseSz });
    doc.text(fmtMoneyAr(totalFinal), rxVal, ty, { size: baseSz, align: 'right' });
    ty += 5;
  }

  const totBarY = curFootY + totalsH - (isA5 ? 8.5 : 9.5);
  doc.rect(totSplitX, totBarY, (m + w) - totSplitX, isA5 ? 8.5 : 9.5, { stroke: borderCol, fill: fillHeader, lineWidth: 0.6 });
  doc.text('TOTAL:', rxLabel, totBarY + 2.5, { size: isA5 ? 9.5 : 11, bold: true });
  doc.text(fmtMoneyAr(totalFinal), rxVal, totBarY + 2.5, { size: isA5 ? 9.5 : 11, bold: true, align: 'right' });

  if (pieTexto) {
    doc.text(pieTexto, midX, yBottom - pieH + 1.8, { size: 7, color: mutedCol, align: 'center' });
  }

  // ── 4. TABLA DE ÍTEMS (OCUPA HASTA footerTop) ─────────────────────────────
  const thH = isA5 ? 6 : 7;
  doc.rect(m, curY, w, thH, { stroke: borderCol, fill: fillHeader, lineWidth: 0.6 });

  const cCantW = isA5 ? 14 : 18;
  const cUmW = isA5 ? 14 : 18;
  const cPuW = isA5 ? 22 : 28;
  const cIvaW = discriminaIva ? (isA5 ? 12 : 14) : 0;
  const cSubW = isA5 ? 24 : 30;
  const cDescW = w - cCantW - cUmW - cPuW - cIvaW - cSubW;

  const xDesc = m;
  const xCant = xDesc + cDescW;
  const xUm = xCant + cCantW;
  const xPu = xUm + cUmW;
  const xIva = xPu + cPuW;
  const xSub = xIva + cIvaW;

  const thSz = isA5 ? 7 : 8;
  doc.text('Descripción del Producto', xDesc + 2, curY + 1.8, { size: thSz, bold: true });
  doc.text('Cant.', xCant + cCantW - 2, curY + 1.8, { size: thSz, bold: true, align: 'right' });
  doc.text('U.M.', xUm + 2, curY + 1.8, { size: thSz, bold: true });
  doc.text(discriminaIva ? 'Precio Neto' : 'Precio Unit.', xPu + cPuW - 2, curY + 1.8, { size: thSz, bold: true, align: 'right' });
  if (discriminaIva) doc.text('IVA', xIva + cIvaW - 2, curY + 1.8, { size: thSz, bold: true, align: 'right' });
  doc.text('Subtotal', xSub + cSubW - 2, curY + 1.8, { size: thSz, bold: true, align: 'right' });

  const vLines = discriminaIva ? [xCant, xUm, xPu, xIva, xSub] : [xCant, xUm, xPu, xSub];
  for (const vx of vLines) {
    doc.line(vx, curY, vx, footerTop, { color: '#CBD5E1', lineWidth: 0.45 });
  }

  let rowY = curY + thH + 1.5;
  for (const l of (lineas || [])) {
    const desc = l.producto_nombre || l.descripcion || 'Ítem';
    const cant = Number(l.cantidad || 0);
    const pu = Number(l.precio_unitario || 0);
    const sub = Number(l.subtotal ?? (cant * pu));
    const alic = Number(l.alicuota_iva ?? venta.alicuota_iva ?? 21);

    const linesCount = wrapTextMm(desc, cDescW - 4, baseSz, false).length;
    const rowH = Math.max(5.5, linesCount * 3.8 + 1.5);
    if (rowY + rowH > footerTop - 2) {
      doc.addPage(spec.w, spec.h);
      doc.rect(m, yTop, w, yBottom - yTop, { stroke: borderCol, lineWidth: 0.85 });
      doc.rect(m, yTop, w, topBarH, { stroke: borderCol, fill: fillHeader, lineWidth: 0.65 });
      doc.text(`${copyLabel} · CONTINUACIÓN`, midX, yTop + (isA5 ? 1.3 : 1.6), { size: isA5 ? 7.5 : 8.5, bold: true, align: 'center' });
      const contY = yTop + topBarH + 2;
      doc.rect(m, contY, w, thH, { stroke: borderCol, fill: fillHeader, lineWidth: 0.6 });
      doc.text('Descripción del Producto', xDesc + 2, contY + 1.8, { size: thSz, bold: true });
      doc.text('Cant.', xCant + cCantW - 2, contY + 1.8, { size: thSz, bold: true, align: 'right' });
      doc.text('U.M.', xUm + 2, contY + 1.8, { size: thSz, bold: true });
      doc.text(discriminaIva ? 'Precio Neto' : 'Precio Unit.', xPu + cPuW - 2, contY + 1.8, { size: thSz, bold: true, align: 'right' });
      if (discriminaIva) doc.text('IVA', xIva + cIvaW - 2, contY + 1.8, { size: thSz, bold: true, align: 'right' });
      doc.text('Subtotal', xSub + cSubW - 2, contY + 1.8, { size: thSz, bold: true, align: 'right' });
      for (const vx of vLines) {
        doc.line(vx, contY, vx, yBottom - 4, { color: '#CBD5E1', lineWidth: 0.45 });
      }
      rowY = contY + thH + 1.5;
    }

    doc.textBlock(desc, xDesc + 2, rowY, cDescW - 4, { size: baseSz, lineHeight: 1.25 });
    doc.text(fmtNumAr(cant), xCant + cCantW - 2, rowY, { size: baseSz, align: 'right' });
    doc.text(String(l.udm || 'un.'), xUm + 2, rowY, { size: baseSz });
    doc.text(fmtMoneyAr(pu), xPu + cPuW - 2, rowY, { size: baseSz, align: 'right' });
    if (discriminaIva) doc.text(`${alic}%`, xIva + cIvaW - 2, rowY, { size: baseSz, align: 'right' });
    doc.text(fmtMoneyAr(sub), xSub + cSubW - 2, rowY, { size: baseSz, bold: true, align: 'right' });

    rowY += rowH;
    doc.line(m, rowY - 0.5, m + w, rowY - 0.5, { color: '#E2E8F0', lineWidth: 0.35 });
  }
}

function renderVentaTicketPage(doc, { venta = {}, lineas = [] }, emp, copyLabel, fmt) {
  const is58 = fmt === 'ticket58';
  const wMm = is58 ? 58 : 80;
  const m = is58 ? 2.5 : 3;
  const cw = wMm - m * 2;
  const { letra, codAfip, titulo, discriminaIva } = resolveLetraAndTitulo(venta);
  const numero = venta.numero || `#${venta.id || ''}`;
  const { ptoVta, cbteNro } = splitComprobanteNumero(numero);
  const esRg5003 = isFacturaAMonotributo(emp.condicion_iva, venta.cliente_condicion_iva, letra);
  const pie = String(emp.print_pie_comprobante || '').trim();
  const hMm = Math.max(135, 95 + lineas.length * 9 + (venta.cae ? 28 : 0) + (esRg5003 ? 12 : 0) + (pie ? 10 : 0));
  doc.addPage(wMm, hMm);

  const { y: hdrY, sz } = drawTicketHeader(doc, {
    wMm, m, copyLabel, titulo, letra, codAfip, ptoVta, cbteNro, fecha: venta.fecha, emp,
  });
  let y = hdrY;

  const cliNombre = venta.cliente_razon_social || venta.cliente_nombre || 'Consumidor Final';
  y = doc.textBlock(`Cliente: ${cliNombre}`, m, y, cw, { size: sz, bold: true, lineHeight: 1.2 });
  if (venta.cliente_cuit) y = doc.textBlock(`${venta.cliente_tipo_documento || 'CUIT'}: ${venta.cliente_cuit}`, m, y, cw, { size: sz - 0.5, lineHeight: 1.2 });
  y = doc.textBlock(`IVA: ${venta.cliente_condicion_iva || 'Consumidor Final'}`, m, y, cw, { size: sz - 0.5, lineHeight: 1.2 });
  y += 1.2;
  doc.line(m, y, m + cw, y, { dashed: true, lineWidth: 0.4 });
  y += 2;

  let netoCalc = 0;
  let ivaCalc = 0;
  for (const l of lineas) {
    const desc = l.descripcion || l.producto_nombre || '-';
    const cant = Number(l.cantidad || 0);
    const pu = Number(l.precio_unitario || 0);
    const alic = Number(l.alicuota_iva ?? 21);
    const sub = Number(l.subtotal || cant * pu);
    netoCalc += sub;
    ivaCalc += sub * (alic / 100);

    y = doc.textBlock(desc, m, y, cw, { size: sz - 0.2, bold: true, lineHeight: 1.15 });
    doc.text(`${fmtNumAr(cant)} x ${fmtMoneyAr(pu)}`, m, y, { size: sz - 0.6, color: '#475569' });
    doc.text(fmtMoneyAr(sub), m + cw, y, { size: sz - 0.3, bold: true, align: 'right' });
    y += 3.6;
  }

  const netoFinal = Number(venta.neto ?? netoCalc);
  const ivaFinal = discriminaIva ? Number(venta.iva ?? ivaCalc) : 0;
  const totalFinal = Number(venta.total || (netoFinal + ivaFinal));

  y += 0.8;
  doc.line(m, y, m + cw, y, { dashed: true, lineWidth: 0.4 });
  y += 2;

  if (discriminaIva) {
    doc.text('Neto Gravado:', m, y, { size: sz - 0.3 });
    doc.text(fmtMoneyAr(netoFinal), m + cw, y, { size: sz - 0.3, align: 'right' });
    y += 3.4;
    doc.text('IVA:', m, y, { size: sz - 0.3 });
    doc.text(fmtMoneyAr(ivaFinal), m + cw, y, { size: sz - 0.3, align: 'right' });
    y += 3.6;
  }
  doc.text('TOTAL:', m, y, { size: sz + 1.2, bold: true });
  doc.text(fmtMoneyAr(totalFinal), m + cw, y, { size: sz + 1.2, bold: true, align: 'right' });
  y += 4.5;

  if (esRg5003) {
    y = doc.textBlock(
      'El crédito fiscal discriminado en el presente comprobante, sólo podrá ser computado a efectos del Régimen de Sostenimiento e Inclusión Fiscal para Pequeños Contribuyentes de la Ley N° 27.618.',
      m, y, cw, { size: sz - 1.5, color: '#475569', lineHeight: 1.15 },
    );
    y += 1.5;
  }

  if (venta.cae) {
    doc.line(m, y, m + cw, y, { dashed: true, lineWidth: 0.4 });
    y += 2;
    doc.text(`CAE: ${venta.cae}`, m, y, { size: sz - 0.3, bold: true });
    y += 3.3;
    doc.text(`Vto CAE: ${fmtDateAr(venta.cae_vencimiento) || '-'}`, m, y, { size: sz - 0.3 });
    y += 4;

    const cCmp = Number(String(codAfip).replace(/\D/g, '')) || 1;
    const recDigits = String(venta.cliente_cuit || '').replace(/\D/g, '');
    const qrPayload = {
      ver: 1,
      fecha: String(venta.fecha || '').slice(0, 10),
      cuit: Number(String(emp.cuit || '').replace(/\D/g, '')) || 0,
      ptoVta: Number(ptoVta) || 1,
      tipoCmp: cCmp,
      nroCmp: Number(cbteNro) || 1,
      importe: Number(totalFinal.toFixed(2)),
      moneda: 'PES',
      ctz: 1,
      tipoDocRec: recDigits.length === 11 ? 80 : (recDigits.length >= 7 ? 96 : 99),
      nroDocRec: Number(recDigits) || 0,
      tipoCodAut: 'E',
      codAut: Number(venta.cae) || 0,
    };
    const qrUrl = `https://www.afip.gob.ar/fe/qr/?p=${Buffer.from(JSON.stringify(qrPayload), 'utf8').toString('base64')}`;
    const qrMatrix = encodeQrMatrix(qrUrl);
    if (qrMatrix && qrMatrix.length > 0) {
      const qrMm = is58 ? 16 : 20;
      const qrX = (wMm - qrMm) / 2;
      const cell = qrMm / qrMatrix.length;
      for (let r = 0; r < qrMatrix.length; r++) {
        for (let c = 0; c < qrMatrix.length; c++) {
          if (qrMatrix[r][c]) doc.rect(qrX + c * cell, y + r * cell, cell, cell, { fill: '#0F1F2A' });
        }
      }
      y += qrMm + 2;
    }
  }

  if (pie) {
    doc.textBlock(pie, m, y, cw, { size: sz - 1, align: 'center', color: '#475569', lineHeight: 1.2 });
  }
}

export function generateVentaPdf(payload = {}, emp = {}) {
  const fmt = resolvePrintFormat(payload.formato, emp.print_formato, ['A4', 'A5', 'ticket80', 'ticket58']);
  const labels = resolveCopyLabels(payload.copias, emp.print_copias);
  const isTicket = fmt === 'ticket80' || fmt === 'ticket58';

  const doc = new PdfDocument();
  for (const copyLabel of labels) {
    if (isTicket) renderVentaTicketPage(doc, payload, emp, copyLabel, fmt);
    else renderVentaSheetPage(doc, payload, emp, copyLabel, fmt);
  }
  if (!isTicket) {
    const spec = PAGE_SIZES_MM[fmt] || PAGE_SIZES_MM.A4;
    stampUnifiedFooter(doc, emp, { margin: spec.margin });
  }
  return doc.toBuffer();
}
