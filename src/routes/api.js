import { hasActiveDatabase } from '../db.js';
import * as authSvc from '../services/auth/authService.js';
import { json, parseBody } from './http.js';
import { getConfig } from '../services/config/configService.js';
import { generateRemitoPdf } from '../services/print/remitoPdfService.js';
import { generateVentaPdf } from '../services/print/ventaPdfService.js';
import { handlePublicAuthRoutes, handleAdminAuthRoutes } from './authRoutes.js';
import { handleDbRoutes } from './dbRoutes.js';
import { handleMetaRoutes } from './metaRoutes.js';
import { handleConfigRoutes } from './configRoutes.js';
import { handleInventarioRoutes } from './inventarioRoutes.js';
import { handleProduccionRoutes } from './produccionRoutes.js';
import { handleComprasRoutes } from './comprasRoutes.js';
import { handleVentasRoutes } from './ventasRoutes.js';
import { handleTesoreriaRoutes } from './tesoreriaRoutes.js';
import { handleContactosRoutes } from './contactosRoutes.js';
import { handleFiscalRoutes } from './fiscalRoutes.js';

export { json };

export async function handleApi(req, res, pathname) {
  if (await handleDbRoutes(req, res, pathname)) return;

  if (!hasActiveDatabase()) {
    if (pathname === '/api/auth/status' && req.method === 'GET') {
      return json(res, 200, { needs_db: true, needs_setup: false });
    }
    if (pathname === '/api/auth/me' && req.method === 'GET') {
      return json(res, 401, { error: 'No hay base de datos activa', needs_db: true });
    }
    return json(res, 400, { error: 'No hay base de datos activa. Creá o seleccioná una instancia primero.' });
  }

  if (await handlePublicAuthRoutes(req, res, pathname)) return;

  // --- GATE DE SESIÓN Y PERMISOS ---
  const user = authSvc.getSessionUser(req);
  if (!user) {
    return json(res, 401, { error: 'Sesión expirada o no autenticado' });
  }
  const deny = (perm) => {
    if (!authSvc.hasPermission(user, perm)) {
      json(res, 403, { error: `Permiso denegado (${perm})` });
      return true;
    }
    return false;
  };
  const hasAny = (perms) => perms.some(p => authSvc.hasPermission(user, p));
  const isWrite = req.method !== 'GET';
  if ((pathname.startsWith('/api/permisos') || pathname.startsWith('/api/grupos') || pathname.startsWith('/api/usuarios')) && deny('sistema.usuarios')) return;
  if (isWrite && (pathname.startsWith('/api/categorias') || pathname.startsWith('/api/unidades') || pathname.startsWith('/api/variantes') || pathname.startsWith('/api/puntos-venta') || pathname.startsWith('/api/empresa') || pathname.startsWith('/api/etapas') || pathname.startsWith('/api/importar') || pathname.startsWith('/api/impuestos') || pathname.startsWith('/api/afip')) && deny('sistema.config')) return;
  if (pathname === '/api/afip/csr/download' && deny('sistema.config')) return;
  if (pathname.startsWith('/api/contactos')) {
    if (isWrite) {
      if (!hasAny(['comercial.editar', 'compras.editar', 'ventas.editar'])) {
        if (deny('comercial.editar')) return;
      }
    } else if (!hasAny(['comercial.ver', 'compras.ver', 'ventas.ver', 'produccion.ver', 'inventario.ver', 'tesoreria.ver', 'contabilidad.ver'])) {
      if (deny('comercial.ver')) return;
    }
  }
  if (pathname.startsWith('/api/compras')) {
    if (!hasAny(isWrite ? ['comercial.editar', 'compras.editar'] : ['comercial.ver', 'compras.ver'])) {
      if (deny(isWrite ? 'comercial.editar' : 'comercial.ver')) return;
    }
  }
  if (pathname.startsWith('/api/ventas')) {
    if (!hasAny(isWrite ? ['comercial.editar', 'ventas.editar'] : ['comercial.ver', 'ventas.ver'])) {
      if (deny(isWrite ? 'comercial.editar' : 'comercial.ver')) return;
    }
  }
  if (pathname.startsWith('/api/contabilidad/')) {
    if (deny(isWrite ? 'contabilidad.editar' : 'contabilidad.ver')) return;
  }
  if (pathname.startsWith('/api/fiscal')) {
    if (pathname === '/api/fiscal/jurisdicciones' || pathname === '/api/fiscal/sugerir-percepciones') {
      if (!hasAny(['comercial.ver', 'ventas.ver', 'compras.ver', 'contabilidad.ver'])) {
        if (deny('contabilidad.ver')) return;
      }
    } else if (deny(isWrite ? 'contabilidad.editar' : 'contabilidad.ver')) {
      return;
    }
  }
  if (
    pathname.startsWith('/api/tesoreria/asientos') ||
    pathname.startsWith('/api/tesoreria/balance') ||
    pathname.startsWith('/api/tesoreria/libro-mayor') ||
    pathname.startsWith('/api/tesoreria/estado-resultados') ||
    pathname.startsWith('/api/tesoreria/plan-cuentas') ||
    pathname.startsWith('/api/tesoreria/diarios')
  ) {
    if (deny(isWrite ? 'contabilidad.editar' : 'contabilidad.ver')) return;
  } else if (pathname.startsWith('/api/tesoreria')) {
    if (deny(isWrite ? 'tesoreria.editar' : 'tesoreria.ver')) return;
  }
  if (pathname.startsWith('/api/inventario') || pathname.startsWith('/api/movimientos-stock') || pathname.startsWith('/api/ubicaciones') || pathname.startsWith('/api/stock-quants') || pathname.startsWith('/api/remitos') || pathname.startsWith('/api/lotes') || pathname.startsWith('/api/operaciones-stock')) {
    if (deny(isWrite ? 'inventario.editar' : 'inventario.ver')) return;
  }
  if (pathname.startsWith('/api/productos') || pathname.startsWith('/api/plantillas')) {
    if (isWrite) {
      if (deny('inventario.editar')) return;
    } else if (!hasAny(['inventario.ver', 'produccion.ver', 'comercial.ver', 'compras.ver', 'ventas.ver'])) {
      if (deny('inventario.ver')) return;
    }
  }
  if (
    pathname.startsWith('/api/ordenes') ||
    pathname.startsWith('/api/orden-etapas') ||
    pathname.startsWith('/api/cronograma-compras') ||
    pathname.startsWith('/api/recetas') ||
    pathname.startsWith('/api/curva') ||
    pathname.startsWith('/api/presupuesto') ||
    pathname.startsWith('/api/pedidos') ||
    pathname.startsWith('/api/entregas') ||
    pathname.startsWith('/api/pendientes') ||
    pathname.startsWith('/api/costos')
  ) {
    if (deny(isWrite ? 'produccion.editar' : 'produccion.ver')) return;
  }

  if (pathname === '/api/print/remito-pdf' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const emp = body.empresa || getConfig()?.empresa || {};
      const pdfBuf = generateRemitoPdf(body, emp);
      const safeName = String(body.numero || 'remito').replace(/[^a-zA-Z0-9_-]+/g, '_');
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="Remito_${safeName}.pdf"`,
        'Content-Length': pdfBuf.length,
        'Cache-Control': 'no-store',
      });
      res.end(pdfBuf);
    } catch (e) {
      json(res, 400, { error: e.message });
    }
    return;
  }
  if (pathname === '/api/print/venta-pdf' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const emp = body.empresa || getConfig()?.empresa || {};
      const pdfBuf = generateVentaPdf(body, emp);
      const safeName = String(body.venta?.numero || body.venta?.id || 'comprobante').replace(/[^a-zA-Z0-9_-]+/g, '_');
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="Comprobante_${safeName}.pdf"`,
        'Content-Length': pdfBuf.length,
        'Cache-Control': 'no-store',
      });
      res.end(pdfBuf);
    } catch (e) {
      json(res, 400, { error: e.message });
    }
    return;
  }

  if (await handleAdminAuthRoutes(req, res, pathname)) return;
  if (await handleMetaRoutes(req, res, pathname, user)) return;
  if (await handleConfigRoutes(req, res, pathname)) return;
  if (await handleInventarioRoutes(req, res, pathname, user)) return;
  if (await handleProduccionRoutes(req, res, pathname, user)) return;
  if (await handleComprasRoutes(req, res, pathname, user)) return;
  if (await handleVentasRoutes(req, res, pathname, user)) return;
  if (await handleTesoreriaRoutes(req, res, pathname, user)) return;
  if (await handleContactosRoutes(req, res, pathname)) return;
  if (await handleFiscalRoutes(req, res, pathname)) return;

  return json(res, 404, { error: 'Endpoint no encontrado' });
}
