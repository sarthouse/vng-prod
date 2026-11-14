import * as authSvc from '../services/auth/authService.js';
import { checkRateLimit } from '../middlewares/security.js';
import { json, parseBody, cookieFlags, setSessionCookie } from './http.js';

export async function handlePublicAuthRoutes(req, res, pathname) {
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    const rl = checkRateLimit(req, 'login', { max: 15, windowMs: 10 * 60 * 1000 });
    if (!rl.allowed) { json(res, 429, { error: `Demasiados intentos. Probá en ${rl.retryAfterSec}s.` }); return true; }
    const b = await parseBody(req);
    try {
      const { token, user } = authSvc.login(b);
      setSessionCookie(res, token);
      json(res, 200, { user });
    } catch (e) {
      json(res, 401, { error: e.message });
    }
    return true;
  }
  if (pathname === '/api/auth/register' && req.method === 'POST') {
    const b = await parseBody(req);
    try {
      const { user } = authSvc.register(b);
      json(res, 201, {
        pendingApproval: true,
        message: 'Cuenta creada. Un administrador debe habilitar tu usuario antes de poder iniciar sesión.',
        user,
      });
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) json(res, 409, { error: 'Ese usuario ya existe.' });
      else json(res, 400, { error: e.message });
    }
    return true;
  }
  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    authSvc.logout(req);
    res.setHeader('Set-Cookie', `calc_sid=; ${cookieFlags(0)}`);
    json(res, 200, { ok: true });
    return true;
  }
  if (pathname === '/api/auth/me' && req.method === 'GET') {
    const user = authSvc.getSessionUser(req);
    if (!user) json(res, 401, { error: 'No autenticado' });
    else json(res, 200, { user });
    return true;
  }
  if (pathname === '/api/auth/status' && req.method === 'GET') {
    json(res, 200, { needs_db: false, needs_setup: authSvc.needsInitialSetup() });
    return true;
  }
  if (pathname === '/api/auth/setup' && req.method === 'POST') {
    const b = await parseBody(req);
    try {
      const { token, user } = authSvc.setupInitialAdmin(b);
      setSessionCookie(res, token);
      json(res, 201, { user });
    } catch (e) {
      json(res, 400, { error: e.message });
    }
    return true;
  }
  if (pathname === '/api/auth/forgot-password' && req.method === 'POST') {
    const rl = checkRateLimit(req, 'forgot', { max: 10, windowMs: 15 * 60 * 1000 });
    if (!rl.allowed) { json(res, 429, { error: `Demasiados intentos. Probá en ${rl.retryAfterSec}s.` }); return true; }
    const b = await parseBody(req);
    try {
      const proto = req.headers['x-forwarded-proto'] || 'http';
      const host = req.headers.host || 'localhost:3000';
      json(res, 200, authSvc.requestPasswordReset({ identifier: b.identifier, baseUrl: `${proto}://${host}` }));
    } catch (e) {
      json(res, 400, { error: e.message });
    }
    return true;
  }
  if (pathname === '/api/auth/reset-password' && req.method === 'POST') {
    const b = await parseBody(req);
    try {
      json(res, 200, authSvc.resetPasswordWithToken(b));
    } catch (e) {
      json(res, 400, { error: e.message });
    }
    return true;
  }
  return false;
}

export async function handleAdminAuthRoutes(req, res, pathname) {
  if (pathname === '/api/permisos' && req.method === 'GET') {
    json(res, 200, authSvc.ALL_PERMISSIONS);
    return true;
  }
  if (pathname === '/api/grupos' && req.method === 'GET') {
    json(res, 200, authSvc.listGrupos());
    return true;
  }
  if (pathname === '/api/grupos' && req.method === 'POST') {
    const b = await parseBody(req);
    try { json(res, 201, { id: authSvc.createGrupo(b) }); }
    catch (e) {
      if (String(e.message).includes('UNIQUE')) json(res, 409, { error: 'Ya existe un grupo con ese nombre.' });
      else json(res, 400, { error: e.message });
    }
    return true;
  }
  const grpMatch = pathname.match(/^\/api\/grupos\/(\d+)$/);
  if (grpMatch && req.method === 'PUT') {
    if (!authSvc.updateGrupo(Number(grpMatch[1]), await parseBody(req))) json(res, 404, { error: 'Grupo no encontrado' });
    else json(res, 200, { ok: true });
    return true;
  }
  if (grpMatch && req.method === 'DELETE') {
    try { authSvc.deleteGrupo(Number(grpMatch[1])); json(res, 200, { ok: true }); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (pathname === '/api/usuarios' && req.method === 'GET') {
    json(res, 200, authSvc.listUsuarios());
    return true;
  }
  if (pathname === '/api/usuarios' && req.method === 'POST') {
    const b = await parseBody(req);
    try { json(res, 201, { id: authSvc.createUsuario(b) }); }
    catch (e) {
      if (String(e.message).includes('UNIQUE')) json(res, 409, { error: 'Ese usuario ya existe.' });
      else json(res, 400, { error: e.message });
    }
    return true;
  }
  const usrMatch = pathname.match(/^\/api\/usuarios\/(\d+)$/);
  if (usrMatch && req.method === 'PUT') {
    if (!authSvc.updateUsuario(Number(usrMatch[1]), await parseBody(req))) json(res, 404, { error: 'Usuario no encontrado' });
    else json(res, 200, { ok: true });
    return true;
  }
  return false;
}
