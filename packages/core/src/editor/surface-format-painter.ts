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
import { FORMAT_PAINTER_OFF } from './surface-format-painter-contract.ts';
import type {
  FormatPainterMode,
  FormatPainterOps,
  FormatPainterPaintResult,
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
 * EVERY property the op vocabulary admits is stated, not just the ones a toolbar shows.
 * `runPropertyEdits` MERGES the capture over what the target run authors, so a property the
 * capture leaves out is a property the target keeps: omitting `w:spacing` or `w:position`
 * left painted text expanded or raised, looking nothing like the source it was painted
 * from. The complete list is `ACCEPTED_RUN_PROPERTIES` minus `w:rStyle`.
 *
 * Two of them merge per ATTRIBUTE rather than wholesale, so the rule applies one level down:
 * `w:u` states its theme colour as well as its colour, and `w:rFonts` deliberately does not
 * state the East Asian and complex-script slots — see each one below.
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
    // The complex-script twins take the Latin answer, because the resolver keeps ONE bold
    // and one italic: `w:bCs` is not separately resolved, so there is nothing else to copy.
    // Left out they would survive the paint, and a run that reached the target already
    // carrying `w:bCs` would stay bold in every complex script.
    { localName: 'bCs', attributes: onOff(style.bold) },
    { localName: 'iCs', attributes: onOff(style.italic) },
    {
      // `w:u` carries two settings, and `mergedMultiSettingProperty` merges it ATTRIBUTE by
      // attribute — so an omitted `w:color` is the target's colour kept, one level below the
      // rule this file's header states. `auto` is the spelling for "follows the text",
      // which is what a resolved colour of null means.
      localName: 'u',
      attributes: {
        val: style.underline ? style.underline.variant : 'none',
        color: style.underline?.color ?? 'auto',
        // `w:themeColor` OUTRANKS `w:color`, so a target underline carrying one would ignore
        // the colour beside it. `none` is the member of `ST_ThemeColor` that means "no theme
        // reference", which is what a resolved RRGGBB — or no colour at all — amounts to.
        themeColor: 'none',
      },
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
    // Back into the units the ATTRIBUTES carry. The resolver hands every measurement over in
    // points; `w:spacing` on a run is twips, `w:position` and `w:kern` are half-points, and
    // `w:w` is a percentage (see `resolveRunStyle`).
    {
      localName: 'spacing',
      attributes: { val: String(Math.round(style.characterSpacingPt * 20)) },
    },
    { localName: 'position', attributes: { val: String(Math.round(style.baselineShiftPt * 2)) } },
    { localName: 'w', attributes: { val: String(Math.round(style.horizontalScalePercent)) } },
    { localName: 'kern', attributes: { val: String(Math.round(style.kerningMinPt * 2)) } },
  ];
  // Only when the cascade resolved to a face. A run whose whole chain authored nothing is
  // measured in the surface's own default, which is not a document fact and must not be
  // written into a paragraph as if it were.
  //
  // `ascii` and `hAnsi` only. `w:rFonts` merges per SLOT (`mergedFontProperty`), so a target
  // keeps its East Asian and complex-script faces — deliberately, and for the same reason a
  // CJK list marker keeps its own face when the Latin text beside it changes. The resolver
  // publishes ONE family, so there is no East Asian answer to copy even if that were wanted.
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
  /**
   * When a press last put a LOCKED painter away, so the second half of that double-click can
   * be told from a fresh press.
   *
   * Only the locked mode earns this. A user who locked the painter with a double-click puts
   * it away with one, and handing it back armed would let their next click in the document
   * repaint silently. A single-application arming is dismissed with a SINGLE click, so a
   * press that follows is a change of mind and must arm — swallowing that one would be a
   * control that looks live and does nothing.
   */
  let dismissedLockAt: number | null = null;

  // Reference-stable while unchanged, like the armed typing format beside it: the editor's
  // snapshot cache compares its fields with `===`, so a fresh object per read would report
  // every tick as a change and cost every consumer a re-render.
  let published: FormatPainterSurfaceState = FORMAT_PAINTER_OFF;
  const state = (): FormatPainterSurfaceState => {
    const level = captured === null ? 'none' : captured.paragraphProperties ? 'paragraph' : 'run';
    if (published.mode !== mode || published.level !== level) published = { mode, level };
    return published;
  };

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

  /** The capture itself. Silent, so a caller that also moves the MODE reports once. */
  const captureNow = (): boolean => {
    const cells = deps.selectedCells?.();
    const rectangular = cells !== undefined && cells.length > 0;
    const { from, to } = deps.orderedRange();
    if (!deps.paragraphOrder().includes(from.paragraphId)) return false;
    const style = selectionRunStyle(deps.layout(), deps.selection(), cells, deps.paragraphOrder());
    // The paragraph's OWN properties, and the style it names among them. A paragraph naming
    // no style contributes no `w:pStyle`, which is exactly right: the apply below is a
    // REPLACING write, so an unnamed style drops the target's and the target falls back to
    // the document default — the style the source paragraph is itself written in.
    const paragraphProperties = coversAParagraphMark(from, to, rectangular)
      ? directParagraphProperties(storyPart(), from.paragraphId)
      : null;
    // NO SPAN IS NOT NO CAPTURE. An EMPTY paragraph publishes no style span at all, and a
    // caret in one is exactly where a paragraph-level copy earns its keep: copying a blank
    // heading's style, alignment and indents onto another paragraph is what the user is
    // reaching for. Refusing here left that press doing nothing, in silence.
    //
    // What it cannot carry is character formatting — there is no text to read it from — so
    // the capture states none and the apply writes none rather than inventing a face.
    if (!style && paragraphProperties === null) return false;
    captured = {
      runProperties: style ? runPropertiesOf(style) : [],
      paragraphProperties,
    };
    return true;
  };

  const capture = (): boolean => {
    if (!captureNow()) return false;
    deps.publish();
    return true;
  };

  /**
   * The paint, and the two different things a caller wants to know about it.
   *
   * `wrote` is whether the DOCUMENT moved — the only honest answer to "did it work". `armed`
   * is the collapsed-caret consolation: no text to paint, so the character half went to the
   * stored-marks lane instead. The public `apply` reports either; the armed painter stands
   * down only for `wrote`, because a click that painted no text is the FIRST half of Word's
   * paint-a-word double-click and the painter has to still be live for the second.
   */
  const applyNow = (): { wrote: boolean; armed: boolean; built: boolean } => {
    const held = captured;
    if (!held) return { wrote: false, armed: false, built: false };
    const cells = deps.selectedCells?.();
    const rectangular = cells !== undefined && cells.length > 0;
    const { from, to } = deps.orderedRange();
    const paragraphIds = rectangular
      ? [...paragraphsInCells(deps.layout(), cells)]
      : paragraphsInRange(deps.paragraphOrder(), { from, to });
    if (paragraphIds.length === 0) return { wrote: false, armed: false, built: false };
    const collapsed =
      !rectangular && from.paragraphId === to.paragraphId && from.offset === to.offset;
    const part = storyPart();
    const displayMode = deps.displayMode();
    const ops: TreeDocOp[] = [];
    paragraphIds.forEach((paragraphId, index) => {
      const text = deps.textOf(paragraphId);
      const start = rectangular || paragraphId !== from.paragraphId ? 0 : from.offset;
      const end = rectangular || paragraphId !== to.paragraphId ? text.length : to.offset;
      if (start < end && held.runProperties.length > 0) {
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
      //
      // A PARAGRAPH-level capture covers it whatever the range does, because that capture
      // reformats the paragraph wholesale: the properties below are written for every
      // paragraph in the set regardless of how much text is selected, so the mark has to be
      // too. Without this, painting a bulleted item by CLICKING the target made it a list
      // item whose bullet kept the target's old face, while painting the same capture over a
      // SELECTION of the same paragraph did not — one capture, two results.
      const coversMark =
        held.paragraphProperties !== null ||
        rectangular ||
        index < paragraphIds.length - 1 ||
        (start === 0 && end === text.length && text.length > 0);
      // Guarded on the capture carrying character formatting for the same reason the run
      // write above is: an op that names nothing still counts as APPLIED — the store
      // publishes a revision and pushes an undo entry for it — so an empty-source paint
      // would cost an undo press that undoes nothing.
      if (coversMark && held.runProperties.length > 0) {
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
    // The REVISION, not the op count: a write can be refused after it is built — a document
    // opened for viewing, a tracked-content protection, a collaboration gate — and reporting
    // a refused paint as success is the one thing a caller cannot recover from. `commit`
    // hands nothing back, so the model is asked directly.
    //
    // Sampled AFTER `orderedRange()` above, which is the point: that call flushes buffered
    // typing (`flushPendingInputAndLayout`), so the keystrokes a user typed just before
    // pressing the chord have already landed and moved the revision. Sampled earlier, this
    // would read their transaction as the paint's own and call a refused paint a success.
    const before = session.packageRevision();
    if (ops.length > 0) {
      deps.commit(
        () => session.applyTreeOps(ops, deps.selectionMark(), undefined, deps.storyScope()),
        undefined,
        { keepCellSelection: rectangular }
      );
    }
    const wrote = session.packageRevision() !== before;
    // At a collapsed caret there is no text to paint, so the character half of the capture
    // arms for the next characters typed instead — Word's stored-marks lane, and the same
    // thing picking a font with nothing selected does. AFTER the commit, because a commit
    // that moves the caret discards what is armed at the old one. Only once the write landed:
    // arming a format the document just refused would let the next keystroke carry it in.
    const armed = collapsed && held.runProperties.length > 0 && (wrote || ops.length === 0);
    if (armed) deps.armPendingFormats(held.runProperties);
    return { wrote, armed, built: ops.length > 0 };
  };

  const apply = (): FormatPainterPaintResult => {
    const result = applyNow();
    // A single-application arming is spent by the paint, whichever gesture ran it. Left
    // standing after a Ctrl+Alt+V, the painter kept the copy cursor on the pages and the next
    // CLICK in the document painted again — a paragraph-level capture landing on whatever
    // paragraph the user happened to click.
    if (result.wrote && mode === 'once') disarm();
    if (result.wrote) return 'painted';
    if (result.armed) return 'armed';
    // BUILT AND REJECTED, not "nothing to paint": the ops existed, so the selection did hold
    // something the capture could reach and the document turned it down. Telling the reader
    // to select some text there would be the wrong instruction for the wrong problem.
    return result.built ? 'refused' : 'nothingToPaint';
  };

  /** Turn it off, leaving the double-press window as it was. */
  const standDown = (): void => {
    if (mode === 'off') return;
    mode = 'off';
    deps.publish();
  };

  const disarm = (): void => {
    // The window goes with it, because this is the lane a press does NOT come through —
    // `Esc`, and a finished single application. The press after either of those starts a
    // fresh gesture rather than reading as the second half of the last one.
    lastPressAt = null;
    dismissedLockAt = null;
    standDown();
  };

  return {
    state,
    capture,
    apply,
    disarm,
    press(): boolean {
      const at = deps.now();
      const doublePress = lastPressAt !== null && at - lastPressAt < DOUBLE_PRESS_WINDOW_MS;
      const previous = mode;
      lastPressAt = at;
      // The window opens only on a press that LANDED. A refusal that left it open made the
      // next press — the one with a real selection under it — read as the second half of a
      // double-click, take the ignore branch below, and report success while the painter sat
      // off and the button stayed unpressed.
      const refuse = (): boolean => {
        lastPressAt = null;
        return false;
      };
      // The second half of a double-click on an ARMED painter locks it on. Re-capturing costs
      // nothing — the selection has not moved since the press that armed it — and it keeps
      // the armed and the locked path telling one story.
      if (previous === 'once' && doublePress) {
        if (!captureNow()) return refuse();
        mode = 'locked';
        deps.publish();
        return true;
      }
      // Any other press while it is armed stands it down, which is what a second click on a
      // live painter means in Word — including a click on a LOCKED one. `standDown`, not
      // `disarm`: the window has to keep running for the branch below.
      if (previous !== 'off') {
        standDown();
        dismissedLockAt = previous === 'locked' ? at : null;
        return true;
      }
      // The second half of the double-click whose FIRST half put a LOCKED painter away.
      // Handing it back armed would leave the user's next click in the document silently
      // repainting formatting they had just dismissed.
      if (dismissedLockAt !== null && at - dismissedLockAt < DOUBLE_PRESS_WINDOW_MS) {
        dismissedLockAt = null;
        return true;
      }
      // `captureNow`, not `capture`: the mode moves in the same gesture, so ONE report
      // covers both. Two would wake every subscriber twice for a single click.
      if (!captureNow()) return refuse();
      mode = 'once';
      dismissedLockAt = null;
      deps.publish();
      return true;
    },
    applyIfArmed() {
      if (mode === 'off' || captured === null) return;
      // Only a paint that reached the DOCUMENT consumes a single-application arming. A click
      // with a character-level capture selects nothing to paint, and Word's gesture there is
      // the double-click whose SECOND release selects the word — so the painter has to still
      // be armed when that release arrives. A refused write does not consume it either.
      if (applyNow().wrote && mode === 'once') disarm();
    },
  };
}
