// Read-only package view used by DOM-free layout consumers.

import {
  EMPTY_DOCUMENT_PROPERTIES,
  readDocumentProperties,
  type DocumentProperties,
} from './package/document-properties.ts';
import {
  resolveHeaderFooterPartsBySection,
  type HeaderFooterParts,
} from './package/hf-references.ts';
import {
  readOoxmlPackage,
  type OoxmlPackage,
  type OoxmlPackageRejection,
} from './package/ooxml-package.ts';
import { resolveRelationship } from './package/relationships.ts';
import { type OoxmlElement, type OoxmlNode, type OoxmlPart } from './package/ooxml-tree.ts';
import { normalizeParagraphIdentity } from './package/para-id.ts';
import { relationshipTargetIn } from './package/hyperlink-part.ts';
import { TreePackageStore } from './store/tree-package-store.ts';

/** Theme typefaces already validated for use by layout. @public */
export interface HeadlessThemeFonts {
  readonly major: string | null;
  readonly minor: string | null;
}

/**
 * The read capabilities shared by browser layout, server export, and future renderers.
 *
 * It deliberately exposes resolved package facts rather than a binding or editor session.
 * An exporter can therefore consume the live document without importing ProseMirror or a DOM.
 * @public
 */
export interface HeadlessDocumentView {
  part(): OoxmlPart;
  currentPackage(): OoxmlPackage;
  packageRevision(): number;
  stylesRoot(): OoxmlElement | null;
  numberingRoot(): OoxmlElement | null;
  settingsRoot(): OoxmlElement | null;
  documentThemeFonts(): HeadlessThemeFonts;
  documentProperties(): DocumentProperties;
  headerFooterPartsBySection(): readonly HeaderFooterParts[];
  relationshipTarget(relationshipId: string): ReturnType<typeof relationshipTargetIn>;
}

/** A bad package is data, not an exceptional control path. @public */
export type HeadlessDocumentRejection = OoxmlPackageRejection | 'no-main-document-tree';

/** Result of opening untrusted DOCX bytes for neutral layout. @public */
export type OpenHeadlessDocumentResult =
  | { readonly ok: true; readonly view: HeadlessDocumentView }
  | { readonly ok: false; readonly reason: HeadlessDocumentRejection; readonly detail?: string };

const REL = Object.freeze({
  styles: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
  numbering: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering',
  settings: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings',
  theme: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme',
  coreProperties:
    'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
  extendedProperties:
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties',
});

function relatedPart(
  pkg: OoxmlPackage,
  ownerPart: string,
  relationshipType: string,
  fallbackName: string
): OoxmlPart | undefined {
  const record = (pkg.relationships.get(ownerPart) ?? []).find(
    (relationship) => relationship.type === relationshipType
  );
  if (record) {
    const resolved = resolveRelationship(record);
    if (resolved.mode === 'Internal' && resolved.target.ok) {
      const part = pkg.parts.get(resolved.target.partName);
      if (part) return part;
    }
  }
  return pkg.parts.get(fallbackName);
}

function isElement(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

function child(parent: OoxmlElement, localName: string): OoxmlElement | null {
  for (const candidate of parent.children) {
    if (isElement(candidate) && candidate.localName === localName) return candidate;
  }
  return null;
}

function firstDescendant(root: OoxmlElement, localName: string): OoxmlElement | null {
  const stack: OoxmlNode[] = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (!isElement(current)) continue;
    if (current.localName === localName) return current;
    for (let index = current.children.length - 1; index >= 0; index -= 1) {
      stack.push(current.children[index]!);
    }
  }
  return null;
}

const FONT_NAME = /^[\p{L}\p{N}\p{M} \-.+_]{1,64}$/u;

function themeTypeface(scheme: OoxmlElement, slot: string): string | null {
  const font = child(scheme, slot);
  const latin = font ? child(font, 'latin') : null;
  const raw = latin?.attributes.find((attribute) => attribute.localName === 'typeface')?.value;
  return raw !== undefined && FONT_NAME.test(raw) ? raw : null;
}

function themeFontsOf(root: OoxmlElement | null): HeadlessThemeFonts {
  const scheme = root ? firstDescendant(root, 'fontScheme') : null;
  if (!scheme) return Object.freeze({ major: null, minor: null });
  return Object.freeze({
    major: themeTypeface(scheme, 'majorFont'),
    minor: themeTypeface(scheme, 'minorFont'),
  });
}

/**
 * Open DOCX bytes through the bounded store reader and expose only neutral layout reads.
 * @public
 */
export function openHeadlessDocument(bytes: Uint8Array): OpenHeadlessDocumentResult {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) {
    return {
      ok: false,
      reason: loaded.reason,
      ...(loaded.detail ? { detail: loaded.detail } : {}),
    };
  }
  const main = loaded.package.parts.get(loaded.package.mainDocumentPart);
  if (!main) {
    return {
      ok: false,
      reason: 'no-main-document-tree',
      detail: loaded.package.mainDocumentPart,
    };
  }

  const store = new TreePackageStore(loaded.package, normalizeParagraphIdentity(main));
  const currentPackage = (): OoxmlPackage => store.currentPackage();
  const mainPart = (): OoxmlPart => store.bodyStore().part;
  const rootOf = (relationshipType: string, fallbackName: string): OoxmlElement | null =>
    relatedPart(currentPackage(), currentPackage().mainDocumentPart, relationshipType, fallbackName)
      ?.root ?? null;

  let themeFonts: HeadlessThemeFonts | null = null;
  let properties: DocumentProperties = EMPTY_DOCUMENT_PROPERTIES;
  let propertiesReady = false;

  const view: HeadlessDocumentView = Object.freeze({
    part: mainPart,
    currentPackage,
    packageRevision: () => store.packageRevision,
    stylesRoot: () => rootOf(REL.styles, '/word/styles.xml'),
    numberingRoot: () => rootOf(REL.numbering, '/word/numbering.xml'),
    settingsRoot: () => rootOf(REL.settings, '/word/settings.xml'),
    documentThemeFonts() {
      themeFonts ??= themeFontsOf(rootOf(REL.theme, '/word/theme/theme1.xml'));
      return themeFonts;
    },
    documentProperties() {
      if (!propertiesReady) {
        propertiesReady = true;
        const pkg = currentPackage();
        const core = relatedPart(pkg, '/', REL.coreProperties, '/docProps/core.xml');
        const app = relatedPart(pkg, '/', REL.extendedProperties, '/docProps/app.xml');
        properties = readDocumentProperties(core?.root ?? null, app?.root ?? null);
      }
      return properties;
    },
    headerFooterPartsBySection: () => resolveHeaderFooterPartsBySection(currentPackage()),
    relationshipTarget: (relationshipId: string) =>
      relationshipTargetIn(currentPackage(), mainPart().name, relationshipId),
  });
  return { ok: true, view };
}
