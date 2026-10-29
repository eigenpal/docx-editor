// Which lines may compress their inter-word spaces to keep one more word, and how far.
import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import { paragraphAlignment } from './paragraph-alignment.ts';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import type { CjkTypographySettings } from './cjk-typography.ts';

/**
 * How a line may borrow inter-word space to keep the word that overflows it: how much of
 * each space can go, how the shrink is weighed against the stretch the shorter line would
 * take, and whether a final half-width mark may hang beside spaces at their limit.
 */
export interface SpaceShrinkRule {
  /** The fraction of its natural advance each eligible space may give up. */
  readonly limit: number;
  /**
   * How much more a shrunk space costs than a stretched one. The word joins when `cost` times
   * its shrink per space is at most the stretch per space of the line without it. 0 admits
   * every word that fits within `limit`.
   */
  readonly cost: number;
  /**
   * The share of the advance of a final mark that may hang that the cost test counts. Absent,
   * the whole mark counts.
   */
  readonly markCost?: number;
  /**
   * A word whose final half-width mark may hang joins when the spaces fit the text before the
   * mark, and the mark hangs. Otherwise the word joins only when the mark fits inside too.
   */
  readonly hangsMarks: boolean;
  /**
   * Lines at every alignment shrink their spaces, and a line that does fills the measure as a
   * justified line does.
   */
  readonly everyAlignment?: true;
  /**
   * Each space shrinks down to half its face's average character width, the metric of the
   * reverse automatic spacing gap, rather than by `limit`. `limit` applies when that width is
   * unknown.
   */
  readonly halfAverageFloor?: true;
}

/** Justified lines (`w:jc` `both`) in a modern compatibility mode. */
export const JUSTIFIED_SPACE_SHRINK: SpaceShrinkRule = Object.freeze({
  limit: 0.25,
  cost: 2,
  hangsMarks: true,
});

/**
 * Distributed lines (`w:jc` `distribute`) in a modern compatibility mode. A shrunk space
 * costs three stretched ones, and the test counts half the advance of a final mark that may
 * hang: the measured rule that admits every word the probes keep and none they wrap.
 */
export const DISTRIBUTED_SPACE_SHRINK: SpaceShrinkRule = Object.freeze({
  limit: 0.25,
  cost: 3,
  markCost: 0.5,
  hangsMarks: true,
});

/** The kashida and Thai distribution values of `w:jc` in a modern compatibility mode. */
const OTHER_JUSTIFIED_SPACE_SHRINK: SpaceShrinkRule = Object.freeze({
  limit: 0.25,
  cost: 2,
  hangsMarks: false,
});

/**
 * A legacy compatibility mode that compresses punctuation (`w:characterSpacingControl`) in a
 * document whose defaults name an East Asian face: each space shrinks down to half its face's
 * average character width (OS/2 `xAvgCharWidth`), without a cost test, at every alignment. A
 * face whose half-average width is wider than its space, such as Calibri, keeps natural spaces;
 * Times New Roman gives about a fifth, Courier New half. Without a known average width, a space
 * gives up a fifth. `w:balanceSingleByteDoubleByteWidth` turns the rule off.
 */
export const COMPRESSED_LEGACY_SPACE_SHRINK: SpaceShrinkRule = Object.freeze({
  limit: 0.2,
  cost: 0,
  hangsMarks: true,
  everyAlignment: true,
  halfAverageFloor: true,
});

/** The space-shrink rule of a paragraph, or undefined when its lines keep natural spaces. */
export function resolveSpaceShrinkRule(
  compatibilityMode: number | undefined,
  props: readonly OoxmlProperty[],
  settings?: CjkTypographySettings
): SpaceShrinkRule | undefined {
  if (
    settings?.legacyLineEndPunctuation === true &&
    settings.compression !== 'doNotCompress' &&
    settings.sourceEastAsianFont === true
  )
    // `w:balanceSingleByteDoubleByteWidth` keeps natural spaces in a legacy mode.
    return settings.balancedWidths ? undefined : COMPRESSED_LEGACY_SPACE_SHRINK;
  // Modern justification is mode 15 and every newer mode. An absent mode stays legacy.
  if (
    !hasCompatibilityRule(compatibilityMode, 'justifiedSpaceShrink') ||
    paragraphAlignment(props) !== 'both'
  )
    return undefined;
  const jc = props.filter((prop) => prop.localName === 'jc').at(-1)?.attributes?.val;
  return jc === 'both'
    ? JUSTIFIED_SPACE_SHRINK
    : jc === 'distribute'
      ? DISTRIBUTED_SPACE_SHRINK
      : OTHER_JUSTIFIED_SPACE_SHRINK;
}
