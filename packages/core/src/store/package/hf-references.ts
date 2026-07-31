// Header/footer reference resolution over the canonical package (phase 2 of the
// legacy-lane retirement).
//
// Everything needed is already parsed: `pkg.parts` holds each header/footer part as a
// canonical tree and `pkg.relationships` holds every rels part with fail-closed internal
// target resolution. This module only CONNECTS them: each section's `w:sectPr`
// `w:headerReference`/`w:footerReference` children name relationship ids; each resolves
// through the main part's rels — filtered by the header/footer type URIs — to a part name.
//
// Inheritance (ECMA-376 §17.10.1): a section that omits a given header/footer variant
// inherits that variant from the previous section. The first section with no refs therefore
// has no furniture; a later section that declares its own refs uses those; a later section
// that declares nothing keeps the previous section's furniture.
//
// Fail-open per reference, exactly as Word behaves: a dangling r:id renders no header
// rather than refusing the document. Traversal safety was already enforced at load.

import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import type { OoxmlPart } from './ooxml-tree.ts';
import { resolveRelationship, type RelationshipRecord } from './relationships.ts';

const HEADER_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
const FOOTER_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';
const SETTINGS_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings';

/** Nested `w:sdt` wrappers deeper than this stop flattening; mirrors `storyBlocks`. */
const MAX_SDT_NESTING = 32;

/** `w:headerReference w:type` vocabulary (ECMA-376 §17.10.5): default, first page, even pages. */
export type HeaderFooterVariant = 'default' | 'first' | 'even';

export interface HeaderFooterParts {
  readonly headers: ReadonlyMap<HeaderFooterVariant, OoxmlPart>;
  readonly footers: ReadonlyMap<HeaderFooterVariant, OoxmlPart>;
  /** `w:evenAndOddHeaders` in settings.xml — without it the `even` variant is ignored. */
  readonly evenAndOddHeaders: boolean;
  /** Effective `w:titlePg` after section inheritance. */
  readonly titlePage: boolean;
}

const EMPTY: HeaderFooterParts = Object.freeze({
  headers: new Map(),
  footers: new Map(),
  evenAndOddHeaders: false,
  titlePage: false,
});

function elementChildren(node: OoxmlNode): readonly OoxmlNode[] {
  return node.kind === 'textValue' ? [] : node.children;
}

function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

function variantOf(raw: string | undefined): HeaderFooterVariant | null {
  return raw === 'default' || raw === 'first' || raw === 'even' ? raw : null;
}

function childNamed(node: OoxmlNode, localName: string): OoxmlElement | undefined {
  for (const child of elementChildren(node)) {
    if (child.kind !== 'textValue' && child.localName === localName) return child;
  }
  return undefined;
}

function findBody(root: OoxmlNode): OoxmlElement | undefined {
  if (root.kind === 'textValue') return undefined;
  if (root.kind === 'body' || root.localName === 'body') return root;
  for (const child of root.children) {
    const found = findBody(child);
    if (found) return found;
  }
  return undefined;
}

/**
 * Body story blocks in document order, flattening block SDTs — same shape as layout's
 * `storyBlocks`, duplicated here so the store package does not import layout.
 */
function bodyBlocks(body: OoxmlElement): OoxmlElement[] {
  const blocks: OoxmlElement[] = [];
  const collect = (children: readonly OoxmlNode[], depth: number): void => {
    for (const child of children) {
      if (child.kind === 'paragraph' || child.kind === 'table') {
        blocks.push(child);
        continue;
      }
      if (child.kind === 'generic' && child.localName === 'sdt' && depth < MAX_SDT_NESTING) {
        for (const inner of child.children) {
          if (inner.kind !== 'textValue' && inner.localName === 'sdtContent') {
            collect(inner.children, depth + 1);
          }
        }
      }
    }
  };
  collect(body.children, 0);
  return blocks;
}

function paragraphSectPr(paragraph: OoxmlElement): OoxmlElement | undefined {
  const pPr =
    paragraph.children.find((child) => child.kind === 'paragraphProperties') ??
    childNamed(paragraph, 'pPr');
  if (!pPr || pPr.kind === 'textValue') return undefined;
  return childNamed(pPr, 'sectPr');
}

/**
 * `w:sectPr` nodes in section order, aligned with layout's `enumerateDocumentSections`.
 *
 * `null` means a section with no `w:sectPr` node (Word defaults, inherits HF from previous).
 * Paragraph-level breaks first; the final entry covers remaining blocks (body-level or null).
 */
export function collectSectionPropertyNodes(root: OoxmlNode): Array<OoxmlElement | null> {
  const body = findBody(root);
  if (!body) return [];
  const blocks = bodyBlocks(body);
  const found: Array<OoxmlElement | null> = [];
  let blockStart = 0;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    if (block.kind !== 'paragraph') continue;
    const sectPr = paragraphSectPr(block);
    if (!sectPr) continue;
    found.push(sectPr);
    blockStart = index + 1;
  }
  if (blockStart < blocks.length || found.length === 0) {
    found.push(childNamed(body, 'sectPr') ?? null);
  } else {
    const bodySectPr = childNamed(body, 'sectPr');
    if (bodySectPr) found.push(bodySectPr);
  }
  return found;
}

