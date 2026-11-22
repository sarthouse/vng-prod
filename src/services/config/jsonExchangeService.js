import { BaseRepository } from '../../core/BaseRepository.js';
import { MODELS } from '../../db/models.js';
import { sanitizeRichHtml } from '../../core/sanitize.js';
import { createPlantilla } from '../inventario/productoService.js';
import { createReceta, addRecetaEtapa, addRecetaLinea } from '../produccion/recetaService.js';

const categoriaRepo = new BaseRepository({ model: MODELS.categorias });
const varianteRepo = new BaseRepository({ model: MODELS.variantes });
const unidadRepo = new BaseRepository({ model: MODELS.unidades_medida });
const planCuentaRepo = new BaseRepository({ model: MODELS.plan_cuentas });
const contactoRepo = new BaseRepository({ model: MODELS.contactos });
const plantillaRepo = new BaseRepository({ model: MODELS.producto_plantillas });
const productoRepo = new BaseRepository({ model: MODELS.productos });
const recetaRepo = new BaseRepository({ model: MODELS.recetas });
const recetaEtapaRepo = new BaseRepository({ model: MODELS.receta_etapas });
const recetaLineaRepo = new BaseRepository({ model: MODELS.receta_lineas });

function parseJsonSafe(raw, fallback) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

function normStr(v) {
  return String(v ?? '').trim();
}

function findOrCreateCategoria(nombre) {
  const n = normStr(nombre);
  if (!n) return null;
  const all = categoriaRepo.findAll();
  const found = all.find(c => normStr(c.nombre).toLowerCase() === n.toLowerCase());
  if (found) return found.id;
  return categoriaRepo.create({ nombre: n });
}

function findOrCreateUnidad(nombre) {
  const n = normStr(nombre) || 'unidades';
  const all = unidadRepo.findAll();
  const found = all.find(u => normStr(u.nombre).toLowerCase() === n.toLowerCase());
  if (found) return found.id;
  return unidadRepo.create({ nombre: n, tipo: 'unidad', factor: 1 });
}

