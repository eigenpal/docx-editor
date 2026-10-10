/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Children that OOXML allows once, written twice by concurrent peers.
 *
 * Two people formatting one paragraph at the same moment each give it a `w:pPr` when it had
 * none, or each add a `w:jc` to the `w:pPr` it had. Both writes are valid on their own; merged,
 * the paragraph holds two of an element its schema allows once. Validation then refuses the
 * whole part on every replica in the room, including peers that made no edit, and the
 * session ends for everyone.
 *
 * The rule here decides, from shared state alone, which copy each replica shows: the first
 * live copy in the parent's child order, which Yjs gives every replica identically. A
 * leading properties element also moves to the front, because a concurrent insert at index
 * 0 can land before it. Copies that lose stay in Yjs, exactly as the losing runs of a
 * concurrent split do, so undo still finds them.
 *
 * The materializer and the journal projection both read this one function. The visible
 * child order a local edit addresses is then the order every journal translates back into
 * shared positions, and a later edit lands where its author saw it.
 *
 * Duplicates the source file already held are not a conflict and stay as loaded: the rule
 * acts only on a group that some peer wrote into.
 */

import { WML_NAMESPACE_URI } from '@docx-editor.dev/core/store';
import { rejectDangerousKey } from './limits.ts';
import { replicaOfLogicalId, type LogicalId } from './identity.ts';
import { childArrayOf, isNodeMap, namespaceUriOf, readNodeShell } from './schema.ts';
import type { DocumentRegistry } from './registry.ts';

/** What the rule needs to know about one child. Null for a child that does not exist. */
export interface ChildShell {
  readonly kind: string;
  readonly namespaceUri: string;
  readonly localName: string;
  /** An element with no children. Absent means it has some, or that nobody asked. */
  readonly empty?: boolean;
}

/** Known child kinds that one parent kind holds at most once. */
const SINGLETON_KINDS: ReadonlyMap<string, readonly string[]> = new Map(
  Object.entries({
    paragraph: ['paragraphProperties'],
    run: ['runProperties'],
    paragraphProperties: ['runProperties'],
    table: ['tableProperties', 'tableGrid'],
    // ECMA-376 `CT_Anchor` and `CT_Inline`: a peer that moves, resizes or describes a drawing
    // writes a new child in place of the old one, and two such peers leave two.
    anchoredDrawing: [
      'drawingSimplePos',
      'drawingPositionH',
      'drawingPositionV',
      'drawingExtent',
      'drawingEffectExtent',
      'drawingDocPr',
      'drawingGraphicFramePr',
      'drawingGraphic',
      'drawingSizeRelH',
      'drawingSizeRelV',
    ],
    inlineDrawing: [
      'drawingExtent',
      'drawingEffectExtent',
      'drawingDocPr',
      'drawingGraphicFramePr',
      'drawingGraphic',
    ],
  })
);

const WRAP_KINDS = new Set([
  'drawingWrapNone',
  'drawingWrapSquare',
  'drawingWrapTight',
  'drawingWrapThrough',
  'drawingWrapTopBottom',
]);

/**
 * Children a parent kind never holds, by the parent's kind. A drawing's placement element is
 * one record whose kind is `wp:inline` or `wp:anchor`: a peer who makes it inline while
 * another gives the anchor a wrap leaves an inline drawing with a wrap element, which the
 * schema refuses, so the whole part stopped applying on every replica.
 */
const NOT_ALLOWED: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [
    'inlineDrawing',
    new Set([
      'drawingSimplePos',
      'drawingPositionH',
      'drawingPositionV',
      'drawingSizeRelH',
      'drawingSizeRelV',
      ...WRAP_KINDS,
    ]),
  ],
]);

/** Choice groups whose members are worth nothing without their content. */
const CONTENT_GROUPS = new Set(['choice:position']);

/**
 * Parents whose children are one choice: a drawing is inline or anchored, a position holds
 * one of `wp:align`, `wp:posOffset` or a percentage, and an anchor one wrap element.
 */
const CHOICE_GROUPS: ReadonlyMap<string, (child: ChildShell) => string | null> = new Map(
  Object.entries({
    drawing: (child) =>
      child.kind === 'anchoredDrawing' || child.kind === 'inlineDrawing'
        ? 'choice:placement'
        : null,
    drawingPositionH: () => 'choice:position',
    drawingPositionV: () => 'choice:position',
    anchoredDrawing: (child) => (WRAP_KINDS.has(child.kind) ? 'choice:wrap' : null),
  })
);

/** The singleton that has to be its parent's first child. */
const LEADING_KIND: Readonly<Record<string, string>> = {
  paragraph: 'paragraphProperties',
  run: 'runProperties',
};

