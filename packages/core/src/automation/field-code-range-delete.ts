// An untracked range delete that removes whole complex fields whose field codes hold paragraph
// marks.
//
// A complex field runs from a `w:fldChar` (CT_FldChar, ECMA-376 Part 1, 17.16.18) of
// `ST_FldCharType` `begin` (17.18.29) to its `end`. When its field codes (`w:instrText`,
// 17.16.23) hold paragraph marks, a text delete across them would keep the field characters,
// join the field codes, and drop the paragraphs inside them: the field would change without a
// visible sign (see `field-code-split-refusal.ts`). A range that holds the whole field, from its
// `begin` through its `end`, removes the field instead: its field characters, its field codes
// with the paragraphs inside them, and its result. What is left of the two outer paragraphs
// joins, as for any range delete.
//
// The ops are existing ones. Middle paragraphs whose field characters all belong to fields
// inside them go with `deleteBlock`, and the fields with them. The paragraphs that hold the
// characters of a field that crosses a paragraph mark join the first paragraph, so each such
// field becomes one field in one paragraph, which is one model character. One `deleteText` then
// removes the range, with those fields whole. The plan is applied to a copy of the tree first.
// When the result keeps any field character from inside the range, or any text outside the
// plain range delete, the range holds part of a field, and the caller refuses. A joined middle
// paragraph that ends a section is refused too: a range delete never removes a section mark.

// The wrapper the store applies ops through, so the trial makes the same field-result choices.
import { applyTreeOp, type TreeDocOp } from '../store/store/tree-ops.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import type { OoxmlNode, OoxmlPart, OoxmlParagraphNode } from '../store/package/ooxml-tree.ts';
import { paragraphTextOf } from '../store/store/paragraph-model-text.ts';
import { isParagraph, paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';

/** One `w:fldChar` in a paragraph's offset stream, and the offsets it occupies. */
interface FieldCharacter {
  readonly id: string;
  readonly start: number;
  readonly end: number;
  /** Whether it belongs to a field closed in this paragraph, one model character. */
  readonly closed: boolean;
}

/** The `w:fldChar` nodes of a paragraph, with the span of their field when it is closed here. */
function fieldCharactersOf(paragraph: OoxmlParagraphNode): FieldCharacter[] {
  const index = paragraphOffsetIndex(paragraph);
  const closed = new Map<string, { start: number; end: number }>();
  for (const segment of index.segments)
    for (const id of segment.removeNodeIds ?? []) closed.set(id, segment);
  const found: FieldCharacter[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'fldChar') {
      // A field character in a text box belongs to that story and has no offset here.
      const field = closed.get(node.id);
      const span = field ?? index.spanOf(node);
      if (span) found.push({ id: node.id, start: span.start, end: span.end, closed: !!field });
      return;
    }
    if (node.kind === 'textValue') return;
    for (const child of node.children) visit(child);
  };
  visit(paragraph);
  return found;
}

/** Whether a paragraph's mark ends a section (`w:pPr/w:sectPr`). */
function endsSection(paragraph: OoxmlParagraphNode): boolean {
  return paragraph.children.some(
    (child) =>
      child.localName === 'pPr' &&
      child.children.some((inner) => inner.kind !== 'textValue' && inner.localName === 'sectPr')
  );
}

/**
 * The ops that delete from `start` in `ids[0]` to `end` in the last of `ids`, the sibling
 * paragraphs the range spans in order, removing each complex field the range holds whole. Null
 * when the range holds part of a field, or when the ops do not apply.
 */
export function wholeFieldRangeDeleteOps(
  part: OoxmlPart,
  ids: readonly string[],
  start: number,
  end: number
): TreeDocOp[] | null {
  const paragraphs = ids.map((id) => findNode(part, id));
  if (paragraphs.length < 2 || !paragraphs.every(isParagraph)) return null;
  const first = paragraphs[0]!;
  const last = paragraphs.at(-1)!;
  const firstText = paragraphTextOf(part, first.id);
  const lastText = paragraphTextOf(part, last.id);
  if (firstText === null || lastText === null) return null;

  // Every field character inside the range: in the first paragraph from `start`, in the last up
  // to `end`, and all of them in between. A field closed in its paragraph is inside when its
  // whole character is; a field that touches an edge from outside is not. A lone character of
  // a field that crosses a paragraph mark is inside also at an edge.
  const inside = new Set<string>();
  const ops: TreeDocOp[] = [];
  const joined: string[] = [];
  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index]!;
    const characters = fieldCharactersOf(paragraph);
    for (const character of characters) {
      const within =
        index === 0
          ? character.start >= start
          : index === paragraphs.length - 1
            ? character.end <= end
            : true;
      if (within) inside.add(character.id);
    }
    if (index === 0) continue;
    const middle = index < paragraphs.length - 1;
    if (middle && characters.every((character) => character.closed))
      ops.push({ op: 'deleteBlock', blockId: paragraph.id });
    else if (middle && endsSection(paragraph)) return null;
    else joined.push(paragraph.id);
  }
  for (const secondId of joined) ops.push({ op: 'joinParagraphs', firstId: first.id, secondId });

  // Deferred validation, as the store's transaction applies them: the store validates the part
  // once when it commits the real ops.
  const trialOptions = { deferValidation: true };
  let trial = part;
  for (const op of ops) {
    const applied = applyTreeOp(trial, op, trialOptions);
    if (!applied.ok) return null;
    trial = applied.part;
  }
  const joinedLength = paragraphTextOf(trial, first.id)?.length ?? -1;
  const deleteEnd = joinedLength - (lastText.length - end);
  if (deleteEnd < start) return null;
  if (deleteEnd > start) {
    const remove: TreeDocOp = { op: 'deleteText', paragraphId: first.id, start, end: deleteEnd };
    const applied = applyTreeOp(trial, remove, trialOptions);
    if (!applied.ok) return null;
    trial = applied.part;
    ops.push(remove);
  }

  // The result must be the plain range delete with every field character inside it gone.
  const result = findNode(trial, first.id);
  if (!isParagraph(result)) return null;
  if (paragraphTextOf(trial, first.id) !== firstText.slice(0, start) + lastText.slice(end))
    return null;
  if (fieldCharactersOf(result).some((character) => inside.has(character.id))) return null;
  return ops;
}
