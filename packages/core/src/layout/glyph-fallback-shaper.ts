import { shapeClusterGlyphFallback } from './glyph-cluster-fallback.ts';
import {
  clusterSelectsColorFace,
  hasColorGlyphTables,
  orderFallbackFacesForCluster,
} from './color-font-tables.ts';
import { orderFacesForScript } from './font-script-support.ts';
import { shapeHyphenGlyphFallback } from './hyphen-glyph-fallback.ts';
import { synthesizeSmallCaps } from './synthetic-small-caps.ts';
// Optional glyph fallback over admitted faces. Measurement and glyph publication share this
// shaper, in the editor and in an export, so fallback changes pagination before a painter runs.
import {
  createShapingEnvironment,
  type ShapeInput,
  type ShapedRun,
  type TextShaper,
  markFacePreservingShaper,
  markMissingGlyphFallbackShaper,
  preservesShapingFace,
} from './shaped-run.ts';
import { FontResolutionError, type FontRequest, type ResolvedFont } from './font-resource.ts';
import type { LayoutShapingOptions } from './shaped-measurer.ts';

/** How a host uses the glyph fallback chain. */
export interface GlyphFallbackOptions {
  /**
   * False leaves small caps to the face's own feature. A painter that draws small caps
   * itself (CSS `font-variant`) cannot draw the synthesized capitals, so its measurer must
   * not measure them.
   */
  readonly synthesizeSmallCaps?: boolean;
  /**
   * Told the characters of a run that no admitted face covers. A host that loads its
   * fallback faces on demand reads them to decide which faces to ask for.
   */
  readonly onUncovered?: (characters: string) => void;
  /**
   * Told that a run selects emoji presentation for a character that its own face draws, while
   * no color face is held. A host that loads its fallback faces on demand loads a color face.
   */
  readonly onEmojiPresentation?: () => void;
  /**
   * True keeps the substitutions that need no fallback face (the hyphen, synthesized small
   * caps) when `requests` is empty. Every renderer then measures them alike, whether or not
   * it holds a fallback face.
   */
  readonly withoutFaces?: boolean;
}

/** The characters of the clusters that `run` could not draw. */
function uncoveredCharacters(text: string, run: ShapedRun): string {
  let out = '';
  for (const cluster of run.clusters) {
    if (run.glyphs.slice(cluster.glyphStart, cluster.glyphEnd).some((glyph) => glyph.id === 0))
      out += text.slice(cluster.textStart, cluster.textEnd);
  }
  return out;
}

/**
 * Whether a cluster of `run` selects emoji presentation ({@link clusterSelectsColorFace})
 * while the run's face has no color glyphs.
 */
function selectsColorFace(input: ShapeInput, run: ShapedRun): boolean {
  if (!/[\uFE0F\u20E3]/u.test(input.text)) return false;
  if (hasColorGlyphTables(input.environment.font)) return false;
  return run.clusters.some((cluster) =>
    clusterSelectsColorFace(
      input.text.slice(cluster.textStart, cluster.textEnd),
      input.text.slice(cluster.textEnd, cluster.textEnd + 2)
    )
  );
}

