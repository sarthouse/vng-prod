import { PdfDocument } from './pdfBuilder.js';
import { getPrintTheme, stampUnifiedFooter, fmtMoneyAr } from './printLayout.js';

function numeroALetrasEntero(n) {
  const num = Math.floor(Math.abs(Number(n) || 0));
  if (num === 0) return 'cero';
  const unidades = ['', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiún', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
  const decenas = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
  const centenas = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

  const menor1000 = (x) => {
    if (x === 0) return '';
    if (x === 100) return 'cien';
    const c = Math.floor(x / 100);
    const r = x % 100;
    const cStr = c > 0 ? centenas[c] : '';
    let rStr = '';
    if (r < 30) rStr = unidades[r];
    else {
      const d = Math.floor(r / 10);
      const u = r % 10;
      rStr = u > 0 ? `${decenas[d]} y ${unidades[u]}` : decenas[d];
    }
    return [cStr, rStr].filter(Boolean).join(' ');
  };

  const millones = Math.floor(num / 1000000);
  const miles = Math.floor((num % 1000000) / 1000);
  const resto = num % 1000;
  const parts = [];
  if (millones > 0) parts.push(millones === 1 ? 'un millón' : `${menor1000(millones)} millones`);
  if (miles > 0) parts.push(miles === 1 ? 'mil' : `${menor1000(miles)} mil`);
  if (resto > 0) parts.push(menor1000(resto));
  return parts.join(' ').trim();
}

export function numeroALetrasPesos(monto) {
  const val = Math.max(0, Number(monto || 0));
  const ent = Math.floor(val);
  const dec = Math.round((val - ent) * 100);
  const decStr = String(dec).padStart(2, '0');
  return `Son pesos ${numeroALetrasEntero(ent)} con ${decStr}/100`;
}

function drawReciboCuerpo(doc, { topY, ejemplarLabel, liq, rec, emp, params }) {
  const theme = getPrintTheme(emp);
  const m = 10;
  const w = 190;
  const h = 132;
  doc.rect(m, topY, w, h, { stroke: '#334155', lineWidth: 0.45 });

  // Encabezado
  doc.rect(m, topY, w, 13, { fill: theme.fillHeader, stroke: '#334155', lineWidth: 0.35 });
  doc.text(`RECIBO DE HABERES — LEY 20.744 ART. 140`, m + 3, topY + 2.5, { size: 8.5, bold: true });
  doc.text(ejemplarLabel, m + w - 3, topY + 2.5, { size: 8, bold: true, align: 'right' });
  doc.text(`Período: ${liq.periodo || '-'} · Liquidación: ${liq.tipo_liquidacion || 'Mensual'} (${liq.numero || ''})`, m + 3, topY + 7.5, { size: 7 });
  doc.text(`Fecha Pago: ${liq.fecha_pago || liq.fecha_liquidacion || '-'}`, m + w - 3, topY + 7.5, { size: 7, align: 'right' });

  // Datos Empleador y Último Depósito
  let y = topY + 15;
  doc.text(`Empleador: ${emp.razon_social || emp.nombre_fantasia || 'Empresa'}`, m + 3, y, { size: 7.2, bold: true });
  doc.text(`CUIT: ${emp.cuit || '-'}`, m + w - 3, y, { size: 7.2, align: 'right' });
  y += 4;
  doc.text(`Domicilio: ${emp.direccion || '-'} ${emp.localidad ? `(${emp.localidad})` : ''}`, m + 3, y, { size: 6.8 });
  const depPeriodo = emp.lct_ultimo_deposito_periodo || params?.nomina_ultimo_dep_periodo || '';
  const depFecha = emp.lct_ultimo_deposito_fecha || params?.nomina_ultimo_dep_fecha || '';
  const depBanco = emp.lct_ultimo_deposito_banco || params?.nomina_ultimo_dep_banco || liq.banco_deposito_aportes || '';
  const ultDep = [
    depPeriodo ? `Período ${depPeriodo}` : '',
    depFecha ? `Fecha ${depFecha}` : '',
    depBanco,
  ].filter(Boolean).join(' · ');
  doc.text(`Últ. Dep. Aportes: ${ultDep || 'Sin informar'}`, m + w - 3, y, { size: 6.5, align: 'right' });

  y += 4;
  doc.line(m, y, m + w, y, { color: '#CBD5E1', lineWidth: 0.3 });
  y += 2;

  // Datos Trabajador
  doc.text(`Trabajador: ${rec.nombre_completo || rec.empleado_nombre || '-'}`, m + 3, y, { size: 7.2, bold: true });
  doc.text(`CUIL: ${rec.cuil || '-'} · Legajo: ${rec.legajo || '-'}`, m + w - 3, y, { size: 7, align: 'right' });
  y += 4;
  doc.text(`Ingreso: ${rec.fecha_ingreso || '-'} · Categoría: ${rec.categoria_laboral || '-'} (${rec.convenio_cct || '-'})`, m + 3, y, { size: 6.6 });
  doc.text(`Puesto: ${rec.puesto || rec.sector || '-'} · CBU: ${rec.cbu || 'Efectivo'}`, m + w - 3, y, { size: 6.6, align: 'right' });

  y += 4;
  // Tabla de conceptos (solo haberes y descuentos del trabajador, sin contribuciones patronales)
  const cols = [
    { label: 'Cód.', w: 16 },
    { label: 'Concepto', w: 68 },
    { label: 'Cant./Base', w: 22, align: 'right' },
    { label: 'Hab. Remun.', w: 28, align: 'right' },
    { label: 'No Remun.', w: 28, align: 'right' },
    { label: 'Deducciones', w: w - 4 - 16 - 68 - 22 - 28 - 28, align: 'right' },
  ];
  doc.rect(m, y, w, 5.5, { fill: theme.eco ? '#FFFFFF' : '#E2E8F0', stroke: '#94A3B8', lineWidth: 0.25 });
  let cx = m + 2;
  for (const c of cols) {
    const tx = c.align === 'right' ? cx + c.w - 1.5 : cx;
    doc.text(c.label, tx, y + 1.5, { size: 6.5, bold: true, align: c.align || 'left' });
    cx += c.w;
  }
  y += 6;

  const lineasVisibles = (rec.lineas || []).filter(l => Number(l.importe_haber || 0) > 0 || Number(l.importe_descuento || 0) > 0);
  const maxLines = 10;
  for (const l of lineasVisibles.slice(0, maxLines)) {
    const isNoRem = l.concepto_tipo === 'no_remunerativo';
    const remVal = !isNoRem && Number(l.importe_haber || 0) > 0 ? fmtMoneyAr(l.importe_haber) : '';
    const noRemVal = isNoRem && Number(l.importe_haber || 0) > 0 ? fmtMoneyAr(l.importe_haber) : '';
    const descVal = Number(l.importe_descuento || 0) > 0 ? fmtMoneyAr(l.importe_descuento) : '';
    const vals = [
      l.codigo_afip_lsd || '-',
      l.descripcion || '-',
      l.cantidad ? String(l.cantidad) : '-',
      remVal,
      noRemVal,
      descVal,
    ];
    let rx = m + 2;
    vals.forEach((v, idx) => {
      const c = cols[idx];
      const tx = c.align === 'right' ? rx + c.w - 1.5 : rx;
      doc.text(String(v), tx, y, { size: 6.4, align: c.align || 'left', maxWidth: c.w - 2 });
      rx += c.w;
    });
    y += 4.3;
  }

  // Pie de totales + Neto en letras + Firmas
  const footY = topY + h - 25;
  doc.line(m, footY, m + w, footY, { color: '#334155', lineWidth: 0.35 });
  doc.text(
    `Totales: Rem. ${fmtMoneyAr(rec.total_remunerativo)} | No Rem. ${fmtMoneyAr(rec.total_no_remunerativo)} | Ded. ${fmtMoneyAr(rec.total_descuentos)}`,
    m + 3,
    footY + 2,
    { size: 6.8 },
  );
  doc.text(`NETO A COBRAR: ${fmtMoneyAr(rec.neto_a_pagar)}`, m + w - 3, footY + 2, { size: 8, bold: true, align: 'right' });
  doc.text(numeroALetrasPesos(rec.neto_a_pagar), m + 3, footY + 6.5, { size: 6.8, bold: true });
  doc.text(`Lugar y fecha de pago: ${emp.localidad || 'Buenos Aires'}, ${liq.fecha_pago || liq.fecha_liquidacion || '-'} · Forma: ${rec.forma_pago || 'Transferencia CBU'}`, m + 3, footY + 10.5, { size: 6.3 });

  const sigY = topY + h - 5;
  doc.line(m + 10, sigY, m + 75, sigY, { color: '#64748B', lineWidth: 0.3 });
  doc.text('Firma del Empleador', m + 42.5, sigY + 1.2, { size: 6.3, align: 'center' });
  doc.line(m + 115, sigY, m + 180, sigY, { color: '#64748B', lineWidth: 0.3 });
  doc.text('Firma del Trabajador (Recibí conforme)', m + 147.5, sigY + 1.2, { size: 6.3, align: 'center' });
}

/**
 * Genera el PDF legal de Recibos de Sueldo LCT Art. 140 en formato Duplicado
 * (Original Empleador arriba / Duplicado Empleado abajo en A4) para uno o todos los recibos.
 */
export function generateRecibosSueldoPdf(det = {}, emp = {}, { reciboId = null, params = {} } = {}) {
  const doc = new PdfDocument({ size: 'A4' });
  const liq = det.liquidacion || {};
  const recibos = reciboId
    ? (det.recibos || []).filter(r => Number(r.id) === Number(reciboId))
    : (det.recibos || []);

  if (!recibos.length) {
    doc.addPage();
    doc.text('No hay recibos para imprimir en esta liquidación.', 15, 20, { size: 10 });
    return doc.toBuffer();
  }

  recibos.forEach((rec) => {
    doc.addPage();
    drawReciboCuerpo(doc, { topY: 10, ejemplarLabel: 'ORIGINAL (Empleador)', liq, rec, emp, params });
    doc.line(10, 148.5, 200, 148.5, { color: '#94A3B8', lineWidth: 0.3 });
    drawReciboCuerpo(doc, { topY: 154, ejemplarLabel: 'DUPLICADO (Trabajador)', liq, rec, emp, params });
  });

  stampUnifiedFooter(doc, emp, { margin: 10 });
  return doc.toBuffer();
}
