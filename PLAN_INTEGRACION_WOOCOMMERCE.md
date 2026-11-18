# Plan de Integración con WooCommerce

Documento de diseño técnico y especificación de implementación para integrar **Vanguard Production** con **WooCommerce REST API v3** y **Webhooks**, respetando la arquitectura (`BaseRepository`, `MODELS`, `stock_quants`, `resolveNumeroDocumento`) y las **Reglas de Desarrollo Frontend** del proyecto (`utils/ARQUITECTURA_Y_FLUJOS.md`).

---

## 1. Arquitectura y Principios Generales

1. **Tablas espejo separadas (`woo_*`)**: toda entidad de WooCommerce se persiste primero en su tabla espejo (`woo_clientes`, `woo_productos`, `woo_pedidos`, `woo_cupones`, `woo_descuentos`, `woo_metodos_envio`, `woo_metodos_pago`) antes de crear o vincular entidades del core (`contactos`, `producto_plantillas`, `productos`, `ventas`, `cobros`).
2. **Mapeo de dominio (`woo_pedidos` → `ventas`)**: los pedidos de WooCommerce son comprobantes comerciales multi-producto con descuentos, envío, impuestos y pagos; por lo tanto se traducen a **`ventas`** (Módulo Comercial) y **no** a `pedidos` (que en este sistema son órdenes de planificación de fabricación por una única plantilla/receta).
3. **Clave de sincronización (`woo_id`)**: cada tabla espejo y cada tabla core vinculable (`contactos`, `producto_plantillas`, `productos`, `ventas`) mantiene su `woo_id` indexado para garantizar idempotencia.
4. **Integridad de Stock**: nunca se modifica `productos.stock` de forma directa. La sincronización hacia WooCommerce lee la sumatoria agregada desde `stock_quants` (filtrada por el depósito configurado) y las salidas por ventas confirmadas pasan por `operacionStockService` / `ventaService`.
5. **Precios por Listas de Precios**: los precios normal (`regular_price`) y oferta (`sale_price`) se resuelven mediante el módulo existente de **Listas de Precios** (`listas_precios` + `lista_precio_items`) configuradas en `woo_config`.
6. **Cobros y Facturación configurables**: la creación automática de ventas, su confirmación, la emisión del cobro en Tesorería (mapeando `woo_metodos_pago` → `metodos_pago` + `cuentas`) y la facturación son flags independientes en `woo_config`.
7. **Numeración y Jurisdicciones**:
   - Las ventas y cobros generados desde WooCommerce usan `resolveNumeroDocumento()` (`src/services/config/configService.js`).
   - El campo de provincia/estado de WooCommerce (`billing.state` / `shipping.state`, ej. `B`, `C`, `X`) se mapea contra `jurisdicciones` usando su **código de letra** (`jurisdicciones.letra` → `jurisdicciones.codigo`).

---

## 2. Modelo de Datos (`src/db/models.js` y `src/db/schema.js`)

> **Importante**: En `src/db/schema.js`, usar `ensureColumn` para agregar las columnas nuevas sobre bases SQLite existentes sin pérdida de datos.

### 2.1 Columnas en tablas Core (vinculación rápida)
Agregar columna nullable indexada `woo_id INTEGER`:
- `contactos.woo_id`
- `producto_plantillas.woo_id` (+ `woo_sync_activo INTEGER DEFAULT 0`)
- `productos.woo_id`
- `ventas.woo_id`

