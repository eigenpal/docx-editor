import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from '../package/ooxml-tree.ts';
import type { RevisionSite } from './tree-op-revisions.ts';

const attr = (node: OoxmlElement, name: string) =>
  node.attributes.find((a) => a.namespaceUri === WML_NAMESPACE_URI && a.localName === name)?.value;
export interface OrdinaryMoveRange {
  start: OoxmlElement;
  end?: OoxmlElement;
  parent: OoxmlElement;
  content: readonly OoxmlNode[];
  direction: 'from' | 'to';
  name?: string;
  supported: boolean;
}
const cache = new WeakMap<OoxmlNode, readonly OrdinaryMoveRange[]>();
const containsRangeCache = new WeakMap<OoxmlNode, boolean>();
function containsRange(node: OoxmlNode): boolean {
  if (node.kind === 'textValue') return false;
  const cached = containsRangeCache.get(node);
  if (cached !== undefined) return cached;
  const result =
    node.kind === 'moveFromRangeStart' ||
    node.kind === 'moveToRangeStart' ||
    node.children.some(containsRange);
  containsRangeCache.set(node, result);
  return result;
}

/** Range decisions over ordinary tracked text are independent of the text wrappers. */
export function ordinaryMoveRanges(root: OoxmlNode): readonly OrdinaryMoveRange[] {
  const cached = cache.get(root);
  if (cached) return cached;
  const ranges: OrdinaryMoveRange[] = [];
  const wrapperNames = new Set<string>();
  const containsWrapper = (node: OoxmlNode): boolean =>
    node.kind !== 'textValue' &&
    (['revisionMoveFrom', 'revisionMoveTo'].includes(node.kind) ||
      node.children.some(containsWrapper));
  // Existing wrapper moves may start/end in different paragraphs. Find those
  // names across the story before classifying paragraph-local ordinary ranges.
  const open: { name: string; id: string | undefined; direction: string }[] = [];
  const scanWrappers = (node: OoxmlNode): void => {
    if (
      node.kind === 'textValue' ||
      (node.namespaceUri === WML_NAMESPACE_URI && /Change$/.test(node.localName))
    )
      return;
    if (node.kind === 'moveFromRangeStart' || node.kind === 'moveToRangeStart') {
      const name = attr(node, 'name');
      if (name !== undefined)
        open.push({ name, id: attr(node, 'id'), direction: node.kind.replace('Start', '') });
    } else if (node.kind === 'moveFromRangeEnd' || node.kind === 'moveToRangeEnd') {
      let index = -1;
      for (let at = open.length - 1; at >= 0; at--) {
        const range = open[at]!;
        if (range.id === attr(node, 'id') && range.direction === node.kind.replace('End', '')) {
          index = at;
          break;
        }
      }
      if (index >= 0) open.splice(index, 1);
    } else if (node.kind === 'revisionMoveFrom' || node.kind === 'revisionMoveTo') {
      for (const range of open) wrapperNames.add(range.name);
    }
    for (const child of node.children) scanWrappers(child);
  };
  if (containsRange(root)) scanWrappers(root);
  // Initially support the paragraph-local run sequences verified with Word. Other
  // shapes remain explicit read-only decisions instead of being silently discarded.
  const safeProperties = (node: OoxmlNode): boolean =>
    node.kind === 'textValue' ||
    (!/Change$|^(ins|del|moveFrom|moveTo)$/.test(node.localName) &&
      node.children.every(safeProperties));
  const safeContent = (node: OoxmlNode): boolean =>
    node.kind === 'textValue' ||
    (node.kind === 'runProperties' && safeProperties(node)) ||
    (['run', 'text', 'deletedText', 'revisionInsert', 'revisionDelete'].includes(node.kind) &&
      node.children.every(safeContent));
  const visit = (node: OoxmlNode): void => {
    if (
      !containsRange(node) ||
      node.kind === 'textValue' ||
      (node.namespaceUri === WML_NAMESPACE_URI && /Change$/.test(node.localName))
    )
      return;
    const endsByKey = new Map<string, number[]>();
    for (const [at, child] of node.children.entries()) {
      if (child.kind !== 'moveFromRangeEnd' && child.kind !== 'moveToRangeEnd') continue;
      const key = `${child.kind}:${attr(child, 'id')}`;
      const ends = endsByKey.get(key) ?? [];
      ends.push(at);
      endsByKey.set(key, ends);
    }
    for (const [index, start] of node.children.entries()) {
      if (start.kind !== 'moveFromRangeStart' && start.kind !== 'moveToRangeStart') continue;
      if (wrapperNames.has(attr(start, 'name') ?? '')) continue;
      const direction = start.kind === 'moveFromRangeStart' ? 'from' : 'to';
      const endKind = direction === 'from' ? 'moveFromRangeEnd' : 'moveToRangeEnd';
      const ends = endsByKey.get(`${endKind}:${attr(start, 'id')}`) ?? [];
      const endIndex = ends.length === 1 && ends[0]! > index ? ends[0]! : -1;
      const content = endIndex < 0 ? [] : node.children.slice(index + 1, endIndex);
      if (content.some(containsWrapper)) {
        const name = attr(start, 'name');
        if (name !== undefined) wrapperNames.add(name);
        continue;
      }
      const end = endIndex < 0 ? undefined : (node.children[endIndex] as OoxmlElement);
      ranges.push({
        start,
        end,
        parent: node,
        content,
        direction,
        name: attr(start, 'name'),
        supported:
          node.kind === 'paragraph' &&
          !!end &&
          attr(start, 'name') !== undefined &&
          attr(start, 'id') !== undefined &&
          attr(start, 'author') !== undefined &&
          content.every(safeContent),
      });
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  const identities = new Map<string, OrdinaryMoveRange[]>();
  for (const range of ranges) {
    if (range.name !== undefined && wrapperNames.has(range.name)) range.supported = false;
    const key = `${range.direction}:${range.name}`;
    const own = identities.get(key) ?? [];
    own.push(range);
    identities.set(key, own);
  }
  for (const own of identities.values())
    if (own.length > 1) for (const range of own) range.supported = false;
  const unsupportedNames = new Set(
    ranges.filter((range) => !range.supported).map((range) => range.name)
  );
  for (const range of ranges) if (unsupportedNames.has(range.name)) range.supported = false;
  cache.set(root, ranges);
  return ranges;
}

export interface OrdinaryMovePlan {
  selected: Set<string>;
  implicit: Set<string>;
  dependencies: string[][];
  remove: Set<string>;
  markers: Set<string>;
  relocate: Map<string, readonly OoxmlNode[]>;
}

/** Native move rejection carries destination revisions back to the source position. */
export function planOrdinaryMoves(
  root: OoxmlNode,
  sites: readonly RevisionSite[],
  requested: ReadonlySet<string>,
  action: 'accept' | 'reject'
): OrdinaryMovePlan {
  const selected = new Set(requested);
  const result: OrdinaryMovePlan = {
    selected,
    dependencies: [],
    implicit: new Set(),
    remove: new Set(),
    markers: new Set(),
    relocate: new Map(),
  };
  const ranges = ordinaryMoveRanges(root);
  const byName = new Map<string, OrdinaryMoveRange[]>();
  for (const range of ranges) {
    if (!range.supported || range.name === undefined) continue;
    const own = byName.get(range.name) ?? [];
    own.push(range);
    byName.set(range.name, own);
  }
  const siteIds = new Set(sites.map((site) => site.node.id));
  const selectDescendants = (node: OoxmlNode, dependencies: string[]): void => {
    if (siteIds.has(node.id)) {
      selected.add(node.id);
      dependencies.push(node.id);
    }
    if (node.kind !== 'textValue')
      for (const child of node.children) selectDescendants(child, dependencies);
  };
  const emptied = (range: OrdinaryMoveRange) =>
    range.content.length > 0 &&
    range.content.every(
      (node) =>
        requested.has(node.id) &&
        (action === 'accept' ? node.kind === 'revisionDelete' : node.kind === 'revisionInsert')
    );
  for (const pair of byName.values()) {
    const from = pair.find((range) => range.direction === 'from');
    const to = pair.find((range) => range.direction === 'to');
    const explicit = pair.some((range) => requested.has(range.start.id));
    if (!explicit && !pair.some(emptied)) continue;
    const dependencies = pair.map((range) => range.start.id);
    result.dependencies.push(dependencies);
    if (!explicit)
      for (const range of pair.filter(emptied))
        for (const node of range.content) selectDescendants(node, dependencies);
    for (const range of pair) {
      selected.add(range.start.id);
      if (!explicit) result.implicit.add(range.start.id);
      result.markers.add(range.start.id);
      result.markers.add(range.end!.id);
    }
    if (!explicit) continue;
    if (from && (to || action === 'accept')) {
      for (const node of from.content) {
        result.remove.add(node.id);
        selectDescendants(node, dependencies);
      }
    }
    if (from && to && action === 'reject') {
      result.relocate.set(from.start.id, to.content);
      for (const node of to.content) result.remove.add(node.id);
    }
  }
  return result;
}
