export async function openPdfFromEndpoint(endpoint, payload = {}, downloadName = 'comprobante.pdf') {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Error al generar PDF (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function printRemito(payload = {}) {
  const safeName = String(payload.numero || 'remito').replace(/[^a-zA-Z0-9_-]+/g, '_');
  return openPdfFromEndpoint('/api/print/remito-pdf', payload, `Remito_${safeName}.pdf`);
}
