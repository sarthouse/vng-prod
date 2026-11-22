import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

import { initDb, runWithDatabase, closeConnection, getDbPath } from '../src/db.js';
import { MODELS } from '../src/db/models.js';
import { BaseRepository } from '../src/core/BaseRepository.js';
import * as contactoSvc from '../src/services/comercial/contactoService.js';
import * as ventaSvc from '../src/services/comercial/ventaService.js';
import { signLoginTicketRequest, parseCertificateInfo } from '../src/services/afip/afipCrypto.js';
import * as afipSvc from '../src/services/afip/afipService.js';

const empresaRepo = new BaseRepository({ model: MODELS.empresa_config });
const puntoVentaRepo = new BaseRepository({ model: MODELS.puntos_venta });
const ventaRepo = new BaseRepository({ model: MODELS.ventas });

async function withIsolatedDb(fn) {
  const dbName = `test_afip_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  initDb(dbName);
  try {
    return await runWithDatabase(dbName, () => fn());
  } finally {
    closeConnection(dbName);
    fs.rmSync(getDbPath(dbName), { force: true });
  }
}

// Generador mínimo de certificado X.509 v3 autofirmado en PEM para pruebas locales sin OpenSSL
function derLen(len) {
  if (len < 128) return Buffer.from([len]);
  const bytes = [];
  let n = len;
  while (n > 0) { bytes.unshift(n & 0xff); n >>>= 8; }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
function derTag(tag, ...parts) {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), derLen(body.length), body]);
}
const derSeq = (...p) => derTag(0x30, ...p);
const derSet = (...p) => derTag(0x31, ...p);
const derCtx = (n, ...p) => derTag(0xa0 | n, ...p);
const derInt = (n) => derTag(0x02, Buffer.from([n]));
const derNull = () => Buffer.from([0x05, 0x00]);
const derBitString = (buf) => derTag(0x03, Buffer.from([0x00]), buf);
const derUtf8 = (s) => derTag(0x0c, Buffer.from(s, 'utf8'));
function derOid(oid) {
  const a = oid.split('.').map(Number);
  const out = [40 * a[0] + a[1]];
  for (let i = 2; i < a.length; i++) {
    let v = a[i];
    if (v < 128) out.push(v);
    else {
      const tmp = [];
      while (v > 0) { tmp.unshift((v & 0x7f) | (tmp.length ? 0x80 : 0)); v >>>= 7; }
      out.push(...tmp);
    }
  }
  return derTag(0x06, Buffer.from(out));
}
function derUtc(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const s = String(date.getUTCFullYear()).slice(-2)
    + pad(date.getUTCMonth() + 1) + pad(date.getUTCDate())
    + pad(date.getUTCHours()) + pad(date.getUTCMinutes()) + pad(date.getUTCSeconds()) + 'Z';
  return derTag(0x17, Buffer.from(s, 'ascii'));
}
function createTestCertAndKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const sigAlg = derSeq(derOid('1.2.840.113549.1.1.11'), derNull());
  const name = derSeq(derSet(derSeq(derOid('2.5.4.3'), derUtf8('Vanguard Test AFIP'))));
  const now = new Date();
  const future = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  const tbs = derSeq(
    derCtx(0, derInt(2)),
    derInt(1),
    sigAlg,
    name,
    derSeq(derUtc(now), derUtc(future)),
    name,
    publicKey
  );
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(tbs);
  const sig = signer.sign(privateKey);
  const certDer = derSeq(tbs, sigAlg, derBitString(sig));
  const certPem = `-----BEGIN CERTIFICATE-----\n${certDer.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
  return { certPem, privateKeyPem: privateKey };
}

function makeSoapResponse(xmlBody) {
  return {
    ok: true,
    status: 200,
    async text() {
      return xmlBody;
    },
  };
}

test('afipCrypto genera firma CMS/PKCS#7 válida sobre TRA XML y parsea metadatos del certificado', () => {
  const { certPem, privateKeyPem } = createTestCertAndKey();
  const info = parseCertificateInfo(certPem);
  assert.ok(info.subject.includes('Vanguard Test AFIP'));
  assert.equal(info.vigente, true);

  const uniqueId = 1700000123;
  const genTime = new Date(Date.now() - 60_000).toISOString();
  const expTime = new Date(Date.now() + 3600_000).toISOString();
  const traXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<loginTicketRequest version="1.0">',
    '  <header>',
    `    <uniqueId>${uniqueId}</uniqueId>`,
    `    <generationTime>${genTime}</generationTime>`,
    `    <expirationTime>${expTime}</expirationTime>`,
    '  </header>',
    '  <service>wsfe</service>',
    '</loginTicketRequest>',
  ].join('\n');

  const cmsBase64 = signLoginTicketRequest(traXml, certPem, privateKeyPem);
  const cmsBuf = Buffer.from(cmsBase64, 'base64');
  // Debe ser un SEQUENCE ASN.1 (0x30) conteniendo el OID de PKCS#7 SignedData y el XML TRA
  assert.equal(cmsBuf[0], 0x30);
  assert.ok(cmsBuf.includes(Buffer.from('<loginTicketRequest', 'utf8')));
});

