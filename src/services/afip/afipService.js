import fs from 'node:fs';
import path from 'node:path';
import { db, DB_DIR } from '../../db.js';
import {
  generateKeyAndCsr,
  signLoginTicketRequest,
  parseCertificateInfo,
} from './afipCrypto.js';
import { validateComprobanteFiscal } from './fiscalRules.js';

const ENDPOINTS = {
  homologacion: {
    wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
    padron: 'https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA5',
    wscdc: 'https://wswhomo.afip.gov.ar/wscdc/service.asmx',
  },
  produccion: {
    wsaa: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
    padron: 'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5',
    wscdc: 'https://servicios1.afip.gov.ar/WSCDC/service.asmx',
  },
};

// Mapeo de códigos internos de tipo_comprobante a códigos AFIP WSFEv1
const AFIP_CBTE_TIPO = {
  'FA-A': 1, 'ND-A': 2, 'NC-A': 3, 'REC-A': 4,
  'FA-B': 6, 'ND-B': 7, 'NC-B': 8, 'REC-B': 9,
  'FA-C': 11, 'ND-C': 12, 'NC-C': 13, 'REC-C': 15,
  'FA-M': 51, 'ND-M': 52, 'NC-M': 53,
  'FCE-A': 201, 'NDE-A': 202, 'NCE-A': 203,
  'FCE-B': 206, 'NDE-B': 207, 'NCE-B': 208,
  'FCE-C': 211, 'NDE-C': 212, 'NCE-C': 213,
};

const AFIP_DOC_TIPO = {
  CUIT: 80,
  CUIL: 86,
  CDI: 87,
  LE: 89,
  LC: 90,
  CI: 91,
  Pasaporte: 94,
  DNI: 96,
  'Consumidor Final': 99,
};

const AFIP_COND_IVA_RECEPTOR = {
  'Responsable Inscripto': 1,
  'IVA Responsable Inscripto': 1,
  Exento: 4,
  'IVA Sujeto Exento': 4,
  'Consumidor Final': 5,
  Monotributo: 6,
  Monotributista: 6,
  'Responsable Monotributo': 6,
  'No Categorizado': 7,
  'Sujeto No Categorizado': 7,
  'IVA No Alcanzado': 15,
};

const AFIP_ALIC_IVA_ID = {
  0: 3,
  10.5: 4,
  21: 5,
  27: 6,
  5: 8,
  2.5: 9,
};

// ── Helpers XML / SOAP ─────────────────────────────────────────────────────

