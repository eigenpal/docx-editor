/**
 * Read repairs for content that a broken shape would otherwise hide or misplace.
 *
 * The read types a paragraph, run, table or row only when its children fit the schema, and a
 * node that does not fit is generic: saved again, but neither shown nor editable. Files break
 * those shapes in ways that still show their text, so the read rebuilds the shape the content
 * shows with before it decides the kind:
 *
 * - A run is rebuilt by `repairedRun`, at its parent, because it may become several runs.
 * - A paragraph or table written inside a paragraph shows as part of it, at its parent: its
 *   runs join the paragraph, an inner paragraph's `w:pPr` adds to the paragraph's own, and the
 *   paragraph's own mark follows as an empty paragraph.
 * - A paragraph's `w:pPr` elements before its content merge into one leading `w:pPr`, a later
 *   one adding to the earlier. A `w:pPr` after content does not apply at all, section break
 *   included: it stays generic where it stands, behind an empty leading `w:pPr` when there is
 *   no other, because many readers find a paragraph's properties by name.
 * - A table's `w:tblPr` elements merge into the first, a later element replacing an earlier one
 *   of the same name. Every `w:tblGrid` after the first stays generic.
 * - A paragraph written straight into a row is the first paragraph of the next cell. One after
 *   the last cell shows nowhere, and stays generic where it stands.
 * - Text in a `w:t` or `w:delText` loses its leading and trailing white space, and a tab in it
 *   is a space, unless `xml:space="preserve"` is on the element itself or on the part's root.
 *   A line break in any text is a space.
 *
 * Anything that still fails its shape stays generic, as written.
 */
import { mergedPropertyList } from './ooxml-property-merge.ts';
import { CT_PPR_SEQUENCE, CT_TBLPR_SEQUENCE } from './ooxml-property-order.ts';
import { attributesFitKind, isEmptyMarker, repairedRun } from './ooxml-run-repair.ts';
import { WML_NAMESPACE_URI, validKnownKind } from './ooxml-shared.ts';
import type { OoxmlAttribute, OoxmlElement, OoxmlNode } from './ooxml-tree.ts';

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

/** Nesting deeper than this inside one paragraph stays as written. */
const MAX_FLATTEN_DEPTH = 8;

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

const isWmlNamed = (node: OoxmlNode, localName: string): node is OoxmlElement =>
  node.kind !== 'textValue' &&
  node.namespaceUri === WML_NAMESPACE_URI &&
  node.localName === localName;

/** Run children that a run shows only once rebuilt: text holding elements, an insertion, a run. */
const hidesContent = (node: OoxmlNode): boolean =>
  node.kind === 'generic' &&
  node.namespaceUri === WML_NAMESPACE_URI &&
  (node.localName === 't' || node.localName === 'delText' || node.localName === 'ins');

/** A generic run, or a typed one holding content it shows only once rebuilt. */
const isRepairableRun = (node: OoxmlNode): node is OoxmlElement =>
  isWmlNamed(node, 'r') &&
  (node.kind === 'generic' || (node.kind === 'run' && node.children.some(hidesContent)));

/**
 * The children of a node of `kind` with id `id` and `attributes`, with the shapes that hide
 * content rebuilt.
 */
