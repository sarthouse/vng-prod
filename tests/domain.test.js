import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { initDb, runWithDatabase, closeConnection } from '../src/db.js';
import { MODELS } from '../src/db/models.js';
import { buildCreateTableSql, getWritableColumns, validateAgainstModel } from '../src/core/schemaBuilder.js';
import * as contactoSvc from '../src/services/comercial/contactoService.js';
import * as prodSvc from '../src/services/inventario/productoService.js';
import * as recetaSvc from '../src/services/produccion/recetaService.js';
import * as curvaSvc from '../src/services/produccion/curvaService.js';
import * as presSvc from '../src/services/produccion/presupuestoService.js';
import * as pedidoSvc from '../src/services/produccion/pedidoService.js';
import * as produccionSvc from '../src/services/produccion/produccionService.js';
import * as invSvc from '../src/services/inventario/inventarioService.js';
import * as opStockSvc from '../src/services/inventario/operacionStockService.js';
import * as importSvc from '../src/services/config/importService.js';
import * as configSvc from '../src/services/config/configService.js';
import * as compraSvc from '../src/services/comercial/compraService.js';
import * as asientoSvc from '../src/services/finanzas/asientoService.js';
import { buildRecetaFichaPdf } from '../src/services/print/recetaPdfService.js';
import { BaseRepository } from '../src/core/BaseRepository.js';

const TEST_DB = 'test_suite_domain';