function escXml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescXml(v) {
  return String(v ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractTag(xml, tagName) {
  const re = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${tagName}>`, 'i');
  const m = String(xml || '').match(re);
  return m ? m[1].trim() : '';
}

function extractAllBlocks(xml, tagName) {
  const re = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${tagName}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(String(xml || ''))) !== null) {
    out.push(m[1]);
  }
  return out;
}

async function soapPost(url, soapAction, envelopeXml) {
  const headers = {
    'Content-Type': 'text/xml; charset=utf-8',
  };
  if (soapAction !== undefined && soapAction !== null) {
    headers.SOAPAction = `"${soapAction}"`;
  }
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: envelopeXml,
      signal: AbortSignal.timeout(25000),
    });
  } catch (err) {
    throw new Error(`Error de red comunicándose con AFIP (${url}): ${err.message}`);
  }
  const text = await res.text();
  const fault = extractTag(text, 'faultstring');
  if (fault) {
    throw new Error(`AFIP SOAP Fault: ${unescXml(fault)}`);
  }
  if (!res.ok) {
    throw new Error(`AFIP HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return text;
}

// ── Lectura / Escritura de configuración AFIP ──────────────────────────────

function getEmpresaAfipRow() {
  return db.prepare(`
    SELECT id, razon_social, cuit, condicion_iva,
           afip_entorno, afip_private_key, afip_csr, afip_crt, afip_ta_wsfe, afip_ta_padron, afip_ta_wscdc
    FROM empresa_config WHERE id = 1
  `).get() || {};
}

function getEntorno(row) {
  return row?.afip_entorno === 'produccion' ? 'produccion' : 'homologacion';
}

export function getAfipStatus() {
  const row = getEmpresaAfipRow();
  let certInfo = null;
  let certError = '';
  if (row.afip_crt) {
    try {
      certInfo = parseCertificateInfo(row.afip_crt);
    } catch (e) {
      certError = e.message;
    }
  }
  return {
    entorno: getEntorno(row),
    cuit_empresa: row.cuit || '',
    razon_social: row.razon_social || '',
    tiene_key: Boolean(row.afip_private_key),
    tiene_csr: Boolean(row.afip_csr),
    tiene_crt: Boolean(row.afip_crt),
    cert_info: certInfo,
    cert_error: certError,
  };
}

export function setAfipEntorno(entorno) {
  if (entorno !== 'homologacion' && entorno !== 'produccion') {
    throw new Error('Entorno AFIP inválido. Debe ser "homologacion" o "produccion"');
  }
  db.prepare(`
    UPDATE empresa_config
    SET afip_entorno = ?, afip_ta_wsfe = '', afip_ta_padron = '', afip_ta_wscdc = ''
    WHERE id = 1
  `).run(entorno);
  return getAfipStatus();
}

export function generarAfipKeys({ cn = 'vanguard' } = {}) {
  const row = getEmpresaAfipRow();
  const { privateKeyPem, csrPem } = generateKeyAndCsr({
    cuit: row.cuit,
    razonSocial: row.razon_social,
    cn,
  });
  db.prepare(`
    UPDATE empresa_config
    SET afip_private_key = ?, afip_csr = ?, afip_ta_wsfe = '', afip_ta_padron = '', afip_ta_wscdc = ''
    WHERE id = 1
  `).run(privateKeyPem, csrPem);
  return getAfipStatus();
}

export function getAfipCsr() {
  const row = getEmpresaAfipRow();
  if (!row.afip_csr) {
    throw new Error('Todavía no se generó el CSR. Generá la clave y CSR primero.');
  }
  return row.afip_csr;
}

export function guardarAfipCertificado(crtPem) {
  const clean = String(crtPem || '').trim();
  if (!clean.includes('BEGIN CERTIFICATE')) {
    throw new Error('El contenido no parece un certificado X.509 PEM (.crt) válido');
  }
  // Validar que Node pueda parsearlo
  parseCertificateInfo(clean);
  db.prepare(`
    UPDATE empresa_config
    SET afip_crt = ?, afip_ta_wsfe = '', afip_ta_padron = '', afip_ta_wscdc = ''
    WHERE id = 1
  `).run(clean);
  return getAfipStatus();
}

// ── WSAA (Autenticación y Ticket de Acceso) ────────────────────────────────

export async function getAuthToken(service = 'wsfe') {
  const row = getEmpresaAfipRow();
  const entorno = getEntorno(row);
  const cuitDigits = String(row.cuit || '').replace(/\D/g, '');
  if (cuitDigits.length !== 11) {
    throw new Error('Configurá el CUIT de la empresa (11 dígitos) antes de conectar con AFIP');
  }
  if (!row.afip_private_key || !row.afip_crt) {
    throw new Error('Falta configurar la clave privada y el certificado (.crt) de AFIP en Configuración');
  }

  const cacheCol = service === 'wsfe'
    ? 'afip_ta_wsfe'
    : service === 'wscdc'
      ? 'afip_ta_wscdc'
      : 'afip_ta_padron';
  if (row[cacheCol]) {
    try {
      const cached = JSON.parse(row[cacheCol]);
      const expMs = Date.parse(cached.expirationTime);
      if (
        cached.entorno === entorno
        && cached.token
        && cached.sign
        && Number.isFinite(expMs)
        && expMs - Date.now() > 5 * 60 * 1000
      ) {
        return { token: cached.token, sign: cached.sign, cuit: cuitDigits, entorno };
      }
    } catch {
      // Cache corrupto: regenerar
    }
  }

  const uniqueId = Math.floor(Date.now() / 1000);
  const genTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const expTime = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();

  const traXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<loginTicketRequest version="1.0">',
    '  <header>',
    `    <uniqueId>${uniqueId}</uniqueId>`,
    `    <generationTime>${genTime}</generationTime>`,
    `    <expirationTime>${expTime}</expirationTime>`,
    '  </header>',
    `  <service>${escXml(service)}</service>`,
    '</loginTicketRequest>',
  ].join('\n');

  const cmsBase64 = signLoginTicketRequest(traXml, row.afip_crt, row.afip_private_key);

  const soapEnvelope = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">',
    '  <soapenv:Header/>',
    '  <soapenv:Body>',
    '    <wsaa:loginCms>',
    `      <wsaa:in0>${cmsBase64}</wsaa:in0>`,
    '    </wsaa:loginCms>',
    '  </soapenv:Body>',
    '</soapenv:Envelope>',
  ].join('\n');

  const respXml = await soapPost(ENDPOINTS[entorno].wsaa, '', soapEnvelope);
  const loginCmsReturn = unescXml(extractTag(respXml, 'loginCmsReturn'));
  const token = extractTag(loginCmsReturn, 'token');
  const sign = extractTag(loginCmsReturn, 'sign');
  const expirationTime = extractTag(loginCmsReturn, 'expirationTime') || expTime;

  if (!token || !sign) {
    throw new Error('WSAA no devolvió token/sign válidos');
  }

  db.prepare(`UPDATE empresa_config SET ${cacheCol} = ? WHERE id = 1`).run(
    JSON.stringify({ entorno, token, sign, expirationTime })
  );

  return { token, sign, cuit: cuitDigits, entorno };
}

