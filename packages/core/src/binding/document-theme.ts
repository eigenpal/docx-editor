// Theme colour derivation: the document's `a:clrScheme`, projected for a colour picker.
//
// Reads the CANONICAL theme tree — never the DOM, never the layout. Word's picker shows
// ten theme columns (Background 1, Text 1, Background 2, Text 2, Accent 1-6); this module
// answers those ten base colours in that order. Tint/shade variants are presentation and
// belong to the chrome that draws the matrix.
//
// Every hex that leaves this module is validated here: scheme colours are authored file
// content, and downstream sinks (inline swatch backgrounds, `w:color` writes) must only
// receive values this module has already bounded.

import type { OoxmlElement, OoxmlNode } from '../store/package/ooxml-tree.ts';
import { collectThemeColorScheme } from '../store/package/theme-color-resolution.ts';

/**
 * The scheme slots the picker shows, in Word's column order.
 *
 * Assumes the default `w:clrSchemeMapping` (bg1→lt1, t1→dk1, ...); a settings part
 * that remaps them is rare and a follow-up.
 */
const PICKER_SLOTS = [
  'lt1',
  'dk1',
  'lt2',
  'dk2',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
] as const;

export type ThemeColorSlot = (typeof PICKER_SLOTS)[number];

/** One theme colour: the scheme slot and its resolved six-digit hex (no '#'). */
export interface DocumentThemeColorEntry {
  readonly slot: ThemeColorSlot;
  readonly hex: string;
}

function isElement(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

/** Depth-first search for the first element with a local name, document order. */
function findElement(root: OoxmlElement, localName: string): OoxmlElement | null {
  const stack: OoxmlNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (!isElement(node)) continue;
    if (node.localName === localName) return node;
    for (let i = node.children.length - 1; i >= 0; i -= 1) stack.push(node.children[i]!);
  }
  return null;
}

/** The first element child, or the one with a given local name. */
function elementChild(parent: OoxmlElement, localName?: string): OoxmlElement | null {
  for (const child of parent.children) {
    if (!isElement(child)) continue;
    if (localName === undefined || child.localName === localName) return child;
  }
  return null;
}

/** The theme's two font slots, for resolving `w:rFonts` theme attributes. */
export interface DocumentThemeFonts {
  /** `a:majorFont` latin typeface — headings. */
  readonly major: string | null;
  /** `a:minorFont` latin typeface — body text. */
  readonly minor: string | null;
}

/** The CSS-sink shape font names must satisfy (document-catalog's `FONT_NAME`). */
const FONT_NAME = /^[\p{L}\p{N}\p{M} \-.+_]{1,64}$/u;

/** A validated `a:latin` typeface under `a:majorFont`/`a:minorFont`, or null. */
function latinTypeface(scheme: OoxmlElement, slot: string): string | null {
  const font = elementChild(scheme, slot);
  const latin = font ? elementChild(font, 'latin') : null;
  const raw = latin ? attributeValue(latin, 'typeface') : undefined;
  return raw !== undefined && FONT_NAME.test(raw) ? raw : null;
}

/**
 * The theme part's `a:fontScheme` typefaces. Independent slots — a valid minor font
 * is answered even when the major is missing or invalid, unlike the colour scheme's
 * all-or-nothing rule, because each resolves a different `w:rFonts` attribute.
 */
export function collectDocumentThemeFonts(themeRoot: OoxmlElement | null): DocumentThemeFonts {
  if (!themeRoot) return { major: null, minor: null };
  const scheme = findElement(themeRoot, 'fontScheme');
  if (!scheme) return { major: null, minor: null };
  return {
    major: latinTypeface(scheme, 'majorFont'),
    minor: latinTypeface(scheme, 'minorFont'),
  };
}

/**
 * The ten picker colours of a theme part's `a:clrScheme`, or `[]` when the scheme is
 * absent or incomplete — all or nothing, so chrome can fall back to a default palette
 * rather than showing a matrix with holes.
 */
export function collectDocumentThemeColors(
  themeRoot: OoxmlElement | null
): readonly DocumentThemeColorEntry[] {
  const scheme = collectThemeColorScheme(themeRoot);
  const entries: DocumentThemeColorEntry[] = [];
  for (const slot of PICKER_SLOTS) {
    const hex = scheme.get(slot);
    if (!hex) return [];
    entries.push({ slot, hex });
  }
  return entries;
}
