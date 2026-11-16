let onUnauthorizedCb = null;
export function setOnUnauthorized(cb) {
  onUnauthorizedCb = cb;
}

export async function api(url, options = {}) {
  const opts = { ...options };
  if (
    opts.body &&
    typeof opts.body === 'object' &&
    !(opts.body instanceof FormData) &&
    !(opts.body instanceof Blob) &&
    !(opts.body instanceof ArrayBuffer)
  ) {
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
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
    const [dash, pend, cotiz] = await Promise.all([
      api('/api/dashboard'),
      api('/api/pendientes'),
      api('/api/fiscal/cotizaciones').catch(() => []),
    ]);
    const elOrd = document.getElementById('kpi-ordenes');
    const elSaldo = document.getElementById('kpi-saldo');
    const elPend = document.getElementById('kpi-pendientes');
    const elUsd = document.getElementById('kpi-usd');
    if (elOrd) elOrd.textContent = Number(dash.produccion?.ordenes_activas || 0).toLocaleString('es-AR');
    if (elSaldo) elSaldo.textContent = '$' + Number(dash.tesoreria?.saldo_total || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    const totalPend = Array.isArray(pend)
      ? pend.filter(p => p.total > 0).reduce((a, p) => a + p.total, 0)
      : Number(pend?.total_entregas_unidades || 0);
    if (elPend) elPend.textContent = Number(totalPend).toLocaleString('es-AR');
    if (elUsd) {
      const usdRow = Array.isArray(cotiz) ? cotiz.find(c => String(c.moneda || '').toUpperCase() === 'USD') : null;
      elUsd.textContent = usdRow && Number(usdRow.cotizacion) > 0
        ? '$' + Number(usdRow.cotizacion).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
        : '-';
    }
  } catch {
    // Ignore background KPI errors
  }
}