### 2.2 Tablas dedicadas de WooCommerce
| Tabla | Propósito | Campos clave |
| :--- | :--- | :--- |
| **`woo_config`** | Credenciales y reglas de negocio | `store_url`, `consumer_key`, `consumer_secret`, `webhook_secret`, `meta_key_dni` (default `'billing_dni'`), `ubicacion_stock_id` (depósito fuente), `lista_precio_normal_id` (nullable = precio base/default), `lista_precio_oferta_id` (nullable = sin oferta), `cuenta_cobro_default_id` (fallback), `punto_venta_default`, `auto_crear_clientes`, `auto_crear_productos`, `auto_crear_ventas`, `auto_confirmar_ventas`, `auto_crear_cobros`, `auto_facturar_afip`, `sync_stock_auto`, `sync_precios_auto`, `activo` |
| **`woo_clientes`** | Espejo de clientes Woo | `woo_id` (UNIQUE), `email`, `nombre`, `apellido`, `dni` (extraído de `meta_key_dni`), `telefono`, `direccion`, `ciudad`, `jurisdiccion_letra`, `codigo_postal`, `contacto_id` (FK `contactos`), `raw_json`, `synced_at` |
| **`woo_productos`** | Espejo de productos y variaciones | `woo_id` (UNIQUE), `woo_parent_id`, `tipo` (`simple`/`variable`/`variation`), `sku`, `nombre`, `regular_price`, `sale_price`, `sale_start`, `sale_end`, `manage_stock`, `stock_quantity`, `stock_status`, `plantilla_id`, `producto_id`, `ultimo_hash`, `synced_at` |
| **`woo_pedidos`** | Espejo de pedidos Woo | `woo_id` (UNIQUE), `numero_woo`, `estado_woo`, `fecha_woo`, `fecha_pago`, `woo_cliente_id`, `dni`, `metodo_envio_woo_id`, `metodo_pago_woo_id`, `subtotal`, `descuento_total`, `envio_total`, `total`, `moneda`, `venta_id` (FK `ventas`), `cobro_id` (FK `cobros`), `raw_json`, `synced_at` |
| **`woo_cupones`** | Catálogo de cupones Woo | `woo_id` (UNIQUE), `code`, `discount_type` (`percent`/`fixed_cart`/`fixed_product`), `amount`, `date_expires`, `usage_count`, `usage_limit`, `activo`, `synced_at` |
| **`woo_descuentos`** | Descuentos aplicados por pedido | `woo_pedido_id` (FK `woo_pedidos`), `woo_cupon_id` (nullable), `code`, `tipo`, `monto`, `monto_iva` |
| **`woo_metodos_envio`** | Métodos y zonas de envío | `woo_instance_id` (UNIQUE), `method_id`, `titulo`, `zona_nombre`, `costo_defecto`, `producto_servicio_id` (FK opcional a `productos` para facturar envío), `activo` |
| **`woo_metodos_pago`** | Pasarelas de pago Woo → Tesorería | `woo_gateway_id` (UNIQUE, ej. `woo-mercado-pago-basic`, `bacs`, `cod`), `titulo`, `metodo_pago_id` (FK `metodos_pago`), `cuenta_id` (FK `cuentas`, ej. MercadoPago/Banco/Caja), `activo` |
| **`woo_sync_logs`** | Auditoría e idempotencia | `origen` (`manual`/`webhook`), `topic`, `delivery_id`, `entidad`, `woo_id`, `direccion` (`in`/`out`), `estado` (`ok`/`error`/`ignorado`), `detalle`, `created_at` |

---

## 3. Reglas de Mapeo e Idempotencia

### 3.1 Resolución por `woo_id` y Fallbacks
1. **Clientes**: buscar en `woo_clientes` por `woo_id` → si no existe, buscar en `contactos` por `woo_id`, luego por `dni` (desde `meta_key_dni`, normalizando puntos/guiones) y luego por `email`. Si `auto_crear_clientes = 1`, crea el registro en `contactos` y guarda su `woo_id`.
2. **Campo Meta DNI configurable**:
   - En `woo_config.meta_key_dni` se configura el `key` exacto del `meta_data` de WooCommerce (por defecto `billing_dni`, editable a `_billing_dni`, `billing_cuit`, etc.).
   - El parser busca en `order.meta_data` y `customer.meta_data` la primera entrada cuyo `key === config.meta_key_dni`.
3. **Jurisdicciones**:
   - `billing.state` / `shipping.state` (ej. `'B'`, `'C'`) se busca en `jurisdicciones.letra` para asignar `jurisdiccion_codigo` en `contactos` y `ventas`.
