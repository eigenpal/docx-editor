// Render the edit-bench and browser typing-latency JSON reports (plus optional
// baselines) as the markdown body of the sticky PR comment posted by
// .github/workflows/bench.yml.
//
// Each side may supply SEVERAL runs (the workflow interleaves head/base/base/head
// to cancel machine drift); runs aggregate to mean medians, and a delta smaller
// than the observed same-side spread renders neutral — the comment measures its
// own noise instead of coloring it.
//
// Wall-clock numbers come from a shared CI runner, so the comment is advisory:
// it flags regressions but never fails the job on a head-vs-base delta. The
// deterministic gates live elsewhere: edit-bench-gates.test.ts pins the engine
// work counters, and the browser spec's own structural gates fail its head runs.
//
// Usage: node scripts/bench/edit-bench-comment.mjs --head head-1.json [--head head-2.json]
//          [--base base-1.json ...] [--head-ux browser-1.json ...] [--base-ux ...]
//          --out comment.md

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const COMMENT_MARKER = '<!-- edit-bench-report -->';

const REGRESSION_WARN_PCT = 20;

// Within this band a delta is runner noise, not a signal — shown neutral. The
// observed same-side spread widens this floor per scenario.
const NOISE_BAND_PCT = 5;

// GitHub caps issue comment bodies at 65536 characters; leave room for the
// wrapper text around the <details> payloads.
const MAX_COMMENT_CHARS = 60_000;

function parseArgs(argv) {
  const head = [];
  const base = [];
  const headUx = [];
  const baseUx = [];
  let out;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--head') head.push(argv[++index]);
    else if (value === '--base') base.push(argv[++index]);
    else if (value === '--head-ux') headUx.push(argv[++index]);
    else if (value === '--base-ux') baseUx.push(argv[++index]);
    else if (value === '--out') out = argv[++index];
    else throw new Error(`unknown argument: ${value}`);
  }
  if (head.length === 0) throw new Error('--head <report.json> is required');
  if (!out) throw new Error('--out <comment.md> is required');
  return { head, base, headUx, baseUx, out };
}

function readReport(path) {
  const report = JSON.parse(readFileSync(path, 'utf8'));
  const shapeOk =
    report.schema === 1 &&
    typeof report.fixtureSha256 === 'string' &&
    Array.isArray(report.scenarios) &&
    report.scenarios.every((scenario) => Number.isFinite(scenario?.total?.medianMs));
  if (!shapeOk) throw new Error(`${path}: not an edit-bench schema-1 report`);
  return report;
}

/**
 * A browser (UX) report from e2e/edit-browser.bench.spec.ts: per-scenario `inputTask`
 * is the keystroke-handler latency and `frame` the time until the frame presents —
 * the numbers a typing user actually feels.
 */
function readUxReport(path) {
  const report = JSON.parse(readFileSync(path, 'utf8'));
  const shapeOk =
    report.schema === 1 &&
    typeof report.fixtureSha256 === 'string' &&
    Array.isArray(report.scenarios) &&
    report.scenarios.every((scenario) => Number.isFinite(scenario?.inputTask?.medianMs));
  if (!shapeOk) throw new Error(`${path}: not a browser-bench schema-1 report`);
  return report;
}

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

function aggregateSummary(summaries) {
  const finite = (key) => summaries.map((summary) => summary?.[key]).filter(Number.isFinite);
  const medians = finite('medianMs');
  if (medians.length === 0) return summaries[0];
  return {
    medianMs: mean(medians),
    p95Ms: finite('p95Ms').length > 0 ? mean(finite('p95Ms')) : undefined,
    minMs: finite('minMs').length > 0 ? Math.min(...finite('minMs')) : undefined,
    maxMs: finite('maxMs').length > 0 ? Math.max(...finite('maxMs')) : undefined,
  };
}

const SUMMARY_KEYS = ['transaction', 'layout', 'total', 'inputTask', 'frame', 'paint', 'selection'];

/**
 * Fold same-side runs into one report-shaped aggregate: mean medians/p95 per
 * scenario, plus a per-scenario spread (max−min of the primary-metric medians as
 * a percent of their mean) so the tables can refuse to color deltas inside it.
 * Runs whose fixture hash differs from the first run's are dropped loudly.
 */
