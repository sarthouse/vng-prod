import * as tareaSvc from '../services/tareas/tareaService.js';
import { json, parseBody } from './http.js';

export async function handleTareaRoutes(req, res, pathname, user = null) {
  const url = new URL(req.url, 'http://localhost');

  if (pathname === '/api/tareas/responsables' && req.method === 'GET') {
    json(res, 200, tareaSvc.listResponsables());
    return true;
  }

  if (pathname === '/api/tareas' && req.method === 'GET') {
    json(res, 200, tareaSvc.listTareas({
      estado: url.searchParams.get('estado') || '',
      responsable_id: url.searchParams.get('responsable_id') || '',
      vencimiento: url.searchParams.get('vencimiento') || '',
      q: url.searchParams.get('q') || '',
    }));
    return true;
  }

  if (pathname === '/api/tareas' && req.method === 'POST') {
    try {
      const b = await parseBody(req);
      const id = tareaSvc.createTarea(b, user);
      json(res, 201, { id });
    } catch (e) {
      json(res, 400, { error: e.message });
    }
    return true;
  }

  const m = pathname.match(/^\/api\/tareas\/(\d+)$/);
  if (m && req.method === 'GET') {
    const row = tareaSvc.getTareaById(Number(m[1]));
    if (!row) { json(res, 404, { error: 'Tarea no encontrada' }); return true; }
    json(res, 200, row);
    return true;
  }
  if (m && (req.method === 'PUT' || req.method === 'PATCH')) {
    try {
      const b = await parseBody(req);
      const ok = tareaSvc.updateTarea(Number(m[1]), b, user);
      if (!ok) { json(res, 404, { error: 'Tarea no encontrada' }); return true; }
      json(res, 200, { ok: true });
    } catch (e) {
      json(res, 400, { error: e.message });
    }
    return true;
  }
  if (m && req.method === 'DELETE') {
    tareaSvc.deleteTarea(Number(m[1]));
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}
