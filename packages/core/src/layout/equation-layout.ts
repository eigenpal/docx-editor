// Deterministic DOM-free geometry for the bounded equation expression tree.

import type { EquationExpression, OmmlEquationProjection } from '@docx-editor.dev/core/store';
import { measureDisplayText, withFontFamily, type ResolvedRunStyle } from './run-style.ts';
import type { LayoutBox, TextMeasurer } from './semantic-records.ts';
import { equationDisplayText } from './equation-display-text.ts';
import { equationInk, equationLowercaseTop, inheritEquationInk } from './equation-ink.ts';
import {
  equationAtomSpaces,
  equationTextAtoms,
  equationTextHasOperators,
  type EquationAtomClass,
  type EquationSpacingAtom,
  type EquationTextAtom,
} from './equation-spacing.ts';

// Script and stack metrics in ems of the structure size, from the math constants of the
// default math face (2048 font units to the em).
/** Scripts, fraction parts, and limits draw at 73% of their base size. */
const SCRIPT_SCALE = 0.73;
/** A script inside a script, fraction part, or limit draws at 60%, at every deeper level too. */
const SCRIPT_SCRIPT_SCALE = 0.6;
/** The least superscript baseline rise. */
const SUPERSCRIPT_SHIFT_UP = 750 / 2048;
/** How far a superscript baseline may sit below the top of a lowercase base. */
const SUPERSCRIPT_BASELINE_DROP_MAX = 460 / 2048;
/** The least ink gap between a superscript and a subscript of one base. */
const SUB_SUPERSCRIPT_GAP_MIN = 300 / 2048;
/** How high a superscript bottom may rise to open the gap above a subscript. */
const SUPERSCRIPT_BOTTOM_MAX_WITH_SUBSCRIPT = 765 / 2048;
/** The stroke of an upper or lower bar. */
const BAR_RULE_THICKNESS = 133 / 2048;
/** The gap between a bar and the ink of its body. */
const BAR_VERTICAL_GAP = 345 / 2048;
/** The space a bar reserves on its outer side. */
const BAR_EXTRA_SPACE = 133 / 2048;
/** The height of the math axis, where fraction rules and operators centre. */
const MATH_AXIS_HEIGHT = 585 / 2048;
/** The stroke of a fraction rule. */
const FRACTION_RULE_THICKNESS = 133 / 2048;
/** The least numerator baseline rise of an inline fraction. */
const FRACTION_NUMERATOR_SHIFT_UP = 1200 / 2048;
/** The least denominator baseline drop of an inline fraction. */
const FRACTION_DENOMINATOR_SHIFT_DOWN = 1030 / 2048;
/** The least ink gap between the numerator and the rule. */
const FRACTION_NUMERATOR_GAP_MIN = 133 / 2048;
/** The least ink gap between the rule and the denominator. */
const FRACTION_DENOMINATOR_GAP_MIN = 133 / 2048;
const NARY_OPERATOR_SCALE = 1.25;
/** The synthetic face Core layout uses for every OMML equation. @internal */
export const EQUATION_FONT_FAMILY = 'Cambria Math';

// The atomic span keeps its math face. Normal-text children still need the
// paragraph face that supplied this memoized derivation.
const equationTextStyles = new WeakMap<ResolvedRunStyle, ResolvedRunStyle>();
const equationMathStyles = new WeakMap<ResolvedRunStyle, ResolvedRunStyle>();

/** Use Word's math face when installed while retaining the measurer's safe fallback stack. */
export function equationRunStyle(style: ResolvedRunStyle): ResolvedRunStyle {
  const cached = equationMathStyles.get(style);
  if (cached) return cached;
  const resolved = withFontFamily(style, EQUATION_FONT_FAMILY);
  if (resolved === style) return style;
  // The shared helper derives the face. Only equation context gets this wrapper
  // to retain its paragraph face, distinct from an ordinary explicit math style.
  // One immutable wrapper per source style preserves measurer cache identity.
  const derived = Object.freeze({ ...resolved });
  equationMathStyles.set(style, derived);
  equationTextStyles.set(derived, style);
  return derived;
}

interface EquationGeometryBase {
  readonly box: LayoutBox;
  /** Baseline measured from this node's top edge. */
  readonly baseline: number;
}

