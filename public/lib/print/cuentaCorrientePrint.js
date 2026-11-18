import { openPdfFromEndpoint } from './remitoPrint.js';

export function buildCuentaCorrienteMovimientos({ compras = [], pagos = [], ventas = [], cobros = [] } = {}) {
  const movsCliente = [];
  for (const v of ventas) {
    if (!['Confirmada', 'Entregada'].includes(v.estado)) continue;
    const isNC = v.clase_documento === 'nota_credito';
    const total = Number(v.total || 0);
    movsCliente.push({
      fecha: v.fecha || '',
      id: v.id,
      tipo: isNC ? 'Nota de Crédito Venta' : v.clase_documento === 'nota_debito' ? 'Nota de Débito Venta' : 'Factura / Venta',
      numero: v.numero || `#${v.id}`,
      debe: isNC ? 0 : total,
      haber: isNC ? total : 0,
    });
  }
  for (const cb of cobros) {
    if (cb.estado !== 'Confirmado') continue;
    movsCliente.push({
      fecha: cb.fecha || '',
      id: cb.id,
      tipo: 'Recibo de Cobro',
      numero: cb.numero || `#${cb.id}`,
      debe: 0,
      haber: Number(cb.monto || 0),
    });
  }
  movsCliente.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || a.id - b.id);
  let saldoCli = 0;
  for (const m of movsCliente) {
    saldoCli += m.debe - m.haber;
    m.saldo = Number(saldoCli.toFixed(2));
  }

  const movsProveedor = [];
  for (const cmp of compras) {
    if (cmp.estado !== 'Confirmado') continue;
    const isNC = cmp.clase_documento === 'nota_credito';
    const total = Number(cmp.total || 0);
    movsProveedor.push({
      fecha: cmp.fecha || '',
      id: cmp.id,
      tipo: isNC ? 'Nota de Crédito Compra' : cmp.clase_documento === 'nota_debito' ? 'Nota de Débito Compra' : 'Factura / Compra',
      numero: cmp.numero || `#${cmp.id}`,
      debe: isNC ? total : 0,
      haber: isNC ? 0 : total,
    });
  }
  for (const p of pagos) {
    if (p.estado !== 'Confirmado') continue;
    movsProveedor.push({
      fecha: p.fecha || '',
      id: p.id,
      tipo: 'Orden de Pago',
      numero: p.numero || `#${p.id}`,
      debe: Number(p.monto || 0),
      haber: 0,
    });
  }
  movsProveedor.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || a.id - b.id);
  let saldoProv = 0;
  for (const m of movsProveedor) {
    saldoProv += m.haber - m.debe;
    m.saldo = Number(saldoProv.toFixed(2));
  }

  return { movsCliente, movsProveedor };
}

export async function printCuentaCorriente(data = {}, empresa = null) {
  const c = data.contacto || {};
  const { movsCliente, movsProveedor } = buildCuentaCorrienteMovimientos(data);
  const safeName = String(c.nombre || c.id || 'contacto').replace(/[^a-zA-Z0-9_-]+/g, '_');
  return openPdfFromEndpoint('/api/print/cuenta-corriente-pdf', {
    contacto: c,
    movsCliente,
    movsProveedor,
    saldoCliente: data.saldo_cliente ?? c.saldo_cliente ?? 0,
    saldoProveedor: data.saldo_proveedor ?? c.saldo_proveedor ?? 0,
    empresa,
  }, `CuentaCorriente_${safeName}.pdf`);
}
