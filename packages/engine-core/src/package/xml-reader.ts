// Bounded, fidelity-preserving XML reader (document-engine task 2.4 / design D14).
// Uses fast-xml-parser but at the trust boundary: it PRE-REJECTS DTDs, entity
// declarations, and external-entity references before parsing (fast-xml-parser
// can otherwise process DOCTYPE/entities), disables entity expansion and value
// coercion, and preserves significant child order, attributes, whitespace, and
// raw lexical values. Output is ordered and every attribute record has a null prototype.

import { XMLParser, XMLValidator } from 'fast-xml-parser';

export type XmlNode =
  | {
      readonly type: 'element';
      readonly name: string;
      readonly attributes: Readonly<Record<string, string>>;
      readonly children: readonly XmlNode[];
    }
  | { readonly type: 'text'; readonly value: string };

export type XmlRejection =
  | 'too-large'
  | 'dtd-forbidden'
  | 'entity-forbidden'
  | 'too-deep'
  | 'too-many-elements'
  | 'invalid-limits'
  | 'parse-error';

const MAX_DEPTH = 256; // recursion-depth ceiling at the trust boundary
export const XML_HARD_MAX_BYTES = 64 * 1024 * 1024;
export const XML_HARD_MAX_ELEMENTS = 1_000_000;

/**
 * Decode ONLY the five predefined XML entities and numeric character references.
 * Safe because `readXml` has already rejected any DTD / custom entity declaration
 * or reference before this runs — so `&amp;`/`&#nn;` are the only refs possible,
 * and `processEntities:false` leaves them raw (avoiding entity-expansion attacks).
 * Without this, run text keeps its escaped lexical form and a re-serialize
 * double-escapes it.
 */
function decodeXmlEntities(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (m, e: string) => {
    switch (e) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      default: {
        const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
      }
    }
  });
}

class DepthError extends Error {}
class ElementCountError extends Error {}

export type XmlResult =
  | { readonly ok: true; readonly nodes: readonly XmlNode[] }
  | { readonly ok: false; readonly reason: XmlRejection };

const DOCTYPE_RE = /<!DOCTYPE/i;
const ENTITY_DECL_RE = /<!ENTITY/i;
// A reference to any entity other than the five predefined XML ones.
const CUSTOM_ENTITY_REF_RE = /&(?!(amp|lt|gt|quot|apos);)[A-Za-z_][\w.-]*;/;

function validLimit(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

/** Count lexical start tags before XMLParser allocates its object tree. Comments,
 * CDATA, processing instructions, and closing tags are skipped quote-aware. */
function preflightElementCount(xml: string, maxElements: number): XmlRejection | undefined {
  let count = 0;
  for (let i = 0; i < xml.length; i += 1) {
    if (xml[i] !== '<') continue;
    if (xml.startsWith('<!--', i)) {
      const end = xml.indexOf('-->', i + 4);
      if (end < 0) return 'parse-error';
      i = end + 2;
      continue;
    }
    if (xml.startsWith('<![CDATA[', i)) {
      const end = xml.indexOf(']]>', i + 9);
      if (end < 0) return 'parse-error';
      i = end + 2;
      continue;
    }
    if (xml.startsWith('<?', i)) {
      const end = xml.indexOf('?>', i + 2);
      if (end < 0) return 'parse-error';
      i = end + 1;
      continue;
    }
    const next = xml[i + 1];
    if (next === '/' || next === '!') continue;
    count += 1;
    if (count > maxElements) return 'too-many-elements';
    let quote: '"' | "'" | undefined;
    let closed = false;
    for (i += 1; i < xml.length; i += 1) {
      const c = xml[i];
      if (quote) {
        if (c === quote) quote = undefined;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '>') {
        closed = true;
        break;
      }
    }
    if (!closed) return 'parse-error';
  }
  return undefined;
}

export interface XmlLimits {
  readonly maxBytes: number;
  readonly maxElements?: number;
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: false, // preserve significant whitespace
  parseTagValue: false, // never coerce text to number/boolean
  parseAttributeValue: false, // never coerce attributes
  processEntities: false, // no entity expansion (billion laughs)
  htmlEntities: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
});

