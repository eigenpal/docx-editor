// Fragment-paste intent: resource merge + `insertFragment` in ONE story transaction,
// promoted to a package undo unit (rich-clipboard-fidelity task 2.2, pattern from
// tree-package-images.ts). Undo reverts the tree and the imported styles, numbering,
// media, rels and note parts together — a story-only undo would strand the resources.
//
// The story store commits the write. Capture must be armed on the package store, the
// same way `addPackageComment` does: `storyStore.transact` alone never entered
// `runObservedStoreTransaction`, so a paste produced no primitive journal and a peer
// never saw the blocks or the imported parts.

import {
  packageTransactionPublished,
  runObservedStoreTransaction,
} from '../package/canonical-primitive-capture.ts';
import { readOoxmlPackage, type OoxmlPackage } from '../package/ooxml-package.ts';
import { mergeFragmentIntoPackage, type FragmentMergeResult } from './clipboard-fragment-merge.ts';
import {
  MAX_FRAGMENT_DEPTH,
  MAX_FRAGMENT_INSERT_BLOCKS,
  MAX_FRAGMENT_NODES,
} from './tree-op-fragment.ts';
import type { OoxmlNode } from '../package/ooxml-tree.ts';
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
 * One early-exit walk over the fragment against the insertFragment budgets.
 *
 * Bounds the BODY blocks/nodes/depth AND the total node count across the resource parts
 * (styles, numbering, notes) the merge walks and re-serializes. A body-only budget let a
 * fragment ship a near-max styles.xml under a one-block body — the merge then paid a
 * multi-second linear pass no cap rejected.
 */
function withinFragmentBudget(fragment: OoxmlPackage): boolean {
  const doc = fragment.parts.get(fragment.mainDocumentPart);
  if (!doc || doc.root.kind !== 'document') return false;
  const body = doc.root.children.find((child) => child.kind === 'body');
  if (!body || body.kind !== 'body') return false;
  if (body.children.length > MAX_FRAGMENT_INSERT_BLOCKS) return false;

  let total = 0;
  const walk = (node: OoxmlNode, depth: number, maxDepth: number): boolean => {
    if (depth > maxDepth) return false;
    total += 1;
    if (total > MAX_FRAGMENT_NODES) return false;
    if (node.kind === 'textValue') return true;
    for (const child of node.children) {
      if (!walk(child, depth + 1, maxDepth)) return false;
    }
    return true;
  };
  for (const block of body.children) {
    if (!walk(block, 1, MAX_FRAGMENT_DEPTH)) return false;
  }
  // The resource parts share the same total-node budget (a deeper structural cap since a
  // styles/numbering tree is legitimately deeper than body blocks).
  for (const [name, part] of fragment.parts) {
    if (name === fragment.mainDocumentPart) continue;
    if (!/\/(styles|numbering|footnotes|endnotes)\.xml$/.test(name)) continue;
    if (!walk(part.root, 1, MAX_FRAGMENT_DEPTH * 4)) return false;
  }
  return true;
}

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

  // The insert budgets, applied BEFORE the merge: `insertFragment` would refuse an
  // oversized fragment anyway, but only after the merge had already walked the whole
  // decompressed envelope a dozen times. One bounded pass here rejects it first.
  if (!withinFragmentBudget(fragment)) {
    return { ok: false, reason: 'invalidArgs', detail: 'fragment-over-budget' };
  }

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

  return runObservedStoreTransaction(
    store,
    () => {
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
        return { ok: false as const, reason: 'invalidArgs' as const, detail: refusalDetail };
      }
      if (!result.ok) {
        return {
          ok: false as const,
          reason: result.reason,
          ...(result.detail ? { detail: result.detail } : {}),
        };
      }
      if (!result.change) return { ok: true as const, change: null, blockCount };

      const change = store.promoteStoryTransactionToPackageUnit(
        beforePackage,
        storyStore,
        checkpoint,
        beforeDepth
      );
      return { ok: true as const, change, blockCount };
    },
    (outcome) => packageTransactionPublished(outcome)
  );
}
