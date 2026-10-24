/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The presentation tree a layout runs on, matched to its layout definition.
//
// Every presentation point names the layout node that made it (`presName`) and the content
// point it iterates over (`presAssocID`). Walking the presentation tree and the layout
// definition side by side finds each point's layout node without evaluating `forEach`:
// a child's layout node is the one with its name under the parent's layout node, through
// `forEach` and the `choose` branches that hold in the child's context.

import { isElement, type OoxmlElement } from '@docx-editor.dev/core/store';
import {
  attr,
  contentDepth,
  dgmChild,
  dgmChildren,
  levelsBelow,
  MAX_DIAGRAM_TREE_DEPTH,
  selectAxis,
  siblingPosition,
  type DiagramModel,
  type DiagramPoint,
  type DiagramPointType,
} from './diagram-layout-model.ts';

/** Layout instances one diagram may have, drawn or not. */
export const MAX_DIAGRAM_LAYOUT_NODES = 2048;
/** Elements of a layout definition the index walk visits. */
const MAX_LAYOUT_DEFINITION_ELEMENTS = 50_000;

export interface LayoutAlgorithm {
  readonly type: string;
  readonly params: ReadonlyMap<string, string>;
}

export interface LayoutShape {
  /** Preset name, `conn`, or null for no geometry. */
  readonly type: string | null;
  readonly rotation: number;
  /** Adjust values by 1-based index, as fractions. */
  readonly adjust: ReadonlyMap<number, number>;
  readonly hideGeometry: boolean;
  readonly zOrderOffset: number;
}

export type ConstraintTarget = 'self' | 'ch' | 'des';

export interface LayoutConstraint {
  readonly type: string;
  readonly for: ConstraintTarget;
  readonly forName: string | null;
  readonly ptType: string;
  readonly refType: string | null;
  readonly refFor: ConstraintTarget;
  readonly refForName: string | null;
  readonly refPtType: string;
  readonly op: 'none' | 'equ' | 'gte' | 'lte';
  readonly fact: number;
  /** The `val` attribute; NaN when absent. */
  readonly val: number;
}

export interface LayoutRule {
  readonly type: string;
  readonly for: ConstraintTarget;
  readonly forName: string | null;
  readonly ptType: string;
  readonly val: number;
  readonly fact: number;
  readonly max: number;
}

export interface DiagramLayoutNode {
  readonly index: number;
  readonly pres: DiagramPoint;
  readonly name: string;
  /** The content point this instance iterates over. */
  readonly assoc: string;
  readonly assocType: DiagramPointType;
  readonly definition: OoxmlElement;
  readonly algorithm: LayoutAlgorithm;
  readonly shape: LayoutShape;
  readonly constraints: readonly LayoutConstraint[];
  readonly rules: readonly LayoutRule[];
  /** Whether the layout node shows text (`presOf` with an axis). */
  readonly showsText: boolean;
  readonly styleLabel: string | null;
  readonly parent: DiagramLayoutNode | null;
  readonly children: DiagramLayoutNode[];
  readonly depth: number;
}

export interface DiagramLayoutTree {
  readonly model: DiagramModel;
  readonly root: DiagramLayoutNode;
  readonly nodes: readonly DiagramLayoutNode[];
}

const VARIABLE_DEFAULTS: Record<string, string> = {
  dir: 'norm',
  hierBranch: 'std',
  bulletEnabled: '0',
  chMax: '-1',
  chPref: '-1',
  orgChart: '0',
  animLvl: 'none',
  animOne: 'one',
  resizeHandles: 'rel',
};

function booleanText(value: string): string {
  if (value === 'true') return '1';
  if (value === 'false') return '0';
  return value;
}

/** A layout variable for a presentation point: its own, an ancestor's, or the default. */
export function layoutVariable(model: DiagramModel, pres: DiagramPoint, name: string): string {
  let current: DiagramPoint | undefined = pres;
  let guard = 0;
  while (current && guard++ <= MAX_DIAGRAM_TREE_DEPTH) {
    const vars = dgmChild(current.prSet, 'presLayoutVars');
    const element = dgmChild(vars, name);
    if (element) {
      const value = attr(element, 'val');
      return booleanText(value ?? VARIABLE_DEFAULTS[name] ?? '');
    }
    // Only inherited variables pass down; `dir` and `hierBranch` do.
    if (name !== 'dir' && name !== 'hierBranch' && name !== 'orgChart') break;
    const parent = model.presParent.get(current.modelId);
    current = parent ? model.points.get(parent) : undefined;
  }
  return VARIABLE_DEFAULTS[name] ?? '';
}

