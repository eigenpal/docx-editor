// The `settings.xml` writes: locating (or creating) the part, and the one element whose
// position in `CT_Settings` sequence order Word actually checks.
//
// Split out of `hf-lifecycle.ts`, which owns the header/footer lifecycle and was against its
// line cap. The document-protection write lives here rather than beside its reader in
// `document-protection.ts` because it needs the package plumbing — relationships, content
// types, node ids — that the reader deliberately knows nothing about.

import { createNodeIdAllocator, replaceChildren } from './ooxml-edit.ts';
import { readOoxmlPart, type OoxmlElement, type OoxmlNode, type OoxmlPart } from './ooxml-tree.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { withPart } from './ooxml-package.ts';
import { resolveRelationship } from './relationships.ts';
import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import {
  freeRelationshipId,
  withContentTypeOverride,
  withStoryRelationship,
} from './hf-lifecycle-shell.ts';
import { readDocumentProtection } from './document-protection.ts';
import type { HeaderFooterLifecycleOp, HeaderFooterLifecycleResult } from './hf-lifecycle.ts';

const W = WML_NAMESPACE_URI;
const SETTINGS_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings';
const SETTINGS_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml';
const SETTINGS_PART = '/word/settings.xml';

function refuse(
  reason: 'invalidArgs' | 'tree-invariant',
  detail?: string
): HeaderFooterLifecycleResult {
  return detail ? { ok: false, reason, detail } : { ok: false, reason };
}

export function wmlAttribute(localName: string, value: string) {
  return {
    kind: 'genericExtension' as const,
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    prefix: 'w',
    value,
  };
}

/** A `w:`-prefixed generic element, for settings and section properties. */
export function sectionElement(
  id: string,
  localName: string,
  attributes: readonly unknown[],
  children: readonly OoxmlNode[]
): OoxmlNode {
  return {
    id,
    kind: 'generic',
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    prefix: 'w',
    namespaceBindings: [],
    attributes,
    children,
  } as unknown as OoxmlNode;
}

/** The settings part, created with its relationship when the package has none yet. */
export function settingsPartForWrite(
  pkg: OoxmlPackage
): { readonly package: OoxmlPackage; readonly settings: OoxmlPart } | null {
  let next = pkg;
  const relationships = next.relationships.get(next.mainDocumentPart) ?? [];
  let settingsRel = relationships.find((rel) => rel.type === SETTINGS_REL_TYPE);
  if (!settingsRel) {
    const ensured = ensureSettingsPart(next);
    if (!ensured) return null;
    next = ensured;
    settingsRel = (next.relationships.get(next.mainDocumentPart) ?? []).find(
      (rel) => rel.type === SETTINGS_REL_TYPE
    );
    if (!settingsRel) return null;
  }

  const resolved = resolveRelationship(settingsRel);
  if (resolved.mode !== 'Internal' || !resolved.target.ok) return null;
  const settings = next.parts.get(resolved.target.partName);
  if (!settings) return null;
  return { package: next, settings };
}

function ensureSettingsPart(pkg: OoxmlPackage): OoxmlPackage | null {
  if (pkg.parts.has(SETTINGS_PART)) {
    // Part exists but no rel — add the relationship only.
    const related = withStoryRelationship(
      pkg,
      freeRelationshipId(pkg),
      SETTINGS_REL_TYPE,
      'settings.xml'
    );
    return related;
  }
  const xml = `<w:settings xmlns:w="${W}"></w:settings>`;
  const read = readOoxmlPart(xml, { name: SETTINGS_PART, contentType: SETTINGS_CONTENT_TYPE });
  if (!read.ok) return null;
  let next = withPart(pkg, read.part);
  const related = withStoryRelationship(
    next,
    freeRelationshipId(next),
    SETTINGS_REL_TYPE,
    'settings.xml'
  );
  if (!related) return null;
  next = related;
  return withContentTypeOverride(next, SETTINGS_PART, SETTINGS_CONTENT_TYPE);
}

/** The settings part as the package relates it, without creating one. */
function settingsPartOfPackage(pkg: OoxmlPackage): OoxmlPart | null {
  const relationships = pkg.relationships.get(pkg.mainDocumentPart) ?? [];
  for (const record of relationships) {
    if (record.type !== SETTINGS_REL_TYPE) continue;
    const resolved = resolveRelationship(record);
    if (resolved.mode !== 'Internal' || !resolved.target.ok) continue;
    return pkg.parts.get(resolved.target.partName) ?? null;
  }
  return pkg.parts.get(SETTINGS_PART) ?? null;
}

