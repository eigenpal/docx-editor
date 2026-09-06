// The unit layout measures: one run of text with everything paint will need to draw it.
//
// A "piece" is what the paragraph walk emits and `paragraph-flow.ts` breaks into lines. It is
// deliberately not a run: one run can produce several pieces (a tab splits it), and several runs
// can produce one (a field's cached result). What every piece does carry is its MODEL RANGE, so
// selection, the caret and hit-testing address the store rather than the DOM.
//
// Split out of `field-projection.ts` because these are the vocabulary, not the walk — and that
// module is against the file-size cap.

import { WML_NAMESPACE_URI, type OoxmlNode, type OoxmlProperty } from '@docx-editor.dev/core/store';
import type { HardBreakKind } from '@docx-editor.dev/core/store';
import type { LegacyFormFieldData } from '../store/package/field-nodes.ts';
import type { InlineDrawingLayoutInput } from './drawing-layout.ts';
import { eastAsiaRunsOfSegments, type FontSlot } from './script-itemization.ts';
import {
  hasEastAsiaSymbolHint,
  hasTimesNewRomanEastAsiaException,
} from './east-asia-symbol-hint.ts';
import type { ButtonFieldSpec } from './field-button.ts';
import type { DocPropertyField } from './field-doc-property.ts';
import type { FormFieldKind } from './field-form.ts';
import type { AllowlistedPageField } from './field-instruction.ts';
import type { AutonumFieldSpec } from './field-autonum.ts';
import type { HyperlinkFieldSpec } from './field-link.ts';
import type { PageRefFieldProjection, RefFieldSpec } from './field-ref.ts';
import type { SymbolFieldSpec } from './field-symbol.ts';
import { isSymbolEncodedFamily } from './symbol-encoding.ts';
import type { RevisionAttribution } from './revision-projection.ts';
import type { ResolvedRunStyle, ThemeFonts } from './run-style.ts';
import type { SpanLinkRecord } from './semantic-records.ts';
import type { OmmlEquationProjection } from '@docx-editor.dev/core/store';

/**
 * A `w:ptab` — the ABSOLUTE-position tab (ECMA-376 §17.3.3.16), which is what a table of
 * contents line is actually made of.
 *
 * Not a `w:tab`: it carries its own destination and leader instead of advancing to the next
 * stop in `w:tabs`, so a paragraph needs no tab stops at all to lay one out. A document that
 * uses these has no `w:tabs` to find, which is why an engine that only models `w:tab` shows
 * the entries and page numbers run together with no dots between them.
 */
export interface PositionalTab {
  readonly alignment: 'left' | 'center' | 'right';
  readonly relativeTo: 'margin' | 'indent' | 'leftMargin';
  readonly leader?: 'dot' | 'hyphen' | 'underscore' | 'middleDot';
}

/**
 * What a piece says about the FIELD result it came from, for Word's shading.
 *
 * Carried from layout rather than decided at paint time because only the walk knows an atom was
 * a field at all — by paint the result is just text. Whether the shading is actually drawn is a
 * view decision made downstream, so this states the fact and nothing about the appearance.
 */
export interface FieldAtomMarker {
  /**
   * A legacy form field: `w:fldChar/w:ffData` (FORMTEXT, FORMCHECKBOX, FORMDROPDOWN).
   *
   * Word shades these on a different rule from ordinary fields — always, unless the document
   * turns it off — because they mark the blanks somebody is meant to fill in.
   */
  readonly formField: boolean;
  /**
   * A BODY PAGE / NUMPAGES / SECTIONPAGES atom whose value depends on pagination.
   *
   * The paragraph walk cannot know which page the field lands on — layout runs before the page
   * count — so it paints a placeholder and records the field's kind here. Document finalize
   * (`substituteBodyPageFields`) reads this marker and substitutes the real value per page.
   * Absent in headers/footers, which evaluate live through their own per-page projector.
   */
  readonly pageField?: {
    readonly kind: AllowlistedPageField;
    /** The field's `\#` numeric picture, applied when finalize substitutes the value. */
    readonly picture?: string;
  };
  /**
   * A BODY `PAGEREF` atom whose value is the page number its bookmark target lands on.
   *
   * Deferred exactly like {@link pageField}: the paragraph walk paints the field's cached
   * result (or the placeholder digit when the file cached none) and records the resolved
   * target here; document finalize substitutes the number of the page hosting the target's
   * first fragment, gated per field on the calibration verdict.
   */
  readonly pageRef?: PageRefFieldProjection;
}

