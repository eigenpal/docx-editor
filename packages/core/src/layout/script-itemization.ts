import type { BidiEmbeddingLevels } from './bidi.ts';
import type { TextDirection } from './shaped-run.ts';
import { withFontFamily, type ResolvedRunStyle } from './run-style.ts';
import { isEastAsiaHintSymbol } from './east-asia-symbol-hint.ts';

/**
 * Which `w:rFonts` slot a character resolves its face through.
 *
 * OOXML gives a run up to four faces and picks between them by SCRIPT, so one run of mixed Latin
 * and CJK text uses two different fonts without saying so anywhere in its properties.
 */
export type FontSlot = 'ascii' | 'hAnsi' | 'eastAsia' | 'cs';

/**
 * A run of text sharing one script, direction and font slot — the unit handed to the shaper.
 *
 * Shaping cannot span a script change: Arabic and Latin in one call would produce wrong joining
 * behaviour, so a run is itemized into these first.
 */
export interface ScriptItem {
  readonly from: number;
  readonly to: number;
  readonly direction: TextDirection;
  readonly bidiLevel: number;
  readonly script:
    | 'Zyyy'
    | 'Latn'
    | 'Grek'
    | 'Cyrl'
    | 'Hani'
    | 'Hebr'
    | 'Arab'
    | 'Deva'
    | 'Beng'
    | 'Thai'
    | 'Khmr';
  readonly slot: FontSlot;
}

type Classified = Omit<ScriptItem, 'from' | 'to' | 'direction' | 'bidiLevel'> | null;

const inRange = (value: number, from: number, to: number): boolean => value >= from && value <= to;

/**
 * A code point whose script this engine does not itemize.
 *
 * Carries the offending `codePoint` so the caller can report which character stopped it, rather
 * than failing anonymously somewhere in the middle of a paragraph.
 */
export class UnsupportedScriptError extends Error {
  readonly name = 'UnsupportedScriptError';
  readonly code = 'unsupportedScript';
  readonly codePoint: number;

  constructor(codePoint: number) {
    super(`Unsupported Unicode script at U+${codePoint.toString(16).toUpperCase()}`);
    this.codePoint = codePoint;
  }
}

/**
 * Explicit, deterministic Unicode-range policy for the Word font slots supported by Task 5.
 * Common/inherited characters return null. Paragraph-wide resolution uses the preceding
 * strong item on conflicts, and the following strong item only for leading Common text.
 */
