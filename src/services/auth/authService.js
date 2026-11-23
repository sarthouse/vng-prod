import crypto from 'node:crypto';
import { BaseRepository } from '../../core/BaseRepository.js';
import { ENV } from '../../config/env.js';

const sesionRepo = new BaseRepository({
  table: 'sesiones',
  columns: ['token', 'usuario_id', 'expires_at'],
});
const usuarioRepo = new BaseRepository({
  table: 'usuarios',
  columns: ['username', 'nombre', 'email', 'password_hash', 'grupo_id', 'activo'],
});
const grupoRepo = new BaseRepository({
  table: 'grupos',
  columns: ['nombre', 'descripcion', 'permisos_json', 'es_admin'],
});
const passwordResetRepo = new BaseRepository({
  table: 'password_resets',
  columns: ['usuario_id', 'token', 'expira_en', 'usado'],
});

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
  { key: 'rrhh.ver', label: 'RRHH / Nómina · Ver' },
  { key: 'rrhh.editar', label: 'RRHH / Nómina · Editar y Liquidar' },
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
  sesionRepo.create({ token: rawToken, usuario_id: userId, expires_at: expiresAt });
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

  const row = sesionRepo.query('s')
    .select('u.*, g.nombre as grupo_nombre, g.permisos_json, g.es_admin')
    .innerJoin('usuarios', 'u', 'u.id', 's.usuario_id')
    .leftJoin('grupos', 'g', 'g.id', 'u.grupo_id')
    .where('s.token', token)
    .where('s.expires_at', '>', new Date().toISOString())
    .where('u.activo', 1)
    .get();

  return mapUserRow(row);
}

export function login({ username, password }) {
  const uname = String(username || '').trim().toLowerCase();
  if (!uname || !password) throw new Error('Usuario y contraseña obligatorios');
  const row = usuarioRepo.query('u')
    .select('u.*, g.nombre as grupo_nombre, g.permisos_json, g.es_admin')
    .leftJoin('grupos', 'g', 'g.id', 'u.grupo_id')
    .all()
    .find(u => String(u.username || '').toLowerCase() === uname);
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

  const defaultGrp = grupoRepo.query().select('id').where('es_admin', 0).orderBy('id', 'ASC').limit(1).get();
  const uid = usuarioRepo.create({
    username: uname,
    nombre: fullName,
    email: (email || '').trim(),
    password_hash: hashPassword(password),
    grupo_id: defaultGrp?.id || null,
    activo: 0,
  });
  const row = usuarioRepo.query('u')
    .select('u.*, g.nombre as grupo_nombre, g.permisos_json, g.es_admin')
    .leftJoin('grupos', 'g', 'g.id', 'u.grupo_id')
    .where('u.id', uid)
    .get();
  return { pendingApproval: true, user: mapUserRow(row) };
}

export function logout(req) {
  const cookies = parseCookies(req);
  if (cookies.calc_sid) {
    const token = unsignValue(cookies.calc_sid) || cookies.calc_sid;
    sesionRepo.query().where('token', token).delete();
  }
}

export function needsInitialSetup() {
  return Number(usuarioRepo.query().count() || 0) === 0;
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

  const adminGrp = grupoRepo.query().select('id').where('es_admin', 1).orderBy('id', 'ASC').limit(1).get();
  const uid = usuarioRepo.create({
    username: uname,
    nombre: fullName,
    email: (email || '').trim(),
    password_hash: hashPassword(password),
    grupo_id: adminGrp?.id || null,
    activo: 1,
  });

  const row = usuarioRepo.query('u')
    .select('u.*, g.nombre as grupo_nombre, g.permisos_json, g.es_admin')
    .leftJoin('grupos', 'g', 'g.id', 'u.grupo_id')
    .where('u.id', uid)
    .get();
  const token = createSession(uid);
  return { token, user: mapUserRow(row) };
}

