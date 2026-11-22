import * as libroIvaSvc from '../services/afip/libroIvaService.js';
import * as impSvc from '../services/finanzas/imputacionService.js';
import * as contAvSvc from '../services/finanzas/contabilidadAvanzadaService.js';
import * as activoSvc from '../services/finanzas/activoFijoService.js';
import * as nominaSvc from '../services/finanzas/nominaService.js';
import * as lsdSvc from '../services/afip/libroSueldosDigitalService.js';
import { generateNominaPdf } from '../services/print/nominaPdfService.js';
import { generateRecibosSueldoPdf } from '../services/print/reciboSueldoPdfService.js';
import { COMPROBANTES_AR } from '../services/afip/fiscalRules.js';
import { getPagoById } from '../services/finanzas/tesoreriaService.js';
import { getConfig } from '../services/config/configService.js';
import { generateRetencionPdf } from '../services/print/retencionPdfService.js';
import { json, parseBody } from './http.js';

export async function handleFiscalRoutes(req, res, pathname, user = null) {
  const qs = new URL(req.url, 'http://localhost').searchParams;

  if (pathname === '/api/fiscal/catalogo' && req.method === 'GET') {
    json(res, 200, { comprobantes: COMPROBANTES_AR });
    return true;
  }

  if (pathname === '/api/fiscal/jurisdicciones' && req.method === 'GET') {
    json(res, 200, libroIvaSvc.listJurisdicciones());
    return true;
  }

  if (pathname === '/api/fiscal/padron' && req.method === 'GET') {
    json(res, 200, libroIvaSvc.listPadronAlicuotas({
      cuit: qs.get('cuit') || undefined,
      jurisdiccion_codigo: qs.get('jurisdiccion_codigo') || undefined,
      tipo: qs.get('tipo') || undefined,
    }));
    return true;
  }

  if (pathname === '/api/fiscal/padron' && req.method === 'POST') {
    try {
      const id = libroIvaSvc.upsertPadronAlicuota(await parseBody(req));
      json(res, 201, { id });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }

  if (pathname === '/api/fiscal/padron/import' && req.method === 'POST') {
    try {
      const b = await parseBody(req);
      const out = libroIvaSvc.importPadronCsv(b.contenido || b.text || '', {
        jurisdiccion_codigo: b.jurisdiccion_codigo || '902',
        tipo: b.tipo || 'percepcion',
        origen: b.origen || 'import_padron',
      });
      json(res, 200, out);
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }

  const padronDelMatch = pathname.match(/^\/api\/fiscal\/padron\/(\d+)$/);
  if (padronDelMatch && req.method === 'DELETE') {
    libroIvaSvc.deletePadronAlicuota(Number(padronDelMatch[1]));
    json(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/fiscal/sugerir-percepciones' && req.method === 'POST') {
    try {
      json(res, 200, libroIvaSvc.sugerirPercepciones(await parseBody(req)));
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }

  if (pathname === '/api/fiscal/libro-iva' && req.method === 'GET') {
    json(res, 200, libroIvaSvc.getLibroIva({
      tipo: qs.get('tipo') || 'ventas',
      desde: qs.get('desde') || '',
      hasta: qs.get('hasta') || '',
      incluir_no_fiscales: qs.get('incluir_no_fiscales') === '1',
    }));
    return true;
  }

  if (pathname === '/api/fiscal/libro-iva/export' && req.method === 'GET') {
    const tipo = qs.get('tipo') || 'ventas';
    const archivo = qs.get('archivo') || 'cbte';
    const out = libroIvaSvc.exportLibroIvaTxt({
      tipo,
      desde: qs.get('desde') || '',
      hasta: qs.get('hasta') || '',
    });
    const isAlic = archivo === 'alicuotas';
    const filename = isAlic ? out.alicuotasFilename : out.cbteFilename;
    const content = isAlic ? out.alicuotasTxt : out.cbteTxt;
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    });
    res.end(content);
    return true;
  }

  if (pathname === '/api/fiscal/libros-auxiliares' && req.method === 'GET') {
    json(res, 200, libroIvaSvc.getLibroAuxiliar({
      categoria: qs.get('categoria') || 'percepciones',
      jurisdiccion_codigo: qs.get('jurisdiccion_codigo') || '',
      desde: qs.get('desde') || '',
      hasta: qs.get('hasta') || '',
    }));
    return true;
  }

  if (pathname === '/api/fiscal/libros-auxiliares/sicore' && req.method === 'GET') {
    const out = libroIvaSvc.exportSicoreTxt({
      desde: qs.get('desde') || '',
      hasta: qs.get('hasta') || '',
    });
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${out.filename}"`,
      'Cache-Control': 'no-store',
    });
    res.end(out.content);
    return true;
  }

  if (pathname === '/api/fiscal/libros-auxiliares/sifere' && req.method === 'GET') {
    const out = libroIvaSvc.exportSifereTxt({
      categoria: qs.get('categoria') || 'percepciones',
      desde: qs.get('desde') || '',
      hasta: qs.get('hasta') || '',
    });
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${out.filename}"`,
      'Cache-Control': 'no-store',
    });
    res.end(out.content);
    return true;
  }

  if (pathname === '/api/fiscal/reporte-jurisdicciones' && req.method === 'GET') {
    json(res, 200, libroIvaSvc.getReporteJurisdicciones({
      tipo: qs.get('tipo') || 'ventas',
      desde: qs.get('desde') || '',
      hasta: qs.get('hasta') || '',
    }));
    return true;
  }

  const retPdfMatch = pathname.match(/^\/api\/tesoreria\/pagos\/(\d+)\/retencion\/(\d+)\/pdf$/);
  if (retPdfMatch && req.method === 'GET') {
    const pagoData = getPagoById(Number(retPdfMatch[1]));
    if (!pagoData) { json(res, 404, { error: 'Pago no encontrado' }); return true; }
    const ret = (pagoData.retenciones || []).find(r => Number(r.id) === Number(retPdfMatch[2]));
    if (!ret) { json(res, 404, { error: 'Retención no encontrada' }); return true; }
    const emp = getConfig()?.empresa || {};
    const pdfBuf = generateRetencionPdf({ pago: pagoData.pago, retencion: ret }, emp);
    const safeCert = String(ret.numero_certificado || ret.id).replace(/[^a-zA-Z0-9_-]+/g, '_');
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="Certificado_Retencion_${safeCert}.pdf"`,
      'Content-Length': pdfBuf.length,
      'Cache-Control': 'no-store',
    });
    res.end(pdfBuf);
    return true;
  }

  // --- IMPUTACIONES (Conciliación N-a-N Facturas ↔ Pagos/Cobros/NC) ---
  if (pathname === '/api/tesoreria/imputaciones/cuadre' && req.method === 'GET') {
    json(res, 200, impSvc.getCuadreCuentasCorrientes({ fecha_corte: qs.get('fecha_corte') || undefined }));
    return true;
  }
  if (pathname === '/api/tesoreria/imputaciones/estado-cuenta' && req.method === 'GET') {
    const cId = Number(qs.get('contacto_id'));
    if (!cId) { json(res, 400, { error: 'contacto_id requerido' }); return true; }
    json(res, 200, impSvc.getEstadoCuentaContacto(cId, qs.get('dominio') || 'ventas'));
    return true;
  }
  if (pathname === '/api/tesoreria/imputaciones' && req.method === 'POST') {
    try {
      const id = impSvc.crearImputacion(await parseBody(req));
      json(res, 201, { id });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const impDelMatch = pathname.match(/^\/api\/tesoreria\/imputaciones\/(\d+)$/);
  if (impDelMatch && req.method === 'DELETE') {
    impSvc.eliminarImputacion(Number(impDelMatch[1]));
    json(res, 200, { ok: true });
    return true;
  }

  // --- POSICIÓN MENSUAL DE IVA ---
  if (pathname === '/api/fiscal/posicion-iva' && req.method === 'GET') {
    json(res, 200, contAvSvc.getPosicionMensualIva({
      desde: qs.get('desde') || '',
      hasta: qs.get('hasta') || '',
      saldo_tecnico_anterior: Number(qs.get('saldo_tecnico_anterior')) || 0,
      saldo_libre_anterior: Number(qs.get('saldo_libre_anterior')) || 0,
    }));
    return true;
  }
  if (pathname === '/api/fiscal/posicion-iva/contabilizar' && req.method === 'POST') {
    try {
      json(res, 201, contAvSvc.contabilizarPosicionIva(await parseBody(req)));
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }

  // --- CONCILIACIÓN BANCARIA ---
  if (pathname === '/api/tesoreria/conciliacion' && req.method === 'GET') {
    json(res, 200, contAvSvc.listExtractoMovimientos({
      cuenta_id: qs.get('cuenta_id') || undefined,
      estado: qs.get('estado') || undefined,
      desde: qs.get('desde') || undefined,
      hasta: qs.get('hasta') || undefined,
    }));
    return true;
  }
  if (pathname === '/api/tesoreria/conciliacion/sistema' && req.method === 'GET') {
    const ctaId = Number(qs.get('cuenta_id'));
    if (!ctaId) { json(res, 400, { error: 'cuenta_id requerido' }); return true; }
    json(res, 200, contAvSvc.listMovimientosSistemaCuenta(ctaId));
    return true;
  }
  if (pathname === '/api/tesoreria/conciliacion/importar' && req.method === 'POST') {
    try { json(res, 200, contAvSvc.importarExtractoCsv(await parseBody(req))); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (pathname === '/api/tesoreria/conciliacion/auto' && req.method === 'POST') {
    try {
      const b = await parseBody(req);
      json(res, 200, contAvSvc.autoConciliarExtracto(b.cuenta_id));
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const concMatch = pathname.match(/^\/api\/tesoreria\/conciliacion\/(\d+)\/(conciliar|ignorar|desconciliar)$/);
  if (concMatch && req.method === 'POST') {
    try {
      const id = Number(concMatch[1]);
      const action = concMatch[2];
      if (action === 'conciliar') contAvSvc.conciliarExtractoItem(id, await parseBody(req));
      else if (action === 'ignorar') contAvSvc.ignorarExtractoItem(id);
      else contAvSvc.desconciliarExtractoItem(id);
      json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }

  // --- MULTIMONEDA Y COTIZACIONES ---
  if (pathname === '/api/fiscal/cotizaciones' && req.method === 'GET') {
    json(res, 200, contAvSvc.listCotizaciones({ moneda: qs.get('moneda') || undefined }));
    return true;
  }
  if (pathname === '/api/fiscal/cotizaciones/vigente' && req.method === 'GET') {
    json(res, 200, {
      moneda: (qs.get('moneda') || 'ARS').toUpperCase(),
      cotizacion: contAvSvc.getCotizacionVigente(qs.get('moneda') || 'ARS', qs.get('fecha') || ''),
    });
    return true;
  }
  if (pathname === '/api/fiscal/cotizaciones' && req.method === 'POST') {
    try { json(res, 201, { id: contAvSvc.upsertCotizacion(await parseBody(req)) }); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }

  // --- CIERRE DE EJERCICIO ---
  if (pathname === '/api/contabilidad/cierres' && req.method === 'GET') {
    json(res, 200, contAvSvc.listCierresEjercicio());
    return true;
  }
  if (pathname === '/api/contabilidad/cierres/preview' && req.method === 'GET') {
    try {
      json(res, 200, contAvSvc.previewCierreEjercicio({
        fecha_desde: qs.get('fecha_desde') || '',
        fecha_hasta: qs.get('fecha_hasta') || '',
      }));
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (pathname === '/api/contabilidad/cierres' && req.method === 'POST') {
    try { json(res, 201, contAvSvc.ejecutarCierreEjercicio(await parseBody(req))); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const cierreReabrirMatch = pathname.match(/^\/api\/contabilidad\/cierres\/(\d+)\/reabrir$/);
  if (cierreReabrirMatch && req.method === 'POST') {
    try {
      contAvSvc.reabrirCierreEjercicio(Number(cierreReabrirMatch[1]));
      json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }

  // ── Activos Fijos (Bienes de Uso) y Amortizaciones ──────────────────────────
  if (pathname === '/api/activos' && req.method === 'GET') {
    json(res, 200, activoSvc.listActivosFijos({ estado: qs.get('estado') || undefined }));
    return true;
  }
  if (pathname === '/api/activos' && req.method === 'POST') {
    try { json(res, 201, { id: activoSvc.createActivoFijo(await parseBody(req), user) }); }
    catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (pathname === '/api/activos/amortizaciones' && req.method === 'GET') {
    json(res, 200, activoSvc.listAmortizacionesPeriodo(qs.get('periodo') || null));
    return true;
  }
  if (pathname === '/api/activos/amortizar' && req.method === 'POST') {
    try {
      const b = await parseBody(req);
      json(res, 200, activoSvc.amortizarPeriodo(b.periodo, { fecha: b.fecha }, user));
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const activoBajaMatch = pathname.match(/^\/api\/activos\/(\d+)\/baja$/);
  if (activoBajaMatch && req.method === 'POST') {
    try {
      const b = await parseBody(req).catch(() => ({}));
      json(res, 200, activoSvc.darDeBajaActivo(Number(activoBajaMatch[1]), b, user));
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  const activoMatch = pathname.match(/^\/api\/activos\/(\d+)$/);
  if (activoMatch && req.method === 'GET') {
    const det = activoSvc.getActivoFijoById(Number(activoMatch[1]));
    if (!det) json(res, 404, { error: 'Activo fijo no encontrado' });
    else json(res, 200, det);
    return true;
  }
  if (activoMatch && req.method === 'PUT') {
    try {
      const ok = activoSvc.updateActivoFijo(Number(activoMatch[1]), await parseBody(req), user);
      if (!ok) json(res, 404, { error: 'Activo fijo no encontrado' });
      else json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }
  if (activoMatch && req.method === 'DELETE') {
    try {
      const ok = activoSvc.deleteActivoFijo(Number(activoMatch[1]));
      if (!ok) json(res, 404, { error: 'Activo fijo no encontrado' });
      else json(res, 200, { ok: true });
    } catch (e) { json(res, 400, { error: e.message }); }
    return true;
  }

  // ── Nómina Argentina (ARCA / LSD / F.931 / Recibos LCT) ─────────────────────
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
