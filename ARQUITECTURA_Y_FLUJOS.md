# Vanguard Production (`vng-prod`) — Arquitectura, Flujos y Guía de Onboarding

Documento de referencia para cualquier persona o agente IA que lea el proyecto por primera vez. Resume **qué es**, **cómo se organiza**, **qué reglas no se rompen**, **cómo fluyen los datos entre módulos** y **qué falta implementar**.

> Reglas estrictas de código: [`DEVELOPMENT_RULES.md`](./DEVELOPMENT_RULES.md). Este documento las resume en la sección 11.

---

## 1. Qué es el proyecto

ERP web para una operación de **manufactura (calzado) + comercio**, orientado a Argentina (ARCA/AFIP, IIBB, SIFERE). Cubre: catálogo con variantes, recetas y producción por etapas con talleres externos, inventario multi-ubicación con lotes, compras, ventas, tesorería, contabilidad de partida doble, libros fiscales, tareas y multi-base de datos.

| Aspecto | Detalle |
|---|---|
| Runtime | Node.js ESM, **sin dependencias externas** (`package.json` sin `dependencies`) |
| Base de datos | SQLite nativo (`node:sqlite`), una base por archivo en `./db/<nombre>.sqlite` |
| Backend | `http` nativo + router propio (`src/routes/api.js`) |
| Frontend | SPA Vanilla ESM servida estáticamente desde `public/` (router propio, sin framework) |
| PDF | Generador PDF 1.4 propio (`src/services/print/pdfBuilder.js`), sin librerías |
| Idioma | UI, dominio y comentarios en español rioplatense |

### Comandos
```powershell
npm start                      # node server.js  (PORT por .env, default 3000)
node --test                    # suite completa (27 tests, deben pasar siempre)
node --check <archivo.js>      # validación de sintaxis de todo JS modificado
```
> En PowerShell no hay `rg`; usar `Select-String`. `npm test` puede estar bloqueado por política: usar `node --test`.

### Configuración (`.env`, ver `.env.example`)
`PORT`, `ALLOWED_HOSTS`, `SECRET_TOKEN` (firma HMAC de cookies), `DB_MASTER_KEY` (administrar bases), `DEFAULT_DB`, `COOKIE_SECURE`, `LOG_LEVEL`, `LOG_CONSOLE`, `LOG_TO_FILE`, `LOG_DIR`. Cargadas por `src/config/env.js`.

---

## 2. Estructura de carpetas

```
server.js                      Servidor HTTP: seguridad, hosts, logging, estáticos, delega /api/* a handleApi
src/
  config/env.js                Carga .env y expone ENV
  core/                        ORM y utilidades base
    BaseRepository.js          CRUD tipado + validación + auditoría + transacciones (SAVEPOINT re-entrantes)
    QueryBuilder.js            Query builder parametrizado (único lugar con SQL de consulta)
    schemaBuilder.js           Genera CREATE/ALTER desde MODELS
    logger.js                  Logger por nivel/contexto, archivos app-*.log y error-*.log
  db/
    models.js                  ★ SSOT del esquema: MODELS (tablas) y VIEWS (vistas SQL)
    schema.js                  Aplica el esquema/migraciones al abrir una base
    seed.js                    Datos base (plan de cuentas, jurisdicciones, ubicaciones, secuencias, grupos...)
    connection.js              Multi-base con AsyncLocalStorage (una conexión por request)
  db.js                        Reexporta la conexión (`db` proxy, `runWithDatabase`, etc.)
  middlewares/security.js      Headers de seguridad, IP del cliente, rate limiting
  routes/                      Capa HTTP (solo parseo, permisos y respuesta)
    api.js                     Despachador + chequeo de permisos por prefijo + helper `handlePdfPrint`
    authRoutes / dbRoutes / metaRoutes / configRoutes / inventarioRoutes / produccionRoutes /
    comprasRoutes / ventasRoutes / tesoreriaRoutes / contactosRoutes / fiscalRoutes / tareaRoutes
  services/                    Reglas de negocio por dominio (ver sección 6)
public/
  index.html, app.js, router.js  Shell SPA, definición de rutas (`addRoute`), router
  styles.css
  lib/                         Utilidades compartidas del frontend (ver sección 7)
    engine/                    ★ Motores visuales reutilizables
  views/<modulo>/              Pantallas por dominio
tests/                         Suite `node:test` (dominio, fiscal, contabilidad, cheques, SOLID, PDF, logger)
utils/                         Este documento y planillas auxiliares
uploads/<db>/                  Adjuntos en disco por base (gestionado por metaService)
logs/                          Logs de aplicación
```

