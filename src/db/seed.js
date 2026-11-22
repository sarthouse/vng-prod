import { BaseRepository } from '../core/BaseRepository.js';
import { MODELS } from './models.js';
import { JURISDICCIONES_AR } from '../../public/lib/jurisdicciones.js';
import { PLAN_CUENTAS_TEMPLATES } from '../services/finanzas/planCuentasTemplates.js';

const DEFAULT_UNITS = [
  { nombre: 'g', grupo: 'Masa', factor: 1 },
  { nombre: 'kg', grupo: 'Masa', factor: 1000 },
  { nombre: 'mm', grupo: 'Longitud', factor: 1 },
  { nombre: 'cm', grupo: 'Longitud', factor: 10 },
  { nombre: 'metros', grupo: 'Longitud', factor: 1000 },
  { nombre: 'cm3', grupo: 'Volumen', factor: 1 },
  { nombre: 'litros', grupo: 'Volumen', factor: 1000 },
  { nombre: 'cm2', grupo: 'Superficie', factor: 1 },
  { nombre: 'm2', grupo: 'Superficie', factor: 10000 },
  { nombre: 'unidades', grupo: 'Cantidad', factor: 1 },
  { nombre: 'pares', grupo: 'Cantidad', factor: 2 },
  { nombre: 'docenas', grupo: 'Cantidad', factor: 12 },
  { nombre: 'centenas', grupo: 'Cantidad', factor: 100 },
  { nombre: 'mil', grupo: 'Cantidad', factor: 1000 },
];

const DEFAULT_CATEGORIES = [
  { nombre: 'Mano de obra' },
  { nombre: 'Bases' },
  { nombre: 'Plantillas' },
  { nombre: 'Cueros' },
  { nombre: 'Otros insumos' },
  { nombre: 'Packaging' },
];

const DEFAULT_ETAPAS = [
  { nombre: 'Cortado', orden: 1, dias_estimados: 3 },
  { nombre: 'Aparado', orden: 2, dias_estimados: 5 },
  { nombre: 'Costura', orden: 3, dias_estimados: 1 },
  { nombre: 'Armado', orden: 4, dias_estimados: 3 },
  { nombre: 'Terminación', orden: 5, dias_estimados: 2 },
];

const DEFAULT_CUENTAS = [
  { nombre: 'Caja Efectivo', tipo: 'efectivo', moneda: 'ARS', saldo_inicial: 0, saldo_actual: 0 },
  { nombre: 'Banco Principal', tipo: 'banco', moneda: 'ARS', saldo_inicial: 0, saldo_actual: 0 },
];

const DEFAULT_PUNTOS_VENTA = [
  { numero: 1, nombre: 'Casa Central', es_default: 1, activo: 1 },
];

