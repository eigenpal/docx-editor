/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Constraint resolution and placement over a diagram layout tree.
//
// A layout node's constraints set values on itself (`for="self"`), its children (`ch`) or its
// descendants (`des`), either as a constant (`val`) or as another value times a factor
// (`refType`, `refFor`, `fact`). The node's algorithm then places its children from those
// values inside its own box, and the walk continues one level down. Values are EMU for
// geometry and points for font sizes; `val` sizes are millimetres.
//
// The solve is a pure function of the tree, the frame and a set of overrides. The rule loop
// (`diagram-layout-rules.ts`) changes overrides and solves again.

import { fitOwnBox, placeChildren, type PlacementContext } from './diagram-layout-algorithms.ts';
import type {
  DiagramLayoutNode,
  DiagramLayoutTree,
  LayoutConstraint,
} from './diagram-layout-tree.ts';
import type { DiagramModel, DiagramPointType } from './diagram-layout-model.ts';

export const EMU_PER_MM = 36_000;
export const EMU_PER_POINT = 12_700;
/** Passes over one level's constraints, so a value can refer to one set after it. */
const CONSTRAINT_PASSES = 3;
/** Text size when no constraint sets one, as the gallery definitions start from. */
export const DEFAULT_FONT_SIZE_PT = 65;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NodeState {
  readonly node: DiagramLayoutNode;
  readonly values: Map<string, number>;
  /** The reference value behind each constrained value, before its factor. */
  readonly bases: Map<string, number>;
  /** Values an `equ` constraint ties to another value; rules leave them alone. */
  readonly tied: Set<string>;
  box: Box | null;
  /** Rotation in degrees set by the algorithm (connectors), added to the shape's own. */
  rotation: number;
  /** Geometry an algorithm chose (connectors), replacing the shape type. */
  preset: string | null;
  /** Adjust values by guide name, set by an algorithm, in 1/100000. */
  adjust: Map<string, number> | null;
  flipH: boolean;
  /** Set when the algorithm hides the node (`sp`, or a connector with nothing to join). */
  hidden: boolean;
  /** How far an enclosing layout scaled its solved sizes down (hierarchies). */
  scale: number;
  /**
   * How far the parent's line scaled each of the node's sizes (`w`, `h`) to fit: the box
   * over the solved value. A size grown for text grows the value by the box's growth over
   * this.
   */
  readonly flowScale: Map<string, number>;
  /** A line connector's path, relative to its box, drawn instead of a preset. */
  path: readonly { readonly x: number; readonly y: number }[] | null;
  /**
   * The size custom text (`custT`) keeps, in points, or null. It sizes the node's text and
   * the node's own values that refer to its font size (margins); every other node reads the
   * solved font size.
   */
  readonly customFontSize: number | null;
}

export interface EquGroup {
  readonly type: string;
  readonly members: readonly number[];
}

export interface LayoutSolution {
  readonly tree: DiagramLayoutTree;
  readonly states: readonly NodeState[];
  readonly groups: readonly EquGroup[];
  /**
   * The smallest scale a line of children needed to fit its box: 1 when every line fits,
   * below 1 when the layout overflows and the line shrank.
   */
  readonly overflow: number;
}

const GEOMETRY_TYPES = new Set([
  'w',
  'h',
  'l',
  't',
  'r',
  'b',
  'ctrX',
  'ctrY',
  'lOff',
  'tOff',
  'rOff',
  'bOff',
  'wOff',
  'hOff',
  'ctrXOff',
  'ctrYOff',
  'sp',
  'sibSp',
  'secSibSp',
  'connDist',
  'begPad',
  'endPad',
  'bendDist',
  'stemThick',
  'diam',
  'lMarg',
  'tMarg',
  'rMarg',
  'bMarg',
  'begMarg',
  'endMarg',
  'wArH',
  'hArH',
]);
const FONT_TYPES = new Set(['primFontSz', 'secFontSz']);

