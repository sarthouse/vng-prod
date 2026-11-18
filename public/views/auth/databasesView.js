import { api, toast } from '../../lib/api.js';
import { esc } from '../../lib/format.js';
import { showConfirmModal, showPromptModal } from '../../lib/engine/index.js';

function fmtSize(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export async function renderDatabasesView(container, { onBack = null, requireSelection = false } = {}) {
  const target = container || document.getElementById('app-view');
  let state = { current: 'database', unlocked: false, databases: [] };

  async function load() {
    const info = await api('/api/databases/current');
    state.current = info.current;
    state.unlocked = Boolean(info.unlocked);
    if (state.unlocked) {
      const list = await api('/api/databases');
      state.databases = list.databases || [];
      state.current = list.current;
    }
    draw();
  }

  function draw() {
    target.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Instancias de Base de Datos</h1>
          <p class="muted">
            ${state.current
              ? `Base activa en esta sesión: <strong>${esc(state.current)}.sqlite</strong>`
              : 'No hay ninguna base de datos activa. Desbloqueá con la clave maestra para crear o elegir una.'}
          </p>
        </div>
        ${onBack && !requireSelection ? `<div class="actions"><button type="button" class="btn btn-secondary" id="btn-db-back">← Volver al Login</button></div>` : ''}
      </div>

      ${!state.unlocked ? `
        <div class="card sx-3c9977">
          <div class="card-header"><h2>Autorización Requerida</h2></div>
          <div class="card-body">
            <p class="muted sx-228013">Ingresá la clave maestra (<code>DB_MASTER_KEY</code> en <code>.env</code>) para administrar o cambiar de base de datos.</p>
            <form id="form-db-unlock" class="form-grid grid-1col">
              <label class="full">
                <span>Clave Maestra *</span>
                <input type="password" id="db-master-key" required placeholder="••••••••" autocomplete="off" />
              </label>
              <button type="submit" class="btn btn-primary flex-center-full">Desbloquear Gestor</button>
            </form>
          </div>
        </div>
      ` : `
        <div class="card">
          <div class="card-header"><h2>Nueva Instancia de Base de Datos</h2></div>
          <form id="form-db-create" class="form-grid sx-ede874">
            <label class="sx-39cc94">
              <span>Nombre (solo letras, números, - y _) *</span>
              <input type="text" id="new-db-name" required pattern="[a-zA-Z0-9_-]{1,40}" placeholder="Ej: empresa_demo o temporada_2027" />
            </label>
            <div>
              <button type="submit" class="btn btn-primary">+ Crear Base Vacía</button>
            </div>
          </form>
        </div>

        <div class="card">
          <div class="card-header"><h2>Bases Disponibles</h2></div>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Instancia</th>
                  <th class="num">Tamaño</th>
                  <th>Última Modificación</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                ${state.databases.map(d => `
                  <tr>
                    <td><strong>${esc(d.name)}</strong><span class="muted">.sqlite</span></td>
                    <td class="num">${fmtSize(d.sizeBytes)}</td>
                    <td class="muted">${new Date(d.updatedAt).toLocaleString('es-AR')}</td>
                    <td>
                      ${d.isActive ? '<span class="badge badge-ok">Activa en sesión</span>' : '<span class="badge badge-muted">Inactiva</span>'}
                      ${d.isDefault ? ' <span class="badge badge-confirmado">Por defecto</span>' : ''}
                    </td>
                    <td>
                      <div class="actions">
                        ${!d.isActive ? `<button type="button" class="btn btn-sm btn-primary" data-db-select="${esc(d.name)}">Usar en esta sesión</button>` : ''}
                        <a class="btn btn-sm" href="/api/databases/${encodeURIComponent(d.name)}/backup">Backup</a>
                        <button type="button" class="btn btn-sm" data-db-dup="${esc(d.name)}">Duplicar</button>
                        ${!d.isActive && !d.isDefault ? `<button type="button" class="btn btn-sm btn-danger" data-db-del="${esc(d.name)}">Eliminar</button>` : ''}
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `}
    `;

    target.querySelector('#btn-db-back')?.addEventListener('click', () => onBack());

    target.querySelector('#form-db-unlock')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const res = await api('/api/databases/unlock', {
          method: 'POST',
          body: JSON.stringify({ master_key: target.querySelector('#db-master-key').value }),
        });
        state.unlocked = true;
        state.current = res.current;
        state.databases = res.databases || [];
        toast('Gestor desbloqueado');
        draw();
      } catch (err) {
        toast(err.message, true);
      }
    });

    target.querySelector('#form-db-create')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = target.querySelector('#new-db-name').value.trim();
      try {
        const wasEmpty = !state.current;
        await api('/api/databases', { method: 'POST', body: JSON.stringify({ name }) });
        if (wasEmpty) {
          await api('/api/databases/select', { method: 'POST', body: JSON.stringify({ name }) });
          toast(`Base "${name}" creada y seleccionada`);
          window.location.href = '/';
          return;
        }
        toast(`Base "${name}" creada`);
        await load();
      } catch (err) {
        toast(err.message, true);
      }
    });

    target.querySelectorAll('[data-db-select]').forEach(btn => btn.addEventListener('click', async () => {
      const name = btn.dataset.dbSelect;
      try {
        await api('/api/databases/select', { method: 'POST', body: JSON.stringify({ name }) });
        toast(`Cambiando a "${name}"...`);
        window.location.href = '/';
      } catch (err) {
        toast(err.message, true);
      }
    }));

    target.querySelectorAll('[data-db-dup]').forEach(btn => btn.addEventListener('click', async () => {
      const source = btn.dataset.dbDup;
      const targetName = (await showPromptModal(`Nombre de la copia de "${source}":`, { defaultValue: `${source}_copia` }));
      if (!targetName) return;
      try {
        await api('/api/databases/duplicate', {
          method: 'POST',
          body: JSON.stringify({ source, target: targetName.trim() }),
        });
        toast(`Base "${targetName}" duplicada`);
        await load();
      } catch (err) {
        toast(err.message, true);
      }
    }));

    target.querySelectorAll('[data-db-del]').forEach(btn => btn.addEventListener('click', async () => {
      const name = btn.dataset.dbDel;
      if (!(await showConfirmModal(`¿Eliminar permanentemente la base "${name}" y sus adjuntos?`))) return;
      try {
        await api(`/api/databases/${encodeURIComponent(name)}`, { method: 'DELETE' });
        toast(`Base "${name}" eliminada`);
        await load();
      } catch (err) {
        toast(err.message, true);
      }
    }));
  }

  await load();
}
