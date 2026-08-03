// Cheap package-level gates for `TreePackageStore`.

import { findNode } from '../package/ooxml-edit.ts';
import type { OoxmlPackage } from '../package/ooxml-package.ts';
import { resolveNotesPart } from '../package/note-references.ts';
import type { OoxmlPart } from '../package/ooxml-tree.ts';
import { segmentsOf } from './tree-op-segments.ts';
import type { TreeDocOp } from './tree-ops.ts';

/** Whether the package declares a footnotes or endnotes part at all. */
export function hasNotesPart(pkg: OoxmlPackage): boolean {
  return resolveNotesPart(pkg, 'footnote') !== null || resolveNotesPart(pkg, 'endnote') !== null;
}

/**
 * Whether one text delete can strand a note body and therefore needs a package cascade.
 * Ambiguous repeated deletes in one paragraph fail closed into the bounded cascade.
 */
export function deleteMayStrandNote(
  pkg: OoxmlPackage,
  part: OoxmlPart,
  op: Extract<TreeDocOp, { op: 'deleteText' }>,
  seenParagraphs: Set<string>
): boolean {
  if (!hasNotesPart(pkg)) return false;
  if (seenParagraphs.has(op.paragraphId)) return true;
  seenParagraphs.add(op.paragraphId);
  const paragraph = findNode(part, op.paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return true;
  return segmentsOf(paragraph).some(
    (segment) =>
      segment.node.kind === 'noteReference' && segment.start < op.end && segment.end > op.start
  );
}
