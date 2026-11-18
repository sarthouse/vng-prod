import { esc } from '../format.js';
import { mountFormFields } from './formEngine.js';

/**
 * Motor unificado de modales (createModal, showAlertModal, showConfirmModal, showPromptModal, showFormModal).
 * Soporta tamaños: 'sm' (440px), 'md' (620px), 'lg' (820px).
 */
export function createModal({ title, bodyHtml, footerHtml, size = 'sm', onMount, onCancel }) {
  const backdrop = document.createElement('div');
  backdrop.className = 've-modal-backdrop';
  const sizeClass = size === 'lg' ? 've-modal-lg' : size === 'md' ? 've-modal-md' : '';
  backdrop.innerHTML = `
    <div class="ve-modal ${sizeClass}" role="dialog" aria-modal="true">
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
  cleanup.close = cleanup;
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
        <p class="ve-modal-msg sx-a7409f">${esc(message)}</p>
        <input type="text" class="ve-modal-input sx-6d5673" value="${esc(defaultValue)}" placeholder="${esc(placeholder)}" />
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

/**
 * Motor declarativo de modales con formulario.
 * Combina createModal (contenedor visual) + mountFormFields (campos como datos).
 */
export function showFormModal({
  title = 'Formulario',
  fields = [],
  initialState = {},
  submitText = 'Guardar',
  cancelText = 'Cancelar',
  size = null,
  onChange = null,
  onSubmit,
} = {}) {
  return new Promise((resolve) => {
    const state = { ...initialState };
    const formId = `ve-modal-form-${Math.random().toString(36).slice(2, 9)}`;
    const resolvedSize = size || (fields.length > 4 ? 'md' : 'sm');

    createModal({
      title,
      size: resolvedSize,
      bodyHtml: `<form id="${formId}" class="form-grid mb-0"></form>`,
      footerHtml: `
        <button type="button" class="btn" data-ve-cancel>${esc(cancelText)}</button>
        <button type="submit" form="${formId}" class="btn btn-primary" data-ve-submit>${esc(submitText)}</button>
      `,
      onCancel: () => resolve(null),
      onMount: (el, cleanup) => {
        const form = el.querySelector(`#${formId}`);
        const cancelBtn = el.querySelector('[data-ve-cancel]');
        const submitBtn = el.querySelector('[data-ve-submit]');

        mountFormFields(form, fields, state, { onChange });

        cancelBtn?.addEventListener('click', () => {
          cleanup();
          resolve(null);
        });

        const firstInput = form.querySelector('input:not([type="hidden"]), select:not(.select-sr-hidden), textarea');
        firstInput?.focus();

        let submitting = false;
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (submitting) return;
          submitting = true;
          if (submitBtn) submitBtn.disabled = true;
          try {
            const result = onSubmit ? await onSubmit({ ...state }, { cleanup, form }) : { ...state };
            if (result === false) return;
            cleanup();
            resolve(result ?? { ...state });
          } catch {
            // El callback maneja el feedback (ej. toast); mantener modal abierto para corregir
          } finally {
            submitting = false;
            if (submitBtn) submitBtn.disabled = false;
          }
        });
      },
    });
  });
}