// ── WSFEv1 (Facturación Electrónica) ───────────────────────────────────────

export async function checkEstadoAfip() {
  const status = getAfipStatus();
  const url = ENDPOINTS[status.entorno].wsfe;
  const envelope = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">',
    '  <soap:Body>',
    '    <ar:FEDummy/>',
    '  </soap:Body>',
    '</soap:Envelope>',
  ].join('\n');

  const respXml = await soapPost(url, 'http://ar.gov.afip.dif.FEV1/FEDummy', envelope);
  return {
    ...status,
    wsfe: {
      appServer: extractTag(respXml, 'AppServer'),
      dbServer: extractTag(respXml, 'DbServer'),
      authServer: extractTag(respXml, 'AuthServer'),
    },
  };
}

export async function getUltimoComprobanteAfip(ptoVta, cbteTipo) {
  const { token, sign, cuit, entorno } = await getAuthToken('wsfe');
  const envelope = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">',
    '  <soap:Body>',
    '    <ar:FECompUltimoAutorizado>',
    '      <ar:Auth>',
    `        <ar:Token>${escXml(token)}</ar:Token>`,
    `        <ar:Sign>${escXml(sign)}</ar:Sign>`,
    `        <ar:Cuit>${escXml(cuit)}</ar:Cuit>`,
    '      </ar:Auth>',
    `      <ar:PtoVta>${Number(ptoVta)}</ar:PtoVta>`,
    `      <ar:CbteTipo>${Number(cbteTipo)}</ar:CbteTipo>`,
    '    </ar:FECompUltimoAutorizado>',
    '  </soap:Body>',
    '</soap:Envelope>',
  ].join('\n');

  const respXml = await soapPost(
    ENDPOINTS[entorno].wsfe,
    'http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado',
    envelope
  );
  const errs = parseWsfeMessages(respXml, 'Err');
  if (errs.length) {
    throw new Error(`AFIP Error (${errs[0].code}): ${errs[0].msg}`);
  }
  return parseInt(extractTag(respXml, 'CbteNro') || '0', 10) || 0;
}

function parseWsfeMessages(xml, blockTag) {
  return extractAllBlocks(xml, blockTag).map((b) => ({
    code: extractTag(b, 'Code'),
    msg: unescXml(extractTag(b, 'Msg')),
  }));
}

function toAfipDate(isoDate) {
  const clean = String(isoDate || '').replace(/\D/g, '');
  if (clean.length >= 8) return clean.slice(0, 8);
  const now = new Date();
  return now.toISOString().slice(0, 10).replace(/-/g, '');
}

function fromAfipDate(yyyymmdd) {
  const s = String(yyyymmdd || '').replace(/\D/g, '');
  if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s;
}

