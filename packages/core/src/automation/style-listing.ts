// The styles a document defines, listed for a reader who has to pick one by name.
//
// INTERNAL. One read over `styles.xml`, built on the same index `setStyle` resolves names with, so
// the listing and the write cannot disagree about which paragraph styles exist.
//
// UNTRUSTED VALUES. Every name and reference here is FILE input. It is compared, copied into plain
// frozen data, and keyed in `Map`s and `Set`s only: nothing is templated into markup, and no file
// value becomes an object key or a loop bound.

import { indexStyles, stylesPartOf } from '../store/package/ooxml-indexes.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import { isValidXmlText } from '../store/package/sinks.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../store/package/ooxml-tree.ts';
import type { PlannedOperation } from './plan-types.ts';
import type { AutomationPackageReads } from './reads.ts';
import { MAX_STYLE_NAME, type AutomationStyleIndex } from './styles.ts';

/** Plan `getStyles`: a read with no handle, answered from the package the host holds. */
export function planStyleListing(reads: AutomationPackageReads): PlannedOperation {
  if (!reads.package)
    return {
      ok: false,
      error: { code: 'document-unavailable', message: 'this host holds no document right now' },
    };
  return {
    ok: true,
    kind: 'query',
    value: { kind: 'styles', styles: styleListing(reads.package, reads.styles()) },
  };
}

/** The style kinds a listing names, in the part's own `w:type` vocabulary. */
export type AutomationStyleKind = 'paragraph' | 'character' | 'table' | 'numbering';

/**
 * One style the styles part defines, as a listing answers it.
 *
 * `name` is the part's own `w:name`, the value a `setStyle` write resolves. A reference to another
 * style answers that style's NAME, or null where the part names none or names a style the listing
 * leaves out.
 */
export interface AutomationStyleRead {
  /** The `w:name`, exactly as the style setters accept it. */
  readonly name: string;
  /** The `w:type`, in the part's own vocabulary. */
  readonly type: AutomationStyleKind;
  /** False when the part marks the style `w:customStyle`. */
  readonly builtIn: boolean;
  /** The `w:basedOn` style. */
  readonly basedOn: string | null;
  /** The `w:next` style. Null where the part states none. */
  readonly next: string | null;
  /** Whether `w:link` names a style the listing holds. */
  readonly linked: boolean;
}

const STYLE_KINDS: ReadonlySet<string> = new Set(['paragraph', 'character', 'table', 'numbering']);

/**
 * The styles a document defines, in the order its styles part writes them.
 *
 * A LISTED NAME IS ONE A WRITE ACCEPTS. A paragraph style appears only when the paragraph index
 * resolves its name back to that same id, so every listed paragraph name applies with `setStyle`.
 * Every other kind keeps the first definition of a name, the rule the paragraph index uses. A
 * style with no `w:name`, a name a write would refuse, or no recognized `w:type` is left out
 * rather than answered under its id.
 */
export function styleListing(
  pkg: OoxmlPackage,
  styles: AutomationStyleIndex
): readonly AutomationStyleRead[] {
  const part = stylesPartOf(pkg);
  if (!part) return [];
  const elements = styleElementsOf(part);
  const listed: { readonly styleId: string; readonly name: string; readonly type: string }[] = [];
  const nameById = new Map<string, string>();
  const seen = new Set<string>();
  for (const entry of indexStyles(part).values()) {
    const name = entry.name;
    if (!STYLE_KINDS.has(entry.type) || name === null || !writableName(name)) continue;
    if (entry.type === 'paragraph' && styles.idOf(name) !== entry.styleId) continue;
    const key = `${entry.type}\u0000${name.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    listed.push({ styleId: entry.styleId, name, type: entry.type });
    nameById.set(entry.styleId, name);
  }
  return listed.map(({ styleId, name, type }) => {
    const element = elements.get(styleId);
    const reference = (localName: string): string | null => {
      const child = element ? wmlChild(element, localName) : undefined;
      const id = child ? wmlAttribute(child, 'val') : null;
      return id === null ? null : (nameById.get(id) ?? null);
    };
    return Object.freeze({
      name,
      type: type as AutomationStyleKind,
      builtIn: !onOff(element ? wmlAttribute(element, 'customStyle') : null),
      basedOn: reference('basedOn'),
      next: reference('next'),
      linked: reference('link') !== null,
    });
  });
}

/** The checks a `setStyle` name passes, applied to a name the file declares. */
function writableName(name: string): boolean {
  return name.trim().length > 0 && name.length <= MAX_STYLE_NAME && isValidXmlText(name);
}

/** The first `w:style` element for each id, met in the same document order `indexStyles` uses. */
function styleElementsOf(part: OoxmlPart): Map<string, OoxmlElement> {
  const found = new Map<string, OoxmlElement>();
  // An explicit stack rather than recursion: the depth of the part is the file's to choose.
  const stack: OoxmlNode[] = [part.root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.kind === 'textValue') continue;
    if (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'style') {
      const id = wmlAttribute(node, 'styleId');
      if (id !== null && !found.has(id)) found.set(id, node);
    }
    for (let index = node.children.length - 1; index >= 0; index -= 1)
      stack.push(node.children[index]!);
  }
  return found;
}

function wmlChild(element: OoxmlElement, localName: string): OoxmlElement | undefined {
  for (const child of element.children) {
    if (
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === localName
    )
      return child;
  }
  return undefined;
}

function wmlAttribute(element: OoxmlElement, localName: string): string | null {
  for (const entry of element.attributes) {
    if (entry.namespaceUri === WML_NAMESPACE_URI && entry.localName === localName)
      return entry.value;
  }
  return null;
}

/** `ST_OnOff`: all three on-spellings count, as the store's default flag reads them. */
function onOff(value: string | null): boolean {
  return value !== null && ['1', 'true', 'on'].includes(value);
}