---

## 3. Arquitectura Backend

### 3.1 SSOT del esquema
- Toda tabla, columna, tipo, enum, FK, índice y vista vive en `src/db/models.js` (`MODELS`, `VIEWS`). `schemaBuilder.js` deriva el DDL; `BaseRepository.validate()` valida contra el mismo modelo.
- `public/lib/jurisdicciones.js` es SSOT de **provincias argentinas**: código SIFERE (`901`–`924`), **letra ISO 3166-2:AR** (`C`, `B`, `K`, ... para WooCommerce) y nombre. Lo consumen `seed.js` (tabla `jurisdicciones`) y los formularios (Empresa, Contactos, modal rápido).

### 3.2 ORM (cero SQL crudo en servicios)
- **`src/services/**` y `src/routes/**` no contienen `db.prepare` ni `db.exec`** (auditado: 0 coincidencias). Solo `src/core/`, `src/db/` y `src/db.js` tocan SQLite.
- `BaseRepository({ model | table, ... })`: `findById`, `findWhere`, `findAll`, `create`, `update`, `delete`, `transaction(fn)` (SAVEPOINT, anidable), `validate`, `query(alias)`.
- `QueryBuilder`: `select`, `from`, `leftJoin`, `innerJoin`, `where` (ops seguros), `whereIn`, `whereNotIn`, `whereNull`, `whereNotNull`, `groupBy`, `orderBy(col, dir)`, `limit`, `all`, `get`, `count`, `sum`, `insert`, `update`, `delete`. Identificadores validados contra inyección.
- Limitaciones conocidas: `orderBy` acepta una columna por llamada (encadenar `.orderBy()`), no expresiones (`COALESCE(...)`); en esos casos ordenar en JS tras `.all()`.
- Para vistas SQL: `new BaseRepository({ table: 'v_productos' })`.

### 3.3 Multi-base de datos
`server.js` lee la cookie firmada `calc_db`, resuelve la base (`resolveRequestDatabase`) y ejecuta todo el request dentro de `runWithDatabase(db, ...)` (AsyncLocalStorage). Gestión (crear, respaldar, cambiar, eliminar) en `dbManagerService.js` + `/databases`, protegida por `DB_MASTER_KEY`.

### 3.4 Autenticación y permisos
- Sesiones por cookie `calc_sid` firmada (HMAC con `SECRET_TOKEN`) o `Bearer`. Usuarios/grupos con `permisos_json`.
- Permisos: `produccion.ver/editar`, `inventario.ver/editar`, `comercial.ver/editar`, `tesoreria.ver/editar`, `contabilidad.ver/editar`, `sistema.config`, `sistema.usuarios`, `*` (admin). `api.js` mapea prefijo de ruta → permiso; el frontend oculta menús vía `data-perm`.
- Primer arranque: `needsInitialSetup` / `setupInitialAdmin`. Registro público queda **pendiente de habilitación** por un admin.

### 3.5 Motor de impresión PDF (criterio único)
- **Toda impresión es un PDF generado on-the-fly en backend** y abierto en el frontend con `openPdfFromEndpoint(endpoint, payload, nombre)` (`public/lib/remitoPrint.js`). **No existen ventanas HTML `about:blank`** (se eliminó `printShell.js`).
- Piezas: `pdfBuilder.js` (`PdfDocument`, tamaños A4/A5/ticket80/ticket58, helpers `fmtDateAr`/`fmtNumAr`), `reportLayout.js` (`createReportContext`: encabezado de empresa, paginación, tabla con `ensureSpace`/`drawTableHeaders`, pie con nº de página) y un servicio por documento.
- `api.js` expone `handlePdfPrint(generatorFn, getFilename)` y registra:

| Endpoint | Servicio | Documento |
|---|---|---|
| `/api/print/remito-pdf` | `remitoPdfService` | Remito (X/R, con CAI) |
| `/api/print/venta-pdf` | `ventaPdfService` | Factura/NC/ND con QR AFIP y leyendas RG 5003 |
| `/api/print/presupuesto-pdf` | `presupuestoPdfService` | Presupuesto de producción |
| `/api/print/orden-pdf` | `ordenPdfService` | Orden de producción |
| `/api/print/cuenta-corriente-pdf` | `cuentaCorrientePdfService` | Extracto de cuenta corriente |
| `/api/print/existencias-pdf` | `existenciasPdfService` | Reporte de existencias valorizado |
| `/api/print/tesoreria-pdf` | `tesoreriaPdfService` | Orden de pago / Recibo de cobro |
| (recetas, retenciones) | `recetaPdfService`, `retencionPdfService` | Ficha técnica (con/sin costos, taller), certificado de retención |

