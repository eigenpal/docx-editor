// Bounded Office Math projection and compact linear-math conversion.
//
// OMML stays generic in the canonical tree. This module reads that preserved source into a
// small immutable expression tree and creates fresh generic OMML for supported user input.

import { XML_NAMESPACE_URI } from './ooxml-shared.ts';
import { isValidXmlText } from './sinks.ts';
import { renderReversibleLinearMath } from './linear-math-render.ts';
import type {
  OoxmlAttribute,
  OoxmlElement,
  OoxmlGenericElementNode,
  OoxmlNode,
  OoxmlNodeId,
} from './ooxml-tree.ts';

/** Office Math Markup Language namespace. */
export const OFFICE_MATH_NAMESPACE_URI =
  'http://schemas.openxmlformats.org/officeDocument/2006/math';

export const DEFAULT_OMML_LIMITS = Object.freeze({
  maxDepth: 24,
  maxNodes: 256,
  maxTextLength: 512,
});

/** Shared work limits for untrusted OMML and linear-math input. */
export interface OmmlLimits {
  readonly maxDepth?: number;
  readonly maxNodes?: number;
  readonly maxTextLength?: number;
}

export type EquationExpression =
  | { readonly kind: 'row'; readonly items: readonly EquationExpression[] }
  | { readonly kind: 'text'; readonly value: string }
  | {
      readonly kind: 'fraction';
      readonly numerator: EquationExpression;
      readonly denominator: EquationExpression;
    }
  | {
      readonly kind: 'radical';
      readonly radicand: EquationExpression;
      readonly degree?: EquationExpression;
    }
  | {
      readonly kind: 'script';
      readonly base: EquationExpression;
      readonly subscript?: EquationExpression;
      readonly superscript?: EquationExpression;
    }
  | {
      readonly kind: 'nary';
      readonly operator: string;
      readonly body: EquationExpression;
      readonly lowerLimit?: EquationExpression;
      readonly upperLimit?: EquationExpression;
    }
  | { readonly kind: 'fallback'; readonly text: string };

export interface OmmlEquationProjection {
  readonly sourceNodeId: OoxmlNodeId;
  readonly expression: EquationExpression;
  readonly fallbackText: string;
  readonly truncated: boolean;
  readonly visitedNodes: number;
}

/**
 * Canonical nodes are immutable and edits preserve untouched child identity.
 *
 * Cache the default projection by source identity. Typing beside an equation can relayout its
 * paragraph many times, but it must not walk the same bounded OMML tree twice per keystroke.
 * Weak keys release the projection with the document revision that owned the source node.
 */
const defaultProjectionCache = new WeakMap<OoxmlGenericElementNode, OmmlEquationProjection>();
const DEFAULT_LINEAR_CACHE_LIMIT = 64;
const defaultLinearMathCache = new Map<string, LinearMathParseResult>();
const reversibleLinearMathCache = new WeakMap<EquationExpression, string>();

export type LinearMathRejection =
  | 'empty'
  | 'invalid-syntax'
  | 'invalid-xml-text'
  | 'depth-limit'
  | 'node-limit'
  | 'text-limit';

export type LinearMathParseResult =
  | { readonly ok: true; readonly expression: EquationExpression }
  | { readonly ok: false; readonly reason: LinearMathRejection };

export type LinearMathOmmlResult =
  | {
      readonly ok: true;
      readonly expression: EquationExpression;
      readonly equation: OoxmlGenericElementNode;
    }
  | { readonly ok: false; readonly reason: LinearMathRejection };

interface ResolvedLimits {
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxTextLength: number;
}

function resolveLimits(limits: OmmlLimits | undefined): ResolvedLimits {
  const positiveInteger = (value: number | undefined, fallback: number): number =>
    Number.isSafeInteger(value) && value! > 0 ? value! : fallback;
  return {
    maxDepth: positiveInteger(limits?.maxDepth, DEFAULT_OMML_LIMITS.maxDepth),
    maxNodes: positiveInteger(limits?.maxNodes, DEFAULT_OMML_LIMITS.maxNodes),
    maxTextLength: positiveInteger(limits?.maxTextLength, DEFAULT_OMML_LIMITS.maxTextLength),
  };
}

