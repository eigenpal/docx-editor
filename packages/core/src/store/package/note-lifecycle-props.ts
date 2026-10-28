// Document/section note-property writes for `setNoteProperties`.
//
// Note numbering and the footnote position resolve from each section's own `w:sectPr`
// (see `note-properties.ts`); settings.xml supplies only the endnote position. A document-scope
// write therefore writes every section's `w:footnotePr`/`w:endnotePr`, and settings.xml as
// well, so the saved file carries the change in both places other consumers look. A
// section-scope write that names an endnote position also writes it to settings.xml, because
// the endnote position is document-wide and a section's own copy does not apply. For the same
// reason a write never adds or changes an endnote position in a section.
//
// Every write is a per-field merge made in place:
// - A field the op does not name keeps its value.
// - An element that exists keeps its node id, and so does each of its field children; only
//   the `w:val` that changes is rewritten. Concurrent writers then contest the same nodes and
//   attributes instead of each adding a copy of an element the schema allows once.
// - A field the container does not author is added only when its value differs from the
//   default, so a write that changes nothing (the dialog applied as it opened) leaves the
//   package as it was.

import { createNodeIdAllocator, insertChildren, replaceNode } from './ooxml-edit.ts';
import { readOoxmlPart, type OoxmlElement, type OoxmlNode, type OoxmlPart } from './ooxml-tree.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { withPart } from './ooxml-package.ts';
import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import { collectSectionPropertyNodes } from './hf-references.ts';
import { freeRelationshipId, withContentTypeOverride } from './note-lifecycle-shell.ts';
import { withStoryRelationship } from './hf-lifecycle-shell.ts';
import {
  DEFAULT_ENDNOTE_PROPERTIES,
  DEFAULT_FOOTNOTE_PROPERTIES,
  settingsPartOf,
} from './note-properties.ts';

const W = WML_NAMESPACE_URI;
const SETTINGS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings';
const SETTINGS_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml';
const SETTINGS_PART = '/word/settings.xml';

/** The fields one note kind's write can set. A field left out keeps its current value. */
export interface NotePropertiesWrite {
  readonly numFmt?: string;
  readonly numRestart?: string;
  readonly position?: string;
  readonly numStart?: number;
}

export type SetNotePropertiesOp = {
  readonly op: 'setNoteProperties';
  readonly scope: 'document' | 'section';
  readonly sectionIndex?: number;
  readonly footnote?: NotePropertiesWrite;
  readonly endnote?: NotePropertiesWrite;
};

type PropsName = 'footnotePr' | 'endnotePr';

/** `CT_FtnProps`/`CT_EdnProps` fields in schema order, with the op key that sets each. */
const FIELDS: readonly (readonly [string, keyof NotePropertiesWrite])[] = [
  ['pos', 'position'],
  ['numFmt', 'numFmt'],
  ['numStart', 'numStart'],
  ['numRestart', 'numRestart'],
];
const FIELD_NAMES: ReadonlySet<string> = new Set(FIELDS.map(([name]) => name));

const DEFAULTS: Readonly<Record<PropsName, Readonly<Record<string, string>>>> = {
  footnotePr: {
    pos: DEFAULT_FOOTNOTE_PROPERTIES.pos,
    numFmt: DEFAULT_FOOTNOTE_PROPERTIES.numFmt,
    numStart: String(DEFAULT_FOOTNOTE_PROPERTIES.numStart),
    numRestart: DEFAULT_FOOTNOTE_PROPERTIES.numRestart,
  },
  endnotePr: {
    pos: DEFAULT_ENDNOTE_PROPERTIES.pos,
    numFmt: DEFAULT_ENDNOTE_PROPERTIES.numFmt,
    numStart: String(DEFAULT_ENDNOTE_PROPERTIES.numStart),
    numRestart: DEFAULT_ENDNOTE_PROPERTIES.numRestart,
  },
};

/**
 * Write note properties for the whole document: settings.xml and every section's `w:sectPr`.
 * A side the op omits (`footnote` or `endnote`), and a field a side omits, keep their values
 * everywhere. An implicit final section with no `w:sectPr` gets one when the write adds a value.
 */