const REGISTRY = {
  categorias: {
    label: 'Categorías',
    description: 'Rubros de productos e insumos',
    template: [
      { nombre: 'Bases', descripcion: 'Suelas y bases', se_fabrica: 0, se_compra: 1, se_vende: 0 },
      { nombre: 'Calzado Terminado', descripcion: 'Producto final', se_fabrica: 1, se_compra: 0, se_vende: 1 },
    ],
    exportItems: () => categoriaRepo.findAll().map(c => ({
      nombre: c.nombre,
      descripcion: c.descripcion || '',
      se_fabrica: Number(c.se_fabrica || 0),
      se_compra: Number(c.se_compra || 0),
      se_vende: Number(c.se_vende || 0),
    })),
    importItem: (item, { mode }) => {
      const nombre = normStr(item.nombre);
      if (!nombre) throw new Error('Falta nombre de categoría');
      const existing = categoriaRepo.findAll().find(c => normStr(c.nombre).toLowerCase() === nombre.toLowerCase());
      const data = {
        nombre,
        descripcion: normStr(item.descripcion),
        se_fabrica: item.se_fabrica ? 1 : 0,
        se_compra: item.se_compra ? 1 : 0,
        se_vende: item.se_vende ? 1 : 0,
      };
      if (existing) {
        if (mode === 'skip_existing') return 'skipped';
        categoriaRepo.validate(data, { partial: true });
        categoriaRepo.update(existing.id, data);
        return 'updated';
      }
      categoriaRepo.validate(data);
      categoriaRepo.create(data);
      return 'created';
    },
  },

  variantes: {
    label: 'Variantes',
    description: 'Atributos y valores (ej. Talle, Color)',
    template: [
      { atributo: 'Talle', valor: '35', abreviatura: '35' },
      { atributo: 'Color', valor: 'Negro', abreviatura: 'NEG' },
    ],
    exportItems: () => varianteRepo.findAll().map(v => ({
      atributo: v.atributo,
      valor: v.valor,
      abreviatura: v.abreviatura || '',
    })),
    importItem: (item, { mode }) => {
      const atributo = normStr(item.atributo);
      const valor = normStr(item.valor);
      if (!atributo || !valor) throw new Error('Falta atributo o valor');
      const existing = varianteRepo.findAll().find(
        v => normStr(v.atributo).toLowerCase() === atributo.toLowerCase() && normStr(v.valor).toLowerCase() === valor.toLowerCase()
      );
      const data = { atributo, valor, abreviatura: normStr(item.abreviatura) };
      if (existing) {
        if (mode === 'skip_existing') return 'skipped';
        varianteRepo.validate(data, { partial: true });
        varianteRepo.update(existing.id, data);
        return 'updated';
      }
      varianteRepo.validate(data);
      varianteRepo.create(data);
      return 'created';
    },
  },

  cuentas_contables: {
    label: 'Plan de Cuentas',
    description: 'Cuentas contables jerárquicas por código',
    template: [
      { codigo: '5.1.01', nombre: 'Costo de Mercadería Vendida', tipo: 'egreso', imputable: 1, padre_codigo: '5.1', activa: 1 },
    ],
    exportItems: () => {
      const all = planCuentaRepo.findAll();
      const byId = new Map(all.map(c => [c.id, c]));
      return all.map(c => ({
        codigo: c.codigo,
        nombre: c.nombre,
        tipo: c.tipo,
        naturaleza: c.naturaleza || 'deudora',
        imputable: Number(c.imputable ?? 1),
        padre_codigo: c.padre_id ? (byId.get(c.padre_id)?.codigo || '') : '',
        activa: Number(c.activa ?? 1),
      }));
    },
    importItem: (item, { mode }) => {
      const codigo = normStr(item.codigo);
      const nombre = normStr(item.nombre);
      if (!codigo || !nombre) throw new Error('Falta código o nombre de cuenta');
      const tipo = normStr(item.tipo) || 'egreso';
      const defaultNat = (tipo === 'ingreso' || tipo === 'pasivo' || tipo === 'patrimonio') ? 'acreedora' : 'deudora';
      const padre = item.padre_codigo ? planCuentaRepo.query().where('codigo', normStr(item.padre_codigo)).get() : null;
      const existing = planCuentaRepo.query().where('codigo', codigo).get();
      const data = {
        codigo,
        nombre,
        tipo,
        naturaleza: normStr(item.naturaleza) || defaultNat,
        imputable: item.imputable !== undefined ? (item.imputable ? 1 : 0) : 1,
        padre_id: padre?.id || null,
        activo: (item.activo ?? item.activa) !== undefined ? ((item.activo ?? item.activa) ? 1 : 0) : 1,
      };
      if (existing) {
        if (mode === 'skip_existing') return 'skipped';
        planCuentaRepo.validate(data, { partial: true });
        planCuentaRepo.update(existing.id, data);
        return 'updated';
      }
      planCuentaRepo.validate(data);
      planCuentaRepo.create(data);
      return 'created';
    },
    afterImport: (items) => {
      const all = planCuentaRepo.findAll();
      const byCod = new Map(all.map(c => [normStr(c.codigo), c]));
      for (const item of items) {
        const pc = byCod.get(normStr(item.codigo));
        const padreCod = normStr(item.padre_codigo);
        if (pc && padreCod && !pc.padre_id) {
          const padre = byCod.get(padreCod);
          if (padre && padre.id !== pc.id) {
            planCuentaRepo.update(pc.id, { padre_id: padre.id });
          }
        }
      }
    },
  },

  contactos: {
    label: 'Contactos',
    description: 'Clientes, proveedores y talleres',
    template: [
      {
        nombre: 'Proveedor Ejemplo SA',
        cuit: '30-12345678-9',
        condicion_iva: 'Responsable Inscripto',
        email: 'ventas@ejemplo.com',
        telefono: '11-5555-0000',
        direccion: 'Av. Siempreviva 742',
        localidad: 'CABA',
        provincia: 'CABA',
        es_cliente: 0,
        es_proveedor: 1,
        es_taller: 0,
      },
    ],
    exportItems: () => contactoRepo.findAll().map(c => ({
      nombre: c.nombre,
      cuit: c.cuit || '',
      condicion_iva: c.condicion_iva || 'Consumidor Final',
      email: c.email || '',
      telefono: c.telefono || '',
      direccion: c.direccion || '',
      localidad: c.localidad || '',
      provincia: c.provincia || '',
      codigo_postal: c.codigo_postal || '',
      es_cliente: Number(c.es_cliente || 0),
      es_proveedor: Number(c.es_proveedor || 0),
      es_taller: Number(c.es_taller || 0),
      es_empleado: Number(c.es_empleado || 0),
      notas: c.notas || '',
    })),
    importItem: (item, { mode }) => {
      const nombre = normStr(item.nombre);
      if (!nombre) throw new Error('Falta nombre de contacto');
      const cuit = normStr(item.cuit);
      const cuitDigits = cuit.replace(/\D+/g, '');
      const emailNorm = normStr(item.email).toLowerCase();
      const all = contactoRepo.findAll();
      const existing = (cuitDigits && all.find(c => String(c.cuit || '').replace(/\D+/g, '') === cuitDigits))
        || (emailNorm && all.find(c => normStr(c.email).toLowerCase() === emailNorm))
        || all.find(c => normStr(c.nombre).toLowerCase() === nombre.toLowerCase());
      const data = {
        nombre,
        cuit,
        condicion_iva: normStr(item.condicion_iva) || 'Consumidor Final',
        email: normStr(item.email),
        telefono: normStr(item.telefono),
        direccion: normStr(item.direccion),
        localidad: normStr(item.localidad),
        provincia: normStr(item.provincia),
        codigo_postal: normStr(item.codigo_postal),
        es_cliente: item.es_cliente ? 1 : 0,
        es_proveedor: item.es_proveedor ? 1 : 0,
        es_taller: item.es_taller ? 1 : 0,
        es_empleado: item.es_empleado ? 1 : 0,
        observaciones: normStr(item.observaciones ?? item.notas),
      };
      if (existing) {
        if (mode === 'skip_existing') return 'skipped';
        contactoRepo.validate(data, { partial: true });
        contactoRepo.update(existing.id, data);
        return 'updated';
      }
      contactoRepo.validate(data);
      contactoRepo.create(data);
      return 'created';
    },
  },

  productos: {
    label: 'Productos (Plantillas y Variantes)',
    description: 'Plantillas con sus variantes, precios, costos y categorías',
    template: [
      {
        nombre: 'Zapatilla Demo',
        codigo: 'ZAP-DEMO',
        categoria: 'Calzado Terminado',
        unidad: 'pares',
        precio_base: 45000,
        costo_base: 22000,
        se_fabrica: 1,
        se_compra: 0,
        se_vende: 1,
        variantes: [
          { sku: 'ZAP-DEMO-38', costo: 22000, precio: 45000, combinacion: { Talle: '38' } },
          { sku: 'ZAP-DEMO-39', costo: 22000, precio: 45000, combinacion: { Talle: '39' } },
        ],
      },
    ],
    exportItems: () => {
      const cats = new Map(categoriaRepo.findAll().map(c => [c.id, c.nombre]));
      const uoms = new Map(unidadRepo.findAll().map(u => [u.id, u.nombre]));
      const ctas = new Map(planCuentaRepo.findAll().map(c => [c.id, c.codigo]));
      const allProds = productoRepo.findAll();
      return plantillaRepo.findAll().map(pt => ({
        nombre: pt.nombre,
        codigo: pt.codigo || '',
        categoria: cats.get(pt.categoria_id) || '',
        unidad: uoms.get(pt.unidad_id) || 'unidades',
        descripcion: pt.descripcion || '',
        precio_base: Number(pt.precio_base || 0),
        costo_base: Number(pt.costo_base || 0),
        stock_minimo: Number(pt.stock_minimo || 0),
        se_fabrica: Number(pt.se_fabrica || 0),
        se_compra: Number(pt.se_compra || 0),
        se_vende: Number(pt.se_vende || 0),
        cuenta_venta_codigo: pt.cuenta_venta_id ? (ctas.get(pt.cuenta_venta_id) || '') : '',
        cuenta_compra_codigo: pt.cuenta_compra_id ? (ctas.get(pt.cuenta_compra_id) || '') : '',
        variantes: allProds
          .filter(p => Number(p.plantilla_id) === Number(pt.id))
          .map(p => ({
            nombre: p.nombre,
            sku: p.sku || p.codigo || '',
            codigo_barras: p.codigo_barras || '',
            costo: Number(p.costo || 0),
            precio: Number(p.precio || 0),
            stock_minimo: Number(p.stock_minimo || 0),
            combinacion: parseJsonSafe(p.combinacion_json, {}),
          })),
      }));
    },
    importItem: (item, { mode }) => {
      const nombre = normStr(item.nombre);
      if (!nombre) throw new Error('Falta nombre de plantilla');
      const catId = findOrCreateCategoria(item.categoria || 'General');
      const uomId = findOrCreateUnidad(item.unidad || 'unidades');
      const existing = plantillaRepo.findAll().find(
        pt => (item.codigo && normStr(pt.codigo) === normStr(item.codigo)) || normStr(pt.nombre).toLowerCase() === nombre.toLowerCase()
      );
      if (existing && mode === 'skip_existing') return 'skipped';

      const ctaV = item.cuenta_venta_codigo ? planCuentaRepo.query().where('codigo', normStr(item.cuenta_venta_codigo)).get()?.id : null;
      const ctaC = item.cuenta_compra_codigo ? planCuentaRepo.query().where('codigo', normStr(item.cuenta_compra_codigo)).get()?.id : null;

      if (existing) {
        const updData = {
          nombre,
          codigo: normStr(item.codigo),
          categoria_id: catId,
          unidad_id: uomId,
          descripcion: sanitizeRichHtml(normStr(item.descripcion)),
          precio_base: Number(item.precio_base || 0),
          costo_base: Number(item.costo_base || 0),
          stock_minimo: Number(item.stock_minimo || 0),
          se_fabrica: item.se_fabrica ? 1 : 0,
          se_compra: item.se_compra ? 1 : 0,
          se_vende: item.se_vende ? 1 : 0,
          cuenta_venta_id: ctaV || existing.cuenta_venta_id || null,
          cuenta_compra_id: ctaC || existing.cuenta_compra_id || null,
        };
        plantillaRepo.validate(updData, { partial: true });
        plantillaRepo.update(existing.id, updData);
        for (const v of (Array.isArray(item.variantes) ? item.variantes : [])) {
          const comboKey = JSON.stringify(v.combinacion || {});
          const varRow = productoRepo.findWhere({ plantilla_id: existing.id }).find(
            p => (v.sku && normStr(p.sku) === normStr(v.sku)) || p.combinacion_json === comboKey
          );
          if (varRow) {
            productoRepo.update(varRow.id, {
              costo: Number(v.costo ?? item.costo_base ?? varRow.costo),
              precio: Number(v.precio ?? item.precio_base ?? varRow.precio),
              sku: normStr(v.sku) || varRow.sku,
              codigo_barras: normStr(v.codigo_barras) || varRow.codigo_barras,
              stock_minimo: Number(v.stock_minimo ?? varRow.stock_minimo ?? 0),
            });
          } else {
            productoRepo.create({
              plantilla_id: existing.id,
              nombre: normStr(v.nombre) || `${nombre}${Object.values(v.combinacion || {}).length ? ` (${Object.values(v.combinacion).join(' · ')})` : ''}`,
              sku: normStr(v.sku),
              codigo: normStr(v.sku),
              codigo_barras: normStr(v.codigo_barras),
              costo: Number(v.costo ?? item.costo_base ?? 0),
              precio: Number(v.precio ?? item.precio_base ?? 0),
              stock_minimo: Number(v.stock_minimo || 0),
              combinacion_json: comboKey,
            });
          }
        }
        return 'updated';
      }

      const atributos = [];
      const attrMap = new Map();
      for (const v of (Array.isArray(item.variantes) ? item.variantes : [])) {
        for (const [k, val] of Object.entries(v.combinacion || {})) {
          if (!attrMap.has(k)) attrMap.set(k, new Set());
          attrMap.get(k).add(String(val));
        }
      }
      for (const [atributo, vals] of attrMap.entries()) {
        atributos.push({ atributo, valores: Array.from(vals) });
      }

      const res = createPlantilla({
        nombre,
        codigo: normStr(item.codigo),
        categoria_id: catId,
        unidad_id: uomId,
        descripcion: sanitizeRichHtml(normStr(item.descripcion)),
        precio_base: Number(item.precio_base || 0),
        costo_base: Number(item.costo_base || 0),
        stock_minimo: Number(item.stock_minimo || 0),
        se_fabrica: Boolean(item.se_fabrica),
        se_compra: Boolean(item.se_compra),
        se_vende: Boolean(item.se_vende),
        cuenta_venta_id: ctaV,
        cuenta_compra_id: ctaC,
        atributos,
      });

      if (res?.plantilla_id && Array.isArray(item.variantes)) {
        const createdVars = productoRepo.findWhere({ plantilla_id: res.plantilla_id });
        for (const v of item.variantes) {
          const combo = v.combinacion || {};
          const match = createdVars.find(p => {
            const pc = parseJsonSafe(p.combinacion_json, {});
            return Object.entries(combo).every(([k, val]) => String(pc[k] || '') === String(val));
          });
          if (match) {
            productoRepo.update(match.id, {
              costo: Number(v.costo ?? item.costo_base ?? 0),
              precio: Number(v.precio ?? item.precio_base ?? 0),
              sku: normStr(v.sku) || match.sku,
              codigo_barras: normStr(v.codigo_barras) || '',
              stock_minimo: Number(v.stock_minimo || 0),
            });
          }
        }
      }
      return 'created';
    },
  },

  recetas: {
    label: 'Recetas (BoM)',
    description: 'Recetas completas con etapas, insumos y variantes aplicadas',
    template: [
      {
        nombre: 'Receta Zapatilla Demo',
        referencia: 'BOM-001',
        plantilla_nombre: 'Zapatilla Demo',
        activa: 1,
        notas: 'Especificación general',
        etapas: [
          { orden: 1, nombre: 'Cortado', dias_estimados: 2, costo_unidad: 500 },
          { orden: 2, nombre: 'Armado', dias_estimados: 3, costo_unidad: 800 },
        ],
        lineas: [
          { producto_nombre: 'Base Demo (38)', etapa_nombre: 'Armado', coeficiente: 1, udm_receta: 'unidades', variantes: ['Talle: 38'] },
        ],
      },
    ],
    exportItems: () => {
      const pts = new Map(plantillaRepo.findAll().map(pt => [pt.id, pt.nombre]));
      const prods = new Map(productoRepo.findAll().map(p => [p.id, p]));
      const contactos = new Map(contactoRepo.findAll().map(c => [c.id, c.nombre]));
      const ctas = new Map(planCuentaRepo.findAll().map(c => [c.id, c.codigo]));

      const etapasByReceta = new Map();
      for (const e of recetaEtapaRepo.query().orderBy('orden', 'ASC').all()) {
        if (!etapasByReceta.has(e.receta_id)) etapasByReceta.set(e.receta_id, []);
        etapasByReceta.get(e.receta_id).push(e);
      }
      const lineasByReceta = new Map();
      for (const l of recetaLineaRepo.query().orderBy('id', 'ASC').all()) {
        if (!lineasByReceta.has(l.receta_id)) lineasByReceta.set(l.receta_id, []);
        lineasByReceta.get(l.receta_id).push(l);
      }

      return recetaRepo.findAll().map(r => {
        const etapas = etapasByReceta.get(r.id) || [];
        const etapaById = new Map(etapas.map(e => [e.id, e.nombre]));
        const lineas = lineasByReceta.get(r.id) || [];
        const prodCab = r.producto_id ? prods.get(r.producto_id) : null;

        return {
          nombre: r.nombre,
          referencia: r.referencia || '',
          plantilla_nombre: pts.get(r.plantilla_id) || '',
          producto_sku: prodCab?.sku || prodCab?.codigo || '',
          activa: Number(r.activa ?? 1),
          notas: r.notas || '',
          ficha_tecnica_html: r.ficha_tecnica_html || '',
          etapas: etapas.map(e => ({
            orden: Number(e.orden || 1),
            nombre: e.nombre,
            descripcion: e.descripcion || '',
            dias_estimados: Number(e.dias_estimados || 0),
            costo_unidad: Number(e.costo_unidad || 0),
            taller_nombre: e.taller_id ? (contactos.get(e.taller_id) || '') : '',
            cuenta_codigo: e.plan_cuenta_id ? (ctas.get(e.plan_cuenta_id) || '') : '',
          })),
          lineas: lineas.map(l => {
            const ins = prods.get(l.producto_id);
            return {
              producto_sku: ins?.sku || ins?.codigo || '',
              producto_nombre: ins?.nombre || '',
              etapa_nombre: l.receta_etapa_id ? (etapaById.get(l.receta_etapa_id) || '') : '',
              coeficiente: Number(l.coeficiente || 0),
              udm_receta: l.udm_receta || 'unidades',
              variantes: parseJsonSafe(l.variantes_json, []),
            };
          }),
        };
      });
    },
    importItem: (item, { mode }) => {
      const nombre = normStr(item.nombre);
      const ptNombre = normStr(item.plantilla_nombre);
      if (!nombre || !ptNombre) throw new Error('Falta nombre o plantilla_nombre');
      const pt = plantillaRepo.findAll().find(p => normStr(p.nombre).toLowerCase() === ptNombre.toLowerCase());
      if (!pt) throw new Error(`Plantilla de producto no encontrada: "${ptNombre}"`);

      const existing = recetaRepo.findWhere({ plantilla_id: pt.id }).find(r => normStr(r.nombre).toLowerCase() === nombre.toLowerCase());
      if (existing && mode === 'skip_existing') return 'skipped';

      const allProds = productoRepo.findAll();
      const allContactos = contactoRepo.findAll();
      const allCtas = planCuentaRepo.findAll();
      const prodCab = item.producto_sku
        ? allProds.find(p => normStr(p.sku) === normStr(item.producto_sku) || normStr(p.codigo) === normStr(item.producto_sku))
        : null;

      let recetaId;
      const safeFichaHtml = sanitizeRichHtml(item.ficha_tecnica_html || '');
      if (existing) {
        recetaRepo.update(existing.id, {
          referencia: normStr(item.referencia),
          producto_id: prodCab?.id || null,
          activa: item.activa !== undefined ? (item.activa ? 1 : 0) : 1,
          notas: normStr(item.notas),
          ficha_tecnica_html: safeFichaHtml,
        });
        recetaId = existing.id;
        recetaLineaRepo.query().where('receta_id', recetaId).delete();
        recetaEtapaRepo.query().where('receta_id', recetaId).delete();
      } else {
        recetaId = createReceta({
          plantilla_id: pt.id,
          producto_id: prodCab?.id || null,
          nombre,
          referencia: normStr(item.referencia),
          activa: item.activa !== undefined ? Boolean(item.activa) : true,
          notas: normStr(item.notas),
          ficha_tecnica_html: safeFichaHtml,
        });
      }

      const etapaIdByNombre = new Map();
      for (const et of (Array.isArray(item.etapas) ? item.etapas : [])) {
        const taller = et.taller_nombre ? allContactos.find(c => normStr(c.nombre).toLowerCase() === normStr(et.taller_nombre).toLowerCase()) : null;
        const cta = et.cuenta_codigo ? allCtas.find(c => normStr(c.codigo) === normStr(et.cuenta_codigo)) : null;
        const etId = addRecetaEtapa(recetaId, {
          nombre: et.nombre,
          descripcion: et.descripcion || '',
          orden: Number(et.orden || 1),
          dias_estimados: Number(et.dias_estimados || 0),
          costo_unidad: Number(et.costo_unidad || 0),
          taller_id: taller?.id || null,
          plan_cuenta_id: cta?.id || null,
        });
        etapaIdByNombre.set(normStr(et.nombre).toLowerCase(), etId);
      }

      for (const l of (Array.isArray(item.lineas) ? item.lineas : [])) {
        const ins = (l.producto_sku && allProds.find(p => normStr(p.sku) === normStr(l.producto_sku) || normStr(p.codigo) === normStr(l.producto_sku)))
          || (l.producto_nombre && allProds.find(p => normStr(p.nombre).toLowerCase() === normStr(l.producto_nombre).toLowerCase()));
        if (!ins) throw new Error(`Insumo no encontrado: "${l.producto_nombre || l.producto_sku}"`);
        const etapaId = l.etapa_nombre ? (etapaIdByNombre.get(normStr(l.etapa_nombre).toLowerCase()) || null) : null;
        addRecetaLinea(recetaId, {
          producto_id: ins.id,
          receta_etapa_id: etapaId,
          coeficiente: Number(l.coeficiente || 1),
          udm_receta: l.udm_receta || 'unidades',
          variantes: Array.isArray(l.variantes) ? l.variantes : [],
          emparejar_variante: 0,
        });
      }

      return existing ? 'updated' : 'created';
    },
  },
};

