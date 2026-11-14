import { db } from '../../db.js';
import { BaseRepository } from '../../core/BaseRepository.js';
import { MODELS } from '../../db/models.js';

const PROVINCIA_TO_JURISDICCION = {
  'caba': '901',
  'capital federal': '901',
  'ciudad autonoma de buenos aires': '901',
  'ciudad autónoma de buenos aires': '901',
  'buenos aires': '902',
  'pba': '902',
  'catamarca': '903',
  'cordoba': '904',
  'córdoba': '904',
  'corrientes': '905',
  'chaco': '906',
  'chubut': '907',
  'entre rios': '908',
  'entre ríos': '908',
  'formosa': '909',
  'jujuy': '910',
  'la pampa': '911',
  'la rioja': '912',
  'mendoza': '913',
  'misiones': '914',
  'neuquen': '915',
  'neuquén': '915',
  'rio negro': '916',
  'río negro': '916',
  'salta': '917',
  'san juan': '918',
  'san luis': '919',
  'santa cruz': '920',
  'santa fe': '921',
  'santiago del estero': '922',
  'tucuman': '923',
  'tucumán': '923',
  'tierra del fuego': '924',
};

const AFIP_CBTE_COD = {
  'FA-A': '001', 'ND-A': '002', 'NDA': '002', 'NC-A': '003', 'NCA': '003',
  'FA-B': '006', 'ND-B': '007', 'NDB': '007', 'NC-B': '008', 'NCB': '008',
  'FA-C': '011', 'ND-C': '012', 'NDC': '012', 'NC-C': '013', 'NCC': '013',
  'FA-M': '051', 'ND-M': '052', 'NDM': '052', 'NC-M': '053', 'NCM': '053',
  'FC-A': '001', 'FC-B': '006', 'FC-C': '011', 'FC-M': '051',
};

const AFIP_DOC_COD = {
  CUIT: '80',
  CUIL: '86',
  CDI: '87',
  DNI: '96',
  Pasaporte: '94',
  Otro: '99',
};

const AFIP_ALIC_COD = {
  0: '0003',
  10.5: '0004',
  21: '0005',
  27: '0006',
  5: '0008',
  2.5: '0009',
};

function normText(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function resolveJurisdiccionCodigo(provincia = '', explicitCodigo = '') {
  const exp = String(explicitCodigo || '').trim();
  if (/^9\d{2}$/.test(exp)) return exp;
  const key = normText(provincia);
  if (!key) return '';
  if (PROVINCIA_TO_JURISDICCION[key]) return PROVINCIA_TO_JURISDICCION[key];
  for (const [name, cod] of Object.entries(PROVINCIA_TO_JURISDICCION)) {
    if (key.includes(name)) return cod;
  }
  return '';
}

export function listJurisdicciones() {
  return db.prepare('SELECT * FROM jurisdicciones WHERE activo = 1 ORDER BY codigo ASC').all();
}

export function listPadronAlicuotas({ cuit, jurisdiccion_codigo, tipo } = {}) {
  const where = ['1=1'];
  const args = [];
  if (cuit) {
    where.push("REPLACE(cuit, '-', '') = ?");
    args.push(String(cuit).replace(/\D/g, ''));
  }
  if (jurisdiccion_codigo) {
    where.push('jurisdiccion_codigo = ?');
    args.push(String(jurisdiccion_codigo).trim());
  }
  if (tipo) {
    where.push('tipo = ?');
    args.push(tipo);
  }
  return db.prepare(`SELECT * FROM padron_alicuotas WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 500`).all(...args);
}

export function upsertPadronAlicuota(b) {
  const cuitDigits = String(b.cuit || '').replace(/\D/g, '');
  if (!cuitDigits) throw new Error('El CUIT es obligatorio');
  const jur = String(b.jurisdiccion_codigo || '902').trim();
  const tipo = ['percepcion', 'retencion'].includes(b.tipo) ? b.tipo : 'percepcion';
  const alicuota = Math.max(0, Number(b.alicuota) || 0);
  const existing = db.prepare(
    "SELECT id FROM padron_alicuotas WHERE REPLACE(cuit, '-', '') = ? AND jurisdiccion_codigo = ? AND tipo = ?"
  ).get(cuitDigits, jur, tipo);
  const repo = new BaseRepository({ model: MODELS.padron_alicuotas });
  if (existing) {
    repo.update(existing.id, {
      cuit: cuitDigits,
      jurisdiccion_codigo: jur,
      tipo,
      alicuota,
      vigencia_desde: b.vigencia_desde || '',
      vigencia_hasta: b.vigencia_hasta || '',
      origen: b.origen || 'manual',
    });
    return existing.id;
  }
  return repo.create({
    cuit: cuitDigits,
    jurisdiccion_codigo: jur,
    tipo,
    alicuota,
    vigencia_desde: b.vigencia_desde || '',
    vigencia_hasta: b.vigencia_hasta || '',
    origen: b.origen || 'manual',
  });
}

export function deletePadronAlicuota(id) {
  new BaseRepository({ model: MODELS.padron_alicuotas }).delete(Number(id));
}

export function importPadronCsv(text, { jurisdiccion_codigo = '902', tipo = 'percepcion', origen = 'import_padron' } = {}) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let imported = 0;
  for (const line of lines) {
    const parts = line.split(/[;|,\t]/).map(p => p.trim());
    const cuitCol = parts.find(p => /^\d{2}-?\d{8}-?\d$/.test(p));
    if (!cuitCol) continue;
    const numCols = parts
      .filter(p => p !== cuitCol)
      .map(p => Number(p.replace(',', '.')))
      .filter(n => Number.isFinite(n) && n >= 0 && n <= 30);
    if (numCols.length === 0) continue;
    const alicuota = numCols[numCols.length - 1];
    upsertPadronAlicuota({
      cuit: cuitCol,
      jurisdiccion_codigo,
      tipo,
      alicuota,
      origen,
    });
    imported++;
  }
  return { imported };
}

