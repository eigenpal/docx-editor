/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The diagram data model as the layout engine reads it: points, the content tree (`parOf`),
// the presentation tree (`presParOf`) and the content each presentation point shows
// (`presOf`). Also the axis walk and the `if` functions a layout definition evaluates.
//
// Every list here is bounded: a data model past the caps is refused, never truncated, so the
// diagram keeps its placeholder rather than drawing part of itself.

import {
  DIAGRAM_NAMESPACE_URI,
  isElement,
  schemaAttributeValue,
  type OoxmlElement,
} from '@docx-editor.dev/core/store';

const DGM = DIAGRAM_NAMESPACE_URI;

/** Points one data model may hold; the presentation tree is several per content point. */
export const MAX_DIAGRAM_MODEL_POINTS = 4096;
/** Nodes an axis walk may select; larger selections refuse the diagram. */
export const MAX_AXIS_SELECTION = 512;
/** Content and presentation tree depth. */
export const MAX_DIAGRAM_TREE_DEPTH = 32;

export type DiagramPointType = 'doc' | 'node' | 'asst' | 'parTrans' | 'sibTrans' | 'pres';

export interface DiagramPoint {
  readonly modelId: string;
  readonly type: DiagramPointType;
  readonly element: OoxmlElement;
  readonly prSet: OoxmlElement | null;
  readonly spPr: OoxmlElement | null;
  readonly text: OoxmlElement | null;
}

export interface DiagramModel {
  readonly points: ReadonlyMap<string, DiagramPoint>;
  /** Content children of a point, in `srcOrd` order. */
  readonly contentChildren: ReadonlyMap<string, readonly string[]>;
  readonly contentParent: ReadonlyMap<string, string>;
  /** The sibling and parent transition points of a content child. */
  readonly sibTransOf: ReadonlyMap<string, string>;
  readonly parTransOf: ReadonlyMap<string, string>;
  /** Transition point → the content child whose connection names it. */
  readonly transitionOwner: ReadonlyMap<string, string>;
  /** Presentation children of a presentation point, in `srcOrd` order. */
  readonly presChildren: ReadonlyMap<string, readonly string[]>;
  readonly presParent: ReadonlyMap<string, string>;
  /** Content points a presentation point shows, in `srcOrd` order. */
  readonly presOf: ReadonlyMap<string, readonly string[]>;
  readonly root: DiagramPoint;
  readonly presRoot: DiagramPoint;
}

export function attr(element: OoxmlElement | null | undefined, name: string): string | undefined {
  return element ? schemaAttributeValue(element.attributes, name) : undefined;
}

export function dgmChild(element: OoxmlElement | null | undefined, localName: string) {
  if (!element) return null;
  for (const node of element.children) {
    if (isElement(node) && node.namespaceUri === DGM && node.localName === localName) return node;
  }
  return null;
}

export function* dgmChildren(element: OoxmlElement | null | undefined, localName?: string) {
  if (!element) return;
  for (const node of element.children) {
    if (!isElement(node) || node.namespaceUri !== DGM) continue;
    if (localName === undefined || node.localName === localName) yield node;
  }
}

const POINT_TYPES = new Set<DiagramPointType>([
  'doc',
  'node',
  'asst',
  'parTrans',
  'sibTrans',
  'pres',
]);

function ordinal(value: string | undefined): number {
  const parsed = value === undefined ? 0 : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pushOrdered(
  map: Map<string, { id: string; ord: number }[]>,
  key: string,
  id: string,
  ord: number
) {
  let list = map.get(key);
  if (!list) map.set(key, (list = []));
  list.push({ id, ord });
}

function sorted(map: Map<string, { id: string; ord: number }[]>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [key, list] of map) {
    // A stable sort keeps file order between equal ordinals.
    out.set(
      key,
      list
        .map((entry, index) => ({ ...entry, index }))
        .sort((a, b) => a.ord - b.ord || a.index - b.index)
        .map((entry) => entry.id)
    );
  }
  return out;
}

