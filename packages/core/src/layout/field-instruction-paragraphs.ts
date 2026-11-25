// Which paragraphs sit wholly inside a complex field's instruction.
//
// A complex field runs from a `w:fldChar` (CT_FldChar, §17.16.18) of `ST_FldCharType`
// `begin` to its `end` (§17.18.29). Its field codes, the `w:instrText` runs (CT_Text,
// §17.16.23), run up to the `separate` character; without one, the whole field is field codes
// (§17.16.18). An `IF` field's text can hold several paragraphs, so its paragraph marks fall
// inside the field codes. Only the field result displays, so a paragraph that starts and ends
// inside one field's codes shows nothing: no text, no list marker, no line, and no list count.
//
// An unclosed field generates no field (§17.16.18), so it hides nothing. A field whose codes
// hold plain `w:t` text outside a nested field's result is malformed, and it hides nothing too.
// A field nested deeper than `MAX_FIELD_NESTING` inside the fields the scan tracks is left out:
// it hides nothing. Its text still counts as stray text for the fields around it that are in
// their field codes, because the scan cannot tell its instruction from its result. The fields
// around it, and every other field in the story, still apply. The cap keeps the scan linear in
// paragraphs and markers.

import type { OoxmlElement, OoxmlNode } from '@docx-editor.dev/core/store';
import { fldCharType, MAX_FIELD_NESTING, type FldCharType } from '../store/package/field-nodes.ts';

const OWN_STORIES = new Set(['drawing', 'pict', 'object', 'AlternateContent', 'txbxContent']);

type Marker = FldCharType | 'text';

/** The block's field characters and plain text in document order, text boxes left out. */
function markersOf(block: OoxmlNode): Marker[] {
  const markers: Marker[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    const type = fldCharType(node);
    if (type) {
      markers.push(type);
      return;
    }
    if (node.kind === 'text') {
      if (node.children.some((value) => value.kind === 'textValue' && value.value.length > 0))
        markers.push('text');
      return;
    }
    if (OWN_STORIES.has(node.localName)) return;
    for (const child of node.children) visit(child);
  };
  visit(block);
  return markers;
}

/** The paragraph that opens a field, and the paragraph where its field codes end. */
export interface FieldCodeJoin {
  readonly first: number;
  readonly last: number;
}

/** Indexes of the paragraphs in `blocks` that start and end inside the same field's instruction. */
export function paragraphsInsideFieldInstructions(
  blocks: readonly OoxmlElement[]
): ReadonlySet<number> {
  return scanFieldInstructionParagraphs(blocks).inside;
}

/**
 * The paragraphs inside a field instruction (`inside`), and every paragraph that sits between a
 * closed field's `begin` and the end of its field codes, also when stray text keeps them in the
 * flow (`spanned`). A text edit in a spanned paragraph can change which paragraphs leave the
 * flow, so incremental layout must not carry the old block list over it.
 *
 * `joins` pairs the paragraph that holds a field's `begin` with the paragraph where its field
 * codes end, for each field whose field codes hold paragraph marks and no plain text. The mark
 * of the first one is field code too, so edits never add or remove it without saying so (see
 * `field-code-marks.ts`).
 */
export function scanFieldInstructionParagraphs(blocks: readonly OoxmlElement[]): {
  readonly inside: ReadonlySet<number>;
  readonly spanned: ReadonlySet<number>;
  readonly joins: readonly FieldCodeJoin[];
} {
  const joins: FieldCodeJoin[] = [];
  // Each closed field marks its range once in two difference arrays, so the scan stays linear
  // in paragraphs plus markers: +1 where a range starts, -1 past its end.
  const spannedDiff = new Int32Array(blocks.length + 1);
  const insideDiff = new Int32Array(blocks.length + 1);
  const open: { begin: number; instructionEnd: number | null; holdsText: boolean }[] = [];
  // Fields opened past the nesting cap, still open: their characters and text are skipped.
  let ignored = 0;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    if (block.kind !== 'paragraph') continue;
    for (const type of markersOf(block)) {
      if (ignored > 0) {
        if (type === 'begin') ignored += 1;
        else if (type === 'end') ignored -= 1;
        // Text inside a field past the cap may be its instruction, which is stray text for
        // every tracked field still in its own field codes. Counting it keeps those fields
        // from hiding paragraphs, the same answer the scan gives without the cap.
        else if (type === 'text') {
          for (const field of open) if (field.instructionEnd === null) field.holdsText = true;
        }
        continue;
      }
      if (type === 'text') {
        if (open.at(-1)?.instructionEnd !== null) continue;
        for (const field of open) if (field.instructionEnd === null) field.holdsText = true;
      } else if (type === 'begin') {
        if (open.length >= MAX_FIELD_NESTING) ignored = 1;
        else open.push({ begin: index, instructionEnd: null, holdsText: false });
      } else if (type === 'separate') {
        const field = open.at(-1);
        if (field && field.instructionEnd === null) field.instructionEnd = index;
      } else {
        const field = open.pop();
        if (!field) continue;
        const instructionEnd = field.instructionEnd ?? index;
        if (instructionEnd > field.begin && !field.holdsText)
          joins.push({ first: field.begin, last: instructionEnd });
        if (instructionEnd > field.begin + 1) {
          spannedDiff[field.begin + 1]! += 1;
          spannedDiff[instructionEnd]! -= 1;
          if (!field.holdsText) {
            insideDiff[field.begin + 1]! += 1;
            insideDiff[instructionEnd]! -= 1;
          }
        }
      }
    }
  }
  const inside = new Set<number>();
  const spanned = new Set<number>();
  let spannedDepth = 0;
  let insideDepth = 0;
  for (let index = 0; index < blocks.length; index += 1) {
    spannedDepth += spannedDiff[index]!;
    insideDepth += insideDiff[index]!;
    if (blocks[index]!.kind !== 'paragraph') continue;
    if (spannedDepth > 0) spanned.add(index);
    if (insideDepth > 0) inside.add(index);
  }
  return { inside, spanned, joins };
}
