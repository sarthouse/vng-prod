<div align="center">
  <img src=".github/assets/logo.svg" alt="Vanguard — ERP & MES Industrial" width="560" />

  <h3>Sistema integral de gestión empresarial (ERP) y control de producción (MES) para PyMEs argentinas</h3>

  <p>
    <img src="https://img.shields.io/badge/Estado-En%20desarrollo%20(v0.1.0)-orange?style=flat-square" alt="En desarrollo" />
    <img src="https://img.shields.io/badge/Licencia-GPL--3.0-blue?style=flat-square" alt="GPL-3.0" />
    <img src="https://img.shields.io/badge/Node.js-22.5%2B%20%7C%2024-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js" />
    <img src="https://img.shields.io/badge/SQLite-Nativo%20(node%3Asqlite)-003B57?style=flat-square&logo=sqlite&logoColor=white" alt="SQLite Nativo" />
    <img src="https://img.shields.io/badge/Dependencias-Cero%20externas-2B6CB0?style=flat-square" alt="Zero Dependencies" />
    <img src="https://img.shields.io/badge/Fiscal-ARCA%20(ex%20AFIP)-FFC241?style=flat-square&labelColor=0F1F2A" alt="ARCA / AFIP" />
    <img src="https://img.shields.io/badge/Despliegue-Local%20%2F%20Cero%20Exposici%C3%B3n-0F1F2A?style=flat-square" alt="Cero Exposición" />
  </p>

  <blockquote>
    <strong>Nota:</strong> El proyecto se encuentra actualmente en <strong>desarrollo activo (v0.1.0)</strong>. Las funcionalidades y esquemas pueden evolucionar antes de alcanzar la versión <code>1.0</code>.
  </blockquote>

  <p>
    <a href="#-qu%C3%A9-es-vanguard">¿Qué es Vanguard?</a> •
    <a href="#-m%C3%B3dulos-principales">Módulos</a> •
    <a href="#-inicio-r%C3%A1pido">Inicio Rápido</a> •
    <a href="#%EF%B8%8F-arquitectura-y-estructura">Arquitectura</a> •
    <a href="#-documentaci%C3%B3n-t%C3%A9cnica">Documentación</a>
  </p>
</div>

---

## 💡 ¿Qué es Vanguard?

**Vanguard** unifica en una sola plataforma la **producción en taller (MES)**, el **stock**, las **ventas y compras**, la **contabilidad**, los **sueldos** y la **facturación electrónica ante ARCA (ex AFIP)**.

Está pensado para PyMEs industriales y comerciales de Argentina que necesitan un sistema rápido en red local, sin depender de la nube ni pagar licencias por usuario.

| Pilar | Qué significa en la práctica |
| :--- | :--- |
| ⚡ **Sin dependencias pesadas** | Funciona con **Node.js puro** y **SQLite nativo** (`node:sqlite`), sin frameworks externos ni motores de base de datos aparte. |
| 🔒 **Cero Exposición** | Corre en un servidor de oficina o red local. Incluso la sincronización con **WooCommerce** se hace de forma saliente, sin abrir puertos a internet. |
| 🇦🇷 **100% Adaptado a Argentina** | Facturación electrónica (CAE), códigos QR fiscales, retenciones/percepciones, Libro IVA Digital, Libro de Sueldos Digital y recibos LCT. |
| 📒 **Contabilidad Automática** | Cada venta, compra, cobro, pago o entrega de mercadería genera sus asientos de partida doble y trazabilidad de stock sin carga manual doble. |

---

## 🧩 Módulos Principales

### 1. 🏭 Manufactura y Producción (MES)
- **Recetas y Fichas Técnicas:** Estructuras multinivel con insumos, mano de obra, etapas productivas, mermas e historial de costos.
- **Curvas de Talles y Variantes:** Gestión matricial de combinaciones (talle, color, material) sobre plantillas de producto.
- **Órdenes de Producción por Etapas:** Seguimiento en taller con consumo de materiales, avances parciales, control de calidad y generación automática de Órdenes de Compra ante faltantes.

