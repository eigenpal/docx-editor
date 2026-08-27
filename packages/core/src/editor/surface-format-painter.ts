// Word's Format Painter over the selection (paginated-surface seam).
//
// Two halves that never meet in the document: a CAPTURE, which reads and writes nothing,
// and an APPLY, which writes formatting and never moves text. They sit in their own lane
// rather than in `surface-format.ts` because the capture is the one formatting read that
// deliberately takes the RESOLVED cascade — every write base in that file is the authored
// properties, for the very good reason that echoing the cascade freezes inherited
// formatting as direct. Here that IS the point: the painter promises the reader "make this
// look like that", and what the reader sees is the cascade.

import type { TreeApplyResult, TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import type { FormattingDisplayMode, StoryScope, TreeDocOp } from '@docx-editor.dev/core/store';
import {
  directParagraphProperties,
  mergedParagraphMarkProperties,
  runPropertyEdits,
} from '@docx-editor.dev/core/store';
import {
  paragraphsInCells,
  type ResolvedRunStyle,
  type SemanticLayout,
  type SemanticPosition,
  type SemanticSelection,
} from '@docx-editor.dev/core/layout';
import { selectionRunStyle, type SurfaceProperty } from './surface-formatting.ts';
import type {
  FormatPainterMode,
  FormatPainterOps,
  FormatPainterSurfaceState,
} from './surface-format-painter-contract.ts';

/**
 * How close two presses must be to read as one double-press.
 *
 * The platform's own double-click interval is not readable from script, so this is the
 * conventional 500ms every toolkit falls back to. It lives in the ENGINE rather than in
 * each adapter's `dblclick` binding, because two hosts deciding separately what a
 * double-click means is two hosts that drift the moment one of them changes.
 */
const DOUBLE_PRESS_WINDOW_MS = 500;

/** What one capture holds. Internal: the surface contract publishes the LEVEL, not this. */
interface FormatPainterCapture {
  readonly runProperties: readonly SurfaceProperty[];
  /** Null for a run-level capture — a range that stayed inside one paragraph. */
  readonly paragraphProperties: readonly SurfaceProperty[] | null;
}

/** What the composition root lends this lane. */
export interface SurfaceFormatPainterDeps {
  readonly session: TreeDocxSessionView;
  /** Active story for reads and mutations — body or `{ kind: 'headerFooter', rId }`. */
  storyScope(): StoryScope;
  layout(): SemanticLayout;
  selection(): SemanticSelection;
  /** Which revision halves the reader is looking at; a write must not restyle hidden text. */
  displayMode(): FormattingDisplayMode;
  commit(
    run: () => TreeApplyResult | boolean,
    nextSelection?: () => SemanticSelection | null,
    options?: { readonly keepCellSelection?: boolean }
  ): void;
  orderedRange(): { from: SemanticPosition; to: SemanticPosition };
  selectionMark(): { paragraphId: string; start: number; end: number } | null;
  textOf(paragraphId: string): string;
  paragraphOrder(): readonly string[];
  /** The cells a rectangular table selection covers, when one is live. */
  selectedCells?(): readonly string[] | undefined;
  /** Arm run formatting for the next characters typed — the collapsed-caret lane. */
  armPendingFormats(properties: readonly SurfaceProperty[]): void;
  /** Monotonic clock, for the double-press window. */
  now(): number;
  /** Report observable surface state moving, so a toolbar's pressed state follows. */
  publish(): void;
}

/**
 * The captured RUN formatting, spelled out as run properties.
 *
 * Every property is stated, including the ones that are OFF. That is what makes painting
 * subtractive as well as additive: Word's painter un-bolds bold text when the source is not
 * bold, and a capture that listed only what was on could never do that.
 *
 * `w:rStyle` is absent, as it is everywhere else in this engine — preserved, not authored
 * (see `ACCEPTED_RUN_PROPERTIES`) — so painting onto a run that carries a character style
 * leaves that style's face underneath. The same limit `clearFormatting` states.
 */
function runPropertiesOf(style: ResolvedRunStyle): readonly SurfaceProperty[] {
  const onOff = (on: boolean): { val: string } => ({ val: on ? '1' : '0' });
  const halfPoints = String(Math.max(2, Math.min(3276, Math.round(style.fontSizePt * 2))));
  const properties: SurfaceProperty[] = [
    { localName: 'b', attributes: onOff(style.bold) },
    { localName: 'i', attributes: onOff(style.italic) },
    {
      localName: 'u',
      attributes: style.underline
        ? {
            val: style.underline.variant,
            ...(style.underline.color ? { color: style.underline.color } : {}),
          }
        : { val: 'none' },
    },
    { localName: 'strike', attributes: onOff(style.strike) },
    { localName: 'dstrike', attributes: onOff(style.doubleStrike) },
    { localName: 'caps', attributes: onOff(style.caps) },
    { localName: 'smallCaps', attributes: onOff(style.smallCaps) },
    // Closed enumerations, so their OFF state is a member rather than `val="0"` — the same
    // spelling `toggleRunProperty` writes when it turns them off.
    { localName: 'vertAlign', attributes: { val: style.verticalAlign } },
    { localName: 'color', attributes: { val: style.color ?? 'auto' } },
    { localName: 'highlight', attributes: { val: style.highlight ?? 'none' } },
    { localName: 'sz', attributes: { val: halfPoints } },
    { localName: 'szCs', attributes: { val: halfPoints } },
  ];
  // Only when the cascade resolved to a face. A run whose whole chain authored nothing is
  // measured in the surface's own default, which is not a document fact and must not be
  // written into a paragraph as if it were.
  if (style.fontFamily) {
    properties.push({
      localName: 'rFonts',
      attributes: { ascii: style.fontFamily, hAnsi: style.fontFamily },
    });
  }
  return properties;
}

/** Every paragraph a range touches, in document order. */
function paragraphsInRange(
  order: readonly string[],
  range: { from: SemanticPosition; to: SemanticPosition }
): readonly string[] {
  const firstIndex = order.indexOf(range.from.paragraphId);
  const lastIndex = order.indexOf(range.to.paragraphId);
  if (firstIndex === -1 || lastIndex === -1) return [];
  return order.slice(firstIndex, lastIndex + 1);
}

/** The painter, plus the one hook the composition root drives from a settled gesture. */
export type SurfaceFormatPainter = FormatPainterOps & {
  /** Paint and stand down, if armed. Called when a selection gesture settles. */
  applyIfArmed(): void;
};

export function createSurfaceFormatPainter(deps: SurfaceFormatPainterDeps): SurfaceFormatPainter {
  const session = deps.session;
  const storyPart = () => session.partFor(deps.storyScope()) ?? session.part();

  let mode: FormatPainterMode = 'off';
  let captured: FormatPainterCapture | null = null;
  let lastPressAt: number | null = null;

  const state = (): FormatPainterSurfaceState => ({
    mode,
    level: captured === null ? 'none' : captured.paragraphProperties ? 'paragraph' : 'run',
  });

  /**
   * Whether the selection covers a paragraph MARK, which is what decides the level.
   *
   * The engine has no separate offset for the pilcrow, so the proxy is the one every other
   * write in this lane already uses: a range that covers a paragraph's whole text, or that
   * reaches past it into another paragraph, owns that paragraph's mark. A collapsed caret
   * counts too — Word copies paragraph formatting from a caret, and a caret has no range
   * for character formatting to mean anything else.
   */
  const coversAParagraphMark = (
    from: SemanticPosition,
    to: SemanticPosition,
    rectangular: boolean
  ): boolean => {
    if (rectangular) return true;
    if (from.paragraphId !== to.paragraphId) return true;
    if (from.offset === to.offset) return true;
    const text = deps.textOf(from.paragraphId);
    return from.offset === 0 && to.offset === text.length && text.length > 0;
  };

  const capture = (): boolean => {
    const cells = deps.selectedCells?.();
    const rectangular = cells !== undefined && cells.length > 0;
    const style = selectionRunStyle(deps.layout(), deps.selection(), cells, deps.paragraphOrder());
    if (!style) return false;
    const { from, to } = deps.orderedRange();
    // The paragraph's OWN properties, and the style it names among them. A paragraph naming
    // no style contributes no `w:pStyle`, which is exactly right: the apply below is a
    // REPLACING write, so an unnamed style drops the target's and the target falls back to
    // the document default — the style the source paragraph is itself written in.
    const paragraphProperties = coversAParagraphMark(from, to, rectangular)
      ? directParagraphProperties(storyPart(), from.paragraphId)
      : null;
    captured = { runProperties: runPropertiesOf(style), paragraphProperties };
    deps.publish();
    return true;
  };

  const apply = (): boolean => {
    const held = captured;
    if (!held) return false;
    const cells = deps.selectedCells?.();
    const rectangular = cells !== undefined && cells.length > 0;
    const { from, to } = deps.orderedRange();
    const paragraphIds = rectangular
      ? [...paragraphsInCells(deps.layout(), cells)]
      : paragraphsInRange(deps.paragraphOrder(), { from, to });
    if (paragraphIds.length === 0) return false;
    const collapsed =
      !rectangular && from.paragraphId === to.paragraphId && from.offset === to.offset;
    const part = storyPart();
    const displayMode = deps.displayMode();
    const ops: TreeDocOp[] = [];
    paragraphIds.forEach((paragraphId, index) => {
      const text = deps.textOf(paragraphId);
      const start = rectangular || paragraphId !== from.paragraphId ? 0 : from.offset;
      const end = rectangular || paragraphId !== to.paragraphId ? text.length : to.offset;
      if (start < end) {
        for (const edit of runPropertyEdits(
          part,
          paragraphId,
          start,
          end,
          held.runProperties,
          displayMode
        )) {
          ops.push({
            op: 'setRunProperties',
            paragraphId,
            start: edit.start,
            end: edit.end,
            properties: edit.properties,
            ...(edit.targetRunIds ? { targetRunIds: edit.targetRunIds } : {}),
          });
        }
      }
      // The mark follows a paragraph whose pilcrow the range contains — the same rule the
      // rest of the formatting lane applies, and what a list marker takes its face from.
      const coversMark =
        rectangular ||
        index < paragraphIds.length - 1 ||
        (start === 0 && end === text.length && text.length > 0);
      if (coversMark) {
        ops.push({
          op: 'setParagraphMarkProperties',
          paragraphId,
          properties: mergedParagraphMarkProperties(part, paragraphId, held.runProperties),
        });
      }
      if (held.paragraphProperties) {
        // REPLACING, not merged: painting a paragraph means it ends up formatted like the
        // source, so what the source does not state the target must not keep. The applier
        // drops only what an op can NAME, so `w:sectPr`, `w:pBdr` and the rest survive.
        ops.push({
          op: 'setParagraphProperties',
          paragraphId,
          properties: [...held.paragraphProperties],
        });
      }
    });
    if (ops.length > 0) {
      deps.commit(
        () => session.applyTreeOps(ops, deps.selectionMark(), undefined, deps.storyScope()),
        undefined,
        { keepCellSelection: rectangular }
      );
    }
    // At a collapsed caret there is no text to paint, so the character half of the capture
    // arms for the next characters typed instead — Word's stored-marks lane, and the same
    // thing picking a font with nothing selected does. AFTER the commit, because a commit
    // that moves the caret discards what is armed at the old one.
    if (collapsed) deps.armPendingFormats(held.runProperties);
    return ops.length > 0 || collapsed;
  };

  const disarm = (): void => {
    if (mode === 'off') return;
    mode = 'off';
    deps.publish();
  };

  return {
    state,
    capture,
    apply,
    disarm,
    press() {
      const at = deps.now();
      const doublePress = lastPressAt !== null && at - lastPressAt < DOUBLE_PRESS_WINDOW_MS;
      lastPressAt = at;
      // A double press locks the painter on. Re-capturing costs nothing — the selection has
      // not moved since the press that armed it — and it keeps the two paths identical.
      if (doublePress) {
        if (!capture()) return;
        mode = 'locked';
        deps.publish();
        return;
      }
      if (mode !== 'off') {
        disarm();
        return;
      }
      if (!capture()) return;
      mode = 'once';
      deps.publish();
    },
    applyIfArmed() {
      if (mode === 'off' || captured === null) return;
      apply();
      if (mode === 'once') disarm();
    },
  };
}