export interface EquationTextGeometry extends EquationGeometryBase {
  readonly kind: 'text' | 'fallback';
  readonly text: string;
  readonly fontSizePt: number;
  /** The same resolved face used by measurement and the trusted paint sink. */
  readonly runStyle?: ResolvedRunStyle;
}

export interface EquationRowGeometry extends EquationGeometryBase {
  readonly kind: 'row';
  readonly items: readonly EquationGeometry[];
}

export interface EquationFractionGeometry extends EquationGeometryBase {
  readonly kind: 'fraction';
  readonly numerator: EquationGeometry;
  readonly denominator: EquationGeometry;
  readonly bar: LayoutBox;
}

export interface EquationRadicalGeometry extends EquationGeometryBase {
  readonly kind: 'radical';
  readonly sign: EquationTextGeometry;
  readonly radicand: EquationGeometry;
  readonly degree?: EquationGeometry;
  readonly bar: LayoutBox;
}

export interface EquationBarGeometry extends EquationGeometryBase {
  readonly kind: 'bar';
  readonly body: EquationGeometry;
  readonly bar: LayoutBox;
}

export interface EquationScriptGeometry extends EquationGeometryBase {
  readonly kind: 'script';
  readonly base: EquationGeometry;
  readonly subscript?: EquationGeometry;
  readonly superscript?: EquationGeometry;
}

export interface EquationNaryGeometry extends EquationGeometryBase {
  readonly kind: 'nary';
  readonly operator: EquationTextGeometry;
  readonly body: EquationGeometry;
  readonly lowerLimit?: EquationGeometry;
  readonly upperLimit?: EquationGeometry;
}

export type EquationGeometry =
  | EquationTextGeometry
  | EquationRowGeometry
  | EquationFractionGeometry
  | EquationRadicalGeometry
  | EquationBarGeometry
  | EquationScriptGeometry
  | EquationNaryGeometry;

/** Equation metadata carried by one atomic semantic span. */
export interface EquationSpanRecord {
  readonly sourceNodeId: string;
  readonly geometry: EquationGeometry;
  readonly fallbackText: string;
  readonly truncated: boolean;
}

function box(x: number, y: number, width: number, height: number): LayoutBox {
  return Object.freeze({ x, y, width, height });
}

function shifted<T extends EquationGeometry>(node: T, x: number, y: number): T {
  const moved = Object.freeze({
    ...node,
    box: box(x, y, node.box.width, node.box.height),
  }) as unknown as T;
  inheritEquationInk(node, moved);
  return moved;
}

/**
 * Layout inputs that an equation piece carries beside its projection. An inline and a display
 * equation can share one projection, so these inputs also key the geometry cache.
 * @internal
 */
export interface EquationLayoutInput {
  /** The equation is a display equation (`m:oMathPara`). */
  readonly display?: boolean;
}

interface EquationLayoutCache {
  readonly textStyle: ResolvedRunStyle;
  /** The equation is a display equation, so its fractions keep the padded placement. */
  readonly display: boolean;
  readonly formats: WeakMap<
    object,
    Map<boolean, { readonly style: ResolvedRunStyle; readonly cache: EquationLayoutCache }>
  >;
  readonly styles: Map<number, ResolvedRunStyle>;
  readonly metrics: Map<number, ReturnType<TextMeasurer['lineMetrics']>>;
}

interface SharedEquationLayouts {
  readonly projections: WeakMap<OmmlEquationProjection, Map<string, EquationSpanRecord>>;
}

const MAX_PRODUCER_CACHES_PER_MEASURER = 4;
const MAX_STYLES_PER_PROJECTION = 8;
const sharedLayoutsByMeasurer = new WeakMap<TextMeasurer, Map<string, SharedEquationLayouts>>();

function geometryStyleToken(style: ResolvedRunStyle): string {
  const resolved = equationRunStyle(style);
  return [
    resolved.fontFamily ?? '',
    (equationTextStyles.get(style) ?? style).fontFamily ?? '',
    resolved.fontSizePt,
    resolved.bold ? 1 : 0,
    resolved.italic ? 1 : 0,
    resolved.verticalAlign,
    resolved.baselineShiftPt,
    resolved.caps ? 1 : 0,
    resolved.smallCaps ? 1 : 0,
    resolved.characterSpacingPt,
    resolved.horizontalScalePercent,
    resolved.kerningMinPt,
    resolved.ligatures?.standard ? 1 : 0,
    resolved.ligatures?.contextual ? 1 : 0,
    resolved.ligatures?.historical ? 1 : 0,
    resolved.ligatures?.discretionary ? 1 : 0,
  ].join('|');
}