### 2. 📦 Inventario y Trazabilidad Física
- **Stock Inmutable (`stock_quants`):** Las existencias se calculan únicamente a partir de movimientos registrados (`movimientos_stock`), sin edición directa de saldos.
- **Multi-Depósito:** Depósitos físicos, ubicaciones de producción, clientes, proveedores y ajustes.
- **Lotes y Backorders:** Trazabilidad por lote, reservas de mercadería, recepciones parciales con generación de backorders y proyección de faltantes.

### 3. 🛒 Circuito Comercial y E-Commerce
- **Ventas y Compras:** Presupuestos, Órdenes de Compra, Facturas, Remitos (`R` con CAI y `X`) y Notas de Crédito vinculadas con devolución automática de stock e imputación en cuenta corriente.
- **Costo de Mercadería Vendida (CMV):** Asientos automáticos de CMV al confirmar o anular entregas.
- **Listas de Precios:** Tarifas por cliente/proveedor, descuentos, recargos, fletes y medios de pago.
- **Integración WooCommerce:** Sincronización bidireccional mediante worker saliente (sin exponer el servidor), mapeo por `woo_id`, extracción configurable de DNI (`meta_key_dni`) y publicación de stock y precios normal/oferta.

### 4. 💰 Contabilidad, Tesorería, Activos Fijos y Nómina
- **Contabilidad de Partida Doble:** Plan de cuentas configurable (RI, Monotributo, Exento), asientos desacoplados por eventos de dominio, imputaciones N-a-N, diferencia de cambio multimoneda, conciliación bancaria y cierre de ejercicio.
- **Tesorería y Cartera de Cheques:** Cajas, bancos, transferencias, cobros, pagos y ciclo completo de cheques físicos/eCheqs (en cartera, depositados, endosados, rechazados y propios diferidos) con flujo de caja proyectado.
- **Activos Fijos (Bienes de Uso):** Alta patrimonial, cálculo y asiento consolidado de amortizaciones mensuales y baja de bienes.
- **Nómina y Sueldos (Argentina):** Padrón de empleados, liquidación mensual con topes previsionales, devengamiento contable por sector (Producción vs. Administración), recibos legales (Art. 140 LCT) y exportación TXT para **Libro de Sueldos Digital (ARCA)** y papel de trabajo **F.931**.

### 5. 🧾 Localización Fiscal Argentina (ARCA / AFIP)
- **Facturación Electrónica (`WSAA` / `WSFEv1` / `WSCDC`):** Firma criptográfica CMS/PKCS#7, caché de tickets de acceso, solicitud de CAE, validación de matriz Emisor × Receptor, leyendas RG 5003/21 y código QR fiscal.
- **Impuestos y Libros Digitales:** Cálculo de retenciones y percepciones (IIBB / Ganancias / IVA), certificados de retención en PDF y exportación para **Libro IVA Digital**, **SICORE** y **SIFERE**.

### 6. 📄 Motor PDF Nativo e Intercambio de Datos
- **Generación PDF sin librerías externas:** Motor propio (`PdfDocument`) con soporte `A4`/`A5`, modo económico, paginación multipágina, códigos QR y encabezados/pies institucionales unificados.
- **Importación y Exportación:** Carga masiva atómica desde CSV, intercambio JSON round-trip entre bases y exportación directa desde grillas.

---

## 🚀 Inicio Rápido

### Requisitos
- **Node.js `22.5+`** (recomendado **Node.js 24 LTS**) con soporte nativo para `node:sqlite`.
- No requiere instalar PostgreSQL, MySQL ni dependencias `npm` externas.

### Puesta en marcha

1. **Clonar el repositorio:**
   ```bash
   git clone https://github.com/sarthouse/vng-prod.git
   cd vng-prod
   ```

