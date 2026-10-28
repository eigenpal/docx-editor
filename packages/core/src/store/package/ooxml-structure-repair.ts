/**
 * Read repairs for content that a broken shape would otherwise hide.
 *
 * The read types a paragraph, run, table or row only when its children fit the schema, and a
 * node that does not fit is generic: saved again, but neither shown nor editable. Files break
 * those shapes in ways that still show their text, so the read rebuilds the shape the content
 * shows with before it decides the kind:
 *
 * - A run is rebuilt by `repairedRun`, at its parent, because it may become several runs.
 * - A paragraph's `w:pPr` that only empty markers precede moves first. A `w:pPr` after content
 *   does not apply at all, section break included: it stays generic where it stands, behind an
 *   empty leading `w:pPr`, because many readers find a paragraph's properties by name. Every
 *   `w:pPr` after the leading one stays generic too.
 * - A table's `w:tblPr` elements merge into the first, a later one winning where they name the
 *   same property. Every `w:tblGrid` after the first stays generic.
 * - A paragraph written straight into a row is the first paragraph of the next cell. One after
 *   the last cell shows nowhere, and stays generic where it stands.
 *
 * Anything that still fails its shape stays generic, as written.
 */
import { CT_TBLPR_SEQUENCE } from './ooxml-property-order.ts';
import { isEmptyMarker, repairedRun } from './ooxml-run-repair.ts';
import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';

/** Inline wrappers that hold runs but no properties element of their own. */
const INLINE_WRAPPERS: ReadonlySet<string> = new Set([
  'hyperlink',
  'ins',
  'del',
  'moveFrom',
  'moveTo',
  'fldSimple',
  'smartTag',
  'customXml',
  'dir',
  'bdo',
]);

/** Run content that only a run may hold. */
const RUN_CONTENT: ReadonlySet<string> = new Set([
  't',
  'delText',
  'tab',
  'instrText',
  'delInstrText',
  'fldChar',
]);

/**
 * Whether an element read under `parent` stays generic where it stands instead of taking its
 * known kind: run content written straight into a paragraph, and a `w:pPr` or `w:rPr` inside
 * a link, field or revision. Typed, it would demote the container that holds it, and the
 * container's text with it. It applies to nothing there.
 */
export function staysGenericUnder(localName: string, parent: string): boolean {
  if (parent === 'p') return RUN_CONTENT.has(localName);
  return (localName === 'pPr' || localName === 'rPr') && INLINE_WRAPPERS.has(parent);
}

/** The node and everything under it as generic, so nothing in it counts as structure. */
function genericSubtree(node: OoxmlNode): OoxmlNode {
  if (node.kind === 'textValue') return node;
  return { ...node, kind: 'generic', children: node.children.map(genericSubtree) } as OoxmlNode;
}

/** Run children that a run shows only once rebuilt: text holding elements, an insertion. */
const hidesContent = (node: OoxmlNode): boolean =>
  node.kind === 'generic' &&
  node.namespaceUri === WML_NAMESPACE_URI &&
  (node.localName === 't' || node.localName === 'delText' || node.localName === 'ins');

/** A generic run, or a typed one holding content it shows only once rebuilt. */
const isRepairableRun = (node: OoxmlNode): node is OoxmlElement =>
  node.kind !== 'textValue' &&
  node.namespaceUri === WML_NAMESPACE_URI &&
  node.localName === 'r' &&
  (node.kind === 'generic' || (node.kind === 'run' && node.children.some(hidesContent)));

/** The children of a node of `kind` with id `id`, with the shapes that hide content rebuilt. */
export function repairedChildren(
  kind: string,
  children: readonly OoxmlNode[],
  id: string
): readonly OoxmlNode[] {
  let out = children;
  if (children.some(isRepairableRun)) {
    let changed = false;
    const rebuilt = children.flatMap((child) => {
      const runs = isRepairableRun(child) ? repairedRun(child) : null;
      if (!runs) return [child];
      changed = true;
      return runs;
    });
    if (changed) out = rebuilt;
  }
  if (kind === 'paragraph') return paragraphChildren(out, id);
  if (kind === 'table') return tableChildren(out);
  if (kind === 'tableRow') return rowChildren(out);
  return out;
}

