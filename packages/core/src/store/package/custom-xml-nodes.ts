// The nodes inside a custom XML data part, and the sweep that keeps them honest.
//
// One node per bound control. Its shape is fixed and deliberately dull:
//
//   <docxEditor xmlns="…"><node id="cx1"><label>(Smith 2024)</label><data>{…}</data></node></docxEditor>
//
// `label` is what a `w:dataBinding` xpath points at, because a binding supplies the CONTROL'S
// TEXT and nothing else — Word regenerates the control from it on open. `data` is a JSON
// string, which is where a payload of any shape lives. Splitting the two keeps Word from ever
// rendering the payload: it is not what the binding names, so Word copies it and moves on.
//
// THE SWEEP. Word will not delete a node when a user deletes the control bound to it, and
// nothing in OOXML asks it to. So orphans are a fact of the format, not a bug to prevent, and
// `withoutOrphanCustomXmlNodes` is the answer: given the ids the story still binds, every other
// node goes. One mechanism covers deletion here and deletion in Word, the difference being only
// when it runs.
//
// SECURITY: `label` and `data` come out of a file the sender controls. This module returns them
// as strings and parses nothing; a caller that renders one, or trusts its JSON, owes it the
// validation every other file-derived value gets.

import { withPart, type OoxmlPackage } from './ooxml-package.ts';
import { insertChildren, removeNode, replaceChildren } from './ooxml-edit.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from './ooxml-tree.ts';

/** The element holding the text a binding resolves to. */
const LABEL = 'label';
/** The element holding the payload, as JSON text. */
const DATA = 'data';
const NODE = 'node';

/** One node in a store: its id, the bound text, and the payload beside it. */
export interface CustomXmlNode {
  readonly id: string;
  /** Text a `w:dataBinding` resolves to. Untrusted file input. */
  readonly label: string;
  /** Payload as authored, JSON by convention and unparsed here. Untrusted file input. */
  readonly data: string;
}

function textOf(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  let text = '';
  for (const child of node.children) text += textOf(child);
  return text;
}

function childNamed(element: OoxmlElement, localName: string): OoxmlNode | null {
  return (
    element.children.find((child) => child.kind !== 'textValue' && child.localName === localName) ??
    null
  );
}

function idOf(element: OoxmlElement): string | null {
  const id = element.attributes.find((a) => a.localName === 'id' && a.namespaceUri === '');
  return id && id.value.length > 0 ? id.value : null;
}

function nodeElements(part: OoxmlPart): OoxmlElement[] {
  const found: OoxmlElement[] = [];
  for (const child of part.root.children) {
    if (child.kind === 'textValue') continue;
    if (child.localName !== NODE) continue;
    if (child.namespaceUri !== part.root.namespaceUri) continue;
    found.push(child);
  }
  return found;
}

function element(
  id: string,
  namespaceUri: string,
  localName: string,
  attributes: Readonly<Record<string, string>>,
  children: readonly OoxmlNode[]
): OoxmlElement {
  return {
    id,
    kind: 'generic',
    namespaceUri,
    localName,
    namespaceBindings: [],
    attributes: Object.entries(attributes).map(([name, value]) => ({
      kind: 'genericExtension' as const,
      namespaceUri: '',
      localName: name,
      value,
    })),
    children,
  } as OoxmlElement;
}

function textElement(
  id: string,
  namespaceUri: string,
  localName: string,
  value: string
): OoxmlElement {
  return element(id, namespaceUri, localName, {}, [{ id: `${id}#text`, kind: 'textValue', value }]);
}

/** Every node a store holds, in document order. */
export function customXmlNodes(pkg: OoxmlPackage, partName: string): CustomXmlNode[] {
  const part = pkg.parts.get(partName);
  if (!part) return [];
  const found: CustomXmlNode[] = [];
  for (const node of nodeElements(part)) {
    const id = idOf(node);
    if (id === null) continue;
    const label = childNamed(node, LABEL);
    const data = childNamed(node, DATA);
    found.push({
      id,
      label: label ? textOf(label) : '',
      data: data ? textOf(data) : '',
    });
  }
  return found;
}

/** One node by id, or null. */
export function readCustomXmlNode(
  pkg: OoxmlPackage,
  partName: string,
  nodeId: string
): CustomXmlNode | null {
  return customXmlNodes(pkg, partName).find((node) => node.id === nodeId) ?? null;
}

/**
 * Write a node, replacing one that already has the id.
 *
 * Replace rather than append: a second node with the same id makes the binding xpath ambiguous,
 * and Word resolves an ambiguous xpath to the first match — so an "update" that appended would
 * leave the control showing its old text forever.
 */
