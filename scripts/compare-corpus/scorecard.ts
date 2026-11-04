/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * The compare scorecard: one repeatable measure of how well compare works.
 *
 *   bun run compare:scorecard [--baseline FILE] [--write-baseline FILE] [--json FILE]
 *                             [--pairs DIR] [--decide-ours DIR ... --decide-control DIR ...]
 *
 * Part 1 runs every synthetic case (scripts/compare-corpus/cases.ts) through the engine and
 * scores it against the committed reference redline. Per family it reports token agreement on
 * changed text (F1), precision (low: changes the reference does not make), recall (low:
 * changes the reference makes and the compare misses), exact paragraph-mark and row
 * revisions, refusals, and time.
 *
 * Part 2 is optional. With --pairs, it compares every `<DIR>/<group>/<case>/base.docx` with
 * its `revised.docx` and counts the refusals by code and message: the share of real version
 * pairs a user cannot compare.
 *
 * Part 3 is optional. It reads recorded review results (`<dir>/<group>/<case>/decide.json`:
 * the revisions a reference editor lists when it compares the accepted and rejected states of
 * a redline with the two inputs) for our redlines and for the reference editor's own
 * redlines. A case is clean when ours lists no difference, noise when every difference of ours
 * also occurs in the reference's own redline, and excess otherwise.
 *
 * With --baseline, the run fails when a measure gets worse than the saved one.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { allCases } from './cases.ts';
import { buildDocx } from './docx-builder.ts';
import { compareDocuments } from '../../packages/pro/src/compare/index.ts';
import {
  compactRedline,
  expandRedline,
  type CompactRedline,
} from '../../packages/pro/src/compare/__tests__/support/redline-compact.ts';
import { redlineNormalForm } from '../../packages/pro/src/compare/__tests__/support/redline-normal-form.ts';
import { scoreRedline } from '../../packages/pro/src/compare/__tests__/support/redline-score.ts';

interface FamilyScore {
  cases: number;
  refused: number;
  stale: number;
  f1: number;
  precision: number;
  recall: number;
  exactMarks: number;
  /** Cases with precision below 0.9: changes the reference does not make. */
  extraChanges: number;
  /** Cases with recall below 0.9: changes the reference makes and the compare misses. */
  missedChanges: number;
  medianMs: number;
  maxMs: number;
}

interface DecideScore {
  cases: number;
  clean: number;
  noise: number;
  excess: number;
  /**
   * Excess cases with an extra difference other than a table or section property record. The
   * reference editor rewrites the properties of a table in a document with no default table
   * style and reports its own rewrite as a difference, so property records alone are not
   * evidence of a wrong change.
   */
  excessBeyondProperties: number;
  unbased: number;
}

/** Revision types that the reference editor reports for its own property rewrites. */
const PROPERTY_REWRITES = new Set(['revision table property', 'revision section property']);

interface PairScore {
  pairs: number;
  refused: number;
  /** Refusals by code and message, with up to five cases each. */
  reasons: Record<string, { count: number; cases: string[] }>;
  medianMs: number;
  maxMs: number;
}

interface Scorecard {
  families: Record<string, FamilyScore>;
  overall: FamilyScore;
  pairs?: PairScore;
  decide?: DecideScore;
}

const CASE_FLOOR = 0.9;
/** A drop smaller than this is measurement noise, not a regression. */
const TOLERANCE = 0.002;