2. **Configurar las variables de entorno:**
   ```bash
   cp .env.example .env
   ```
   Editá `.env` y definí valores seguros para `SECRET_TOKEN` y `DB_MASTER_KEY`.

3. **Iniciar el servidor:**
   ```bash
   npm start
   ```
   Por defecto quedará disponible en **`http://localhost:3000`**.

4. **Ejecutar la suite de tests:**
   ```bash
   npm test
   ```

<details>
<summary>⚙️ Variables de entorno principales (<code>.env.example</code>)</summary>

| Variable | Descripción | Valor por defecto |
| :--- | :--- | :--- |
| `PORT` | Puerto HTTP del servidor | `3000` |
| `ALLOWED_HOSTS` | Hosts permitidos separados por coma (`*` en desarrollo) | `localhost,127.0.0.1` |
| `SECRET_TOKEN` | Secreto HMAC para firmar cookies de sesión y tokens internos | *(obligatorio cambiar)* |
| `DB_MASTER_KEY` | Clave maestra para administrar instancias de base de datos | *(obligatorio cambiar)* |
| `DEFAULT_DB` | Nombre de la base SQLite por defecto en `./db/<nombre>.sqlite` | `database` |
| `COOKIE_SECURE` | Activar en `true` si corre detrás de HTTPS | `false` |
| `LOG_LEVEL` | Nivel de logs (`info`, `warn`, `error`, `debug`) | `info` |

</details>

---

## 🏗️ Arquitectura y Estructura

Vanguard sigue una arquitectura **Orientada a Objetos (POO)** con separación estricta de responsabilidades entre rutas HTTP, servicios de dominio, eventos y persistencia:

```text
vng-prod/
├── server.js                 # Servidor HTTP nativo, workers en segundo plano y ciclo de vida
├── src/
│   ├── core/                 # Núcleo ORM (BaseRepository, QueryBuilder), StateMachine, EventBus, Logger
│   ├── db/                   # SSOT de esquema (models.js), migraciones idempotentes (schema.js) y seed.js
│   ├── routes/               # Enrutamiento HTTP, autenticación por cookie firmada y control RBAC
│   └── services/             # Lógica de dominio desacoplada por módulo
│       ├── afip/             # Criptografía CMS, WSAA/WSFEv1, Libro IVA Digital y Libro Sueldos Digital
│       ├── auth/             # Autenticación, sesiones y permisos
│       ├── comercial/        # Ventas, Compras, Órdenes de Compra, Precios, WooCommerce e Import/Export
│       ├── config/           # Configuración de empresa, puntos de venta y secuencias documentales
│       ├── finanzas/         # Contabilidad, Tesorería, Cheques, Activos Fijos y Nómina
│       ├── inventario/       # Operaciones de stock, reservas, lotes y proyecciones
│       ├── print/            # Motor PDF nativo, codificador QR y plantillas estandarizadas
│       ├── produccion/       # Recetas, curvas, presupuestos y órdenes de producción
│       ├── rrhh/             # Padrón de empleados y liquidación de sueldos
│       └── tareas/           # Gestión operativa de tareas internas
├── public/                   # Frontend SPA Vanilla JS (grillas tipo hoja de cálculo, vistas y estilos)
├── utils/                    # Utilidades compartidas
└── tests/                    # Suite automatizada con node:test (tests unitarios, integración y arquitectura)
```

---

## 📚 Documentación Técnica

- [**Arquitectura y Flujos**](ARQUITECTURA_Y_FLUJOS.md) — Detalle de flujos operativos, eventos de dominio y modelo de datos.
- [**Reglas de Desarrollo**](DEVELOPMENT_RULES.md) — Convenciones de código, patrones de repositorio y buenas prácticas del proyecto.

---

## 📄 Licencia

Este proyecto se distribuye bajo la licencia **GNU General Public License v3.0 (GPL-3.0)**. Consultá el archivo [LICENSE](LICENSE) para más detalles.