export function repairedChildren(
  opened: {
    readonly candidateKind: string;
    readonly attributes: readonly OoxmlAttribute[];
    readonly metadata: object;
  },
  children: readonly OoxmlNode[],
  id: string
): readonly OoxmlNode[] {
  const kind = opened.candidateKind;
  if (kind === 'text' || kind === 'deletedText') {
    return displayedText(
      children,
      ownXmlSpace(opened.attributes) ?? rootPreserves.get(opened.metadata) ?? false
    );
  }
  let out = children;
  if (children.some(isNestingParagraph)) {
    out = children.flatMap((child) =>
      isNestingParagraph(child) ? (flattenedParagraph(child) ?? [child]) : [child]
    );
  }
  if (out.some(isRepairableRun)) {
    let changed = false;
    const rebuilt = out.flatMap((child) => {
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

/**
 * Whether each part read keeps white space by its root's `xml:space`. Of the ancestors of a
 * text element, only the part root's `xml:space` counts; a paragraph's or run's does not.
 */
const rootPreserves = new WeakMap<object, boolean>();

/** An element's own `xml:space`: true to preserve, false for default, undefined when unset. */
function ownXmlSpace(attributes: readonly OoxmlAttribute[]): boolean | undefined {
  const space = attributes.find((attribute) => attribute.kind === 'xmlSpace');
  return space ? space.value === 'preserve' : undefined;
}

/** Record the `xml:space` of the root of the part `metadata` reads. */
export function notePartRoot(metadata: object, attributes: readonly OoxmlAttribute[]): void {
  rootPreserves.set(metadata, ownXmlSpace(attributes) ?? false);
}

/** A text element's text as it shows: see the module comment. */
function displayedText(children: readonly OoxmlNode[], preserve: boolean): readonly OoxmlNode[] {
  const values = children.filter((child) => child.kind === 'textValue');
  if (values.length !== children.length || values.length === 0) return children;
  let changed = false;
  const out = values.map((child, index) => {
    if (child.kind !== 'textValue') return child;
    let value = child.value.replace(/\r\n?|\n/g, ' ');
    if (!preserve) {
      value = value.replace(/\t/g, ' ');
      if (index === 0) value = value.replace(/^ +/, '');
      if (index === values.length - 1) value = value.replace(/ +$/, '');
    }
    if (value === child.value) return child;
    changed = true;
    return { ...child, value };
  });
  if (!changed) return children;
  return out.filter((child) => child.kind !== 'textValue' || child.value !== '');
}

/** An empty leading `w:pPr` for paragraph `id`. */
function emptyParagraphProperties(id: string): OoxmlNode {
  return {
    id: `${id}~pPr`,
    kind: 'paragraphProperties',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'pPr',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [],
  } as unknown as OoxmlNode;
}

const isParagraphProperties = (node: OoxmlNode): node is OoxmlElement =>
  node.kind === 'paragraphProperties' || (node.kind === 'generic' && isWmlNamed(node, 'pPr'));

/**
 * The children with each paragraph written inside the paragraph replaced by its content, and
 * the `w:pPr` of each inner paragraph collected in `nested`.
 */
function flattened(
  children: readonly OoxmlNode[],
  nested: OoxmlElement[],
  depth: number
): OoxmlNode[] {
  const out: OoxmlNode[] = [];
  for (const child of children) {
    if (depth < MAX_FLATTEN_DEPTH && isWmlNamed(child, 'p')) {
      const inner = child.children.filter((grand) => {
        if (!isParagraphProperties(grand)) return true;
        nested.push(grand);
        return false;
      });
      out.push(...flattened(inner, nested, depth + 1));
    } else {
      out.push(child);
    }
  }
  return out;
}

/** A paragraph holding a paragraph or table written inside it. */
const isNestingParagraph = (node: OoxmlNode): node is OoxmlElement =>
  isWmlNamed(node, 'p') &&
  (node.children as readonly OoxmlNode[]).some(
    (child) => child.kind === 'table' || isWmlNamed(child, 'p')
  );

/** `node` with `child` at `index` replaced. */
const withChildAt = (node: OoxmlElement, index: number, child: OoxmlNode): OoxmlElement =>
  ({
    ...node,
    children: node.children.map((current, at) => (at === index ? child : current)),
  }) as OoxmlElement;

/**
 * The table with `content` at the start of its first cell's first paragraph, or null when that
 * paragraph is missing or would not take it.
 */
function withLeadingContent(
  table: OoxmlElement,
  content: readonly OoxmlNode[]
): OoxmlElement | null {
  if (content.length === 0) return table;
  const rowAt = table.children.findIndex((child) => child.kind === 'tableRow');
  const row = table.children[rowAt] as OoxmlElement | undefined;
  const cellAt = row?.children.findIndex((child) => child.kind === 'tableCell') ?? -1;
  const cell = row?.children[cellAt] as OoxmlElement | undefined;
  const paragraphAt = cell?.children.findIndex((child) => child.kind === 'paragraph') ?? -1;
  const paragraph = cell?.children[paragraphAt] as OoxmlElement | undefined;
  if (!row || !cell || !paragraph) return null;
  const lead = paragraph.children[0]?.kind === 'paragraphProperties' ? 1 : 0;
  const children = [
    ...paragraph.children.slice(0, lead),
    ...content,
    ...paragraph.children.slice(lead),
  ];
  if (!validKnownKind('paragraph', children)) return null;
  const rebuilt = { ...paragraph, children } as OoxmlElement;
  return withChildAt(
    table,
    rowAt,
    withChildAt(row, cellAt, withChildAt(cell, paragraphAt, rebuilt))
  );
}

/** An empty paragraph standing for the paragraph mark of `paragraph`. */
function markParagraph(paragraph: OoxmlElement): OoxmlNode {
  return {
    id: `${paragraph.id}~mark`,
    kind: 'paragraph',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'p',
    prefix: paragraph.prefix,
    namespaceBindings: [],
    attributes: [],
    children: [],
  } as unknown as OoxmlNode;
}

/**
 * A paragraph holding a paragraph or table, as the blocks it shows.
 *
 * An inner paragraph's content joins the paragraph, and the paragraph's own mark follows as an
 * empty paragraph. A table stays a table: the content before it starts the table's first cell,
 * and the paragraph follows the last table with its properties and the content after it.
 */
function flattenedParagraph(paragraph: OoxmlElement): OoxmlNode[] | null {
  if (!attributesFitKind('paragraph', paragraph.attributes)) return null;
  const blocks: OoxmlNode[] = [];
  const all: readonly OoxmlNode[] = paragraph.children;
  const properties = all.filter(isParagraphProperties);
  let pending: OoxmlNode[] = [];
  for (const child of all) {
    if (child.kind === 'table') {
      const table = withLeadingContent(child, flattened(pending, [], 0));
      if (!table) return null;
      blocks.push(table);
      pending = [];
    } else if (!isParagraphProperties(child)) {
      pending.push(child);
    }
  }
  const nested: OoxmlElement[] = [];
  const children = paragraphChildren(
    [...properties, ...flattened(pending, nested, 0)],
    paragraph.id,
    nested
  );
  if (!validKnownKind('paragraph', children)) return null;
  const last = { ...paragraph, kind: 'paragraph', children } as OoxmlNode;
  return blocks.length > 0 ? [...blocks, last] : [last, markParagraph(paragraph)];
}

function paragraphChildren(
  list: readonly OoxmlNode[],
  id: string,
  nested: readonly OoxmlElement[] = []
): readonly OoxmlNode[] {
  const children = list;
  if (nested.length === 0 && !children.some((child) => child.kind === 'paragraphProperties'))
    return children;

  // `w:pPr` elements before the first content apply; empty markers between them do not count.
  const leading: OoxmlElement[] = [];
  let content = false;
  let late = false;
  const rest: OoxmlNode[] = [];
  for (const child of list) {
    if (child.kind === 'paragraphProperties') {
      if (content) {
        late = true;
        rest.push(genericSubtree(child));
      } else leading.push(child);
      continue;
    }
    if (!isEmptyMarker(child)) content = true;
    rest.push(child);
  }
  const sources = [...leading, ...nested];
  if (nested.length === 0 && sources.length === 1 && !late && children[0] === leading[0])
    return children;
  let properties: OoxmlNode | null = null;
  if (sources.length === 1 && sources[0]!.kind === 'paragraphProperties') {
    properties = sources[0]!;
  } else if (sources.length > 0) {
    const merged = sources
      .slice(1)
      .reduce<
        readonly OoxmlNode[]
      >((state, next) => mergedPropertyList(state, next.children, CT_PPR_SEQUENCE, 'rPr'), mergedPropertyList([], sources[0]!.children, CT_PPR_SEQUENCE, 'rPr'));
    const kind = validKnownKind('paragraphProperties', merged) ? 'paragraphProperties' : 'generic';
    properties = { ...sources[0]!, kind, children: merged } as OoxmlNode;
  } else if (late) {
    properties = emptyParagraphProperties(id);
  }
  return properties ? [properties, ...rest] : rest;
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

/** One `w:tblPr` holding every property, a later element replacing one of the same name. */
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