function parseArgs(argv: readonly string[]) {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const list = (flag: string) => {
    const i = argv.indexOf(flag);
    if (i < 0) return [];
    const out: string[] = [];
    for (let j = i + 1; j < argv.length && !argv[j]!.startsWith('--'); j++) out.push(argv[j]!);
    return out;
  };
  return {
    baseline: value('--baseline'),
    writeBaseline: value('--write-baseline'),
    json: value('--json'),
    pairs: value('--pairs'),
    decideOurs: list('--decide-ours'),
    decideControl: list('--decide-control'),
  };
}

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const median = (values: readonly number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

function syntheticScores(): Pick<Scorecard, 'families' | 'overall'> {
  const reference = (
    JSON.parse(
      readFileSync(
        new URL(
          '../../packages/pro/src/compare/__tests__/fixtures/compare-reference.json',
          import.meta.url
        ),
        'utf8'
      )
    ) as { cases: Record<string, CompactRedline & { inputs: string[] }> }
  ).cases;
  type Raw = { f1: number[]; p: number[]; r: number[]; marks: number; ms: number[] } & Pick<
    FamilyScore,
    'refused' | 'stale' | 'extraChanges' | 'missedChanges'
  >;
  const raw = new Map<string, Raw>();
  const all: Raw = {
    f1: [],
    p: [],
    r: [],
    marks: 0,
    ms: [],
    refused: 0,
    stale: 0,
    extraChanges: 0,
    missedChanges: 0,
  };
  for (const entry of allCases()) {
    const family = raw.get(entry.family) ?? {
      f1: [],
      p: [],
      r: [],
      marks: 0,
      ms: [],
      refused: 0,
      stale: 0,
      extraChanges: 0,
      missedChanges: 0,
    };
    raw.set(entry.family, family);
    const add = (apply: (target: Raw) => void) => {
      apply(family);
      apply(all);
    };
    const base = buildDocx(entry.base);
    const revised = buildDocx(entry.revised);
    const expected = reference[`${entry.family}/${entry.name}`];
    if (!expected || expected.inputs[0] !== sha(base) || expected.inputs[1] !== sha(revised)) {
      add((t) => t.stale++);
      continue;
    }
    const start = performance.now();
    const result = compareDocuments(base, revised, {
      authorName: 'Reference',
      date: new Date('2026-01-10T12:00:00Z'),
    });
    const ms = performance.now() - start;
    if (!result.ok) {
      add((t) => t.refused++);
      continue;
    }
    const score = scoreRedline(
      expandRedline(compactRedline(redlineNormalForm(result.bytes))),
      expandRedline(expected)
    );
    add((t) => {
      t.f1.push(score.changedF1);
      t.p.push(score.precision);
      t.r.push(score.recall);
      t.ms.push(ms);
      if (score.paragraphMarksEqual && score.rowMarksEqual) t.marks++;
      if (score.precision < CASE_FLOOR) t.extraChanges++;
      if (score.recall < CASE_FLOOR) t.missedChanges++;
    });
  }
  const summarize = (t: Raw): FamilyScore => {
    const n = t.f1.length;
    const mean = (values: number[]) => (n ? values.reduce((a, b) => a + b, 0) / n : 0);
    return {
      cases: n,
      refused: t.refused,
      stale: t.stale,
      f1: mean(t.f1),
      precision: mean(t.p),
      recall: mean(t.r),
      exactMarks: n ? t.marks / n : 0,
      extraChanges: t.extraChanges,
      missedChanges: t.missedChanges,
      medianMs: median(t.ms),
      maxMs: t.ms.length ? Math.max(...t.ms) : 0,
    };
  };
  const families: Record<string, FamilyScore> = {};
  for (const [name, t] of [...raw].sort(([a], [b]) => a.localeCompare(b)))
    families[name] = summarize(t);
  return { families, overall: summarize(all) };
}

interface DecideRecord {
  readonly accept: DecideSide;
  readonly reject: DecideSide;
}
interface DecideSide {
  readonly count: number;
  readonly revisions: readonly {
    readonly type: string;
    readonly story: string;
    readonly text: string;
  }[];
}

function pairScores(dir: string): PairScore {
  const score: PairScore = { pairs: 0, refused: 0, reasons: {}, medianMs: 0, maxMs: 0 };
  const times: number[] = [];
  for (const group of readdirSync(dir, { withFileTypes: true })) {
    if (!group.isDirectory()) continue;
    for (const entry of readdirSync(path.join(dir, group.name), { withFileTypes: true })) {
      const folder = path.join(dir, group.name, entry.name);
      if (!entry.isDirectory() || !existsSync(path.join(folder, 'base.docx'))) continue;
      score.pairs++;
      const start = performance.now();
      const result = compareDocuments(
        new Uint8Array(readFileSync(path.join(folder, 'base.docx'))),
        new Uint8Array(readFileSync(path.join(folder, 'revised.docx'))),
        { authorName: 'Scorecard' }
      );
      times.push(performance.now() - start);
      if (result.ok) continue;
      score.refused++;
      const reason = `${result.code}: ${result.message.replace(/\s*\(.*\)/, '')}`;
      const slot = (score.reasons[reason] ??= { count: 0, cases: [] });
      slot.count++;
      if (slot.cases.length < 5) slot.cases.push(`${group.name}/${entry.name}`);
    }
  }
  score.medianMs = median(times);
  score.maxMs = times.length ? Math.max(...times) : 0;
  return score;
}

function readDecides(dirs: readonly string[]): Map<string, DecideRecord> {
  const out = new Map<string, DecideRecord>();
  // Later directories override earlier ones, case by case.
  for (const dir of dirs) {
    for (const group of readdirSync(dir, { withFileTypes: true })) {
      if (!group.isDirectory()) continue;
      for (const entry of readdirSync(path.join(dir, group.name), { withFileTypes: true })) {
        const file = path.join(dir, group.name, entry.name, 'decide.json');
        if (entry.isDirectory() && existsSync(file))
          out.set(`${group.name}/${entry.name}`, JSON.parse(readFileSync(file, 'utf8')));
      }
    }
  }
  return out;
}

/** Each difference of one decide record: side, revision type, story, and text. */
function differences(record: DecideRecord): Map<string, number> {
  const out = new Map<string, number>();
  const add = (key: string, n = 1) => out.set(key, (out.get(key) ?? 0) + n);
  for (const side of ['accept', 'reject'] as const) {
    const { count, revisions } = record[side];
    for (const r of revisions) add(`${side}\u0000${r.type}\u0000${r.story}\u0000${r.text.trim()}`);
    if (count > revisions.length) add(`${side}\u0000unlisted`, count - revisions.length);
  }
  return out;
}

function decideScores(oursDirs: readonly string[], controlDirs: readonly string[]): DecideScore {
  const ours = readDecides(oursDirs);
  const control = readDecides(controlDirs);
  const score: DecideScore = {
    cases: 0,
    clean: 0,
    noise: 0,
    excess: 0,
    excessBeyondProperties: 0,
    unbased: 0,
  };
  for (const [key, record] of ours) {
    score.cases++;
    const mine = differences(record);
    if (mine.size === 0) {
      score.clean++;
      continue;
    }
    const theirs = control.get(key);
    if (!theirs) {
      score.unbased++;
      continue;
    }
    const reference = differences(theirs);
    const extra = [...mine].filter(([diff, n]) => (reference.get(diff) ?? 0) < n);
    if (extra.length === 0) {
      score.noise++;
      continue;
    }
    score.excess++;
    if (extra.some(([diff]) => !PROPERTY_REWRITES.has(diff.split('\u0000')[1] ?? '')))
      score.excessBeyondProperties++;
  }
  return score;
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const num = (value: number) => value.toFixed(3);

function print(card: Scorecard): void {
  const rows = [
    ['family', 'cases', 'F1', 'prec', 'recall', 'marks', 'extra', 'missed', 'refused', 'med ms', 'max ms'],
    ...[...Object.entries(card.families), ['overall', card.overall] as const].map(([name, s]) => [
      name,
      String(s.cases + s.refused),
      num(s.f1),
      num(s.precision),
      num(s.recall),
      pct(s.exactMarks),
      String(s.extraChanges),
      String(s.missedChanges),
      String(s.refused),
      s.medianMs.toFixed(1),
      s.maxMs.toFixed(0),
    ]),
  ];
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((row) => row[i]!.length)));
  for (const row of rows)
    console.log(row.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]!) : cell.padStart(widths[i]!))).join('  '));
  if (card.overall.stale > 0)
    console.log(`\n${card.overall.stale} cases have no reference for their current inputs.`);
  if (card.pairs) {
    const q = card.pairs;
    console.log(
      `\nVersion pairs: ${q.pairs} compared, ${q.refused} refused (${pct(q.pairs ? q.refused / q.pairs : 0)}), ` +
        `median ${q.medianMs.toFixed(0)} ms, max ${q.maxMs.toFixed(0)} ms.`
    );
    for (const [reason, slot] of Object.entries(q.reasons).sort((a, b) => b[1].count - a[1].count))
      console.log(`  ${slot.count}  ${reason}\n       ${slot.cases.join(' ')}`);
  }
  if (card.decide) {
    const d = card.decide;
    console.log(
      `\nRecorded review results: ${d.cases} cases, ${d.clean} clean, ${d.noise} noise, ` +
        `${d.excess} excess (${d.excessBeyondProperties} beyond table and section property ` +
        `records), ${d.unbased} without a reference result.`
    );
  }
}

