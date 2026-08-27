/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as Y from 'yjs';
import {
  normalizeParagraphIdentity,
  readOoxmlPackage,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createLayoutSession,
  createParagraphLayoutCache,
  layoutSemanticDocument,
  pagesToMaterialize,
  type SemanticLayout,
} from '@docx-editor.dev/core/layout';
import { paintSemanticLayout } from '@docx-editor.dev/core/output';
import { collectKind, nodeText, walk } from './fixtures.ts';
import { allocationEvidence, percentile, timingSummary, timingVerdict } from './gates.ts';
import { createReplica, destroyReplica, joinReplica } from './replicas.ts';

const FIXTURE = resolve(import.meta.dir, '../../../../../../e2e/fixtures/synthetic-long-edit.docx');
const BUDGETS = resolve(
  import.meta.dir,
  '../../../../../../openspec/changes/full-document-yjs-collaboration/collaboration-budgets.json'
);

const WARMUP = 2;
const RUNS = 9;

function firstText(node: OoxmlNode): { id: string; value: string } {
  let found: { id: string; value: string } | null = null;
  walk(node, (current) => {
    if (!found && current.kind === 'textValue') found = { id: current.id, value: current.value };
  });
  if (!found) throw new Error('paragraph has no text');
  return found;
}

function pageIndexOfParagraph(layout: SemanticLayout, paragraphId: string): number {
  for (const page of layout.pages) {
    for (const fragment of page.fragments) {
      if (fragment.kind === 'paragraph' && fragment.paragraphId === paragraphId) return page.index;
    }
  }
  throw new Error(`paragraph ${paragraphId} is not on any page`);
}

function loadMainPart(): OoxmlPart {
  const bytes = new Uint8Array(readFileSync(FIXTURE));
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(`parse failed: ${loaded.reason}`);
  const main = loaded.package.parts.get(loaded.package.mainDocumentPart);
  if (!main) throw new Error('main document part missing');
  return normalizeParagraphIdentity(main);
}

function collectNodes(root: OoxmlNode): Set<OoxmlNode> {
  const nodes = new Set<OoxmlNode>();
  walk(root, (node) => nodes.add(node));
  return nodes;
}

function parentMap(root: OoxmlNode): Map<OoxmlNode, OoxmlNode> {
  const parents = new Map<OoxmlNode, OoxmlNode>();
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    for (const child of node.children) {
      parents.set(child, node);
      visit(child);
    }
  };
  visit(root);
  return parents;
}

function allocationWork(before: OoxmlNode, after: OoxmlNode, paragraphId: string) {
  const beforeSet = collectNodes(before);
  const parents = parentMap(after);
  let paragraph: OoxmlNode | null = null;
  walk(after, (node) => {
    if (!paragraph && node.id === paragraphId) paragraph = node;
  });
  if (!paragraph) throw new Error('edited paragraph missing');
  const path = new Set<OoxmlNode>();
  let cursor: OoxmlNode | undefined = paragraph;
  while (cursor) {
    path.add(cursor);
    cursor = parents.get(cursor);
  }
  walk(paragraph, (node) => path.add(node));
  let allocated = 0;
  let offPath = 0;
  walk(after, (node) => {
    if (beforeSet.has(node)) return;
    allocated += 1;
    if (!path.has(node)) offPath += 1;
  });
  return { allocated, offPath };
}

export interface RegistryRoundWork {
  readonly localAllocated: number;
  readonly remoteAllocated: number;
  readonly localOffPath: number;
  readonly remoteOffPath: number;
  readonly pagesBefore: number;
  readonly pagesAfter: number;
  // Page RECORDS kept by object identity, not `LayoutSession.stats.reusedPages`. The two
  // differ on a multi-section fixture — the session does not count the edited section's
  // untouched pages — so the budget carries both, and a name that said only "pages" here
  // read as the session counter and got compared against it.
  readonly reusedPageRecords: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly reusedPaintElements: number;
  readonly rebuiltPaintElements: number;
  readonly materializedPages: number;
  readonly updateBytes: number;
}

export interface RegistryTimingEvidence {
  readonly localAuthoring: { medianMs: number; p95Ms: number };
  readonly remoteApply: { medianMs: number; p95Ms: number };
  readonly layout: { medianMs: number; p95Ms: number };
  readonly paint: { medianMs: number; p95Ms: number };
  readonly remoteTotal: { medianMs: number; p95Ms: number };
  readonly remoteTotalVerdict: string;
  readonly work: RegistryRoundWork;
  readonly updateBytes: number;
  readonly snapshotBytes: number;
  readonly rssDeltaMedian: number;
  readonly rssVerdict: string;
}

