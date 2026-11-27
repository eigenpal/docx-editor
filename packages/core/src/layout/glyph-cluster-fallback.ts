// Bounded last-resort composition when no admitted face covers an entire run.
import type { ResolvedFont } from './font-resource.ts';
import {
  createShapedRun,
  createShapingEnvironment,
  fixedPoint,
  type ShapeInput,
  type ShapedRun,
  type ShapedGlyph,
  type ShapedCluster,
  type ShapedFontSpan,
  type TextShaper,
} from './shaped-run.ts';
import { synthesizeSmallCaps } from './synthetic-small-caps.ts';
import {
  clusterAsksForEmoji,
  clusterSelectsColorFace,
  continuesEmojiSequence,
  hasColorGlyphTables,
  orderFallbackFacesForCluster,
} from './color-font-tables.ts';

/** Keep fragmented fallback work bounded independently of the original shaping limit. */
const MAX_FALLBACK_CLUSTERS = 2048;
/**
 * The longest emoji sequence, in UTF-16 code units, kept whole in one color face. A Unicode
 * emoji sequence is a few code points; a longer chain of joiners is shaped in pieces, so
 * each continuation never shapes more than this again.
 */
const MAX_EMOJI_SEQUENCE = 64;

export function shapeClusterGlyphFallback(
  shaper: TextShaper,
  input: ShapeInput,
  primary: ShapedRun,
  fonts: readonly ResolvedFont[],
  smallCaps: typeof synthesizeSmallCaps = synthesizeSmallCaps
): ShapedRun | null {
  if (!primary.clusters.length || primary.clusters.length > MAX_FALLBACK_CLUSTERS) return null;
  const shape = (font: ResolvedFont, text: string) => {
    // A group is a slice of the run, so the run's context does not border it. Groups shape
    // without context; joining scripts never take this path.
    const { context: _context, ...plain } = input;
    const next = {
      ...plain,
      text,
      environment: createShapingEnvironment({ ...input.environment, font }),
    };
    return smallCaps(shaper, next, shaper.shape(next));
  };
  const groups: { start: number; end: number; font: ResolvedFont }[] = [];
  const selected = new Map<string, ResolvedFont | null>();
  // A cluster that the primary face covers but that selects emoji presentation moves to a
  // color face, when the primary face has no color glyphs and a color face draws it.
  const colorFaces = hasColorGlyphTables(input.environment.font)
    ? []
    : fonts.filter(hasColorGlyphTables);
  // Where the emoji sequence that the last group ends with starts; -1 when it ends with none.
  let sequenceStart = -1;
  for (const cluster of [...primary.clusters].sort((a, b) => a.textStart - b.textStart)) {
    let font = input.environment.font;
    const text = input.text.slice(cluster.textStart, cluster.textEnd);
    // A variation selector belongs to the character before it. The primary shaping puts it
    // in a cluster of its own, so it is folded into the previous group, whose face then
    // shapes the pair together and can honour the emoji or text presentation it asks for.
    const previousGroup = groups.at(-1);
    if (/^[\uFE0E\uFE0F]$/.test(text) && previousGroup && previousGroup.end === cluster.textStart) {
      previousGroup.end = cluster.textEnd;
      continue;
    }
    // An emoji sequence stays in the color face of its first cluster, when that face draws
    // the whole sequence, so the face forms the sequence's own glyph.
    if (
      previousGroup &&
      sequenceStart >= 0 &&
      previousGroup.end === cluster.textStart &&
      cluster.textEnd - sequenceStart <= MAX_EMOJI_SEQUENCE &&
      continuesEmojiSequence(text, input.text.slice(sequenceStart, cluster.textStart))
    ) {
      const sequence = input.text.slice(sequenceStart, cluster.textEnd);
      let drawn = false;
      try {
        drawn = !shape(previousGroup.font, sequence).glyphs.some((glyph) => glyph.id === 0);
      } catch {
        drawn = false;
      }
      if (drawn) {
        previousGroup.end = cluster.textEnd;
        continue;
      }
    }
    // A space between Hebrew words that fell back stays with them, so the words keep the
    // fallback face's line height; punctuation still takes the authored face. A color face
    // draws emoji, not the words around them, so a space after an emoji keeps the run face.
    if (
      input.environment.script === 'Hebr' &&
      /^\s+$/u.test(text) &&
      previousGroup &&
      previousGroup.font !== input.environment.font &&
      !hasColorGlyphTables(previousGroup.font) &&
      previousGroup.end === cluster.textStart
    ) {
      previousGroup.end = cluster.textEnd;
      continue;
    }
    // The selector that follows decides the presentation, so it takes part in the order and
    // in the face this cluster keeps: `❤` and `❤️` can take different faces.
    const after = input.text.slice(cluster.textEnd, cluster.textEnd + 2);
    const selector = /^[\uFE0E\uFE0F]/u.test(after) ? after[0]! : '';
    const missing = primary.glyphs
      .slice(cluster.glyphStart, cluster.glyphEnd)
      .some((glyph) => glyph.id === 0);
    const emoji = !missing && colorFaces.length > 0 && clusterSelectsColorFace(text, after);
    if (missing || emoji) {
      const key = text + selector;
      const sample = missing ? text : key;
      const found = selected.has(key)
        ? selected.get(key)
        : ((missing
            ? orderFallbackFacesForCluster(fonts, text, clusterAsksForEmoji(text, after))
            : colorFaces
          ).find((candidate) => {
            try {
              return !shape(candidate, sample).glyphs.some((glyph) => glyph.id === 0);
            } catch {
              return false;
            }
          }) ?? null);
      selected.set(key, found ?? null);
      // A missing cluster that no face draws leaves the run uncovered; an emoji cluster that
      // no color face draws keeps the primary face's glyph.
      if (found) font = found;
      else if (missing) return null;
    }
    sequenceStart =
      font !== input.environment.font && hasColorGlyphTables(font) ? cluster.textStart : -1;
    const previous = groups.at(-1);
    if (previous && previous.font === font && previous.end === cluster.textStart)
      previous.end = cluster.textEnd;
    else groups.push({ start: cluster.textStart, end: cluster.textEnd, font });
  }
  const glyphs: ShapedGlyph[] = [],
    clusters: ShapedCluster[] = [],
    fontSpans: ShapedFontSpan[] = [],
    exactAdvancesX: number[] = [];
  // Advances are per glyph, so composition just concatenates them in glyph order. One group
  // that cannot state them drops the whole array, and paint falls back to the rounded origins.
  let exact = true;
  let penX = 0,
    penY = 0,
    ascent = 0,
    descent = 0,
    lineGap = 0;
  for (const group of input.environment.direction === 'rtl' ? groups.reverse() : groups) {
    const run = shape(group.font, input.text.slice(group.start, group.end));
    if (run.glyphs.some((glyph) => glyph.id === 0)) return null;
    const first = glyphs.length,
      fontSpan = fontSpans.length;
    for (const glyph of run.glyphs)
      glyphs.push({
        ...glyph,
        cluster: group.start + glyph.cluster,
        originX: fixedPoint(penX + glyph.originX),
        originY: fixedPoint(penY + glyph.originY),
      });
    if (run.exactAdvancesX === undefined) exact = false;
    else for (const advance of run.exactAdvancesX) exactAdvancesX.push(advance);
    for (const cluster of run.clusters)
      clusters.push({
        ...cluster,
        textStart: group.start + cluster.textStart,
        textEnd: group.start + cluster.textEnd,
        glyphStart: first + cluster.glyphStart,
        glyphEnd: first + cluster.glyphEnd,
        fontSpan,
      });
    if (run.glyphs.length)
      fontSpans.push({
        font: group.font,
        glyphStart: first,
        glyphEnd: glyphs.length,
        fallbackIndex: group.font === input.environment.font ? null : fonts.indexOf(group.font),
      });
    penX += run.glyphs.reduce((sum, glyph) => sum + glyph.advanceX, 0);
    penY += run.glyphs.reduce((sum, glyph) => sum + glyph.advanceY, 0);
    ascent = Math.max(ascent, run.metrics.ascent);
    descent = Math.max(descent, run.metrics.descent);
    lineGap = Math.max(lineGap, run.metrics.lineGap);
  }
  return createShapedRun(
    {
      ...primary,
      glyphs,
      clusters,
      fontSpans,
      exactAdvancesX: exact && exactAdvancesX.length === glyphs.length ? exactAdvancesX : undefined,
      metrics: {
        ascent: fixedPoint(ascent),
        descent: fixedPoint(descent),
        lineGap: fixedPoint(lineGap),
      },
    },
    { ...input.environment, fallbackOrder: fonts }
  );
}
