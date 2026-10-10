// Review-path benchmark: what the comment / tracked-change derivations cost at scale.
//
// Runs against the review-heavy fixture built by scripts/create-review-20x-fixture.mjs
// (~1080 comments + ~800 tracked-change sites at 20x) and measures the paths a review
// document actually exercises: session open, the full queue derivation, predicate projection,
// the per-keystroke cached / locally-patched reads, the store-lane sub-derivations, and layout
// with both full and predicate-filtered markup.
//
// The review-model hooks come from the pro review module, exactly as `createDocxEditor`
// receives them. Pro's `@docx-editor.dev/core/*` imports resolve to core SRC through its
// tsconfig `paths` when bun runs this from the workspace, so the whole bench is one engine
// copy (consumer installs resolve the same specifiers to dist through the export maps).
//
// Usage: bun scripts/bench/review-bench.ts [fixturePath] [--json]

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  collectReviewItems,
  commentAnchorsOfStory,
  locateSites,
  paragraphOrderOfPart,
  revisionItemsOf,
  type OoxmlNode,
  type OoxmlParagraphNode,
} from '../../packages/core/src/store/index.ts';
import { reviewModule } from '../../packages/pro/src/index.ts';
import { commentsOfPart } from '../../packages/core/src/store/store/comment-reads.ts';
import { openTreeSession } from '../../packages/core/src/binding/tree-session.ts';
import { createRevisionAuthorVisibility } from '../../packages/core/src/editor/revision-author-visibility.ts';
import {
  createFixedMeasurer,
  createLayoutSession,
  layoutSemanticDocument,
} from '../../packages/core/src/layout/index.ts';

const fixture = resolve(
  process.argv[2] && !process.argv[2].startsWith('--')
    ? process.argv[2]
    : 'examples/vite/public/sample-review-20x.docx'
);
const asJson = process.argv.includes('--json');

interface StageResult {
  stage: string;
  ms: number;
  note?: string;
}
const results: StageResult[] = [];
function stage<T>(name: string, fn: () => T, note?: (value: T) => string): T {
  const t0 = performance.now();
  const value = fn();
  const ms = performance.now() - t0;
  results.push({ stage: name, ms, ...(note ? { note: note(value) } : {}) });
  return value;
}

const bytes = new Uint8Array(readFileSync(fixture));
results.push({ stage: 'fixture', ms: 0, note: `${fixture} (${(bytes.length / 1024) | 0} KB)` });

const reviewModel = reviewModule().review!;

// ── session open (parse + identity + store) ──
const opened = stage('openTreeSession', () => openTreeSession(bytes, { reviewModel }));
if (!opened.ok) throw new Error(`open failed: ${opened.reason}`);
const session = opened.session;

// ── the review queue ──
const items = stage(
  'reviewItems (cold, document open)',
  () => session.reviewItems(),
  (list) => {
    const comments = list.filter((item) => item.kind === 'comment').length;
    const revisions = list.filter((item) => item.kind === 'revision').length;
    return `${list.length} items (${comments} comments, ${revisions} revisions)`;
  }
);
stage('reviewItems (cached)', () => session.reviewItems());
stage('hasReviewContent', () => session.hasReviewContent());

// ── predicate projection ──
// The editor asks for this projection from several render paths. The first read may scan the
// review queue, but every later read of the unchanged queue must be an identity hit: a predicate
// cannot become a per-page or per-paint full-document walk on revision-heavy files.
const predicateVisibility = createRevisionAuthorVisibility();
const firstRevisionId = items.find((item) => item.kind === 'revision')?.id;
let predicateCalls = 0;
predicateVisibility.setTrackedChangePredicate((revision) => {
  predicateCalls += 1;
  return revision.id !== firstRevisionId;
});
const predicateFilter = stage(
  'tracked-change predicate (cold)',
  () => predicateVisibility.filterFor(items),
  () => `${predicateCalls} predicate calls`
);
const callsAfterColdProjection = predicateCalls;
stage(
  'tracked-change predicate (cached)',
  () => predicateVisibility.filterFor(items),
  () => `${predicateCalls - callsAfterColdProjection} additional predicate calls`
);