const DEFAULT_SECUENCIAS = [
  { codigo: 'compra', nombre: 'Facturas de Compra', dominio: 'compras', prefijo: 'FC', sufijo: '', padding: 8, siguiente_numero: 1, usa_punto_venta: 1, activo: 1 },
  { codigo: 'nc_compra', nombre: 'Notas de Crédito Compra', dominio: 'compras', prefijo: 'NCC', sufijo: '', padding: 8, siguiente_numero: 1, usa_punto_venta: 1, activo: 1 },
  { codigo: 'nd_compra', nombre: 'Notas de Débito Compra', dominio: 'compras', prefijo: 'NDC', sufijo: '', padding: 8, siguiente_numero: 1, usa_punto_venta: 1, activo: 1 },
  { codigo: 'orden_compra', nombre: 'Órdenes de Compra', dominio: 'compras', prefijo: 'OC-', sufijo: '', padding: 6, siguiente_numero: 1, usa_punto_venta: 0, activo: 1 },
  { codigo: 'venta', nombre: 'Facturas de Venta A', dominio: 'ventas', prefijo: 'FA', sufijo: '', padding: 8, siguiente_numero: 1, usa_punto_venta: 1, activo: 1 },
  { codigo: 'venta_b', nombre: 'Facturas de Venta B', dominio: 'ventas', prefijo: 'FB', sufijo: '', padding: 8, siguiente_numero: 1, usa_punto_venta: 1, activo: 1 },
  { codigo: 'venta_c', nombre: 'Facturas de Venta C', dominio: 'ventas', prefijo: 'FC', sufijo: '', padding: 8, siguiente_numero: 1, usa_punto_venta: 1, activo: 1 },
  { codigo: 'venta_x', nombre: 'Facturas de Venta X (Internas)', dominio: 'ventas', prefijo: 'FX', sufijo: '', padding: 8, siguiente_numero: 1, usa_punto_venta: 1, activo: 1 },
  { codigo: 'nc_venta', nombre: 'Notas de Crédito Venta A', dominio: 'ventas', prefijo: 'NCA', sufijo: '', padding: 8, siguiente_numero: 1, usa_punto_venta: 1, activo: 1 },
  { codigo: 'nc_venta_b', nombre: 'Notas de Crédito Venta B', dominio: 'ventas', prefijo: 'NCB', sufijo: '', padding: 8, siguiente_numero: 1, usa_punto_venta: 1, activo: 1 },
  { codigo: 'nc_venta_c', nombre: 'Notas de Crédito Venta C', dominio: 'ventas', prefijo: 'NCC', sufijo: '', padding: 8, siguiente_numero: 1, usa_punto_venta: 1, activo: 1 },
  { codigo: 'nc_venta_x', nombre: 'Notas de Crédito Venta X (Internas)', dominio: 'ventas', prefijo: 'NCX', sufijo: '', padding: 8, siguiente_numero: 1, usa_punto_venta: 1, activo: 1 },
  { codigo: 'nd_venta', nombre: 'Notas de Débito Venta A', dominio: 'ventas', prefijo: 'NDA', sufijo: '', padding: 8, siguiente_numero: 1, usa_punto_venta: 1, activo: 1 },
  { codigo: 'nd_venta_b', nombre: 'Notas de Débito Venta B', dominio: 'ventas', prefijo: 'NDB', sufijo: '', padding: 8, siguiente_numero: 1, usa_punto_venta: 1, activo: 1 },
  { codigo: 'nd_venta_c', nombre: 'Notas de Débito Venta C', dominio: 'ventas', prefijo: 'NDC', sufijo: '', padding: 8, siguiente_numero: 1, usa_punto_venta: 1, activo: 1 },
  { codigo: 'nd_venta_x', nombre: 'Notas de Débito Venta X (Internas)', dominio: 'ventas', prefijo: 'NDX', sufijo: '', padding: 8, siguiente_numero: 1, usa_punto_venta: 1, activo: 1 },
  { codigo: 'remito', nombre: 'Remitos y Traslados', dominio: 'inventario', prefijo: 'REM', sufijo: '', padding: 8, siguiente_numero: 1, usa_punto_venta: 1, activo: 1 },
  { codigo: 'operacion_stock', nombre: 'Operaciones de Stock', dominio: 'inventario', prefijo: 'STK-', sufijo: '', padding: 5, siguiente_numero: 1, usa_punto_venta: 0, activo: 1 },
  { codigo: 'orden', nombre: 'Órdenes de Producción', dominio: 'produccion', prefijo: 'OP-', sufijo: '', padding: 5, siguiente_numero: 1, usa_punto_venta: 0, activo: 1 },
  { codigo: 'pago', nombre: 'Órdenes de Pago', dominio: 'tesoreria', prefijo: 'OP', sufijo: '', padding: 8, siguiente_numero: 1, usa_punto_venta: 1, activo: 1 },
  { codigo: 'cobro', nombre: 'Recibos de Cobro', dominio: 'tesoreria', prefijo: 'RC', sufijo: '', padding: 8, siguiente_numero: 1, usa_punto_venta: 1, activo: 1 },
  { codigo: 'retencion', nombre: 'Certificados de Retención', dominio: 'tesoreria', prefijo: 'RET-', sufijo: '', padding: 8, siguiente_numero: 1, usa_punto_venta: 0, activo: 1 },
  { codigo: 'asiento', nombre: 'Asientos Contables', dominio: 'contabilidad', prefijo: 'ASI-', sufijo: '', padding: 6, siguiente_numero: 1, usa_punto_venta: 0, activo: 1 },
];

