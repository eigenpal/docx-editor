// The Watermark dialog's framework-neutral model, byte-identical in both adapters.
//
// The draft is plain data. `seedWatermarkFields` reads it from the document's current
// watermark, and `watermarkFromFields` turns it back into the ONE `setWatermark` value the
// dialog sends, so both adapters agree on every default and every conversion.

import type { Watermark, WatermarkState } from '@docx-editor.dev/core/contracts/editor';

/** How a text watermark crosses the page. @public */
export type WatermarkDialogLayout = NonNullable<WatermarkState['layout']>;

/** Which watermark the dialog writes. @public */
export type WatermarkDialogKind = 'none' | 'picture' | 'text';

/** The Watermark dialog draft. Transparency is 0 to 1, color is `RRGGBB`. @public */
export interface WatermarkDialogFields {
  kind: WatermarkDialogKind;
  /** The picture bytes, or null when no picture is chosen. */
  imageData: Uint8Array | null;
  /** The chosen file name. Null for no picture or for the document's current picture. */
  imageName: string | null;
  /** A factor of the picture's natural size. Null is Auto. */
  scale: number | null;
  washout: boolean;
  text: string;
  fontFamily: string;
  /** Points. Null is Auto. */
  fontSizePt: number | null;
  bold: boolean;
  italic: boolean;
  transparency: number;
  color: string;
  layout: WatermarkDialogLayout;
}

/** The text choices the dialog offers when the host passes no `presets`. @public */
export const DEFAULT_WATERMARK_PRESETS: readonly string[] = [
  'ASAP',
  'CONFIDENTIAL',
  'COPY',
  'DO NOT COPY',
  'DRAFT',
  'ORIGINAL',
  'PERSONAL',
  'SAMPLE',
  'TOP SECRET',
  'URGENT',
];

/** Picture scale choices. Null is Auto. */
export const WATERMARK_SCALES: readonly (number | null)[] = [null, 0.5, 1, 1.5, 2, 5];

/** Text size choices in points. Null is Auto. */
export const WATERMARK_SIZES: readonly (number | null)[] = [
  null,
  36,
  40,
  44,
  48,
  54,
  60,
  66,
  72,
  80,
  90,
  96,
  105,
  120,
  144,
];

/** File types the picture chooser accepts. */
export const WATERMARK_IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/bmp,image/webp';

export const DEFAULT_WATERMARK_FIELDS: Readonly<WatermarkDialogFields> = {
  kind: 'none',
  imageData: null,
  imageName: null,
  scale: null,
  washout: true,
  text: 'DRAFT',
  fontFamily: 'Calibri',
  fontSizePt: null,
  bold: false,
  italic: false,
  transparency: 0.5,
  color: 'C0C0C0',
  layout: 'diagonal',
};

const HEX = /^[0-9A-Fa-f]{6}$/;

/** The draft for the document's current watermark. `full` carries the picture bytes. */
export function seedWatermarkFields(
  state: WatermarkState | null,
  full: Watermark | null
): WatermarkDialogFields {
  const base: WatermarkDialogFields = { ...DEFAULT_WATERMARK_FIELDS };
  if (!state) return base;
  if (state.kind === 'image') {
    return {
      ...base,
      kind: full?.imageData ? 'picture' : 'none',
      imageData: full?.imageData ?? null,
      scale: full?.scale ?? null,
      washout: state.washout ?? full?.washout ?? true,
    };
  }
  return {
    ...base,
    kind: 'text',
    text: state.text ?? base.text,
    fontFamily: state.fontFamily ?? base.fontFamily,
    fontSizePt: state.fontSizePt ?? null,
    bold: state.bold ?? false,
    italic: state.italic ?? false,
    transparency: state.transparency ?? base.transparency,
    color: state.color && HEX.test(state.color) ? state.color.toUpperCase() : base.color,
    layout: state.layout ?? base.layout,
  };
}

/**
 * The `setWatermark` value for a draft. Null removes the watermark. Undefined means the
 * draft cannot be applied yet: a picture without bytes, or empty text.
 */
export function watermarkFromFields(fields: WatermarkDialogFields): Watermark | null | undefined {
  if (fields.kind === 'none') return null;
  if (fields.kind === 'picture') {
    if (!fields.imageData) return undefined;
    return { imageData: fields.imageData, scale: fields.scale, washout: fields.washout };
  }
  if (fields.text.trim() === '') return undefined;
  return {
    text: fields.text,
    fontFamily: fields.fontFamily,
    fontSizePt: fields.fontSizePt,
    bold: fields.bold,
    italic: fields.italic,
    color: fields.color,
    transparency: fields.transparency,
    layout: fields.layout,
  };
}

/** `#rrggbb` for a color input. */
export const colorInputValue = (color: string): string =>
  `#${HEX.test(color) ? color.toLowerCase() : 'c0c0c0'}`;

/** `RRGGBB` from a color input value, or null when it is not a six-digit color. */
export function colorFromInput(value: string): string | null {
  const hex = value.startsWith('#') ? value.slice(1) : value;
  return HEX.test(hex) ? hex.toUpperCase() : null;
}

/** Whole percent, 0 to 100, for a 0 to 1 transparency. */
export const transparencyPercent = (transparency: number): number =>
  Math.round(Math.min(1, Math.max(0, transparency)) * 100);

/** 0 to 1 from a percent input. Non-numbers keep the previous value. */
export function transparencyFromPercent(value: string, previous: number): number {
  const parsed = Number(value);
  if (value.trim() === '' || !Number.isFinite(parsed)) return previous;
  return Math.min(100, Math.max(0, Math.round(parsed))) / 100;
}

