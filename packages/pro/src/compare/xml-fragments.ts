/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * XML string helpers for the compare engine.
 *
 * The engine assembles the output story as XML text from serialized input fragments and
 * re-reads it through the bounded part reader, so every output node passes the same typed
 * tree construction as a file read.
 */
import { serializeOoxmlPart, type OoxmlNode, type OoxmlPart } from '@docx-editor.dev/core/store';

export const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** An element node (anything but a text value). */
export type ElementNode = Exclude<OoxmlNode, { readonly kind: 'textValue' }>;

export const isElement = (node: OoxmlNode): node is ElementNode => node.kind !== 'textValue';

export const elementChildren = (node: OoxmlNode): readonly ElementNode[] =>
  isElement(node) ? (node.children as readonly OoxmlNode[]).filter(isElement) : [];

export const childNamed = (node: OoxmlNode, name: string): ElementNode | undefined =>
  elementChildren(node).find((child) => child.localName === name);

export function attributeOf(
  node: OoxmlNode,
  localName: string,
  namespaceUri?: string
): string | undefined {
  if (!isElement(node)) return undefined;
  return node.attributes.find(
    (attribute) =>
      attribute.localName === localName &&
      (namespaceUri === undefined || attribute.namespaceUri === namespaceUri)
  )?.value;
}

export function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttribute(text: string): string {
  return escapeText(text).replace(/"/g, '&quot;');
}

const DECLARATION = /\s+xmlns(?::([A-Za-z_][\w.-]*))?="([^"]*)"/g;

/**
 * Collects namespace declarations stripped from fragments, so the output root can declare
 * each prefix once. A prefix bound to two different URIs keeps its inline declaration.
 */
export class NamespaceScope {
  readonly #bindings = new Map<string, string>();

  /** Serializes `node` on its own and moves its namespace declarations to the root scope. */
  serialize(node: OoxmlNode): string {
    const xml = serializeOoxmlPart({
      id: 'fragment',
      name: '/fragment.xml',
      contentType: 'application/xml',
      root: node,
    } as OoxmlPart);
    return this.strip(xml.replace(/^<\?xml[^>]*\?>\s*/, ''));
  }

  strip(xml: string): string {
    return xml.replace(DECLARATION, (whole, prefix: string | undefined, uri: string) => {
      const key = prefix ?? '';
      const bound = this.#bindings.get(key);
      if (bound === undefined) {
        this.#bindings.set(key, uri);
        return '';
      }
      return bound === uri ? '' : whole;
    });
  }

  /** The namespace a root-scope prefix is bound to, if any. */
  uriOf(prefix: string): string | undefined {
    return this.#bindings.get(prefix);
  }

  /** Declarations for the output root element. */
  declarations(): string {
    return [...this.#bindings]
      .filter(([prefix]) => prefix !== '' && prefix !== 'xml')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([prefix, uri]) => ` xmlns:${prefix}="${escapeAttribute(uri)}"`)
      .join('');
  }
}

/** Splits an element's serialization into an open tag and a close tag around its content. */
export function shellOf(xml: string): { readonly start: string; readonly end: string } {
  const selfClosing = /^<([^\s/>]+)([^>]*)\/>$/.exec(xml);
  if (selfClosing)
    return { start: `<${selfClosing[1]}${selfClosing[2]}>`, end: `</${selfClosing[1]}>` };
  const open = /^<([^\s/>]+)[^>]*>/.exec(xml);
  if (!open) return { start: xml, end: '' };
  return { start: open[0], end: `</${open[1]}>` };
}

/** Inner XML of a serialized element (empty for a self-closing element). */
export function innerOf(xml: string): string {
  if (/^<[^>]*\/>$/.test(xml)) return '';
  const open = /^<[^>]*>/.exec(xml);
  const close = /<\/[^>]+>$/.exec(xml);
  if (!open || !close) return '';
  return xml.slice(open[0].length, xml.length - close[0].length);
}