function isMathElement(node: OoxmlNode, localName?: string): node is OoxmlGenericElementNode {
  return (
    node.kind === 'generic' &&
    node.namespaceUri === OFFICE_MATH_NAMESPACE_URI &&
    (localName === undefined || node.localName === localName)
  );
}

function frozenRow(children: readonly EquationExpression[]): EquationExpression {
  if (children.length === 1) return children[0]!;
  return Object.freeze({ kind: 'row', items: Object.freeze([...children]) });
}

function childrenOf(node: OoxmlElement): readonly OoxmlNode[] {
  return node.children;
}

interface ProjectionState {
  readonly limits: ResolvedLimits;
  visitedNodes: number;
  text: string;
  truncated: boolean;
}

function appendProjectionText(state: ProjectionState, value: string): string {
  const room = state.limits.maxTextLength - state.text.length;
  if (room <= 0) {
    if (value.length > 0) state.truncated = true;
    return '';
  }
  const accepted = value.slice(0, room);
  state.text += accepted;
  if (accepted.length !== value.length) state.truncated = true;
  return accepted;
}

function enterProjectionNode(state: ProjectionState, depth: number): boolean {
  if (depth > state.limits.maxDepth || state.visitedNodes >= state.limits.maxNodes) {
    state.truncated = true;
    return false;
  }
  state.visitedNodes += 1;
  return true;
}

function fallbackOf(node: OoxmlNode, state: ProjectionState, depth: number): EquationExpression {
  const start = state.text.length;
  collectFallbackText(node, state, depth);
  const text = state.text.slice(start);
  return Object.freeze({ kind: 'fallback', text: text || (state.truncated ? '…' : '') });
}

function collectFallbackText(node: OoxmlNode, state: ProjectionState, depth: number): void {
  if (!enterProjectionNode(state, depth)) return;
  if (node.kind === 'textValue') {
    appendProjectionText(state, node.value);
    return;
  }
  for (const child of childrenOf(node)) {
    collectFallbackText(child, state, depth + 1);
    if (state.truncated && state.text.length >= state.limits.maxTextLength) return;
  }
}

function namedChild(
  node: OoxmlGenericElementNode,
  localName: string
): OoxmlGenericElementNode | null {
  for (const child of childrenOf(node)) {
    if (isMathElement(child, localName)) return child;
  }
  return null;
}

function namedChildren(
  node: OoxmlGenericElementNode,
  localName: string
): readonly OoxmlGenericElementNode[] {
  return childrenOf(node).filter((child): child is OoxmlGenericElementNode =>
    isMathElement(child, localName)
  );
}

function hasOnlyMathChildren(
  node: OoxmlGenericElementNode,
  counts: Readonly<Record<string, { readonly min: number; readonly max: number }>>
): boolean {
  if (node.attributes.length > 0) return false;
  const seen = new Map<string, number>();
  for (const child of childrenOf(node)) {
    if (!isMathElement(child) || counts[child.localName] === undefined) return false;
    seen.set(child.localName, (seen.get(child.localName) ?? 0) + 1);
  }
  return Object.entries(counts).every(([name, range]) => {
    const count = seen.get(name) ?? 0;
    return count >= range.min && count <= range.max;
  });
}

function isEmptyProperty(node: OoxmlGenericElementNode): boolean {
  return node.attributes.length === 0 && childrenOf(node).length === 0;
}

function mathVal(node: OoxmlGenericElementNode): string | undefined {
  return node.attributes.find(
    (attribute) =>
      attribute.namespaceUri === OFFICE_MATH_NAMESPACE_URI && attribute.localName === 'val'
  )?.value;
}

function hasOnlyMathVal(node: OoxmlGenericElementNode, accepted?: ReadonlySet<string>): boolean {
  if (childrenOf(node).length > 0 || node.attributes.length !== 1) return false;
  const value = mathVal(node);
  return value !== undefined && (accepted === undefined || accepted.has(value));
}