export function sugerirPercepciones({ contacto_id, jurisdiccion_codigo, neto = 0, total = 0, aplica_a = 'ventas' } = {}) {
  const contacto = contacto_id
    ? db.prepare('SELECT id, cuit, provincia, jurisdiccion_codigo, condicion_iva FROM contactos WHERE id = ?').get(Number(contacto_id))
    : null;
  const jur = resolveJurisdiccionCodigo(contacto?.provincia, jurisdiccion_codigo || contacto?.jurisdiccion_codigo);
  const cuitDigits = String(contacto?.cuit || '').replace(/\D/g, '');
  const netoVal = Number(neto) || 0;
  const totalVal = Number(total) || netoVal;

  const impuestos = db.prepare(`
    SELECT * FROM impuestos_config
    WHERE activo = 1 AND tipo = 'percepcion' AND (aplica_a = 'ambos' OR aplica_a = ?)
  `).all(aplica_a);

  const sugerencias = [];
  for (const imp of impuestos) {
    if (jur && imp.jurisdiccion_codigo && imp.jurisdiccion_codigo !== jur) continue;
    if (!jur && imp.jurisdiccion_codigo) continue;

    let alicuota = Number(imp.alicuota_defecto || 0);
    let fuente = 'config';
    if (cuitDigits && imp.jurisdiccion_codigo) {
      const pad = db.prepare(
        "SELECT alicuota, origen FROM padron_alicuotas WHERE REPLACE(cuit, '-', '') = ? AND jurisdiccion_codigo = ? AND tipo = 'percepcion' LIMIT 1"
      ).get(cuitDigits, imp.jurisdiccion_codigo);
      if (pad) {
        alicuota = Number(pad.alicuota || 0);
        fuente = pad.origen || 'padron';
      }
    }
    if (alicuota <= 0) continue;
    const base = imp.base_calculo === 'total' ? totalVal : netoVal;
    const monto = Number(((base * alicuota) / 100).toFixed(2));
    sugerencias.push({
      impuesto_id: imp.id,
      nombre: imp.nombre,
      codigo: imp.codigo,
      jurisdiccion_codigo: imp.jurisdiccion_codigo || jur,
      alicuota,
      base_imponible: base,
      monto,
      fuente,
    });
  }
  return { jurisdiccion_codigo: jur, sugerencias };
}

function resolveAfipCbteCodigo(doc) {
  const tipo = String(doc.tipo_comprobante || '').toUpperCase().trim();
  if (AFIP_CBTE_COD[tipo]) return AFIP_CBTE_COD[tipo];
  const clase = doc.clase_documento || 'factura';
  const letraMatch = tipo.match(/-(A|B|C|M)$/) || tipo.match(/(A|B|C|M)$/);
  const letra = letraMatch ? letraMatch[1] : 'B';
  if (letra === 'A') return clase === 'nota_credito' ? '003' : clase === 'nota_debito' ? '002' : '001';
  if (letra === 'B') return clase === 'nota_credito' ? '008' : clase === 'nota_debito' ? '007' : '006';
  if (letra === 'C') return clase === 'nota_credito' ? '013' : clase === 'nota_debito' ? '012' : '011';
  if (letra === 'M') return clase === 'nota_credito' ? '053' : clase === 'nota_debito' ? '052' : '051';
  return '006';
}

