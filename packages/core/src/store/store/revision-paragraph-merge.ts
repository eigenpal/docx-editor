import { isContentControl } from '../package/content-control-walk.ts';
import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from '../package/ooxml-tree.ts';
import { tableChildren } from './revision-table-children.ts';

const properties = (n: OoxmlNode) =>
  n.kind !== 'textValue' && n.namespaceUri === WML_NAMESPACE_URI && n.localName === 'pPr';

/** Word joins a paragraph before a table into its first cell's first paragraph. */
export function tableParagraphMergeTarget(
  table: OoxmlNode,
  removed?: ReadonlySet<string>
): OoxmlElement | undefined {
  if (table.kind !== 'table') return undefined;
  const row = tableChildren(table, 'tableRow').find((n) => !removed?.has(n.id));
  const cell = row && tableChildren(row, 'tableCell').find((n) => !removed?.has(n.id));
  const first = cell?.children.find(
    (n) =>
      n.kind === 'paragraph' ||
      n.kind === 'table' ||
      (n.kind !== 'textValue' && isContentControl(n))
  );
  return first?.kind === 'paragraph' ? first : undefined;
}

/** Paragraph marks whose removal can merge into the next sibling block. */
export function paragraphMergeSources(
  children: readonly OoxmlNode[],
  removed?: ReadonlySet<string>
): ReadonlySet<string> {
  const sources = new Set<string>();
  let nextAcceptsText = false;
  for (let index = children.length - 1; index >= 0; index--) {
    const child = children[index]!;
    if (removed?.has(child.id)) continue;
    if (child.kind === 'paragraph') {
      if (nextAcceptsText) sources.add(child.id);
      nextAcceptsText = true;
    } else if (child.kind === 'table') {
      nextAcceptsText = tableParagraphMergeTarget(child, removed) !== undefined;
    } else if (child.kind !== 'textValue' && isContentControl(child)) {
      nextAcceptsText = false;
    }
  }
  return sources;
}

function prepend(paragraph: OoxmlElement, content: readonly OoxmlNode[]): OoxmlElement {
  return {
    ...paragraph,
    children: [
      ...paragraph.children.filter(properties),
      ...content,
      ...paragraph.children.filter((n) => !properties(n)),
    ],
  } as OoxmlElement;
}
function replaceIn(node: OoxmlNode, target: OoxmlElement): OoxmlNode {
  if (node.id === target.id) return target;
  if (node.kind === 'textValue') return node;
  const children = node.children.map((n) => replaceIn(n, target));
  return children.some((n, i) => n !== node.children[i])
    ? ({ ...node, children } as OoxmlElement)
    : node;
}

/** Merge after rebuilding: a removed table/row cannot receive or swallow carried text. */
export function mergeRevisionParagraphs(
  children: OoxmlNode[],
  marks: ReadonlySet<string>
): OoxmlNode[] {
  if (!children.some((n) => marks.has(n.id))) return children;
  const sources = paragraphMergeSources(children);
  const out: OoxmlNode[] = [];
  let carried: OoxmlNode[] = [];
  for (const node of children) {
    if (node.kind === 'paragraph') {
      const merged = carried.length ? prepend(node, carried) : node;
      carried = [];
      if (marks.has(node.id) && sources.has(node.id)) {
        carried = merged.children.filter((n) => !properties(n));
        continue;
      }
      out.push(merged);
    } else if (node.kind === 'table' && carried.length) {
      const target = tableParagraphMergeTarget(node)!;
      out.push(replaceIn(node, prepend(target, carried)));
      carried = [];
    } else out.push(node);
  }
  return out;
}
