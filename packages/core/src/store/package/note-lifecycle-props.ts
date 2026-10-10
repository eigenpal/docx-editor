// Document/section note-property writes for `setNoteProperties`.

import { createNodeIdAllocator, replaceChildren } from './ooxml-edit.ts';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from './ooxml-tree.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import { withPart } from './ooxml-package.ts';
import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import { collectSectionPropertyNodes } from './hf-references.ts';
import { freeRelationshipId, withContentTypeOverride } from './note-lifecycle-shell.ts';
import { withStoryRelationship } from './hf-lifecycle-shell.ts';
import { settingsPartOf } from './note-properties.ts';

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

export function writeDocumentNoteProperties(
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

function rebuildSettings(settings: OoxmlPart, op: SetNotePropertiesOp): OoxmlPart | null {
  const nextId = createNodeIdAllocator(settings);
  const kept = settings.root.children.filter(
    (child) =>
      child.kind === 'textValue' ||
      (child.localName !== 'footnotePr' && child.localName !== 'endnotePr')
  );
  const added: OoxmlNode[] = [];
  if (op.footnote) added.push(buildPropsNode(nextId, 'footnotePr', op.footnote));
  else {
    const prior = settings.root.children.find(
      (child) => child.kind !== 'textValue' && child.localName === 'footnotePr'
    );
    if (prior) added.push(prior);
  }
  if (op.endnote) added.push(buildPropsNode(nextId, 'endnotePr', op.endnote));
  else {
    const prior = settings.root.children.find(
      (child) => child.kind !== 'textValue' && child.localName === 'endnotePr'
    );
    if (prior) added.push(prior);
  }
  const replaced = replaceChildren(settings, settings.root.id, [...kept, ...added]);
  return replaced.ok ? replaced.part : null;
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
  const without = target.children.filter(
    (child) =>
      child.kind === 'textValue' ||
      (child.localName !== 'footnotePr' && child.localName !== 'endnotePr')
  );
  const added: OoxmlNode[] = [];
  if (op.footnote) added.push(buildPropsNode(nextId, 'footnotePr', op.footnote));
  else {
    const prior = target.children.find(
      (child) => child.kind !== 'textValue' && child.localName === 'footnotePr'
    );
    if (prior) added.push(prior);
  }
  if (op.endnote) added.push(buildPropsNode(nextId, 'endnotePr', op.endnote));
  else {
    const prior = target.children.find(
      (child) => child.kind !== 'textValue' && child.localName === 'endnotePr'
    );
    if (prior) added.push(prior);
  }
  const replaced = replaceChildren(main, target.id, [...added, ...without]);
  if (!replaced.ok) return null;
  return withPart(pkg, replaced.part);
}

function buildPropsNode(
  nextId: () => string,
  localName: 'footnotePr' | 'endnotePr',
  props: {
    readonly numFmt?: string;
    readonly numRestart?: string;
    readonly position?: string;
    readonly numStart?: number;
  }
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
