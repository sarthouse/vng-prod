import { api, toast } from '../../lib/api.js';
import { esc, fmtMoney } from '../../lib/format.js';
import {
  mountPageView,
  renderFilterBar,
  renderDataTable,
  showFormModal,
  showConfirmModal,
  createModal,
} from '../../lib/engine/index.js';

export async function renderChequesView() {
  const root = document.getElementById('app-view');
  let filtroOrigen = '';
  let filtroEstado = '';
  let search = '';

  const loadAndRender = async () => {
    const [cheques, cuentas] = await Promise.all([
      api('/api/tesoreria/cheques').catch(() => []),
      api('/api/tesoreria/cuentas').catch(() => []),
    ]);

    const hoyIso = new Date().toISOString().slice(0, 10);
    const en7Dias = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const enCartera = cheques.filter(c => c.origen === 'terceros' && c.estado === 'En Cartera');
    const depositados = cheques.filter(c => c.origen === 'terceros' && c.estado === 'Depositado');
    const propiosEmitidos = cheques.filter(c => c.origen === 'propio' && c.estado === 'Emitido');
    const vencen7 = cheques.filter(c => ['En Cartera', 'Depositado', 'Emitido'].includes(c.estado) && c.fecha_pago && c.fecha_pago <= en7Dias);
    const sumMonto = (arr) => arr.reduce((s, c) => s + Number(c.monto || 0), 0);

    const openNuevoChequeModal = () => {
      showFormModal({
        title: 'Cargar Cheque de Tercero en Cartera',
        submitText: 'Guardar Cheque',
        initialState: {
          numero: '',
          banco: '',
          monto: '',
          modalidad: 'diferido',
          fecha_emision: hoyIso,
          fecha_pago: hoyIso,
          librador_nombre: '',
          cuit_librador: '',
          echeq: false,
        },
        fields: [
          { name: 'numero', label: 'N° Cheque', type: 'text', required: true, placeholder: 'Ej: 12345678' },
          { name: 'banco', label: 'Banco Emisor', type: 'text', placeholder: 'Ej: Banco Galicia' },
          { name: 'monto', label: 'Monto ($)', type: 'number', step: '0.01', min: '0.01', required: true, placeholder: '0.00' },
          {
            name: 'modalidad',
            label: 'Modalidad',
            type: 'select',
            searchable: false,
            options: [
              { value: 'diferido', label: 'Diferido' },
              { value: 'comun', label: 'Común' },
            ],
          },
          { name: 'fecha_emision', label: 'Fecha Emisión', type: 'date' },
          { name: 'fecha_pago', label: 'Fecha Pago / Vto', type: 'date', required: true },
          { name: 'librador_nombre', label: 'Librador', type: 'text', placeholder: 'Nombre / Razón social' },
          { name: 'cuit_librador', label: 'CUIT Librador', type: 'text', placeholder: '20-12345678-9' },
          { name: 'echeq', label: 'Es E-Cheq', type: 'checkbox' },
        ],
        onSubmit: async (data) => {
          try {
            await api('/api/tesoreria/cheques', {
              method: 'POST',
              body: {
                numero: data.numero,
                banco: data.banco,
                monto: Number(data.monto || 0),
                modalidad: data.modalidad,
                fecha_emision: data.fecha_emision,
                fecha_pago: data.fecha_pago,
                librador_nombre: data.librador_nombre,
                cuit_librador: data.cuit_librador,
                echeq: Boolean(data.echeq),
              },
            });
            toast('Cheque cargado en cartera');
            await loadAndRender();
            return true;
          } catch (err) {
            toast(err.message, true);
            throw err;
          }
        },
      });
    };

    const drawTableOnly = () => {
      const qLower = search.trim().toLowerCase();
      const filtrados = cheques.filter(c => {
        if (filtroOrigen && c.origen !== filtroOrigen) return false;
        if (filtroEstado && c.estado !== filtroEstado) return false;
        if (qLower) {
          const hay = `${c.numero} ${c.banco} ${c.librador_nombre} ${c.contacto_origen_nombre} ${c.contacto_destino_nombre}`.toLowerCase();
          if (!hay.includes(qLower)) return false;
        }
        return true;
      });

      const badgeEstado = (est) => {
        if (est === 'Acreditado' || est === 'Debitado') return 'badge-ok';
        if (est === 'Rechazado' || est === 'Anulado') return 'badge-danger';
        if (est === 'Depositado' || est === 'Endosado') return 'badge-info';
        return 'badge-warn';
      };

      const tableWrap = root.querySelector('#cheq-table-wrap');
      renderDataTable(tableWrap, {
        rows: filtrados,
        emptyText: 'No hay cheques que coincidan con los filtros.',
        exportFilename: `cheques_${hoyIso}.csv`,
        columns: [
          {
            label: 'Origen',
            render: c => `
              <span class="badge ${c.origen === 'terceros' ? 'badge-info' : 'badge-warn'}">${c.origen === 'terceros' ? 'Tercero' : 'Propio'}</span>
              <span class="muted sx-5a9b7a">${c.modalidad === 'comun' ? 'Común' : 'Diferido'}${c.echeq ? ' · E-Cheq' : ''}</span>
            `,
          },
          {
            label: 'N° / Banco',
            render: c => `<strong>${esc(c.numero)}</strong>${c.banco ? `<div class="muted sx-978ebc">${esc(c.banco)}</div>` : ''}`,
          },
          {
            label: 'Librador / Contraparte',
            render: c => `
              <div>${esc(c.librador_nombre || c.contacto_origen_nombre || '-')}</div>
              ${c.cuit_librador ? `<div class="muted text-xs">CUIT ${esc(c.cuit_librador)}</div>` : ''}
              ${c.contacto_destino_nombre ? `<div class="muted text-xs">Endosado a: ${esc(c.contacto_destino_nombre)}</div>` : ''}
            `,
          },
          { label: 'Emisión', render: c => esc(c.fecha_emision || '-') },
          {
            label: 'Vencimiento',
            render: c => {
              const vencido = ['En Cartera', 'Depositado', 'Emitido'].includes(c.estado) && c.fecha_pago && c.fecha_pago < hoyIso;
              const pronto = !vencido && ['En Cartera', 'Depositado', 'Emitido'].includes(c.estado) && c.fecha_pago && c.fecha_pago <= en7Dias;
              return `
                <span style="${vencido ? 'color:var(--color-accent);font-weight:700;' : pronto ? 'color:#b45309;font-weight:600;' : ''}">${esc(c.fecha_pago || '-')}</span>
                ${vencido ? '<div class="muted sx-3f0fb7">Vencido</div>' : ''}
              `;
            },
          },
          { label: 'Cuenta Bancaria', render: c => esc(c.cuenta_bancaria_nombre || '-') },
          { label: 'Estado', render: c => `<span class="badge ${badgeEstado(c.estado)}">${esc(c.estado)}</span>` },
          {
            label: 'Monto',
            align: 'right',
            render: c => `<strong>${fmtMoney(c.monto)}</strong>`,
            sum: rows => `<strong>${fmtMoney(rows.reduce((s, r) => s + (Number(r.monto) || 0), 0))}</strong>`,
          },
          {
            label: 'Acciones',
            render: c => `
              <div class="actions">
                ${c.origen === 'terceros' && c.estado === 'En Cartera' ? `<button type="button" class="btn btn-sm btn-primary" data-cheq-depositar="${c.id}">Depositar</button>` : ''}
                ${c.origen === 'terceros' && c.estado === 'Depositado' ? `<button type="button" class="btn btn-sm btn-primary" data-cheq-acreditar="${c.id}">Acreditar</button>` : ''}
                ${c.origen === 'propio' && c.estado === 'Emitido' ? `<button type="button" class="btn btn-sm btn-primary" data-cheq-debitar="${c.id}">Debitar</button>` : ''}
                ${!['Rechazado', 'Anulado'].includes(c.estado) ? `<button type="button" class="btn btn-sm btn-danger" data-cheq-rechazar="${c.id}">Rechazar</button>` : ''}
              </div>
            `,
          },
        ],
      });

      tableWrap.querySelectorAll('[data-cheq-depositar]').forEach(btn => btn.addEventListener('click', () => {
        const ch = cheques.find(x => String(x.id) === String(btn.dataset.cheqDepositar));
        const bancos = cuentas.filter(c => c.tipo !== 'efectivo');
        if (!bancos.length) { toast('No hay cuentas bancarias o billeteras configuradas', true); return; }
        createModal({
          title: `Depositar Cheque N° ${ch?.numero || ''}`,
          bodyHtml: `
            <div class="form-grid sx-d7614d">
              <label>
                <span>Cuenta Bancaria Destino *</span>
                <select id="mod-dep-cta">
                  ${bancos.map(b => `<option value="${b.id}">${esc(b.nombre)} (${fmtMoney(b.saldo_actual)})</option>`).join('')}
                </select>
              </label>
              <label><span>Fecha de Depósito *</span><input type="date" id="mod-dep-fecha" value="${hoyIso}" /></label>
              <label class="checkbox-field">
                <input type="checkbox" id="mod-dep-acreditar" checked />
                <span>Acreditar saldo inmediatamente en banco</span>
              </label>
            </div>
          `,
          footerHtml: `
            <button type="button" class="btn" data-ve-cancel>Cancelar</button>
            <button type="button" class="btn btn-primary" data-ve-ok>Depositar</button>
          `,
          onMount: (el, cleanup) => {
            el.querySelector('[data-ve-cancel]')?.addEventListener('click', cleanup);
            el.querySelector('[data-ve-ok]')?.addEventListener('click', async () => {
              try {
                await api(`/api/tesoreria/cheques/${btn.dataset.cheqDepositar}/depositar`, {
                  method: 'POST',
                  body: {
                    cuenta_id: Number(el.querySelector('#mod-dep-cta').value),
                    fecha: el.querySelector('#mod-dep-fecha').value || hoyIso,
                    acreditar: el.querySelector('#mod-dep-acreditar').checked,
                  },
                });
                cleanup();
                toast('Cheque depositado');
                await loadAndRender();
              } catch (err) { toast(err.message, true); }
            });
          },
        });
      }));

      tableWrap.querySelectorAll('[data-cheq-acreditar]').forEach(btn => btn.addEventListener('click', async () => {
        if (!(await showConfirmModal('¿Confirmar acreditación del cheque en la cuenta bancaria?', { danger: false }))) return;
        try {
          await api(`/api/tesoreria/cheques/${btn.dataset.cheqAcreditar}/acreditar`, { method: 'POST', body: {} });
          toast('Cheque acreditado en banco');
          await loadAndRender();
        } catch (err) { toast(err.message, true); }
      }));

      tableWrap.querySelectorAll('[data-cheq-debitar]').forEach(btn => btn.addEventListener('click', async () => {
        if (!(await showConfirmModal('¿Confirmar débito del cheque propio en la cuenta bancaria?', { danger: false }))) return;
        try {
          await api(`/api/tesoreria/cheques/${btn.dataset.cheqDebitar}/debitar`, { method: 'POST', body: {} });
          toast('Cheque propio debitado');
          await loadAndRender();
        } catch (err) { toast(err.message, true); }
      }));

      tableWrap.querySelectorAll('[data-cheq-rechazar]').forEach(btn => btn.addEventListener('click', () => {
        const ch = cheques.find(x => String(x.id) === String(btn.dataset.cheqRechazar));
        createModal({
          title: `Rechazar Cheque N° ${ch?.numero || ''}`,
          bodyHtml: `
            <div class="form-grid sx-d7614d">
              <label><span>Fecha de Rechazo *</span><input type="date" id="mod-rej-fecha" value="${hoyIso}" /></label>
              <label><span>Motivo del Rechazo</span><input type="text" id="mod-rej-motivo" placeholder="Ej: Sin fondos, firma difiere..." /></label>
              <label><span>Gastos Bancarios ($)</span><input type="number" step="0.01" min="0" id="mod-rej-gastos" value="0" /></label>
            </div>
          `,
          footerHtml: `
            <button type="button" class="btn" data-ve-cancel>Cancelar</button>
            <button type="button" class="btn btn-danger" data-ve-ok>Confirmar Rechazo</button>
          `,
          onMount: (el, cleanup) => {
            el.querySelector('[data-ve-cancel]')?.addEventListener('click', cleanup);
            el.querySelector('[data-ve-ok]')?.addEventListener('click', async () => {
              try {
                await api(`/api/tesoreria/cheques/${btn.dataset.cheqRechazar}/rechazar`, {
                  method: 'POST',
                  body: {
                    fecha: el.querySelector('#mod-rej-fecha').value || hoyIso,
                    motivo: el.querySelector('#mod-rej-motivo').value,
                    gastos_bancarios: Number(el.querySelector('#mod-rej-gastos').value || 0),
                  },
                });
                cleanup();
                toast('Cheque marcado como rechazado y contra-asiento generado');
                await loadAndRender();
              } catch (err) { toast(err.message, true); }
            });
          },
        });
      }));
    };

    mountPageView(root, {
      breadcrumb: { label: 'Tesorería', href: '/tesoreria' },
      title: 'Cheques',
      subtitle: 'Seguimiento de valores en cartera, depósitos, endosos, cheques propios y vencimientos.',
      actions: [
        { label: 'Flujo de Caja', href: '/tesoreria/flujo-caja' },
        { label: '+ Nuevo Cheque', primary: true, onClick: openNuevoChequeModal },
      ],
      kpis: [
        { label: 'En Cartera', value: fmtMoney(sumMonto(enCartera)), hint: `${enCartera.length} cheque(s)`, tone: 'ok' },
        { label: 'Depositados', value: fmtMoney(sumMonto(depositados)), hint: `${depositados.length} cheque(s)` },
        { label: 'Emitidos', value: fmtMoney(sumMonto(propiosEmitidos)), hint: `${propiosEmitidos.length} cheque(s)`, tone: propiosEmitidos.length ? 'danger' : 'default' },
        { label: 'Próximos 7 días', value: fmtMoney(sumMonto(vencen7)), hint: `${vencen7.length} cheque(s)`, tone: vencen7.length ? 'warn' : 'default' },
      ],
      bodyHtml: `
        <div class="card">
          <div id="cheq-filter-bar"></div>
          <div id="cheq-table-wrap"></div>
        </div>
      `,
      onAfterMount: () => {
        renderFilterBar(root.querySelector('#cheq-filter-bar'), {
          searchValue: search,
          searchPlaceholder: 'Buscar N°, banco, librador o contraparte...',
          filters: [
            {
              name: 'origen',
              value: filtroOrigen,
              options: [
                { value: '', label: 'Todos los orígenes' },
                { value: 'terceros', label: 'Terceros' },
                { value: 'propio', label: 'Propios' },
              ],
            },
            {
              name: 'estado',
              value: filtroEstado,
              options: [
                { value: '', label: 'Todos los estados' },
                ...['En Cartera', 'Depositado', 'Acreditado', 'Endosado', 'Emitido', 'Debitado', 'Rechazado'].map(st => ({ value: st, label: st })),
              ],
            },
          ],
          onChange: (st) => {
            search = st.search;
            filtroOrigen = st.origen ?? '';
            filtroEstado = st.estado ?? '';
            drawTableOnly();
          },
        });
        drawTableOnly();
      },
    });
  };

  await loadAndRender();
}
