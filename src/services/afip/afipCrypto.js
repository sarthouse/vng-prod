import crypto from 'node:crypto';

// ── Primitivas ASN.1 / DER ─────────────────────────────────────────────────

function derLen(len) {
  if (len < 128) return Buffer.from([len]);
  const bytes = [];
  let n = len;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derTag(tag, ...parts) {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), derLen(body.length), body]);
}

const derSeq = (...parts) => derTag(0x30, ...parts);
const derSet = (...parts) => derTag(0x31, ...parts);
const derCtx = (n, constructed, ...parts) => derTag((constructed ? 0xa0 : 0x80) | n, ...parts);
const derOctet = (buf) => derTag(0x04, buf);
const derNull = () => Buffer.from([0x05, 0x00]);
const derBitString = (buf) => derTag(0x03, Buffer.from([0x00]), buf);
const derUtf8 = (str) => derTag(0x0c, Buffer.from(str, 'utf8'));
const derPrintable = (str) => derTag(0x13, Buffer.from(str, 'ascii'));

function derInt(val) {
  let buf;
  if (Buffer.isBuffer(val)) {
    buf = val;
    while (buf.length > 1 && buf[0] === 0 && (buf[1] & 0x80) === 0) {
      buf = buf.subarray(1);
    }
    if (buf.length === 0) buf = Buffer.from([0]);
    if (buf[0] & 0x80) buf = Buffer.concat([Buffer.from([0x00]), buf]);
  } else {
    let n = Number(val);
    if (n === 0) return Buffer.from([0x02, 0x01, 0x00]);
    const bytes = [];
    while (n > 0) {
      bytes.unshift(n & 0xff);
      n = Math.floor(n / 256);
    }
    if (bytes[0] & 0x80) bytes.unshift(0x00);
    buf = Buffer.from(bytes);
  }
  return derTag(0x02, buf);
}

function derOid(oid) {
  const arcs = oid.split('.').map(Number);
  const out = [40 * arcs[0] + arcs[1]];
  for (let i = 2; i < arcs.length; i++) {
    let v = arcs[i];
    if (v < 128) {
      out.push(v);
    } else {
      const tmp = [];
      while (v > 0) {
        tmp.unshift((v & 0x7f) | (tmp.length ? 0x80 : 0));
        v >>>= 7;
      }
      out.push(...tmp);
    }
  }
  return derTag(0x06, Buffer.from(out));
}

function derUtcTime(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const yy = String(date.getUTCFullYear()).slice(-2);
  const s = yy + pad(date.getUTCMonth() + 1) + pad(date.getUTCDate())
    + pad(date.getUTCHours()) + pad(date.getUTCMinutes()) + pad(date.getUTCSeconds()) + 'Z';
  return derTag(0x17, Buffer.from(s, 'ascii'));
}

