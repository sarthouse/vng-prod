/**
 * Reglas fiscales ARCA / AFIP (RG 1415/03, Ley 27.618 / RG 5003/21, RG 5762/25).
 * SSOT (Single Source of Truth) del catálogo de comprobantes y validación de letra fiscal.
 */

export const COMPROBANTES_AR = [
  // Facturas Fiscales
  { code: 'FA-A', label: '001 · Factura A', clase: 'factura', caracter: 'fiscal', letra: 'A', seqBase: 'venta', group: 'Facturas Fiscales' },
  { code: 'FA-B', label: '006 · Factura B', clase: 'factura', caracter: 'fiscal', letra: 'B', seqBase: 'venta', group: 'Facturas Fiscales' },
  { code: 'FA-C', label: '011 · Factura C', clase: 'factura', caracter: 'fiscal', letra: 'C', seqBase: 'venta', group: 'Facturas Fiscales' },
  { code: 'FA-M', label: '051 · Factura M', clase: 'factura', caracter: 'fiscal', letra: 'M', seqBase: 'venta', group: 'Facturas Fiscales' },
  { code: 'FA-E', label: '019 · Factura de Exportación E', clase: 'factura', caracter: 'fiscal', letra: 'E', seqBase: 'venta', group: 'Facturas Fiscales' },
  { code: 'FCE-A', label: '201 · Factura de Crédito MiPyME A', clase: 'factura', caracter: 'fiscal', letra: 'A', seqBase: 'venta', group: 'Facturas Fiscales' },
  { code: 'FCE-B', label: '206 · Factura de Crédito MiPyME B', clase: 'factura', caracter: 'fiscal', letra: 'B', seqBase: 'venta', group: 'Facturas Fiscales' },
  { code: 'FCE-C', label: '211 · Factura de Crédito MiPyME C', clase: 'factura', caracter: 'fiscal', letra: 'C', seqBase: 'venta', group: 'Facturas Fiscales' },
  { code: 'TKT-A', label: '081 · Tique Factura A', clase: 'factura', caracter: 'fiscal', letra: 'A', seqBase: 'venta', group: 'Facturas Fiscales' },
  { code: 'TKT-B', label: '082 · Tique Factura B', clase: 'factura', caracter: 'fiscal', letra: 'B', seqBase: 'venta', group: 'Facturas Fiscales' },
  { code: 'REC-A', label: '004 · Recibo A', clase: 'factura', caracter: 'fiscal', letra: 'A', seqBase: 'venta', group: 'Facturas Fiscales' },
  { code: 'REC-B', label: '009 · Recibo B', clase: 'factura', caracter: 'fiscal', letra: 'B', seqBase: 'venta', group: 'Facturas Fiscales' },
  { code: 'REC-C', label: '015 · Recibo C', clase: 'factura', caracter: 'fiscal', letra: 'C', seqBase: 'venta', group: 'Facturas Fiscales' },

  // Notas de Crédito Fiscales
  { code: 'NC-A', label: '003 · Nota de Crédito A', clase: 'nota_credito', caracter: 'fiscal', letra: 'A', seqBase: 'nc_venta', group: 'Notas de Crédito Fiscales' },
  { code: 'NC-B', label: '008 · Nota de Crédito B', clase: 'nota_credito', caracter: 'fiscal', letra: 'B', seqBase: 'nc_venta', group: 'Notas de Crédito Fiscales' },
  { code: 'NC-C', label: '013 · Nota de Crédito C', clase: 'nota_credito', caracter: 'fiscal', letra: 'C', seqBase: 'nc_venta', group: 'Notas de Crédito Fiscales' },
  { code: 'NC-M', label: '053 · Nota de Crédito M', clase: 'nota_credito', caracter: 'fiscal', letra: 'M', seqBase: 'nc_venta', group: 'Notas de Crédito Fiscales' },
  { code: 'NC-E', label: '021 · Nota de Crédito Exportación E', clase: 'nota_credito', caracter: 'fiscal', letra: 'E', seqBase: 'nc_venta', group: 'Notas de Crédito Fiscales' },
  { code: 'NCE-A', label: '203 · Nota de Crédito MiPyME A', clase: 'nota_credito', caracter: 'fiscal', letra: 'A', seqBase: 'nc_venta', group: 'Notas de Crédito Fiscales' },
  { code: 'NCE-B', label: '208 · Nota de Crédito MiPyME B', clase: 'nota_credito', caracter: 'fiscal', letra: 'B', seqBase: 'nc_venta', group: 'Notas de Crédito Fiscales' },
  { code: 'NCE-C', label: '213 · Nota de Crédito MiPyME C', clase: 'nota_credito', caracter: 'fiscal', letra: 'C', seqBase: 'nc_venta', group: 'Notas de Crédito Fiscales' },

  // Notas de Débito Fiscales
  { code: 'ND-A', label: '002 · Nota de Débito A', clase: 'nota_debito', caracter: 'fiscal', letra: 'A', seqBase: 'nd_venta', group: 'Notas de Débito Fiscales' },
  { code: 'ND-B', label: '007 · Nota de Débito B', clase: 'nota_debito', caracter: 'fiscal', letra: 'B', seqBase: 'nd_venta', group: 'Notas de Débito Fiscales' },
  { code: 'ND-C', label: '012 · Nota de Débito C', clase: 'nota_debito', caracter: 'fiscal', letra: 'C', seqBase: 'nd_venta', group: 'Notas de Débito Fiscales' },
  { code: 'ND-M', label: '052 · Nota de Débito M', clase: 'nota_debito', caracter: 'fiscal', letra: 'M', seqBase: 'nd_venta', group: 'Notas de Débito Fiscales' },
  { code: 'ND-E', label: '020 · Nota de Débito Exportación E', clase: 'nota_debito', caracter: 'fiscal', letra: 'E', seqBase: 'nd_venta', group: 'Notas de Débito Fiscales' },
  { code: 'NDE-A', label: '202 · Nota de Débito MiPyME A', clase: 'nota_debito', caracter: 'fiscal', letra: 'A', seqBase: 'nd_venta', group: 'Notas de Débito Fiscales' },
  { code: 'NDE-B', label: '207 · Nota de Débito MiPyME B', clase: 'nota_debito', caracter: 'fiscal', letra: 'B', seqBase: 'nd_venta', group: 'Notas de Débito Fiscales' },
  { code: 'NDE-C', label: '212 · Nota de Débito MiPyME C', clase: 'nota_debito', caracter: 'fiscal', letra: 'C', seqBase: 'nd_venta', group: 'Notas de Débito Fiscales' },

  // Comprobantes Internos X
  { code: 'FX', label: 'FX · Factura X (Interna)', clase: 'factura', caracter: 'interno', letra: 'X', seqBase: 'venta', group: 'Comprobantes Internos' },
  { code: 'NCX', label: 'NCX · Nota de Crédito X (Interna)', clase: 'nota_credito', caracter: 'interno', letra: 'X', seqBase: 'nc_venta', group: 'Comprobantes Internos' },
  { code: 'NDX', label: 'NDX · Nota de Débito X (Interna)', clase: 'nota_debito', caracter: 'interno', letra: 'X', seqBase: 'nd_venta', group: 'Comprobantes Internos' },
];