// ---------------------------------------------------------------------------
// settings.xml documentProtection
// ---------------------------------------------------------------------------

/**
 * `CT_Settings` members that PRECEDE `w:documentProtection`. Word reads `settings.xml` in
 * schema order and reports a file whose members are out of sequence as damaged, so the element
 * lands after the last of these and before everything else — never appended.
 */
const SETTINGS_BEFORE_PROTECTION: ReadonlySet<string> = new Set([
  'writeProtection',
  'view',
  'zoom',
  'removePersonalInformation',
  'removeDateAndTime',
  'doNotDisplayPageBoundaries',
  'displayBackgroundShape',
  'printPostScriptOverText',
  'printFractionalCharacterWidth',
  'printFormsData',
  'embedTrueTypeFonts',
  'embedSystemFonts',
  'saveSubsetFonts',
  'saveFormsData',
  'mirrorMargins',
  'alignBordersAndEdges',
  'bordersDoNotSurroundHeader',
  'bordersDoNotSurroundFooter',
  'gutterAtTop',
  'hideSpellingErrors',
  'hideGrammaticalErrors',
  'activeWritingStyle',
  'proofState',
  'formsDesign',
  'attachedTemplate',
  'linkStyles',
  'stylePaneFormatFilter',
  'stylePaneSortMethod',
  'documentType',
  'mailMerge',
  'revisionView',
  'trackRevisions',
  'doNotTrackMoves',
  'doNotTrackFormatting',
]);

/**
 * Enforce filling-in-forms protection, or lift whatever protection is enforced.
 *
 * Enforcing writes a fresh `w:edit="forms" w:enforcement="1"` element and drops any password
 * attributes a lifted protection left behind: re-arming an old hash would lock the document
 * behind a password the reader never typed. Lifting keeps `@w:edit` and sets
 * `w:enforcement="0"`, which is what Word's Stop Protection writes, and refuses when the
 * element carries a password — Word asks for it, and this editor never verifies one.
 */
export function applyDocumentProtection(
  pkg: OoxmlPackage,
  op: Extract<HeaderFooterLifecycleOp, { op: 'setDocumentProtection' }>
): HeaderFooterLifecycleResult {
  if (typeof op.enforce !== 'boolean') return refuse('invalidArgs', 'enforce');
  const current = readDocumentProtection(settingsPartOfPackage(pkg)?.root);
  if (op.enforce === current.enforced && (!op.enforce || current.edit === 'forms')) {
    return refuse('invalidArgs', 'no-change');
  }
  if (!op.enforce && current.password) return refuse('invalidArgs', 'password');

  const located = settingsPartForWrite(pkg);
  if (!located) return refuse('tree-invariant', 'settings-part');
  const { package: next, settings } = located;
  const nextId = createNodeIdAllocator(settings);
  const existing = settings.root.children.find(
    (child): child is OoxmlElement =>
      child.kind !== 'textValue' &&
      child.namespaceUri === W &&
      child.localName === 'documentProtection'
  );
  const kept = existing && 'attributes' in existing ? existing.attributes : [];
  const attributes = op.enforce
    ? [wmlAttribute('edit', 'forms'), wmlAttribute('enforcement', '1')]
    : [
        ...kept.filter((attribute) => attribute.localName !== 'enforcement'),
        wmlAttribute('enforcement', '0'),
      ];
  const element = sectionElement(existing?.id ?? nextId(), 'documentProtection', attributes, []);
  const children = [...settings.root.children];
  if (existing) {
    children.splice(children.indexOf(existing), 1, element);
  } else {
    let at = 0;
    for (const [index, child] of children.entries()) {
      if (child.kind !== 'textValue' && SETTINGS_BEFORE_PROTECTION.has(child.localName)) {
        at = index + 1;
      }
    }
    children.splice(at, 0, element);
  }
  const replaced = replaceChildren(settings, settings.root.id, children);
  if (!replaced.ok) return refuse('tree-invariant', 'settings');
  return { ok: true, package: withPart(next, replaced.part), impact: 'global' };
}