const DEFAULT_IMPUESTOS = [
  { nombre: 'IVA 21%', codigo: 'IVA-21', tipo: 'iva', aplica_a: 'ambos', alicuota_defecto: 21.0, base_calculo: 'neto' },
  { nombre: 'IVA 10.5%', codigo: 'IVA-10.5', tipo: 'iva', aplica_a: 'ambos', alicuota_defecto: 10.5, base_calculo: 'neto' },
  { nombre: 'IVA 27%', codigo: 'IVA-27', tipo: 'iva', aplica_a: 'ambos', alicuota_defecto: 27.0, base_calculo: 'neto' },
  { nombre: 'IVA 0% / Exento', codigo: 'IVA-0', tipo: 'iva', aplica_a: 'ambos', alicuota_defecto: 0, base_calculo: 'neto' },
  { nombre: 'Percepción IIBB ARBA', codigo: 'PERC-IIBB-ARBA', tipo: 'percepcion', aplica_a: 'ambos', alicuota_defecto: 3.0, base_calculo: 'neto', jurisdiccion_codigo: '902', codigo_regimen: '902' },
  { nombre: 'Percepción IIBB AGIP / CABA', codigo: 'PERC-IIBB-CABA', tipo: 'percepcion', aplica_a: 'ambos', alicuota_defecto: 2.5, base_calculo: 'neto', jurisdiccion_codigo: '901', codigo_regimen: '901' },
  { nombre: 'Percepción IVA', codigo: 'PERC-IVA', tipo: 'percepcion', aplica_a: 'compras', alicuota_defecto: 3.0, base_calculo: 'neto', jurisdiccion_codigo: '', codigo_regimen: '493' },
  { nombre: 'Retención Ganancias', codigo: 'RET-GAN', tipo: 'retencion', aplica_a: 'ambos', alicuota_defecto: 2.0, base_calculo: 'neto', jurisdiccion_codigo: '', codigo_regimen: '78' },
  { nombre: 'Retención IIBB ARBA', codigo: 'RET-IIBB-ARBA', tipo: 'retencion', aplica_a: 'ambos', alicuota_defecto: 1.5, base_calculo: 'neto', jurisdiccion_codigo: '902', codigo_regimen: '902' },
  { nombre: 'Retención IIBB AGIP / CABA', codigo: 'RET-IIBB-CABA', tipo: 'retencion', aplica_a: 'ambos', alicuota_defecto: 1.5, base_calculo: 'neto', jurisdiccion_codigo: '901', codigo_regimen: '901' },
  { nombre: 'Impuesto Interno / Otro', codigo: 'OTRO-IMP', tipo: 'otro', aplica_a: 'ambos', alicuota_defecto: 0, base_calculo: 'neto', jurisdiccion_codigo: '', codigo_regimen: '' },
];

