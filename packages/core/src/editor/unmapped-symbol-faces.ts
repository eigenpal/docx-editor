// The `w:sym` faces a document cannot do without.
//
// A symbol glyph with a Unicode equivalent paints in any face, so a missing symbol face
// loses nothing. A private-use glyph (`U+F0xx` with no table entry, or a face with no table
// at all) means something only in its own face; without it the reader sees a missing-glyph
// box. Those faces belong in the font-substitution notice even though they render no text.

import type { TreeDocxSessionView } from '../binding/tree-session-contract.ts';
import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
} from '../store/package/ooxml-tree.ts';
import { symbolFontFamily } from '../store/package/run-defaults.ts';
import { symbolGlyphOf } from '../store/package/symbol-glyph.ts';

function isElement(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

const NO_FACES: ReadonlyMap<string, string> = new Map();

/** Per-block answer; blocks are immutable per revision, so an edit re-walks only its own. */
const blockMemo = new WeakMap<OoxmlElement, ReadonlyMap<string, string>>();

const sessionMemo = new WeakMap<
  TreeDocxSessionView,
  { readonly revision: number; readonly faces: readonly string[] }
>();

function blockFaces(block: OoxmlElement): ReadonlyMap<string, string> {
  const cached = blockMemo.get(block);
  if (cached) return cached;
  const byFold = new Map<string, string>();
  // Iterative, so a deeply nested hostile tree cannot overflow the stack.
  const stack: OoxmlElement[] = [block];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.localName === 'sym' && node.namespaceUri === WML_NAMESPACE_URI) {
      const glyph = symbolGlyphOf(node);
      const family = glyph && !glyph.unicode ? symbolFontFamily(glyph.font ?? undefined) : null;
      if (family !== null && !byFold.has(family.toLowerCase()))
        byFold.set(family.toLowerCase(), family);
      continue;
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      const child = node.children[i]!;
      if (isElement(child)) stack.push(child);
    }
  }
  const answer = byFold.size === 0 ? NO_FACES : byFold;
  blockMemo.set(block, answer);
  return answer;
}

/**
 * Faces named by a `w:sym` whose glyph has no Unicode equivalent, in reading order and
 * deduplicated case-insensitively. Memoized per package revision.
 */
export function unmappedSymbolFaces(session: TreeDocxSessionView): readonly string[] {
  const revision = session.packageRevision();
  const cached = sessionMemo.get(session);
  if (cached?.revision === revision) return cached.faces;
  // Most documents name no symbol face, and then there is nothing to walk.
  const faces: string[] = [];
  if (session.symbolFontFamilies().length > 0) {
    const seen = new Set<string>();
    for (const part of session.storyParts()) {
      for (const child of part.root.children) {
        if (!isElement(child)) continue;
        for (const [fold, family] of blockFaces(child)) {
          if (seen.has(fold)) continue;
          seen.add(fold);
          faces.push(family);
        }
      }
    }
  }
  sessionMemo.set(session, { revision, faces });
  return faces;
}

/**
 * The families the font-substitution notice checks: faces text renders in, then the faces
 * an unmapped symbol glyph needs. A face already in the first list is not repeated.
 */
export function renderedAndUnmappedSymbolFaces(session: TreeDocxSessionView): readonly string[] {
  const rendered = session.renderedFontFamilies();
  const symbols = unmappedSymbolFaces(session);
  if (symbols.length === 0) return rendered;
  const seen = new Set(rendered.map((family) => family.toLowerCase()));
  const extra = symbols.filter((family) => !seen.has(family.toLowerCase()));
  return extra.length === 0 ? rendered : [...rendered, ...extra];
}
