import fs from 'node:fs';
import path from 'node:path';
import { ENV } from '../config/env.js';

const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};

function safeStringify(obj) {
  const seen = new WeakSet();
  return JSON.stringify(obj, (_key, value) => {
    if (typeof value === 'bigint') return value.toString();
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        code: value.code,
        stack: value.stack,
      };
    }
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  });
}

function normalizeArgs(errOrMeta, maybeMeta) {
  let err = null;
  let meta = null;
  if (errOrMeta instanceof Error) {
    err = errOrMeta;
    if (maybeMeta && typeof maybeMeta === 'object') meta = maybeMeta;
  } else if (errOrMeta && typeof errOrMeta === 'object') {
    if (errOrMeta.err instanceof Error) err = errOrMeta.err;
    meta = errOrMeta;
  }
  return { err, meta };
}

function formatLine(timestamp, level, context, message, err, meta) {
  const tag = `[${level.toUpperCase()}]`;
  const ctx = context ? `[${context}]` : '';
  let line = `${timestamp} ${tag}${ctx} ${message}`;

  if (meta && Object.keys(meta).length > 0) {
    const cleanMeta = { ...meta };
    if (cleanMeta.err instanceof Error) delete cleanMeta.err;
    if (Object.keys(cleanMeta).length > 0) {
      line += ` ${safeStringify(cleanMeta)}`;
    }
  }

  if (err) {
    line += `\n${err.stack || `${err.name}: ${err.message}`}`;
  }
  return line;
}

function formatConsoleLine(timestamp, level, context, message, err, meta, useColor) {
  if (!useColor) return formatLine(timestamp, level, context, message, err, meta);
  const color = COLORS[level] || '';
  const tag = `${color}[${level.toUpperCase()}]${COLORS.reset}`;
  const ctx = context ? `${COLORS.dim}[${context}]${COLORS.reset}` : '';
  const ts = `${COLORS.dim}${timestamp}${COLORS.reset}`;
  let line = `${ts} ${tag}${ctx} ${message}`;

  if (meta && Object.keys(meta).length > 0) {
    const cleanMeta = { ...meta };
    if (cleanMeta.err instanceof Error) delete cleanMeta.err;
    if (Object.keys(cleanMeta).length > 0) {
      line += ` ${COLORS.dim}${safeStringify(cleanMeta)}${COLORS.reset}`;
    }
  }

  if (err) {
    line += `\n${color}${err.stack || `${err.name}: ${err.message}`}${COLORS.reset}`;
  }
  return line;
}

export function createLogger(context = 'APP', overrides = {}) {
  const getConfig = () => ({
    level: overrides.level ?? ENV.LOG_LEVEL ?? 'info',
    console: overrides.console ?? ENV.LOG_CONSOLE ?? true,
    toFile: overrides.toFile ?? ENV.LOG_TO_FILE ?? true,
    logDir: overrides.logDir ?? ENV.LOG_DIR,
  });

  function write(level, message, errOrMeta, maybeMeta) {
    const cfg = getConfig();
    const minScore = LEVELS[cfg.level] ?? LEVELS.info;
    const msgScore = LEVELS[level] ?? LEVELS.info;
    if (msgScore < minScore) return;

    const now = new Date();
    const timestamp = now.toISOString();
    const dateKey = timestamp.slice(0, 10);
    const { err, meta } = normalizeArgs(errOrMeta, maybeMeta);

    if (cfg.console) {
      const useColor = Boolean(process.stdout?.isTTY);
      const out = formatConsoleLine(timestamp, level, context, message, err, meta, useColor);
      if (level === 'error') console.error(out);
      else if (level === 'warn') console.warn(out);
      else console.log(out);
    }

    if (cfg.toFile && cfg.logDir) {
      try {
        fs.mkdirSync(cfg.logDir, { recursive: true });
        const plain = formatLine(timestamp, level, context, message, err, meta) + '\n';
        fs.appendFileSync(path.join(cfg.logDir, `app-${dateKey}.log`), plain, 'utf8');
        if (level === 'error') {
          fs.appendFileSync(path.join(cfg.logDir, `error-${dateKey}.log`), plain, 'utf8');
        }
      } catch (fileErr) {
        console.error(`[LOGGER] No se pudo escribir el archivo de log: ${fileErr.message}`);
      }
    }
  }

  return {
    debug: (msg, errOrMeta, meta) => write('debug', msg, errOrMeta, meta),
    info: (msg, errOrMeta, meta) => write('info', msg, errOrMeta, meta),
    warn: (msg, errOrMeta, meta) => write('warn', msg, errOrMeta, meta),
    error: (msg, errOrMeta, meta) => write('error', msg, errOrMeta, meta),
    child: (subContext) => createLogger(context ? `${context}:${subContext}` : subContext, overrides),
  };
}

export const logger = createLogger('APP');
