import { promptsIn } from './surface-prompt-deletion.ts';
import { equationPlainText } from './surface-equations.ts';
import {
  CHART_CLIPBOARD_REASON,
  fragmentRefusalOf,
  selectionContainsClipboardChart,
  selectionContainsClipboardObject,
} from './clipboard-object-selection.ts';
import { fragmentFromHtml } from './clipboard-fragment-codec.ts';
import { chartCopyFlavours, pasteCopiedChart } from './surface-chart-clipboard.ts';
import { chartClipboardToken } from './chart-clipboard.ts';
import {
  DRAWING_CLIPBOARD_STORY_REASON,
  DRAWING_PASTE_CELLS_REASON,
  drawingCopyFlavours,
  floatingDrawingEndingAt,
  isDrawingCopyHtml,
  DRAWING_PASTE_VIEWING_REASON,
  TEXT_BOX_PASTE_REASON,
} from './surface-drawing-clipboard.ts';
import { partOfNodeId } from './surface-scope.ts';
import { FIELD_CODE_PASTE_NOTICE, fieldCodePasteRefusal } from './hidden-mark-joins.ts';
import type { DrawingPasteTarget } from './drawing-paste-target.ts';
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
  paragraphsInCells,
  type CellSelection,
  type SemanticLayout,
  type SemanticPosition,
  type SemanticSelection,
} from '@docx-editor.dev/core/layout';
import { buildCopyFlavours, type CopyFlavours } from './clipboard-copy-payload.ts';
import { routePaste } from './clipboard-paste-router.ts';
import { insertableText, plainTextFromHtml } from './clipboard-plain-text.ts';
import {
  paragraphTextMarkingOptionalHyphens,
  withoutOptionalHyphens,
} from '../layout/optional-hyphen-copy-text.ts';
import { fieldResultSpeller, REMOVED_COPY_UNIT, copiedText } from '../layout/field-copy-text.ts';
import { paragraphMarkDeleted } from '../layout/revision-visibility.ts';
import type { OoxmlPart } from '@docx-editor.dev/core/store';
import { findNode, parentNodeOf } from '../store/package/ooxml-edit.ts';
import type { FragmentPasteEnd } from '../store/store/tree-package-fragment.ts';
import { clampTextFormPaste } from './text-form-field-paste.ts';
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

/** Whether the paragraph's own mark is a pending deletion: plain text joins it to the next. */
function markDeletedIn(part: OoxmlPart, paragraphId: string): boolean {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || !paragraphMarkDeleted(paragraph)) return false;
  // Only a paragraph that follows in the same container takes the joined text. A deleted
  // mark before a table or at the end of a cell joins nothing, so the break stays.
  const siblings = parentNodeOf(part, paragraphId)?.children ?? [];
  const next = siblings[siblings.findIndex((child) => child.id === paragraphId) + 1];
  return next?.kind === 'paragraph';
}

export interface SurfaceClipboardDeps {
  session: TreeDocxSessionView;
  textFormFieldId?(): string | null;
  /** The control that owns text inserted at the caret, as `type()` names it. */
  insertOwner?(): string | undefined;
  typingSelectionPlan?(): RangeDeletionPlan & { readonly outsidePromptId?: string };
  retainPromptBoundary?(controlId?: string): void;
  richPasteAllowed?(): boolean;
  paragraphIds?(): readonly string[];
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
  /** The review display mode; the Original view copies the text before the changes. */
  revisionDisplayMode?(): string;
  /**
   * Suggesting mode with an author: who and when a rich paste is proposed by. Undefined
   * otherwise, which keeps the rich lane to edit mode.
   */
  suggestion?(): { readonly author: string; readonly date: string } | undefined;
  /** The selection-clearing ops, attributed the way typing attributes them. */
  trackedOps?(ops: readonly TreeDocOp[], date?: string): TreeDocOp[];
  /** Tell the host a tracked change landed, as every other tracked lane does. */
  trackedChangeLanded?(): void;
  commit(
    run: () => TreeApplyResult | boolean,
    selectionAfter?: () => SemanticSelection | null
  ): void;
  /**
   * The selected drawing, when an object selection holds one, and whether a shape inside it is
   * selected rather than the drawing itself.
   */
  selectedDrawing?(): {
    readonly drawingNodeId: string;
    readonly ownerPartName: string;
    readonly groupMemberSelected?: boolean;
  } | null;
  /** Select a pasted drawing and bring it into view. */
  selectPastedDrawing?(drawingNodeId: string, paragraphId: string): void;
  /** Where a paste payload goes while a drawing is selected (`pasteTargetOf`); html null for plain. */
  drawingPasteTarget?(
    text: string,
    html: string | null,
    drawingCopy: boolean
  ): DrawingPasteTarget | null;
  /** Enter the selected drawing's text box and select its text; false when it cannot. */
  selectTextBoxForPaste?(drawingNodeId: string): boolean;
  /** Leave the text box a paste entered, and select its drawing again. */
  leaveTextBoxForPaste?(drawingNodeId: string, paragraphId: string): void;
  /**
   * Put a collapsed caret at the point a paste beside a selected drawing goes. Returns a
   * function that selects that drawing again, for a paste that then lands nothing.
   */
  placeCaretForPaste?(paragraphId: string, offset: number): (() => void) | null;
}

