// The style definitions automation reads, from one walk of the styles part.
//
// INTERNAL. The paragraph style index (`setStyle`, `style` reads) and the style listing
// (`getStyles`) both start here, so they agree about which styles exist and how a name compares.
//
// CACHED ON THE PART ROOT. Trees are immutable, so a body edit leaves the styles part's root the
// same object and the definitions are reused; only an edit to `styles.xml` builds them again.
//
// BOUNDED. Only the first `MAX_STYLE_DEFINITIONS` `w:style` children of the root count, the same
// bound and the same direct-children rule layout uses, so automation never names a style the page
// does not resolve.

import { indexStyles, type StyleIndexEntry } from '../store/package/ooxml-indexes.ts';
import type { OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import { MAX_STYLE_DEFINITIONS } from '../layout/style-cascade.ts';

/** What one styles part defines, as automation reads it. */
export interface StyleDefinitions {
  /** Every counted definition, first per id, in part order. */
  readonly entries: readonly StyleIndexEntry[];
  /** The paragraph style id a folded name belongs to. The first definition of a name wins. */
  readonly paragraphIdByName: ReadonlyMap<string, string>;
  /** The `w:name` of each paragraph style id, or null where the part gives none. */
  readonly paragraphNameById: ReadonlyMap<string, string | null>;
  /** The paragraph style the part marks as default, or null. */
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
  const built = build(part);
  cache.set(part.root, built);
  return built;
}

function build(part: OoxmlPart): StyleDefinitions {
  const counted = new Set<string>();
  for (const child of part.root.children) {
    if (child.kind === 'textValue' || child.localName !== 'style') continue;
    if (counted.size >= MAX_STYLE_DEFINITIONS) break;
    counted.add(child.id);
  }
  const entries: StyleIndexEntry[] = [];
  const paragraphIdByName = new Map<string, string>();
  const paragraphNameById = new Map<string, string | null>();
  let defaultParagraphId: string | null = null;
  for (const entry of indexStyles(part).values()) {
    if (!counted.has(entry.nodeId)) continue;
    entries.push(entry);
    if (entry.type !== 'paragraph') continue;
    paragraphNameById.set(entry.styleId, entry.name);
    if (entry.name !== null) {
      const key = styleNameKey(entry.name);
      // First definition wins, matching the store's own index: a later duplicate must not
      // silently retarget a name.
      if (!paragraphIdByName.has(key)) paragraphIdByName.set(key, entry.styleId);
    }
    if (entry.isDefault && defaultParagraphId === null) defaultParagraphId = entry.styleId;
  }
  return Object.freeze({
    entries: Object.freeze(entries),
    paragraphIdByName,
    paragraphNameById,
    defaultParagraphId,
  });
}