// ── keystroke paths ──
const paragraphs = (() => {
  const found: OoxmlParagraphNode[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'paragraph') {
      found.push(node);
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(session.part().root);
  return found;
})();

const reviewedParagraphIds = new Set<string>();
for (const item of items) {
  if (item.kind === 'comment' && item.range) reviewedParagraphIds.add(item.range.start.paragraphId);
  if (item.kind === 'revision') {
    for (const range of item.ranges) reviewedParagraphIds.add(range.start.paragraphId);
  }
}
const plainParagraph = paragraphs.find((paragraph) => !reviewedParagraphIds.has(paragraph.id));
const revisionParagraphId = items.find((item) => item.kind === 'revision' && item.ranges.length > 0)
  ?.ranges?.[0]?.start.paragraphId;
const revisionParagraph = paragraphs.find((paragraph) => paragraph.id === revisionParagraphId);

function keystrokeRound(name: string, paragraph: OoxmlParagraphNode | undefined, rounds: number) {
  if (!paragraph) {
    results.push({ stage: name, ms: 0, note: 'no target paragraph found' });
    return;
  }
  const timings: number[] = [];
  for (let i = 0; i < rounds; i++) {
    const applied = session.applyTreeOps([
      { op: 'insertText', paragraphId: paragraph.id, offset: 0, text: 'X' },
    ]);
    if (!applied.committed) {
      results.push({ stage: name, ms: 0, note: `apply refused` });
      return;
    }
    const t0 = performance.now();
    session.reviewItems();
    timings.push(performance.now() - t0);
  }
  timings.sort((a, b) => a - b);
  results.push({
    stage: name,
    ms: timings[timings.length >> 1]!,
    note: `median of ${rounds} keystrokes (min ${timings[0]!.toFixed(1)}, max ${timings[timings.length - 1]!.toFixed(1)})`,
  });
}

keystrokeRound('reviewItems after keystroke (plain ¶)', plainParagraph, 10);
keystrokeRound('reviewItems after keystroke (revision ¶)', revisionParagraph, 10);

// ── store-lane sub-derivations, on the current part ──
const part = session.part();
const pkg = session.currentPackage();
const commentsPart = [...pkg.parts.values()].find((candidate) =>
  candidate.name.endsWith('comments.xml')
);

// The keystroke rounds above local-patched without a full derivation, so the root-level
// memos are cold for the CURRENT tree: this is the re-derive an accept, reject, comment
// write or undo pays.
stage('collectReviewItems (fresh root)', () =>
  collectReviewItems({ storyPart: part, commentsPart })
);
// And this is what any second reader of the same revision pays.
{
  const timings: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    collectReviewItems({ storyPart: part, commentsPart });
    timings.push(performance.now() - t0);
  }
  timings.sort((a, b) => a - b);
  results.push({
    stage: 'collectReviewItems (repeat, unchanged tree)',
    ms: timings[2]!,
    note: 'median of 5 repeats',
  });
}
stage(
  'revisionItemsOf',
  () => revisionItemsOf(part),
  (list) => `${list.length} cards`
);
stage(
  'locateSites',
  () => locateSites(part),
  (map) => `${map.size} sites`
);
stage(
  'commentAnchorsOfStory',
  () => commentAnchorsOfStory(part),
  (list) => `${list.length} anchors`
);
stage(
  'paragraphOrderOfPart',
  () => paragraphOrderOfPart(part),
  (map) => `${map.size} paragraphs`
);
if (commentsPart) {
  stage(
    'commentsOfPart',
    () => commentsOfPart(commentsPart),
    (list) => `${list.length} records`
  );
}

// ── layout with markup (the painted view of a reviewed document) ──
const measurer = createFixedMeasurer(6, 14);
const layoutSession = createLayoutSession();
const layout = stage(
  'layoutSemanticDocument (cold)',
  () => layoutSemanticDocument(part, 1, { measurer, session: layoutSession, producer: 'bench' }),
  (l) => `${l.pages.length} pages`
);
stage('layout (no-change, warm)', () =>
  layoutSemanticDocument(part, 2, { measurer, session: layoutSession, producer: 'bench' })
);
if (predicateFilter) {
  const predicateLayoutSession = createLayoutSession();
  stage(
    'layout with predicate (cold)',
    () =>
      layoutSemanticDocument(part, 1, {
        measurer,
        session: predicateLayoutSession,
        producer: 'bench-predicate',
        revisionAuthorFilter: predicateFilter,
      }),
    (value) => `${value.pages.length} pages`
  );
  stage('layout with predicate (no-change, warm)', () =>
    layoutSemanticDocument(part, 2, {
      measurer,
      session: predicateLayoutSession,
      producer: 'bench-predicate',
      revisionAuthorFilter: predicateFilter,
    })
  );
}

if (asJson) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const r of results) {
    console.log(`${r.stage.padEnd(44)} ${r.ms.toFixed(1).padStart(9)} ms  ${r.note ?? ''}`);
  }
  console.log(`pages: ${layout.pages.length}`);
}