const DEFAULT_UBICACIONES = [
  { codigo: 'DEP-CENTRAL', nombre: 'Depósito Central', tipo: 'interna', es_default: 1, activa: 1 },
  { codigo: 'TALLER-EXT', nombre: 'En Taller / Proceso', tipo: 'interna', es_default: 0, activa: 1 },
  { codigo: 'PROD-TERM', nombre: 'Producto Terminado', tipo: 'interna', es_default: 0, activa: 1 },
  { codigo: 'VIRT-PROV', nombre: 'Proveedores (Virtual)', tipo: 'virtual', es_default: 0, activa: 1 },
  { codigo: 'VIRT-CLI', nombre: 'Clientes (Virtual)', tipo: 'virtual', es_default: 0, activa: 1 },
  { codigo: 'VIRT-PROD', nombre: 'Producción / Consumo (Virtual)', tipo: 'virtual', es_default: 0, activa: 1 },
  { codigo: 'VIRT-AJUSTE', nombre: 'Ajustes de Inventario (Virtual)', tipo: 'virtual', es_default: 0, activa: 1 },
];

const DEFAULT_GRUPOS = [
  {
    nombre: 'Administrador',
    descripcion: 'Acceso total al sistema, configuración y gestión de usuarios',
    permisos_json: JSON.stringify(['*']),
    es_admin: 1,
  },
  {
    nombre: 'Operaciones',
    descripcion: 'Producción, inventario y comercial',
    permisos_json: JSON.stringify([
      'produccion.ver', 'produccion.editar',
      'inventario.ver', 'inventario.editar',
      'comercial.ver', 'comercial.editar',
      'tesoreria.ver',
    ]),
    es_admin: 0,
  },
  {
    nombre: 'Consulta',
    descripcion: 'Solo lectura en todos los módulos',
    permisos_json: JSON.stringify(['produccion.ver', 'inventario.ver', 'comercial.ver', 'tesoreria.ver']),
    es_admin: 0,
  },
];

