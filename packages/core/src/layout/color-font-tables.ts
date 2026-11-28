import type { ResolvedFont } from './font-resource.ts';

const colorFaces = new WeakMap<ResolvedFont, boolean>();

/**
 * Whether a resolved face carries color glyphs: a `COLR` layer table, or `CBDT`/`sbix`
 * bitmap strikes. Read from the sfnt table directory only, so an eight-megabyte face costs
 * a few dozen bytes to classify, and remembered per face.
 */
export function hasColorGlyphTables(font: ResolvedFont): boolean {
  let known = colorFaces.get(font);
  if (known === undefined) {
    known = directoryHasColorTable(font.bytes, font.faceIndex);
    colorFaces.set(font, known);
  }
  return known;
}

const TAGS = new Set(['COLR', 'CBDT', 'sbix']);
const MAX_TABLES = 512;

function directoryHasColorTable(bytes: Uint8Array, faceIndex: number): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12) return false;
  let offset = 0;
  // A collection lists each face's offset table after its own 12-byte header.
  if (tag(bytes, 0) === 'ttcf') {
    const faces = view.getUint32(8);
    if (faceIndex < 0 || faceIndex >= faces || 12 + 4 * faceIndex + 4 > bytes.byteLength)
      return false;
    offset = view.getUint32(12 + 4 * faceIndex);
    if (offset + 12 > bytes.byteLength) return false;
  }
  const tables = Math.min(view.getUint16(offset + 4), MAX_TABLES);
  for (let index = 0; index < tables; index++) {
    const entry = offset + 12 + index * 16;
    if (entry + 4 > bytes.byteLength) return false;
    if (TAGS.has(tag(bytes, entry))) return true;
  }
  return false;
}

function tag(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
}

const EMOJI_PRESENTATION = /\p{Emoji_Presentation}|️/u;

/**
 * Whether a cluster asks for emoji presentation: a character whose default presentation is
 * emoji, or any character followed by the emoji variation selector U+FE0F.
 *
 * A cluster that its run's face cannot draw tries the color faces first when it asks for
 * emoji presentation, so a text-presentation dingbat such as a check mark stays a monochrome
 * glyph while the same character with U+FE0F, and every emoji-default pictograph, gets the
 * color face.
 */
export function prefersEmojiPresentation(text: string): boolean {
  return EMOJI_PRESENTATION.test(text);
}

/**
 * Whether one cluster, followed by the text `after` it, asks for emoji presentation (Unicode
 * Technical Standard #51): a variation selector decides first, U+FE0F for emoji and U+FE0E
 * for text; without one, the character's default presentation decides. A digit, `#` or `*`
 * is an emoji only as the base of a keycap sequence, which ends in U+20E3.
 */
export function clusterAsksForEmoji(text: string, after = ''): boolean {
  // A selector alone belongs to the cluster before it, which it already decided.
  if (/^[\uFE0E\uFE0F]+$/u.test(text)) return false;
  if (/^[0-9#*]$/u.test(text)) return /^\uFE0F?\u20E3/u.test(after);
  const sequence = /^[\uFE0E\uFE0F]/u.test(after) ? text + after[0] : text;
  if (sequence.includes('\uFE0E')) return false;
  return EMOJI_PRESENTATION.test(sequence);
}

/**
 * Whether a cluster that the run's own face draws asks for a color face instead: the emoji
 * variation selector U+FE0F after a character above U+00FF, or a keycap sequence with it. A
 * character whose default presentation is emoji, and a Latin-1 sign such as `©` with
 * U+FE0F, keep the run face's glyph.
 */
export function clusterSelectsColorFace(text: string, after = ''): boolean {
  if (/^[\uFE0E\uFE0F]+$/u.test(text)) return false;
  if (/^[0-9#*]$/u.test(text)) return /^\uFE0F\u20E3/u.test(after);
  const sequence = /^[\uFE0E\uFE0F]/u.test(after) ? text + after[0] : text;
  return (
    sequence.includes('\uFE0F') && !sequence.includes('\uFE0E') && (text.codePointAt(0) ?? 0) > 0xff
  );
}

/**
 * Whether a cluster continues the emoji sequence before it: a zero width joiner, the
 * pictograph after one, a keycap, a skin tone modifier, or a tag (Unicode Technical
 * Standard #51). Such a cluster belongs in the same face as the sequence it continues.
 */
export function continuesEmojiSequence(text: string, before: string): boolean {
  if (before.endsWith('\u200D')) return /^\p{Extended_Pictographic}/u.test(text);
  return /^[\u200D\u20E3\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]/u.test(text);
}

/**
 * The fallback faces in the order this cluster should try them: color faces first for
 * emoji presentation, last otherwise. The relative order within each group is kept.
 */
export function orderFallbackFacesForCluster(
  fonts: readonly ResolvedFont[],
  text: string,
  emoji = prefersEmojiPresentation(text)
): readonly ResolvedFont[] {
  if (fonts.length < 2) return fonts;
  const color = fonts.filter(hasColorGlyphTables);
  if (color.length === 0 || color.length === fonts.length) return fonts;
  const mono = fonts.filter((font) => !color.includes(font));
  return emoji ? [...color, ...mono] : [...mono, ...color];
}
