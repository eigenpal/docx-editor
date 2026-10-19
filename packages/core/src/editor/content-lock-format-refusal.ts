// Run formatting over a content lock, answered BEFORE the write, so `can`, the toolbar and
// `exec` all say the same thing. The store refuses the transaction either way; asking here
// first is what keeps a button from looking available and then doing nothing.

import type { EditorCommand, ExecResult } from '../contracts/editor.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import type { ContentLockPolicy } from '../store/package/ooxml-edit.ts';
import {
  contentControlPropertiesOf,
  contentControlsIn,
  lockForbidsEdit,
  resolveContentControlLock,
} from '../store/package/content-control-nodes.ts';
import { effectiveContentLockAt } from '../store/store/tree-op-nodes.ts';
import { enclosingContentControls } from '../store/store/tree-op-content-controls.ts';
import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import { paragraphsInCells } from '../layout/semantic-cell-selection.ts';
import { partOfNodeId } from './surface-scope.ts';

export const LOCKED_FORMAT_REASON = 'this content is locked';

const RUN_FORMAT_COMMANDS: ReadonlySet<EditorCommand['type']> = new Set([
  'toggleMark',
  'setMarkAttr',
  'clearFormatting',
]);

/** One paragraph's selected span: `[start, end)` in its own offsets. */
interface SelectedSpan {
  readonly paragraphId: string;
  readonly start: number;
  readonly end: number;
}

function selectedSpans(surface: PaginatedSurface): SelectedSpan[] | null {
  const state = surface.state();
  const cells = state.cellSelection;
  if (cells) {
    return [...paragraphsInCells(surface.layout(), cells.cellIds)].map((paragraphId) => ({
      paragraphId,
      start: 0,
      end: Number.MAX_SAFE_INTEGER,
    }));
  }
  const { anchor, head } = state.selection;
  if (anchor.paragraphId === head.paragraphId) {
    if (anchor.offset === head.offset) return null;
    return [
      {
        paragraphId: anchor.paragraphId,
        start: Math.min(anchor.offset, head.offset),
        end: Math.max(anchor.offset, head.offset),
      },
    ];
  }
  const order = surface.session.paragraphIds();
  const a = order.indexOf(anchor.paragraphId);
  const b = order.indexOf(head.paragraphId);
  // A story the body order does not list: its endpoints are still asked.
  if (a === -1 || b === -1) {
    return [
      { paragraphId: anchor.paragraphId, start: 0, end: Number.MAX_SAFE_INTEGER },
      { paragraphId: head.paragraphId, start: 0, end: Number.MAX_SAFE_INTEGER },
    ];
  }
  const [from, to] = a < b ? [anchor, head] : [head, anchor];
  const [first, last] = a < b ? [a, b] : [b, a];
  return order.slice(first, last + 1).map((paragraphId, index, all) => ({
    paragraphId,
    start: index === 0 ? from.offset : 0,
    end: index === all.length - 1 ? to.offset : Number.MAX_SAFE_INTEGER,
  }));
}

/**
 * The refusal a run-formatting command meets because the selection reaches content a
 * control locks, or null. Null as well when the host's policy lets formatting through.
 */
export function contentLockFormatRefusal(
  command: EditorCommand,
  surface: PaginatedSurface,
  policy: ContentLockPolicy | undefined
): Exclude<ExecResult, { ok: true }> | null {
  if (!RUN_FORMAT_COMMANDS.has(command.type) || policy?.allowFormattingInLockedContent) {
    return null;
  }
  const spans = selectedSpans(surface);
  if (!spans) return null;
  const refusal = { ok: false as const, code: 'locked' as const, reason: LOCKED_FORMAT_REASON };
  for (const span of spans) {
    // A pure ancestry read of the story that holds the paragraph.
    const source = partOfNodeId(surface.session, span.paragraphId) ?? surface.session.part();
    const paragraph = findNode(source, span.paragraphId);
    if (!paragraph || paragraph.kind !== 'paragraph') continue;
    if (effectiveContentLockAt(source, span.paragraphId).content) return refusal;
    const inside = contentControlsIn(paragraph);
    if (inside.length === 0) continue;
    const offsets = paragraphOffsetIndex(paragraph);
    for (const entry of inside) {
      const at = offsets.spanOf(entry.node);
      if (!at || at.end <= span.start || at.start >= span.end) continue;
      const locks = enclosingContentControls(source, entry.node.id).map(
        (control) => contentControlPropertiesOf(control).lock
      );
      if (lockForbidsEdit(resolveContentControlLock(locks))) return refusal;
    }
  }
  return null;
}
