// The style definitions automation reads, from one bounded walk of the styles part.
//
// INTERNAL. The paragraph style index (`setStyle`, `style` reads), the style listing (`getStyles`)
// and table style names all start here, so they agree about which styles exist and how a name
// compares.
//
// THE SAME DEFINITIONS THE PAGE RESOLVES. Each definition is read with layout's own
// `readStyleIdentity` (the id rules, the first child of each kind, the `w:default` spellings), over
// the same direct `w:style` children of the root, under the same `MAX_STYLE_DEFINITIONS` bound. A
// repeated `w:styleId` resolves the way layout's cascade table does: the last definition wins, and
// the default paragraph style follows layout's rule. Formatting properties are not parsed: only
// what identifies and names a style is read.
//
// ONE DIFFERENCE, ON PURPOSE: the name. Layout keeps names of at most 128 characters because it
// never looks a style up by name. Automation does, so it reads a name up to `MAX_STYLE_NAME`, the
// longest name a `setStyle` write accepts.
//
// CACHED ON THE PART ROOT. Trees are immutable, so a body edit leaves the styles part's root the
// same object and the definitions are reused; only an edit to `styles.xml` builds them again.

import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import { MAX_STYLE_DEFINITIONS } from '../layout/style-cascade.ts';
import { isElement, readStyleIdentity } from '../layout/style-definition-reader.ts';

/** Longest style name automation reads or a write may carry. */
export const MAX_STYLE_NAME = 255;

/** One style definition, read by layout's identity rules, with the element it came from. */
export interface StyleDefinitionEntry {
  readonly styleId: string;
  /** The `w:type`, or an empty string where the part states none. */
  readonly type: string;
  /** The `w:name`, or null where the part gives none of at most `MAX_STYLE_NAME` characters. */
  readonly name: string | null;
  /** The `w:basedOn` id, or null. */
  readonly basedOn: string | null;
  /** The `w:next` id, or null. */
  readonly next: string | null;
  readonly element: OoxmlElement;
}

/** What one styles part defines, as automation reads it. */
export interface StyleDefinitions {
  /** Every counted definition that wins its id, in the order the part writes the winners. */
  readonly entries: readonly StyleDefinitionEntry[];
  /** The paragraph style id a folded name belongs to. The first definition of a name wins. */
  readonly paragraphIdByName: ReadonlyMap<string, string>;
  /** The `w:name` of each paragraph style id, or null where the part gives none. */
  readonly paragraphNameById: ReadonlyMap<string, string | null>;
  /** The default paragraph style id, resolved by layout's rule, or null. */
  readonly defaultParagraphId: string | null;
}

/**
 * The form two style names are compared in: surrounding spaces dropped, case folded. Used by the
 * style setters, the listing, and a listing lookup by name, so the three cannot drift apart.
 */
export function styleNameKey(name: string): string {
  return name.trim().toLowerCase();
}

const cache = new WeakMap<OoxmlNode, StyleDefinitions>();

/** The definitions of one styles part, built once per part root. */
export function styleDefinitionsOf(part: OoxmlPart): StyleDefinitions {
  const cached = cache.get(part.root);
  if (cached) return cached;
  const built = build(part.root);
  cache.set(part.root, built);
  return built;
}

function build(root: OoxmlElement): StyleDefinitions {
  const read: StyleDefinitionEntry[] = [];
  const winner = new Map<string, StyleDefinitionEntry>();
  let defaultParagraphId: string | null = null;
  let counted = 0;
  // Bounded: the walk itself stops at the cap, as layout's does.
  for (const child of root.children) {
    if (!isElement(child) || child.localName !== 'style') continue;
    if (counted >= MAX_STYLE_DEFINITIONS) break;
    counted += 1;
    const identity = readStyleIdentity(child, MAX_STYLE_NAME);
    if (!identity) continue;
    const { styleId } = identity;
    const entry: StyleDefinitionEntry = Object.freeze({
      styleId,
      type: identity.type,
      name: identity.name ?? null,
      basedOn: identity.basedOn,
      next: identity.next,
      element: child,
    });
    read.push(entry);
    // Last duplicate wins. The default paragraph style follows layout's rule exactly: only a
    // paragraph definition sets or clears it, so a later duplicate of another type keeps it.
    winner.set(styleId, entry);
    if (entry.type === 'paragraph') {
      if (identity.isDefault) defaultParagraphId = styleId;
      else if (defaultParagraphId === styleId) defaultParagraphId = null;
    }
  }
  const entries = read.filter((entry) => winner.get(entry.styleId) === entry);
  const paragraphIdByName = new Map<string, string>();
  const paragraphNameById = new Map<string, string | null>();
  for (const entry of entries) {
    if (entry.type !== 'paragraph') continue;
    paragraphNameById.set(entry.styleId, entry.name);
    if (entry.name === null) continue;
    const key = styleNameKey(entry.name);
    // First definition of a name wins: a later style must not silently retarget a name.
    if (!paragraphIdByName.has(key)) paragraphIdByName.set(key, entry.styleId);
  }
  return Object.freeze({
    entries: Object.freeze(entries),
    paragraphIdByName,
    paragraphNameById,
    defaultParagraphId,
  });
}
