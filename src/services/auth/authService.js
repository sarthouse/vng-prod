import crypto from 'node:crypto';
import { db } from '../../db.js';
import { ENV } from '../../config/env.js';

export function signValue(val) {
  const sig = crypto.createHmac('sha256', ENV.SECRET_TOKEN).update(String(val)).digest('hex');
  return `${val}.${sig}`;
}

export function unsignValue(signed) {
  const s = String(signed || '');
  const dot = s.lastIndexOf('.');
  if (dot <= 0) return null;
  const val = s.slice(0, dot);
  const sig = s.slice(dot + 1);
  const expected = crypto.createHmac('sha256', ENV.SECRET_TOKEN).update(val).digest('hex');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return val;
}

export const ALL_PERMISSIONS = [
  { key: 'produccion.ver', label: 'Producción · Ver' },
  { key: 'produccion.editar', label: 'Producción · Editar' },
  { key: 'inventario.ver', label: 'Inventario · Ver' },
  { key: 'inventario.editar', label: 'Inventario · Editar / Movimientos' },
  { key: 'comercial.ver', label: 'Comercial · Ver (Compras, Ventas, Contactos)' },
  { key: 'comercial.editar', label: 'Comercial · Editar (Compras, Ventas, Contactos)' },
  { key: 'tesoreria.ver', label: 'Tesorería · Ver' },
  { key: 'tesoreria.editar', label: 'Tesorería · Pagos / Cobros' },
  { key: 'contabilidad.ver', label: 'Contabilidad · Ver (Diario, Mayor, Balance)' },
  { key: 'contabilidad.editar', label: 'Contabilidad · Asientos y Plan de Cuentas' },
  { key: 'sistema.config', label: 'Sistema · Configuración' },
  { key: 'sistema.usuarios', label: 'Sistema · Usuarios y Grupos' },
];

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const derived = crypto.scryptSync(String(password), salt, 64);
  const storedBuf = Buffer.from(hash, 'hex');
  if (derived.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(derived, storedBuf);
}

function parsePermisos(jsonStr) {
  try {
    const arr = JSON.parse(jsonStr || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function mapUserRow(row) {
  if (!row) return null;
  const permisos = parsePermisos(row.permisos_json);
  return {
    id: row.id,
    username: row.username,
    nombre: row.nombre,
    email: row.email || '',
    grupo_id: row.grupo_id,
    grupo_nombre: row.grupo_nombre || 'Sin grupo',
    es_admin: Boolean(row.es_admin),
    permisos,
    activo: Boolean(row.activo),
  };
}

const LEGACY_PERM_ALIASES = {
  'comercial.ver': ['compras.ver', 'ventas.ver'],
  'comercial.editar': ['compras.editar', 'ventas.editar'],
};

export function hasPermission(user, perm) {
  if (!user) return false;
  const perms = user.permisos || [];
  if (user.es_admin || perms.includes('*')) return true;
  if (perms.includes(perm)) return true;
  const aliases = LEGACY_PERM_ALIASES[perm];
  return Array.isArray(aliases) && aliases.some(a => perms.includes(a));
}

function createSession(userId) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sesiones (token, usuario_id, expires_at) VALUES (?, ?, ?)').run(rawToken, userId, expiresAt);
  return signValue(rawToken);
}

export function parseCookies(req) {
  const raw = req.headers?.cookie || '';
  const out = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = decodeURIComponent(part.slice(idx + 1).trim());
    if (k) out[k] = v;
  }
  return out;
}

export function getSessionUser(req) {
  const cookies = parseCookies(req);
  const authHeader = req.headers?.authorization || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const signedOrRaw = cookies.calc_sid || bearer;
  if (!signedOrRaw) return null;
  const token = unsignValue(signedOrRaw);
  if (!token) return null;

  const row = db.prepare(`
    SELECT u.*, g.nombre as grupo_nombre, g.permisos_json, g.es_admin
    FROM sesiones s
    JOIN usuarios u ON u.id = s.usuario_id
    LEFT JOIN grupos g ON g.id = u.grupo_id
    WHERE s.token = ? AND s.expires_at > ? AND u.activo = 1
  `).get(token, new Date().toISOString());

  return mapUserRow(row);
}

export function login({ username, password }) {
  const uname = String(username || '').trim().toLowerCase();
  if (!uname || !password) throw new Error('Usuario y contraseña obligatorios');
  const row = db.prepare(`
    SELECT u.*, g.nombre as grupo_nombre, g.permisos_json, g.es_admin
    FROM usuarios u
    LEFT JOIN grupos g ON g.id = u.grupo_id
    WHERE LOWER(u.username) = ?
  `).get(uname);
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw new Error('Usuario o contraseña inválidos');
  }
  if (!row.activo) {
    throw new Error('Tu cuenta está pendiente de habilitación por un administrador');
  }

  const token = createSession(row.id);
  return { token, user: mapUserRow(row) };
}

