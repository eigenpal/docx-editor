// Copy, cut and paste for the paginated surface (paginated-surface seam).
//
// Thin glue, on purpose. The flavour payload lives in `clipboard-copy-payload.ts`, the
// fidelity ladder in `clipboard-paste-router.ts`, and control-character normalization in
// `clipboard-plain-text.ts`. What is left here is what needs the mount closure: which range
// a paste replaces, where the replacement lands once a tracked strike has had its say, and
// the ONE commit each gesture becomes.
//
// The force-plain arm lives here too, with the paste that consumes it. It is a deadline, not
// a flag: when no paste follows the chord — a denied clipboard, a focus loss — a stale arm
// must not silently downgrade a LATER ordinary Cmd+V.
//
// Mutable mount state arrives as a getter and is read at the ORIGINAL read point, never
// hoisted: `orderedRange()` and `flushPendingInputAndLayout()` both republish the layout, so
// a `layout()` lifted above one would hand the caller the pre-flush revision.

// The VIEW, not the concrete binding session: `paginated-surface.ts` is the only file in
// this lane allowed to name that one (`store/__tests__/prosemirror-isolation.test.ts`).
import type { TreeApplyResult, TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import type { StoryScope, TreeDocOp } from '@docx-editor.dev/core/store';
import {
  cellSelectionText,
  type CellSelection,
  type SemanticLayout,
  type SemanticPosition,
  type SemanticSelection,
} from '@docx-editor.dev/core/layout';
import { buildCopyFlavours } from './clipboard-copy-payload.ts';
import { routePaste } from './clipboard-paste-router.ts';
import { insertableText } from './clipboard-plain-text.ts';
import {
  collapsedAt,
  fragmentCoverageOf,
  selectedTextIn,
  type RangeDeletionPlan,
} from './surface-selection-ops.ts';
import type { SurfaceEditingMode } from './paginated-surface-contract.ts';

/** A history mark: one paragraph and an offset range within it. */
type HistoryMark = { paragraphId: string; start: number; end: number };

/** What this lane borrows from the mount closure. Mutable state arrives as a getter. */
export interface SurfaceClipboardDeps {
  session: TreeDocxSessionView;
  layout(): SemanticLayout;
  cellSelection(): CellSelection | null;
  editingMode(): SurfaceEditingMode;
  storyScope(): StoryScope;
  paragraphOrder(): readonly string[];
  /** The collaboration actor, or undefined when no session is attached. */
  actorId(): string | undefined;
  /**
   * The collaboration write gate the typing lane asks: the refusal code, or null when the
   * gate admits — always null with no session attached, so the non-collaborative paste
   * path stays exactly as it was.
   */
  collaborationGate(ops: readonly TreeDocOp[], scope: StoryScope): string | null;
  /** Monotonic clock for the force-plain deadline. */
  now(): number;
  flushPendingInputAndLayout(): void;
  /** Range-edit lane: the selection in document order. */
  orderedRange(): { from: SemanticPosition; to: SemanticPosition };
  /** Range-edit lane: the current selection as a history mark. */
  selectionMark(): HistoryMark | null;
  /** Range-edit lane: what removing the selection takes, and where a replacement lands. */
  deleteSelectionPlan(): RangeDeletionPlan;
  /** The armed caret format, as ops over the pre-split offsets, consumed by this insert. */
  consumePendingFormatOps(
    paragraphId: string,
    offset: number,
    length: number,
    replacing?: { readonly start: number; readonly end: number }
  ): TreeDocOp[];
  /** Apply with the armed format, and — if the store refuses the pair — without it. */
  withoutPendingOnRejection(
    withFormat: readonly TreeDocOp[],
    withoutFormat: readonly TreeDocOp[],
    mark: HistoryMark | null,
    redoMark?: HistoryMark
  ): TreeApplyResult;
  caretMark(position: { paragraphId: string; offset: number }): HistoryMark;
  commit(
    run: () => TreeApplyResult | boolean,
    selectionAfter?: () => SemanticSelection | null
  ): void;
}

export interface SurfaceClipboardOps {
  /** Insert text, turning newlines into real paragraph splits rather than literal characters. */
  insertPlainText(text: string): void;
  /** Every clipboard flavour for the current selection — see clipboard-copy-payload.ts. */
  copyFlavoursNow(): { text: string; html: string | null };
  /** The paste router entry — fidelity order with continuous degrade to plain. */
  pasteRichNow(text: string, html: string | null): boolean;
  /** Arm Cmd+Shift+V: the next paste inside the deadline routes plain. */
  armForcePlainPaste(): void;
}

const FORCE_PLAIN_PASTE_WINDOW_MS = 2000;

export function createSurfaceClipboardOps(deps: SurfaceClipboardDeps): SurfaceClipboardOps {
  const { session } = deps;

  /**
   * Armed by Cmd+Shift+V; the next paste routes plain. Deadline-bound: when no paste
   * event follows the chord (denied clipboard, focus loss), a stale arm must not silently
   * downgrade a LATER ordinary Cmd+V.
   */
  let forcePlainPasteArmedAt: number | null = null;

  /** Insert text, turning newlines into real paragraph splits rather than literal characters. */
  function insertPlainText(text: string): void {
    // Normalized first: a Windows clipboard carries CRLF, a page break arrives as a form
    // feed, and either one left in run text is a control character the store refuses —
    // which vetoes the whole transaction and makes the paste do nothing at all.
    const lines = insertableText(text).split('\n');

    // ONE COMMIT, TWO OPS, whatever the clipboard holds.
    //
    // A newline in pasted plain text is a paragraph boundary — a new `w:p`, never a
    // character in run text. Committing once per line laid out and repainted the whole
    // document per pasted paragraph, so a four-page paste cost two hundred layouts of a
    // growing document: quadratic in document size, and the reason paste lagged long
    // before typing did. The whole paste is one op list instead: the joined text lands in
    // the caret's paragraph with a single insert, and one `splitParagraphMany` cuts that
    // paragraph at every newline offset in a single pass — one rebuild of the body's child
    // sequence, however many paragraphs the clipboard carried.
    const plan = deps.deleteSelectionPlan();
    // WHERE THE REPLACEMENT GOES, the same question `type()` answers: in suggesting mode a
    // deletion keeps the characters it strikes, so the replacement belongs AFTER them.
    // Pasting at the range start put the new text in front of the struck words and left
    // the caret inside it, so the next keystroke landed mid-word.
    const target = plan.replaceAt ?? plan.collapseTo;
    const joined = lines.join('');
    const ops: TreeDocOp[] = [...plan.ops];
    // Plain text pasted at a caret takes the armed typing format, like typed text — Word
    // formats a plain paste as if you had typed it. Written over the PRE-SPLIT offsets, so
    // the op runs before `splitParagraphMany` cuts the paragraph up.
    const pendingOps = deps.consumePendingFormatOps(
      target.paragraphId,
      target.offset,
      joined.length
    );
    if (joined.length > 0) {
      ops.push({
        op: 'insertText',
        paragraphId: target.paragraphId,
        offset: target.offset,
        text: joined,
      });
      ops.push(...pendingOps);
    }
    const boundaries: number[] = [];
    let consumed = 0;
    for (let index = 0; index < lines.length - 1; index += 1) {
      consumed += lines[index]!.length;
      boundaries.push(target.offset + consumed);
    }
    if (boundaries.length > 0) {
      ops.push({ op: 'splitParagraphMany', paragraphId: target.paragraphId, offsets: boundaries });
    }
    if (ops.length === 0) return;

    const before = new Set(session.paragraphIdsIn(deps.storyScope()));
    const lastLine = lines[lines.length - 1]!;
    // A paste that stays in ONE paragraph knows exactly where it ends, so redo can put the
    // caret there. A multi-line paste mints its paragraphs inside the transaction, so the
    // landing id does not exist yet and the mark stays undefined — redo then falls back to
    // the clamp, which is where this lane started.
    const redoMark =
      boundaries.length === 0
        ? deps.caretMark({
            paragraphId: target.paragraphId,
            offset: target.offset + lastLine.length,
          })
        : undefined;
    const withoutFormat = ops.filter((op) => !pendingOps.includes(op));
    deps.commit(
      () => deps.withoutPendingOnRejection(ops, withoutFormat, deps.selectionMark(), redoMark),
      () => {
        if (boundaries.length === 0) {
          return collapsedAt({
            paragraphId: target.paragraphId,
            offset: target.offset + lastLine.length,
          });
        }
        // The caret lands at the end of the pasted text: in the LAST minted paragraph, right
        // after the final line. Scoped story ids are in document order, so the last unfamiliar
        // id is the tail that carries the final line and whatever followed the caret.
        const minted = session.paragraphIdsIn(deps.storyScope()).filter((id) => !before.has(id));
        const landing = minted[minted.length - 1];
        return landing ? collapsedAt({ paragraphId: landing, offset: lastLine.length }) : null;
      }
    );
  }

  /** Every clipboard flavour for the current selection — see clipboard-copy-payload.ts. */
  function copyFlavoursNow(): { text: string; html: string | null } {
    deps.flushPendingInputAndLayout();
    const rectangle = deps.cellSelection();
    if (rectangle) {
      return buildCopyFlavours({
        text: cellSelectionText(deps.layout(), rectangle),
        cellRectangle: true,
        coverage: null,
        pkg: null,
      });
    }
    const { from, to } = deps.orderedRange();
    const text = selectedTextIn(deps.layout(), from, to, deps.paragraphOrder());
    const scope = deps.storyScope();
    const collapsed = from.paragraphId === to.paragraphId && from.offset === to.offset;
    if (collapsed || scope.kind !== 'body') return { text, html: null };
    // A copy is a pure READ: `session.part()` is the body part, and the body-only guard
    // above is what keeps this off `partFor`, which would retain a story-store slot.
    const part = session.part();
    const coverage = fragmentCoverageOf(deps.layout(), part, from, to, deps.paragraphOrder());
    return buildCopyFlavours({
      text,
      cellRectangle: false,
      coverage,
      pkg: session.currentPackage(),
    });
  }

  /**
   * Land a fragment package at the selection, ONE commit: the selection-clearing ops plus
   * the resource merge plus `insertFragment`, promoted to a package undo unit in the
   * session. False on any refusal — the paste router degrades to the next flavour.
   */
  function pasteFragmentBytes(bytes: Uint8Array, lastMarkCovered: boolean): boolean {
    if (deps.editingMode() !== 'edit') return false;
    if (deps.storyScope().kind !== 'body') return false;
    if (deps.cellSelection()) return false;
    deps.flushPendingInputAndLayout();
    const plan = deps.deleteSelectionPlan();
    const target = plan.replaceAt ?? plan.collapseTo;
    let landed = false;
    deps.commit(
      () => {
        // The readiness gate the typing lane asks. A fragment paste reaches the store
        // through `applyFragmentPaste`, past `applyOps`, so without this a disconnected
        // replica landed a rich paste locally and never replicated it. The selection-
        // clearing plan is the op-shaped half of the write, so it is what the gate sees.
        const collaborationRefusal = deps.collaborationGate(plan.ops, { kind: 'body' });
        if (collaborationRefusal) {
          return {
            committed: false,
            rejected: true,
            opCount: 0,
            reason: collaborationRefusal,
          } as TreeApplyResult;
        }
        const actorId = deps.actorId();
        const result = session.applyFragmentPaste(
          { kind: 'body' },
          {
            paragraphId: target.paragraphId,
            offset: target.offset,
            fragmentBytes: bytes,
            lastMarkCovered,
            priorOps: plan.ops as unknown as TreeDocOp[],
            ...(actorId !== undefined ? { actorId } : {}),
          }
        );
        landed = result.ok;
        return {
          committed: result.ok,
          rejected: !result.ok,
          opCount: result.ok ? 1 : 0,
          ...(result.ok ? {} : { reason: result.detail ?? result.reason }),
        } as unknown as TreeApplyResult;
      },
      () => collapsedAt(target)
    );
    return landed;
  }

  /** The paste router entry — fidelity order with continuous degrade to plain. */
  function pasteRichNow(text: string, html: string | null): boolean {
    const forcePlain =
      forcePlainPasteArmedAt !== null &&
      deps.now() - forcePlainPasteArmedAt < FORCE_PLAIN_PASTE_WINDOW_MS;
    forcePlainPasteArmedAt = null;
    const lane = routePaste(
      {
        richLaneOpen:
          deps.editingMode() === 'edit' &&
          deps.storyScope().kind === 'body' &&
          deps.cellSelection() === null,
        pasteFragment: (fragmentBytes, lastMarkCovered) =>
          pasteFragmentBytes(fragmentBytes, lastMarkCovered),
        insertPlainText,
      },
      { html, text, forcePlain }
    );
    return lane !== 'none';
  }

  return {
    insertPlainText,
    copyFlavoursNow,
    pasteRichNow,
    armForcePlainPaste: () => {
      forcePlainPasteArmedAt = deps.now();
    },
  };
}