function compare(op: string | undefined, left: string | number, right: string): boolean {
  const leftNumber = typeof left === 'number' ? left : Number(left);
  const rightNumber = Number(right);
  const numeric = Number.isFinite(leftNumber) && Number.isFinite(rightNumber);
  switch (op ?? 'equ') {
    case 'equ':
      return numeric ? leftNumber === rightNumber : String(left) === right;
    case 'neq':
      return numeric ? leftNumber !== rightNumber : String(left) !== right;
    case 'gt':
      return numeric && leftNumber > rightNumber;
    case 'lt':
      return numeric && leftNumber < rightNumber;
    case 'gte':
      return numeric && leftNumber >= rightNumber;
    case 'lte':
      return numeric && leftNumber <= rightNumber;
    default:
      return false;
  }
}

interface ConditionContext {
  readonly model: DiagramModel;
  /** The content point the condition reads. */
  readonly point: string;
  /** The presentation point whose variables the condition reads. */
  readonly pres: DiagramPoint;
}

/** One `dgm:if`; null when the selection is past a cap. */
function evaluateIf(element: OoxmlElement, context: ConditionContext): boolean | null {
  const func = attr(element, 'func');
  const op = attr(element, 'op');
  const val = booleanText(attr(element, 'val') ?? '');
  const { model, point } = context;
  switch (func) {
    case 'var':
      return compare(op, layoutVariable(model, context.pres, attr(element, 'arg') ?? ''), val);
    case 'cnt': {
      const selected = selectAxis(model, point, element);
      return selected === null ? null : compare(op, selected.length, val);
    }
    case 'pos':
    case 'revPos':
    case 'posEven':
    case 'posOdd': {
      const { pos, count } = siblingPosition(model, point);
      const value =
        func === 'pos'
          ? pos
          : func === 'revPos'
            ? count - pos + 1
            : func === 'posEven'
              ? Number(pos % 2 === 0)
              : Number(pos % 2 === 1);
      return compare(op, value, val);
    }
    case 'depth':
      return compare(op, contentDepth(model, point), val);
    case 'maxDepth': {
      const selected = selectAxis(model, point, element);
      if (selected === null) return null;
      let deepest = 0;
      for (const id of selected) deepest = Math.max(deepest, 1 + levelsBelow(model, id));
      return compare(op, deepest, val);
    }
    default:
      return false;
  }
}

/** The children of the branch a `dgm:choose` takes, or null past a cap. */
function chooseBranch(choose: OoxmlElement, context: ConditionContext): OoxmlElement | null {
  for (const branch of dgmChildren(choose)) {
    if (branch.localName === 'if') {
      const holds = evaluateIf(branch, context);
      if (holds === null) return null;
      if (holds) return branch;
    } else if (branch.localName === 'else') {
      return branch;
    }
  }
  return choose;
}

