/* eslint-disable no-console */
// Isolated local one-character baseline for full-document Yjs collaboration (OpenSpec 1.7).
//
// Scratch-only. Does not change production code. Reuses the headless edit-bench pipeline
// (fixed measurer, warmed layout session, synthetic 200-page fixture) and adds canonical
// allocation, dirty scope, paint reuse, memory, and an equivalent paragraph Yjs update size.
//
// Usage:
//   bun scripts/bench/collaboration-local-edit-bench.ts [fixture] [--runs 9] [--warmup 2]
//   bun scripts/bench/collaboration-local-edit-bench.ts --json --out path.json --md path.md

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as Y from 'yjs';
import { createCollaborationDocumentPort } from '../../packages/core/src/collaboration/index.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  createParagraphLayoutCache,
  enumerateDocumentSections,
  geometryOfSection,
  layoutHeaderFooterStory,
  layoutSemanticDocument,
  pagesToMaterialize,
  type LayoutCacheStats,
  type LayoutSessionStats,
  type PageFurniture,
  type SemanticLayout,
} from '../../packages/core/src/layout/index.ts';
import { paintSemanticLayout } from '../../packages/core/src/output/semantic-paint.ts';
import {
  normalizeParagraphIdentity,
  readOoxmlPackage,
  resolveHeaderFooterPartsBySection,
  TreePackageStore,
  type OoxmlNode,
  type OoxmlPackage,
  type OoxmlPart,
  type OoxmlParagraphNode,
} from '../../packages/core/src/store/index.ts';
import { PARAGRAPHS_KEY } from '../../packages/pro/src/collaboration/schema.ts';

interface Args {
  fixture: string;
  runs: number;
  warmup: number;
  json: boolean;
  out?: string;
  md?: string;
}

interface TimingSummary {
  medianMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
}

interface MemorySample {
  heapUsed: number;
  heapTotal: number;
  rss: number;
  external: number;
}

interface CanonicalAllocation {
  totalBefore: number;
  totalAfter: number;
  allocated: number;
  reused: number;
  allocatedOnParagraphPath: number;
  allocatedOffParagraphPath: number;
}

interface DirtyScope {
  impact: string;
  dirty: readonly string[];
  created: readonly string[];
  deleted: readonly string[];
  dependencyKeyCount: number;
}

interface PaintWork {
  pagesBefore: number;
  pagesAfter: number;
  reusedPageRecords: number;
  newPageRecords: number;
  materializedPages: number;
  reusedPaintElements: number;
  rebuiltPaintElements: number;
}

interface WorkSnapshot {
  layout: LayoutSessionStats & {
    pagesBefore: number;
    pagesAfter: number;
    cache: LayoutCacheStats;
  };
  canonical: CanonicalAllocation;
  dirty: DirtyScope;
  paint: PaintWork;
  yjs: { incrementalUpdateBytes: number; snapshotBytes: number; paragraphCount: number };
}

interface BenchmarkReport {
  schema: 1;
  task: 'full-document-yjs-collaboration/1.7';
  capturedAt: string;
  fixture: string;
  fixtureBytes: number;
  fixtureSha256: string;
  environment: { runtime: string; arch: string; platform: string };
  config: { runs: number; warmup: number; measurer: string; edit: string };
  target: { paragraphIndex: number; paragraphId: string; collaborationParagraphId: string };
  timings: {
    transaction: TimingSummary;
    layout: TimingSummary;
    paint: TimingSummary;
    total: TimingSummary;
  };
  memory: {
    afterWarmLayout: MemorySample;
    afterEdit: MemorySample;
    afterLayout: MemorySample;
    afterPaint: MemorySample;
    heapUsedDeltaMedian: {
      edit: number;
      layout: number;
      paint: number;
      editThroughPaint: number;
    };
    rssDeltaMedian: {
      editThroughPaint: number;
    };
    externalDeltaMedian: {
      editThroughPaint: number;
    };
  };
  work: WorkSnapshot;
  methods: readonly string[];
  limitations: readonly string[];
}

