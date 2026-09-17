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
import { createNodeIdAllocator, replaceNode, type EditOptions } from '../package/ooxml-edit.ts';
import { MAX_INLINE_CONTAINER_DEPTH } from '../package/ooxml-shared.ts';
import type { OoxmlNode } from '../package/ooxml-tree.ts';
import { isInlineControl } from './content-control-checkbox.ts';
import { contentWithText, editedProperties, promptFor } from './tree-op-content-controls.ts';
import {
  contentControlContentOf,
  findContentControl,
  isRunPropertiesNode,
} from './tree-op-nodes.ts';
import type { TreeOpResult } from './tree-op-types.ts';

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
  options?: EditOptions
): TreeOpResult {
  if (!result.ok) return result;
  const control = findContentControl(result.part, controlId);
  if (!control) return result;
  const summary = contentControlPropertiesOf(control);
  if (summary.showingPlaceholder || !PROMPT_KINDS.has(summary.type)) return result;
  const content = contentControlContentOf(control);
  if (!content || holdsContent(content, 0)) return result;
  const nextId = createNodeIdAllocator(result.part);
  const inline = isInlineControl(result.part, control.id);
  const children = contentWithText(content, promptFor(summary.type), nextId, inline);
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
