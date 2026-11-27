// Which paragraph marks and split points in the tree belong to a complex field's field codes.
//
// A complex field runs from a `w:fldChar` (CT_FldChar, ECMA-376 Part 1, 17.16.18) of
// `ST_FldCharType` `begin` (17.18.29) to its `end`, and its field codes (`w:instrText`,
// 17.16.23) run up to `separate`. When the field codes hold paragraph marks, those marks belong
// to the field instruction: the marks of the paragraphs inside, and the mark of the paragraph
// that holds `begin` (see `field-instruction-paragraphs.ts`). The editor and the automation
// planners ask these questions of the tree, so a write never adds or removes such a mark
// without saying so.
//
// These answers read the stored tree, with every tracked insertion and deletion in it, because
// writes act on the stored tree. Layout reads the revision view the page shows, so a field
// character inside a tracked insertion or deletion can count here and not on the page, or the
// other way round. A refusal can then cover a mark the page shows as a break, or miss one the
// page hides.

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
  /** Paragraphs wholly inside the field codes. */
  readonly inside: ReadonlySet<string>;
  /** Paragraphs where field codes that hold paragraph marks end. */
  readonly closing: ReadonlySet<string>;
  /** For each paragraph whose start is inside field codes, the paragraph that holds `begin`. */
  readonly beginOf: ReadonlyMap<string, string>;
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
  // Inner fields close first, so an outer field's begin is set last and wins.
  const beginOf = new Map<string, string>();
  for (const join of joins) {
    for (let index = join.first + 1; index <= join.last; index += 1) {
      if (index === join.last || inside.has(index)) beginOf.set(idOf(index), idOf(join.first));
    }
  }
  const ids: FieldCodeIds = {
    inside: insideIds,
    marks: new Set([...insideIds, ...joins.map((join) => idOf(join.first))]),
    closing: new Set(joins.map((join) => idOf(join.last))),
    beginOf,
  };
  idsByContainer.set(container, ids);
  return ids;
}

/** Whether the mark of paragraph `id` is field code. Each container is scanned once. */
export function markIsFieldCode(part: OoxmlPart, id: string): boolean {
  return fieldCodeIdsOf(part, id)?.marks.has(id) ?? false;
}

/**
 * Whether a paragraph split at `offset` of paragraph `id` adds a paragraph mark inside field
 * codes: anywhere in a paragraph wholly inside them, or at offset 0 of the paragraph where they
 * end, which sits before the field codes that continue into it.
 */
export function splitInsideFieldCodes(part: OoxmlPart, id: string, offset: number): boolean {
  const ids = fieldCodeIdsOf(part, id);
  if (!ids) return false;
  return ids.inside.has(id) || (offset === 0 && ids.closing.has(id));
}

/**
 * Whether a block inserted before paragraph `id` lands inside field codes: before a paragraph
 * wholly inside them, or before the paragraph where they end.
 */
export function blockBeforeInsideFieldCodes(part: OoxmlPart, id: string): boolean {
  const ids = fieldCodeIdsOf(part, id);
  return ids !== null && (ids.inside.has(id) || ids.closing.has(id));
}

/**
 * The paragraph a block goes before when it is placed at paragraph `id`: the paragraph that
 * holds the field's `begin` when the start of `id` is inside field codes, so the block lands
 * outside them. `id` anywhere else.
 */
export function blockAnchorOutsideFieldCodes(part: OoxmlPart, id: string): string {
  return fieldCodeIdsOf(part, id)?.beginOf.get(id) ?? id;
}