const classify = (codePoint: number): Classified => {
  if (inRange(codePoint, 0xff21, 0xff3a) || inRange(codePoint, 0xff41, 0xff5a)) {
    return { slot: 'hAnsi', script: 'Latn' };
  }
  if (inRange(codePoint, 0x0590, 0x05ff) || inRange(codePoint, 0xfb1d, 0xfb4f)) {
    return { slot: 'cs', script: 'Hebr' };
  }
  if (
    inRange(codePoint, 0x0600, 0x06ff) ||
    inRange(codePoint, 0x0750, 0x077f) ||
    inRange(codePoint, 0x0870, 0x089f) ||
    inRange(codePoint, 0x08a0, 0x08ff) ||
    inRange(codePoint, 0xfb50, 0xfdff) ||
    inRange(codePoint, 0xfe70, 0xfeff) ||
    inRange(codePoint, 0x1ee00, 0x1eeff)
  ) {
    return { slot: 'cs', script: 'Arab' };
  }
  if (
    inRange(codePoint, 0x1100, 0x11ff) ||
    inRange(codePoint, 0x2e80, 0x303f) ||
    inRange(codePoint, 0x3040, 0x30ff) ||
    inRange(codePoint, 0x3100, 0x318f) ||
    inRange(codePoint, 0x31f0, 0x31ff) ||
    inRange(codePoint, 0x3400, 0x4dbf) ||
    inRange(codePoint, 0x4e00, 0x9fff) ||
    inRange(codePoint, 0xac00, 0xd7af) ||
    inRange(codePoint, 0xf900, 0xfaff) ||
    inRange(codePoint, 0xff66, 0xff9d) ||
    inRange(codePoint, 0xffa0, 0xffdc) ||
    inRange(codePoint, 0x20000, 0x3134f)
  ) {
    return { slot: 'eastAsia', script: 'Hani' };
  }
  if (inRange(codePoint, 0x0900, 0x097f) || inRange(codePoint, 0xa8e0, 0xa8ff)) {
    return { slot: 'cs', script: 'Deva' };
  }
  if (inRange(codePoint, 0x0980, 0x09ff)) {
    return { slot: 'cs', script: 'Beng' };
  }
  if (inRange(codePoint, 0x0370, 0x03ff) || inRange(codePoint, 0x1f00, 0x1fff)) {
    return { slot: 'hAnsi', script: 'Grek' };
  }
  if (
    inRange(codePoint, 0x0400, 0x052f) ||
    inRange(codePoint, 0x1c80, 0x1c8f) ||
    inRange(codePoint, 0x2de0, 0x2dff) ||
    inRange(codePoint, 0xa640, 0xa69f)
  ) {
    return { slot: 'hAnsi', script: 'Cyrl' };
  }
  if (inRange(codePoint, 0x0e00, 0x0e7f)) {
    return { slot: 'cs', script: 'Thai' };
  }
  if (inRange(codePoint, 0x1780, 0x17ff) || inRange(codePoint, 0x19e0, 0x19ff)) {
    return { slot: 'cs', script: 'Khmr' };
  }
  if (
    inRange(codePoint, 0x0300, 0x036f) ||
    inRange(codePoint, 0x1ab0, 0x1aff) ||
    inRange(codePoint, 0x1dc0, 0x1dff) ||
    inRange(codePoint, 0x20d0, 0x20ff) ||
    inRange(codePoint, 0x2000, 0x206f) ||
    inRange(codePoint, 0xfe20, 0xfe2f) ||
    codePoint <= 0x002f ||
    inRange(codePoint, 0x003a, 0x0040) ||
    inRange(codePoint, 0x005b, 0x0060) ||
    inRange(codePoint, 0x007b, 0x00bf)
  ) {
    return null;
  }
  if (
    codePoint === 0x1680 ||
    inRange(codePoint, 0x2000, 0x2bff) ||
    inRange(codePoint, 0xfe00, 0xfe0f) ||
    inRange(codePoint, 0xff00, 0xff65) ||
    inRange(codePoint, 0xff9e, 0xff9f) ||
    inRange(codePoint, 0xffdd, 0xffff) ||
    inRange(codePoint, 0x1f000, 0x1faff) ||
    inRange(codePoint, 0xe0100, 0xe01ef)
  ) {
    return null;
  }
  if (codePoint <= 0x007f) return { slot: 'ascii', script: 'Latn' };
  if (
    inRange(codePoint, 0x00c0, 0x02af) ||
    inRange(codePoint, 0x1d00, 0x1d7f) ||
    inRange(codePoint, 0x1d80, 0x1dbf) ||
    inRange(codePoint, 0x1e00, 0x1eff) ||
    inRange(codePoint, 0x2c60, 0x2c7f) ||
    inRange(codePoint, 0xa720, 0xa7ff) ||
    inRange(codePoint, 0xab30, 0xab6f)
  ) {
    return { slot: 'hAnsi', script: 'Latn' };
  }
  throw new UnsupportedScriptError(codePoint);
};

/**
 * Per-code-point classification with the inheritance passes applied: Common/inherited
 * characters take the preceding strong item's answer, and leading Common text takes the
 * following one. Shared by full itemization and the slot-only pass below.
 */
function classifiedCodePoints(
  text: string
): { from: number; to: number; classified: Classified }[] {
  const codePoints: { from: number; to: number; classified: Classified }[] = [];
  for (let from = 0; from < text.length; ) {
    const codePoint = text.codePointAt(from)!;
    const to = from + (codePoint > 0xffff ? 2 : 1);
    codePoints.push({ from, to, classified: classify(codePoint) });
    from = to;
  }
  let inherited: Classified = null;
  for (const item of codePoints) {
    if (item.classified) inherited = item.classified;
    else if (inherited) item.classified = inherited;
  }
  inherited = null;
  for (let index = codePoints.length - 1; index >= 0; index -= 1) {
    const item = codePoints[index]!;
    if (item.classified) inherited = item.classified;
    else if (inherited) item.classified = inherited;
  }
  return codePoints;
}

/**
 * Split text into shapeable runs by script, bidi level and font slot.
 *
 * Consumes the bidi levels rather than re-deriving direction, so itemization and reordering agree
 * by construction instead of by two implementations happening to match.
 */