export function writeDocumentNoteProperties(
  pkg: OoxmlPackage,
  op: SetNotePropertiesOp
): OoxmlPackage | null {
  const withSettings = writeSettingsNoteProperties(pkg, op);
  if (!withSettings) return null;
  return writeEverySectionNoteProperties(withSettings, op);
}

/** Write one section's note properties; an endnote position also goes to settings.xml. */
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

  const updated = containerWith(
    target,
    sectionOp(op),
    createNodeIdAllocator(main),
    sectPrInsertIndex
  );
  let written = pkg;
  if (updated) {
    const replaced = replaceNode(main, target.id, updated);
    if (!replaced.ok) return null;
    written = withPart(pkg, replaced.part);
  }
  const position = op.endnote?.position;
  if (position === undefined) return written;
  // The endnote position is document-wide: merge it into settings.xml, keeping the rest.
  return writeSettingsNoteProperties(written, {
    op: 'setNoteProperties',
    scope: 'document',
    endnote: { position },
  });
}

function writeSettingsNoteProperties(
  pkg: OoxmlPackage,
  op: SetNotePropertiesOp
): OoxmlPackage | null {
  let next = pkg;
  let settings = settingsPartOf(next);
  if (!settings) {
    // Create the part only when the write adds a value to it.
    const empty = element('probe', 'settings', []);
    if (!containerWith(empty, op, counterIds(), settingsInsertIndex)) return pkg;
    const created = ensureSettingsPart(next);
    if (!created) return null;
    next = created;
    settings = settingsPartOf(next);
  }
  if (!settings) return null;
  const updated = containerWith(
    settings.root,
    op,
    createNodeIdAllocator(settings),
    settingsInsertIndex
  );
  if (!updated) return next;
  const replaced = replaceNode(settings, settings.root.id, updated);
  return replaced.ok ? withPart(next, replaced.part) : null;
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
  const forSection = sectionOp(op);
  let working: OoxmlPart = main;
  for (const sectPr of collectSectionPropertyNodes(main.root)) {
    if (sectPr) {
      const updated = containerWith(sectPr, forSection, nextId, sectPrInsertIndex);
      if (!updated) continue;
      const replaced = replaceNode(working, sectPr.id, updated);
      if (!replaced.ok) return null;
      working = replaced.part;
      continue;
    }
    const minted = containerWith(
      element(nextId(), 'sectPr', []),
      forSection,
      nextId,
      sectPrInsertIndex
    );
    if (!minted) continue;
    const body = bodyOf(working.root);
    if (!body) return null;
    const inserted = insertChildren(working, body.id, body.children.length, [minted]);
    if (!inserted.ok) return null;
    working = inserted.part;
  }
  return working === main ? pkg : withPart(pkg, working);
}

/**
 * The op as a section receives it. The endnote position is document-wide and settings.xml
 * holds it; a section's own copy has no effect, so a write does not add or change one there.
 */
function sectionOp(op: SetNotePropertiesOp): SetNotePropertiesOp {
  if (op.endnote?.position === undefined) return op;
  const { position: _position, ...endnote } = op.endnote;
  return { ...op, endnote };
}

/**
 * The container (a `w:sectPr` or the settings root) with the op's note properties merged in,
 * or null when nothing changes. An existing `w:footnotePr`/`w:endnotePr` is updated in place;
 * a missing one is inserted where `insertIndex` says.
 */
function containerWith(
  container: OoxmlElement,
  op: SetNotePropertiesOp,
  nextId: () => string,
  insertIndex: (children: readonly OoxmlNode[], name: PropsName) => number
): OoxmlElement | null {
  const children = [...container.children];
  let changed = false;
  for (const [name, side] of [
    ['footnotePr', op.footnote],
    ['endnotePr', op.endnote],
  ] as const) {
    if (!side) continue;
    const index = children.findIndex((child) => isW(child, name));
    const prior = index >= 0 ? (children[index] as OoxmlElement) : undefined;
    const next = mergedProps(prior, name, side, nextId);
    if (!next || next === prior) continue;
    changed = true;
    if (index >= 0) children[index] = next;
    else children.splice(insertIndex(children, name), 0, next);
  }
  return changed ? ({ ...container, children } as OoxmlElement) : null;
}

