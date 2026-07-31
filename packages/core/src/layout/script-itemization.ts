import type { BidiEmbeddingLevels } from './bidi.ts';
import type { TextDirection } from './shaped-run.ts';

export type FontSlot = 'ascii' | 'hAnsi' | 'eastAsia' | 'cs';

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

export function itemizeScriptFontSlots(
  text: string,
  paragraphOffset: number,
  embedding: BidiEmbeddingLevels
): readonly ScriptItem[] {
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