/**
 * One measurable piece produced while walking runs (including projected field results).
 *
 * Projected page-field text covers the single atomic model unit for a well-formed field
 * (`start`..`end` is length 1, matching `paragraphTextOf`). Empty-result allowlisted fields
 * still occupy that unit. Furniture is read-only / non-selectable at the surface; the range
 * stays canonical-aligned for layout consumers.
 */
export interface FieldAwarePiece {
  readonly text: string;
  readonly props: readonly OoxmlProperty[];
  readonly style: ResolvedRunStyle;
  /** UTF-16 model offset range; projected fields cover suppressed cached-result text when present. */
  readonly start: number;
  readonly end: number;
  /** True when text substitutes for a model unit (page field or inert atomic cache). */
  readonly projected?: boolean;
  /**
   * Set when this piece is a `w:ptab`. Its range is ZERO-WIDTH: the element is generic in
   * the canonical tree and contributes nothing to the paragraph's text, so it must advance
   * the line without moving a single model offset — anything else and every offset after it
   * would disagree with the store.
   */
  readonly positionalTab?: PositionalTab;
  /** Typed hard-break intent; model text remains one newline-compatible UTF-16 unit. */
  readonly breakKind?: HardBreakKind;
  /** The hyperlink this piece came from, already sanitized, or absent for ordinary text. */
  readonly link?: SpanLinkRecord;
  /**
   * When set, layout measures this string instead of `text` (eachPage note-mark width
   * reservation). Paint still uses `text`.
   */
  readonly measureText?: string;
  /** Note citation / mark navigation for paint (body ↔ note). */
  readonly noteNav?: {
    readonly scopeId: string;
    readonly direction: 'to-note' | 'to-body';
  };
  /** Typed inline drawing occupying one UTF-16 model unit. */
  readonly inlineDrawing?: InlineDrawingLayoutInput;
  /**
   * This piece is a visible ANCHORED drawing's zero-glyph placeholder. The record paints
   * from the page layer, not from a span — so this marker is how the anchor line still
   * learns it carries a tracked change (the margin bar reads it; see #479).
   */
  readonly anchoredAtom?: true;
  /** Bounded paragraph-level OMML projection occupying one UTF-16 model unit. */
  readonly equation?: OmmlEquationProjection;
  /**
   * The revision wrappers enclosing this text, outermost first, absent when untracked.
   *
   * A stack rather than a single value because revisions nest: an insertion by one author
   * inside a deletion by another is ordinary in a two-round review, and both matter — the
   * outer one decides whether the content exists, the inner one is still someone's pending
   * decision about it.
   */
  readonly revisions?: readonly RevisionAttribution[];
  /** Present when this piece is a field's displayed result; literal or projected. */
  readonly fieldAtom?: FieldAtomMarker;
  /**
   * The `w:rFonts` slot this piece's text resolves its face through; absent means the base
   * (ascii/hAnsi) slots. Set by {@link applyEastAsiaFontSlots}, and carried through to the
   * style spans, so every consumer that measures or paints the text resolves the face with
   * `styleForFontSlot` while the piece's `style` stays the run's real resolution.
   */
  readonly fontSlot?: FontSlot;
}

/** A half-open model-offset range, in the paragraph's own UTF-16 offset space. */
export interface ModelRange {
  readonly start: number;
  readonly end: number;
}

export type MutableModelRange = { start: number; end: number };

/** Append a range, coalescing with the previous one when they touch or overlap. */
export function appendModelRange(ranges: MutableModelRange[], start: number, end: number): void {
  if (end <= start) return;
  const last = ranges[ranges.length - 1];
  if (last && last.end >= start) {
    last.end = Math.max(last.end, end);
    return;
  }
  ranges.push({ start, end });
}