export function resolveComprobanteMeta(code, fallbackClase = 'factura') {
  const norm = String(code || '').trim().toUpperCase();
  if (norm === 'INT') {
    const mapped = fallbackClase === 'nota_credito' ? 'NCX' : fallbackClase === 'nota_debito' ? 'NDX' : 'FX';
    return resolveComprobanteMeta(mapped);
  }
  const found = COMPROBANTES_AR.find(c => c.code === norm) || COMPROBANTES_AR[0];
  let seqCode = found.seqBase;
  if (found.caracter === 'interno') {
    seqCode = `${found.seqBase}_x`;
  } else if (found.letra === 'B' || found.letra === 'C') {
    seqCode = `${found.seqBase}_${found.letra.toLowerCase()}`;
  }
  return { ...found, seqCode };
}

export function normalizeCondicionIva(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return 'OTRO';
  if (s.includes('monotribut')) return 'MONO';
  if (s.includes('no alcanzado')) return 'NO_ALCANZADO';
  if (s.includes('exento')) return 'EXENTO';
  if (s.includes('consumidor final')) return 'CF';
  if (s.includes('inscripto') && !s.includes('no inscripto')) return 'RI';
  return 'OTRO';
}

/**
 * Devuelve la letra fiscal obligatoria ('A' | 'B' | 'C') o null si el emisor no está categorizado.
 */
export function resolveLetraFiscal(emisorCondIva, receptorCondIva) {
  const emisor = normalizeCondicionIva(emisorCondIva);
  const receptor = normalizeCondicionIva(receptorCondIva);

  if (emisor === 'RI') {
    return (receptor === 'RI' || receptor === 'MONO') ? 'A' : 'B';
  }
  if (emisor === 'MONO' || emisor === 'EXENTO' || emisor === 'NO_ALCANZADO') {
    return 'C';
  }
  return null;
}

export function extractLetraComprobante(tipoComprobante) {
  const m = String(tipoComprobante || '').trim().toUpperCase().match(/-(A|B|C|M|E)$/);
  return m ? m[1] : null;
}

/**
 * Indica si corresponde la leyenda obligatoria RG 5003/21 (RI -> Monotributista en Factura/NC/ND A).
 */
export function isFacturaAMonotributo(emisorCondIva, receptorCondIva, tipoOrLetra) {
  const letra = String(tipoOrLetra || '').includes('-')
    ? extractLetraComprobante(tipoOrLetra)
    : String(tipoOrLetra || '').trim().toUpperCase();
  return letra === 'A'
    && normalizeCondicionIva(emisorCondIva) === 'RI'
    && normalizeCondicionIva(receptorCondIva) === 'MONO';
}

/**
 * Valida que el tipo_comprobante fiscal sea compatible con Emisor x Receptor según normativa ARCA.
 * Omite comprobantes internos ('X'), presupuestos/borradores y comprobantes de exportación ('E').
 */
export function validateComprobanteFiscal({ caracter = 'fiscal', tipoComprobante, emisorCondIva, receptorCondIva, estado = 'Confirmada' }) {
  if (caracter === 'interno') return;
  if (estado === 'Presupuesto' || estado === 'Borrador' || estado === 'Anulada') return;

  const letra = extractLetraComprobante(tipoComprobante);
  if (!letra || letra === 'E') return;

  const expected = resolveLetraFiscal(emisorCondIva, receptorCondIva);
  if (!expected) return;

  if (expected === 'C' && letra !== 'C') {
    throw new Error(`Normativa ARCA: un emisor "${emisorCondIva}" solo puede emitir comprobantes tipo C (recibido: ${tipoComprobante}).`);
  }
  if (expected === 'A' && letra !== 'A' && letra !== 'M') {
    throw new Error(`Normativa ARCA (RG 1415 / RG 5003): para emisor Responsable Inscripto y receptor "${receptorCondIva}" corresponde comprobante tipo A (recibido: ${tipoComprobante}).`);
  }
  if (expected === 'B' && letra !== 'B') {
    throw new Error(`Normativa ARCA (RG 1415): para emisor Responsable Inscripto y receptor "${receptorCondIva || 'Consumidor Final'}" corresponde comprobante tipo B (recibido: ${tipoComprobante}).`);
  }
}