- Preferencias de impresión (formato, copias, logo, modo económico B/N, pie) viven en `empresa_config` (`print_*`).

---

## 4. Arquitectura Frontend

### 4.1 Shell y navegación
`index.html` define el drawer lateral (grupos `<details class="nav-group">` filtrados por `data-perm`) y carga `app.js`, que registra rutas con `addRoute(path, handler, permiso)`. Cada vista exporta `render...View()` y escribe en `#app-view`.

Menú actual: **Dashboard**, **Tareas**, **Producción** (Pedidos, Órdenes, Etapas, Pendientes, Recetas), **Inventario** (Productos, Existencias, Flujo de Stock, Operaciones, Categorías, Variantes, Unidades, Ubicaciones), **Comercial** (Ventas, Compras, Abastecimiento, Contactos, Condiciones), **Tesorería** (Cuentas y Pagos, Flujo de Caja, Cheques, Conciliación), **Contabilidad** (Diario, Mayor, Balance, Plan de Cuentas, Impuestos, Libros IVA, Posición IVA, Cierres), **Sistema** (Configuración, Bases de Datos).

Alias de rutas: `/traslados`, `/remitos` y `/entregas` renderizan las mismas pantallas de Operaciones de Stock. `/presupuestos/:id` existe pero **no tiene entrada de menú** (se llega desde otras pantallas).

### 4.2 Motores visuales (`public/lib/engine/`, punto de entrada `index.js`)
| Motor | Exporta | Uso |
|---|---|---|
| `tableEngine` | `renderDataTable` | Listados con selección múltiple (Shift+Click), acciones masivas, exportar CSV, orden por columna, totales y **paginación** (`paginate`, `pageSize=25`, `pageSizeOptions=[25,50,100,0]`; recuerda página/tamaño en el contenedor). Extensible a cualquier pantalla sin código extra. |
| `layoutEngine` | `renderKpiStrip`, `renderFilterBar`, `renderViewSwitcher`, `mountPageView` | KPIs, barra de búsqueda/filtros con "Limpiar", selector de vistas |
| `viewsEngine` | `renderKanbanBoard`, `renderGanttChart`, `renderGroupedList`, `renderHierarchyTree` | Vistas alternativas (Kanban con drag&drop, Gantt con indicador de hoy) |
| `detailEngine` | `mountDetailView` | Ficha ERP: breadcrumb, acciones, stepper, smart buttons, KPIs, tabs con memoria por ruta, sidebar (`sidebarPosition: 'right' \| 'bottom'`) |
| `modalEngine` | `createModal`, `showAlertModal`, `showConfirmModal`, `showPromptModal`, `showFormModal` | **Único** sistema de modales/diálogos |
| `formEngine` | `mountFormFields` | Formularios declarativos |
| `matrixEngine`, `chartEngine` | `renderMatrixTable`, `renderComboFlowChart` | Matriz de flujo de stock y gráficos |

### 4.3 Librerías compartidas (`public/lib/`)
- `api.js`: `api()`, `toast()`, `refreshKPIs()`.
- `autocomplete.js`: `mountCombobox`, `mountMultiSelect` (chips + buscador + "Seleccionar todo"), mejora automática de `<select>` (combo con `Tab` correcto y `z-index` sobre modales), y creación rápida: `quickCreateContacto` (base común de `quickCreateCliente`/`quickCreateProveedor`: Nombre/Fantasía, Razón Social, Tipo y Nº de documento formateado, Condición IVA, domicilio, Localidad, Provincia desde SSOT, CP, País), `quickCreateProducto`, `quickCreateCategoria`.
- `format.js`: `fmtMoney`, `fmtNum`, badges, `formatDocumento`/`bindDocumentoInput` (CUIT/CUIL/CDI con guiones, DNI con millares), `renderProvinciaOptions`, `compressImageToDataUrl`, `exportRowsToCSV`, y **editor enriquecido** `mountRichEditor` + `sanitizeRichHtml` (negrita/listas/títulos, **links**, **imágenes** por URL o archivo comprimido, **videos** YouTube/Vimeo/MP4/WebM ≤ 8 MB, **archivos** ≤ 5 MB como chip descargable). Usado en Recetas (ficha técnica), Productos (descripción) y Tareas.
- `jurisdicciones.js` (SSOT provincias), `comprobantesAr.js` (tipos de comprobante), `taxHelper.js`, `metaPanel.js` (notas/adjuntos/auditoría por entidad), `remitoPrint.js`/`ventaPrint.js`/`tesoreriaPrint.js`/`cuentaCorrientePrint.js` (adaptadores finos que llaman a los endpoints PDF).

