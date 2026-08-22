// The Paragraph dialog's field logic, with no framework in it.
//
// Byte-identical between the React and Vue adapters (enforced by
// `scripts/check-adapter-mirror.mjs`). The dialog is a form over ~15 settings, and every
// rule about what those settings MEAN — how a signed first-line indent splits into a kind
// and a magnitude, which fields a submission may name — is the engine's contract, not a
// framework's. Two hand-written copies drifted; one shared module cannot.

import type {
  ParagraphFormatRead,
  ParagraphFormatUpdate,
  ParagraphTabStop,
} from './useParagraphFormat';

export const TWIPS_PER_INCH = 1440;

export const twipsToInches = (twips: number): number =>
  Math.round((twips / TWIPS_PER_INCH) * 100) / 100;

/**
 * Inches for DISPLAY, in the BROWSER's number format.
 *
 * `0.5` and `0,5` are the same measurement, and roughly half the locales this ships with
 * write the second one. Interpolating a raw `Number` into a string picks the first for
 * everyone. The catalogue supplies the surrounding words; this supplies the number.
 *
 * Not the editor's locale: nothing in the i18n layer exposes one to read, so a German
 * editor in an American browser still renders `0.5`. The browser's guess beats a hardcoded
 * `.` for every reader whose browser matches their language, which is most of them.
 */
export const formatInches = (twips: number): string =>
  twipsToInches(twips).toLocaleString(undefined, { maximumFractionDigits: 2 });

export const inchesToTwips = (inches: number): number => Math.round(inches * TWIPS_PER_INCH);

export type TabAlignment = 'left' | 'center' | 'right' | 'decimal' | 'bar';
export type TabLeaderName = 'none' | 'dot' | 'hyphen' | 'underscore';

/** One label key per alignment, so the rows read as words rather than as `w:val` values. */
export const TAB_ALIGNMENT_LABELS = {
  left: 'dialogs.paragraph.tabAlignLeft',
  center: 'dialogs.paragraph.tabAlignCenter',
  right: 'dialogs.paragraph.tabAlignRight',
  decimal: 'dialogs.paragraph.tabAlignDecimal',
  // Unreachable today — the reader never yields `bar`, the dialog does not offer it and
  // `classifyCommand` refuses it — but `ParagraphTabStop` admits it, so the map that types
  // itself against that union has to carry it. A row with no label is worse than a spare one.
  bar: 'dialogs.paragraph.tabAlignBar',
} as const satisfies Record<TabAlignment, string>;

/** The "Special" pair: the signed first-line offset, split into a kind and a magnitude. */
export type SpecialIndent = 'none' | 'firstLine' | 'hanging';

export const specialOf = (signedTwips: number | null): SpecialIndent => {
  if (signedTwips === null || signedTwips === 0) return 'none';
  return signedTwips < 0 ? 'hanging' : 'firstLine';
};

/** Fold the "Special" pair back into the ONE signed value the engine takes. */
export const signedFirstLineOf = (kind: SpecialIndent, magnitudeTwips: number): number => {
  if (kind === 'none') return 0;
  return kind === 'hanging' ? -Math.abs(magnitudeTwips) : Math.abs(magnitudeTwips);
};

/**
 * Every field of the form, in the shape the controls hold it.
 *
 * Deliberately flat and all-defined: this is what the dialog SHOWS, and a control cannot
 * show "mixed" and a number at once. The disagreement itself is remembered by comparing
 * against the seed, not by keeping a null in here.
 */
export interface ParagraphDialogFields {
  alignment: 'left' | 'center' | 'right' | 'justify';
  indentLeft: number;
  indentRight: number;
  special: SpecialIndent;
  specialBy: number;
  spaceBefore: number;
  spaceAfter: number;
  lineRule: 'multiple' | 'exact' | 'atLeast';
  lineValue: number;
  contextualSpacing: boolean;
  keepNext: boolean;
  keepLines: boolean;
  widowControl: boolean;
  pageBreakBefore: boolean;
  tabStops: readonly ParagraphTabStop[];
  /** The user pressed "Clear all", which is a decision even when the list already looked empty. */
  clearedAllTabStops: boolean;
}

/**
 * Open the form on the selection.
 *
 * A `null` field means the selection DISAGREES about that setting. There is no third
 * checkbox state to show it with, so the control opens on the least surprising value and
 * {@link changedFields} keeps the disagreement alive by not writing what the user did not
 * touch. `widowControl` opens ON because that is the Word default a document inherits
 * when nothing says otherwise.
 */
