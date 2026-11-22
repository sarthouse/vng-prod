import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { initDb, runWithDatabase, closeConnection } from '../src/db.js';
import * as contactoSvc from '../src/services/comercial/contactoService.js';
import * as prodSvc from '../src/services/inventario/productoService.js';
import * as compraSvc from '../src/services/comercial/compraService.js';
import * as ocSvc from '../src/services/comercial/ordenCompraService.js';
import * as ventaSvc from '../src/services/comercial/ventaService.js';
import * as asientoSvc from '../src/services/finanzas/asientoService.js';
import * as opStockSvc from '../src/services/inventario/operacionStockService.js';
import * as recetaSvc from '../src/services/produccion/recetaService.js';
import * as curvaSvc from '../src/services/produccion/curvaService.js';
import * as presupuestoSvc from '../src/services/produccion/presupuestoService.js';
import * as produccionSvc from '../src/services/produccion/produccionService.js';
import * as tesSvc from '../src/services/finanzas/tesoreriaService.js';
import * as configSvc from '../src/services/config/configService.js';
import { BaseRepository } from '../src/core/BaseRepository.js';
import { MODELS } from '../src/db/models.js';

const TEST_DB = 'test_suite_contabilidad';

function cleanupDb() {
  closeConnection(TEST_DB);
  for (const ext of ['', '-shm', '-wal']) {
    const f = `./db/${TEST_DB}.sqlite${ext}`;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

describe('Contabilidad, Notas de Crédito/Débito y Remito Unificado', () => {
  before(() => {
    cleanupDb();
    initDb(TEST_DB);
  });

  after(() => cleanupDb());

  it('genera asientos balanceados para factura y NC en compras/ventas y remito sobre operaciones_stock', () => {
    runWithDatabase(TEST_DB, () => {
      const provId = contactoSvc.createContacto({ nombre: 'Curtiembre Contable', es_proveedor: true, es_taller: true });
      const cliId = contactoSvc.createContacto({ nombre: 'Zapatería Contable', es_cliente: true });

      const pltId = prodSvc.createPlantilla({
        nombre: 'Forro Test Contabilidad',
        tipo: 'almacenable',
        categoria: 'Cueros',
        udm: 'unidades',
        se_compra: true,
        se_fabrica: false,
        se_vende: true,
        precio: 1000,
      });
      const prod = prodSvc.listProductos({ plantilla_id: pltId })[0];

      // Compra Factura ($1000 + $210 IVA = $1210)
      const cmpFaId = compraSvc.createCompra({
        contacto_id: provId,
        fecha: '2026-11-14',
        caracter: 'fiscal',
        tipo_comprobante: 'FA-A',
        numero: '0001-00000100',
        lineas: [{ producto_id: prod.id, cantidad: 10, precio_unitario: 100, alicuota_iva: 21 }],
      });
      const cmpFa = compraSvc.getCompraById(cmpFaId);
      assert.equal(cmpFa.compra.total, 1210);
      assert.ok(cmpFa.compra.asiento_id);

      // Compra Nota de Crédito (-$242)
      const cmpNcId = compraSvc.createCompra({
        contacto_id: provId,
        clase_documento: 'nota_credito',
        comprobante_origen_id: cmpFaId,
        fecha: '2026-11-14',
        caracter: 'fiscal',
        tipo_comprobante: 'NC-A',
        numero: '0001-00000001',
        lineas: [{ producto_id: prod.id, cantidad: 2, precio_unitario: 100, alicuota_iva: 21 }],
      });
      const cmpNc = compraSvc.getCompraById(cmpNcId);
      assert.equal(cmpNc.compra.clase_documento, 'nota_credito');
      assert.ok(cmpNc.compra.asiento_id);

      // Saldo proveedor = 1210 - 242 = 968
      const provDet = contactoSvc.getContactoById(provId);
      assert.equal(provDet.saldo_proveedor, 968);

      // Venta Factura ($2000 + $420 IVA = $2420)
      const vtaFaId = ventaSvc.createVenta({
        contacto_id: cliId,
        fecha: '2026-11-14',
        caracter: 'fiscal',
        tipo_comprobante: 'FA-B',
        lineas: [{ producto_id: prod.id, cantidad: 2, precio_unitario: 1000, alicuota_iva: 21 }],
      });
      const vtaFa = ventaSvc.getVentaById(vtaFaId);
      assert.equal(vtaFa.venta.total, 2420);
      assert.ok(vtaFa.venta.asiento_id);

      // Venta Nota de Crédito (-$1210)
      ventaSvc.createVenta({
        contacto_id: cliId,
        clase_documento: 'nota_credito',
        comprobante_origen_id: vtaFaId,
        fecha: '2026-11-14',
        caracter: 'fiscal',
        tipo_comprobante: 'NC-B',
        lineas: [{ producto_id: prod.id, cantidad: 1, precio_unitario: 1000, alicuota_iva: 21 }],
      });
      const cliDet = contactoSvc.getContactoById(cliId);
      assert.equal(cliDet.saldo_cliente, 1210);

      // Balance de Sumas y Saldos cuadrado (Total Debe === Total Haber)
      const balance = asientoSvc.getBalanceSumasYSaldos();
      const sumDebe = Number(balance.reduce((s, r) => s + r.total_debe, 0).toFixed(2));
      const sumHaber = Number(balance.reduce((s, r) => s + r.total_haber, 0).toFixed(2));
      assert.equal(sumDebe, sumHaber);
      assert.ok(sumDebe > 0);

      // Remito a taller sobre operaciones_stock unificado
      const remId = opStockSvc.createOperacionStock({
        tipo: 'remito_taller',
        contacto_id: provId,
        fecha: '2026-11-14',
        lineas: [{ producto_id: prod.id, cantidad: 3, udm: 'unidades' }],
      });
      const remDet = opStockSvc.getOperacionStockById(remId);
      assert.equal(remDet.operacion.contacto_id, provId);
      assert.equal(remDet.operacion.tipo, 'remito_taller');
      assert.equal(remDet.lineas.length, 1);

      // Automatización en Borrador: Compra -> Recepción Borrador, Venta -> Entrega Borrador
      const recepcionesCompra = opStockSvc.operacionStockRepo.query()
        .where('referencia_tipo', 'compra')
        .where('referencia_id', cmpFaId)
        .all();
      assert.equal(recepcionesCompra.length, 1);
      assert.equal(recepcionesCompra[0].tipo, 'recepcion');
      assert.equal(recepcionesCompra[0].estado, 'Borrador');

      const entregasVenta = opStockSvc.operacionStockRepo.query()
        .where('referencia_tipo', 'venta')
        .where('referencia_id', vtaFaId)
        .all();
      assert.equal(entregasVenta.length, 1);
      assert.equal(entregasVenta[0].tipo, 'entrega');
      assert.equal(entregasVenta[0].estado, 'Borrador');

      // Confirmar recepción de la compra para tener 10 unidades de stock disponibles
      assert.equal(opStockSvc.confirmarOperacionStock(recepcionesCompra[0].id), true);

      // Orden de Producción: requiere 15 unidades (10 disponibles -> Remito Borrador, 5 faltantes -> Compra Borrador)
      const insumoPltId = prodSvc.createPlantilla({
        nombre: 'Insumo Con Stock Parcial',
        tipo: 'almacenable',
        categoria: 'Cueros',
        udm: 'unidades',
        se_compra: true,
        se_fabrica: false,
        proveedor_id: provId,
        precio: 500,
        stock: 10,
      });
      const insumoProd = prodSvc.listProductos({ plantilla_id: insumoPltId })[0];

      const modPltId = prodSvc.createPlantilla({
        nombre: 'Modelo Automatizado',
        tipo: 'almacenable',
        categoria: 'Calzado',
        udm: 'pares',
        se_fabrica: true,
        se_compra: false,
      });
      const modProd = prodSvc.listProductos({ plantilla_id: modPltId })[0];
      const recId = recetaSvc.createReceta({ plantilla_id: modPltId, nombre: 'Receta Auto', activa: true });
      recetaSvc.addRecetaLinea(recId, { producto_id: insumoProd.id, coeficiente: 1, udm_receta: 'unidades' });

      const ordenId = produccionSvc.createOrden({
        plantilla_id: modPltId,
        fecha_inicio: '2026-11-14',
        lineas: [{ producto_id: modProd.id, cantidad: 15 }],
      });

      const remitosOrden = opStockSvc.operacionStockRepo.query()
        .where('referencia_tipo', 'orden')
        .where('referencia_id', ordenId)
        .all();
      assert.equal(remitosOrden.length, 1);
      assert.equal(remitosOrden[0].tipo, 'remito_taller');
      assert.equal(remitosOrden[0].estado, 'Borrador');
      const remOrdenDet = opStockSvc.getOperacionStockById(remitosOrden[0].id);
      assert.equal(remOrdenDet.lineas[0].cantidad, 10);

      const ocsOrden = ocSvc.ocRepo.query()
        .where('origen_tipo', 'orden')
        .where('origen_id', ordenId)
        .all();
      assert.equal(ocsOrden.length, 1);
      assert.equal(ocsOrden[0].estado, 'Borrador');
      const ocOrdenDet = ocSvc.getOrdenCompraById(ocsOrden[0].id);
      assert.equal(ocOrdenDet.lineas[0].cantidad, 5);

      const convRes = ocSvc.convertirOrdenCompraACompra(ocsOrden[0].id, {
        numero: '0001-00009999',
        lineas: [{
          producto_id: insumoProd.id,
          descripcion: 'Insumo Auto Orden Ajustado',
          cantidad: 7,
          udm: 'unidades',
          precio_unitario: 100,
          alicuota_iva: 21,
        }],
      });
      assert.equal(convRes.ok, true);
      const cmpAfterEdit = compraSvc.getCompraById(convRes.compra_id);
      assert.equal(cmpAfterEdit.compra.numero, '0001-00009999');
      assert.equal(cmpAfterEdit.compra.orden_compra_id, ocsOrden[0].id);
      assert.equal(cmpAfterEdit.lineas[0].cantidad, 7);
      assert.equal(cmpAfterEdit.compra.total, 847);

      compraSvc.confirmarCompra(convRes.compra_id, {});
      assert.throws(() => compraSvc.updateCompra(convRes.compra_id, { numero: '0001-00000000' }), /Borrador/);

      // Circuito Retail: se_vende=1, se_compra=1, se_fabrica=0 -> Venta sin stock dispara Orden de Compra Borrador
      const retailPltId = prodSvc.createPlantilla({
        nombre: 'Cordón Retail Test',
        se_fabrica: 0,
        se_compra: 1,
        se_vende: 1,
        proveedor_id: provId,
        precio: 150,
        stock: 2,
        minimo_compra: 5,
      });
      const retailProds = prodSvc.listProductos({ plantilla_id: retailPltId, se_vende: 1 });
      assert.equal(retailProds.length, 1);
      assert.equal(retailProds[0].se_vende, 1);

      const vtaRetailId = ventaSvc.createVenta({
        contacto_id: cliId,
        fecha: '2026-11-14',
        caracter: 'interno',
        estado: 'Confirmada',
        lineas: [{ producto_id: retailProds[0].id, descripcion: retailProds[0].nombre, cantidad: 4, precio_unitario: 300 }],
      });
      assert.ok(vtaRetailId > 0);
      const ocsRetail = ocSvc.ocRepo.query()
        .where('origen_tipo', 'venta')
        .where('origen_id', vtaRetailId)
        .all();
      assert.equal(ocsRetail.length, 1);
      assert.equal(ocsRetail[0].estado, 'Borrador');
      const ocRetailDet = ocSvc.getOrdenCompraById(ocsRetail[0].id);
      // Faltante = 4 - 2 = 2, pero minimo_compra = 5 -> OC Borrador por 5
      assert.equal(ocRetailDet.lineas[0].cantidad, 5);
      // Convertir OC Retail a Compra Borrador
      const convRetail = ocSvc.convertirOrdenCompraACompra(ocsRetail[0].id, { estado: 'Borrador' });
      assert.ok(convRetail.compra_id > 0);

      const dash = tesSvc.getDashboardSummary();
      assert.ok(dash.borradores.compras >= 1);
      assert.ok(dash.borradores.entregas >= 1);

      // Impuestos IVA unificados en impuestos_config + Pagos y Cobros multimétodo (lineas)
      const ivasSeed = configSvc.listImpuestos({ tipo: 'iva' });
      assert.ok(ivasSeed.length >= 4);

      const cta1Id = tesSvc.createCuenta({ nombre: 'Caja Test', tipo: 'caja', saldo_inicial: 1000 });
      const cta2Id = tesSvc.createCuenta({ nombre: 'Banco Test', tipo: 'banco', saldo_inicial: 5000 });
      const cobroLineaRepo = new BaseRepository({ model: MODELS.cobro_lineas });
      const pagoLineaRepo = new BaseRepository({ model: MODELS.pago_lineas });

      const cobroMultiId = tesSvc.createCobro({
        contacto_id: cliId,
        fecha: '2026-11-14',
        concepto: 'Cobro multimétodo',
        lineas: [
          { cuenta_id: cta1Id, metodo: 'Efectivo', monto: 300 },
          { cuenta_id: cta2Id, metodo: 'Transferencia', monto: 700 },
        ],
      });
      const cobroLines = cobroLineaRepo.findWhere({ cobro_id: cobroMultiId });
      assert.equal(cobroLines.length, 2);
      const ctas1 = tesSvc.listCuentas();
      assert.equal(ctas1.find(c => c.id === cta1Id).saldo_actual, 1300);
      assert.equal(ctas1.find(c => c.id === cta2Id).saldo_actual, 5700);

      const pagoMultiId = tesSvc.createPago({
        contacto_id: provId,
        fecha: '2026-11-14',
        concepto: 'Pago multimétodo',
        lineas: [
          { cuenta_id: cta1Id, metodo: 'Efectivo', monto: 100 },
          { cuenta_id: cta2Id, metodo: 'Transferencia', monto: 200 },
        ],
      });
      const pagoLines = pagoLineaRepo.findWhere({ pago_id: pagoMultiId });
      assert.equal(pagoLines.length, 2);
      const ctas2 = tesSvc.listCuentas();
      assert.equal(ctas2.find(c => c.id === cta1Id).saldo_actual, 1200);
      assert.equal(ctas2.find(c => c.id === cta2Id).saldo_actual, 5500);

      assert.throws(() => tesSvc.deletePago(pagoMultiId), /No se puede eliminar un pago confirmado o anulado/i);
      assert.throws(() => tesSvc.deleteCobro(cobroMultiId), /No se puede eliminar un cobro confirmado o anulado/i);
      tesSvc.anularPago(pagoMultiId);
      tesSvc.anularCobro(cobroMultiId);
      const ctas3 = tesSvc.listCuentas();
      assert.equal(ctas3.find(c => c.id === cta1Id).saldo_actual, 1000);
      assert.equal(ctas3.find(c => c.id === cta2Id).saldo_actual, 5000);

      // Compra de Servicio (híbrido: producto tipo 'servicio' + cuenta contable en la línea)
      const ctaServicios = asientoSvc.planCuentaRepo.query().where('codigo', '5.2.01').get();
      assert.ok(ctaServicios, 'Debe existir cuenta 5.2.01 Servicios Públicos');
      const srvPltId = prodSvc.createPlantilla({
        nombre: 'Servicio de Electricidad',
        tipo: 'servicio',
        categoria: 'General',
        udm: 'unidades',
        se_compra: true,
        se_fabrica: false,
        se_vende: false,
        precio: 15000,
      });
      const srvProd = prodSvc.listProductos({ plantilla_id: srvPltId })[0];
      const cmpSrvId = compraSvc.createCompra({
        contacto_id: provId,
        fecha: '2026-11-14',
        fecha_vencimiento: '2026-11-25',
        caracter: 'fiscal',
        tipo_comprobante: 'FA-A',
        numero: '0002-00000111',
        lineas: [{ producto_id: srvProd.id, plan_cuenta_id: ctaServicios.id, cantidad: 1, precio_unitario: 15000, alicuota_iva: 21 }],
      });
      const srvOps = opStockSvc.operacionStockRepo.query()
        .where('referencia_tipo', 'compra')
        .where('referencia_id', cmpSrvId)
        .all();
      assert.equal(srvOps.length, 0, 'Un producto tipo servicio no debe generar operación de stock');
      const cmpSrvDet = compraSvc.getCompraById(cmpSrvId);
      assert.equal(cmpSrvDet.compra.fecha_vencimiento, '2026-11-25');
      const srvAsiento = asientoSvc.getAsientoById(cmpSrvDet.compra.asiento_id);
      assert.ok(srvAsiento.lineas.some(l => l.plan_cuenta_id === ctaServicios.id && l.debe === 15000));

      // Flujo histórico con saldo_apertura, transferencias y agrupación mensual
      tesSvc.createTransferencia({
        fecha: '2026-11-10',
        cuenta_origen_id: cta2Id,
        cuenta_destino_id: cta1Id,
        monto: 500,
        concepto: 'Fondeo caja',
      });
      const flujoHist = tesSvc.getFlujoCaja({ desde: '2026-11-12', hasta: '2026-11-30', cuenta_id: cta1Id, granularidad: 'semana' });
      assert.equal(flujoHist.resumen.saldo_apertura, 1500);
      assert.equal(flujoHist.resumen.saldo_cierre, 1500);
      assert.equal(flujoHist.granularidad, 'semana');

      // Flujo proyectado por semana: incluye compra de servicio impaga (Comprometido) + recurrente (Estimado)
      const proyId = tesSvc.createProyeccion({
        concepto: 'Alquiler Mensual',
        tipo: 'egreso',
        plan_cuenta_id: ctaServicios.id,
        monto: 20000,
        frecuencia: 'mensual',
        fecha_inicio: '2026-12-05',
      });
      const flujoProy = tesSvc.getFlujoProyectado({ desde: '2026-11-14', dias: 90, granularidad: 'semana' });
      assert.equal(flujoProy.granularidad, 'semana');
      assert.equal(flujoProy.hasta, '2027-02-12');
      assert.ok(flujoProy.eventos.some(e => e.origen === 'compra' && e.origen_id === cmpSrvId && e.estado_flujo === 'Comprometido'));
      assert.ok(flujoProy.eventos.some(e => e.origen === 'recurrente' && e.origen_id === proyId && e.estado_flujo === 'Estimado'));
      assert.ok(flujoProy.por_periodo.length >= 2);
      assert.ok(flujoProy.por_periodo.every(r => r.periodo_label.startsWith('Sem ')));

      // Recetas por variante específica (recetas.producto_id) + emparejar_variante en líneas
      const varPltId = prodSvc.createPlantilla({
        nombre: 'Zapatilla Receta Var',
        se_fabrica: 1,
        se_compra: 0,
        se_vende: 1,
        atributos: [{ atributo: 'Color', valores: ['Negro', 'Blanco'] }],
      });
      const zapVars = prodSvc.listProductos({ plantilla_id: varPltId });
      const zapNegro = zapVars.find(v => (v.combinacion_json || v.nombre).includes('Negro'));
      const zapBlanco = zapVars.find(v => (v.combinacion_json || v.nombre).includes('Blanco'));
      assert.ok(zapNegro && zapBlanco);

      const cordonPltId = prodSvc.createPlantilla({
        nombre: 'Cordón Match Test',
        se_fabrica: 0,
        se_compra: 1,
        se_vende: 0,
        precio: 50,
        atributos: [{ atributo: 'Color', valores: ['Negro', 'Blanco'] }],
      });
      const cordonVars = prodSvc.listProductos({ plantilla_id: cordonPltId });
      const cordonNegro = cordonVars.find(v => (v.combinacion_json || v.nombre).includes('Negro'));
      const cordonBlanco = cordonVars.find(v => (v.combinacion_json || v.nombre).includes('Blanco'));
      prodSvc.updateProducto(cordonBlanco.id, { precio: 60 });

      const pegaPltId = prodSvc.createPlantilla({
        nombre: 'Pegamento General Test',
        se_fabrica: 0,
        se_compra: 1,
        se_vende: 0,
        precio: 100,
      });
      const pegaProd = prodSvc.listProductos({ plantilla_id: pegaPltId })[0];

      const recGeneralId = recetaSvc.createReceta({
        plantilla_id: varPltId,
        nombre: 'Receta General',
        activa: true,
      });
      recetaSvc.addRecetaLinea(recGeneralId, {
        producto_id: cordonNegro.id,
        coeficiente: 2,
        emparejar_variante: 1,
      });

      const recNegraId = recetaSvc.createReceta({
        plantilla_id: varPltId,
        producto_id: zapNegro.id,
        nombre: 'Receta Solo Negra',
        activa: true,
      });
      recetaSvc.addRecetaLinea(recNegraId, {
        producto_id: pegaProd.id,
        coeficiente: 3,
      });

      assert.equal(recetaSvc.getActiveRecetaForPlantilla(varPltId, zapNegro.id).id, recNegraId);
      assert.equal(recetaSvc.getActiveRecetaForPlantilla(varPltId, zapBlanco.id).id, recGeneralId);
      assert.ok(recetaSvc.listRecetas().some(r => r.id === recNegraId && r.producto_id === zapNegro.id));
      assert.equal(recetaSvc.getRecetaById(recNegraId).receta.producto_id, zapNegro.id);

      curvaSvc.updateCurva([
        { producto_id: zapBlanco.id, cantidad: 3 },
        { producto_id: zapNegro.id, cantidad: 2 },
      ]);
      const presLive = presupuestoSvc.computePresupuestoLive();
      const lineCordonBlanco = presLive.items.find(r => r.id === cordonBlanco.id);
      const linePega = presLive.items.find(r => r.id === pegaProd.id);
      assert.equal(lineCordonBlanco.cant, 6);
      assert.equal(lineCordonBlanco.subtotal, 360);
      assert.equal(linePega.cant, 6);
      assert.equal(linePega.subtotal, 600);

      // MRP: lead_time_dias por plantilla, consolidación por producto y reposición por stock_minimo
      const cueroMrpPltId = prodSvc.createPlantilla({
        nombre: 'Cuero MRP Consolidado',
        se_fabrica: 0,
        se_compra: 1,
        se_vende: 0,
        proveedor_id: provId,
        lead_time_dias: 12,
        precio: 2000,
        minimo_compra: 10,
      });
      const cueroMrpProd = prodSvc.listProductos({ plantilla_id: cueroMrpPltId })[0];
      const modMrpPltId = prodSvc.createPlantilla({
        nombre: 'Bota MRP Test',
        se_fabrica: 1,
        se_compra: 0,
        se_vende: 1,
      });
      const modMrpProd = prodSvc.listProductos({ plantilla_id: modMrpPltId })[0];
      const recMrpId = recetaSvc.createReceta({ plantilla_id: modMrpPltId, nombre: 'Receta MRP', activa: true });
      recetaSvc.addRecetaLinea(recMrpId, { producto_id: cueroMrpProd.id, coeficiente: 1 });

      produccionSvc.createOrden({
        plantilla_id: modMrpPltId,
        fecha_inicio: '2026-12-20',
        generar_documentos: false,
        lineas: [{ producto_id: modMrpProd.id, cantidad: 2 }],
      });
      produccionSvc.createOrden({
        plantilla_id: modMrpPltId,
        fecha_inicio: '2026-12-25',
        generar_documentos: false,
        lineas: [{ producto_id: modMrpProd.id, cantidad: 3 }],
      });

      const hiloMinPltId = prodSvc.createPlantilla({
        nombre: 'Hilo Stock Minimo MRP',
        se_fabrica: 0,
        se_compra: 1,
        se_vende: 0,
        proveedor_id: provId,
        lead_time_dias: 4,
        stock: 2,
        stock_minimo: 8,
      });
      const hiloMinProd = prodSvc.listProductos({ plantilla_id: hiloMinPltId })[0];

      const mrp = produccionSvc.computeCronogramaCompras();
      const consCuero = mrp.consolidado.find(c => c.producto_id === cueroMrpProd.id);
      assert.ok(consCuero);
      assert.equal(consCuero.lead_time_dias, 12);
      assert.equal(consCuero.demanda_ordenes, 5);
      assert.equal(consCuero.a_comprar, 10);
      assert.equal(consCuero.origenes.length, 2);

      const reqHilo = mrp.requerimientos.find(r => r.producto_id === hiloMinProd.id && r.origen === 'Stock Mínimo');
      const consHilo = mrp.consolidado.find(c => c.producto_id === hiloMinProd.id);
      assert.ok(reqHilo && consHilo);
      assert.equal(reqHilo.lead_time_dias, 4);
      assert.equal(consHilo.a_comprar, 6);

      // UdM Compra != UdM Stock (docenas -> unidades), requiere_lote obligatorio e ingreso auto de PT al cerrar OP
      const brochePltId = prodSvc.createPlantilla({
        nombre: 'Broche Metálico Test',
        se_fabrica: 0,
        se_compra: 1,
        se_vende: 0,
        udm: 'unidades',
        udm_compra: 'docenas',
        requiere_lote: 1,
      });
      const brocheProd = prodSvc.listProductos({ plantilla_id: brochePltId })[0];
      assert.throws(() => opStockSvc.createOperacionStock({
        tipo: 'recepcion',
        fecha: '2026-11-14',
        contacto_id: provId,
        lineas: [{ producto_id: brocheProd.id, cantidad: 2, udm: 'docenas' }],
      }), /requiere especificar un lote/);

      opStockSvc.createOperacionStock({
        tipo: 'recepcion',
        fecha: '2026-11-14',
        contacto_id: provId,
        lineas: [{ producto_id: brocheProd.id, cantidad: 2, udm: 'docenas', lote: 'LOT-BR-01' }],
      });
      const brocheAfter = prodSvc.listProductos({ plantilla_id: brochePltId })[0];
      assert.equal(brocheAfter.stock, 24);

      // Completar todas las etapas de una OP ingresa automáticamente el producto terminado al stock
      const opId = produccionSvc.createOrden({
        plantilla_id: modMrpPltId,
        fecha_inicio: '2026-12-28',
        generar_documentos: false,
        lineas: [{ producto_id: modMrpProd.id, cantidad: 5 }],
      });
      const opDet = produccionSvc.getOrdenDetalle(opId);
      const stockAntesOp = prodSvc.listProductos({ plantilla_id: modMrpPltId })[0].stock;
      for (const et of opDet.etapas) {
        produccionSvc.updateOrdenEtapa(et.id, { estado: 'Completada' });
      }
      const stockDespuesOp = prodSvc.listProductos({ plantilla_id: modMrpPltId })[0].stock;
      assert.equal(stockDespuesOp, stockAntesOp + 5);
    });
  });
});
