import { esc, fmtMoney } from './format.js';

export const IVA_RATES = [
  { value: 21, label: '21%' },
  { value: 10.5, label: '10.5%' },
  { value: 27, label: '27%' },
  { value: 0, label: '0% / Exento' },
];

export function getIvaRatesFromConfig(impuestosConfig = []) {
  const fromCfg = (impuestosConfig || [])
    .filter(ic => ic.tipo === 'iva')
    .map(ic => ({ value: Number(ic.alicuota_defecto || 0), label: ic.nombre || `${Number(ic.alicuota_defecto || 0)}%` }));
  return fromCfg.length > 0 ? fromCfg : IVA_RATES;
}

export function calcDocumentTotals(lineas = [], impuestos = [], caracter = 'fiscal', tipoComprobante = 'FA-A') {
  const noIva = caracter === 'interno' || tipoComprobante === 'FA-C';
  let neto = 0;
  let ivaTotal = 0;
  const ivaByRate = new Map();

  for (const l of lineas) {
    const sub = Number(l.subtotal) || 0;
    const rate = noIva ? 0 : Math.max(0, Number(l.alicuota_iva ?? 21));
    const iva = Number((sub * rate / 100).toFixed(2));
    neto += sub;
    ivaTotal += iva;
    if (rate > 0 || !noIva) {
      const prev = ivaByRate.get(rate) || { rate, base: 0, monto: 0 };
      prev.base = Number((prev.base + sub).toFixed(2));
      prev.monto = Number((prev.monto + iva).toFixed(2));
      ivaByRate.set(rate, prev);
    }
  }

  neto = Number(neto.toFixed(2));
  ivaTotal = Number(ivaTotal.toFixed(2));

  let otrosImpuestos = 0;
  for (const imp of impuestos) {
    const monto = Number(imp.monto) || 0;
    otrosImpuestos += imp.tipo === 'retencion' ? -monto : monto;
  }
  otrosImpuestos = Number(otrosImpuestos.toFixed(2));
  const total = Number((neto + ivaTotal + otrosImpuestos).toFixed(2));

  return {
    neto,
    ivaTotal,
    ivaDesglose: Array.from(ivaByRate.values()).sort((a, b) => b.rate - a.rate),
    otrosImpuestos,
    total,
    noIva,
  };
}

export function renderTaxFooterHtml(totals, impuestos = [], colspan = 5) {
  const ivaRows = totals.noIva
    ? `<tr><td colspan="${colspan}" class="muted">IVA (Comprobante sin discriminación)</td><td class="num">${fmtMoney(0)}</td><td></td></tr>`
    : totals.ivaDesglose.map(d => `
        <tr>
          <td colspan="${colspan}" class="muted">IVA ${d.rate}% (Base ${fmtMoney(d.base)})</td>
          <td class="num">${fmtMoney(d.monto)}</td>
          <td></td>
        </tr>
      `).join('');

  const impRows = impuestos.map(imp => `
    <tr>
      <td colspan="${colspan}" class="muted">${esc(imp.nombre)} (${imp.alicuota || 0}%)</td>
      <td class="num">${imp.tipo === 'retencion' ? '-' : ''}${fmtMoney(imp.monto)}</td>
      <td></td>
    </tr>
  `).join('');

  return `
    <tr><td colspan="${colspan}" class="muted">Neto</td><td class="num">${fmtMoney(totals.neto)}</td><td></td></tr>
    ${ivaRows}
    ${impRows}
    <tr><td colspan="${colspan}"><strong>Total</strong></td><td class="num"><strong>${fmtMoney(totals.total)}</strong></td><td></td></tr>
  `;
}
