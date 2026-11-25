// Which paragraph marks in the tree belong to a complex field's field codes.
//
// A complex field runs from a `w:fldChar` (CT_FldChar, ECMA-376 Part 1, 17.16.18) of
// `ST_FldCharType` `begin` (17.18.29) to its `end`, and its field codes (`w:instrText`,
// 17.16.23) run up to `separate`. When the field codes hold paragraph marks, those marks belong
// to the field instruction: the marks of the paragraphs inside, and the mark of the paragraph
// that holds `begin` (see `field-instruction-paragraphs.ts`). The editor asks this question of
// the tree, so a write never removes such a mark without saying so.

import type { OoxmlNode, OoxmlPart } from '@docx-editor.dev/core/store';
import { parentNodeOf } from '@docx-editor.dev/core/store';
import {
  collectFlowBlocks,
  isContentControl,
  isContentControlContent,
} from '../store/package/content-control-walk.ts';
import { scanFieldInstructionParagraphs } from './field-instruction-paragraphs.ts';

/** The field-code paragraphs of one container, by id. */
interface FieldCodeIds {
  /** Paragraphs whose mark is field code: inside the field codes, or holding `begin`. */
  readonly marks: ReadonlySet<string>;
}

/** The container whose blocks a paragraph flows in: its parent, outside any content control. */
function flowContainerOf(part: OoxmlPart, id: string): OoxmlNode | null {
  let parent: OoxmlNode | null = parentNodeOf(part, id);
  while (parent && (isContentControlContent(parent) || isContentControl(parent))) {
    parent = parentNodeOf(part, parent.id);
  }
  return parent;
}

/** Per container node. Nodes are immutable, so an answer holds while the node does. */
const idsByContainer = new WeakMap<OoxmlNode, FieldCodeIds>();

function fieldCodeIdsOf(part: OoxmlPart, id: string): FieldCodeIds | null {
  const container = flowContainerOf(part, id);
  if (!container || container.kind === 'textValue') return null;
  const cached = idsByContainer.get(container);
  if (cached) return cached;
  const blocks = collectFlowBlocks(container.children);
  const { inside, joins } = scanFieldInstructionParagraphs(blocks);
  const idOf = (index: number) => blocks[index]!.id;
  const insideIds = new Set([...inside].map(idOf));
  const ids: FieldCodeIds = {
    marks: new Set([...insideIds, ...joins.map((join) => idOf(join.first))]),
  };
  idsByContainer.set(container, ids);
  return ids;
}

/** Whether the mark of paragraph `id` is field code. Each container is scanned once. */
export function markIsFieldCode(part: OoxmlPart, id: string): boolean {
  return fieldCodeIdsOf(part, id)?.marks.has(id) ?? false;
}