function splitPtoVtaYNumero(numero = '', ptoVtaField = '') {
  const s = String(numero || '').trim();
  const m = s.match(/(\d{1,5})-(\d{1,8})$/);
  if (m) {
    return {
      ptoVta: String(Number(m[1]) || 1).padStart(5, '0'),
      cbteNro: String(Number(m[2]) || 1).padStart(20, '0'),
      cbteNroShort: String(Number(m[2]) || 1).padStart(8, '0'),
    };
  }
  const pv = String(Number(String(ptoVtaField || '1').replace(/\D/g, '')) || 1).padStart(5, '0');
  const nro = String(Number(s.replace(/\D/g, '')) || 1);
  return {
    ptoVta: pv,
    cbteNro: nro.padStart(20, '0'),
    cbteNroShort: nro.padStart(8, '0'),
  };
}

function padNum(val, len = 15) {
  const cents = Math.round(Math.abs(Number(val) || 0) * 100);
  return String(cents).padStart(len, '0').slice(-len);
}

function padStr(str, len = 30) {
  const clean = String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\r\n\t]/g, ' ')
    .trim();
  return clean.slice(0, len).padEnd(len, ' ');
}

function fmtDateYmd(fecha) {
  return String(fecha || '').replace(/\D/g, '').slice(0, 8).padEnd(8, '0');
}