const METHODS = [
  'Load e2e/fixtures/synthetic-long-edit.docx, normalize paragraph identity, and pick the middle body paragraph (edit-bench steady-middle-text).',
  'Each round starts from a fresh TreePackageStore, layout session, and paragraph layout cache.',
  'Warm layout with two layoutSemanticDocument passes and a fixed measurer (6px, 14px), matching scripts/bench/edit-bench.ts.',
  'Insert one character with insertText at UTF-16 offset 0.',
  'Canonical allocation compares object identity of every node in the main part before and after the transaction.',
  'Dirty scope is TreeModelChange.dirty/created/deleted/impact/dependencyKeys from the committed transaction.',
  'Layout work counters come from the warmed LayoutSession plus ParagraphLayoutCache.stats.',
  'Paint uses happy-dom. The viewport pins the edited page plus one overscan page. Incremental paint reuse counts retained page element identity.',
  'Memory samples process.memoryUsage() with no GC between stages. RSS and external bytes are the usable process-level signals on this Bun runtime.',
  'Yjs size seeds the proof paragraph map (docx-body-paragraphs-v1) with every w14:paraId text, fixes clientID=1, then encodes the incremental update for inserting X at the start of the target Y.Text.',
] as const;

const LIMITATIONS = [
  'This is the local one-character baseline only. It does not apply a remote Yjs update or materialize a collaborative replica.',
  'Yjs size uses the current paragraph-text proof schema, not a full-document XML or registry CRDT. The baseline DOCX blob is not stored in Yjs.',
  'Paint runs in happy-dom, not Chromium. It excludes React, selection sync, and the review rail. Use bench:edit:browser for those layers.',
  'Viewport materialization paints the edited page plus overscan, not every sheet. Page-record identity still covers the whole document.',
  'Bun 1.3.14 did not change process.memoryUsage().heapUsed between edit, layout, and paint samples. Canonical node counts and RSS are the allocation signals.',
  'Wall-clock medians are hardware-sensitive. Compare them on the same machine.',
] as const;

function positiveInteger(value: string | undefined, fallback: number, flag: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseArgs(argv: readonly string[]): Args {
  let fixture = 'e2e/fixtures/synthetic-long-edit.docx';
  let runs = 9;
  let warmup = 2;
  let json = false;
  let out: string | undefined;
  let md: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]!;
    if (value === '--json') json = true;
    else if (value === '--runs') runs = positiveInteger(argv[++index], runs, '--runs');
    else if (value === '--warmup') warmup = positiveInteger(argv[++index], warmup, '--warmup');
    else if (value === '--out') {
      out = argv[++index];
      if (!out) throw new Error('--out requires a JSON path');
    } else if (value === '--md') {
      md = argv[++index];
      if (!md) throw new Error('--md requires a Markdown path');
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
    ...(out ? { out: resolve(out) } : {}),
    ...(md ? { md: resolve(md) } : {}),
  };
}

function summarize(values: readonly number[]): TimingSummary {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    medianMs: sorted[Math.floor(sorted.length / 2)]!,
    p95Ms: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]!,
    minMs: sorted[0]!,
    maxMs: sorted[sorted.length - 1]!,
  };
}

function medianInt(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function asMemorySample(usage: ReturnType<typeof process.memoryUsage>): MemorySample {
  return {
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    rss: usage.rss,
    external: usage.external,
  };
}

function visitNodes(node: OoxmlNode, visit: (node: OoxmlNode) => void): void {
  visit(node);
  if (node.kind === 'textValue') return;
  for (const child of node.children) visitNodes(child, visit);
}

function collectNodes(root: OoxmlNode): Set<OoxmlNode> {
  const nodes = new Set<OoxmlNode>();
  visitNodes(root, (node) => nodes.add(node));
  return nodes;
}

function findNode(root: OoxmlNode, id: string): OoxmlNode | null {
  let found: OoxmlNode | null = null;
  visitNodes(root, (node) => {
    if (node.id === id) found = node;
  });
  return found;
}

function parentMapOf(root: OoxmlNode): Map<OoxmlNode, OoxmlNode> {
  const parents = new Map<OoxmlNode, OoxmlNode>();
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    for (const child of node.children) {
      parents.set(child, node);
      walk(child);
    }
  };
  walk(root);
  return parents;
}

