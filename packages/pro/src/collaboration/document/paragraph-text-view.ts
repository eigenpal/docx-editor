/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Reading and writing a paragraph's shared inline text as canonical nodes.
 *
 * The materializer and the local-edit translator both read a paragraph through
 * `inlineChildren`, so the view a local edit is made against is exactly the one every
 * replica shows.
 */
import * as Y from 'yjs';
import { WML_NAMESPACE_URI, type OoxmlNode } from '@docx-editor.dev/core/store';
import { elementFrom } from './node-shapes.ts';
import { rejectDangerousKey, type DocumentLimits } from './limits.ts';
import type { ParagraphView } from './paragraph-inline-index.ts';
import { asLogicalId, type LogicalId } from './identity.ts';
import { materializeParagraph, type LinearItem } from './paragraph-linear.ts';
import {
  decodeAttributes,
  decodeItems,
  INLINE_FIELD,
  uniqueInlineIds,
  type InlineDeltaOp,
  type SharedCharacter,
  type ShownPiece,
  type ShownSlot,
} from './paragraph-text.ts';
import type { FollowingText } from './paragraph-text-follow.ts';
import { placeFollowingText, type FollowingSlot } from './paragraph-text-placement.ts';

type Delta = { insert?: unknown; attributes?: Record<string, unknown> }[];

/** A paragraph's inline sequence from its shared text, as `view` says it shows. */
function inlineItems(
  text: Y.Text,
  embedOf: (logicalId: LogicalId) => OoxmlNode | null,
  limits: DocumentLimits,
  paragraphId: string,
  view?: ParagraphView,
  onCharacter?: (character: SharedCharacter | null) => void
): readonly LinearItem[] {
  const delta = text.toDelta() as Delta;
  if (!view) return decodeItems(delta, embedOf, limits, paragraphId);
  const shown = view.shown(text);
  if (shown.hidden.size > 0 || shown.incoming.length > 0) view.noteDrift();
  // Many pieces can follow out of one source; its text is decoded once for all of them.
  const wantedBySource = new Map<LogicalId, Set<number>>();
  for (const following of shown.incoming) {
    const wanted = wantedBySource.get(following.source) ?? new Set<number>();
    for (const position of following.positions) wanted.add(position);
    wantedBySource.set(following.source, wanted);
  }
  const decodedBySource = new Map<LogicalId, ReadonlyMap<number, FollowingItem>>();
  for (const [source, wanted] of wantedBySource) {
    decodedBySource.set(
      source,
      followingItems(view.textOf(source), source, wanted, embedOf, limits)
    );
  }
  const placement = placeFollowingText(shown);
  const pieceOf = (following: FollowingText): ShownPiece => {
    const decoded = decodedBySource.get(following.source)!;
    const slots = placement.inside.get(following);
    const entries: ShownPiece['entries'][number][] = [];
    following.positions.forEach((position, index) => {
      const entry = decoded.get(position);
      const slot = slots?.get(index);
      // A character that cannot show still holds the pieces placed at it.
      if (!entry && !slot) return;
      const item = following.items[index];
      entries.push({
        item: entry?.item,
        placement: entry?.placement,
        ...(slot ? { slot: slotOf(slot) } : {}),
        ...(item !== undefined
          ? { character: { item, identity: following.identities[index] ?? null } }
          : {}),
      });
    });
    return { entries };
  };
  const slotOf = (slot: FollowingSlot): ShownSlot => ({
    before: slot.before.map(pieceOf),
    after: slot.after.map(pieceOf),
  });
  const at = new Map<number, ShownSlot>();
  for (const [position, slot] of placement.atPosition) at.set(position, slotOf(slot));
  return decodeItems(delta, embedOf, limits, paragraphId, {
    hidden: shown.hidden,
    following: { at, atEnd: placement.atEnd.map(pieceOf) },
    onRepair: () => view.noteDrift(),
    ...(onCharacter
      ? {
          onCharacter,
          characters: { items: shown.identities.items, ids: shown.identities.ids },
        }
      : {}),
  });
}

/** One character or embed of following text, and for an embed, whether it sits in a run. */
interface FollowingItem {
  readonly item: LinearItem;
  readonly placement: boolean | undefined;
}

/**
 * The characters and embeds at `wanted` positions of a source paragraph's text, decoded where
 * they are, by position.
 */
function followingItems(
  text: Y.Text | null,
  source: LogicalId,
  wanted: ReadonlySet<number>,
  embedOf: (logicalId: LogicalId) => OoxmlNode | null,
  limits: DocumentLimits
): ReadonlyMap<number, FollowingItem> {
  const decoded = new Map<number, FollowingItem>();
  if (!text) return decoded;
  let position = 0;
  for (const op of text.toDelta() as Delta) {
    const length = typeof op.insert === 'string' ? op.insert.length : 1;
    if (typeof op.insert === 'string') {
      let attributes: ReturnType<typeof decodeAttributes> | null = null;
      for (let at = 0; at < length; at += 1) {
        if (!wanted.has(position + at)) continue;
        attributes ??= decodeAttributes(op.attributes, limits, source);
        decoded.set(position + at, {
          item: { kind: 'char', value: op.insert[at]!, attributes },
          placement: undefined,
        });
      }
    } else if (wanted.has(position)) {
      const embed = op.insert as { n?: unknown; r?: unknown } | null;
      const id = embed?.n;
      const node =
        typeof id === 'string' && !rejectDangerousKey(id) ? embedOf(asLogicalId(id)) : null;
      if (node) {
        decoded.set(position, {
          item: {
            kind: 'embed',
            node,
            attributes: decodeAttributes(op.attributes, limits, source),
          },
          placement: embed?.r === 1,
        });
      }
    }
    position += length;
  }
  return decoded;
}

