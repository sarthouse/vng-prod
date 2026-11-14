import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, getCurrentDbName } from '../../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOADS_DIR = path.join(__dirname, '..', '..', '..', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function getDbUploadsDir() {
  const dir = path.join(UPLOADS_DIR, getCurrentDbName());
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const VALID_ENTIDADES = new Set(['compra', 'venta', 'movimiento', 'pago', 'cobro', 'orden', 'operacion_stock']);

function assertTipo(tipo) {
  if (!VALID_ENTIDADES.has(tipo)) throw new Error('Tipo de entidad inválido');
}

export function listNotas(tipo, id) {
  assertTipo(tipo);
  return db.prepare(`
    SELECT * FROM notas_internas
    WHERE entidad_tipo = ? AND entidad_id = ?
    ORDER BY id DESC
  `).all(tipo, Number(id));
}

export function addNota({ tipo, id, contenido, user }) {
  assertTipo(tipo);
  const text = String(contenido || '').trim();
  if (!text) throw new Error('La nota no puede estar vacía');
  const info = db.prepare(`
    INSERT INTO notas_internas (entidad_tipo, entidad_id, contenido, autor_id, autor_nombre)
    VALUES (?, ?, ?, ?, ?)
  `).run(tipo, Number(id), text, user?.id || null, user?.nombre || 'Sistema');
  return Number(info.lastInsertRowid);
}

export function deleteNota(notaId) {
  db.prepare('DELETE FROM notas_internas WHERE id = ?').run(Number(notaId));
}

export function listAdjuntos(tipo, id) {
  assertTipo(tipo);
  return db.prepare(`
    SELECT id, entidad_tipo, entidad_id, nombre_original, mime_type, tamano, autor_id, autor_nombre, created_at
    FROM adjuntos
    WHERE entidad_tipo = ? AND entidad_id = ?
    ORDER BY id DESC
  `).all(tipo, Number(id));
}

export function saveAdjunto({ tipo, id, nombre, mime_type, data_base64, user }) {
  assertTipo(tipo);
  const safeOriginal = path.basename(String(nombre || 'archivo')).replace(/[^\w.\- ()]/g, '_') || 'archivo';
  const b64 = String(data_base64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!b64) throw new Error('El archivo está vacío');
  const buf = Buffer.from(b64, 'base64');
  if (buf.length > 10 * 1024 * 1024) throw new Error('El archivo supera el límite de 10 MB');

  const storedName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safeOriginal}`;
  fs.writeFileSync(path.join(getDbUploadsDir(), storedName), buf);

  const info = db.prepare(`
    INSERT INTO adjuntos (entidad_tipo, entidad_id, nombre_original, mime_type, tamano, ruta_relativa, autor_id, autor_nombre)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    tipo,
    Number(id),
    safeOriginal,
    String(mime_type || 'application/octet-stream'),
    buf.length,
    storedName,
    user?.id || null,
    user?.nombre || 'Sistema'
  );
  return Number(info.lastInsertRowid);
}

export function getAdjunto(adjuntoId) {
  const row = db.prepare('SELECT * FROM adjuntos WHERE id = ?').get(Number(adjuntoId));
  if (!row) return null;
  const perDbPath = path.join(getDbUploadsDir(), path.basename(row.ruta_relativa));
  const sharedUploadPath = path.join(UPLOADS_DIR, path.basename(row.ruta_relativa));
  const fullPath = fs.existsSync(perDbPath) ? perDbPath : sharedUploadPath;
  return { ...row, fullPath };
}

export function deleteAdjunto(adjuntoId) {
  const row = getAdjunto(adjuntoId);
  if (!row) return;
  db.prepare('DELETE FROM adjuntos WHERE id = ?').run(row.id);
  try {
    if (fs.existsSync(row.fullPath)) fs.unlinkSync(row.fullPath);
  } catch (_) { /* ignore */ }
}

export function getMetaBundle(tipo, id) {
  return {
    notas: listNotas(tipo, id),
    adjuntos: listAdjuntos(tipo, id),
  };
}
