// The vertical extent that an equation claims on its line.
import type { EquationGeometry } from './equation-layout.ts';
import { equationInk, isInvisibleEquationText } from './equation-ink.ts';
import { box, shifted } from './equation-scripts.ts';
import type { TextMeasurer } from './semantic-records.ts';

/** The space kept above the ink of the math, in ems of the first atom size (`MathLeading`). */
const MATH_LEADING = 300 / 2048;

/** A font box on the equation baseline: its height and the baseline from its top. */
export interface EquationTextBand {
  readonly height: number;
  readonly baseline: number;
}

/** One part that claims height, with its baseline offset below the equation baseline. */
interface Claimant {
  readonly node: EquationGeometry;
  readonly offset: number;
}

/**
 * Collect the parts that claim height. Rows, scripts, and fractions open into their parts, so
 * every script and fraction part claims for itself. Other structures claim as one part.
 */
function collectClaimants(
  node: EquationGeometry,
  top: number,
  baseline: number,
  display: boolean,
  claimants: Claimant[]
): void {
  const parts =
    node.kind === 'row'
      ? node.items
      : node.kind === 'script'
        ? [node.base, node.subscript, node.superscript]
        : node.kind === 'fraction' && !display
          ? [node.numerator, node.denominator]
          : null;
  if (!parts) {
    claimants.push({ node, offset: top + node.baseline - baseline });
    return;
  }
  for (const part of parts)
    if (part) collectClaimants(part, top + part.box.y, baseline, display, claimants);
}

/** `node` with a new `baseline` and `height`: its parts move down by the change in baseline. */
function withExtent(node: EquationGeometry, baseline: number, height: number): EquationGeometry {
  const dy = baseline - node.baseline;
  const move = <T extends EquationGeometry>(part: T): T =>
    shifted(part, part.box.x, part.box.y + dy);
  const extent = { box: box(node.box.x, node.box.y, node.box.width, height), baseline };
  switch (node.kind) {
    case 'row':
      return Object.freeze({ ...node, ...extent, items: Object.freeze(node.items.map(move)) });
    case 'script':
      return Object.freeze({
        ...node,
        ...extent,
        base: move(node.base),
        ...(node.subscript ? { subscript: move(node.subscript) } : {}),
        ...(node.superscript ? { superscript: move(node.superscript) } : {}),
      });
    case 'fraction':
      return Object.freeze({
        ...node,
        ...extent,
        numerator: move(node.numerator),
        denominator: move(node.denominator),
        bar: box(node.bar.x, node.bar.y + dy, node.bar.width, node.bar.height),
      });
    default:
      // Other parts claim their own boxes, so their extent never changes.
      return node;
  }
}

/** The font box of each equation whose extent this module fitted; see {@link equationTextBand}. */
const textBands = new WeakMap<EquationGeometry, EquationTextBand>();

/**
 * The text height that an equation gives its line for multiple line spacing: the font box of
 * its first atom, or of the structure size when a structure opens the equation. Undefined for
 * geometry that {@link fitEquationLineExtent} did not return.
 */
export function equationTextBand(geometry: EquationGeometry): EquationTextBand | undefined {
  return textBands.get(geometry);
}

/**
 * Fit the outer node of an equation to the extent that it claims on its line.
 *
 * The equation claims the font box `band` on its baseline: the box of its first text atom, or
 * of the structure size when a structure opens it. Every other part claims only its glyph
 * ink, plus the math leading above the ink, and never more than its own font box. The leading
 * takes the smaller of `leadingSizePt` and the part's own size. Script and fraction parts
 * claim for themselves at their own positions, so a large script raises the line by its ink,
 * not by its font box. A fraction of a `display` equation keeps its padded box. Text that draws nothing,
 * such as a space, claims no height. Other structures claim their boxes. A text part without
 * measured ink keeps its font box.
 *
 * The result is `root` itself when the extent does not change.
 */
export function fitEquationLineExtent(
  root: EquationGeometry,
  band: EquationTextBand,
  leadingSizePt: number,
  measurer: TextMeasurer,
  display = false
): EquationGeometry {
  const claimants: Claimant[] = [];
  collectClaimants(root, 0, root.baseline, display, claimants);
  const first = claimants[0];
  if (!first) return root;
  // A first text atom is the band itself, on the baseline.
  const opensWithText = first.node.kind === 'text' && first.offset === 0;
  let ascent = band.baseline;
  let descent = band.height - band.baseline;
  for (const [index, { node, offset }] of claimants.entries()) {
    if (index === 0 && opensWithText) continue;
    // Later text that draws nothing, such as a larger space, claims no height.
    if (node.kind === 'text' && isInvisibleEquationText(node.text)) continue;
    let nodeAscent = node.baseline;
    let nodeDescent = node.box.height - node.baseline;
    // Ink can only lower a claim, so read it only for a box that reaches past the extent.
    if (node.kind === 'text' && (nodeAscent - offset > ascent || nodeDescent + offset > descent)) {
      const ink = equationInk(node, measurer);
      if (!ink.fromFontBox) {
        // The leading takes the smaller of the first atom size and the part's own size.
        const leading = MATH_LEADING * Math.min(leadingSizePt, node.fontSizePt);
        nodeAscent = Math.min(nodeAscent, ink.ascent + leading);
        nodeDescent = Math.min(nodeDescent, ink.descent);
      }
    }
    ascent = Math.max(ascent, nodeAscent - offset);
    descent = Math.max(descent, nodeDescent + offset);
  }
  const rootDescent = root.box.height - root.baseline;
  const fitted =
    ascent === root.baseline && descent === rootDescent
      ? root
      : withExtent(root, ascent, ascent + descent);
  textBands.set(fitted, band);
  return fitted;
}