export async function emitirFacturaAfip(ventaId) {
  const venta = db.prepare('SELECT * FROM ventas WHERE id = ?').get(ventaId);
  if (!venta) throw new Error('Venta no encontrada');
  if (venta.caracter !== 'fiscal') {
    throw new Error('Solo los comprobantes con carácter Fiscal pueden solicitar CAE en AFIP');
  }
  if (venta.cae) {
    throw new Error(`Este comprobante ya posee CAE (${venta.cae})`);
  }

  const ptoVtaNum = parseInt(String(venta.punto_venta || '').replace(/\D/g, ''), 10);
  if (!ptoVtaNum) {
    throw new Error('La venta no tiene un Punto de Venta válido asignado');
  }
  const pvRow = db.prepare('SELECT * FROM puntos_venta WHERE numero = ?').get(ptoVtaNum);
  if (!pvRow || !pvRow.es_electronica) {
    throw new Error(`El Punto de Venta ${String(ptoVtaNum).padStart(4, '0')} no está marcado como Facturación Electrónica (WSFE) en Configuración`);
  }

  const cbteTipo = AFIP_CBTE_TIPO[venta.tipo_comprobante];
  if (!cbteTipo) {
    throw new Error(`El tipo de comprobante "${venta.tipo_comprobante}" no tiene código AFIP WSFE mapeado`);
  }

  const contacto = db.prepare('SELECT * FROM contactos WHERE id = ?').get(venta.contacto_id);
  if (!contacto) throw new Error('Contacto/cliente no encontrado');

  const empIva = db.prepare('SELECT condicion_iva FROM empresa_config WHERE id = 1').get()?.condicion_iva || '';
  validateComprobanteFiscal({
    caracter: venta.caracter || 'fiscal',
    tipoComprobante: venta.tipo_comprobante,
    emisorCondIva: empIva,
    receptorCondIva: contacto.condicion_iva || 'Consumidor Final',
    estado: 'Confirmada',
  });

  const docNroDigits = String(contacto.cuit || '').replace(/\D/g, '');
  let docTipo = AFIP_DOC_TIPO[contacto.tipo_documento] ?? (docNroDigits.length === 11 ? 80 : docNroDigits.length >= 7 ? 96 : 99);
  let docNro = docTipo === 99 ? 0 : (docNroDigits || '0');
  if (docTipo !== 99 && !docNroDigits) {
    docTipo = 99;
    docNro = 0;
  }

  const condIvaId = AFIP_COND_IVA_RECEPTOR[contacto.condicion_iva] || 5;
  const { token, sign, cuit, entorno } = await getAuthToken('wsfe');

  const ultimo = await getUltimoComprobanteAfip(ptoVtaNum, cbteTipo);
  const cbteNro = ultimo + 1;
  const cbteFch = toAfipDate(venta.fecha);

  // Tipos C (11, 12, 13, 15, 211, 212, 213) no discriminan IVA
  const esTipoC = [11, 12, 13, 15, 211, 212, 213].includes(cbteTipo);
  const total = Number(Number(venta.total || 0).toFixed(2));
  const impTrib = Number(Number(venta.otros_impuestos_monto || 0).toFixed(2));

  let impNeto = 0;
  let impIva = 0;
  let impOpEx = 0;
  let ivaXml = '';

  if (esTipoC) {
    impNeto = Number((total - impTrib).toFixed(2));
    impIva = 0;
  } else {
    const lineas = db.prepare('SELECT alicuota_iva, iva_monto, subtotal FROM venta_lineas WHERE venta_id = ?').all(ventaId);
    const porAlic = new Map();
    for (const l of lineas) {
      const rate = Number(l.alicuota_iva || 0);
      const base = Number(l.subtotal || 0);
      const iva = Number(l.iva_monto || 0);
      const prev = porAlic.get(rate) || { base: 0, iva: 0 };
      prev.base += base;
      prev.iva += iva;
      porAlic.set(rate, prev);
    }
    if (porAlic.size === 0) {
      porAlic.set(Number(venta.alicuota_iva || 0), {
        base: Number(venta.neto || 0),
        iva: Number(venta.iva_monto || 0),
      });
    }
    const alicNodes = [];
    for (const [rate, vals] of porAlic.entries()) {
      const baseImp = Number(vals.base.toFixed(2));
      const importe = Number(vals.iva.toFixed(2));
      const id = AFIP_ALIC_IVA_ID[rate] ?? (rate === 0 ? 3 : 5);
      impNeto += baseImp;
      impIva += importe;
      alicNodes.push([
        '            <ar:AlicIva>',
        `              <ar:Id>${id}</ar:Id>`,
        `              <ar:BaseImp>${baseImp.toFixed(2)}</ar:BaseImp>`,
        `              <ar:Importe>${importe.toFixed(2)}</ar:Importe>`,
        '            </ar:AlicIva>',
      ].join('\n'));
    }
    impNeto = Number(impNeto.toFixed(2));
    impIva = Number(impIva.toFixed(2));
    if (alicNodes.length) {
      ivaXml = `          <ar:Iva>\n${alicNodes.join('\n')}\n          </ar:Iva>`;
    }
  }

  // Comprobante asociado para NC / ND
  let cbtesAsocXml = '';
  if ((venta.clase_documento === 'nota_credito' || venta.clase_documento === 'nota_debito') && venta.comprobante_origen_id) {
    const orig = db.prepare('SELECT tipo_comprobante, punto_venta, numero, fecha FROM ventas WHERE id = ?').get(venta.comprobante_origen_id);
    if (orig) {
      const origTipo = AFIP_CBTE_TIPO[orig.tipo_comprobante] || cbteTipo;
      const origPv = parseInt(String(orig.punto_venta || ptoVtaNum).replace(/\D/g, ''), 10) || ptoVtaNum;
      const numMatch = String(orig.numero || '').match(/(\d+)$/);
      const origNro = numMatch ? parseInt(numMatch[1], 10) : 0;
      if (origNro > 0) {
        cbtesAsocXml = [
          '          <ar:CbtesAsoc>',
          '            <ar:CbteAsoc>',
          `              <ar:Tipo>${origTipo}</ar:Tipo>`,
          `              <ar:PtoVta>${origPv}</ar:PtoVta>`,
          `              <ar:Nro>${origNro}</ar:Nro>`,
          `              <ar:CbteFch>${toAfipDate(orig.fecha)}</ar:CbteFch>`,
          '            </ar:CbteAsoc>',
          '          </ar:CbtesAsoc>',
        ].join('\n');
      }
    }
  }

  const envelope = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">',
    '  <soap:Body>',
    '    <ar:FECAESolicitar>',
    '      <ar:Auth>',
    `        <ar:Token>${escXml(token)}</ar:Token>`,
    `        <ar:Sign>${escXml(sign)}</ar:Sign>`,
    `        <ar:Cuit>${escXml(cuit)}</ar:Cuit>`,
    '      </ar:Auth>',
    '      <ar:FeCAEReq>',
    '        <ar:FeCabReq>',
    '          <ar:CantReg>1</ar:CantReg>',
    `          <ar:PtoVta>${ptoVtaNum}</ar:PtoVta>`,
    `          <ar:CbteTipo>${cbteTipo}</ar:CbteTipo>`,
    '        </ar:FeCabReq>',
    '        <ar:FeDetReq>',
    '          <ar:FECAEDetRequest>',
    '            <ar:Concepto>1</ar:Concepto>',
    `            <ar:DocTipo>${docTipo}</ar:DocTipo>`,
    `            <ar:DocNro>${docNro}</ar:DocNro>`,
    `            <ar:CbteDesde>${cbteNro}</ar:CbteDesde>`,
    `            <ar:CbteHasta>${cbteNro}</ar:CbteHasta>`,
    `            <ar:CbteFch>${cbteFch}</ar:CbteFch>`,
    `            <ar:ImpTotal>${total.toFixed(2)}</ar:ImpTotal>`,
    '            <ar:ImpTotConc>0.00</ar:ImpTotConc>',
    `            <ar:ImpNeto>${impNeto.toFixed(2)}</ar:ImpNeto>`,
    `            <ar:ImpOpEx>${impOpEx.toFixed(2)}</ar:ImpOpEx>`,
    `            <ar:ImpTrib>${impTrib.toFixed(2)}</ar:ImpTrib>`,
    `            <ar:ImpIVA>${impIva.toFixed(2)}</ar:ImpIVA>`,
    '            <ar:MonId>PES</ar:MonId>',
    '            <ar:MonCotiz>1</ar:MonCotiz>',
    `            <ar:CondicionIVAReceptorId>${condIvaId}</ar:CondicionIVAReceptorId>`,
    cbtesAsocXml,
    ivaXml,
    '          </ar:FECAEDetRequest>',
    '        </ar:FeDetReq>',
    '      </ar:FeCAEReq>',
    '    </ar:FECAESolicitar>',
    '  </soap:Body>',
    '</soap:Envelope>',
  ].filter(Boolean).join('\n');

  const respXml = await soapPost(
    ENDPOINTS[entorno].wsfe,
    'http://ar.gov.afip.dif.FEV1/FECAESolicitar',
    envelope
  );

  const errs = parseWsfeMessages(respXml, 'Err');
  const obs = parseWsfeMessages(respXml, 'Obs');
  const resultado = extractTag(respXml, 'Resultado');
  const cae = extractTag(respXml, 'CAE');
  const caeFchVto = fromAfipDate(extractTag(respXml, 'CAEFchVto'));

  const pvPad = String(ptoVtaNum).padStart(4, '0');
  const nroPad = String(cbteNro).padStart(8, '0');
  const prefixMatch = String(venta.numero || '').match(/^([A-Z-]+)\s+/);
  const prefix = prefixMatch ? prefixMatch[1] : String(venta.tipo_comprobante || 'FA').replace('-', '');
  const numeroOficial = `${prefix} ${pvPad}-${nroPad}`;

  archiveAfipXml({
    entorno,
    servicio: 'wsfe',
    operacion: 'FECAESolicitar',
    entidadTipo: 'venta',
    entidadId: ventaId,
    referencia: numeroOficial,
    resultado: resultado || 'ERROR',
    cae,
    requestXml: envelope,
    responseXml: respXml,
  });

  if (resultado !== 'A' || !cae) {
    const detail = [...errs, ...obs].map((m) => `[${m.code}] ${m.msg}`).join('; ') || 'Solicitud rechazada por AFIP';
    throw new Error(detail);
  }

  db.prepare(`
    UPDATE ventas
    SET cae = ?, cae_vto = ?, numero = ?, updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `).run(cae, caeFchVto, numeroOficial, ventaId);

  return {
    cae,
    cae_vto: caeFchVto,
    cbte_nro: cbteNro,
    punto_venta: pvPad,
    cbte_tipo: cbteTipo,
    numero: numeroOficial,
    observaciones: obs,
  };
}