function sharedEquationLayouts(
  measurer: TextMeasurer,
  producer: string | undefined
): SharedEquationLayouts {
  if (producer === undefined) return { projections: new WeakMap() };
  let producers = sharedLayoutsByMeasurer.get(measurer);
  if (!producers) {
    producers = new Map();
    sharedLayoutsByMeasurer.set(measurer, producers);
  }
  const cached = producers.get(producer);
  if (cached) {
    producers.delete(producer);
    producers.set(producer, cached);
    return cached;
  }
  if (producers.size >= MAX_PRODUCER_CACHES_PER_MEASURER) {
    const oldest = producers.keys().next().value;
    if (oldest !== undefined) producers.delete(oldest);
  }
  const created = {
    projections: new WeakMap<OmmlEquationProjection, Map<string, EquationSpanRecord>>(),
  };
  producers.set(producer, created);
  return created;
}

/** The size factor of a script level below a structure drawn at `scale`. */
function scriptScale(scale: number): number {
  return scale >= 1 ? scale * SCRIPT_SCALE : Math.min(scale, SCRIPT_SCRIPT_SCALE);
}

function scaledStyle(
  style: ResolvedRunStyle,
  scale: number,
  cache: EquationLayoutCache
): ResolvedRunStyle {
  const cached = cache.styles.get(scale);
  if (cached) return cached;
  // A reduced size rounds down to whole half points, the unit of authored run sizes.
  const resolved =
    scale === 1
      ? style
      : Object.freeze({
          ...style,
          fontSizePt:
            scale < 1
              ? Math.max(0.5, Math.floor(style.fontSizePt * scale * 2 + 1e-9) / 2)
              : style.fontSizePt * scale,
          characterSpacingPt: style.characterSpacingPt * scale,
        });
  cache.styles.set(scale, resolved);
  return resolved;
}

function metricsAt(
  measurer: TextMeasurer,
  style: ResolvedRunStyle,
  scale: number,
  cache: EquationLayoutCache
): ReturnType<TextMeasurer['lineMetrics']> {
  const cached = cache.metrics.get(scale);
  if (cached) return cached;
  const metrics = measurer.lineMetrics(scaledStyle(style, scale, cache));
  cache.metrics.set(scale, metrics);
  return metrics;
}

function textGeometry(
  kind: 'text' | 'fallback',
  text: string,
  measurer: TextMeasurer,
  style: ResolvedRunStyle,
  scale: number,
  cache: EquationLayoutCache
): EquationTextGeometry {
  const resolved = scaledStyle(style, scale, cache);
  const metrics = metricsAt(measurer, style, scale, cache);
  return Object.freeze({
    kind,
    text,
    fontSizePt: resolved.fontSizePt,
    runStyle: resolved,
    box: box(0, 0, measureDisplayText(text, resolved, measurer), metrics.height),
    baseline: metrics.baseline,
  });
}

function rowGeometry(
  items: readonly EquationGeometry[],
  fallbackMetrics: { readonly height: number; readonly baseline: number },
  /** The space, in points, before each item. */
  spaces?: readonly number[]
): EquationRowGeometry {
  if (items.length === 0) {
    return Object.freeze({
      kind: 'row',
      items: Object.freeze([]),
      box: box(0, 0, 0, fallbackMetrics.height),
      baseline: fallbackMetrics.baseline,
    });
  }
  const baseline = Math.max(...items.map((child) => child.baseline));
  const descent = Math.max(...items.map((child) => child.box.height - child.baseline));
  let x = 0;
  const placed = items.map((child, index) => {
    x += spaces?.[index] ?? 0;
    const result = shifted(child, x, baseline - child.baseline);
    x += child.box.width;
    return result;
  });
  return Object.freeze({
    kind: 'row',
    items: Object.freeze(placed),
    box: box(0, 0, x, baseline + descent),
    baseline,
  });
}

type TextExpression = Extract<EquationExpression, { readonly kind: 'text' }>;

