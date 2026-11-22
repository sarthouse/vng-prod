import { api, toast } from '../../lib/api.js';
import { esc, fmtMoney, fmtDate } from '../../lib/format.js';
import { navigate } from '../../router.js';
import {
  mountPageView,
  renderKpiStrip,
  renderDataTable,
  renderSpreadsheetTable,
  showFormModal,
  showConfirmModal,
} from '../../lib/engine/index.js';

function ocEstadoBadge(estado) {
  if (estado === 'Facturada') return '<span class="badge badge-ok">Facturada</span>';
  if (estado === 'Enviada' || estado === 'Recibida Parcial') return `<span class="badge badge-parcial">${esc(estado)}</span>`;
  if (estado === 'Cancelada') return '<span class="badge badge-muted">Cancelada</span>';
  return '<span class="badge badge-muted">Borrador</span>';
}

export async function renderOrdenesCompraView() {
  const root = document.getElementById('app-view');
  let selectedOcId = null;

  const draw = async () => {
    const [ordenes, proveedores, productos] = await Promise.all([
      api('/api/ordenes-compra').catch(() => []),
      api('/api/contactos?es_proveedor=1').catch(() => []),
      api('/api/productos').catch(() => []),
    ]);

    if (!selectedOcId && ordenes.length > 0) {
      selectedOcId = ordenes[0].id;
    }
    const detalle = selectedOcId
      ? await api(`/api/ordenes-compra/${selectedOcId}`).catch(() => null)
      : null;

    const borradores = ordenes.filter(o => o.estado === 'Borrador').length;
    const enviadas = ordenes.filter(o => o.estado === 'Enviada' || o.estado === 'Recibida Parcial').length;
    const totalPendiente = ordenes
      .filter(o => !['Facturada', 'Cancelada'].includes(o.estado))
      .reduce((s, o) => s + Number(o.total_estimado || 0), 0);

    mountPageView(root, {
      title: 'Órdenes de Compra',
      subtitle: 'Pedidos internos a proveedores sin impacto fiscal ni contable hasta registrar la Factura de Compra.',
      actionsHtml: '<button type="button" class="btn btn-primary" id="btn-nueva-oc">+ Nueva Orden de Compra</button>',
      kpisHtml: '<div id="oc-kpis"></div>',
      tabs: [
        {
          id: 'listado',
          label: 'Órdenes de Compra',
          badge: ordenes.length,
          html: `
            <div class="card mb-md">
              <div class="card-header"><h2>Listado de Órdenes de Compra</h2></div>
              <div id="oc-list-table"></div>
            </div>
            <div class="card">
              <div class="card-header">
                <div>
                  <h2>Ítems de la Orden ${detalle ? `— ${esc(detalle.orden.numero)}` : ''}</h2>
                  <span class="muted text-sm">${detalle && !['Facturada', 'Cancelada'].includes(detalle.orden.estado) ? 'Click en celda para editar o completá la fila inferior para agregar ítems.' : 'Orden cerrada / solo lectura.'}</span>
                </div>
                <div class="actions">
                  ${detalle && !['Facturada', 'Cancelada'].includes(detalle.orden.estado) ? `<button type="button" class="btn btn-primary btn-sm" data-convert-oc="${detalle.orden.id}">Registrar Factura de Compra</button>` : ''}
                </div>
              </div>
              <div id="oc-lines-sheet"></div>
            </div>
          `,
        },
      ],
      onAfterMount: () => {
        renderKpiStrip(root.querySelector('#oc-kpis'), [
          { label: 'Total OC', value: String(ordenes.length) },
          { label: 'Borradores', value: String(borradores) },
          { label: 'Enviadas / En Curso', value: String(enviadas), tone: 'success' },
          { label: 'Monto Estimado Pendiente', value: fmtMoney(totalPendiente), tone: 'accent' },
        ]);

        renderDataTable(root.querySelector('#oc-list-table'), {
          emptyText: 'No hay órdenes de compra registradas.',
          rows: ordenes,
          columns: [
            { label: 'Número', render: o => `<strong>${esc(o.numero)}</strong>` },
            { label: 'Fecha', render: o => fmtDate(o.fecha) },
            { label: 'Proveedor', render: o => esc(o.proveedor_nombre || '-') },
            {
              label: 'Origen',
              render: o => (o.origen_tipo
                ? `<span class="badge badge-muted">${esc(o.origen_tipo)} #${o.origen_id || ''}</span>`
                : '<span class="muted">Manual</span>'),
            },
            { label: 'Estado', render: o => ocEstadoBadge(o.estado) },
            { label: 'Total Estimado', align: 'right', render: o => `<strong>${fmtMoney(o.total_estimado)}</strong>` },
            {
              label: 'Factura',
              render: o => (o.compra_id
                ? `<a href="/compras/${o.compra_id}" data-link class="badge badge-ok">Compra #${o.compra_id}</a>`
                : '<span class="muted">-</span>'),
            },
            {
              label: 'Acciones',
              align: 'right',
              render: o => `
                <div class="actions justify-end">
                  <button type="button" class="btn btn-sm" data-sel-oc="${o.id}">Ver Ítems</button>
                  ${o.estado === 'Borrador' ? `<button type="button" class="btn btn-sm" data-enviar-oc="${o.id}">Enviar</button>` : ''}
                  ${!['Facturada', 'Cancelada'].includes(o.estado) ? `<button type="button" class="btn btn-sm btn-primary" data-convert-oc="${o.id}">Registrar Factura</button>` : ''}
                  ${!['Facturada', 'Cancelada'].includes(o.estado) ? `<button type="button" class="btn btn-sm btn-danger" data-cancel-oc="${o.id}">Cancelar</button>` : ''}
                  ${['Borrador', 'Cancelada'].includes(o.estado) ? `<button type="button" class="btn btn-sm btn-danger" data-del-oc="${o.id}">Eliminar</button>` : ''}
                </div>
              `,
            },
          ],
        });

        const sheetHost = root.querySelector('#oc-lines-sheet');
        if (detalle) {
          const editable = !['Facturada', 'Cancelada'].includes(detalle.orden.estado);
          const prodOpts = productos.map(p => ({ value: String(p.id), label: p.nombre, raw: p }));

          renderSpreadsheetTable(sheetHost, {
            rows: detalle.lineas,
            emptyText: 'Sin ítems en esta orden de compra.',
            compact: true,
            ...(editable ? {
              defaultNewRow: () => ({
                producto_id: '',
                producto_nombre: '',
                descripcion: '',
                cantidad: 1,
                precio_unitario: 0,
                udm: 'unidades',
                alicuota_iva: 21,
              }),
              onCreateRow: async ({ row }) => {
                if (!row.producto_id && !String(row.descripcion || '').trim()) return false;
                try {
                  await api(`/api/ordenes-compra/${detalle.orden.id}/lineas`, {
                    method: 'POST',
                    body: JSON.stringify(row),
                  });
                  toast('Ítem agregado a la OC');
                  await draw();
                  return false;
                } catch (err) {
                  toast(err.message, true);
                  throw err;
                }
              },
            } : {}),
            columns: [
              {
                key: 'producto_id',
                label: 'Producto / Insumo',
                type: 'combobox',
                editable: () => editable,
                placeholder: 'Buscar producto...',
                options: prodOpts,
                onPickItem: (l, p) => {
                  if (!p) return;
                  l.producto_id = p.id;
                  l.producto_nombre = p.nombre;
                  l.descripcion = p.nombre;
                  l.precio_unitario = Number(p.costo || p.precio || 0);
                  l.udm = p.udm || 'unidades';
                },
                render: l => (l.producto_nombre ? `<strong>${esc(l.producto_nombre)}</strong>` : '<span class="muted">Seleccionar...</span>'),
              },
              {
                key: 'descripcion',
                label: 'Descripción',
                type: 'text',
                editable: () => editable,
              },
              {
                key: 'cantidad',
                label: 'Cantidad',
                type: 'number',
                min: 0.01,
                step: 0.01,
                align: 'right',
                editable: () => editable,
                parse: v => Math.max(0, Number(v) || 0),
              },
              {
                key: 'precio_unitario',
                label: 'Precio Est. Unit.',
                type: 'number',
                min: 0,
                step: 0.01,
                align: 'right',
                editable: () => editable,
                parse: v => Math.max(0, Number(v) || 0),
                render: l => fmtMoney(l.precio_unitario || 0),
              },
              {
                key: 'subtotal',
                label: 'Subtotal Est.',
                align: 'right',
                editable: () => false,
                render: l => `<strong>${fmtMoney(Number(l.cantidad || 0) * Number(l.precio_unitario || 0))}</strong>`,
              },
            ],
            onCellChange: async ({ row, key, value }) => {
              try {
                await api(`/api/ordenes-compra/lineas/${row.id}`, {
                  method: 'PUT',
                  body: JSON.stringify({ [key]: value }),
                });
                toast('Línea actualizada');
                await draw();
              } catch (err) {
                toast(err.message, true);
                throw err;
              }
            },
            canDeleteRow: l => editable && !l.__isNew,
            onDeleteRow: async (l) => {
              if (!(await showConfirmModal('¿Quitar este ítem de la Orden de Compra?'))) return;
              try {
                await api(`/api/ordenes-compra/lineas/${l.id}`, { method: 'DELETE' });
                toast('Ítem quitado');
                await draw();
              } catch (err) { toast(err.message, true); }
            },
          });
        } else if (sheetHost) {
          sheetHost.innerHTML = '<p class="muted">Seleccioná o creá una Orden de Compra para ver sus ítems.</p>';
        }

        root.querySelector('#btn-nueva-oc')?.addEventListener('click', () => {
          showFormModal({
            title: 'Nueva Orden de Compra',
            submitText: 'Crear Orden de Compra',
            initialState: {
              proveedor_id: proveedores[0]?.id ? String(proveedores[0].id) : '',
              fecha: new Date().toISOString().slice(0, 10),
              fecha_entrega_est: '',
              observaciones: '',
            },
            fields: [
              {
                name: 'proveedor_id',
                label: 'Proveedor *',
                type: 'select',
                required: true,
                options: proveedores.map(p => ({ value: String(p.id), label: p.nombre })),
              },
              { name: 'fecha', label: 'Fecha *', type: 'date', required: true },
              { name: 'fecha_entrega_est', label: 'Entrega Estimada', type: 'date' },
              { name: 'observaciones', label: 'Observaciones', type: 'text', full: true },
            ],
            onSubmit: async (data) => {
              try {
                const res = await api('/api/ordenes-compra', {
                  method: 'POST',
                  body: JSON.stringify(data),
                });
                selectedOcId = res.id;
                toast('Orden de Compra creada');
                await draw();
                return true;
              } catch (err) {
                toast(err.message, true);
                throw err;
              }
            },
          });
        });

        root.querySelectorAll('[data-sel-oc]').forEach(btn => {
          btn.addEventListener('click', async () => {
            selectedOcId = Number(btn.dataset.selOc);
            await draw();
          });
        });
        root.querySelectorAll('[data-enviar-oc]').forEach(btn => {
          btn.addEventListener('click', async () => {
            try {
              await api(`/api/ordenes-compra/${btn.dataset.enviarOc}/enviar`, { method: 'POST', body: '{}' });
              toast('Orden de Compra marcada como Enviada');
              await draw();
            } catch (err) { toast(err.message, true); }
          });
        });
        root.querySelectorAll('[data-cancel-oc]').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (!(await showConfirmModal('¿Cancelar esta Orden de Compra?', { danger: true }))) return;
            try {
              await api(`/api/ordenes-compra/${btn.dataset.cancelOc}/cancelar`, { method: 'POST', body: '{}' });
              toast('Orden de Compra cancelada');
              await draw();
            } catch (err) { toast(err.message, true); }
          });
        });
        root.querySelectorAll('[data-del-oc]').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (!(await showConfirmModal('¿Eliminar esta Orden de Compra?', { danger: true }))) return;
            try {
              await api(`/api/ordenes-compra/${btn.dataset.delOc}`, { method: 'DELETE' });
              if (Number(selectedOcId) === Number(btn.dataset.delOc)) selectedOcId = null;
              toast('Orden de Compra eliminada');
              await draw();
            } catch (err) { toast(err.message, true); }
          });
        });
        root.querySelectorAll('[data-convert-oc]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const ok = await showConfirmModal('¿Generar el borrador de Factura de Compra desde esta Orden de Compra y abrir su ficha?');
            if (!ok) return;
            try {
              const res = await api(`/api/ordenes-compra/${btn.dataset.convertOc}/convertir-compra`, {
                method: 'POST',
                body: JSON.stringify({ estado: 'Borrador' }),
              });
              toast('Factura de Compra generada desde OC');
              navigate(`/compras/${res.compra_id}`);
            } catch (err) { toast(err.message, true); }
          });
        });
      },
    });
  };

  await draw();
}