export function requestPasswordReset({ identifier, baseUrl }) {
  const q = String(identifier || '').trim().toLowerCase();
  if (!q) throw new Error('Ingresá tu usuario o email');

  const user = usuarioRepo.query()
    .select('id, username, nombre, email, activo')
    .all()
    .find(u => String(u.username || '').toLowerCase() === q || (u.email && String(u.email).toLowerCase() === q));

  if (user && user.activo) {
    const token = crypto.randomBytes(24).toString('hex');
    passwordResetRepo.query().where('usuario_id', user.id).where('usado', 0).delete();
    const expiraEn = new Date(Date.now() + 30 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    passwordResetRepo.create({
      usuario_id: user.id,
      token,
      expira_en: expiraEn,
    });

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

  const row = passwordResetRepo.query()
    .select('id, usuario_id, usado, expira_en')
    .where('token', tk)
    .get();

  if (!row) throw new Error('El enlace de recuperación no es válido');
  if (row.usado) throw new Error('Este enlace ya fue utilizado');

  const nowSql = new Date().toISOString().slice(0, 19).replace('T', ' ');
  if (!(nowSql < String(row.expira_en || ''))) {
    throw new Error('El enlace de recuperación expiró. Solicitá uno nuevo.');
  }

  usuarioRepo.transaction(() => {
    usuarioRepo.update(row.usuario_id, { password_hash: hashPassword(password) });
    passwordResetRepo.update(row.id, { usado: 1 });
    sesionRepo.query().where('usuario_id', row.usuario_id).delete();
  });
  return { ok: true };
}

export function listGrupos() {
  const grupos = grupoRepo.query()
    .orderBy('es_admin', 'DESC')
    .orderBy('nombre', 'ASC')
    .all();
  const usuarios = usuarioRepo.query().select('grupo_id').all();
  const countMap = new Map();
  for (const u of usuarios) {
    if (u.grupo_id) countMap.set(u.grupo_id, (countMap.get(u.grupo_id) || 0) + 1);
  }
  return grupos.map(g => ({
    ...g,
    usuarios_count: countMap.get(g.id) || 0,
    permisos: parsePermisos(g.permisos_json),
  }));
}

export function createGrupo(b) {
  const nombre = (b.nombre || '').trim();
  if (!nombre) throw new Error('El nombre del grupo es obligatorio');
  const permisos = Array.isArray(b.permisos) ? b.permisos : [];
  const esAdmin = b.es_admin ? 1 : 0;
  return grupoRepo.create({
    nombre,
    descripcion: (b.descripcion || '').trim(),
    permisos_json: JSON.stringify(esAdmin ? ['*'] : permisos),
    es_admin: esAdmin,
  });
}

export function updateGrupo(id, b) {
  const ex = grupoRepo.findById(id);
  if (!ex) return false;
  const esAdmin = b.es_admin !== undefined ? (b.es_admin ? 1 : 0) : ex.es_admin;
  if (ex.es_admin && !esAdmin && grupoRepo.query().where('es_admin', 1).count() <= 1) {
    throw new Error('No se puede quitar privilegios al único grupo Administrador.');
  }
  const permisos = b.permisos !== undefined ? (Array.isArray(b.permisos) ? b.permisos : []) : parsePermisos(ex.permisos_json);
  grupoRepo.update(id, {
    nombre: b.nombre !== undefined ? b.nombre.trim() : ex.nombre,
    descripcion: b.descripcion !== undefined ? b.descripcion.trim() : ex.descripcion,
    permisos_json: JSON.stringify(esAdmin ? ['*'] : permisos),
    es_admin: esAdmin,
  });
  return true;
}

export function deleteGrupo(id) {
  const ex = grupoRepo.findById(id);
  if (!ex) return;
  if (ex.es_admin && grupoRepo.query().where('es_admin', 1).count() <= 1) {
    throw new Error('No se puede eliminar el único grupo Administrador.');
  }
  grupoRepo.delete(id);
}

export function listUsuarios() {
  return usuarioRepo.query('u')
    .select("u.id, u.username, u.nombre, u.email, u.grupo_id, u.activo, u.created_at, u.updated_at, COALESCE(g.nombre, 'Sin grupo') as grupo_nombre, COALESCE(g.es_admin, 0) as es_admin")
    .leftJoin('grupos', 'g', 'g.id', 'u.grupo_id')
    .orderBy('u.id', 'ASC')
    .all();
}

export function createUsuario(b) {
  const uname = String(b.username || '').trim().toLowerCase();
  const nombre = String(b.nombre || '').trim();
  if (!uname || !nombre || !b.password) throw new Error('Usuario, nombre y contraseña obligatorios');
  return usuarioRepo.create({
    username: uname,
    nombre,
    email: (b.email || '').trim(),
    password_hash: hashPassword(b.password),
    grupo_id: b.grupo_id ? Number(b.grupo_id) : null,
    activo: b.activo === false ? 0 : 1,
  });
}

export function updateUsuario(id, b) {
  const ex = usuarioRepo.query('u')
    .select('u.*, COALESCE(g.es_admin, 0) as es_admin')
    .leftJoin('grupos', 'g', 'g.id', 'u.grupo_id')
    .where('u.id', id)
    .get();
  if (!ex) return false;
  const nextGrupoId = b.grupo_id !== undefined ? (b.grupo_id ? Number(b.grupo_id) : null) : ex.grupo_id;
  const nextActivo = b.activo !== undefined ? (b.activo ? 1 : 0) : ex.activo;
  const nextIsAdmin = nextGrupoId ? Boolean(grupoRepo.query().select('es_admin').where('id', nextGrupoId).get()?.es_admin) : false;
  if (ex.es_admin && ex.activo && (!nextActivo || !nextIsAdmin)) {
    const activeAdmins = usuarioRepo.query('u')
      .innerJoin('grupos', 'g', 'g.id', 'u.grupo_id')
      .where('g.es_admin', 1)
      .where('u.activo', 1)
      .count();
    if (activeAdmins <= 1) {
      throw new Error('No se puede desactivar o degradar al único Administrador activo.');
    }
  }
  const pwHash = b.password && String(b.password).length >= 4 ? hashPassword(b.password) : ex.password_hash;
  usuarioRepo.update(id, {
    nombre: b.nombre !== undefined ? b.nombre.trim() : ex.nombre,
    email: b.email !== undefined ? b.email.trim() : ex.email,
    grupo_id: nextGrupoId,
    activo: nextActivo,
    password_hash: pwHash,
  });
  return true;
}