export function withGlyphFallbacks(
  shaping: LayoutShapingOptions,
  requests: readonly FontRequest[],
  options: GlyphFallbackOptions = {}
): LayoutShapingOptions {
  if (requests.length === 0 && !options.onUncovered && !options.withoutFaces) return shaping;
  if (requests.length > 16) throw new RangeError('At most 16 glyph fallback faces are supported');
  const fonts = requests
    .map((request) => {
      try {
        return shaping.fonts.resolve(request);
      } catch {
        return undefined; // a request the snapshot refuses names no face
      }
    })
    .filter((font): font is ResolvedFont => !!font && !(font instanceof FontResolutionError));
  const smallCaps: typeof synthesizeSmallCaps =
    options.synthesizeSmallCaps === false ? (_shaper, _input, run) => run : synthesizeSmallCaps;
  const compatible: TextShaper = {
    shape(input) {
      return shapeHyphenGlyphFallback(shaping.shaper, input, shaping.shaper.shape(input));
    },
  };
  const report = (input: ShapeInput, run: ShapedRun): ShapedRun => {
    if (options.onUncovered && !/^[\t\n\r\f]*$/.test(input.text)) {
      const characters = uncoveredCharacters(input.text, run);
      if (characters) options.onUncovered(characters);
    }
    return run;
  };
  // A run that selects emoji presentation with no color face held tells a host that loads
  // faces on demand to load one, though its own face draws the characters. The faces are
  // classified once, and only when a run selects emoji presentation.
  let colorFaceHeld: boolean | undefined;
  const holdsColorFace = (): boolean => (colorFaceHeld ??= fonts.some(hasColorGlyphTables));
  const askForColorFace = (input: ShapeInput, run: ShapedRun): void => {
    if (options.onEmojiPresentation && selectsColorFace(input, run) && !holdsColorFace())
      options.onEmojiPresentation();
  };
  // No fallback face resolved: every run keeps its own face. The shaper still substitutes
  // the hyphen and reports what the face lacks, and it stays face preserving, so a measurer
  // reads line metrics from the face alone.
  if (fonts.length === 0) {
    const plain: TextShaper = {
      shape(input) {
        const run = smallCaps(compatible, input, compatible.shape(input));
        askForColorFace(input, run);
        return run.glyphs.some((glyph) => glyph.id === 0) ? report(input, run) : run;
      },
    };
    return {
      ...shaping,
      shaper: preservesShapingFace(shaping.shaper) ? markFacePreservingShaper(plain) : plain,
    };
  }
  // The fallback chain is a function of the input and of `fonts`, which this closure fixes.
  // A caching base shaper hands back one run object for every equal input, so the finished run
  // is kept against it and the chain runs once per distinct text, not once per span. The
  // input is compared as well, so a base shaper that reuses a run for unequal inputs still
  // gets the chain run for each.
  const finished = new WeakMap<
    ShapedRun,
    { readonly input: ShapeInput; readonly run: ShapedRun }
  >();
  const shaper: TextShaper = {
    shape(input) {
      const base = shaping.shaper.shape(input);
      const memo = finished.get(base);
      if (
        memo &&
        memo.input.text === input.text &&
        memo.input.fontSizeHalfPoints === input.fontSizeHalfPoints &&
        memo.input.bidiLevel === input.bidiLevel &&
        memo.input.context?.before === input.context?.before &&
        memo.input.context?.after === input.context?.after &&
        memo.input.environment === input.environment
      )
        return memo.run;
      const run = shapeWithFallbacks(input, shapeHyphenGlyphFallback(shaping.shaper, input, base));
      finished.set(base, { input, run });
      return run;
    },
  };
  const shapeWithFallbacks = (input: ShapeInput, compatibleRun: ShapedRun): ShapedRun => {
    const primary = smallCaps(compatible, input, compatibleRun);
    // Controls have no ink and are not evidence that a text face lacks coverage.
    if (/^[\t\n\r\f]*$/.test(input.text)) return primary;
    const missing = primary.glyphs.some((glyph) => glyph.id === 0);
    // A covered run moves only the clusters that select emoji presentation (U+FE0F, Unicode
    // Technical Standard #51) to a color face; its other letters keep the authored face.
    const emoji = !missing && selectsColorFace(input, primary) && holdsColorFace();
    askForColorFace(input, primary);
    if (!missing && !emoji) return primary;
    // Preserve the authored face around missing symbols. Moving an entire Latin/CJK
    // run to a fallback also changes its supported letters, spaces and line breaks.
    // Hebrew letters in an Arabic face fall back the same way: the face keeps drawing the
    // spaces and punctuation it has, so its line height still applies to the line.
    // Joining scripts retain whole-run fallback so font boundaries do not sever joins.
    // A joining script falls back per cluster too when every missing cluster is a character no
    // join passes through, such as a checkbox symbol after an Arabic word: the face keeps the
    // letters, and only the symbol moves.
    if (
      /^(Latn|Cyrl|Grek|Hebr|Hani|Hira|Kana|Hang|Zyyy|Zinh)$/.test(input.environment.script) ||
      (/^(Arab|Syrc|Nkoo|Mong)$/.test(input.environment.script) &&
        movedClustersAreNonJoining(input.text, primary, emoji))
    ) {
      const mixed = shapeClusterGlyphFallback(compatible, input, primary, fonts, smallCaps);
      if (mixed) return mixed;
    }
    // A covered run never moves whole to a fallback face for its emoji.
    if (!missing) return primary;
    // Color faces go first for emoji presentation and last otherwise, so a dingbat stays a
    // symbol glyph and an emoji-default pictograph gets its color face. Within that, a face
    // that declares the run's script goes first: covering Arabic letters is not shaping
    // them, and a math face that only maps them draws every letter isolated.
    for (const font of orderFacesForScript(
      orderFallbackFacesForCluster(fonts, input.text),
      input.environment.script
    )) {
      if (
        font.hash === input.environment.font.hash &&
        font.faceIndex === input.environment.font.faceIndex
      )
        continue;
      try {
        const next = {
          ...input,
          environment: createShapingEnvironment({ ...input.environment, font }),
        };
        const run = smallCaps(compatible, next, compatible.shape(next));
        if (!run.glyphs.some((glyph) => glyph.id === 0)) return run;
      } catch {
        /* One unsupported fallback face does not hide later admitted faces. */
      }
    }
    // Partial font replacement cannot safely preserve joining-script context yet.
    // Keep uncovered runs explicit so strict exporters refuse them.
    return report(input, primary);
  };
  return {
    ...shaping,
    shaper: preservesShapingFace(shaping.shaper) ? markMissingGlyphFallbackShaper(shaper) : shaper,
  };
}

/** Letters of the joining scripts, the tatweel, and the join controls: what a join passes through. */
const JOINING = /[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Nko}\p{Script=Mongolian}ـ‌‍]/u;

/**
 * Whether every cluster that can move to another face holds no joining character: each
 * cluster the primary face could not draw and, with `emoji`, each cluster that selects
 * emoji presentation.
 */
function movedClustersAreNonJoining(text: string, run: ShapedRun, emoji: boolean): boolean {
  let moved = false;
  for (const cluster of run.clusters) {
    const clusterText = text.slice(cluster.textStart, cluster.textEnd);
    if (
      !run.glyphs.slice(cluster.glyphStart, cluster.glyphEnd).some((glyph) => glyph.id === 0) &&
      !(
        emoji &&
        clusterSelectsColorFace(clusterText, text.slice(cluster.textEnd, cluster.textEnd + 2))
      )
    )
      continue;
    moved = true;
    if (JOINING.test(clusterText)) return false;
  }
  return moved;
}
