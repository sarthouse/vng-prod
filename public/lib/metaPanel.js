import { api, toast } from './api.js';
import { esc, setupFileDropzones } from './format.js';
import { showConfirmModal } from './engine/index.js';

function fmtDateTime(val) {
  if (!val) return '—';
  const d = new Date(String(val).includes('T') ? val : String(val).replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return esc(val);
  return d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

function fmtSize(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result || '');
      const idx = res.indexOf(',');
      resolve(idx >= 0 ? res.slice(idx + 1) : res);
    };
    reader.onerror = () => reject(new Error('Error leyendo el archivo'));
    reader.readAsDataURL(file);
  });
}

export async function renderMetaPanel(container, { entidadTipo, entidadId, titulo, record = null, onClose = null }) {
  if (!container) return;
  container.innerHTML = `<div class="card"><div class="empty-state">Cargando notas y adjuntos...</div></div>`;

  let bundle = { notas: [], adjuntos: [] };
  try {
    bundle = await api(`/api/meta/${encodeURIComponent(entidadTipo)}/${encodeURIComponent(entidadId)}`);
  } catch (err) {
    container.innerHTML = `<div class="card"><div class="empty-state">${esc(err.message)}</div></div>`;
    return;
  }

  const notas = bundle.notas || [];
  const adjuntos = bundle.adjuntos || [];

  container.innerHTML = `
    <div class="card sx-60acac">
      <div class="card-header sx-f390bf">
        <div>
          <h3 class="m-0">${esc(titulo || `${entidadTipo} #${entidadId}`)}</h3>
          <p class="subtitle sx-b11216">Auditoría, notas internas y archivos adjuntos</p>
        </div>
        ${onClose ? `<button type="button" class="btn secondary" id="btn-close-meta">Cerrar</button>` : ''}
      </div>
      <div class="card-body">

      ${record ? `
        <div class="sx-d5deb5">
          <div><span class="sx-9b5b0a">Creado por:</span> <strong>${esc(record.autor_nombre || 'Sistema')}</strong></div>
          <div><span class="sx-9b5b0a">Creación:</span> <strong>${fmtDateTime(record.created_at)}</strong></div>
          <div><span class="sx-9b5b0a">Actualizado por:</span> <strong>${esc(record.actualizado_por_nombre || record.autor_nombre || 'Sistema')}</strong></div>
          <div><span class="sx-9b5b0a">Últ. actualización:</span> <strong>${fmtDateTime(record.updated_at || record.created_at)}</strong></div>
        </div>
      ` : ''}

      <div class="sx-aef58a">
        <div>
          <h4 class="sx-4c7b29">Notas Internas (${notas.length})</h4>
          <form id="meta-nota-form" class="sx-da64e6">
            <input type="text" id="meta-nota-input" placeholder="Escribir nota interna..." required class="sx-da5cd6" />
            <button type="submit" class="btn primary">Agregar</button>
          </form>
          ${notas.length === 0 ? `<div class="empty-state sx-6069bb">Sin notas internas.</div>` : `
            <div class="sx-40c28f">
              ${notas.map(n => `
                <div class="sx-16cf6c">
                  <div class="sx-132437">
                    <span><strong>${esc(n.autor_nombre || 'Sistema')}</strong> · ${fmtDateTime(n.created_at)}</span>
                    <button type="button" class="btn danger btn-sm sx-50ad51" data-del-nota="${n.id}">×</button>
                  </div>
                  <div class="sx-cc9088">${esc(n.contenido)}</div>
                </div>
              `).join('')}
            </div>
          `}
        </div>

        <div>
          <h4 class="sx-4c7b29">Archivos Adjuntos (${adjuntos.length})</h4>
          <div class="sx-a7409f">
            <input type="file" id="meta-file-input" multiple />
          </div>
          ${adjuntos.length === 0 ? `<div class="empty-state sx-6069bb">Sin archivos adjuntos.</div>` : `
            <div class="sx-40c28f">
              ${adjuntos.map(a => `
                <div class="sx-eceb43">
                  <div class="sx-3f9f96">
                    <a href="/api/adjuntos/${a.id}/download" target="_blank" rel="noopener" class="sx-819219">${esc(a.nombre_original)}</a>
                    <div class="sx-8f12e5">
                      ${fmtSize(a.tamano)} · ${esc(a.autor_nombre || 'Sistema')} · ${fmtDateTime(a.created_at)}
                    </div>
                  </div>
                  <button type="button" class="btn danger btn-sm sx-50ad51" data-del-adj="${a.id}">×</button>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </div>
      </div>
    </div>
  `;

  setupFileDropzones(container);

  container.querySelector('#btn-close-meta')?.addEventListener('click', () => {
    container.innerHTML = '';
    if (onClose) onClose();
  });

  container.querySelector('#meta-nota-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const contenido = container.querySelector('#meta-nota-input').value.trim();
    if (!contenido) return;
    try {
      await api(`/api/notas/${encodeURIComponent(entidadTipo)}/${encodeURIComponent(entidadId)}`, {
        method: 'POST',
        body: JSON.stringify({ contenido }),
      });
      toast('Nota agregada');
      await renderMetaPanel(container, { entidadTipo, entidadId, titulo, record, onClose });
    } catch (err) {
      toast(err.message, true);
    }
  });

  container.querySelectorAll('[data-del-nota]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/notas/${btn.dataset.delNota}`, { method: 'DELETE' });
        toast('Nota eliminada');
        await renderMetaPanel(container, { entidadTipo, entidadId, titulo, record, onClose });
      } catch (err) {
        toast(err.message, true);
      }
    });
  });

  container.querySelector('#meta-file-input')?.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) {
        toast(`"${file.name}" supera el límite de 10 MB`, true);
        continue;
      }
      try {
        const data_base64 = await fileToBase64(file);
        await api(`/api/adjuntos/${encodeURIComponent(entidadTipo)}/${encodeURIComponent(entidadId)}`, {
          method: 'POST',
          body: JSON.stringify({
            nombre: file.name,
            mime_type: file.type || 'application/octet-stream',
            data_base64,
          }),
        });
        toast(`Adjunto "${file.name}" subido`);
      } catch (err) {
        toast(err.message, true);
      }
    }
    await renderMetaPanel(container, { entidadTipo, entidadId, titulo, record, onClose });
  });

  container.querySelectorAll('[data-del-adj]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!(await showConfirmModal('¿Eliminar archivo adjunto?'))) return;
      try {
        await api(`/api/adjuntos/${btn.dataset.delAdj}`, { method: 'DELETE' });
        toast('Adjunto eliminado');
        await renderMetaPanel(container, { entidadTipo, entidadId, titulo, record, onClose });
      } catch (err) {
        toast(err.message, true);
      }
    });
  });
}
