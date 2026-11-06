// The writes a bullet or numbering toggle makes over the paragraphs it touches.
//
// Turning a list off drops each paragraph's numbering. Turning one on picks the list
// (`switchedListNumIds`), then writes either the List Paragraph style and `w:numPr`, or, for a
// level linked to a paragraph style, that style alone (`linkedStyleOps`).

import type { StyleCascadeTable } from '@docx-editor.dev/core/layout';
import type { TreeDocOp } from '@docx-editor.dev/core/store';
import { styleNumberingOf } from './list-level-geometry.ts';
import {
  linkedStyleOps,
  switchedListNumIds,
  type ListKind,
  type ListSwitchDeps,
} from './surface-list-switch.ts';
import type { ListStyleWrites } from './surface-list-style.ts';

export interface ListToggleDeps {
  readonly listSwitch: ListSwitchDeps;
  readonly listStyle: ListStyleWrites;
  /** The write that takes a paragraph out of its list. */
  leaveOp(paragraphId: string): TreeDocOp;
  /** The paragraph's own list level, or null when it is no list item. */
  levelOf(paragraphId: string): number | null;
  kindOf(paragraphId: string): ListKind | null;
  styleCascade(): StyleCascadeTable | undefined;
}

/** The ops that toggle `kind` over `touched`, or null when no list can be found or made. */
export function listToggleOps(
  deps: ListToggleDeps,
  touched: readonly string[],
  kind: ListKind
): TreeDocOp[] | null {
  // The toggle turns OFF only when the whole selection is already that list; a mixed
  // selection becomes one list rather than clearing half of it. Turning a list off leaves
  // the style alone: an outdented item stays in List Paragraph until the user picks another.
  if (touched.every((paragraphId) => deps.kindOf(paragraphId) === kind)) {
    return touched.map((paragraphId) => deps.leaveOp(paragraphId));
  }
  const numIds = switchedListNumIds(deps.listSwitch, touched, kind);
  if (numIds === null) return null;
  const linked = linkedStyleOps(numIds, {
    listLevelStyleOf: deps.listSwitch.listLevelStyleOf,
    listAbstractOf: deps.listSwitch.listAbstractOf,
    levelOf: deps.levelOf,
    styleNumberingOf: (styleId) => styleNumberingOf(deps.styleCascade(), styleId),
    linkedStyleOp: deps.listStyle.linkedStyleOp,
  });
  const ops: TreeDocOp[] = [
    ...deps.listStyle.applyOps(touched.filter((paragraphId) => !linked.has(paragraphId))),
    ...linked.values(),
  ];
  for (const paragraphId of touched) {
    if (linked.has(paragraphId)) continue;
    // `w:numPr` carries the level AND the definition, and the op mints a fresh one, so a call
    // that names no level silently resets `w:ilvl` to 0. A bullet converts to a number IN
    // PLACE: pressing Numbered on a level-2 item leaves it at level 2.
    const level = deps.levelOf(paragraphId);
    ops.push({
      op: 'setListNumbering',
      paragraphId,
      numId: numIds.get(paragraphId) ?? null,
      ...(level !== null ? { level } : {}),
    });
  }
  return ops;
}
