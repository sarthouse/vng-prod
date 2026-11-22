import { api, toast } from '../../lib/api.js';
import { esc, exportRowsToCSV, renderProvinciaOptions, setupFileDropzones, formatDocumento, bindDocumentoInput } from '../../lib/format.js';
import { renderSeguridadSection } from './seguridadSection.js';
import { showConfirmModal, renderSpreadsheetTable } from '../../lib/engine/index.js';

let activeConfigTab = 'empresa';

function parseCsvText(text) {
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const delim = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const splitLine = (line) => {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === delim && !inQ) {
        out.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };
  const headers = splitLine(lines[0]).map(h => h.toLowerCase().trim());
  return lines.slice(1).map(line => {
    const vals = splitLine(line);
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = vals[idx] ?? ''; });
    return obj;
  });
}

export async function renderConfigView() {
  const root = document.getElementById('app-view');
  const [config, puntosVenta, secuencias, afip, planCuentas] = await Promise.all([
    api('/api/config'),
    api('/api/puntos-venta'),
    api('/api/secuencias').catch(() => []),
    api('/api/afip/config').catch(() => null),
    api('/api/tesoreria/plan-cuentas').catch(() => []),
  ]);
  const empresa = config.empresa || {};
  const impuestos = config.impuestos || [];
  const cuentasImputables = (planCuentas || []).filter(c => Number(c.activo) !== 0 && Number(c.imputable) !== 0);
  const ctaOptions = (selectedId, fallbackLabel) => [
    `<option value="">-- Estándar (${esc(fallbackLabel)}) --</option>`,
    ...cuentasImputables.map(c => `<option value="${c.id}" ${Number(selectedId) === Number(c.id) ? 'selected' : ''}>${esc(c.codigo)} · ${esc(c.nombre)}</option>`),
  ].join('');

  const tabs = [
    { id: 'empresa', label: 'Empresa y Fiscal' },
    { id: 'cuentas_contables', label: 'Cuentas Contables' },
    { id: 'importacion', label: 'Importación / Exportación' },
    { id: 'seguridad', label: 'Usuarios y Permisos' },
  ];
  if (!tabs.some(t => t.id === activeConfigTab)) activeConfigTab = 'empresa';

  root.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Configuración</h1>
        <p class="muted">Empresa, puntos de venta, secuencias de numeración, importación CSV y seguridad.</p>
      </div>
    </div>

    <div class="config-tabs" role="tablist">
      ${tabs.map(t => `
        <button type="button" class="config-tab ${activeConfigTab === t.id ? 'active' : ''}" data-config-tab="${t.id}" role="tab" aria-selected="${activeConfigTab === t.id}">
          ${t.label}
        </button>
      `).join('')}
    </div>

    <section class="config-tab-panel ${activeConfigTab === 'empresa' ? 'active' : ''}" data-config-panel="empresa">
    <div class="card">
      <div class="card-header">
        <div>
          <h2>Empresa y Parámetros Fiscales</h2>
        </div>
      </div>
      <form id="form-empresa" class="form-grid">
        <label>
          <span>Razón Social</span>
          <input type="text" name="razon_social" value="${esc(empresa.razon_social || '')}" placeholder="Ej: Mi Empresa SRL" />
        </label>
        <label>
          <span>Nombre de Fantasía</span>
          <input type="text" name="nombre_fantasia" value="${esc(empresa.nombre_fantasia || '')}" placeholder="Ej: Nombre comercial" />
        </label>
        <label>
          <span>CUIT</span>
          <input type="text" name="cuit" value="${esc(empresa.cuit || '')}" placeholder="30-12345678-9" />
        </label>
        <label>
          <span>Condición frente al IVA</span>
          <select name="condicion_iva">
            ${['Responsable Inscripto', 'Monotributo', 'Exento', 'Consumidor Final'].map(c =>
              `<option value="${c}" ${(empresa.condicion_iva || 'Responsable Inscripto') === c ? 'selected' : ''}>${c}</option>`
            ).join('')}
          </select>
        </label>
        <label>
          <span>Dirección</span>
          <input type="text" name="direccion" value="${esc(empresa.direccion || '')}" placeholder="Calle, altura, piso/depto" />
        </label>
        <label>
          <span>Localidad</span>
          <input type="text" name="localidad" value="${esc(empresa.localidad || '')}" placeholder="Ej: CABA / Avellaneda" />
        </label>
        <label>
          <span>Provincia</span>
          <select name="provincia">
            ${renderProvinciaOptions(empresa.provincia)}
          </select>
        </label>
        <label>
          <span>Código Postal (CP)</span>
          <input type="text" name="codigo_postal" value="${esc(empresa.codigo_postal || '')}" placeholder="Ej: 1406" />
        </label>
        <label>
          <span>País</span>
          <input type="text" name="pais" value="${esc(empresa.pais || 'Argentina')}" placeholder="Argentina" />
        </label>
        <label>
          <span>Teléfono</span>
          <input type="text" name="telefono" value="${esc(empresa.telefono || '')}" />
        </label>
        <label>
          <span>Email</span>
          <input type="email" name="email" value="${esc(empresa.email || '')}" />
        </label>
        <label>
          <span>Ingresos Brutos (IIBB)</span>
          <input type="text" name="iibb" value="${esc(empresa.iibb || '')}" placeholder="Ej: 901-123456-7 o Exento" />
        </label>
        <label>
          <span>Inicio de Actividades</span>
          <input type="date" name="inicio_actividades" value="${esc(empresa.inicio_actividades || '')}" />
        </label>
        <label>
          <span>IVA Compras por Defecto</span>
          <select name="alicuota_iva_compras_defecto">
            ${(() => {
              const curVal = Number(empresa.alicuota_iva_compras_defecto ?? empresa.alicuota_iva_defecto ?? 21);
              const opts = (impuestos || []).filter(i => i.activo !== 0 && i.tipo === 'iva' && (i.aplica_a === 'compras' || i.aplica_a === 'ambos'));
              const html = opts.map(i => {
                const rate = Number(i.alicuota_defecto);
                return `<option value="${rate}" ${rate === curVal ? 'selected' : ''}>${esc(i.nombre)} (${rate}%)</option>`;
              });
              if (!opts.some(i => Number(i.alicuota_defecto) === curVal)) {
                html.push(`<option value="${curVal}" selected>IVA ${curVal}%</option>`);
              }
              return html.join('');
            })()}
          </select>
        </label>
        <label>
          <span>IVA Ventas por Defecto</span>
          <select name="alicuota_iva_ventas_defecto">
            ${(() => {
              const curVal = Number(empresa.alicuota_iva_ventas_defecto ?? empresa.alicuota_iva_defecto ?? 21);
              const opts = (impuestos || []).filter(i => i.activo !== 0 && i.tipo === 'iva' && (i.aplica_a === 'ventas' || i.aplica_a === 'ambos'));
              const html = opts.map(i => {
                const rate = Number(i.alicuota_defecto);
                return `<option value="${rate}" ${rate === curVal ? 'selected' : ''}>${esc(i.nombre)} (${rate}%)</option>`;
              });
              if (!opts.some(i => Number(i.alicuota_defecto) === curVal)) {
                html.push(`<option value="${curVal}" selected>IVA ${curVal}%</option>`);
              }
              return html.join('');
            })()}
          </select>
        </label>
        <label>
          <span>Días Entrega por Defecto (Lead Time)</span>
          <input type="number" min="1" name="dias_entrega_defecto" value="${Number(empresa.dias_entrega_defecto ?? 7)}" />
        </label>
        <label>
          <span>Formato PDF por Defecto</span>
          <select name="print_formato">
            ${[
              { v: 'A4', l: 'A4 (210 × 297 mm)' },
              { v: 'A5', l: 'A5 (148 × 210 mm)' },
              { v: 'ticket80', l: 'Ticket Térmico 80mm' },
              { v: 'ticket58', l: 'Ticket Térmico 58mm' },
            ].map(o => `<option value="${o.v}" ${(empresa.print_formato || 'A4') === o.v ? 'selected' : ''}>${o.l}</option>`).join('')}
          </select>
        </label>
        <label>
          <span>Copias por Defecto</span>
          <select name="print_copias">
            ${[
              { v: 'original', l: 'Solo Original' },
              { v: 'duplicado', l: 'Original + Duplicado' },
              { v: 'triplicado', l: 'Original + Duplicado + Triplicado' },
            ].map(o => `<option value="${o.v}" ${(empresa.print_copias || 'original') === o.v ? 'selected' : ''}>${o.l}</option>`).join('')}
          </select>
        </label>
        <label class="full">
          <span>Pie / Leyenda fija en comprobantes</span>
          <input type="text" name="print_pie_comprobante" value="${esc(empresa.print_pie_comprobante || '')}" placeholder="Ej: Alias: MI.EMPRESA.MP · Los cambios se realizan dentro de los 15 días." />
        </label>
        <label>
          <span>Últ. Depósito LCT (Período)</span>
          <input type="text" name="lct_ultimo_deposito_periodo" value="${esc(empresa.lct_ultimo_deposito_periodo || '')}" placeholder="Ej: 2026-10" />
        </label>
        <label>
          <span>Últ. Depósito LCT (Fecha)</span>
          <input type="date" name="lct_ultimo_deposito_fecha" value="${esc(empresa.lct_ultimo_deposito_fecha || '')}" />
        </label>
        <label>
          <span>Últ. Depósito LCT (Banco)</span>
          <input type="text" name="lct_ultimo_deposito_banco" value="${esc(empresa.lct_ultimo_deposito_banco || '')}" placeholder="Ej: Banco Nación" />
        </label>
        <div class="full sx-0db129">
          <label class="checkbox-field"><input type="checkbox" name="print_mostrar_logo" ${Number(empresa.print_mostrar_logo ?? 1) === 1 ? 'checked' : ''} /> <span>Mostrar logo en comprobantes</span></label>
          <label class="checkbox-field"><input type="checkbox" name="print_modo_economico" ${Number(empresa.print_modo_economico ?? 0) === 1 ? 'checked' : ''} /> <span>Modo tinta económico (B/N sin rellenos)</span></label>
        </div>
        <div class="full sx-03a722">
          <div id="empresa-logo-preview" class="sx-332390">
            ${empresa.logo_data && String(empresa.logo_data).startsWith('data:image/')
              ? `<img src="${esc(empresa.logo_data)}" alt="Logo empresa" class="sx-60bb2c" />`
              : '<span class="muted text-2xs">Sin logo</span>'}
          </div>
          <div class="sx-39cc94">
            <div class="sx-1299a6">Logo de Empresa (para PDFs y Remitos)</div>
            <div class="sx-36eedc">
              <input type="file" id="empresa-logo-file" accept="image/png,image/jpeg,image/webp,image/svg+xml" />
              <button type="button" class="btn btn-sm" id="btn-clear-logo">Quitar Logo</button>
            </div>
            <p class="muted sx-58980f">PNG, JPG, WebP o SVG. Se optimiza automáticamente para impresión.</p>
          </div>
          <input type="hidden" name="logo_data" id="empresa-logo-data" value="${esc(empresa.logo_data || '')}" />
        </div>
        <div class="full modal-footer">
          <button type="submit" class="btn btn-primary">Guardar Configuración de Empresa</button>
        </div>
      </form>
    </div>

    <div class="card">
      <div class="card-header">
        <div>
          <h2>Puntos de Venta</h2>
          <p class="muted text-sm">Formato fiscal estándar: <code>{prefijo} {puntoventa}-{comprobante}</code> (ej. <code>FA 0001-00000001</code>). Click en una celda para editar o completá la fila inferior.</p>
        </div>
      </div>
      <div id="pv-sheet-host"></div>
    </div>

    ${afip ? `
    <div class="card">
      <div class="card-header sx-4ad709">
        <div>
          <h2>Facturación Electrónica y Padrón (AFIP / ARCA)</h2>
          <p class="muted text-sm">Generá tu clave privada y CSR para subir a AFIP, cargá el certificado <code>.crt</code> y operá con WSFEv1 y Padrón A5.</p>
        </div>
        <span class="badge ${afip.entorno === 'produccion' ? 'badge-ok' : 'badge-parcial'}">${afip.entorno === 'produccion' ? 'Producción' : 'Homologación (Testing)'}</span>
      </div>

      <div class="form-grid mb-lg">
        <label>
          <span>Entorno AFIP</span>
          <select id="afip-entorno">
            <option value="homologacion" ${afip.entorno === 'homologacion' ? 'selected' : ''}>Homologación (Testing)</option>
            <option value="produccion" ${afip.entorno === 'produccion' ? 'selected' : ''}>Producción</option>
          </select>
        </label>
        <label>
          <span>Nombre / Alias del Certificado (CN)</span>
          <input type="text" id="afip-cn" value="vanguard" placeholder="vanguard" />
        </label>
        <div class="full sx-49587d">
          <button type="button" class="btn btn-primary" id="btn-afip-gen-keys">Generar Clave Privada y CSR</button>
          <button type="button" class="btn" id="btn-afip-dl-csr" ${afip.tiene_csr ? '' : 'disabled'}>Descargar solicitud (.csr)</button>
          <button type="button" class="btn" id="btn-afip-test-wsfe">Probar Conexión WSFE</button>
          <span class="muted text-sm">
            ${afip.tiene_key ? 'Clave RSA 2048 guardada.' : 'Sin clave generada.'}
            ${afip.tiene_csr ? ' CSR listo para descargar.' : ''}
          </span>
        </div>
      </div>

      <div class="section-divider">
        <div class="flex-between mb-md">
          <strong>Certificado X.509 emitido por AFIP (.crt)</strong>
          ${afip.cert_info
            ? `<span class="badge ${afip.cert_info.vigente ? 'badge-ok' : 'badge-danger'}">${afip.cert_info.vigente ? 'Vigente' : 'Vencido'} · Vence: ${esc(afip.cert_info.validTo)}</span>`
            : `<span class="badge badge-muted">Sin certificado cargado</span>`}
        </div>
        ${afip.cert_info ? `<p class="text-sm-muted mb-md">${esc(afip.cert_info.subject)} · Serie: <code>${esc(afip.cert_info.serialNumber)}</code></p>` : ''}
        <div class="cert-upload-row">
          <input type="file" id="afip-crt-file" accept=".crt,.pem,.cer" />
          <button type="button" class="btn btn-primary" id="btn-afip-save-crt" disabled>Guardar Certificado (.crt)</button>
        </div>
        <div id="afip-crt-status" class="text-sm-muted">Seleccioná un archivo de certificado X.509 (.crt, .pem o .cer).</div>
      </div>
    </div>
    ` : ''}

    <div class="card">
      <div class="card-header">
        <div>
          <h2>Secuencias de Numeración</h2>
          <p class="muted text-sm">Prefijos, sufijos, relleno (padding), próximo número y dominio para cada tipo de documento.</p>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nombre</th>
              <th>Dominio</th>
              <th>Prefijo</th>
              <th>Sufijo</th>
              <th class="w-90">Padding</th>
              <th class="sx-1a3055">Próx. Nº</th>
              <th>Usa PV</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${secuencias.map(seq => `
              <tr data-seq-row="${seq.id}">
                <td><code>${esc(seq.codigo)}</code></td>
                <td><input type="text" class="seq-nombre input-sm" value="${esc(seq.nombre)}" /></td>
                <td>
                  <select class="seq-dominio input-sm">
                    ${['general', 'compras', 'ventas', 'inventario', 'produccion', 'tesoreria'].map(d =>
                      `<option value="${d}" ${seq.dominio === d ? 'selected' : ''}>${d}</option>`
                    ).join('')}
                  </select>
                </td>
                <td><input type="text" class="seq-prefijo input-sm w-85" value="${esc(seq.prefijo)}" /></td>
                <td><input type="text" class="seq-sufijo input-sm sx-65e62e" value="${esc(seq.sufijo)}" /></td>
                <td><input type="number" min="1" max="12" class="seq-padding input-sm w-70" value="${seq.padding}" /></td>
                <td><input type="number" min="1" class="seq-next input-sm w-90" value="${seq.siguiente_numero}" /></td>
                <td><input type="checkbox" class="seq-pv" ${seq.usa_punto_venta ? 'checked' : ''} /></td>
                <td><button type="button" class="btn btn-sm btn-primary" data-save-seq="${seq.id}">Guardar</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    </section>

    <section class="config-tab-panel ${activeConfigTab === 'cuentas_contables' ? 'active' : ''}" data-config-panel="cuentas_contables">
      <div class="card">
        <div class="card-header">
          <div>
            <h2>Cuentas Contables por Defecto</h2>
            <span class="muted text-md">Cuentas utilizadas automáticamente en asientos de ventas, compras, impuestos y etapas de producción cuando no hay una cuenta específica en el ítem o diario.</span>
          </div>
        </div>
        <form id="form-cuentas-defecto" class="form-grid">
          <label>
            <span>Clientes / Deudores por Ventas</span>
            <select name="cta_clientes_id">${ctaOptions(empresa.cta_clientes_id, '1.1.03')}</select>
          </label>
          <label>
            <span>Proveedores</span>
            <select name="cta_proveedores_id">${ctaOptions(empresa.cta_proveedores_id, '2.1.01')}</select>
          </label>
          <label>
            <span>Ventas por Defecto</span>
            <select name="cta_ventas_id">${ctaOptions(empresa.cta_ventas_id, '4.1.01')}</select>
          </label>
          <label>
            <span>Compras / Costo Mercadería por Defecto</span>
            <select name="cta_compras_id">${ctaOptions(empresa.cta_compras_id, '5.1.01')}</select>
          </label>
          <label>
            <span>Mano de Obra / Talleres (Etapas Producción)</span>
            <select name="cta_mano_obra_id">${ctaOptions(empresa.cta_mano_obra_id, '5.1.02')}</select>
          </label>
          <label>
            <span>IVA Crédito Fiscal</span>
            <select name="cta_iva_credito_id">${ctaOptions(empresa.cta_iva_credito_id, '1.1.04')}</select>
          </label>
          <label>
            <span>IVA Débito Fiscal</span>
            <select name="cta_iva_debito_id">${ctaOptions(empresa.cta_iva_debito_id, '2.1.02')}</select>
          </label>
          <label>
            <span>Percepciones y Retenciones Sufridas</span>
            <select name="cta_perc_sufridas_id">${ctaOptions(empresa.cta_perc_sufridas_id, '1.1.05')}</select>
          </label>
          <label>
            <span>Percepciones / Retenciones a Depositar</span>
            <select name="cta_ret_depositar_id">${ctaOptions(empresa.cta_ret_depositar_id, '2.1.03')}</select>
          </label>
          <div class="full modal-footer">
            <button type="submit" class="btn btn-primary">Guardar Cuentas por Defecto</button>
          </div>
        </form>
      </div>
    </section>

    <section class="config-tab-panel ${activeConfigTab === 'importacion' ? 'active' : ''}" data-config-panel="importacion">
    <div class="card">
      <div class="card-header">
        <div>
          <h2>Importación Masiva de Datos</h2>
          <p class="muted text-sm">Importá contactos (clientes, proveedores o talleres) y productos desde un archivo CSV. Columnas separadas por coma o punto y coma.</p>
        </div>
      </div>
      <div class="card-body">
        <div class="sx-1e4e90">
          <div class="sx-89030c">
            <div class="sx-cea59b">
              <strong>Importar Contactos</strong>
              <button type="button" id="btn-tpl-cont" class="btn btn-sm">Descargar Plantilla CSV</button>
            </div>
            <p class="muted sx-7b0e4e">Columnas: <code>nombre, razon_social, cuit, condicion_iva, es_cliente, es_proveedor, es_taller, telefono, email, direccion, localidad, provincia, observaciones</code></p>
            <input type="file" id="file-imp-cont" accept=".csv,text/csv" />
            <div id="status-imp-cont" class="muted sx-f6314d">Ningún archivo seleccionado.</div>
            <div class="sx-1c2c18">
              <button type="button" id="btn-imp-cont" class="btn btn-primary btn-sm">Importar Contactos</button>
            </div>
          </div>
          <div class="sx-89030c">
            <div class="sx-cea59b">
              <strong>Importar Productos</strong>
              <button type="button" id="btn-tpl-prod" class="btn btn-sm">Descargar Plantilla CSV</button>
            </div>
            <p class="muted sx-7b0e4e">Columnas: <code>codigo, nombre, descripcion, se_fabrica, se_compra, tipo, categoria, proveedor, udm, precio, alicuota_iva, stock, stock_minimo, minimo_compra</code></p>
            <input type="file" id="file-imp-prod" accept=".csv,text/csv" />
            <div id="status-imp-prod" class="muted sx-f6314d">Ningún archivo seleccionado.</div>
            <div class="sx-1c2c18">
              <button type="button" id="btn-imp-prod" class="btn btn-primary btn-sm">Importar Productos</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="card mt-md">
      <div class="card-header">
        <div>
          <h2>Motor JSON (Importar / Exportar con Plantillas)</h2>
          <p class="muted text-sm">Ideal para estructuras con relaciones (Recetas, Productos con variantes, Plan de Cuentas, Contactos, Categorías y Variantes).</p>
        </div>
      </div>
      <div class="form-grid">
        <label>
          <span>Entidad</span>
          <select id="json-ex-entidad">
            <option value="recetas">Recetas (BoM)</option>
            <option value="productos">Productos (Plantillas y Variantes)</option>
            <option value="contactos">Contactos</option>
            <option value="cuentas_contables">Plan de Cuentas</option>
            <option value="categorias">Categorías</option>
            <option value="variantes">Variantes</option>
          </select>
        </label>
        <label>
          <span>Modo al importar</span>
          <select id="json-ex-mode">
            <option value="upsert">Crear y actualizar existentes (Upsert)</option>
            <option value="skip_existing">Solo crear nuevos (omitir existentes)</option>
          </select>
        </label>
        <div class="full flex-row-md">
          <button type="button" id="btn-json-export" class="btn">Exportar JSON</button>
          <button type="button" id="btn-json-template" class="btn">Descargar Plantilla JSON</button>
        </div>
        <div class="full">
          <input type="file" id="file-json-import" accept=".json,application/json" />
          <div id="status-json-import" class="text-sm-muted mt-sm">Ningún archivo JSON seleccionado.</div>
        </div>
        <div class="full">
          <button type="button" id="btn-json-import" class="btn btn-primary" disabled>Importar JSON</button>
        </div>
      </div>
    </div>

    </section>

    <section class="config-tab-panel ${activeConfigTab === 'seguridad' ? 'active' : ''}" data-config-panel="seguridad">
      <div id="config-seguridad-root"></div>
    </section>
  `;

  root.querySelectorAll('[data-config-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeConfigTab = btn.dataset.configTab;
      root.querySelectorAll('[data-config-tab]').forEach(b => {
        const isActive = b.dataset.configTab === activeConfigTab;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-selected', String(isActive));
      });
      root.querySelectorAll('[data-config-panel]').forEach(p => {
        p.classList.toggle('active', p.dataset.configPanel === activeConfigTab);
      });
    });
  });

  renderSeguridadSection(root.querySelector('#config-seguridad-root'));

  const logoFileEl = root.querySelector('#empresa-logo-file');
  const logoDataEl = root.querySelector('#empresa-logo-data');
  const logoPreviewEl = root.querySelector('#empresa-logo-preview');
  const renderLogoPreview = (src) => {
    logoPreviewEl.innerHTML = src
      ? `<img src="${esc(src)}" alt="Logo empresa" class="sx-60bb2c" />`
      : '<span class="muted text-2xs">Sin logo</span>';
  };
  logoFileEl?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      if (file.type === 'image/svg+xml') {
        logoDataEl.value = result;
        renderLogoPreview(result);
        return;
      }
      const img = new Image();
      img.onload = () => {
        const maxSide = 360;
        const scale = Math.min(1, maxSide / Math.max(img.width || 1, img.height || 1));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const out = canvas.toDataURL('image/png');
        logoDataEl.value = out;
        renderLogoPreview(out);
      };
      img.src = result;
    };
    reader.readAsDataURL(file);
  });
  root.querySelector('#btn-clear-logo')?.addEventListener('click', () => {
    logoDataEl.value = '';
    if (logoFileEl) logoFileEl.value = '';
    renderLogoPreview('');
  });

  root.querySelector('#form-cuentas-defecto')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const numOrNull = (k) => (fd.get(k) ? Number(fd.get(k)) : null);
    try {
      await api('/api/empresa', {
        method: 'PUT',
        body: JSON.stringify({
          cta_clientes_id: numOrNull('cta_clientes_id'),
          cta_proveedores_id: numOrNull('cta_proveedores_id'),
          cta_ventas_id: numOrNull('cta_ventas_id'),
          cta_compras_id: numOrNull('cta_compras_id'),
          cta_mano_obra_id: numOrNull('cta_mano_obra_id'),
          cta_iva_credito_id: numOrNull('cta_iva_credito_id'),
          cta_iva_debito_id: numOrNull('cta_iva_debito_id'),
          cta_perc_sufridas_id: numOrNull('cta_perc_sufridas_id'),
          cta_ret_depositar_id: numOrNull('cta_ret_depositar_id'),
        }),
      });
      toast('Cuentas contables por defecto guardadas');
      await renderConfigView();
    } catch (err) {
      toast(err.message, true);
    }
  });

  const formEmpresa = root.querySelector('#form-empresa');
  bindDocumentoInput(formEmpresa?.querySelector('input[name="cuit"]'), 'CUIT');

  formEmpresa.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/empresa', {
        method: 'PUT',
        body: JSON.stringify({
          razon_social: fd.get('razon_social'),
          nombre_fantasia: fd.get('nombre_fantasia'),
          cuit: formatDocumento(fd.get('cuit'), 'CUIT'),
          condicion_iva: fd.get('condicion_iva'),
          direccion: fd.get('direccion'),
          localidad: fd.get('localidad'),
          provincia: fd.get('provincia'),
          codigo_postal: fd.get('codigo_postal') ?? '',
          pais: fd.get('pais') || 'Argentina',
          telefono: fd.get('telefono'),
          email: fd.get('email'),
          iibb: fd.get('iibb') ?? '',
          inicio_actividades: fd.get('inicio_actividades') ?? '',
          alicuota_iva_compras_defecto: fd.get('alicuota_iva_compras_defecto') !== null ? Number(fd.get('alicuota_iva_compras_defecto')) : 21,
          alicuota_iva_ventas_defecto: fd.get('alicuota_iva_ventas_defecto') !== null ? Number(fd.get('alicuota_iva_ventas_defecto')) : 21,
          dias_entrega_defecto: Number(fd.get('dias_entrega_defecto')) || 7,
          print_formato: fd.get('print_formato') || 'A4',
          print_copias: fd.get('print_copias') || 'original',
          print_pie_comprobante: fd.get('print_pie_comprobante') ?? '',
          lct_ultimo_deposito_periodo: fd.get('lct_ultimo_deposito_periodo') ?? '',
          lct_ultimo_deposito_fecha: fd.get('lct_ultimo_deposito_fecha') ?? '',
          lct_ultimo_deposito_banco: fd.get('lct_ultimo_deposito_banco') ?? '',
          print_mostrar_logo: fd.get('print_mostrar_logo') === 'on' ? 1 : 0,
          print_modo_economico: fd.get('print_modo_economico') === 'on' ? 1 : 0,
          logo_data: fd.get('logo_data') ?? '',
        }),
      });
      toast('Configuración de empresa guardada');
      await renderConfigView();
    } catch (err) {
      toast(err.message, true);
    }
  });

  renderSpreadsheetTable(root.querySelector('#pv-sheet-host'), {
    rows: puntosVenta,
    emptyText: 'No hay puntos de venta configurados.',
    compact: true,
    defaultNewRow: () => ({
      numero: '',
      nombre: '',
      es_default: 0,
      es_electronica: 0,
      cai: '',
      cai_vto: '',
      activo: 1,
    }),
    onCreateRow: async ({ row }) => {
      if (!Number(row.numero) || !String(row.nombre || '').trim()) return false;
      try {
        const res = await api('/api/puntos-venta', {
          method: 'POST',
          body: JSON.stringify({
            numero: Number(row.numero),
            nombre: String(row.nombre).trim(),
            es_default: Boolean(Number(row.es_default)),
            es_electronica: Boolean(Number(row.es_electronica)),
            cai: String(row.cai || '').trim(),
            cai_vto: String(row.cai_vto || '').trim(),
          }),
        });
        if (res?.id) row.id = res.id;
        toast('Punto de venta agregado');
        if (Number(row.es_default)) {
          await renderConfigView();
          return false;
        }
        return true;
      } catch (err) {
        toast(err.message, true);
        throw err;
      }
    },
    columns: [
      {
        key: 'numero',
        label: 'Punto',
        type: 'number',
        min: 1,
        max: 9999,
        nowrap: true,
        parse: v => Number(v) || 0,
        render: pv => (pv.numero ? `<strong>${String(pv.numero).padStart(4, '0')}</strong>` : '<span class="muted">Ej: 1</span>'),
      },
      {
        key: 'nombre',
        label: 'Nombre',
        type: 'text',
        parse: v => String(v || '').trim(),
        render: pv => (pv.nombre ? esc(pv.nombre) : '<span class="muted">Nuevo punto de venta...</span>'),
      },
      {
        key: 'es_default',
        label: 'Por defecto',
        type: 'checkbox',
        align: 'center',
        getValue: pv => (pv.es_default ? 1 : 0),
      },
      {
        key: 'es_electronica',
        label: 'Electrónica (WSFE)',
        type: 'checkbox',
        align: 'center',
        getValue: pv => (pv.es_electronica ? 1 : 0),
      },
      {
        key: 'cai',
        label: 'CAI Remito R',
        type: 'text',
        width: 130,
      },
      {
        key: 'cai_vto',
        label: 'Vto CAI',
        type: 'text',
        width: 100,
      },
      {
        key: 'activo',
        label: 'Activo',
        type: 'checkbox',
        align: 'center',
        getValue: pv => (pv.activo !== 0 ? 1 : 0),
      },
    ],
    onCellChange: async ({ row, key, value }) => {
      try {
        await api(`/api/puntos-venta/${row.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            numero: key === 'numero' ? Number(value) : Number(row.numero),
            nombre: key === 'nombre' ? value : row.nombre,
            es_default: key === 'es_default' ? Boolean(Number(value)) : Boolean(row.es_default),
            es_electronica: key === 'es_electronica' ? Boolean(Number(value)) : Boolean(row.es_electronica),
            cai: key === 'cai' ? String(value || '').trim() : (row.cai || ''),
            cai_vto: key === 'cai_vto' ? String(value || '').trim() : (row.cai_vto || ''),
            activo: key === 'activo' ? Boolean(Number(value)) : Boolean(row.activo !== 0),
          }),
        });
        toast('Punto de venta actualizado');
        if (key === 'es_default' && Number(value) === 1) {
          await renderConfigView();
        }
      } catch (err) {
        toast(err.message, true);
        throw err;
      }
    },
    onDeleteRow: async (pv) => {
      if (!(await showConfirmModal('¿Eliminar este punto de venta?'))) return;
      try {
        await api(`/api/puntos-venta/${pv.id}`, { method: 'DELETE' });
        toast('Punto de venta eliminado');
        await renderConfigView();
      } catch (err) {
        toast(err.message, true);
      }
    },
  });

  root.querySelector('#afip-entorno')?.addEventListener('change', async (e) => {
    try {
      await api('/api/afip/entorno', { method: 'PUT', body: JSON.stringify({ entorno: e.target.value }) });
      toast(`Entorno AFIP cambiado a ${e.target.value}`);
      await renderConfigView();
    } catch (err) { toast(err.message, true); }
  });
  root.querySelector('#btn-afip-gen-keys')?.addEventListener('click', async () => {
    if (afip?.tiene_key && !(await showConfirmModal('Ya existe una clave privada guardada. ¿Querés generar una nueva clave y CSR? Deberás tramitar un nuevo .crt en AFIP.'))) return;
    const cn = root.querySelector('#afip-cn')?.value?.trim() || 'vanguard';
    try {
      await api('/api/afip/generar-keys', { method: 'POST', body: JSON.stringify({ cn }) });
      toast('Clave RSA 2048 y CSR generados correctamente');
      await renderConfigView();
    } catch (err) { toast(err.message, true); }
  });
  root.querySelector('#btn-afip-dl-csr')?.addEventListener('click', () => {
    window.location.href = '/api/afip/csr/download';
  });
  let pendingAfipCrtPem = '';
  root.querySelector('#afip-crt-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    const statusEl = root.querySelector('#afip-crt-status');
    const saveBtn = root.querySelector('#btn-afip-save-crt');
    pendingAfipCrtPem = '';
    if (saveBtn) saveBtn.disabled = true;
    if (!file) {
      if (statusEl) {
        statusEl.textContent = 'Seleccioná un archivo de certificado X.509 (.crt, .pem o .cer).';
        statusEl.style.color = '';
      }
      return;
    }
    const extOk = /\.(crt|pem|cer)$/i.test(file.name);
    if (!extOk) {
      const msg = `Extensión inválida ("${file.name}"). Debe ser .crt, .pem o .cer.`;
      if (statusEl) { statusEl.textContent = msg; statusEl.style.color = 'var(--color-accent)'; }
      toast(msg, true);
      return;
    }
    if (file.size === 0 || file.size > 65536) {
      const msg = 'Tamaño de archivo inválido (máximo 64 KB).';
      if (statusEl) { statusEl.textContent = msg; statusEl.style.color = 'var(--color-accent)'; }
      toast(msg, true);
      return;
    }
    const txt = (await file.text()).trim();
    const hasPem = /-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/.test(txt);
    if (!hasPem) {
      const msg = `El archivo "${file.name}" no contiene un bloque X.509 PEM válido (BEGIN/END CERTIFICATE).`;
      if (statusEl) { statusEl.textContent = msg; statusEl.style.color = 'var(--color-accent)'; }
      toast(msg, true);
      return;
    }
    pendingAfipCrtPem = txt;
    if (saveBtn) saveBtn.disabled = false;
    if (statusEl) {
      statusEl.innerHTML = `Archivo validado: <strong>${esc(file.name)}</strong> (${file.size} bytes) — listo para guardar.`;
      statusEl.style.color = '#15803d';
    }
  });
  root.querySelector('#btn-afip-save-crt')?.addEventListener('click', async () => {
    if (!pendingAfipCrtPem) { toast('Seleccioná un archivo .crt/.pem/.cer válido primero', true); return; }
    try {
      await api('/api/afip/subir-crt', { method: 'POST', body: JSON.stringify({ crt: pendingAfipCrtPem }) });
      toast('Certificado AFIP guardado');
      await renderConfigView();
    } catch (err) { toast(err.message, true); }
  });
  root.querySelector('#btn-afip-test-wsfe')?.addEventListener('click', async () => {
    try {
      const res = await api('/api/afip/estado');
      const w = res.wsfe || {};
      toast(`WSFE (${res.entorno}): App=${w.appServer}, DB=${w.dbServer}, Auth=${w.authServer}`);
    } catch (err) { toast(err.message, true); }
  });

  root.querySelectorAll('[data-save-seq]').forEach(btn => btn.addEventListener('click', async () => {
    const row = root.querySelector(`[data-seq-row="${btn.dataset.saveSeq}"]`);
    try {
      await api(`/api/secuencias/${btn.dataset.saveSeq}`, {
        method: 'PUT',
        body: JSON.stringify({
          nombre: row.querySelector('.seq-nombre').value.trim(),
          dominio: row.querySelector('.seq-dominio').value,
          prefijo: row.querySelector('.seq-prefijo').value,
          sufijo: row.querySelector('.seq-sufijo').value,
          padding: Number(row.querySelector('.seq-padding').value) || 8,
          siguiente_numero: Number(row.querySelector('.seq-next').value) || 1,
          usa_punto_venta: row.querySelector('.seq-pv').checked,
        }),
      });
      toast('Secuencia actualizada');
      await renderConfigView();
    } catch (err) { toast(err.message, true); }
  }));

  root.querySelector('#btn-tpl-cont').addEventListener('click', () => {
    exportRowsToCSV(
      ['nombre', 'razon_social', 'tipo_documento', 'cuit', 'condicion_iva', 'jurisdiccion_codigo', 'es_cliente', 'es_proveedor', 'es_taller', 'telefono', 'email', 'direccion', 'localidad', 'provincia', 'codigo_postal', 'observaciones'],
      [
        ['Curtiembre Ejemplo', 'Curtiembre Ejemplo SA', 'CUIT', '30-11223344-5', 'Responsable Inscripto', '902', '0', '1', '0', '11-4455-6677', 'ventas@ejemplo.com', 'Av. Industrial 100', 'Avellaneda', 'Buenos Aires', '1870', ''],
        ['Taller Aparado Sur', '', 'CUIT', '20-22334455-6', 'Monotributo', '902', '0', '1', '1', '11-5566-7788', '', 'Calle 10 200', 'Lanús', 'Buenos Aires', '1824', ''],
        ['Zapatería Centro', 'Zapatería Centro SRL', 'CUIT', '30-12345678-9', 'Responsable Inscripto', '901', '1', '0', '0', '11-4455-6677', 'compras@ejemplo.com', 'Av. Principal 123', 'CABA', 'Ciudad Autónoma de Buenos Aires', '1000', 'Entrega martes y jueves'],
      ],
      'plantilla_contactos.csv'
    );
  });

  root.querySelector('#btn-tpl-prod').addEventListener('click', () => {
    exportRowsToCSV(
      ['codigo', 'nombre', 'descripcion', 'tipo', 'categoria', 'se_fabrica', 'se_compra', 'se_vende', 'requiere_lote', 'costo', 'precio', 'alicuota_iva', 'alicuota_iva_compra', 'udm', 'stock', 'stock_minimo', 'minimo_compra', 'proveedor'],
      [
        ['MOD-01', 'Bota Urbana Clásica', 'Producto fabricado en taller', 'almacenable', 'Calzado', '1', '0', '1', '1', '22000', '48000', '21', '21', 'pares', '0', '5', '0', ''],
        ['CUE-01', 'Cuero Vacuno Negro', 'Espesor 1.4mm', 'almacenable', 'Cueros', '0', '1', '0', '1', '12500', '12500', '21', '21', 'metros', '50', '10', '5', 'Curtiembre Ejemplo'],
        ['SRV-AP', 'Servicio de Aparado', 'Mano de obra', 'servicio', 'Mano de obra', '0', '1', '0', '0', '3800', '3800', '21', '21', 'unidades', '0', '0', '0', 'Taller Aparado Sur'],
      ],
      'plantilla_productos.csv'
    );
  });

  setupFileDropzones(root);

  const csvRows = { cont: [], prod: [] };
  const bindCsvFile = (fileId, statusId, key) => {
    root.querySelector(fileId)?.addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      const statusEl = root.querySelector(statusId);
      if (!f) {
        csvRows[key] = [];
        if (statusEl) statusEl.textContent = 'Ningún archivo seleccionado.';
        return;
      }
      const rows = parseCsvText(await f.text());
      csvRows[key] = rows;
      if (statusEl) {
        statusEl.innerHTML = rows.length
          ? `Archivo: <strong>${esc(f.name)}</strong> (${rows.length} filas listas para importar)`
          : `Archivo: <strong>${esc(f.name)}</strong> — sin filas válidas`;
      }
    });
  };
  bindCsvFile('#file-imp-cont', '#status-imp-cont', 'cont');
  bindCsvFile('#file-imp-prod', '#status-imp-prod', 'prod');

  root.querySelector('#btn-imp-cont').addEventListener('click', async () => {
    if (!csvRows.cont.length) return toast('Seleccioná un archivo CSV válido con encabezado y filas', true);
    try {
      const res = await api('/api/importar/contactos', { method: 'POST', body: { rows: csvRows.cont } });
      toast(`Contactos importados: ${res.created} creados, ${res.updated || 0} actualizados${res.errors?.length ? `, ${res.errors.length} errores` : ''}`);
    } catch (err) {
      toast(err.message, true);
    }
  });

  root.querySelector('#btn-imp-prod').addEventListener('click', async () => {
    if (!csvRows.prod.length) return toast('Seleccioná un archivo CSV válido con encabezado y filas', true);
    try {
      const res = await api('/api/importar/productos', { method: 'POST', body: { rows: csvRows.prod } });
      toast(`Productos importados: ${res.created} creados, ${res.updated || 0} actualizados${res.errors?.length ? `, ${res.errors.length} errores` : ''}`);
    } catch (err) {
      toast(err.message, true);
    }
  });

  const downloadJsonObj = (obj, filename) => {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  root.querySelector('#btn-json-export')?.addEventListener('click', async () => {
    const ent = root.querySelector('#json-ex-entidad')?.value || 'recetas';
    try {
      const data = await api(`/api/json/exportar/${encodeURIComponent(ent)}`);
      downloadJsonObj(data, `vanguard_${ent}_${new Date().toISOString().slice(0, 10)}.json`);
      toast(`Exportados ${data.count ?? data.items?.length ?? 0} registros de ${ent}`);
    } catch (err) {
      toast(err.message, true);
    }
  });

  root.querySelector('#btn-json-template')?.addEventListener('click', async () => {
    const ent = root.querySelector('#json-ex-entidad')?.value || 'recetas';
    try {
      const tpl = await api(`/api/json/plantilla/${encodeURIComponent(ent)}`);
      downloadJsonObj(tpl, `plantilla_${ent}.json`);
    } catch (err) {
      toast(err.message, true);
    }
  });

  let parsedJsonPayload = null;
  const jsonFileInp = root.querySelector('#file-json-import');
  const jsonStatusEl = root.querySelector('#status-json-import');
  const jsonImpBtn = root.querySelector('#btn-json-import');
  jsonFileInp?.addEventListener('change', async () => {
    const f = jsonFileInp.files?.[0];
    parsedJsonPayload = null;
    if (jsonImpBtn) jsonImpBtn.disabled = true;
    if (!f) {
      if (jsonStatusEl) jsonStatusEl.textContent = 'Ningún archivo JSON seleccionado.';
      return;
    }
    try {
      const obj = JSON.parse(await f.text());
      const count = Array.isArray(obj) ? obj.length : (Array.isArray(obj?.items) ? obj.items.length : 0);
      if (!count && !Array.isArray(obj) && !Array.isArray(obj?.items)) {
        throw new Error('El JSON debe ser un array o contener { "items": [...] }');
      }
      parsedJsonPayload = obj;
      if (obj?.entidad && root.querySelector(`#json-ex-entidad option[value="${obj.entidad}"]`)) {
        root.querySelector('#json-ex-entidad').value = obj.entidad;
      }
      if (jsonStatusEl) jsonStatusEl.innerHTML = `Archivo: <strong>${esc(f.name)}</strong> (${count} registros listos para importar)`;
      if (jsonImpBtn) jsonImpBtn.disabled = false;
    } catch (err) {
      if (jsonStatusEl) jsonStatusEl.innerHTML = `<span class="text-accent">${esc(err.message)}</span>`;
      toast(err.message, true);
    }
  });

  jsonImpBtn?.addEventListener('click', async () => {
    if (!parsedJsonPayload) return;
    const ent = root.querySelector('#json-ex-entidad')?.value || 'recetas';
    const mode = root.querySelector('#json-ex-mode')?.value || 'upsert';
    jsonImpBtn.disabled = true;
    try {
      const res = await api(`/api/json/importar/${encodeURIComponent(ent)}?mode=${encodeURIComponent(mode)}`, {
        method: 'POST',
        body: parsedJsonPayload,
      });
      const errMsg = res.errors?.length ? `, ${res.errors.length} errores (ej: ${res.errors[0].error})` : '';
      toast(`Importación ${ent}: ${res.created} creados, ${res.updated} actualizados, ${res.skipped} omitidos${errMsg}`);
      if (jsonStatusEl) {
        jsonStatusEl.innerHTML = `Resultado: <strong>${res.created} creados</strong> · <strong>${res.updated} actualizados</strong> · ${res.skipped} omitidos${res.errors?.length ? ` · <span class="text-accent">${res.errors.length} errores</span>` : ''}`;
      }
    } catch (err) {
      toast(err.message, true);
    } finally {
      jsonImpBtn.disabled = false;
    }
  });
}
