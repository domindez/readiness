import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Filler,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  type ChartConfiguration,
  type Plugin,
  type ScriptableContext,
} from 'chart.js';
import type { SeriesPayload } from './trends';

Chart.register(LineController, LineElement, PointElement, BarController, BarElement, LinearScale, CategoryScale, Filler, Tooltip);

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const shortDate = (iso: string) => (iso ? `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}` : '');
const longDate = (iso: string) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';

const ZONE_LABEL: Record<string, string> = { green: 'Listo', amber: 'Precaución', red: 'Recuperación', none: '' };

/** Línea vertical de guía en el punto activo (crosshair). */
const crosshair: Plugin = {
  id: 'crosshair',
  afterDatasetsDraw(chart) {
    const active = chart.tooltip?.getActiveElements();
    if (!active?.length) return;
    const x = active[0].element.x;
    const { top, bottom } = chart.chartArea;
    const ctx = chart.ctx;
    ctx.save();
    ctx.strokeStyle = css('--border-strong');
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.restore();
  },
};

function areaGradient(color: string) {
  return (ctx: ScriptableContext<'line'>) => {
    const { chart } = ctx;
    const area = chart.chartArea;
    if (!area) return 'transparent';
    const g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
    g.addColorStop(0, color);
    g.addColorStop(1, 'transparent');
    return g;
  };
}

export function buildChart(canvas: HTMLCanvasElement, labels: string[], s: SeriesPayload, large = false): Chart {
  const line = css('--chart-line');
  const avg = css('--chart-avg');
  const band = css('--chart-band');
  const fill = css('--chart-fill');
  const grid = css('--chart-grid');
  const muted = css('--muted');
  const surface = css('--surface');
  const text = css('--text');
  const border = css('--border');
  const zoneColor: Record<string, string> = { green: css('--green'), amber: css('--amber'), red: css('--red'), none: css('--surface-3') };
  const showPoints = labels.length <= (large ? 31 : 14);
  const font = { family: css('--font'), size: 11 };

  const datasets: ChartConfiguration['data']['datasets'] = [];
  if (s.bandLo && s.bandHi) {
    datasets.push(
      { type: 'line', label: 'Base −1 DE', data: s.bandLo, borderWidth: 0, pointRadius: 0, pointHitRadius: 0, fill: false, spanGaps: true, order: 3 },
      {
        type: 'line',
        label: 'Base +1 DE',
        data: s.bandHi,
        borderWidth: 0,
        pointRadius: 0,
        pointHitRadius: 0,
        backgroundColor: band,
        fill: '-1',
        spanGaps: true,
        order: 3,
      },
    );
  }
  if (s.kind === 'readiness') {
    datasets.push({
      type: 'bar',
      label: s.label,
      data: s.values,
      backgroundColor: (s.zones ?? []).map((z) => zoneColor[z] ?? zoneColor.none),
      hoverBackgroundColor: (s.zones ?? []).map((z) => zoneColor[z] ?? zoneColor.none),
      borderRadius: { topLeft: 4, topRight: 4 },
      borderSkipped: 'bottom',
      categoryPercentage: 0.86,
      barPercentage: 0.92,
      order: 2,
    });
  } else {
    datasets.push({
      type: 'line',
      label: s.label,
      data: s.values,
      borderColor: line,
      backgroundColor: areaGradient(fill),
      fill: s.bandLo ? false : 'origin',
      borderWidth: labels.length > 45 ? 1.5 : 2,
      pointRadius: showPoints ? 4 : 0,
      pointBackgroundColor: line,
      pointBorderColor: surface,
      pointBorderWidth: 2,
      pointHoverRadius: 6,
      pointHoverBorderWidth: 2,
      pointHoverBackgroundColor: line,
      pointHoverBorderColor: surface,
      pointHitRadius: 12,
      cubicInterpolationMode: 'monotone',
      spanGaps: true,
      order: 2,
    });
  }
  datasets.push({
    type: 'line',
    label: 'Media 7 d',
    data: s.ma7,
    borderColor: avg,
    borderWidth: 2,
    borderDash: s.kind === 'readiness' ? [] : [5, 4],
    pointRadius: 0,
    pointHoverRadius: 0,
    pointHitRadius: 0,
    cubicInterpolationMode: 'monotone',
    spanGaps: true,
    order: 1,
  });

  const fixed = s.min !== undefined && s.max !== undefined;

  return new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    plugins: [crosshair],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500, easing: 'easeOutQuart' },
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 4 } },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: muted,
            font,
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: large ? 10 : 4,
            callback: (_, i) => shortDate(labels[i]),
          },
        },
        y: {
          min: s.min,
          max: s.max,
          position: 'right',
          grid: { color: grid, drawTicks: false },
          border: { display: false },
          ticks: {
            color: muted,
            font,
            padding: 8,
            maxTicksLimit: large ? 7 : 4,
            precision: s.kind === 'question' ? 0 : undefined,
            stepSize: s.kind === 'question' ? 1 : undefined,
          },
          // Margen del 12 % alrededor de los datos, sin salirse de los límites de la métrica.
          afterDataLimits: (scale) => {
            if (fixed) return;
            const pad = (scale.max - scale.min || Math.abs(scale.max) * 0.1 || 1) * 0.12;
            scale.min = scale.min - pad;
            scale.max = scale.max + pad;
            if (s.floor !== undefined) scale.min = Math.max(scale.min, s.floor);
            if (s.ceil !== undefined) scale.max = Math.min(scale.max, s.ceil);
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: surface,
          titleColor: text,
          bodyColor: text,
          footerColor: muted,
          borderColor: border,
          borderWidth: 1,
          padding: 10,
          cornerRadius: 12,
          boxPadding: 4,
          usePointStyle: true,
          titleFont: { family: css('--font'), size: 12, weight: 600 },
          bodyFont: { family: css('--font'), size: 12 },
          footerFont: { family: css('--font'), size: 11, weight: 400 },
          filter: (item) => !String(item.dataset.label).startsWith('Base') && item.raw !== null,
          callbacks: {
            title: (items) => longDate(labels[items[0].dataIndex]),
            label: (item) => {
              const zone = s.kind === 'readiness' && item.dataset.type === 'bar' ? s.zones?.[item.dataIndex] : undefined;
              return ` ${item.dataset.label}: ${item.formattedValue}${zone && ZONE_LABEL[zone] ? ` · ${ZONE_LABEL[zone]}` : ''}`;
            },
            labelPointStyle: () => ({ pointStyle: 'circle', rotation: 0 }),
            footer: (items) => {
              const i = items[0]?.dataIndex;
              if (i === undefined || s.bandLo?.[i] == null || s.bandHi?.[i] == null) return '';
              return `Tu rango normal: ${s.bandLo[i]} – ${s.bandHi[i]}`;
            },
          },
        },
      },
    },
  });
}
