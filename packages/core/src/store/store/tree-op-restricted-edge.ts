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
export function holdsContentControl(paragraph: OoxmlParagraphNode): boolean {
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

/**
 * Every control in the paragraph that typing cannot enter and whose content starts or ends at
 * `offset`, wrapped in a revision or a hyperlink or not.
 */
export function restrictedControlsWithEdgeAt(
  paragraph: OoxmlParagraphNode,
  offset: number,
  offsets: ParagraphOffsetIndex
): OoxmlElement[] {
  return restrictedControlsIn(paragraph).filter((node) => {
    const span = offsets.spanOf(node);
    return span !== null && (span.start === offset || span.end === offset);
  });
}

/** Every control in the paragraph that typing cannot enter, outermost first. */
function restrictedControlsIn(paragraph: OoxmlParagraphNode): OoxmlElement[] {
  if (!holdsContentControl(paragraph)) return [];
  const found: OoxmlElement[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (isContentControlNode(node) && refusesTypedContent(node)) found.push(node);
    node.children.forEach(walk);
  };
  paragraph.children.forEach(walk);
  return found;
}

/** A run and the paragraph offsets its content covers. */
export interface RunOffsetSpan {
  readonly runId: string;
  readonly start: number;
  readonly end: number;
}

/**
 * The run whose formatting typed text takes at the OUTER edge of a control that typing cannot
 * enter.
 *
 * Text typed there lands beside the control ({@link besideRestrictedControl}), so it must not
 * look like the control. The ordinary rule takes the run to the left, which at a control's
 * trailing edge is the control's own run: a citation styled bold and colored at the end of a
 * paragraph passed that style to every word typed after it, and at the start of a paragraph
 * typed text lost the formatting of the words beside it. The source is the run that starts
 * right after the offset, else the nearest run before it, else the nearest run after it, each
 * outside every such control.
 *
 * `undefined` when the ordinary rule applies: no such control has an edge at `offset`, or the
 * run to the left is outside it. `null` when only the control holds text, so the paragraph
 * mark's formatting applies. Shared by the store's insertion and the caret formatting the
 * toolbar reports, so the two agree.
 */
export function formattingRunBesideRestrictedControl(
  paragraph: OoxmlParagraphNode,
  offset: number,
  offsets: ParagraphOffsetIndex,
  runs: readonly RunOffsetSpan[]
): string | null | undefined {
  const restricted = restrictedControlsIn(paragraph);
  const edges = restricted.filter((node) => {
    const span = offsets.spanOf(node);
    return span !== null && (span.start === offset || span.end === offset);
  });
  if (edges.length === 0) return undefined;
  const inAny = (run: RunOffsetSpan, controls: readonly OoxmlElement[]) =>
    controls.some((control) => findWithin(control, run.runId) !== null);
  // Outside EVERY such control, not only the one at the caret: the run before a control can
  // belong to another control right beside it.
  const outside = (run: RunOffsetSpan) => run.start < run.end && !inAny(run, restricted);
  let left: RunOffsetSpan | undefined;
  for (const run of runs) if (run.start < run.end && run.end === offset) left = run;
  const right = runs.find((run) => run.start < run.end && run.start === offset);
  if (left ? !inAny(left, edges) : !right || !inAny(right, edges)) return undefined;
  let before: RunOffsetSpan | undefined;
  for (const run of runs) if (run.end <= offset && outside(run)) before = run;
  const source =
    (right && outside(right) ? right : undefined) ??
    before ??
    runs.find((run) => run.start >= offset && outside(run));
  return source ? source.runId : null;
}