/**
 * `prior` with the side's fields merged in, keeping its id and the ids of the field children
 * it already has. Returns `prior` itself when nothing changes, and undefined when there is no
 * prior and every named value is the default.
 */
function mergedProps(
  prior: OoxmlElement | undefined,
  name: PropsName,
  side: NotePropertiesWrite,
  nextId: () => string
): OoxmlElement | undefined {
  const fields: OoxmlNode[] = [];
  let changed = false;
  for (const [field, key] of FIELDS) {
    const raw = side[key];
    const value = raw === undefined ? undefined : String(raw);
    const existing = prior?.children.find((child) => isW(child, field)) as OoxmlElement | undefined;
    if (existing) {
      if (value === undefined || valOf(existing) === value) fields.push(existing);
      else {
        fields.push(withVal(existing, value));
        changed = true;
      }
    } else if (value !== undefined && value !== DEFAULTS[name][field]) {
      fields.push(element(nextId(), field, [wmlVal(value)]));
      changed = true;
    }
  }
  if (!changed) return prior;
  // Children other than the four fields (settings.xml lists separator references here) stay,
  // after the fields, as `CT_FtnDocProps` orders them.
  const others = (prior?.children ?? []).filter(
    (child) =>
      !(child.kind !== 'textValue' && child.namespaceUri === W && FIELD_NAMES.has(child.localName))
  );
  const children = [...fields, ...others];
  return prior ? ({ ...prior, children } as OoxmlElement) : element(nextId(), name, [], children);
}

/** `CT_SectPr`: note properties follow the header/footer references, footnotes first. */
function sectPrInsertIndex(children: readonly OoxmlNode[], name: PropsName): number {
  let at = 0;
  children.forEach((child, index) => {
    if (
      isW(child, 'headerReference') ||
      isW(child, 'footerReference') ||
      (name === 'endnotePr' && isW(child, 'footnotePr'))
    ) {
      at = index + 1;
    }
  });
  return at;
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

function settingsInsertIndex(children: readonly OoxmlNode[], name: PropsName): number {
  const at = children.findIndex(
    (child) =>
      child.kind !== 'textValue' &&
      (child.namespaceUri !== W ||
        SETTINGS_AFTER_NOTE_PROPERTIES.has(child.localName) ||
        (name === 'footnotePr' && child.localName === 'endnotePr'))
  );
  return at === -1 ? children.length : at;
}

function isW(child: OoxmlNode, localName: string): boolean {
  return child.kind !== 'textValue' && child.namespaceUri === W && child.localName === localName;
}

function valOf(node: OoxmlElement): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === 'val')?.value;
}

function withVal(node: OoxmlElement, value: string): OoxmlElement {
  const has = node.attributes.some((attribute) => attribute.localName === 'val');
  const attributes = has
    ? node.attributes.map((attribute) =>
        attribute.localName === 'val' ? { ...attribute, value } : attribute
      )
    : [...node.attributes, wmlVal(value)];
  return { ...node, attributes } as OoxmlElement;
}

function bodyOf(root: OoxmlNode): OoxmlElement | undefined {
  if (root.kind === 'textValue') return undefined;
  return root.children.find((child) => isW(child, 'body')) as OoxmlElement | undefined;
}

/** Ids for a throwaway probe tree that never enters a part. */
function counterIds(): () => string {
  let next = 0;
  return () => `probe:${(next += 1)}`;
}

function element(
  id: string,
  localName: string,
  attributes: readonly unknown[],
  children: readonly OoxmlNode[] = []
): OoxmlElement {
  return {
    id,
    kind: 'generic',
    namespaceUri: W,
    localName,
    prefix: 'w',
    namespaceBindings: [],
    attributes,
    children,
  } as unknown as OoxmlElement;
}

function wmlVal(value: string) {
  return { kind: 'wmlVal', namespaceUri: W, localName: 'val', prefix: 'w', value };
}