export interface SurfaceClipboardOps {
  /** Insert text, turning newlines into real paragraph splits rather than literal characters. */
  insertPlainText(text: string): void;
  /** Every clipboard flavour for the current selection — see clipboard-copy-payload.ts. */
  copyFlavoursNow(): CopyFlavours;
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
  /** Set when a rich paste refused at field codes, so the plain fallback can say so. */
  let pasteKeptOnlyText = false;

  const refuse = (reason: string): void =>
    deps.commit(
      () => ({ committed: false, rejected: true, opCount: 0, reason }) as TreeApplyResult
    );

  /**
   * Move the selection to where a paste goes while a drawing is selected: before its anchor
   * run, or over the text of its text box. False when the paste refuses; the reason is
   * published. After a move, a function that undoes it for a paste that lands nothing: it
   * leaves the text box, and selects the drawing again. Null when the selection did not move,
   * which includes no drawing selected.
   */
  function placeDrawingPaste(
    text: string,
    html: string | null,
    drawingCopy: boolean
  ): false | (() => void) | null {
    const target = deps.drawingPasteTarget?.(text, html, drawingCopy) ?? null;
    if (!target) return null;
    if (target.kind === 'anchor') {
      // The point before the drawing's anchor run, which the caret need not be at: a press on
      // the right half of an inline drawing leaves the caret after it.
      const { from } = deps.orderedRange();
      if (from.paragraphId === target.paragraphId && from.offset === target.offset) return null;
      return deps.placeCaretForPaste?.(target.paragraphId, target.offset) ?? null;
    }
    if (target.kind === 'refused') {
      refuse(target.reason);
      return false;
    }
    const anchorParagraphId = deps.orderedRange().from.paragraphId;
    if (!deps.selectTextBoxForPaste?.(target.drawingNodeId)) {
      refuse(TEXT_BOX_PASTE_REASON);
      return false;
    }
    return () => deps.leaveTextBoxForPaste?.(target.drawingNodeId, anchorParagraphId);
  }

  /** Insert text, turning newlines into real paragraph splits rather than literal characters. */
  function insertPlainText(text: string): void {
    // Normalized first: a Windows clipboard carries CRLF, a page break arrives as a form
    // feed, and either one left in run text is a control character the store refuses —
    // which vetoes the whole transaction and makes the paste do nothing at all.
    const normalized = insertableText(text);
    const range = deps.orderedRange();
    const lines = clampTextFormPaste(
      session,
      range.from,
      range.to,
      normalized,
      deps.textFormFieldId?.() ?? null
    ).split('\n');

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
    const plan: RangeDeletionPlan & { readonly outsidePromptId?: string } =
      deps.typingSelectionPlan?.() ?? deps.deleteSelectionPlan();
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
      // The caret's own control owns a one-line paste, as it owns a keystroke: at a text
      // control's trailing edge the store's default lands the text beside the control. A
      // multi-line paste stays beside it: the paragraph split would cut the control in two.
      const inside =
        !plan.outsidePromptId && plan.ops.length === 0 && lines.length === 1
          ? deps.insertOwner?.()
          : undefined;
      ops.push({
        op: 'insertText',
        paragraphId: target.paragraphId,
        offset: target.offset,
        text: joined,
        ...(inside === undefined ? {} : { inside }),
        ...(plan.outsidePromptId ? { bias: 'left' as const } : {}),
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

    const before = new Set(deps.paragraphIds?.() ?? session.paragraphIdsIn(deps.storyScope()));
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
        deps.retainPromptBoundary?.(plan.outsidePromptId);
        if (boundaries.length === 0) {
          return collapsedAt({
            paragraphId: target.paragraphId,
            offset: target.offset + lastLine.length,
          });
        }
        // The caret lands at the end of the pasted text: in the LAST minted paragraph, right
        // after the final line. Scoped story ids are in document order, so the last unfamiliar
        // id is the tail that carries the final line and whatever followed the caret.
        const minted = (deps.paragraphIds?.() ?? session.paragraphIdsIn(deps.storyScope())).filter(
          (id) => !before.has(id)
        );
        const landing = minted[minted.length - 1];
        return landing ? collapsedAt({ paragraphId: landing, offset: lastLine.length }) : null;
      }
    );
  }

