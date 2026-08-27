// Deterministic long-document editing benchmark.
//
// Unlike the browser HUD, this uses a fixed measurer and fixed paragraph positions. Timings
// remain hardware-sensitive, so the benchmark reports repeated medians/p95s alongside the
// hardware-independent work counters that tell us whether an optimization changed complexity.
//
// Usage:
//   bun scripts/bench/edit-bench.ts [fixture] [--runs 9] [--warmup 2] [--json]
//   bun scripts/bench/edit-bench.ts [fixture] --compare /tmp/edit-before.json

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import {
  normalizeParagraphIdentity,
  readOoxmlPackage,
  resolveHeaderFooterPartsBySection,
  TreePackageStore,
  type OoxmlNode,
  type OoxmlPackage,
  type OoxmlParagraphNode,
  type OoxmlPart,
  type TreeDocOp,
} from '../../packages/core/src/store/index.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  enumerateDocumentSections,
  geometryOfSection,
  layoutHeaderFooterStory,
  layoutSemanticDocument,
  type LayoutSessionStats,
  type PageFurniture,
} from '../../packages/core/src/layout/index.ts';
import {
  createParagraphLayoutCache,
  type LayoutCacheStats,
} from '../../packages/core/src/layout/layout-cache.ts';

interface Args {
  fixture: string;
  runs: number;
  warmup: number;
  json: boolean;
  compare?: string;
}

interface TimingSummary {
  medianMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
}

interface WorkSummary extends LayoutSessionStats {
  pagesBefore: number;
  pagesAfter: number;
  cache: LayoutCacheStats;
}

interface ScenarioResult {
  name: string;
  target: { paragraphIndex: number; paragraphId: string };
  transaction: TimingSummary;
  layout: TimingSummary;
  total: TimingSummary;
  work: WorkSummary;
}

interface BenchmarkReport {
  schema: 1;
  fixture: string;
  fixtureBytes: number;
  fixtureSha256: string;
  environment: { runtime: string; arch: string };
  config: { runs: number; warmup: number; measurer: string };
  scenarios: ScenarioResult[];
  comparison?: ScenarioComparison[];
}

interface ScenarioComparison {
  name: string;
  totalMedianChangePct: number;
  layoutMedianChangePct: number;
  placedChange: number;
  reusedPagesChange: number;
  cacheMissesChange: number;
  cacheEvictionsChange: number;
}

interface ScenarioTarget {
  paragraphId: string;
  /** The immediately following top-level body paragraph, for join scenarios. */
  nextParagraphId: string;
}

interface Scenario {
  name: string;
  fraction: number;
  /**
   * How the target paragraph is chosen. `any-paragraph` picks from every paragraph in
   * document order (the historical behaviour, kept so existing gate counters stand);
   * `adjacent-body-pair` picks a plain top-level body paragraph whose next sibling is
   * also one, so split/join ops address real Enter/Backspace sites.
   */
  target: 'any-paragraph' | 'adjacent-body-pair';
  op(target: ScenarioTarget): TreeDocOp;
}

const SCENARIOS: readonly Scenario[] = [
  {
    name: 'steady-middle-text',
    fraction: 0.5,
    target: 'any-paragraph',
    op: ({ paragraphId }) => ({ op: 'insertText', paragraphId, offset: 0, text: 'X' }),
  },
  {
    name: 'wrap-middle-text',
    fraction: 0.5,
    target: 'any-paragraph',
    op: ({ paragraphId }) => ({
      op: 'insertText',
      paragraphId,
      offset: 0,
      text: 'word '.repeat(20),
    }),
  },
  {
    name: 'forced-middle-reflow',
    fraction: 0.5,
    target: 'any-paragraph',
    op: ({ paragraphId }) => ({ op: 'insertHardBreak', paragraphId, offset: 0 }),
  },
  {
    name: 'forced-early-reflow',
    fraction: 0.05,
    target: 'any-paragraph',
    op: ({ paragraphId }) => ({ op: 'insertHardBreak', paragraphId, offset: 0 }),
  },
  // The two structural edits a keyboard produces constantly: Enter splits the
  // paragraph at the caret, Backspace at a paragraph start joins it into the
  // one before. Both change the BLOCK COUNT, which is what distinguishes them
  // from every scenario above.
  //
  // 0.6, and the pair moves together so both still address one site. At 0.5 the paragraph
  // the two 500-page fixtures pick sits on a page boundary, so Enter pushes a line across
  // it and pays a whole unit reflow — 44 blocks rather than the 4 it costs anywhere else.
  // Baselining that would leave the gate permitting an 11x regression in Enter's
  // incremental cost, which is the one thing it exists to catch.
  {
    name: 'enter-split-middle',
    fraction: 0.6,
    target: 'adjacent-body-pair',
    op: ({ paragraphId }) => ({ op: 'splitParagraph', paragraphId, offset: 10 }),
  },
  {
    name: 'backspace-join-middle',
    fraction: 0.6,
    target: 'adjacent-body-pair',
    op: ({ paragraphId, nextParagraphId }) => ({
      op: 'joinParagraphs',
      firstId: paragraphId,
      secondId: nextParagraphId,
    }),
  },
  {
    name: 'enter-split-early',
    fraction: 0.05,
    target: 'adjacent-body-pair',
    op: ({ paragraphId }) => ({ op: 'splitParagraph', paragraphId, offset: 10 }),
  },
  // Ctrl+Enter: adds one whole sheet, so every page below moves without changing.
  // The scenario that proves whole-page tail reuse (a shifted tail must not re-place).
  //
  // 0.6, not 0.5. Whether a page break ADDS a sheet depends on where its paragraph sits:
  // at 0.5 the two generated 500-page fixtures put it at the top of a page, where a break
  // is a no-op, and both gates went from proving the remap to proving nothing. The
  // synthetic units end on a forced page start, so slack inside a unit can also swallow the
  // break; 0.6 lands past that on all three fixtures and each one gains exactly one sheet.
  {
    name: 'page-break-middle',
    fraction: 0.6,
    target: 'adjacent-body-pair',
    op: ({ paragraphId }) => ({ op: 'insertPageBreak', paragraphId, offset: 0 }),
  },
];

