# Reglas de Desarrollo — Vanguard Production

## 1. SSOT (Single Source of Truth)
- **Esquema de base de datos**: Todo modelo, columna, restricción, índice y vista se define exclusivamente en `src/db/models.js` (`MODELS` y `VIEWS`).
- `src/core/schemaBuilder.js` genera los `CREATE TABLE`, `ALTER TABLE` y validaciones a partir de `MODELS`. Prohibido duplicar DDL manualmente en servicios.
- **Reglas fiscales y constantes**: Centralizar en `src/services/afip/fiscalRules.js` y `public/lib/comprobantesAr.js`.

## 2. ORM Obligatorio (`BaseRepository` y `QueryBuilder`)
- **Prohibido `db.prepare(...)` fuera de `src/core/` (`BaseRepository.js`, `QueryBuilder.js`, `schemaBuilder.js`) y `src/db/schema.js`**.
- Todo acceso a datos en `src/services/**` debe hacerse a través de:
  - `new BaseRepository({ model: MODELS.<tabla> })`:
    - Lectura: `find(id)` / `findById(id)`, `findOrFail(id, msg?)` (HTTP 404), `findBy(whereObj)`, `first(whereObj?)`, `findWhere(filters)`, `findAll()`, `pluck(col, whereObj?)`, `count(whereObj?)`, `exists(whereObj?)`.
    - Encadenamiento fluido: `repo.where(col, opOrVal, val?)`, `repo.whereIn(col, values)`, `repo.whereNull(col)`, `repo.whereNotNull(col)` retornan `QueryBuilder`.
    - Escritura y atomicidad: `validate(data, { partial })`, `create(data, actor)`, `update(id, data, actor)`, `delete(id)`, `findOrCreate(uniqueWhere, defaults, actor)`, `upsert(uniqueWhere, data, actor)`, `transaction(fn)` (con soporte automático de `SAVEPOINT`s anidados).
  - `repo.query('alias')` (`QueryBuilder`):
    - Joins y selección: `select(...)`, `leftJoin(...)`, `innerJoin(...)`, `groupBy(...)`, `orderBy(col, dir)`, `limit(n)`.
    - Filtros seguros (operadores whitelisteados `=`, `!=`, `<>`, `<`, `<=`, `>`, `>=`, `LIKE`, `NOT LIKE`, `IS`, `IS NOT`): `where(...)`, `orWhere(...)`, `whereIn(...)`, `whereNotIn(...)`, `whereNull(...)`, `whereNotNull(...)`, `whereBetween(col, [min, max])`.
    - Terminadores: `all()`, `get()` / `first()` (`LIMIT 1`, retorna objeto o `null`), `count(col?)`, `sum(col)`, `pluck(col)`, `exists()`, `insert(data)`, `update(data)`, `delete()`.
- Si un query necesita un operador o cláusula que `QueryBuilder` no soporta, extender `QueryBuilder.js` (con validación de identificadores) antes que escribir SQL crudo en un servicio.

## 3. SOLID y DRY
- **SRP (Single Responsibility)**:
  - `src/routes/*.js`: solo parseo HTTP, autorización y respuesta JSON/PDF; sin lógica de negocio ni queries.
  - `src/services/<dominio>/*Service.js`: reglas de negocio puras del dominio.
  - `src/services/print/*.js`: únicamente maquetación PDF sobre `PdfDocument` (`pdfBuilder.js`).
- **OCP / LSP / DIP**:
  - Los servicios de dominio principales deben poder recibir repositorios inyectables en su constructor (como `ContactoService`, `AsientoService`, `InventarioBaseService`) para permitir tests unitarios sin SQLite.
- **Patrón Facade + Helpers Especializados**:
  - Los servicios principales (`*Service.js` como `tesoreriaService.js`, `ventaService.js`, `compraService.js`, `produccionService.js`, `inventarioService.js`) actúan como **fachada pública (Facade / Barrel)** re-exportando su API hacia rutas y tests, y delegando responsabilidades internas cohesivas en `*Helper.js` o sub-servicios (`cuentasService.js`, `pagosService.js`, `cobrosService.js`, `ventaEfectosHelper.js`, `compraEfectosHelper.js`, `produccionStockHelper.js`, `produccionCierreHelper.js`, `stockQuantHelper.js`, `stockProyeccionHelper.js`) para evitar archivos monolíticos y preservar SSOT.