function fmtDateDmy(fecha) {
  const m = String(fecha || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(fecha || '').slice(0, 10);
}

export function getLibroIva({ tipo = 'ventas', desde = '', hasta = '', incluir_no_fiscales = false } = {}) {
  const isVentas = tipo !== 'compras';
  const table = isVentas ? 'ventas' : 'compras';
  const linesTable = isVentas ? 'venta_lineas' : 'compra_lineas';
  const lineFk = isVentas ? 'venta_id' : 'compra_id';
  const impTable = isVentas ? 'venta_impuestos' : 'compra_impuestos';
  const impFk = isVentas ? 'venta_id' : 'compra_id';

  const where = ["d.estado NOT IN ('Borrador', 'Presupuesto', 'Anulada', 'Cancelado')"];
  const args = [];
  if (!incluir_no_fiscales) {
    where.push("d.caracter = 'fiscal'");
    where.push("UPPER(d.tipo_comprobante) NOT IN ('INT', 'FX', 'NCX', 'NDX', 'X')");
  }
  if (desde) {
    where.push('d.fecha >= ?');
    args.push(desde);
  }
  if (hasta) {
    where.push('d.fecha <= ?');
    args.push(hasta);
  }

  const docs = db.prepare(`
    SELECT d.*, c.nombre AS contacto_nombre, c.razon_social AS contacto_razon_social,
           c.tipo_documento AS contacto_tipo_doc, c.cuit AS contacto_cuit,
           c.condicion_iva AS contacto_condicion_iva, c.provincia AS contacto_provincia,
           c.jurisdiccion_codigo AS contacto_jur
    FROM ${table} d
    LEFT JOIN contactos c ON c.id = d.contacto_id
    WHERE ${where.join(' AND ')}
    ORDER BY d.fecha ASC, d.id ASC
  `).all(...args);

  const stmtLines = db.prepare(`SELECT alicuota_iva, subtotal, iva_monto FROM ${linesTable} WHERE ${lineFk} = ?`);
  const stmtImps = db.prepare(`SELECT tipo, nombre, alicuota, monto FROM ${impTable} WHERE ${impFk} = ?`);

  const rows = [];
  const totales = {
    cantidad: 0,
    neto_21: 0,
    iva_21: 0,
    neto_10_5: 0,
    iva_10_5: 0,
    neto_27: 0,
    iva_27: 0,
    neto_otros: 0,
    iva_otros: 0,
    exento_no_gravado: 0,
    percepciones_iva: 0,
    percepciones_iibb: 0,
    otros_impuestos: 0,
    total: 0,
  };

  for (const doc of docs) {
    const sign = doc.clase_documento === 'nota_credito' ? -1 : 1;
    const lineas = stmtLines.all(doc.id);
    const imps = stmtImps.all(doc.id);

    const alicMap = new Map();
    let exentoNoGravado = 0;

    if (lineas.length > 0) {
      for (const l of lineas) {
        const alic = Number(l.alicuota_iva ?? doc.alicuota_iva ?? 0);
        const sub = Number(l.subtotal || 0);
        const iva = Number(l.iva_monto ?? ((sub * alic) / 100));
        if (alic <= 0) {
          exentoNoGravado += sub;
        } else {
          const cur = alicMap.get(alic) || { alicuota: alic, neto: 0, iva: 0 };
          cur.neto += sub;
          cur.iva += iva;
          alicMap.set(alic, cur);
        }
      }
    } else {
      const alic = Number(doc.alicuota_iva || 0);
      const neto = Number(doc.neto || 0);
      const iva = Number(doc.iva_monto || 0);
      if (alic <= 0 && iva <= 0) exentoNoGravado += neto;
      else alicMap.set(alic || 21, { alicuota: alic || 21, neto, iva });
    }

    let percIva = 0;
    let percIibb = 0;
    let otrosImp = 0;
    for (const im of imps) {
      const m = Number(im.monto || 0);
      const nom = normText(im.nombre);
      if (im.tipo === 'percepcion' && nom.includes('iva')) percIva += m;
      else if (im.tipo === 'percepcion') percIibb += m;
      else if (im.tipo !== 'iva') otrosImp += m;
    }
    if (imps.length === 0 && Number(doc.otros_impuestos_monto || 0) > 0) {
      otrosImp = Number(doc.otros_impuestos_monto);
    }

    const getAlic = (rate) => alicMap.get(rate) || { neto: 0, iva: 0 };
    const a21 = getAlic(21);
    const a105 = getAlic(10.5);
    const a27 = getAlic(27);
    let netoOtros = 0;
    let ivaOtros = 0;
    for (const [rate, v] of alicMap.entries()) {
      if (rate !== 21 && rate !== 10.5 && rate !== 27) {
        netoOtros += v.neto;
        ivaOtros += v.iva;
      }
    }

    const row = {
      id: doc.id,
      fecha: doc.fecha,
      tipo_comprobante: doc.tipo_comprobante,
      clase_documento: doc.clase_documento,
      afip_cod: resolveAfipCbteCodigo(doc),
      numero: doc.numero,
      punto_venta: doc.punto_venta,
      cae: doc.cae || '',
      contacto_id: doc.contacto_id,
      razon_social: doc.contacto_razon_social || doc.contacto_nombre || 'Consumidor Final',
      tipo_documento: doc.contacto_tipo_doc || 'CUIT',
      cuit: doc.contacto_cuit || '',
      condicion_iva: doc.contacto_condicion_iva || 'Consumidor Final',
      jurisdiccion_codigo: resolveJurisdiccionCodigo(doc.contacto_provincia, doc.jurisdiccion_codigo || doc.contacto_jur),
      sign,
      neto_21: Number((a21.neto * sign).toFixed(2)),
      iva_21: Number((a21.iva * sign).toFixed(2)),
      neto_10_5: Number((a105.neto * sign).toFixed(2)),
      iva_10_5: Number((a105.iva * sign).toFixed(2)),
      neto_27: Number((a27.neto * sign).toFixed(2)),
      iva_27: Number((a27.iva * sign).toFixed(2)),
      neto_otros: Number((netoOtros * sign).toFixed(2)),
      iva_otros: Number((ivaOtros * sign).toFixed(2)),
      exento_no_gravado: Number((exentoNoGravado * sign).toFixed(2)),
      percepciones_iva: Number((percIva * sign).toFixed(2)),
      percepciones_iibb: Number((percIibb * sign).toFixed(2)),
      otros_impuestos: Number((otrosImp * sign).toFixed(2)),
      total: Number((Number(doc.total || 0) * sign).toFixed(2)),
      alicuotas: Array.from(alicMap.values()).map(a => ({
        alicuota: a.alicuota,
        afip_alic_cod: AFIP_ALIC_COD[a.alicuota] || '0005',
        neto: Number(a.neto.toFixed(2)),
        iva: Number(a.iva.toFixed(2)),
      })),
    };

    rows.push(row);
    totales.cantidad += 1;
    totales.neto_21 += row.neto_21;
    totales.iva_21 += row.iva_21;
    totales.neto_10_5 += row.neto_10_5;
    totales.iva_10_5 += row.iva_10_5;
    totales.neto_27 += row.neto_27;
    totales.iva_27 += row.iva_27;
    totales.neto_otros += row.neto_otros;
    totales.iva_otros += row.iva_otros;
    totales.exento_no_gravado += row.exento_no_gravado;
    totales.percepciones_iva += row.percepciones_iva;
    totales.percepciones_iibb += row.percepciones_iibb;
    totales.otros_impuestos += row.otros_impuestos;
    totales.total += row.total;
  }

  for (const k of Object.keys(totales)) {
    if (k !== 'cantidad') totales[k] = Number(totales[k].toFixed(2));
  }

  return { tipo: isVentas ? 'ventas' : 'compras', desde, hasta, rows, totales };
}

export function exportLibroIvaTxt({ tipo = 'ventas', desde = '', hasta = '' } = {}) {
  const isVentas = tipo !== 'compras';
  const data = getLibroIva({ tipo, desde, hasta, incluir_no_fiscales: false });
  const cbteLines = [];
  const alicLines = [];

  for (const r of data.rows) {
    const fechaYmd = fmtDateYmd(r.fecha);
    const { ptoVta, cbteNro } = splitPtoVtaYNumero(r.numero, r.punto_venta);
    const docDigits = String(r.cuit || '').replace(/\D/g, '');
    const docCod = docDigits ? (AFIP_DOC_COD[r.tipo_documento] || '80') : '99';
    const docNro = (docDigits || '0').padStart(20, '0').slice(-20);
    const denom = padStr(r.razon_social, 30);
    const totalAbs = padNum(r.total, 15);
    const noGrav = padNum(0, 15);
    const exento = padNum(r.exento_no_gravado, 15);
    const percIva = padNum(r.percepciones_iva, 15);
    const percIibb = padNum(r.percepciones_iibb, 15);
    const otrosImp = padNum(r.otros_impuestos, 15);
    const cantAlic = String(Math.max(1, r.alicuotas.length));
    const codOp = r.alicuotas.length === 0 && Math.abs(r.exento_no_gravado) > 0 ? 'E' : '0';

    if (isVentas) {
      // Especificación ARCA LIBRO_IVA_DIGITAL_VENTAS_CBTE
      cbteLines.push([
        fechaYmd,
        r.afip_cod,
        ptoVta,
        cbteNro,
        cbteNro,
        docCod,
        docNro,
        denom,
        totalAbs,
        noGrav,
        padNum(0, 15), // Percepción a no categorizados
        exento,
        percIva, // Percepciones impuestos nacionales
        percIibb,
        padNum(0, 15), // Impuestos municipales
        otrosImp,
        'PES',
        '0001000000',
        cantAlic,
        codOp,
        otrosImp,
        fechaYmd,
      ].join(''));

      const alics = r.alicuotas.length > 0
        ? r.alicuotas
        : [{ afip_alic_cod: '0003', neto: Math.abs(r.exento_no_gravado), iva: 0 }];
      for (const a of alics) {
        alicLines.push([
          r.afip_cod,
          ptoVta,
          cbteNro,
          padNum(a.neto, 15),
          a.afip_alic_cod,
          padNum(a.iva, 15),
        ].join(''));
      }
    } else {
      // Especificación ARCA LIBRO_IVA_DIGITAL_COMPRAS_CBTE
      cbteLines.push([
        fechaYmd,
        r.afip_cod,
        ptoVta,
        cbteNro,
        padStr('', 16), // Despacho importación
        docCod,
        docNro,
        denom,
        totalAbs,
        noGrav,
        exento,
        percIva,
        padNum(0, 15), // Percepciones otros impuestos nacionales
        percIibb,
        padNum(0, 15), // Impuestos municipales
        otrosImp,
        'PES',
        '0001000000',
        cantAlic,
        codOp,
        padNum(Math.abs(r.iva_21 + r.iva_10_5 + r.iva_27 + r.iva_otros), 15), // Crédito fiscal computable
        otrosImp,
        '0'.repeat(11), // CUIT emisor/corredor
        padStr('', 30), // Denominación emisor/corredor
        padNum(0, 15), // IVA comisión
      ].join(''));

      const alics = r.alicuotas.length > 0
        ? r.alicuotas
        : [{ afip_alic_cod: '0003', neto: Math.abs(r.exento_no_gravado), iva: 0 }];
      for (const a of alics) {
        alicLines.push([
          r.afip_cod,
          ptoVta,
          cbteNro,
          docCod,
          docNro,
          padNum(a.neto, 15),
          a.afip_alic_cod,
          padNum(a.iva, 15),
        ].join(''));
      }
    }
  }

  return {
    tipo: isVentas ? 'ventas' : 'compras',
    cbteFilename: isVentas ? 'LIBRO_IVA_DIGITAL_VENTAS_CBTE.txt' : 'LIBRO_IVA_DIGITAL_COMPRAS_CBTE.txt',
    alicuotasFilename: isVentas ? 'LIBRO_IVA_DIGITAL_VENTAS_ALICUOTAS.txt' : 'LIBRO_IVA_DIGITAL_COMPRAS_ALICUOTAS.txt',
    cbteTxt: cbteLines.join('\r\n'),
    alicuotasTxt: alicLines.join('\r\n'),
    cantidad: data.rows.length,
  };
}

export function getLibroAuxiliar({ categoria = 'percepciones', jurisdiccion_codigo = '', desde = '', hasta = '' } = {}) {
  const rows = [];

  if (categoria === 'percepciones' || categoria === 'todas') {
    const vWhere = ["v.estado NOT IN ('Borrador', 'Presupuesto', 'Anulada')", "vi.tipo = 'percepcion'"];
    const vArgs = [];
    if (desde) { vWhere.push('v.fecha >= ?'); vArgs.push(desde); }
    if (hasta) { vWhere.push('v.fecha <= ?'); vArgs.push(hasta); }
    const vRows = db.prepare(`
      SELECT vi.id, v.fecha, 'venta' AS origen, 'Practicada (Venta)' AS direccion,
             v.id AS documento_id, v.numero AS comprobante, v.tipo_comprobante, v.clase_documento,
             c.nombre AS contacto_nombre, c.razon_social AS contacto_razon_social, c.cuit,
             COALESCE(NULLIF(ic.jurisdiccion_codigo, ''), v.jurisdiccion_codigo, c.jurisdiccion_codigo, '') AS jurisdiccion_codigo,
             COALESCE(ic.codigo_regimen, '') AS codigo_regimen,
             vi.nombre AS impuesto_nombre, ic.codigo AS impuesto_codigo,
             v.neto AS base_imponible, vi.alicuota, vi.monto
      FROM venta_impuestos vi
      JOIN ventas v ON v.id = vi.venta_id
      LEFT JOIN contactos c ON c.id = v.contacto_id
      LEFT JOIN impuestos_config ic ON ic.id = vi.impuesto_id
      WHERE ${vWhere.join(' AND ')}
    `).all(...vArgs);

    const cWhere = ["co.estado NOT IN ('Borrador', 'Anulada', 'Cancelado')", "ci.tipo = 'percepcion'"];
    const cArgs = [];
    if (desde) { cWhere.push('co.fecha >= ?'); cArgs.push(desde); }
    if (hasta) { cWhere.push('co.fecha <= ?'); cArgs.push(hasta); }
    const cRows = db.prepare(`
      SELECT ci.id, co.fecha, 'compra' AS origen, 'Sufrida (Compra)' AS direccion,
             co.id AS documento_id, co.numero AS comprobante, co.tipo_comprobante, co.clase_documento,
             c.nombre AS contacto_nombre, c.razon_social AS contacto_razon_social, c.cuit,
             COALESCE(NULLIF(ic.jurisdiccion_codigo, ''), co.jurisdiccion_codigo, c.jurisdiccion_codigo, '') AS jurisdiccion_codigo,
             COALESCE(ic.codigo_regimen, '') AS codigo_regimen,
             ci.nombre AS impuesto_nombre, ic.codigo AS impuesto_codigo,
             co.neto AS base_imponible, ci.alicuota, ci.monto
      FROM compra_impuestos ci
      JOIN compras co ON co.id = ci.compra_id
      LEFT JOIN contactos c ON c.id = co.contacto_id
      LEFT JOIN impuestos_config ic ON ic.id = ci.impuesto_id
      WHERE ${cWhere.join(' AND ')}
    `).all(...cArgs);

    rows.push(...vRows, ...cRows);
  }

  if (categoria === 'retenciones' || categoria === 'todas') {
    const pWhere = ["p.estado = 'Confirmado'"];
    const pArgs = [];
    if (desde) { pWhere.push('p.fecha >= ?'); pArgs.push(desde); }
    if (hasta) { pWhere.push('p.fecha <= ?'); pArgs.push(hasta); }
    const pRows = db.prepare(`
      SELECT pr.id, p.fecha, 'pago' AS origen, 'Practicada (Pago)' AS direccion,
             p.id AS documento_id, COALESCE(NULLIF(pr.numero_certificado, ''), p.numero) AS comprobante,
             'OP' AS tipo_comprobante, 'pago' AS clase_documento,
             c.nombre AS contacto_nombre, c.razon_social AS contacto_razon_social, c.cuit,
             COALESCE(NULLIF(pr.jurisdiccion_codigo, ''), ic.jurisdiccion_codigo, c.jurisdiccion_codigo, '') AS jurisdiccion_codigo,
             COALESCE(NULLIF(pr.codigo_regimen, ''), ic.codigo_regimen, '') AS codigo_regimen,
             pr.nombre AS impuesto_nombre, ic.codigo AS impuesto_codigo,
             pr.base_imponible, pr.alicuota, pr.monto, pr.numero_certificado
      FROM pago_retenciones pr
      JOIN pagos p ON p.id = pr.pago_id
      LEFT JOIN contactos c ON c.id = p.contacto_id
      LEFT JOIN impuestos_config ic ON ic.id = pr.impuesto_id
      WHERE ${pWhere.join(' AND ')}
    `).all(...pArgs);

    const crWhere = ["co.estado NOT IN ('Borrador', 'Anulada', 'Cancelado')", "ci.tipo = 'retencion'"];
    const crArgs = [];
    if (desde) { crWhere.push('co.fecha >= ?'); crArgs.push(desde); }
    if (hasta) { crWhere.push('co.fecha <= ?'); crArgs.push(hasta); }
    const crRows = db.prepare(`
      SELECT ci.id, co.fecha, 'compra' AS origen, 'Compra' AS direccion,
             co.id AS documento_id, co.numero AS comprobante, co.tipo_comprobante, co.clase_documento,
             c.nombre AS contacto_nombre, c.razon_social AS contacto_razon_social, c.cuit,
             COALESCE(NULLIF(ic.jurisdiccion_codigo, ''), co.jurisdiccion_codigo, c.jurisdiccion_codigo, '') AS jurisdiccion_codigo,
             COALESCE(ic.codigo_regimen, '') AS codigo_regimen,
             ci.nombre AS impuesto_nombre, ic.codigo AS impuesto_codigo,
             co.neto AS base_imponible, ci.alicuota, ci.monto
      FROM compra_impuestos ci
      JOIN compras co ON co.id = ci.compra_id
      LEFT JOIN contactos c ON c.id = co.contacto_id
      LEFT JOIN impuestos_config ic ON ic.id = ci.impuesto_id
      WHERE ${crWhere.join(' AND ')}
    `).all(...crArgs);

    rows.push(...pRows, ...crRows);
  }

  const filtered = rows
    .filter(r => !jurisdiccion_codigo || r.jurisdiccion_codigo === jurisdiccion_codigo)
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || (a.id - b.id));

  const porImpuesto = {};
  let totalMonto = 0;
  for (const r of filtered) {
    const sign = r.clase_documento === 'nota_credito' ? -1 : 1;
    r.monto_neto = Number((Number(r.monto || 0) * sign).toFixed(2));
    totalMonto += r.monto_neto;
    const key = `${r.impuesto_nombre} (${r.direccion})`;
    if (!porImpuesto[key]) porImpuesto[key] = { nombre: r.impuesto_nombre, direccion: r.direccion, cantidad: 0, monto: 0 };
    porImpuesto[key].cantidad += 1;
    porImpuesto[key].monto = Number((porImpuesto[key].monto + r.monto_neto).toFixed(2));
  }

  return {
    categoria,
    desde,
    hasta,
    rows: filtered,
    resumen: Object.values(porImpuesto),
    total: Number(totalMonto.toFixed(2)),
  };
}