test('WSAA getAuthToken parsea token/sign, persiste en caché y reutiliza sin re-llamar mientras esté vigente', async () => {
  await withIsolatedDb(async () => {
    const { certPem, privateKeyPem } = createTestCertAndKey();
    empresaRepo.update(1, {
      cuit: '30-71234567-9',
      afip_entorno: 'homologacion',
      afip_crt: certPem,
      afip_private_key: privateKeyPem,
      afip_ta_wsfe: '',
    });

    const expFuture = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
    let wsaaCalls = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      wsaaCalls++;
      assert.ok(String(url).includes('wsaahomo.afip.gov.ar'));
      assert.ok(String(opts.body).includes('<wsaa:loginCms>'));
      const inner = `<loginTicketResponse><credentials><token>TOK-123</token><sign>SIG-456</sign></credentials><header><expirationTime>${expFuture}</expirationTime></header></loginTicketResponse>`
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return makeSoapResponse(`<soapenv:Envelope><soapenv:Body><loginCmsResponse><loginCmsReturn>${inner}</loginCmsReturn></loginCmsResponse></soapenv:Body></soapenv:Envelope>`);
    };

    try {
      const auth1 = await afipSvc.getAuthToken('wsfe');
      assert.equal(auth1.token, 'TOK-123');
      assert.equal(auth1.sign, 'SIG-456');
      assert.equal(wsaaCalls, 1);

      // Segundo llamado debe usar el caché en empresa.afip_ta_wsfe sin llamar a fetch
      const auth2 = await afipSvc.getAuthToken('wsfe');
      assert.equal(auth2.token, 'TOK-123');
      assert.equal(auth2.sign, 'SIG-456');
      assert.equal(wsaaCalls, 1);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

test('WSFEv1 emitirFacturaAfip aprueba CAE, maneja rechazo Resultado=R y constatarComprobanteAfip valida WSCDC', async () => {
  await withIsolatedDb(async () => {
    const { certPem, privateKeyPem } = createTestCertAndKey();
    const expFuture = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
    const cachedTa = JSON.stringify({
      entorno: 'homologacion',
      token: 'TOK-CACHED',
      sign: 'SIG-CACHED',
      expirationTime: expFuture,
    });

    empresaRepo.update(1, {
      cuit: '30-71234567-9',
      condicion_iva: 'Responsable Inscripto',
      afip_entorno: 'homologacion',
      afip_crt: certPem,
      afip_private_key: privateKeyPem,
      afip_ta_wsfe: cachedTa,
      afip_ta_wscdc: cachedTa,
    });

    const pv = puntoVentaRepo.query().where('numero', 1).get();
    if (pv) puntoVentaRepo.update(pv.id, { es_electronica: 1, activo: 1 });
    else puntoVentaRepo.create({ numero: 1, nombre: 'PV 0001', es_electronica: 1, activo: 1 });

    const cliId = contactoSvc.createContacto({
      nombre: 'Cliente Fiscal SA',
      tipo_documento: 'CUIT',
      cuit: '30-70999888-1',
      condicion_iva: 'Responsable Inscripto',
      es_cliente: 1,
    });

    const v1Id = ventaSvc.createVenta({
      contacto_id: cliId,
      caracter: 'fiscal',
      tipo_comprobante: 'FA-A',
      punto_venta: '0001',
      fecha: '2026-11-20',
      lineas: [{ descripcion: 'Producto A', cantidad: 1, precio_unitario: 1000, alicuota_iva: 21 }],
    });

    const v2Id = ventaSvc.createVenta({
      contacto_id: cliId,
      caracter: 'fiscal',
      tipo_comprobante: 'FA-A',
      punto_venta: '0001',
      fecha: '2026-11-20',
      lineas: [{ descripcion: 'Producto B', cantidad: 1, precio_unitario: 500, alicuota_iva: 21 }],
    });

    let rejectNext = false;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      const body = String(opts?.body || '');
      if (body.includes('FECompUltimoAutorizado')) {
        return makeSoapResponse('<soap:Envelope><soap:Body><FECompUltimoAutorizadoResponse><FECompUltimoAutorizadoResult><CbteNro>41</CbteNro></FECompUltimoAutorizadoResult></FECompUltimoAutorizadoResponse></soap:Body></soap:Envelope>');
      }
      if (body.includes('FECAESolicitar')) {
        if (rejectNext) {
          return makeSoapResponse('<soap:Envelope><soap:Body><FECAESolicitarResponse><FECAESolicitarResult><FeCabResp><Resultado>R</Resultado></FeCabResp><Errors><Err><Code>10016</Code><Msg>El numero o fecha del comprobante no se corresponde con el proximo a autorizar</Msg></Err></Errors></FECAESolicitarResult></FECAESolicitarResponse></soap:Body></soap:Envelope>');
        }
        return makeSoapResponse('<soap:Envelope><soap:Body><FECAESolicitarResponse><FECAESolicitarResult><FeCabResp><Resultado>A</Resultado></FeCabResp><FeDetResp><FECAEDetResponse><Resultado>A</Resultado><CAE>74451234567890</CAE><CAEFchVto>20261130</CAEFchVto><CbteDesde>42</CbteDesde></FECAEDetResponse></FeDetResp></FECAESolicitarResult></FECAESolicitarResponse></soap:Body></soap:Envelope>');
      }
      if (body.includes('ComprobanteConstatar')) {
        assert.ok(String(url).includes('wswhomo.afip.gov.ar/wscdc'));
        return makeSoapResponse('<soap:Envelope><soap:Body><ComprobanteConstatarResponse><ComprobanteConstatarResult><Resultado>A</Resultado></ComprobanteConstatarResult></ComprobanteConstatarResponse></soap:Body></soap:Envelope>');
      }
      throw new Error(`Fetch inesperado en test AFIP: ${url}`);
    };

    try {
      // 1) Emisión aprobada (Resultado = 'A')
      const resOk = await afipSvc.emitirFacturaAfip(v1Id);
      assert.equal(resOk.cae, '74451234567890');
      assert.equal(resOk.cae_vto, '2026-11-30');
      const v1Saved = ventaRepo.findById(v1Id);
      assert.equal(v1Saved.cae, '74451234567890');
      assert.equal(v1Saved.cae_vto, '2026-11-30');

      // 2) Emisión rechazada (Resultado = 'R')
      rejectNext = true;
      await assert.rejects(
        () => afipSvc.emitirFacturaAfip(v2Id),
        /10016|proximo a autorizar/i
      );
      const v2Saved = ventaRepo.findById(v2Id);
      assert.equal(v2Saved.cae, '');

      // 3) Constatación de comprobante (WSCDC)
      const constRes = await afipSvc.constatarComprobanteAfip({
        cuitEmisor: '30-71234567-9',
        tipoComprobante: 'FA-A',
        puntoVenta: '0001',
        numero: '0001-00000042',
        fecha: '2026-11-20',
        total: 1210,
        cae: '74451234567890',
      });
      assert.equal(constRes.resultado, 'A');
      assert.equal(constRes.constatado, true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