export function listExchangeEntities() {
  return Object.entries(REGISTRY).map(([key, def]) => ({
    key,
    label: def.label,
    description: def.description,
  }));
}

export function getTemplateJson(entidad) {
  const def = REGISTRY[entidad];
  if (!def) throw new Error(`Entidad no soportada: ${entidad}`);
  return {
    schema: 'vanguard.export.v1',
    entidad,
    template: true,
    items: def.template,
  };
}

export function exportEntityJson(entidad) {
  const def = REGISTRY[entidad];
  if (!def) throw new Error(`Entidad no soportada: ${entidad}`);
  const items = def.exportItems();
  return {
    schema: 'vanguard.export.v1',
    entidad,
    exported_at: new Date().toISOString(),
    count: items.length,
    items,
  };
}

export function importEntityJson(entidad, payload, { mode = 'upsert' } = {}) {
  const def = REGISTRY[entidad];
  if (!def) throw new Error(`Entidad no soportada: ${entidad}`);
  const items = Array.isArray(payload) ? payload : (Array.isArray(payload?.items) ? payload.items : null);
  if (!items) throw new Error('El JSON debe contener un array "items" o ser un array de registros.');

  const result = { entidad, mode, total: items.length, created: 0, updated: 0, skipped: 0, errors: [] };
  return categoriaRepo.transaction(() => {
    items.forEach((item, idx) => {
      try {
        const status = def.importItem(item, { mode });
        if (status === 'created') result.created++;
        else if (status === 'updated') result.updated++;
        else result.skipped++;
      } catch (err) {
        const abortErr = new Error(`Importación JSON abortada (rollback completo) — Registro #${idx + 1}: ${err.message}`);
        abortErr.statusCode = 400;
        throw abortErr;
      }
    });
    if (typeof def.afterImport === 'function') {
      def.afterImport(items);
    }
    return result;
  });
}