function layoutText(
  expression: TextExpression,
  measurer: TextMeasurer,
  style: ResolvedRunStyle,
  scale: number,
  cache: EquationLayoutCache,
  // A part of a split run shares the faces derived for the whole run.
  source: object = expression
): EquationGeometry {
  const authoredFamily = expression.format?.fontFamily;
  const textFace = authoredFamily && authoredFamily.trim().toLowerCase() !== 'cambria math';
  const digitParts =
    textFace && !expression.format?.normalText && (expression.format?.mathStyle ?? 'i') === 'i'
      ? expression.value.match(/(?:[0-9]\p{M}*)+|[^0-9]+/gu)
      : null;
  if (digitParts && digitParts.length > 1) {
    return rowGeometry(
      digitParts.map((value) =>
        layoutText({ ...expression, value }, measurer, style, scale, cache, source)
      ),
      metricsAt(measurer, style, scale, cache)
    );
  }
  const display = equationDisplayText(expression, authoredFamily ?? style.fontFamily);
  const familyStyle =
    authoredFamily && !display.mathematicalGlyphs
      ? withFontFamily(style, authoredFamily)
      : expression.format?.normalText
        ? cache.textStyle
        : style;
  const formatKey = expression.format ?? source;
  const digits = Boolean(textFace && display.mathStyle && !display.mathematicalGlyphs);
  let formats = cache.formats.get(formatKey);
  let formatted = formats?.get(digits);
  if (!formatted) {
    const face = Object.freeze({
      ...familyStyle,
      fontSizePt: textSizePt(expression, familyStyle),
      // Mathematical alphanumeric glyphs already carry their style in this
      // regular face. Do not request a second italic or bold font program.
      bold:
        display.mathStyle === null
          ? (expression.format?.bold ?? familyStyle.bold)
          : !display.mathematicalGlyphs &&
            (digits && expression.format?.bold !== undefined
              ? expression.format.bold
              : display.mathStyle === 'b' || display.mathStyle === 'bi'),
      italic:
        display.mathStyle === null || digits
          ? (expression.format?.italic ??
            (digits
              ? display.mathStyle === 'i' || display.mathStyle === 'bi'
              : expression.format?.normalText
                ? false
                : familyStyle.italic))
          : !display.mathematicalGlyphs &&
            (display.mathStyle === 'i' || display.mathStyle === 'bi'),
    });
    formatted = {
      style: face,
      cache: {
        textStyle: cache.textStyle,
        display: cache.display,
        styles: new Map(),
        metrics: new Map(),
        formats: new WeakMap(),
      },
    };
    if (!formats) {
      formats = new Map();
      cache.formats.set(formatKey, formats);
    }
    formats.set(digits, formatted);
  }
  return textGeometry('text', display.text, measurer, formatted.style, scale, formatted.cache);
}

function textSizePt(expression: TextExpression, style: ResolvedRunStyle): number {
  return expression.format?.fontSizePt ?? expression.fontSizePt ?? style.fontSizePt;
}

function collectLeaves(items: readonly EquationExpression[], leaves: EquationExpression[]): void {
  for (const item of items) {
    if (item.kind === 'row') collectLeaves(item.items, leaves);
    else leaves.push(item);
  }
}

function structureClass(expression: EquationExpression): EquationAtomClass {
  return expression.kind === 'fraction' ? 'inner' : expression.kind === 'nary' ? 'op' : 'ord';
}

/**
 * Lay out one argument at its base size with the space between its atoms. Runs inside the
 * argument are one sequence, so an operator in its own run is spaced like one inside a
 * longer run.
 */