export const registryTimingEvidence: RegistryTimingEvidence[] = [];

describe('representation spike registry 200-page remote comparison', () => {
  test('records hardware evidence and enforces deterministic work budgets', () => {
    const budgets = JSON.parse(readFileSync(BUDGETS, 'utf8')) as {
      localExact: {
        canonical: { allocated: number; allocatedOffParagraphPath: number };
        layout: {
          reusedPages: number;
          pagesBefore: number;
          pagesAfter: number;
          cache: { hits: number; misses: number };
        };
        paint: {
          reusedPageRecords: number;
          reusedPaintElements: number;
          rebuiltPaintElements: number;
          materializedPages: number;
        };
      };
      maintainedHardware: {
        remoteTimingMaxInclusive: {
          total: { medianMs: number; p95Ms: number };
        };
        rssDeltaMaxInclusive: { editThroughPaint: number };
      };
    };
    const part = loadMainPart();
    const paragraphIndex = Math.min(
      collectKind(part, 'paragraph').length - 1,
      Math.max(0, Math.floor((collectKind(part, 'paragraph').length - 1) * 0.5))
    );
    const targetId = collectKind(part, 'paragraph')[paragraphIndex]!.id;
    const left = createReplica('registry', 'alice', 1, part);
    const right = joinReplica('registry', 'bob', 2, left.lastSnapshot);
    const measurer = createFixedMeasurer(6, 14);
    const localTimes: number[] = [];
    const remoteTimes: number[] = [];
    const layoutTimes: number[] = [];
    const paintTimes: number[] = [];
    const totalTimes: number[] = [];
    const rssDeltas: number[] = [];
    const works: RegistryRoundWork[] = [];
    let snapshotBytes = 0;
    try {
      for (let round = 0; round < WARMUP + RUNS; round += 1) {
        const beforeLeft = left.materializer.current();
        const beforeRight = right.materializer.current();
        const liveParagraph = collectKind(beforeLeft, 'paragraph')[paragraphIndex]!;
        expect(liveParagraph.id).toBe(targetId);
        const text = firstText(liveParagraph);
        const session = createLayoutSession();
        const cache = createParagraphLayoutCache<never>();
        const layoutOptions = { measurer, session, cache, producer: 'representation-spike' };
        const beforeLayout = layoutSemanticDocument(beforeLeft, 1, layoutOptions);
        layoutSemanticDocument(beforeLeft, 2, layoutOptions);
        const pageIndex = pageIndexOfParagraph(beforeLayout, liveParagraph.id);
        const page = beforeLayout.pages[pageIndex]!;
        const viewport = { top: page.box.y, height: page.box.height * 2 };
        const materializeBefore = pagesToMaterialize({
          layout: beforeLayout,
          viewport,
          overscanPages: 1,
          pinnedPages: [pageIndex],
        });
        const container = document.createElement('div');
        document.body.appendChild(container);
        paintSemanticLayout(container, beforeLayout, { scale: 1, materialize: materializeBefore });
        const paintElementsBefore = [...container.children];
        const rssWarm = process.memoryUsage().rss;

        const localStart = performance.now();
        left.backend.insertText(text.id, 0, 'X');
        const afterLeft = left.materializer.rebuild();
        const localMs = performance.now() - localStart;
        const localAlloc = allocationWork(beforeLeft.root, afterLeft.root, targetId);

        const vector = Y.encodeStateVector(right.doc);
        const update = Y.encodeStateAsUpdate(left.doc, vector);
        const remoteStart = performance.now();
        Y.applyUpdate(right.doc, update, 'spike-manual');
        const afterRight = right.materializer.rebuild();
        const remoteMs = performance.now() - remoteStart;
        const remoteAlloc = allocationWork(beforeRight.root, afterRight.root, targetId);

        const layoutStart = performance.now();
        const afterLayout = layoutSemanticDocument(afterLeft, 3, layoutOptions);
        const layoutMs = performance.now() - layoutStart;
        const materializeAfter = pagesToMaterialize({
          layout: afterLayout,
          viewport,
          overscanPages: 1,
          pinnedPages: [pageIndexOfParagraph(afterLayout, liveParagraph.id)],
        });
        const paintStart = performance.now();
        paintSemanticLayout(container, afterLayout, { scale: 1, materialize: materializeAfter });
        const paintMs = performance.now() - paintStart;
        const rssPaint = process.memoryUsage().rss;
        const paintElementsAfter = [...container.children];
        const reusedPaintElements = paintElementsAfter.filter((element) =>
          paintElementsBefore.includes(element)
        ).length;
        container.remove();

        const work: RegistryRoundWork = {
          localAllocated: localAlloc.allocated,
          remoteAllocated: remoteAlloc.allocated,
          localOffPath: localAlloc.offPath,
          remoteOffPath: remoteAlloc.offPath,
          pagesBefore: beforeLayout.pages.length,
          pagesAfter: afterLayout.pages.length,
          reusedPageRecords: afterLayout.pages.filter((record) =>
            beforeLayout.pages.includes(record)
          ).length,
          cacheHits: cache.stats.hits,
          cacheMisses: cache.stats.misses,
          reusedPaintElements,
          rebuiltPaintElements: paintElementsAfter.length - reusedPaintElements,
          materializedPages: materializeAfter.size,
          updateBytes: update.byteLength,
        };

        const undoVector = Y.encodeStateVector(right.doc);
        left.undo.undo();
        left.materializer.rebuild();
        Y.applyUpdate(right.doc, Y.encodeStateAsUpdate(left.doc, undoVector), 'spike-manual');
        right.materializer.rebuild();
        expect(nodeText(collectKind(afterRight, 'paragraph')[paragraphIndex]!)).toMatch(/^X/);

        if (round >= WARMUP) {
          localTimes.push(localMs);
          remoteTimes.push(remoteMs);
          layoutTimes.push(layoutMs);
          paintTimes.push(paintMs);
          totalTimes.push(remoteMs + layoutMs + paintMs);
          rssDeltas.push(rssPaint - rssWarm);
          works.push(work);
          snapshotBytes = Y.encodeStateAsUpdate(left.doc).byteLength;
        }
      }

      const firstWork = works[0]!;
      for (const work of works) expect(work).toEqual(firstWork);
      expect(firstWork.localAllocated).toBe(budgets.localExact.canonical.allocated);
      expect(firstWork.remoteAllocated).toBe(budgets.localExact.canonical.allocated);
      expect(firstWork.localOffPath).toBe(budgets.localExact.canonical.allocatedOffParagraphPath);
      expect(firstWork.remoteOffPath).toBe(0);
      expect(firstWork.pagesBefore).toBe(budgets.localExact.layout.pagesBefore);
      expect(firstWork.pagesAfter).toBe(budgets.localExact.layout.pagesAfter);
      expect(firstWork.reusedPageRecords).toBe(budgets.localExact.paint.reusedPageRecords);
      expect(firstWork.cacheHits).toBe(budgets.localExact.layout.cache.hits);
      expect(firstWork.cacheMisses).toBe(budgets.localExact.layout.cache.misses);
      expect(firstWork.reusedPaintElements).toBe(budgets.localExact.paint.reusedPaintElements);
      expect(firstWork.rebuiltPaintElements).toBe(budgets.localExact.paint.rebuiltPaintElements);
      expect(firstWork.materializedPages).toBe(budgets.localExact.paint.materializedPages);

      const remoteTotal = timingSummary(totalTimes);
      const ceiling = budgets.maintainedHardware.remoteTimingMaxInclusive.total;
      const totalVerdict = timingVerdict(remoteTotal, ceiling);
      const rssDeltaMedian = percentile(rssDeltas, 0.5);
      const rssCeiling = budgets.maintainedHardware.rssDeltaMaxInclusive.editThroughPaint;
      const rssVerdict = rssDeltaMedian <= rssCeiling ? 'pass' : 'kill';
      const evidence: RegistryTimingEvidence = {
        localAuthoring: timingSummary(localTimes),
        remoteApply: timingSummary(remoteTimes),
        layout: timingSummary(layoutTimes),
        paint: timingSummary(paintTimes),
        remoteTotal,
        remoteTotalVerdict: totalVerdict,
        work: firstWork,
        updateBytes: firstWork.updateBytes,
        snapshotBytes,
        rssDeltaMedian,
        rssVerdict,
      };
      registryTimingEvidence.push(evidence);
      console.warn('representation-spike-200-page', JSON.stringify(evidence, null, 2));
      expect(
        allocationEvidence('registry', firstWork.localAllocated, firstWork.remoteAllocated).verdict
      ).toBe('pass');
    } finally {
      destroyReplica(right);
      destroyReplica(left);
    }
  }, 1_200_000);
});