function toPem(label, derBuf) {
  const b64 = derBuf.toString('base64');
  const lines = b64.match(/.{1,64}/g) || [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

// ── Lector mínimo ASN.1 DER para extraer Issuer y SerialNumber del X.509 ──

function readTlv(buf, offset) {
  const tag = buf[offset];
  let pos = offset + 1;
  let len = buf[pos++];
  if (len & 0x80) {
    const numBytes = len & 0x7f;
    len = 0;
    for (let i = 0; i < numBytes; i++) len = (len << 8) | buf[pos++];
  }
  const start = offset;
  const end = pos + len;
  return { tag, headerEnd: pos, start, end, value: buf.subarray(pos, end), raw: buf.subarray(start, end) };
}

function extractCertIssuerAndSerial(certDer) {
  const certSeq = readTlv(certDer, 0);
  const tbsSeq = readTlv(certDer, certSeq.headerEnd);
  let pos = tbsSeq.headerEnd;

  let tlv = readTlv(certDer, pos);
  if (tlv.tag === 0xa0) {
    // [0] EXPLICIT version opcional
    pos = tlv.end;
    tlv = readTlv(certDer, pos);
  }
  // serialNumber (INTEGER 0x02)
  const serialRaw = tlv.raw;
  pos = tlv.end;

  // signature AlgorithmIdentifier (SEQUENCE)
  const sigAlg = readTlv(certDer, pos);
  pos = sigAlg.end;

  // issuer (Name SEQUENCE)
  const issuer = readTlv(certDer, pos);
  return { issuerRaw: issuer.raw, serialRaw };
}

// ── OIDs comunes ───────────────────────────────────────────────────────────

const OID_C = '2.5.4.6';
const OID_O = '2.5.4.10';
const OID_CN = '2.5.4.3';
const OID_SERIAL = '2.5.4.5';
const OID_SHA256_RSA = '1.2.840.113549.1.1.11';
const OID_RSA_ENC = '1.2.840.113549.1.1.1';
const OID_SHA256 = '2.16.840.1.101.3.4.2.1';
const OID_PKCS7_DATA = '1.2.840.113549.1.7.1';
const OID_PKCS7_SIGNED = '1.2.840.113549.1.7.2';
const OID_ATTR_CONTENT_TYPE = '1.2.840.113549.1.9.3';
const OID_ATTR_MSG_DIGEST = '1.2.840.113549.1.9.4';
const OID_ATTR_SIGNING_TIME = '1.2.840.113549.1.9.5';

// ── API pública ────────────────────────────────────────────────────────────

/**
 * Genera un par de claves RSA 2048 y un CSR PKCS#10 válido para AFIP / ARCA.
 * @param {{ cuit: string, razonSocial: string, cn?: string }} opts
 * @returns {{ privateKeyPem: string, csrPem: string }}
 */
export function generateKeyAndCsr({ cuit, razonSocial, cn = 'vanguard' }) {
  const cuitDigits = String(cuit || '').replace(/\D/g, '');
  if (cuitDigits.length !== 11) {
    throw new Error('El CUIT de la empresa debe tener 11 dígitos para generar el CSR de AFIP');
  }
  const org = String(razonSocial || '').trim() || `CUIT ${cuitDigits}`;
  const commonName = String(cn || 'vanguard').trim();

  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const rdn = (oid, valNode) => derSet(derSeq(derOid(oid), valNode));
  const subject = derSeq(
    rdn(OID_C, derPrintable('AR')),
    rdn(OID_O, derUtf8(org)),
    rdn(OID_CN, derUtf8(commonName)),
    rdn(OID_SERIAL, derPrintable(`CUIT ${cuitDigits}`))
  );

  const certReqInfo = derSeq(
    derInt(0),
    subject,
    publicKey,
    Buffer.from([0xa0, 0x00]) // attributes [0] IMPLICIT vacío
  );

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(certReqInfo);
  const signature = signer.sign(privateKey);

  const sigAlg = derSeq(derOid(OID_SHA256_RSA), derNull());
  const csrDer = derSeq(certReqInfo, sigAlg, derBitString(signature));

  return {
    privateKeyPem: privateKey,
    csrPem: toPem('CERTIFICATE REQUEST', csrDer),
  };
}

/**
 * Firma un LoginTicketRequest XML de WSAA generando un CMS / PKCS#7 SignedData (DER base64).
 * @param {string} traXml
 * @param {string} certPem
 * @param {string} keyPem
 * @returns {string} CMS en base64 listo para enviar en loginCms
 */
export function signLoginTicketRequest(traXml, certPem, keyPem) {
  if (!certPem || !keyPem) {
    throw new Error('Falta configurar el certificado (.crt) o la clave privada para firmar WSAA');
  }
  const x509 = new crypto.X509Certificate(certPem);
  const certDer = x509.raw;
  const { issuerRaw, serialRaw } = extractCertIssuerAndSerial(certDer);

  const contentBuf = Buffer.from(traXml, 'utf8');
  const digest = crypto.createHash('sha256').update(contentBuf).digest();

  const attrContentType = derSeq(derOid(OID_ATTR_CONTENT_TYPE), derSet(derOid(OID_PKCS7_DATA)));
  const attrSigningTime = derSeq(derOid(OID_ATTR_SIGNING_TIME), derSet(derUtcTime(new Date())));
  const attrMsgDigest = derSeq(derOid(OID_ATTR_MSG_DIGEST), derSet(derOctet(digest)));

  // En DER, los elementos de un SET OF se ordenan lexicográficamente
  const attrs = [attrContentType, attrMsgDigest, attrSigningTime].sort(Buffer.compare);
  const signedAttrsSet = derSet(...attrs);
  const signedAttrsImplicit = derCtx(0, true, ...attrs);

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signedAttrsSet);
  const signature = signer.sign(keyPem);

  const sha256Alg = derSeq(derOid(OID_SHA256), derNull());
  const rsaAlg = derSeq(derOid(OID_RSA_ENC), derNull());

  const signerInfo = derSeq(
    derInt(1),
    derSeq(issuerRaw, serialRaw),
    sha256Alg,
    signedAttrsImplicit,
    rsaAlg,
    derOctet(signature)
  );

  const encapContentInfo = derSeq(
    derOid(OID_PKCS7_DATA),
    derCtx(0, true, derOctet(contentBuf))
  );

  const signedData = derSeq(
    derInt(1),
    derSet(sha256Alg),
    encapContentInfo,
    derCtx(0, true, certDer),
    derSet(signerInfo)
  );

  const contentInfo = derSeq(
    derOid(OID_PKCS7_SIGNED),
    derCtx(0, true, signedData)
  );

  return contentInfo.toString('base64');
}

/**
 * Extrae metadatos legibles de un certificado X.509 PEM (.crt).
 * @param {string} crtPem
 */
export function parseCertificateInfo(crtPem) {
  if (!crtPem || !String(crtPem).trim()) return null;
  const x509 = new crypto.X509Certificate(crtPem);
  const validToMs = Date.parse(x509.validTo);
  return {
    subject: x509.subject,
    issuer: x509.issuer,
    serialNumber: x509.serialNumber,
    validFrom: x509.validFrom,
    validTo: x509.validTo,
    fingerprint256: x509.fingerprint256,
    vigente: Number.isFinite(validToMs) ? Date.now() <= validToMs : true,
  };
}
