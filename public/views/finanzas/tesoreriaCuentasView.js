import { api, toast } from '../../lib/api.js';
import { esc, fmtMoney } from '../../lib/format.js';
import { showConfirmModal } from '../../lib/modal.js';

export async function renderTesoreriaCuentasView() {
  const root = document.getElementById('app-view');
  let ajusteCuentaId = null;

  const loadAndRender = async () => {
    const [cuentas, planCuentas, asientos] = await Promise.all([
      api('/api/tesoreria/cuentas'),
      api('/api/tesoreria/plan-cuentas').catch(() => []),
      api('/api/tesoreria/asientos?limit=50').catch(() => []),
    ]);

    const cuentasActivas = (cuentas || []).filter(c => c.activa !== 0);
    const planActivas = (planCuentas || []).filter(pc => pc.activo !== 0);
    const planCapital = planActivas.find(pc => pc.codigo === '3.1.01');
    const movsInternos = (asientos || []).filter(a =>
      ['apertura_cuenta', 'ajuste_saldo', 'transferencia'].includes(a.tipo_origen)
    );
    const ctaAjuste = ajusteCuentaId ? cuentasActivas.find(c => String(c.id) === String(ajusteCuentaId)) : null;

    root.innerHTML = `
      <div class="page-header">
        <div>
          <div style="margin-bottom:6px;"><a href="/tesoreria" data-link class="muted" style="font-size:0.85rem;">← Volver al Dashboard de Tesorería</a></div>
          <h1>Cuentas, Ajustes de Saldo y Transferencias</h1>
        </div>
        <div class="actions">
          <a href="/contabilidad" data-link class="btn">Ver Libro Diario</a>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h2>Cuentas de Caja y Banco</h2>
            <span class="muted" style="font-size:0.82rem;">Los saldos iniciales generan un asiento de apertura; los arqueos o diferencias generan un asiento de ajuste sin alterar el historial.</span>
          </div>
        </div>

        <form id="form-add-cuenta" class="form-grid" style="margin-bottom:1rem;">
          <label><span>Nombre de Cuenta *</span><input type="text" name="nombre" placeholder="Ej: Banco Galicia CC / Caja Chica" required /></label>
          <label><span>Tipo</span>
            <select name="tipo">
              <option value="efectivo">Efectivo</option>
              <option value="banco">Banco</option>
              <option value="billetera">Billetera virtual</option>
              <option value="otro">Otra</option>
            </select>
          </label>
          <label><span>Saldo Inicial</span><input type="number" step="0.01" name="saldo_inicial" value="0" /></label>
          <label><span>Fecha Apertura</span><input type="date" name="fecha" value="${new Date().toISOString().slice(0, 10)}" /></label>
          <label style="grid-column: span 2;"><span>Contrapartida Contable (si saldo inicial ≠ 0)</span>
            <select name="plan_cuenta_contrapartida_id">
              ${planActivas.map(pc => `<option value="${pc.id}" ${planCapital && pc.id === planCapital.id ? 'selected' : ''}>${esc(pc.codigo)} — ${esc(pc.nombre)} (${esc(pc.tipo)})</option>`).join('')}
            </select>
          </label>
          <div style="display:flex; align-items:flex-end;">
            <button type="submit" class="btn btn-primary">+ Agregar Cuenta</button>
          </div>
        </form>

        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Cuenta</th>
                <th>Tipo</th>
                <th>Moneda</th>
                <th class="num">Saldo Inicial</th>
                <th class="num">Saldo Actual</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${cuentasActivas.map(c => `
                <tr>
                  <td><strong>${esc(c.nombre)}</strong></td>
                  <td><span class="badge badge-muted">${esc(c.tipo)}</span></td>
                  <td>${esc(c.moneda)}</td>
                  <td class="num">${fmtMoney(c.saldo_inicial)}</td>
                  <td class="num"><strong>${fmtMoney(c.saldo_actual)}</strong></td>
                  <td>
                    <div class="actions">
                      <button type="button" class="btn btn-sm" data-adj-cta="${c.id}">Ajustar Saldo / Arqueo</button>
                      <button type="button" class="btn btn-sm btn-danger" data-del-cta="${c.id}">Eliminar</button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      ${ctaAjuste ? `
        <div class="card" style="border-left: 4px solid var(--color-primary, #2563eb);">
          <div class="card-header">
            <div>
              <h2>Ajustar Saldo / Arqueo — ${esc(ctaAjuste.nombre)}</h2>
              <span class="muted" style="font-size:0.82rem;">Saldo actual en sistema: <strong>${fmtMoney(ctaAjuste.saldo_actual)}</strong>. Se generará un asiento contable por la diferencia.</span>
            </div>
            <button type="button" id="btn-cancel-ajuste" class="btn btn-sm">Cancelar</button>
          </div>
          <form id="form-ajuste-saldo" class="form-grid">
            <label><span>Nuevo Saldo Real *</span><input type="number" step="0.01" name="nuevo_saldo" value="${Number(ctaAjuste.saldo_actual || 0).toFixed(2)}" required /></label>
            <label><span>Fecha *</span><input type="date" name="fecha" value="${new Date().toISOString().slice(0, 10)}" required /></label>
            <label><span>Motivo / Concepto *</span><input type="text" name="motivo" value="Arqueo / Conciliación ${esc(ctaAjuste.nombre)}" required /></label>
            <label><span>Contrapartida Contable</span>
              <select name="plan_cuenta_contrapartida_id">
                <option value="">Automática (Gastos Bancarios / Otros Gastos / Ingresos)</option>
                ${planActivas.map(pc => `<option value="${pc.id}">${esc(pc.codigo)} — ${esc(pc.nombre)} (${esc(pc.tipo)})</option>`).join('')}
              </select>
            </label>
            <div style="display:flex; align-items:flex-end;">
              <button type="submit" class="btn btn-primary">Confirmar Ajuste Contable</button>
            </div>
          </form>
        </div>
      ` : ''}

      <div class="card">
        <div class="card-header">
          <div>
            <h2>Transferencia entre Cuentas</h2>
            <span class="muted" style="font-size:0.82rem;">Registra el movimiento entre cajas/bancos con asiento contable automático en partida doble.</span>
          </div>
        </div>
        <form id="form-transferencia" class="toolbar" style="margin-bottom:0; flex-wrap:wrap; gap:0.5rem;">
          <input type="date" name="fecha" required value="${new Date().toISOString().slice(0, 10)}" />
          <select name="cuenta_origen_id" required>
            <option value="">Cuenta origen...</option>
            ${cuentasActivas.map(c => `<option value="${c.id}">${esc(c.nombre)} (${fmtMoney(c.saldo_actual)})</option>`).join('')}
          </select>
          <span>→</span>
          <select name="cuenta_destino_id" required>
            <option value="">Cuenta destino...</option>
            ${cuentasActivas.map(c => `<option value="${c.id}">${esc(c.nombre)} (${fmtMoney(c.saldo_actual)})</option>`).join('')}
          </select>
          <input type="number" step="0.01" min="0.01" name="monto" placeholder="Monto" required style="width:130px;" />
          <input type="text" name="concepto" placeholder="Concepto (ej: Depósito recaudación)" style="min-width:220px;" />
          <button type="submit" class="btn btn-primary btn-sm">Transferir</button>
        </form>
      </div>

      <div class="card">
        <div class="card-header">
          <h2>Historial de Aperturas, Ajustes y Transferencias</h2>
        </div>
        ${movsInternos.length === 0 ? '<p class="muted">No hay movimientos registrados.</p>' : `
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Asiento</th>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Concepto</th>
                  <th class="num">Importe</th>
                </tr>
              </thead>
              <tbody>
                ${movsInternos.map(a => {
                  const totalDebe = (a.lineas || []).reduce((s, l) => s + (Number(l.debe) || 0), 0);
                  const badge = a.tipo_origen === 'apertura_cuenta'
                    ? 'badge-ok'
                    : a.tipo_origen === 'ajuste_saldo'
                      ? 'badge-warn'
                      : 'badge-muted';
                  const label = a.tipo_origen === 'apertura_cuenta'
                    ? 'Apertura'
                    : a.tipo_origen === 'ajuste_saldo'
                      ? 'Ajuste Saldo'
                      : 'Transferencia';
                  return `
                    <tr>
                      <td><code>${esc(a.numero || '#' + a.id)}</code></td>
                      <td>${esc(a.fecha)}</td>
                      <td><span class="badge ${badge}">${label}</span></td>
                      <td>${esc(a.concepto)}</td>
                      <td class="num"><strong>${fmtMoney(totalDebe)}</strong></td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;

    root.querySelector('#form-add-cuenta')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api('/api/tesoreria/cuentas', {
          method: 'POST',
          body: JSON.stringify({
            nombre: fd.get('nombre'),
            tipo: fd.get('tipo'),
            saldo_inicial: Number(fd.get('saldo_inicial')) || 0,
            fecha: fd.get('fecha'),
            plan_cuenta_contrapartida_id: fd.get('plan_cuenta_contrapartida_id') ? Number(fd.get('plan_cuenta_contrapartida_id')) : null,
          }),
        });
        toast('Cuenta creada');
        await loadAndRender();
      } catch (err) { toast(err.message, true); }
    });

    root.querySelectorAll('[data-adj-cta]').forEach(btn => btn.addEventListener('click', () => {
      ajusteCuentaId = btn.dataset.adjCta;
      loadAndRender();
    }));

    root.querySelector('#btn-cancel-ajuste')?.addEventListener('click', () => {
      ajusteCuentaId = null;
      loadAndRender();
    });

    root.querySelector('#form-ajuste-saldo')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const res = await api(`/api/tesoreria/cuentas/${ajusteCuentaId}/ajuste`, {
          method: 'POST',
          body: JSON.stringify({
            nuevo_saldo: Number(fd.get('nuevo_saldo')),
            fecha: fd.get('fecha'),
            motivo: fd.get('motivo'),
            plan_cuenta_contrapartida_id: fd.get('plan_cuenta_contrapartida_id') ? Number(fd.get('plan_cuenta_contrapartida_id')) : null,
          }),
        });
        toast(`Saldo ajustado (${res.diferencia > 0 ? '+' : ''}${fmtMoney(res.diferencia)}) · Asiento #${res.asiento_id}`);
        ajusteCuentaId = null;
        await loadAndRender();
      } catch (err) { toast(err.message, true); }
    });

    root.querySelectorAll('[data-del-cta]').forEach(btn => btn.addEventListener('click', async () => {
      if (!(await showConfirmModal('¿Eliminar esta cuenta?'))) return;
      try {
        await api(`/api/tesoreria/cuentas/${btn.dataset.delCta}`, { method: 'DELETE' });
        toast('Cuenta eliminada');
        await loadAndRender();
      } catch (err) { toast(err.message, true); }
    }));

    root.querySelector('#form-transferencia')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api('/api/tesoreria/transferencias', {
          method: 'POST',
          body: JSON.stringify({
            fecha: fd.get('fecha'),
            cuenta_origen_id: Number(fd.get('cuenta_origen_id')),
            cuenta_destino_id: Number(fd.get('cuenta_destino_id')),
            monto: Number(fd.get('monto')),
            concepto: fd.get('concepto'),
          }),
        });
        toast('Transferencia registrada');
        await loadAndRender();
      } catch (err) { toast(err.message, true); }
    });
  };

  await loadAndRender();
}
