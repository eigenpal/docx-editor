// Ink extents of equation geometry. Script and bar placement keep clearances between drawn
// glyphs, not between font boxes, because a font box reaches far above and below its glyphs.
import type { EquationGeometry } from './equation-layout.ts';
import type { LayoutBox, TextMeasurer } from './semantic-records.ts';

/** Distances, in points, from a geometry's baseline to its highest and lowest ink. */
export interface EquationInk {
  /** Distance above the baseline. Negative when all ink is below the baseline. */
  readonly ascent: number;
  /** Distance below the baseline. Negative when all ink is above the baseline. */
  readonly descent: number;
}

function children(node: EquationGeometry): readonly EquationGeometry[] {
  switch (node.kind) {
    case 'text':
    case 'fallback':
      return [];
    case 'row':
      return node.items;
    case 'fraction':
      return [node.numerator, node.denominator];
    case 'radical':
      return node.degree ? [node.sign, node.radicand, node.degree] : [node.sign, node.radicand];
    case 'bar':
      return [node.body];
    case 'script':
      return [node.base, node.subscript, node.superscript].filter(
        (child): child is EquationGeometry => child !== undefined
      );
    case 'nary':
      return [node.operator, node.body, node.lowerLimit, node.upperLimit].filter(
        (child): child is EquationGeometry => child !== undefined
      );
  }
}

function rule(node: EquationGeometry): LayoutBox | null {
  return node.kind === 'fraction' || node.kind === 'radical' || node.kind === 'bar'
    ? node.bar
    : null;
}

/**
 * The ink extents of `node`, measured from its baseline.
 *
 * Text uses the glyph ink that the measurer reports through `textOutline`. A measurer that
 * cannot report ink gives the font box instead, so clearances stay conservative. Child
 * positions and rules (fraction, radical, and bar strokes) are included.
 */
export function equationInk(node: EquationGeometry, measurer: TextMeasurer): EquationInk {
  if (node.kind === 'text' || node.kind === 'fallback') {
    const ink =
      node.text && node.runStyle ? measurer.textOutline?.(node.text, node.runStyle)?.ink : null;
    return ink
      ? { ascent: -ink.top, descent: ink.bottom }
      : { ascent: node.baseline, descent: node.box.height - node.baseline };
  }
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const child of children(node)) {
    const ink = equationInk(child, measurer);
    const baseline = child.box.y + child.baseline;
    top = Math.min(top, baseline - ink.ascent);
    bottom = Math.max(bottom, baseline + ink.descent);
  }
  const stroke = rule(node);
  if (stroke && stroke.height > 0) {
    top = Math.min(top, stroke.y);
    bottom = Math.max(bottom, stroke.y + stroke.height);
  }
  if (top > bottom) return { ascent: 0, descent: 0 };
  return { ascent: node.baseline - top, descent: bottom - node.baseline };
}

/** The largest text size, in points, in `node`. Zero when it holds no text. */
export function equationNominalSizePt(node: EquationGeometry): number {
  if (node.kind === 'text' || node.kind === 'fallback') return node.fontSizePt;
  return children(node).reduce((size, child) => Math.max(size, equationNominalSizePt(child)), 0);
}