function number(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (value === 'INF') return Infinity;
  if (value === '-INF') return -Infinity;
  if (value === 'NaN') return NaN;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function target(value: string | undefined): ConstraintTarget {
  return value === 'ch' || value === 'des' ? value : 'self';
}

function readConstraint(element: OoxmlElement): LayoutConstraint | null {
  const type = attr(element, 'type');
  if (!type || type === 'none') return null;
  const refType = attr(element, 'refType');
  const op = attr(element, 'op');
  return {
    type,
    for: target(attr(element, 'for')),
    forName: attr(element, 'forName') ?? null,
    ptType: attr(element, 'ptType') ?? 'all',
    refType: refType && refType !== 'none' ? refType : null,
    refFor: target(attr(element, 'refFor')),
    refForName: attr(element, 'refForName') ?? null,
    refPtType: attr(element, 'refPtType') ?? 'all',
    op: op === 'equ' || op === 'gte' || op === 'lte' ? op : 'none',
    fact: number(attr(element, 'fact'), 1),
    val: number(attr(element, 'val'), NaN),
  };
}

function readRule(element: OoxmlElement): LayoutRule | null {
  const type = attr(element, 'type');
  if (!type) return null;
  return {
    type,
    for: target(attr(element, 'for')),
    forName: attr(element, 'forName') ?? null,
    ptType: attr(element, 'ptType') ?? 'all',
    val: number(attr(element, 'val'), NaN),
    fact: number(attr(element, 'fact'), NaN),
    max: number(attr(element, 'max'), NaN),
  };
}

function readShape(element: OoxmlElement | null): LayoutShape {
  const adjust = new Map<number, number>();
  for (const adj of dgmChildren(dgmChild(element, 'adjLst'), 'adj')) {
    const idx = Number(attr(adj, 'idx'));
    const val = Number(attr(adj, 'val'));
    if (Number.isInteger(idx) && idx >= 1 && idx <= 16 && Number.isFinite(val)) {
      adjust.set(idx, val);
    }
  }
  const type = attr(element, 'type');
  const hide = attr(element, 'hideGeom');
  return {
    type: element && type && type !== 'none' ? type : null,
    rotation: number(attr(element, 'rot'), 0),
    adjust,
    hideGeometry: hide === '1' || hide === 'true',
    zOrderOffset: number(attr(element, 'zOrderOff'), 0),
  };
}

interface LayoutBody {
  algorithm: LayoutAlgorithm;
  shape: OoxmlElement | null;
  presOf: OoxmlElement | null;
  constraints: LayoutConstraint[];
  rules: LayoutRule[];
}

/** A layout node's own algorithm, shape, text and constraints, through its `choose` branches. */
function readBody(definition: OoxmlElement, context: ConditionContext): LayoutBody | null {
  const body: LayoutBody = {
    algorithm: { type: 'sp', params: new Map() },
    shape: null,
    presOf: null,
    constraints: [],
    rules: [],
  };
  let algorithmSeen = false;
  const visit = (container: OoxmlElement, depth: number): boolean => {
    if (depth > MAX_DIAGRAM_TREE_DEPTH) return false;
    for (const element of dgmChildren(container)) {
      switch (element.localName) {
        case 'alg': {
          if (algorithmSeen) break;
          algorithmSeen = true;
          const params = new Map<string, string>();
          for (const param of dgmChildren(element, 'param')) {
            const type = attr(param, 'type');
            const val = attr(param, 'val');
            if (type && val !== undefined && !params.has(type)) params.set(type, val);
          }
          body.algorithm = { type: attr(element, 'type') ?? 'sp', params };
          break;
        }
        case 'shape':
          body.shape ??= element;
          break;
        case 'presOf':
          body.presOf ??= element;
          break;
        case 'constrLst':
          for (const constr of dgmChildren(element, 'constr')) {
            const read = readConstraint(constr);
            if (read) body.constraints.push(read);
          }
          break;
        case 'ruleLst':
          for (const rule of dgmChildren(element, 'rule')) {
            const read = readRule(rule);
            if (read) body.rules.push(read);
          }
          break;
        case 'choose': {
          const branch = chooseBranch(element, context);
          if (branch === null) return false;
          if (branch !== element && !visit(branch, depth + 1)) return false;
          break;
        }
        default:
          break;
      }
    }
    return true;
  };
  return visit(definition, 0) ? body : null;
}

/** `forEach` elements by name, for `ref`. */
function indexForEach(layoutDef: OoxmlElement): Map<string, OoxmlElement> | null {
  const byName = new Map<string, OoxmlElement>();
  const stack: OoxmlElement[] = [layoutDef];
  let visited = 0;
  while (stack.length > 0) {
    const element = stack.pop()!;
    if (++visited > MAX_LAYOUT_DEFINITION_ELEMENTS) return null;
    if (element.localName === 'forEach') {
      const name = attr(element, 'name');
      if (name && !byName.has(name)) byName.set(name, element);
    }
    for (const child of element.children) if (isElement(child)) stack.push(child);
  }
  return byName;
}

/**
 * The layout node named `name` directly under `container`'s layout node: inside `forEach`
 * (following `ref`) and taken `choose` branches, never inside another layout node.
 */
function findChildDefinition(
  container: OoxmlElement,
  name: string,
  outer: ConditionContext,
  inner: ConditionContext,
  forEachByName: ReadonlyMap<string, OoxmlElement>,
  insideForEach: boolean,
  depth: number
): OoxmlElement | null | 'refused' {
  if (depth > MAX_DIAGRAM_TREE_DEPTH) return 'refused';
  for (const element of dgmChildren(container)) {
    if (element.localName === 'layoutNode') {
      if ((attr(element, 'name') ?? '') === name) return element;
      continue;
    }
    let next: OoxmlElement | null = null;
    let nextInside = insideForEach;
    if (element.localName === 'forEach') {
      const ref = attr(element, 'ref');
      next = ref ? (forEachByName.get(ref) ?? null) : element;
      nextInside = true;
    } else if (element.localName === 'choose') {
      const branch = chooseBranch(element, insideForEach ? inner : outer);
      if (branch === null) return 'refused';
      next = branch === element ? null : branch;
    }
    if (!next) continue;
    const found = findChildDefinition(
      next,
      name,
      outer,
      inner,
      forEachByName,
      nextInside,
      depth + 1
    );
    if (found !== null) return found;
  }
  return null;
}

function presName(point: DiagramPoint): string {
  return attr(point.prSet, 'presName') ?? '';
}

/**
 * The layout tree of a diagram: one instance per presentation point that the layout
 * definition explains. Null when the definition does not match the stored presentation
 * tree's root, or a cap is reached.
 */
export function buildDiagramLayoutTree(
  model: DiagramModel,
  layoutDef: OoxmlElement
): DiagramLayoutTree | null {
  const rootDefinition = dgmChild(layoutDef, 'layoutNode');
  if (!rootDefinition) return null;
  const forEachByName = indexForEach(layoutDef);
  if (!forEachByName) return null;
  const nodes: DiagramLayoutNode[] = [];
  const make = (
    pres: DiagramPoint,
    definition: OoxmlElement,
    parent: DiagramLayoutNode | null,
    depth: number
  ): DiagramLayoutNode | null => {
    if (nodes.length >= MAX_DIAGRAM_LAYOUT_NODES || depth > MAX_DIAGRAM_TREE_DEPTH) return null;
    const assoc = attr(pres.prSet, 'presAssocID') ?? model.root.modelId;
    const assocPoint = model.points.get(assoc) ?? model.root;
    const context: ConditionContext = { model, point: assocPoint.modelId, pres };
    const body = readBody(definition, context);
    if (!body) return null;
    const presOfAxis = attr(body.presOf, 'axis');
    const node: DiagramLayoutNode = {
      index: nodes.length,
      pres,
      name: presName(pres),
      assoc: assocPoint.modelId,
      assocType: assocPoint.type,
      definition,
      algorithm: body.algorithm,
      shape: readShape(body.shape),
      constraints: body.constraints,
      rules: body.rules,
      showsText: presOfAxis !== undefined && presOfAxis !== 'none',
      styleLabel: attr(pres.prSet, 'presStyleLbl') ?? attr(definition, 'styleLbl') ?? null,
      parent,
      children: [],
      depth,
    };
    nodes.push(node);
    for (const childId of model.presChildren.get(pres.modelId) ?? []) {
      const child = model.points.get(childId);
      if (!child || child.type !== 'pres') continue;
      const childAssoc = attr(child.prSet, 'presAssocID') ?? model.root.modelId;
      const inner: ConditionContext = {
        model,
        point: model.points.has(childAssoc) ? childAssoc : model.root.modelId,
        pres: child,
      };
      const childDefinition = findChildDefinition(
        definition,
        presName(child),
        context,
        inner,
        forEachByName,
        false,
        0
      );
      if (childDefinition === 'refused') return null;
      // A stored point the definition no longer explains draws nothing.
      if (!childDefinition) continue;
      const built = make(child, childDefinition, node, depth + 1);
      if (!built) return null;
      node.children.push(built);
    }
    return node;
  };
  if ((attr(rootDefinition, 'name') ?? '') !== presName(model.presRoot)) return null;
  const root = make(model.presRoot, rootDefinition, null, 0);
  return root ? { model, root, nodes } : null;
}