export function isFontType(type: string): boolean {
  return FONT_TYPES.has(type);
}

const MARGIN_TYPES = new Set(['lMarg', 'tMarg', 'rMarg', 'bMarg']);

/** A constant in the value's unit: millimetres for geometry, points for text margins. */
function convertConstant(value: number, type: string): number {
  if (MARGIN_TYPES.has(type)) return value * EMU_PER_POINT;
  if (type === 'wArH' || type === 'hArH') return value;
  return GEOMETRY_TYPES.has(type) ? value * EMU_PER_MM : value;
}

/**
 * The unit a value's number counts in: millimetres for geometry, points for font sizes and
 * text margins. Values here hold geometry in EMU and the rest as plain numbers.
 */
function unitOf(type: string): 'mm' | 'pt' | null {
  if (FONT_TYPES.has(type) || MARGIN_TYPES.has(type)) return 'pt';
  if (type === 'wArH' || type === 'hArH') return null;
  return GEOMETRY_TYPES.has(type) ? 'mm' : null;
}

/**
 * A referenced value in the target's unit. The number carries over and takes the target's
 * unit: a 65 pt font size makes a 65 mm height, and a 152.4 mm width a 152.4 pt margin.
 */
function convertReference(value: number, refType: string, type: string): number {
  const from = unitOf(refType);
  const to = unitOf(type);
  if (from === null || to === null) return value;
  // Geometry and margins are stored in EMU, font sizes in points.
  const toNumber = (v: number) =>
    FONT_TYPES.has(refType) ? v : v / (from === 'mm' ? EMU_PER_MM : EMU_PER_POINT);
  const number = toNumber(value);
  if (FONT_TYPES.has(type)) return number;
  return number * (to === 'mm' ? EMU_PER_MM : EMU_PER_POINT);
}

export function matchesPointType(type: DiagramPointType, ptType: string): boolean {
  switch (ptType) {
    case 'all':
      return true;
    case 'node':
    case 'norm':
      return type === 'node';
    case 'nonNorm':
      return type !== 'node';
    case 'asst':
      return type === 'asst';
    case 'nonAsst':
      return type !== 'asst';
    case 'doc':
      return type === 'doc';
    case 'parTrans':
      return type === 'parTrans';
    case 'sibTrans':
      return type === 'sibTrans';
    default:
      return false;
  }
}

export function overrideKey(index: number, type: string): string {
  return `${index}:${type}`;
}

interface SolveContext {
  readonly states: NodeState[];
  readonly overrides: ReadonlyMap<string, number>;
  readonly groups: Map<string, { type: string; members: number[] }>;
  readonly model: DiagramModel;
  /** `lte`/`gte` limits per target value, by the constraint that set each. */
  /** Values an algorithm fixed (index:type); constraints no longer change them. */
  readonly pinned: Set<string>;
  readonly limits: Map<string, Map<string, { readonly op: 'lte' | 'gte'; readonly value: number }>>;
}

/** A value inside every limit recorded for it. */
function limited(context: SolveContext, key: string, value: number): number {
  const limits = context.limits.get(key);
  if (!limits) return value;
  let out = value;
  for (const limit of limits.values()) {
    out = limit.op === 'lte' ? Math.min(out, limit.value) : Math.max(out, limit.value);
  }
  return out;
}

function matches(node: DiagramLayoutNode, forName: string | null, ptType: string): boolean {
  if (forName !== null && node.name !== forName) return false;
  return matchesPointType(node.assocType, ptType);
}

function descendants(node: DiagramLayoutNode, out: DiagramLayoutNode[] = []) {
  for (const child of node.children) {
    out.push(child);
    descendants(child, out);
  }
  return out;
}

function targetsOf(owner: DiagramLayoutNode, constraint: LayoutConstraint): DiagramLayoutNode[] {
  if (constraint.for === 'self') return [owner];
  const pool = constraint.for === 'ch' ? owner.children : descendants(owner);
  return pool.filter((node) => matches(node, constraint.forName, constraint.ptType));
}

