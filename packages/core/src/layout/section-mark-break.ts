// Whether an empty section mark after a manual page break may stay on the sheet the break closed.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { paragraphSectionNode, type DocumentSection } from './section-properties.ts';

/**
 * Whether a section is nothing but its own empty mark paragraph: no run text, break,
 * drawing, or field. Structural, so the section loop can ask it before any section is laid
 * out; the flow pass still makes the final call with measured lines.
 */
function holdsOnlyItsMark(blocks: readonly OoxmlElement[], section: DocumentSection): boolean {
  if (section.blockEndExclusive - section.blockStart !== 1) return false;
  const block = blocks[section.blockStart];
  if (block?.kind !== 'paragraph' || paragraphSectionNode(block) === undefined) return false;
  return block.children.every(
    (child) =>
      child.kind === 'paragraphProperties' ||
      child.kind === 'bookmarkStart' ||
      child.kind === 'bookmarkEnd' ||
      (child.kind === 'run' && child.children.every((part) => part.kind === 'runProperties'))
  );
}

/**
 * For each section, whether the empty mark that ends it may stay on the sheet a page break
 * just closed, instead of opening a sheet of its own.
 *
 * A page break followed by an empty section mark advances ONE sheet when the next section
 * opens a new sheet anyway. Mark-only sections that continue on the same sheet in between
 * change nothing, so the answer passes through them. A section with content that continues
 * the sheet stops it: that content starts after the break, and the mark goes with it. The
 * last section has nothing after it, so a trailing break there keeps its empty sheet.
 *
 * One backward sweep, so a run of mark-only sections costs one step each rather than one
 * walk each: the section count comes from the file.
 *
 * `sharesSheet(index)` says whether section `index` continues the sheet of section
 * `index - 1`.
 */
export function sectionMarksJoiningBreakSheet(
  sections: readonly DocumentSection[],
  blocks: readonly OoxmlElement[],
  sharesSheet: (index: number) => boolean
): boolean[] {
  const joins = new Array<boolean>(sections.length).fill(false);
  for (let index = sections.length - 2; index >= 0; index -= 1) {
    const next = index + 1;
    joins[index] =
      !sharesSheet(next) || (holdsOnlyItsMark(blocks, sections[next]!) && joins[next]!);
  }
  return joins;
}
