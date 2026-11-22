# Vanguard — ERP & MES Industrial para PyMEs

**Vanguard** es un sistema integral de planificación de recursos empresariales (**ERP**) y ejecución de manufactura (**MES**) diseñado para PyMEs industriales y comerciales en Argentina.

Construido sobre **Node.js puro y SQLite nativo (`node:sqlite`)**, sin frameworks pesados ni dependencias externas críticas, priorizando velocidad operativa en red local, trazabilidad contable de partida doble, cumplimiento normativo **ARCA (ex AFIP)** y despliegue **Cero Exposición** en servidores de oficina.

---

## Características Principales

### 1. Manufactura y Ejecución de Producción (MES)
- **Ingeniería de Producto:** Fichas técnicas y recetas multinivel con insumos, mano de obra, etapas productivas, mermas e historial de costos.
- **Curvas de Talles y Variantes:** Gestión matricial de variantes (talle, color, material) sobre plantillas de producto.
- **Órdenes de Producción por Etapas:** Seguimiento en taller con control de consumo de materiales, avances parciales, control de calidad y abastecimiento automático de faltantes mediante Órdenes de Compra.

### 2. Inventario y Trazabilidad Física
- **Contabilidad de Existencias (`stock_quants`):** Stock calculado exclusivamente a partir de movimientos inmutables (`movimientos_stock`), sin edición directa de saldos.
- **Multi-Depósito y Ubicaciones Virtuales:** Depósitos físicos, ubicaciones de producción, clientes, proveedores y ajustes.
- **Lotes y Backorders:** Trazabilidad por número de lote, reservas de stock, recepciones parciales con generación automática de backorders y proyección de faltantes.

### 3. Circuito Comercial y E-Commerce
- **Ventas y Compras:** Presupuestos, Órdenes de Compra, Facturas, Remitos (letras `R` con CAI y `X`), Notas de Crédito vinculadas con devolución automática de stock e imputación en cuenta corriente.
- **Costo de Mercadería Vendida (CMV):** Generación y reversión automática de asientos de CMV al confirmar o anular entregas.
- **Listas de Precios y Condiciones Comerciales:** Tarifas por cliente/proveedor, descuentos, recargos, fletes y métodos de pago.
- **Integración WooCommerce (Cero Exposición):** Sincronización bidireccional mediante worker de polling saliente (sin abrir puertos ni exponer el servidor a internet), mapeo por `woo_id`, extracción configurable de DNI (`meta_key_dni`) y publicación de stock y precios normal/oferta.

### 4. Contabilidad, Tesorería, Activos Fijos y Nómina
- **Contabilidad de Partida Doble:** Plan de cuentas configurable (RI, Monotributo, Exento), asientos automáticos desacoplados por eventos de dominio, imputaciones N-a-N, diferencia de cambio multimoneda, conciliación bancaria y cierre de ejercicio.
- **Tesorería y Cartera de Cheques:** Gestión de cajas, bancos, transferencias, cobros, pagos y ciclo completo de cheques físicos/eCheqs (en cartera, depositados, endosados, rechazados y propios diferidos) con flujo de caja proyectado.
- **Activos Fijos (Bienes de Uso):** Alta patrimonial, cálculo y asiento consolidado de amortizaciones mensuales y baja de bienes.
- **Nómina y Sueldos (Argentina):** Padrón de empleados, liquidación mensual con topes previsionales vigentes, devengamiento contable por sector (Producción vs. Administración), emisión de recibos legales (Art. 140 LCT) y exportación posicional TXT para **Libro de Sueldos Digital (ARCA)** y papel de trabajo **F.931**.

### 5. Localización Fiscal Argentina (ARCA / AFIP)
- **Facturación Electrónica (WSAA / WSFEv1 / WSCDC):** Firma criptográfica CMS/PKCS#7, caché de tickets de acceso, solicitud de CAE, validación de matriz Emisor × Receptor, leyendas RG 5003/21 y código QR fiscal en comprobantes.
- **Impuestos y Libros Digitales:** Cálculo de retenciones y percepciones (IIBB / Ganancias / IVA), certificados de retención en PDF y exportación para **Libro IVA Digital**, **SICORE** y **SIFERE**.

### 6. Motor PDF Nativo e Intercambio de Datos
- **Generación PDF sin dependencias externas:** Motor propio (`PdfDocument`) con soporte de formatos `A4`/`A5`, modo económico, paginación multipágina, códigos QR y encabezados/pies institucionales unificados para comprobantes y reportes.
- **Importación y Exportación:** Carga masiva atómica desde CSV, intercambio JSON round-trip entre bases y exportación directa desde grillas.

---

## Arquitectura Técnica

Vanguard sigue una arquitectura **Orientada a Objetos (POO)** con separación estricta de responsabilidades:

```text
vanguard/
├── server.js                 # Servidor HTTP nativo, workers en segundo plano y ciclo de vida
├── src/
│   ├── core/                 # Núcleo ORM (BaseRepository, QueryBuilder), StateMachine, EventBus, Logger
│   ├── db/                   # SSOT de esquema (models.js), migraciones idempotentes (schema.js) y seed.js
│   ├── routes/               # Enrutamiento HTTP, autenticación por cookie firmada y control RBAC
│   └── services/             # Lógica de dominio desacoplada por módulo
│       ├── afip/             # Criptografía CMS, WSAA/WSFEv1, Libro IVA Digital y Libro Sueldos Digital
│       ├── comercial/        # Ventas, Compras, Órdenes de Compra, Precios, WooCommerce e Import/Export
│       ├── config/           # Configuración de empresa, puntos de venta y secuencias documentales
│       ├── finanzas/         # Contabilidad, Tesorería, Cheques, Activos Fijos y Nómina
│       ├── inventario/       # Operaciones de stock, reservas, lotes y proyecciones
│       ├── print/            # Motor PDF nativo, codificador QR y plantillas estandarizadas
│       ├── produccion/       # Recetas, curvas, presupuestos y órdenes de producción
│       └── tareas/           # Gestión operativa de tareas internas
├── public/                   # Frontend SPA Vanilla JS (grillas tipo hoja de cálculo, vistas y estilos)
└── tests/                    # Suite automatizada con node:test (73+ tests unitarios, integración y arquitectura)