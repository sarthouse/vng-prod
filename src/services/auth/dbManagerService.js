import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ENV } from '../../config/env.js';
import { DB_DIR, getConnection, getCurrentDbName, closeConnection, isValidDbName, getDbPath } from '../../db.js';
import { UPLOADS_DIR } from './metaService.js';

export function verifyMasterKey(inputKey) {
  const expected = String(ENV.DB_MASTER_KEY || '');
  const provided = String(inputKey || '');
  if (!expected || !provided) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function listDatabases() {
  fs.mkdirSync(DB_DIR, { recursive: true });
  const current = getCurrentDbName();
  const files = fs.readdirSync(DB_DIR)
    .filter(f => f.endsWith('.sqlite'))
    .sort((a, b) => a.localeCompare(b));

  return files.map(file => {
    const name = file.slice(0, -'.sqlite'.length);
    const stat = fs.statSync(path.join(DB_DIR, file));
    return {
      name,
      sizeBytes: stat.size,
      updatedAt: stat.mtime.toISOString(),
      isActive: name === current,
      isDefault: name === ENV.DEFAULT_DB,
    };
  });
}

export function createDatabase(name) {
  const clean = String(name || '').trim();
  if (!isValidDbName(clean)) {
    throw new Error('Nombre inválido. Usá entre 1 y 40 caracteres (letras, números, "-" o "_").');
  }
  const targetPath = getDbPath(clean);
  if (fs.existsSync(targetPath)) {
    throw new Error(`La base de datos "${clean}" ya existe.`);
  }
  getConnection(clean);
  return { name: clean };
}

export function duplicateDatabase(sourceName, targetName) {
  const src = String(sourceName || '').trim();
  const dst = String(targetName || '').trim();
  if (!isValidDbName(src) || !isValidDbName(dst)) {
    throw new Error('Nombre de base de datos inválido.');
  }
  const srcPath = getDbPath(src);
  const dstPath = getDbPath(dst);
  if (!fs.existsSync(srcPath)) throw new Error(`La base origen "${src}" no existe.`);
  if (fs.existsSync(dstPath)) throw new Error(`La base destino "${dst}" ya existe.`);

  const conn = getConnection(src);
  try {
    conn.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch { /* ignore */ }

  fs.copyFileSync(srcPath, dstPath);

  const srcUploads = path.join(UPLOADS_DIR, src);
  const dstUploads = path.join(UPLOADS_DIR, dst);
  if (fs.existsSync(srcUploads)) {
    fs.cpSync(srcUploads, dstUploads, { recursive: true });
  }
  return { name: dst };
}

export function deleteDatabase(name) {
  const clean = String(name || '').trim();
  if (!isValidDbName(clean)) throw new Error('Nombre inválido.');
  if (clean === ENV.DEFAULT_DB) {
    throw new Error(`No se puede eliminar la base por defecto (${ENV.DEFAULT_DB}).`);
  }
  if (clean === getCurrentDbName()) {
    throw new Error('No podés eliminar la base de datos que estás usando en esta sesión. Cambiá a otra primero.');
  }

  const targetPath = getDbPath(clean);
  if (!fs.existsSync(targetPath)) {
    throw new Error(`La base de datos "${clean}" no existe.`);
  }

  closeConnection(clean);
  for (const suffix of ['', '-wal', '-shm']) {
    const p = `${targetPath}${suffix}`;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  const dbUploads = path.join(UPLOADS_DIR, clean);
  if (fs.existsSync(dbUploads)) {
    fs.rmSync(dbUploads, { recursive: true, force: true });
  }
  return { ok: true };
}