function layoutArgument(
  items: readonly EquationExpression[],
  measurer: TextMeasurer,
  style: ResolvedRunStyle,
  cache: EquationLayoutCache
): EquationGeometry {
  const leaves: EquationExpression[] = [];
  collectLeaves(items, leaves);
  const atoms: EquationSpacingAtom[] = [];
  const parts: (readonly EquationTextAtom[] | null)[] = [];
  for (const leaf of leaves) {
    if (leaf.kind === 'text') {
      // Normal text is one ordinary atom. Its operators take no space.
      const textAtoms = leaf.format?.normalText ? null : equationTextAtoms(leaf.value);
      const sizePt = textSizePt(leaf, leaf.format?.normalText ? cache.textStyle : style);
      parts.push(textAtoms);
      if (!textAtoms) {
        atoms.push({ atomClass: 'ord', sizePt, text: leaf.value });
        continue;
      }
      for (const atom of textAtoms)
        atoms.push({ atomClass: atom.atomClass, sizePt, text: atom.text });
      continue;
    }
    parts.push(null);
    atoms.push({ atomClass: structureClass(leaf), sizePt: style.fontSizePt });
  }
  const spaces = equationAtomSpaces(atoms);
  if (spaces.every((space) => space === 0)) {
    // Keep the source rows. A text item needs no second scan for operators.
    const plain = (item: EquationExpression) =>
      item.kind === 'text'
        ? layoutText(item, measurer, style, 1, cache)
        : layoutExpression(item, measurer, style, 1, cache);
    return items.length === 1
      ? plain(items[0]!)
      : rowGeometry(items.map(plain), metricsAt(measurer, style, 1, cache));
  }
  const geometries: EquationGeometry[] = [];
  leaves.forEach((leaf, index) => {
    const textAtoms = parts[index];
    if (leaf.kind === 'text' && textAtoms) {
      for (const atom of textAtoms) {
        geometries.push(layoutText({ ...leaf, value: atom.text }, measurer, style, 1, cache, leaf));
      }
    } else {
      geometries.push(layoutExpression(leaf, measurer, style, 1, cache));
    }
  });
  return rowGeometry(geometries, metricsAt(measurer, style, 1, cache), spaces);
}

/** The typographic ascender and descender of the default math face, in ems. */
const MATH_FACE_TYPO_ASCENT = 1593 / 2048;
const MATH_FACE_TYPO_DESCENT = 455 / 2048;

/**
 * One part of a stacked structure, with its text boxes trimmed to the typographic ascender
 * and descender of the math face, without the line gap that its font box adds above. Text in
 * another face and other structures keep their boxes. Glyphs keep their baselines.
 */
function stackPart(node: EquationGeometry): EquationGeometry {
  if (node.kind === 'text') {
    // The requested family, not the drawn face: a substitute keeps the trim, which only shrinks.
    if (node.runStyle?.fontFamily?.trim().toLowerCase() !== EQUATION_FONT_FAMILY.toLowerCase())
      return node;
    const ascent = Math.min(node.baseline, MATH_FACE_TYPO_ASCENT * node.fontSizePt);
    const descent = Math.min(
      node.box.height - node.baseline,
      MATH_FACE_TYPO_DESCENT * node.fontSizePt
    );
    return Object.freeze({
      ...node,
      box: box(node.box.x, node.box.y, node.box.width, ascent + descent),
      baseline: ascent,
    });
  }
  if (node.kind !== 'row' || node.items.length === 0) return node;
  const items = node.items.map(stackPart);
  const baseline = Math.max(...items.map((item) => item.baseline));
  const descent = Math.max(...items.map((item) => item.box.height - item.baseline));
  return Object.freeze({
    ...node,
    items: Object.freeze(items.map((item) => shifted(item, item.box.x, baseline - item.baseline))),
    box: box(node.box.x, node.box.y, node.box.width, baseline + descent),
    baseline,
  });
}

/**
 * A fraction in a display equation. Display style is not modelled yet: its parts take the
 * inline part size, and the fraction keeps the earlier padded placement, with full font boxes
 * for the parts and fixed gaps around the rule. The inline typographic trim would make a
 * display fraction shorter still, so it waits for display style.
 */
function displayFraction(
  numerator: EquationGeometry,
  denominator: EquationGeometry,
  em: number
): EquationFractionGeometry {
  const pad = Math.max(0.75, em * 0.08);
  const gap = Math.max(0.75, em * 0.08);
  const thickness = Math.max(0.6, em * 0.055);
  const width = Math.max(numerator.box.width, denominator.box.width) + pad * 2;
  const barY = numerator.box.height + gap;
  const denominatorY = barY + thickness + gap;
  const height = denominatorY + denominator.box.height;
  return Object.freeze({
    kind: 'fraction',
    numerator: shifted(numerator, (width - numerator.box.width) / 2, 0),
    denominator: shifted(denominator, (width - denominator.box.width) / 2, denominatorY),
    bar: box(pad / 2, barY, width - pad, thickness),
    box: box(0, 0, width, height),
    baseline: Math.min(height, barY + thickness / 2 + em * 0.22),
  });
}

