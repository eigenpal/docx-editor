// Render an edit-bench JSON report (plus an optional baseline report) as the
// markdown body of the sticky PR comment posted by .github/workflows/bench.yml.
//
// Wall-clock numbers come from a shared CI runner, so the comment is advisory:
// it flags regressions but never fails the job. The deterministic gate stays in
// scripts/bench/edit-bench-gates.test.ts, which pins the work counters exactly.
//
// Usage: node scripts/bench/edit-bench-comment.mjs --head head.json [--base base.json] --out comment.md

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const COMMENT_MARKER = '<!-- edit-bench-report -->';

const REGRESSION_WARN_PCT = 20;

// GitHub caps issue comment bodies at 65536 characters; leave room for the
// wrapper text around the <details> payloads.
const MAX_COMMENT_CHARS = 60_000;

function parseArgs(argv) {
  let head;
  let base;
  let out;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--head') head = argv[++index];
    else if (value === '--base') base = argv[++index];
    else if (value === '--out') out = argv[++index];
    else throw new Error(`unknown argument: ${value}`);
  }
  if (!head) throw new Error('--head <report.json> is required');
  if (!out) throw new Error('--out <comment.md> is required');
  return { head, base, out };
}

function readReport(path) {
  const report = JSON.parse(readFileSync(path, 'utf8'));
  const shapeOk =
    report.schema === 1 &&
    Array.isArray(report.scenarios) &&
    report.scenarios.every((scenario) => Number.isFinite(scenario?.total?.medianMs));
  if (!shapeOk) throw new Error(`${path}: not an edit-bench schema-1 report`);
  return report;
}

function formatMs(value) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)} ms` : 'n/a';
}

// Within this band a delta is runner noise, not a signal — shown neutral.
const NOISE_BAND_PCT = 5;

function formatDelta(baseMs, headMs) {
  if (!Number.isFinite(baseMs) || !Number.isFinite(headMs)) return 'n/a';
  if (baseMs === 0) return headMs === 0 ? '⚪ ±0%' : 'n/a';
  const pct = Number((((headMs - baseMs) / baseMs) * 100).toFixed(1));
  const text = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  if (pct > REGRESSION_WARN_PCT) return `🔴 ${text} ⚠️`;
  if (pct > NOISE_BAND_PCT) return `🔴 ${text}`;
  if (pct < -NOISE_BAND_PCT) return `🟢 ${text}`;
  return `⚪ ${text}`;
}

/** Compact x-axis labels for the chart; the table above carries the full names. */
const SCENARIO_SHORT_LABELS = new Map([
  ['steady-middle-text', 'steady'],
  ['wrap-middle-text', 'wrap'],
  ['forced-middle-reflow', 'reflow-mid'],
  ['forced-early-reflow', 'reflow-early'],
]);

function shortLabel(name) {
  return SCENARIO_SHORT_LABELS.get(name) ?? name.slice(0, 14);
}

/**
 * Grouped comparison as a mermaid chart (GitHub renders these natively in comments).
 * Mermaid overlays multiple bar series at full width — it has no native grouped bars —
 * so the pairing is built from categories instead: each scenario contributes two
 * adjacent x slots, baseline then PR, and each series holds zeros in the other's slots
 * (a zero-height bar draws nothing). The result is a literal gray-next-to-blue pair per
 * scenario. The gray (#6e7781) is a deliberate neutral for the reference series, and
 * both colors clear 3:1 contrast on GitHub's light and dark comment surfaces.
 */
function medianChart(head, base) {
  if (head.scenarios.length === 0) return null;
  const headValues = head.scenarios.map((scenario) => scenario.total.medianMs);
  const baseByName = base
    ? new Map(base.scenarios.map((scenario) => [scenario.name, scenario]))
    : null;
  const baseValues = baseByName
    ? head.scenarios.map((scenario) => baseByName.get(scenario.name)?.total.medianMs ?? 0)
    : null;
  const values = [...headValues, ...(baseValues ?? [])];
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) return null;
  const top = Math.max(1, Math.ceil(Math.max(...values) * 1.15));
  const series = (list) => `[${list.map((value) => value.toFixed(2)).join(', ')}]`;

  let categories;
  let seriesLines;
  let palette;
  if (baseValues) {
    categories = head.scenarios.flatMap((scenario) => [
      `${shortLabel(scenario.name)} (main)`,
      `${shortLabel(scenario.name)} (PR)`,
    ]);
    const baseSlots = baseValues.flatMap((value) => [value, 0]);
    const headSlots = headValues.flatMap((value) => [0, value]);
    palette = '#6e7781, #0969da';
    seriesLines = [`  bar ${series(baseSlots)}`, `  bar ${series(headSlots)}`];
  } else {
    categories = head.scenarios.map((scenario) => shortLabel(scenario.name));
    palette = '#0969da';
    seriesLines = [`  bar ${series(headValues)}`];
  }

  const lines = [
    '```mermaid',
    `%%{init: {"themeVariables": {"xyChart": {"plotColorPalette": "${palette}"}}}}%%`,
    'xychart-beta',
    `  title "Median edit latency (ms)"`,
    `  x-axis [${categories.map((name) => `"${name}"`).join(', ')}]`,
    `  y-axis "ms" 0 --> ${top}`,
    ...seriesLines,
    '```',
    baseValues ? '⬛ `main` baseline · 🟦 this PR' : '🟦 this PR (no comparable baseline)',
  ];
  return lines.join('\n');
}

