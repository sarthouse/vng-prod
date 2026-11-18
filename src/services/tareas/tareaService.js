import { BaseRepository } from '../../core/BaseRepository.js';
import { MODELS } from '../../db/models.js';

export const tareaRepo = new BaseRepository({ model: MODELS.tareas });
const usuarioRepo = new BaseRepository({ table: 'usuarios' });

const ESTADOS_VALIDOS = new Set(['Pendiente', 'En Proceso', 'En Revisión', 'Completada', 'Cancelada']);
const PRIORIDADES_VALIDAS = new Set(['Baja', 'Media', 'Alta', 'Urgente']);

function addDaysIso(iso, days) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + days));
  return dt.toISOString().slice(0, 10);
}

export function listResponsables() {
  return usuarioRepo.query()
    .select('id, nombre, username')
    .where('activo', 1)
    .orderBy('nombre', 'ASC')
    .all();
}

export function listTareas({ estado, responsable_id, vencimiento, q } = {}) {
  const qb = tareaRepo.query('t')
    .select(
      't.*',
      "COALESCE(u.nombre, 'Sin asignar') as responsable_nombre",
      "COALESCE(c.nombre, '') as contacto_nombre"
    )
    .leftJoin('usuarios', 'u', 'u.id', 't.responsable_id')
    .leftJoin('contactos', 'c', 'c.id', 't.contacto_id')
    .orderBy('t.orden', 'ASC')
    .orderBy('t.id', 'DESC');

  if (estado && ESTADOS_VALIDOS.has(estado)) {
    qb.where('t.estado', estado);
  }
  if (responsable_id === 'sin_asignar') {
    qb.whereNull('t.responsable_id');
  } else if (responsable_id) {
    qb.where('t.responsable_id', Number(responsable_id));
  }

  let rows = qb.all();

  const hoy = new Date().toISOString().slice(0, 10);
  const finSemana = addDaysIso(hoy, 7);

  if (vencimiento === 'vencidas') {
    rows = rows.filter(r => r.fecha_vencimiento && r.fecha_vencimiento < hoy && r.estado !== 'Completada' && r.estado !== 'Cancelada');
  } else if (vencimiento === 'hoy') {
    rows = rows.filter(r => r.fecha_vencimiento === hoy);
  } else if (vencimiento === 'semana') {
    rows = rows.filter(r => r.fecha_vencimiento && r.fecha_vencimiento >= hoy && r.fecha_vencimiento <= finSemana);
  } else if (vencimiento === 'sin_fecha') {
    rows = rows.filter(r => !r.fecha_vencimiento);
  }

  if (q && String(q).trim()) {
    const term = String(q).trim().toLowerCase();
    rows = rows.filter(r =>
      String(r.titulo || '').toLowerCase().includes(term)
      || String(r.responsable_nombre || '').toLowerCase().includes(term)
      || String(r.contacto_nombre || '').toLowerCase().includes(term)
    );
  }

  return rows;
}

export function getTareaById(id) {
  return tareaRepo.query('t')
    .select(
      't.*',
      "COALESCE(u.nombre, 'Sin asignar') as responsable_nombre",
      "COALESCE(c.nombre, '') as contacto_nombre"
    )
    .leftJoin('usuarios', 'u', 'u.id', 't.responsable_id')
    .leftJoin('contactos', 'c', 'c.id', 't.contacto_id')
    .where('t.id', Number(id))
    .get();
}

export function createTarea(b, user = null) {
  const titulo = String(b.titulo || '').trim();
  if (!titulo) throw new Error('El título de la tarea es obligatorio');
  const estado = ESTADOS_VALIDOS.has(b.estado) ? b.estado : 'Pendiente';
  const prioridad = PRIORIDADES_VALIDAS.has(b.prioridad) ? b.prioridad : 'Media';
  const hoy = new Date().toISOString().slice(0, 10);
  const payload = {
    titulo,
    descripcion: String(b.descripcion || ''),
    estado,
    prioridad,
    fecha_inicio: b.fecha_inicio ? String(b.fecha_inicio).slice(0, 10) : hoy,
    fecha_vencimiento: b.fecha_vencimiento ? String(b.fecha_vencimiento).slice(0, 10) : '',
    responsable_id: b.responsable_id ? Number(b.responsable_id) : (user?.id || null),
    contacto_id: b.contacto_id ? Number(b.contacto_id) : null,
    referencia_tipo: String(b.referencia_tipo || '').trim(),
    referencia_id: b.referencia_id ? Number(b.referencia_id) : null,
    orden: Number(b.orden) || 0,
    completada_en: estado === 'Completada' ? hoy : null,
  };
  tareaRepo.validate(payload);
  return tareaRepo.create(payload, user);
}

export function updateTarea(id, b, user = null) {
  const ex = tareaRepo.findById(Number(id));
  if (!ex) return false;
  const nextEstado = b.estado !== undefined && ESTADOS_VALIDOS.has(b.estado) ? b.estado : ex.estado;
  const hoy = new Date().toISOString().slice(0, 10);
  const payload = {
    titulo: b.titulo !== undefined ? (String(b.titulo || '').trim() || ex.titulo) : ex.titulo,
    descripcion: b.descripcion !== undefined ? String(b.descripcion || '') : ex.descripcion,
    estado: nextEstado,
    prioridad: b.prioridad !== undefined && PRIORIDADES_VALIDAS.has(b.prioridad) ? b.prioridad : ex.prioridad,
    fecha_inicio: b.fecha_inicio !== undefined ? String(b.fecha_inicio || '').slice(0, 10) : ex.fecha_inicio,
    fecha_vencimiento: b.fecha_vencimiento !== undefined ? String(b.fecha_vencimiento || '').slice(0, 10) : ex.fecha_vencimiento,
    responsable_id: b.responsable_id !== undefined ? (b.responsable_id ? Number(b.responsable_id) : null) : ex.responsable_id,
    contacto_id: b.contacto_id !== undefined ? (b.contacto_id ? Number(b.contacto_id) : null) : ex.contacto_id,
    referencia_tipo: b.referencia_tipo !== undefined ? String(b.referencia_tipo || '').trim() : ex.referencia_tipo,
    referencia_id: b.referencia_id !== undefined ? (b.referencia_id ? Number(b.referencia_id) : null) : ex.referencia_id,
    orden: b.orden !== undefined ? (Number(b.orden) || 0) : ex.orden,
    completada_en: nextEstado === 'Completada' ? (ex.completada_en || hoy) : null,
  };
  tareaRepo.validate(payload, { partial: true });
  tareaRepo.update(Number(id), payload, user);
  return true;
}

export function deleteTarea(id) {
  return tareaRepo.delete(Number(id));
}