function positiveInteger(value: string | undefined, fallback: number, flag: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

function parseArgs(argv: readonly string[]): Args {
  let fixture = 'e2e/fixtures/synthetic-long-edit.docx';
  let runs = 9;
  let warmup = 2;
  let json = false;
  let compare: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]!;
    if (value === '--json') {
      json = true;
    } else if (value === '--runs') {
      runs = positiveInteger(argv[++index], runs, '--runs');
    } else if (value === '--warmup') {
      warmup = positiveInteger(argv[++index], warmup, '--warmup');
    } else if (value === '--compare') {
      compare = argv[++index];
      if (!compare) throw new Error('--compare requires a baseline JSON path');
    } else if (value.startsWith('--')) {
      throw new Error(`unknown argument: ${value}`);
    } else {
      fixture = value;
    }
  }
  return {
    fixture: resolve(fixture),
    runs,
    warmup,
    json,
    ...(compare ? { compare: resolve(compare) } : {}),
  };
}

const args = parseArgs(process.argv.slice(2));
const bytes = new Uint8Array(readFileSync(args.fixture));
const fixtureSha256 = createHash('sha256').update(bytes).digest('hex');
const loaded = readOoxmlPackage(bytes);
if (!loaded.ok) throw new Error(`parse failed: ${loaded.reason}`);
const originalPackage = loaded.package;
const originalMain = originalPackage.parts.get(originalPackage.mainDocumentPart);
if (!originalMain) throw new Error('main document part missing');
const normalizedMain = normalizeParagraphIdentity(originalMain);
const measurer = createFixedMeasurer(6, 14);

function paragraphsOf(part: OoxmlPart): OoxmlParagraphNode[] {
  const paragraphs: OoxmlParagraphNode[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'paragraph') paragraphs.push(node);
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  return paragraphs;
}

/** Top-level body paragraph pairs eligible as Enter/Backspace sites. */
function adjacentBodyPairsOf(part: OoxmlPart): ScenarioTarget[] {
  const textLengthOf = (node: OoxmlNode): number => {
    if (node.kind === 'textValue') return node.value.length;
    return (node.children ?? []).reduce((sum, child) => sum + textLengthOf(child), 0);
  };
  const carriesSectionBreak = (node: OoxmlNode): boolean => {
    if (node.kind === 'textValue') return false;
    if ('localName' in node && node.localName === 'sectPr') return true;
    return (node.children ?? []).some(carriesSectionBreak);
  };
  const body = part.root.children.find(
    (child) => child.kind !== 'textValue' && 'localName' in child && child.localName === 'body'
  );
  if (!body || body.kind === 'textValue') return [];
  const pairs: ScenarioTarget[] = [];
  const blocks = body.children;
  for (let index = 0; index + 1 < blocks.length; index += 1) {
    const current = blocks[index]!;
    const next = blocks[index + 1]!;
    if (current.kind !== 'paragraph' || next.kind !== 'paragraph') continue;
    if (carriesSectionBreak(current) || carriesSectionBreak(next)) continue;
    // The split offset must land inside real text so both halves carry content.
    if (textLengthOf(current) < 12) continue;
    pairs.push({ paragraphId: current.id, nextParagraphId: next.id });
  }
  return pairs;
}

