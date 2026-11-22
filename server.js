import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENV, isAllowedHost } from './src/config/env.js';
import { DB_DIR, resolveRequestDatabase, runWithDatabase, closeAllConnections } from './src/db.js';
import { parseCookies, unsignValue } from './src/services/auth/authService.js';
import { applySecurityHeaders } from './src/middlewares/security.js';
import { handleApi, json } from './src/routes/api.js';
import { createLogger } from './src/core/logger.js';
import { startWooPollingWorker } from './src/services/comercial/wooService.js';

const log = createLogger('SERVER');
const httpLog = createLogger('HTTP');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = ENV.PORT;

fs.mkdirSync(DB_DIR, { recursive: true });

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  try {
    applySecurityHeaders(res);
    if (!isAllowedHost(req.headers.host)) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Host no permitido');
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (pathname.startsWith('/api/')) {
      const start = process.hrtime.bigint();
      const cookies = parseCookies(req);
      const cookieDb = cookies.calc_db ? unsignValue(cookies.calc_db) : null;
      const selectedDb = resolveRequestDatabase(cookieDb);
      res.on('finish', () => {
        const ms = Number((Number(process.hrtime.bigint() - start) / 1e6).toFixed(1));
        const meta = { method: req.method, path: pathname, status: res.statusCode, ms, db: selectedDb || undefined };
        if (res.statusCode >= 500) httpLog.error(`${req.method} ${pathname}`, meta);
        else if (res.statusCode >= 400) httpLog.warn(`${req.method} ${pathname}`, meta);
        else httpLog.info(`${req.method} ${pathname}`, meta);
      });
      return await runWithDatabase(selectedDb, () => handleApi(req, res, pathname));
    }

    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }

    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    log.error('Error no manejado en request HTTP', err, { method: req.method, url: req.url });
    if (!res.headersSent) {
      json(res, 500, { error: err.message || 'Error interno del servidor' });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
});

server.listen(PORT, () => {
  log.info(`Servidor corriendo en http://localhost:${PORT}`, {
    logLevel: ENV.LOG_LEVEL,
    logToFile: ENV.LOG_TO_FILE,
    logDir: ENV.LOG_TO_FILE ? ENV.LOG_DIR : undefined,
  });
  startWooPollingWorker();
});

function shutdown(signal) {
  log.info(`[${signal}] Cerrando servidor y conexiones SQLite...`);
  server.close(() => {
    closeAllConnections();
    process.exit(0);
  });
  setTimeout(() => {
    closeAllConnections();
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  log.error('Unhandled Promise Rejection', reason instanceof Error ? reason : new Error(String(reason)));
});
process.on('uncaughtException', (err) => {
  log.error('Uncaught Exception', err);
  closeAllConnections();
  process.exit(1);
});