function canonicalAllocation(
  beforeRoot: OoxmlNode,
  afterRoot: OoxmlNode,
  paragraphId: string
): CanonicalAllocation {
  const before = collectNodes(beforeRoot);
  const after = collectNodes(afterRoot);
  const parents = parentMapOf(afterRoot);
  const paragraph = findNode(afterRoot, paragraphId);
  if (!paragraph) throw new Error('edited paragraph missing after insertText');
  const path = new Set<OoxmlNode>();
  let cursor: OoxmlNode | undefined = paragraph;
  while (cursor) {
    path.add(cursor);
    cursor = parents.get(cursor);
  }
  visitNodes(paragraph, (node) => path.add(node));
  let allocated = 0;
  let reused = 0;
  let allocatedOnParagraphPath = 0;
  for (const node of after) {
    if (before.has(node)) {
      reused += 1;
      continue;
    }
    allocated += 1;
    if (path.has(node)) allocatedOnParagraphPath += 1;
  }
  return {
    totalBefore: before.size,
    totalAfter: after.size,
    allocated,
    reused,
    allocatedOnParagraphPath,
    allocatedOffParagraphPath: allocated - allocatedOnParagraphPath,
  };
}

function paragraphsOf(part: OoxmlPart): OoxmlParagraphNode[] {
  const paragraphs: OoxmlParagraphNode[] = [];
  visitNodes(part.root, (node) => {
    if (node.kind === 'paragraph') paragraphs.push(node);
  });
  return paragraphs;
}