const PTAB_ALIGNMENTS = new Set(['left', 'center', 'right']);
const PTAB_RELATIVE_TO = new Set(['margin', 'indent', 'leftMargin']);
const PTAB_LEADERS = new Set(['dot', 'hyphen', 'underscore', 'middleDot']);

/**
 * Read a `w:ptab` off a run child, or null when it is not one.
 *
 * The element is generic in the canonical tree (nothing models it), so this reads its
 * attributes directly and validates every one against its closed enumeration — the values
 * come from the file and go on to drive geometry. `w:leader="none"`, and anything
 * unrecognised, resolves to no leader rather than rejecting the tab: the ADVANCE is still
 * authored, and dropping it would run the text together.
 */
export function positionalTabOf(node: OoxmlNode): PositionalTab | null {
  if (node.kind === 'textValue' || node.localName !== 'ptab') return null;
  if (node.namespaceUri !== WML_NAMESPACE_URI) return null;
  let alignment = 'left';
  let relativeTo = 'margin';
  let leader: string | undefined;
  for (const attribute of node.attributes) {
    if (attribute.namespaceUri !== WML_NAMESPACE_URI) continue;
    if (attribute.localName === 'alignment') alignment = attribute.value;
    else if (attribute.localName === 'relativeTo') relativeTo = attribute.value;
    else if (attribute.localName === 'leader') leader = attribute.value;
  }
  return {
    alignment: (PTAB_ALIGNMENTS.has(alignment) ? alignment : 'left') as PositionalTab['alignment'],
    relativeTo: (PTAB_RELATIVE_TO.has(relativeTo)
      ? relativeTo
      : 'margin') as PositionalTab['relativeTo'],
    ...(leader !== undefined && PTAB_LEADERS.has(leader)
      ? { leader: leader as NonNullable<PositionalTab['leader']> }
      : {}),
  };
}

/**
 * How layout turns a typed `w:hyperlink` node into the sanitized record spans carry.
 *
 * Injected rather than computed here because resolving `r:id` needs the PACKAGE's
 * relationships and this module only ever sees one part's tree. `null` means the caller
 * declined to project — the runs still measure and paint, they simply carry no link, which is
 * the right degradation: text is never lost for want of a target.
 */
export type HyperlinkProjector = (link: OoxmlNode) => SpanLinkRecord | null;

/**
 * How layout turns a parsed HYPERLINK field instruction into the sanitized record spans carry.
 *
 * Injected for the same reason as {@link HyperlinkProjector}: the spec's raw target must cross
 * the surface's ONE href trust boundary, and layout owns no sanitization policy. `null` means
 * no link — the cached result still paints as plain text, which is the right degradation.
 */
export type FieldLinkProjector = (spec: HyperlinkFieldSpec) => SpanLinkRecord | null;

/**
 * Pending live or inert-cache projection for one atomic field unit.
 *
 * Well-formed computed fields contribute exactly one UTF-16 model unit. Cached result text
 * is not independently addressable — it only donates display text and result-run style.
 * Missing `end` demotes: buffered cache is flushed as ordinary pieces with real lengths.
 *
 * The state only; the machinery that fills and flushes it stays closure-bound inside
 * `piecesOfParagraph`.
 */