function isSupportedRun(node: OoxmlGenericElementNode): boolean {
  if (node.attributes.length > 0) return false;
  const properties = namedChildren(node, 'rPr');
  const texts = namedChildren(node, 't');
  if (properties.length > 1 || texts.length === 0) return false;
  if (properties[0] && !isEmptyProperty(properties[0])) return false;
  if (properties.length + texts.length !== childrenOf(node).length) return false;
  return texts.every(
    (text) =>
      text.attributes.every(
        (attribute) =>
          attribute.namespaceUri === XML_NAMESPACE_URI &&
          attribute.localName === 'space' &&
          (attribute.value === 'preserve' || attribute.value === 'default')
      ) && childrenOf(text).every((child) => child.kind === 'textValue')
  );
}

function isSupportedExpressionNode(node: OoxmlNode): boolean {
  if (node.kind === 'textValue') return true;
  if (!isMathElement(node)) return false;
  if (node.localName === 'r') return isSupportedRun(node);
  if (node.localName === 't') {
    return (
      node.attributes.every(
        (attribute) =>
          attribute.namespaceUri === XML_NAMESPACE_URI &&
          attribute.localName === 'space' &&
          (attribute.value === 'preserve' || attribute.value === 'default')
      ) && childrenOf(node).every((child) => child.kind === 'textValue')
    );
  }
  if (node.localName === 'f') {
    if (
      !hasOnlyMathChildren(node, {
        fPr: { min: 0, max: 1 },
        num: { min: 1, max: 1 },
        den: { min: 1, max: 1 },
      })
    ) {
      return false;
    }
    const property = namedChild(node, 'fPr');
    const propertySupported =
      !property ||
      isEmptyProperty(property) ||
      (hasOnlyMathChildren(property, { type: { min: 1, max: 1 } }) &&
        hasOnlyMathVal(namedChildren(property, 'type')[0]!, new Set(['bar'])));
    return (
      propertySupported &&
      childrenOf(namedChildren(node, 'num')[0]!).every(isSupportedExpressionNode) &&
      childrenOf(namedChildren(node, 'den')[0]!).every(isSupportedExpressionNode)
    );
  }
  if (node.localName === 'rad') {
    if (
      !hasOnlyMathChildren(node, {
        radPr: { min: 0, max: 1 },
        deg: { min: 1, max: 1 },
        e: { min: 1, max: 1 },
      })
    ) {
      return false;
    }
    const degree = namedChildren(node, 'deg')[0]!;
    const property = namedChild(node, 'radPr');
    const propertySupported =
      !property ||
      isEmptyProperty(property) ||
      (childrenOf(degree).length === 0 &&
        hasOnlyMathChildren(property, { degHide: { min: 1, max: 1 } }) &&
        hasOnlyMathVal(namedChildren(property, 'degHide')[0]!, new Set(['1', 'true', 'on'])));
    return (
      propertySupported &&
      childrenOf(degree).every(isSupportedExpressionNode) &&
      childrenOf(namedChildren(node, 'e')[0]!).every(isSupportedExpressionNode)
    );
  }
  if (node.localName === 'sSup' || node.localName === 'sSub' || node.localName === 'sSubSup') {
    const propertyName = `${node.localName}Pr`;
    const expected = {
      [propertyName]: { min: 0, max: 1 },
      e: { min: 1, max: 1 },
      sub: { min: node.localName === 'sSup' ? 0 : 1, max: node.localName === 'sSup' ? 0 : 1 },
      sup: { min: node.localName === 'sSub' ? 0 : 1, max: node.localName === 'sSub' ? 0 : 1 },
    };
    if (!hasOnlyMathChildren(node, expected)) return false;
    const property = namedChild(node, propertyName);
    return (
      (!property || isEmptyProperty(property)) &&
      ['e', 'sub', 'sup'].every((name) =>
        namedChildren(node, name).every((container) =>
          childrenOf(container).every(isSupportedExpressionNode)
        )
      )
    );
  }
  if (node.localName === 'nary') {
    if (
      !hasOnlyMathChildren(node, {
        naryPr: { min: 0, max: 1 },
        sub: { min: 0, max: 1 },
        sup: { min: 0, max: 1 },
        e: { min: 1, max: 1 },
      })
    ) {
      return false;
    }
    const property = namedChild(node, 'naryPr');
    if (property) {
      if (
        !hasOnlyMathChildren(property, {
          chr: { min: 0, max: 1 },
          limLoc: { min: 0, max: 1 },
        })
      ) {
        return false;
      }
      const character = namedChild(property, 'chr');
      const limitLocation = namedChild(property, 'limLoc');
      if (character && !hasOnlyMathVal(character)) return false;
      if (limitLocation && !hasOnlyMathVal(limitLocation, new Set(['undOvr']))) {
        return false;
      }
    }
    return ['e', 'sub', 'sup'].every((name) =>
      namedChildren(node, name).every((container) =>
        childrenOf(container).every(isSupportedExpressionNode)
      )
    );
  }
  return false;
}

