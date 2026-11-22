import { createReportContext, fmtMoneyAr } from './reportLayout.js';

export function generateNominaPdf(det = {}, emp = {}) {
  const liq = det.liquidacion || {};
  const items = Array.isArray(det.items) ? det.items : [];
  const sub = [
    `Período: ${liq.periodo || '-'}`,
    `Fecha: ${liq.fecha || '-'}`,
    `Estado: ${liq.estado || '-'}`,
    liq.asiento_id ? `Asiento #${liq.asiento_id}` : '',
  ].filter(Boolean).join(' · ');

  const ctx = createReportContext('LIQUIDACIÓN DE SUELDOS Y CARGAS SOCIALES', emp, { subtitle: sub });
  const { doc, m, w, borderCol, mutedCol } = ctx;

  const cols = [
    { label: 'Legajo', w: 18 },
    { label: 'Empleado', w: 46 },
    { label: 'Sector', w: 24 },
    { label: 'Remun.', w: 23, align: 'right' },
    { label: 'No Rem.', w: 20, align: 'right' },
    { label: 'Retenc.', w: 21, align: 'right' },
    { label: 'Contrib.', w: 21, align: 'right' },
    { label: 'Neto', w: w - 7 - 18 - 46 - 24 - 23 - 20 - 21 - 21, align: 'right' },
  ];

  ctx.drawTableHeaders(cols);

  if (!items.length) {
    doc.text('No hay empleados en esta liquidación.', m + 4, ctx.y + 4, { size: 8, color: mutedCol });
    return ctx.finish();
  }

  for (const it of items) {
    ctx.ensureSpace(6, () => ctx.drawTableHeaders(cols));
    let x = m + 3.5;
    const rowY = ctx.y + 1.2;
    const vals = [
      it.legajo || '-',
      it.empleado_nombre || '-',
      it.sector || '-',
      fmtMoneyAr(it.remunerativo || 0),
      fmtMoneyAr(it.no_remunerativo || 0),
      fmtMoneyAr(it.retenciones || 0),
      fmtMoneyAr(it.contribuciones || 0),
      fmtMoneyAr(it.neto || 0),
    ];
    vals.forEach((val, idx) => {
      const c = cols[idx];
      const tx = c.align === 'right' ? x + c.w - 2 : x;
      doc.text(String(val), tx, rowY, {
        size: 7.1,
        bold: idx === 1 || idx === 7,
        align: c.align || 'left',
        maxWidth: c.w - 2,
      });
      x += c.w;
    });
    ctx.y += 5;
    doc.line(m + 2, ctx.y, m + w - 2, ctx.y, { color: '#CBD5E1', lineWidth: 0.25 });
  }

  ctx.ensureSpace(12);
  ctx.y += 3;
  doc.line(m + 2, ctx.y, m + w - 2, ctx.y, { color: borderCol, lineWidth: 0.5 });
  ctx.y += 3;
  doc.text(
    `Totales — Remun.: ${fmtMoneyAr(liq.total_remunerativo)} · No Rem.: ${fmtMoneyAr(liq.total_no_remunerativo)} · Retenc.: ${fmtMoneyAr(liq.total_retenciones)} · Contrib.: ${fmtMoneyAr(liq.total_contribuciones)}`,
    m + 3.5,
    ctx.y,
    { size: 7.5 },
  );
  doc.text(`Total Neto a Pagar: ${fmtMoneyAr(liq.total_neto)}`, m + w - 3.5, ctx.y, {
    size: 8.4,
    bold: true,
    align: 'right',
  });

  return ctx.finish();
}