export function itemizeScriptFontSlots(
  text: string,
  paragraphOffset: number,
  embedding: BidiEmbeddingLevels
): readonly ScriptItem[] {
  const codePoints = classifiedCodePoints(text);

  const out: ScriptItem[] = [];
  const commonOnlySlot: FontSlot = codePoints.every(({ from }) => text.codePointAt(from)! <= 0x7f)
    ? 'ascii'
    : 'hAnsi';
  for (const item of codePoints) {
    const bidiLevel = embedding.levels[paragraphOffset + item.from] ?? 0;
    const direction: TextDirection = (bidiLevel & 1) === 1 ? 'rtl' : 'ltr';
    const classified =
      item.classified ??
      ({
        slot: commonOnlySlot,
        script: 'Zyyy',
      } as const);
    const previous = out.at(-1);
    if (
      previous &&
      previous.to === item.from &&
      previous.bidiLevel === bidiLevel &&
      previous.slot === classified.slot &&
      previous.script === classified.script
    ) {
      out[out.length - 1] = { ...previous, to: item.to };
    } else {
      out.push({
        from: item.from,
        to: item.to,
        direction,
        bidiLevel,
        script: classified.script,
        slot: classified.slot,
      });
    }
  }
  return out;
}

/**
 * The style a piece's text is MEASURED AND PAINTED in, given the font slot it carries.
 *
 * This is the measurer-boundary resolution: pieces and spans keep the run's real resolved
 * style — with `fontFamily` and `fontFamilyEastAsia` both intact, so formatting readback
 * and the format painter see the run as authored — and every consumer that turns text into
 * geometry or ink resolves the face through here. The derived object is memoized per
 * (style, family) by {@link withFontFamily}, so measurers amortizing over style identity
 * keep their caches.
 */
export function styleForFontSlot(
  style: ResolvedRunStyle,
  slot: FontSlot | undefined
): ResolvedRunStyle {
  if (slot !== 'eastAsia') return style;
  const family = style.fontFamilyEastAsia;
  return family === null ? style : withFontFamily(style, family);
}

/** An eastAsia-slot run of text inside segment `segment` of the classified sequence. */
export interface SegmentSlotRange {
  readonly segment: number;
  readonly from: number;
  readonly to: number;
}

/** How one code point participates in slot resolution. */
type SlotClass = 'eastAsia' | 'base' | 'common';

/**
 * {@link classify}, projected to the eastAsia-or-not question, never throwing.
 *
 * An unsupported code point answers 'base' — a strong classification confined to that one
 * character, so a single Tamil sign in a CJK piece costs itself the East Asian face and
 * nothing else.
 */
const slotClassOf = (codePoint: number): SlotClass => {
  let classified: Classified;
  try {
    classified = classify(codePoint);
  } catch (error) {
    if (error instanceof UnsupportedScriptError) return 'base';
    throw error;
  }
  if (classified === null) return 'common';
  return classified.slot === 'eastAsia' ? 'eastAsia' : 'base';
};

/** Whether `text` holds only code units below U+0080 — text that can never touch the eastAsia slot. */
const pureAscii = (text: string): boolean => {
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) >= 0x80) return false;
  }
  return true;
};

/**
 * The `[from, to)` UTF-16 ranges that resolve through the `eastAsia` font slot, across a
 * SEQUENCE of text segments classified as one paragraph. Merged and in order; `[]` means
 * everything stays in the base (Latin) slots.
 *
 * One classification over the whole sequence, not one per segment, because Common
 * characters inherit from their strong neighbours and `w:t` boundaries are not script
 * boundaries: a fullwidth comma alone in its own run between two CJK runs is East Asian
 * text. Inheritance follows {@link itemizeScriptFontSlots} — preceding strong item first,
 * following strong item for leading Common text — with one restriction: an ASCII code
 * point NEVER resolves through the eastAsia slot, because ECMA-376 routes ASCII-range
 * characters through `w:ascii` and Word measures the `, ` in `中文, Hello` in the Latin
 * face. Which face a character uses does not depend on its embedding level, so this pass
 * is independent of bidi analysis.
 *
 * Cost discipline: a pure-ASCII segment (`charCodeAt` prescan) contributes its strong
 * class without per-code-point classification, so the pure-Latin paragraphs of a document
 * whose docDefaults author an East Asian face pay two compares per character, not a
 * classifier call.
 */