function referenceNode(
  owner: DiagramLayoutNode,
  constraint: LayoutConstraint
): DiagramLayoutNode | null {
  if (constraint.refFor === 'self') return owner;
  const pool = constraint.refFor === 'ch' ? owner.children : descendants(owner);
  return pool.find((node) => matches(node, constraint.refForName, constraint.refPtType)) ?? null;
}

/**
 * A value of a node: its box once placed, otherwise its constrained value or one derived
 * from the values that pin the same axis (`r` from `l` and `w`, and so on).
 */
export function readValue(state: NodeState, type: string, parentBox: Box | null): number | null {
  const box = state.box;
  if (box) {
    switch (type) {
      case 'w':
        return box.w;
      case 'h':
        return box.h;
      case 'l':
        return box.x - (parentBox?.x ?? 0);
      case 't':
        return box.y - (parentBox?.y ?? 0);
      case 'r':
        return box.x + box.w - (parentBox?.x ?? 0);
      case 'b':
        return box.y + box.h - (parentBox?.y ?? 0);
      case 'ctrX':
        return box.x + box.w / 2 - (parentBox?.x ?? 0);
      case 'ctrY':
        return box.y + box.h / 2 - (parentBox?.y ?? 0);
      default:
        break;
    }
  }
  const horizontal = type === 'l' || type === 'r' || type === 'w' || type === 'ctrX';
  const vertical = type === 't' || type === 'b' || type === 'h' || type === 'ctrY';
  if (!horizontal && !vertical) return state.values.get(type) ?? null;
  const keys: [string, string, string, string] = horizontal
    ? ['l', 'r', 'w', 'ctrX']
    : ['t', 'b', 'h', 'ctrY'];
  const pinned = keys.filter((key) => state.values.has(key)).length;
  const hasOffsets = keys.some((key) => state.values.has(`${key}Off`));
  // A size reads as constrained, before its offset: `h` of one node equal to `h` of another
  // takes the other's constraint, and its own offset applies on top. Edges and centres come
  // from the same derivation placement uses, offsets included.
  if (type === keys[2] && state.values.has(type)) return state.values.get(type)!;
  if (!hasOffsets && state.values.has(type)) return state.values.get(type)!;
  if (pinned === 0) return null;
  if (pinned < 2 && !state.values.has(keys[2])) return state.values.get(type) ?? null;
  const [start, size] = compositeAxis(
    state.values,
    keys,
    (horizontal ? parentBox?.w : parentBox?.h) ?? 0
  );
  const index = keys.indexOf(type);
  return index === 0 ? start : index === 1 ? start + size : index === 2 ? size : start + size / 2;
}

/** [start, end, size, centre] from any two of them, or null with fewer. */
export function deriveAxis(
  values: ReadonlyMap<string, number>,
  startKey: string,
  endKey: string,
  sizeKey: string,
  centreKey: string
): [number, number, number, number] | null {
  const start = values.get(startKey);
  const end = values.get(endKey);
  const size = values.get(sizeKey);
  const centre = values.get(centreKey);
  let s: number | undefined;
  let z: number | undefined;
  if (size !== undefined) {
    z = size;
    if (start !== undefined) s = start;
    else if (centre !== undefined) s = centre - size / 2;
    else if (end !== undefined) s = end - size;
  } else if (start !== undefined && end !== undefined) {
    s = start;
    z = end - start;
  } else if (start !== undefined && centre !== undefined) {
    s = start;
    z = 2 * (centre - start);
  } else if (end !== undefined && centre !== undefined) {
    z = 2 * (end - centre);
    s = end - z;
  }
  if (s === undefined || z === undefined) return null;
  return [s, s + z, z, s + z / 2];
}

