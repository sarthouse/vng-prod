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
    <div class="card" style="border-left:4px solid var(--accent,#2563eb)">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
        <div>
          <h3 style="margin:0">${esc(titulo || `${entidadTipo} #${entidadId}`)}</h3>
          <p class="subtitle" style="margin:4px 0 0">Auditoría, notas internas y archivos adjuntos</p>
        </div>
        ${onClose ? `<button type="button" class="btn secondary" id="btn-close-meta">Cerrar</button>` : ''}
      </div>
      <div class="card-body">

      ${record ? `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;padding:10px 12px;margin-bottom:16px;border-radius:8px;background:var(--surface-2,#f8fafc);font-size:12px">
          <div><span style="color:var(--muted,#64748b)">Creado por:</span> <strong>${esc(record.autor_nombre || 'Sistema')}</strong></div>
          <div><span style="color:var(--muted,#64748b)">Creación:</span> <strong>${fmtDateTime(record.created_at)}</strong></div>
          <div><span style="color:var(--muted,#64748b)">Actualizado por:</span> <strong>${esc(record.actualizado_por_nombre || record.autor_nombre || 'Sistema')}</strong></div>
          <div><span style="color:var(--muted,#64748b)">Últ. actualización:</span> <strong>${fmtDateTime(record.updated_at || record.created_at)}</strong></div>
        </div>
      ` : ''}

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px">
        <div>
          <h4 style="margin:0 0 8px">Notas Internas (${notas.length})</h4>
          <form id="meta-nota-form" style="display:flex;gap:8px;margin-bottom:10px">
            <input type="text" id="meta-nota-input" placeholder="Escribir nota interna..." required style="flex:1" />
            <button type="submit" class="btn primary">Agregar</button>
          </form>
          ${notas.length === 0 ? `<div class="empty-state" style="padding:14px">Sin notas internas.</div>` : `
            <div style="display:flex;flex-direction:column;gap:8px;max-height:260px;overflow:auto">
              ${notas.map(n => `
                <div style="padding:8px 10px;border:1px solid var(--border,#e2e8f0);border-radius:8px;background:#fff">
                  <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--muted,#64748b);margin-bottom:4px">
                    <span><strong>${esc(n.autor_nombre || 'Sistema')}</strong> · ${fmtDateTime(n.created_at)}</span>
                    <button type="button" class="btn danger btn-sm" data-del-nota="${n.id}" style="padding:2px 6px;font-size:11px">×</button>
                  </div>
                  <div style="font-size:13px;white-space:pre-wrap">${esc(n.contenido)}</div>
                </div>
              `).join('')}
            </div>
          `}
        </div>

        <div>
          <h4 style="margin:0 0 8px">Archivos Adjuntos (${adjuntos.length})</h4>
          <div style="margin-bottom:10px">
            <input type="file" id="meta-file-input" multiple />
          </div>
          ${adjuntos.length === 0 ? `<div class="empty-state" style="padding:14px">Sin archivos adjuntos.</div>` : `
            <div style="display:flex;flex-direction:column;gap:8px;max-height:260px;overflow:auto">
              ${adjuntos.map(a => `
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border,#e2e8f0);border-radius:8px;background:#fff">
                  <div style="min-width:0">
                    <a href="/api/adjuntos/${a.id}/download" target="_blank" rel="noopener" style="font-weight:600;font-size:13px;word-break:break-all">${esc(a.nombre_original)}</a>
                    <div style="font-size:11px;color:var(--muted,#64748b)">
                      ${fmtSize(a.tamano)} · ${esc(a.autor_nombre || 'Sistema')} · ${fmtDateTime(a.created_at)}
                    </div>
                  </div>
                  <button type="button" class="btn danger btn-sm" data-del-adj="${a.id}" style="padding:2px 6px;font-size:11px">×</button>
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