function layoutExpression(
  expression: EquationExpression,
  measurer: TextMeasurer,
  style: ResolvedRunStyle,
  scale: number,
  cache: EquationLayoutCache
): EquationGeometry {
  switch (expression.kind) {
    case 'text': {
      // Operator spacing applies only at the base size, not in scripts, limits, or fractions.
      if (
        scale === 1 &&
        !expression.format?.normalText &&
        equationTextHasOperators(expression.value)
      ) {
        return layoutArgument([expression], measurer, style, cache);
      }
      return layoutText(expression, measurer, style, scale, cache);
    }
    case 'fallback':
      return textGeometry('fallback', expression.text || '…', measurer, style, scale, cache);
    case 'row': {
      if (scale === 1) return layoutArgument(expression.items, measurer, style, cache);
      return rowGeometry(
        expression.items.map((child) => layoutExpression(child, measurer, style, scale, cache)),
        metricsAt(measurer, style, scale, cache)
      );
    }
    case 'fraction': {
      const resolved = scaledStyle(style, scale, cache);
      if (cache.display) {
        return displayFraction(
          layoutExpression(expression.numerator, measurer, style, scriptScale(scale), cache),
          layoutExpression(expression.denominator, measurer, style, scriptScale(scale), cache),
          resolved.fontSizePt
        );
      }
      const numerator = stackPart(
        layoutExpression(expression.numerator, measurer, style, scriptScale(scale), cache)
      );
      const denominator = stackPart(
        layoutExpression(expression.denominator, measurer, style, scriptScale(scale), cache)
      );
      // The rule is centred on the math axis. Each part sits at least a fixed shift from the
      // baseline, and further when its ink would come closer to the rule than the minimum gap.
      // The parts reach their typographic extents, and the rule spans the wider part.
      const em = resolved.fontSizePt;
      const axis = MATH_AXIS_HEIGHT * em;
      const thickness = FRACTION_RULE_THICKNESS * em;
      const numeratorShift = Math.max(
        FRACTION_NUMERATOR_SHIFT_UP * em,
        axis +
          thickness / 2 +
          FRACTION_NUMERATOR_GAP_MIN * em +
          equationInk(numerator, measurer).descent
      );
      const denominatorShift = Math.max(
        FRACTION_DENOMINATOR_SHIFT_DOWN * em,
        FRACTION_DENOMINATOR_GAP_MIN * em +
          thickness / 2 -
          axis +
          equationInk(denominator, measurer).ascent
      );
      const baseline = Math.max(numeratorShift + numerator.baseline, axis + thickness / 2);
      const height =
        baseline +
        Math.max(
          denominatorShift + denominator.box.height - denominator.baseline,
          thickness / 2 - axis
        );
      const width = Math.max(numerator.box.width, denominator.box.width);
      return Object.freeze({
        kind: 'fraction',
        numerator: shifted(
          numerator,
          (width - numerator.box.width) / 2,
          baseline - numeratorShift - numerator.baseline
        ),
        denominator: shifted(
          denominator,
          (width - denominator.box.width) / 2,
          baseline + denominatorShift - denominator.baseline
        ),
        bar: box(0, baseline - axis - thickness / 2, width, thickness),
        box: box(0, 0, width, height),
        baseline,
      });
    }
    case 'radical': {
      const resolved = scaledStyle(style, scale, cache);
      const radicand = layoutExpression(expression.radicand, measurer, style, scale, cache);
      const sign = textGeometry('text', '√', measurer, style, scale, cache);
      const degree = expression.degree
        ? layoutExpression(expression.degree, measurer, style, scale * 0.55, cache)
        : undefined;
      const barThickness = Math.max(0.55, resolved.fontSizePt * 0.05);
      const barGap = Math.max(0.35, resolved.fontSizePt * 0.035);
      const radicandY = barThickness + barGap;
      const signX = degree ? Math.max(0, degree.box.width * 0.65) : 0;
      const radicandX = signX + sign.box.width;
      const baseline = radicandY + radicand.baseline;
      const height = Math.max(
        radicandY + radicand.box.height,
        baseline + (sign.box.height - sign.baseline)
      );
      return Object.freeze({
        kind: 'radical',
        sign: shifted(sign, signX, baseline - sign.baseline),
        radicand: shifted(radicand, radicandX, radicandY),
        ...(degree ? { degree: shifted(degree, 0, 0) } : {}),
        bar: box(radicandX, 0, radicand.box.width, barThickness),
        box: box(0, 0, radicandX + radicand.box.width, height),
        baseline,
      });
    }
    case 'bar': {
      const resolved = scaledStyle(style, scale, cache);
      const body = layoutExpression(expression.body, measurer, style, scale, cache);
      const em = resolved.fontSizePt;
      const thickness = BAR_RULE_THICKNESS * em;
      const gap = BAR_VERTICAL_GAP * em;
      // The rule keeps its gap from the body's ink, not from its font box, and reserves
      // one more rule thickness of space on its outer side. Offsets are from the body
      // baseline, downward.
      const ink = equationInk(body, measurer);
      const barTop =
        expression.position === 'top' ? -(ink.ascent + gap + thickness) : ink.descent + gap;
      const top = Math.min(
        -body.baseline,
        expression.position === 'top' ? barTop - BAR_EXTRA_SPACE * em : -body.baseline
      );
      const bottom = Math.max(
        body.box.height - body.baseline,
        expression.position === 'top' ? 0 : barTop + thickness + BAR_EXTRA_SPACE * em
      );
      return Object.freeze({
        kind: 'bar',
        body: shifted(body, 0, -body.baseline - top),
        bar: box(0, barTop - top, body.box.width, thickness),
        box: box(0, 0, body.box.width, bottom - top),
        baseline: -top,
      });
    }
    case 'script': {
      const resolved = scaledStyle(style, scale, cache);
      const base = layoutExpression(expression.base, measurer, style, scale, cache);
      const subscript = expression.subscript
        ? layoutExpression(expression.subscript, measurer, style, scriptScale(scale), cache)
        : undefined;
      const superscript = expression.superscript
        ? layoutExpression(expression.superscript, measurer, style, scriptScale(scale), cache)
        : undefined;
      const gap = Math.max(0.4, resolved.fontSizePt * 0.04);
      const scriptX = base.box.width + gap;
      const em = resolved.fontSizePt;
      // The superscript baseline rises at least a fixed share of the structure size, and
      // never sits lower than a fixed drop below the top of the base's lowercase text. A
      // text base gives its lowercase height, so an ascender keeps the same rise; a
      // structured base gives the highest lowercase top of its text, such as a numerator.
      let rise = superscript
        ? Math.max(
            SUPERSCRIPT_SHIFT_UP * em,
            equationLowercaseTop(base) - SUPERSCRIPT_BASELINE_DROP_MAX * em
          )
        : 0;
      // The subscript's own baseline sits a fifth of an em below the base baseline.
      let drop = em * 0.2;
      if (superscript && subscript) {
        // Keep an ink gap between the scripts. The superscript rises first, up to a limit,
        // and the subscript drops for the rest.
        const supInk = equationInk(superscript, measurer);
        const subInk = equationInk(subscript, measurer);
        const missing =
          SUB_SUPERSCRIPT_GAP_MIN * em - (rise - supInk.descent - (subInk.ascent - drop));
        if (missing > 0) {
          const raised = Math.min(
            missing,
            Math.max(0, SUPERSCRIPT_BOTTOM_MAX_WITH_SUBSCRIPT * em - (rise - supInk.descent))
          );
          rise += raised;
          drop += missing - raised;
        }
      }
      const baseY = superscript ? Math.max(0, superscript.baseline + rise - base.baseline) : 0;
      const baseline = baseY + base.baseline;
      const superscriptY = superscript ? baseline - rise - superscript.baseline : 0;
      const subscriptY = subscript ? Math.max(0, baseline + drop - subscript.baseline) : baseline;
      const width =
        scriptX + Math.max(subscript?.box.width ?? 0, superscript?.box.width ?? 0, -gap);
      const height = Math.max(
        baseY + base.box.height,
        superscript ? superscriptY + superscript.box.height : 0,
        subscript ? subscriptY + subscript.box.height : 0
      );
      return Object.freeze({
        kind: 'script',
        base: shifted(base, 0, baseY),
        ...(subscript ? { subscript: shifted(subscript, scriptX, subscriptY) } : {}),
        ...(superscript ? { superscript: shifted(superscript, scriptX, superscriptY) } : {}),
        box: box(0, 0, width, height),
        baseline,
      });
    }
    case 'nary': {
      const resolved = scaledStyle(style, scale, cache);
      const operator = textGeometry(
        'text',
        expression.operator,
        measurer,
        style,
        scale * NARY_OPERATOR_SCALE,
        cache
      );
      const body = layoutExpression(expression.body, measurer, style, scale, cache);
      const lower = expression.lowerLimit
        ? layoutExpression(expression.lowerLimit, measurer, style, scriptScale(scale), cache)
        : undefined;
      const upper = expression.upperLimit
        ? layoutExpression(expression.upperLimit, measurer, style, scriptScale(scale), cache)
        : undefined;
      const gap = Math.max(0.5, resolved.fontSizePt * 0.05);
      const operatorWidth = Math.max(
        operator.box.width,
        lower?.box.width ?? 0,
        upper?.box.width ?? 0
      );
      const upperHeight = upper ? upper.box.height + gap : 0;
      const operatorY = upperHeight;
      const rawBaseline = operatorY + operator.baseline;
      const lowerY = operatorY + operator.box.height + (lower ? gap : 0);
      const bodyX = operatorWidth + gap;
      const bodyY = rawBaseline - body.baseline;
      const minTop = Math.min(0, operatorY, bodyY, lower ? lowerY : 0);
      const shiftY = -minTop;
      const baseline = rawBaseline + shiftY;
      const height =
        Math.max(
          operatorY + operator.box.height,
          lower ? lowerY + lower.box.height : 0,
          bodyY + body.box.height
        ) + shiftY;
      return Object.freeze({
        kind: 'nary',
        operator: shifted(operator, (operatorWidth - operator.box.width) / 2, operatorY + shiftY),
        body: shifted(body, bodyX, bodyY + shiftY),
        ...(lower
          ? {
              lowerLimit: shifted(lower, (operatorWidth - lower.box.width) / 2, lowerY + shiftY),
            }
          : {}),
        ...(upper
          ? { upperLimit: shifted(upper, (operatorWidth - upper.box.width) / 2, shiftY) }
          : {}),
        box: box(0, 0, bodyX + body.box.width, height),
        baseline,
      });
    }
  }
}

