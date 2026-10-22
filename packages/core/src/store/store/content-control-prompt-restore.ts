// A control a content edit emptied shows its prompt again.
//
// Word's rule: delete the last character of a text, date or list control and the
// placeholder comes back under `w:showingPlcHdr`, ready for the next keystroke to replace
// it whole. The store lane cannot read the glossary, so the type's own prompt stands in
// for the block's text; the `w:placeholder` reference itself survives for Word and for the
// next open, where `materializeGlossaryPlaceholders` resolves it. Split from
// `tree-op-content-controls.ts` to keep that file under its line cap.

import type { ContentControlKind } from '../package/content-control-nodes.ts';
import {
  contentControlPropertiesContainerOf,
  contentControlPropertiesOf,
} from '../package/content-control-nodes.ts';
import {
  createNodeIdAllocator,
  findNode,
  parentNodeOf,
  replaceNode,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import { MAX_INLINE_CONTAINER_DEPTH } from '../package/ooxml-shared.ts';
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { isInlineControl } from './content-control-checkbox.ts';
import { contentWithText, editedProperties, promptFor } from './tree-op-content-controls.ts';
import {
  contentControlContentOf,
  findContentControl,
  isRunPropertiesNode,
} from './tree-op-nodes.ts';
import { paragraphLength } from './tree-op-segments.ts';
import type { TreeOpEffect, TreeOpResult } from './tree-op-types.ts';

/** The kinds whose empty content shows a prompt. A checkbox or a picture has none. */
const PROMPT_KINDS: ReadonlySet<ContentControlKind> = new Set<ContentControlKind>([
  'plainText',
  'richText',
  'date',
  'dropDownList',
  'comboBox',
  'docPartList',
]);

function holdsContent(node: OoxmlNode, depth: number): boolean {
  if (node.kind === 'textValue' || depth > MAX_INLINE_CONTAINER_DEPTH) return false;
  if (node.kind === 'run') return node.children.some((child) => !isRunPropertiesNode(child));
  if (node.localName === 'sdtPr' || node.localName === 'pPr') return false;
  return node.children.some((child) => holdsContent(child, depth + 1));
}

/**
 * Restore the prompt of a control the edit in `result` has just emptied. The wrapper stays,
 * the type's prompt goes back under `w:showingPlcHdr`, and the next keystroke replaces it
 * whole. Deleting the last character used to leave a zero-width control the caret could not
 * enter, which read as the control having vanished. A control that still holds content,
 * already shows its prompt, or has no prompt to show leaves `result` unchanged.
 */
export function restoreEmptiedPlaceholder(
  result: TreeOpResult,
  controlId: string,
  options?: EditOptions,
  /** The text that stands in for the content; the type's own prompt when absent. */
  prompt?: string
): TreeOpResult {
  if (!result.ok) return result;
  const control = findContentControl(result.part, controlId);
  if (!control) return result;
  const summary = contentControlPropertiesOf(control);
  // A decision's placeholder also stands in an untyped control, which reads as rich text, and
  // replaces a prompt the decision emptied.
  const decision = prompt !== undefined;
  if (summary.showingPlaceholder && !decision) return result;
  if (!PROMPT_KINDS.has(summary.type) && !(decision && summary.type === 'untyped')) return result;
  const content = contentControlContentOf(control);
  if (!content || holdsContent(content, 0)) return result;
  const nextId = createNodeIdAllocator(result.part);
  const inline = isInlineControl(result.part, control.id);
  const children = contentWithText(content, prompt ?? promptFor(summary.type), nextId, inline);
  if (!children) return result;
  const sdtPr = contentControlPropertiesContainerOf(control);
  const properties = editedProperties(sdtPr, { showingPlaceholder: true }, nextId);
  const rebuilt = {
    ...control,
    children: [
      properties,
      ...control.children.filter((child) => child.id !== sdtPr?.id && child.id !== content.id),
      { ...content, children } as OoxmlNode,
    ],
  } as OoxmlNode;
  const written = replaceNode(result.part, control.id, rebuilt, options);
  return written.ok ? { ...result, part: written.part } : result;
}

/**
 * Restore the placeholder of each inline control a revision decision emptied. A decision writes
 * five spaces under `w:showingPlcHdr`, the placeholder a control without its own prompt text
 * shows, so the control keeps a place for the caret and for the next value.
 */
export function restoreDecisionEmptiedControls(
  before: OoxmlPart,
  decidedIds: Iterable<string>,
  after: OoxmlPart,
  options?: EditOptions
): OoxmlPart {
  const controls = new Set<string>();
  const inside = (node: OoxmlNode, depth: number): void => {
    if (node.kind === 'textValue' || depth > MAX_INLINE_CONTAINER_DEPTH) return;
    if (node.kind === 'contentControl') controls.add(node.id);
    for (const child of node.children) inside(child, depth + 1);
  };
  // The controls around each decided change, and the ones a removed change held.
  for (const id of decidedIds) {
    for (let node = parentNodeOf(before, id); node; node = parentNodeOf(before, node.id))
      if (node.kind === 'contentControl') controls.add(node.id);
    const decided = findNode(before, id);
    if (decided) inside(decided, 0);
  }
  let result: TreeOpResult = { ok: true, part: after, effect: NO_EFFECT };
  for (const id of controls) {
    if (!isInlineControl(before, id)) continue;
    const control = findContentControl(before, id);
    const content = control && contentControlContentOf(control);
    if (!content || !holdsContent(content, 0)) continue;
    result = restoreEmptiedPlaceholder(result, id, options, DECISION_PLACEHOLDER);
  }
  return result.ok ? result.part : after;
}
const DECISION_PLACEHOLDER = '     ';
/** The effect is the caller's; the restore reads only the part. */
const NO_EFFECT = {} as TreeOpEffect;

/**
 * Where the caller's characters go once a prompt has been emptied.
 *
 * Prompt replacement uses the prompt's start position. Clamp the position to the shortened
 * paragraph before inserting the replacement text.
 */
export function promptInsertionOffset(
  part: OoxmlPart,
  paragraphId: string,
  planned: number
): number {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return planned;
  return Math.min(planned, paragraphLength(paragraph));
}