/** Read XML into an ordered tree, refusing DTDs/entities and bounding size. */
export function readXml(
  xml: string,
  limits: XmlLimits = { maxBytes: XML_HARD_MAX_BYTES }
): XmlResult {
  if (
    !validLimit(limits.maxBytes) ||
    (limits.maxElements !== undefined && !validLimit(limits.maxElements))
  )
    return { ok: false, reason: 'invalid-limits' };
  const maxBytes = Math.min(limits.maxBytes, XML_HARD_MAX_BYTES);
  const maxElements = Math.min(limits.maxElements ?? XML_HARD_MAX_ELEMENTS, XML_HARD_MAX_ELEMENTS);
  if (xml.length > maxBytes) return { ok: false, reason: 'too-large' };
  if (DOCTYPE_RE.test(xml)) return { ok: false, reason: 'dtd-forbidden' };
  if (ENTITY_DECL_RE.test(xml)) return { ok: false, reason: 'entity-forbidden' };
  if (CUSTOM_ENTITY_REF_RE.test(xml)) return { ok: false, reason: 'entity-forbidden' };
  const preflight = preflightElementCount(xml, maxElements);
  if (preflight) return { ok: false, reason: preflight };
  if (XMLValidator.validate(xml) !== true) return { ok: false, reason: 'parse-error' };

  let raw: unknown;
  try {
    raw = parser.parse(xml);
  } catch {
    return { ok: false, reason: 'parse-error' };
  }
  try {
    return {
      ok: true,
      nodes: convert(raw as FxpNode[], 0, { count: 0, maxElements }),
    };
  } catch (e) {
    return {
      ok: false,
      reason:
        e instanceof DepthError
          ? 'too-deep'
          : e instanceof ElementCountError
            ? 'too-many-elements'
            : 'parse-error',
    };
  }
}

// fast-xml-parser preserveOrder node: { [tag]: children[], ':@'?: {"@_a": v} } | { '#text': v }.
type FxpNode = Record<string, unknown>;

function convert(
  items: FxpNode[],
  depth: number,
  budget: { count: number; maxElements: number }
): XmlNode[] {
  if (depth > MAX_DEPTH) throw new DepthError();
  const out: XmlNode[] = [];
  for (const item of items) {
    if ('#text' in item) {
      out.push({ type: 'text', value: decodeXmlEntities(String(item['#text'])) });
      continue;
    }
    const attrs = (item[':@'] as Record<string, unknown> | undefined) ?? {};
    const tagKey = Object.keys(item).find((k) => k !== ':@');
    if (!tagKey) continue;
    budget.count += 1;
    if (budget.count > budget.maxElements) throw new ElementCountError();
    const attributes = Object.create(null) as Record<string, string>;
    for (const [k, v] of Object.entries(attrs))
      attributes[k.replace(/^@_/, '')] = decodeXmlEntities(String(v));
    out.push({
      type: 'element',
      name: tagKey,
      attributes,
      children: convert((item[tagKey] as FxpNode[]) ?? [], depth + 1, budget),
    });
  }
  return out;
}

/** Find the first descendant element with the given qualified name. */
export function findElement(
  nodes: readonly XmlNode[],
  name: string
): Extract<XmlNode, { type: 'element' }> | undefined {
  for (const node of nodes) {
    if (node.type !== 'element') continue;
    if (node.name === name) return node;
    const nested = findElement(node.children, name);
    if (nested) return nested;
  }
  return undefined;
}

/** All direct child elements with the given name. */
export function childElements(
  node: Extract<XmlNode, { type: 'element' }>,
  name: string
): Extract<XmlNode, { type: 'element' }>[] {
  return node.children.filter(
    (c): c is Extract<XmlNode, { type: 'element' }> => c.type === 'element' && c.name === name
  );
}

/** Concatenated text content of an element (all descendant text nodes). */
export function textContent(node: Extract<XmlNode, { type: 'element' }>): string {
  let out = '';
  for (const child of node.children) {
    if (child.type === 'text') out += child.value;
    else out += textContent(child);
  }
  return out;
}
