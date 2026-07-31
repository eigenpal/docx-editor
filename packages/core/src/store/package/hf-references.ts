// Header/footer reference resolution over the canonical package (phase 2 of the
// legacy-lane retirement).
//
// Everything needed is already parsed: `pkg.parts` holds each header/footer part as a
// canonical tree and `pkg.relationships` holds every rels part with fail-closed internal
// target resolution. This module only CONNECTS them: the body `w:sectPr`'s
// `w:headerReference`/`w:footerReference` children name relationship ids; each resolves
// through the main part's rels — filtered by the header/footer type URIs — to a part name.
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

/** `w:headerReference w:type` vocabulary (ECMA-376 §17.10.5): default, first page, even pages. */
export type HeaderFooterVariant = 'default' | 'first' | 'even';

export interface HeaderFooterParts {
  readonly headers: ReadonlyMap<HeaderFooterVariant, OoxmlPart>;
  readonly footers: ReadonlyMap<HeaderFooterVariant, OoxmlPart>;
  /** `w:evenAndOddHeaders` in settings.xml — without it the `even` variant is ignored. */
  readonly evenAndOddHeaders: boolean;
}

const EMPTY: HeaderFooterParts = Object.freeze({
  headers: new Map(),
  footers: new Map(),
  evenAndOddHeaders: false,
});

function elementChildren(node: OoxmlNode): readonly OoxmlNode[] {
  return node.kind === 'textValue' ? [] : node.children;
}

function findBodySectPr(root: OoxmlNode): OoxmlElement | undefined {
  if (root.kind === 'textValue') return undefined;
  const walk = (node: OoxmlNode): OoxmlElement | undefined => {
    if (node.kind === 'textValue') return undefined;
    if (node.kind === 'body' || node.localName === 'body') {
      for (const child of node.children) {
        if (child.kind !== 'textValue' && child.localName === 'sectPr') return child;
      }
      return undefined;
    }
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return undefined;
  };
  return walk(root);
}

function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

function variantOf(raw: string | undefined): HeaderFooterVariant | null {
  return raw === 'default' || raw === 'first' || raw === 'even' ? raw : null;
}

/**
 * Resolve the main-document header/footer references to their parts, gated by the
 * settings the section actually declares.
 */
export function resolveHeaderFooterParts(pkg: OoxmlPackage): HeaderFooterParts {
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) return EMPTY;
  const sectPr = findBodySectPr(main.root);
  if (!sectPr) return EMPTY;

  const relationships = pkg.relationships.get(pkg.mainDocumentPart) ?? [];
  const partForReference = (relId: string | undefined, typeUri: string): OoxmlPart | undefined => {
    if (!relId) return undefined;
    const record = relationships.find((rel) => rel.id === relId && rel.type === typeUri);
    if (!record) return undefined;
    const resolved = resolveRelationship(record);
    if (resolved.mode !== 'Internal' || !resolved.target.ok) return undefined;
    return pkg.parts.get(resolved.target.partName);
  };

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
    evenAndOddHeaders: readEvenAndOddHeaders(pkg, relationships),
  };
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
