// The style definitions automation reads, from one bounded walk of the styles part.
//
// INTERNAL. The paragraph style index (`setStyle`, `style` reads), the style listing (`getStyles`)
// and table style names all start here, so they agree about which styles exist and how a name
// compares.
//
// THE SAME DEFINITIONS THE PAGE RESOLVES. Each definition is read with layout's own
// `readStyleDefinition`, over the same direct `w:style` children of the root, under the same
// `MAX_STYLE_DEFINITIONS` bound, and a repeated `w:styleId` resolves the way layout's cascade table
// does: the last definition wins. So a style automation lists or applies is the style the page
// paints.
//
// CACHED ON THE PART ROOT. Trees are immutable, so a body edit leaves the styles part's root the
// same object and the definitions are reused; only an edit to `styles.xml` builds them again.

import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import { MAX_STYLE_DEFINITIONS } from '../layout/style-cascade.ts';
import { isElement, readStyleDefinition } from '../layout/style-definition-reader.ts';

/** One style definition, as layout reads it, with the element it came from. */
export interface StyleDefinitionEntry {
  readonly styleId: string;
  /** The `w:type`, or an empty string where the part states none. */
  readonly type: string;
  /** The `w:name`, or null where the part gives none layout accepts. */
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
  /** The paragraph style the part marks as default, resolved as layout resolves it, or null. */
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
  // The walk itself is bounded: it stops at the cap, as layout's does.
  const read: StyleDefinitionEntry[] = [];
  const winner = new Map<string, StyleDefinitionEntry>();
  let defaultParagraphId: string | null = null;
  let counted = 0;
  for (const child of root.children) {
    if (!isElement(child) || child.localName !== 'style') continue;
    if (counted >= MAX_STYLE_DEFINITIONS) break;
    counted += 1;
    const definition = readStyleDefinition(child);
    if (!definition) continue;
    const entry: StyleDefinitionEntry = Object.freeze({
      styleId: definition.styleId,
      type: definition.type,
      name: definition.name ?? null,
      basedOn: definition.basedOn,
      next: definition.next,
      element: child,
    });
    read.push(entry);
    // Last duplicate wins, and the default flag follows the winning definition, as in layout.
    winner.set(entry.styleId, entry);
    if (entry.type === 'paragraph') {
      if (definition.isDefault) defaultParagraphId = entry.styleId;
      else if (defaultParagraphId === entry.styleId) defaultParagraphId = null;
    }
  }
  if (defaultParagraphId !== null && winner.get(defaultParagraphId)?.type !== 'paragraph')
    defaultParagraphId = null;
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
