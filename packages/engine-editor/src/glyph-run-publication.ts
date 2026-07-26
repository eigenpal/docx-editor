import type { GlyphFont, GlyphRun } from '@docx-editor.dev/core-contract/geometry';
import type { TextItem } from '@docx-editor.dev/engine-layout';
import { halfPointsToPx, twipsToPx } from './semantic-index.ts';

function glyphFont(
  font: TextItem['shapingEnvironment']['font'] | TextItem['shapedRun']['fontSpans'][number]['font']
): GlyphFont {
  const request = Object.freeze({
    family: font.request.family,
    weight: font.request.weight,
    style: font.request.style,
  });
  return Object.freeze({
    id: font.id,
    identity: font.identity,
    family: font.family,
    request,
    hash: font.hash,
    faceIndex: font.faceIndex,
    byteLength: font.byteLength,
    substitution: font.substitution
      ? Object.freeze({
          requested: Object.freeze({ ...font.substitution.requested }),
          resolved: Object.freeze({ ...font.substitution.resolved }),
        })
      : null,
  });
}

/** Every non-geometric input that can change a completed shaped text item. */
export function shapedTextItemFingerprint(item: TextItem): string {
  return item.shapingFingerprint;
}

/** Publish one byte-free, serializable and immutable contract glyph run. */
export function publishGlyphRun(item: TextItem, box: GlyphRun['box']): GlyphRun {
  const primaryFont = glyphFont(item.shapingEnvironment.font);
  const fontSpans = Object.freeze(
    item.shapedRun.fontSpans.map((span) =>
      Object.freeze({
        glyphFrom: span.glyphStart,
        glyphTo: span.glyphEnd,
        font: glyphFont(span.font),
        fallbackIndex: span.fallbackIndex,
      })
    )
  );
  const shaping = Object.freeze({
    ...item.shapingEnvironment,
    font: primaryFont,
    fallbackOrder: Object.freeze(item.shapingEnvironment.fallbackOrder.map(glyphFont)),
  });
  return Object.freeze({
    text: item.text,
    box: Object.freeze(box),
    font: primaryFont,
    fontFamily: primaryFont.family,
    fontSizeHalfPoints: item.fontSizeHalfPoints,
    fontSizePx: halfPointsToPx(item.fontSizeHalfPoints),
    fontWeight: primaryFont.request.weight,
    fontStyle: primaryFont.request.style,
    color:
      item.color.toLowerCase() === 'auto'
        ? Object.freeze({ kind: 'auto' as const })
        : Object.freeze({ kind: 'hex' as const, value: item.color }),
    direction: item.shapedRun.direction,
    bidiLevel: item.shapedRun.bidiLevel,
    glyphs: item.shapedRun.glyphs,
    clusters: item.glyphClusters,
    fontSpans,
    verticalMetrics: Object.freeze({
      ascent: item.shapedRun.metrics.ascent,
      descent: item.shapedRun.metrics.descent,
      lineGap: item.shapedRun.metrics.lineGap,
      baseline: twipsToPx(item.baseline),
    }),
    shaping,
    producer: Object.freeze({ ...item.producer }),
    bold: item.bold,
    italic: item.italic,
  });
}