export interface PendingFieldProjection {
  /** Allowlisted kind when live-projecting; null paints inert cached text at the atom. */
  kind: AllowlistedPageField | null;
  /**
   * The `\#` numeric picture of {@link kind}, or null when the field states none.
   *
   * Captured beside the kind, and for the same reason the specs below are: the machine's
   * instruction buffer is reset before the flush runs.
   */
  picture: string | null;
  /**
   * Parsed SYMBOL instruction, or null when the field is not one.
   *
   * Captured while the machine still holds the raw instruction — at `separate`, or at the
   * outermost `end` for the begin/instr/end shape Word also writes — because `onFldCharEnd`
   * resets the buffer before the flush reads anything. SYMBOL has no cached result in real
   * files, so the flush renders from this and it wins over any stale cached text.
   */
  symbolSpec: SymbolFieldSpec | null;
  /**
   * Parsed HYPERLINK instruction, or null when the field is not one.
   *
   * Captured at the same points as {@link symbolSpec} and for the same reason. Only consulted
   * when {@link resultLink} stays empty: an ENCLOSING `w:hyperlink` outranks the field's own
   * instruction, exactly as Word resolves the nesting.
   */
  linkSpec: HyperlinkFieldSpec | null;
  /**
   * FORMCHECKBOX / FORMDROPDOWN instruction, or null when the field is neither.
   *
   * Captured at the same points as {@link symbolSpec}. Consulted with {@link formData}: the
   * checkbox state is authoritative over any stale cached glyph, the dropdown defers to a
   * non-empty cached result.
   */
  formSpec: FormFieldKind | null;
  /**
   * Parsed MACROBUTTON / GOTOBUTTON instruction, or null when the field is neither.
   *
   * Captured at the same points as {@link symbolSpec}. Display text only — the macro / target
   * is discarded at parse and nothing ever executes or navigates. Unlike SYMBOL, a cached
   * result WINS when present (it is what Word last painted); the flush synthesizes from this
   * only when the cache is empty.
   */
  buttonSpec: ButtonFieldSpec | null;
  /**
   * Recognized document-property field (TITLE / AUTHOR / … / `DOCPROPERTY "Name"`), or null.
   *
   * Captured at the same points as {@link symbolSpec}. Resolved against the document's parsed
   * properties at flush time (not here — the properties are document-global, not on the field).
   * A cached result WINS when present, exactly like {@link buttonSpec}; synthesis fills only an
   * empty cache.
   */
  docPropertySpec: DocPropertyField | null;
  /**
   * Recognized REF cross-reference instruction, or null when the field is not one.
   *
   * Captured at the same points as {@link symbolSpec}. Unlike {@link buttonSpec}, a resolved
   * value WINS over a non-empty cached result — the stale cache is exactly what a REF field
   * exists to replace — and an unresolvable spec (missing bookmark, unnumbered target for a
   * number switch) falls back to the cache, never to the raw instruction.
   */
  refSpec: RefFieldSpec | null;
  /**
   * Recognized AUTONUM / AUTONUMLGL / AUTONUMOUT instruction, or null when the field is none.
   *
   * Captured at the same points as {@link symbolSpec}. These fields carry NO separator and NO
   * cached result — Word computes the number at display time and never stores it — so the
   * synthesized sequential value is the only display they have; there is no cache to prefer.
   */
  autonumSpec: AutonumFieldSpec | null;
  /**
   * Bounded `w:ffData` render state read at `begin` (`legacyFormFieldDataOf` — state only,
   * macros never), or null when absent or malformed. {@link formField} stays presence-based:
   * ffData present with an unreadable payload still shades as a form field.
   */
  formData: LegacyFormFieldData | null;
  /**
   * Canonical node id of the field's begin `w:fldChar`.
   *
   * The per-field key REF calibration verdicts live under (`RefFieldContext.liveValueOf`):
   * node ids survive edits, so the projection and the context's token fold read the same
   * verdict for the same field however either walk collected its cached text.
   */
  beginId: string;
  /** True when this pending field is a well-formed atomic unit (begin will close). */
  atomic: boolean;
  /** True when this closed FORMTEXT field exposes its authored result as ordinary text. */
  editableResult: boolean;
  atomStart: number;
  props: readonly OoxmlProperty[];
  style: ResolvedRunStyle;
  capturedResultStyle: boolean;
  /** Cached result text (for inert display or demotion flush). */
  cachedText: string;
  /**
   * True once result-phase content the current display mode KEEPS was seen — visible or
   * vanish-hidden. Only content with model text sets it (result text, tab / break, `w:sym`);
   * drawings, `w:ptab` and note references never do.
   *
   * `cachedText` alone cannot tell "the file cached no result" from "the file cached one and
   * hid it": both leave it empty. Synthesis (MACROBUTTON / GOTOBUTTON display text, the
   * FORMDROPDOWN selected entry) fills only the first — painting over a vanished result would
   * resurrect what the document hides. A result the display mode resolves AWAY (a
   * `w:del`-wrapped cache in the proposed view) does not set it: that view has no cached
   * result left, and Word synthesizes there after the deletion is accepted. FORMCHECKBOX
   * ignores this on purpose: its ffData state is the authority, and a hidden FIELD is
   * already covered by the flush's style guard.
   */
  sawResultContent: boolean;
  /** Demotion-only: ordinary pieces when the field fails to close. */
  buffered: FieldAwarePiece[];
  /** Demotion-only running offset mirror while buffering ordinary pieces. */
  bufferOffset: number;
  /**
   * The revision wrappers this field's displayed text sits inside, captured while the walk was
   * still INSIDE them.
   *
   * An ATOMIC field's result is buffered at the run that carries it and flushed at `fldChar
   * end`, by which point the depth-first walk has left the wrapper and restored the live stack
   * to empty. Reading the live stack at flush time therefore attributed a tracked field result
   * to nothing at all, and it painted as ordinary unchanged text — a deletion with no strike,
   * an insertion with no underline.
   *
   * Both shapes reach here: a `w:del` around only the RESULT run with `begin`/`end` outside it
   * (how Word records a form field whose value was replaced), and a wrapper around the whole
   * `begin`…`end` sequence. The second used to demote instead — `atomicFieldSpansOf` did not
   * descend into revision wrappers — until that walk was widened so the store and layout would
   * stop disagreeing about what such a field is worth. Anything reasoning about "a wrapped field
   * never forms an atom" is out of date; `commitAtomicField` now has to resolve visibility
   * itself, because it can be reached with a stack that the display mode resolves away.
   *
   * A field whose result runs carry DIFFERENT stacks collapses to the first: the atom is one
   * model unit and Word treats a field as one decision, so splitting it would invent a boundary
   * the model does not have.
   */
  resultRevisions: readonly RevisionAttribution[];
  /** Whether {@link resultRevisions} has been donated yet — an EMPTY stack is a real answer. */
  capturedResultRevisions: boolean;
  /** `w:ffData` on the begin marker — a legacy form field, which Word shades on its own rule. */
  formField: boolean;
  /**
   * The link enclosing the displayed result, captured at `begin` for the same reason.
   *
   * Reachable where the revision capture is not: `atomicFieldSpansOf` DOES descend into
   * `w:hyperlink`, so a field inside a link is still an atom, and without this its result was
   * the one run in the link painting with no href.
   */
  resultLink?: SpanLinkRecord;
}

