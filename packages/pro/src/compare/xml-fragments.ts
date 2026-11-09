/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
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
import {
  serializeOoxmlPart,
  type OoxmlNamespaceBinding,
  type OoxmlNode,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { pushAll } from './arrays.ts';

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

const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';

/** Prefixes that attribute values in `node`'s subtree name: `mc:Ignorable`, `Requires`, ... */
function valuePrefixes(node: ElementNode): Set<string> {
  const out = new Set<string>();
  const stack: ElementNode[] = [node];
  while (stack.length > 0) {
    const element = stack.pop()!;
    for (const attribute of element.attributes) {
      const named =
        attribute.namespaceUri === MC_NS ||
        (attribute.namespaceUri === '' && attribute.localName === 'Requires') ||
        (attribute.namespaceUri === XSI_NS && attribute.localName === 'type');
      if (!named) continue;
      for (const token of attribute.value.split(/\s+/)) {
        const colon = token.indexOf(':');
        if (token) out.add(colon < 0 ? token : token.slice(0, colon));
      }
    }
    pushAll(stack, elementChildren(element));
  }
  return out;
}

/**
 * `node` with the declarations its attribute values need from the part root. A fragment
 * serializes on its own, and a value such as `mc:Ignorable="w14"` names a prefix that the
 * part root declares.
 */
export function withInheritedBindings(
  node: OoxmlNode,
  inherited: readonly OoxmlNamespaceBinding[]
): OoxmlNode {
  if (!isElement(node) || inherited.length === 0) return node;
  const named = valuePrefixes(node);
  if (named.size === 0) return node;
  const own = new Set(node.namespaceBindings.map((binding) => binding.prefix));
  const extra = inherited.filter(
    (binding) => named.has(binding.prefix) && !own.has(binding.prefix)
  );
  return extra.length === 0
    ? node
    : ({ ...node, namespaceBindings: [...node.namespaceBindings, ...extra] } as OoxmlNode);
}

export function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttribute(text: string): string {
  return escapeText(text).replace(/"/g, '&quot;');
}

const NAMED_REFERENCES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/**
 * An attribute value as serialized XML writes it, decoded: named and numeric character
 * references become the characters they stand for, as the reader's tree holds them.
 */
export function unescapeXml(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (whole, body: string) => {
    if (body[0] !== '#') return NAMED_REFERENCES[body] ?? whole;
    const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

// A match starts only at the first white space of a run: a long run with no declaration after
// it is then scanned once, not again from each of its spaces.
const DECLARATION = /(?<!\s)\s+xmlns(?::([A-Za-z_][\w.-]*))?="([^"]*)"/g;

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
      // A default namespace (or its `xmlns=""` reset) holds only for the element that declares
      // it and its content: it stays there, so the element keeps its namespace.
      if (prefix === undefined) return whole;
      const key = prefix;
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