---

## 5. Mapa de modelos (`MODELS`)

| Dominio | Tablas |
|---|---|
| **Sistema / Auth / Meta** | `usuarios`, `grupos`, `sesiones`, `password_resets`, `notas_internas`, `adjuntos`, `empresa_config`, `puntos_venta`, `secuencias`, `jurisdicciones` (`codigo` SIFERE + `letra` ISO), `afip_xml_logs` |
| **Catálogo y Contactos** | `contactos` (unificado `es_cliente`/`es_proveedor`/`es_taller`), `producto_plantillas`, `productos` (variantes/SKU), `producto_variantes`, `plantilla_impuestos`, `producto_historial_precios`, `producto_proveedores` (tarifas por proveedor), `categorias`, `unidades_medida`, `variantes` |
| **Condiciones comerciales** | `terminos_pago`, `metodos_pago`, `listas_precios`, `lista_precio_items`, `metodos_envio`, `cupones`, `recargos_pago` |
| **Inventario** | `ubicaciones` (`interna`/`dedicada`/`virtual`), `lotes`, `stock_quants`, `movimientos_stock` (ledger inmutable), `operaciones_stock`, `operacion_stock_lineas` |
| **Producción** | `etapas_config`, `recetas`, `receta_etapas`, `receta_lineas`, `receta_linea_variantes`, `pedidos`, `pedido_lineas`, `pedido_insumos` (snapshot), `entregas`, `entrega_lineas`, `presupuestos`, `presupuesto_lineas`, `presupuesto_items`, `ordenes_produccion`, `orden_lineas`, `orden_etapas` |
| **Comercial** | `compras`, `compra_lineas`, `compra_impuestos`, `ventas`, `venta_lineas`, `venta_impuestos`, `impuestos_config`, `padron_alicuotas` |
| **Tesorería y Contabilidad** | `cuentas`, `cobros`, `cobro_lineas`, `pagos`, `pago_lineas`, `pago_retenciones`, `cheques`, `imputaciones`, `flujo_proyecciones`, `plan_cuentas`, `diarios`, `asientos`, `asiento_lineas`, `cotizaciones_moneda`, `extracto_movimientos`, `cierres_ejercicio` |
| **Tareas** | `tareas` |

**Vistas SQL**: `v_producto_stock` (suma de `stock_quants` en ubicaciones internas/dedicadas), `v_plantillas` (categoría y UdM resueltas), `v_productos` (variante + stock agregado).

---

## 6. Servicios del backend (`src/services/`)

| Carpeta | Servicios |
|---|---|
| `auth/` | `authService` (sesiones, usuarios, grupos, permisos, reset), `dbManagerService` (multi-base), `metaService` (notas/adjuntos; `VALID_ENTIDADES` = compra, venta, movimiento, pago, cobro, orden, operacion_stock, receta, pedido, presupuesto, contacto, plantilla, tarea) |
| `config/` | `configService` (empresa, categorías, unidades, variantes, etapas, impuestos, puntos de venta, secuencias y `getNextNumeroDocumento`), `importService` (CSV de productos y contactos) |
| `comercial/` | `compraService`, `ventaService`, `contactoService`, `comercialReglasService` (envíos, cupones, recargos), `condicionesComercialesService` (términos/métodos de pago, listas de precio, tarifas proveedor, `resolverPrecioLista`/`resolverPrecioCompra`), `documentoComercialHelper` |
| `inventario/` | `productoService` (plantillas, variantes, historial de costos/precios), `inventarioService` (ubicaciones, lotes, quants, `registrarMovimientoStock`, resumen, flujo proyectado), `operacionStockService` |
| `produccion/` | `recetaService`, `curvaService`, `presupuestoService`, `pedidoService`, `produccionService` (órdenes, etapas, cronograma de compras, pendientes) |
| `finanzas/` | `tesoreriaService` (cuentas, cobros, pagos, transferencias, flujo), `chequeService`, `imputacionService`, `asientoService`, `contabilidadAvanzadaService` (posición IVA, conciliación, cotizaciones, cierres), `planCuentasTemplates` |
| `afip/` | `afipService` (WSAA/WSFE/Padrón A5/WSCDC), `afipCrypto`, `fiscalRules` (matriz emisor × receptor), `libroIvaService` (Libro IVA Digital, SICORE/SIFERE, retenciones, reporte por jurisdicción) |
| `print/` | Ver 3.5 |
| `tareas/` | `tareaService` |