/** Compose one bounded OMML projection into paint-ready point geometry. */
export function layoutEquation(
  projection: OmmlEquationProjection,
  measurer: TextMeasurer,
  style: ResolvedRunStyle
): EquationSpanRecord {
  return layoutEquationWith(projection, measurer, style, {});
}

function layoutEquationWith(
  projection: OmmlEquationProjection,
  measurer: TextMeasurer,
  style: ResolvedRunStyle,
  input: EquationLayoutInput
): EquationSpanRecord {
  const mathStyle = equationRunStyle(style);
  const cache: EquationLayoutCache = {
    textStyle: equationTextStyles.get(style) ?? style,
    display: input.display === true,
    styles: new Map(),
    metrics: new Map(),
    formats: new WeakMap(),
  };
  return Object.freeze({
    sourceNodeId: projection.sourceNodeId,
    geometry: layoutExpression(projection.expression, measurer, mathStyle, 1, cache),
    fallbackText: projection.fallbackText,
    truncated: projection.truncated,
  });
}

/** Reuse equation geometry across paragraph breaks for one measurement producer. */
export function createEquationLayouter(
  measurer: TextMeasurer,
  producer?: string
): (
  projection: OmmlEquationProjection,
  style: ResolvedRunStyle,
  input?: EquationLayoutInput
) => EquationSpanRecord {
  const layouts = sharedEquationLayouts(measurer, producer);
  return (projection, style, input = {}) => {
    const token = `${geometryStyleToken(style)}|${input.display ? 'display' : 'inline'}`;
    let styles = layouts.projections.get(projection);
    const cached = styles?.get(token);
    if (cached && styles) {
      styles.delete(token);
      styles.set(token, cached);
      return cached;
    }
    const layout = layoutEquationWith(projection, measurer, style, input);
    if (!styles) {
      styles = new Map();
      layouts.projections.set(projection, styles);
    }
    if (styles.size >= MAX_STYLES_PER_PROJECTION) {
      const oldest = styles.keys().next().value;
      if (oldest !== undefined) styles.delete(oldest);
    }
    styles.set(token, layout);
    return layout;
  };
}
