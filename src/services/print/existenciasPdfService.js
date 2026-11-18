import { fmtNumAr } from './pdfBuilder.js';
import { createReportContext, fmtMoneyAr } from './reportLayout.js';

export function generateExistenciasPdf(payload = {}, emp = {}) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const filtros = payload.filtros || {};
  const sub = [
    filtros.search ? `Filtro: "${filtros.search}"` : '',
    filtros.onlyAlerts ? 'Solo bajo mínimo' : '',
    `${items.length} ítem(s)`,
  ].filter(Boolean).join(' · ');

  const ctx = createReportContext('REPORTE DE EXISTENCIAS / STOCK', emp, { subtitle: sub });
  const { doc, m, w, borderCol, mutedCol } = ctx;

  const cols = [
    { label: 'Producto / Componente', w: 58 },
    { label: 'Categoría', w: 28 },
    { label: 'Stock', w: 20, align: 'right' },
    { label: 'Reserv.', w: 18, align: 'right' },
    { label: 'Disp.', w: 20, align: 'right' },
    { label: 'Mín.', w: 16, align: 'right' },
    { label: 'Costo u.', w: w - 7 - 58 - 28 - 20 - 18 - 20 - 16, align: 'right' },
  ];

  ctx.drawTableHeaders(cols);

  if (items.length === 0) {
    doc.text('No hay existencias para los filtros seleccionados.', m + 4, ctx.y + 4, { size: 8, color: mutedCol });
    return doc.build();
  }

  let totalValorizado = 0;
  for (const it of items) {
    ctx.ensureSpace(6, () => ctx.drawTableHeaders(cols));
    const stock = Number(it.stock || 0);
    const costo = Number(it.costo || 0);
    totalValorizado += Math.max(0, stock) * costo;

    let x = m + 3.5;
    const rowY = ctx.y + 1.2;
    const vals = [
      it.nombre || '-',
      it.categoria || it.tipo || '-',
      `${fmtNumAr(stock, 2)} ${it.udm || ''}`.trim(),
      fmtNumAr(it.reservado || 0, 2),
      fmtNumAr(it.disponible ?? stock, 2),
      fmtNumAr(it.stock_minimo || 0, 2),
      fmtMoneyAr(costo),
    ];
    vals.forEach((val, idx) => {
      const c = cols[idx];
      const tx = c.align === 'right' ? x + c.w - 2 : x;
      doc.text(String(val), tx, rowY, {
        size: 7.2,
        bold: idx === 0 || idx === 4,
        align: c.align || 'left',
        maxWidth: c.w - 2,
      });
      x += c.w;
    });
    ctx.y += 5;
    doc.line(m + 2, ctx.y, m + w - 2, ctx.y, { color: '#CBD5E1', lineWidth: 0.25 });
  }

  ctx.ensureSpace(10);
  ctx.y += 3;
  doc.line(m + 2, ctx.y, m + w - 2, ctx.y, { color: borderCol, lineWidth: 0.5 });
  ctx.y += 2.5;
  doc.text(`Total ítems: ${items.length}`, m + 3.5, ctx.y, { size: 8, bold: true });
  doc.text(`Valorización total (stock × costo): ${fmtMoneyAr(totalValorizado)}`, m + w - 3.5, ctx.y, {
    size: 8.2,
    bold: true,
    align: 'right',
  });

  return doc.build();
}
