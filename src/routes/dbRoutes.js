import fs from 'node:fs';
import { getCurrentDbName, getDbPath, getConnection } from '../db.js';
import * as authSvc from '../services/auth/authService.js';
import * as dbMgrSvc from '../services/auth/dbManagerService.js';
import { checkRateLimit } from '../middlewares/security.js';
import { json, parseBody, cookieFlags } from './http.js';

function isMasterUnlocked(req, bodyKey = '') {
  const headerKey = req.headers['x-db-master-key'] || '';
  if (dbMgrSvc.verifyMasterKey(bodyKey || headerKey)) return true;
  const cookies = authSvc.parseCookies(req);
  if (!cookies.calc_db_mgr) return false;
  const val = authSvc.unsignValue(cookies.calc_db_mgr);
  return Boolean(val && Number(val) > Date.now());
}

export async function handleDbRoutes(req, res, pathname) {
  if (pathname === '/api/databases/current' && req.method === 'GET') {
    json(res, 200, { current: getCurrentDbName(), unlocked: isMasterUnlocked(req) });
    return true;
  }
  if (pathname === '/api/databases/unlock' && req.method === 'POST') {
    const rl = checkRateLimit(req, 'db-unlock', { max: 10, windowMs: 10 * 60 * 1000 });
    if (!rl.allowed) { json(res, 429, { error: `Demasiados intentos. Probá en ${rl.retryAfterSec}s.` }); return true; }
    const b = await parseBody(req);
    if (!dbMgrSvc.verifyMasterKey(b.master_key)) {
      json(res, 403, { error: 'Clave maestra incorrecta' });
      return true;
    }
    const signedMgr = authSvc.signValue(String(Date.now() + 3600 * 1000));
    res.setHeader('Set-Cookie', `calc_db_mgr=${encodeURIComponent(signedMgr)}; ${cookieFlags(3600)}`);
    json(res, 200, { ok: true, current: getCurrentDbName(), databases: dbMgrSvc.listDatabases() });
    return true;
  }
  if (pathname === '/api/databases' && req.method === 'GET') {
    if (!isMasterUnlocked(req)) { json(res, 403, { error: 'Se requiere clave maestra' }); return true; }
    json(res, 200, { current: getCurrentDbName(), databases: dbMgrSvc.listDatabases() });
    return true;
  }
  if (pathname === '/api/databases' && req.method === 'POST') {
    const b = await parseBody(req);
    if (!isMasterUnlocked(req, b.master_key)) { json(res, 403, { error: 'Se requiere clave maestra' }); return true; }
    try { json(res, 201, dbMgrSvc.createDatabase(b.name)); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (pathname === '/api/databases/duplicate' && req.method === 'POST') {
    const b = await parseBody(req);
    if (!isMasterUnlocked(req, b.master_key)) { json(res, 403, { error: 'Se requiere clave maestra' }); return true; }
    try { json(res, 201, dbMgrSvc.duplicateDatabase(b.source, b.target)); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (pathname === '/api/databases/select' && req.method === 'POST') {
    const b = await parseBody(req);
    if (!isMasterUnlocked(req, b.master_key)) { json(res, 403, { error: 'Se requiere clave maestra' }); return true; }
    try {
      const target = String(b.name || '').trim();
      const targetPath = getDbPath(target);
      if (!fs.existsSync(targetPath)) { json(res, 404, { error: `La base "${target}" no existe` }); return true; }
      const signedDb = authSvc.signValue(target);
      res.setHeader('Set-Cookie', [
        `calc_db=${encodeURIComponent(signedDb)}; ${cookieFlags(2592000)}`,
        `calc_sid=; ${cookieFlags(0)}`,
      ]);
      json(res, 200, { ok: true, current: target });
    } catch (e) {
      json(res, 400, { error: e.message });
    }
    return true;
  }
  const dbBackupMatch = pathname.match(/^\/api\/databases\/([a-zA-Z0-9_-]+)\/backup$/);
  if (dbBackupMatch && req.method === 'GET') {
    if (!isMasterUnlocked(req)) { json(res, 403, { error: 'Se requiere clave maestra' }); return true; }
    try {
      const name = dbBackupMatch[1];
      const dbPath = getDbPath(name);
      if (!fs.existsSync(dbPath)) { json(res, 404, { error: 'Base no encontrada' }); return true; }
      const conn = getConnection(name);
      try { conn.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* ignore */ }
      const stamp = new Date().toISOString().slice(0, 10);
      res.writeHead(200, {
        'Content-Type': 'application/x-sqlite3',
        'Content-Disposition': `attachment; filename="${name}-backup-${stamp}.sqlite"`,
      });
      fs.createReadStream(dbPath).pipe(res);
    } catch (e) {
      json(res, 400, { error: e.message });
    }
    return true;
  }
  const dbMatch = pathname.match(/^\/api\/databases\/([a-zA-Z0-9_-]+)$/);
  if (dbMatch && req.method === 'DELETE') {
    if (!isMasterUnlocked(req)) { json(res, 403, { error: 'Se requiere clave maestra' }); return true; }
    try { json(res, 200, dbMgrSvc.deleteDatabase(dbMatch[1])); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  return false;
}
