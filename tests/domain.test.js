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
import * as configSvc from '../src/services/config/configService.js';

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
});
