import { escapeHtml } from "./ui.js";

// A small single-series line chart as an inline SVG string (no library: the
// app has no dependencies and must work offline). One series, so no legend —
// the title says what is plotted. The readout line under the title shows one
// point's value: the latest by default, or whichever point is hovered/tapped
// (handleChartPoint, attached once in main.js). The history rows under the
// charts are the table view of the same data.
const W = 320, H = 96, PAD_X = 6, PAD_TOP = 8, PAD_BOTTOM = 6;

export function renderLineChart(title, unit, points) {
  const values = points.map((p) => p.value);
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const x = (i) => PAD_X + (i * (W - 2 * PAD_X)) / (points.length - 1);
  const y = (v) => PAD_TOP + (1 - (v - min) / span) * (H - PAD_TOP - PAD_BOTTOM);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  const last = points.length - 1;
  const step = (W - 2 * PAD_X) / last;
  const fmt = (v) => `${Math.round(v * 10) / 10} ${unit}`;
  const readout = (p) => `${fmt(p.value)} · ${p.label}`;

  return `<figure class="chart">
    <figcaption>
      <span class="chart-title">${escapeHtml(title)}</span>
      <span class="chart-readout" data-default="${escapeHtml(readout(points[last]))}">${escapeHtml(readout(points[last]))}</span>
    </figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(`${title}: ${fmt(points[0].value)} on ${points[0].label} to ${fmt(points[last].value)} on ${points[last].label}`)}">
      <line class="chart-grid" x1="0" x2="${W}" y1="${y(max)}" y2="${y(max)}"/>
      <line class="chart-grid" x1="0" x2="${W}" y1="${y(min)}" y2="${y(min)}"/>
      <path class="chart-area" d="${line} L${x(last)} ${H} L${x(0)} ${H} Z"/>
      <path class="chart-line" d="${line}"/>
      ${points.map((p, i) => {
        // Hit area: half a step to each side, kept inside the chart (the svg
        // shows overflow, so a wider one would cover the chart next to it).
        const left = Math.max(0, x(i) - step / 2), right = Math.min(W, x(i) + step / 2);
        return `<g class="chart-point ${i === last ? "is-last" : ""}" data-chart-point data-readout="${escapeHtml(readout(p))}">
        <rect x="${left.toFixed(1)}" y="0" width="${(right - left).toFixed(1)}" height="${H}"/>
        <circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="5"/>
      </g>`;
      }).join("")}
    </svg>
    <div class="chart-axis muted"><span>${escapeHtml(points[0].label)}</span><span>${min === max ? fmt(min) : `${fmt(min)} – ${fmt(max)}`}</span><span>${escapeHtml(points[last].label)}</span></div>
  </figure>`;
}

// Delegated pointerover/pointerout/click: show the hovered or tapped point's
// value in the chart's readout and mark it. A mouse leaving the chart
// restores the latest value; a lifted finger also fires pointerout, and
// there the tapped value stays.
export function handleChartPoint(e) {
  const chart = e.target.closest(".chart");
  if (!chart) return;
  let point = e.target.closest("[data-chart-point]");
  if (e.type === "pointerout") {
    if (e.pointerType !== "mouse" || chart.contains(e.relatedTarget)) return;
    point = null;
  }
  const readout = chart.querySelector(".chart-readout");
  chart.querySelectorAll(".chart-point.active").forEach((p) => p.classList.remove("active"));
  if (point) point.classList.add("active");
  readout.textContent = point ? point.dataset.readout : readout.dataset.default;
}