Servicios con **inyección de repositorios** (testeables sin SQLite): `ContactoService`, `AsientoService`, `InventarioBaseService`.

---

## 7. Lógica de productos y abastecimiento

Cada `producto_plantillas` define `se_fabrica`, `se_compra`, `se_vende`, `tipo` (`almacenable`/`consumible`/`servicio`), `requiere_lote` y atributos de variantes. `syncVariantesForPlantilla` genera el producto cartesiano en `productos` (`combinacion_json` + SKU).

| `se_fabrica` | `se_compra` | `se_vende` | Tipo operativo | Comportamiento |
|:-:|:-:|:-:|---|---|
| 0 | 1 | 0 | Insumo | Se compra; se consume en recetas/órdenes |
| 1 | 0 | 1 | Fabricado | Se produce con receta + orden; se vende |
| 0 | 1 | 1 | Retail | Compra y reventa; si falta stock al confirmar venta → **Compra en Borrador** |
| 1 | 1 | 1 | Mixto | Se fabrica o se compra |

---

## 8. Flujos del sistema

### 8.1 Producción: Pedido → Orden → Etapas → Stock
1. **Receta** (`/recetas/:id`): tabs Insumos / Etapas / Ficha Técnica / Cabecera. Insumos y Etapas se cargan **en la misma tabla** (fila de alta al pie; al editar, la fila se convierte en inline-edit). Cada etapa tiene taller, cuenta contable, costo/u, días, dependencia e imagen. La ficha técnica (texto enriquecido + imágenes por etapa y producto) se exporta a PDF con o sin costos o versión taller.
2. **Pedido** (`/pedidos`): demanda por lote/cliente con receta elegida; guarda `pedido_insumos` (snapshot de insumos a comprar con flag `comprado`) y registra **Entregas** parciales (`entregas`). Estados: Confirmado, En Producción, Entrega Parcial, Entregado, Cancelado (sincronizados por `syncPedidoEstadoByLote`).
3. **Orden** (`/ordenes`): botón **Lanzar Orden de Producción** desde el Pedido (`POST /api/ordenes` con `pedido_id`) o alta manual. Al crear:
   - Etapas desde la receta (o `etapas_config`), con ventanas de fechas y dependencias.
   - `planificarDocumentosOrden`: stock disponible → **`remito_taller` en Borrador** (depósito → taller); faltante → **Compra en Borrador** agrupada por proveedor.
4. **Ejecución**: al completar una etapa se consume stock (primero `TALLER-EXT`, luego `DEP-CENTRAL`), y si hay taller y costo real se crea una **compra interna** de mano de obra con asiento. Al completar todas, se ingresa el producto terminado a `PROD-TERM` y la orden queda `Completada`.
5. **Seguimiento**: `/produccion/etapas`, `/pendientes`, `/cronograma` (abastecimiento: lead time histórico, urgencias, stock mínimo).

### 8.2 Inventario: el stock nace de operaciones
Principio: **el stock no se edita; se mueve**. Todo cambio pasa por una **Operación de Stock** que deja asiento inmutable.
- Tipos (`operaciones_stock.tipo`): `recepcion`, `entrega`, `remito_taller`, `traslado`, `ajuste`. Estados: `Borrador` (no mueve stock) → `Confirmado` (mueve) → `Anulado` (contra-movimiento).
- Confirmar → `registrarMovimientoStock` actualiza `stock_quants` (por ubicación y lote) y escribe `movimientos_stock`. Productos con `requiere_lote` exigen lote (salvo `ajuste`).
- Ubicaciones de sistema: `DEP-CENTRAL`, `TALLER-EXT`, `PROD-TERM`, `VIRT-PROV`, `VIRT-CLI`, `VIRT-PROD`, `VIRT-AJUSTE`.
- **Stock Físico** (`v_producto_stock.stock_fisico`) = suma de `stock_quants.cantidad` en ubicaciones `interna`/`dedicada`. En Productos/Variantes es **solo lectura** (con acceso "Operar Stock"); no existe "Stock inicial" ni edición directa.
- **Existencias** (`/inventario`): resumen paginado, saldos por ubicación/lote, movimientos, alertas de stock mínimo y **Exportar PDF** valorizado.
- **Flujo de Stock** (`/inventario/flujo-stock`): matriz por período (semana/mes) con reales + proyectados (recepciones/compras en borrador, OP, consumos).