export function aggregateReports(reports, primaryOf) {
  const [first, ...rest] = reports;
  const matching = [
    first,
    ...rest.filter((report) => {
      if (report.fixtureSha256 === first.fixtureSha256) return true;
      console.error('dropping run with mismatched fixture hash from aggregation');
      return false;
    }),
  ];
  const spreadPct = new Map();
  const scenarios = first.scenarios.map((scenario) => {
    const runs = matching
      .map((report) => report.scenarios.find((candidate) => candidate.name === scenario.name))
      .filter(Boolean);
    const primaries = runs.map((run) => primaryOf(run).medianMs).filter(Number.isFinite);
    if (primaries.length > 1) {
      const primaryMean = mean(primaries);
      // All-zero medians mean zero observed variation: record no spread rather
      // than 0/0 = NaN, which would neutralize every delta for the scenario.
      if (primaryMean > 0) {
        spreadPct.set(
          scenario.name,
          ((Math.max(...primaries) - Math.min(...primaries)) / primaryMean) * 100
        );
      }
    }
    const aggregated = { ...scenario };
    for (const key of SUMMARY_KEYS) {
      if (scenario[key]) aggregated[key] = aggregateSummary(runs.map((run) => run[key]));
    }
    return aggregated;
  });
  return { ...first, scenarios, spreadPct, runCount: matching.length, raw: matching };
}

