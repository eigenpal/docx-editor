// Where one tracked change ends and the next begins, beyond its identity.
//
// A change that runs across the edge of a content control, hyperlink, simple field, or
// direction wrapper is two changes, one on each side. Inside a complex field, each field
// character is a change of its own, and the instruction and the result are separate changes.
// The mark of the last paragraph in a block content control is a change of its own too.

import { parentNodeOf } from '../package/ooxml-edit.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';

const REVISION_CONTENT: ReadonlySet<string> = new Set([
  'revisionInsert',
  'revisionDelete',
  'revisionMoveFrom',
  'revisionMoveTo',
]);

const MATH_NAMESPACE_URI = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
/** The outermost of these names the equation a change inside it belongs to. */
const EQUATIONS: ReadonlySet<string> = new Set(['oMath', 'oMathPara']);

/** Inline wrappers whose edge ends a change. */
const CONTAINERS: ReadonlySet<string> = new Set(['hyperlink', 'fldSimple', 'dir', 'bdo']);

const isW = (node: OoxmlNode, name: string): boolean =>
  node.kind !== 'textValue' && node.namespaceUri === WML_NAMESPACE_URI && node.localName === name;

function isContainer(node: OoxmlNode): boolean {
  return (
    node.kind === 'contentControl' ||
    (node.kind !== 'textValue' &&
      node.namespaceUri === WML_NAMESPACE_URI &&
      CONTAINERS.has(node.localName))
  );
}

/** Range markers that hold no content, so they never make a block the last one. */
const INERT_MARKERS: ReadonlySet<string> = new Set([
  'bookmarkStart',
  'bookmarkEnd',
  'commentRangeStart',
  'commentRangeEnd',
  'moveFromRangeStart',
  'moveFromRangeEnd',
  'moveToRangeStart',
  'moveToRangeEnd',
  'permStart',
  'permEnd',
  'proofErr',
]);

/** The last child that holds content, found from the end. */
function lastElement(node: OoxmlElement): OoxmlNode | undefined {
  for (let index = node.children.length - 1; index >= 0; index -= 1) {
    const child = node.children[index]!;
    if (child.kind === 'textValue') continue;
    if (child.namespaceUri === WML_NAMESPACE_URI && INERT_MARKERS.has(child.localName)) continue;
    return child;
  }
  return undefined;
}

/** One answer per derivation: `segmentOf(nodeId, mark)` names the segment a site belongs to. */
export function revisionSegments(part: OoxmlPart): {
  /** The segment of an inline site: its container and its place among field characters. */
  readonly segmentOf: (nodeId: string) => string;
  /** The segment of a paragraph mark site: its container, or the end of a block control. */
  readonly markSegmentOf: (nodeId: string) => string;
  /** The container alone, for joins across paragraph marks. */
  readonly containerOf: (nodeId: string) => string;
  /** The equation a node sits in, if any. */
  readonly equationOf: (nodeId: string) => string | undefined;
  /** The begin run of the outermost complex field a node sits in, if any. */
  readonly fieldOf: (nodeId: string) => string | undefined;
} {
  const containers = new Map<string, string>();
  const containerOf = (id: string): string => {
    const parent = parentNodeOf(part, id);
    if (!parent) return '';
    let found = containers.get(parent.id);
    if (found === undefined) {
      found = isContainer(parent) ? parent.id : containerOf(parent.id);
      containers.set(parent.id, found);
    }
    return found;
  };
  const paragraphOf = (id: string) => {
    for (let node = parentNodeOf(part, id); node; node = parentNodeOf(part, node.id))
      if (node.kind === 'paragraph') return node;
    return null;
  };
  // The outermost open complex field at each node, per paragraph that holds one.
  const owners = new Map<string, ReadonlyMap<string, string>>();
  const fieldOwners = (paragraph: OoxmlElement): ReadonlyMap<string, string> => {
    const cached = owners.get(paragraph.id);
    if (cached) return cached;
    const found = new Map<string, string>();
    const open: string[] = [];
    const visit = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      if (open.length) found.set(node.id, open[0]!);
      const character =
        node.kind === 'run' ? node.children.find((child) => isW(child, 'fldChar')) : undefined;
      const type = character?.attributes.find((a) => a.localName === 'fldCharType')?.value;
      if (type === 'begin') open.push(node.id);
      for (const child of node.children) visit(child);
      if (type === 'end') open.pop();
    };
    for (const child of paragraph.children) visit(child);
    owners.set(paragraph.id, found);
    return found;
  };
  // Field positions, per paragraph that holds a field character.
  const fields = new Map<string, ReadonlyMap<string, string> | null>();
  const fieldPositions = (paragraph: OoxmlElement): ReadonlyMap<string, string> | null => {
    const cached = fields.get(paragraph.id);
    if (cached !== undefined) return cached;
    const positions = new Map<string, string>();
    let count = 0;
    let any = false;
    // A field character the change itself holds does not end it: only an unchanged one does.
    const visit = (node: OoxmlNode, inside: string | null, changed: boolean): void => {
      if (node.kind === 'textValue') return;
      const fieldRun =
        inside === null &&
        !changed &&
        node.kind === 'run' &&
        node.children.some((c) => isW(c, 'fldChar'));
      const own = inside ?? (fieldRun ? `c${count}` : `${count}`);
      positions.set(node.id, own);
      const content = changed || REVISION_CONTENT.has(node.kind);
      for (const child of node.children) visit(child, fieldRun ? own : inside, content);
      if (fieldRun) {
        count += 1;
        any = true;
      }
    };
    for (const child of paragraph.children) visit(child, null, false);
    const result = any ? positions : null;
    fields.set(paragraph.id, result);
    return result;
  };
  return {
    containerOf,
    fieldOf: (id) => {
      const paragraph = paragraphOf(id);
      return paragraph && fieldPositions(paragraph) ? fieldOwners(paragraph).get(id) : undefined;
    },
    equationOf: (id) => {
      let found: string | undefined;
      for (let node = parentNodeOf(part, id); node; node = parentNodeOf(part, node.id))
        if (node.namespaceUri === MATH_NAMESPACE_URI && EQUATIONS.has(node.localName))
          found = node.id;
      return found;
    },
    segmentOf: (id) => {
      const paragraph = paragraphOf(id);
      const field = paragraph ? (fieldPositions(paragraph)?.get(id) ?? '') : '';
      return `${containerOf(id)}\u0000${field}`;
    },
    markSegmentOf: (id) => {
      const paragraph = paragraphOf(id);
      if (!paragraph) return containerOf(id);
      // The control first: a body-level paragraph's parent is the whole body.
      const parent = parentNodeOf(part, paragraph.id);
      const control = parent?.kind === 'contentControlContent' && parentNodeOf(part, parent.id);
      if (!control || control.kind !== 'contentControl' || lastElement(parent) !== paragraph)
        return containerOf(id);
      // A control that closes a table cell ends with the cell, not on its own.
      const holder = parentNodeOf(part, control.id);
      if (holder?.kind === 'tableCell' && lastElement(holder) === control) return containerOf(id);
      return `${control.id}\u0000end`;
    },
  };
}