### 8.3 Compras (`/compras`)
Borrador editable → confirmación genera **`recepcion` en Borrador** (o `entrega` si es NC) y el **asiento** (signo invertido en NC). Resuelve precio por tarifa de proveedor. Pagos desde la compra, retenciones en el pago, imputaciones, constatación de comprobante en ARCA.

### 8.4 Ventas (`/ventas`)
Presupuesto/Borrador (sin efectos) → Confirmada: genera **`entrega` en Borrador** (o `recepcion` si es NC), **abastecimiento retail** automático (Compra en Borrador si falta stock de productos de reventa), asiento contable, y opcionalmente emisión CAE en ARCA con QR. Soporta término/método de pago, lista de precios, envío, cupón y recargo; letra fiscal resuelta por `fiscalRules` (emisor × receptor). Cobros e imputación desde la misma ficha.

### 8.5 Tesorería y Contabilidad
- Cuentas (efectivo/banco/billetera) con métodos permitidos por tipo; saldo recalculado (`recalcCuentaSaldo`) desde cobros, pagos y asientos de transferencia/ajuste/cheques.
- Cobros/pagos **multimétodo** (`*_lineas`), cartera de **cheques** (terceros: cartera → depósito → acreditación/rechazo/endoso; propios diferidos) y **imputaciones N-a-N** con diferencia de cambio.
- `AsientoService` exige partida doble (`SUM(debe) = SUM(haber)`), soporta asientos manuales y reversión por contra-asiento; `assertFechaAbierta` respeta **cierres de ejercicio**.
- Reportes: Libro Diario/Mayor, Balance, Posición IVA (contabilizable), Libro IVA Digital, SICORE/SIFERE, flujo de caja real y proyectado (`flujo_proyecciones`), **conciliación bancaria** (importa extracto CSV, auto-concilia).

### 8.6 Fiscal Argentina
`fiscalRules` define qué comprobante corresponde por condición IVA de emisor y receptor (RG 1415 / RG 5003); `afipService` maneja certificados, tokens WSAA, último comprobante, emisión CAE, Padrón A5 (autocompleta contactos) y archiva XML (`afip_xml_logs`). Contactos y empresa usan la misma lista de provincias/jurisdicciones; los números de documento se formatean según tipo.

### 8.7 Tareas (`/tareas`)
Estados `Pendiente`/`En Proceso`/`En Revisión`/`Completada`/`Cancelada`, prioridad, fechas, responsable, descripción enriquecida. **4 vistas** con los motores visuales (Kanban con drag&drop, Gantt, Calendario mensual, Lista) y filtros por **estado**, **vencimiento** (vencidas/hoy/7 días/sin fecha), **responsable** y búsqueda. Modelo preparado con `referencia_tipo`/`referencia_id` para vincular a otras entidades.

### 8.8 Transversales
- **Notas y adjuntos** por entidad (`metaPanel` ↔ `metaService`); en fichas con tabs el panel va **debajo** (`sidebarPosition: 'bottom'`).
- **Importación CSV** de productos y contactos desde Configuración.
- **Dashboard** (`GET /api/dashboard`): caja, cuentas por cobrar/pagar, valor de inventario, borradores pendientes, stock bajo mínimo, órdenes activas.

---

## 9. Reservado y Próximo: estado actual vs. diseño objetivo

**Hoy:** el *reservado* se calcula al vuelo solo por órdenes de producción activas (`computeStockReservadoPorOrdenes`); la columna `stock_quants.cantidad_reservada` existe pero **no se usa**. El *flujo proyectado* ya suma recepciones/compras en borrador, OP y entregas pendientes. `productos.stock` es una columna espejo legacy que `v_productos` usa solo como fallback (`COALESCE(vps.stock_fisico, p.stock, 0)`).