// ── WS_SR Padrón (Constancia de Inscripción A5 - getPersona_v2) ────────────

export async function consultarPadronAfip(cuitInput) {
  const cuitPersona = String(cuitInput || '').replace(/\D/g, '');
  if (cuitPersona.length !== 11) {
    throw new Error('Ingresá un CUIT válido de 11 dígitos para consultar el Padrón AFIP');
  }

  const { token, sign, cuit, entorno } = await getAuthToken('ws_sr_constancia_inscripcion');
  const envelope = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:a5="http://a5.soap.ws.server.puc.sr/">',
    '  <soapenv:Header/>',
    '  <soapenv:Body>',
    '    <a5:getPersona_v2>',
    `      <token>${escXml(token)}</token>`,
    `      <sign>${escXml(sign)}</sign>`,
    `      <cuitRepresentada>${escXml(cuit)}</cuitRepresentada>`,
    `      <idPersona>${escXml(cuitPersona)}</idPersona>`,
    '    </a5:getPersona_v2>',
    '  </soapenv:Body>',
    '</soapenv:Envelope>',
  ].join('\n');

  const respXml = await soapPost(ENDPOINTS[entorno].padron, '', envelope);

  const errorConstancia = extractTag(respXml, 'errorConstancia');
  if (errorConstancia) {
    const errMsg = extractTag(errorConstancia, 'error') || 'Sin datos en padrón';
    throw new Error(`Padrón AFIP: ${unescXml(errMsg)}`);
  }

  const datosGen = extractTag(respXml, 'datosGenerales');
  if (!datosGen) {
    throw new Error('No se encontró el contribuyente en el Padrón AFIP');
  }

  const razonSocial = unescXml(extractTag(datosGen, 'razonSocial'));
  const apellido = unescXml(extractTag(datosGen, 'apellido'));
  const nombre = unescXml(extractTag(datosGen, 'nombre'));
  const nombreCompleto = razonSocial || [apellido, nombre].filter(Boolean).join(' ').trim();

  const domFiscal = extractTag(datosGen, 'domicilioFiscal');
  const direccion = unescXml(extractTag(domFiscal, 'direccion'));
  const localidad = unescXml(extractTag(domFiscal, 'localidad'));
  const provincia = unescXml(extractTag(domFiscal, 'descripcionProvincia'));
  const codigoPostal = unescXml(extractTag(domFiscal, 'codPostal'));

  const datosMono = extractTag(respXml, 'datosMonotributo');
  const datosReg = extractTag(respXml, 'datosRegimenGeneral');
  const impuestos = extractAllBlocks(datosReg, 'impuesto').map((b) => ({
    id: parseInt(extractTag(b, 'idImpuesto') || '0', 10),
    desc: unescXml(extractTag(b, 'descripcionImpuesto')),
  }));

  let condicionIva = 'Consumidor Final';
  if (datosMono) {
    condicionIva = 'Monotributo';
  } else if (impuestos.some((i) => i.id === 30)) {
    condicionIva = 'Responsable Inscripto';
  } else if (impuestos.some((i) => i.id === 32)) {
    condicionIva = 'Exento';
  }

  const cuitFmt = `${cuitPersona.slice(0, 2)}-${cuitPersona.slice(2, 10)}-${cuitPersona.slice(10)}`;

  return {
    cuit: cuitFmt,
    cuit_raw: cuitPersona,
    tipo_documento: 'CUIT',
    nombre: nombreCompleto,
    razon_social: nombreCompleto,
    condicion_iva: condicionIva,
    direccion,
    localidad,
    provincia,
    codigo_postal: codigoPostal,
    tipo_persona: extractTag(datosGen, 'tipoPersona'),
    estado_clave: extractTag(datosGen, 'estadoClave'),
  };
}

