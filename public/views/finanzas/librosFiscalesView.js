import { api, toast } from '../../lib/api.js';
import { esc, fmtMoney, fmtDate } from '../../lib/format.js';
import { mountPageView } from '../../lib/engine/index.js';

function currentMonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
  return { desde: `${y}-${m}-01`, hasta: `${y}-${m}-${String(lastDay).padStart(2, '0')}` };
}

export async function renderLibrosFiscalesView() {
  const root = document.getElementById('app-view');
  const defRange = currentMonthRange();
  const jurisdicciones = await api('/api/fiscal/jurisdicciones');
  const jurMap = new Map((jurisdicciones || []).map(j => [j.codigo, j.nombre]));

  const state = {
    tab: 'libro_iva',
    tipoIva: 'ventas',
    incluirNoFiscales: false,
    categoriaAux: 'percepciones',
    jurAux: '',
    tipoJur: 'ventas',
    desde: defRange.desde,
    hasta: defRange.hasta,
  };

  async function renderShell() {
    mountPageView(root, {
      title: 'Libros IVA',
      subtitle: 'Libro IVA Compras y Ventas, Percepciones, Retenciones, Convenio Multilateral y Padrón IIBB.',
      tabs: [
        {
          id: 'libro_iva',
          label: 'Libro IVA',
          html: '<div class="card"><div class="card-body" data-fiscal-body="libro_iva"><div class="empty-state">Cargando...</div></div></div>',
          onMount: (p) => renderLibroIvaTab(p.querySelector('[data-fiscal-body="libro_iva"]')),
        },
        {
          id: 'auxiliares',
          label: 'Percepciones y Retenciones',
          html: '<div class="card"><div class="card-body" data-fiscal-body="auxiliares"><div class="empty-state">Cargando...</div></div></div>',
          onMount: (p) => renderAuxiliaresTab(p.querySelector('[data-fiscal-body="auxiliares"]')),
        },
        {
          id: 'jurisdicciones',
          label: 'Jurisdicciones',
          html: '<div class="card"><div class="card-body" data-fiscal-body="jurisdicciones"><div class="empty-state">Cargando...</div></div></div>',
          onMount: (p) => renderJurisdiccionesTab(p.querySelector('[data-fiscal-body="jurisdicciones"]')),
        },
        {
          id: 'padron',
          label: 'Padrón IIBB',
          html: '<div class="card"><div class="card-body" data-fiscal-body="padron"><div class="empty-state">Cargando...</div></div></div>',
          onMount: (p) => renderPadronTab(p.querySelector('[data-fiscal-body="padron"]')),
        },
      ],
      defaultTab: state.tab,
    });
  }

  async function renderLibroIvaTab(body) {
    const qs = new URLSearchParams({
      tipo: state.tipoIva,
      desde: state.desde,
      hasta: state.hasta,
      incluir_no_fiscales: state.incluirNoFiscales ? '1' : '0',
    });
    const data = await api(`/api/fiscal/libro-iva?${qs.toString()}`);
    const t = data.totales || {};
    const rows = data.rows || [];
    const expQs = new URLSearchParams({ tipo: state.tipoIva, desde: state.desde, hasta: state.hasta });

    body.innerHTML = `
      <form id="form-iva-filtros" class="toolbar" style="margin-bottom:14px;flex-wrap:wrap;gap:8px;align-items:end;">
        <div>
          <label style="display:block;font-size:12px;">Libro</label>
          <select name="tipoIva" style="width:160px;">
            <option value="ventas" ${state.tipoIva === 'ventas' ? 'selected' : ''}>Libro IVA Ventas</option>
            <option value="compras" ${state.tipoIva === 'compras' ? 'selected' : ''}>Libro IVA Compras</option>
          </select>
        </div>
        <div>
          <label style="display:block;font-size:12px;">Desde</label>
          <input type="date" name="desde" value="${esc(state.desde)}" />
        </div>
        <div>
          <label style="display:block;font-size:12px;">Hasta</label>
          <input type="date" name="hasta" value="${esc(state.hasta)}" />
        </div>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;padding-bottom:6px;">
          <input type="checkbox" name="incluirNoFiscales" ${state.incluirNoFiscales ? 'checked' : ''} /> Incluir no fiscales (X)
        </label>
        <button type="submit" class="btn btn-primary">Filtrar</button>
        <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;">
          <a class="btn" href="/api/fiscal/libro-iva/export?${expQs.toString()}&archivo=cbte" target="_blank" rel="noopener">TXT Comprobantes (ARCA)</a>
          <a class="btn" href="/api/fiscal/libro-iva/export?${expQs.toString()}&archivo=alicuotas" target="_blank" rel="noopener">TXT Alícuotas (ARCA)</a>
        </div>
      </form>

      <div class="kpis" style="margin-bottom:14px;">
        <div class="kpi-card"><span class="kpi-label">Comprobantes</span><strong class="kpi-value">${t.cantidad || 0}</strong></div>
        <div class="kpi-card"><span class="kpi-label">Neto Gravado</span><strong class="kpi-value">${fmtMoney((t.neto_21 || 0) + (t.neto_10_5 || 0) + (t.neto_27 || 0) + (t.neto_otros || 0))}</strong></div>
        <div class="kpi-card"><span class="kpi-label">IVA Liquidado</span><strong class="kpi-value">${fmtMoney((t.iva_21 || 0) + (t.iva_10_5 || 0) + (t.iva_27 || 0) + (t.iva_otros || 0))}</strong></div>
        <div class="kpi-card"><span class="kpi-label">Exento / No Grav.</span><strong class="kpi-value">${fmtMoney(t.exento_no_gravado || 0)}</strong></div>
        <div class="kpi-card"><span class="kpi-label">Percepciones</span><strong class="kpi-value">${fmtMoney((t.percepciones_iva || 0) + (t.percepciones_iibb || 0))}</strong></div>
        <div class="kpi-card"><span class="kpi-label">Total Período</span><strong class="kpi-value accent">${fmtMoney(t.total || 0)}</strong></div>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Cbte.</th>
              <th>Número</th>
              <th>Razón Social</th>
              <th>CUIT</th>
              <th>Cond. IVA</th>
              <th class="num">Neto 21%</th>
              <th class="num">IVA 21%</th>
              <th class="num">Otros Netos</th>
              <th class="num">Otros IVA</th>
              <th class="num">Exento/NG</th>
              <th class="num">Percep.</th>
              <th class="num">Total</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map(r => `
              <tr>
                <td>${fmtDate(r.fecha)}</td>
                <td><code>${esc(r.tipo_comprobante)} (${esc(r.afip_cod)})</code></td>
                <td><strong>${esc(r.numero)}</strong></td>
                <td>${esc(r.razon_social)}</td>
                <td>${esc(r.cuit || '-')}</td>
                <td>${esc(r.condicion_iva)}</td>
                <td class="num">${fmtMoney(r.neto_21)}</td>
                <td class="num">${fmtMoney(r.iva_21)}</td>
                <td class="num">${fmtMoney((r.neto_10_5 || 0) + (r.neto_27 || 0) + (r.neto_otros || 0))}</td>
                <td class="num">${fmtMoney((r.iva_10_5 || 0) + (r.iva_27 || 0) + (r.iva_otros || 0))}</td>
                <td class="num">${fmtMoney(r.exento_no_gravado)}</td>
                <td class="num">${fmtMoney((r.percepciones_iva || 0) + (r.percepciones_iibb || 0) + (r.otros_impuestos || 0))}</td>
                <td class="num"><strong>${fmtMoney(r.total)}</strong></td>
              </tr>
            `).join('') : '<tr><td colspan="13" class="muted" style="text-align:center;">Sin comprobantes fiscales en el período.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;

    body.querySelector('#form-iva-filtros')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      state.tipoIva = fd.get('tipoIva') || 'ventas';
      state.desde = fd.get('desde') || '';
      state.hasta = fd.get('hasta') || '';
      state.incluirNoFiscales = Boolean(fd.get('incluirNoFiscales'));
      renderLibroIvaTab(body);
    });
  }

  async function renderAuxiliaresTab(body) {
    const qs = new URLSearchParams({
      categoria: state.categoriaAux,
      jurisdiccion_codigo: state.jurAux,
      desde: state.desde,
      hasta: state.hasta,
    });
    const data = await api(`/api/fiscal/libros-auxiliares?${qs.toString()}`);
    const rows = data.rows || [];
    const resumen = data.resumen || [];
    const expQs = new URLSearchParams({ categoria: state.categoriaAux, desde: state.desde, hasta: state.hasta });

    body.innerHTML = `
      <form id="form-aux-filtros" class="toolbar" style="margin-bottom:14px;flex-wrap:wrap;gap:8px;align-items:end;">
        <div>
          <label style="display:block;font-size:12px;">Libro Auxiliar</label>
          <select name="categoriaAux" style="width:190px;">
            <option value="percepciones" ${state.categoriaAux === 'percepciones' ? 'selected' : ''}>Percepciones</option>
            <option value="retenciones" ${state.categoriaAux === 'retenciones' ? 'selected' : ''}>Retenciones</option>
            <option value="todas" ${state.categoriaAux === 'todas' ? 'selected' : ''}>Todas</option>
          </select>
        </div>
        <div>
          <label style="display:block;font-size:12px;">Jurisdicción</label>
          <select name="jurAux" style="width:200px;">
            <option value="">-- Todas --</option>
            ${(jurisdicciones || []).map(j => `<option value="${esc(j.codigo)}" ${state.jurAux === j.codigo ? 'selected' : ''}>${esc(j.codigo)} · ${esc(j.nombre)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="display:block;font-size:12px;">Desde</label>
          <input type="date" name="desde" value="${esc(state.desde)}" />
        </div>
        <div>
          <label style="display:block;font-size:12px;">Hasta</label>
          <input type="date" name="hasta" value="${esc(state.hasta)}" />
        </div>
        <button type="submit" class="btn btn-primary">Filtrar</button>
        <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;">
          <a class="btn" href="/api/fiscal/libros-auxiliares/sicore?${expQs.toString()}" target="_blank" rel="noopener">Exportar SICORE (.txt)</a>
          <a class="btn" href="/api/fiscal/libros-auxiliares/sifere?${expQs.toString()}" target="_blank" rel="noopener">Exportar SIFERE (.txt)</a>
        </div>
      </form>

      <div class="kpis" style="margin-bottom:14px;">
        <div class="kpi-card"><span class="kpi-label">Registros</span><strong class="kpi-value">${rows.length}</strong></div>
        <div class="kpi-card"><span class="kpi-label">Total Período</span><strong class="kpi-value accent">${fmtMoney(data.total || 0)}</strong></div>
        ${resumen.slice(0, 4).map(r => `
          <div class="kpi-card"><span class="kpi-label">${esc(r.nombre)} (${esc(r.direccion)})</span><strong class="kpi-value">${fmtMoney(r.monto)}</strong></div>
        `).join('')}
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Dirección</th>
              <th>Comprobante / Cert.</th>
              <th>Contacto</th>
              <th>CUIT</th>
              <th>Jur.</th>
              <th>Rég.</th>
              <th>Impuesto</th>
              <th class="num">Base</th>
              <th class="num">Alíc.</th>
              <th class="num">Monto</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map(r => `
              <tr>
                <td>${fmtDate(r.fecha)}</td>
                <td><span class="badge ${r.origen === 'venta' || r.origen === 'pago' ? 'badge-ok' : 'badge-muted'}">${esc(r.direccion)}</span></td>
                <td><strong>${esc(r.comprobante || '-')}</strong></td>
                <td>${esc(r.contacto_razon_social || r.contacto_nombre || '-')}</td>
                <td>${esc(r.cuit || '-')}</td>
                <td><code>${esc(r.jurisdiccion_codigo || 'NAC')}</code></td>
                <td><code>${esc(r.codigo_regimen || '-')}</code></td>
                <td>${esc(r.impuesto_nombre)}</td>
                <td class="num">${fmtMoney(r.base_imponible)}</td>
                <td class="num">${Number(r.alicuota || 0)}%</td>
                <td class="num"><strong>${fmtMoney(r.monto_neto ?? r.monto)}</strong></td>
                <td>
                  ${r.origen === 'pago' ? `<a class="btn btn-sm" href="/api/tesoreria/pagos/${r.documento_id}/retencion/${r.id}/pdf" target="_blank" rel="noopener">Cert. PDF</a>` : '-'}
                </td>
              </tr>
            `).join('') : '<tr><td colspan="12" class="muted" style="text-align:center;">Sin percepciones ni retenciones en el período.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;

    body.querySelector('#form-aux-filtros')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      state.categoriaAux = fd.get('categoriaAux') || 'percepciones';
      state.jurAux = fd.get('jurAux') || '';
      state.desde = fd.get('desde') || '';
      state.hasta = fd.get('hasta') || '';
      renderAuxiliaresTab(body);
    });
  }

  async function renderJurisdiccionesTab(body) {
    const qs = new URLSearchParams({ tipo: state.tipoJur, desde: state.desde, hasta: state.hasta });
    const data = await api(`/api/fiscal/reporte-jurisdicciones?${qs.toString()}`);
    const rows = data.rows || [];

    body.innerHTML = `
      <form id="form-jur-filtros" class="toolbar" style="margin-bottom:14px;flex-wrap:wrap;gap:8px;align-items:end;">
        <div>
          <label style="display:block;font-size:12px;">Operaciones</label>
          <select name="tipoJur" style="width:160px;">
            <option value="ventas" ${state.tipoJur === 'ventas' ? 'selected' : ''}>Ventas</option>
            <option value="compras" ${state.tipoJur === 'compras' ? 'selected' : ''}>Compras</option>
          </select>
        </div>
        <div>
          <label style="display:block;font-size:12px;">Desde</label>
          <input type="date" name="desde" value="${esc(state.desde)}" />
        </div>
        <div>
          <label style="display:block;font-size:12px;">Hasta</label>
          <input type="date" name="hasta" value="${esc(state.hasta)}" />
        </div>
        <button type="submit" class="btn btn-primary">Filtrar</button>
      </form>

      <div class="kpis" style="margin-bottom:14px;">
        <div class="kpi-card"><span class="kpi-label">Jurisdicciones con actividad</span><strong class="kpi-value">${rows.length}</strong></div>
        <div class="kpi-card"><span class="kpi-label">Total Período</span><strong class="kpi-value accent">${fmtMoney(data.total || 0)}</strong></div>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Cód. SIFERE</th>
              <th>Jurisdicción</th>
              <th class="num">Comprobantes</th>
              <th class="num">Neto Gravado / Base</th>
              <th class="num">IVA</th>
              <th class="num">Percepciones / Otros</th>
              <th class="num">Total</th>
              <th class="num">% Part.</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map(r => `
              <tr>
                <td><code>${esc(r.codigo)}</code></td>
                <td><strong>${esc(r.nombre)}</strong></td>
                <td class="num">${r.cantidad}</td>
                <td class="num">${fmtMoney(r.neto)}</td>
                <td class="num">${fmtMoney(r.iva)}</td>
                <td class="num">${fmtMoney(r.otros_impuestos)}</td>
                <td class="num"><strong>${fmtMoney(r.total)}</strong></td>
                <td class="num">${Number(r.porcentaje || 0).toFixed(2)}%</td>
              </tr>
            `).join('') : '<tr><td colspan="8" class="muted" style="text-align:center;">Sin operaciones en el período.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;

    body.querySelector('#form-jur-filtros')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      state.tipoJur = fd.get('tipoJur') || 'ventas';
      state.desde = fd.get('desde') || '';
      state.hasta = fd.get('hasta') || '';
      renderJurisdiccionesTab(body);
    });
  }

  async function renderPadronTab(body) {
    const items = await api('/api/fiscal/padron');
    body.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px;margin-bottom:16px;">
        <form id="form-padron-add" class="card" style="margin:0;">
          <div class="card-header"><h2>Agregar / Actualizar CUIT</h2></div>
          <div class="form-grid">
            <label><span>CUIT *</span><input type="text" name="cuit" required placeholder="20-12345678-9" /></label>
            <label>
              <span>Jurisdicción *</span>
              <select name="jurisdiccion_codigo">
                ${(jurisdicciones || []).map(j => `<option value="${esc(j.codigo)}" ${j.codigo === '902' ? 'selected' : ''}>${esc(j.codigo)} · ${esc(j.nombre)}</option>`).join('')}
              </select>
            </label>
            <label>
              <span>Tipo</span>
              <select name="tipo">
                <option value="percepcion">Percepción</option>
                <option value="retencion">Retención</option>
              </select>
            </label>
            <label><span>Alícuota % *</span><input type="number" step="0.01" min="0" max="30" name="alicuota" required value="3.0" /></label>
            <div class="full"><button type="submit" class="btn btn-primary">Guardar Alícuota</button></div>
          </div>
        </form>

        <form id="form-padron-import" class="card" style="margin:0;">
          <div class="card-header"><h2>Importar Padrón ARBA / AGIP</h2></div>
          <div class="form-grid">
            <label>
              <span>Jurisdicción</span>
              <select name="jurisdiccion_codigo">
                ${(jurisdicciones || []).map(j => `<option value="${esc(j.codigo)}" ${j.codigo === '902' ? 'selected' : ''}>${esc(j.codigo)} · ${esc(j.nombre)}</option>`).join('')}
              </select>
            </label>
            <label>
              <span>Tipo</span>
              <select name="tipo">
                <option value="percepcion">Percepción</option>
                <option value="retencion">Retención</option>
              </select>
            </label>
            <label class="full">
              <span>Líneas (CUIT;alícuota)</span>
              <textarea name="contenido" rows="3" placeholder="30-71111111-9;3.5"></textarea>
            </label>
            <div class="full"><button type="submit" class="btn">Importar Líneas</button></div>
          </div>
        </form>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>CUIT</th>
              <th>Jurisdicción</th>
              <th>Tipo</th>
              <th class="num">Alícuota</th>
              <th>Origen</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${items.length ? items.map(p => `
              <tr>
                <td><code>${esc(p.cuit)}</code></td>
                <td>${esc(p.jurisdiccion_codigo)} · ${esc(jurMap.get(p.jurisdiccion_codigo) || '')}</td>
                <td>${esc(p.tipo)}</td>
                <td class="num"><strong>${Number(p.alicuota || 0)}%</strong></td>
                <td>${esc(p.origen || 'manual')}</td>
                <td><button type="button" class="btn btn-sm btn-danger" data-del-padron="${p.id}">Eliminar</button></td>
              </tr>
            `).join('') : '<tr><td colspan="6" class="muted" style="text-align:center;">Sin registros en el padrón de alícuotas.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;

    body.querySelector('#form-padron-add')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api('/api/fiscal/padron', {
          method: 'POST',
          body: JSON.stringify({
            cuit: fd.get('cuit'),
            jurisdiccion_codigo: fd.get('jurisdiccion_codigo'),
            tipo: fd.get('tipo'),
            alicuota: Number(fd.get('alicuota')) || 0,
          }),
        });
        toast('Alícuota guardada en padrón');
        renderPadronTab(body);
      } catch (err) { toast(err.message, true); }
    });

    body.querySelector('#form-padron-import')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const res = await api('/api/fiscal/padron/import', {
          method: 'POST',
          body: JSON.stringify({
            jurisdiccion_codigo: fd.get('jurisdiccion_codigo'),
            tipo: fd.get('tipo'),
            contenido: fd.get('contenido'),
          }),
        });
        toast(`Importadas ${res.imported || 0} alícuotas`);
        renderPadronTab(body);
      } catch (err) { toast(err.message, true); }
    });

    body.querySelectorAll('[data-del-padron]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await api(`/api/fiscal/padron/${btn.dataset.delPadron}`, { method: 'DELETE' });
          toast('Registro eliminado');
          renderPadronTab(body);
        } catch (err) { toast(err.message, true); }
      });
    });
  }

  await renderShell();
}
