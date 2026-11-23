import * as nominaSvc from '../services/rrhh/nominaService.js';
import * as lsdSvc from '../services/afip/libroSueldosDigitalService.js';
import { generateNominaPdf } from '../services/print/nominaPdfService.js';
import { generateRecibosSueldoPdf } from '../services/print/reciboSueldoPdfService.js';
import { getConfig } from '../services/config/configService.js';
import { json, parseBody } from './http.js';

export async function handleNominaRoutes(req, res, pathname, user = null) {
  if (!pathname.startsWith('/api/nomina')) return false;
  const qs = new URL(req.url, 'http://localhost').searchParams;

  if (pathname === '/api/nomina/parametros' && req.method === 'GET') {
    json(res, 200, nominaSvc.getParametrosPrevisionales());
    return true;
  }
  if (pathname === '/api/nomina/parametros' && req.method === 'PUT') {
    try { json(res, 200, nominaSvc.updateParametrosPrevisionales(await parseBody(req))); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (pathname === '/api/nomina/conceptos' && req.method === 'GET') {
    json(res, 200, nominaSvc.listConceptos({ soloActivos: qs.get('activos') === '1' }));
    return true;
  }
  if (pathname === '/api/nomina/conceptos' && req.method === 'POST') {
    try { json(res, 201, { id: nominaSvc.createConcepto(await parseBody(req), user) }); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const nomConcMatch = pathname.match(/^\/api\/nomina\/conceptos\/(\d+)$/);
  if (nomConcMatch && req.method === 'PUT') {
    try {
      const ok = nominaSvc.updateConcepto(Number(nomConcMatch[1]), await parseBody(req), user);
      if (!ok) json(res, 404, { error: 'Concepto no encontrado' });
      else json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (nomConcMatch && req.method === 'DELETE') {
    try {
      const ok = nominaSvc.deleteConcepto(Number(nomConcMatch[1]));
      if (!ok) json(res, 404, { error: 'Concepto no encontrado' });
      else json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (pathname === '/api/nomina/lsd/conceptos.txt' && req.method === 'GET') {
    const txt = lsdSvc.exportarConceptosLsdTxt();
    const buf = Buffer.from(txt, 'utf8');
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': 'attachment; filename="ARCA_LSD_Conceptos.txt"',
      'Content-Length': buf.length,
    });
    res.end(buf);
    return true;
  }
  if (pathname === '/api/nomina/empleados' && req.method === 'GET') {
    json(res, 200, nominaSvc.listEmpleados({ soloActivos: qs.get('activos') === '1' }));
    return true;
  }
  if (pathname === '/api/nomina/empleados' && req.method === 'POST') {
    try { json(res, 201, { id: nominaSvc.createEmpleado(await parseBody(req), user) }); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const empMatch = pathname.match(/^\/api\/nomina\/empleados\/(\d+)$/);
  if (empMatch && req.method === 'GET') {
    const det = nominaSvc.getEmpleadoDetalle(Number(empMatch[1]));
    if (!det) json(res, 404, { error: 'Empleado no encontrado' });
    else json(res, 200, det);
    return true;
  }
  if (empMatch && req.method === 'PUT') {
    try {
      const ok = nominaSvc.updateEmpleado(Number(empMatch[1]), await parseBody(req), user);
      if (!ok) json(res, 404, { error: 'Empleado no encontrado' });
      else json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (empMatch && req.method === 'DELETE') {
    try {
      const ok = nominaSvc.deleteEmpleado(Number(empMatch[1]));
      if (!ok) json(res, 404, { error: 'Empleado no encontrado' });
      else json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (pathname === '/api/nomina/licencias' && req.method === 'GET') {
    json(res, 200, nominaSvc.listLicencias({
      empleado_id: qs.get('empleado_id') ? Number(qs.get('empleado_id')) : undefined,
      periodo: qs.get('periodo') || undefined,
      tipo: qs.get('tipo') || undefined,
      estado: qs.get('estado') || undefined,
    }));
    return true;
  }
  if (pathname === '/api/nomina/licencias' && req.method === 'POST') {
    try { json(res, 201, { id: nominaSvc.createLicencia(await parseBody(req), user) }); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const licMatch = pathname.match(/^\/api\/nomina\/licencias\/(\d+)$/);
  if (licMatch && req.method === 'PUT') {
    try {
      const ok = nominaSvc.updateLicencia(Number(licMatch[1]), await parseBody(req), user);
      if (!ok) json(res, 404, { error: 'Licencia no encontrada' });
      else json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (licMatch && req.method === 'DELETE') {
    const ok = nominaSvc.deleteLicencia(Number(licMatch[1]));
    if (!ok) json(res, 404, { error: 'Licencia no encontrada' });
    else json(res, 200, { ok: true });
    return true;
  }
  if (pathname === '/api/nomina/liquidaciones' && req.method === 'GET') {
    json(res, 200, nominaSvc.listLiquidaciones());
    return true;
  }
  if (pathname === '/api/nomina/liquidaciones' && req.method === 'POST') {
    try { json(res, 201, { id: nominaSvc.createLiquidacion(await parseBody(req), user) }); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const recUpdMatch = pathname.match(/^\/api\/nomina\/recibos\/(\d+)$/);
  if (recUpdMatch && req.method === 'PUT') {
    try {
      const ok = nominaSvc.updateRecibo(Number(recUpdMatch[1]), await parseBody(req), user);
      if (!ok) json(res, 404, { error: 'Recibo no encontrado' });
      else json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const recNovMatch = pathname.match(/^\/api\/nomina\/recibos\/(\d+)\/novedades$/);
  if (recNovMatch && req.method === 'POST') {
    try {
      await nominaSvc.addReciboNovedad(Number(recNovMatch[1]), await parseBody(req), user);
      json(res, 201, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const recLinDelMatch = pathname.match(/^\/api\/nomina\/recibo-lineas\/(\d+)$/);
  if (recLinDelMatch && req.method === 'PUT') {
    try {
      const ok = nominaSvc.updateReciboLinea(Number(recLinDelMatch[1]), await parseBody(req), user);
      if (!ok) json(res, 404, { error: 'Línea no encontrada' });
      else json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (recLinDelMatch && req.method === 'DELETE') {
    try {
      const ok = nominaSvc.deleteReciboLinea(Number(recLinDelMatch[1]), user);
      if (!ok) json(res, 404, { error: 'Línea no encontrada' });
      else json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const liqLsdMatch = pathname.match(/^\/api\/nomina\/liquidaciones\/(\d+)\/lsd\.txt$/);
  if (liqLsdMatch && req.method === 'GET') {
    try {
      const txt = lsdSvc.exportarLiquidacionLsdTxt(Number(liqLsdMatch[1]));
      const buf = Buffer.from(txt, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="ARCA_LSD_Liq_${liqLsdMatch[1]}.txt"`,
        'Content-Length': buf.length,
      });
      res.end(buf);
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const liqF931Match = pathname.match(/^\/api\/nomina\/liquidaciones\/(\d+)\/f931$/);
  if (liqF931Match && req.method === 'GET') {
    try { json(res, 200, lsdSvc.getPapelTrabajoF931(Number(liqF931Match[1]))); }
    catch (e) { json(res, 404, { error: e.message }); }
    return true;
  }
  const liqRecPdfMatch = pathname.match(/^\/api\/nomina\/liquidaciones\/(\d+)\/recibos-pdf$/);
  if (liqRecPdfMatch && (req.method === 'POST' || req.method === 'GET')) {
    const det = nominaSvc.getLiquidacionById(Number(liqRecPdfMatch[1]));
    if (!det) { json(res, 404, { error: 'Liquidación no encontrada' }); return true; }
    const emp = getConfig()?.empresa || {};
    const params = nominaSvc.getParametrosPrevisionales();
    const body = req.method === 'POST' ? await parseBody(req).catch(() => ({})) : {};
    const reciboId = qs.get('recibo_id') || body.recibo_id || null;
    const pdfBuf = generateRecibosSueldoPdf(det, emp, { reciboId, params });
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="Recibos_Sueldo_${det.liquidacion.periodo || liqRecPdfMatch[1]}.pdf"`,
      'Content-Length': pdfBuf.length,
      'Cache-Control': 'no-store',
    });
    res.end(pdfBuf);
    return true;
  }
  const liqPdfMatch = pathname.match(/^\/api\/nomina\/liquidaciones\/(\d+)\/pdf$/);
  if (liqPdfMatch && (req.method === 'POST' || req.method === 'GET')) {
    const det = nominaSvc.getLiquidacionById(Number(liqPdfMatch[1]));
    if (!det) { json(res, 404, { error: 'Liquidación no encontrada' }); return true; }
    const emp = getConfig()?.empresa || {};
    const pdfBuf = generateNominaPdf({ ...det, items: det.recibos }, emp);
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="Liquidacion_Sueldos_${det.liquidacion.periodo || liqPdfMatch[1]}.pdf"`,
      'Content-Length': pdfBuf.length,
      'Cache-Control': 'no-store',
    });
    res.end(pdfBuf);
    return true;
  }
  const liqConfMatch = pathname.match(/^\/api\/nomina\/liquidaciones\/(\d+)\/confirmar$/);
  if (liqConfMatch && req.method === 'POST') {
    try {
      const ok = nominaSvc.confirmarLiquidacion(Number(liqConfMatch[1]), user);
      if (!ok) json(res, 404, { error: 'Liquidación no encontrada' });
      else json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const liqAnulMatch = pathname.match(/^\/api\/nomina\/liquidaciones\/(\d+)\/anular$/);
  if (liqAnulMatch && req.method === 'POST') {
    try {
      const ok = nominaSvc.anularLiquidacion(Number(liqAnulMatch[1]), user);
      if (!ok) json(res, 404, { error: 'Liquidación no encontrada' });
      else json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const liqMatch = pathname.match(/^\/api\/nomina\/liquidaciones\/(\d+)$/);
  if (liqMatch && req.method === 'GET') {
    const det = nominaSvc.getLiquidacionById(Number(liqMatch[1]));
    if (!det) json(res, 404, { error: 'Liquidación no encontrada' });
    else json(res, 200, det);
    return true;
  }
  if (liqMatch && req.method === 'DELETE') {
    try {
      const ok = nominaSvc.deleteLiquidacion(Number(liqMatch[1]));
      if (!ok) json(res, 404, { error: 'Liquidación no encontrada' });
      else json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }

  return false;
}