function fmtSicoreNum(val, intLen, decLen = 2) {
  const fixed = Math.abs(Number(val) || 0).toFixed(decLen).replace('.', ',');
  return fixed.padStart(intLen + 1 + decLen, '0').slice(-(intLen + 1 + decLen));
}

export function exportSicoreTxt({ desde = '', hasta = '' } = {}) {
  const { rows } = getLibroAuxiliar({ categoria: 'retenciones', desde, hasta });
  const lines = [];
  for (const r of rows) {
    if (r.jurisdiccion_codigo) continue; // SICORE aplica a impuestos nacionales (Ganancias / IVA)
    const isIva = normText(r.impuesto_nombre).includes('iva');
    const codImpuesto = isIva ? '0767' : '0217';
    const codRegimen = String(r.codigo_regimen || (isIva ? '212' : '078')).padStart(3, '0').slice(-3);
    const fecha = fmtDateDmy(r.fecha);
    const nroCbte = String(r.comprobante || '').replace(/\s+/g, '').slice(0, 16).padEnd(16, ' ');
    const cuitDigits = String(r.cuit || '').replace(/\D/g, '').padStart(11, '0').slice(-11);
    const cert = String(r.numero_certificado || r.comprobante || '').replace(/\D/g, '').padStart(14, '0').slice(-14);

    lines.push([
      '06', // Orden de Pago
      fecha,
      nroCbte,
      fmtSicoreNum(r.base_imponible, 13, 2),
      codImpuesto,
      codRegimen,
      '1', // Retención
      fmtSicoreNum(r.base_imponible, 11, 2),
      fecha,
      '01', // Inscripto
      '0',
      fmtSicoreNum(r.monto, 11, 2),
      '000,00',
      ' '.repeat(10),
      '80',
      cuitDigits.padEnd(20, ' '),
      cert,
    ].join(''));
  }
  return { filename: 'SICORE_RETENCIONES.txt', content: lines.join('\r\n'), cantidad: lines.length };
}