4. **Productos y Variaciones**:
   - Buscar por `woo_id` en `woo_productos` / `productos` / `producto_plantillas`.
   - Fallback por `sku` exacto si `woo_id` aún no estaba vinculado.
   - Si `auto_crear_productos = 1` y no existe localmente: crea `producto_plantillas` + variantes en `productos` (para `variable` + `variations`) o producto simple.
5. **Pedidos Woo → Ventas (`ventas`) y Cobros (`cobros`)**:
   - Al ingresar un pedido (`woo_pedidos`):
     - Resuelve cliente (`woo_clientes` → `contactos`).
     - Registra cupones usados en `woo_cupones` (si no existen) y cada línea de `coupon_lines` en `woo_descuentos`.
     - Registra/vincula `shipping_lines` en `woo_metodos_envio` (sumando la línea de envío usando `producto_servicio_id` si está mapeado).
     - Registra/vincula `payment_method` en `woo_metodos_pago`.
     - Si `auto_crear_ventas = 1`: crea o actualiza la `venta` vinculada por `woo_id` vía `ventaService.createVenta()` usando `resolveNumeroDocumento()`:
       - `pending` / `on-hold` → estado `Presupuesto` (o `Borrador`).
       - `processing` / `completed` → estado `Confirmada` (si `auto_confirmar_ventas = 1`, dispara salida de stock en `operacionStockService` desde `ubicacion_stock_id`).
       - `cancelled` / `refunded` / `failed` → actualiza estado / registra anulación según corresponda.
     - **Cobro automático**: si la venta quedó `Confirmada`, el pedido tiene `date_paid` (o estado `processing`/`completed`), `auto_crear_cobros = 1` y `woo_pedidos.cobro_id` es nulo:
       - Busca el mapeo en `woo_metodos_pago` por `payment_method` (fallback a `cuenta_cobro_default_id`).
       - Crea el cobro vía `tesoreriaService.createCobro()` imputando el total a la `venta` y guarda `woo_pedidos.cobro_id`.

---

## 4. Sincronización Manual (Importación / Exportación)

### 4.1 Importación Manual (WooCommerce → Sistema)
En la pantalla **Comercial → WooCommerce**, solapa **Sincronización Manual**:
- **Importar Métodos de Envío**: `GET /wp-json/wc/v3/shipping/zones` + `/zones/:id/methods` → puebla `woo_metodos_envio`.
- **Importar Métodos de Pago (Pasarelas)**: `GET /wp-json/wc/v3/payment_gateways` → puebla `woo_metodos_pago` (solo lectura de gateways para mapearlos en la UI).
- **Importar Cupones**: `GET /wp-json/wc/v3/coupons` (paginado `per_page=100`) → puebla `woo_cupones`.
- **Importar Clientes**: `GET /wp-json/wc/v3/customers` → puebla `woo_clientes` y vincula/crea `contactos`.
- **Importar Productos**: `GET /wp-json/wc/v3/products` + `/products/:id/variations` → puebla `woo_productos` y vincula/crea plantillas/variantes.
- **Importar Pedidos (Ventas)**: `GET /wp-json/wc/v3/orders` (filtrable por `after` / `status`) → puebla `woo_pedidos`, `woo_descuentos` y dispara creación automática de `ventas` / `cobros` si está habilitada.

### 4.2 Exportación y Sincronización Saliente (Sistema → WooCommerce)
1. **Exportación de Productos**:
   - Permite seleccionar plantillas/variantes desde el sistema y publicarlas en WooCommerce (`POST /products` o `PUT /products/:id` si ya tiene `woo_id`).
   - Si la plantilla tiene atributos/variantes, crea el producto padre como `type: 'variable'` y luego las variaciones vía `POST /products/:parentId/variations/batch`, guardando cada `woo_id` en `producto_plantillas`, `productos` y `woo_productos`.
2. **Sincronización de Stock (Sistema → WooCommerce)**:
   - Calcula el stock disponible real desde `stock_quants` para el depósito configurado en `woo_config.ubicacion_stock_id` (`SUM(cantidad - reservado)`, piso `0`).
   - Envía actualizaciones por lote (`POST /products/batch` y `POST /products/:parentId/variations/batch`) con `manage_stock: true` y `stock_quantity`.
   - Modo **Manual** (botón "Sincronizar Stock ahora") y modo **Automático** (`sync_stock_auto = 1`: hook tras confirmar una `operacion_stock` en `operacionStockService.js` que afecte la ubicación configurada).
