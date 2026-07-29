#!/usr/bin/env bun
/**
 * Edit-pipeline profiler: stage timings AND exact dirty/reused chunk counts.
 *
 * Two properties the earlier scratch versions of this got wrong and this does not:
 *
 *  - Stage boundaries are NON-OVERLAPPING and measured on one clock in a single pass, so the
 *    parts sum to the total by construction. An earlier profile timed freeze costs
 *    independently, outside publication, and the three numbers summed to nearly twice the
 *    stage they were meant to explain.
 *  - Reuse is COUNTED, not inferred from a wall-clock total. "One edit rebuilds one block"
 *    is the actual claim being made about incrementality, and a timing cannot establish it.
 *
 * Usage:
 *   bun scripts/profile/edit-pipeline.ts <fixture.docx> [samples]
 */
import {
  parseDocx,
  DocumentStore,
  ORIGIN_IDS,
  type PackageModel,
  type ParagraphRecord,
} from '@docx-editor.dev/core-contract/store';
import { createDeterministicLayoutShaping, layoutBody } from '@docx-editor.dev/core-contract/layout';
import {
  DisplayBridgeCache,
  toDisplayPages,
} from '../../packages/core/src/editor/display-bridge.ts';
import { semanticChunkStats } from '../../packages/core/src/editor/semantic-index.ts';
import { InteractionFrameStore } from '../../packages/core/src/editor/interaction-frame.ts';

const LAYOUT = { pageWidth: 12240, pageHeight: 15840, margin: 1440 };
const HUMAN = ORIGIN_IDS.mutationHuman;

const round1 = (value: number) => Math.round(value * 10) / 10;
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

function firstParagraphId(model: PackageModel): string {
  for (const story of model.stories.values()) {
    for (const block of story.blocks) {
      if (block.kind === 'paragraph') return (block as ParagraphRecord).id;
    }
  }
  throw new Error('fixture has no paragraph');
}

function countParagraphs(model: PackageModel): number {
  let total = 0;
  for (const story of model.stories.values()) {
    for (const block of story.blocks) if (block.kind === 'paragraph') total += 1;
  }
  return total;
}

function declaredFontFamilies(model: PackageModel): readonly string[] {
  const families = new Set<string>();
  const seen = new Set<object>();
  const visit = (value: unknown, key?: string): void => {
    if (typeof value === 'string') {
      if (
        key === 'ascii' ||
        key === 'hAnsi' ||
        key === 'eastAsia' ||
        key === 'cs' ||
        key?.startsWith('major') ||
        key?.startsWith('minor')
      ) {
        families.add(value);
      }
      return;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (value instanceof Map) {
      for (const entry of value.values()) visit(entry);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    for (const [entryKey, entry] of Object.entries(value)) visit(entry, entryKey);
  };
  visit(model);
  return [...families].sort();
}

const fixture = process.argv[2];
if (!fixture) {
  console.error('usage: bun scripts/profile/edit-pipeline.ts <fixture.docx> [samples]');
  process.exit(1);
}
const samples = Number(process.argv[3] ?? 9);

const parsed = parseDocx(new Uint8Array(await Bun.file(fixture).arrayBuffer()), {
  preserveAll: true,
});
if (!parsed.ok) throw new Error(`parse failed: ${parsed.reason}`);

const store = new DocumentStore(parsed.model);
const paragraphId = firstParagraphId(parsed.model);
const cache = new DisplayBridgeCache();
const frames = new InteractionFrameStore();

const stage = {
  store: [] as number[],
  layout: [] as number[],
  bridge: [] as number[],
  publish: [] as number[],
  total: [] as number[],
};
let counts: Record<string, unknown> = {};

// This profiler measures pipeline scaling rather than font fidelity. It therefore uses one
// contract-level deterministic font/shaper snapshot for the whole run; production previews must
// inject validated real font bytes.
const shaping = createDeterministicLayoutShaping({
  families: declaredFontFamilies(parsed.model),
});

for (let i = 0; i < samples; i += 1) {
  const t0 = performance.now();
  const applied = store.transact(HUMAN, (c) =>
    c.apply({ op: 'insertText', paragraphId, offset: 0, text: 'x' })
  );
  const t1 = performance.now();
  if (!applied.ok) throw new Error('insertText refused');
  const model = store.currentModel;

  const layout = layoutBody(model, { ...LAYOUT, shaping });
  const t2 = performance.now();
  const bridged = toDisplayPages(model, layout.pages, { cache });
  const t3 = performance.now();
  frames.publishLayout({
    modelRevision: store.revision,
    resourceEpoch: 0,
    configurationEpoch: 0,
    display: bridged.display,
    semanticIndex: bridged.semanticIndex,
    navigationGeometry: bridged.navigationGeometry,
    selection: null,
    caret: null,
    selectionGeometry: null,
    focus: { scope: { kind: 'body' }, focused: true },
    composition: { active: false, scope: null },
    currentPage: { viewport: 0, caret: 0 },
  });
  const t4 = performance.now();

  stage.store.push(t1 - t0);
  stage.layout.push(t2 - t1);
  stage.bridge.push(t3 - t2);
  stage.publish.push(t4 - t3);
  stage.total.push(t4 - t0);

  if (i === samples - 1) {
    let items = 0;
    let glyphRuns = 0;
    let clusters = 0;
    for (const page of bridged.display) {
      for (const item of page.items) {
        items += 1;
        if (item.kind === 'text') {
          glyphRuns += item.runs.length;
          clusters += item.clusters.length;
        }
      }
    }
    counts = {
      paragraphs: countParagraphs(model),
      pages: bridged.display.length,
      displayItems: items,
      glyphRuns,
      clusters,
      navigationEdges: bridged.navigationGeometry.visualLines.reduce(
        (n, l) => n + l.edges.length,
        0
      ),
      visualLines: bridged.navigationGeometry.visualLines.length,
      caretStops: bridged.semanticIndex.caretStops.length,
      ownershipRegions: bridged.semanticIndex.ownershipRegions.length,
      // The incrementality claim, counted rather than inferred.
      reuse: {
        paintedSlices: { reused: cache.reused, rebuilt: cache.built },
        paragraphLineSets: { reused: cache.linesReused, rebuilt: cache.linesBuilt },
        semanticBlockChunks: {
          reused: semanticChunkStats.reused,
          rebuilt: semanticChunkStats.rebuilt,
        },
      },
    };
  }
}

const total = median(stage.total);
const parts =
  median(stage.store) + median(stage.layout) + median(stage.bridge) + median(stage.publish);

console.log(
  JSON.stringify(
    {
      fixture,
      samples,
      counts,
      medianMs: {
        store: round1(median(stage.store)),
        layout: round1(median(stage.layout)),
        bridge: round1(median(stage.bridge)),
        publication: round1(median(stage.publish)),
        total: round1(total),
      },
      share: {
        store: `${((100 * median(stage.store)) / total).toFixed(1)}%`,
        layout: `${((100 * median(stage.layout)) / total).toFixed(1)}%`,
        bridge: `${((100 * median(stage.bridge)) / total).toFixed(1)}%`,
        publication: `${((100 * median(stage.publish)) / total).toFixed(1)}%`,
      },
      // Non-overlapping boundaries: this must track `total`.
      partsSumToTotal: round1(parts),
    },
    null,
    1
  )
);