  /** Every clipboard flavour for the current selection — see clipboard-copy-payload.ts. */
  function copyFlavoursNow(): CopyFlavours {
    deps.flushPendingInputAndLayout();
    // One selected chart copies whole, through the in-memory chart clipboard.
    const chartCopy = chartCopyFlavours(deps);
    if (chartCopy) return chartCopy;
    // Any other selected drawing copies whole as a one-drawing fragment.
    const drawingCopy = drawingCopyFlavours(deps);
    if (drawingCopy) return drawingCopy;
    const rectangle = deps.cellSelection();
    const range = deps.orderedRange();
    const order = deps.paragraphOrder();
    const selected = rectangle
      ? paragraphsInCells(deps.layout(), rectangle.cellIds)
      : order.slice(order.indexOf(range.from.paragraphId), order.indexOf(range.to.paragraphId) + 1);
    const ranges = new Map(
      selected.map((id) => [
        id,
        {
          start: !rectangle && id === range.from.paragraphId ? range.from.offset : 0,
          end: !rectangle && id === range.to.paragraphId ? range.to.offset : Infinity,
        },
      ])
    );
    const copyScope = deps.storyScope();
    // Clipboard preflight reads the selected part without retaining a story-store slot.
    const copyPart =
      copyScope.kind === 'body'
        ? session.part()
        : partOfNodeId(session, selected[0] ?? range.from.paragraphId);
    if (copyPart && selectionContainsClipboardObject(copyPart, ranges)) {
      const chart = selectionContainsClipboardChart(copyPart, ranges);
      // A chart refuses with the sentence hosts translate, as the copy and cut commands do.
      deps.commit(
        () =>
          ({
            committed: false,
            rejected: true,
            opCount: 0,
            reason: chart ? CHART_CLIPBOARD_REASON : 'unsupported-content',
          }) as TreeApplyResult
      );
      return { text: '', html: null, reason: chart ? 'chart-content' : 'unsupported-content' };
    }
    // Plain text is the proposed text: deleted words and deleted paragraph marks stay out, as
    // the HTML flavour already leaves them out. The Original view shows the text before the
    // changes, so it copies what it shows.
    const proposed = deps.revisionDisplayMode?.() !== 'original';
    const baseText = copiedText(paragraphTextMarkingOptionalHyphens, !proposed);
    // An optional hyphen element is a hint for line breaking, not a character of the text, so
    // plain text leaves it out. A literal U+00AD in run text is text and stays. The HTML
    // flavour keeps both.
    const plainCopyText = (text: string): string =>
      withoutOptionalHyphens(text).replaceAll(REMOVED_COPY_UNIT, '');
    // Plain text spells each computed field with its painted result, not its one model unit.
    const fields = fieldResultSpeller(deps.layout(), baseText);
    if (rectangle) {
      return buildCopyFlavours({
        text: plainCopyText(cellSelectionText(deps.layout(), rectangle, fields.spelledText)),
        cellRectangle: true,
        coverage: null,
        pkg: null,
      });
    }
    const { from, to } = deps.orderedRange();
    const textPart = session.part();
    // Plain text spells each equation in its linear form instead of U+FFFC.
    const text = plainCopyText(
      selectedTextIn(
        deps.layout(),
        from,
        to,
        deps.paragraphOrder(),
        (id, offset) =>
          fields.resultAt(id, offset) ??
          (textPart ? equationPlainText(textPart, id, offset) : null),
        fields.markedText,
        proposed && textPart ? (id) => markDeletedIn(textPart, id) : undefined
      )
    );
    const scope = deps.storyScope();
    const collapsed = from.paragraphId === to.paragraphId && from.offset === to.offset;
    if (collapsed || scope.kind !== 'body') return { text, html: null };
    // A copy is a pure READ: `session.part()` is the body part, and the body-only guard
    // above keeps body extraction on the package reader. Non-body preflight uses its active story.
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
   * session. Unsupported content stops routing; other refusals permit the next flavour.
   */
  function pasteFragmentBytes(
    bytes: Uint8Array,
    lastMarkCovered: boolean
  ): boolean | 'unsupported-content' {
    const suggestion = deps.editingMode() === 'suggest' ? deps.suggestion?.() : undefined;
    if (deps.editingMode() !== 'edit' && suggestion === undefined) return false;
    if (deps.storyScope().kind !== 'body') return false;
    if (deps.cellSelection()) return false;
    deps.flushPendingInputAndLayout();
    const plan: RangeDeletionPlan & { readonly outsidePromptId?: string } =
      deps.typingSelectionPlan?.() ?? deps.deleteSelectionPlan();
    // Suggesting: the selection is struck, not removed, and the paste is one proposal.
    const priorOps = suggestion
      ? (deps.trackedOps?.(plan.ops, suggestion.date) ?? plan.ops)
      : plan.ops;
    const target = plan.replaceAt ?? plan.collapseTo;
    let landed = false;
    let unsupported = false;
    let end: FragmentPasteEnd | undefined;
    deps.commit(
      () => {
        // The readiness gate the typing lane asks. A fragment paste reaches the store
        // through `applyFragmentPaste`, past `applyOps`, so without this a disconnected
        // replica landed a rich paste locally and never replicated it. The selection-
        // clearing plan is the op-shaped half of the write, so it is what the gate sees.
        const fieldCode = fieldCodePasteRefusal((id) => partOfNodeId(session, id), target);
        pasteKeptOnlyText ||= fieldCode !== null;
        const collaborationRefusal =
          deps.collaborationGate(priorOps, { kind: 'body' }) ?? fieldCode;
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
            priorOps: priorOps as unknown as TreeDocOp[],
            ...(actorId !== undefined ? { actorId } : {}),
            ...(suggestion ? { revision: suggestion } : {}),
          }
        );
        landed = result.ok;
        if (result.ok) end = result.end;
        if (landed && suggestion) deps.trackedChangeLanded?.();
        unsupported = !result.ok && result.detail === 'fragment-merge:unsupported-content';
        return {
          committed: result.ok,
          rejected: !result.ok,
          opCount: result.ok ? 1 : 0,
          ...(result.ok ? {} : { reason: result.detail ?? result.reason }),
        } as unknown as TreeApplyResult;
      },
      () => {
        deps.retainPromptBoundary?.(plan.outsidePromptId);
        if (plan.outsidePromptId) {
          const part = session.part();
          for (
            let node = parentNodeOf(part, plan.outsidePromptId);
            node;
            node = parentNodeOf(part, node.id)
          ) {
            if (node.kind !== 'paragraph') continue;
            const prompt = promptsIn(part, node.id).find(
              (entry) => entry.control.id === plan.outsidePromptId
            );
            if (prompt) return collapsedAt({ paragraphId: node.id, offset: prompt.start });
            break;
          }
        }
        // Word leaves the caret at the END of the pasted content, as the plain lane does.
        // The landing paragraph is created inside the transaction, so the store reports it.
        return collapsedAt(end ?? target);
      }
    );
    // A paste that landed exactly one floating drawing selects it, so the copy is ready to move.
    if (
      landed &&
      end &&
      end.paragraphId === target.paragraphId &&
      end.offset === target.offset + 1
    ) {
      const drawingNodeId = floatingDrawingEndingAt(session.part(), end.paragraphId, end.offset);
      if (drawingNodeId) deps.selectPastedDrawing?.(drawingNodeId, end.paragraphId);
    }
    return unsupported ? 'unsupported-content' : landed;
  }

  /** The paste router entry — fidelity order with continuous degrade to plain. */
  function pasteRichNow(text: string, html: string | null): boolean {
    const forcePlain =
      forcePlainPasteArmedAt !== null &&
      deps.now() - forcePlainPasteArmedAt < FORCE_PLAIN_PASTE_WINDOW_MS;
    forcePlainPasteArmedAt = null;
    // A copied chart pastes where a copied drawing does: before a selected drawing's anchor.
    const chartPlaced =
      !forcePlain && chartClipboardToken(html) !== null
        ? placeDrawingPaste(text, html, true)
        : null;
    if (chartPlaced === false) return false;
    const chart = forcePlain ? null : pasteCopiedChart(deps, html);
    if (chart !== null) {
      if (chart === false && chartPlaced) chartPlaced();
      return chart;
    }
    const storyOpen = (deps.richPasteAllowed?.() ?? true) && deps.storyScope().kind === 'body';
    // A copied drawing lands only at a caret in the main story. Elsewhere it refuses, rather than
    // pasting a text box's text alone or nothing at all. Cmd+Shift+V still pastes the text.
    const cells = deps.cellSelection() !== null;
    const viewing = deps.editingMode() === 'view';
    const drawingCopy = !forcePlain && isDrawingCopyHtml(html);
    if (drawingCopy && (!storyOpen || cells || viewing)) {
      const reason = viewing
        ? DRAWING_PASTE_VIEWING_REASON
        : storyOpen
          ? DRAWING_PASTE_CELLS_REASON
          : DRAWING_CLIPBOARD_STORY_REASON;
      refuse(reason);
      return false;
    }
    // While a drawing is selected the paste goes before its anchor run or into its text box.
    const placed = placeDrawingPaste(text, forcePlain ? null : html, drawingCopy);
    if (placed === false) return false;
    const revision = deps.session.packageRevision();
    // A text box takes the plain lane: an HTML-only payload brings its visible text there.
    const typed =
      placed && !forcePlain && html && text.trim() === '' ? plainTextFromHtml(html) || text : text;
    const landed = routeRichPaste(typed, html, forcePlain, cells);
    // A paste into a text box that lands nothing leaves the box, so the next key does not
    // replace the text the paste selected, and reports that it landed nothing: the store's
    // refusal, such as a locked content control, stays the published reason.
    if (placed && deps.session.packageRevision() === revision) {
      placed();
      return false;
    }
    return landed;
  }

  function routeRichPaste(
    text: string,
    html: string | null,
    forcePlain: boolean,
    cells: boolean
  ): boolean {
    // Read again: a paste into a text box takes the text box's plain lane.
    const richStory = (deps.richPasteAllowed?.() ?? true) && deps.storyScope().kind === 'body';
    pasteKeptOnlyText = false;
    const lane = routePaste(
      {
        richLaneOpen:
          richStory &&
          (deps.editingMode() === 'edit' ||
            (deps.editingMode() === 'suggest' && deps.suggestion?.() !== undefined)) &&
          !cells,
        pasteFragment: (fragmentBytes, lastMarkCovered) =>
          pasteFragmentBytes(fragmentBytes, lastMarkCovered),
        insertPlainText,
      },
      { html, text, forcePlain }
    );
    if (lane === 'unsupported-content') {
      // Read again only on refusal: a chart refuses with the sentence hosts translate.
      const fragment = html ? fragmentFromHtml(html) : null;
      const chart = fragment !== null && fragmentRefusalOf(fragment.bytes) === 'chart';
      deps.commit(
        () =>
          ({
            committed: false,
            rejected: true,
            opCount: 0,
            reason: chart ? CHART_CLIPBOARD_REASON : 'unsupported-content',
          }) as TreeApplyResult
      );
      return false;
    }
    // A rich paste that would split field codes landed as plain text: an informational
    // rejection tells the host that the formatting and paragraphs were dropped.
    if (pasteKeptOnlyText && lane !== 'none') refuse(FIELD_CODE_PASTE_NOTICE);
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