export function seedFields(format: ParagraphFormatRead): ParagraphDialogFields {
  const firstLine = format.indentFirstLineTwips;
  return {
    alignment: format.alignment ?? 'left',
    indentLeft: format.indentLeftTwips ?? 0,
    indentRight: format.indentRightTwips ?? 0,
    special: specialOf(firstLine),
    specialBy: Math.abs(firstLine ?? 0),
    spaceBefore: format.spaceBeforePt ?? 0,
    spaceAfter: format.spaceAfterPt ?? 0,
    lineRule: format.lineSpacing?.rule ?? 'multiple',
    lineValue: format.lineSpacing?.value ?? 1.08,
    contextualSpacing: format.contextualSpacing === true,
    keepNext: format.keepNext === true,
    keepLines: format.keepLines === true,
    widowControl: format.widowControl !== false,
    pageBreakBefore: format.pageBreakBefore === true,
    tabStops: format.tabStops ?? [],
    clearedAllTabStops: false,
  };
}

/**
 * Which settings the selection DISAGREES about, so a control can show it.
 *
 * The value fields need this as much as the checkboxes do. A control that renders a
 * disagreement as a plausible-looking number is not just unhelpful — it makes the
 * disagreement uncorrectable, because the value that would fix it is the one already on
 * screen, so `changedFields` sees nothing move and writes nothing. Four paragraphs at
 * mixed alignments showed "Left" and could not be set to Left.
 */
export interface ParagraphDialogMixed {
  readonly contextualSpacing: boolean;
  readonly keepNext: boolean;
  readonly keepLines: boolean;
  readonly widowControl: boolean;
  readonly pageBreakBefore: boolean;
  /** The selection's paragraphs carry DIFFERENT tab stops, so the list shows none of them. */
  readonly tabStops: boolean;
  readonly alignment: boolean;
  readonly indentLeft: boolean;
  readonly indentRight: boolean;
  readonly special: boolean;
  readonly spaceBefore: boolean;
  readonly spaceAfter: boolean;
  readonly lineSpacing: boolean;
}

/** The five members that are checkboxes, and so share a label key with their control. */
export type ParagraphFlagKey =
  | 'contextualSpacing'
  | 'keepNext'
  | 'keepLines'
  | 'widowControl'
  | 'pageBreakBefore';

export const NO_MIXED_FIELDS: ParagraphDialogMixed = {
  contextualSpacing: false,
  keepNext: false,
  keepLines: false,
  widowControl: false,
  pageBreakBefore: false,
  tabStops: false,
  alignment: false,
  indentLeft: false,
  indentRight: false,
  special: false,
  spaceBefore: false,
  spaceAfter: false,
  lineSpacing: false,
};

/**
 * A checkbox over a setting the selection disagrees about is INDETERMINATE, not unchecked
 * — unchecked would claim the paragraphs agree it is off. The read reports `null` for
 * exactly this, and a control that collapses it to a boolean throws the distinction away.
 */
export function mixedFieldsOf(format: ParagraphFormatRead): ParagraphDialogMixed {
  return {
    contextualSpacing: format.contextualSpacing === null,
    keepNext: format.keepNext === null,
    keepLines: format.keepLines === null,
    widowControl: format.widowControl === null,
    pageBreakBefore: format.pageBreakBefore === null,
    tabStops: format.tabStops === null,
    alignment: format.alignment === null,
    indentLeft: format.indentLeftTwips === null,
    indentRight: format.indentRightTwips === null,
    special: format.indentFirstLineTwips === null,
    spaceBefore: format.spaceBeforePt === null,
    spaceAfter: format.spaceAfterPt === null,
    lineSpacing: format.lineSpacing === null,
  };
}

/** Whether two stop lists say the same thing. A list needs more than reference equality. */
export function sameTabStops(
  a: readonly ParagraphTabStop[],
  b: readonly ParagraphTabStop[]
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((stop, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      stop.positionTwips === other.positionTwips &&
      stop.alignment === other.alignment &&
      (stop.leader ?? 'none') === (other.leader ?? 'none')
    );
  });
}

/**
 * The submission: ONLY the fields that moved since the dialog opened.
 *
 * Sending the whole form would flatten every setting the selection disagrees about. A
 * mixed `keepNext` would become off on every paragraph, and a mixed left indent would
 * become an explicit zero — which is worse than wrong, because a zero BLOCKS the style
 * cascade where leaving the setting alone would let the style keep supplying it. An
 * untouched field is not a decision, so it is not written.
 *
 * Returns null when nothing moved, which the caller treats as "just close": an empty
 * write would still push an undo entry that restores nothing.
 */
