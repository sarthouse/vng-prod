import { ENV } from '../config/env.js';

export function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

export function parseBody(req, maxBytes = 2e6) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > maxBytes) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

export function cookieFlags(maxAge) {
  return `HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${ENV.COOKIE_SECURE ? '; Secure' : ''}`;
}

export function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `calc_sid=${encodeURIComponent(token)}; ${cookieFlags(2592000)}`);
}