function projectContainer(
  node: OoxmlGenericElementNode,
  state: ProjectionState,
  depth: number,
  skipLocalName?: string
): EquationExpression {
  const expressions: EquationExpression[] = [];
  for (const child of childrenOf(node)) {
    if (skipLocalName && isMathElement(child, skipLocalName)) continue;
    expressions.push(projectNode(child, state, depth + 1));
  }
  return frozenRow(expressions);
}

function projectStructured(
  node: OoxmlGenericElementNode,
  state: ProjectionState,
  depth: number
): EquationExpression | null {
  if (!isSupportedExpressionNode(node)) return null;
  if (node.localName === 'f') {
    const numerator = namedChild(node, 'num');
    const denominator = namedChild(node, 'den');
    if (!numerator || !denominator) return null;
    return Object.freeze({
      kind: 'fraction',
      numerator: projectContainer(numerator, state, depth + 1),
      denominator: projectContainer(denominator, state, depth + 1),
    });
  }
  if (node.localName === 'rad') {
    const radicand = namedChild(node, 'e');
    if (!radicand) return null;
    const degree = namedChild(node, 'deg');
    const projectedDegree =
      degree && childrenOf(degree).length > 0
        ? projectContainer(degree, state, depth + 1)
        : undefined;
    return Object.freeze({
      kind: 'radical',
      radicand: projectContainer(radicand, state, depth + 1),
      ...(projectedDegree === undefined ? {} : { degree: projectedDegree }),
    });
  }
  if (node.localName === 'sSup' || node.localName === 'sSub' || node.localName === 'sSubSup') {
    const base = namedChild(node, 'e');
    const subscript = node.localName === 'sSup' ? null : namedChild(node, 'sub');
    const superscript = node.localName === 'sSub' ? null : namedChild(node, 'sup');
    if (
      !base ||
      (node.localName !== 'sSup' && !subscript) ||
      (node.localName !== 'sSub' && !superscript)
    ) {
      return null;
    }
    return Object.freeze({
      kind: 'script',
      base: projectContainer(base, state, depth + 1),
      ...(subscript ? { subscript: projectContainer(subscript, state, depth + 1) } : {}),
      ...(superscript ? { superscript: projectContainer(superscript, state, depth + 1) } : {}),
    });
  }
  if (node.localName === 'nary') {
    const body = namedChild(node, 'e');
    if (!body) return null;
    const lower = namedChild(node, 'sub');
    const upper = namedChild(node, 'sup');
    const property = namedChild(node, 'naryPr');
    const operatorNode = property ? namedChild(property, 'chr') : null;
    const operator =
      operatorNode?.attributes.find(
        (attribute) =>
          attribute.namespaceUri === OFFICE_MATH_NAMESPACE_URI && attribute.localName === 'val'
      )?.value ?? '∑';
    return Object.freeze({
      kind: 'nary',
      operator: appendProjectionText(state, operator),
      body: projectContainer(body, state, depth + 1),
      ...(lower && childrenOf(lower).length > 0
        ? { lowerLimit: projectContainer(lower, state, depth + 1) }
        : {}),
      ...(upper && childrenOf(upper).length > 0
        ? { upperLimit: projectContainer(upper, state, depth + 1) }
        : {}),
    });
  }
  return null;
}

