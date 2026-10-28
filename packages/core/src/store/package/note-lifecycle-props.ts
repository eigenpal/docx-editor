// Document/section note-property writes for `setNoteProperties`.
//
// Note numbering and the footnote position resolve from each section's own `w:sectPr`
// (see `note-properties.ts`); settings.xml supplies only the endnote position. A document-scope
// write therefore writes every section's `w:footnotePr`/`w:endnotePr`, and settings.xml as
// well, so the saved file carries the change in both places other consumers look. A
// section-scope write that names an endnote position also writes it to settings.xml, because
// the endnote position is document-wide and a section's own copy does not apply.

import { createNodeIdAllocator, insertChildren, replaceChildren } from './ooxml-edit.ts';
import { readOoxmlPart, type OoxmlElement, type OoxmlNode, type OoxmlPart } from './ooxml-tree.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { withPart } from './ooxml-package.ts';
import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import { collectSectionPropertyNodes } from './hf-references.ts';
import { freeRelationshipId, withContentTypeOverride } from './note-lifecycle-shell.ts';
import { withFreshIds, withStoryRelationship } from './hf-lifecycle-shell.ts';
import {
  authoredDocumentEndnoteProperties,
  settingsPartOf,
  type AuthoredNoteProperties,
} from './note-properties.ts';

const W = WML_NAMESPACE_URI;
const SETTINGS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings';
const SETTINGS_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml';
const SETTINGS_PART = '/word/settings.xml';

export type SetNotePropertiesOp = {
  readonly op: 'setNoteProperties';
  readonly scope: 'document' | 'section';
  readonly sectionIndex?: number;
  readonly footnote?: {
    readonly numFmt?: string;
    readonly numRestart?: string;
    readonly position?: string;
    readonly numStart?: number;
  };
  readonly endnote?: {
    readonly numFmt?: string;
    readonly numRestart?: string;
    readonly position?: string;
    readonly numStart?: number;
  };
};

/**
 * Write note properties for the whole document: settings.xml and every section's `w:sectPr`.
 * A side the op omits (`footnote` or `endnote`) keeps its prior value everywhere. An implicit
 * final section with no `w:sectPr` gets one, holding only the note properties.
 */
export function writeDocumentNoteProperties(
  pkg: OoxmlPackage,
  op: SetNotePropertiesOp
): OoxmlPackage | null {
  const withSettings = writeSettingsNoteProperties(pkg, op);
  if (!withSettings) return null;
  return writeEverySectionNoteProperties(withSettings, op);
}

function writeSettingsNoteProperties(
  pkg: OoxmlPackage,
  op: SetNotePropertiesOp
): OoxmlPackage | null {
  let next = pkg;
  let settings = settingsPartOf(next);
  if (!settings) {
    const created = ensureSettingsPart(next);
    if (!created) return null;
    next = created;
    settings = settingsPartOf(next);
  }
  if (!settings) return null;

  const rebuilt = rebuildSettings(settings, op);
  if (!rebuilt) return null;
  return withPart(next, rebuilt);
}

function ensureSettingsPart(pkg: OoxmlPackage): OoxmlPackage | null {
  if (pkg.parts.has(SETTINGS_PART)) return pkg;
  const xml = `<w:settings xmlns:w="${W}"></w:settings>`;
  const read = readOoxmlPart(xml, { name: SETTINGS_PART, contentType: SETTINGS_CT });
  if (!read.ok) return null;
  let next = withPart(pkg, read.part);
  const rId = freeRelationshipId(next);
  const related = withStoryRelationship(next, rId, SETTINGS_REL, 'settings.xml');
  if (!related) return null;
  next = related;
  const typed = withContentTypeOverride(next, SETTINGS_PART, SETTINGS_CT);
  return typed;
}

/**
 * `CT_Settings` members that FOLLOW `w:footnotePr`/`w:endnotePr`. The note properties go
 * before the first of these (or before the first element in another namespace, such as
 * `m:mathPr` or the `w14`/`w15` extensions), never appended: settings.xml is read in schema
 * order, and a member out of sequence makes the part invalid.
 */
const SETTINGS_AFTER_NOTE_PROPERTIES: ReadonlySet<string> = new Set([
  'compat',
  'docVars',
  'rsids',
  'attachedSchema',
  'themeFontLang',
  'clrSchemeMapping',
  'doNotIncludeSubdocsInStats',
  'doNotAutoCompressPictures',
  'forceUpgrade',
  'captions',
  'readModeInkLockDown',
  'smartTagType',
  'shapeDefaults',
  'doNotEmbedSmartTags',
  'decimalSymbol',
  'listSeparator',
]);

