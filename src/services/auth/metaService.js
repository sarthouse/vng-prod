import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getCurrentDbName } from '../../db.js';
import { BaseRepository } from '../../core/BaseRepository.js';
import { MODELS } from '../../db/models.js';

const notaRepo = new BaseRepository({ model: MODELS.notas_internas });
const adjuntoRepo = new BaseRepository({ model: MODELS.adjuntos });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOADS_DIR = path.join(__dirname, '..', '..', '..', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function getDbUploadsDir() {
  const dir = path.join(UPLOADS_DIR, getCurrentDbName());
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const VALID_ENTIDADES = new Set([
  'compra', 'venta', 'movimiento', 'pago', 'cobro', 'orden', 'operacion_stock',
  'receta', 'pedido', 'presupuesto', 'contacto', 'plantilla', 'tarea',
]);

function assertTipo(tipo) {
  if (!VALID_ENTIDADES.has(tipo)) throw new Error('Tipo de entidad inválido');
}

export function listNotas(tipo, id) {
  assertTipo(tipo);
  return notaRepo.findWhere({ entidad_tipo: tipo, entidad_id: Number(id) }, { orderBy: 'id DESC' });
}

export function addNota({ tipo, id, contenido, user }) {
  assertTipo(tipo);
  const text = String(contenido || '').trim();
  if (!text) throw new Error('La nota no puede estar vacía');
  return notaRepo.create({
    entidad_tipo: tipo,
    entidad_id: Number(id),
    contenido: text,
    autor_id: user?.id || null,
    autor_nombre: user?.nombre || 'Sistema',
  });
}

export function deleteNota(notaId) {
  notaRepo.delete(Number(notaId));
}

export function listAdjuntos(tipo, id) {
  assertTipo(tipo);
  return adjuntoRepo.query()
    .select('id', 'entidad_tipo', 'entidad_id', 'nombre_original', 'mime_type', 'tamano', 'autor_id', 'autor_nombre', 'created_at')
    .where('entidad_tipo', tipo)
    .where('entidad_id', Number(id))
    .orderBy('id', 'DESC')
    .all();
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

  return adjuntoRepo.create({
    entidad_tipo: tipo,
    entidad_id: Number(id),
    nombre_original: safeOriginal,
    mime_type: String(mime_type || 'application/octet-stream'),
    tamano: buf.length,
    ruta_relativa: storedName,
    autor_id: user?.id || null,
    autor_nombre: user?.nombre || 'Sistema',
  });
}

export function getAdjunto(adjuntoId) {
  const row = adjuntoRepo.findById(Number(adjuntoId));
  if (!row) return null;
  const perDbPath = path.join(getDbUploadsDir(), path.basename(row.ruta_relativa));
  const sharedUploadPath = path.join(UPLOADS_DIR, path.basename(row.ruta_relativa));
  const fullPath = fs.existsSync(perDbPath) ? perDbPath : sharedUploadPath;
  return { ...row, fullPath };
}

export function deleteAdjunto(adjuntoId) {
  const row = getAdjunto(adjuntoId);
  if (!row) return;
  adjuntoRepo.delete(row.id);
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