export function eastAsiaRunsOfSegments(
  segments: readonly string[],
  hintedSegments: readonly boolean[] = []
): readonly SegmentSlotRange[] {
  const out: SegmentSlotRange[] = [];
  const addEastAsia = (segment: number, from: number, to: number): void => {
    const previous = out.at(-1);
    if (previous && previous.segment === segment && previous.to === from) {
      out[out.length - 1] = { segment, from: previous.from, to };
    } else {
      out.push({ segment, from, to });
    }
  };

  /** Strongly classified text seen so far, or null while only Common text has streamed by. */
  let precedingStrong: Exclude<SlotClass, 'common'> | null = null;
  /** Leading Common units waiting for the FOLLOWING strong item; `ascii` blocks eastAsia. */
  const pending: { segment: number; from: number; to: number; ascii: boolean }[] = [];
  const resolvePending = (strong: Exclude<SlotClass, 'common'>): void => {
    for (const unit of pending) {
      if (strong === 'eastAsia' && !unit.ascii) addEastAsia(unit.segment, unit.from, unit.to);
    }
    pending.length = 0;
  };

  for (let segment = 0; segment < segments.length; segment += 1) {
    const text = segments[segment]!;
    if (pureAscii(text)) {
      // Never eastAsia, so only the strong/Common distinction matters: any alphanumeric
      // is a strong Latin item; pure punctuation and whitespace stay transparent.
      if (/[0-9A-Za-z]/.test(text)) {
        resolvePending('base');
        precedingStrong = 'base';
      }
      continue;
    }
    for (let from = 0; from < text.length; ) {
      const codePoint = text.codePointAt(from)!;
      const to = from + (codePoint > 0xffff ? 2 : 1);
      // A hinted symbol takes the East Asian face for itself only. It is not strong text:
      // it neither resolves the Common units before it nor pulls the Common units after it,
      // so the hint on one run never reaches the `©` or NBSP of an unhinted neighbour. The
      // marks that extend its grapheme cluster (a combining accent, an emoji variation
      // selector) do travel with it: a cluster is shaped as one unit or not at all.
      if (hintedSegments[segment] && isEastAsiaHintSymbol(codePoint)) {
        let clusterEnd = to;
        while (clusterEnd < text.length) {
          const next = text.codePointAt(clusterEnd)!;
          if (!isClusterExtender(next)) break;
          clusterEnd += next > 0xffff ? 2 : 1;
        }
        addEastAsia(segment, from, clusterEnd);
        from = clusterEnd;
        continue;
      }
      const slotClass = slotClassOf(codePoint);
      if (slotClass === 'common') {
        if (precedingStrong === null) {
          pending.push({ segment, from, to, ascii: codePoint <= 0x7f });
        } else if (precedingStrong === 'eastAsia' && codePoint > 0x7f) {
          addEastAsia(segment, from, to);
        }
      } else {
        resolvePending(slotClass);
        precedingStrong = slotClass;
        if (slotClass === 'eastAsia') addEastAsia(segment, from, to);
      }
      from = to;
    }
  }
  // A sequence of nothing but Common text has no strong item to inherit from on either
  // side; it stays in the base slots, exactly as it did before slot resolution existed.
  //
  // Leading Common units resolve only once the strong item AFTER them arrives, and a hinted
  // symbol between the two is emitted first, so the list can be out of document order.
  // The consumer slices pieces with a monotonic cursor, so order and merge here.
  if (out.length < 2) return out;
  out.sort((a, b) => a.segment - b.segment || a.from - b.from);
  const merged: { segment: number; from: number; to: number }[] = [out[0]!];
  for (let index = 1; index < out.length; index += 1) {
    const range = out[index]!;
    const previous = merged[merged.length - 1]!;
    if (previous.segment === range.segment && range.from <= previous.to) {
      if (range.to > previous.to) merged[merged.length - 1] = { ...previous, to: range.to };
    } else {
      merged.push(range);
    }
  }
  return merged;
}

/**
 * A code point that extends the grapheme cluster of the base before it: combining marks
 * and variation selectors. Kept deliberately narrow (no ZWJ sequences), because the only
 * job here is to keep a mark on the face of the symbol it decorates.
 */
function isClusterExtender(codePoint: number): boolean {
  return (
    (codePoint >= 0x300 && codePoint <= 0x36f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f) ||
    (codePoint >= 0xe0100 && codePoint <= 0xe01ef)
  );
}
