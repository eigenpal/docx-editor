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
 * Inches for DISPLAY, in the reader's number format.
 *
 * `0.5` and `0,5` are the same measurement, and roughly half the locales this ships with
 * write the second one. Interpolating a raw `Number` into a string picks the first for
 * everyone. The catalogue supplies the surrounding words; this supplies the number.
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
    alignment: format.alignment === 'both' ? 'justify' : (format.alignment ?? 'left'),
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
  };
}

/** Which settings the selection DISAGREES about, so a control can show it. */
export interface ParagraphDialogMixed {
  readonly contextualSpacing: boolean;
  readonly keepNext: boolean;
  readonly keepLines: boolean;
  readonly widowControl: boolean;
  readonly pageBreakBefore: boolean;
}

export const NO_MIXED_FIELDS: ParagraphDialogMixed = {
  contextualSpacing: false,
  keepNext: false,
  keepLines: false,
  widowControl: false,
  pageBreakBefore: false,
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
  current: ParagraphDialogFields
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

  if (seed.alignment !== current.alignment) take('alignment', current.alignment);
  if (seed.indentLeft !== current.indentLeft) take('indentLeftTwips', current.indentLeft);
  if (seed.indentRight !== current.indentRight) take('indentRightTwips', current.indentRight);
  // The kind and the magnitude are two controls over ONE value, so either one moving
  // rewrites it. Note that `none` and a magnitude of zero fold to the same signed zero,
  // which is why the comparison is on the controls and not on the folded result.
  if (seed.special !== current.special || seed.specialBy !== current.specialBy)
    take('indentFirstLineTwips', signedFirstLineOf(current.special, current.specialBy));
  if (seed.spaceBefore !== current.spaceBefore) take('spaceBeforePt', current.spaceBefore);
  if (seed.spaceAfter !== current.spaceAfter) take('spaceAfterPt', current.spaceAfter);
  if (seed.lineRule !== current.lineRule || seed.lineValue !== current.lineValue)
    take('lineSpacing', { rule: current.lineRule, value: current.lineValue });
  if (seed.contextualSpacing !== current.contextualSpacing)
    take('contextualSpacing', current.contextualSpacing);
  if (seed.keepNext !== current.keepNext) take('keepNext', current.keepNext);
  if (seed.keepLines !== current.keepLines) take('keepLines', current.keepLines);
  if (seed.widowControl !== current.widowControl) take('widowControl', current.widowControl);
  if (seed.pageBreakBefore !== current.pageBreakBefore)
    take('pageBreakBefore', current.pageBreakBefore);
  if (!sameTabStops(seed.tabStops, current.tabStops)) take('tabStops', current.tabStops);

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