function projectNode(node: OoxmlNode, state: ProjectionState, depth: number): EquationExpression {
  if (!enterProjectionNode(state, depth)) {
    return Object.freeze({ kind: 'fallback', text: '…' });
  }
  if (node.kind === 'textValue') {
    return Object.freeze({ kind: 'text', value: appendProjectionText(state, node.value) });
  }
  if (!isMathElement(node)) return fallbackOf(node, state, depth + 1);
  if (node.localName === 'oMath') {
    return projectContainer(node, state, depth);
  }
  if (node.localName === 'r') {
    return isSupportedExpressionNode(node)
      ? projectContainer(node, state, depth, 'rPr')
      : fallbackOf(node, state, depth + 1);
  }
  if (node.localName === 't') {
    return isSupportedExpressionNode(node)
      ? projectContainer(node, state, depth)
      : fallbackOf(node, state, depth + 1);
  }
  const structured = projectStructured(node, state, depth);
  return structured ?? fallbackOf(node, state, depth + 1);
}

/**
 * Project one preserved `m:oMath` generic node without changing its canonical source.
 */
export function projectOmmlEquation(
  node: OoxmlNode,
  limits?: OmmlLimits
): OmmlEquationProjection | null {
  if (!isMathElement(node, 'oMath')) return null;
  const cached = limits === undefined ? defaultProjectionCache.get(node) : undefined;
  if (cached) return cached;
  const publish = (projection: OmmlEquationProjection): OmmlEquationProjection => {
    if (limits === undefined) defaultProjectionCache.set(node, projection);
    return projection;
  };
  const resolved = resolveLimits(limits);
  const scan: ProjectionState = {
    limits: resolved,
    visitedNodes: 0,
    text: '',
    truncated: false,
  };
  collectFallbackText(node, scan, 1);
  const fallbackText = scan.text + (scan.truncated ? '…' : '');
  if (scan.truncated) {
    return publish(
      Object.freeze({
        sourceNodeId: node.id,
        expression: Object.freeze({ kind: 'fallback', text: fallbackText || '…' }),
        fallbackText,
        truncated: true,
        visitedNodes: scan.visitedNodes,
      })
    );
  }
  // The preflight proves the complete source is within each work limit. The structured pass
  // can revisit wrappers while it maps their roles, but it cannot discover more source nodes.
  const state: ProjectionState = {
    limits: { ...resolved, maxNodes: Number.MAX_SAFE_INTEGER },
    visitedNodes: 0,
    text: '',
    truncated: false,
  };
  const expression = projectNode(node, state, 1);
  if (state.truncated) {
    const structuredFallback = state.text + '…';
    return publish(
      Object.freeze({
        sourceNodeId: node.id,
        expression: Object.freeze({ kind: 'fallback', text: structuredFallback }),
        fallbackText: structuredFallback,
        truncated: true,
        visitedNodes: scan.visitedNodes,
      })
    );
  }
  return publish(
    Object.freeze({
      sourceNodeId: node.id,
      expression,
      fallbackText,
      truncated: false,
      visitedNodes: scan.visitedNodes,
    })
  );
}

class LinearMathError extends Error {
  constructor(readonly reason: LinearMathRejection) {
    super(reason);
  }
}

class LinearMathParser {
  private index = 0;
  private nodes = 0;

  constructor(
    private readonly input: string,
    private readonly limits: ResolvedLimits
  ) {}

  parse(): EquationExpression {
    if (this.input.length === 0) throw new LinearMathError('empty');
    if (this.input.length > this.limits.maxTextLength) throw new LinearMathError('text-limit');
    if (!isValidXmlText(this.input)) throw new LinearMathError('invalid-xml-text');
    const expression = this.sequence(undefined, 1);
    if (this.index !== this.input.length) throw new LinearMathError('invalid-syntax');
    return expression;
  }

  private make<T extends EquationExpression>(expression: T, depth: number): T {
    if (depth > this.limits.maxDepth) throw new LinearMathError('depth-limit');
    this.nodes += 1;
    if (this.nodes > this.limits.maxNodes) throw new LinearMathError('node-limit');
    return Object.freeze(expression);
  }