function paragraphChildren(children: readonly OoxmlNode[], id: string): readonly OoxmlNode[] {
  const first = children.findIndex((child) => child.kind === 'paragraphProperties');
  if (first < 0) return children;
  let ordered = children;
  let leading = first === 0;
  if (first > 0 && children.slice(0, first).every(isEmptyMarker)) {
    ordered = [children[first]!, ...children.slice(0, first), ...children.slice(first + 1)];
    leading = true;
  }
  let changed = ordered !== children;
  const kept = ordered.map((child, index) => {
    if (child.kind !== 'paragraphProperties' || (leading && index === 0)) return child;
    changed = true;
    return genericSubtree(child);
  });
  if (!leading) {
    kept.unshift({
      id: `${id}~pPr`,
      kind: 'paragraphProperties',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'pPr',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [],
      children: [],
    } as unknown as OoxmlNode);
  }
  return changed ? kept : children;
}

function tableChildren(children: readonly OoxmlNode[]): readonly OoxmlNode[] {
  const properties = children.filter(
    (child): child is OoxmlElement => child.kind === 'tableProperties'
  );
  const grids = children.filter((child) => child.kind === 'tableGrid');
  if (properties.length <= 1 && grids.length <= 1) return children;
  const merged = properties.length > 1 ? mergedTableProperties(properties) : null;
  const firstGrid = grids[0];
  return children.flatMap((child) => {
    if (child.kind === 'tableProperties' && merged) return child === properties[0] ? [merged] : [];
    if (child.kind === 'tableGrid' && child !== firstGrid) return [genericSubtree(child)];
    return [child];
  });
}

/** One `w:tblPr` holding every property, the later winning where two name the same one. */
function mergedTableProperties(properties: readonly OoxmlElement[]): OoxmlElement {
  const byName = new Map<string, OoxmlNode>();
  const unnamed: OoxmlNode[] = [];
  for (const container of properties) {
    for (const child of container.children) {
      if (child.kind === 'textValue') unnamed.push(child);
      else byName.set(`${child.namespaceUri} ${child.localName}`, child);
    }
  }
  const rank = (node: OoxmlNode) => {
    const at = node.kind === 'textValue' ? -1 : CT_TBLPR_SEQUENCE.indexOf(node.localName);
    return at < 0 ? CT_TBLPR_SEQUENCE.length : at;
  };
  const named = [...byName.values()]
    .map((child, order) => ({ child, order }))
    .sort((a, b) => rank(a.child) - rank(b.child) || a.order - b.order)
    .map(({ child }) => child);
  return { ...properties[0]!, children: [...named, ...unnamed] } as OoxmlElement;
}

function rowChildren(children: readonly OoxmlNode[]): readonly OoxmlNode[] {
  if (!children.some((child) => child.kind === 'paragraph')) return children;
  const out: OoxmlNode[] = [];
  let stray: OoxmlNode[] = [];
  for (const child of children) {
    if (child.kind === 'paragraph') {
      stray.push(child);
      continue;
    }
    if (child.kind === 'tableCell' && stray.length > 0) {
      const at = child.children.findIndex(
        (grand) => !(grand.kind === 'generic' && grand.localName === 'tcPr')
      );
      const split = at < 0 ? child.children.length : at;
      out.push({
        ...child,
        children: [...child.children.slice(0, split), ...stray, ...child.children.slice(split)],
      } as OoxmlNode);
      stray = [];
      continue;
    }
    out.push(child);
  }
  out.push(...stray.map(genericSubtree));
  return out;
}
