/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Compact plain data for the elements a paragraph's shared text carries as attributes.
 *
 * Every character run stores its run, text element and properties, and shared text stores
 * each value again where the run ends. So the data leaves out what it can derive: the
 * WordprocessingML namespace and `w` prefix, the kind a slot implies, an ID's common part
 * with its paragraph or run, and an attribute's kind. Known namespaces take short codes.
 * Decoding checks every value it reads and returns null for data it cannot trust.
 */
import {
  WML_NAMESPACE_URI,
  XML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import { type AttributeFields, attributeListFrom, elementFrom, textNode } from './node-shapes.ts';
import { rejectDangerousKey, type DocumentLimits } from './limits.ts';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** What an element in one position is when its data does not say. */
export interface Slot {
  readonly kind: string;
  readonly localName: string;
}

export const RUN_SLOT: Slot = { kind: 'run', localName: 'r' };
export const RUN_PROPERTIES_SLOT: Slot = { kind: 'runProperties', localName: 'rPr' };
export const TEXT_SLOT: Slot = { kind: 'text', localName: 't' };

/** Bounds on what one attribute value may describe. */
const MAX_JSON_NODES = 512;
export const MAX_JSON_DEPTH = 24;

/** Short codes for namespaces other than WordprocessingML. A URI never starts with `#`. */
const NAMESPACE_CODES: ReadonlyMap<string, string> = new Map([
  ['', '#'],
  [XML_NAMESPACE_URI, '#x'],
  ['http://schemas.microsoft.com/office/word/2010/wordml', '#w14'],
  ['http://schemas.microsoft.com/office/word/2012/wordml', '#w15'],
  ['http://schemas.openxmlformats.org/officeDocument/2006/relationships', '#r'],
  ['http://schemas.openxmlformats.org/officeDocument/2006/math', '#m'],
  ['http://schemas.openxmlformats.org/markup-compatibility/2006', '#mc'],
]);
const NAMESPACES_BY_CODE: ReadonlyMap<string, string> = new Map(
  [...NAMESPACE_CODES].map(([uri, code]) => [code, uri])
);

export function namespaceCode(uri: string): string {
  return uri === WML_NAMESPACE_URI ? '' : (NAMESPACE_CODES.get(uri) ?? uri);
}

export function namespaceFromCode(code: string): string | null {
  if (code === '') return WML_NAMESPACE_URI;
  if (code.startsWith('#')) return NAMESPACES_BY_CODE.get(code) ?? null;
  return code;
}

function defaultPrefix(namespaceUri: string): string | undefined {
  if (namespaceUri === WML_NAMESPACE_URI) return 'w';
  if (namespaceUri === XML_NAMESPACE_URI) return 'xml';
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// IDs

const SIBLING = /^(.*:)(\d{1,15})$/;

/** `id` relative to `base`: equal, extended, or a numbered sibling. */
export function encodeId(id: string, base: string): string {
  if (id === base) return '=';
  if (base.length > 0 && id.startsWith(base)) return `^${id.slice(base.length)}`;
  const own = SIBLING.exec(id);
  const other = SIBLING.exec(base);
  if (own && other && own[1] === other[1]) return `+${Number(own[2]) - Number(other[2])}`;
  return /^[=^+!]/.test(id) ? `!${id}` : id;
}

export function decodeId(value: unknown, base: string, limits: DocumentLimits): string | null {
  if (typeof value !== 'string' || value.length > limits.maxStringLength) return null;
  let id: string | null;
  if (value === '=') id = base;
  else if (value.startsWith('^')) id = base + value.slice(1);
  else if (value.startsWith('+')) {
    const offset = Number(value.slice(1));
    const sibling = SIBLING.exec(base);
    const number = sibling ? Number(sibling[2]) + offset : NaN;
    id = sibling && Number.isSafeInteger(number) && number >= 0 ? `${sibling[1]}${number}` : null;
  } else if (value.startsWith('!')) id = value.slice(1);
  else id = value;
  if (!id || id.length > limits.maxStringLength || rejectDangerousKey(id)) return null;
  return id;
}

// ---------------------------------------------------------------------------------------------
// Encoding

function attributeKind(
  namespaceUri: string,
  localName: string,
  prefix: string | undefined,
  value: string
): string {
  if (
    namespaceUri === XML_NAMESPACE_URI &&
    localName === 'space' &&
    prefix === 'xml' &&
    (value === 'default' || value === 'preserve')
  ) {
    return 'xmlSpace';
  }
  if (namespaceUri === WML_NAMESPACE_URI && localName === 'val') return 'wmlVal';
  return 'genericExtension';
}

/** `[localName, value, namespace?, prefix?, kind?]`, trailing defaults left out. */
function attributeData(attribute: OoxmlElement['attributes'][number]): JsonValue {
  const data: JsonValue[] = [attribute.localName, attribute.value];
  const prefix = attribute.prefix;
  const kind = attributeKind(attribute.namespaceUri, attribute.localName, prefix, attribute.value);
  const tail: JsonValue[] = [
    namespaceCode(attribute.namespaceUri),
    prefix === defaultPrefix(attribute.namespaceUri) ? '' : (prefix ?? null),
    attribute.kind === kind ? '' : attribute.kind,
  ];
  while (tail.length > 0 && tail[tail.length - 1] === '') tail.pop();
  return [...data, ...tail];
}

/** An element as compact data. `slot` gives the kind and name it may leave out. */
export function elementData(node: OoxmlNode, slot: Slot | null, withChildren: boolean): JsonValue {
  if (node.kind === 'textValue') return { v: node.value };
  const data: { [key: string]: JsonValue } = {};
  const defaultName = slot?.localName;
  if (node.localName !== defaultName) data.l = node.localName;
  const ns = namespaceCode(node.namespaceUri);
  if (ns !== '') data.n = ns;
  const impliedKind =
    slot && node.localName === slot.localName && node.namespaceUri === WML_NAMESPACE_URI
      ? slot.kind
      : 'generic';
  if (node.kind !== impliedKind) data.k = node.kind;
  // An absent prefix is `''`; a default one is left out.
  if (node.prefix !== defaultPrefix(node.namespaceUri)) data.p = node.prefix ?? '';
  if (node.attributes.length > 0) data.a = node.attributes.map(attributeData);
  if (node.namespaceBindings.length > 0) {
    data.b = node.namespaceBindings.map((binding) => [
      binding.prefix,
      namespaceCode(binding.namespaceUri),
    ]);
  }
  if (withChildren && node.children.length > 0) {
    data.c = node.children.map((child) => elementData(child, null, true));
  }
  return data;
}

// ---------------------------------------------------------------------------------------------
// Decoding

export interface Budget {
  nodes: number;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeString(value: unknown, limits: DocumentLimits): value is string {
  return typeof value === 'string' && value.length <= limits.maxStringLength;
}

function readAttributes(value: unknown, limits: DocumentLimits): OoxmlElement['attributes'] | null {
  if (value === undefined) return attributeListFrom(Object.freeze([]));
  if (!Array.isArray(value) || value.length > limits.maxAttributes) return null;
  const out: AttributeFields[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length < 2 || entry.length > 5) return null;
    const [localName, attributeValue, code = '', prefixData = '', kindData = ''] =
      entry as unknown[];
    if (!safeString(localName, limits) || rejectDangerousKey(localName)) return null;
    if (!safeString(attributeValue, limits) || !safeString(code, limits)) return null;
    const namespaceUri = namespaceFromCode(code);
    if (namespaceUri === null) return null;
    if (prefixData !== null && !safeString(prefixData, limits)) return null;
    const prefix = prefixData === '' ? defaultPrefix(namespaceUri) : (prefixData ?? undefined);
    if (prefix !== undefined && rejectDangerousKey(prefix)) return null;
    if (!safeString(kindData, limits)) return null;
    const kind = kindData || attributeKind(namespaceUri, localName, prefix, attributeValue);
    if (kind !== 'xmlSpace' && kind !== 'wmlVal' && kind !== 'genericExtension') return null;
    // The canonical attribute's keys, in its order.
    out.push(
      Object.freeze({
        kind,
        namespaceUri,
        localName,
        ...(prefix === undefined ? {} : { prefix }),
        value: attributeValue,
      })
    );
  }
  return attributeListFrom(Object.freeze(out));
}

function readBindings(
  value: unknown,
  limits: DocumentLimits
): OoxmlElement['namespaceBindings'] | null {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > limits.maxAttributes) return null;
  const out: { prefix: string; namespaceUri: string }[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const [prefix, code] = entry as unknown[];
    if (!safeString(prefix, limits) || !safeString(code, limits) || rejectDangerousKey(prefix)) {
      return null;
    }
    const namespaceUri = namespaceFromCode(code);
    if (namespaceUri === null) return null;
    out.push(Object.freeze({ prefix, namespaceUri }));
  }
  return Object.freeze(out);
}

/** An element from compact data, with IDs derived from `id`. Null for data it cannot trust. */
export function readElement(
  value: unknown,
  id: string,
  slot: Slot | null,
  limits: DocumentLimits,
  budget: Budget,
  depth: number
): OoxmlNode | null {
  budget.nodes += 1;
  if (budget.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH || !isRecord(value)) return null;
  if (typeof value.v === 'string' && value.l === undefined && value.k === undefined) {
    if (value.v.length > limits.maxTextLength) return null;
    return Object.freeze(textNode(id, value.v));
  }
  const localName = value.l ?? slot?.localName;
  if (!safeString(localName, limits) || rejectDangerousKey(localName)) return null;
  const code = value.n ?? '';
  if (!safeString(code, limits)) return null;
  const namespaceUri = namespaceFromCode(code);
  if (namespaceUri === null) return null;
  const impliedKind =
    slot && localName === slot.localName && namespaceUri === WML_NAMESPACE_URI
      ? slot.kind
      : 'generic';
  const kind = value.k ?? impliedKind;
  if (!safeString(kind, limits) || rejectDangerousKey(kind)) return null;
  let prefix: string | undefined = defaultPrefix(namespaceUri);
  if (value.p !== undefined) {
    if (!safeString(value.p, limits) || rejectDangerousKey(value.p)) return null;
    prefix = value.p === '' ? undefined : value.p;
  }
  const attributes = readAttributes(value.a, limits);
  const bindings = readBindings(value.b, limits);
  if (!attributes || !bindings) return null;
  const childData = value.c ?? [];
  if (!Array.isArray(childData) || childData.length > limits.maxChildren) return null;
  const children: OoxmlNode[] = [];
  for (let index = 0; index < childData.length; index += 1) {
    const child = readElement(childData[index], `${id}~${index}`, null, limits, budget, depth + 1);
    if (!child) return null;
    children.push(child);
  }
  return Object.freeze(
    elementFrom({
      id,
      kind,
      namespaceUri,
      localName,
      namespaceBindings: bindings,
      attributes,
      children: Object.freeze(children),
      ...(prefix === undefined ? {} : { prefix }),
    })
  );
}