/** One axis of a composite child: start and size from any two pinned values plus offsets. */
export function compositeAxis(
  values: ReadonlyMap<string, number>,
  keys: readonly [string, string, string, string],
  parentSize: number
): [number, number] {
  const [startKey, endKey, sizeKey, centreKey] = keys;
  const derived = deriveAxis(values, startKey, endKey, sizeKey, centreKey);
  let start: number;
  let size: number;
  let anchor: 'start' | 'end' | 'centre' = 'start';
  if (derived) {
    [start, , size] = derived;
    if (!values.has(startKey) && values.has(centreKey)) anchor = 'centre';
    else if (!values.has(startKey) && values.has(endKey)) anchor = 'end';
  } else {
    size = values.get(sizeKey) ?? parentSize;
    if (values.has(startKey)) start = values.get(startKey)!;
    else if (values.has(centreKey)) {
      start = values.get(centreKey)! - size / 2;
      anchor = 'centre';
    } else if (values.has(endKey)) {
      start = values.get(endKey)! - size;
      anchor = 'end';
    } else start = 0;
  }
  // Offsets move the edges after the solve; the pinned edge or centre stays where it was.
  const sizeOff = values.get(`${sizeKey}Off`) ?? 0;
  const startOff = values.get(`${startKey}Off`) ?? 0;
  const endOff = values.get(`${endKey}Off`) ?? 0;
  const centreOff = values.get(`${centreKey}Off`) ?? 0;
  if (sizeOff !== 0) {
    if (anchor === 'centre') start -= sizeOff / 2;
    else if (anchor === 'end') start -= sizeOff;
    size += sizeOff;
  }
  start += startOff + centreOff;
  size += endOff - startOff;
  return [start, size];
}

function parentBoxOf(context: SolveContext, node: DiagramLayoutNode): Box | null {
  return node.parent ? (context.states[node.parent.index]!.box ?? null) : null;
}

function setValue(
  context: SolveContext,
  state: NodeState,
  type: string,
  value: number,
  base: number | null
): number {
  if (context.pinned.has(overrideKey(state.node.index, type))) {
    return state.values.get(type) ?? value;
  }
  const override = context.overrides.get(overrideKey(state.node.index, type));
  let stored = override ?? value;
  // A composite child never grows past its parent's box: the box is a hard limit and the
  // constraint a preferred size.
  const parent = state.node.parent;
  if (parent && parent.algorithm.type === 'composite' && (type === 'w' || type === 'h')) {
    const box = context.states[parent.index]!.box;
    const limit = box ? (type === 'w' ? box.w : box.h) : Infinity;
    if (stored > limit) stored = limit;
  }
  stored = limited(context, overrideKey(state.node.index, type), stored);
  state.values.set(type, stored);
  if (base !== null) state.bases.set(type, base);
  return stored;
}

