// Shared UTF-16 offset insertion for run-level content (text, drawings, tabs, …).
//
// Split out of tree-op-apply so drawing insertion can share the same canonical run split
// without importing tree-op-apply (which imports tree-op-drawings).

import {
  createNodeIdAllocator,
  findNode,
  insertChildren,
  replaceChildren,
  type EditOptions,
  type OoxmlEditResult,
} from '../package/ooxml-edit.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { isContentRevisionKind } from '../package/ooxml-shared.ts';
import { segmentsOf } from './tree-op-segments.ts';

function contains(node: OoxmlNode, id: string): boolean {
  if (node.id === id) return true;
  if (node.kind === 'textValue') return false;
  return node.children.some((child) => contains(child, id));
}

function findTextContainer(paragraph: OoxmlParagraphNode, valueId: string): OoxmlNode | null {
  const walk = (node: OoxmlNode): OoxmlNode | null => {
    if (node.kind === 'textValue') return null;
    if (
      (node.kind === 'text' || node.kind === 'deletedText') &&
      node.children.some((child) => child.id === valueId)
    ) {
      return node;
    }
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(paragraph);
}

function textElement(
  nextId: () => string,
  text: string,
  kind: 'text' | 'deletedText' = 'text'
): OoxmlNode {
  const valueId = nextId();
  return {
    id: nextId(),
    kind,
    namespaceUri: WML_NAMESPACE_URI,
    localName: kind === 'deletedText' ? 'delText' : 't',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [{ id: valueId, kind: 'textValue', value: text }],
  } as unknown as OoxmlNode;
}

function runElement(nextId: () => string, children: readonly OoxmlNode[]): OoxmlNode {
  return {
    id: nextId(),
    kind: 'run',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'r',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children,
  } as unknown as OoxmlNode;
}

/** Insert one or more run children at a UTF-16 offset, splitting text when needed. */
export function insertRunPayloadAtOffset(
  part: OoxmlPart,
  paragraph: OoxmlParagraphNode,
  offset: number,
  payload: readonly OoxmlNode[],
  options?: EditOptions
): OoxmlEditResult {
  const nextId = createNodeIdAllocator(part);
  const segments = segmentsOf(paragraph);

  for (const segment of segments) {
    if (segment.node.kind !== 'textValue') continue;
    if (offset <= segment.start || offset >= segment.end) continue;
    const local = offset - segment.start;
    const value = segment.node.value;
    const textNode = findTextContainer(paragraph, segment.node.id);
    if (!textNode) {
      return {
        ok: false,
        issues: [
          { code: 'known-node-invariant', path: 'orphan-text-value', nodeId: segment.node.id },
        ],
      };
    }
    const run = findNode(part, segment.runId);
    if (!run || run.kind !== 'run') {
      return {
        ok: false,
        issues: [{ code: 'known-node-invariant', path: 'missing-run', nodeId: segment.runId }],
      };
    }
    const kind = textNode.kind === 'deletedText' ? 'deletedText' : 'text';
    const head = textElement(nextId, value.slice(0, local), kind);
    const tail = textElement(nextId, value.slice(local), kind);
    const rebuilt = run.children.flatMap((child) =>
      child.id === textNode.id ? [head, ...payload, tail] : [child]
    );
    return replaceChildren(part, run.id, rebuilt, options);
  }

  const boundary = segments.find((segment) => segment.start === offset);
  if (boundary) {
    const run = findNode(part, boundary.runId);
    if (!run || run.kind !== 'run') {
      return {
        ok: false,
        issues: [{ code: 'known-node-invariant', path: 'missing-run', nodeId: boundary.runId }],
      };
    }
    const index = run.children.findIndex((child) => contains(child, boundary.node.id));
    return insertChildren(part, run.id, Math.max(0, index), payload, options);
  }

  const runs = paragraph.children.flatMap((child) => {
    if (child.kind === 'run') return [child];
    if (child.kind === 'hyperlink' || isContentRevisionKind(child.kind)) {
      return child.children.filter((inner) => inner.kind === 'run');
    }
    return [];
  });
  const last = runs[runs.length - 1];
  if (last && last.kind === 'run') {
    return insertChildren(part, last.id, last.children.length, payload, options);
  }

  return insertChildren(
    part,
    paragraph.id,
    paragraph.children.length,
    [runElement(nextId, payload)],
    options
  );
}

/** Whether an offset lands strictly inside an atomic field/drawing/note segment. */
export function offsetInsideAtomicSegment(paragraph: OoxmlParagraphNode, offset: number): boolean {
  for (const segment of segmentsOf(paragraph)) {
    if (!segment.removeNodeIds || segment.removeNodeIds.length === 0) continue;
    if (offset > segment.start && offset < segment.end) return true;
  }
  return false;
}