function formatMs(value) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)} ms` : 'n/a';
}

function formatDelta(baseMs, headMs, spreadFloorPct = 0) {
  if (!Number.isFinite(baseMs) || !Number.isFinite(headMs)) return 'n/a';
  if (baseMs === 0) return headMs === 0 ? '⚪ ±0%' : 'n/a';
  const pct = Number((((headMs - baseMs) / baseMs) * 100).toFixed(1));
  const text = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  const floor = Math.max(NOISE_BAND_PCT, spreadFloorPct);
  if (pct > floor && pct > REGRESSION_WARN_PCT) return `🔴 ${text} ⚠️`;
  if (pct > floor) return `🔴 ${text}`;
  if (pct < -floor) return `🟢 ${text}`;
  return `⚪ ${text}`;
}

function spreadFloor(headReport, baseReport, name) {
  return Math.max(headReport.spreadPct?.get(name) ?? 0, baseReport?.spreadPct?.get(name) ?? 0);
}

function spreadNote(headReport, baseReport) {
  if ((headReport.runCount ?? 1) < 2 && (baseReport?.runCount ?? 1) < 2) return [];
  const all = [
    ...(headReport.spreadPct?.values() ?? []),
    ...(baseReport?.spreadPct?.values() ?? []),
  ];
  const worst = all.length > 0 ? Math.max(...all) : 0;
  return [
    `Interleaved runs per side: head ${headReport.runCount ?? 1}, base ${baseReport?.runCount ?? 1}. ` +
      `Deltas inside the same-side spread (worst ${worst.toFixed(1)}%) render neutral.`,
    '',
  ];
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

function detailsBlock(summary, report, budget) {
  const json = JSON.stringify(report, null, 2);
  const body = json.length > budget ? `${json.slice(0, budget)}\n… truncated …` : json;
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

/**
 * The typing-feel section: keystroke latency measured in a real Chromium through the
 * full adapter/DOM path. Rendered FIRST — it is the user-facing number; the engine
 * table below it is the algorithmic detail.
 */
function renderUxSection(headUx, baseUx) {
  if (!headUx) return [];
  const lines = ['### Typing latency (browser)', ''];
  const comparable = baseUx && baseUx.fixtureSha256 === headUx.fixtureSha256;
  if (comparable) {
    lines.push(
      '| Scenario | Base median | Head median | Δ | Head p95 | Frame p95 |',
      '| --- | --- | --- | --- | --- | --- |'
    );
    const baseByName = new Map(baseUx.scenarios.map((scenario) => [scenario.name, scenario]));
    for (const scenario of headUx.scenarios) {
      const baseScenario = baseByName.get(scenario.name);
      lines.push(
        `| ${scenario.name} | ${formatMs(baseScenario?.inputTask.medianMs)} | ${formatMs(scenario.inputTask.medianMs)} | ${baseScenario ? formatDelta(baseScenario.inputTask.medianMs, scenario.inputTask.medianMs, spreadFloor(headUx, baseUx, scenario.name)) : 'n/a'} | ${formatMs(scenario.inputTask.p95Ms)} | ${formatMs(scenario.frame?.p95Ms)} |`
      );
    }
    const headNames = new Set(headUx.scenarios.map((scenario) => scenario.name));
    for (const scenario of baseUx.scenarios) {
      if (headNames.has(scenario.name)) continue;
      lines.push(
        `| ${scenario.name} | ${formatMs(scenario.inputTask.medianMs)} | — | n/a | — | — |`
      );
    }
    lines.push('');
    lines.push(...spreadNote(headUx, baseUx));
  } else {
    if (baseUx) lines.push('> Browser baseline not comparable (fixture differs).', '');
    lines.push('| Scenario | Median | p95 | Frame p95 |', '| --- | --- | --- | --- |');
    for (const scenario of headUx.scenarios) {
      lines.push(
        `| ${scenario.name} | ${formatMs(scenario.inputTask.medianMs)} | ${formatMs(scenario.inputTask.p95Ms)} | ${formatMs(scenario.frame?.p95Ms)} |`
      );
    }
    lines.push('');
  }
  return lines;
}

export function renderComment(head, base, ux = {}) {
  const lines = [COMMENT_MARKER, '## Performance benchmark', ''];
  const note = comparisonNote(head, base);
  const comparable = note === null;
  lines.push(...renderUxSection(ux.headUx, ux.baseUx));
  if (ux.headUx) lines.push('### Engine layout (headless)', '');

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
        `| ${scenario.name} | ${formatMs(baseScenario.total.medianMs)} | ${formatMs(scenario.total.medianMs)} | ${formatDelta(baseScenario.total.medianMs, scenario.total.medianMs, spreadFloor(head, base, scenario.name))} | ${formatMs(scenario.total.p95Ms)} |`
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
    lines.push(...spreadNote(head, base));
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

  // The per-block truncation budget shares MAX_COMMENT_CHARS across however many
  // blocks render, so the assembled body stays under GitHub's 65,536-char cap
  // whatever the reports grow to. Only the first run per side is embedded; every
  // raw run lives in the workflow artifact.
  const firstRun = (report) => report.raw?.[0] ?? report;
  const blocks = [
    ['Head report (full JSON)', firstRun(head)],
    ...(base ? [['Base report (full JSON)', firstRun(base)]] : []),
    ...(ux.headUx ? [['Browser report (full JSON)', firstRun(ux.headUx)]] : []),
    ...(ux.headUx && ux.baseUx ? [['Browser baseline (full JSON)', firstRun(ux.baseUx)]] : []),
  ];
  const budget = Math.floor(MAX_COMMENT_CHARS / blocks.length);
  lines.push(blocks.map(([summary, report]) => detailsBlock(summary, report, budget)).join('\n\n'));
  return `${lines.join('\n')}\n`;
}

/** Optional inputs degrade to absence, loudly: a truncated or shape-drifted run
 * must be distinguishable in CI logs from a side without the bench. */
function readAll(paths, reader, label) {
  const reports = [];
  for (const path of paths) {
    try {
      reports.push(reader(path));
    } catch (error) {
      console.error(`ignoring ${label}: ${error instanceof Error ? error.message : error}`);
    }
  }
  return reports;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const engine = (scenario) => scenario.total;
  const input = (scenario) => scenario.inputTask;
  const headRuns = readAll(args.head, readReport, 'head report');
  if (headRuns.length === 0) throw new Error('no readable --head report');
  const head = aggregateReports(headRuns, engine);
  const baseRuns = readAll(args.base, readReport, 'base report');
  const base = baseRuns.length > 0 ? aggregateReports(baseRuns, engine) : undefined;
  const headUxRuns = readAll(args.headUx, readUxReport, 'browser report');
  const headUx = headUxRuns.length > 0 ? aggregateReports(headUxRuns, input) : undefined;
  const baseUxRuns = readAll(args.baseUx, readUxReport, 'browser baseline');
  const baseUx = baseUxRuns.length > 0 ? aggregateReports(baseUxRuns, input) : undefined;
  writeFileSync(args.out, renderComment(head, base, { headUx, baseUx }));
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