/** A slice of `piece` covering `[from, to)` of its text, in the given font slot. */
function fontSlotSlice(
  piece: FieldAwarePiece,
  from: number,
  to: number,
  fontSlot: FontSlot | undefined
): FieldAwarePiece {
  return {
    ...piece,
    text: piece.text.slice(from, to),
    start: piece.start + from,
    end: piece.start + to,
    ...(fontSlot ? { fontSlot } : {}),
  };
}

/**
 * Mark the text that resolves through the `eastAsia` font slot, after a paragraph's pieces
 * are all assembled.
 *
 * A post-pass over the WHOLE paragraph, not a per-piece one, because Common characters
 * inherit their slot from strong neighbours and `w:t`/run boundaries are not script
 * boundaries: a fullwidth comma alone in its own run between two CJK runs is East Asian
 * text, and only a pass that sees both neighbours can say so. Classification is
 * `eastAsiaRunsOfSegments`; this function owns which pieces participate and how the answer
 * lands on them:
 *
 * - Ordinary literal text (model range 1:1 with its text) is SPLIT into slot-homogeneous
 *   pieces. Piece boundaries are not break opportunities (`opensWord` in
 *   `paragraph-flow.ts` carries words across them), so the split changes which face a
 *   character resolves to and nothing else.
 * - Layout-owned text — projected results, field atoms, note marks, `measureText`
 *   reservations — stays WHOLE: its spans publish the piece's model range, and slicing
 *   that range would corrupt offsets. Such a piece takes the slot only when ALL of its
 *   text resolves eastAsia; a mixed one keeps the base face, which is what it painted
 *   before slots existed.
 * - Control pieces (tabs, breaks, drawings, equations) neither classify nor split.
 *
 * The style objects are untouched: a piece carries the run's real resolution and the slot
 * beside it, and the face is derived at the measurer/paint boundary via `styleForFontSlot`.
 */
