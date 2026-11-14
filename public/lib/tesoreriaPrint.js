import { esc, fmtMoney } from './format.js';
import { openPrintWindow, buildEmpresaHeaderInfo } from './printShell.js';

async function openTesoreriaPrint({
  titulo,
  letra,
  subLetra,
  contraparteLabel,
  contraparteFallback,
  docRefLabel,
  docRefNumero,
  doc = {},
  lineas = [],
  empresa = null,
}) {
  const numero = doc.numero || `#${doc.id || ''}`;
  const cpNombre = doc.contacto_razon_social || doc.contacto_nombre || doc.cliente_nombre || doc.proveedor_nombre || contraparteFallback;
  const cpDoc = doc.contacto_cuit ? `${doc.contacto_tipo_documento || 'CUIT'}: ${doc.contacto_cuit}` : '';
  const cpDir = [doc.contacto_direccion, doc.contacto_localidad, doc.contacto_provincia].filter(Boolean).join(', ');
  const cpMeta = [cpDoc, doc.contacto_condicion_iva].filter(Boolean).join(' · ');

  const effectiveLineas = (lineas && lineas.length > 0)
    ? lineas
    : [{
        cuenta_nombre: doc.cuenta_nombre || '-',
        metodo: doc.metodo || '-',
        referencia: doc.referencia || '',
        monto: doc.monto || 0,
      }];

  const rowsHtml = effectiveLineas.map((l, idx) => `
    <tr>
      <td class="num">${idx + 1}</td>
      <td><strong>${esc(l.metodo || '-')}</strong></td>
      <td>${esc(l.cuenta_nombre || '-')}</td>
      <td>${esc(l.referencia || '—')}</td>
      <td class="num"><strong>${fmtMoney(l.monto)}</strong></td>
    </tr>
  `).join('');

  return openPrintWindow({
    title: `${titulo} ${numero}`,
    empresa,
    allowCopies: true,
    renderCopyHtml: ({ emp, copyLabel }) => {
      const { empresaNombre, empresaLogo, empresaSub, empresaFiscalExtra, empresaDir, empresaContact } = buildEmpresaHeaderInfo(emp);
      return `
        <div class="doc-header">
          <div>
            ${empresaLogo}
            <strong style="font-size:15px;display:block;">${esc(empresaNombre)}</strong>
            ${empresaSub ? `<div class="muted">${esc(empresaSub)}</div>` : ''}
            ${empresaFiscalExtra ? `<div class="muted">${esc(empresaFiscalExtra)}</div>` : ''}
            ${empresaDir ? `<div class="muted">${esc(empresaDir)}</div>` : ''}
            ${empresaContact ? `<div class="muted">${esc(empresaContact)}</div>` : ''}
          </div>
          <div>
            <div class="doc-letter">${esc(letra)}</div>
            <div class="doc-letter-sub">${esc(subLetra)}</div>
          </div>
          <div class="doc-title">
            <div class="copy-pill">${esc(copyLabel)}</div>
            <div><span class="doc-badge">${esc(titulo)}</span></div>
            <div class="doc-num">${esc(numero)}</div>
            <div class="muted">Fecha: ${esc(doc.fecha || '-')}</div>
            <div class="muted">Estado: ${esc(doc.estado || 'Confirmado')}</div>
          </div>
        </div>

        <div class="meta-grid">
          <div class="meta-item">
            <span>${esc(contraparteLabel)}</span>
            <strong>${esc(cpNombre)}</strong>
            ${cpMeta ? `<div class="muted">${esc(cpMeta)}</div>` : ''}
            ${cpDir ? `<div class="muted">${esc(cpDir)}</div>` : ''}
          </div>
          <div class="meta-item">
            <span>Referencia / Imputación</span>
            <strong>${docRefNumero ? `${esc(docRefLabel)}: ${esc(docRefNumero)}` : esc(doc.categoria_gasto || 'Cuenta Corriente / Tesorería')}</strong>
            ${doc.concepto ? `<div class="muted">${esc(doc.concepto)}</div>` : ''}
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th class="num" style="width:32px;">#</th>
              <th>Medio</th>
              <th>Cuenta / Caja / Banco</th>
              <th>Referencia / Cheque</th>
              <th class="num" style="width:120px;">Importe</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>

        <div class="bottom-grid">
          <div>
            ${doc.concepto ? `<div class="note-box"><strong>Concepto:</strong> ${esc(doc.concepto)}</div>` : ''}
          </div>
          <div class="totals-box">
            <div class="tot-row grand"><span>TOTAL</span><span>${fmtMoney(doc.monto || 0)}</span></div>
          </div>
        </div>

        <div class="sign-grid">
          <div class="sign-box">Firma y Aclaración Emisor</div>
          <div class="sign-box">Firma y Aclaración Receptor</div>
        </div>
      `;
    },
    renderTicketHtml: ({ emp, copyLabel }) => {
      const { empresaNombre, empresaLogo, empresaDir } = buildEmpresaHeaderInfo(emp);
      const tkMedios = effectiveLineas.map(l => `
        <div class="tk-item">
          <div class="tk-item-name">${esc(l.metodo || '-')}${l.cuenta_nombre ? ` (${esc(l.cuenta_nombre)})` : ''}</div>
          <div class="tk-item-sub">
            <span>${esc(l.referencia || '')}</span>
            <strong>${fmtMoney(l.monto)}</strong>
          </div>
        </div>
      `).join('');

      return `
        <div class="tk-center">
          ${empresaLogo}
          <div class="tk-title">${esc(empresaNombre)}</div>
          ${emp.cuit ? `<div class="tk-sub">CUIT: ${esc(emp.cuit)}</div>` : ''}
          ${empresaDir ? `<div class="tk-sub">${esc(empresaDir)}</div>` : ''}
        </div>
        <div class="tk-hr"></div>
        <div class="tk-center">
          <div class="tk-title">${esc(titulo)}</div>
          <div><strong>${esc(numero)}</strong> · ${esc(copyLabel)}</div>
          <div class="tk-sub">Fecha: ${esc(doc.fecha || '-')}</div>
        </div>
        <div class="tk-hr"></div>
        <div class="tk-sub">
          <div><strong>${esc(contraparteLabel)}:</strong> ${esc(cpNombre)}</div>
          ${cpDoc ? `<div>${esc(cpDoc)}</div>` : ''}
          ${docRefNumero ? `<div>${esc(docRefLabel)}: ${esc(docRefNumero)}</div>` : ''}
        </div>
        <div class="tk-hr"></div>
        ${tkMedios}
        <div class="tk-hr"></div>
        <div class="tk-total"><span>TOTAL</span><span>${fmtMoney(doc.monto || 0)}</span></div>
        ${doc.concepto ? `<div class="tk-hr"></div><div class="tk-sub">${esc(doc.concepto)}</div>` : ''}
        <div class="tk-sign">Firma Receptor</div>
      `;
    },
  });
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
