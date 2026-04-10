import type { PhenomenalChartMetric } from './competencyScores';

const BAR_W = 640;
const BAR_H = 320;
const RADAR = 360;
const PAD = 36;
const FONT = '12px system-ui, -apple-system, Segoe UI, sans-serif';
const BAR_COLOR = '#1d4ed8';
const GRID = '#cbd5e1';
const TEXT = '#334155';

function canvasToPngBuffer(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('toBlob failed'));
          return;
        }
        void blob.arrayBuffer().then(resolve, reject);
      },
      'image/png',
      0.92,
    );
  });
}

/** Горизонтальные столбцы: длина = доля от максимума по каждой метрике. */
export async function phenomenalBarChartPng(metrics: PhenomenalChartMetric[]): Promise<ArrayBuffer | null> {
  if (metrics.length === 0) return null;
  const canvas = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = BAR_W * dpr;
  canvas.height = BAR_H * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, BAR_W, BAR_H);

  const labelW = 168;
  const plotW = BAR_W - PAD - labelW - 8;
  const rowH = (BAR_H - PAD * 2) / metrics.length;

  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD + labelW, PAD);
  ctx.lineTo(PAD + labelW, BAR_H - PAD);
  ctx.stroke();

  metrics.forEach((m, i) => {
    const y = PAD + i * rowH + 6;
    const h = rowH - 12;
    ctx.fillStyle = TEXT;
    ctx.font = FONT;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const short = m.label.length > 26 ? `${m.label.slice(0, 24)}…` : m.label;
    ctx.fillText(short, PAD + labelW - 6, y + h / 2);

    const bw = Math.max(0, plotW * m.pct);
    ctx.fillStyle = BAR_COLOR;
    ctx.fillRect(PAD + labelW + 4, y, bw, h);

    ctx.fillStyle = TEXT;
    ctx.textAlign = 'left';
    ctx.fillText(`${m.value.toFixed(m.max <= 1 ? 2 : 2)} / ${m.max}`, PAD + labelW + 8 + bw + 6, y + h / 2);
  });

  ctx.fillStyle = TEXT;
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Баллы по метрикам (доля от макс. по опроснику)', PAD, 20);

  return canvasToPngBuffer(canvas);
}

/** Радар по нормализованным долям (0–1). */
export async function phenomenalRadarChartPng(metrics: PhenomenalChartMetric[]): Promise<ArrayBuffer | null> {
  if (metrics.length < 3) return null;
  const canvas = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = RADAR * dpr;
  canvas.height = RADAR * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, RADAR, RADAR);

  const cx = RADAR / 2;
  const cy = RADAR / 2 + 8;
  const R = RADAR / 2 - PAD - 10;
  const n = metrics.length;
  const tau = (Math.PI * 2) / n;

  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  for (let ring = 1; ring <= 4; ring++) {
    const rr = (R * ring) / 4;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = -Math.PI / 2 + i * tau;
      const x = cx + rr * Math.cos(a);
      const y = cy + rr * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + i * tau;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a));
    ctx.stroke();
  }

  ctx.beginPath();
  metrics.forEach((m, i) => {
    const a = -Math.PI / 2 + i * tau;
    const rr = R * Math.min(1, m.pct);
    const x = cx + rr * Math.cos(a);
    const y = cy + rr * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = 'rgba(99, 102, 241, 0.28)';
  ctx.fill();
  ctx.strokeStyle = BAR_COLOR;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.font = '10px system-ui, sans-serif';
  ctx.fillStyle = TEXT;
  metrics.forEach((m, i) => {
    const a = -Math.PI / 2 + i * tau;
    const lr = R + 18;
    const x = cx + lr * Math.cos(a);
    const y = cy + lr * Math.sin(a);
    const t = m.label.length > 18 ? `${m.label.slice(0, 16)}…` : m.label;
    ctx.textAlign = x >= cx ? 'left' : 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(t, x, y);
  });

  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Радар (доля от максимума)', cx, 16);

  return canvasToPngBuffer(canvas);
}