function furnitureFor(pkg: OoxmlPackage, part: OoxmlPart): readonly (PageFurniture | undefined)[] {
  const sections = enumerateDocumentSections(part);
  const bySection = resolveHeaderFooterPartsBySection(pkg);
  return sections.map((section, index) => {
    const parts = bySection[index];
    if (!parts || (parts.headers.size === 0 && parts.footers.size === 0)) return undefined;
    const geometry = geometryOfSection(section.properties);
    const width = geometry.width - geometry.margin.left - geometry.margin.right;
    const mapStories = (source: typeof parts.headers) => {
      const stories = new Map();
      for (const [variant, storyPart] of source) {
        stories.set(variant, layoutHeaderFooterStory(storyPart, width, measurer, 'edit-bench'));
      }
      return stories;
    };
    return {
      titlePage: parts.titlePage,
      evenAndOddHeaders: parts.evenAndOddHeaders,
      headers: mapStories(parts.headers),
      footers: mapStories(parts.footers),
    };
  });
}

const normalizedStore = new TreePackageStore(originalPackage, normalizedMain);
const normalizedPackage = normalizedStore.currentPackage();
const normalizedPart = normalizedStore.bodyStore().part;
const paragraphs = paragraphsOf(normalizedPart);
if (paragraphs.length === 0) throw new Error('fixture has no paragraphs');
const bodyPairs = adjacentBodyPairsOf(normalizedPart);
const furniture = furnitureFor(normalizedPackage, normalizedPart);

function summarize(values: readonly number[]): TimingSummary {
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]!;
  return {
    medianMs: median,
    p95Ms: p95,
    minMs: sorted[0]!,
    maxMs: sorted[sorted.length - 1]!,
  };
}

function sameWork(a: WorkSummary, b: WorkSummary): boolean {
  return (
    a.placed === b.placed &&
    a.total === b.total &&
    a.reusedPages === b.reusedPages &&
    a.fullPasses === b.fullPasses &&
    a.pagesBefore === b.pagesBefore &&
    a.pagesAfter === b.pagesAfter &&
    a.cache.hits === b.cache.hits &&
    a.cache.misses === b.cache.misses &&
    a.cache.evictions === b.cache.evictions &&
    a.cache.size === b.cache.size
  );
}

function runScenario(scenario: Scenario): ScenarioResult {
  let paragraphIndex: number;
  let target: ScenarioTarget;
  if (scenario.target === 'adjacent-body-pair') {
    if (bodyPairs.length === 0) throw new Error(`${scenario.name}: fixture has no eligible pairs`);
    const pairIndex = Math.min(
      bodyPairs.length - 1,
      Math.max(0, Math.floor((bodyPairs.length - 1) * scenario.fraction))
    );
    target = bodyPairs[pairIndex]!;
    paragraphIndex = paragraphs.findIndex((node) => node.id === target.paragraphId);
  } else {
    paragraphIndex = Math.min(
      paragraphs.length - 1,
      Math.max(0, Math.floor((paragraphs.length - 1) * scenario.fraction))
    );
    target = {
      paragraphId: paragraphs[paragraphIndex]!.id,
      nextParagraphId: paragraphs[paragraphIndex]!.id,
    };
  }
  const paragraphId = target.paragraphId;
  const transactionTimes: number[] = [];
  const layoutTimes: number[] = [];
  const totalTimes: number[] = [];
  let work: WorkSummary | null = null;
  const rounds = args.warmup + args.runs;

  for (let round = 0; round < rounds; round += 1) {
    const store = new TreePackageStore(normalizedPackage, normalizedPart);
    const bodyStore = store.bodyStore();
    const session = createLayoutSession();
    const cache = createParagraphLayoutCache<never>();
    const before = layoutSemanticDocument(bodyStore.part, 1, {
      measurer,
      sectionFurniture: furniture,
      session,
      cache,
      producer: 'edit-bench',
    });
    layoutSemanticDocument(bodyStore.part, 2, {
      measurer,
      sectionFurniture: furniture,
      session,
      cache,
      producer: 'edit-bench',
    });

    const transactionStart = performance.now();
    const transaction = bodyStore.transact((ctx) => ctx.apply(scenario.op(target)));
    const transactionMs = performance.now() - transactionStart;
    if (!transaction.ok || transaction.change === null) {
      throw new Error(`${scenario.name}: edit did not commit`);
    }

    const layoutStart = performance.now();
    const after = layoutSemanticDocument(bodyStore.part, 3, {
      measurer,
      sectionFurniture: furniture,
      session,
      cache,
      producer: 'edit-bench',
    });
    const layoutMs = performance.now() - layoutStart;
    const currentWork: WorkSummary = {
      ...session.stats,
      pagesBefore: before.pages.length,
      pagesAfter: after.pages.length,
      cache: cache.stats,
    };
    if (round === 0) {
      const clean = layoutSemanticDocument(bodyStore.part, 3, {
        measurer,
        sectionFurniture: furniture,
        producer: 'edit-bench',
      });
      if (JSON.stringify(after) !== JSON.stringify(clean)) {
        throw new Error(`${scenario.name}: incremental layout differs from a clean full pass`);
      }
    }
    if (work && !sameWork(work, currentWork)) {
      throw new Error(`${scenario.name}: deterministic work counters changed between runs`);
    }
    work = currentWork;

    if (round >= args.warmup) {
      transactionTimes.push(transactionMs);
      layoutTimes.push(layoutMs);
      totalTimes.push(transactionMs + layoutMs);
    }
  }

  return {
    name: scenario.name,
    target: { paragraphIndex, paragraphId },
    transaction: summarize(transactionTimes),
    layout: summarize(layoutTimes),
    total: summarize(totalTimes),
    work: work!,
  };
}