// ── WSCDC (Constatación de Comprobantes Recibidos) ─────────────────────────

function parseNumeroComprobante(numeroStr, ptoVtaFallback) {
  const s = String(numeroStr || '').trim();
  const m = s.match(/(\d{1,5})\s*-\s*(\d{1,8})$/);
  if (m) {
    return {
      ptoVta: parseInt(m[1], 10),
      cbteNro: parseInt(m[2], 10),
    };
  }
  const digitsOnly = s.match(/(\d{1,8})$/);
  const pv = parseInt(String(ptoVtaFallback || '').replace(/\D/g, ''), 10);
  if (digitsOnly && pv > 0) {
    return { ptoVta: pv, cbteNro: parseInt(digitsOnly[1], 10) };
  }
  throw new Error('El número de comprobante debe incluir punto de venta y número (ej: 0001-00012345)');
}

/**
 * Constata un comprobante recibido ante AFIP (WSCDC - ComprobanteConstatar).
 * @param {{ cuitEmisor: string, tipoComprobante: string, numero: string, puntoVenta?: number|string, fecha: string, total: number, cae: string, cbteModo?: string }} params
 */
export async function constatarComprobanteAfip(params) {
  const cuitEmisor = String(params.cuitEmisor || '').replace(/\D/g, '');
  if (cuitEmisor.length !== 11) {
    throw new Error('El proveedor debe tener un CUIT válido de 11 dígitos para constatar en AFIP');
  }

  const cbteTipo = AFIP_CBTE_TIPO[params.tipoComprobante];
  if (!cbteTipo) {
    throw new Error(`El tipo de comprobante "${params.tipoComprobante}" no tiene código AFIP mapeado`);
  }

  const codAutorizacion = String(params.cae || '').replace(/\s+/g, '');
  if (!/^\d{10,16}$/.test(codAutorizacion)) {
    throw new Error('Ingresá un CAE / CAI / CAEA numérico válido (14 dígitos para CAE)');
  }

  const { ptoVta, cbteNro } = parseNumeroComprobante(params.numero, params.puntoVenta);
  if (!ptoVta || !cbteNro) {
    throw new Error('Punto de venta o número de comprobante inválido para constatar en AFIP');
  }

  const total = Number(Number(params.total || 0).toFixed(2));
  if (!(total > 0)) {
    throw new Error('El importe total del comprobante debe ser mayor a 0');
  }

  const cbteModo = ['CAE', 'CAEA', 'CAI'].includes(String(params.cbteModo || '').toUpperCase())
    ? String(params.cbteModo).toUpperCase()
    : 'CAE';

  const { token, sign, cuit, entorno } = await getAuthToken('wscdc');

  const envelope = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cdc="http://servicios1.afip.gob.ar/wscdc/">',
    '  <soap:Body>',
    '    <cdc:ComprobanteConstatar>',
    '      <cdc:Auth>',
    `        <cdc:Token>${escXml(token)}</cdc:Token>`,
    `        <cdc:Sign>${escXml(sign)}</cdc:Sign>`,
    `        <cdc:Cuit>${escXml(cuit)}</cdc:Cuit>`,
    '      </cdc:Auth>',
    '      <cdc:CmpReq>',
    `        <cdc:CbteModo>${cbteModo}</cdc:CbteModo>`,
    `        <cdc:CuitEmisor>${escXml(cuitEmisor)}</cdc:CuitEmisor>`,
    `        <cdc:PtoVta>${ptoVta}</cdc:PtoVta>`,
    `        <cdc:CbteTipo>${cbteTipo}</cdc:CbteTipo>`,
    `        <cdc:CbteNro>${cbteNro}</cdc:CbteNro>`,
    `        <cdc:CbteFch>${toAfipDate(params.fecha)}</cdc:CbteFch>`,
    `        <cdc:ImpTotal>${total.toFixed(2)}</cdc:ImpTotal>`,
    `        <cdc:CodAutorizacion>${escXml(codAutorizacion)}</cdc:CodAutorizacion>`,
    '        <cdc:DocTipoReceptor>80</cdc:DocTipoReceptor>',
    `        <cdc:DocNroReceptor>${escXml(cuit)}</cdc:DocNroReceptor>`,
    '      </cdc:CmpReq>',
    '    </cdc:ComprobanteConstatar>',
    '  </soap:Body>',
    '</soap:Envelope>',
  ].join('\n');

  const respXml = await soapPost(
    ENDPOINTS[entorno].wscdc,
    'http://servicios1.afip.gob.ar/wscdc/ComprobanteConstatar',
    envelope
  );

  const resultado = extractTag(respXml, 'Resultado');
  const errs = parseWsfeMessages(respXml, 'Err');
  const obs = parseWsfeMessages(respXml, 'Obs');

  archiveAfipXml({
    entorno,
    servicio: 'wscdc',
    operacion: 'ComprobanteConstatar',
    entidadTipo: params.entidadTipo || '',
    entidadId: params.entidadId || null,
    referencia: `${params.tipoComprobante}_${String(ptoVta).padStart(4, '0')}-${String(cbteNro).padStart(8, '0')}`,
    resultado: resultado || 'ERROR',
    cae: codAutorizacion,
    requestXml: envelope,
    responseXml: respXml,
  });

  if (resultado !== 'A') {
    const detail = [...errs, ...obs].map((m) => `[${m.code}] ${m.msg}`).join('; ') || 'Comprobante NO constatado en AFIP';
    throw new Error(detail);
  }

  return {
    constatado: true,
    resultado,
    entorno,
    observaciones: obs,
    obs_texto: obs.map((o) => `[${o.code}] ${o.msg}`).join('; '),
  };
}