3. **Sincronización de Precios (Listas de Precios: Normal y Oferta)**:
   - Resolución usando `lista_precio_items` / `listas_precios`:
     - **`regular_price`** ← precio resuelto con `woo_config.lista_precio_normal_id` (si no se configura una lista, usa la lista marcada `es_default = 1` o `productos.precio`).
     - **`sale_price`** ← si `woo_config.lista_precio_oferta_id` está configurada y el producto/plantilla tiene precio resultante `> 0` y `< regular_price`, envía `String(precioOferta)`; de lo contrario envía `""` (en WooCommerce REST API, string vacío quita la oferta activa).

---

## 5. Sincronización Automática mediante Webhooks

### 5.1 Endpoints y Cambios en HTTP (`src/routes/http.js` y `src/routes/api.js`)
- **Raw Body en `src/routes/http.js`**:
  - Agregar `parseRawBody(req, maxBytes = 2e6)` acumulando `Buffer.concat(chunks)` en bytes exactos (sin concatenar strings UTF-8 que pueden romper firmas HMAC con acentos/caracteres multibyte).
- **Despacho público antes del gate de sesión en `src/routes/api.js`**:
  - Junto a `handlePublicAuthRoutes(req, res, pathname)` (antes de `authSvc.getSessionUser(req)`), despachar `handlePublicWooWebhookRoutes(req, res, pathname)` para `POST /api/woo/webhooks/:topic`.
- **Validación de seguridad**:
  1. Leer `rawBuffer = await parseRawBody(req)`.
  2. Calcular `HMAC-SHA256(rawBuffer, woo_config.webhook_secret)` en Base64.
  3. Comparar con `req.headers['x-wc-webhook-signature']` usando `crypto.timingSafeEqual`. Si no coincide, responder `401 Unauthorized`.
  4. Si llega el ping inicial de WooCommerce al registrar el webhook (sin header `x-wc-webhook-topic` o body `webhook_id=...`), responder `200 OK` inmediatamente.
- **Respuesta rápida e idempotencia**:
  - Responder `200 OK` en `< 1s` para evitar timeouts de WooCommerce (5 fallos consecutivos desactivan el webhook en Woo).
  - Verificar `X-WC-Webhook-Delivery-ID` en `woo_sync_logs` para ignorar entregas duplicadas.

### 5.2 Topics soportados en WooCommerce
En **WooCommerce → Ajustes → Avanzado → Webhooks** (estado **Activo**, versión **WP REST API Integration v3**):

| Nombre sugerido | Topic | URL de entrega |
| :--- | :--- | :--- |
| Vanguard — Pedido creado | `order.created` | `https://<tu-dominio>/api/woo/webhooks/order.created` |
| Vanguard — Pedido actualizado | `order.updated` | `https://<tu-dominio>/api/woo/webhooks/order.updated` |
| Vanguard — Producto creado | `product.created` | `https://<tu-dominio>/api/woo/webhooks/product.created` |
| Vanguard — Producto actualizado | `product.updated` | `https://<tu-dominio>/api/woo/webhooks/product.updated` |
| Vanguard — Cliente creado/act. | `customer.updated` | `https://<tu-dominio>/api/woo/webhooks/customer.updated` |
| Vanguard — Cupón actualizado | `coupon.updated` | `https://<tu-dominio>/api/woo/webhooks/coupon.updated` |

> [!TIP]
> Incluir un botón **"Registrar Webhooks automáticamente"** en la pestaña Configuración que llame a `POST /wp-json/wc/v3/webhooks` con las URLs y el `webhook_secret` configurado.

---

## 6. Requisitos de Red, Despliegue y Configuración