const report: BenchmarkReport = {
  schema: 1,
  fixture: args.fixture,
  fixtureBytes: bytes.length,
  fixtureSha256,
  environment: { runtime: `Bun ${Bun.version}`, arch: process.arch },
  config: {
    runs: args.runs,
    warmup: args.warmup,
    measurer: 'fixed(6px,14px)',
  },
  scenarios: SCENARIOS.map(runScenario),
};

if (args.compare) {
  const baseline = JSON.parse(readFileSync(args.compare, 'utf8')) as BenchmarkReport;
  if (baseline.fixtureSha256 !== fixtureSha256) {
    throw new Error(
      `baseline fixture hash differs: ${baseline.fixtureSha256 ?? 'missing'} != ${fixtureSha256}`
    );
  }
  report.comparison = report.scenarios.flatMap((current) => {
    const before = baseline.scenarios.find((scenario) => scenario.name === current.name);
    if (!before) return [];
    const percent = (next: number, prior: number) =>
      prior === 0 ? 0 : ((next - prior) / prior) * 100;
    return [
      {
        name: current.name,
        totalMedianChangePct: percent(current.total.medianMs, before.total.medianMs),
        layoutMedianChangePct: percent(current.layout.medianMs, before.layout.medianMs),
        placedChange: current.work.placed - before.work.placed,
        reusedPagesChange: current.work.reusedPages - before.work.reusedPages,
        cacheMissesChange: current.work.cache.misses - before.work.cache.misses,
        cacheEvictionsChange: current.work.cache.evictions - before.work.cache.evictions,
      },
    ];
  });
}

if (args.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`fixture: ${args.fixture} (${Math.round(bytes.length / 1024)} KB)`);
  console.log(`runs: ${args.runs} measured + ${args.warmup} warmup; ${report.config.measurer}`);
  for (const scenario of report.scenarios) {
    const timing = scenario.total;
    const work = scenario.work;
    console.log(
      `\n${scenario.name} (paragraph ${scenario.target.paragraphIndex + 1}/${paragraphs.length})`
    );
    console.log(
      `  total ${timing.medianMs.toFixed(1)} ms median, ${timing.p95Ms.toFixed(1)} ms p95` +
        `  [transaction ${scenario.transaction.medianMs.toFixed(1)}, layout ${scenario.layout.medianMs.toFixed(1)}]`
    );
    console.log(
      `  work  placed ${work.placed}/${work.total}, reused ${work.reusedPages} pages,` +
        ` pages ${work.pagesBefore}→${work.pagesAfter}, full passes ${work.fullPasses}`
    );
    console.log(
      `  cache hits ${work.cache.hits}, misses ${work.cache.misses},` +
        ` evictions ${work.cache.evictions}, size ${work.cache.size}`
    );
  }
  if (report.comparison) {
    console.log('\ncomparison:');
    for (const comparison of report.comparison) {
      console.log(
        `  ${comparison.name}: total ${comparison.totalMedianChangePct.toFixed(1)}%,` +
          ` layout ${comparison.layoutMedianChangePct.toFixed(1)}%,` +
          ` placed ${comparison.placedChange >= 0 ? '+' : ''}${comparison.placedChange},` +
          ` reused ${comparison.reusedPagesChange >= 0 ? '+' : ''}${comparison.reusedPagesChange},` +
          ` cache misses ${comparison.cacheMissesChange >= 0 ? '+' : ''}${comparison.cacheMissesChange},` +
          ` evictions ${comparison.cacheEvictionsChange >= 0 ? '+' : ''}${comparison.cacheEvictionsChange}`
      );
    }
  }
}