const DEFAULT_NOMINA_CONCEPTOS = [
  { codigo_interno: 'BASICO', descripcion: 'Sueldo Básico', tipo: 'remunerativo', codigo_afip_lsd: '110000', formula_tipo: 'porcentaje_basico', valor_default: 100, aporta_sipa: 1, aporta_inssjp: 1, aporta_os: 1, aporta_fsr: 1, aporta_lrt: 1, base_sac: 1, activo: 1 },
  { codigo_interno: 'ANTIGUEDAD', descripcion: 'Adicional Antigüedad', tipo: 'remunerativo', codigo_afip_lsd: '120000', formula_tipo: 'porcentaje_basico', valor_default: 1, aporta_sipa: 1, aporta_inssjp: 1, aporta_os: 1, aporta_fsr: 1, aporta_lrt: 1, base_sac: 1, activo: 1 },
  { codigo_interno: 'PRESENTISMO', descripcion: 'Adicional Presentismo', tipo: 'remunerativo', codigo_afip_lsd: '130000', formula_tipo: 'porcentaje_basico', valor_default: 8.33, aporta_sipa: 1, aporta_inssjp: 1, aporta_os: 1, aporta_fsr: 1, aporta_lrt: 1, base_sac: 1, activo: 1 },
  { codigo_interno: 'SAC', descripcion: 'Sueldo Anual Complementario (SAC)', tipo: 'remunerativo', codigo_afip_lsd: '510000', formula_tipo: 'manual', valor_default: 0, aporta_sipa: 1, aporta_inssjp: 1, aporta_os: 1, aporta_fsr: 1, aporta_lrt: 1, base_sac: 0, activo: 1 },
  { codigo_interno: 'VACACIONES', descripcion: 'Licencia Anual / Vacaciones', tipo: 'remunerativo', codigo_afip_lsd: '520000', formula_tipo: 'manual', valor_default: 0, aporta_sipa: 1, aporta_inssjp: 1, aporta_os: 1, aporta_fsr: 1, aporta_lrt: 1, base_sac: 1, activo: 1 },
  { codigo_interno: 'NO_REM', descripcion: 'Suma No Remunerativa', tipo: 'no_remunerativo', codigo_afip_lsd: '550000', formula_tipo: 'manual', valor_default: 0, aporta_sipa: 0, aporta_inssjp: 0, aporta_os: 1, aporta_fsr: 0, aporta_lrt: 1, base_sac: 0, activo: 1 },
  { codigo_interno: 'JUBILACION', descripcion: 'Jubilación Ley 24.241 (11%)', tipo: 'descuento_retencion', codigo_afip_lsd: '810001', formula_tipo: 'porcentaje_remunerativo', valor_default: 11, aporta_sipa: 0, aporta_inssjp: 0, aporta_os: 0, aporta_fsr: 0, aporta_lrt: 0, base_sac: 0, activo: 1 },
  { codigo_interno: 'PAMI', descripcion: 'Ley 19.032 / PAMI (3%)', tipo: 'descuento_retencion', codigo_afip_lsd: '810002', formula_tipo: 'porcentaje_remunerativo', valor_default: 3, aporta_sipa: 0, aporta_inssjp: 0, aporta_os: 0, aporta_fsr: 0, aporta_lrt: 0, base_sac: 0, activo: 1 },
  { codigo_interno: 'OBRA_SOCIAL', descripcion: 'Obra Social (3%)', tipo: 'descuento_retencion', codigo_afip_lsd: '810003', formula_tipo: 'porcentaje_remunerativo', valor_default: 3, aporta_sipa: 0, aporta_inssjp: 0, aporta_os: 0, aporta_fsr: 0, aporta_lrt: 0, base_sac: 0, activo: 1 },
  { codigo_interno: 'SINDICATO', descripcion: 'Cuota Sindical (2%)', tipo: 'descuento_retencion', codigo_afip_lsd: '810004', formula_tipo: 'porcentaje_remunerativo', valor_default: 2, aporta_sipa: 0, aporta_inssjp: 0, aporta_os: 0, aporta_fsr: 0, aporta_lrt: 0, base_sac: 0, activo: 1 },
  { codigo_interno: 'CONTRIB_SIPA', descripcion: 'Contribución Patronal SIPA / INSSJP / FNE (18%)', tipo: 'contribucion_patronal', codigo_afip_lsd: '820001', formula_tipo: 'porcentaje_remunerativo', valor_default: 18, aporta_sipa: 0, aporta_inssjp: 0, aporta_os: 0, aporta_fsr: 0, aporta_lrt: 0, base_sac: 0, activo: 1 },
  { codigo_interno: 'CONTRIB_OS', descripcion: 'Contribución Patronal Obra Social (6%)', tipo: 'contribucion_patronal', codigo_afip_lsd: '820002', formula_tipo: 'porcentaje_remunerativo', valor_default: 6, aporta_sipa: 0, aporta_inssjp: 0, aporta_os: 0, aporta_fsr: 0, aporta_lrt: 0, base_sac: 0, activo: 1 },
  { codigo_interno: 'CONTRIB_ART', descripcion: 'ART / LRT + SCVO', tipo: 'contribucion_patronal', codigo_afip_lsd: '820003', formula_tipo: 'manual', valor_default: 0, aporta_sipa: 0, aporta_inssjp: 0, aporta_os: 0, aporta_fsr: 0, aporta_lrt: 0, base_sac: 0, activo: 1 },
];

function seedIfEmpty(repo, rows) {
  if (repo.query().count() > 0) return;
  for (const row of rows) {
    repo.validate(row);
    repo.create(row);
  }
}

function seedMissingByKey(repo, key, rows) {
  for (const row of rows) {
    if (repo.query().where(key, row[key]).count() === 0) {
      repo.validate(row);
      repo.create(row);
    }
  }
}

/**
 * Datos obligatorios de sistema (idempotentes, sin sobrescribir ediciones del usuario
 * y sin saldos ni stock iniciales directos).
 */