/** Flatten a work summary into dotted numeric leaves so any schema drift still diffs. */
function numericLeaves(value, prefix = '') {
  const leaves = new Map();
  if (value === null || typeof value !== 'object') return leaves;
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'number') leaves.set(path, child);
    else if (child && typeof child === 'object') {
      for (const [leafPath, leafValue] of numericLeaves(child, path))
        leaves.set(leafPath, leafValue);
    }
  }
  return leaves;
}

function workCounterDeltas(baseScenario, headScenario) {
  const baseLeaves = numericLeaves(baseScenario.work);
  const headLeaves = numericLeaves(headScenario.work);
  const rows = [];
  for (const [path, headValue] of headLeaves) {
    const baseValue = baseLeaves.get(path);
    if (baseValue !== undefined && baseValue !== headValue) {
      rows.push(`  - \`${path}\`: ${baseValue} → ${headValue}`);
    }
  }
  return rows;
}

function comparisonNote(head, base) {
  if (!base) return 'Baseline unavailable (no comparable merge-base run) — head-only numbers.';
  if (base.fixtureSha256 !== head.fixtureSha256) {
    return 'Baseline not comparable: the benchmark fixture differs from the merge-base — head-only numbers.';
  }
  return null;
}

function detailsBlock(summary, report) {
  const json = JSON.stringify(report, null, 2);
  const body =
    json.length > MAX_COMMENT_CHARS / 2
      ? `${json.slice(0, MAX_COMMENT_CHARS / 2)}\n… truncated …`
      : json;
  return [
    '<details>',
    `<summary>${summary}</summary>`,
    '',
    '```json',
    body,
    '```',
    '',
    '</details>',
  ].join('\n');
}

export function renderComment(head, base) {
  const lines = [COMMENT_MARKER, '## Performance benchmark', ''];
  const note = comparisonNote(head, base);
  const comparable = note === null;
  const chart = medianChart(head, comparable ? base : undefined);

  if (comparable) {
    lines.push(
      '| Scenario | Base median | Head median | Δ | Head p95 |',
      '| --- | --- | --- | --- | --- |'
    );
    const baseByName = new Map(base.scenarios.map((scenario) => [scenario.name, scenario]));
    const counterRows = [];
    for (const scenario of head.scenarios) {
      const baseScenario = baseByName.get(scenario.name);
      if (!baseScenario) {
        lines.push(
          `| ${scenario.name} | — | ${formatMs(scenario.total.medianMs)} | n/a | ${formatMs(scenario.total.p95Ms)} |`
        );
        continue;
      }
      lines.push(
        `| ${scenario.name} | ${formatMs(baseScenario.total.medianMs)} | ${formatMs(scenario.total.medianMs)} | ${formatDelta(baseScenario.total.medianMs, scenario.total.medianMs)} | ${formatMs(scenario.total.p95Ms)} |`
      );
      const deltas = workCounterDeltas(baseScenario, scenario);
      if (deltas.length > 0) counterRows.push(`- **${scenario.name}**`, ...deltas);
    }
    const headNames = new Set(head.scenarios.map((scenario) => scenario.name));
    for (const scenario of base.scenarios) {
      if (headNames.has(scenario.name)) continue;
      lines.push(`| ${scenario.name} | ${formatMs(scenario.total.medianMs)} | — | n/a | — |`);
    }
    lines.push('');
    if (counterRows.length > 0) {
      lines.push(
        '**Work counters changed** (deterministic — investigate before merging):',
        '',
        ...counterRows,
        ''
      );
    } else {
      lines.push('Work counters: unchanged.', '');
    }
  } else {
    lines.push(`> ${note}`, '');
    lines.push('| Scenario | Median | p95 | Min | Max |', '| --- | --- | --- | --- | --- |');
    for (const scenario of head.scenarios) {
      lines.push(
        `| ${scenario.name} | ${formatMs(scenario.total.medianMs)} | ${formatMs(scenario.total.p95Ms)} | ${formatMs(scenario.total.minMs)} | ${formatMs(scenario.total.maxMs)} |`
      );
    }
    lines.push('');
  }

  if (chart) lines.push(chart, '');
  lines.push(detailsBlock('Head report (full JSON)', head));
  if (base) lines.push('', detailsBlock('Base report (full JSON)', base));
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const head = readReport(args.head);
  let base;
  if (args.base) {
    try {
      base = readReport(args.base);
    } catch (error) {
      // Degrade to head-only, but say why: a truncated or shape-drifted base.json
      // must be distinguishable in CI logs from a merge-base without the bench.
      console.error(`ignoring base report: ${error instanceof Error ? error.message : error}`);
      base = undefined;
    }
  }
  writeFileSync(args.out, renderComment(head, base));
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