- **Integridad Transaccional / Documental**:
  - **Prohibido el borrado físico (`DELETE`)** de cualquier documento confirmado o anulado con impacto contable o de inventario (Ventas, Compras, Pagos, Cobros, Operaciones de Stock, Órdenes con movimientos/compras confirmadas). Toda reversión debe ejecutarse mediante anulación con contra-asiento y contra-movimiento.
  - **Transiciones declarativas (`stateMachine.js`)**: las transiciones válidas de estado deben declararse mediante `createStateMachine(...)` en `src/core/stateMachine.js`, bloqueando saltos inválidos (ej. `Anulada → Confirmado` o anular borradores) con errores 400 claros.
  - **Eventos de dominio síncronos (`eventBus.js` + `domainEvents.js`)**: los efectos secundarios cross-domain (ej. Ventas/Compras disparando Operaciones de Stock y Asientos) se desacoplan mediante `domainBus.emit(...)` dentro de `repo.transaction(...)`, ejecutándose de forma estrictamente síncrona y fail-fast dentro del mismo `SAVEPOINT`.
  - **Atomicidad obligatoria**: toda operación compuesta (creación, confirmación o anulación que impacte estado + líneas + stock + asiento contable) debe envolverse en un único bloque `repo.transaction(...)` (aprovechando los `SAVEPOINT`s re-entrantes de `BaseRepository`), propagando la transacción entre helpers y listeners para garantizar ejecución atómica (todo o nada).
- **DRY**:
  - Reutilizar helpers compartidos (`documentoComercialHelper.js`, `public/lib/format.js`, `public/lib/autocomplete.js`, `public/lib/remitoPrint.js`).

## 4. Modularización
- **Backend**:
  - `src/core/`: ORM, logger, schemaBuilder.
  - `src/db/`: conexión, `models.js` (SSOT), `schema.js` (migraciones), `seed.js`.
  - `src/services/{afip,auth,comercial,config,finanzas,inventario,print,produccion,tareas}/`: servicios Facade + sub-servicios y `*Helper.js` especializados por dominio.
  - `src/routes/`: enrutadores por módulo.
- **Frontend (`public/`)**:
  - `public/lib/engine/`: motores reutilizables (`pageEngine.js`, `detailEngine.js`, `tableEngine.js`, `formEngine.js`, `modalEngine.js`, `ganttEngine.js`). **Prohibido** crear modales ad-hoc o `alert`/`confirm` nativos fuera de `modalEngine.js`.
  - `public/lib/`: utilidades compartidas (`api.js`, `format.js`, `autocomplete.js`, `remitoPrint.js`, `metaPanel.js`, `comprobantesAr.js`).
  - `public/views/<modulo>/`: vistas modulares por dominio.

## 5. Seed e Inicialización Productiva (`src/db/seed.js`)
- **Idempotencia estricta y no-sobrescritura**: `seedBase(db)` inserta registros faltantes por clave natural (`codigo`, `nombre`) mediante `BaseRepository.validate()` + `BaseRepository.create()`, **sin sobrescribir** nombres, alícuotas ni configuraciones editadas por el usuario.
- **Separación Base vs. Demo**: `runSeeds(db)` ejecuta por defecto solo `seedBase(db)` (datos obligatorios de sistema). Los datos de ejemplo (`seedDemo(db)`) nunca se cargan automáticamente en bases productivas; requieren `{ includeDemo: true }`.
- **SSOT y cero saldos/stock directos**: `seed.js` consume `JURISDICCIONES_AR`, `PLAN_CUENTAS_TEMPLATES` y `MODELS` sin duplicar catálogos maestros ni escribir stock o saldos iniciales distintos de cero.
- **Orden topológico y atomicidad**: toda la inicialización corre dentro de una única transacción (`repo.transaction(...)`), cargando tablas independientes antes que las tablas con claves foráneas.

## 6. Verificación Obligatoria
- Ejecutar `node --check <archivo>` sobre todo JS modificado.
- Ejecutar `node --test` y verificar que toda la suite pase sin errores antes de cerrar una tarea.
