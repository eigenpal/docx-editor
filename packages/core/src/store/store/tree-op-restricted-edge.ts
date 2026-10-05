// Where an unowned insertion lands at the edge of a control that typing cannot enter.
//
// Kept apart from `tree-op-segments.ts`, which resolves every other insertion site, and
// imports only its types: the segments module passes in the offset index it already built.

import type { OoxmlElement, OoxmlNode, OoxmlParagraphNode } from '../package/ooxml-tree.ts';
import { isFieldChrome } from '../package/field-nodes.ts';
import { inlineContainersOf, isContentControlNode, refusesTypedContent } from './tree-op-nodes.ts';
import type { InsertionSite, ParagraphOffsetIndex } from './tree-op-segments.ts';

/**
 * An unowned insertion at the OUTER EDGE of an inline content control that typing can never
 * enter ({@link refusesTypedContent}) lands beside the control.
 *
 * The default rule gives a leading edge to the run that starts there, which is inside the
 * control. For a locked or bound control that place refuses every keystroke, so a locked
 * control at the start of a paragraph, or right after another one, left no position before it
 * to type at; a checkbox took the keystroke into its glyph. The trailing edge already lands
 * outside. A text control keeps the default, because typing at its start fills it in.
 *
 * Only the outermost such control whose edge is `offset` is left. A restriction on a
 * control that encloses the whole paragraph still refuses the edit, as it should.
 */
export function besideRestrictedControl(
  paragraph: OoxmlParagraphNode,
  offset: number,
  landingId: string,
  offsets: ParagraphOffsetIndex
): InsertionSite | null {
  // Most paragraphs hold no control, and this runs on every unowned keystroke.
  if (!holdsContentControl(paragraph)) return null;
  const landing = landingId === paragraph.id ? null : findWithin(paragraph, landingId);
  const enclosing = [
    ...(landing && landing.kind !== 'textValue' ? [landing] : []),
    ...inlineContainersOf(paragraph, landingId),
  ];
  const control = enclosing
    .filter((node) => {
      if (!isContentControlNode(node) || !refusesTypedContent(node)) return false;
      const span = offsets.spanOf(node);
      return span !== null && (span.start === offset || span.end === offset);
    })
    .at(-1);
  if (!control) return null;
  const span = offsets.spanOf(control)!;
  const holder = parentWithin(paragraph, control.id) ?? paragraph;
  const index = holder.children.findIndex((child) => child.id === control.id);
  if (index < 0) return null;
  if (span.end === offset && span.start !== offset) {
    return { kind: 'newRun', holder, index: index + 1 };
  }
  // Join the run that ends right before the control when it ends in plain text, so each
  // keystroke there does not mint a run of its own. `atRunIndex`, because the applier writes
  // that kind exactly where it says; its boundary rule would hand the offset back to the
  // control. A run ending in an atom (a note reference, a drawing) or holding field chrome gets
  // a minted run instead: joining it would style the text as the atom, and removing the atom
  // would take the text with it.
  const previous = holder.children[index - 1];
  if (previous?.kind === 'run' && !previous.children.some(isFieldChrome)) {
    const last = lastSegmentEndingAt(offsets, previous.id, offset);
    if (last && last.node.kind === 'textValue' && last.removeNodeIds === undefined) {
      return { kind: 'atRunIndex', run: previous, index: previous.children.length };
    }
  }
  return { kind: 'newRun', holder, index };
}

function lastSegmentEndingAt(offsets: ParagraphOffsetIndex, runId: string, offset: number) {
  for (let index = offsets.segments.length - 1; index >= 0; index -= 1) {
    const segment = offsets.segments[index]!;
    if (segment.runId === runId && segment.end === offset) return segment;
  }
  return undefined;
}

const holdsControl = new WeakMap<OoxmlParagraphNode, boolean>();

/** Whether any content control sits inside the paragraph. Paragraph nodes are immutable. */
function holdsContentControl(paragraph: OoxmlParagraphNode): boolean {
  let held = holdsControl.get(paragraph);
  if (held === undefined) {
    const walk = (node: OoxmlNode): boolean =>
      node.kind !== 'textValue' && (isContentControlNode(node) || node.children.some(walk));
    held = paragraph.children.some(walk);
    holdsControl.set(paragraph, held);
  }
  return held;
}

function findWithin(node: OoxmlNode, id: string): OoxmlNode | null {
  if (node.id === id) return node;
  if (node.kind === 'textValue') return null;
  for (const child of node.children) {
    const found = findWithin(child, id);
    if (found) return found;
  }
  return null;
}

function parentWithin(parent: OoxmlElement, id: string): OoxmlElement | null {
  for (const child of parent.children) {
    if (child.id === id) return parent;
    if (child.kind === 'textValue') continue;
    const found = parentWithin(child, id);
    if (found) return found;
  }
  return null;
}
