import { api, toast } from '../../lib/api.js';
import { esc, mountRichEditor } from '../../lib/format.js';
import {
  createModal,
  showConfirmModal,
  renderFilterBar,
  renderViewSwitcher,
  renderKanbanBoard,
  renderGanttChart,
  renderDataTable,
} from '../../lib/engine/index.js';

const ESTADOS = ['Pendiente', 'En Proceso', 'En Revisión', 'Completada', 'Cancelada'];
const PRIORIDADES = ['Baja', 'Media', 'Alta', 'Urgente'];
const PRIORIDAD_BADGE = {
  Baja: 'badge-muted',
  Media: 'badge-info',
  Alta: 'badge-warn',
  Urgente: 'badge-danger',
};
const ESTADO_COLOR = {
  Pendiente: '#64748b',
  'En Proceso': '#2563eb',
  'En Revisión': '#d97706',
  Completada: '#16a34a',
  Cancelada: '#dc2626',
};

let activeViewMode = 'kanban';
let calMonth = new Date().toISOString().slice(0, 7);

function isOverdue(t) {
  const hoy = new Date().toISOString().slice(0, 10);
  return Boolean(t.fecha_vencimiento && t.fecha_vencimiento < hoy && t.estado !== 'Completada' && t.estado !== 'Cancelada');
}

