/**
 * Plantillas de Plan de Cuentas para Argentina
 * separadas según la condición fiscal y operatoria de la empresa.
 */
import { BaseRepository } from '../../core/BaseRepository.js';
import { MODELS } from '../../db/models.js';

export const PLAN_CUENTAS_TEMPLATES = {
  monotributo: {
    id: 'monotributo',
    nombre: 'Monotributista (Simplificado)',
    descripcion: 'Sin cuentas de IVA Crédito/Débito Fiscal ni Percepciones IVA. Ideal para monotributistas y pequeños emprendimientos.',
    cuentas: [
      { codigo: '1.1.01', nombre: 'Caja Efectivo', tipo: 'activo', naturaleza: 'deudora', imputable: 1 },
      { codigo: '1.1.02', nombre: 'Bancos Cuenta Corriente', tipo: 'activo', naturaleza: 'deudora', imputable: 1 },
      { codigo: '1.1.03', nombre: 'Deudores por Ventas (Clientes)', tipo: 'activo', naturaleza: 'deudora', imputable: 1 },
      { codigo: '1.1.06', nombre: 'Bienes de Cambio (Inventario)', tipo: 'activo', naturaleza: 'deudora', imputable: 1 },
      { codigo: '1.1.07', nombre: 'Valores a Depositar (Cheques de Terceros)', tipo: 'activo', naturaleza: 'deudora', imputable: 1 },
      { codigo: '2.1.01', nombre: 'Proveedores', tipo: 'pasivo', naturaleza: 'acreedora', imputable: 1 },
      { codigo: '2.1.04', nombre: 'Cheques Diferidos a Pagar', tipo: 'pasivo', naturaleza: 'acreedora', imputable: 1 },
      { codigo: '3.1.01', nombre: 'Capital Social', tipo: 'patrimonio', naturaleza: 'acreedora', imputable: 1 },
      { codigo: '4.1.01', nombre: 'Ventas de Productos y Servicios', tipo: 'ingreso', naturaleza: 'acreedora', imputable: 1 },
      { codigo: '5.1.01', nombre: 'Compras y Costo de Mercadería', tipo: 'egreso', naturaleza: 'deudora', imputable: 1 },
      { codigo: '5.2.01', nombre: 'Servicios Públicos (Luz, Agua, Gas, Internet)', tipo: 'egreso', naturaleza: 'deudora', imputable: 1 },
      { codigo: '5.2.02', nombre: 'Alquileres y Expensas', tipo: 'egreso', naturaleza: 'deudora', imputable: 1 },
      { codigo: '5.2.04', nombre: 'Gastos Bancarios y Comisiones', tipo: 'egreso', naturaleza: 'deudora', imputable: 1 },
      { codigo: '5.2.05', nombre: 'Monotributo / IIBB / Tasas', tipo: 'egreso', naturaleza: 'deudora', imputable: 1 },
      { codigo: '5.2.07', nombre: 'Otros Gastos Operativos', tipo: 'egreso', naturaleza: 'deudora', imputable: 1 },
    ],
  },
  ri_pyme: {
    id: 'ri_pyme',
    nombre: 'Responsable Inscripto — PYME / Producción',
    descripcion: 'Plan completo con IVA Crédito/Débito Fiscal, Percepciones/Retenciones, Cheques, Bienes de Cambio y Costos de Producción.',
    cuentas: [
      { codigo: '1.1.01', nombre: 'Caja Efectivo', tipo: 'activo', naturaleza: 'deudora', imputable: 1 },
      { codigo: '1.1.02', nombre: 'Bancos Cuenta Corriente', tipo: 'activo', naturaleza: 'deudora', imputable: 1 },
      { codigo: '1.1.03', nombre: 'Deudores por Ventas (Clientes)', tipo: 'activo', naturaleza: 'deudora', imputable: 1 },
      { codigo: '1.1.04', nombre: 'IVA Crédito Fiscal', tipo: 'activo', naturaleza: 'deudora', imputable: 1 },
      { codigo: '1.1.05', nombre: 'Percepciones y Retenciones Sufridas', tipo: 'activo', naturaleza: 'deudora', imputable: 1 },
      { codigo: '1.1.06', nombre: 'Bienes de Cambio (Inventario)', tipo: 'activo', naturaleza: 'deudora', imputable: 1 },
      { codigo: '1.1.07', nombre: 'Valores a Depositar (Cheques de Terceros)', tipo: 'activo', naturaleza: 'deudora', imputable: 1 },
      { codigo: '1.1.08', nombre: 'IVA Saldo a Favor', tipo: 'activo', naturaleza: 'deudora', imputable: 1 },
      { codigo: '1.2.01', nombre: 'Bienes de Uso (Maquinaria y Equipos)', tipo: 'activo', naturaleza: 'deudora', imputable: 1 },
      { codigo: '1.2.02', nombre: 'Amortizaciones Acumuladas Bienes de Uso', tipo: 'activo', naturaleza: 'acreedora', imputable: 1 },
      { codigo: '2.1.01', nombre: 'Proveedores', tipo: 'pasivo', naturaleza: 'acreedora', imputable: 1 },
      { codigo: '2.1.02', nombre: 'IVA Débito Fiscal', tipo: 'pasivo', naturaleza: 'acreedora', imputable: 1 },
      { codigo: '2.1.03', nombre: 'Retenciones y Percepciones a Depositar', tipo: 'pasivo', naturaleza: 'acreedora', imputable: 1 },
      { codigo: '2.1.04', nombre: 'Cheques Diferidos a Pagar', tipo: 'pasivo', naturaleza: 'acreedora', imputable: 1 },
      { codigo: '2.1.05', nombre: 'IVA a Pagar (Posición Mensual)', tipo: 'pasivo', naturaleza: 'acreedora', imputable: 1 },
      { codigo: '2.1.06', nombre: 'Sueldos y Jornales a Pagar', tipo: 'pasivo', naturaleza: 'acreedora', imputable: 1 },
      { codigo: '2.1.07', nombre: 'Cargas Sociales y Retenciones a Depositar', tipo: 'pasivo', naturaleza: 'acreedora', imputable: 1 },
      { codigo: '2.1.08', nombre: 'Cuota Sindical a Depositar', tipo: 'pasivo', naturaleza: 'acreedora', imputable: 1 },
      { codigo: '3.1.01', nombre: 'Capital Social', tipo: 'patrimonio', naturaleza: 'acreedora', imputable: 1 },
      { codigo: '3.2.01', nombre: 'Resultado del Ejercicio', tipo: 'patrimonio', naturaleza: 'acreedora', imputable: 1 },
      { codigo: '4.1.01', nombre: 'Ventas de Productos', tipo: 'ingreso', naturaleza: 'acreedora', imputable: 1 },
      { codigo: '4.2.01', nombre: 'Diferencia de Cambio Positiva', tipo: 'ingreso', naturaleza: 'acreedora', imputable: 1 },
      { codigo: '5.1.01', nombre: 'Compras y Costo de Mercadería', tipo: 'egreso', naturaleza: 'deudora', imputable: 1 },
      { codigo: '5.1.02', nombre: 'Gastos de Producción y Taller', tipo: 'egreso', naturaleza: 'deudora', imputable: 1 },
      { codigo: '5.2.01', nombre: 'Servicios Públicos (Luz, Agua, Gas, Internet)', tipo: 'egreso', naturaleza: 'deudora', imputable: 1 },
      { codigo: '5.2.02', nombre: 'Alquileres y Expensas', tipo: 'egreso', naturaleza: 'deudora', imputable: 1 },
      { codigo: '5.2.03', nombre: 'Honorarios y Servicios Profesionales', tipo: 'egreso', naturaleza: 'deudora', imputable: 1 },
      { codigo: '5.2.04', nombre: 'Gastos Bancarios y Comisiones', tipo: 'egreso', naturaleza: 'deudora', imputable: 1 },
      { codigo: '5.2.05', nombre: 'Impuestos, Tasas y Contribuciones', tipo: 'egreso', naturaleza: 'deudora', imputable: 1 },
      { codigo: '5.2.06', nombre: 'Sueldos y Cargas Sociales', tipo: 'egreso', naturaleza: 'deudora', imputable: 1 },
      { codigo: '5.2.07', nombre: 'Otros Gastos Operativos', tipo: 'egreso', naturaleza: 'deudora', imputable: 1 },
      { codigo: '5.2.08', nombre: 'Diferencia de Cambio Negativa', tipo: 'egreso', naturaleza: 'deudora', imputable: 1 },
      { codigo: '5.2.09', nombre: 'Amortizaciones del Ejercicio', tipo: 'egreso', naturaleza: 'deudora', imputable: 1 },
    ],
  },
  exento_servicios: {
    id: 'exento_servicios',
    nombre: 'Exento / Servicios Profesionales',
    descripcion: 'Orientado a prestadores de servicios o sujetos exentos en IVA, sin discriminación de crédito/débito fiscal.',
    cuentas: [
      { codigo: '1.1.01', nombre: 'Caja Efectivo', tipo: 'activo', naturaleza: 'deudora', imputable: 1 },
      { codigo: '1.1.02', nombre: 'Bancos Cuenta Corriente', tipo: 'activo', naturaleza: 'deudora', imputable: 1 },
      { codigo: '1.1.03', nombre: 'Deudores por Servicios', tipo: 'activo', naturaleza: 'deudora', imputable: 1 },
      { codigo: '1.1.05', nombre: 'Retenciones Sufridas', tipo: 'activo', naturaleza: 'deudora', imputable: 1 },
      { codigo: '2.1.01', nombre: 'Proveedores', tipo: 'pasivo', naturaleza: 'acreedora', imputable: 1 },
      { codigo: '3.1.01', nombre: 'Capital Social / Patrimonio', tipo: 'patrimonio', naturaleza: 'acreedora', imputable: 1 },
      { codigo: '4.1.01', nombre: 'Ingresos por Servicios', tipo: 'ingreso', naturaleza: 'acreedora', imputable: 1 },
      { codigo: '5.1.01', nombre: 'Costo de Servicios Contratados', tipo: 'egreso', naturaleza: 'deudora', imputable: 1 },
      { codigo: '5.2.01', nombre: 'Servicios Públicos e Internet', tipo: 'egreso', naturaleza: 'deudora', imputable: 1 },
      { codigo: '5.2.02', nombre: 'Alquileres y Expensas', tipo: 'egreso', naturaleza: 'deudora', imputable: 1 },
      { codigo: '5.2.03', nombre: 'Honorarios Profesionales', tipo: 'egreso', naturaleza: 'deudora', imputable: 1 },
      { codigo: '5.2.04', nombre: 'Gastos Bancarios y Comisiones', tipo: 'egreso', naturaleza: 'deudora', imputable: 1 },
      { codigo: '5.2.07', nombre: 'Otros Gastos Operativos', tipo: 'egreso', naturaleza: 'deudora', imputable: 1 },
    ],
  },
};

