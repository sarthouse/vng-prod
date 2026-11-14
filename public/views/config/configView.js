import { api, toast } from '../../lib/api.js';
import { esc, downloadCSV, renderProvinciaOptions, setupFileDropzones } from '../../lib/format.js';
import { renderSeguridadSection } from './seguridadSection.js';
import { showConfirmModal } from '../../lib/modal.js';

let activeConfigTab = 'empresa';

function parseCsvText(text) {
  const lines = String(text || '')
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
  const [config, puntosVenta, secuencias, afip] = await Promise.all([
    api('/api/config'),
    api('/api/puntos-venta'),
    api('/api/secuencias').catch(() => []),
    api('/api/afip/config').catch(() => null),
  ]);
  const empresa = config.empresa || {};
  const impuestos = config.impuestos || [];

  const tabs = [
    { id: 'empresa', label: 'Empresa y Fiscal' },
    { id: 'importacion', label: 'Importación CSV' },
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
        <div class="full" style="display:flex;gap:18px;flex-wrap:wrap;align-items:center;">
          <label class="checkbox-field"><input type="checkbox" name="print_mostrar_logo" ${Number(empresa.print_mostrar_logo ?? 1) === 1 ? 'checked' : ''} /> <span>Mostrar logo en comprobantes</span></label>
          <label class="checkbox-field"><input type="checkbox" name="print_modo_economico" ${Number(empresa.print_modo_economico ?? 0) === 1 ? 'checked' : ''} /> <span>Modo tinta económico (B/N sin rellenos)</span></label>
        </div>
        <div class="full" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:12px;border:1px solid var(--color-border);border-radius:8px;background:var(--color-bg);">
          <div id="empresa-logo-preview" style="width:140px;height:60px;border:1px dashed var(--color-border);border-radius:6px;background:#fff;display:grid;place-items:center;overflow:hidden;padding:4px;">
            ${empresa.logo_data && String(empresa.logo_data).startsWith('data:image/')
              ? `<img src="${esc(empresa.logo_data)}" alt="Logo empresa" style="max-width:100%;max-height:100%;object-fit:contain;" />`
              : '<span class="muted" style="font-size:11px;">Sin logo</span>'}
          </div>
          <div style="flex:1;min-width:220px;">
            <div style="font-size:13px;font-weight:600;margin-bottom:4px;">Logo de Empresa (para PDFs y Remitos)</div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <input type="file" id="empresa-logo-file" accept="image/png,image/jpeg,image/webp,image/svg+xml" />
              <button type="button" class="btn btn-sm" id="btn-clear-logo">Quitar Logo</button>
            </div>
            <p class="muted" style="font-size:11.5px;margin:4px 0 0;">PNG, JPG, WebP o SVG. Se optimiza automáticamente para impresión.</p>
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
          <p class="muted" style="font-size:0.82rem;">Formato fiscal estándar: <code>{prefijo} {puntoventa}-{comprobante}</code> (ej. <code>FA 0001-00000001</code>).</p>
        </div>
      </div>
      <form id="form-add-pv" class="toolbar" style="margin-bottom:14px;">
        <input type="number" name="numero" min="1" max="9999" required placeholder="Número" style="width:150px;" />
        <input type="text" name="nombre" required placeholder="Nombre" style="min-width:260px;" />
        <label class="checkbox-inline" style="margin:0;"><input type="checkbox" name="es_default" /><span>Por defecto</span></label>
        <label class="checkbox-inline" style="margin:0;"><input type="checkbox" name="es_electronica" /><span>Electrónica (WSFE)</span></label>
        <button type="submit" class="btn btn-primary">+ Agregar Punto de Venta</button>
      </form>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Punto</th>
              <th>Nombre</th>
              <th>Facturación</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${puntosVenta.map(pv => `
              <tr>
                <td><strong>${String(pv.numero).padStart(4, '0')}</strong></td>
                <td>${esc(pv.nombre)} ${pv.es_default ? '<span class="badge badge-ok">Por defecto</span>' : ''}</td>
                <td><span class="badge ${pv.es_electronica ? 'badge-ok' : 'badge-muted'}">${pv.es_electronica ? 'Electrónica WSFE' : 'Manual'}</span></td>
                <td><span class="badge ${pv.activo ? 'badge-ok' : 'badge-muted'}">${pv.activo ? 'Activo' : 'Inactivo'}</span></td>
                <td>
                  <div class="actions">
                    ${!pv.es_default ? `<button type="button" class="btn btn-sm" data-pv-default="${pv.id}">Hacer default</button>` : ''}
                    <button type="button" class="btn btn-sm" data-pv-elec="${pv.id}" data-elec="${pv.es_electronica ? 1 : 0}">${pv.es_electronica ? 'Pasar a Manual' : 'Hacer Electrónica'}</button>
                    <button type="button" class="btn btn-sm" data-pv-toggle="${pv.id}" data-activo="${pv.activo ? 1 : 0}">${pv.activo ? 'Desactivar' : 'Activar'}</button>
                    <button type="button" class="btn btn-sm btn-danger" data-del-pv="${pv.id}">Eliminar</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    ${afip ? `
    <div class="card">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div>
          <h2>Facturación Electrónica y Padrón (AFIP / ARCA)</h2>
          <p class="muted" style="font-size:0.82rem;">Generá tu clave privada y CSR para subir a AFIP, cargá el certificado <code>.crt</code> y operá con WSFEv1 y Padrón A5.</p>
        </div>
        <span class="badge ${afip.entorno === 'produccion' ? 'badge-ok' : 'badge-parcial'}">${afip.entorno === 'produccion' ? 'Producción' : 'Homologación (Testing)'}</span>
      </div>

      <div class="form-grid" style="margin-bottom:14px;">
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
        <div class="full" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
          <button type="button" class="btn btn-primary" id="btn-afip-gen-keys">Generar Clave Privada y CSR</button>
          <button type="button" class="btn" id="btn-afip-dl-csr" ${afip.tiene_csr ? '' : 'disabled'}>Descargar solicitud (.csr)</button>
          <button type="button" class="btn" id="btn-afip-test-wsfe">Probar Conexión WSFE</button>
          <span class="muted" style="font-size:0.82rem;">
            ${afip.tiene_key ? 'Clave RSA 2048 guardada.' : 'Sin clave generada.'}
            ${afip.tiene_csr ? ' CSR listo para descargar.' : ''}
          </span>
        </div>
      </div>

      <div style="border-top:1px solid var(--color-border);padding-top:14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
          <strong>Certificado X.509 emitido por AFIP (.crt)</strong>
          ${afip.cert_info
            ? `<span class="badge ${afip.cert_info.vigente ? 'badge-ok' : 'badge-danger'}">${afip.cert_info.vigente ? 'Vigente' : 'Vencido'} · Vence: ${esc(afip.cert_info.validTo)}</span>`
            : `<span class="badge badge-muted">Sin certificado cargado</span>`}
        </div>
        ${afip.cert_info ? `<p class="muted" style="font-size:0.8rem;margin:0 0 8px;">${esc(afip.cert_info.subject)} · Serie: <code>${esc(afip.cert_info.serialNumber)}</code></p>` : ''}
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
          <input type="file" id="afip-crt-file" accept=".crt,.pem,.cer,.txt" />
          <button type="button" class="btn btn-primary btn-sm" id="btn-afip-save-crt">Guardar Certificado (.crt)</button>
        </div>
        <textarea id="afip-crt-text" rows="4" placeholder="O pegá acá el contenido PEM completo (-----BEGIN CERTIFICATE----- ...)" style="width:100%;font-family:monospace;font-size:12px;"></textarea>
      </div>
    </div>
    ` : ''}

    <div class="card">
      <div class="card-header">
        <div>
          <h2>Secuencias de Numeración</h2>
          <p class="muted" style="font-size:0.82rem;">Prefijos, sufijos, relleno (padding), próximo número y dominio para cada tipo de documento.</p>
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
              <th style="width:90px;">Padding</th>
              <th style="width:110px;">Próx. Nº</th>
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
                <td><input type="text" class="seq-prefijo input-sm" value="${esc(seq.prefijo)}" style="width:85px;" /></td>
                <td><input type="text" class="seq-sufijo input-sm" value="${esc(seq.sufijo)}" style="width:75px;" /></td>
                <td><input type="number" min="1" max="12" class="seq-padding input-sm" value="${seq.padding}" style="width:70px;" /></td>
                <td><input type="number" min="1" class="seq-next input-sm" value="${seq.siguiente_numero}" style="width:90px;" /></td>
                <td><input type="checkbox" class="seq-pv" ${seq.usa_punto_venta ? 'checked' : ''} /></td>
                <td><button type="button" class="btn btn-sm btn-primary" data-save-seq="${seq.id}">Guardar</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    </section>

    <section class="config-tab-panel ${activeConfigTab === 'importacion' ? 'active' : ''}" data-config-panel="importacion">
    <div class="card">
      <div class="card-header">
        <div>
          <h2>Importación Masiva de Datos</h2>
          <p class="muted" style="font-size:0.82rem;">Importá contactos (clientes, proveedores o talleres) y productos desde un archivo CSV. Columnas separadas por coma o punto y coma.</p>
        </div>
      </div>
      <div class="card-body">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;">
          <div style="border:1px solid var(--color-border);border-radius:8px;padding:14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px;flex-wrap:wrap;">
              <strong>Importar Contactos</strong>
              <button type="button" id="btn-tpl-cont" class="btn btn-sm">Descargar Plantilla CSV</button>
            </div>
            <p class="muted" style="font-size:0.78rem;margin:0 0 10px;">Columnas: <code>nombre, razon_social, cuit, condicion_iva, es_cliente, es_proveedor, es_taller, telefono, email, direccion, localidad, provincia, observaciones</code></p>
            <input type="file" id="file-imp-cont" accept=".csv,text/csv" />
            <div id="status-imp-cont" class="muted" style="font-size:12px;margin-top:8px;">Ningún archivo seleccionado.</div>
            <div style="margin-top:10px;display:flex;justify-content:flex-end;">
              <button type="button" id="btn-imp-cont" class="btn btn-primary btn-sm">Importar Contactos</button>
            </div>
          </div>
          <div style="border:1px solid var(--color-border);border-radius:8px;padding:14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px;flex-wrap:wrap;">
              <strong>Importar Productos</strong>
              <button type="button" id="btn-tpl-prod" class="btn btn-sm">Descargar Plantilla CSV</button>
            </div>
            <p class="muted" style="font-size:0.78rem;margin:0 0 10px;">Columnas: <code>codigo, nombre, descripcion, se_fabrica, se_compra, tipo, categoria, proveedor, udm, precio, alicuota_iva, stock, stock_minimo, minimo_compra</code></p>
            <input type="file" id="file-imp-prod" accept=".csv,text/csv" />
            <div id="status-imp-prod" class="muted" style="font-size:12px;margin-top:8px;">Ningún archivo seleccionado.</div>
            <div style="margin-top:10px;display:flex;justify-content:flex-end;">
              <button type="button" id="btn-imp-prod" class="btn btn-primary btn-sm">Importar Productos</button>
            </div>
          </div>
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
      ? `<img src="${esc(src)}" alt="Logo empresa" style="max-width:100%;max-height:100%;object-fit:contain;" />`
      : '<span class="muted" style="font-size:11px;">Sin logo</span>';
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

  root.querySelector('#form-empresa').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/empresa', {
        method: 'PUT',
        body: JSON.stringify({
          razon_social: fd.get('razon_social'),
          nombre_fantasia: fd.get('nombre_fantasia'),
          cuit: fd.get('cuit'),
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

  root.querySelector('#form-add-pv').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/puntos-venta', {
        method: 'POST',
        body: JSON.stringify({
          numero: Number(fd.get('numero')),
          nombre: fd.get('nombre'),
          es_default: fd.get('es_default') === 'on',
          es_electronica: fd.get('es_electronica') === 'on',
        }),
      });
      toast('Punto de venta agregado');
      await renderConfigView();
    } catch (err) {
      toast(err.message, true);
    }
  });
  root.querySelectorAll('[data-pv-default]').forEach(btn => btn.addEventListener('click', async () => {
    try {
      await api(`/api/puntos-venta/${btn.dataset.pvDefault}`, { method: 'PUT', body: JSON.stringify({ es_default: true }) });
      toast('Punto de venta por defecto actualizado');
      await renderConfigView();
    } catch (err) { toast(err.message, true); }
  }));
  root.querySelectorAll('[data-pv-elec]').forEach(btn => btn.addEventListener('click', async () => {
    try {
      await api(`/api/puntos-venta/${btn.dataset.pvElec}`, { method: 'PUT', body: JSON.stringify({ es_electronica: btn.dataset.elec !== '1' }) });
      toast('Modalidad de facturación del punto de venta actualizada');
      await renderConfigView();
    } catch (err) { toast(err.message, true); }
  }));
  root.querySelectorAll('[data-pv-toggle]').forEach(btn => btn.addEventListener('click', async () => {
    try {
      await api(`/api/puntos-venta/${btn.dataset.pvToggle}`, { method: 'PUT', body: JSON.stringify({ activo: btn.dataset.activo !== '1' }) });
      await renderConfigView();
    } catch (err) { toast(err.message, true); }
  }));
  root.querySelectorAll('[data-del-pv]').forEach(btn => btn.addEventListener('click', async () => {
    if (!(await showConfirmModal('¿Eliminar este punto de venta?'))) return;
    try {
      await api(`/api/puntos-venta/${btn.dataset.delPv}`, { method: 'DELETE' });
      toast('Punto de venta eliminado');
      await renderConfigView();
    } catch (err) { toast(err.message, true); }
  }));

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
  root.querySelector('#afip-crt-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const txt = await file.text();
    const ta = root.querySelector('#afip-crt-text');
    if (ta) ta.value = txt;
  });
  root.querySelector('#btn-afip-save-crt')?.addEventListener('click', async () => {
    const crt = root.querySelector('#afip-crt-text')?.value?.trim();
    if (!crt) { toast('Pegá o seleccioná un archivo .crt primero', true); return; }
    try {
      await api('/api/afip/subir-crt', { method: 'POST', body: JSON.stringify({ crt }) });
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
    downloadCSV('plantilla_contactos.csv', [
      ['nombre', 'razon_social', 'cuit', 'condicion_iva', 'es_cliente', 'es_proveedor', 'es_taller', 'telefono', 'email', 'direccion', 'localidad', 'provincia', 'codigo_postal', 'observaciones'],
      ['Curtiembre Ejemplo', 'Curtiembre Ejemplo SA', '30-11223344-5', 'Responsable Inscripto', '0', '1', '0', '11-4455-6677', 'ventas@ejemplo.com', 'Av. Industrial 100', 'Avellaneda', 'Buenos Aires', ''],
      ['Taller Aparado Sur', '', '20-22334455-6', 'Monotributo', '0', '1', '1', '11-5566-7788', '', 'Calle 10 200', 'Lanús', 'Buenos Aires', ''],
      ['Zapatería Centro', 'Zapatería Centro SRL', '30-12345678-9', 'Responsable Inscripto', '1', '0', '0', '11-4455-6677', 'compras@ejemplo.com', 'Av. Principal 123', 'CABA', 'Buenos Aires', 'Entrega martes y jueves'],
    ]);
  });

  root.querySelector('#btn-tpl-prod').addEventListener('click', () => {
    downloadCSV('plantilla_productos.csv', [
      ['codigo', 'nombre', 'descripcion', 'se_fabrica', 'se_compra', 'tipo', 'categoria', 'proveedor', 'udm', 'precio', 'alicuota_iva', 'stock', 'stock_minimo', 'minimo_compra'],
      ['MOD-01', 'Bota Urbana Clásica', 'Producto fabricado en taller', '1', '0', 'almacenable', 'Calzado', '', 'pares', '48000', '21', '0', '5', '0'],
      ['CUE-01', 'Cuero Vacuno Negro', 'Espesor 1.4mm', '0', '1', 'almacenable', 'Cueros', 'Curtiembre Ejemplo', 'metros', '12500', '21', '50', '10', '5'],
      ['SRV-AP', 'Servicio de Aparado', 'Mano de obra', '0', '1', 'servicio', 'Mano de obra', 'Taller Aparado Sur', 'unidades', '3800', '21', '0', '0', '0'],
    ]);
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
      const res = await api('/api/importar/contactos', { method: 'POST', body: JSON.stringify({ rows: csvRows.cont }) });
      toast(`Contactos importados: ${res.created} creados${res.errors?.length ? `, ${res.errors.length} errores` : ''}`);
    } catch (err) {
      toast(err.message, true);
    }
  });

  root.querySelector('#btn-imp-prod').addEventListener('click', async () => {
    if (!csvRows.prod.length) return toast('Seleccioná un archivo CSV válido con encabezado y filas', true);
    try {
      const res = await api('/api/importar/productos', { method: 'POST', body: JSON.stringify({ rows: csvRows.prod }) });
      toast(`Productos importados: ${res.created} creados${res.errors?.length ? `, ${res.errors.length} errores` : ''}`);
    } catch (err) {
      toast(err.message, true);
    }
  });
}
