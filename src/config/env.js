import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..', '..');
const ENV_PATH = path.join(ROOT_DIR, '.env');

function loadDotEnv() {
  if (!fs.existsSync(ENV_PATH)) return;
  const lines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

loadDotEnv();

const fallbackSecret = crypto.randomBytes(32).toString('hex');
if (!process.env.SECRET_TOKEN) {
  console.warn('[ENV] SECRET_TOKEN no está definido en .env; usando secreto efímero en memoria.');
}

export const ENV = {
  PORT: Number(process.env.PORT) || 3000,
  ALLOWED_HOSTS: String(process.env.ALLOWED_HOSTS || 'localhost,127.0.0.1')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean),
  SECRET_TOKEN: process.env.SECRET_TOKEN || fallbackSecret,
  DB_MASTER_KEY: process.env.DB_MASTER_KEY || '',
  DEFAULT_DB: (process.env.DEFAULT_DB || 'database').replace(/[^a-zA-Z0-9_-]/g, '') || 'database',
  COOKIE_SECURE: String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true',
  LOG_LEVEL: String(process.env.LOG_LEVEL || 'info').trim().toLowerCase(),
  LOG_CONSOLE: String(process.env.LOG_CONSOLE || 'true').toLowerCase() !== 'false',
  LOG_TO_FILE: String(process.env.LOG_TO_FILE || 'true').toLowerCase() !== 'false',
  LOG_DIR: process.env.LOG_DIR ? path.resolve(ROOT_DIR, process.env.LOG_DIR) : path.join(ROOT_DIR, 'logs'),
};

export function isAllowedHost(hostHeader) {
  if (ENV.ALLOWED_HOSTS.includes('*')) return true;
  if (!hostHeader) return false;
  const hostOnly = String(hostHeader).split(':')[0].trim().toLowerCase();
  return ENV.ALLOWED_HOSTS.includes(hostOnly) || ENV.ALLOWED_HOSTS.includes(String(hostHeader).trim().toLowerCase());
}