function followsNoteProperties(child: OoxmlNode): boolean {
  if (child.kind === 'textValue') return false;
  if (child.namespaceUri !== W) return true;
  return SETTINGS_AFTER_NOTE_PROPERTIES.has(child.localName);
}

/** `w:headerReference`/`w:footerReference` lead `CT_SectPr`; note properties follow them. */
function isHeaderFooterReference(child: OoxmlNode): boolean {
  return (
    child.kind !== 'textValue' &&
    child.namespaceUri === W &&
    (child.localName === 'headerReference' || child.localName === 'footerReference')
  );
}

function isNoteProperties(child: OoxmlNode): boolean {
  return (
    child.kind !== 'textValue' &&
    child.namespaceUri === W &&
    (child.localName === 'footnotePr' || child.localName === 'endnotePr')
  );
}

/** The `w:footnotePr`, then `w:endnotePr`, a container holds after the op: new, or kept. */
function notePropertiesAfter(
  container: OoxmlElement,
  op: SetNotePropertiesOp,
  nextId: () => string
): OoxmlNode[] {
  const prior = (localName: string) =>
    container.children.find(
      (child) => isNoteProperties(child) && (child as OoxmlElement).localName === localName
    ) as OoxmlElement | undefined;
  const out: OoxmlNode[] = [];
  const priorFootnote = prior('footnotePr');
  const footnote = op.footnote
    ? buildPropsNode(nextId, 'footnotePr', op.footnote, priorFootnote)
    : priorFootnote;
  if (footnote) out.push(footnote);
  const priorEndnote = prior('endnotePr');
  const endnote = op.endnote
    ? buildPropsNode(nextId, 'endnotePr', op.endnote, priorEndnote)
    : priorEndnote;
  if (endnote) out.push(endnote);
  return out;
}

function rebuildSettings(settings: OoxmlPart, op: SetNotePropertiesOp): OoxmlPart | null {
  const nextId = createNodeIdAllocator(settings);
  const kept = settings.root.children.filter((child) => !isNoteProperties(child));
  const at = kept.findIndex(followsNoteProperties);
  const insertAt = at === -1 ? kept.length : at;
  const added = notePropertiesAfter(settings.root, op, nextId);
  const children = [...kept.slice(0, insertAt), ...added, ...kept.slice(insertAt)];
  const replaced = replaceChildren(settings, settings.root.id, children);
  return replaced.ok ? replaced.part : null;
}

/** A `w:sectPr`'s children with its note properties replaced, in `CT_SectPr` order. */
function sectionChildrenWith(
  sectPr: OoxmlElement,
  op: SetNotePropertiesOp,
  nextId: () => string
): OoxmlNode[] {
  const added = notePropertiesAfter(sectPr, op, nextId);
  const without = sectPr.children.filter((child) => !isNoteProperties(child));
  let insertAt = 0;
  for (let i = 0; i < without.length; i += 1) {
    if (isHeaderFooterReference(without[i]!)) insertAt = i + 1;
  }
  return [...without.slice(0, insertAt), ...added, ...without.slice(insertAt)];
}

export function writeSectionNoteProperties(
  pkg: OoxmlPackage,
  sectionIndex: number,
  op: SetNotePropertiesOp
): OoxmlPackage | null {
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) return null;
  const sectPrNodes = collectSectionPropertyNodes(main.root);
  if (sectionIndex >= sectPrNodes.length) return null;
  const target = sectPrNodes[sectionIndex];
  if (!target) return null;

  const nextId = createNodeIdAllocator(main);
  const replaced = replaceChildren(main, target.id, sectionChildrenWith(target, op, nextId));
  if (!replaced.ok) return null;
  const written = withPart(pkg, replaced.part);
  const position = op.endnote?.position;
  if (position === undefined) return written;
  // The endnote position is document-wide: merge it into settings.xml, keeping the rest.
  const prior = authoredDocumentEndnoteProperties(settingsPartOf(written));
  return writeSettingsNoteProperties(written, {
    op: 'setNoteProperties',
    scope: 'document',
    endnote: { ...writeShapeOf(prior), position },
  });
}

