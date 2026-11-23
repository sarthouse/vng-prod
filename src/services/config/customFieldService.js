import { BaseRepository } from '../../core/BaseRepository.js';
import {
  parseOpciones,
  parseCustomFields,
  validateAndMergeCustomFieldsWithDefs,
} from '../../core/customFields.js';
import { MODELS } from '../../db/models.js';

export { parseOpciones, parseCustomFields };

export const CUSTOM_FIELD_ENTITIES = [
  'contactos',
  'producto_plantillas',
  'productos',
  'empleados',
  'ordenes_produccion',
];

const SYSTEM_COLS = new Set([
  'id', 'created_at', 'updated_at',
  'autor_id', 'autor_nombre',
  'actualizado_por_id', 'actualizado_por_nombre',
  'custom_fields', 'custom_fields_json',
]);

const SNAKE_CASE_RE = /^[a-z][a-z0-9_]*$/;

export const customFieldDefRepo = new BaseRepository({ model: MODELS.custom_field_defs });

function badRequest(msg) {
  const err = new Error(msg);
  err.status = 400;
  return err;
}

export function assertValidEntidad(entidad) {
  const e = String(entidad || '').trim();
  if (!CUSTOM_FIELD_ENTITIES.includes(e)) {
    throw badRequest(`Entidad inválida para campo personalizado: "${e}"`);
  }
  return e;
}

export function assertNoNativeCollision(entidad, nombreTecnico) {
  const e = assertValidEntidad(entidad);
  const k = String(nombreTecnico || '').trim();
  if (!SNAKE_CASE_RE.test(k)) {
    throw badRequest(`El nombre técnico "${k}" debe ser snake_case (ej: horma_codigo)`);
  }
  const nativeFields = Object.keys(MODELS[e]?.fields || {});
  if (SYSTEM_COLS.has(k) || nativeFields.includes(k)) {
    throw badRequest(`El nombre técnico "${k}" colisiona con una columna nativa de ${e}`);
  }
  return k;
}

export function listCustomFieldDefs({ entidad = null, soloActivos = false, db = null } = {}) {
  const repo = db ? new BaseRepository({ model: MODELS.custom_field_defs, db }) : customFieldDefRepo;
  const qb = repo.query();
  if (entidad) qb.where('entidad', assertValidEntidad(entidad));
  if (soloActivos) qb.where('activo', 1);
  return qb.orderBy('entidad', 'ASC').orderBy('orden', 'ASC').orderBy('id', 'ASC').all();
}

export function getCustomFieldDefById(id) {
  return customFieldDefRepo.findById(Number(id));
}

export function createCustomFieldDef(b = {}, actor = null) {
  const entidad = assertValidEntidad(b.entidad);
  const nombre_tecnico = assertNoNativeCollision(entidad, b.nombre_tecnico);
  const etiqueta = String(b.etiqueta || '').trim();
  if (!etiqueta) throw badRequest('La etiqueta es obligatoria');

  const opciones = parseOpciones(b.opciones_json ?? b.opciones);
  const payload = customFieldDefRepo.validate({
    entidad,
    nombre_tecnico,
    etiqueta,
    tipo: b.tipo || 'text',
    opciones_json: JSON.stringify(opciones),
    requerido: b.requerido ? 1 : 0,
    visible_en_grilla: b.visible_en_grilla === undefined ? 1 : (b.visible_en_grilla ? 1 : 0),
    visible_en_pdf: b.visible_en_pdf ? 1 : 0,
    orden: Number(b.orden || 0),
    activo: b.activo === undefined ? 1 : (b.activo ? 1 : 0),
  });

  const dup = customFieldDefRepo.findBy({ entidad, nombre_tecnico });
  if (dup) throw badRequest(`Ya existe el campo "${nombre_tecnico}" en ${entidad}`);

  return customFieldDefRepo.create(payload, actor);
}

export function updateCustomFieldDef(id, b = {}, actor = null) {
  const cur = customFieldDefRepo.findById(Number(id));
  if (!cur) return false;

  const entidad = b.entidad !== undefined ? assertValidEntidad(b.entidad) : cur.entidad;
  const nombre_tecnico = b.nombre_tecnico !== undefined
    ? assertNoNativeCollision(entidad, b.nombre_tecnico)
    : cur.nombre_tecnico;

  if (entidad !== cur.entidad || nombre_tecnico !== cur.nombre_tecnico) {
    assertNoNativeCollision(entidad, nombre_tecnico);
    const dup = customFieldDefRepo.findBy({ entidad, nombre_tecnico });
    if (dup && Number(dup.id) !== Number(id)) {
      throw badRequest(`Ya existe el campo "${nombre_tecnico}" en ${entidad}`);
    }
  }

  const patch = {};
  if (b.entidad !== undefined) patch.entidad = entidad;
  if (b.nombre_tecnico !== undefined) patch.nombre_tecnico = nombre_tecnico;
  if (b.etiqueta !== undefined) {
    const etq = String(b.etiqueta || '').trim();
    if (!etq) throw badRequest('La etiqueta no puede estar vacía');
    patch.etiqueta = etq;
  }
  if (b.tipo !== undefined) patch.tipo = b.tipo;
  if (b.opciones_json !== undefined || b.opciones !== undefined) {
    patch.opciones_json = JSON.stringify(parseOpciones(b.opciones_json ?? b.opciones));
  }
  if (b.requerido !== undefined) patch.requerido = b.requerido ? 1 : 0;
  if (b.visible_en_grilla !== undefined) patch.visible_en_grilla = b.visible_en_grilla ? 1 : 0;
  if (b.visible_en_pdf !== undefined) patch.visible_en_pdf = b.visible_en_pdf ? 1 : 0;
  if (b.orden !== undefined) patch.orden = Number(b.orden || 0);
  if (b.activo !== undefined) patch.activo = b.activo ? 1 : 0;

  customFieldDefRepo.validate(patch, { partial: true });
  return customFieldDefRepo.update(Number(id), patch, actor);
}

export function deleteCustomFieldDef(id) {
  return customFieldDefRepo.delete(Number(id));
}

export function validateAndMergeCustomFields(entidad, existingJson, patchObj, { partial = false, db = null } = {}) {
  const defs = listCustomFieldDefs({ entidad, soloActivos: true, db });
  return validateAndMergeCustomFieldsWithDefs(defs, existingJson, patchObj, { partial });
}