1. **HTTPS público con certificado válido**: obligatorio para recibir webhooks desde WooCommerce en producción. Opciones:
   - Reverse Proxy (**Nginx** o **Caddy** con Let's Encrypt) en VPS/cloud, o
   - **Cloudflare Tunnel (`cloudflared`)** si corre en servidor local/on-premise sin abrir puertos del router.
2. **Conectividad saliente**: el servidor Node debe alcanzar `store_url/wp-json/wc/v3/*` por HTTPS (revisar reglas de Cloudflare/Wordfence/iThemes en WordPress).
3. **Permisos WordPress / WooCommerce**:
   - Clave REST API con permisos **Lectura/Escritura** (`Read/Write`) de un usuario Administrador.
   - Permalinks de WordPress distintos de *Simple* (ej. *Nombre de la entrada*).
4. **Resiliencia ante cortes**: si el servidor local estuvo apagado, ejecutar una sincronización incremental (`modified_after` = último `synced_at`) al reiniciar o desde el botón de sincronización manual.
5. **Multi-base (`databases`)**: todas las tablas `woo_*` viven dentro de cada base SQLite activa, permitiendo conectar una base de staging a un WooCommerce de pruebas.

---

## 7. Mapa Exacto de Archivos a Crear / Modificar

### Backend (`src/`)
1. `src/db/models.js`: definir las 9 tablas `woo_*` y agregar `woo_id` / `woo_sync_activo` a `contactos`, `producto_plantillas`, `productos`, `ventas`.
2. `src/db/schema.js`: `ensureColumn` para las columnas nuevas en bases existentes.
3. `src/routes/http.js`: agregar `parseRawBody(req, maxBytes)`.
4. `src/routes/api.js`:
   - Despachar `handlePublicWooWebhookRoutes` antes del gate de sesión.
   - Proteger `/api/woo/config` con `sistema.config` y `/api/woo/*` con `comercial.ver` (`GET`) / `comercial.editar` (`POST`/`PUT`/`DELETE`).
   - Despachar `handleWooRoutes(req, res, pathname, user)`.
5. `src/services/comercial/wooService.js` *(nuevo)*: cliente REST v3 (`fetch` nativo), validador HMAC, parsers de `meta_key_dni` y `jurisdicciones.letra`, importadores, exportadores, sync de stock (`stock_quants`) y precios (`listas_precios`), creación de `ventas` y `cobros`.
6. `src/routes/wooRoutes.js` *(nuevo)*: endpoints públicos de webhooks y endpoints privados de config, sync manual y consultas de tablas espejo.
7. `src/services/inventario/operacionStockService.js`: hook no bloqueante tras confirmar operación de stock para sincronizar stock a Woo cuando `sync_stock_auto = 1`.
8. `src/services/comercial/jsonExchangeService.js`: contemplar `woo_id` en import/export JSON de `productos` y `contactos` (Regla 6).

### Frontend (`public/`)
1. `public/lib/appShell.js`: agregar `{ href: '/woo', label: 'WooCommerce', perm: 'comercial.ver' }` dentro de `NAV_GROUPS` (`comercial`).
2. `public/app.js`: registrar `addRoute('/woo', () => renderWooView(), 'comercial.ver')`.
3. `public/views/comercial/wooView.js` *(nuevo)* con pestañas:
   - **Pedidos** (`woo_pedidos` con enlace a `venta` y `cobro`) — `renderDataTable()`
   - **Productos** (`woo_productos` + sync manual stock/precios/exportación) — `renderDataTable()`
   - **Clientes** (`woo_clientes`) — `renderDataTable()`
   - **Cupones y Descuentos** (`woo_cupones`, `woo_descuentos`) — `renderDataTable()`
   - **Métodos de Envío** (`woo_metodos_envio` mapeando `producto_servicio_id`) — `renderSpreadsheetTable()` (Regla 5)
   - **Métodos de Pago** (`woo_metodos_pago` mapeando `metodo_pago_id` y `cuenta_id`) — `renderSpreadsheetTable()` (Regla 5)
   - **Configuración & Webhooks** (`woo_config`, listas de precios normal/oferta, `meta_key_dni`, depósito, toggles automáticos, botón registrar webhooks) + **Logs** (`woo_sync_logs`)
4. `public/styles.css`: cualquier estilo adicional requerido por `wooView.js` (cero `style="..."` inline, sin emojis).
