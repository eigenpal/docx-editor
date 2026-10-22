import { isContentControl } from '../package/content-control-walk.ts';
import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from '../package/ooxml-tree.ts';
import { tableChildren } from './revision-table-children.ts';
import { isInertMarker } from './revision-marker-content.ts';
import { ooxmlTreesEqual } from '../package/ooxml-serialize.ts';
import { contentWithText, editedProperties } from './tree-op-content-controls.ts';
import { cloneWithNewIds } from './tree-op-nodes.ts';

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
  marks: ReadonlySet<string>,
  mint: () => string,
  cell = false,
  /** The element that holds `children`, such as `body` or `txbxContent`. */
  container = ''
): OoxmlNode[] {
  if (
    !children.some((n) => marks.has(n.id) || (isNamed(n, 'customXml') && emptiedBlock(n, marks)))
  ) {
    return children.some((n) => n.kind === 'contentControl')
      ? inlinedEmptiedControls(children, marks, mint)
      : children;
  }
  const sources = paragraphMergeSources(children);
  const blocks = children.filter(
    (n) => n.kind === 'paragraph' || n.kind === 'table' || isContentControl(n)
  );
  const out: OoxmlNode[] = [];
  let carried: OoxmlNode[] = [];
  for (const [index, node] of children.entries()) {
    if (node.kind === 'paragraph') {
      // A paragraph the decision emptied and whose mark it removed, with no paragraph to join,
      // goes when a block follows it, or when it ends a text box or custom XML. A cell, a block
      // content control and a comment keep their last paragraph.
      if (
        marks.has(node.id) &&
        !sources.has(node.id) &&
        container !== 'tc' &&
        blocks.length > 1 &&
        node.children.every((child) => properties(child) || emptyRun(child)) &&
        ((DROPS_LAST_PARAGRAPH.has(container) &&
          // A custom XML block every paragraph of which goes keeps its last one here, so the
          // block around it goes whole rather than staying hollow.
          (container !== 'customXml' ||
            children.some((n) => n.kind === 'paragraph' && !marks.has(n.id)))) ||
          children.slice(index + 1).some((n) => n.kind === 'paragraph' || isContentControl(n)))
      )
        continue;
      if (marks.has(node.id) && sources.has(node.id)) {
        // A dropped paragraph only adds to the carried content; the one that keeps its mark
        // is built once, so a long run of joins stays linear.
        for (const child of node.children) if (!properties(child)) carried.push(child);
        continue;
      }
      out.push(carried.length ? prepend(node, carried) : node);
      carried = [];
    } else if (node.kind === 'table' && carried.length) {
      const target = tableParagraphMergeTarget(node)!;
      out.push(replaceIn(node, prepend(target, carried)));
      carried = [];
    } else if (carried.length && isInertMarker(node)) {
      // A bookmark or comment boundary between the joined paragraphs marks the join point,
      // so it goes after the carried text, not before the whole joined paragraph. It is a new
      // node there: a collaborating replica records removing the body-level one and inserting
      // this one, rather than moving one node from between blocks into a paragraph.
      carried.push({ ...node, id: mint() } as OoxmlNode);
    } else if (
      isNamed(node, 'customXml') &&
      emptiedBlock(node, marks) &&
      endsWithKeptParagraph(children, node, marks)
    ) {
      // A custom XML block the decision empties of every paragraph and mark goes whole, when
      // its container still ends with a paragraph that stays.
      continue;
    } else out.push(node);
  }
  const joined = inlinedEmptiedControls(joinedTables(children, out), marks, mint);
  return cell ? joinedCellEnd(joined, marks, mint) : joined;
}

/**
 * A block content control the decision emptied, whose last paragraph lost its mark, joins the
 * paragraph after it: the control goes inline at that paragraph's start and shows its
 * placeholder.
 */
function inlinedEmptiedControls(
  nodes: OoxmlNode[],
  marks: ReadonlySet<string>,
  mint: () => string
): OoxmlNode[] {
  const out: OoxmlNode[] = [];
  // The emptied control waiting for the paragraph after it, and the control as it was.
  let pending: { readonly inline: OoxmlNode; readonly original: OoxmlNode } | null = null;
  for (const node of nodes) {
    if (node.kind === 'textValue') {
      out.push(node);
      continue;
    }
    if (pending && node.kind === 'paragraph') {
      const properties = node.children.filter((child) => isNamed(child, 'pPr'));
      const rest = node.children.filter((child) => !isNamed(child, 'pPr'));
      out.push({ ...node, children: [...properties, pending.inline, ...rest] } as OoxmlNode);
      pending = null;
      continue;
    }
    // Nothing to join: the control stays where it was.
    if (pending) out.push(pending.original);
    pending = null;
    const inline = node.kind === 'contentControl' ? emptiedControlInline(node, marks, mint) : null;
    // A new node in the paragraph, not the block one moved: a collaborating replica records the
    // block control's removal and this one's insertion.
    if (inline) pending = { inline: cloneWithNewIds(inline, mint), original: node };
    else out.push(node);
  }
  if (pending) out.push(pending.original);
  return out;
}

