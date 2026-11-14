import { api, toast } from '../../lib/api.js';
import { esc } from '../../lib/format.js';
import { showConfirmModal } from '../../lib/modal.js';

const PERM_CATEGORY_LABELS = {
  produccion: 'Producción',
  inventario: 'Inventario',
  comercial: 'Comercial',
  tesoreria: 'Tesorería',
  contabilidad: 'Contabilidad',
  sistema: 'Sistema',
};

function splitPermission(perm) {
  const [catKey] = String(perm.key || '').split('.');
  const parts = String(perm.label || '').split('·').map(s => s.trim());
  const category = parts.length > 1 ? parts[0] : (PERM_CATEGORY_LABELS[catKey] || catKey || 'General');
  const action = parts.length > 1 ? parts.slice(1).join(' · ') : (perm.label || perm.key);
  return { catKey: catKey || 'general', category, action };
}

function groupPermissions(permsList) {
  const map = new Map();
  for (const p of permsList) {
    const { catKey, category, action } = splitPermission(p);
    if (!map.has(catKey)) map.set(catKey, { category, items: [] });
    map.get(catKey).items.push({ ...p, action });
  }
  return Array.from(map.values());
}

export async function renderSeguridadSection(container) {
  if (!container) return;

  let permisos = [];
  let grupos = [];
  let usuarios = [];
  let editingGrupo = null;
  let editingUsuario = null;

  async function loadAndDraw() {
    try {
      [permisos, grupos, usuarios] = await Promise.all([
        api('/api/permisos'),
        api('/api/grupos'),
        api('/api/usuarios'),
      ]);
    } catch (err) {
      container.innerHTML = `
        <div class="card">
          <div class="card-header"><h2>Usuarios, Grupos y Permisos</h2></div>
          <div class="empty-state">${esc(err.message || 'No tenés permisos para administrar usuarios y grupos.')}</div>
        </div>
      `;
      return;
    }
    draw();
  }

  function draw() {
    const gSelPerms = new Set(editingGrupo?.permisos || []);
    if (gSelPerms.has('compras.ver') || gSelPerms.has('ventas.ver')) gSelPerms.add('comercial.ver');
    if (gSelPerms.has('compras.editar') || gSelPerms.has('ventas.editar')) gSelPerms.add('comercial.editar');
    const permCategories = groupPermissions(permisos);
    const permByKey = new Map(permisos.map(p => [p.key, splitPermission(p)]));

    const renderGroupPerms = (g) => {
      if (g.es_admin || (g.permisos || []).includes('*')) {
        return '<span class="badge badge-confirmado">Acceso total</span>';
      }
      const keys = g.permisos || [];
      if (!keys.length) return '<span class="muted">Sin permisos</span>';
      const byCat = new Map();
      for (const k of keys) {
        const meta = permByKey.get(k);
        const cat = meta?.category || k.split('.')[0] || 'General';
        const act = meta?.action || k.split('.').slice(1).join('.') || k;
        if (!byCat.has(cat)) byCat.set(cat, []);
        byCat.get(cat).push(act);
      }
      return `<div class="perm-group-list">${Array.from(byCat.entries()).map(([cat, acts]) =>
        `<span class="perm-group-chip"><strong>${esc(cat)}:</strong> ${esc(acts.join(' · '))}</span>`
      ).join('')}</div>`;
    };

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div>
            <h2>Grupos y Permisos</h2>
            <p class="subtitle">Definí roles y permisos por módulo para los usuarios del sistema.</p>
          </div>
        </div>

        <form id="form-grupo" style="margin-bottom:16px;padding:12px;border-radius:8px;background:var(--surface-2,#f8fafc)">
          <div class="form-grid">
            <label>
              <span>Nombre del Grupo *</span>
              <input type="text" name="nombre" required value="${esc(editingGrupo?.nombre || '')}" placeholder="Ej: Ventas" />
            </label>
            <label>
              <span>Descripción</span>
              <input type="text" name="descripcion" value="${esc(editingGrupo?.descripcion || '')}" placeholder="Acceso a ventas y cobros" />
            </label>
            <label style="display:flex;align-items:center;gap:8px;align-self:end">
              <input type="checkbox" name="es_admin" id="grp-es-admin" ${editingGrupo?.es_admin ? 'checked' : ''} />
              <span>Administrador total</span>
            </label>
          </div>

          <div id="grp-permisos-box" style="margin-top:12px;${editingGrupo?.es_admin ? 'opacity:0.5;pointer-events:none' : ''}">
            <div style="font-size:12px;font-weight:600;margin-bottom:8px">Permisos asignados por categoría:</div>
            <div class="perm-categories-grid">
              ${permCategories.map(cat => `
                <div class="perm-category-card">
                  <div class="perm-category-title">${esc(cat.category)}</div>
                  <div class="perm-category-items">
                    ${cat.items.map(p => `
                      <label class="perm-category-item">
                        <input type="checkbox" name="perm" value="${esc(p.key)}" ${gSelPerms.has(p.key) || gSelPerms.has('*') ? 'checked' : ''} />
                        <span>${esc(p.action)}</span>
                      </label>
                    `).join('')}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <div style="display:flex;gap:8px;margin-top:12px">
            <button type="submit" class="btn btn-primary">${editingGrupo ? 'Guardar Grupo' : '+ Crear Grupo'}</button>
            ${editingGrupo ? `<button type="button" class="btn secondary" id="btn-cancel-grupo">Cancelar</button>` : ''}
          </div>
        </form>

        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Grupo</th>
                <th>Descripción</th>
                <th>Permisos</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${grupos.map(g => `
                <tr>
                  <td><strong>${esc(g.nombre)}</strong> ${g.es_admin ? '<span class="badge badge-ok">Admin</span>' : ''}</td>
                  <td class="muted">${esc(g.descripcion || '—')}</td>
                  <td style="font-size:12px">
                    ${renderGroupPerms(g)}
                  </td>
                  <td>
                    <div class="actions">
                      <button type="button" class="btn btn-sm" data-edit-grupo="${g.id}">Editar</button>
                      ${!g.es_admin ? `<button type="button" class="btn btn-sm btn-danger" data-del-grupo="${g.id}">Eliminar</button>` : ''}
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h2>Usuarios</h2>
            <p class="subtitle">Administrá cuentas de acceso, grupos asignados y estado.</p>
          </div>
        </div>

        <form id="form-usuario" style="margin-bottom:16px;padding:12px;border-radius:8px;background:var(--surface-2,#f8fafc)">
          <div class="form-grid">
            <label>
              <span>Usuario *</span>
              <input type="text" name="username" required value="${esc(editingUsuario?.username || '')}" ${editingUsuario ? 'readonly' : ''} placeholder="Ej: jperez" />
            </label>
            <label>
              <span>Nombre completo *</span>
              <input type="text" name="nombre" required value="${esc(editingUsuario?.nombre || '')}" placeholder="Juan Pérez" />
            </label>
            <label>
              <span>Email</span>
              <input type="email" name="email" value="${esc(editingUsuario?.email || '')}" placeholder="juan@empresa.com" />
            </label>
            <label>
              <span>${editingUsuario ? 'Nueva Contraseña' : 'Contraseña *'}</span>
              <input type="password" name="password" ${editingUsuario ? '' : 'required'} placeholder="••••••••" />
            </label>
            <label>
              <span>Grupo *</span>
              <select name="grupo_id" required>
                ${grupos.map(g => `<option value="${g.id}" ${String(g.id) === String(editingUsuario?.grupo_id) ? 'selected' : ''}>${esc(g.nombre)}</option>`).join('')}
              </select>
            </label>
            <label style="display:flex;align-items:center;gap:8px;align-self:end">
              <input type="checkbox" name="activo" ${editingUsuario ? (editingUsuario.activo ? 'checked' : '') : 'checked'} />
              <span>Usuario activo</span>
            </label>
          </div>
          <div style="display:flex;gap:8px;margin-top:12px">
            <button type="submit" class="btn btn-primary">${editingUsuario ? 'Guardar Usuario' : '+ Crear Usuario'}</button>
            ${editingUsuario ? `<button type="button" class="btn secondary" id="btn-cancel-usuario">Cancelar</button>` : ''}
          </div>
        </form>

        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Nombre</th>
                <th>Email</th>
                <th>Grupo</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              ${usuarios.map(u => `
                <tr>
                  <td><strong>${esc(u.username)}</strong></td>
                  <td>${esc(u.nombre)}</td>
                  <td class="muted">${esc(u.email || '—')}</td>
                  <td><span class="badge badge-confirmado">${esc(u.grupo_nombre || '—')}</span></td>
                  <td>${u.activo ? '<span class="badge badge-ok">Activo</span>' : '<span class="badge badge-muted">Inactivo</span>'}</td>
                  <td>
                    <div class="actions">
                      <button type="button" class="btn btn-sm" data-edit-usr="${u.id}">Editar</button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const esAdminChk = container.querySelector('#grp-es-admin');
    const permsBox = container.querySelector('#grp-permisos-box');
    esAdminChk?.addEventListener('change', () => {
      if (!permsBox) return;
      permsBox.style.opacity = esAdminChk.checked ? '0.5' : '1';
      permsBox.style.pointerEvents = esAdminChk.checked ? 'none' : 'auto';
    });

    container.querySelector('#btn-cancel-grupo')?.addEventListener('click', () => {
      editingGrupo = null;
      draw();
    });

    container.querySelector('#form-grupo').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const es_admin = fd.get('es_admin') === 'on';
      const perms = es_admin ? ['*'] : fd.getAll('perm').map(String);
      const payload = {
        nombre: fd.get('nombre'),
        descripcion: fd.get('descripcion'),
        es_admin,
        permisos: perms,
      };
      try {
        if (editingGrupo) {
          await api(`/api/grupos/${editingGrupo.id}`, { method: 'PUT', body: JSON.stringify(payload) });
          toast('Grupo actualizado');
          editingGrupo = null;
        } else {
          await api('/api/grupos', { method: 'POST', body: JSON.stringify(payload) });
          toast('Grupo creado');
        }
        await loadAndDraw();
      } catch (err) {
        toast(err.message, true);
      }
    });

    container.querySelectorAll('[data-edit-grupo]').forEach(btn => btn.addEventListener('click', () => {
      editingGrupo = grupos.find(g => String(g.id) === String(btn.dataset.editGrupo)) || null;
      draw();
    }));

    container.querySelectorAll('[data-del-grupo]').forEach(btn => btn.addEventListener('click', async () => {
      if (!(await showConfirmModal('¿Eliminar este grupo?'))) return;
      try {
        await api(`/api/grupos/${btn.dataset.delGrupo}`, { method: 'DELETE' });
        toast('Grupo eliminado');
        await loadAndDraw();
      } catch (err) {
        toast(err.message, true);
      }
    }));

    container.querySelector('#btn-cancel-usuario')?.addEventListener('click', () => {
      editingUsuario = null;
      draw();
    });

    container.querySelector('#form-usuario').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        username: fd.get('username'),
        nombre: fd.get('nombre'),
        email: fd.get('email'),
        grupo_id: Number(fd.get('grupo_id')),
        activo: fd.get('activo') === 'on',
      };
      const pass = String(fd.get('password') || '');
      if (pass) payload.password = pass;
      try {
        if (editingUsuario) {
          await api(`/api/usuarios/${editingUsuario.id}`, { method: 'PUT', body: JSON.stringify(payload) });
          toast('Usuario actualizado');
          editingUsuario = null;
        } else {
          await api('/api/usuarios', { method: 'POST', body: JSON.stringify(payload) });
          toast('Usuario creado');
        }
        await loadAndDraw();
      } catch (err) {
        toast(err.message, true);
      }
    });

    container.querySelectorAll('[data-edit-usr]').forEach(btn => btn.addEventListener('click', () => {
      editingUsuario = usuarios.find(u => String(u.id) === String(btn.dataset.editUsr)) || null;
      draw();
    }));
  }

  await loadAndDraw();
}