function cleanupDb() {
  closeConnection(TEST_DB);
  for (const ext of ['', '-shm', '-wal']) {
    const f = `./db/${TEST_DB}.sqlite${ext}`;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

describe('SSOT Schema-as-Data & Validación', () => {
  it('genera DDL y columnas escribibles desde MODELS', () => {
    const sql = buildCreateTableSql(MODELS.producto_plantillas);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS producto_plantillas/);
    assert.match(sql, /categoria_id INTEGER REFERENCES categorias\(id\) ON DELETE SET NULL/);
    const cols = getWritableColumns(MODELS.contactos);
    assert.ok(cols.includes('es_proveedor'));
    assert.ok(cols.includes('es_cliente'));
    assert.ok(!cols.includes('id'));
  });

  it('valida campos obligatorios, enums, numéricos y booleanos', () => {
    assert.throws(
      () => validateAgainstModel(MODELS.contactos, { es_cliente: true }),
      /obligatorio/
    );
    assert.throws(
      () => validateAgainstModel(MODELS.producto_plantillas, { nombre: 'X', tipo: 'invalido' }),
      /Valor inválido/
    );
    const clean = validateAgainstModel(MODELS.contactos, {
      nombre: '  Proveedor A  ',
      es_proveedor: true,
      es_cliente: false,
    });
    assert.equal(clean.nombre, 'Proveedor A');
    assert.equal(clean.es_proveedor, 1);
    assert.equal(clean.es_cliente, 0);
  });
});

describe('Flujo integral OOP & Partida Doble (Base limpia)', () => {
  before(() => {
    cleanupDb();
    initDb(TEST_DB);
  });

  after(() => {
    cleanupDb();
  });

  it('ejecuta contactos unificados, plantillas con base requerida, receta, curva, presupuesto, pedido, orden e inventario', () => {
    runWithDatabase(TEST_DB, () => {
      const provId = contactoSvc.createContacto({ nombre: 'Curtiembre Norte', es_proveedor: true });
      const cliId = contactoSvc.createContacto({ nombre: 'Zapatería Sur', es_cliente: true });

      const baseId = prodSvc.createPlantilla({
        nombre: 'Base Goma',
        se_fabrica: false,
        se_compra: true,
        categoria: 'Bases',
        udm: 'pares',
        precio: 5000,
      });
      const insumoId = prodSvc.createPlantilla({
        nombre: 'Cuero Negro',
        se_fabrica: false,
        se_compra: true,
        categoria: 'Cueros',
        proveedor_id: provId,
        udm: 'metros',
        precio: 10000,
      });
      const modeloId = prodSvc.createPlantilla({
        nombre: 'Bota Urbana',
        se_fabrica: true,
        se_compra: false,
        categoria: 'Calzado',
        udm: 'pares',
      });

      const baseVar = prodSvc.listProductos({ plantilla_id: baseId })[0];
      const insumoVar = prodSvc.listProductos({ plantilla_id: insumoId })[0];
      const modeloVar = prodSvc.listProductos({ plantilla_id: modeloId })[0];

      // Stock inicial por partida doble (ubicacion virtual -> deposito interno)
      const ubicaciones = invSvc.listUbicaciones();
      const depo = ubicaciones.find(u => u.codigo === 'DEP-INT') || ubicaciones.find(u => u.tipo === 'interna');
      assert.ok(depo, 'Debe existir una ubicación interna por defecto');

      invSvc.registrarMovimientoStock({
        producto_id: insumoVar.id,
        tipo: 'ajuste',
        cantidad: 25,
        ubicacion_destino_id: depo.id,
        lote: 'LOTE-001',
        fecha: '2026-11-14',
        nota: 'Stock inicial test',
      });

      const quants = invSvc.listStockQuants({ ubicacion_id: depo.id }).filter(q => q.producto_id === insumoVar.id);
      assert.equal(quants.reduce((s, q) => s + q.cantidad, 0), 25);

      // Receta técnica + etapa
      const recId = recetaSvc.createReceta({ plantilla_id: modeloId, nombre: 'Receta Principal', activa: true });
      recetaSvc.addRecetaEtapa(recId, { orden: 1, nombre: 'Cortado', dias_estimados: 2 });
      recetaSvc.addRecetaLinea(recId, { producto_id: baseVar.id, coeficiente: 1, udm_receta: 'pares' });
      recetaSvc.addRecetaLinea(recId, { producto_id: insumoVar.id, coeficiente: 0.5, udm_receta: 'metros' });

      // Curva y Presupuesto en vivo (10 pares -> 10*5000 base + max(0, 5 - 25 stock) = 50000 + 0, o bruto 5m)
      curvaSvc.updateCurva([{ producto_id: modeloVar.id, cantidad: 10 }]);
      const curva = curvaSvc.computeCurvaSummary();
      assert.equal(curva.totalPares, 10);
      assert.equal(curva.plantillas.length, 1);

      const pres = presSvc.computePresupuestoLive();
      assert.equal(pres.totalPares, 10);
      assert.ok(pres.items.some(i => i.nombre.includes('Base Goma') && i.cant === 10));

      // Pedido con snapshot + Orden de Producción
      const pedRes = pedidoSvc.createPedido({
        plantilla_id: modeloId,
        contacto_id: cliId,
        fecha: '2026-11-14',
        lineas: [{ producto_id: modeloVar.id, cantidad: 4 }],
      });
      const pedDet = pedidoSvc.getPedidoDetalle(pedRes.id);
      assert.equal(pedDet.pedido.cantidad, 4);
      assert.equal(pedDet.snapshot.length, 2);

      const ordRes = produccionSvc.createOrden({
        plantilla_id: modeloId,
        pedido_id: pedRes.id,
        fecha_inicio: '2026-11-14',
      });
      const ordId = typeof ordRes === 'object' ? ordRes.id : ordRes;
      const ordDet = produccionSvc.getOrdenDetalle(ordId);
      assert.equal(ordDet.orden.cantidad, 4);
      assert.equal(ordDet.insumos.length, 2);

      // Ingreso parcial de producción (2 pares ahora, quedan 2 pendientes)
      const ingParcial = produccionSvc.registrarIngresoParcialOrden(ordId, {
        fecha: '2026-11-15',
        nota: 'Primera tanda',
        lineas: [{ producto_id: modeloVar.id, cantidad: 2 }],
      });
      assert.equal(ingParcial.ingresado, 2);
      const ordDet2 = produccionSvc.getOrdenDetalle(ordId);
      assert.equal(ordDet2.orden.cantidad_ingresada, 2);
      assert.equal(ordDet2.orden.cantidad_pendiente, 2);

      // Confirmación parcial de operación de stock con generación automática de Backorder
      const opId = opStockSvc.createOperacionStock({
        fecha: '2026-11-15',
        tipo: 'entrega',
        contacto_id: cliId,
        estado: 'Borrador',
        motivo: 'Entrega test backorder',
        lineas: [{ producto_id: modeloVar.id, cantidad: 4, udm: 'pares' }],
      });
      const opDet = opStockSvc.getOperacionStockById(opId);
      const confRes = opStockSvc.confirmarOperacionStock(opId, {
        lineas: [{ id: opDet.lineas[0].id, producto_id: modeloVar.id, cantidad: 1 }],
        generar_backorder: true,
      });
      assert.ok(confRes.backorder_id, 'Debe crear documento Backorder en Borrador por las 3 unidades restantes');
      const backorderDet = opStockSvc.getOperacionStockById(confRes.backorder_id);
      assert.equal(backorderDet.operacion.estado, 'Borrador');
      assert.equal(backorderDet.lineas[0].cantidad, 3);

      // Importación CSV con Upsert
      const impRes1 = importSvc.importProductos([
        { codigo: 'IMP-01', nombre: 'Hebilla Níquel', se_fabrica: '0', se_compra: '1', se_vende: '0', udm: 'unidades', costo: '150', precio: '200', stock: '10' },
      ]);
      assert.equal(impRes1.created, 1);
      const impRes2 = importSvc.importProductos([
        { codigo: 'IMP-01', nombre: 'Hebilla Níquel', se_fabrica: '0', se_compra: '1', se_vende: '0', udm: 'unidades', costo: '180', precio: '250', stock: '10' },
      ]);
      assert.equal(impRes2.updated, 1);

      // Secuencias: prefijo, sufijo, padding, siguiente_numero y dominio
      const seqs = configSvc.listSecuencias({ dominio: 'ventas' });
      assert.ok(seqs.some(s => s.codigo === 'venta'));
      const ventaSeq = seqs.find(s => s.codigo === 'venta');
      configSvc.updateSecuencia(ventaSeq.id, { prefijo: 'FB', sufijo: '-AR', padding: 6, siguiente_numero: 42 });
      const nextNum = configSvc.getNextNumeroDocumento('venta', 1);
      assert.equal(nextNum.numero, 'FB 0001-000042-AR');
      assert.equal(nextNum.dominio, 'ventas');

      // 3NF: renombrar categoría refleja en v_plantillas sin UPDATE en texto
      const catId = configSvc.createCategoria('Cueros Premium');
      prodSvc.updatePlantilla(insumoId, { categoria_id: catId });
      configSvc.updateCategoria(catId, 'Cueros Importados');
      const insumoInfo = prodSvc.getPlantillaById(insumoId);
      assert.equal(insumoInfo.plantilla.categoria, 'Cueros Importados');
    });
  });

  it('propaga taller y cuenta contable en etapas y genera compra interna + asiento al completar', () => {
    runWithDatabase(TEST_DB, () => {
      const tallerId = contactoSvc.createContacto({ nombre: 'Taller Aparado Test', es_taller: true, es_proveedor: true });
      const planCuentaRepo = new BaseRepository({ model: MODELS.plan_cuentas });
      const ctaManoObra = planCuentaRepo.query().where('codigo', '5.1.02').where('activo', 1).get();
      assert.ok(ctaManoObra, 'Debe existir la cuenta 5.1.02 Mano de Obra / Talleres en el plan');

      const etapaCfgId = configSvc.createEtapa({
        nombre: 'Aparado Tercerizado Test',
        descripcion: 'Costura externa',
        orden: 99,
        dias_estimados: 2,
        costo_unidad: 2500,
        taller_id: tallerId,
        plan_cuenta_id: ctaManoObra.id,
      });
      assert.ok(etapaCfgId > 0);

      const modId = prodSvc.createPlantilla({
        codigo: 'ZAP-ET-01',
        nombre: 'Zapato Etapa Test',
        se_fabrica: true,
        udm: 'pares',
        atributos: { Talle: ['40'] },
      });
      const modDet = prodSvc.getPlantillaById(modId);
      const prodVar = modDet.variantes[0];

      const recId = recetaSvc.createReceta({
        plantilla_id: modId,
        nombre: 'Receta Etapa Test',
        activa: true,
      });
      const recDet = recetaSvc.getRecetaById(recId);
      const recEtapa = recDet.etapas.find(e => e.nombre === 'Aparado Tercerizado Test');
      assert.ok(recEtapa, 'La receta debe clonar la etapa configurada');
      assert.equal(recEtapa.taller_id, tallerId);
      assert.equal(recEtapa.plan_cuenta_id, ctaManoObra.id);

      const ordenId = produccionSvc.createOrden({
        plantilla_id: modId,
        receta_id: recId,
        fecha_inicio: '2026-11-16',
        lineas: [{ producto_id: prodVar.id, cantidad: 4 }],
        generar_documentos: false,
      });
      const ordenDet1 = produccionSvc.getOrdenDetalle(ordenId);
      const ordEtapa = ordenDet1.etapas.find(e => e.nombre === 'Aparado Tercerizado Test');
      assert.ok(ordEtapa, 'La orden debe heredar la etapa de la receta');
      assert.equal(ordEtapa.taller_id, tallerId);
      assert.equal(ordEtapa.plan_cuenta_id, ctaManoObra.id);
      assert.equal(ordEtapa.costo_estimado, 10000);
      assert.equal(ordEtapa.compra_id, null);

      produccionSvc.updateOrdenEtapa(ordEtapa.id, {
        estado: 'Completada',
        costo_real: 12000,
      });
      const ordenDet2 = produccionSvc.getOrdenDetalle(ordenId);
      const ordEtapaDone = ordenDet2.etapas.find(e => e.id === ordEtapa.id);
      assert.ok(ordEtapaDone.compra_id, 'Completar etapa con taller y costo_real > 0 debe crear compra_id');

      const compraDet = compraSvc.getCompraById(ordEtapaDone.compra_id);
      assert.equal(compraDet.compra.estado, 'Confirmado');
      assert.equal(compraDet.compra.caracter, 'interno');
      assert.equal(compraDet.compra.contacto_id, tallerId);
      assert.equal(compraDet.compra.total, 12000);
      assert.equal(compraDet.lineas[0].plan_cuenta_id, ctaManoObra.id);

      const cc = contactoSvc.getContactoById(tallerId);
      assert.equal(cc.saldo_proveedor, 12000);

      const asiento = asientoSvc.getAsientoById(compraDet.compra.asiento_id);
      assert.equal(asiento.asiento.estado, 'Confirmado');
      assert.equal(asiento.lineas.reduce((s, l) => s + l.debe, 0), 12000);
      assert.equal(asiento.lineas.reduce((s, l) => s + l.haber, 0), 12000);
      assert.ok(asiento.lineas.some(l => l.plan_cuenta_id === ctaManoObra.id && l.debe === 12000));

      // Idempotencia: volver a guardar la etapa completada no duplica la compra
      produccionSvc.updateOrdenEtapa(ordEtapa.id, { notas: 'Revisado' });
      const ordenDet3 = produccionSvc.getOrdenDetalle(ordenId);
      const ordEtapaAgain = ordenDet3.etapas.find(e => e.id === ordEtapa.id);
      assert.equal(ordEtapaAgain.compra_id, ordEtapaDone.compra_id);
    });
  });

  it('registra historial de costos y precios desde edición manual, compra y receta', () => {
      runWithDatabase(TEST_DB, () => {
        const pltId = prodSvc.createPlantilla({
          codigo: 'HIST-01',
          nombre: 'Insumo Historial',
          se_compra: true,
          costo: 100,
          precio: 200,
        });
        const pltDet = prodSvc.getPlantillaById(pltId);
        const varId = pltDet.variantes[0].id;

        // 1. Edición manual con cambio real
        prodSvc.updateProducto(varId, { costo: 150, precio: 250 }, { origen: 'manual', user: { username: 'tester' } });
        // Sin cambios: no debe agregar fila
        prodSvc.updateProducto(varId, { costo: 150, precio: 250 }, { origen: 'manual' });

        // 2. Compra confirmada actualiza costo y registra historial
        const provId = contactoSvc.createContacto({ nombre: 'Proveedor Hist', es_proveedor: true });
        compraSvc.createCompra({
          contacto_id: provId,
          numero: 'FA-A 0001-00000123',
          fecha: '2026-11-16',
          estado: 'Confirmado',
          lineas: [{ producto_id: varId, cantidad: 2, precio_unitario: 180, alicuota_iva: 21 }],
        });

        const hist = prodSvc.listHistorialPrecios({ plantilla_id: pltId });
        assert.equal(hist.length, 2);
        assert.equal(hist[0].origen, 'compra');
        assert.equal(hist[0].costo_anterior, 150);
        assert.equal(hist[0].costo_nuevo, 180);
        assert.equal(hist[1].origen, 'manual');
        assert.equal(hist[1].costo_anterior, 100);
        assert.equal(hist[1].costo_nuevo, 150);
        assert.equal(hist[1].precio_anterior, 200);
        assert.equal(hist[1].precio_nuevo, 250);
        assert.equal(hist[1].usuario, 'tester');
    });
  });

  it('genera ficha tecnica PDF con texto enriquecido e imagenes de producto y etapas', () => {
    runWithDatabase(TEST_DB, () => {
      const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const pltId = prodSvc.createPlantilla({
        codigo: 'FT-01',
        nombre: 'Bota Ficha PDF',
        se_fabrica: true,
        imagen_data: tinyPng,
      });
      const recId = recetaSvc.createReceta({
        plantilla_id: pltId,
        nombre: 'Receta Ficha PDF',
        activa: true,
        ficha_tecnica_html: '<h3>Corte</h3><p>Usar <strong>cuero vacuno</strong> 1.8mm.</p><ul><li>Hilo encerado #40</li></ul>',
      });
      const recDet = recetaSvc.getRecetaById(recId);
      assert.equal(recDet.receta.plantilla_imagen, tinyPng);
      if (recDet.etapas[0]) {
        recetaSvc.updateRecetaEtapa(recDet.etapas[0].id, { imagen_data: tinyPng });
      }
      const pdfConCostos = buildRecetaFichaPdf(recId, { conCostos: true });
      const pdfSinCostos = buildRecetaFichaPdf(recId, { conCostos: false });
      assert.ok(Buffer.isBuffer(pdfConCostos) && pdfConCostos.subarray(0, 8).toString('latin1').startsWith('%PDF-1.4'));
      assert.ok(pdfConCostos.toString('latin1').includes('/Subtype /Image'));
      assert.ok(Buffer.isBuffer(pdfSinCostos) && pdfSinCostos.toString('latin1').includes('Variantes'));
    });
  });
});