function emptiedControlInline(
  control: OoxmlElement,
  marks: ReadonlySet<string>,
  mint: () => string
): OoxmlNode | null {
  const content = control.children.find((child) => child.kind === 'contentControlContent');
  if (!content || content.kind === 'textValue') return null;
  const blocks = content.children.filter((child) => child.kind !== 'textValue');
  const only = blocks[0];
  if (blocks.length !== 1 || only?.kind !== 'paragraph' || !marks.has(only.id)) return null;
  // Deleted text a later decision resolves goes inline with the control.
  if (!only.children.every((child) => properties(child) || holdsNoLiveText(child))) return null;
  const held = only.children.filter((child) => !properties(child) && !emptyRun(child));
  const others = control.children.filter(
    (child) => child.kind !== 'contentControlProperties' && child.kind !== 'contentControlContent'
  );
  if (held.length)
    return {
      ...control,
      children: [
        ...control.children.filter((child) => child.kind === 'contentControlProperties'),
        ...others,
        { ...content, children: held } as OoxmlNode,
      ],
    } as OoxmlNode;
  const sdtPr = control.children.find((child) => child.kind === 'contentControlProperties');
  const prompt = contentWithText(
    { ...content, children: [] } as OoxmlElement,
    PLACEHOLDER,
    mint,
    true
  );
  if (!prompt) return null;
  return {
    ...control,
    children: [
      editedProperties(
        sdtPr && sdtPr.kind !== 'textValue' ? sdtPr : undefined,
        { showingPlaceholder: true },
        mint
      ),
      ...others,
      { ...content, children: prompt } as OoxmlNode,
    ],
  } as OoxmlNode;
}
/** The placeholder a control without its own prompt text shows. */
const PLACEHOLDER = '     ';

/**
 * Two tables the decision left side by side, with the same properties and grid, are one table:
 * the rows of the second follow the rows of the first.
 */
function joinedTables(before: readonly OoxmlNode[], after: OoxmlNode[]): OoxmlNode[] {
  const blocks = (list: readonly OoxmlNode[]) => list.filter((n) => n.kind !== 'textValue');
  const adjacentBefore = new Set<string>();
  const was = blocks(before);
  for (let i = 1; i < was.length; i += 1)
    if (was[i - 1]!.kind === 'table' && was[i]!.kind === 'table') adjacentBefore.add(was[i]!.id);
  const out: OoxmlNode[] = [];
  for (const node of after) {
    const previous = blocks(out).at(-1);
    if (
      node.kind === 'table' &&
      previous?.kind === 'table' &&
      !adjacentBefore.has(node.id) &&
      sameTableFrame(previous, node)
    ) {
      const rows = node.children.filter(
        (child) => !isNamed(child, 'tblPr') && !isNamed(child, 'tblGrid')
      );
      out[out.lastIndexOf(previous)] = {
        ...previous,
        children: [...previous.children, ...rows],
      } as OoxmlNode;
      continue;
    }
    out.push(node);
  }
  return out;
}

function sameTableFrame(a: OoxmlNode, b: OoxmlNode): boolean {
  if (a.kind === 'textValue' || b.kind === 'textValue') return false;
  for (const name of ['tblPr', 'tblGrid']) {
    const left = a.children.find((child) => isNamed(child, name));
    const right = b.children.find((child) => isNamed(child, name));
    if (!left || !right || !ooxmlTreesEqual(left, right)) return false;
  }
  return true;
}

/** Whether every block of a custom XML block is a paragraph the decision emptied of its mark. */
function emptiedBlock(node: OoxmlNode, marks: ReadonlySet<string>): boolean {
  if (node.kind === 'textValue') return false;
  // A bookmark or comment range in the block is an anchor something else names: it stays.
  if (node.children.some((child) => child.kind !== 'textValue' && isInertMarker(child)))
    return false;
  const blocks = node.children.filter(
    (child) => child.kind !== 'textValue' && !isNamed(child, 'customXmlPr')
  );
  return (
    blocks.length > 0 &&
    blocks.every(
      (block) =>
        block.kind === 'paragraph' &&
        marks.has(block.id) &&
        block.children.every((child) => properties(child) || emptyRun(child))
    )
  );
}

