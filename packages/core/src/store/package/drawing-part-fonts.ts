// Faces named by the parts a drawing renders from: chart parts, saved diagram drawings, and
// EMF and WMF pictures.
//
// Their labels lower to stories that live outside every document story, so a collector that
// walks the stories never sees the faces they name. Theme font tokens (`+mn-lt`, `+mj-lt`)
// name the theme's faces, which chart text also takes when it names none. The walk and the
// result are bounded: family names are file-supplied.

import { CHART_NAMESPACE_URI } from './chart-parts.ts';
import { DIAGRAM_DRAWING_NAMESPACE_URI } from './diagram-parts.ts';
import { schemaAttributeValue } from './ooxml-drawing-rules.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlElement } from './ooxml-tree.ts';
import { validFontFamily } from './run-defaults.ts';
import { metafileFontFamilies } from './metafile-fonts.ts';

const MAX_NODES = 200_000;
const MAX_FAMILIES = 32;
const FACE_ELEMENTS = new Set(['latin', 'ea', 'cs']);

/** The theme's Latin faces, for theme font tokens. */
export interface DrawingPartThemeFonts {
  readonly major?: string | null;
  readonly minor?: string | null;
}

/** The typefaces one part names, in order; parts are immutable, so this is kept per root. */
const PART_TYPEFACES = new WeakMap<OoxmlElement, readonly string[]>();

function partTypefaces(root: OoxmlElement): readonly string[] {
  const cached = PART_TYPEFACES.get(root);
  if (cached) return cached;
  const out: string[] = [];
  const seen = new Set<string>();
  const stack: OoxmlElement[] = [root];
  let visited = 0;
  while (stack.length > 0 && ++visited <= MAX_NODES && out.length < MAX_FAMILIES) {
    const node = stack.pop()!;
    if (node.namespaceUri === DRAWINGML_MAIN_NAMESPACE_URI && FACE_ELEMENTS.has(node.localName)) {
      const typeface = schemaAttributeValue(node.attributes, 'typeface');
      if (typeface && !seen.has(typeface)) {
        seen.add(typeface);
        out.push(typeface);
      }
      continue;
    }
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      const child = node.children[index]!;
      if (child.kind !== 'textValue') stack.push(child as OoxmlElement);
    }
  }
  PART_TYPEFACES.set(root, out);
  return out;
}

/** Faces named in chart and saved diagram parts, in part order. */
export function drawingPartFontFamilies(
  pkg: OoxmlPackage,
  theme: DrawingPartThemeFonts = {}
): readonly string[] {
  const byFold = new Map<string, string>();
  const add = (raw: string | null | undefined): void => {
    const family = raw ? validFontFamily(raw) : null;
    if (family === null || byFold.size >= MAX_FAMILIES) return;
    const fold = family.toLowerCase();
    if (!byFold.has(fold)) byFold.set(fold, family);
  };
  for (const part of pkg.parts.values()) {
    const root = part.root;
    if (
      root.namespaceUri !== CHART_NAMESPACE_URI &&
      root.namespaceUri !== DIAGRAM_DRAWING_NAMESPACE_URI
    )
      continue;
    // Text that names no face takes the theme's body face.
    add(theme.minor);
    for (const typeface of partTypefaces(root)) {
      if (typeface.startsWith('+mj')) add(theme.major);
      else if (typeface.startsWith('+mn')) add(theme.minor);
      else add(typeface);
    }
  }
  // EMF and WMF pictures name their text faces in their own font records.
  for (const face of metafileFontFamilies(pkg, validFontFamily)) add(face);
  return [...byFold.values()];
}