export function withCustomXmlNode(
  pkg: OoxmlPackage,
  partName: string,
  node: CustomXmlNode
): OoxmlPackage {
  const part = pkg.parts.get(partName);
  if (!part) return pkg;
  const ns = part.root.namespaceUri;
  const base = `${partName}#node-${node.id}`;
  const authored = element(base, ns, NODE, { id: node.id }, [
    textElement(`${base}-label`, ns, LABEL, node.label),
    textElement(`${base}-data`, ns, DATA, node.data),
  ]);

  const existing = nodeElements(part).find((candidate) => idOf(candidate) === node.id);
  if (existing) {
    const replaced = replaceChildren(part, part.root.id, [
      ...part.root.children.map((child) => (child.id === existing.id ? authored : child)),
    ]);
    return replaced.ok ? withPart(pkg, replaced.part) : pkg;
  }
  const appended = insertChildren(part, part.root.id, part.root.children.length, [authored], {
    deferValidation: true,
  });
  return appended.ok ? withPart(pkg, appended.part) : pkg;
}

/** Drop one node by id. A store that never held it comes back unchanged. */
export function withoutCustomXmlNode(
  pkg: OoxmlPackage,
  partName: string,
  nodeId: string
): OoxmlPackage {
  const part = pkg.parts.get(partName);
  if (!part) return pkg;
  const existing = nodeElements(part).find((candidate) => idOf(candidate) === nodeId);
  if (!existing) return pkg;
  const removed = removeNode(part, existing.id);
  return removed.ok ? withPart(pkg, removed.part) : pkg;
}

/**
 * Drop every node no longer referenced, given the ids the document still binds.
 *
 * This is the whole deletion story. Deleting a control in THIS editor can remove its node
 * directly, but a control deleted in Word leaves the node behind — Word has no lifecycle link
 * between the two and no way to run our code. Reconciling against what the story actually binds
 * collects both, and is the only thing that can collect the second.
 *
 * Takes the referenced ids rather than reading the story itself: the caller already walked it,
 * and a sweep that guessed at which controls exist would delete a payload on a mistake.
 */
export function withoutOrphanCustomXmlNodes(
  pkg: OoxmlPackage,
  partName: string,
  referencedIds: ReadonlySet<string>
): { readonly pkg: OoxmlPackage; readonly removed: readonly string[] } {
  const part = pkg.parts.get(partName);
  if (!part) return { pkg, removed: [] };
  const orphans = nodeElements(part).filter((node) => {
    const id = idOf(node);
    return id !== null && !referencedIds.has(id);
  });
  if (orphans.length === 0) return { pkg, removed: [] };
  const orphanNodeIds = new Set(orphans.map((node) => node.id));
  const kept = part.root.children.filter((child) => !orphanNodeIds.has(child.id));
  const replaced = replaceChildren(part, part.root.id, kept);
  if (!replaced.ok) return { pkg, removed: [] };
  return {
    pkg: withPart(pkg, replaced.part),
    removed: orphans.map((node) => idOf(node) ?? '').filter((id) => id.length > 0),
  };
}

/** Ids this will address: XPath 1.0 has no escape for a quote inside a literal, so a node id
 *  carrying one could close the predicate and append an expression of the sender's choosing.
 *  Restricting the id is honest — we mint them — and refusing beats emitting a broken binding. */
const ADDRESSABLE_ID = /^[A-Za-z_][\w.-]{0,127}$/;

/**
 * The `w:xpath` a binding uses to reach a node's label, or null when the id cannot be addressed.
 *
 * Word needs a prefix for the payload namespace even when the store declares it as a default —
 * an unprefixed step in an XPath means "no namespace", so `/docxEditor/node` would match
 * nothing in a namespaced store. The prefix is declared in `w:prefixMappings` beside it.
 */
export function customXmlLabelXPath(
  prefix: string,
  rootLocalName: string,
  nodeId: string
): string | null {
  if (!ADDRESSABLE_ID.test(prefix) || !ADDRESSABLE_ID.test(rootLocalName)) return null;
  if (!ADDRESSABLE_ID.test(nodeId)) return null;
  return `/${prefix}:${rootLocalName}/${prefix}:${NODE}[@id='${nodeId}']/${prefix}:${LABEL}`;
}

/** The `w:prefixMappings` value declaring that prefix, or null when it cannot be written.
 *  The namespace sits inside single quotes inside a double-quoted attribute, so a namespace
 *  carrying either quote character has no representation here. */
export function customXmlPrefixMappings(prefix: string, namespaceUri: string): string | null {
  if (!ADDRESSABLE_ID.test(prefix)) return null;
  if (/['"<>&]/.test(namespaceUri)) return null;
  // eslint-disable-next-line no-control-regex -- unrepresentable, not merely awkward.
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(namespaceUri)) return null;
  return `xmlns:${prefix}='${namespaceUri}'`;
}
