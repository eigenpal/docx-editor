// Tracked FORMAT changes — `w:rPrChange` and `w:pPrChange` (tracked-edits seam).
//
// The third kind of tracked edit, beside content wrappers (`tree-op-tracked.ts`) and
// paragraph marks (`tree-op-tracked-marks.ts`). Content revisions keep the CHARACTERS and say
// who added or struck them; this one keeps the characters exactly as they were and says what
// their PROPERTIES used to be.
//
// The shape is the same for all three containers: the container keeps its new children, and
// gains one change wrapper holding a copy of the container as it was.
//
//   w:rPr        → w:rPrChange/w:rPr   (CT_RPrChange over CT_RPrOriginal,      §17.13.5.30)
//   w:pPr/w:rPr  → w:rPrChange/w:rPr   (CT_ParaRPrChange over CT_ParaRPrOriginal, §17.13.5.31)
//   w:pPr        → w:pPrChange/w:pPr   (CT_PPrChange over CT_PPrBase,           §17.13.5.29)
//
// TWO RULES DO ALL THE WORK.
//
// THE RECORD IS THE ORIGINAL, NOT THE PREVIOUS STATE. Only one change wrapper may sit in a
// container, so a second format press over an already-pending change cannot record a second
// step. It keeps the record that is already there — the state Reject has to restore — and
// only re-attributes it. Recording the intermediate state instead would make Reject restore
// a document nobody ever saw.
//
// A WRITE THAT ARRIVES BACK AT THE ORIGINAL LEAVES NO RECORD. Turning Bold on and off again
// is not two proposals, and a card offering to revert a change that no longer exists is worse
// than no card: accepting and rejecting it both produce the same document, so the reviewer
// cannot tell what they decided. This is the same rule `retractsOwnParagraphMark` applies to
// a break the author took back.
//
// `resolveRevisions` already resolves both wrappers — accept drops the record, reject
// restores what it holds. This module is the missing WRITE half.

import { WML_NAMESPACE_URI, type OoxmlNode, type OoxmlPart } from '../package/ooxml-tree.ts';
import { parentNodeOf } from '../package/ooxml-edit.ts';
import { equivalentNodes } from './ooxml-node-equality.ts';
import { cloneWithNewIds, isParagraphMarkRevision } from './tree-op-nodes.ts';
import { build, revisionAttributes } from './tree-op-tracked.ts';
import type { RevisionAttributionInput } from './tree-op-validate.ts';

/**
 * Which container is being recorded.
 *
 * `runProperties` covers a run's own `w:rPr` and the paragraph MARK's alike: both write a
 * `w:rPrChange`, and the only difference — `CT_ParaRPrOriginal` also admits the mark's own
 * `w:ins`/`w:del` — is a widening, so one code path covers both.
 */
export type PropertyChangeContainer = 'runProperties' | 'paragraphProperties';

/** `w:rPr` records through `w:rPrChange`; `w:pPr` through `w:pPrChange`. */
function changeNameOf(container: PropertyChangeContainer): 'rPrChange' | 'pPrChange' {
  return container === 'runProperties' ? 'rPrChange' : 'pPrChange';
}

/** The element the wrapper holds its copy in. */
function recordNameOf(container: PropertyChangeContainer): 'rPr' | 'pPr' {
  return container === 'runProperties' ? 'rPr' : 'pPr';
}

function isWmlNamed(node: OoxmlNode, localName: string): boolean {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    node.localName === localName
  );
}

/**
 * What a container's children reduce to for the RECORD.
 *
 * Three families come out, and each for its own reason.
 *
 * The change wrapper never records itself.
 *
 * `CT_PPrChange` records a `CT_PPrBase`, which by construction cannot hold `w:rPr` or
 * `w:sectPr` — `CT_PPr` is `CT_PPrBase`, then `w:rPr`, then `w:sectPr`, then the change
 * wrapper. So the paragraph mark and the section break are not part of what a paragraph
 * property change records, and putting them in produces a `w:pPr` Word calls unreadable.
 *
 * The MARK REVISIONS come out even though `CT_ParaRPrOriginal` admits them, because a reject
 * restores the container from the record and they are somebody's PENDING DECISION about the
 * paragraph break — a decision that may have been taken after this format change was
 * proposed. Recording them made rejecting a formatting suggestion silently delete an
 * unrelated `w:pPr/w:rPr/w:ins`, taking a break the reviewer had not answered. They are
 * preserved on the container instead, exactly as `w:rPr` and `w:sectPr` are for `w:pPrChange`.
 */
function recordable(
  children: readonly OoxmlNode[],
  container: PropertyChangeContainer
): readonly OoxmlNode[] {
  const changeName = changeNameOf(container);
  return children.filter((child) => {
    if (child.kind === 'textValue') return true;
    if (isWmlNamed(child, changeName)) return false;
    if (container === 'paragraphProperties') {
      return !isWmlNamed(child, 'rPr') && !isWmlNamed(child, 'sectPr');
    }
    return !isParagraphMarkRevision(child);
  });
}