  private sequence(stop: '}' | ']' | undefined, depth: number): EquationExpression {
    if (depth > this.limits.maxDepth) throw new LinearMathError('depth-limit');
    const children: EquationExpression[] = [];
    while (this.index < this.input.length && this.input[this.index] !== stop) {
      if (this.input[this.index] === '}' || this.input[this.index] === ']') {
        throw new LinearMathError('invalid-syntax');
      }
      children.push(this.scripted(depth + 1));
    }
    if (stop !== undefined) {
      if (this.input[this.index] !== stop) throw new LinearMathError('invalid-syntax');
      this.index += 1;
    }
    if (children.length === 0) return this.make({ kind: 'row', items: Object.freeze([]) }, depth);
    return children.length === 1
      ? children[0]!
      : this.make({ kind: 'row', items: Object.freeze(children) }, depth);
  }

  private scripted(depth: number): EquationExpression {
    const groupedBase = this.input[this.index] === '{';
    let base = this.primary(depth + 1);
    let prefix: EquationExpression | undefined;
    let subscript: EquationExpression | undefined;
    let superscript: EquationExpression | undefined;
    while (this.input[this.index] === '^' || this.input[this.index] === '_') {
      const marker = this.input[this.index++]!;
      const operand = this.scriptOperand(depth + 1);
      if (marker === '^') {
        if (superscript) throw new LinearMathError('invalid-syntax');
        superscript = operand;
      } else {
        if (subscript) throw new LinearMathError('invalid-syntax');
        subscript = operand;
      }
    }
    if (subscript || superscript) {
      if (!groupedBase && base.kind === 'text') {
        const characters = Array.from(base.value);
        if (characters.length > 1) {
          prefix = this.make({ kind: 'text', value: characters.slice(0, -1).join('') }, depth + 1);
          base = this.make({ kind: 'text', value: characters.at(-1)! }, depth + 1);
        }
      }
      base = this.make(
        {
          kind: 'script',
          base,
          ...(subscript === undefined ? {} : { subscript }),
          ...(superscript === undefined ? {} : { superscript }),
        },
        depth
      );
    }
    return prefix ? this.make({ kind: 'row', items: [prefix, base] }, depth) : base;
  }

  private scriptOperand(depth: number): EquationExpression {
    if (this.input[this.index] === '{') return this.braced(depth + 1);
    const value = this.codePoint();
    if (value === null || '^_{}[]'.includes(value)) throw new LinearMathError('invalid-syntax');
    return this.make({ kind: 'text', value }, depth);
  }

  private braced(depth: number): EquationExpression {
    if (this.input[this.index] !== '{') throw new LinearMathError('invalid-syntax');
    this.index += 1;
    const expression = this.sequence('}', depth + 1);
    if (expression.kind === 'row' && expression.items.length === 0) {
      throw new LinearMathError('invalid-syntax');
    }
    return expression;
  }

  private primary(depth: number): EquationExpression {
    if (this.input[this.index] === '{') {
      const numerator = this.braced(depth + 1);
      if (this.input[this.index] === '/' && this.input[this.index + 1] === '{') {
        this.index += 1;
        const denominator = this.braced(depth + 1);
        return this.make({ kind: 'fraction', numerator, denominator }, depth);
      }
      return numerator;
    }
    if (this.input[this.index] === '√') {
      this.index += 1;
      let degree: EquationExpression | undefined;
      if (this.input[this.index] === '[') {
        this.index += 1;
        degree = this.sequence(']', depth + 1);
        if (degree.kind === 'row' && degree.items.length === 0) {
          throw new LinearMathError('invalid-syntax');
        }
      }
      if (this.input[this.index] !== '{') throw new LinearMathError('invalid-syntax');
      return this.make(
        {
          kind: 'radical',
          radicand: this.braced(depth + 1),
          ...(degree === undefined ? {} : { degree }),
        },
        depth
      );
    }
    if (this.input[this.index] === '∑') {
      this.index += 1;
      let lowerLimit: EquationExpression | undefined;
      let upperLimit: EquationExpression | undefined;
      if (this.input[this.index] === '[') {
        this.index += 1;
        lowerLimit = this.sequence(']', depth + 1);
        if (lowerLimit.kind === 'row' && lowerLimit.items.length === 0) {
          throw new LinearMathError('invalid-syntax');
        }
      }
      if (this.input[this.index] === '^') {
        this.index += 1;
        if (this.input[this.index] !== '[') throw new LinearMathError('invalid-syntax');
        this.index += 1;
        upperLimit = this.sequence(']', depth + 1);
        if (upperLimit.kind === 'row' && upperLimit.items.length === 0) {
          throw new LinearMathError('invalid-syntax');
        }
      }
      if (this.input[this.index] !== '{') throw new LinearMathError('invalid-syntax');
      return this.make(
        {
          kind: 'nary',
          operator: '∑',
          body: this.braced(depth + 1),
          ...(lowerLimit === undefined ? {} : { lowerLimit }),
          ...(upperLimit === undefined ? {} : { upperLimit }),
        },
        depth
      );
    }
    const start = this.index;
    while (this.index < this.input.length) {
      const character = this.input[this.index]!;
      if ('{}[]^_√∑'.includes(character)) break;
      this.index += 1;
    }
    if (this.index === start) throw new LinearMathError('invalid-syntax');
    return this.make({ kind: 'text', value: this.input.slice(start, this.index) }, depth);
  }