function furnitureFor(
  pkg: OoxmlPackage,
  part: OoxmlPart,
  measurer: ReturnType<typeof createFixedMeasurer>
): readonly (PageFurniture | undefined)[] {
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
        stories.set(
          variant,
          layoutHeaderFooterStory(storyPart, width, measurer, 'collab-local-edit-bench')
        );
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

function pageIndexOfParagraph(layout: SemanticLayout, paragraphId: string): number {
  for (const page of layout.pages) {
    for (const fragment of page.fragments) {
      if (fragment.kind === 'paragraph' && fragment.paragraphId === paragraphId) {
        return page.index;
      }
    }
  }
  throw new Error(`paragraph ${paragraphId} is not on any page`);
}

function sameWork(a: WorkSnapshot, b: WorkSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function measureYjsUpdate(
  paragraphs: readonly { paragraphId: string; text: string }[],
  targetParagraphId: string
): WorkSnapshot['yjs'] {
  const ydoc = new Y.Doc();
  ydoc.clientID = 1;
  const map = ydoc.getMap<Y.Text>(PARAGRAPHS_KEY);
  ydoc.transact(() => {
    for (const paragraph of paragraphs) {
      const text = new Y.Text();
      map.set(paragraph.paragraphId, text);
      text.insert(0, paragraph.text);
    }
  });
  const target = map.get(targetParagraphId);
  if (!target) throw new Error(`Y.Text missing for ${targetParagraphId}`);
  const stateVector = Y.encodeStateVector(ydoc);
  ydoc.transact(() => {
    target.insert(0, 'X');
  });
  const incremental = Y.encodeStateAsUpdate(ydoc, stateVector);
  const snapshot = Y.encodeStateAsUpdate(ydoc);
  ydoc.destroy();
  return {
    incrementalUpdateBytes: incremental.byteLength,
    snapshotBytes: snapshot.byteLength,
    paragraphCount: paragraphs.length,
  };
}

function renderMarkdown(report: BenchmarkReport): string {
  const work = report.work;
  const mem = report.memory.heapUsedDeltaMedian;
  const line = (label: string, value: string): string => `| ${label} | ${value} |`;
  return [
    '# Local one-character edit baseline',
    '',
    'OpenSpec task 1.7 for `full-document-yjs-collaboration`.',
    '',
    `- Captured: ${report.capturedAt}`,
    `- Fixture: \`${report.fixture}\``,
    `- SHA-256: \`${report.fixtureSha256}\``,
    `- Runtime: ${report.environment.runtime}, ${report.environment.arch}, ${report.environment.platform}`,
    `- Config: ${report.config.runs} measured rounds, ${report.config.warmup} warmup, ${report.config.measurer}`,
    `- Edit: ${report.config.edit} on paragraph ${report.target.paragraphIndex + 1} (\`${report.target.paragraphId}\` / \`${report.target.collaborationParagraphId}\`)`,
    '',
    '## Metrics',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    line('Canonical allocated nodes', String(work.canonical.allocated)),
    line('Canonical reused nodes', String(work.canonical.reused)),
    line(
      'Canonical total before → after',
      `${work.canonical.totalBefore} → ${work.canonical.totalAfter}`
    ),
    line('Allocated on edited paragraph path', String(work.canonical.allocatedOnParagraphPath)),
    line('Allocated off edited paragraph path', String(work.canonical.allocatedOffParagraphPath)),
    line('Dirty impact', work.dirty.impact),
    line('Dirty ids', work.dirty.dirty.join(', ') || '(none)'),
    line('Created / deleted ids', `${work.dirty.created.length} / ${work.dirty.deleted.length}`),
    line('Dependency keys', String(work.dirty.dependencyKeyCount)),
    line('Layout placed / total', `${work.layout.placed} / ${work.layout.total}`),
    line('Layout reused pages', String(work.layout.reusedPages)),
    line('Layout full passes', String(work.layout.fullPasses)),
    line('Pages before → after', `${work.layout.pagesBefore} → ${work.layout.pagesAfter}`),
    line(
      'Layout cache hits / misses / evictions / size',
      `${work.layout.cache.hits} / ${work.layout.cache.misses} / ${work.layout.cache.evictions} / ${work.layout.cache.size}`
    ),
    line(
      'Reused / new page records',
      `${work.paint.reusedPageRecords} / ${work.paint.newPageRecords}`
    ),
    line('Materialized pages', String(work.paint.materializedPages)),
    line(
      'Reused / rebuilt paint elements',
      `${work.paint.reusedPaintElements} / ${work.paint.rebuiltPaintElements}`
    ),
    line(
      'Transaction median / p95 (ms)',
      `${report.timings.transaction.medianMs.toFixed(3)} / ${report.timings.transaction.p95Ms.toFixed(3)}`
    ),
    line(
      'Layout median / p95 (ms)',
      `${report.timings.layout.medianMs.toFixed(3)} / ${report.timings.layout.p95Ms.toFixed(3)}`
    ),
    line(
      'Paint median / p95 (ms)',
      `${report.timings.paint.medianMs.toFixed(3)} / ${report.timings.paint.p95Ms.toFixed(3)}`
    ),
    line(
      'Total median / p95 (ms)',
      `${report.timings.total.medianMs.toFixed(3)} / ${report.timings.total.p95Ms.toFixed(3)}`
    ),
    line('Heap delta edit (bytes, median)', String(mem.edit)),
    line('Heap delta layout (bytes, median)', String(mem.layout)),
    line('Heap delta paint (bytes, median)', String(mem.paint)),
    line('Heap delta edit through paint (bytes, median)', String(mem.editThroughPaint)),
    line(
      'RSS delta edit through paint (bytes, median)',
      String(report.memory.rssDeltaMedian.editThroughPaint)
    ),
    line(
      'External delta edit through paint (bytes, median)',
      String(report.memory.externalDeltaMedian.editThroughPaint)
    ),
    line('Yjs incremental update (bytes)', String(work.yjs.incrementalUpdateBytes)),
    line('Yjs snapshot after insert (bytes)', String(work.yjs.snapshotBytes)),
    line('Yjs paragraph count', String(work.yjs.paragraphCount)),
    '',
    '## Methods',
    '',
    ...METHODS.map((method) => `- ${method}`),
    '',
    '## Limitations',
    '',
    ...LIMITATIONS.map((limitation) => `- ${limitation}`),
    '',
    '## Command',
    '',
    '```bash',
    `bun scripts/bench/collaboration-local-edit-bench.ts --runs ${report.config.runs} --warmup ${report.config.warmup} --json --out openspec/changes/full-document-yjs-collaboration/local-edit-baseline.json --md openspec/changes/full-document-yjs-collaboration/local-edit-baseline.md`,
    '```',
    '',
  ].join('\n');
}

const args = parseArgs(process.argv.slice(2));
const bytes = new Uint8Array(readFileSync(args.fixture));
const fixtureSha256 = createHash('sha256').update(bytes).digest('hex');
const loaded = readOoxmlPackage(bytes);
if (!loaded.ok) throw new Error(`parse failed: ${loaded.reason}`);
const originalMain = loaded.package.parts.get(loaded.package.mainDocumentPart);
if (!originalMain) throw new Error('main document part missing');
const normalizedMain = normalizeParagraphIdentity(originalMain);
const measurer = createFixedMeasurer(6, 14);
const normalizedStore = new TreePackageStore(loaded.package, normalizedMain);
const normalizedPackage = normalizedStore.currentPackage();
const normalizedPart = normalizedStore.bodyStore().part;
const paragraphs = paragraphsOf(normalizedPart);
if (paragraphs.length === 0) throw new Error('fixture has no paragraphs');
const paragraphIndex = Math.min(
  paragraphs.length - 1,
  Math.max(0, Math.floor((paragraphs.length - 1) * 0.5))
);
const paragraphId = paragraphs[paragraphIndex]!.id;
const port = createCollaborationDocumentPort(normalizedStore, {
  documentId: 'local-edit-baseline',
});
const collaborationParagraphs = port.paragraphs();
const collaborationTarget = collaborationParagraphs.find(
  (paragraph) => paragraph.nodeId === paragraphId
);
if (!collaborationTarget) {
  throw new Error('middle paragraph has no collaboration w14:paraId');
}
const furniture = furnitureFor(normalizedPackage, normalizedPart, measurer);
const yjsWork = measureYjsUpdate(collaborationParagraphs, collaborationTarget.paragraphId);

const transactionTimes: number[] = [];
const layoutTimes: number[] = [];
const paintTimes: number[] = [];
const totalTimes: number[] = [];
const editHeapDeltas: number[] = [];
const layoutHeapDeltas: number[] = [];
const paintHeapDeltas: number[] = [];
const totalHeapDeltas: number[] = [];
const totalRssDeltas: number[] = [];
const totalExternalDeltas: number[] = [];
let work: WorkSnapshot | null = null;
let memoryAfterWarm: MemorySample | null = null;
let memoryAfterEdit: MemorySample | null = null;
let memoryAfterLayout: MemorySample | null = null;
let memoryAfterPaint: MemorySample | null = null;
const rounds = args.warmup + args.runs;
const producer = 'collab-local-edit-bench';

for (let round = 0; round < rounds; round += 1) {
  const store = new TreePackageStore(normalizedPackage, normalizedPart);
  const bodyStore = store.bodyStore();
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache<never>();
  const layoutOptions = { measurer, sectionFurniture: furniture, session, cache, producer };
  const before = layoutSemanticDocument(bodyStore.part, 1, layoutOptions);
  layoutSemanticDocument(bodyStore.part, 2, layoutOptions);
  const pageIndex = pageIndexOfParagraph(before, paragraphId);
  const page = before.pages[pageIndex]!;
  const viewport = { top: page.box.y, height: page.box.height * 2 };
  const materializeBefore = pagesToMaterialize({
    layout: before,
    viewport,
    overscanPages: 1,
    pinnedPages: [pageIndex],
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  paintSemanticLayout(container, before, { scale: 1, materialize: materializeBefore });
  const warmMemory = process.memoryUsage();
  const nodesBefore = bodyStore.part.root;

  const transactionStart = performance.now();
  const transaction = bodyStore.transact((ctx) =>
    ctx.apply({ op: 'insertText', paragraphId, offset: 0, text: 'X' })
  );
  const transactionMs = performance.now() - transactionStart;
  if (!transaction.ok || transaction.change === null) {
    throw new Error('insertText did not commit');
  }
  const afterEditMemory = process.memoryUsage();
  const canonical = canonicalAllocation(nodesBefore, bodyStore.part.root, paragraphId);

  const layoutStart = performance.now();
  const after = layoutSemanticDocument(bodyStore.part, 3, layoutOptions);
  const layoutMs = performance.now() - layoutStart;
  const afterLayoutMemory = process.memoryUsage();

  const materializeAfter = pagesToMaterialize({
    layout: after,
    viewport,
    overscanPages: 1,
    pinnedPages: [pageIndexOfParagraph(after, paragraphId)],
  });
  const paintElementsBefore = [...container.children];
  const paintStart = performance.now();
  paintSemanticLayout(container, after, { scale: 1, materialize: materializeAfter });
  const paintMs = performance.now() - paintStart;
  const afterPaintMemory = process.memoryUsage();
  const paintElementsAfter = [...container.children];
  const reusedPaintElements = paintElementsAfter.filter((element) =>
    paintElementsBefore.includes(element)
  ).length;
  container.remove();

  const beforePages = new Set(before.pages);
  const reusedPageRecords = after.pages.filter((record) => beforePages.has(record)).length;
  const currentWork: WorkSnapshot = {
    layout: {
      ...session.stats,
      pagesBefore: before.pages.length,
      pagesAfter: after.pages.length,
      cache: cache.stats,
    },
    canonical,
    dirty: {
      impact: transaction.change.impact,
      dirty: [...transaction.change.dirty],
      created: [...transaction.change.created],
      deleted: [...transaction.change.deleted],
      dependencyKeyCount: transaction.change.dependencyKeys.length,
    },
    paint: {
      pagesBefore: before.pages.length,
      pagesAfter: after.pages.length,
      reusedPageRecords,
      newPageRecords: after.pages.length - reusedPageRecords,
      materializedPages: materializeAfter.size,
      reusedPaintElements,
      rebuiltPaintElements: paintElementsAfter.length - reusedPaintElements,
    },
    yjs: yjsWork,
  };
  if (work && !sameWork(work, currentWork)) {
    throw new Error('deterministic work counters changed between runs');
  }
  work = currentWork;
  if (round >= args.warmup) {
    transactionTimes.push(transactionMs);
    layoutTimes.push(layoutMs);
    paintTimes.push(paintMs);
    totalTimes.push(transactionMs + layoutMs + paintMs);
    editHeapDeltas.push(afterEditMemory.heapUsed - warmMemory.heapUsed);
    layoutHeapDeltas.push(afterLayoutMemory.heapUsed - afterEditMemory.heapUsed);
    paintHeapDeltas.push(afterPaintMemory.heapUsed - afterLayoutMemory.heapUsed);
    totalHeapDeltas.push(afterPaintMemory.heapUsed - warmMemory.heapUsed);
    totalRssDeltas.push(afterPaintMemory.rss - warmMemory.rss);
    totalExternalDeltas.push(afterPaintMemory.external - warmMemory.external);
    memoryAfterWarm = asMemorySample(warmMemory);
    memoryAfterEdit = asMemorySample(afterEditMemory);
    memoryAfterLayout = asMemorySample(afterLayoutMemory);
    memoryAfterPaint = asMemorySample(afterPaintMemory);
  }
}

if (!work || !memoryAfterWarm || !memoryAfterEdit || !memoryAfterLayout || !memoryAfterPaint) {
  throw new Error('benchmark produced no measured rounds');
}

const report: BenchmarkReport = {
  schema: 1,
  task: 'full-document-yjs-collaboration/1.7',
  capturedAt: new Date().toISOString(),
  fixture: args.fixture,
  fixtureBytes: bytes.length,
  fixtureSha256,
  environment: {
    runtime: `Bun ${Bun.version}`,
    arch: process.arch,
    platform: process.platform,
  },
  config: {
    runs: args.runs,
    warmup: args.warmup,
    measurer: 'fixed(6px,14px)',
    edit: "insertText('X') at offset 0",
  },
  target: {
    paragraphIndex,
    paragraphId,
    collaborationParagraphId: collaborationTarget.paragraphId,
  },
  timings: {
    transaction: summarize(transactionTimes),
    layout: summarize(layoutTimes),
    paint: summarize(paintTimes),
    total: summarize(totalTimes),
  },
  memory: {
    afterWarmLayout: memoryAfterWarm,
    afterEdit: memoryAfterEdit,
    afterLayout: memoryAfterLayout,
    afterPaint: memoryAfterPaint,
    heapUsedDeltaMedian: {
      edit: medianInt(editHeapDeltas),
      layout: medianInt(layoutHeapDeltas),
      paint: medianInt(paintHeapDeltas),
      editThroughPaint: medianInt(totalHeapDeltas),
    },
    rssDeltaMedian: {
      editThroughPaint: medianInt(totalRssDeltas),
    },
    externalDeltaMedian: {
      editThroughPaint: medianInt(totalExternalDeltas),
    },
  },
  work,
  methods: METHODS,
  limitations: LIMITATIONS,
};

const encoded = JSON.stringify(report, null, 2);
if (args.out) writeFileSync(args.out, `${encoded}\n`);
if (args.md) writeFileSync(args.md, renderMarkdown(report));

if (args.json) {
  console.log(encoded);
} else {
  console.log(`fixture: ${args.fixture} (${Math.round(bytes.length / 1024)} KB)`);
  console.log(`runs: ${args.runs} measured + ${args.warmup} warmup; ${report.config.measurer}`);
  console.log(`target: paragraph ${paragraphIndex + 1}/${paragraphs.length} ${paragraphId}`);
  console.log(
    `canonical allocated ${work.canonical.allocated} (path ${work.canonical.allocatedOnParagraphPath}, off-path ${work.canonical.allocatedOffParagraphPath}), reused ${work.canonical.reused}`
  );
  console.log(
    `dirty ${work.dirty.impact} ids=${work.dirty.dirty.join(',')} created=${work.dirty.created.length} deleted=${work.dirty.deleted.length}`
  );
  console.log(
    `layout placed ${work.layout.placed}/${work.layout.total}, reused ${work.layout.reusedPages} pages, cache hits ${work.layout.cache.hits} misses ${work.layout.cache.misses}`
  );
  console.log(
    `paint reused records ${work.paint.reusedPageRecords}, new ${work.paint.newPageRecords}, elements reused ${work.paint.reusedPaintElements} rebuilt ${work.paint.rebuiltPaintElements}`
  );
  console.log(
    `timing median tx ${report.timings.transaction.medianMs.toFixed(2)} ms, layout ${report.timings.layout.medianMs.toFixed(2)} ms, paint ${report.timings.paint.medianMs.toFixed(2)} ms`
  );
  console.log(
    `memory median heap delta edit→paint ${report.memory.heapUsedDeltaMedian.editThroughPaint} bytes`
  );
  console.log(
    `yjs incremental ${work.yjs.incrementalUpdateBytes} bytes, snapshot ${work.yjs.snapshotBytes} bytes, paragraphs ${work.yjs.paragraphCount}`
  );
}