/** The data model, or null when it is malformed or past a cap. */
export function readDiagramModel(dataModel: OoxmlElement): DiagramModel | null {
  const points = new Map<string, DiagramPoint>();
  for (const pt of dgmChildren(dgmChild(dataModel, 'ptLst'), 'pt')) {
    const modelId = attr(pt, 'modelId');
    if (!modelId || points.has(modelId)) continue;
    if (points.size >= MAX_DIAGRAM_MODEL_POINTS) return null;
    const rawType = attr(pt, 'type') ?? 'node';
    const type = POINT_TYPES.has(rawType as DiagramPointType)
      ? (rawType as DiagramPointType)
      : 'node';
    points.set(modelId, {
      modelId,
      type,
      element: pt,
      prSet: dgmChild(pt, 'prSet'),
      spPr: dgmChild(pt, 'spPr'),
      text: dgmChild(pt, 't'),
    });
  }
  const content = new Map<string, { id: string; ord: number }[]>();
  const pres = new Map<string, { id: string; ord: number }[]>();
  const shows = new Map<string, { id: string; ord: number }[]>();
  const contentParent = new Map<string, string>();
  const presParent = new Map<string, string>();
  const sibTransOf = new Map<string, string>();
  const parTransOf = new Map<string, string>();
  const transitionOwner = new Map<string, string>();
  let cxnCount = 0;
  for (const cxn of dgmChildren(dgmChild(dataModel, 'cxnLst'), 'cxn')) {
    if (++cxnCount > MAX_DIAGRAM_MODEL_POINTS * 2) return null;
    const src = attr(cxn, 'srcId');
    const dest = attr(cxn, 'destId');
    if (!src || !dest || !points.has(src) || !points.has(dest) || src === dest) continue;
    const type = attr(cxn, 'type') ?? 'parOf';
    const ord = ordinal(attr(cxn, 'srcOrd'));
    if (type === 'parOf') {
      if (contentParent.has(dest)) continue;
      contentParent.set(dest, src);
      pushOrdered(content, src, dest, ord);
      const sib = attr(cxn, 'sibTransId');
      const par = attr(cxn, 'parTransId');
      if (sib && points.has(sib)) {
        sibTransOf.set(dest, sib);
        transitionOwner.set(sib, dest);
      }
      if (par && points.has(par)) {
        parTransOf.set(dest, par);
        if (!transitionOwner.has(par)) transitionOwner.set(par, dest);
      }
    } else if (type === 'presParOf') {
      if (presParent.has(dest)) continue;
      presParent.set(dest, src);
      pushOrdered(pres, src, dest, ord);
    } else if (type === 'presOf') {
      pushOrdered(shows, dest, src, ord);
    }
  }
  let root: DiagramPoint | null = null;
  for (const point of points.values()) {
    if (point.type === 'doc') {
      root = point;
      break;
    }
  }
  if (!root) return null;
  let presRoot: DiagramPoint | null = null;
  for (const point of points.values()) {
    if (point.type !== 'pres' || presParent.has(point.modelId)) continue;
    if (attr(point.prSet, 'presAssocID') !== root.modelId) continue;
    presRoot = point;
    break;
  }
  if (!presRoot) return null;
  const model: DiagramModel = {
    points,
    contentChildren: sorted(content),
    contentParent,
    sibTransOf,
    parTransOf,
    transitionOwner,
    presChildren: sorted(pres),
    presParent,
    presOf: sorted(shows),
    root,
    presRoot,
  };
  // Cycles in either tree would loop every walk below; refuse them once here.
  if (
    !acyclic(model.contentChildren, root.modelId) ||
    !acyclic(model.presChildren, presRoot.modelId)
  )
    return null;
  return model;
}

function acyclic(children: ReadonlyMap<string, readonly string[]>, start: string): boolean {
  const seen = new Set<string>([start]);
  const stack: { id: string; depth: number }[] = [{ id: start, depth: 0 }];
  while (stack.length > 0) {
    const { id, depth } = stack.pop()!;
    if (depth > MAX_DIAGRAM_TREE_DEPTH) return false;
    for (const next of children.get(id) ?? []) {
      if (seen.has(next)) return false;
      seen.add(next);
      stack.push({ id: next, depth: depth + 1 });
    }
  }
  return true;
}

// ---- Axis walk (§21.4.2.14) ----

function matchesPtType(model: DiagramModel, id: string, ptType: string): boolean {
  const type = model.points.get(id)?.type;
  switch (ptType) {
    case 'all':
      return true;
    case 'doc':
      return type === 'doc';
    case 'node':
      return type === 'node';
    case 'norm':
      return type === 'node';
    case 'nonNorm':
      return type !== 'node';
    case 'asst':
      return type === 'asst';
    case 'nonAsst':
      return type !== 'asst';
    case 'parTrans':
      return type === 'parTrans';
    case 'sibTrans':
      return type === 'sibTrans';
    case 'pres':
      return type === 'pres';
    default:
      return false;
  }
}

/** Content children including assistants, which share the `parOf` list. */
function childrenOf(model: DiagramModel, id: string): readonly string[] {
  return model.contentChildren.get(id) ?? [];
}

