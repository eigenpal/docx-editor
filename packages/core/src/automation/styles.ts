// Paragraph styles, named the way a reader names them.
//
// INTERNAL. Two directions over one index of `styles.xml`.
//
// THE NAME IS NOT THE ID. `w:styleId="Heading1"` is what a paragraph states; `heading 1` is what the
// styles gallery shows and what an object model talks in. They are routinely different, and a lane
// that answered the id would hand a caller a value that reads like a name, works on documents Word
// wrote in English, and stops working on one it wrote in German. So a read resolves the id to the
// part's own `w:name`, and a write resolves the name back to an id.
//
// AN UNKNOWN NAME IS REFUSED, NEVER MINTED. A host that added a style definition on demand would
// report "applied" for a style with no formatting in it: the paragraph would look untouched while
// reading back as styled. It also turns an attacker-controlled string into a new part rather than an
// error, which is the wrong way round for a lane whose input is a file and a caller it does not
// trust.
//
// UNTRUSTED VALUES. A name reaching `setStyle` is caller input; a name read back is FILE input. The
// caller's is bounded and validated as XML text here, and only ever compared against names the
// document already declares — nothing is templated into markup and no id is derived from it.

import { indexStyles, stylesPartOf } from '../store/package/ooxml-indexes.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import { isValidXmlText } from '../store/package/sinks.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import { namedChild, paragraphPropertiesNodeOf } from '../store/store/tree-op-nodes.ts';

/** Longest style name a write may carry. Word's own limit is far below this. */
const MAX_NAME = 255;

/** What the document says its paragraph styles are. */
export interface AutomationStyleIndex {
  /** The name a paragraph style id shows in a gallery, or null for an id the part omits one for. */
  nameOf(styleId: string): string | null;
  /** The paragraph style id a name belongs to, matched case-insensitively, or null. */
  idOf(name: string): string | null;
  /** The id the part marks as the default paragraph style, or null. */
  readonly defaultId: string | null;
  /** Whether the package has a styles part at all. */
  readonly present: boolean;
}

const NO_STYLES: AutomationStyleIndex = Object.freeze({
  nameOf: () => null,
  idOf: () => null,
  defaultId: null,
  present: false,
});

/**
 * Index the package's PARAGRAPH styles.
 *
 * Character and table styles are indexed by the store helper too and are dropped here on purpose:
 * this is what a paragraph may be set to, and quietly accepting a character style would write a
 * `w:pStyle` naming something Word resolves to nothing.
 */
export function styleIndex(pkg: OoxmlPackage): AutomationStyleIndex {
  const part = stylesPartOf(pkg);
  if (!part) return NO_STYLES;
  const byId = new Map<string, string | null>();
  const byName = new Map<string, string>();
  let defaultId: string | null = null;
  for (const entry of indexStyles(part).values()) {
    if (entry.type !== 'paragraph') continue;
    byId.set(entry.styleId, entry.name);
    if (entry.name !== null) {
      const folded = entry.name.trim().toLowerCase();
      // First definition wins, matching the store's own index: a later duplicate must not
      // silently retarget a name.
      if (!byName.has(folded)) byName.set(folded, entry.styleId);
    }
    if (entry.isDefault && defaultId === null) defaultId = entry.styleId;
  }
  return Object.freeze({
    nameOf: (styleId: string) => byId.get(styleId) ?? null,
    idOf: (name: string) => byName.get(name.trim().toLowerCase()) ?? null,
    defaultId,
    present: true,
  });
}

/**
 * The style NAME a paragraph has, or null when nothing names one.
 *
 * A paragraph that states no `w:pStyle` answers the part's own default paragraph style, because
 * that is the style it has — `w:docDefaults` and `w:default="1"` are the document saying so, not
 * this lane guessing. A package with no styles part answers null: there is no name to give.
 */
export function paragraphStyleName(
  part: OoxmlPart,
  paragraphId: string,
  styles: AutomationStyleIndex
): string | null {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return null;
  const stated = attributeOf(namedChild(paragraphPropertiesNodeOf(paragraph), 'pStyle'));
  if (stated !== null) return styles.nameOf(stated);
  return styles.defaultId === null ? null : styles.nameOf(styles.defaultId);
}

function attributeOf(
  element:
    | { readonly attributes: readonly { readonly localName: string; readonly value: string }[] }
    | undefined
): string | null {
  if (!element) return null;
  for (const entry of element.attributes) {
    if (entry.localName === 'val') return entry.value;
  }
  return null;
}

export type StylePlan =
  | { readonly ok: true; readonly styleId: string }
  | { readonly ok: false; readonly detail: string };

/**
 * The `w:pStyle` id a name may be written as, or why it may not.
 *
 * Every refusal is the same kind of refusal — this document does not define that paragraph style —
 * and the detail says which check it failed, so a caller can tell a typo from a character style
 * from a name the file never had.
 */
export function styleIdFor(name: unknown, styles: AutomationStyleIndex): StylePlan {
  if (typeof name !== 'string' || name.trim().length === 0)
    return { ok: false, detail: 'style: not a name' };
  if (name.length > MAX_NAME) return { ok: false, detail: 'style: name too long' };
  if (!isValidXmlText(name)) return { ok: false, detail: 'style: not valid XML text' };
  if (!styles.present) return { ok: false, detail: 'style: this document defines no styles' };
  const styleId = styles.idOf(name);
  if (styleId === null)
    return { ok: false, detail: 'style: this document defines no paragraph style with that name' };
  return { ok: true, styleId };
}