export function register({ username, nombre, email, password }) {
  const uname = String(username || '').trim().toLowerCase();
  const fullName = String(nombre || '').trim();
  if (!uname || uname.length < 3) throw new Error('El usuario debe tener al menos 3 caracteres');
  if (!fullName) throw new Error('El nombre es obligatorio');
  if (!password || String(password).length < 4) throw new Error('La contraseña debe tener al menos 4 caracteres');

  const defaultGrp = db.prepare('SELECT id FROM grupos WHERE es_admin = 0 ORDER BY id ASC LIMIT 1').get();
  const info = db.prepare(`
    INSERT INTO usuarios (username, nombre, email, password_hash, grupo_id, activo)
    VALUES (?, ?, ?, ?, ?, 0)
  `).run(uname, fullName, (email || '').trim(), hashPassword(password), defaultGrp?.id || null);
  const uid = Number(info.lastInsertRowid);
  const row = db.prepare(`
    SELECT u.*, g.nombre as grupo_nombre, g.permisos_json, g.es_admin
    FROM usuarios u LEFT JOIN grupos g ON g.id = u.grupo_id WHERE u.id = ?
  `).get(uid);
  return { pendingApproval: true, user: mapUserRow(row) };
}

export function logout(req) {
  const cookies = parseCookies(req);
  if (cookies.calc_sid) {
    const token = unsignValue(cookies.calc_sid) || cookies.calc_sid;
    db.prepare('DELETE FROM sesiones WHERE token = ?').run(token);
  }
}

export function needsInitialSetup() {
  return Number(db.prepare('SELECT COUNT(*) as c FROM usuarios').get()?.c || 0) === 0;
}

