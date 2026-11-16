import * as configSvc from '../services/config/configService.js';
import * as importSvc from '../services/config/importService.js';
import * as afipSvc from '../services/afip/afipService.js';
import { json, parseBody } from './http.js';

export async function handleConfigRoutes(req, res, pathname) {
  if (pathname === '/api/config' && req.method === 'GET') {
    json(res, 200, configSvc.getConfig());
    return true;
  }
  if (pathname === '/api/categorias' && req.method === 'GET') {
    json(res, 200, configSvc.getConfig().categorias || []);
    return true;
  }

  if (pathname === '/api/categorias' && req.method === 'POST') {
    const b = await parseBody(req);
    if (!b.nombre?.trim()) { json(res, 400, { error: 'El nombre es obligatorio' }); return true; }
    try {
      json(res, 201, {
        id: configSvc.createCategoria({
          nombre: b.nombre,
          padre_id: b.padre_id,
          descripcion: b.descripcion,
        }),
      });
    }
    catch (e) {
      if (String(e.message).includes('UNIQUE')) { json(res, 409, { error: 'Esa categoría ya existe.' }); return true; }
      throw e;
    }
    return true;
  }
  const catMatch = pathname.match(/^\/api\/categorias\/(\d+)$/);
  if (catMatch && req.method === 'PUT') {
    const b = await parseBody(req);
    if (!b.nombre?.trim()) { json(res, 400, { error: 'El nombre es obligatorio' }); return true; }
    try {
      const ok = configSvc.updateCategoria(Number(catMatch[1]), {
        nombre: b.nombre,
        padre_id: b.padre_id,
        descripcion: b.descripcion,
      });
      if (!ok) json(res, 404, { error: 'Categoría no encontrada' });
      else json(res, 200, { ok: true });
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) { json(res, 409, { error: 'Esa categoría ya existe.' }); return true; }
      throw e;
    }
    return true;
  }
  if (catMatch && req.method === 'DELETE') {
    configSvc.deleteCategoria(Number(catMatch[1]));
    json(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/unidades' && req.method === 'GET') {
    json(res, 200, configSvc.getConfig().unidades || []);
    return true;
  }
  if (pathname === '/api/unidades' && req.method === 'POST') {
    const b = await parseBody(req);
    if (!b.nombre?.trim() || !b.grupo?.trim()) { json(res, 400, { error: 'Nombre y grupo son obligatorios' }); return true; }
    try { json(res, 201, { id: configSvc.createUnidad(b) }); }
    catch (e) {
      if (String(e.message).includes('UNIQUE')) { json(res, 409, { error: 'Esa unidad ya existe.' }); return true; }
      throw e;
    }
    return true;
  }
  const unitMatch = pathname.match(/^\/api\/unidades\/(\d+)$/);
  if (unitMatch && req.method === 'PUT') {
    configSvc.updateUnidad(Number(unitMatch[1]), await parseBody(req));
    json(res, 200, { ok: true });
    return true;
  }
  if (unitMatch && req.method === 'DELETE') {
    configSvc.deleteUnidad(Number(unitMatch[1]));
    json(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/variantes' && req.method === 'GET') {
    json(res, 200, configSvc.getConfig().variantes || []);
    return true;
  }
  if (pathname === '/api/variantes' && req.method === 'POST') {
    const b = await parseBody(req);
    if (!b.atributo?.trim() || !b.valor?.trim()) { json(res, 400, { error: 'Atributo y valor son obligatorios' }); return true; }
    try { json(res, 201, { id: configSvc.createVariante(b) }); }
    catch (e) {
      if (String(e.message).includes('UNIQUE')) { json(res, 409, { error: 'Esa variante ya existe.' }); return true; }
      throw e;
    }
    return true;
  }
  if (pathname === '/api/variantes/seed-talles' && req.method === 'POST') {
    configSvc.seedTallesVariantes();
    json(res, 200, { ok: true });
    return true;
  }
  const varMatch = pathname.match(/^\/api\/variantes\/(\d+)$/);
  if (varMatch && req.method === 'DELETE') {
    configSvc.deleteVariante(Number(varMatch[1]));
    json(res, 200, { ok: true });
    return true;
  }
  const varAttrMatch = pathname.match(/^\/api\/variantes\/atributo\/(.+)$/);
  if (varAttrMatch && req.method === 'DELETE') {
    configSvc.deleteVarianteAtributo(decodeURIComponent(varAttrMatch[1]));
    json(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/puntos-venta' && req.method === 'GET') {
    json(res, 200, configSvc.listPuntosVenta());
    return true;
  }
  if (pathname === '/api/puntos-venta' && req.method === 'POST') {
    const b = await parseBody(req);
    try { json(res, 201, { id: configSvc.createPuntoVenta(b) }); }
    catch (e) {
      if (String(e.message).includes('UNIQUE')) json(res, 409, { error: 'Ya existe un punto de venta con ese número.' });
      else json(res, 400, { error: e.message });
    }
    return true;
  }
  const pvMatch = pathname.match(/^\/api\/puntos-venta\/(\d+)$/);
  if (pvMatch && req.method === 'PUT') {
    const b = await parseBody(req);
    try {
      if (!configSvc.updatePuntoVenta(Number(pvMatch[1]), b)) json(res, 404, { error: 'Punto de venta no encontrado' });
      else json(res, 200, { ok: true });
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) json(res, 409, { error: 'Ya existe un punto de venta con ese número.' });
      else json(res, 400, { error: e.message });
    }
    return true;
  }
  if (pvMatch && req.method === 'DELETE') {
    try { configSvc.deletePuntoVenta(Number(pvMatch[1])); json(res, 200, { ok: true }); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (pathname === '/api/secuencias/siguiente' && req.method === 'GET') {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    const pv = qs.get('pv') ?? qs.get('punto_venta');
    json(res, 200, configSvc.getNextNumeroDocumento(qs.get('tipo') || 'venta', pv));
    return true;
  }
  if (pathname === '/api/secuencias' && req.method === 'GET') {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    json(res, 200, configSvc.listSecuencias({ dominio: qs.get('dominio') || undefined }));
    return true;
  }
  if (pathname === '/api/secuencias' && req.method === 'POST') {
    try { json(res, 201, { id: configSvc.createSecuencia(await parseBody(req)) }); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const seqMatch = pathname.match(/^\/api\/secuencias\/(\d+)$/);
  if (seqMatch && req.method === 'PUT') {
    try {
      const ok = configSvc.updateSecuencia(Number(seqMatch[1]), await parseBody(req));
      if (!ok) json(res, 404, { error: 'Secuencia no encontrada' });
      else json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (seqMatch && req.method === 'DELETE') {
    configSvc.deleteSecuencia(Number(seqMatch[1]));
    json(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/empresa' && req.method === 'GET') {
    json(res, 200, configSvc.getEmpresaConfig());
    return true;
  }
  if (pathname === '/api/empresa' && req.method === 'PUT') {
    json(res, 200, configSvc.updateEmpresaConfig(await parseBody(req)));
    return true;
  }

  if (pathname === '/api/impuestos' && req.method === 'GET') {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    json(res, 200, configSvc.listImpuestos({
      aplica_a: qs.get('aplica_a') || undefined,
      tipo: qs.get('tipo') || undefined,
      solo_activos: qs.get('solo_activos') === '1',
    }));
    return true;
  }
  if (pathname === '/api/impuestos' && req.method === 'POST') {
    try { json(res, 201, { id: configSvc.createImpuesto(await parseBody(req)) }); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const impMatch = pathname.match(/^\/api\/impuestos\/(\d+)$/);
  if (impMatch && req.method === 'PUT') {
    if (!configSvc.updateImpuesto(Number(impMatch[1]), await parseBody(req))) json(res, 404, { error: 'Impuesto no encontrado' });
    else json(res, 200, { ok: true });
    return true;
  }
  if (impMatch && req.method === 'DELETE') {
    configSvc.deleteImpuesto(Number(impMatch[1]));
    json(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/importar/contactos' && req.method === 'POST') {
    const b = await parseBody(req);
    json(res, 200, importSvc.importContactos(b.rows || []));
    return true;
  }
  if (pathname === '/api/importar/proveedores' && req.method === 'POST') {
    const b = await parseBody(req);
    json(res, 200, importSvc.importContactos(b.rows || [], { es_proveedor: true }));
    return true;
  }
  if (pathname === '/api/importar/productos' && req.method === 'POST') {
    const b = await parseBody(req);
    json(res, 200, importSvc.importProductos(b.rows || []));
    return true;
  }
  if (pathname === '/api/importar/clientes' && req.method === 'POST') {
    const b = await parseBody(req);
    json(res, 200, importSvc.importContactos(b.rows || [], { es_cliente: true }));
    return true;
  }

  if (pathname === '/api/etapas' && req.method === 'POST') {
    const b = await parseBody(req);
    if (!b.nombre?.trim()) { json(res, 400, { error: 'El nombre de la etapa es obligatorio' }); return true; }
    try { json(res, 201, { id: configSvc.createEtapa(b) }); }
    catch (e) {
      if (String(e.message).includes('UNIQUE')) { json(res, 409, { error: 'Esa etapa ya existe.' }); return true; }
      throw e;
    }
    return true;
  }
  const etapaCfgMatch = pathname.match(/^\/api\/etapas\/(\d+)$/);
  if (etapaCfgMatch && req.method === 'PUT') {
    if (!configSvc.updateEtapa(Number(etapaCfgMatch[1]), await parseBody(req))) json(res, 404, { error: 'Etapa no encontrada' });
    else json(res, 200, { ok: true });
    return true;
  }
  if (etapaCfgMatch && req.method === 'DELETE') {
    configSvc.deleteEtapa(Number(etapaCfgMatch[1]));
    json(res, 200, { ok: true });
    return true;
  }

  // ── AFIP / ARCA Facturación Electrónica y Padrón ────────────────────────
  if (pathname === '/api/afip/config' && req.method === 'GET') {
    json(res, 200, afipSvc.getAfipStatus());
    return true;
  }
  if (pathname === '/api/afip/generar-keys' && req.method === 'POST') {
    try {
      const b = await parseBody(req);
      json(res, 200, afipSvc.generarAfipKeys({ cn: b.cn || 'vanguard' }));
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (pathname === '/api/afip/csr/download' && req.method === 'GET') {
    try {
      const csr = afipSvc.getAfipCsr();
      res.writeHead(200, {
        'Content-Type': 'application/pkcs10',
        'Content-Disposition': 'attachment; filename="afip_solicitud.csr"',
      });
      res.end(csr);
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (pathname === '/api/afip/subir-crt' && req.method === 'POST') {
    try {
      const b = await parseBody(req);
      json(res, 200, afipSvc.guardarAfipCertificado(b.crt || ''));
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (pathname === '/api/afip/entorno' && req.method === 'PUT') {
    try {
      const b = await parseBody(req);
      json(res, 200, afipSvc.setAfipEntorno(b.entorno));
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (pathname === '/api/afip/estado' && req.method === 'GET') {
    try { json(res, 200, await afipSvc.checkEstadoAfip()); }
    catch (e) { json(res, 502, { error: e.message }); }
    return true;
  }
  const padronMatch = pathname.match(/^\/api\/afip\/padron\/(\d{7,15})$/);
  if (padronMatch && req.method === 'GET') {
    try { json(res, 200, await afipSvc.consultarPadronAfip(padronMatch[1])); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (pathname === '/api/afip/xml' && req.method === 'GET') {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    json(res, 200, afipSvc.listAfipXmlLogs({
      entidad_tipo: qs.get('entidad_tipo') || undefined,
      entidad_id: qs.get('entidad_id') || undefined,
      entorno: qs.get('entorno') || undefined,
    }));
    return true;
  }
  const xmlDlMatch = pathname.match(/^\/api\/afip\/xml\/(\d+)\/download$/);
  if (xmlDlMatch && req.method === 'GET') {
    const log = afipSvc.getAfipXmlLogById(Number(xmlDlMatch[1]));
    if (!log) { json(res, 404, { error: 'Registro XML no encontrado' }); return true; }
    const qs = new URL(req.url, 'http://localhost').searchParams;
    const parte = qs.get('parte') === 'req' ? 'req' : 'res';
    const xml = parte === 'req' ? log.request_xml : log.response_xml;
    if (!xml) { json(res, 404, { error: 'XML vacío' }); return true; }
    const fname = `${log.entorno}_${log.servicio}_${log.operacion}_${log.id}_${parte}.xml`;
    res.writeHead(200, {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fname}"`,
    });
    res.end(xml);
    return true;
  }

  return false;
}
