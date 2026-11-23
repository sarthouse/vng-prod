import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Readable } from 'node:stream';

import { initDb, runWithDatabase, closeConnection, getDbPath } from '../src/db.js';
import { MODELS } from '../src/db/models.js';
import { BaseRepository } from '../src/core/BaseRepository.js';
import { handleApi } from '../src/routes/api.js';
import * as authSvc from '../src/services/auth/authService.js';
import * as cfSvc from '../src/services/config/customFieldService.js';
import * as contactoSvc from '../src/services/comercial/contactoService.js';

async function withIsolatedDb(fn) {
  const dbName = `test_cf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  initDb(dbName);
  try {
    return await runWithDatabase(dbName, () => fn(dbName));
  } finally {
    closeConnection(dbName);
    for (const ext of ['', '-shm', '-wal']) {
      fs.rmSync(`${getDbPath(dbName)}${ext}`, { force: true });
    }
  }
}

function createMockReq({ method = 'GET', url = '/', headers = {}, body = null } = {}) {
  const chunks = body !== null && body !== undefined ? [Buffer.from(JSON.stringify(body), 'utf8')] : [];
  const req = Readable.from(chunks);
  req.method = method;
  req.url = url;
  req.headers = { host: 'localhost:3000', ...headers };
  req.socket = { remoteAddress: '127.0.0.1' };
  return req;
}

function createMockRes() {
  const headers = {};
  return {
    statusCode: 200,
    headers,
    jsonBody: null,
    setHeader(k, v) { headers[String(k).toLowerCase()] = v; },
    getHeader(k) { return headers[String(k).toLowerCase()]; },
    writeHead(status, hdrs = {}) {
      this.statusCode = status;
      for (const [k, v] of Object.entries(hdrs)) this.setHeader(k, v);
    },
    end(chunk = '') {
      const txt = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
      try { this.jsonBody = txt ? JSON.parse(txt) : null; } catch { this.jsonBody = null; }
    },
  };
}

test('Campos Personalizados: colisiones con MODELS, validación tipada/requeridos, merge parcial y QueryBuilder.whereJson', async () => {
  await withIsolatedDb(async () => {
    // 1. Rechazo por colisión con columnas nativas o de sistema
    assert.throws(
      () => cfSvc.createCustomFieldDef({ entidad: 'contactos', nombre_tecnico: 'cuit', etiqueta: 'CUIT', tipo: 'text' }),
      /colisiona con una columna nativa/i,
    );
    assert.throws(
      () => cfSvc.createCustomFieldDef({ entidad: 'empleados', nombre_tecnico: 'legajo', etiqueta: 'Legajo', tipo: 'text' }),
      /colisiona con una columna nativa/i,
    );
    assert.throws(
      () => cfSvc.createCustomFieldDef({ entidad: 'contactos', nombre_tecnico: 'id', etiqueta: 'ID', tipo: 'number' }),
      /colisiona con una columna nativa/i,
    );
    assert.throws(
      () => cfSvc.createCustomFieldDef({ entidad: 'contactos', nombre_tecnico: 'Campo Malo!', etiqueta: 'Malo', tipo: 'text' }),
      /snake_case/i,
    );

    // 2. Crear definiciones válidas de los 5 tipos
    cfSvc.createCustomFieldDef({
      entidad: 'contactos',
      nombre_tecnico: 'canal_origen',
      etiqueta: 'Canal de Origen',
      tipo: 'select',
      opciones_json: JSON.stringify(['Instagram', 'Mayorista', 'Referido']),
      requerido: 1,
      orden: 1,
    });
    cfSvc.createCustomFieldDef({
      entidad: 'contactos',
      nombre_tecnico: 'puntaje_riesgo',
      etiqueta: 'Puntaje Riesgo',
      tipo: 'number',
      requerido: 0,
      orden: 2,
    });
    cfSvc.createCustomFieldDef({
      entidad: 'contactos',
      nombre_tecnico: 'fecha_alta_comercial',
      etiqueta: 'Fecha Alta Comercial',
      tipo: 'date',
    });
    cfSvc.createCustomFieldDef({
      entidad: 'contactos',
      nombre_tecnico: 'vip',
      etiqueta: 'Cliente VIP',
      tipo: 'boolean',
    });

    // 3. Validaciones de requerido, enum, number y date en createContacto
    assert.throws(
      () => contactoSvc.createContacto({ nombre: 'Sin Canal', cuit: '30-71111111-9', es_cliente: 1 }),
      /obligatorio/i,
    );
    assert.throws(
      () => contactoSvc.createContacto({
        nombre: 'Canal Inválido',
        es_cliente: 1,
        custom_fields: { canal_origen: 'TikTok' },
      }),
      /inválido/i,
    );
    assert.throws(
      () => contactoSvc.createContacto({
        nombre: 'Número Inválido',
        es_cliente: 1,
        custom_fields: { canal_origen: 'Instagram', puntaje_riesgo: 'no-num' },
      }),
      /número válido/i,
    );
    assert.throws(
      () => contactoSvc.createContacto({
        nombre: 'Fecha Inválida',
        es_cliente: 1,
        custom_fields: { canal_origen: 'Instagram', fecha_alta_comercial: '23/11/2026' },
      }),
      /YYYY-MM-DD/i,
    );

    // 4. Alta válida + lectura con row.custom_fields hidratado + merge parcial
    const cId1 = contactoSvc.createContacto({
      nombre: 'Zapatería Alfa',
      es_cliente: 1,
      custom_fields: {
        canal_origen: 'Instagram',
        puntaje_riesgo: 85,
        fecha_alta_comercial: '2026-11-23',
        vip: true,
      },
    });
    const cId2 = contactoSvc.createContacto({
      nombre: 'Zapatería Beta',
      es_cliente: 1,
      custom_fields: {
        canal_origen: 'Mayorista',
        puntaje_riesgo: 40,
        vip: false,
      },
    });

    const repo = new BaseRepository({ model: MODELS.contactos });
    const det1 = repo.findById(cId1);
    assert.equal(det1.custom_fields.canal_origen, 'Instagram');
    assert.equal(det1.custom_fields.puntaje_riesgo, 85);
    assert.equal(det1.custom_fields.vip, true);

    // Merge parcial: actualiza puntaje_riesgo sin perder canal_origen ni vip
    contactoSvc.updateContacto(cId1, { custom_fields: { puntaje_riesgo: 92 } });
    const det1After = repo.findById(cId1);
    assert.equal(det1After.custom_fields.canal_origen, 'Instagram');
    assert.equal(det1After.custom_fields.puntaje_riesgo, 92);
    assert.equal(det1After.custom_fields.vip, true);

    // 5. Filtrado seguro con QueryBuilder.whereJson()
    const igRows = repo.query().whereJson('custom_fields_json', 'canal_origen', 'Instagram').all();
    assert.equal(igRows.length, 1);
    assert.equal(igRows[0].id, cId1);

    const highScore = repo.query().whereJson('custom_fields_json', 'puntaje_riesgo', '>=', 80).all();
    assert.equal(highScore.length, 1);
    assert.equal(highScore[0].id, cId1);

    // Rechazo de claves JSON maliciosas o columnas no permitidas
    assert.throws(
      () => repo.query().whereJson('custom_fields_json', "a'); DROP TABLE contactos;--", 'x'),
      /Clave JSON inválida/i,
    );
    assert.throws(
      () => repo.query().whereJson('otra_col', 'canal_origen', 'x'),
      /Columna no permitida/i,
    );
  });
});

test('Campos Personalizados RBAC: GET permitido autenticado y POST/PUT/DELETE restringidos a sistema.config', async () => {
  await withIsolatedDb(async (dbName) => {
    const gidComercial = authSvc.createGrupo({
      nombre: 'Solo Comercial Ver',
      permisos: ['comercial.ver'],
    });
    authSvc.createUsuario({
      username: 'vendedor_cf',
      nombre: 'Vendedor',
      password: 'Password123!',
      grupo_id: gidComercial,
    });
    const loginUser = authSvc.login({ username: 'vendedor_cf', password: 'Password123!' });
    const cookieUser = `calc_sid=${loginUser.token}`;

    const gidAdmin = authSvc.createGrupo({
      nombre: 'Config Admin',
      permisos: ['sistema.config'],
    });
    authSvc.createUsuario({
      username: 'cfg_admin',
      nombre: 'Config Admin',
      password: 'Password123!',
      grupo_id: gidAdmin,
    });
    const loginAdmin = authSvc.login({ username: 'cfg_admin', password: 'Password123!' });
    const cookieAdmin = `calc_sid=${loginAdmin.token}`;

    // Usuario sin sistema.config -> GET 200, POST 403
    const resGet = createMockRes();
    await handleApi(
      createMockReq({ method: 'GET', url: '/api/custom-fields?entidad=contactos', headers: { cookie: cookieUser, 'x-db': dbName } }),
      resGet,
      '/api/custom-fields',
    );
    assert.equal(resGet.statusCode, 200);

    const resPostDenied = createMockRes();
    await handleApi(
      createMockReq({
        method: 'POST',
        url: '/api/custom-fields',
        headers: { cookie: cookieUser, 'x-db': dbName },
        body: { entidad: 'contactos', nombre_tecnico: 'zona_venta', etiqueta: 'Zona', tipo: 'text' },
      }),
      resPostDenied,
      '/api/custom-fields',
    );
    assert.equal(resPostDenied.statusCode, 403);

    // Usuario con sistema.config -> POST 201, PUT 200, DELETE 200
    const resPostOk = createMockRes();
    await handleApi(
      createMockReq({
        method: 'POST',
        url: '/api/custom-fields',
        headers: { cookie: cookieAdmin, 'x-db': dbName },
        body: { entidad: 'contactos', nombre_tecnico: 'zona_venta', etiqueta: 'Zona', tipo: 'text' },
      }),
      resPostOk,
      '/api/custom-fields',
    );
    assert.equal(resPostOk.statusCode, 201);
    const cfId = resPostOk.jsonBody.id;

    const resPutOk = createMockRes();
    await handleApi(
      createMockReq({
        method: 'PUT',
        url: `/api/custom-fields/${cfId}`,
        headers: { cookie: cookieAdmin, 'x-db': dbName },
        body: { etiqueta: 'Zona Comercial' },
      }),
      resPutOk,
      `/api/custom-fields/${cfId}`,
    );
    assert.equal(resPutOk.statusCode, 200);

    const resDelOk = createMockRes();
    await handleApi(
      createMockReq({
        method: 'DELETE',
        url: `/api/custom-fields/${cfId}`,
        headers: { cookie: cookieAdmin, 'x-db': dbName },
      }),
      resDelOk,
      `/api/custom-fields/${cfId}`,
    );
    assert.equal(resDelOk.statusCode, 200);
  });
});