export function setupInitialAdmin({ username, nombre, email = '', password }) {
  if (!needsInitialSetup()) {
    throw new Error('El administrador inicial ya fue configurado');
  }
  const uname = String(username || '').trim().toLowerCase();
  const fullName = String(nombre || '').trim();
  if (!uname || uname.length < 3) throw new Error('El usuario debe tener al menos 3 caracteres');
  if (!fullName) throw new Error('El nombre es obligatorio');
  if (!password || String(password).length < 4) throw new Error('La contraseña debe tener al menos 4 caracteres');

  const adminGrp = db.prepare('SELECT id FROM grupos WHERE es_admin = 1 ORDER BY id ASC LIMIT 1').get();
  const info = db.prepare(`
    INSERT INTO usuarios (username, nombre, email, password_hash, grupo_id, activo)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(uname, fullName, (email || '').trim(), hashPassword(password), adminGrp?.id || null);

  const uid = Number(info.lastInsertRowid);
  const row = db.prepare(`
    SELECT u.*, g.nombre as grupo_nombre, g.permisos_json, g.es_admin
    FROM usuarios u LEFT JOIN grupos g ON g.id = u.grupo_id WHERE u.id = ?
  `).get(uid);
  const token = createSession(uid);
  return { token, user: mapUserRow(row) };
}

export function requestPasswordReset({ identifier, baseUrl }) {
  const q = String(identifier || '').trim().toLowerCase();
  if (!q) throw new Error('Ingresá tu usuario o email');

  const user = db.prepare(`
    SELECT id, username, nombre, email, activo
    FROM usuarios
    WHERE LOWER(username) = ? OR (email != '' AND LOWER(email) = ?)
    LIMIT 1
  `).get(q, q);

  if (user && user.activo) {
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare("DELETE FROM password_resets WHERE usuario_id = ? AND usado = 0").run(user.id);
    db.prepare(`
      INSERT INTO password_resets (usuario_id, token, expira_en)
      VALUES (?, ?, datetime('now', '+30 minutes'))
    `).run(user.id, token);

    const resetUrl = `${String(baseUrl || 'http://localhost:3000').replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
    console.log('');
    console.log('============================================================');
    console.log(`[RECUPERACIÓN DE CONTRASEÑA] Usuario: ${user.username} (${user.nombre})`);
    console.log(`Enlace (válido por 30 minutos): ${resetUrl}`);
    console.log('============================================================');
    console.log('');
  }

  return {
    ok: true,
    message: 'Si la cuenta existe y está activa, se envió el enlace de recuperación a la consola del servidor.',
  };
}

export function resetPasswordWithToken({ token, password }) {
  const tk = String(token || '').trim();
  if (!tk) throw new Error('Token de recuperación faltante');
  if (!password || String(password).length < 4) throw new Error('La contraseña debe tener al menos 4 caracteres');

  const row = db.prepare(`
    SELECT pr.id, pr.usuario_id, pr.usado, pr.expira_en
    FROM password_resets pr
    WHERE pr.token = ?
  `).get(tk);

  if (!row) throw new Error('El enlace de recuperación no es válido');
  if (row.usado) throw new Error('Este enlace ya fue utilizado');

  const valid = db.prepare("SELECT datetime('now') < ? as ok").get(row.expira_en);
  if (!valid?.ok) throw new Error('El enlace de recuperación expiró. Solicitá uno nuevo.');

  db.exec('BEGIN');
  try {
    db.prepare("UPDATE usuarios SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
      .run(hashPassword(password), row.usuario_id);
    db.prepare('UPDATE password_resets SET usado = 1 WHERE id = ?').run(row.id);
    db.prepare('DELETE FROM sesiones WHERE usuario_id = ?').run(row.usuario_id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { ok: true };
}

export function listGrupos() {
  return db.prepare(`
    SELECT g.*, (SELECT COUNT(*) FROM usuarios u WHERE u.grupo_id = g.id) as usuarios_count
    FROM grupos g
    ORDER BY g.es_admin DESC, g.nombre ASC
  `).all().map(g => ({ ...g, permisos: parsePermisos(g.permisos_json) }));
}

export function createGrupo(b) {
  const nombre = (b.nombre || '').trim();
  if (!nombre) throw new Error('El nombre del grupo es obligatorio');
  const permisos = Array.isArray(b.permisos) ? b.permisos : [];
  const esAdmin = b.es_admin ? 1 : 0;
  const info = db.prepare('INSERT INTO grupos (nombre, descripcion, permisos_json, es_admin) VALUES (?, ?, ?, ?)').run(
    nombre, (b.descripcion || '').trim(), JSON.stringify(esAdmin ? ['*'] : permisos), esAdmin
  );
  return Number(info.lastInsertRowid);
}

export function updateGrupo(id, b) {
  const ex = db.prepare('SELECT * FROM grupos WHERE id = ?').get(id);
  if (!ex) return false;
  const esAdmin = b.es_admin !== undefined ? (b.es_admin ? 1 : 0) : ex.es_admin;
  if (ex.es_admin && !esAdmin && db.prepare('SELECT COUNT(*) as c FROM grupos WHERE es_admin = 1').get().c <= 1) {
    throw new Error('No se puede quitar privilegios al único grupo Administrador.');
  }
  const permisos = b.permisos !== undefined ? (Array.isArray(b.permisos) ? b.permisos : []) : parsePermisos(ex.permisos_json);
  db.prepare('UPDATE grupos SET nombre=?, descripcion=?, permisos_json=?, es_admin=? WHERE id=?').run(
    b.nombre !== undefined ? b.nombre.trim() : ex.nombre,
    b.descripcion !== undefined ? b.descripcion.trim() : ex.descripcion,
    JSON.stringify(esAdmin ? ['*'] : permisos),
    esAdmin,
    id
  );
  return true;
}

export function deleteGrupo(id) {
  const ex = db.prepare('SELECT * FROM grupos WHERE id = ?').get(id);
  if (!ex) return;
  if (ex.es_admin && db.prepare('SELECT COUNT(*) as c FROM grupos WHERE es_admin = 1').get().c <= 1) {
    throw new Error('No se puede eliminar el único grupo Administrador.');
  }
  db.prepare('DELETE FROM grupos WHERE id = ?').run(id);
}

export function listUsuarios() {
  return db.prepare(`
    SELECT u.id, u.username, u.nombre, u.email, u.grupo_id, u.activo, u.created_at, u.updated_at,
           COALESCE(g.nombre, 'Sin grupo') as grupo_nombre, COALESCE(g.es_admin, 0) as es_admin
    FROM usuarios u
    LEFT JOIN grupos g ON g.id = u.grupo_id
    ORDER BY u.id ASC
  `).all();
}

export function createUsuario(b) {
  const uname = String(b.username || '').trim().toLowerCase();
  const nombre = String(b.nombre || '').trim();
  if (!uname || !nombre || !b.password) throw new Error('Usuario, nombre y contraseña obligatorios');
  const info = db.prepare(`
    INSERT INTO usuarios (username, nombre, email, password_hash, grupo_id, activo)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uname, nombre, (b.email || '').trim(), hashPassword(b.password), b.grupo_id ? Number(b.grupo_id) : null, b.activo === false ? 0 : 1);
  return Number(info.lastInsertRowid);
}

export function updateUsuario(id, b) {
  const ex = db.prepare(`
    SELECT u.*, COALESCE(g.es_admin, 0) as es_admin
    FROM usuarios u
    LEFT JOIN grupos g ON g.id = u.grupo_id
    WHERE u.id = ?
  `).get(id);
  if (!ex) return false;
  const nextGrupoId = b.grupo_id !== undefined ? (b.grupo_id ? Number(b.grupo_id) : null) : ex.grupo_id;
  const nextActivo = b.activo !== undefined ? (b.activo ? 1 : 0) : ex.activo;
  const nextIsAdmin = nextGrupoId ? Boolean(db.prepare('SELECT es_admin FROM grupos WHERE id = ?').get(nextGrupoId)?.es_admin) : false;
  if (ex.es_admin && ex.activo && (!nextActivo || !nextIsAdmin)) {
    const activeAdmins = db.prepare(`
      SELECT COUNT(*) as c FROM usuarios u
      JOIN grupos g ON g.id = u.grupo_id
      WHERE g.es_admin = 1 AND u.activo = 1
    `).get().c;
    if (activeAdmins <= 1) {
      throw new Error('No se puede desactivar o degradar al único Administrador activo.');
    }
  }
  const pwHash = b.password && String(b.password).length >= 4 ? hashPassword(b.password) : ex.password_hash;
  db.prepare(`
    UPDATE usuarios SET nombre=?, email=?, grupo_id=?, activo=?, password_hash=?, updated_at=datetime('now')
    WHERE id=?
  `).run(
    b.nombre !== undefined ? b.nombre.trim() : ex.nombre,
    b.email !== undefined ? b.email.trim() : ex.email,
    nextGrupoId,
    nextActivo,
    pwHash,
    id
  );
  return true;
}
