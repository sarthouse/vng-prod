/**
 * Plantillas de Plan de Cuentas para Argentina
 * separadas según la condición fiscal y operatoria de la empresa.
 */
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
      { codigo: '2.1.01', nombre: 'Proveedores', tipo: 'pasivo', naturaleza: 'acreedora', imputable: 1 },
      { codigo: '2.1.02', nombre: 'IVA Débito Fiscal', tipo: 'pasivo', naturaleza: 'acreedora', imputable: 1 },
      { codigo: '2.1.03', nombre: 'Retenciones y Percepciones a Depositar', tipo: 'pasivo', naturaleza: 'acreedora', imputable: 1 },
      { codigo: '2.1.04', nombre: 'Cheques Diferidos a Pagar', tipo: 'pasivo', naturaleza: 'acreedora', imputable: 1 },
      { codigo: '3.1.01', nombre: 'Capital Social', tipo: 'patrimonio', naturaleza: 'acreedora', imputable: 1 },
      { codigo: '4.1.01', nombre: 'Ventas de Productos', tipo: 'ingreso', naturaleza: 'acreedora', imputable: 1 },
      { codigo: '5.1.01', nombre: 'Compras y Costo de Mercadería', tipo: 'egreso', naturaleza: 'deudora', imputable: 1 },
      { codigo: '5.1.02', nombre: 'Gastos de Producción y Taller', tipo: 'egreso', naturaleza: 'deudora', imputable: 1 },
      { codigo: '5.2.01', nombre: 'Servicios Públicos (Luz, Agua, Gas, Internet)', tipo: 'egreso', naturaleza: 'deudora', imputable: 1 },
      { codigo: '5.2.02', nombre: 'Alquileres y Expensas', tipo: 'egreso', naturaleza: 'deudora', imputable: 1 },
      { codigo: '5.2.03', nombre: 'Honorarios y Servicios Profesionales', tipo: 'egreso', naturaleza: 'deudora', imputable: 1 },
      { codigo: '5.2.04', nombre: 'Gastos Bancarios y Comisiones', tipo: 'egreso', naturaleza: 'deudora', imputable: 1 },
      { codigo: '5.2.05', nombre: 'Impuestos, Tasas y Contribuciones', tipo: 'egreso', naturaleza: 'deudora', imputable: 1 },
      { codigo: '5.2.06', nombre: 'Sueldos y Cargas Sociales', tipo: 'egreso', naturaleza: 'deudora', imputable: 1 },
      { codigo: '5.2.07', nombre: 'Otros Gastos Operativos', tipo: 'egreso', naturaleza: 'deudora', imputable: 1 },
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

  const tplCodes = new Set(tpl.cuentas.map(c => c.codigo));
  let creadas = 0;
  let actualizadas = 0;
  let desactivadas = 0;

  db.exec('BEGIN');
  try {
    const findStmt = db.prepare('SELECT id FROM plan_cuentas WHERE codigo = ?');
    const insStmt = db.prepare(`
      INSERT INTO plan_cuentas (codigo, nombre, tipo, naturaleza, imputable, activo)
      VALUES (?, ?, ?, ?, ?, 1)
    `);
    const updStmt = db.prepare(`
      UPDATE plan_cuentas SET nombre = ?, tipo = ?, naturaleza = ?, imputable = ?, activo = 1 WHERE id = ?
    `);

    for (const c of tpl.cuentas) {
      const ex = findStmt.get(c.codigo);
      if (ex) {
        updStmt.run(c.nombre, c.tipo, c.naturaleza, c.imputable ?? 1, ex.id);
        actualizadas += 1;
      } else {
        insStmt.run(c.codigo, c.nombre, c.tipo, c.naturaleza, c.imputable ?? 1);
        creadas += 1;
      }
    }

    // Desactivar cuentas que no pertenecen a la plantilla (sin borrar para no romper asientos históricos)
    const all = db.prepare('SELECT id, codigo, activo FROM plan_cuentas').all();
    const deactStmt = db.prepare('UPDATE plan_cuentas SET activo = 0 WHERE id = ?');
    for (const row of all) {
      if (!tplCodes.has(row.codigo) && row.activo !== 0) {
        deactStmt.run(row.id);
        desactivadas += 1;
      }
    }

    db.exec('COMMIT');
    return { plantilla: tpl.id, creadas, actualizadas, desactivadas };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
