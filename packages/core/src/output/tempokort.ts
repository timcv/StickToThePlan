/**
 * Tempokort output: render race plan as GitHub-flavored Markdown and
 * print-friendly standalone HTML for the Vatternrundan race-plan calculator.
 *
 * Spec reference: design doc section 12.1.
 */

import type { DisplaySegment, Config } from '../types.js';
import type { ThreeScenarios } from '../planner.js';
import { secondsToClock } from '../util/time.js';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/**
 * Format a duration in seconds as H:MM:SS (zero-padded minutes and seconds).
 * Examples: 42300 -> "11:45:00", 3661 -> "1:01:01"
 */
function secondsToHms(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/**
 * Build the three-scenario summary line.
 * Format: "Optimistisk H:MM:SS vid X W, Förväntad H:MM:SS vid Y W, Pessimistisk H:MM:SS vid Z W"
 * Swedish words from the spec, full diacritics preserved. The only formatting rule is no em dash.
 */
function buildScenarioLine(scenarios: ThreeScenarios): string {
  const opt = `Optimistisk ${secondsToHms(scenarios.optimistic.total_time_s)} vid ${Math.round(scenarios.optimistic.np_target_used)} W`;
  const exp = `Förväntad ${secondsToHms(scenarios.expected.total_time_s)} vid ${Math.round(scenarios.expected.np_target_used)} W`;
  const pes = `Pessimistisk ${secondsToHms(scenarios.pessimistic.total_time_s)} vid ${Math.round(scenarios.pessimistic.np_target_used)} W`;
  return `${opt}, ${exp}, ${pes}`;
}

// ---------------------------------------------------------------------------
// Row data builder
// ---------------------------------------------------------------------------

interface RowData {
  fromTo: string;
  town: string;
  eta: string;
  distance: string;
  height: string;
  gradient: string;
  wind: string;
  pullW: string;
  avgW: string;
  note: string;
  stop: string;
}

function buildRow(seg: DisplaySegment, startTime: string): RowData {
  const fromTo = `${seg.from_km}-${seg.to_km}`;
  const town = seg.town ?? '';
  const eta = secondsToClock(seg.eta_s, startTime);
  const distance = (seg.distance_m / 1000).toFixed(1);
  const netH = Math.round(seg.net_height_m);
  const height = netH >= 0 ? `+${netH}` : `${netH}`;
  const gradient = `${(seg.avg_grade * 100).toFixed(1)}%`;
  const wind = seg.wind_label;
  const pullW = `${seg.pull_w_low}-${seg.pull_w_high}`;
  const avgW = String(seg.avg_w);
  const note = seg.note;

  let stop = '';
  if (seg.stop_minutes !== undefined && seg.depart_s !== undefined) {
    const departClock = secondsToClock(seg.depart_s, startTime);
    stop = `${seg.stop_minutes} min, avg ${departClock}`;
  }

  return { fromTo, town, eta, distance, height, gradient, wind, pullW, avgW, note, stop };
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const COLUMNS = [
  'From-to (km)',
  'Town',
  'ETA',
  'Distance (km)',
  'Height (m)',
  'Gradient',
  'Wind',
  'Pull W',
  'Avg W',
  'Note',
  'Stop',
] as const;

function rowToArray(row: RowData): string[] {
  return [
    row.fromTo,
    row.town,
    row.eta,
    row.distance,
    row.height,
    row.gradient,
    row.wind,
    row.pullW,
    row.avgW,
    row.note,
    row.stop,
  ];
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

/**
 * Render the tempokort as GitHub-flavored Markdown.
 * Header section uses #, ##, and a paragraph (not a table).
 * Table is a GFM pipe table.
 */
export function renderMarkdown(
  scenarios: ThreeScenarios,
  displaySegments: DisplaySegment[],
  cfg: Config,
): string {
  const lines: string[] = [];

  // Header section
  lines.push('# Vätternrundan Raceplan');
  lines.push('');
  lines.push(`## ${cfg.race_date}`);
  lines.push('');
  lines.push(`Start: ${cfg.start_time}  |  Mål: ${cfg.target_total_hm}`);
  lines.push('');
  lines.push(buildScenarioLine(scenarios));
  lines.push('');

  // Table header
  const header = `| ${COLUMNS.join(' | ')} |`;
  const separator = `| ${COLUMNS.map(() => '---').join(' | ')} |`;
  lines.push(header);
  lines.push(separator);

  // Table rows
  for (const seg of displaySegments) {
    const row = buildRow(seg, cfg.start_time);
    const cells = rowToArray(row);
    lines.push(`| ${cells.join(' | ')} |`);
  }

  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// HTML renderer
// ---------------------------------------------------------------------------

/**
 * Escape characters with special meaning in HTML.
 */
function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const HTML_STYLE = `
  * { box-sizing: border-box; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 11pt;
    margin: 1cm;
    color: #111;
  }
  h1 { font-size: 16pt; margin-bottom: 4px; }
  h2 { font-size: 13pt; margin: 0 0 6px; }
  p { margin: 4px 0; }
  .scenarios { margin-bottom: 14px; font-size: 10pt; color: #333; }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 9pt;
    page-break-inside: auto;
  }
  thead tr { background: #2a5095; color: #fff; }
  thead th {
    padding: 5px 7px;
    text-align: left;
    font-weight: bold;
    border: 1px solid #1a3a75;
    white-space: nowrap;
  }
  tbody tr:nth-child(even) { background: #f0f4ff; }
  tbody tr:nth-child(odd) { background: #fff; }
  tbody td {
    padding: 4px 7px;
    border: 1px solid #ccc;
    vertical-align: top;
  }
  tr { page-break-inside: avoid; }
  @media print {
    body { margin: 0.5cm; }
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
  }
  @page {
    size: A4;
    margin: 1cm;
  }
`.trim();

const STYRKORT_STYLE = `
  * { box-sizing: border-box; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 7.5pt;
    margin: 4mm;
    color: #111;
  }
  h1 { font-size: 9pt; margin: 0 0 2px; }
  p { margin: 1px 0; font-size: 7pt; color: #444; }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 7pt;
  }
  thead tr { background: #2a5095; color: #fff; }
  thead th {
    padding: 3px 4px;
    text-align: left;
    font-weight: bold;
    border: 1px solid #1a3a75;
    white-space: nowrap;
  }
  tbody tr:nth-child(even) { background: #f0f4ff; }
  tbody tr:nth-child(odd) { background: #fff; }
  tbody tr.stop-row { background: #fff3cd; font-weight: bold; }
  tbody td {
    padding: 2px 4px;
    border: 1px solid #ccc;
  }
  td.num { text-align: right; }
  tr { page-break-inside: avoid; }
  @media print {
    body { margin: 3mm; }
    thead { display: table-header-group; }
  }
  @page {
    size: A6;
    margin: 4mm;
  }
`.trim();

/**
 * Render a compact A6-sized handlebar card as a standalone HTML document.
 * Columns: Sträcka, Ort, km/h, Ankomst, Avgång, W.
 */
export function buildStyrkortHtml(
  displaySegments: DisplaySegment[],
  cfg: Config,
): string {
  const title = escHtml(`Vätternrundan ${cfg.race_date} – Start ${cfg.start_time} – Mål ${cfg.target_total_hm}`);

  const rows = displaySegments.map(seg => {
    const stracka = escHtml(`${seg.from_km}-${seg.to_km}`);
    const ort = escHtml(seg.town ?? '');
    const kmh = seg.avg_speed_kmh > 0 ? String(Math.round(seg.avg_speed_kmh)) : '';
    const ankomst = escHtml(secondsToClock(seg.eta_s, cfg.start_time));
    const avgang = seg.depart_s !== undefined
      ? escHtml(secondsToClock(seg.depart_s, cfg.start_time))
      : '';
    const w = seg.avg_w > 0 ? String(seg.avg_w) : '';
    const rowClass = seg.stop_minutes !== undefined && seg.stop_minutes > 0 ? ' class="stop-row"' : '';
    return `    <tr${rowClass}>\n      <td>${stracka}</td><td>${ort}</td><td class="num">${kmh}</td><td class="num">${ankomst}</td><td class="num">${avgang}</td><td class="num">${w}</td>\n    </tr>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="UTF-8">
  <title>Styrkortet ${escHtml(cfg.race_date)}</title>
  <style>
    ${STYRKORT_STYLE}
  </style>
</head>
<body>
  <h1>Styrkortet</h1>
  <p>${title}</p>
  <table>
    <thead>
      <tr>
        <th>Km</th>
        <th>Ort</th>
        <th>km/h</th>
        <th>Ankomst</th>
        <th>Avg&aring;ng</th>
        <th>W</th>
      </tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
</body>
</html>`;
}

/**
 * Render the tempokort as a complete standalone HTML document
 * suitable for A4 printing.
 */
export function renderHtml(
  scenarios: ThreeScenarios,
  displaySegments: DisplaySegment[],
  cfg: Config,
): string {
  const scenarioLine = escHtml(buildScenarioLine(scenarios));
  const startInfo = escHtml(`Start: ${cfg.start_time}  |  Mål: ${cfg.target_total_hm}`);

  const thCells = COLUMNS.map(c => `<th>${escHtml(c)}</th>`).join('\n        ');

  const tdRows = displaySegments.map(seg => {
    const row = buildRow(seg, cfg.start_time);
    const cells = rowToArray(row);
    const tds = cells.map(c => `<td>${escHtml(c)}</td>`).join('\n        ');
    return `    <tr>\n        ${tds}\n    </tr>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vätternrundan Raceplan ${escHtml(cfg.race_date)}</title>
  <style>
    ${HTML_STYLE}
  </style>
</head>
<body>
  <h1>Vätternrundan Raceplan</h1>
  <h2>${escHtml(cfg.race_date)}</h2>
  <p>${startInfo}</p>
  <p class="scenarios">${scenarioLine}</p>
  <table>
    <thead>
      <tr>
        ${thCells}
      </tr>
    </thead>
    <tbody>
${tdRows}
    </tbody>
  </table>
</body>
</html>`;
}
