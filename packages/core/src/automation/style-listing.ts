// The styles a document defines, listed for a reader who has to pick one by name.
//
// INTERNAL. Built from the same cached definitions the paragraph style index uses, so the listing
// and `setStyle` cannot disagree about which paragraph styles exist or how a name compares.
//
// CACHED ON THE STYLES PART ROOT. A body edit keeps that root, so it keeps the listing too.
//
// UNTRUSTED VALUES. Every name and reference here is FILE input. It is compared, copied into plain
// frozen data, and keyed in `Map`s and `Set`s only: nothing is templated into markup, and no file
// value becomes an object key or a loop bound. The definitions are capped like layout's.

import { findNode } from '../store/package/ooxml-edit.ts';
import { stylesPartOf } from '../store/package/ooxml-indexes.ts';
import { isValidXmlText } from '../store/package/sinks.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../store/package/ooxml-tree.ts';
import type { AutomationOperation } from './operations.ts';
import type { PlannedOperation } from './plan-types.ts';
import type { AutomationPackageReads } from './reads.ts';
import { styleDefinitionsOf, styleNameKey } from './style-definitions.ts';
import { MAX_STYLE_NAME } from './styles.ts';

/**
 * Plan `getStyles`: a read with no handle, answered from the package the host holds.
 *
 * The listing is cached on the styles part, so a batch that asks several times (a load, a count,
 * a lookup, a load per item) shares one listing, and so do batches after a body edit.
 */
export function planStyleListing(
  operation: Extract<AutomationOperation, { op: 'getStyles' }>,
  reads: AutomationPackageReads
): PlannedOperation {
  if (!reads.package)
    return {
      ok: false,
      error: { code: 'document-unavailable', message: 'this host holds no document right now' },
    };
  const listing = reads.styleListing();
  if (operation.name === undefined)
    return { ok: true, kind: 'query', value: { kind: 'styles', styles: listing } };
  if (typeof operation.name !== 'string')
    return {
      ok: false,
      error: { code: 'unsupported-content', message: 'a style name is a string' },
    };
  const found = styleNamed(listing, operation.name);
  return { ok: true, kind: 'query', value: { kind: 'styles', styles: found ? [found] : [] } };
}

/** The style kinds a listing names, in the part's own `w:type` vocabulary. */
export type AutomationStyleKind = 'paragraph' | 'character' | 'table' | 'numbering';

/**
 * One style the styles part defines, as a listing answers it.
 *
 * `name` is the part's own `w:name`. A paragraph `setStyle` write accepts it only when `type` is
 * `paragraph`; character, table, and numbering names are refused there. A reference to another
 * style answers that style's NAME, or null where the part names none or names a style this field
 * does not allow.
 */
export interface AutomationStyleRead {
  /** The `w:styleId`. Names can repeat across kinds; the id tells two listed styles apart. */
  readonly id: string;
  /** The `w:name`, as the part declares it. */
  readonly name: string;
  /** The `w:type`, in the part's own vocabulary. */
  readonly type: AutomationStyleKind;
  /** False when the part marks the style `w:customStyle`. */
  readonly builtIn: boolean;
  /** The `w:basedOn` style, when it is a listed style of the same kind. */
  readonly basedOn: string | null;
  /**
   * The style of the paragraph after this one, always a listed paragraph style. A paragraph style
   * that states no `w:next` names itself. Null for every other kind, and where `w:next` names a
   * style that is not a listed paragraph style.
   */
  readonly next: string | null;
  /** Whether `w:link` names a style the listing holds. */
  readonly linked: boolean;
  /** Whether the part marks the style `w:semiHidden` or `w:hidden`. */
  readonly hidden: boolean;
  /** The `w:uiPriority`, or null where the part states no valid one. */
  readonly uiPriority: number | null;
  /** Whether the part marks the style `w:qFormat`. */
  readonly quickStyle: boolean;
  /** Whether the part marks the style `w:unhideWhenUsed`. */
  readonly unhideWhenUsed: boolean;
}

const STYLE_KINDS: ReadonlySet<string> = new Set(['paragraph', 'character', 'table', 'numbering']);
const NO_STYLES: readonly AutomationStyleRead[] = Object.freeze([]);
const listings = new WeakMap<OoxmlNode, readonly AutomationStyleRead[]>();
const byKey = new WeakMap<readonly AutomationStyleRead[], Map<string, AutomationStyleRead>>();

/**
 * The listed style a name finds, or undefined. Names compare as `setStyle` compares them; where a
 * name belongs to several kinds, the paragraph style wins, otherwise the first in part order.
 */
export function styleNamed(
  listing: readonly AutomationStyleRead[],
  name: string
): AutomationStyleRead | undefined {
  let lookup = byKey.get(listing);
  if (!lookup) {
    lookup = new Map();
    for (const style of listing) {
      const key = styleNameKey(style.name);
      const held = lookup.get(key);
      if (!held || (held.type !== 'paragraph' && style.type === 'paragraph'))
        lookup.set(key, style);
    }
    byKey.set(listing, lookup);
  }
  return lookup.get(styleNameKey(name));
}