function stepAxis(model: DiagramModel, id: string, axis: string, out: string[]): void {
  const push = (value: string) => {
    if (out.length < MAX_AXIS_SELECTION + 1) out.push(value);
  };
  switch (axis) {
    case 'self':
      push(id);
      return;
    case 'ch':
      for (const child of childrenOf(model, id)) push(child);
      return;
    case 'des':
    case 'desOrSelf': {
      if (axis === 'desOrSelf') push(id);
      const stack = [...childrenOf(model, id)].reverse();
      while (stack.length > 0 && out.length <= MAX_AXIS_SELECTION) {
        const next = stack.pop()!;
        push(next);
        const below = childrenOf(model, next);
        for (let i = below.length - 1; i >= 0; i--) stack.push(below[i]!);
      }
      return;
    }
    case 'par': {
      const parent = model.contentParent.get(id) ?? model.contentParent.get(ownerOf(model, id));
      if (parent) push(parent);
      return;
    }
    case 'ancst':
    case 'ancstOrSelf': {
      if (axis === 'ancstOrSelf') push(id);
      let parent = model.contentParent.get(id);
      let guard = 0;
      while (parent && guard++ < MAX_DIAGRAM_TREE_DEPTH) {
        push(parent);
        parent = model.contentParent.get(parent);
      }
      return;
    }
    case 'followSib':
    case 'precedSib': {
      // Transitions are siblings too: a node's sibling transition follows it.
      const owner = ownerOf(model, id);
      const parent = model.contentParent.get(owner);
      if (!parent) return;
      const siblings = childrenOf(model, parent);
      const index = siblings.indexOf(owner);
      const sequence: string[] = [];
      siblings.forEach((sibling, i) => {
        sequence.push(sibling);
        // The transition after the last sibling is hidden (`hideLastTrans`, on by default).
        const trans = i < siblings.length - 1 ? model.sibTransOf.get(sibling) : undefined;
        if (trans) sequence.push(trans);
      });
      const at = sequence.indexOf(id === owner ? owner : id);
      if (index < 0 || at < 0) return;
      if (axis === 'followSib') for (let i = at + 1; i < sequence.length; i++) push(sequence[i]!);
      else for (let i = at - 1; i >= 0; i--) push(sequence[i]!);
      return;
    }
    case 'root':
      push(model.root.modelId);
      return;
    default:
      return;
  }
}

function ownerOf(model: DiagramModel, id: string): string {
  return model.transitionOwner.get(id) ?? id;
}

function listAttribute(value: string | undefined): string[] {
  return value ? value.trim().split(/\s+/).slice(0, 8) : [];
}

function integerAt(values: readonly string[], index: number, fallback: number): number {
  const raw = values[Math.min(index, values.length - 1)];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : fallback;
}

/**
 * The points an `axis`/`ptType`/`st`/`cnt`/`step` selection names from `context`, or null
 * when the selection passes MAX_AXIS_SELECTION.
 */
export function selectAxis(
  model: DiagramModel,
  context: string,
  element: OoxmlElement
): string[] | null {
  const axes = listAttribute(attr(element, 'axis'));
  if (axes.length === 0) axes.push('none');
  const types = listAttribute(attr(element, 'ptType'));
  const starts = listAttribute(attr(element, 'st'));
  const counts = listAttribute(attr(element, 'cnt'));
  const steps = listAttribute(attr(element, 'step'));
  let current = [context];
  for (let i = 0; i < axes.length; i++) {
    const axis = axes[i]!;
    if (axis === 'none') return [];
    const next: string[] = [];
    for (const id of current) {
      const selected: string[] = [];
      stepAxis(model, id, axis, selected);
      const type = types[Math.min(i, types.length - 1)] ?? 'all';
      const filtered = selected.filter((value) => matchesPtType(model, value, type));
      const start = Math.max(1, integerAt(starts, i, 1));
      const count = Math.max(0, integerAt(counts, i, 0));
      const step = integerAt(steps, i, 1) || 1;
      let taken = 0;
      if (step > 0) {
        for (let k = start - 1; k < filtered.length; k += step) {
          if (count > 0 && taken >= count) break;
          next.push(filtered[k]!);
          taken++;
        }
      } else {
        for (let k = filtered.length - start; k >= 0; k += step) {
          if (count > 0 && taken >= count) break;
          next.push(filtered[k]!);
          taken++;
        }
      }
      if (next.length > MAX_AXIS_SELECTION) return null;
    }
    current = next;
  }
  return current;
}

/** Depth in the content tree: the document is 0, top-level content 1. */
export function contentDepth(model: DiagramModel, id: string): number {
  let depth = 0;
  let current = model.contentParent.get(ownerOf(model, id));
  let guard = 0;
  while (current && guard++ < MAX_DIAGRAM_TREE_DEPTH) {
    depth++;
    current = model.contentParent.get(current);
  }
  return depth;
}

/** Levels below a point: 0 for a leaf. */
export function levelsBelow(model: DiagramModel, id: string, guard = 0): number {
  if (guard > MAX_DIAGRAM_TREE_DEPTH) return 0;
  let deepest = 0;
  for (const child of childrenOf(model, id)) {
    deepest = Math.max(deepest, 1 + levelsBelow(model, child, guard + 1));
  }
  return deepest;
}

/** 1-based position of a point among its parent's children of the same type. */
export function siblingPosition(model: DiagramModel, id: string): { pos: number; count: number } {
  const owner = ownerOf(model, id);
  const parent = model.contentParent.get(owner);
  const type = model.points.get(id)?.type;
  if (!parent) return { pos: 1, count: 1 };
  const siblings = childrenOf(model, parent).filter((value) =>
    owner === id ? model.points.get(value)?.type === type : model.sibTransOf.has(value)
  );
  const index = siblings.indexOf(owner);
  return { pos: index + 1, count: siblings.length };
}