  private codePoint(): string | null {
    if (this.index >= this.input.length) return null;
    const point = this.input.codePointAt(this.index);
    if (point === undefined) return null;
    const value = String.fromCodePoint(point);
    this.index += value.length;
    return value;
  }
}

/** Parse the supported compact linear-math subset with fixed work limits. */
export function parseLinearMath(input: string, limits?: OmmlLimits): LinearMathParseResult {
  const cacheable = limits === undefined && input.length <= DEFAULT_OMML_LIMITS.maxTextLength;
  const cached = cacheable ? defaultLinearMathCache.get(input) : undefined;
  if (cached) return cached;
  let result: LinearMathParseResult;
  try {
    result = Object.freeze({
      ok: true,
      expression: new LinearMathParser(input, resolveLimits(limits)).parse(),
    });
  } catch (error) {
    result = Object.freeze({
      ok: false,
      reason: error instanceof LinearMathError ? error.reason : 'invalid-syntax',
    });
  }
  if (cacheable) {
    if (defaultLinearMathCache.size >= DEFAULT_LINEAR_CACHE_LIMIT) {
      const oldest = defaultLinearMathCache.keys().next().value;
      if (oldest !== undefined) defaultLinearMathCache.delete(oldest);
    }
    defaultLinearMathCache.set(input, result);
  }
  return result;
}

/**
 * Convert a projected expression into reversible compact syntax.
 *
 * Returns an empty string when parsing the result would change the projected meaning.
 */
export function equationExpressionToLinearMath(expression: EquationExpression): string {
  const cached = reversibleLinearMathCache.get(expression);
  if (cached !== undefined) return cached;
  const linear = renderReversibleLinearMath(expression, parseLinearMath);
  reversibleLinearMathCache.set(expression, linear);
  return linear;
}

type NextNodeId = () => string;

function mathAttribute(localName: string, value: string): OoxmlAttribute {
  return Object.freeze({
    kind: 'genericExtension',
    namespaceUri: OFFICE_MATH_NAMESPACE_URI,
    localName,
    prefix: 'm',
    value,
  });
}

function textValue(value: string, nextId: NextNodeId): OoxmlNode {
  return Object.freeze({ id: nextId(), kind: 'textValue', value });
}

function textAttributes(value: string): readonly OoxmlAttribute[] {
  return /^\s|\s$/.test(value)
    ? [
        Object.freeze({
          kind: 'xmlSpace',
          namespaceUri: XML_NAMESPACE_URI,
          localName: 'space',
          prefix: 'xml',
          value: 'preserve',
        }),
      ]
    : [];
}

function mathElement(
  localName: string,
  children: readonly OoxmlNode[],
  nextId: NextNodeId,
  attributes: readonly OoxmlAttribute[] = []
): OoxmlGenericElementNode {
  return Object.freeze({
    id: nextId(),
    kind: 'generic',
    namespaceUri: OFFICE_MATH_NAMESPACE_URI,
    localName,
    prefix: 'm',
    namespaceBindings: Object.freeze([]),
    attributes: Object.freeze([...attributes]),
    children: Object.freeze([...children]),
  });
}

