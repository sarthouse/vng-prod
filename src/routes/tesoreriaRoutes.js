import * as tesSvc from '../services/finanzas/tesoreriaService.js';
import * as asientoSvc from '../services/finanzas/asientoService.js';
import * as chequeSvc from '../services/finanzas/chequeService.js';
import { db } from '../db.js';
import { listPlanCuentasTemplates, applyPlanCuentasTemplate } from '../services/finanzas/planCuentasTemplates.js';
import { json, parseBody } from './http.js';

export async function handleTesoreriaRoutes(req, res, pathname, user) {
  if (pathname === '/api/tesoreria/cuentas' && req.method === 'GET') {
    json(res, 200, tesSvc.listCuentas());
    return true;
  }
  if (pathname === '/api/tesoreria/cuentas' && req.method === 'POST') {
    try { json(res, 201, { id: tesSvc.createCuenta(await parseBody(req)) }); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const ctaAjusteMatch = pathname.match(/^\/api\/tesoreria\/cuentas\/(\d+)\/ajuste$/);
  if (ctaAjusteMatch && req.method === 'POST') {
    try { json(res, 201, tesSvc.ajustarSaldoCuenta(Number(ctaAjusteMatch[1]), await parseBody(req))); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const ctaMatch = pathname.match(/^\/api\/tesoreria\/cuentas\/(\d+)$/);
  if (ctaMatch && req.method === 'PUT') {
    if (!tesSvc.updateCuenta(Number(ctaMatch[1]), await parseBody(req))) json(res, 404, { error: 'Cuenta no encontrada' });
    else json(res, 200, { ok: true });
    return true;
  }
  if (ctaMatch && req.method === 'DELETE') {
    tesSvc.deleteCuenta(Number(ctaMatch[1]));
    json(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/tesoreria/pagos' && req.method === 'GET') {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    json(res, 200, tesSvc.listPagos({ cuenta_id: qs.get('cuenta_id') || undefined, proveedor_id: qs.get('proveedor_id') || undefined }));
    return true;
  }
  if (pathname === '/api/tesoreria/pagos' && req.method === 'POST') {
    try { json(res, 201, { id: tesSvc.createPago(await parseBody(req), user) }); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const pagoMatch = pathname.match(/^\/api\/tesoreria\/pagos\/(\d+)$/);
  if (pagoMatch && req.method === 'GET') {
    const data = tesSvc.getPagoById(Number(pagoMatch[1]));
    if (!data) { json(res, 404, { error: 'Pago no encontrado' }); return true; }
    json(res, 200, data);
    return true;
  }
  if (pagoMatch && req.method === 'DELETE') {
    tesSvc.deletePago(Number(pagoMatch[1]));
    json(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/tesoreria/cobros' && req.method === 'GET') {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    json(res, 200, tesSvc.listCobros({ cuenta_id: qs.get('cuenta_id') || undefined, cliente_id: qs.get('cliente_id') || undefined }));
    return true;
  }
  if (pathname === '/api/tesoreria/cobros' && req.method === 'POST') {
    try { json(res, 201, { id: tesSvc.createCobro(await parseBody(req), user) }); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const cobroMatch = pathname.match(/^\/api\/tesoreria\/cobros\/(\d+)$/);
  if (cobroMatch && req.method === 'GET') {
    const data = tesSvc.getCobroById(Number(cobroMatch[1]));
    if (!data) { json(res, 404, { error: 'Cobro no encontrado' }); return true; }
    json(res, 200, data);
    return true;
  }
  if (cobroMatch && req.method === 'DELETE') {
    tesSvc.deleteCobro(Number(cobroMatch[1]));
    json(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/tesoreria/flujo-caja' && req.method === 'GET') {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    json(res, 200, tesSvc.getFlujoCaja({
      desde: qs.get('desde') || undefined,
      hasta: qs.get('hasta') || undefined,
      cuenta_id: qs.get('cuenta_id') || undefined,
      granularidad: qs.get('granularidad') || 'semana',
    }));
    return true;
  }
  if (pathname === '/api/tesoreria/flujo-matriz' && req.method === 'GET') {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    json(res, 200, tesSvc.getFlujoMatriz({
      granularidad: qs.get('granularidad') || 'semana',
      hist_periodos: qs.get('hist') ? Number(qs.get('hist')) : 4,
      proy_periodos: qs.get('proy') ? Number(qs.get('proy')) : 6,
      cuenta_id: qs.get('cuenta_id') || undefined,
    }));
    return true;
  }
  if (pathname === '/api/tesoreria/flujo-operativo' && req.method === 'GET') {
    json(res, 200, tesSvc.getFlujoOperativo());
    return true;
  }
  if (pathname === '/api/tesoreria/flujo-proyectado' && req.method === 'GET') {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    json(res, 200, tesSvc.getFlujoProyectado({
      desde: qs.get('desde') || undefined,
      hasta: qs.get('hasta') || undefined,
      dias: qs.get('dias') ? Number(qs.get('dias')) : undefined,
      meses: qs.get('meses') ? Number(qs.get('meses')) : undefined,
      cuenta_id: qs.get('cuenta_id') || undefined,
      granularidad: qs.get('granularidad') || 'semana',
    }));
    return true;
  }
  if (pathname === '/api/tesoreria/proyecciones' && req.method === 'GET') {
    json(res, 200, tesSvc.listProyecciones());
    return true;
  }
  if (pathname === '/api/tesoreria/proyecciones' && req.method === 'POST') {
    try { json(res, 201, { id: tesSvc.createProyeccion(await parseBody(req)) }); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const proyMatch = pathname.match(/^\/api\/tesoreria\/proyecciones\/(\d+)$/);
  if (proyMatch && req.method === 'PUT') {
    try {
      if (!tesSvc.updateProyeccion(Number(proyMatch[1]), await parseBody(req))) json(res, 404, { error: 'Proyección no encontrada' });
      else json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (proyMatch && req.method === 'DELETE') {
    tesSvc.deleteProyeccion(Number(proyMatch[1]));
    json(res, 200, { ok: true });
    return true;
  }
  if (pathname === '/api/tesoreria/asientos' && req.method === 'GET') {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    json(res, 200, asientoSvc.listAsientos({
      diario_id: qs.get('diario_id') || undefined,
      estado: qs.get('estado') || undefined,
      desde: qs.get('desde') || undefined,
      hasta: qs.get('hasta') || undefined,
    }));
    return true;
  }
  if (pathname === '/api/tesoreria/asientos' && req.method === 'POST') {
    try { json(res, 201, { id: asientoSvc.createAsiento(await parseBody(req)) }); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const revMatch = pathname.match(/^\/api\/tesoreria\/asientos\/(\d+)\/revertir$/);
  if (revMatch && req.method === 'POST') {
    try { json(res, 201, { id: asientoSvc.revertirAsiento(Number(revMatch[1]), await parseBody(req).catch(() => ({}))) }); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (pathname === '/api/tesoreria/balance' && req.method === 'GET') {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    json(res, 200, asientoSvc.getBalanceSumasYSaldos({
      desde: qs.get('desde') || undefined,
      hasta: qs.get('hasta') || undefined,
    }));
    return true;
  }
  if (pathname === '/api/tesoreria/libro-mayor' && req.method === 'GET') {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    json(res, 200, asientoSvc.getLibroMayor({
      plan_cuenta_id: qs.get('plan_cuenta_id') || undefined,
      desde: qs.get('desde') || undefined,
      hasta: qs.get('hasta') || undefined,
    }));
    return true;
  }
  if (pathname === '/api/tesoreria/estado-resultados' && req.method === 'GET') {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    json(res, 200, asientoSvc.getEstadoResultados({
      desde: qs.get('desde') || undefined,
      hasta: qs.get('hasta') || undefined,
    }));
    return true;
  }
  if (pathname === '/api/tesoreria/plan-cuentas/plantillas' && req.method === 'GET') {
    json(res, 200, listPlanCuentasTemplates());
    return true;
  }
  if (pathname === '/api/tesoreria/plan-cuentas/aplicar-plantilla' && req.method === 'POST') {
    try {
      const b = await parseBody(req);
      json(res, 200, applyPlanCuentasTemplate(db, b.plantilla_id));
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (pathname === '/api/tesoreria/plan-cuentas' && req.method === 'GET') {
    json(res, 200, asientoSvc.planCuentaRepo.findAll());
    return true;
  }
  if (pathname === '/api/tesoreria/plan-cuentas' && req.method === 'POST') {
    try {
      const b = await parseBody(req);
      asientoSvc.planCuentaRepo.validate(b);
      json(res, 201, { id: asientoSvc.planCuentaRepo.create(b) });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const pcMatch = pathname.match(/^\/api\/tesoreria\/plan-cuentas\/(\d+)$/);
  if (pcMatch && req.method === 'PUT') {
    try {
      const b = await parseBody(req);
      asientoSvc.planCuentaRepo.validate(b, { partial: true });
      const ok = asientoSvc.planCuentaRepo.update(Number(pcMatch[1]), b);
      if (!ok) json(res, 404, { error: 'Cuenta contable no encontrada' });
      else json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (pathname === '/api/tesoreria/diarios' && req.method === 'GET') {
    json(res, 200, asientoSvc.diarioRepo.findAll());
    return true;
  }
  if (pathname === '/api/tesoreria/diarios' && req.method === 'POST') {
    try {
      const b = await parseBody(req);
      asientoSvc.diarioRepo.validate(b);
      json(res, 201, { id: asientoSvc.diarioRepo.create(b) });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const diarioMatch = pathname.match(/^\/api\/tesoreria\/diarios\/(\d+)$/);
  if (diarioMatch && req.method === 'PUT') {
    try {
      const b = await parseBody(req);
      asientoSvc.diarioRepo.validate(b, { partial: true });
      const ok = asientoSvc.diarioRepo.update(Number(diarioMatch[1]), b);
      if (!ok) json(res, 404, { error: 'Diario contable no encontrado' });
      else json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (pathname === '/api/dashboard' && req.method === 'GET') {
    json(res, 200, tesSvc.getDashboardSummary());
    return true;
  }
  if (pathname === '/api/tesoreria/transferencias' && req.method === 'POST') {
    try { json(res, 201, { id: tesSvc.createTransferencia(await parseBody(req)) }); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }

  if (pathname === '/api/tesoreria/cheques' && req.method === 'GET') {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    json(res, 200, chequeSvc.listCheques({
      origen: qs.get('origen') || undefined,
      modalidad: qs.get('modalidad') || undefined,
      estado: qs.get('estado') || undefined,
      vencimiento_desde: qs.get('vencimiento_desde') || undefined,
      vencimiento_hasta: qs.get('vencimiento_hasta') || undefined,
      search: qs.get('search') || undefined,
    }));
    return true;
  }
  if (pathname === '/api/tesoreria/cheques' && req.method === 'POST') {
    try {
      const b = await parseBody(req);
      const id = chequeSvc.registrarChequeTercero({ ...b, generar_asiento: b.generar_asiento === true }, user);
      json(res, 201, { id });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const chequeMatch = pathname.match(/^\/api\/tesoreria\/cheques\/(\d+)$/);
  if (chequeMatch && req.method === 'GET') {
    const ch = chequeSvc.getChequeById(Number(chequeMatch[1]));
    if (!ch) json(res, 404, { error: 'Cheque no encontrado' });
    else json(res, 200, ch);
    return true;
  }
  const chequeActMatch = pathname.match(/^\/api\/tesoreria\/cheques\/(\d+)\/(depositar|acreditar|debitar|rechazar)$/);
  if (chequeActMatch && req.method === 'POST') {
    const id = Number(chequeActMatch[1]);
    const act = chequeActMatch[2];
    try {
      const b = await parseBody(req).catch(() => ({}));
      let out = null;
      if (act === 'depositar') out = chequeSvc.depositarCheque(id, b);
      else if (act === 'acreditar') out = chequeSvc.acreditarChequeDepositado(id, b);
      else if (act === 'debitar') out = chequeSvc.debitarCheque(id, b);
      else if (act === 'rechazar') out = chequeSvc.rechazarCheque(id, b);
      json(res, 200, out);
    } catch (e) {
      json(res, 400, { error: e.message });
    }
    return true;
  }
  return false;
}