export function exportSifereTxt({ desde = '', hasta = '', categoria = 'percepciones' } = {}) {
  const { rows } = getLibroAuxiliar({ categoria, desde, hasta });
  const lines = [];
  for (const r of rows) {
    if (!r.jurisdiccion_codigo) continue;
    const jur = String(r.jurisdiccion_codigo).padStart(3, '0').slice(-3);
    const d = String(r.cuit || '').replace(/\D/g, '').padStart(11, '0').slice(-11);
    const cuitFmt = `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10, 11)}`;
    const fecha = fmtDateDmy(r.fecha);
    const { ptoVta, cbteNroShort } = splitPtoVtaYNumero(r.comprobante, '');
    const tipo = r.clase_documento === 'nota_credito' ? 'C' : (r.origen === 'pago' ? 'R' : 'F');
    const letraMatch = String(r.tipo_comprobante || '').match(/-(A|B|C|M)$/);
    const letra = letraMatch ? letraMatch[1] : ' ';
    const montoFmt = Math.abs(Number(r.monto || 0)).toFixed(2).replace('.', ',').padStart(11, '0');

    lines.push([
      jur,
      cuitFmt,
      fecha,
      ptoVta.slice(-4),
      cbteNroShort,
      tipo,
      letra,
      montoFmt,
    ].join(''));
  }
  return {
    filename: categoria === 'retenciones' ? 'SIFERE_RETENCIONES.txt' : 'SIFERE_PERCEPCIONES.txt',
    content: lines.join('\r\n'),
    cantidad: lines.length,
  };
}