export function applyEastAsiaFontSlots(
  pieces: FieldAwarePiece[],
  themeFonts?: ThemeFonts
): FieldAwarePiece[] {
  // Nothing to resolve unless some run authors a DISTINCT East Asian face. This is the
  // cheap common-case exit for Latin-defaulted documents; documents whose docDefaults
  // author one for every run instead lean on the pure-ASCII prescan inside
  // `eastAsiaRunsOfSegments`, which costs two compares per character.
  if (
    !pieces.some(
      ({ style }) =>
        style.fontFamilyEastAsia !== null && style.fontFamilyEastAsia !== style.fontFamily
    )
  ) {
    return pieces;
  }

  /** Indices of the pieces whose text joins the classification, in paragraph order. */
  const streamed: number[] = [];
  const segments: string[] = [];
  const hintedSegments: boolean[] = [];
  for (let index = 0; index < pieces.length; index += 1) {
    const piece = pieces[index]!;
    if (piece.positionalTab || piece.breakKind || piece.inlineDrawing) continue;
    if (piece.anchoredAtom || piece.equation) continue;
    if (piece.text.length === 0) continue;
    streamed.push(index);
    segments.push(piece.text);
    // Leave the special Times New Roman East Asian fallback to existing resolution, and never
    // move a symbol-encoded face (Wingdings, Symbol, a `w:sym` piece): its glyphs live in
    // the symbol font, and the East Asian face would paint them as notdef boxes.
    hintedSegments.push(
      hasEastAsiaSymbolHint(piece.props) &&
        !isSymbolEncodedFamily(piece.style.fontFamily) &&
        !hasTimesNewRomanEastAsiaException(piece.props, piece.style.fontFamilyEastAsia, themeFonts)
    );
  }
  const ranges = eastAsiaRunsOfSegments(segments, hintedSegments);
  if (ranges.length === 0) return pieces;

  const rangesBySegment = new Map<number, { from: number; to: number }[]>();
  for (const range of ranges) {
    const list = rangesBySegment.get(range.segment);
    if (list) list.push({ from: range.from, to: range.to });
    else rangesBySegment.set(range.segment, [{ from: range.from, to: range.to }]);
  }

  const out: FieldAwarePiece[] = [];
  let segment = 0;
  for (let index = 0; index < pieces.length; index += 1) {
    const piece = pieces[index]!;
    if (streamed[segment] !== index) {
      out.push(piece);
      continue;
    }
    const pieceRanges = rangesBySegment.get(segment);
    segment += 1;
    const { style } = piece;
    if (
      !pieceRanges ||
      style.fontFamilyEastAsia === null ||
      style.fontFamilyEastAsia === style.fontFamily
    ) {
      out.push(piece);
      continue;
    }
    const literal =
      !piece.projected &&
      !piece.fieldAtom &&
      !piece.noteNav &&
      piece.measureText === undefined &&
      piece.end - piece.start === piece.text.length;
    if (!literal) {
      const whole =
        pieceRanges.length === 1 &&
        pieceRanges[0]!.from === 0 &&
        pieceRanges[0]!.to === piece.text.length;
      out.push(whole ? { ...piece, fontSlot: 'eastAsia' } : piece);
      continue;
    }
    let cursor = 0;
    for (const range of pieceRanges) {
      if (range.from > cursor) out.push(fontSlotSlice(piece, cursor, range.from, undefined));
      out.push(fontSlotSlice(piece, range.from, range.to, 'eastAsia'));
      cursor = range.to;
    }
    if (cursor < piece.text.length) {
      out.push(fontSlotSlice(piece, cursor, piece.text.length, undefined));
    }
  }
  return out;
}
