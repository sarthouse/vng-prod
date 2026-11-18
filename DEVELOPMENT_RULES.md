# Reglas de Desarrollo — Vanguard Production

## 1. SSOT (Single Source of Truth)
- **Esquema de base de datos**: Todo modelo, columna, restricción, índice y vista se define exclusivamente en `src/db/models.js` (`MODELS` y `VIEWS`).
- `src/core/schemaBuilder.js` genera los `CREATE TABLE`, `ALTER TABLE` y validaciones a partir de `MODELS`. Prohibido duplicar DDL manualmente en servicios.
- **Reglas fiscales y constantes**: Centralizar en `src/services/afip/fiscalRules.js` y `public/lib/comprobantesAr.js`.

## 2. ORM Obligatorio (`BaseRepository` y `QueryBuilder`)
- **Prohibido `db.prepare(...)` fuera de `src/core/` (`BaseRepository.js`, `QueryBuilder.js`, `schemaBuilder.js`) y `src/db/schema.js`**.
- Todo acceso a datos en `src/services/**` debe hacerse a través de:
  - `new BaseRepository({ model: MODELS.<tabla> })` para CRUD, transacciones (`repo.transaction(...)`), `findById`, `findWhere`, `create`, `update`, `delete`.
  - `repo.query('alias')` (`QueryBuilder`) para `select`, `leftJoin`, `innerJoin`, `where`, `whereIn`, `whereNull`, `groupBy`, `orderBy`, `limit`, `count`, `sum`.
- Si un query necesita un operador o cláusula que `QueryBuilder` no soporta, extender `QueryBuilder.js` (con validación de identificadores) antes que escribir SQL crudo en un servicio.

## 3. SOLID y DRY
- **SRP (Single Responsibility)**:
  - `src/routes/*.js`: solo parseo HTTP, autorización y respuesta JSON/PDF; sin lógica de negocio ni queries.
  - `src/services/<dominio>/*Service.js`: reglas de negocio puras del dominio.
  - `src/services/print/*.js`: únicamente maquetación PDF sobre `PdfDocument` (`pdfBuilder.js`).
- **OCP / LSP / DIP**:
  - Los servicios de dominio principales deben poder recibir repositorios inyectables en su constructor (como `ContactoService`, `AsientoService`, `InventarioBaseService`) para permitir tests unitarios sin SQLite.
- **DRY**:
  - Reutilizar helpers compartidos (`documentoComercialHelper.js`, `public/lib/format.js`, `public/lib/autocomplete.js`, `public/lib/remitoPrint.js`).

## 4. Modularización
- **Backend**:
  - `src/core/`: ORM, logger, schemaBuilder.
  - `src/db/`: conexión, `models.js` (SSOT), `schema.js` (migraciones), `seed.js`.
  - `src/services/{afip,auth,comercial,config,finanzas,inventario,print,produccion}/`.
  - `src/routes/`: enrutadores por módulo.
- **Frontend (`public/`)**:
  - `public/lib/engine/`: motores reutilizables (`pageEngine.js`, `detailEngine.js`, `tableEngine.js`, `formEngine.js`, `modalEngine.js`, `ganttEngine.js`). **Prohibido** crear modales ad-hoc o `alert`/`confirm` nativos fuera de `modalEngine.js`.
  - `public/lib/`: utilidades compartidas (`api.js`, `format.js`, `autocomplete.js`, `remitoPrint.js`, `metaPanel.js`, `comprobantesAr.js`).
  - `public/views/<modulo>/`: vistas modulares por dominio.

## 5. Verificación Obligatoria
- Ejecutar `node --check <archivo>` sobre todo JS modificado.
- Ejecutar `node --test` y verificar que toda la suite pase sin errores antes de cerrar una tarea.
