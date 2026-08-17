// Render the edit-bench and browser typing-latency JSON reports (plus optional
// baselines) as the markdown body of the sticky PR comment posted by
// .github/workflows/bench.yml.
//
// Wall-clock numbers come from a shared CI runner, so the comment is advisory:
// it flags regressions but never fails the job on a head-vs-base delta. The
// deterministic gates live elsewhere: edit-bench-gates.test.ts pins the engine
// work counters, and the browser spec's own structural gates fail its head run.
//
// Usage: node scripts/bench/edit-bench-comment.mjs --head head.json [--base base.json]
//          [--head-ux browser.json] [--base-ux browser-base.json] --out comment.md

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
  let headUx;
  let baseUx;
  let out;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--head') head = argv[++index];
    else if (value === '--base') base = argv[++index];
    else if (value === '--head-ux') headUx = argv[++index];
    else if (value === '--base-ux') baseUx = argv[++index];
    else if (value === '--out') out = argv[++index];
    else throw new Error(`unknown argument: ${value}`);
  }
  if (!head) throw new Error('--head <report.json> is required');
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
        `| ${scenario.name} | ${formatMs(baseScenario?.inputTask.medianMs)} | ${formatMs(scenario.inputTask.medianMs)} | ${baseScenario ? formatDelta(baseScenario.inputTask.medianMs, scenario.inputTask.medianMs) : 'n/a'} | ${formatMs(scenario.inputTask.p95Ms)} | ${formatMs(scenario.frame?.p95Ms)} |`
      );
    }
    const headNames = new Set(headUx.scenarios.map((scenario) => scenario.name));
    for (const scenario of baseUx.scenarios) {
      if (headNames.has(scenario.name)) continue;
      lines.push(
        `| ${scenario.name} | ${formatMs(scenario.inputTask.medianMs)} | — | n/a | — | — |`
      );
    }
  } else {
    if (baseUx) lines.push('> Browser baseline not comparable (fixture differs).', '');
    lines.push('| Scenario | Median | p95 | Frame p95 |', '| --- | --- | --- | --- |');
    for (const scenario of headUx.scenarios) {
      lines.push(
        `| ${scenario.name} | ${formatMs(scenario.inputTask.medianMs)} | ${formatMs(scenario.inputTask.p95Ms)} | ${formatMs(scenario.frame?.p95Ms)} |`
      );
    }
  }
  lines.push('');
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

  // The per-block truncation budget shares MAX_COMMENT_CHARS across however many
  // blocks render, so the assembled body stays under GitHub's 65,536-char cap
  // whatever the reports grow to.
  const blocks = [
    ['Head report (full JSON)', head],
    ...(base ? [['Base report (full JSON)', base]] : []),
    ...(ux.headUx ? [['Browser report (full JSON)', ux.headUx]] : []),
    ...(ux.headUx && ux.baseUx ? [['Browser baseline (full JSON)', ux.baseUx]] : []),
  ];
  const budget = Math.floor(MAX_COMMENT_CHARS / blocks.length);
  lines.push(blocks.map(([summary, report]) => detailsBlock(summary, report, budget)).join('\n\n'));
  return `${lines.join('\n')}\n`;
}

/** Optional inputs degrade to absence, loudly: see the base-report rationale below. */
function readOptional(path, reader, label) {
  if (!path) return undefined;
  try {
    return reader(path);
  } catch (error) {
    console.error(`ignoring ${label}: ${error instanceof Error ? error.message : error}`);
    return undefined;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const head = readReport(args.head);
  // Degrade to head-only, but say why: a truncated or shape-drifted base.json
  // must be distinguishable in CI logs from a merge-base without the bench.
  const base = readOptional(args.base, readReport, 'base report');
  const headUx = readOptional(args.headUx, readUxReport, 'browser report');
  const baseUx = readOptional(args.baseUx, readUxReport, 'browser baseline');
  writeFileSync(args.out, renderComment(head, base, { headUx, baseUx }));
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
