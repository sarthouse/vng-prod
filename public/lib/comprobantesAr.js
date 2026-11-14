/**
 * Catálogo de tipos de comprobantes (sincronizado desde /api/fiscal/catalogo como SSOT).
 */
export const COMPROBANTES_AR = [
  // Fallback inicial hasta que cargue /api/fiscal/catalogo
  { code: 'FA-A', label: '001 · Factura A', clase: 'factura', caracter: 'fiscal', letra: 'A', seqBase: 'venta', group: 'Facturas Fiscales' },
  { code: 'FA-B', label: '006 · Factura B', clase: 'factura', caracter: 'fiscal', letra: 'B', seqBase: 'venta', group: 'Facturas Fiscales' },
  { code: 'FA-C', label: '011 · Factura C', clase: 'factura', caracter: 'fiscal', letra: 'C', seqBase: 'venta', group: 'Facturas Fiscales' },
  { code: 'NC-A', label: '003 · Nota de Crédito A', clase: 'nota_credito', caracter: 'fiscal', letra: 'A', seqBase: 'nc_venta', group: 'Notas de Crédito Fiscales' },
  { code: 'NC-B', label: '008 · Nota de Crédito B', clase: 'nota_credito', caracter: 'fiscal', letra: 'B', seqBase: 'nc_venta', group: 'Notas de Crédito Fiscales' },
  { code: 'NC-C', label: '013 · Nota de Crédito C', clase: 'nota_credito', caracter: 'fiscal', letra: 'C', seqBase: 'nc_venta', group: 'Notas de Crédito Fiscales' },
  { code: 'ND-A', label: '002 · Nota de Débito A', clase: 'nota_debito', caracter: 'fiscal', letra: 'A', seqBase: 'nd_venta', group: 'Notas de Débito Fiscales' },
  { code: 'ND-B', label: '007 · Nota de Débito B', clase: 'nota_debito', caracter: 'fiscal', letra: 'B', seqBase: 'nd_venta', group: 'Notas de Débito Fiscales' },
  { code: 'ND-C', label: '012 · Nota de Débito C', clase: 'nota_debito', caracter: 'fiscal', letra: 'C', seqBase: 'nd_venta', group: 'Notas de Débito Fiscales' },
  { code: 'FX', label: 'FX · Factura X (Interna)', clase: 'factura', caracter: 'interno', letra: 'X', seqBase: 'venta', group: 'Comprobantes Internos' },
  { code: 'NCX', label: 'NCX · Nota de Crédito X (Interna)', clase: 'nota_credito', caracter: 'interno', letra: 'X', seqBase: 'nc_venta', group: 'Comprobantes Internos' },
  { code: 'NDX', label: 'NDX · Nota de Débito X (Interna)', clase: 'nota_debito', caracter: 'interno', letra: 'X', seqBase: 'nd_venta', group: 'Comprobantes Internos' },
];

let _catalogPromise = null;
export async function loadComprobantesCatalog(fetcher) {
  if (_catalogPromise) return _catalogPromise;
  _catalogPromise = (async () => {
    try {
      const data = fetcher
        ? await fetcher('/api/fiscal/catalogo')
        : await fetch('/api/fiscal/catalogo').then(r => (r.ok ? r.json() : null));
      if (Array.isArray(data?.comprobantes) && data.comprobantes.length > 0) {
        COMPROBANTES_AR.splice(0, COMPROBANTES_AR.length, ...data.comprobantes);
      }
    } catch { /* fallback local */ }
    return COMPROBANTES_AR;
  })();
  return _catalogPromise;
}

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

export function normalizeCondicionIvaClient(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return 'OTRO';
  if (s.includes('monotribut')) return 'MONO';
  if (s.includes('no alcanzado')) return 'NO_ALCANZADO';
  if (s.includes('exento')) return 'EXENTO';
  if (s.includes('consumidor final')) return 'CF';
  if (s.includes('inscripto') && !s.includes('no inscripto')) return 'RI';
  return 'OTRO';
}

export function resolveLetraFiscalClient(emisorCondIva, receptorCondIva) {
  const emisor = normalizeCondicionIvaClient(emisorCondIva);
  const receptor = normalizeCondicionIvaClient(receptorCondIva);
  if (emisor === 'RI') return (receptor === 'RI' || receptor === 'MONO') ? 'A' : 'B';
  if (emisor === 'MONO' || emisor === 'EXENTO' || emisor === 'NO_ALCANZADO') return 'C';
  return null;
}