/**
 * The only `w:pPr` children the paragraph-mark `w:rPr` may precede. The core validator holds
 * the same rule (`validKnownKind`, `paragraphProperties`): `w:jc` after the mark's `w:rPr`
 * refuses the part. One author appending the mark's `w:rPr` while another inserts `w:jc` at the
 * same index can merge in that order, so a replica shows the mark's `w:rPr` after the rest.
 */
const AFTER_MARK_PROPERTIES = new Set(['sectPr', 'pPrChange']);

function mayFollowMarkProperties(shell: ChildShell): boolean {
  return (
    shell.kind === 'generic' &&
    shell.namespaceUri === WML_NAMESPACE_URI &&
    AFTER_MARK_PROPERTIES.has(shell.localName)
  );
}

/**
 * Property containers whose direct WML children each appear once (ECMA-376 `CT_PPr`,
 * `CT_RPr`, `CT_TblPr`): two `w:jc` in one `w:pPr` make a document that is not valid.
 */
const UNIQUE_PROPERTY_PARENTS = new Set([
  'paragraphProperties',
  'runProperties',
  'tableProperties',
]);

function groupKey(parentKind: string, child: ChildShell): string | null {
  if (SINGLETON_KINDS.get(parentKind)?.includes(child.kind)) return `kind:${child.kind}`;
  const choice = CHOICE_GROUPS.get(parentKind)?.(child);
  if (choice) return choice;
  if (
    UNIQUE_PROPERTY_PARENTS.has(parentKind) &&
    child.kind === 'generic' &&
    child.namespaceUri === WML_NAMESPACE_URI
  ) {
    return `wml:${child.localName}`;
  }
  return null;
}

/** True when this parent kind can hold a concurrent singleton conflict at all. */
export function hasSingletonRules(parentKind: string | null): boolean {
  return (
    parentKind !== null &&
    (SINGLETON_KINDS.has(parentKind) ||
      CHOICE_GROUPS.has(parentKind) ||
      NOT_ALLOWED.has(parentKind) ||
      UNIQUE_PROPERTY_PARENTS.has(parentKind))
  );
}

/** What a replica shows of one child list, when a conflict changes it. */
export interface SingletonLayout {
  /** Indexes of `children` a replica shows, in the order it shows them. */
  readonly order: readonly number[];
  /**
   * Each group winner's index, mapped to the indexes of the copies it hides. Deleting a winner
   * has to delete these too, or the next copy would show the value its author just removed.
   */
  readonly companions: ReadonlyMap<number, readonly number[]>;
}

/**
 * The children of one parent as a replica shows them, or null when nothing changes, which is
 * the ordinary case, so callers allocate only for a real conflict.
 *
 * `children` is the parent's shared child array. `shellOf` reads a child's kind and name and
 * returns null for a child the caller already excludes (a tombstone, a split loser): an
 * excluded child neither shows nor wins a group. A repeated id is not a second copy: the
 * caller reports it as a duplicate child and keeps the first listing, so it joins no group.
 * Each shell is read once, because rebuilt paragraphs and runs pass through here per keystroke.
 */
export function singletonLayout<Id extends string>(
  parentKind: string | null,
  children: readonly Id[],
  shellOf: (id: Id) => ChildShell | null
): SingletonLayout | null {
  if (!hasSingletonRules(parentKind)) return null;
  const kind = parentKind!;
  const groups = new Map<string, number[]>();
  const seen = new Set<string>();
  const shells: (ChildShell | null)[] = [];
  const notAllowed = NOT_ALLOWED.get(kind);
  const hidden = new Set<number>();
  let firstShown = -1;
  for (let index = 0; index < children.length; index += 1) {
    const id = children[index]!;
    if (seen.has(id)) continue;
    seen.add(id);
    const shell = shellOf(id);
    shells[index] = shell;
    if (!shell) continue;
    if (notAllowed?.has(shell.kind)) {
      hidden.add(index);
      continue;
    }
    // A hidden copy always follows its group's winner, so the first live child is shown.
    if (firstShown < 0) firstShown = index;
    const key = groupKey(kind, shell);
    if (key === null) continue;
    const members = groups.get(key);
    if (members) members.push(index);
    else groups.set(key, [index]);
  }
  const companions = new Map<number, readonly number[]>();
  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    // A group nobody wrote into is the file's own content. Keep it as loaded.
    if (members.every((index) => replicaOfLogicalId(children[index]!) === null)) continue;
    // A position's value is its text: two peers' undos can restore an element whose value
    // one of them took away, so a copy that still holds one wins over an empty one.
    const preferred = CONTENT_GROUPS.has(key)
      ? (members.find((index) => shells[index]?.empty !== true) ?? members[0]!)
      : members[0]!;
    const losers = members.filter((index) => index !== preferred);
    for (const index of losers) hidden.add(index);
    companions.set(preferred, losers);
  }
  const leadingKey = LEADING_KIND[kind] ? `kind:${LEADING_KIND[kind]}` : null;
  const leading = leadingKey ? groups.get(leadingKey)?.[0] : undefined;
  const moveLeading = leading !== undefined && firstShown !== leading;
  // The paragraph mark's `w:rPr` goes after the last shown sibling it may not precede.
  const trailing =
    kind === 'paragraphProperties' ? groups.get('kind:runProperties')?.[0] : undefined;
  let trailAfter = -1;
  if (trailing !== undefined) {
    for (let index = trailing + 1; index < children.length; index += 1) {
      const shell = shells[index];
      if (shell && !hidden.has(index) && !mayFollowMarkProperties(shell)) trailAfter = index;
    }
  }
  if (hidden.size === 0 && !moveLeading && trailAfter < 0) return null;
  const order: number[] = [];
  if (moveLeading) order.push(leading);
  for (let index = 0; index < children.length; index += 1) {
    if (hidden.has(index) || (moveLeading && index === leading)) continue;
    if (trailAfter >= 0 && index === trailing) continue;
    order.push(index);
    if (index === trailAfter) order.push(trailing!);
  }
  return { order, companions };
}

