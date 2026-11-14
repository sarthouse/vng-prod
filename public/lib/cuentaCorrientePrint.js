import { esc, fmtMoney } from './format.js';
import { openPrintWindow, buildEmpresaHeaderInfo } from './printShell.js';

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

function renderMovsSection(title, subtitle, movs, saldoFinal, saldoLabel) {
  const rows = movs.map(m => `
    <tr>
      <td>${esc(m.fecha)}</td>
      <td>${esc(m.tipo)}</td>
      <td><strong>${esc(m.numero)}</strong></td>
      <td class="num">${m.debe > 0 ? fmtMoney(m.debe) : '—'}</td>
      <td class="num">${m.haber > 0 ? fmtMoney(m.haber) : '—'}</td>
      <td class="num"><strong>${fmtMoney(m.saldo)}</strong></td>
    </tr>
  `).join('');

  return `
    <div class="section">
      <div class="section-head">
        <div>
          <h3>${esc(title)}</h3>
          <div class="muted">${esc(subtitle)}</div>
        </div>
        <div class="saldo-pill">
          <span>${esc(saldoLabel)}</span>
          <strong>${fmtMoney(saldoFinal)}</strong>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th style="width:90px;">Fecha</th>
            <th>Comprobante</th>
            <th>Número</th>
            <th class="num" style="width:105px;">Debe</th>
            <th class="num" style="width:105px;">Haber</th>
            <th class="num" style="width:110px;">Saldo</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="6" class="muted" style="text-align:center;padding:12px;">Sin movimientos confirmados.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

export async function printCuentaCorriente(data = {}, empresa = null) {
  const c = data.contacto || {};
  const { movsCliente, movsProveedor } = buildCuentaCorrienteMovimientos(data);
  const showCli = Boolean(c.es_cliente) || movsCliente.length > 0;
  const showProv = Boolean(c.es_proveedor || c.es_taller) || movsProveedor.length > 0;

  return openPrintWindow({
    title: `Cuenta Corriente — ${c.nombre || ''}`,
    empresa,
    allowCopies: false,
    extraCss: `
      .section { margin-top: 16px; }
      .section-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; gap: 8px; flex-wrap: wrap; }
      .section-head h3 { margin: 0; font-size: 14px; }
      .saldo-pill { background: #EDF2F7; border: 1px solid #C1CCDD; border-radius: 6px; padding: 6px 12px; text-align: right; }
      .saldo-pill span { display: block; font-size: 10px; text-transform: uppercase; color: #4A5568; }
      .saldo-pill strong { font-size: 15px; }
    `,
    renderCopyHtml: ({ emp }) => {
      const { empresaNombre, empresaLogo, empresaSub, empresaFiscalExtra } = buildEmpresaHeaderInfo(emp);
      return `
        <div class="doc-header" style="grid-template-columns:1fr auto;">
          <div>
            ${empresaLogo}
            <strong style="font-size:15px;display:block;">${esc(empresaNombre)}</strong>
            ${empresaSub ? `<div class="muted">${esc(empresaSub)}</div>` : ''}
            ${empresaFiscalExtra ? `<div class="muted">${esc(empresaFiscalExtra)}</div>` : ''}
          </div>
          <div class="doc-title">
            <div class="doc-badge">EXTRACTO DE CUENTA CORRIENTE</div>
            <div class="muted">Emitido: ${new Date().toISOString().slice(0, 10)}</div>
          </div>
        </div>

        <div class="meta-grid">
          <div class="meta-item">
            <span>Contacto</span>
            <strong>${esc(c.razon_social || c.nombre || '-')}</strong>
            <div class="muted">${c.cuit ? `${esc(c.tipo_documento || 'CUIT')}: ${esc(c.cuit)}` : 'Sin documento'} · ${esc(c.condicion_iva || '-')}</div>
          </div>
          <div class="meta-item">
            <span>Domicilio / Contacto</span>
            <strong>${esc([c.direccion, c.localidad, c.provincia].filter(Boolean).join(', ') || '-')}</strong>
            <div class="muted">${esc([c.telefono, c.email].filter(Boolean).join(' · ') || '')}</div>
          </div>
        </div>

        ${showCli ? renderMovsSection('Cuenta Corriente Cliente', 'Ventas confirmadas (+) vs. Cobros y Notas de Crédito (-)', movsCliente, data.saldo_cliente || 0, 'Saldo a Cobrar') : ''}
        ${showProv ? renderMovsSection('Cuenta Corriente Proveedor', 'Compras confirmadas (+) vs. Pagos y Notas de Crédito (-)', movsProveedor, data.saldo_proveedor || 0, 'Saldo a Pagar') : ''}
      `;
    },
  });
}
