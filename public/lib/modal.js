import { esc } from './format.js';

export function createModal({ title, bodyHtml, footerHtml, onMount, onCancel }) {
  const backdrop = document.createElement('div');
  backdrop.className = 've-modal-backdrop';
  backdrop.innerHTML = `
    <div class="ve-modal" role="dialog" aria-modal="true">
      <div class="ve-modal-header">
        <h3>${esc(title)}</h3>
        <button type="button" class="ve-modal-close" aria-label="Cerrar">×</button>
      </div>
      <div class="ve-modal-body">${bodyHtml}</div>
      <div class="ve-modal-footer">${footerHtml}</div>
    </div>
  `;
  document.body.appendChild(backdrop);

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeyDown);
    backdrop.remove();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cleanup();
      onCancel?.();
    }
  };
  document.addEventListener('keydown', onKeyDown);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      cleanup();
      onCancel?.();
    }
  });
  backdrop.querySelector('.ve-modal-close')?.addEventListener('click', () => {
    cleanup();
    onCancel?.();
  });

  onMount?.(backdrop, cleanup);
  return cleanup;
}

export function showAlertModal(message, { title = 'Aviso', okText = 'Aceptar' } = {}) {
  return new Promise((resolve) => {
    createModal({
      title,
      bodyHtml: `<p class="ve-modal-msg">${esc(message)}</p>`,
      footerHtml: `<button type="button" class="btn btn-primary" data-ve-ok>${esc(okText)}</button>`,
      onCancel: () => resolve(),
      onMount: (el, cleanup) => {
        const okBtn = el.querySelector('[data-ve-ok]');
        okBtn?.addEventListener('click', () => {
          cleanup();
          resolve();
        });
        okBtn?.focus();
      },
    });
  });
}

export function showConfirmModal(message, {
  title = 'Confirmar acción',
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  danger = true,
} = {}) {
  return new Promise((resolve) => {
    createModal({
      title,
      bodyHtml: `<p class="ve-modal-msg">${esc(message)}</p>`,
      footerHtml: `
        <button type="button" class="btn" data-ve-cancel>${esc(cancelText)}</button>
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ve-ok>${esc(confirmText)}</button>
      `,
      onCancel: () => resolve(false),
      onMount: (el, cleanup) => {
        const cancelBtn = el.querySelector('[data-ve-cancel]');
        const okBtn = el.querySelector('[data-ve-ok]');
        cancelBtn?.addEventListener('click', () => {
          cleanup();
          resolve(false);
        });
        okBtn?.addEventListener('click', () => {
          cleanup();
          resolve(true);
        });
        okBtn?.focus();
      },
    });
  });
}

export function showPromptModal(message, {
  title = 'Ingresar dato',
  defaultValue = '',
  placeholder = '',
  confirmText = 'Aceptar',
  cancelText = 'Cancelar',
  required = false,
} = {}) {
  return new Promise((resolve) => {
    createModal({
      title,
      bodyHtml: `
        <p class="ve-modal-msg" style="margin-bottom:10px;">${esc(message)}</p>
        <input type="text" class="ve-modal-input" value="${esc(defaultValue)}" placeholder="${esc(placeholder)}" style="width:100%;" />
      `,
      footerHtml: `
        <button type="button" class="btn" data-ve-cancel>${esc(cancelText)}</button>
        <button type="button" class="btn btn-primary" data-ve-ok>${esc(confirmText)}</button>
      `,
      onCancel: () => resolve(null),
      onMount: (el, cleanup) => {
        const input = el.querySelector('.ve-modal-input');
        const cancelBtn = el.querySelector('[data-ve-cancel]');
        const okBtn = el.querySelector('[data-ve-ok]');
        const submit = () => {
          const val = input ? input.value : '';
          if (required && !val.trim()) {
            input?.focus();
            return;
          }
          cleanup();
          resolve(val);
        };
        cancelBtn?.addEventListener('click', () => {
          cleanup();
          resolve(null);
        });
        okBtn?.addEventListener('click', submit);
        input?.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        });
        input?.focus();
        input?.select();
      },
    });
  });
}
