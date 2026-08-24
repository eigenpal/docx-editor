// Deterministic DOM-free geometry for the bounded equation expression tree.

import type { EquationExpression, OmmlEquationProjection } from '@docx-editor.dev/core/store';
import { measureDisplayText, type ResolvedRunStyle } from './run-style.ts';
import type { LayoutBox, TextMeasurer } from './semantic-records.ts';

const SCRIPT_SCALE = 0.7;
const NARY_OPERATOR_SCALE = 1.25;
const EQUATION_FONT_FAMILY = 'Cambria Math';

/** Use Word's math face when installed while retaining the measurer's safe fallback stack. */
export function equationRunStyle(style: ResolvedRunStyle): ResolvedRunStyle {
  return style.fontFamily === EQUATION_FONT_FAMILY
    ? style
    : Object.freeze({ ...style, fontFamily: EQUATION_FONT_FAMILY });
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
  readonly styles: Map<number, ResolvedRunStyle>;
  readonly metrics: Map<number, ReturnType<TextMeasurer['lineMetrics']>>;
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
    case 'text':
      return textGeometry('text', expression.value, measurer, style, scale, cache);
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
  const cache: EquationLayoutCache = { styles: new Map(), metrics: new Map() };
  return Object.freeze({
    sourceNodeId: projection.sourceNodeId,
    geometry: layoutExpression(projection.expression, measurer, mathStyle, 1, cache),
    fallbackText: projection.fallbackText,
    truncated: projection.truncated,
  });
}

/** Cache equation geometry for one paragraph break by immutable source identity. */
export function createEquationLayouter(
  measurer: TextMeasurer
): (projection: OmmlEquationProjection, style: ResolvedRunStyle) => EquationSpanRecord {
  const layouts = new Map<string, EquationSpanRecord>();
  return (projection, style) => {
    const cached = layouts.get(projection.sourceNodeId);
    if (cached) return cached;
    const layout = layoutEquation(projection, measurer, style);
    layouts.set(projection.sourceNodeId, layout);
    return layout;
  };
}