/** Apply one constraint; false when its reference is not known yet. */
function applyConstraint(
  context: SolveContext,
  owner: DiagramLayoutNode,
  constraint: LayoutConstraint,
  groupKey: string,
  bounds: { state: NodeState; constraint: LayoutConstraint; value: number }[]
): boolean {
  const targets = targetsOf(owner, constraint);
  if (targets.length === 0) return true;
  let value: number | null = null;
  let base: number | null = null;
  let refNode: DiagramLayoutNode | null = null;
  if (constraint.refType !== null) {
    refNode = referenceNode(owner, constraint);
    if (!refNode) return true;
    const refState = context.states[refNode.index]!;
    // Custom text sizes the node's own values that refer to its font size.
    const custom =
      constraint.for === 'self' && refNode === owner && FONT_TYPES.has(constraint.refType)
        ? refState.customFontSize
        : null;
    const raw = custom ?? readValue(refState, constraint.refType, parentBoxOf(context, refNode));
    if (raw === null) return false;
    base = convertReference(raw, constraint.refType, constraint.type);
    value = base * constraint.fact;
  } else if (!Number.isNaN(constraint.val)) {
    value = convertConstant(constraint.val, constraint.type);
  }
  if (constraint.op === 'gte' || constraint.op === 'lte') {
    // A negative limit (an overlap) does not bind: the value its own constraint sets stands.
    if (value === null || value < 0) return true;
    for (const target of targets) {
      const state = context.states[target.index]!;
      const key = overrideKey(target.index, constraint.type);
      let limits = context.limits.get(key);
      if (!limits) context.limits.set(key, (limits = new Map()));
      limits.set(groupKey, { op: constraint.op, value });
      // Values set before the limit was known keep inside it too.
      const current = state.values.get(constraint.type);
      if (current !== undefined) state.values.set(constraint.type, limited(context, key, current));
      bounds.push({ state, constraint, value });
    }
    return true;
  }
  if (constraint.op === 'equ' && targets.length > 1) {
    const existing = context.groups.get(groupKey);
    if (!existing) {
      context.groups.set(groupKey, {
        type: constraint.type,
        members: targets.map((target) => target.index),
      });
    }
  }
  // A font size equal to another node's moves with it: both shrink to the size the least
  // fitting one needs.
  if (
    constraint.op === 'equ' &&
    refNode !== null &&
    constraint.refType === constraint.type &&
    FONT_TYPES.has(constraint.type) &&
    constraint.fact === 1
  ) {
    // Every node the reference names takes part, not only the first.
    const named =
      constraint.refFor === 'self'
        ? [owner]
        : (constraint.refFor === 'ch' ? owner.children : descendants(owner)).filter((node) =>
            matches(node, constraint.refForName, constraint.refPtType)
          );
    const members = targets.map((target) => target.index);
    for (const node of named) if (!members.includes(node.index)) members.push(node.index);
    context.groups.set(`${groupKey}=`, { type: constraint.type, members });
  }
  for (const target of targets) {
    const state = context.states[target.index]!;
    if (value === null) {
      // A constraint naming no value declares the value as 0; it never replaces a set one.
      // An equality naming none only groups its targets.
      if (constraint.op !== 'equ' && !state.values.has(constraint.type)) {
        setValue(context, state, constraint.type, 0, null);
      }
      continue;
    }
    const stored = setValue(context, state, constraint.type, value, base);
    if (constraint.op === 'equ' && refNode !== null) state.tied.add(constraint.type);
    // An equality with another value of the same node holds both ways: a limited target
    // limits its source too (a circle kept round when its height reaches the box).
    if (
      constraint.op === 'equ' &&
      refNode === target &&
      constraint.refType !== null &&
      stored < value &&
      constraint.fact !== 0
    ) {
      state.values.set(constraint.refType, stored / constraint.fact);
    }
  }
  return true;
}

function constraintsOnChildren(
  context: SolveContext,
  owner: DiagramLayoutNode,
  inherited: readonly { owner: DiagramLayoutNode; constraint: LayoutConstraint; key: string }[]
) {
  const bounds: { state: NodeState; constraint: LayoutConstraint; value: number }[] = [];
  for (let pass = 0; pass < CONSTRAINT_PASSES; pass++) {
    bounds.length = 0;
    owner.constraints.forEach((constraint, i) => {
      if (constraint.for === 'self') return;
      applyConstraint(context, owner, constraint, `${owner.index}#${i}`, bounds);
    });
    for (const entry of inherited) {
      // A descendant constraint lands on the owner's descendants as they are reached.
      applyConstraint(context, entry.owner, entry.constraint, entry.key, bounds);
    }
    for (const child of owner.children) {
      child.constraints.forEach((constraint, i) => {
        if (constraint.for !== 'self') return;
        applyConstraint(context, child, constraint, `${child.index}#${i}`, bounds);
      });
    }
    // The owner's own values that read its children (spacing from a child's width).
    owner.constraints.forEach((constraint, i) => {
      if (constraint.for !== 'self' || constraint.refFor === 'self') return;
      applyConstraint(context, owner, constraint, `${owner.index}#${i}`, bounds);
    });
  }
  for (const { state, constraint, value } of bounds) {
    const current = state.values.get(constraint.type);
    if (current === undefined) continue;
    const bounded = constraint.op === 'lte' ? Math.min(current, value) : Math.max(current, value);
    state.values.set(constraint.type, bounded);
  }
}