/** Whether two `getWatermark()` reads describe the same watermark. */
export function watermarkStateEqual(a: WatermarkState | null, b: WatermarkState | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.kind === b.kind &&
    a.text === b.text &&
    a.fontFamily === b.fontFamily &&
    a.fontSizePt === b.fontSizePt &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.color === b.color &&
    a.transparency === b.transparency &&
    a.layout === b.layout &&
    a.washout === b.washout
  );
}

/**
 * The draft an Apply is compared with, or null when every Apply must write. A document
 * watermark the dialog cannot show (a picture without readable bytes) seeds as No
 * watermark, and Apply on that draft must still remove it.
 */
export function watermarkBaseline(
  state: WatermarkState | null,
  seeded: WatermarkDialogFields
): WatermarkDialogFields | null {
  return state !== null && seeded.kind === 'none' ? null : seeded;
}

/**
 * Whether two drafts write the same watermark. Only the fields of the chosen kind count,
 * and picture bytes compare by identity, so a newly chosen file is always a change.
 */
export function watermarkFieldsEqual(a: WatermarkDialogFields, b: WatermarkDialogFields): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'none') return true;
  if (a.kind === 'picture')
    return a.imageData === b.imageData && a.scale === b.scale && a.washout === b.washout;
  return (
    a.text === b.text &&
    a.fontFamily === b.fontFamily &&
    a.fontSizePt === b.fontSizePt &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.color.toUpperCase() === b.color.toUpperCase() &&
    a.transparency === b.transparency &&
    a.layout === b.layout
  );
}

/** The preset select's value for a text: the preset itself, or `''` for Custom. */
export const watermarkPresetValue = (text: string, presets: readonly string[]): string =>
  presets.includes(text) ? text : '';

/** The preview page in SVG user units: a portrait page in the 8.5 by 11 ratio. */
export const WATERMARK_PREVIEW_PAGE = { width: 85, height: 110 } as const;

/** Placeholder body lines on the preview page, as `[y, width]` in SVG user units. */
export const WATERMARK_PREVIEW_LINES: readonly (readonly [number, number])[] = [
  [12, 40],
  [20, 65],
  [26, 65],
  [32, 58],
  [40, 65],
  [46, 65],
  [52, 40],
  [60, 65],
  [66, 62],
  [72, 65],
  [78, 30],
  [86, 65],
  [92, 50],
];

/**
 * CSS filter for a washed-out picture: brightness +70% and contrast -70% as one linear
 * transfer per channel, `out = 0.3 * in + 0.805`, which keeps white at white. CSS
 * `contrast(c) brightness(b)` is `b * (c * in + (1 - c) / 2)`, so `b = 0.3 + 2 * 0.805`
 * and `c = 0.3 / b`.
 */
export const WATERMARK_WASHOUT_FILTER = 'contrast(0.157068) brightness(1.91)';

/** What the preview draws for a text draft, in SVG user units of the preview page. */
export interface WatermarkPreviewText {
  readonly text: string;
  readonly fontFamily: string;
  readonly fontSize: number;
  /**
   * The width the text is stretched or squeezed to, or null when short text reaches the
   * size cap and keeps its natural width. Stretching it would distort its glyphs.
   */
  readonly length: number | null;
  readonly fontWeight: 'bold' | 'normal';
  readonly fontStyle: 'italic' | 'normal';
  /** `#RRGGBB`. */
  readonly fill: string;
  readonly opacity: number;
  /** Degrees; negative turns counterclockwise. */
  readonly rotation: number;
}

/**
 * The preview geometry for a text draft, or null when the draft is not a text watermark
 * or its text is blank. The text fits the page width, or the page diagonal when diagonal.
 */
/** The largest preview font size, so short text keeps the shape of a page watermark. */
const PREVIEW_MAX_FONT_SIZE = 36;

export function watermarkPreviewText(fields: WatermarkDialogFields): WatermarkPreviewText | null {
  if (fields.kind !== 'text') return null;
  const text = fields.text.trim();
  if (text === '') return null;
  const { width } = WATERMARK_PREVIEW_PAGE;
  const diagonal = fields.layout === 'diagonal';
  // A 45 degree line through the page center meets the side edges first.
  const length = diagonal ? width * Math.SQRT2 * 0.85 : width * 0.78;
  // About 0.6 em per character, so the stretch to `length` stays close to the real shape.
  const fitted = length / (Math.min(text.length, 256) * 0.6);
  const fontSize = Math.min(PREVIEW_MAX_FONT_SIZE, Math.max(3, fitted));
  return {
    text,
    // A family the browser lacks falls back to sans-serif, the shape of the default fonts,
    // not to the browser's serif default. Quotes and backslashes cannot end the name.
    fontFamily: `"${fields.fontFamily.replace(/["\\]/g, '')}", sans-serif`,
    fontSize: Math.round(fontSize * 100) / 100,
    length: fitted > PREVIEW_MAX_FONT_SIZE ? null : Math.round(length * 100) / 100,
    fontWeight: fields.bold ? 'bold' : 'normal',
    fontStyle: fields.italic ? 'italic' : 'normal',
    fill: `#${HEX.test(fields.color) ? fields.color.toUpperCase() : 'C0C0C0'}`,
    opacity: Math.round((1 - Math.min(1, Math.max(0, fields.transparency))) * 100) / 100,
    rotation: diagonal ? -45 : 0,
  };
}