**Diseño objetivo (a implementar):**
- **Físico** = Σ `stock_quants.cantidad` (internas/dedicadas). Solo cambia al confirmar/anular una operación.
- **Reservado** = compromisos de salida aún no ejecutados: operaciones de salida en `Borrador` (entrega de venta, remito a taller) + consumos pendientes de OP (`orden_etapas.stock_consumido = 0`). Se libera al confirmar la operación o al cancelar el documento origen.
- **Disponible** = Físico − Reservado (lo que se puede prometer hoy).
- **Próximo / Proyectado** = Físico + Entradas previstas (recepciones en borrador, compras sin recepción en `fecha + lead_time`, OP por ingresar) − Salidas previstas (entregas y consumos pendientes). No toca `stock_quants`. No restar dos veces el reservado.

---

## 10. Testing
`tests/` (`node --test`, 27 tests): dominio integral y partida doble, fiscal AR (jurisdicciones, Libro IVA, retenciones, QR), `fiscalRules`, cheques, tesorería de cuentas, contabilidad y contabilidad avanzada (imputaciones, multimoneda, conciliación, cierre), condiciones comerciales, reglas comerciales (envíos/cupones/recargos), remito PDF, logger, y **tests SOLID** con repositorios en memoria (DIP/LSP/SRP). Cada tarea se cierra con `node --check` + `node --test` en verde.

---

## 11. Reglas para agentes IA (resumen de `DEVELOPMENT_RULES.md`)

1. **SSOT**: esquema solo en `src/db/models.js`; provincias solo en `public/lib/jurisdicciones.js`; reglas fiscales en `fiscalRules.js`/`comprobantesAr.js`.
2. **ORM**: prohibido `db.prepare`/`db.exec` fuera de `src/core/`, `src/db/`, `src/db.js`. Si falta una capacidad, extender `QueryBuilder` (con validación) antes de escribir SQL.
3. **Capas (SRP)**: `routes` = HTTP/permisos; `services/<dominio>` = negocio; `services/print` = solo maquetación PDF; vistas = solo UI.
4. **Frontend**: usar `public/lib/engine/index.js`. **Prohibido** crear modales/tablas/filtros ad-hoc ni `alert`/`confirm` nativos. Selectores con `mountCombobox`/`mountMultiSelect`.
5. **Impresión**: todo reporte/comprobante = PDF on-the-fly (`PdfDocument` + `reportLayout`) + `openPdfFromEndpoint`. Nunca `window.open('about:blank')`.
6. **Stock**: nunca escribir `productos.stock` ni quants a mano; solo vía operaciones (`registrarMovimientoStock`/`operacionStockService`).
7. **DRY**: reutilizar `format.js`, `autocomplete.js` (`quickCreateContacto`), `documentoComercialHelper`.
8. **Pruebas**: `node --check` por archivo modificado y `node --test` completo antes de cerrar.
9. Comunicación y UI en español; PowerShell (sin `rg`).

---

## 12. Próximas implementaciones

1. **Reservas y Próximo reales**: implementar el diseño de la sección 9 (reserva por operaciones de salida en borrador y OP, liberación automática, columnas Reservado/Disponible/Próximo en Existencias y Productos), usando `stock_quants.cantidad_reservada` o un cálculo agregado único (una sola fuente), y eliminar el uso de `productos.stock` como fallback.
2. **Ajustes de stock como operación de primera clase**: asistente de `ajuste` (ubicación, lote si `requiere_lote`, motivo) accesible desde Productos/Existencias y **carga de stock inicial mediante operación**; auditoría de todo movimiento.
3. **Paginación del motor en todas las pantallas**: revisar listados que no usan `renderDataTable` y migrarlos; opcionalmente paginación server-side para tablas grandes (`movimientos_stock`, asientos, ventas).
4. **Integración WooCommerce**: sincronización de catálogo/stock por SKU, descarga de pedidos y clientes mapeando provincia por `jurisdicciones.letra` (ISO `AR-X`).
5. **ARCA/AFIP en producción**: homologación completa de WSAA/WSFEv1/Padrón/WSCDC con certificados de `empresa_config`, persistencia de CAE y vencimiento, manejo de rechazos.
6. **Tareas contextuales**: crear/ver tareas desde Órdenes, Pedidos, Ventas, Compras y Contactos (`referencia_tipo/id`), widgets de vencidas en el Dashboard, notificaciones.
7. **Presupuesto de producción**: decidir si se fusiona con el simulador de costos de Recetas o se expone con entrada de menú propia (hoy solo accesible por `/presupuestos/:id`).
8. **Limpieza técnica**: unificar alias de rutas de stock (`/traslados`, `/remitos`, `/entregas`), revisar entradas legacy (`entregas`/`pedidos` vs operaciones de stock) y completar tests de rutas HTTP y de vistas críticas.


