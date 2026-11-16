import test from 'node:test';
import assert from 'node:assert/strict';
import { generateRemitoPdf } from '../src/services/print/remitoPdfService.js';
import { generateVentaPdf } from '../src/services/print/ventaPdfService.js';
import { generatePresupuestoPdf } from '../src/services/print/presupuestoPdfService.js';
import { generateOrdenPdf } from '../src/services/print/ordenPdfService.js';

test('Remito PDF: letra X sin CAI, letra R con CAI, fechas dd/mm/aaaa, datos cliente y Recibido Conforme', () => {
  const emp = {
    razon_social: 'Tiago Gabriel Sarthou',
    nombre_fantasia: 'VAGNER',
    cuit: '20449379587',
    condicion_iva: 'Monotributo',
    inicio_actividades: '2026-10-01',
    direccion: 'Gregorio de Laferrere 2728 PB 3',
    localidad: 'CABA',
    provincia: 'Ciudad Autónoma de Buenos Aires',
    codigo_postal: '1406',
    telefono: '1153056615',
    email: 'shop@vagner.ar',
    print_formato: 'A4',
    print_copias: 'original',
  };

  const bufSinCai = generateRemitoPdf({
    tipoDoc: 'REMITO DE ENTREGA',
    numero: 'ENT 0001-00000001',
    fecha: '2026-11-14',
    contraparteLabel: 'Cliente / Destinatario',
    contraparteNombre: 'Zapatería Sur SRL',
    contraparteCuit: '30712345678',
    contraparteDireccion: 'Av. Rivadavia 1234',
    contraparteLocalidad: 'Morón',
    contraparteProvincia: 'Buenos Aires',
    contraparteCp: '1708',
    contraparteTelefono: '1144445555',
    contraparteEmail: 'compras@zapateriasur.ar',
    notasInternas: ['Entregar por portón lateral'],
    lineas: [{ nombre: 'Zapatilla Urbana', lote: 'L-01', cantidad: 12, udm: 'pares' }],
  }, emp);

  const strSinCai = bufSinCai.toString('latin1');
  assert.ok(strSinCai.startsWith('%PDF-1.4'), 'Debe iniciar con cabecera %PDF-1.4');
  assert.ok(strSinCai.includes('%%EOF'), 'Debe terminar con %%EOF');
  assert.ok(strSinCai.includes('(X) Tj'), 'Sin CAI debe emitir letra X');
  assert.ok(strSinCai.includes('(COD. 099) Tj'), 'Sin CAI debe incluir COD. 099');
  assert.ok(!strSinCai.includes('(R) Tj'), 'Sin CAI no debe emitir letra R');
  assert.ok(strSinCai.includes('Punto de Venta: 0001') && strSinCai.includes('Remito Nro: 00000001'), 'Debe separar Punto de Venta y Remito Nro sin prefijo ENT');
  assert.ok(strSinCai.includes('14/11/2026'), 'Fecha debe estar en formato dd/mm/aaaa');
  assert.ok(strSinCai.includes('01/10/2026'), 'Inicio de actividades debe estar en formato dd/mm/aaaa');
  assert.ok(strSinCai.includes('Domicilio: Av. Rivadavia 1234'), 'Debe incluir domicilio del cliente');
  assert.ok(strSinCai.includes('Localidad: Mor') && strSinCai.includes('Provincia: Buenos Aires') && strSinCai.includes('CP: 1708'), 'Debe incluir localidad, provincia y CP separados');
  assert.ok(strSinCai.includes('CP 1406'), 'Debe incluir CP de la empresa');
  assert.ok(strSinCai.includes('compras@zapateriasur.ar'), 'Debe incluir email del cliente');
  assert.ok(strSinCai.includes('Entregar por port'), 'Debe incluir notas internas');
  assert.ok(strSinCai.includes('RECIB\\315 CONFORME') || strSinCai.includes('RECIB'), 'Debe incluir recuadro RECIBÍ CONFORME');
  assert.ok(strSinCai.includes('(DNI:) Tj'), 'Debe incluir campo DNI');
  assert.ok(!strSinCai.includes('Entregado por'), 'No debe incluir Entregado por');

  const bufConCai = generateRemitoPdf({
    tipoDoc: 'REMITO',
    numero: '0001-00000099',
    fecha: '2026-11-14',
    cai: '74123456789012',
    caiVto: '2026-12-31',
    contraparteNombre: 'Cliente Test',
    envio: 'Andreani',
    codigo_seguimiento: 'AR99887766',
    lineas: [{ nombre: 'Bota Cuero', cantidad: 5, udm: 'pares' }],
  }, emp);

  const strConCai = bufConCai.toString('latin1');
  assert.ok(strConCai.includes('(R) Tj'), 'Con CAI debe emitir letra R');
  assert.ok(strConCai.includes('(COD. 91) Tj'), 'Con CAI debe incluir COD. 91');
  assert.ok(strConCai.includes('CAI: 74123456789012'), 'Debe imprimir el CAI');
  assert.ok(strConCai.includes('31/12/2026'), 'Debe imprimir vencimiento del CAI en dd/mm/aaaa');
  assert.ok(strConCai.includes('Andreani'), 'Debe imprimir el envío en el pie del remito');
  assert.ok(strConCai.includes('AR99887766'), 'Debe imprimir el código de seguimiento en el pie del remito');

  const bufVenta = generateVentaPdf({
    venta: {
      id: 1,
      numero: 'FA 0001-00000001',
      fecha: '2026-11-14',
      caracter: 'fiscal',
      tipo_comprobante: 'FC-A',
      cliente_nombre: 'Zapatería Sur SRL',
      cliente_cuit: '30712345678',
      cliente_condicion_iva: 'Responsable Inscripto',
      cliente_direccion: 'Av. Rivadavia 1234',
      cliente_localidad: 'Morón',
      cliente_provincia: 'Buenos Aires',
      cliente_codigo_postal: '1708',
      neto: 1000,
      iva_monto: 210,
      total: 1210,
    },
    lineas: [{ producto_nombre: 'Zapatilla Urbana', cantidad: 2, udm: 'pares', precio_unitario: 500, subtotal: 1000 }],
  }, emp);
  const strVenta = bufVenta.toString('latin1');
  assert.ok(strVenta.startsWith('%PDF-1.4') && strVenta.includes('%%EOF'));
  assert.ok(strVenta.includes('(A) Tj') && strVenta.includes('(COD. 001) Tj'));
  assert.ok(strVenta.includes('Punto de Venta: 0001') && strVenta.includes('Comp. Nro: 00000001'));

  const bufPres = generatePresupuestoPdf({
    id: 42,
    titulo: 'Campaña Invierno',
    fecha: '2026-11-16',
    total_pares: 120,
    total_monto: 950000,
    items: [
      { nombre: 'Cuero Vacuno Negro', categoria: 'Cueros', proveedor_nombre: 'Curtiembre Sur', precio_unitario: 15000, a_comprar: 40, udm: 'metros', subtotal: 600000 },
    ],
  }, emp);
  const strPres = bufPres.toString('latin1');
  assert.ok(strPres.startsWith('%PDF-1.4') && strPres.includes('%%EOF'));
  assert.ok(strPres.includes('Campaña Invierno') || strPres.includes('Campa'));
  assert.ok(strPres.includes('Cuero Vacuno Negro'));

  const bufOrden = generateOrdenPdf({
    orden: {
      id: 7,
      codigo: 'OP-0007',
      plantilla_nombre: 'Bota Chelsea',
      estado: 'En Proceso',
      cantidad: 60,
      fecha_inicio: '2026-11-16',
      fecha_objetivo: '2026-11-30',
      costo_procesos_est: 180000,
      costo_procesos_real: 90000,
    },
    lineas: [{ combinacion: 'Talle 40', cantidad: 30 }, { combinacion: 'Talle 41', cantidad: 30 }],
    etapas: [{ orden: 1, nombre: 'Corte', taller_nombre: 'Taller Norte', fecha_inicio_est: '2026-11-16', fecha_fin_est: '2026-11-20', cantidad_completada: 30, estado: 'En Proceso' }],
    insumos: [{ etapa_nombre: 'Corte', producto_nombre: 'Cuero Vacuno', categoria: 'Cueros', cantidad_requerida: 25, udm: 'metros', stock_actual: 50 }],
  }, emp);
  const strOrden = bufOrden.toString('latin1');
  assert.ok(strOrden.startsWith('%PDF-1.4') && strOrden.includes('%%EOF'));
  assert.ok(strOrden.includes('OP-0007') && strOrden.includes('Bota Chelsea'));
  assert.ok(strOrden.includes('Taller Norte') && strOrden.includes('Cuero Vacuno'));
});