function expressionNodes(expression: EquationExpression, nextId: NextNodeId): readonly OoxmlNode[] {
  switch (expression.kind) {
    case 'row':
      return expression.items.flatMap((child) => expressionNodes(child, nextId));
    case 'text':
      return [
        mathElement(
          'r',
          [
            mathElement(
              't',
              [textValue(expression.value, nextId)],
              nextId,
              textAttributes(expression.value)
            ),
          ],
          nextId
        ),
      ];
    case 'fallback':
      return [
        mathElement(
          'r',
          [
            mathElement(
              't',
              [textValue(expression.text, nextId)],
              nextId,
              textAttributes(expression.text)
            ),
          ],
          nextId
        ),
      ];
    case 'fraction':
      return [
        mathElement(
          'f',
          [
            mathElement('num', expressionNodes(expression.numerator, nextId), nextId),
            mathElement('den', expressionNodes(expression.denominator, nextId), nextId),
          ],
          nextId
        ),
      ];
    case 'radical':
      return [
        mathElement(
          'rad',
          [
            mathElement(
              'deg',
              expression.degree ? expressionNodes(expression.degree, nextId) : [],
              nextId
            ),
            mathElement('e', expressionNodes(expression.radicand, nextId), nextId),
          ],
          nextId
        ),
      ];
    case 'script': {
      if (expression.subscript && expression.superscript) {
        return [
          mathElement(
            'sSubSup',
            [
              mathElement('e', expressionNodes(expression.base, nextId), nextId),
              mathElement('sub', expressionNodes(expression.subscript, nextId), nextId),
              mathElement('sup', expressionNodes(expression.superscript, nextId), nextId),
            ],
            nextId
          ),
        ];
      }
      const superscript = expression.superscript !== undefined;
      const script = superscript ? expression.superscript! : expression.subscript!;
      return [
        mathElement(
          superscript ? 'sSup' : 'sSub',
          [
            mathElement('e', expressionNodes(expression.base, nextId), nextId),
            mathElement(superscript ? 'sup' : 'sub', expressionNodes(script, nextId), nextId),
          ],
          nextId
        ),
      ];
    }
    case 'nary':
      return [
        mathElement(
          'nary',
          [
            mathElement(
              'naryPr',
              [
                mathElement('chr', [], nextId, [mathAttribute('val', expression.operator)]),
                mathElement('limLoc', [], nextId, [mathAttribute('val', 'undOvr')]),
              ],
              nextId
            ),
            mathElement(
              'sub',
              expression.lowerLimit ? expressionNodes(expression.lowerLimit, nextId) : [],
              nextId
            ),
            mathElement(
              'sup',
              expression.upperLimit ? expressionNodes(expression.upperLimit, nextId) : [],
              nextId
            ),
            mathElement('e', expressionNodes(expression.body, nextId), nextId),
          ],
          nextId
        ),
      ];
  }
}

/**
 * Build a canonical `m:oMath` tree. The caller supplies the part-scoped fresh ID allocator.
 */
function ommlEquationFromExpression(
  expression: EquationExpression,
  nextId: NextNodeId
): OoxmlGenericElementNode {
  const equation = mathElement('oMath', expressionNodes(expression, nextId), nextId);
  return Object.freeze({
    ...equation,
    namespaceBindings: Object.freeze([
      Object.freeze({ prefix: 'm', namespaceUri: OFFICE_MATH_NAMESPACE_URI }),
    ]),
  });
}

/** Parse compact linear math and generate fresh canonical OMML in one bounded operation. */
export function linearMathToOmml(
  input: string,
  nextId: NextNodeId,
  limits?: OmmlLimits
): LinearMathOmmlResult {
  const parsed = parseLinearMath(input, limits);
  if (!parsed.ok) return parsed;
  return Object.freeze({
    ok: true,
    expression: parsed.expression,
    equation: ommlEquationFromExpression(parsed.expression, nextId),
  });
}