/**
 * Whether two property sets say the same thing, ignoring the order the schema imposes.
 *
 * `mergedPropertyChildren` re-sorts what it rewrites into `xsd:sequence` order, so a
 * container the file authored out of order comes back reordered even when no value moved.
 * Comparing positionally would call that a change and raise a card for a press that did
 * nothing. A reorder alone is not a formatting change.
 */
function sameProperties(left: readonly OoxmlNode[], right: readonly OoxmlNode[]): boolean {
  const byName = (nodes: readonly OoxmlNode[]): readonly OoxmlNode[] =>
    [...nodes].sort((a, b) => {
      const first = a.kind === 'textValue' ? '' : a.localName;
      const second = b.kind === 'textValue' ? '' : b.localName;
      return first < second ? -1 : first > second ? 1 : 0;
    });
  return equivalentNodes(byName(left), byName(right));
}

/** The copy an existing change wrapper already holds, or null when it holds none. */
function recordedIn(
  wrapper: OoxmlNode,
  container: PropertyChangeContainer
): readonly OoxmlNode[] | null {
  if (wrapper.kind === 'textValue') return null;
  const inner = recordNameOf(container);
  for (const child of wrapper.children) {
    if (child.kind === 'textValue' || !isWmlNamed(child, inner)) continue;
    const children: readonly OoxmlNode[] = child.children;
    return children;
  }
  return null;
}

/**
 * A container's rewritten children with the tracked format record folded in.
 *
 * `prior` is what the container held before the write and `next` is the merge's result — the
 * caller's own `mergedPropertyChildren` output, change wrapper and all, because the merge
 * keeps every child its vocabulary cannot name.
 *
 * Returns `next` unchanged in shape when the write lands back on the recorded original: no
 * wrapper is added, and an existing one is DROPPED, because there is nothing left to revert.
 */
export function withPropertyChangeRecord(options: {
  readonly container: PropertyChangeContainer;
  readonly prior: readonly OoxmlNode[];
  readonly next: readonly OoxmlNode[];
  readonly revision: RevisionAttributionInput;
  readonly mint: () => string;
  readonly nextRevisionId: () => string;
}): readonly OoxmlNode[] {
  const { container, prior, next, revision, mint, nextRevisionId } = options;
  const changeName = changeNameOf(container);
  const existing = prior.find((child) => isWmlNamed(child, changeName));
  // The ORIGINAL: whatever a pending record already holds, else the state this write is
  // replacing. Never the intermediate state — see the module header.
  const recorded =
    (existing ? recordedIn(existing, container) : null) ?? recordable(prior, container);
  const body = next.filter((child) => !isWmlNamed(child, changeName));
  if (sameProperties(recordable(body, container), recorded)) return body;

  const copy = recorded.map((child) => cloneWithNewIds(child, mint));
  // The record's inner container carries the TYPED kind, because that is what re-reading the
  // emitted XML produces (`w:rPr` is `runProperties` wherever it sits) and a save/reopen
  // digest compares the two trees.
  const record = build(mint(), container, recordNameOf(container), [], copy);
  const wrapper = build(
    mint(),
    'generic',
    changeName,
    // A fresh id even when a record was already standing: the previous author's proposal is
    // being replaced by this one, and reusing the id would join two authors' cards.
    revisionAttributes(nextRevisionId(), revision),
    [record]
  );
  // BOTH change wrappers are the last member of their container's sequence — `CT_RPr` ends
  // with `w:rPrChange`, `CT_PPr` with `w:pPrChange` — so the tail is the only legal slot.
  return [...body, wrapper];
}

/**
 * Whether this node sits inside a tracked INSERTION this author owns.
 *
 * A run inside the author's own `w:ins` needs no format record: the whole run is already a
 * proposal of theirs, so rejecting the insertion takes the words and the formatting together
 * and there is nothing a separate card could offer. A run inside SOMEBODY ELSE's `w:ins` is
 * the opposite case and is exactly why this lane exists — before it, a suggester's Bold press
 * silently rewrote another author's pending insertion with nothing to accept or reject.
 *
 * A `w:moveTo` is NOT the same case even for the same author: the words were not added, they
 * were moved, and rejecting the move restores the `w:moveFrom` half as it was. A format
 * applied to the moved-in text is a separate decision and gets its own record.
 *
 * The NEAREST enclosing insertion wins: a foreign `w:ins` inside this author's own is text
 * they did not write, and the record belongs on it.
 */
export function insideOwnInsertion(part: OoxmlPart, nodeId: string, author: string): boolean {
  let ancestor = parentNodeOf(part, nodeId);
  while (ancestor !== null) {
    if (ancestor.kind === 'revisionInsert') {
      const owner = ancestor.attributes.find(
        (attribute) =>
          attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'author'
      );
      return (owner?.value ?? '') === author;
    }
    ancestor = parentNodeOf(part, ancestor.id);
  }
  return false;
}
