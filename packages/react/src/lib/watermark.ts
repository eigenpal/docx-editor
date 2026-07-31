/**
 * Watermark — the MS Word "Design → Watermark" feature.
 *
 * In OOXML a watermark is legacy VML stored inside a header part, inside a
 * paragraph run: `<w:pict><v:shape>…</v:shape></w:pict>`. It renders behind
 * the body content on every page of the section. Word supports two kinds:
 *
 * - **Text** — `<v:shape type="#_x0000_t136"><v:textpath string="DRAFT"/>`
 *   with a fill color, font, optional rotation (diagonal vs horizontal) and a
 *   reduced-opacity "semitransparent" look.
 * - **Picture** — `<v:shape><v:imagedata r:id="rIdN"/>` referencing a media
 *   file, scaled, optionally "washed out" (lightened).
 *
 * We model the watermark as a dedicated field on the owning `HeaderFooter`
 * rather than as editable run content, so it stays out of the ProseMirror text
 * flow while still round-tripping through parse → render → serialize.
 */

/**
 * Text watermark (e.g. "CONFIDENTIAL", "DRAFT").
 */
export interface TextWatermark {
  kind: 'text';
  /** The watermark text. */
  text: string;
  /** Font family (e.g. 'Calibri'). */
  font: string;
  /** Fill color as a CSS hex string (e.g. '#C0C0C0'). */
  color: string;
  /** Word's "Semitransparent" checkbox — renders at reduced opacity. */
  semitransparent: boolean;
  /** Diagonal (≈ -45°) or horizontal layout. */
  layout: 'diagonal' | 'horizontal';
  /** Font size in points. When undefined the renderer auto-sizes to the page (Word's "Auto"). */
  fontSize?: number;
}

/**
 * Picture watermark — a scaled, optionally washed-out background image.
 */
export interface PictureWatermark {
  kind: 'picture';
  /** Header-part relationship id of the media (set for images parsed from an existing file). */
  relId?: string;
  /** Package path of the media, e.g. 'word/media/image1.png'. */
  mediaPath?: string;
  /** Raw bytes for an image added in-editor (no rId yet). */
  data?: Uint8Array;
  /** MIME type for `data`. */
  contentType?: string;
  /** Ready-to-use data URL for rendering (resolved from media or `data`). */
  dataUrl?: string;
  /** Scale factor; 1 = 100% / Word's "Auto". */
  scale: number;
  /** Word's "Washout" checkbox — lightens the image so text stays readable. */
  washout: boolean;
  /** Natural width in EMUs (when known). */
  widthEmu?: number;
  /** Natural height in EMUs (when known). */
  heightEmu?: number;
}

/**
 * A document watermark — text or picture.
 */
export type Watermark = TextWatermark | PictureWatermark;

/**
 * Default text-watermark presets shown in the watermark dialog, mirroring the
 * canned phrases MS Word offers. Adapters expose a `watermarkPresets` prop to
 * override this list; both React and Vue fall back to these when unset.
 */
export const DEFAULT_WATERMARK_PRESETS: readonly string[] = [
  'CONFIDENTIAL',
  'DRAFT',
  'DO NOT COPY',
  'SAMPLE',
  'URGENT',
  'ASAP',
];

/**
 * Default on-page extent of a picture watermark, in EMUs (~4.32in / 311.4pt),
 * matching the size MS Word uses. The larger of the image's sides is fit to
 * this; the other side is derived from the aspect ratio.
 */
const PICTURE_WATERMARK_MAX_EMU = 3_954_780; // 311.4pt × 12700 EMU/pt

/**
 * Compute the display dimensions (in EMUs) for a picture watermark from the
 * source image's natural pixel size. Bounds the larger side to a page-sized
 * default and derives the other from the aspect ratio, so the watermark is
 * never distorted (the serializer would otherwise force a square) and never
 * overflows the page. Returns `undefined` for an unusable size (zero/NaN),
 * letting callers fall back to defaults.
 */
export function pictureWatermarkDisplayEmu(
  naturalWidthPx: number,
  naturalHeightPx: number
): { widthEmu: number; heightEmu: number } | undefined {
  if (!(naturalWidthPx > 0) || !(naturalHeightPx > 0)) return undefined;
  const aspect = naturalWidthPx / naturalHeightPx;
  if (aspect >= 1) {
    return {
      widthEmu: PICTURE_WATERMARK_MAX_EMU,
      heightEmu: Math.round(PICTURE_WATERMARK_MAX_EMU / aspect),
    };
  }
  return {
    widthEmu: Math.round(PICTURE_WATERMARK_MAX_EMU * aspect),
    heightEmu: PICTURE_WATERMARK_MAX_EMU,
  };
}
