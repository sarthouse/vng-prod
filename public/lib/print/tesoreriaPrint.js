import { openPdfFromEndpoint } from './remitoPrint.js';

async function openTesoreriaPrint(payload = {}) {
  const doc = payload.doc || {};
  const safeNum = String(doc.numero || doc.id || 'comprobante').replace(/[^a-zA-Z0-9_-]+/g, '_');
  return openPdfFromEndpoint('/api/print/tesoreria-pdf', payload, `${payload.letra || 'TES'}_${safeNum}.pdf`);
}

export async function printOrdenPago({ pago = {}, lineas = [], empresa = null } = {}) {
  return openTesoreriaPrint({
    titulo: 'ORDEN DE PAGO',
    letra: 'OP',
    subLetra: 'Comprobante Pago',
    contraparteLabel: 'Proveedor / Beneficiario',
    contraparteFallback: pago.categoria_gasto || 'Gasto Operativo',
    docRefLabel: 'Compra asociada',
    docRefNumero: pago.compra_numero || (pago.compra_id ? `#${pago.compra_id}` : ''),
    doc: pago,
    lineas,
    empresa,
  });
}

export async function printReciboCobro({ cobro = {}, lineas = [], empresa = null } = {}) {
  return openTesoreriaPrint({
    titulo: 'RECIBO DE COBRO',
    letra: 'RC',
    subLetra: 'Comprobante Cobro',
    contraparteLabel: 'Cliente / Pagador',
    contraparteFallback: 'Otro Ingreso',
    docRefLabel: 'Venta asociada',
    docRefNumero: cobro.venta_numero || (cobro.venta_id ? `#${cobro.venta_id}` : ''),
    doc: cobro,
    lineas,
    empresa,
  });
}
