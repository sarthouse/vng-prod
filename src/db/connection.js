import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENV } from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DB_DIR = path.join(__dirname, '..', '..', 'db');
export const DB_PATH = path.join(DB_DIR, `${ENV.DEFAULT_DB}.sqlite`);

fs.mkdirSync(DB_DIR, { recursive: true });

const dbStorage = new AsyncLocalStorage();
const pool = new Map();
let initializerFn = null;

export function registerDbInitializer(fn) {
  initializerFn = fn;
}

export function isValidDbName(name) {
  return typeof name === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(name);
}

export function getDbPath(name = ENV.DEFAULT_DB) {
  if (!isValidDbName(name)) throw new Error('Nombre de base de datos inválido (solo letras, números, - y _)');
  return path.join(DB_DIR, `${name}.sqlite`);
}

export function getCurrentDbName() {
  const store = dbStorage.getStore();
  if (store === undefined) return ENV.DEFAULT_DB;
  return store;
}

export function hasActiveDatabase() {
  const name = getCurrentDbName();
  return Boolean(name && isValidDbName(name) && fs.existsSync(getDbPath(name)));
}

export function resolveRequestDatabase(cookieDbName) {
  if (isValidDbName(cookieDbName) && fs.existsSync(getDbPath(cookieDbName))) {
    return cookieDbName;
  }
  if (fs.existsSync(getDbPath(ENV.DEFAULT_DB))) {
    return ENV.DEFAULT_DB;
  }
  return null;
}

export function getConnection(name = ENV.DEFAULT_DB) {
  const safeName = isValidDbName(name) ? name : ENV.DEFAULT_DB;
  if (pool.has(safeName)) return pool.get(safeName);

  const filePath = getDbPath(safeName);
  const conn = new DatabaseSync(filePath);
  conn.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
  pool.set(safeName, conn);
  if (typeof initializerFn === 'function') {
    initializerFn(conn);
  }
  return conn;
}

export function closeConnection(name) {
  const conn = pool.get(name);
  if (conn) {
    try { conn.close(); } catch { /* ignore */ }
    pool.delete(name);
  }
}

export function closeAllConnections() {
  for (const [name, conn] of pool.entries()) {
    try {
      conn.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      conn.close();
    } catch { /* ignore */ }
    pool.delete(name);
  }
}

export function runWithDatabase(name, fn) {
  const safeName = (isValidDbName(name) && fs.existsSync(getDbPath(name))) ? name : null;
  return dbStorage.run(safeName, fn);
}

export const db = new Proxy({}, {
  get(_, prop) {
    const target = getConnection(getCurrentDbName());
    const val = target[prop];
    return typeof val === 'function' ? val.bind(target) : val;
  },
});