---

## 9. Reglas de Desarrollo Frontend (UI, CSS y Tablas)

Para mantener consistencia visual, evitar regresiones en mobile y eliminar estilos ad-hoc:

1. **Cero `style="..."` inline en nuevos componentes y vistas**:
   - Usar clases estandarizadas definidas en `public/styles.css` (`.section-divider`, `.cert-upload-row`, `.flex-between`, `.text-sm-muted`, `.mt-sm`, `.mt-md`, `.mb-sm`, `.mb-md`, `.nowrap`, `.num`, `.actions`).
   - Migrar gradualmente los `style="..."` heredados a clases semánticas o utilitarias en `public/styles.css`.
2. **Tablas (`.data-table`) y Motor Visual (`tableEngine.js`)**:
   - Todas las tablas de listado deben usar `renderDataTable()` o `<table class="data-table">` dentro de `.table-wrap` para heredar automáticamente selección múltiple, exportación CSV, ordenamiento, densidad (`Compacta`/`Normal`) y selector de columnas (`.ve-table-toolbar`, persistido en `localStorage`).
   - En `.data-table td`, el texto descriptivo permite wrap (`white-space: normal; word-break: normal;`), mientras que fechas, códigos, unidades compuestas (`1 unidades`), montos, badges y botones de acción deben llevar `.nowrap`, `.num` o `.actions` (`white-space: nowrap`).
3. **Layout Shell y Navegación**:
   - El navbar y el drawer lateral viven exteriorizados en `public/lib/appShell.js` (`mountAppShell()`), manteniendo `public/index.html` mínimo.
   - Sin emojis en botones, tabs o badges de interfaz: usar texto limpio o íconos SVG inline.
   - En botones de acciones dentro de tablas/grillas, priorizar íconos SVG de interfaz inline (con `title` y `aria-label` descriptivos) en lugar de botones de texto apilados.
   - El estado colapsado del drawer en desktop se persiste en `sessionStorage` (`vng_sidebar_collapsed`).
4. **Numeración Documental**:
   - Todo documento con secuencia (Ventas, Compras internas, Pagos, Cobros, Retenciones, Órdenes de Producción, Operaciones de Stock y Remitos) debe resolver y avanzar su numeración en backend mediante `resolveNumeroDocumento()` / `getNextNumeroDocumento()` de `src/services/config/configService.js`, y formatear inputs manuales en frontend con `bindNumeroPadding()` + `bindPuntoVentaSeq()` de `public/lib/format.js`.
5. **Tablas editables tipo Hoja de Cálculo (`sheetEngine.js`)**:
   - Toda tabla con edición inline en celda (líneas de Compras, Ventas, Operaciones de Stock, Órdenes, Pedidos, Cobros, Pagos, Asientos, Recetas y catálogos editables) debe usar `renderSpreadsheetTable()` de `public/lib/engine/sheetEngine.js` (re-exportado en `public/lib/engine/index.js`), nunca `<input>`/`<select>` sueltos dentro de `<table>` manuales.
   - En **catálogos, configuración y recetas** (`defaultNewRow` + `onCreateRow`): **sin `<form>` de alta arriba ni botón `+ Agregar`**; siempre debe mostrarse una fila vacía al final de la grilla esperando el nuevo dato (incluso si aún no hay ítems cargados).
   - En **documentos confirmados** (`allowAppend: false` / solo lectura): **nunca** aparece fila vacía. En documentos en estado **Borrador**, la misma grilla permite edición y pasa a solo lectura al confirmarse.
6. **Importador / Exportador JSON (`jsonExchangeService.js`)**:
   - Las entidades con relaciones jerárquicas o múltiples sub-tablas (`recetas`, `productos`, `cuentas_contables`, `contactos`, `categorias`, `variantes`) se exportan e importan mediante `/api/json/(plantilla|exportar|importar)/:entidad` resolviendo referencias por código, SKU o nombre.
