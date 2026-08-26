// Fragment-paste intent: resource merge + `insertFragment` in ONE story transaction,
// promoted to a package undo unit (rich-clipboard-fidelity task 2.2, pattern from
// tree-package-images.ts). Undo reverts the tree and the imported styles, numbering,
// media, rels and note parts together — a story-only undo would strand the resources.

import { readOoxmlPackage, type OoxmlPackage } from '../package/ooxml-package.ts';
import { mergeFragmentIntoPackage, type FragmentMergeResult } from './clipboard-fragment-merge.ts';
import type { PackageTransactResult, StoryScope, TreePackageStore } from './tree-package-store.ts';
import type { TreeDocOp } from './tree-op-types.ts';

/** Decoded fragment payloads above this cap are refused before any package work. */
export const MAX_FRAGMENT_DECODED_BYTES = 16 * 1024 * 1024;

export interface FragmentPasteInput {
  readonly paragraphId: string;
  readonly offset: number;
  /** The fragment package zip (from the clipboard codec or the HTML projection). */
  readonly fragmentBytes: Uint8Array;
  readonly lastMarkCovered: boolean;
  /** Ops that clear the current selection first (the surface's deleteSelectionPlan). */
  readonly priorOps?: readonly TreeDocOp[];
}

export type FragmentPasteResult =
  | (Extract<PackageTransactResult, { ok: true }> & { readonly blockCount: number })
  | Extract<PackageTransactResult, { ok: false }>;

/**
 * Read the fragment through the bounded file-open trust boundary, merge its resources,
 * and land its blocks — all inside one transaction. Any refusal leaves the document
 * exactly as it was; the caller (the paste router) degrades to the next flavour.
 */
export function applyFragmentPaste(
  store: TreePackageStore,
  scope: StoryScope,
  input: FragmentPasteInput
): FragmentPasteResult {
  if (input.fragmentBytes.byteLength > MAX_FRAGMENT_DECODED_BYTES) {
    return { ok: false, reason: 'invalidArgs', detail: 'fragment-too-large' };
  }
  const read = readOoxmlPackage(input.fragmentBytes);
  if (!read.ok) {
    return { ok: false, reason: 'invalidArgs', detail: `fragment-read:${read.reason}` };
  }
  const fragment: OoxmlPackage = read.package;

  const resolved = store.resolveStory(scope);
  if (!resolved.ok) {
    return {
      ok: false,
      reason: resolved.reason,
      ...(resolved.detail ? { detail: resolved.detail } : {}),
    };
  }
  const { store: storyStore, story } = resolved;
  if (storyStore.compositionActive || store.compositionSessionOpen()) {
    return { ok: false, reason: 'invalidArgs', detail: 'ime-composition-active' };
  }

  const beforePackage = store.currentPackage();
  const checkpoint = storyStore.checkpoint();
  const beforeDepth = storyStore.historyDepth;
  let blockCount = 0;
  let refusalDetail = '';

  const result = storyStore.transact(
    (ctx) => {
      for (const op of input.priorOps ?? []) {
        if (!ctx.apply(op)) return;
      }
      // The merge MUST run against the transaction's WORKING package — the one the
      // selection-clearing ops above just edited. Merging from `store.currentPackage()`
      // (the pre-transaction snapshot) and replacing the working package wholesale threw
      // those deletions away, so a rich paste over a selection kept the old content.
      let merged: FragmentMergeResult | null = null;
      const packageApplied = ctx.applyPackage((current) => {
        merged = mergeFragmentIntoPackage(current, fragment, story.partName);
        return merged.ok ? merged.pkg : current;
      });
      const landed = merged as FragmentMergeResult | null;
      if (!landed || !landed.ok) {
        refusalDetail = `fragment-merge:${landed ? landed.reason : 'no-merge'}`;
        // Poison the transaction so nothing commits.
        ctx.apply({ op: 'insertText', paragraphId: '\0fragment-abort', offset: 0, text: 'x' });
        return;
      }
      if (!packageApplied) return;
      blockCount = landed.blocks.length;
      ctx.apply({
        op: 'insertFragment',
        paragraphId: input.paragraphId,
        offset: input.offset,
        blocks: landed.blocks,
        lastMarkCovered: input.lastMarkCovered,
      });
    },
    { story }
  );

  if (refusalDetail.length > 0) {
    return { ok: false, reason: 'invalidArgs', detail: refusalDetail };
  }
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
      ...(result.detail ? { detail: result.detail } : {}),
    };
  }
  if (!result.change) return { ok: true, change: null, blockCount };

  const change = store.promoteStoryTransactionToPackageUnit(
    beforePackage,
    storyStore,
    checkpoint,
    beforeDepth
  );
  return { ok: true, change, blockCount };
}