export async function constatarCompraAfip(compraId) {
  const compra = db.prepare('SELECT * FROM compras WHERE id = ?').get(compraId);
  if (!compra) throw new Error('Compra no encontrada');
  if (compra.caracter !== 'fiscal') {
    throw new Error('Solo las compras fiscales pueden constatarse en AFIP (WSCDC)');
  }
  const prov = db.prepare('SELECT cuit, nombre FROM contactos WHERE id = ?').get(compra.contacto_id);
  if (!prov) throw new Error('Proveedor no encontrado');

  try {
    const res = await constatarComprobanteAfip({
      cuitEmisor: prov.cuit,
      tipoComprobante: compra.tipo_comprobante,
      numero: compra.numero,
      puntoVenta: compra.punto_venta,
      fecha: compra.fecha,
      total: compra.total,
      cae: compra.cae,
      entidadTipo: 'compra',
      entidadId: compraId,
    });
    const fechaNow = new Date().toISOString().slice(0, 19).replace('T', ' ');
    db.prepare(`
      UPDATE compras
      SET afip_constatado = 1, afip_constatado_fecha = ?, afip_constatado_obs = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(fechaNow, res.obs_texto || '', compraId);
    return { ...res, fecha: fechaNow };
  } catch (err) {
    db.prepare(`
      UPDATE compras
      SET afip_constatado = 0, afip_constatado_obs = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(String(err.message || '').slice(0, 500), compraId);
    throw err;
  }
}

// ── Archivado de XML originales AFIP (Disco + SQLite) ──────────────────────

function sanitizeFilePart(v) {
  return String(v || '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'doc';
}

export function archiveAfipXml({
  entorno = 'homologacion',
  servicio = 'wsfe',
  operacion = '',
  entidadTipo = '',
  entidadId = null,
  referencia = '',
  resultado = '',
  cae = '',
  requestXml = '',
  responseXml = '',
}) {
  const now = new Date();
  const yyyyMm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const envFolder = entorno === 'produccion' ? 'produccion' : 'homologacion';
  const relDir = path.join('afip_xml', envFolder, yyyyMm);
  const absDir = path.join(DB_DIR, relDir);

  fs.mkdirSync(absDir, { recursive: true });

  const baseName = `${stamp}_${sanitizeFilePart(servicio)}_${sanitizeFilePart(operacion)}_${sanitizeFilePart(referencia)}`;
  const reqRel = path.join(relDir, `${baseName}_req.xml`).replace(/\\/g, '/');
  const resRel = path.join(relDir, `${baseName}_res.xml`).replace(/\\/g, '/');

  if (requestXml) fs.writeFileSync(path.join(DB_DIR, reqRel), requestXml, 'utf8');
  if (responseXml) fs.writeFileSync(path.join(DB_DIR, resRel), responseXml, 'utf8');

  const info = db.prepare(`
    INSERT INTO afip_xml_logs (
      entorno, servicio, operacion, entidad_tipo, entidad_id, referencia,
      resultado, cae, archivo_req, archivo_res, request_xml, response_xml
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    envFolder,
    servicio,
    operacion,
    entidadTipo || '',
    entidadId ? Number(entidadId) : null,
    referencia || '',
    resultado || '',
    cae || '',
    requestXml ? reqRel : '',
    responseXml ? resRel : '',
    requestXml || '',
    responseXml || ''
  );

  return { id: Number(info.lastInsertRowid), archivo_req: reqRel, archivo_res: resRel };
}

export function listAfipXmlLogs({ entidad_tipo, entidad_id, entorno } = {}) {
  const where = [];
  const args = [];
  if (entidad_tipo) { where.push('entidad_tipo = ?'); args.push(entidad_tipo); }
  if (entidad_id) { where.push('entidad_id = ?'); args.push(Number(entidad_id)); }
  if (entorno) { where.push('entorno = ?'); args.push(entorno); }
  const sqlWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db.prepare(`
    SELECT id, entorno, servicio, operacion, entidad_tipo, entidad_id, referencia,
           resultado, cae, archivo_req, archivo_res, created_at
    FROM afip_xml_logs
    ${sqlWhere}
    ORDER BY id DESC
    LIMIT 100
  `).all(...args);
}

export function getAfipXmlLogById(id) {
  return db.prepare('SELECT * FROM afip_xml_logs WHERE id = ?').get(Number(id));
}