/**
 * The inline children a paragraph shows, after its block children. `embedOf` returns an
 * embedded node's canonical subtree, or null when it cannot be shown; `view` says how
 * the paragraph shows what it shares with other paragraphs. `onCharacter` hears the shared
 * character behind each character shown, in order.
 */
export function inlineChildren(
  paragraphId: string,
  text: Y.Text,
  embedOf: (logicalId: LogicalId) => OoxmlNode | null,
  limits: DocumentLimits,
  view?: ParagraphView,
  onCharacter?: (character: SharedCharacter | null) => void
): readonly OoxmlNode[] {
  const embedded = new Set<string>();
  const lineages = new Set<string>();
  const items = inlineItems(
    text,
    (id) => {
      // Concurrent moves can leave one node embedded in two texts; it shows once.
      if (view && !view.showsEmbed(id)) {
        view.noteDrift();
        return null;
      }
      // Copies of one relocated marker, written by peers that accepted the same join, show
      // once: the first in the text, which every replica reads in the same order. None shows
      // while the original is listed again, as an undo of one of the accepts restores it.
      const lineage = view?.lineageOf?.(id) ?? null;
      if (lineage !== null && lineage !== id) {
        if (lineages.has(lineage) || view!.listed?.(lineage)) {
          view!.noteDrift();
          return null;
        }
        lineages.add(lineage);
      }
      const node = embedOf(id);
      if (node) embedded.add(id);
      return node;
    },
    limits,
    paragraphId,
    view,
    onCharacter
  );
  const shell = elementFrom({
    id: paragraphId,
    kind: 'paragraph',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'p',
    namespaceBindings: [],
    attributes: [],
    children: [],
  });
  const built = materializeParagraph({ shell, items });
  const unique = uniqueInlineIds(built, embedded, view ? (id) => view.shownId(id) : undefined);
  // A renamed ID is one the editor's tree may not have.
  if (view && unique !== built) view.noteDrift();
  return unique.children;
}

/** Give a paragraph record its shared inline text, filled with `ops`. */
export function writeInlineText(record: Y.Map<unknown>, ops: readonly InlineDeltaOp[]): Y.Text {
  const text = new Y.Text();
  record.set(INLINE_FIELD, text);
  let at = 0;
  for (const op of ops) {
    if (typeof op.insert === 'string') {
      text.insert(at, op.insert, { ...op.attributes });
      at += op.insert.length;
    } else {
      text.insertEmbed(at, op.insert, { ...op.attributes });
      at += 1;
    }
  }
  return text;
}

/**
 * `next` with each node that equals a node of `previous` with its ID replaced by that node.
 * Inline nodes are rebuilt from shared text on every read of their paragraph, so a pass that
 * reads an unchanged paragraph reuses its built nodes, as it reuses records' nodes.
 */
export function reuseEqualNodes(
  previous: readonly OoxmlNode[],
  next: readonly OoxmlNode[]
): readonly OoxmlNode[] {
  if (previous.length === 0) return next;
  const byId = new Map(previous.map((node) => [node.id, node]));
  return next.map((node) => {
    const old = byId.get(node.id);
    return old && sameNode(old, node) ? old : node;
  });
}

function sameNode(left: OoxmlNode, right: OoxmlNode): boolean {
  if (left === right) return true;
  if (left.id !== right.id || left.kind !== right.kind) return false;
  if (left.kind === 'textValue' || right.kind === 'textValue') {
    return left.kind === 'textValue' && right.kind === 'textValue' && left.value === right.value;
  }
  return (
    left.namespaceUri === right.namespaceUri &&
    left.localName === right.localName &&
    left.prefix === right.prefix &&
    sameList(
      left.attributes,
      right.attributes,
      (a, b) =>
        a.kind === b.kind &&
        a.namespaceUri === b.namespaceUri &&
        a.localName === b.localName &&
        a.prefix === b.prefix &&
        a.value === b.value
    ) &&
    sameList(
      left.namespaceBindings,
      right.namespaceBindings,
      (a, b) => a.prefix === b.prefix && a.namespaceUri === b.namespaceUri
    ) &&
    sameList(left.children, right.children, sameNode)
  );
}

function sameList<T>(
  left: readonly T[],
  right: readonly T[],
  same: (a: T, b: T) => boolean
): boolean {
  return left.length === right.length && left.every((item, index) => same(item, right[index]!));
}
