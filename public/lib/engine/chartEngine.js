import { esc, fmtNum } from '../format.js';

/**
 * Motor de Gráficos SVG Nativos para Flujos, Evolución de Saldos (Curva Diente de Sierra) y Barras de Entradas/Salidas.
 */
export function renderComboFlowChart(container, {
  series = [],
  formatValue = (v) => fmtNum(v),
  unitLabel = '',
  title = '',
  subtitle = '',
  showMinLine = true,
  emptyText = 'Sin datos suficientes para graficar.',
} = {}) {
  if (!container) return;
  if (!Array.isArray(series) || series.length === 0) {
    container.innerHTML = `<div class="empty-state">${esc(emptyText)}</div>`;
    return;
  }

  const W = 920;
  const H = 320;
  const padL = 62;
  const padR = 28;
  const padT = 26;
  const padB = 54;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const allVals = [0];
  for (const s of series) {
    allVals.push(Number(s.entradas || 0));
    allVals.push(-Math.abs(Number(s.salidas || 0)));
    allVals.push(Number(s.saldo || 0));
    if (showMinLine && Number(s.minimo || 0) > 0) {
      allVals.push(Number(s.minimo || 0));
    }
  }

  let minVal = Math.min(...allVals);
  let maxVal = Math.max(...allVals);
  if (minVal === maxVal) {
    maxVal = minVal + 10;
    minVal = Math.min(0, minVal - 2);
  } else {
    const span = maxVal - minVal;
    maxVal += span * 0.12;
    if (minVal < 0) minVal -= span * 0.1;
  }

  const valToY = (v) => {
    const ratio = (v - minVal) / (maxVal - minVal || 1);
    return padT + plotH - ratio * plotH;
  };

  const zeroY = valToY(0);
  const stepX = plotW / series.length;
  const colCenter = (idx) => padL + stepX * idx + stepX / 2;

  // Grilla horizontal (5 marcas)
  const ticks = 5;
  const gridLines = [];
  for (let i = 0; i <= ticks; i++) {
    const val = minVal + ((maxVal - minVal) * i) / ticks;
    const y = valToY(val);
    gridLines.push({ val, y });
  }

  // Puntos de la línea de saldo
  const pts = series.map((s, i) => ({
    x: colCenter(i),
    y: valToY(Number(s.saldo || 0)),
    raw: s,
    idx: i,
  }));

  const currentIdx = series.findIndex(s => s.isCurrent);
  const splitIdx = currentIdx >= 0 ? currentIdx : series.length - 1;

  const histPts = pts.slice(0, splitIdx + 1);
  const proyPts = pts.slice(Math.max(0, splitIdx));

  const buildPath = (arr) => arr.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const buildArea = (arr) => {
    if (arr.length < 2) return '';
    return `${buildPath(arr)} L ${arr[arr.length - 1].x.toFixed(1)} ${zeroY.toFixed(1)} L ${arr[0].x.toFixed(1)} ${zeroY.toFixed(1)} Z`;
  };

  const minRef = Number(series[0]?.minimo || 0);
  const minY = showMinLine && minRef > 0 ? valToY(minRef) : null;
  const barW = Math.max(8, Math.min(22, stepX * 0.26));

  container.innerHTML = `
    <div class="ve-chart-card">
      ${title ? `
        <div class="ve-chart-head">
          <div>
            <strong>${esc(title)}</strong>
            ${subtitle ? `<div class="muted sx-6b9c17">${esc(subtitle)}</div>` : ''}
          </div>
          <div class="ve-chart-legend">
            <span><i class="ve-chart-swatch sx-d92dad"></i> Entradas (+)</span>
            <span><i class="ve-chart-swatch sx-aa7ca4"></i> Salidas (-)</span>
            <span><i class="ve-chart-swatch sx-00f4c1"></i> Saldo Real</span>
            <span><i class="ve-chart-swatch sx-15ed7a"></i> Saldo Proyectado</span>
            ${minY !== null ? `<span><i class="ve-chart-swatch sx-cc9199"></i> Stock Mínimo (${formatValue(minRef)}${unitLabel ? ' ' + esc(unitLabel) : ''})</span>` : ''}
          </div>
        </div>
      ` : ''}
      <div class="ve-chart-svg-wrap">
        <svg viewBox="0 0 ${W} ${H}" class="ve-chart-svg" role="img" aria-label="${esc(title || 'Gráfico de flujo')}">
          <defs>
            <linearGradient id="veAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#2563eb" stop-opacity="0.18"/>
              <stop offset="100%" stop-color="#2563eb" stop-opacity="0.01"/>
            </linearGradient>
          </defs>

          <!-- Fondo sombreado para zona proyectada -->
          ${currentIdx >= 0 && currentIdx < series.length - 1 ? `
            <rect x="${(padL + stepX * (currentIdx + 0.5)).toFixed(1)}" y="${padT}" width="${(plotW - stepX * (currentIdx + 0.5)).toFixed(1)}" height="${plotH}" fill="#f8fafc" />
          ` : ''}

          <!-- Líneas de grilla horizontal -->
          ${gridLines.map(g => `
            <g>
              <line x1="${padL}" y1="${g.y.toFixed(1)}" x2="${W - padR}" y2="${g.y.toFixed(1)}" stroke="#e2e8f0" stroke-dasharray="${Math.abs(g.val) < 0.001 ? 'none' : '3,3'}" stroke-width="${Math.abs(g.val) < 0.001 ? '1.4' : '1'}" />
              <text x="${padL - 8}" y="${(g.y + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#64748b">${esc(formatValue(Number(g.val.toFixed(1))))}</text>
            </g>
          `).join('')}

          <!-- Línea vertical divisoria Período Actual -->
          ${currentIdx >= 0 ? `
            <g>
              <line x1="${colCenter(currentIdx).toFixed(1)}" y1="${padT}" x2="${colCenter(currentIdx).toFixed(1)}" y2="${padT + plotH}" stroke="#3b82f6" stroke-dasharray="4,3" stroke-width="1.5" />
              <text x="${colCenter(currentIdx).toFixed(1)}" y="${padT - 8}" text-anchor="middle" font-size="10" font-weight="600" fill="#1d4ed8">Actual</text>
            </g>
          ` : ''}

          <!-- Umbral de Stock Mínimo -->
          ${minY !== null ? `
            <g>
              <line x1="${padL}" y1="${minY.toFixed(1)}" x2="${W - padR}" y2="${minY.toFixed(1)}" stroke="#d97706" stroke-dasharray="6,4" stroke-width="1.6" />
              <text x="${W - padR - 4}" y="${(minY - 5).toFixed(1)}" text-anchor="end" font-size="10" font-weight="600" fill="#b45309">Mín: ${esc(formatValue(minRef))}</text>
            </g>
          ` : ''}

          <!-- Barras de Entradas (+) y Salidas (-) por período -->
          ${series.map((s, i) => {
            const cx = colCenter(i);
            const ent = Math.max(0, Number(s.entradas || 0));
            const sal = Math.max(0, Number(s.salidas || 0));
            const yEnt = valToY(ent);
            const hEnt = Math.max(0, zeroY - yEnt);
            const ySal = valToY(-sal);
            const hSal = Math.max(0, ySal - zeroY);
            const opacity = s.kind === 'proyectado' ? '0.62' : '0.85';
            return `
              <g>
                ${ent > 0 ? `<rect x="${(cx - barW - 1).toFixed(1)}" y="${yEnt.toFixed(1)}" width="${barW.toFixed(1)}" height="${hEnt.toFixed(1)}" rx="2" fill="#16a34a" fill-opacity="${opacity}"><title>${esc(s.label)} · Entradas: +${esc(formatValue(ent))} ${esc(unitLabel)}</title></rect>` : ''}
                ${sal > 0 ? `<rect x="${(cx + 1).toFixed(1)}" y="${zeroY.toFixed(1)}" width="${barW.toFixed(1)}" height="${hSal.toFixed(1)}" rx="2" fill="#dc2626" fill-opacity="${opacity}"><title>${esc(s.label)} · Salidas: -${esc(formatValue(sal))} ${esc(unitLabel)}</title></rect>` : ''}
              </g>
            `;
          }).join('')}

          <!-- Área y curva de Saldo Acumulado -->
          ${histPts.length >= 2 ? `<path d="${buildArea(histPts)}" fill="url(#veAreaGrad)" />` : ''}
          ${histPts.length >= 2 ? `<path d="${buildPath(histPts)}" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />` : ''}
          ${proyPts.length >= 2 ? `<path d="${buildPath(proyPts)}" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-dasharray="6,4" stroke-linecap="round" stroke-linejoin="round" />` : ''}

          <!-- Nodos de Saldo y etiquetas X -->
          ${pts.map(p => {
            const val = Number(p.raw.saldo || 0);
            const isAlert = val < 0 || (minRef > 0 && val <= minRef);
            const dotColor = isAlert ? '#dc2626' : '#2563eb';
            return `
              <g>
                <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${isAlert ? '5' : '4'}" fill="${p.raw.kind === 'proyectado' ? '#fff' : dotColor}" stroke="${dotColor}" stroke-width="2.2">
                  <title>${esc(p.raw.label)} (${esc(p.raw.sublabel || '')}) · Saldo Cierre: ${esc(formatValue(val))} ${esc(unitLabel)}</title>
                </circle>
                <text x="${p.x.toFixed(1)}" y="${(p.y - 8).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="600" fill="${isAlert ? '#dc2626' : '#1e293b'}">${esc(formatValue(val))}</text>
                <text x="${p.x.toFixed(1)}" y="${H - 26}" text-anchor="middle" font-size="10" font-weight="${p.raw.isCurrent ? '700' : '500'}" fill="${p.raw.isCurrent ? '#1d4ed8' : '#475569'}">${esc(p.raw.label)}</text>
                <text x="${p.x.toFixed(1)}" y="${H - 12}" text-anchor="middle" font-size="9" fill="#94a3b8">${esc(p.raw.sublabel || '')}</text>
              </g>
            `;
          }).join('')}
        </svg>
      </div>
    </div>
  `;
}
