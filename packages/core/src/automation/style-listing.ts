// The styles a document defines, listed for a reader who has to pick one by name.
//
// INTERNAL. One read over `styles.xml`, built on the same index `setStyle` resolves names with, so
// the listing and the write cannot disagree about which paragraph styles exist.
//
// UNTRUSTED VALUES. Every name and reference here is FILE input. It is compared, copied into plain
// frozen data, and keyed in `Map`s and `Set`s only: nothing is templated into markup, and no file
// value becomes an object key or a loop bound.

import { findNode } from '../store/package/ooxml-edit.ts';
import { indexStyles, stylesPartOf, type StyleIndexEntry } from '../store/package/ooxml-indexes.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import { isValidXmlText } from '../store/package/sinks.ts';
import { WML_NAMESPACE_URI, type OoxmlElement } from '../store/package/ooxml-tree.ts';
import type { PlannedOperation } from './plan-types.ts';
import type { AutomationPackageReads } from './reads.ts';
import { MAX_STYLE_NAME, foldStyleName, type AutomationStyleIndex } from './styles.ts';

/**
 * Plan `getStyles`: a read with no handle, answered from the package the host holds.
 *
 * The listing comes from the package reads, which build it once per package revision, so a batch
 * that asks several times (a load, a count, a lookup, a load per item) shares one listing.
 */
export function planStyleListing(reads: AutomationPackageReads): PlannedOperation {
  if (!reads.package)
    return {
      ok: false,
      error: { code: 'document-unavailable', message: 'this host holds no document right now' },
    };
  return { ok: true, kind: 'query', value: { kind: 'styles', styles: reads.styleListing() } };
}

/** The style kinds a listing names, in the part's own `w:type` vocabulary. */
export type AutomationStyleKind = 'paragraph' | 'character' | 'table' | 'numbering';

/**
 * One style the styles part defines, as a listing answers it.
 *
 * `name` is the part's own `w:name`. A paragraph `setStyle` write accepts it only when `type` is
 * `paragraph`; character, table, and numbering names are refused there. A reference to another
 * style answers that style's NAME, or null where the part names none or names a style the listing
 * leaves out.
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
  /** The `w:basedOn` style. */
  readonly basedOn: string | null;
  /**
   * The style of the paragraph after this one. A paragraph style that states no `w:next` names
   * itself. Null for every other kind, and where `w:next` names a style the listing leaves out.
   */
  readonly next: string | null;
  /** Whether `w:link` names a style the listing holds. */
  readonly linked: boolean;
}

const STYLE_KINDS: ReadonlySet<string> = new Set(['paragraph', 'character', 'table', 'numbering']);
const NO_STYLES: readonly AutomationStyleRead[] = Object.freeze([]);

/**
 * The styles a document defines, in the order its styles part writes them.
 *
 * EVERY KIND IS LISTED. Only paragraph names apply through a paragraph `setStyle`; character,
 * table, and numbering names are refused there. A paragraph style appears only when the paragraph
 * index resolves its name back to that same id, so every listed PARAGRAPH name applies. Every
 * other kind keeps the first definition of a name, the rule the paragraph index uses. One name can
 * appear once per kind, so `id` is what identifies an entry. A style with no `w:name`, a name a
 * write would refuse, or no recognized `w:type` is left out rather than answered under its id.
 *
 * Callers go through `AutomationPackageReads.styleListing()`, which computes this once per package
 * revision.
 */
export function styleListing(
  pkg: OoxmlPackage,
  styles: AutomationStyleIndex
): readonly AutomationStyleRead[] {
  const part = stylesPartOf(pkg);
  if (!part) return NO_STYLES;
  const listed: StyleIndexEntry[] = [];
  const nameById = new Map<string, string>();
  const seen = new Set<string>();
  for (const entry of indexStyles(part).values()) {
    const name = entry.name;
    if (!STYLE_KINDS.has(entry.type) || name === null || !writableName(name)) continue;
    if (entry.type === 'paragraph' && styles.idOf(name) !== entry.styleId) continue;
    const key = `${entry.type}\u0000${foldStyleName(name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    listed.push(entry);
    nameById.set(entry.styleId, name);
  }
  const nameOf = (id: string | null | undefined): string | null =>
    id === null || id === undefined ? null : (nameById.get(id) ?? null);
  return Object.freeze(
    listed.map((entry): AutomationStyleRead => {
      const found = findNode(part, entry.nodeId);
      const element = found && found.kind !== 'textValue' ? found : undefined;
      const name = nameById.get(entry.styleId)!;
      const next = element ? lastChildValue(element, 'next') : undefined;
      return Object.freeze({
        id: entry.styleId,
        name,
        type: entry.type as AutomationStyleKind,
        builtIn: !onOff(element ? wmlAttribute(element, 'customStyle') : null),
        // The index's own `basedOn`, so every lane reads a duplicated child the same way.
        basedOn: nameOf(entry.basedOn),
        // Only a paragraph style has a next style. Stating none means it follows itself; naming a
        // style the listing leaves out answers no name, as `basedOn` does.
        next: entry.type !== 'paragraph' ? null : next === undefined ? name : nameOf(next),
        linked: nameOf(element ? lastChildValue(element, 'link') : undefined) !== null,
      });
    })
  );
}

/** The checks a `setStyle` name passes, applied to a name the file declares. */
function writableName(name: string): boolean {
  return name.trim().length > 0 && name.length <= MAX_STYLE_NAME && isValidXmlText(name);
}

/**
 * The `w:val` of the LAST child with this name, or undefined where the style states none. The
 * last child wins, the rule `indexStyles` uses for `w:name` and `w:basedOn`. A stated child with
 * no value answers null.
 */
function lastChildValue(element: OoxmlElement, localName: string): string | null | undefined {
  let value: string | null | undefined;
  for (const child of element.children) {
    if (
      child.kind !== 'textValue' &&
      child.namespaceUri === WML_NAMESPACE_URI &&
      child.localName === localName
    )
      value = wmlAttribute(child, 'val');
  }
  return value;
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
