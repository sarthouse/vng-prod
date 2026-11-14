import { openPdfFromEndpoint } from './remitoPrint.js';

export async function printVentaComprobante({ venta = {}, lineas = [], impuestos = [], empresa = null } = {}) {
  const safeName = String(venta.numero || venta.id || 'comprobante').replace(/[^a-zA-Z0-9_-]+/g, '_');
  return openPdfFromEndpoint(
    '/api/print/venta-pdf',
    { venta, lineas, impuestos, empresa },
    `Comprobante_${safeName}.pdf`,
  );
}