/** Each measure that got worse than the baseline, as a sentence. */
function regressions(card: Scorecard, baseline: Scorecard): string[] {
  const out: string[] = [];
  const check = (name: string, now: FamilyScore, then: FamilyScore | undefined) => {
    if (!then) return;
    for (const key of ['f1', 'precision', 'recall', 'exactMarks'] as const)
      if (now[key] < then[key] - TOLERANCE)
        out.push(`${name}: ${key} ${num(then[key])} -> ${num(now[key])}`);
    for (const key of ['extraChanges', 'missedChanges', 'refused'] as const)
      if (now[key] > then[key]) out.push(`${name}: ${key} ${then[key]} -> ${now[key]}`);
  };
  check('overall', card.overall, baseline.overall);
  for (const [name, score] of Object.entries(card.families))
    check(name, score, baseline.families[name]);
  if (card.pairs && baseline.pairs && card.pairs.refused > baseline.pairs.refused)
    out.push(`version pairs: refused ${baseline.pairs.refused} -> ${card.pairs.refused}`);
  for (const key of ['excess', 'excessBeyondProperties'] as const) {
    const now = card.decide?.[key];
    const then = baseline.decide?.[key];
    if (now !== undefined && then !== undefined && now > then)
      out.push(`review results: ${key} ${then} -> ${now}`);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const card: Scorecard = syntheticScores();
if (args.pairs) card.pairs = pairScores(args.pairs);
if (args.decideOurs.length > 0) card.decide = decideScores(args.decideOurs, args.decideControl);
print(card);
if (args.json) writeFileSync(args.json, `${JSON.stringify(card, null, 2)}\n`);
if (args.writeBaseline) {
  writeFileSync(args.writeBaseline, `${JSON.stringify(card, null, 2)}\n`);
  console.log(`\nBaseline written to ${args.writeBaseline}.`);
}
if (args.baseline) {
  const worse = regressions(card, JSON.parse(readFileSync(args.baseline, 'utf8')) as Scorecard);
  if (worse.length > 0) {
    console.log(`\nWorse than the baseline:\n  ${worse.join('\n  ')}`);
    process.exit(1);
  }
  console.log('\nNo measure is worse than the baseline.');
}