/** Authored note properties in the op's write shape (`pos` is `position` there). */
function writeShapeOf(
  authored: AuthoredNoteProperties | undefined
): NonNullable<SetNotePropertiesOp['endnote']> {
  if (!authored) return {};
  return {
    ...(authored.pos !== undefined ? { position: authored.pos } : {}),
    ...(authored.numFmt !== undefined ? { numFmt: authored.numFmt } : {}),
    ...(authored.numStart !== undefined ? { numStart: authored.numStart } : {}),
    ...(authored.numRestart !== undefined ? { numRestart: authored.numRestart } : {}),
  };
}

/**
 * Write the op's note properties into every section's `w:sectPr`. Sections are bounded by
 * `collectSectionPropertyNodes`. The implicit final section (no body-level `w:sectPr`) gets a
 * new one as the body's last child, so the write reaches every section the document has.
 */
function writeEverySectionNoteProperties(
  pkg: OoxmlPackage,
  op: SetNotePropertiesOp
): OoxmlPackage | null {
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) return null;
  const nextId = createNodeIdAllocator(main);
  let working: OoxmlPart = main;
  for (const sectPr of collectSectionPropertyNodes(main.root)) {
    if (sectPr) {
      const replaced = replaceChildren(working, sectPr.id, sectionChildrenWith(sectPr, op, nextId));
      if (!replaced.ok) return null;
      working = replaced.part;
      continue;
    }
    const body = bodyOf(working.root);
    if (!body) return null;
    const minted = {
      id: nextId(),
      kind: 'generic',
      namespaceUri: W,
      localName: 'sectPr',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [],
      children: [],
    } as unknown as OoxmlElement;
    const children = sectionChildrenWith(minted, op, nextId);
    const inserted = insertChildren(working, body.id, body.children.length, [
      { ...minted, children } as OoxmlNode,
    ]);
    if (!inserted.ok) return null;
    working = inserted.part;
  }
  return working === main ? pkg : withPart(pkg, working);
}

function bodyOf(root: OoxmlNode): OoxmlElement | undefined {
  if (root.kind === 'textValue') return undefined;
  return root.children.find(
    (child) => child.kind !== 'textValue' && child.namespaceUri === W && child.localName === 'body'
  ) as OoxmlElement | undefined;
}

/** The four `CT_FtnProps`/`CT_EdnProps` fields a write sets; anything else is kept. */
const WRITTEN_FIELDS: ReadonlySet<string> = new Set(['pos', 'numFmt', 'numStart', 'numRestart']);

/**
 * A new `w:footnotePr`/`w:endnotePr` with the written fields. The prior element's other
 * children follow them (as copies), so the separator references settings.xml lists there
 * (`<w:footnote w:id="-1"/>`) survive the write.
 */
function buildPropsNode(
  nextId: () => string,
  localName: 'footnotePr' | 'endnotePr',
  props: {
    readonly numFmt?: string;
    readonly numRestart?: string;
    readonly position?: string;
    readonly numStart?: number;
  },
  prior?: OoxmlElement
): OoxmlNode {
  const children: OoxmlNode[] = [];
  if (props.position !== undefined) children.push(valChild(nextId, 'pos', props.position));
  if (props.numFmt !== undefined) children.push(valChild(nextId, 'numFmt', props.numFmt));
  if (props.numStart !== undefined) {
    children.push(valChild(nextId, 'numStart', String(props.numStart)));
  }
  if (props.numRestart !== undefined) {
    children.push(valChild(nextId, 'numRestart', props.numRestart));
  }
  for (const child of prior?.children ?? []) {
    if (child.kind === 'textValue') continue;
    if (child.namespaceUri === W && WRITTEN_FIELDS.has(child.localName)) continue;
    children.push(withFreshIds(child, nextId));
  }
  return {
    id: nextId(),
    kind: 'generic',
    namespaceUri: W,
    localName,
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children,
  } as unknown as OoxmlNode;
}

function valChild(nextId: () => string, localName: string, value: string): OoxmlNode {
  return {
    id: nextId(),
    kind: 'generic',
    namespaceUri: W,
    localName,
    prefix: 'w',
    namespaceBindings: [],
    attributes: [
      {
        kind: 'wmlVal',
        namespaceUri: W,
        localName: 'val',
        prefix: 'w',
        value,
      },
    ],
    children: [],
  } as unknown as OoxmlNode;
}