/** The indexes of `children` a replica shows, in order, or null when nothing changes. */
function visibleChildOrder<Id extends string>(
  parentKind: string | null,
  children: readonly Id[],
  shellOf: (id: Id) => ChildShell | null
): readonly number[] | null {
  return singletonLayout(parentKind, children, shellOf)?.order ?? null;
}

/** One live child's shell from shared state, or null for a tombstone or an absent record. */
export function sharedChildShell(registry: DocumentRegistry, id: LogicalId): ChildShell | null {
  if (rejectDangerousKey(id) || registry.isTombstoned(id)) return null;
  const record = registry.schema.nodes.get(id);
  if (!isNodeMap(record)) return null;
  const shell = readNodeShell(record);
  return {
    kind: shell.kind,
    namespaceUri: namespaceUriOf(registry.schema.namespaces, shell.namespaceId),
    localName: shell.localName,
    ...(childArrayOf(record)?.length === 0 ? { empty: true } : {}),
  };
}

/** `childIds` split into the ids a replica shows, in order, and the ids a conflict hides. */
export function partitionChildIds<Id extends string>(
  parentKind: string | null,
  childIds: readonly Id[],
  shellOf: (id: Id) => ChildShell | null
): { readonly shown: readonly Id[]; readonly hidden: readonly Id[] } {
  const order = visibleChildOrder(parentKind, childIds, shellOf);
  if (!order) return { shown: childIds, hidden: [] };
  const shown = order.map((index) => childIds[index]!);
  // A repeated id stays shown once; only a losing copy is hidden.
  const kept = new Set(shown);
  return { shown, hidden: childIds.filter((id) => !kept.has(id)) };
}

/**
 * Property containers whose copies merge instead of hiding whole. Two people formatting one
 * paragraph at once each mean their own property: an indent from one and an alignment from
 * the other is both. The shown copy keeps its own value of a property both wrote.
 */
export const MERGED_KINDS: ReadonlySet<string> = new Set([
  'paragraphProperties',
  'runProperties',
  'tableProperties',
]);

/**
 * `partitionChildIds`, plus, for each shown property container that won a concurrent group,
 * the hidden copies whose children it also shows, after its own.
 */
export function partitionWithMerges<Id extends string>(
  parentKind: string | null,
  childIds: readonly Id[],
  shellOf: (id: Id) => ChildShell | null
): {
  readonly shown: readonly Id[];
  readonly hidden: readonly Id[];
  readonly merges: ReadonlyMap<Id, readonly Id[]> | null;
} {
  const layout = singletonLayout(parentKind, childIds, shellOf);
  if (!layout) return { shown: childIds, hidden: [], merges: null };
  const shown = layout.order.map((index) => childIds[index]!);
  const kept = new Set(shown);
  return {
    shown,
    hidden: childIds.filter((id) => !kept.has(id)),
    merges: containerMerges(layout, childIds, shellOf),
  };
}

/** The hidden copies each winning property container shows the children of. */
function containerMerges<Id extends string>(
  layout: SingletonLayout,
  childIds: readonly Id[],
  shellOf: (id: Id) => ChildShell | null
): Map<Id, readonly Id[]> | null {
  let merges: Map<Id, readonly Id[]> | null = null;
  for (const [winner, losers] of layout.companions) {
    const shell = shellOf(childIds[winner]!);
    if (!shell || !MERGED_KINDS.has(shell.kind)) continue;
    merges ??= new Map();
    merges.set(
      childIds[winner]!,
      losers.map((index) => childIds[index]!)
    );
  }
  return merges;
}
