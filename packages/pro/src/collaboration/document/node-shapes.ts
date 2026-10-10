/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Canonical nodes built from fields that shared state or a view assembled.
 *
 * Core types each element kind with its own children and attributes. A node decoded from
 * shared state has a kind that is only a string until core validates the tree, which it does
 * before any tree is published: local commits validate the part, and a remote install runs
 * `validateRemoteCanonicalPackage`. So the step from fields to a typed node is one assertion,
 * and it is made here, under one name, rather than as a cast at every site.
 */
import {
  WML_NAMESPACE_URI,
  type OoxmlAttribute,
  type OoxmlElement,
  type OoxmlNamespaceBinding,
  type OoxmlNode,
  type OoxmlTextNode,
} from '@docx-editor.dev/core/store';

/** The fields of one attribute, before core proves the values its kind allows. */
export interface AttributeFields {
  readonly kind: OoxmlAttribute['kind'];
  readonly namespaceUri: string;
  readonly localName: string;
  readonly prefix?: string;
  readonly value: string;
}

/** The fields of one element, before core proves that its kind allows them. */
export interface ElementFields {
  readonly id: string;
  readonly kind: string;
  readonly namespaceUri: string;
  readonly localName: string;
  readonly prefix?: string;
  readonly namespaceBindings: readonly OoxmlNamespaceBinding[];
  readonly attributes: readonly AttributeFields[];
  readonly children: readonly OoxmlNode[];
}

/** An element from its fields. Core validation checks the kind's rules before a publish. */
export function elementFrom(fields: ElementFields): OoxmlElement {
  const element = {
    id: fields.id,
    kind: fields.kind,
    namespaceUri: fields.namespaceUri,
    localName: fields.localName,
    namespaceBindings: fields.namespaceBindings,
    attributes: fields.attributes,
    children: fields.children,
    ...(fields.prefix === undefined ? {} : { prefix: fields.prefix }),
  };
  return element as unknown as OoxmlElement;
}

/** An attribute list as an element of any kind carries it. */
export function attributeListFrom(
  attributes: readonly AttributeFields[]
): OoxmlElement['attributes'] {
  return attributes as unknown as OoxmlElement['attributes'];
}

/** The same element, every other field kept, with other children and optionally another ID. */
export function withChildren(
  element: OoxmlElement,
  children: readonly OoxmlNode[],
  id: string = element.id
): OoxmlElement {
  return { ...element, id, children } as unknown as OoxmlElement;
}

/** One attribute from its fields. Core validation checks the kind's values before a publish. */
export function attributeFrom(fields: AttributeFields): OoxmlAttribute {
  return fields as OoxmlAttribute;
}

export function isElement(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

/** The elements of a child list, text nodes left out. */
export function elementsOf(nodes: readonly OoxmlNode[]): OoxmlElement[] {
  return nodes.filter(isElement);
}

/** `node` as an element. A text node here is a broken invariant of the caller. */
export function expectElement(node: OoxmlNode): OoxmlElement {
  if (!isElement(node)) throw new Error(`expected an element, found text node ${node.id}`);
  return node;
}

/** A frozen, empty WordprocessingML element with the `w` prefix. */
export function emptyWmlElement(
  id: string,
  kind: string,
  localName: string,
  attributes: readonly AttributeFields[] = []
): OoxmlElement {
  return Object.freeze(
    elementFrom({
      id,
      kind,
      namespaceUri: WML_NAMESPACE_URI,
      localName,
      prefix: 'w',
      namespaceBindings: Object.freeze([]),
      attributes: Object.freeze([...attributes]),
      children: Object.freeze([]),
    })
  );
}

/**
 * An empty generic element that stands in for an embedded node: a reader that needs only the
 * embed's position and ID reads it, and its content never reaches a published tree.
 */
export function embedPlaceholder(id: string): OoxmlElement {
  return elementFrom({
    id,
    kind: 'generic',
    namespaceUri: '',
    localName: '',
    namespaceBindings: [],
    attributes: [],
    children: [],
  });
}

export function textNode(id: string, value: string): OoxmlTextNode {
  return { id, kind: 'textValue', value };
}