export async function renderTareasView() {
  const root = document.getElementById('app-view');
  const responsables = await api('/api/tareas/responsables').catch(() => []);
  const filters = {
    estado: '',
    vencimiento: '',
    responsable_id: '',
    q: '',
  };
  let tareas = [];

  const fetchTareas = async () => {
    const qs = new URLSearchParams();
    if (filters.estado) qs.set('estado', filters.estado);
    if (filters.vencimiento) qs.set('vencimiento', filters.vencimiento);
    if (filters.responsable_id) qs.set('responsable_id', filters.responsable_id);
    if (filters.q) qs.set('q', filters.q);
    tareas = await api(`/api/tareas${qs.toString() ? `?${qs.toString()}` : ''}`);
  };

  const openTareaModal = (tarea = null, defaultDue = '') => {
    const isEdit = Boolean(tarea?.id);
    const hoy = new Date().toISOString().slice(0, 10);
    let descEditor = null;

    createModal({
      title: isEdit ? 'Editar Tarea' : 'Nueva Tarea',
      size: 'lg',
      bodyHtml: `
        <form id="form-tarea-modal" class="form-grid">
          <label class="full">
            <span>Título *</span>
            <input type="text" name="titulo" required value="${esc(tarea?.titulo || '')}" placeholder="Ej: Revisar moldería base..." />
          </label>
          <label>
            <span>Estado</span>
            <select name="estado">
              ${ESTADOS.map(e => `<option value="${e}" ${(tarea?.estado || 'Pendiente') === e ? 'selected' : ''}>${e}</option>`).join('')}
            </select>
          </label>
          <label>
            <span>Prioridad</span>
            <select name="prioridad">
              ${PRIORIDADES.map(p => `<option value="${p}" ${(tarea?.prioridad || 'Media') === p ? 'selected' : ''}>${p}</option>`).join('')}
            </select>
          </label>
          <label>
            <span>Responsable</span>
            <select name="responsable_id">
              <option value="">-- Sin asignar --</option>
              ${responsables.map(u => `<option value="${u.id}" ${String(tarea?.responsable_id || '') === String(u.id) ? 'selected' : ''}>${esc(u.nombre)}</option>`).join('')}
            </select>
          </label>
          <label>
            <span>Fecha Inicio</span>
            <input type="date" name="fecha_inicio" value="${esc(tarea?.fecha_inicio || hoy)}" />
          </label>
          <label>
            <span>Fecha Vencimiento</span>
            <input type="date" name="fecha_vencimiento" value="${esc(tarea?.fecha_vencimiento || defaultDue)}" />
          </label>
          <div class="full">
            <span class="field-title">Descripción (texto enriquecido, links, imágenes, videos, archivos)</span>
            <div id="tarea-desc-editor"></div>
          </div>
        </form>
      `,
      footerHtml: `
        <div class="sx-dc0d28">
          <div>${isEdit ? '<button type="button" id="btn-tarea-del" class="btn btn-danger">Eliminar</button>' : ''}</div>
          <div class="actions">
            <button type="button" class="btn" data-ve-cancel>Cancelar</button>
            <button type="submit" form="form-tarea-modal" class="btn btn-primary">${isEdit ? 'Guardar Cambios' : 'Crear Tarea'}</button>
          </div>
        </div>
      `,
      onMount: (el, cleanup) => {
        descEditor = mountRichEditor(el.querySelector('#tarea-desc-editor'), {
          value: tarea?.descripcion || '',
          placeholder: 'Detalles, checklist, links, imágenes, videos o archivos adjuntos...',
        });
        el.querySelector('[data-ve-cancel]')?.addEventListener('click', cleanup);
        el.querySelector('input[name="titulo"]')?.focus();

        el.querySelector('#btn-tarea-del')?.addEventListener('click', async () => {
          if (!(await showConfirmModal(`¿Eliminar la tarea "${tarea.titulo}"?`))) return;
          await api(`/api/tareas/${tarea.id}`, { method: 'DELETE' });
          toast('Tarea eliminada');
          cleanup();
          await fetchTareas();
          renderBody();
        });

        el.querySelector('#form-tarea-modal')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const payload = {
            titulo: fd.get('titulo'),
            estado: fd.get('estado'),
            prioridad: fd.get('prioridad'),
            responsable_id: fd.get('responsable_id') ? Number(fd.get('responsable_id')) : null,
            fecha_inicio: fd.get('fecha_inicio') || '',
            fecha_vencimiento: fd.get('fecha_vencimiento') || '',
            descripcion: descEditor ? descEditor.getHtml() : '',
          };
          try {
            if (isEdit) {
              await api(`/api/tareas/${tarea.id}`, { method: 'PUT', body: JSON.stringify(payload) });
              toast('Tarea actualizada');
            } else {
              await api('/api/tareas', { method: 'POST', body: JSON.stringify(payload) });
              toast('Tarea creada');
            }
            cleanup();
            await fetchTareas();
            renderBody();
          } catch (err) {
            toast(err.message, true);
          }
        });
      },
    });
  };

  const renderKanban = (host) => {
    renderKanbanBoard(host, {
      columns: ESTADOS.map(e => ({ id: e, label: e })),
      rows: tareas,
      groupBy: 'estado',
      emptyText: 'Sin tareas',
      renderCard: (t) => `
        <div class="sx-d1f4a6">
          <span class="badge ${PRIORIDAD_BADGE[t.prioridad] || 'badge-muted'}">${esc(t.prioridad)}</span>
          ${t.fecha_vencimiento ? `<span class="${isOverdue(t) ? 'is-overdue-text' : 'muted'} sx-3bc422">${esc(t.fecha_vencimiento)}</span>` : ''}
        </div>
        <div class="sx-43ec83">${esc(t.titulo)}</div>
        <div class="muted sx-80442b"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="sx-9d078c"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>${esc(t.responsable_nombre || 'Sin asignar')}</div>
      `,
      onMove: async (id, nextEstado, row) => {
        try {
          await api(`/api/tareas/${id}`, { method: 'PATCH', body: JSON.stringify({ estado: nextEstado }) });
          if (row) row.estado = nextEstado;
          toast(`Movida a ${nextEstado}`);
          renderBody();
        } catch (err) {
          toast(err.message, true);
        }
      },
    });
    host.querySelectorAll('.ve-kanban-card').forEach(card => {
      card.addEventListener('click', () => {
        const t = tareas.find(x => String(x.id) === String(card.dataset.kanbanId));
        if (t) openTareaModal(t);
      });
    });
  };

  const renderGantt = (host) => {
    const hoy = new Date().toISOString().slice(0, 10);
    const ganttRows = tareas.map(t => ({
      ...t,
      fecha_inicio: t.fecha_inicio || t.fecha_vencimiento || hoy,
      fecha_vencimiento: t.fecha_vencimiento || t.fecha_inicio || hoy,
      etapas: [],
    }));
    host.innerHTML = '<div class="card"><div id="tareas-gantt-host"></div></div>';
    renderGanttChart(host.querySelector('#tareas-gantt-host'), {
      rows: ganttRows,
      startKey: 'fecha_inicio',
      endKey: 'fecha_vencimiento',
      subRowsKey: 'etapas',
      labelRender: (t) => `
        <button type="button" class="link-primary sx-09760d" data-gantt-edit="${t.id}">
          ${esc(t.titulo)}
        </button>
        <div class="muted text-xs">${esc(t.responsable_nombre || 'Sin asignar')} · ${esc(t.estado)}</div>
      `,
      emptyText: 'No hay tareas para graficar en el diagrama de Gantt.',
    });
    host.querySelectorAll('[data-gantt-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = tareas.find(x => x.id === Number(btn.dataset.ganttEdit));
        if (t) openTareaModal(t);
      });
    });
  };

  const renderCalendario = (host) => {
    const [y, m] = calMonth.split('-').map(Number);
    const firstDay = new Date(Date.UTC(y, m - 1, 1));
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const startOffset = (firstDay.getUTCDay() + 6) % 7;
    const hoy = new Date().toISOString().slice(0, 10);
    const monthLabel = firstDay.toLocaleDateString('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

    const cells = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${calMonth}-${String(d).padStart(2, '0')}`;
      const dayTasks = tareas.filter(t => (t.fecha_vencimiento || t.fecha_inicio) === iso);
      cells.push({ day: d, iso, dayTasks });
    }

    host.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="actions">
            <button type="button" id="cal-prev" class="btn btn-sm">← Anterior</button>
            <strong class="sx-496256">${esc(monthLabel)}</strong>
            <button type="button" id="cal-next" class="btn btn-sm">Siguiente →</button>
            <button type="button" id="cal-today" class="btn btn-sm">Hoy</button>
          </div>
        </div>
        <div class="cal-grid">
          ${['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(d => `<div class="cal-dow">${d}</div>`).join('')}
          ${cells.map(c => {
            if (!c) return '<div class="cal-cell is-empty"></div>';
            return `
              <div class="cal-cell ${c.iso === hoy ? 'is-today' : ''}" data-date="${c.iso}">
                <div class="cal-cell-head">
                  <span>${c.day}</span>
                  <button type="button" class="cal-add-btn" data-date="${c.iso}" title="Nueva tarea para ${c.iso}">+</button>
                </div>
                <div class="cal-cell-items">
                  ${c.dayTasks.map(t => `
                    <button type="button" class="cal-task-pill ${isOverdue(t) ? 'is-overdue' : ''}" data-id="${t.id}" style="border-left:3px solid ${ESTADO_COLOR[t.estado] || '#2563eb'};">
                      ${esc(t.titulo)}
                    </button>
                  `).join('')}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    const shiftMonth = (delta) => {
      const dt = new Date(Date.UTC(y, m - 1 + delta, 1));
      calMonth = dt.toISOString().slice(0, 7);
      renderBody();
    };
    host.querySelector('#cal-prev')?.addEventListener('click', () => shiftMonth(-1));
    host.querySelector('#cal-next')?.addEventListener('click', () => shiftMonth(1));
    host.querySelector('#cal-today')?.addEventListener('click', () => {
      calMonth = new Date().toISOString().slice(0, 7);
      renderBody();
    });
    host.querySelectorAll('.cal-add-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openTareaModal(null, btn.dataset.date);
      });
    });
    host.querySelectorAll('.cal-task-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = tareas.find(x => x.id === Number(btn.dataset.id));
        if (t) openTareaModal(t);
      });
    });
  };

  const renderLista = (host) => {
    host.innerHTML = '<div class="card"><div id="tareas-list-table"></div></div>';
    renderDataTable(host.querySelector('#tareas-list-table'), {
      rows: tareas,
      emptyText: 'No hay tareas que coincidan con los filtros seleccionados.',
      exportFilename: `tareas_${new Date().toISOString().slice(0, 10)}.csv`,
      columns: [
        { label: 'Título', render: t => `<strong>${esc(t.titulo)}</strong>` },
        {
          label: 'Estado',
          render: t => `
            <select class="tarea-inline-estado" data-id="${t.id}">
              ${ESTADOS.map(e => `<option value="${e}" ${t.estado === e ? 'selected' : ''}>${e}</option>`).join('')}
            </select>
          `,
        },
        { label: 'Prioridad', render: t => `<span class="badge ${PRIORIDAD_BADGE[t.prioridad] || 'badge-muted'}">${esc(t.prioridad)}</span>` },
        { label: 'Responsable', render: t => esc(t.responsable_nombre || 'Sin asignar') },
        { label: 'Inicio', render: t => esc(t.fecha_inicio || '-') },
        {
          label: 'Vencimiento',
          render: t => t.fecha_vencimiento
            ? `<span class="${isOverdue(t) ? 'is-overdue-text' : ''}">${esc(t.fecha_vencimiento)}</span>`
            : '-',
        },
        {
          label: 'Acciones',
          render: t => `
            <div class="actions">
              <button type="button" class="btn btn-sm" data-edit="${t.id}">Editar</button>
              <button type="button" class="btn btn-sm btn-danger" data-del="${t.id}">Borrar</button>
            </div>
          `,
        },
      ],
    });
    host.querySelectorAll('.tarea-inline-estado').forEach(sel => {
      sel.addEventListener('change', async () => {
        try {
          await api(`/api/tareas/${sel.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ estado: sel.value }) });
          const t = tareas.find(x => x.id === Number(sel.dataset.id));
          if (t) t.estado = sel.value;
          toast('Estado actualizado');
        } catch (err) {
          toast(err.message, true);
        }
      });
    });
    host.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = tareas.find(x => x.id === Number(btn.dataset.edit));
        if (t) openTareaModal(t);
      });
    });
    host.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!(await showConfirmModal('¿Eliminar esta tarea?'))) return;
        await api(`/api/tareas/${btn.dataset.del}`, { method: 'DELETE' });
        toast('Tarea eliminada');
        await fetchTareas();
        renderBody();
      });
    });
  };

  const renderBody = () => {
    const bodyEl = root.querySelector('#tareas-view-body');
    if (!bodyEl) return;
    if (activeViewMode === 'kanban') renderKanban(bodyEl);
    else if (activeViewMode === 'gantt') renderGantt(bodyEl);
    else if (activeViewMode === 'calendario') renderCalendario(bodyEl);
    else renderLista(bodyEl);
  };

  root.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Tareas</h1>
        <p class="muted">Gestión operativa con vistas Kanban, Gantt, Calendario y Lista.</p>
      </div>
      <div class="actions sx-aace3e">
        <div id="tareas-view-switcher"></div>
        <button type="button" id="btn-nueva-tarea" class="btn btn-primary">+ Nueva Tarea</button>
      </div>
    </div>

    <div id="tareas-filter-bar"></div>
    <div id="tareas-view-body"></div>
  `;

  root.querySelector('#btn-nueva-tarea')?.addEventListener('click', () => openTareaModal());

  renderViewSwitcher(root.querySelector('#tareas-view-switcher'), {
    active: activeViewMode,
    views: [
      { id: 'kanban', label: 'Kanban' },
      { id: 'gantt', label: 'Gantt' },
      { id: 'calendario', label: 'Calendario' },
      { id: 'lista', label: 'Lista' },
    ],
    onChange: (mode) => {
      activeViewMode = mode;
      renderBody();
    },
  });

  renderFilterBar(root.querySelector('#tareas-filter-bar'), {
    searchValue: filters.q,
    searchPlaceholder: 'Buscar tarea o responsable...',
    filters: [
      {
        name: 'estado',
        value: filters.estado,
        options: [
          { value: '', label: 'Estado: Todos' },
          ...ESTADOS.map(e => ({ value: e, label: e })),
        ],
      },
      {
        name: 'vencimiento',
        value: filters.vencimiento,
        options: [
          { value: '', label: 'Vencimiento: Todos' },
          { value: 'vencidas', label: 'Vencidas' },
          { value: 'hoy', label: 'Vencen Hoy' },
          { value: 'semana', label: 'Próximos 7 días' },
          { value: 'sin_fecha', label: 'Sin fecha' },
        ],
      },
      {
        name: 'responsable_id',
        value: filters.responsable_id,
        options: [
          { value: '', label: 'Responsable: Todos' },
          { value: 'sin_asignar', label: 'Sin asignar' },
          ...responsables.map(u => ({ value: String(u.id), label: u.nombre })),
        ],
      },
    ],
    onChange: async (state) => {
      filters.q = state.search || '';
      filters.estado = state.estado || '';
      filters.vencimiento = state.vencimiento || '';
      filters.responsable_id = state.responsable_id || '';
      await fetchTareas();
      renderBody();
    },
  });

  await fetchTareas();
  renderBody();
}
