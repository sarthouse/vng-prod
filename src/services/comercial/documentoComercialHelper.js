/**
 * Helpers DRY compartidos entre Compras y Ventas para sanitización de líneas,
 * impuestos adicionales y cálculo de totales de documentos comerciales.
 */
export function sanitizeDocumentoLineas(lineas, {
  caracter = 'fiscal',
  tipoComprobante = 'FA-B',
  defaultUdm = 'unidades',
  allowTiposLinea = false,
} = {}) {
  if (!Array.isArray(lineas)) return [];
  const noIva = caracter === 'interno' || /-C$/i.test(String(tipoComprobante || ''));
  return lineas.map(l => {
    const tipo_linea = allowTiposLinea && ['producto', 'envio', 'descuento', 'recargo'].includes(l.tipo_linea)
      ? l.tipo_linea
      : 'producto';
    const cantidad = Number(l.cantidad) || 0;
    const precio_unitario = Number(l.precio_unitario) || 0;
    const subtotal = l.subtotal !== undefined && l.subtotal !== ''
      ? Number(l.subtotal)
      : Number((cantidad * precio_unitario).toFixed(2));
    const alicuota_iva = noIva ? 0 : Math.max(0, Number(l.alicuota_iva ?? 21));
    const iva_monto = Number((subtotal * alicuota_iva / 100).toFixed(2));
    return {
      producto_id: l.producto_id ? Number(l.producto_id) : null,
      plantilla_id: l.plantilla_id ? Number(l.plantilla_id) : null,
      plan_cuenta_id: l.plan_cuenta_id ? Number(l.plan_cuenta_id) : null,
      tipo_linea,
      descripcion: (l.descripcion || '').trim(),
      cantidad,
      udm: (l.udm || defaultUdm).trim(),
      precio_unitario,
      alicuota_iva,
      iva_monto,
      subtotal: Number(subtotal.toFixed(2)),
    };
  }).filter(l => l.producto_id || l.descripcion || l.cantidad > 0 || l.subtotal !== 0);
}

export function sanitizeDocumentoImpuestos(impuestos, neto) {
  if (!Array.isArray(impuestos)) return [];
  return impuestos.map(imp => {
    const nombre = (imp.nombre || '').trim();
    const tipo = ['percepcion', 'retencion', 'otro'].includes(imp.tipo) ? imp.tipo : 'percepcion';
    const base = imp.base !== undefined && imp.base !== '' ? Number(imp.base) : neto;
    const alicuota = Math.max(0, Number(imp.alicuota) || 0);
    const monto = imp.monto !== undefined && imp.monto !== ''
      ? Number(imp.monto)
      : Number((base * alicuota / 100).toFixed(2));
    return {
      impuesto_id: imp.impuesto_id ? Number(imp.impuesto_id) : null,
      nombre,
      tipo,
      base: Number(base.toFixed(2)),
      alicuota,
      monto: Number(monto.toFixed(2)),
    };
  }).filter(imp => imp.nombre && imp.monto !== 0);
}

export function computeDocumentoTotales(lineas, rawImpuestos, {
  fallbackNeto = 0,
  fallbackAlicuotaIva = 0,
} = {}) {
  const neto = lineas.length > 0
    ? Number(lineas.reduce((s, l) => s + l.subtotal, 0).toFixed(2))
    : Number(Number(fallbackNeto || 0).toFixed(2));
  const ivaMonto = lineas.length > 0
    ? Number(lineas.reduce((s, l) => s + (Number(l.iva_monto) || 0), 0).toFixed(2))
    : Number((neto * Math.max(0, Number(fallbackAlicuotaIva || 0)) / 100).toFixed(2));
  const alicuotaIva = neto > 0 ? Number(((ivaMonto / neto) * 100).toFixed(2)) : 0;
  const impuestos = sanitizeDocumentoImpuestos(rawImpuestos, neto);
  const otrosImpuestosMonto = Number(
    impuestos.reduce((s, i) => s + (i.tipo === 'retencion' ? -Number(i.monto) : Number(i.monto)), 0).toFixed(2),
  );
  const total = Number((neto + ivaMonto + otrosImpuestosMonto).toFixed(2));
  return { neto, ivaMonto, alicuotaIva, impuestos, otrosImpuestosMonto, total };
}
