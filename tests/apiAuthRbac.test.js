import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Readable } from 'node:stream';

import { initDb, runWithDatabase, closeConnection, getDbPath } from '../src/db.js';
import { ENV } from '../src/config/env.js';
import { handleApi } from '../src/routes/api.js';
import * as authSvc from '../src/services/auth/authService.js';

async function withIsolatedDb(fn) {
  const dbName = `test_rbac_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  initDb(dbName);
  try {
    return await runWithDatabase(dbName, () => fn(dbName));
  } finally {
    closeConnection(dbName);
    fs.rmSync(getDbPath(dbName), { force: true });
  }
}

function createMockReq({ method = 'GET', url = '/', headers = {}, body = null, rawBody = null } = {}) {
  let chunks = [];
  if (rawBody !== null) {
    chunks = [Buffer.from(String(rawBody), 'utf8')];
  } else if (body !== null && body !== undefined) {
    chunks = [Buffer.from(JSON.stringify(body), 'utf8')];
  }
  const req = Readable.from(chunks);
  req.method = method;
  req.url = url;
  req.headers = { host: 'localhost:3000', ...headers };
  req.socket = { remoteAddress: '127.0.0.1' };
  return req;
}

function createMockRes() {
  const headers = {};
  const res = {
    statusCode: 200,
    headers,
    bodyText: '',
    jsonBody: null,
    writableEnded: false,
    setHeader(k, v) {
      headers[String(k).toLowerCase()] = v;
    },
    getHeader(k) {
      return headers[String(k).toLowerCase()];
    },
    writeHead(status, hdrs = {}) {
      this.statusCode = status;
      for (const [k, v] of Object.entries(hdrs)) {
        this.setHeader(k, v);
      }
    },
    end(chunk = '') {
      if (chunk) this.bodyText += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      try {
        this.jsonBody = this.bodyText ? JSON.parse(this.bodyText) : null;
      } catch {
        this.jsonBody = null;
      }
      this.writableEnded = true;
    },
  };
  return res;
}

async function callApi({ method = 'GET', path = '/', headers = {}, body = null, rawBody = null } = {}) {
  const req = createMockReq({ method, url: path, headers, body, rawBody });
  const res = createMockRes();
  await handleApi(req, res, path);
  return res;
}

function extractCookieHeader(res, name = 'calc_sid') {
  const raw = res.getHeader('set-cookie');
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const match = list.find(c => String(c).startsWith(`${name}=`));
  if (!match) return '';
  return String(match).split(';')[0];
}

test('API rechaza con 401 Unauthorized endpoints protegidos sin cookie de sesión válida', async () => {
  await withIsolatedDb(async () => {
    authSvc.setupInitialAdmin({ username: 'admin', nombre: 'Admin', password: 'Password123!' });

    for (const [method, path] of [
      ['GET', '/api/ventas'],
      ['GET', '/api/contabilidad/asientos'],
      ['GET', '/api/woo/config'],
    ]) {
      const res = await callApi({ method, path });
      assert.equal(res.statusCode, 401, `${method} ${path} debe devolver 401`);
    }
  });
});

test('Flujo completo de login, cookie firmada calc_sid, acceso autorizado y logout', async () => {
  await withIsolatedDb(async () => {
    authSvc.setupInitialAdmin({ username: 'admin_login', nombre: 'Admin Login', password: 'Password123!' });

    const loginRes = await callApi({
      method: 'POST',
      path: '/api/auth/login',
      body: { username: 'admin_login', password: 'Password123!' },
    });
    assert.equal(loginRes.statusCode, 200);
    assert.equal(loginRes.jsonBody?.user?.username, 'admin_login');

    const cookie = extractCookieHeader(loginRes, 'calc_sid');
    assert.ok(cookie.startsWith('calc_sid=') && cookie.length > 20);

    const ventasRes = await callApi({
      method: 'GET',
      path: '/api/ventas',
      headers: { cookie },
    });
    assert.equal(ventasRes.statusCode, 200);
    assert.ok(Array.isArray(ventasRes.jsonBody));

    const wooCfgRes = await callApi({
      method: 'GET',
      path: '/api/woo/config',
      headers: { cookie },
    });
    assert.equal(wooCfgRes.statusCode, 200);
    assert.equal(typeof wooCfgRes.jsonBody?.meta_key_dni, 'string');

    const logoutRes = await callApi({
      method: 'POST',
      path: '/api/auth/logout',
      headers: { cookie },
    });
    assert.equal(logoutRes.statusCode, 200);

    const afterLogout = await callApi({
      method: 'GET',
      path: '/api/ventas',
      headers: { cookie },
    });
    assert.equal(afterLogout.statusCode, 401);
  });
});

test('Matriz RBAC: usuario con solo comercial.ver accede a GET /api/ventas y recibe 403 en otros permisos', async () => {
  await withIsolatedDb(async () => {
    authSvc.setupInitialAdmin({ username: 'admin_rbac', nombre: 'Admin', password: 'Password123!' });

    const grupoId = authSvc.createGrupo({
      nombre: 'Solo Lectura Comercial',
      permisos: ['comercial.ver'],
    });
    authSvc.createUsuario({
      username: 'vendedor_readonly',
      nombre: 'Vendedor Lectura',
      password: 'UserPass123!',
      grupo_id: grupoId,
      activo: 1,
    });

    const loginRes = await callApi({
      method: 'POST',
      path: '/api/auth/login',
      body: { username: 'vendedor_readonly', password: 'UserPass123!' },
    });
    assert.equal(loginRes.statusCode, 200);
    const cookie = extractCookieHeader(loginRes, 'calc_sid');

    const okGet = await callApi({ method: 'GET', path: '/api/ventas', headers: { cookie } });
    assert.equal(okGet.statusCode, 200);

    const deniedWrite = await callApi({
      method: 'POST',
      path: '/api/ventas',
      headers: { cookie },
      body: { contacto_id: 1 },
    });
    assert.equal(deniedWrite.statusCode, 403);

    const deniedContab = await callApi({
      method: 'GET',
      path: '/api/contabilidad/asientos',
      headers: { cookie },
    });
    assert.equal(deniedContab.statusCode, 403);

    const deniedWooCfg = await callApi({
      method: 'PUT',
      path: '/api/woo/config',
      headers: { cookie },
      body: { activo: 1 },
    });
    assert.equal(deniedWooCfg.statusCode, 403);
  });
});

test('dbRoutes protege gestión de bases con master_key (403 sin clave, 200 con clave correcta)', async () => {
  const prevMaster = ENV.DB_MASTER_KEY;
  ENV.DB_MASTER_KEY = 'test-master-secret-key';
  try {
    await withIsolatedDb(async () => {
      const deniedList = await callApi({ method: 'GET', path: '/api/databases' });
      assert.equal(deniedList.statusCode, 403);

      const deniedUnlock = await callApi({
        method: 'POST',
        path: '/api/databases/unlock',
        body: { master_key: 'wrong-key' },
      });
      assert.equal(deniedUnlock.statusCode, 403);

      const okUnlock = await callApi({
        method: 'POST',
        path: '/api/databases/unlock',
        body: { master_key: 'test-master-secret-key' },
      });
      assert.equal(okUnlock.statusCode, 200);
      assert.equal(okUnlock.jsonBody?.ok, true);
      assert.ok(Array.isArray(okUnlock.jsonBody?.databases));

      const mgrCookie = extractCookieHeader(okUnlock, 'calc_db_mgr');
      const okList = await callApi({
        method: 'GET',
        path: '/api/databases',
        headers: { cookie: mgrCookie },
      });
      assert.equal(okList.statusCode, 200);
    });
  } finally {
    ENV.DB_MASTER_KEY = prevMaster;
  }
});

test('Validación de entrada: JSON malformado devuelve 400 y ruta inexistente devuelve 404', async () => {
  await withIsolatedDb(async () => {
    authSvc.setupInitialAdmin({ username: 'admin_val', nombre: 'Admin Val', password: 'Password123!' });
    const loginRes = await callApi({
      method: 'POST',
      path: '/api/auth/login',
      body: { username: 'admin_val', password: 'Password123!' },
    });
    const cookie = extractCookieHeader(loginRes, 'calc_sid');

    const badJsonRes = await callApi({
      method: 'POST',
      path: '/api/ventas',
      headers: { cookie, 'content-type': 'application/json' },
      rawBody: '{malformed-json:',
    });
    assert.equal(badJsonRes.statusCode, 400);

    const notFoundRes = await callApi({
      method: 'GET',
      path: '/api/ruta-que-no-existe',
      headers: { cookie },
    });
    assert.equal(notFoundRes.statusCode, 404);
  });
});