export function listPlanCuentasTemplates() {
  return Object.values(PLAN_CUENTAS_TEMPLATES).map(({ id, nombre, descripcion, cuentas }) => ({
    id,
    nombre,
    descripcion,
    cantidad_cuentas: cuentas.length,
  }));
}

export function applyPlanCuentasTemplate(db, templateId) {
  const tpl = PLAN_CUENTAS_TEMPLATES[templateId];
  if (!tpl) throw new Error('Plantilla de plan de cuentas no encontrada');

  const planCuentaRepo = new BaseRepository({ model: MODELS.plan_cuentas, db });
  const tplCodes = new Set(tpl.cuentas.map(c => c.codigo));
  let creadas = 0;
  let actualizadas = 0;
  let desactivadas = 0;

  return planCuentaRepo.transaction(() => {
    for (const c of tpl.cuentas) {
      const ex = planCuentaRepo.query().select('id').where('codigo', c.codigo).get();
      if (ex) {
        planCuentaRepo.update(ex.id, {
          nombre: c.nombre,
          tipo: c.tipo,
          naturaleza: c.naturaleza,
          imputable: c.imputable ?? 1,
          activo: 1,
        });
        actualizadas += 1;
      } else {
        planCuentaRepo.create({
          codigo: c.codigo,
          nombre: c.nombre,
          tipo: c.tipo,
          naturaleza: c.naturaleza,
          imputable: c.imputable ?? 1,
          activo: 1,
        });
        creadas += 1;
      }
    }

    // Desactivar cuentas que no pertenecen a la plantilla (sin borrar para no romper asientos históricos)
    const all = planCuentaRepo.query().select('id', 'codigo', 'activo').all();
    for (const row of all) {
      if (!tplCodes.has(row.codigo) && row.activo !== 0) {
        planCuentaRepo.update(row.id, { activo: 0 });
        desactivadas += 1;
      }
    }

    return { plantilla: tpl.id, creadas, actualizadas, desactivadas };
  });
}