/** Whether, without `dropped`, the container's last block is a paragraph the decision keeps. */
function endsWithKeptParagraph(
  children: readonly OoxmlNode[],
  dropped: OoxmlNode,
  marks: ReadonlySet<string>
): boolean {
  const blocks = children.filter(
    (child) =>
      child !== dropped &&
      (child.kind === 'paragraph' ||
        child.kind === 'table' ||
        isContentControl(child) ||
        isNamed(child, 'customXml'))
  );
  const last = blocks.at(-1);
  return last?.kind === 'paragraph' && !marks.has(last.id);
}

/** Containers whose emptied last paragraph goes with its content. */
const DROPS_LAST_PARAGRAPH: ReadonlySet<string> = new Set(['txbxContent', 'customXml']);

const emptyRun = (node: OoxmlNode) =>
  node.kind === 'run' && node.children.every((child) => isNamed(child, 'rPr'));

const isNamed = (node: OoxmlNode | undefined, name: string) =>
  node !== undefined &&
  node.kind !== 'textValue' &&
  node.namespaceUri === WML_NAMESPACE_URI &&
  node.localName === name;

/** Wrappers that go with their content. */
const WRAPPERS = new Set(['hyperlink', 'smartTag', 'customXml']);

/**
 * Content that holds no live text: markers, deleted text (decided or not), empty runs, and
 * insertions or wrappers of those.
 */
export function holdsNoLiveText(node: OoxmlNode): boolean {
  return (
    node.kind !== 'textValue' &&
    (isInertMarker(node) ||
      node.kind === 'revisionDelete' ||
      (node.kind === 'run' && node.children.every((child) => isNamed(child, 'rPr'))) ||
      ((node.kind === 'revisionInsert' || WRAPPERS.has(node.localName)) &&
        node.children.every(holdsNoLiveText)))
  );
}

const REVISION_RECORDS = new Set([
  'ins',
  'del',
  'moveFrom',
  'moveTo',
  'pPrChange',
  'rPrChange',
  'numberingChange',
]);
/** Whether a subtree still holds a tracked change record. */
function holdsRevision(node: OoxmlNode): boolean {
  return (
    node.kind !== 'textValue' &&
    ((node.namespaceUri === WML_NAMESPACE_URI && REVISION_RECORDS.has(node.localName)) ||
      node.children.some(holdsRevision))
  );
}

/** Whether a paragraph's own mark is recorded as deleted. */
function markDeleted(paragraph: OoxmlNode): boolean {
  if (paragraph.kind === 'textValue') return false;
  const pPr = paragraph.children.find(properties);
  const rPr = pPr?.kind === 'textValue' ? undefined : pPr?.children.find((n) => isNamed(n, 'rPr'));
  return !!rPr && rPr.kind !== 'textValue' && rPr.children.some((n) => isNamed(n, 'del'));
}

/**
 * A cell's last paragraph mark ends the cell, so removing it joins an emptied last paragraph
 * into the one before. The mark before then ends the cell: when it waits on its own deletion,
 * accepting that later empties the cell.
 */
function joinedCellEnd(
  children: OoxmlNode[],
  marks: ReadonlySet<string>,
  mint: () => string
): OoxmlNode[] {
  const blocks = children.flatMap((n, index) =>
    n.kind !== 'textValue' && !properties(n) && !isNamed(n, 'tcPr') && !isInertMarker(n)
      ? [index]
      : []
  );
  const last = blocks.at(-1);
  const before = blocks.at(-2);
  if (last === undefined || before === undefined) return children;
  const paragraph = children[last]!;
  const previous = children[before]!;
  if (
    paragraph.kind !== 'paragraph' ||
    previous.kind !== 'paragraph' ||
    !marks.has(paragraph.id) ||
    markDeleted(paragraph) ||
    // Properties that still hold a change, such as another author's, would go unreported.
    paragraph.children.some((n) => properties(n) && holdsRevision(n)) ||
    !paragraph.children.every((n) => properties(n) || holdsNoLiveText(n))
  )
    return children;
  // Markers keep their place at the end of the joined paragraph, as new nodes there.
  const carried = paragraph.children
    .filter((n) => !properties(n))
    .map((n) => (isInertMarker(n) ? ({ ...n, id: mint() } as OoxmlNode) : n));
  const joined = { ...previous, children: [...previous.children, ...carried] } as OoxmlElement;
  return children.flatMap((n, index) => (index === last ? [] : index === before ? [joined] : [n]));
}