export function changedFields(
  seed: ParagraphDialogFields,
  current: ParagraphDialogFields,
  /** What the selection disagreed about when the dialog opened. */
  seedMixed: ParagraphDialogMixed = NO_MIXED_FIELDS,
  /** What it still disagrees about now. A field that left this set was RESOLVED. */
  currentMixed: ParagraphDialogMixed = seedMixed
): ParagraphFormatUpdate | null {
  const update: {
    -readonly [K in keyof ParagraphFormatUpdate]: ParagraphFormatUpdate[K];
  } = {};
  let moved = false;
  const take = <K extends keyof ParagraphFormatUpdate>(
    key: K,
    value: ParagraphFormatUpdate[K]
  ): void => {
    update[key] = value;
    moved = true;
  };
  /**
   * A setting the selection DISAGREED about, that it no longer disagrees about.
   *
   * Comparing values alone is not enough for these. The control opened on one of the two
   * answers, so a user resolving the disagreement TO that answer — clicking a mixed box on
   * and off again, which is how you say "off, for all of them" — leaves the value equal to
   * the seed while the box now reads as settled. Writing nothing there would leave the
   * paragraphs still disagreeing under a control claiming they agree, and making the
   * selection agree is the whole job.
   */
  const resolved = (key: keyof ParagraphDialogMixed): boolean =>
    seedMixed[key] && !currentMixed[key];

  if (seed.alignment !== current.alignment || resolved('alignment'))
    take('alignment', current.alignment);
  if (seed.indentLeft !== current.indentLeft || resolved('indentLeft'))
    take('indentLeftTwips', current.indentLeft);
  if (seed.indentRight !== current.indentRight || resolved('indentRight'))
    take('indentRightTwips', current.indentRight);
  // The kind and the magnitude are two controls over ONE value, so either one moving
  // rewrites it. Note that `none` and a magnitude of zero fold to the same signed zero,
  // which is why the comparison is on the controls and not on the folded result.
  if (
    seed.special !== current.special ||
    seed.specialBy !== current.specialBy ||
    resolved('special')
  )
    take('indentFirstLineTwips', signedFirstLineOf(current.special, current.specialBy));
  if (seed.spaceBefore !== current.spaceBefore || resolved('spaceBefore'))
    take('spaceBeforePt', current.spaceBefore);
  if (seed.spaceAfter !== current.spaceAfter || resolved('spaceAfter'))
    take('spaceAfterPt', current.spaceAfter);
  if (
    seed.lineRule !== current.lineRule ||
    seed.lineValue !== current.lineValue ||
    resolved('lineSpacing')
  )
    take('lineSpacing', { rule: current.lineRule, value: current.lineValue });
  if (seed.contextualSpacing !== current.contextualSpacing || resolved('contextualSpacing'))
    take('contextualSpacing', current.contextualSpacing);
  if (seed.keepNext !== current.keepNext || resolved('keepNext'))
    take('keepNext', current.keepNext);
  if (seed.keepLines !== current.keepLines || resolved('keepLines'))
    take('keepLines', current.keepLines);
  if (seed.widowControl !== current.widowControl || resolved('widowControl'))
    take('widowControl', current.widowControl);
  if (seed.pageBreakBefore !== current.pageBreakBefore || resolved('pageBreakBefore'))
    take('pageBreakBefore', current.pageBreakBefore);
  // Same rule for the tab list, with one extra condition: the list must ALSO differ from
  // the seed, or a net-zero gesture writes. "Clear all" over a mixed selection is a real
  // decision and the list legitimately equals the seed there — but so does "add a stop,
  // change your mind, remove it", and that used to clear every selected paragraph.
  // `clearedAllTabStops` is set only by the button that says so.
  if (
    !sameTabStops(seed.tabStops, current.tabStops) ||
    (resolved('tabStops') && current.clearedAllTabStops)
  )
    take('tabStops', current.tabStops);

  return moved ? update : null;
}

/** Add one stop, replacing any stop already at that position, and keep the list sorted. */
export function withTabStop(
  stops: readonly ParagraphTabStop[],
  stop: ParagraphTabStop
): readonly ParagraphTabStop[] {
  const kept = stops.filter((existing) => existing.positionTwips !== stop.positionTwips);
  return [...kept, stop].sort((a, b) => a.positionTwips - b.positionTwips);
}

/**
 * Keep Tab inside the dialog.
 *
 * `aria-modal` tells assistive tech the rest of the page is inert; it does not stop Tab,
 * so without this the third Tab lands on the document behind the dialog — which is the
 * editable surface, so the next keystroke types into the paragraph being formatted.
 *
 * Returns true when the event was handled, so a caller only has to call `preventDefault`.
 */
export function trapTabWithin(panel: HTMLElement, event: KeyboardEvent): boolean {
  if (event.key !== 'Tab') return false;
  const focusable = [
    ...panel.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    ),
  ].filter((node) => !node.hasAttribute('disabled') && node.tabIndex !== -1);
  if (focusable.length === 0) return false;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  const active = panel.ownerDocument.activeElement;
  // Wrap at whichever end the user is walking off, and treat "focus is on the panel
  // itself" as being before the first control — that is where it sits when the dialog
  // has just opened.
  if (event.shiftKey && (active === first || active === panel)) {
    last.focus();
    return true;
  }
  if (!event.shiftKey && active === last) {
    first.focus();
    return true;
  }
  return false;
}
