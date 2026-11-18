import { api, toast } from '../../lib/api.js';
import { esc } from '../../lib/format.js';
import { renderDatabasesView } from './databasesView.js';

export async function renderAuthView(container, onAuthSuccess) {
  let mode = 'login';
  let resetToken = '';
  let forgotSentMsg = '';
  let registerPendingMsg = '';
  let currentDb = 'database';

  const urlParams = new URLSearchParams(window.location.search);
  try {
    const dbInfo = await api('/api/databases/current');
    if (dbInfo?.current) currentDb = dbInfo.current;
  } catch { /* ignore */ }
  if (window.location.pathname === '/reset-password' && urlParams.get('token')) {
    mode = 'reset';
    resetToken = urlParams.get('token');
  } else {
    try {
      const st = await api('/api/auth/status');
      if (st?.needs_db) {
        if (window.location.pathname !== '/database') {
          window.history.replaceState({}, '', '/database');
        }
        await renderDatabasesView(container, { requireSelection: true });
        return;
      }
      if (st?.needs_setup) mode = 'setup';
      if (window.location.pathname !== '/login') {
        window.history.replaceState({}, '', '/login');
      }
    } catch { /* ignore */ }
  }

  function dbFooterHtml() {
    return `
      <div class="sx-980e9f">
        <span>Base activa: <strong>${esc(currentDb)}.sqlite</strong></span>
        <button type="button" class="btn btn-sm btn-secondary" id="btn-open-db-mgr">Cambiar / Gestionar DB</button>
      </div>
    `;
  }

  function bindDbMgr() {
    container.querySelector('#btn-open-db-mgr')?.addEventListener('click', () => {
      window.history.replaceState({}, '', '/database');
      renderDatabasesView(container, {
        onBack: () => {
          window.history.replaceState({}, '', '/login');
          renderAuthView(container, onAuthSuccess);
        },
      });
    });
  }

  function draw() {
    if (mode === 'setup') {
      container.innerHTML = `
        <div class="sx-c239b5">
          <div class="card">
            <div class="card-body">
              <div class="sx-c3f2e8">
                <div class="mb-sm"><img src="/favicon.svg" alt="VNG" width="52" height="52" class="sx-8a9ab5" /></div>
                <h2 class="m-0">Configuración Inicial</h2>
                <p class="muted sx-0f9ed7">Creá la primera cuenta de Administrador para esta base de datos.</p>
              </div>

              <form id="auth-setup-form" class="form-grid grid-1col">
                <label class="full">
                  <span>Usuario *</span>
                  <input type="text" id="setup-username" required minlength="3" autocomplete="username" placeholder="Ej: admin" />
                </label>
                <label class="full">
                  <span>Nombre completo *</span>
                  <input type="text" id="setup-nombre" required placeholder="Nombre y Apellido" />
                </label>
                <label class="full">
                  <span>Email</span>
                  <input type="email" id="setup-email" placeholder="nombre@empresa.com" />
                </label>
                <label class="full">
                  <span>Contraseña *</span>
                  <input type="password" id="setup-password" required minlength="4" autocomplete="new-password" placeholder="••••••••" />
                </label>
                <button type="submit" class="btn btn-primary sx-f585b4">Crear Administrador y Entrar</button>
              </form>
              ${dbFooterHtml()}
            </div>
          </div>
        </div>
      `;

      bindDbMgr();
      container.querySelector('#auth-setup-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const res = await api('/api/auth/setup', {
            method: 'POST',
            body: JSON.stringify({
              username: container.querySelector('#setup-username').value.trim(),
              nombre: container.querySelector('#setup-nombre').value.trim(),
              email: container.querySelector('#setup-email').value.trim(),
              password: container.querySelector('#setup-password').value,
            }),
          });
          toast(`Bienvenido, ${esc(res.user?.nombre || res.user?.username)}`);
          onAuthSuccess(res.user);
        } catch (err) {
          toast(err.message, true);
        }
      });
      return;
    }

    if (mode === 'forgot') {
      container.innerHTML = `
        <div class="auth-card">
          <div class="card">
            <div class="card-body">
              <div class="sx-b7ff7c">
                <div class="mb-sm"><img src="/favicon.svg" alt="VNG" width="52" height="52" class="sx-8a9ab5" /></div>
                <h2 class="m-0">Recuperar Contraseña</h2>
                <p class="muted sx-0f9ed7">Ingresá tu usuario o email. El enlace se imprimirá en la consola del servidor.</p>
              </div>

              ${forgotSentMsg ? `
                <div class="sx-c11955">
                  ${esc(forgotSentMsg)}
                </div>
              ` : ''}

              <form id="auth-forgot-form" class="form-grid grid-1col">
                <label class="full">
                  <span>Usuario o Email</span>
                  <input type="text" id="forgot-identifier" required placeholder="Usuario o correo@empresa.com" />
                </label>
                <button type="submit" class="btn btn-primary flex-center-full">Enviar enlace de recuperación</button>
                <button type="button" class="btn btn-secondary flex-center-full" id="btn-back-login">Volver al Login</button>
              </form>
              ${dbFooterHtml()}
            </div>
          </div>
        </div>
      `;

      bindDbMgr();
      container.querySelector('#btn-back-login').addEventListener('click', () => {
        forgotSentMsg = '';
        mode = 'login';
        draw();
      });

      container.querySelector('#auth-forgot-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const res = await api('/api/auth/forgot-password', {
            method: 'POST',
            body: JSON.stringify({ identifier: container.querySelector('#forgot-identifier').value.trim() }),
          });
          forgotSentMsg = res.message || 'Enlace generado en la consola del servidor.';
          toast('Revisá la consola del servidor para abrir el enlace');
          draw();
        } catch (err) {
          toast(err.message, true);
        }
      });
      return;
    }

    if (mode === 'reset') {
      container.innerHTML = `
        <div class="auth-card">
          <div class="card">
            <div class="card-body">
              <div class="sx-b7ff7c">
                <div class="mb-sm"><img src="/favicon.svg" alt="VNG" width="52" height="52" class="sx-8a9ab5" /></div>
                <h2 class="m-0">Restablecer Contraseña</h2>
                <p class="muted sx-0f9ed7">Elegí tu nueva contraseña para ingresar.</p>
              </div>

              <form id="auth-reset-form" class="form-grid grid-1col">
                <label class="full">
                  <span>Nueva Contraseña *</span>
                  <input type="password" id="reset-pass-1" required minlength="4" autocomplete="new-password" placeholder="••••••••" />
                </label>
                <label class="full">
                  <span>Confirmar Contraseña *</span>
                  <input type="password" id="reset-pass-2" required minlength="4" autocomplete="new-password" placeholder="••••••••" />
                </label>
                <button type="submit" class="btn btn-primary flex-center-full">Guardar Nueva Contraseña</button>
                <button type="button" class="btn btn-secondary flex-center-full" id="btn-reset-to-login">Ir al Login</button>
              </form>
              ${dbFooterHtml()}
            </div>
          </div>
        </div>
      `;

      bindDbMgr();
      container.querySelector('#btn-reset-to-login').addEventListener('click', () => {
        window.history.replaceState({}, '', '/');
        mode = 'login';
        draw();
      });

      container.querySelector('#auth-reset-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const p1 = container.querySelector('#reset-pass-1').value;
        const p2 = container.querySelector('#reset-pass-2').value;
        if (p1 !== p2) {
          toast('Las contraseñas no coinciden', true);
          return;
        }
        try {
          await api('/api/auth/reset-password', {
            method: 'POST',
            body: JSON.stringify({ token: resetToken, password: p1 }),
          });
          toast('Contraseña actualizada. Ya podés iniciar sesión.');
          window.history.replaceState({}, '', '/');
          mode = 'login';
          draw();
        } catch (err) {
          toast(err.message, true);
        }
      });
      return;
    }

    container.innerHTML = `
      <div class="auth-card">
        <div class="card">
          <div class="card-body">
            <div class="sx-c3f2e8">
              <div class="mb-sm"><img src="/favicon.svg" alt="VNG" width="52" height="52" class="sx-8a9ab5" /></div>
              <h2 class="m-0">Vanguard Production</h2>
              <p class="muted sx-537dcb">Gestión de Producción · v0.1.0</p>
              <p class="muted sx-0f9ed7">Iniciá sesión o creá una cuenta para continuar</p>
            </div>

            <div class="sx-be29ac">
              <button type="button" class="btn ${mode === 'login' ? 'btn-primary' : 'btn-secondary'} sx-4b99fd" id="auth-tab-login">Iniciar Sesión</button>
              <button type="button" class="btn ${mode === 'register' ? 'btn-primary' : 'btn-secondary'} sx-4b99fd" id="auth-tab-register">Registrarse</button>
            </div>

            ${mode === 'login' && registerPendingMsg ? `
              <div class="sx-c11955">
                ${esc(registerPendingMsg)}
              </div>
            ` : ''}

            <form id="auth-form" class="form-grid grid-1col">
              <label class="full">
                <span>Usuario *</span>
                <input type="text" id="auth-username" required autocomplete="username" placeholder="Tu usuario" />
              </label>
              ${mode === 'register' ? `
                <label class="full">
                  <span>Nombre completo *</span>
                  <input type="text" id="auth-nombre" required placeholder="Ej: Juan Pérez" />
                </label>
                <label class="full">
                  <span>Email</span>
                  <input type="email" id="auth-email" placeholder="juan@empresa.com" />
                </label>
              ` : ''}
              <label class="full">
                <span>Contraseña *</span>
                <input type="password" id="auth-password" required autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" placeholder="••••••••" />
              </label>
              <button type="submit" class="btn btn-primary sx-f585b4">
                ${mode === 'login' ? 'Entrar' : 'Crear Cuenta'}
              </button>
            </form>

            ${mode === 'login' ? `
              <div class="sx-d6c6d5">
                <button type="button" id="btn-forgot-pass" class="sx-89cc90">
                  ¿Olvidaste tu contraseña?
                </button>
              </div>
            ` : `
              <div class="sx-b26cd7">
                Las cuentas nuevas quedan <strong>pendientes de habilitación</strong> por un administrador en Configuración → Usuarios y Permisos.
              </div>
            `}
            ${dbFooterHtml()}
          </div>
        </div>
      </div>
    `;

    bindDbMgr();
    container.querySelector('#auth-tab-login').addEventListener('click', () => {
      mode = 'login';
      draw();
    });
    container.querySelector('#auth-tab-register').addEventListener('click', () => {
      mode = 'register';
      draw();
    });
    container.querySelector('#btn-forgot-pass')?.addEventListener('click', () => {
      mode = 'forgot';
      draw();
    });

    container.querySelector('#auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = container.querySelector('#auth-username').value.trim();
      const password = container.querySelector('#auth-password').value;
      try {
        let res;
        if (mode === 'login') {
          res = await api('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password }),
          });
          toast(`Bienvenido, ${esc(res.user?.nombre || username)}`);
          onAuthSuccess(res.user);
        } else {
          const nombre = container.querySelector('#auth-nombre').value.trim();
          const email = container.querySelector('#auth-email').value.trim();
          res = await api('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify({ username, nombre, email, password }),
          });
          registerPendingMsg = res.message || 'Cuenta creada. Un administrador debe habilitar tu usuario antes de ingresar.';
          toast('Cuenta creada. Pendiente de habilitación.');
          mode = 'login';
          draw();
        }
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  draw();
}
