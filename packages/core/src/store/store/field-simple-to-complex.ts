// Rewrite an editable `w:fldSimple` as the equivalent complex field before an edit inside it.
//
// A simple field holds its result runs inside one element, which the revision and run-split
// lanes do not enter. The complex form has the same meaning (begin, instruction, separate,
// the same result runs, end), and it is the form the document is saved in by the reference
// word processor anyway. So an edit that reaches inside an editable simple field's result
// first rewrites the field, then edits ordinary runs.

import { fieldOnOffAttribute, fldSimpleInstr, isFldSimple } from '../package/field-nodes.ts';
import {
  createNodeIdAllocator,
  findNode,
  replaceChildren,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import { WML_NAMESPACE_URI, XML_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { cloneWithNewIds, parentOf, runPropertiesNodeOf } from './tree-op-nodes.ts';

function attribute(localName: string, value: string): Record<string, unknown> {
  return {
    kind: 'genericExtension',
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    prefix: 'w',
    value,
  };
}

function element(
  nextId: () => string,
  kind: string,
  localName: string,
  attributes: readonly Record<string, unknown>[],
  children: readonly OoxmlNode[]
): OoxmlNode {
  return {
    id: nextId(),
    kind,
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    prefix: 'w',
    namespaceBindings: [],
    attributes,
    children,
  } as unknown as OoxmlNode;
}

/** The first result run's properties, so the markers carry the result's formatting. */
function resultRunProperties(simple: OoxmlNode): OoxmlNode | null {
  if (simple.kind === 'textValue') return null;
  for (const child of simple.children) {
    if (child.kind === 'run') return runPropertiesNodeOf(child) ?? null;
  }
  return null;
}

/**
 * Replace the simple field `simpleId` with its complex form. The instruction and the result
 * runs are kept as they are; `w:fldLock` and `w:dirty` move to the begin marker.
 */
export function complexFieldFromSimple(
  part: OoxmlPart,
  simpleId: string,
  options?: EditOptions
): { ok: true; part: OoxmlPart } | { ok: false } {
  const simple = findNode(part, simpleId);
  const parent = parentOf(part, simpleId);
  if (!simple || !isFldSimple(simple) || simple.kind === 'textValue' || !parent)
    return { ok: false };
  const nextId = createNodeIdAllocator(part);
  const rPr = resultRunProperties(simple);
  const run = (child: OoxmlNode): OoxmlNode =>
    element(nextId, 'run', 'r', [], rPr ? [cloneWithNewIds(rPr, nextId), child] : [child]);
  const beginAttributes = [attribute('fldCharType', 'begin')];
  for (const name of ['fldLock', 'dirty'] as const) {
    if (fieldOnOffAttribute(simple, name) === true) beginAttributes.push(attribute(name, 'true'));
  }
  const fldChar = (attributes: readonly Record<string, unknown>[]) =>
    element(nextId, 'fldChar', 'fldChar', attributes, []);
  const instruction = element(
    nextId,
    'instrText',
    'instrText',
    [
      {
        kind: 'xmlSpace',
        namespaceUri: XML_NAMESPACE_URI,
        localName: 'space',
        prefix: 'xml',
        value: 'preserve',
      },
    ],
    [{ id: nextId(), kind: 'textValue', value: fldSimpleInstr(simple) ?? '' } as OoxmlNode]
  );
  const complex = [
    run(fldChar(beginAttributes)),
    run(instruction),
    run(fldChar([attribute('fldCharType', 'separate')])),
    ...simple.children,
    run(fldChar([attribute('fldCharType', 'end')])),
  ];
  const rebuilt = parent.children.flatMap((child) => (child.id === simpleId ? complex : [child]));
  const replaced = replaceChildren(part, parent.id, rebuilt, options);
  return replaced.ok ? { ok: true, part: replaced.part } : { ok: false };
}