/** The styles of a package, in part order. Built once per styles part root. */
export function packageStyleListing(pkg: OoxmlPackage): readonly AutomationStyleRead[] {
  const part = stylesPartOf(pkg);
  if (!part) return NO_STYLES;
  const cached = listings.get(part.root);
  if (cached) return cached;
  const built = styleListing(part);
  listings.set(part.root, built);
  return built;
}

/**
 * The styles one styles part defines, in the order it writes them.
 *
 * EVERY KIND IS LISTED. Only paragraph names apply through a paragraph `setStyle`; character,
 * table, and numbering names are refused there. A paragraph style appears only when the paragraph
 * index resolves its name back to that same id, so every listed PARAGRAPH name applies. Every
 * other kind keeps the first definition of a name, the rule the paragraph index uses. One name can
 * appear once per kind, so `id` is what identifies an entry. A style with no `w:name`, a name a
 * write would refuse, or no recognized `w:type` is left out rather than answered under its id.
 */
function styleListing(part: OoxmlPart): readonly AutomationStyleRead[] {
  const definitions = styleDefinitionsOf(part);
  const listed: (typeof definitions.entries)[number][] = [];
  const kept = new Map<string, { readonly name: string; readonly type: string }>();
  const seen = new Set<string>();
  for (const entry of definitions.entries) {
    const name = entry.name;
    if (!STYLE_KINDS.has(entry.type) || name === null || !writableName(name)) continue;
    const key = styleNameKey(name);
    if (entry.type === 'paragraph' && definitions.paragraphIdByName.get(key) !== entry.styleId)
      continue;
    const kindKey = `${entry.type}\u0000${key}`;
    if (seen.has(kindKey)) continue;
    seen.add(kindKey);
    listed.push(entry);
    kept.set(entry.styleId, { name, type: entry.type });
  }
  /** The name of a listed style, when it is of `type`, or of any kind when `type` is omitted. */
  const nameOf = (id: string | null | undefined, type?: string): string | null => {
    const target = id === null || id === undefined ? undefined : kept.get(id);
    return target && (type === undefined || target.type === type) ? target.name : null;
  };
  return Object.freeze(
    listed.map((entry): AutomationStyleRead => {
      const found = findNode(part, entry.nodeId);
      const element = found && found.kind !== 'textValue' ? found : undefined;
      const name = kept.get(entry.styleId)!.name;
      const child = (localName: string) => (element ? lastChild(element, localName) : undefined);
      const next = child('next');
      const link = child('link');
      return Object.freeze({
        id: entry.styleId,
        name,
        type: entry.type as AutomationStyleKind,
        builtIn: !onOffValue(element ? wmlAttribute(element, 'customStyle') : null, false),
        // The index's own `basedOn`, so every lane reads a duplicated child the same way. A style
        // is based on a style of its own kind; any other target answers no name.
        basedOn: nameOf(entry.basedOn, entry.type),
        // Only a paragraph style has a next style, and it is always a paragraph style. Stating
        // none means the style follows itself.
        next:
          entry.type !== 'paragraph'
            ? null
            : next === undefined
              ? name
              : nameOf(wmlAttribute(next, 'val'), 'paragraph'),
        linked: nameOf(link ? wmlAttribute(link, 'val') : null) !== null,
        hidden: onOffElement(child('semiHidden')) || onOffElement(child('hidden')),
        uiPriority: priorityOf(child('uiPriority')),
        quickStyle: onOffElement(child('qFormat')),
        unhideWhenUsed: onOffElement(child('unhideWhenUsed')),
      });
    })
  );
}

/** The checks a `setStyle` name passes, applied to a name the file declares. */
function writableName(name: string): boolean {
  return name.trim().length > 0 && name.length <= MAX_STYLE_NAME && isValidXmlText(name);
}

/**
 * The LAST child with this name, or undefined where the style states none. The last child wins,
 * the rule `indexStyles` uses for `w:name` and `w:basedOn`.
 */
function lastChild(element: OoxmlElement, localName: string): OoxmlElement | undefined {
  let found: OoxmlElement | undefined;
  for (const child of element.children) {
    if (
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === localName
    )
      found = child;
  }
  return found;
}

function wmlAttribute(element: OoxmlElement, localName: string): string | null {
  for (const entry of element.attributes) {
    if (entry.namespaceUri === WML_NAMESPACE_URI && entry.localName === localName)
      return entry.value;
  }
  return null;
}

const ON: ReadonlySet<string> = new Set(['1', 'true', 'on']);

/** `ST_OnOff` as an attribute: on only for an on-spelling; `absent` where none is stated. */
function onOffValue(value: string | null, absent: boolean): boolean {
  if (value === null) return absent;
  return ON.has(value);
}

/** `CT_OnOff` as an element: absent is off; present with no `w:val` or an on-spelling is on. */
function onOffElement(element: OoxmlElement | undefined): boolean {
  if (!element) return false;
  const value = wmlAttribute(element, 'val');
  return value === null || ON.has(value);
}

/** A `w:uiPriority` value: a decimal integer of at most nine digits, or null. */
function priorityOf(element: OoxmlElement | undefined): number | null {
  const value = element ? wmlAttribute(element, 'val') : null;
  return value !== null && /^-?\d{1,9}$/.test(value) ? Number(value) : null;
}