export function getReporteJurisdicciones({ desde = '', hasta = '', tipo = 'ventas' } = {}) {
  const isVentas = tipo !== 'compras';
  const table = isVentas ? 'ventas' : 'compras';
  const where = ["d.estado NOT IN ('Borrador', 'Presupuesto', 'Anulada', 'Cancelado')"];
  const args = [];
  if (desde) { where.push('d.fecha >= ?'); args.push(desde); }
  if (hasta) { where.push('d.fecha <= ?'); args.push(hasta); }

  const docs = db.prepare(`
    SELECT d.id, d.clase_documento, d.neto, d.iva_monto, d.otros_impuestos_monto, d.total,
           d.jurisdiccion_codigo, c.provincia AS contacto_provincia, c.jurisdiccion_codigo AS contacto_jur
    FROM ${table} d
    LEFT JOIN contactos c ON c.id = d.contacto_id
    WHERE ${where.join(' AND ')}
  `).all(...args);

  const jurNames = new Map(listJurisdicciones().map(j => [j.codigo, j.nombre]));
  const grouped = new Map();
  let granTotal = 0;

  for (const d of docs) {
    const sign = d.clase_documento === 'nota_credito' ? -1 : 1;
    const cod = resolveJurisdiccionCodigo(d.contacto_provincia, d.jurisdiccion_codigo || d.contacto_jur) || '000';
    const nombre = jurNames.get(cod) || 'Sin jurisdicción asignada';
    if (!grouped.has(cod)) {
      grouped.set(cod, { codigo: cod, nombre, cantidad: 0, neto: 0, iva: 0, otros_impuestos: 0, total: 0 });
    }
    const g = grouped.get(cod);
    g.cantidad += 1;
    g.neto = Number((g.neto + Number(d.neto || 0) * sign).toFixed(2));
    g.iva = Number((g.iva + Number(d.iva_monto || 0) * sign).toFixed(2));
    g.otros_impuestos = Number((g.otros_impuestos + Number(d.otros_impuestos_monto || 0) * sign).toFixed(2));
    g.total = Number((g.total + Number(d.total || 0) * sign).toFixed(2));
    granTotal += Number(d.total || 0) * sign;
  }

  const rows = Array.from(grouped.values())
    .map(r => ({
      ...r,
      porcentaje: granTotal !== 0 ? Number(((r.total / granTotal) * 100).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.total - a.total);

  return {
    tipo: isVentas ? 'ventas' : 'compras',
    desde,
    hasta,
    rows,
    total: Number(granTotal.toFixed(2)),
  };
}