/** A `dgm:prSet` factor in 1/100000, or `fallback`. */
export function presFactor(state: NodeState, name: string, fallback: number): number {
  const raw = state.node.pres.prSet?.attributes.find((a) => a.localName === name)?.value;
  const value = raw !== undefined && /^-?\d{1,9}$/.test(raw) ? Number(raw) / 100_000 : NaN;
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Resizes and moves the user made to one shape (`custScaleX/Y` about its centre, then
 * `custLinFactNeighborX/Y` as a share of its size), applied after its parent places it.
 */
function applyUserAdjustments(state: NodeState): { dx: number; dy: number } | null {
  const box = state.box;
  if (!box) return null;
  const sx = Math.min(100, Math.max(0, presFactor(state, 'custScaleX', 1)));
  const sy = Math.min(100, Math.max(0, presFactor(state, 'custScaleY', 1)));
  // Neighbour moves count in hierarchies only; lists and composites keep their slots.
  let owner = state.node.parent;
  while (owner && owner.algorithm.type === 'composite') owner = owner.parent;
  // A pyramid sizes and moves its levels itself.
  if (owner?.algorithm.type === 'pyra') return null;
  const moves = owner?.algorithm.type === 'hierRoot' || owner?.algorithm.type === 'hierChild';
  // A sideways move always counts; a vertical one only down a column of siblings.
  const row = owner?.algorithm.type === 'hierChild' ? owner : owner?.parent;
  const direction = row?.algorithm.params.get('linDir') ?? 'fromL';
  const column = direction === 'fromT' || direction === 'fromB';
  const fx = moves ? presFactor(state, 'custLinFactNeighborX', 0) : 0;
  const fy = moves && column ? presFactor(state, 'custLinFactNeighborY', 0) : 0;
  if (sx === 1 && sy === 1 && fx === 0 && fy === 0) return null;
  const w = box.w * sx;
  const h = box.h * sy;
  state.box = {
    x: box.x + (box.w - w) / 2 + fx * w,
    y: box.y + (box.h - h) / 2 + fy * h,
    w,
    h,
  };
  return { dx: fx * w, dy: fy * h };
}

/**
 * Apply each child's own resize and move; a child that moves with a sibling (`moveWith`)
 * and has no move of its own follows that sibling's move.
 */
function applyChildAdjustments(states: readonly NodeState[], node: DiagramLayoutNode): void {
  const moves = new Map<string, { dx: number; dy: number }>();
  const own = new Set<NodeState>();
  for (const child of node.children) {
    const state = states[child.index]!;
    const move = applyUserAdjustments(state);
    if (!move) continue;
    own.add(state);
    if (move.dx !== 0 || move.dy !== 0) moves.set(child.name, move);
  }
  if (moves.size === 0) return;
  for (const child of node.children) {
    const state = states[child.index]!;
    const leader = child.definition.attributes.find((a) => a.localName === 'moveWith')?.value;
    const move = leader === undefined ? undefined : moves.get(leader);
    if (!move || own.has(state) || !state.box) continue;
    state.box = { ...state.box, x: state.box.x + move.dx, y: state.box.y + move.dy };
  }
}

/** Groups of one type that share a member, joined: equality is transitive. */
function mergeGroups(groups: readonly EquGroup[]): EquGroup[] {
  const out: { type: string; members: Set<number> }[] = [];
  for (const group of groups) {
    const members = new Set(group.members);
    for (let i = out.length - 1; i >= 0; i--) {
      const other = out[i]!;
      if (other.type !== group.type || ![...other.members].some((m) => members.has(m))) continue;
      for (const member of other.members) members.add(member);
      out.splice(i, 1);
    }
    out.push({ type: group.type, members });
  }
  return out.map((group) => ({ type: group.type, members: [...group.members] }));
}

/** Override key of a node's custom text size. */
export const CUSTOM_FONT_SIZE = 'custFontSz';

function freshState(node: DiagramLayoutNode, overrides: ReadonlyMap<string, number>): NodeState {
  return {
    node,
    values: new Map(),
    bases: new Map(),
    tied: new Set(),
    box: null,
    rotation: 0,
    preset: null,
    adjust: null,
    flipH: false,
    hidden: false,
    scale: 1,
    flowScale: new Map(),
    path: null,
    customFontSize: overrides.get(overrideKey(node.index, CUSTOM_FONT_SIZE)) ?? null,
  };
}

/**
 * Solve every node's values and box. `frame` is the graphic frame in EMU. Null when an
 * algorithm is outside the supported set.
 */
export function solveDiagramLayout(
  tree: DiagramLayoutTree,
  frame: Readonly<{ cx: number; cy: number }>,
  overrides: ReadonlyMap<string, number> = new Map()
): LayoutSolution | null {
  const context: SolveContext = {
    states: tree.nodes.map((node) => freshState(node, overrides)),
    overrides,
    groups: new Map(),
    limits: new Map(),
    pinned: new Set(),
    model: tree.model,
  };
  const rootState = context.states[tree.root.index]!;
  rootState.box = { x: 0, y: 0, w: frame.cx, h: frame.cy };
  const bounds: { state: NodeState; constraint: LayoutConstraint; value: number }[] = [];
  for (let pass = 0; pass < CONSTRAINT_PASSES; pass++) {
    tree.root.constraints.forEach((constraint, i) => {
      if (constraint.for === 'self')
        applyConstraint(context, tree.root, constraint, `r#${i}`, bounds);
    });
  }
  let overflow = 1;
  const placement: PlacementContext = {
    model: tree.model,
    overflow: (scale) => {
      if (scale < overflow) overflow = scale;
    },
    states: context.states,
    readValue: (state, type) => readValue(state, type, parentBoxOf(context, state.node)),
    pin: (state, type) => {
      context.pinned.add(overrideKey(state.node.index, type));
    },
    resolveSelf: (state, except) => {
      state.node.constraints.forEach((constraint, i) => {
        if (constraint.for !== 'self' || constraint.type === except) return;
        applyConstraint(context, state.node, constraint, `${state.node.index}#${i}`, bounds);
      });
    },
  };
  type Inherited = readonly {
    owner: DiagramLayoutNode;
    constraint: LayoutConstraint;
    key: string;
  }[];
  // Connectors join shapes anywhere in the tree, so they lay out once everything else has.
  const connectors: { node: DiagramLayoutNode; inherited: Inherited }[] = [];
  const visit = (node: DiagramLayoutNode, inherited: Inherited, now = false): boolean => {
    if (node.algorithm.type === 'conn' && !now) {
      connectors.push({ node, inherited });
      return true;
    }
    const state = context.states[node.index]!;
    const own = node.constraints
      .map((constraint, i) => ({ owner: node, constraint, key: `${node.index}#${i}` }))
      .filter((entry) => entry.constraint.for === 'des');
    const passed = [...inherited, ...own];
    fitOwnBox(state);
    constraintsOnChildren(context, node, inherited);
    if (!placeChildren(placement, state)) return false;
    applyChildAdjustments(context.states, node);
    if (node.algorithm.type === 'conn') constraintsOnChildren(context, node, inherited);
    for (const child of node.children) {
      if (!visit(child, passed)) return false;
    }
    return true;
  };
  if (!visit(tree.root, [])) return null;
  for (let i = 0; i < connectors.length; i++) {
    const { node, inherited } = connectors[i]!;
    if (!visit(node, inherited, true)) return null;
  }
  for (const state of context.states) {
    if (!state.values.has('primFontSz') && state.node.showsText) {
      setValue(context, state, 'primFontSz', DEFAULT_FONT_SIZE_PT, null);
    }
  }
  return {
    tree,
    states: context.states,
    groups: mergeGroups([...context.groups.values()]),
    overflow,
  };
}
