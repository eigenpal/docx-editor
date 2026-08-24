// Body paragraph → section index with a session-owned cache (no generic sidecars).
//
// Builds the full paragraph map once on first body lookup, then preserves it across proven
// body text-local edits. Invalidation is subscription-driven from TreeModelChange — never
// from a structure-key rescan on lookup.

import type { TreeDocxSessionView } from '../binding/tree-session.ts';
import { enumerateDocumentSections } from '../layout/section-properties.ts';
import { storyBlocks } from '../layout/story-roots.ts';
import { DEPENDENCY_KEY_IDS, ORIGIN_IDS } from '../store/registry/frozen-ids.ts';
import type { TreeModelChange } from '../store/store/tree-store.ts';
import type { OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';

const MAX_WALK_DEPTH = 32;

let bodySectionIndexRebuilds = 0;
let bodySectionTraversalVisits = 0;

/** @internal Warm-path recorder for body section index tests. */
export function bodySectionIndexTestRecorder(): {
  readonly rebuilds: number;
  readonly traversalVisits: number;
  reset(): void;
} {
  return {
    get rebuilds() {
      return bodySectionIndexRebuilds;
    },
    get traversalVisits() {
      return bodySectionTraversalVisits;
    },
    reset() {
      bodySectionIndexRebuilds = 0;
      bodySectionTraversalVisits = 0;
    },
  };
}

function collectParagraphs(
  node: OoxmlNode,
  sectionIndex: number,
  into: Map<string, number>,
  depth: number
): void {
  if (node.kind === 'textValue' || depth > MAX_WALK_DEPTH) return;
  if (node.kind === 'paragraph') {
    if (!into.has(node.id)) into.set(node.id, sectionIndex);
    return;
  }
  for (const child of node.children) collectParagraphs(child, sectionIndex, into, depth + 1);
}

/** Walk oracle used by parity tests and cold cache builds. */
export function buildBodyParagraphSectionIndex(part: OoxmlPart): ReadonlyMap<string, number> {
  bodySectionTraversalVisits += 1;
  const blocks = storyBlocks(part);
  const sections = enumerateDocumentSections(part);
  const map = new Map<string, number>();
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index]!;
    for (
      let blockIndex = section.blockStart;
      blockIndex < section.blockEndExclusive;
      blockIndex += 1
    ) {
      const block = blocks[blockIndex];
      if (block) collectParagraphs(block, index, map, 0);
    }
  }
  return map;
}

interface BodySectionCacheEntry {
  map: ReadonlyMap<string, number> | null;
  subscribed: boolean;
}

const bodySectionCacheBySession = new WeakMap<TreeDocxSessionView, BodySectionCacheEntry>();

function preservesBodySectionMap(change: TreeModelChange): boolean {
  if (!change.story) return false;
  if (change.origin === ORIGIN_IDS.mutationUndo || change.origin === ORIGIN_IDS.mutationRedo) {
    return false;
  }
  if (change.impact !== 'text-local') return false;
  if (change.created.length > 0 || change.deleted.length > 0 || change.splitJoin.length > 0) {
    return false;
  }
  if (change.dependencyKeys.includes(DEPENDENCY_KEY_IDS.section)) return false;
  return true;
}

function onBodySectionModelChange(entry: BodySectionCacheEntry, change: TreeModelChange): void {
  if (change.story && change.story.kind !== 'body') return;
  if (preservesBodySectionMap(change)) return;
  entry.map = null;
}

function ensureBodySectionSubscription(
  session: TreeDocxSessionView,
  entry: BodySectionCacheEntry
): void {
  if (entry.subscribed) return;
  entry.subscribed = true;
  session.subscribe((change) => onBodySectionModelChange(entry, change));
}

function bodySectionMapForSession(
  session: TreeDocxSessionView,
  part: OoxmlPart
): ReadonlyMap<string, number> {
  let entry = bodySectionCacheBySession.get(session);
  if (!entry) {
    entry = { map: null, subscribed: false };
    bodySectionCacheBySession.set(session, entry);
  }
  ensureBodySectionSubscription(session, entry);
  if (!entry.map) {
    bodySectionIndexRebuilds += 1;
    entry.map = buildBodyParagraphSectionIndex(part);
  }
  return entry.map;
}

/** Session-owned cache with subscription-driven invalidation. */
export function bodyParagraphSectionIndexForSession(
  session: TreeDocxSessionView,
  part: OoxmlPart,
  paragraphId: string
): number | null {
  if (!paragraphId.startsWith(`${part.name}#`)) return null;
  return bodySectionMapForSession(session, part).get(paragraphId) ?? null;
}