function referencesFromSectPr(
  sectPr: OoxmlElement,
  partForReference: (relId: string | undefined, typeUri: string) => OoxmlPart | undefined
): {
  headers: Map<HeaderFooterVariant, OoxmlPart>;
  footers: Map<HeaderFooterVariant, OoxmlPart>;
  titlePage: boolean;
} {
  const headers = new Map<HeaderFooterVariant, OoxmlPart>();
  const footers = new Map<HeaderFooterVariant, OoxmlPart>();
  for (const child of elementChildren(sectPr)) {
    if (child.kind === 'textValue') continue;
    const isHeader = child.localName === 'headerReference';
    const isFooter = child.localName === 'footerReference';
    if (!isHeader && !isFooter) continue;
    const variant = variantOf(attributeValue(child, 'type'));
    if (!variant) continue;
    const part = partForReference(
      attributeValue(child, 'id'),
      isHeader ? HEADER_REL_TYPE : FOOTER_REL_TYPE
    );
    if (!part) continue;
    const target = isHeader ? headers : footers;
    // Word honours the FIRST reference of a given type; a duplicate is ignored.
    if (!target.has(variant)) target.set(variant, part);
  }
  return {
    headers,
    footers,
    titlePage: childNamed(sectPr, 'titlePg') !== undefined,
  };
}

function inheritMaps(
  previous: ReadonlyMap<HeaderFooterVariant, OoxmlPart> | undefined,
  declared: ReadonlyMap<HeaderFooterVariant, OoxmlPart>
): Map<HeaderFooterVariant, OoxmlPart> {
  const result = new Map<HeaderFooterVariant, OoxmlPart>();
  if (previous) {
    for (const [variant, part] of previous) result.set(variant, part);
  }
  // Declared refs replace inherited ones per variant; a section that declares nothing keeps
  // the full previous map.
  for (const [variant, part] of declared) result.set(variant, part);
  return result;
}

/**
 * Resolve header/footer parts for every section, applying OOXML inheritance.
 *
 * Index aligns with `enumerateDocumentSections` in the layout package.
 */
export function resolveHeaderFooterPartsBySection(pkg: OoxmlPackage): readonly HeaderFooterParts[] {
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) return [];

  const relationships = pkg.relationships.get(pkg.mainDocumentPart) ?? [];
  const evenAndOddHeaders = readEvenAndOddHeaders(pkg, relationships);
  const partForReference = (relId: string | undefined, typeUri: string): OoxmlPart | undefined => {
    if (!relId) return undefined;
    const record = relationships.find((rel) => rel.id === relId && rel.type === typeUri);
    if (!record) return undefined;
    const resolved = resolveRelationship(record);
    if (resolved.mode !== 'Internal' || !resolved.target.ok) return undefined;
    return pkg.parts.get(resolved.target.partName);
  };

  const sectPrNodes = collectSectionPropertyNodes(main.root);
  if (sectPrNodes.length === 0) return [EMPTY];

  const result: HeaderFooterParts[] = [];
  let previous: HeaderFooterParts | undefined;
  for (const sectPr of sectPrNodes) {
    const declared = sectPr
      ? referencesFromSectPr(sectPr, partForReference)
      : { headers: new Map(), footers: new Map(), titlePage: false };
    // titlePg is presence-based: an explicit element sets it; omission inherits.
    const titlePage = declared.titlePage ? true : (previous?.titlePage ?? false);
    const resolved: HeaderFooterParts = {
      headers: inheritMaps(previous?.headers, declared.headers),
      footers: inheritMaps(previous?.footers, declared.footers),
      evenAndOddHeaders,
      titlePage,
    };
    result.push(resolved);
    previous = resolved;
  }
  return result;
}

/**
 * Resolve the main-document header/footer references to their parts, gated by the
 * settings the section actually declares.
 *
 * Returns the FINAL section's effective parts (after inheritance). Multi-section hosts
 * should prefer `resolveHeaderFooterPartsBySection`.
 */
export function resolveHeaderFooterParts(pkg: OoxmlPackage): HeaderFooterParts {
  const bySection = resolveHeaderFooterPartsBySection(pkg);
  return bySection[bySection.length - 1] ?? EMPTY;
}

function readEvenAndOddHeaders(
  pkg: OoxmlPackage,
  mainRelationships: readonly RelationshipRecord[]
): boolean {
  const settingsRel = mainRelationships.find((rel) => rel.type === SETTINGS_REL_TYPE);
  if (!settingsRel) return false;
  const resolved = resolveRelationship(settingsRel);
  if (resolved.mode !== 'Internal' || !resolved.target.ok) return false;
  const settings = pkg.parts.get(resolved.target.partName);
  if (!settings) return false;
  for (const child of elementChildren(settings.root)) {
    if (child.kind === 'textValue' || child.localName !== 'evenAndOddHeaders') continue;
    const value = attributeValue(child, 'val');
    return value !== '0' && value !== 'false';
  }
  return false;
}
