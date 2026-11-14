import * as contactoSvc from '../services/comercial/contactoService.js';
import { getContactoCondiciones } from '../services/comercial/condicionesComercialesService.js';
import { json, parseBody } from './http.js';

export async function handleContactosRoutes(req, res, pathname) {
  if (pathname === '/api/contactos' && req.method === 'GET') {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    json(res, 200, contactoSvc.listContactos({
      es_proveedor: qs.get('es_proveedor') || undefined,
      es_cliente: qs.get('es_cliente') || undefined,
      es_taller: qs.get('es_taller') || undefined,
      search: qs.get('search') || undefined,
    }));
    return true;
  }
  if (pathname === '/api/contactos' && req.method === 'POST') {
    try { json(res, 201, { id: contactoSvc.createContacto(await parseBody(req)) }); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const condMatch = pathname.match(/^\/api\/contactos\/(\d+)\/condiciones$/);
  if (condMatch && req.method === 'GET') {
    const d = getContactoCondiciones(Number(condMatch[1]));
    if (!d) json(res, 404, { error: 'Contacto no encontrado' });
    else json(res, 200, d);
    return true;
  }
  const conMatch = pathname.match(/^\/api\/contactos\/(\d+)$/);
  if (conMatch && req.method === 'GET') {
    const d = contactoSvc.getContactoById(Number(conMatch[1]));
    if (!d) json(res, 404, { error: 'Contacto no encontrado' });
    else json(res, 200, d);
    return true;
  }
  if (conMatch && req.method === 'PUT') {
    try {
      if (!contactoSvc.updateContacto(Number(conMatch[1]), await parseBody(req))) json(res, 404, { error: 'Contacto no encontrado' });
      else json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (conMatch && req.method === 'DELETE') {
    try {
      if (!contactoSvc.deleteContacto(Number(conMatch[1]))) json(res, 404, { error: 'Contacto no encontrado' });
      else json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  return false;
}
