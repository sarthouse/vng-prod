let onUnauthorizedCb = null;
export function setOnUnauthorized(cb) {
  onUnauthorizedCb = cb;
}

export async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.startsWith('/api/auth/') && typeof onUnauthorizedCb === 'function') {
    onUnauthorizedCb();
  }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

export function toast(msg, isError = false) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${isError ? 'error' : ''}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

export async function refreshKPIs() {
  try {
    const [dash, pend] = await Promise.all([
      api('/api/dashboard'),
      api('/api/pendientes'),
    ]);
    const elOrd = document.getElementById('kpi-ordenes');
    const elSaldo = document.getElementById('kpi-saldo');
    const elPend = document.getElementById('kpi-pendientes');
    if (elOrd) elOrd.textContent = Number(dash.produccion?.ordenes_activas || 0).toLocaleString('es-AR');
    if (elSaldo) elSaldo.textContent = '$' + Number(dash.tesoreria?.saldo_total || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    const totalPend = Array.isArray(pend)
      ? pend.filter(p => p.total > 0).reduce((a, p) => a + p.total, 0)
      : Number(pend?.total_entregas_unidades || 0);
    if (elPend) elPend.textContent = Number(totalPend).toLocaleString('es-AR');
  } catch {
    // Ignore background KPI errors
  }
}
