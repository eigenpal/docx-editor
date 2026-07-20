#!/usr/bin/env node
/**
 * Compare a perf-metrics JSON produced by a large-document spec against the
 * committed baseline, and render a Markdown report.
 *
 * Used by the `!check-performance` workflow to post a PR comment. It is
 * informational only: it never exits non-zero, regardless of regressions.
 *
 *   node scripts/perf/compare-baseline.mjs \
 *     --baseline e2e/perf-baselines/large-docs-comments-suggestions.json \
 *     --current  test-results/perf/large-docs-comments-suggestions.json \
 *     --commit   <sha> \
 *     --threshold 20 \
 *     --out      perf-comment.md
 */
import * as fs from 'fs';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i += 1;
      } else {
        args[key] = 'true';
      }
    }
  }
  return args;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function fmt(value, unit) {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  if (unit === 'ms') return `${Math.round(value)} ms`;
  if (unit === 'fps') return `${Math.round(value)} fps`;
  return `${value}`;
}

/**
 * Classify a metric's change. Returns { pct, icon, regressed } where pct is the
 * percentage change from baseline (signed), positive meaning the value grew.
 */
function classify(metric, baseValue, threshold) {
  if (baseValue === undefined || baseValue === null) {
    return { pct: null, icon: '🆕', regressed: false };
  }
  if (metric.direction === 'informational') {
    const pct = baseValue === 0 ? null : ((metric.value - baseValue) / baseValue) * 100;
    return { pct, icon: 'ℹ️', regressed: false };
  }
  if (baseValue === 0) {
    return { pct: null, icon: '➖', regressed: false };
  }
  const pct = ((metric.value - baseValue) / baseValue) * 100;
  // For lower-is-better, growth is bad. For higher-is-better, a drop is bad.
  const worsePct = metric.direction === 'higher-is-better' ? -pct : pct;
  let icon = '✅';
  let regressed = false;
  if (worsePct > threshold) {
    icon = '🔴';
    regressed = true;
  } else if (worsePct < -threshold) {
    icon = '🟢'; // notable improvement
  }
  return { pct, icon, regressed };
}

function signed(pct) {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return '—';
  const rounded = Math.round(pct * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

const args = parseArgs(process.argv.slice(2));
const threshold = Number(args.threshold ?? 20);
const commit = args.commit ? String(args.commit).slice(0, 7) : null;

const current = readJson(args.current);
const baseline = readJson(args.baseline);

const lines = [];
lines.push('## ⚡ Performance check');
lines.push('');

if (!current || !Array.isArray(current.metrics) || current.metrics.length === 0) {
  lines.push(
    '⚠️ The perf run produced no metrics. The suite likely failed before completing. Check the workflow logs.'
  );
  const out = `${lines.join('\n')}\n`;
  if (args.out) fs.writeFileSync(args.out, out);
  process.stdout.write(out);
  process.exit(0);
}

const baseMap = new Map();
if (baseline && Array.isArray(baseline.metrics)) {
  for (const m of baseline.metrics) baseMap.set(m.key, m);
}

const suiteLabel = current.suite ?? args.suite ?? 'perf';
const meta = [`Suite \`${suiteLabel}\``];
if (commit) meta.push(`commit \`${commit}\``);
if (baseline?.capturedAt) meta.push(`baseline captured ${baseline.capturedAt}`);
lines.push(meta.join(' · '));
lines.push('');

lines.push('| Metric | Baseline | This PR | Δ | |');
lines.push('| --- | --- | --- | --- | :-: |');

let regressions = 0;
for (const metric of current.metrics) {
  const base = baseMap.get(metric.key);
  const baseValue = base ? base.value : undefined;
  const { pct, icon, regressed } = classify(metric, baseValue, threshold);
  if (regressed) regressions += 1;
  lines.push(
    `| ${metric.label} | ${fmt(baseValue, metric.unit)} | ${fmt(metric.value, metric.unit)} | ${signed(pct)} | ${icon} |`
  );
}

lines.push('');
if (!baseline) {
  lines.push(
    '🆕 No committed baseline was found, so deltas are blank. Refresh it via the workflow’s manual “Run workflow” dispatch on `main`.'
  );
} else if (regressions > 0) {
  lines.push(
    `🔴 **${regressions}** metric${regressions === 1 ? '' : 's'} regressed beyond ${threshold}% vs the baseline.`
  );
} else {
  lines.push(`✅ No metric regressed beyond ${threshold}% vs the baseline.`);
}
lines.push('');
lines.push(
  '<sub>Informational only, this check never fails. Numbers are timing-sensitive and vary with runner load. Baseline lives in `e2e/perf-baselines/`.</sub>'
);

const out = `${lines.join('\n')}\n`;
if (args.out) fs.writeFileSync(args.out, out);
process.stdout.write(out);
process.exit(0);
