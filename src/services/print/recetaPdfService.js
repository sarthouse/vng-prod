import { PdfDocument, fmtNumAr } from './pdfBuilder.js';
import { getRecetaById } from '../produccion/recetaService.js';
import { getEmpresaConfig } from '../config/configService.js';

function decodeHtmlEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function parseRichHtmlBlocks(html) {
  const src = String(html || '').trim();
  if (!src) return [];
  const normalized = src
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h1|h2|h3|h4|li|tr)>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<\s*h[1-4][^>]*>/gi, '##H##');

  const rawLines = normalized.split(/\r?\n/);
  const blocks = [];
  for (let line of rawLines) {
    const isHeading = line.includes('##H##');
    const isBoldOnly = !isHeading && /<\s*(strong|b)\b/i.test(line) && line.replace(/<\s*(strong|b)[^>]*>[\s\S]*?<\/\s*(strong|b)\s*>/gi, '').replace(/<[^>]+>/g, '').trim() === '';
    line = decodeHtmlEntities(line.replace(/##H##/g, '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (!line) continue;
    blocks.push({ text: line, heading: isHeading, bold: isHeading || isBoldOnly });
  }
  return blocks;
}

export function buildRecetaFichaPdf(recetaId, { conCostos = true } = {}) {
  const data = getRecetaById(Number(recetaId));
  if (!data) return null;
  const { receta, etapas = [], lineas = [] } = data;
  const empresa = getEmpresaConfig();

  const doc = new PdfDocument();
  doc.addPage(210, 297);
  const M = 12;
  const W = 210 - M * 2;
  let y = 12;

  const ensureSpace = (needMm) => {
    if (y + needMm > 282) {
      doc.addPage(210, 297);
      y = 14;
    }
  };

  // Cabecera
  doc.rect(M, y, W, 32, { fill: '#F8FAFC', stroke: '#CBD5E1', lineWidth: 0.4 });
  const hasProdImg = Boolean(receta.plantilla_imagen);
  const textW = hasProdImg ? W - 38 : W - 8;

  if (hasProdImg) {
    doc.rect(M + W - 34, y + 2, 30, 28, { fill: '#FFFFFF', stroke: '#E2E8F0', lineWidth: 0.3 });
    doc.drawImage(receta.plantilla_imagen, M + W - 33, y + 3, 28, 26);
  }

  doc.text(empresa.nombre_fantasia || empresa.razon_social || 'Vanguard Production', M + 4, y + 4, { size: 9, bold: true, color: '#475569' });
  doc.text(`FICHA TÉCNICA · ${receta.nombre}`, M + 4, y + 10, { size: 13, bold: true, color: '#0F172A' });
  doc.text(`Producto: ${receta.plantilla_nombre}${receta.plantilla_codigo ? ` [${receta.plantilla_codigo}]` : ''}`, M + 4, y + 18, { size: 9, color: '#1E293B' });
  if (receta.referencia || receta.producto_nombre) {
    doc.text([receta.producto_nombre ? `Variante: ${receta.producto_nombre}` : '', receta.referencia ? `Ref: ${receta.referencia}` : ''].filter(Boolean).join(' · '), M + 4, y + 23.5, { size: 8.5, color: '#64748B' });
  }
  y += 37;

  // Texto enriquecido de Ficha Técnica
  const richBlocks = parseRichHtmlBlocks(receta.ficha_tecnica_html);
  if (richBlocks.length > 0) {
    ensureSpace(18);
    doc.rect(M, y, W, 7, { fill: '#0F1F2A' });
    doc.text('ESPECIFICACIONES Y FICHA TÉCNICA', M + 3, y + 1.8, { size: 8.5, bold: true, color: '#FFFFFF' });
    y += 10;
    for (const blk of richBlocks) {
      ensureSpace(10);
      y = doc.textBlock(blk.text, M + 2, y, textW + (hasProdImg ? 30 : 0), {
        size: blk.heading ? 10 : 8.8,
        bold: blk.bold,
        color: blk.heading ? '#0F172A' : '#1E293B',
        lineHeight: 1.38,
      });
      y += blk.heading ? 1.5 : 0.8;
    }
    y += 4;
  } else if (receta.notas) {
    ensureSpace(16);
    doc.rect(M, y, W, 7, { fill: '#0F1F2A' });
    doc.text('NOTAS TÉCNICAS', M + 3, y + 1.8, { size: 8.5, bold: true, color: '#FFFFFF' });
    y += 10;
    y = doc.textBlock(receta.notas, M + 2, y, W - 4, { size: 8.8, color: '#1E293B' });
    y += 4;
  }

  // Secuencia de Etapas (con imágenes)
  if (etapas.length > 0) {
    ensureSpace(18);
    doc.rect(M, y, W, 7, { fill: '#0F1F2A' });
    doc.text('SECUENCIA DE ETAPAS Y PROCESOS', M + 3, y + 1.8, { size: 8.5, bold: true, color: '#FFFFFF' });
    y += 10;

    for (const et of etapas) {
      const hasEtImg = Boolean(et.imagen_data);
      const blockH = hasEtImg ? 30 : (et.descripcion ? 16 : 11);
      ensureSpace(blockH + 3);
      doc.rect(M, y, W, blockH, { fill: '#FFFFFF', stroke: '#CBD5E1', lineWidth: 0.35 });

      const infoW = hasEtImg ? W - 36 : W - 6;
      doc.text(`${et.orden}. ${et.nombre}`, M + 3, y + 2.5, { size: 9.5, bold: true, color: '#0F172A' });
      const metaParts = [
        `${et.dias_estimados || 0} d est.`,
        et.taller_nombre ? `Taller: ${et.taller_nombre}` : '',
        conCostos && Number(et.costo_unidad) > 0 ? `Costo/u: $${fmtNumAr(et.costo_unidad, 2)}` : '',
      ].filter(Boolean);
      doc.text(metaParts.join(' · '), M + 3, y + 7.5, { size: 8, color: '#475569' });
      if (et.descripcion) {
        doc.textBlock(et.descripcion, M + 3, y + 12.5, infoW, { size: 8.3, color: '#334155', lineHeight: 1.25 });
      }
      if (hasEtImg) {
        doc.drawImage(et.imagen_data, M + W - 31, y + 2, 28, blockH - 4);
      }
      y += blockH + 3;
    }
    y += 3;
  }

  // Insumos y Materiales
  ensureSpace(20);
  doc.rect(M, y, W, 7, { fill: '#0F1F2A' });
  doc.text('LISTA DE INSUMOS / MATERIALES', M + 3, y + 1.8, { size: 8.5, bold: true, color: '#FFFFFF' });
  y += 9;

  const drawInsumosHeader = () => {
    doc.rect(M, y, W, 6.5, { fill: '#F1F5F9', stroke: '#CBD5E1', lineWidth: 0.3 });
    doc.text('Insumo', M + 2, y + 1.6, { size: 8, bold: true });
    doc.text('Etapa', M + 74, y + 1.6, { size: 8, bold: true });
    doc.text('Cant.', M + 125, y + 1.6, { size: 8, bold: true, align: 'right' });
    doc.text('UDM', M + 128, y + 1.6, { size: 8, bold: true });
    if (conCostos) {
      doc.text('Costo/u', M + 162, y + 1.6, { size: 8, bold: true, align: 'right' });
      doc.text('Subtotal', M + W - 2, y + 1.6, { size: 8, bold: true, align: 'right' });
    } else {
      doc.text('Variantes', M + 148, y + 1.6, { size: 8, bold: true });
    }
    y += 7;
  };

  drawInsumosHeader();
  if (lineas.length === 0) {
    doc.text('Sin insumos cargados en esta receta.', M + 2, y + 2, { size: 8.5, color: '#64748B' });
    y += 8;
  } else {
    for (const l of lineas) {
      ensureSpace(8);
      if (y === 14) drawInsumosHeader();
      doc.line(M, y + 6, M + W, y + 6, { color: '#E2E8F0', lineWidth: 0.25 });
      const varsTxt = l.variantes?.length
        ? ` [${l.variantes.map(v => (typeof v === 'string' ? v : `${v.atributo}: ${v.valor}`)).join(', ')}]`
        : '';
      doc.text(String(l.producto_nombre || '').slice(0, 42), M + 2, y + 1.5, { size: 8.2 });
      doc.text(String(l.etapa_nombre || '-').slice(0, 22), M + 74, y + 1.5, { size: 8, color: '#475569' });
      doc.text(fmtNumAr(l.coeficiente, 4), M + 125, y + 1.5, { size: 8.2, align: 'right' });
      doc.text(String(l.udm_receta || l.udm || ''), M + 128, y + 1.5, { size: 8, color: '#475569' });
      if (conCostos) {
        doc.text(`$${fmtNumAr(l.precio, 2)}`, M + 162, y + 1.5, { size: 8.2, align: 'right' });
        doc.text(`$${fmtNumAr(l.costo_par, 2)}`, M + W - 2, y + 1.5, { size: 8.2, bold: true, align: 'right' });
      } else {
        doc.text((varsTxt || 'Todas').trim().slice(0, 26), M + 148, y + 1.5, { size: 7.8, color: '#475569' });
      }
      y += 6.5;
    }
  }

  if (conCostos) {
    ensureSpace(16);
    y += 4;
    const matCost = Number(receta.costo_materiales ?? data.costoMateriales ?? data.costoBase ?? 0);
    const procCost = Number(receta.costo_procesos ?? data.costoProcesos ?? 0);
    const totCost = Number((matCost + procCost).toFixed(2));
    doc.rect(M + W - 82, y, 82, 16, { fill: '#F8FAFC', stroke: '#CBD5E1', lineWidth: 0.4 });
    doc.text('Materiales / u.:', M + W - 79, y + 2, { size: 8.2, color: '#475569' });
    doc.text(`$${fmtNumAr(matCost, 2)}`, M + W - 3, y + 2, { size: 8.2, align: 'right' });
    doc.text('Procesos / u.:', M + W - 79, y + 6.5, { size: 8.2, color: '#475569' });
    doc.text(`$${fmtNumAr(procCost, 2)}`, M + W - 3, y + 6.5, { size: 8.2, align: 'right' });
    doc.text('COSTO TOTAL / U.:', M + W - 79, y + 11.2, { size: 8.8, bold: true, color: '#0F172A' });
    doc.text(`$${fmtNumAr(totCost, 2)}`, M + W - 3, y + 11.2, { size: 9, bold: true, color: '#0F172A', align: 'right' });
  }

  return doc.toBuffer();
}
