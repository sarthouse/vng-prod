import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { initDb, runWithDatabase, closeConnection, getDbPath } from '../src/db.js';
import { MODELS } from '../src/db/models.js';
import { BaseRepository } from '../src/core/BaseRepository.js';
import * as contactoSvc from '../src/services/comercial/contactoService.js';
import * as prodSvc from '../src/services/inventario/productoService.js';
import * as ventaSvc from '../src/services/comercial/ventaService.js';
import * as compraSvc from '../src/services/comercial/compraService.js';
import * as ocSvc from '../src/services/comercial/ordenCompraService.js';
import * as recetaSvc from '../src/services/produccion/recetaService.js';
import * as opSvc from '../src/services/produccion/produccionService.js';

const productoRepo = new BaseRepository({ model: MODELS.productos });
const compraRepo = new BaseRepository({ model: MODELS.compras });

function withIsolatedDb(fn) {
  const dbName = `test_oc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  initDb(dbName);
  try {
    return runWithDatabase(dbName, () => fn());
  } finally {
    closeConnection(dbName);
    for (const ext of ['', '-shm', '-wal']) {
      fs.rmSync(`${getDbPath(dbName)}${ext}`, { force: true });
    }
  }
}

test('Abastecimiento Retail (Venta) genera Orden de Compra en Borrador y conversión a Factura de Compra', () => {
  withIsolatedDb(() => {
    const provId = contactoSvc.createContacto({ nombre: 'Proveedor Retail SA', cuit: '30-74444444-9', es_proveedor: 1 });
    const cliId = contactoSvc.createContacto({ nombre: 'Cliente Retail SA', cuit: '30-75555555-9', es_cliente: 1 });

    const pltId = prodSvc.createPlantilla({
      nombre: 'Cordón Importado',
      codigo: 'CORD-1',
      proveedor_id: provId,
      se_fabrica: false,
      se_compra: true,
      se_vende: true,
      costo: 200,
      precio: 500,
      udm: 'unidades',
    });
    const prod = productoRepo.query().where('plantilla_id', pltId).get();

    const comprasAntes = compraRepo.query().count();

    // Venta Confirmada con faltante de 6 unidades -> debe disparar OC en Borrador, NO Compra fiscal
    const ventaId = ventaSvc.createVenta({
      contacto_id: cliId,
      caracter: 'interno',
      tipo_comprobante: 'FC-X',
      estado: 'Confirmada',
      lineas: [{ producto_id: prod.id, cantidad: 6, udm: 'unidades', precio_unitario: 500, alicuota_iva: 0 }],
    });

    assert.equal(compraRepo.query().count(), comprasAntes, 'No debe crear Compra fiscal en abastecimiento automático');
    const ocs = ocSvc.listOrdenesCompra({ proveedor_id: provId });
    assert.equal(ocs.length, 1);
    assert.equal(ocs[0].estado, 'Borrador');
    assert.equal(ocs[0].origen_tipo, 'venta');
    assert.equal(ocs[0].origen_id, ventaId);

    // Enviar OC -> Enviada
    ocSvc.enviarOrdenCompra(ocs[0].id);
    assert.equal(ocSvc.getOrdenCompraById(ocs[0].id).orden.estado, 'Enviada');

    // Convertir OC a Factura de Compra -> Facturada y compra vinculada
    const conv = ocSvc.convertirOrdenCompraACompra(ocs[0].id, {
      caracter: 'interno',
      estado: 'Confirmado',
      recibir_inmediato: true,
    });
    assert.ok(conv.compra_id);
    const ocAfter = ocSvc.getOrdenCompraById(ocs[0].id).orden;
    assert.equal(ocAfter.estado, 'Facturada');
    assert.equal(ocAfter.compra_id, conv.compra_id);

    const cmpDet = compraSvc.getCompraById(conv.compra_id);
    assert.equal(cmpDet.compra.orden_compra_id, ocs[0].id);
    assert.equal(cmpDet.lineas[0].cantidad, 6);
  });
});

test('Abastecimiento Producción genera Orden de Compra en Borrador sin ensuciar Compras fiscales', () => {
  withIsolatedDb(() => {
    const provId = contactoSvc.createContacto({ nombre: 'Proveedor Cuero SA', cuit: '30-76666666-9', es_proveedor: 1 });
    const insPltId = prodSvc.createPlantilla({
      nombre: 'Cuero Vacuno OC',
      codigo: 'CUERO-OC',
      proveedor_id: provId,
      se_fabrica: false,
      se_compra: true,
      se_vende: false,
      costo: 1000,
      udm: 'unidades',
    });
    const insProd = productoRepo.query().where('plantilla_id', insPltId).get();

    const ptPltId = prodSvc.createPlantilla({
      nombre: 'Bota OC',
      codigo: 'BOTA-OC',
      se_fabrica: true,
      se_compra: false,
      se_vende: true,
      precio: 15000,
      udm: 'pares',
    });
    const ptProd = productoRepo.query().where('plantilla_id', ptPltId).get();

    const recId = recetaSvc.createReceta({
      plantilla_id: ptPltId,
      nombre: 'Receta Bota OC',
      activa: true,
    });
    recetaSvc.addRecetaLinea(recId, {
      producto_id: insProd.id,
      coeficiente: 2,
      udm_receta: 'unidades',
    });

    const comprasAntes = compraRepo.query().count();
    const ordenId = opSvc.createOrden({
      plantilla_id: ptPltId,
      receta_id: recId,
      fecha_inicio: '2026-11-22',
      lineas: [{ producto_id: ptProd.id, cantidad: 5 }],
    });

    assert.equal(compraRepo.query().count(), comprasAntes);
    const ocs = ocSvc.listOrdenesCompra({ proveedor_id: provId });
    assert.equal(ocs.length, 1);
    assert.equal(ocs[0].origen_tipo, 'orden');
    assert.equal(ocs[0].origen_id, ordenId);
    assert.equal(ocs[0].estado, 'Borrador');
  });
});
