// Deterministic DOM-free geometry for the bounded equation expression tree.

import type { EquationExpression, OmmlEquationProjection } from '@docx-editor.dev/core/store';
import { measureDisplayText, withFontFamily, type ResolvedRunStyle } from './run-style.ts';
import type { LayoutBox, TextMeasurer } from './semantic-records.ts';
import { equationDisplayText } from './equation-display-text.ts';

const SCRIPT_SCALE = 0.7;
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
  return Object.freeze({
    ...node,
    box: box(x, y, node.box.width, node.box.height),
  }) as unknown as T;
}

interface EquationLayoutCache {
  readonly textStyle: ResolvedRunStyle;
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

function scaledStyle(
  style: ResolvedRunStyle,
  scale: number,
  cache: EquationLayoutCache
): ResolvedRunStyle {
  const cached = cache.styles.get(scale);
  if (cached) return cached;
  const resolved =
    scale === 1
      ? style
      : Object.freeze({
          ...style,
          fontSizePt: style.fontSizePt * scale,
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
  fallbackMetrics: { readonly height: number; readonly baseline: number }
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
  const placed = items.map((child) => {
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

function layoutExpression(
  expression: EquationExpression,
  measurer: TextMeasurer,
  style: ResolvedRunStyle,
  scale: number,
  cache: EquationLayoutCache
): EquationGeometry {
  switch (expression.kind) {
    case 'text': {
      const authoredFamily = expression.format?.fontFamily;
      const textFace = authoredFamily && authoredFamily.trim().toLowerCase() !== 'cambria math';
      const digitParts =
        textFace && !expression.format?.normalText && expression.format?.mathStyle !== 'p'
          ? expression.value.match(/(?:[0-9]\p{M}*)+|[^0-9]+/gu)
          : null;
      if (digitParts && digitParts.length > 1) {
        return rowGeometry(
          digitParts.map((value) =>
            layoutExpression({ ...expression, value }, measurer, style, scale, cache)
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
      const formatKey = expression.format ?? expression;
      const digits = Boolean(textFace && display.mathStyle && !display.mathematicalGlyphs);
      let formats = cache.formats.get(formatKey);
      let formatted = formats?.get(digits);
      if (!formatted) {
        const face = Object.freeze({
          ...familyStyle,
          fontSizePt:
            expression.format?.fontSizePt ?? expression.fontSizePt ?? familyStyle.fontSizePt,
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
    case 'fallback':
      return textGeometry('fallback', expression.text || '…', measurer, style, scale, cache);
    case 'row':
      return rowGeometry(
        expression.items.map((child) => layoutExpression(child, measurer, style, scale, cache)),
        metricsAt(measurer, style, scale, cache)
      );
    case 'fraction': {
      const resolved = scaledStyle(style, scale, cache);
      const numerator = layoutExpression(
        expression.numerator,
        measurer,
        style,
        scale * SCRIPT_SCALE,
        cache
      );
      const denominator = layoutExpression(
        expression.denominator,
        measurer,
        style,
        scale * SCRIPT_SCALE,
        cache
      );
      const pad = Math.max(0.75, resolved.fontSizePt * 0.08);
      const gap = Math.max(0.75, resolved.fontSizePt * 0.08);
      const thickness = Math.max(0.6, resolved.fontSizePt * 0.055);
      const width = Math.max(numerator.box.width, denominator.box.width) + pad * 2;
      const barY = numerator.box.height + gap;
      const denominatorY = barY + thickness + gap;
      const height = denominatorY + denominator.box.height;
      const baseline = Math.min(height, barY + thickness / 2 + resolved.fontSizePt * 0.22);
      return Object.freeze({
        kind: 'fraction',
        numerator: shifted(numerator, (width - numerator.box.width) / 2, 0),
        denominator: shifted(denominator, (width - denominator.box.width) / 2, denominatorY),
        bar: box(pad / 2, barY, width - pad, thickness),
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
      const thickness = Math.max(0.55, resolved.fontSizePt * 0.05);
      const gap = Math.max(0.35, resolved.fontSizePt * 0.035);
      const bodyY = expression.position === 'top' ? thickness + gap : 0;
      const barY = expression.position === 'top' ? 0 : body.box.height + gap;
      return Object.freeze({
        kind: 'bar',
        body: shifted(body, 0, bodyY),
        bar: box(0, barY, body.box.width, thickness),
        box: box(0, 0, body.box.width, body.box.height + gap + thickness),
        baseline: body.baseline + bodyY,
      });
    }
    case 'script': {
      const resolved = scaledStyle(style, scale, cache);
      const base = layoutExpression(expression.base, measurer, style, scale, cache);
      const subscript = expression.subscript
        ? layoutExpression(expression.subscript, measurer, style, scale * SCRIPT_SCALE, cache)
        : undefined;
      const superscript = expression.superscript
        ? layoutExpression(expression.superscript, measurer, style, scale * SCRIPT_SCALE, cache)
        : undefined;
      const gap = Math.max(0.4, resolved.fontSizePt * 0.04);
      const scriptX = base.box.width + gap;
      const superscriptY = 0;
      const baseY = superscript ? Math.max(0, superscript.box.height - base.baseline * 0.45) : 0;
      const baseline = baseY + base.baseline;
      const subscriptY = baseline + resolved.fontSizePt * 0.08;
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
        ? layoutExpression(expression.lowerLimit, measurer, style, scale * SCRIPT_SCALE, cache)
        : undefined;
      const upper = expression.upperLimit
        ? layoutExpression(expression.upperLimit, measurer, style, scale * SCRIPT_SCALE, cache)
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
  const mathStyle = equationRunStyle(style);
  const cache: EquationLayoutCache = {
    textStyle: equationTextStyles.get(style) ?? style,
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
): (projection: OmmlEquationProjection, style: ResolvedRunStyle) => EquationSpanRecord {
  const layouts = sharedEquationLayouts(measurer, producer);
  return (projection, style) => {
    const token = geometryStyleToken(style);
    let styles = layouts.projections.get(projection);
    const cached = styles?.get(token);
    if (cached && styles) {
      styles.delete(token);
      styles.set(token, cached);
      return cached;
    }
    const layout = layoutEquation(projection, measurer, style);
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