export function seedBase(db) {
  const repoFor = (model) => new BaseRepository({ model, db });
  const txRepo = repoFor(MODELS.empresa_config);

  txRepo.transaction(() => {
    // 1. Tablas independientes (orden topológico)
    seedMissingByKey(repoFor(MODELS.unidades_medida), 'nombre', DEFAULT_UNITS);
    seedMissingByKey(repoFor(MODELS.categorias), 'nombre', DEFAULT_CATEGORIES);
    seedIfEmpty(repoFor(MODELS.etapas_config), DEFAULT_ETAPAS);

    if (txRepo.query().where('id', 1).count() === 0) {
      txRepo.query().insert({ id: 1 });
    }

    seedIfEmpty(repoFor(MODELS.cuentas), DEFAULT_CUENTAS);
    seedIfEmpty(repoFor(MODELS.puntos_venta), DEFAULT_PUNTOS_VENTA);
    seedMissingByKey(repoFor(MODELS.secuencias), 'codigo', DEFAULT_SECUENCIAS);

    const planCuentasBase = (PLAN_CUENTAS_TEMPLATES.ri_pyme?.cuentas || []).map(c => ({ ...c, activo: 1 }));
    const planRepo = repoFor(MODELS.plan_cuentas);
    seedMissingByKey(planRepo, 'codigo', planCuentasBase);

    const jurRepo = repoFor(MODELS.jurisdicciones);
    const defaultJurisdicciones = JURISDICCIONES_AR.map(j => ({ ...j, activo: 1 }));
    seedMissingByKey(jurRepo, 'codigo', defaultJurisdicciones);
    for (const j of defaultJurisdicciones) {
      const ex = jurRepo.query().select('id, letra').where('codigo', j.codigo).get();
      if (ex && !ex.letra && j.letra) jurRepo.update(ex.id, { letra: j.letra });
    }

    seedMissingByKey(repoFor(MODELS.impuestos_config), 'codigo', DEFAULT_IMPUESTOS);
    seedMissingByKey(repoFor(MODELS.ubicaciones), 'codigo', DEFAULT_UBICACIONES);
    seedMissingByKey(repoFor(MODELS.grupos), 'nombre', DEFAULT_GRUPOS);
    seedMissingByKey(repoFor(MODELS.nomina_conceptos), 'codigo_interno', DEFAULT_NOMINA_CONCEPTOS);

    // 2. Tablas con FKs a las anteriores
    const seqRepo = repoFor(MODELS.secuencias);
    const ctaRepo = repoFor(MODELS.cuentas);
    const diarioRepo = repoFor(MODELS.diarios);

    const planId = (codigo) => planRepo.query().where('codigo', codigo).get()?.id || null;
    const seqId = (codigo) => seqRepo.query().where('codigo', codigo).get()?.id || null;
    const ctaId = (nombre) => ctaRepo.query().where('nombre', nombre).get()?.id || null;

    seedMissingByKey(diarioRepo, 'codigo', [
      { codigo: 'VTA-FIS', nombre: 'Diario Ventas Fiscales', tipo: 'ventas', caracter: 'fiscal', es_fiscal: 1, secuencia_id: seqId('venta'), cuenta_contable_id: planId('4.1.01'), activo: 1 },
      { codigo: 'VTA-INT', nombre: 'Diario Ventas Internas', tipo: 'ventas', caracter: 'interno', es_fiscal: 0, secuencia_id: seqId('venta_x'), cuenta_contable_id: planId('4.1.01'), activo: 1 },
      { codigo: 'CMP-FIS', nombre: 'Diario Compras Fiscales', tipo: 'compras', caracter: 'fiscal', es_fiscal: 1, secuencia_id: seqId('compra'), cuenta_contable_id: planId('5.1.01'), activo: 1 },
      { codigo: 'CMP-INT', nombre: 'Diario Compras Internas', tipo: 'compras', caracter: 'interno', es_fiscal: 0, secuencia_id: seqId('compra'), cuenta_contable_id: planId('5.1.01'), activo: 1 },
      { codigo: 'CAJA', nombre: 'Diario Caja Efectivo', tipo: 'caja', caracter: 'ambos', es_fiscal: 0, secuencia_id: seqId('cobro'), cuenta_contable_id: planId('1.1.01'), cuenta_tesoreria_id: ctaId('Caja Efectivo'), activo: 1 },
      { codigo: 'BANCO', nombre: 'Diario Banco Principal', tipo: 'banco', caracter: 'ambos', es_fiscal: 0, secuencia_id: seqId('pago'), cuenta_contable_id: planId('1.1.02'), cuenta_tesoreria_id: ctaId('Banco Principal'), activo: 1 },
      { codigo: 'GRAL', nombre: 'Diario Operaciones Varias', tipo: 'general', caracter: 'ambos', es_fiscal: 0, secuencia_id: seqId('asiento'), activo: 1 },
    ]);

    seedMissingByKey(repoFor(MODELS.terminos_pago), 'nombre', [
      { nombre: 'Contado', dias: 0, cuotas_json: '[]', descripcion: 'Pago inmediato al emitir comprobante', activo: 1 },
      { nombre: '15 días', dias: 15, cuotas_json: '[{"dias":15,"porcentaje":100}]', descripcion: 'Vencimiento a 15 días fecha factura', activo: 1 },
      { nombre: '30 días', dias: 30, cuotas_json: '[{"dias":30,"porcentaje":100}]', descripcion: 'Cuenta corriente 30 días', activo: 1 },
      { nombre: '60 días', dias: 60, cuotas_json: '[{"dias":60,"porcentaje":100}]', descripcion: 'Cuenta corriente 60 días', activo: 1 },
      { nombre: '30 / 60 días', dias: 30, cuotas_json: '[{"dias":30,"porcentaje":50},{"dias":60,"porcentaje":50}]', descripcion: '50% a 30 días y 50% a 60 días', activo: 1 },
    ]);

    seedMissingByKey(repoFor(MODELS.metodos_pago), 'nombre', [
      { nombre: 'Efectivo', tipo: 'efectivo', requiere_referencia: 0, activo: 1 },
      { nombre: 'Transferencia', tipo: 'banco', requiere_referencia: 1, activo: 1 },
      { nombre: 'Cheque', tipo: 'cheque', requiere_referencia: 1, activo: 1 },
      { nombre: 'MercadoPago', tipo: 'digital', requiere_referencia: 1, activo: 1 },
      { nombre: 'Tarjeta de Débito', tipo: 'banco', requiere_referencia: 1, activo: 1 },
      { nombre: 'Tarjeta de Crédito', tipo: 'banco', requiere_referencia: 1, activo: 1 },
    ]);

    seedIfEmpty(repoFor(MODELS.listas_precios), [
      { nombre: 'Lista Base (Minorista)', moneda: 'ARS', descuento_pct: 0, recargo_pct: 0, es_default: 1, activo: 1, observaciones: 'Precio estándar de catálogo' },
      { nombre: 'Lista Mayorista', moneda: 'ARS', descuento_pct: 15, recargo_pct: 0, es_default: 0, activo: 1, observaciones: '15% de descuento por defecto sobre catálogo' },
    ]);
  });
}

/**
 * Datos de demostración opcionales (nunca se ejecutan automáticamente en bases productivas).
 */
export function seedDemo(db) {
  const repoFor = (model) => new BaseRepository({ model, db });
  const contactoRepo = repoFor(MODELS.contactos);
  contactoRepo.transaction(() => {
    seedMissingByKey(contactoRepo, 'nombre', [
      { nombre: 'Cliente Demo', condicion_iva: 'Consumidor Final', es_cliente: 1, es_proveedor: 0, es_taller: 0 },
      { nombre: 'Proveedor Demo', condicion_iva: 'Responsable Inscripto', es_cliente: 0, es_proveedor: 1, es_taller: 0 },
    ]);
  });
}

export function runSeeds(db, { includeDemo = false } = {}) {
  seedBase(db);
  if (includeDemo) {
    seedDemo(db);
  }
}
