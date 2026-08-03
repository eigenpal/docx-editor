// Package shell persistence: numbering / hyperlink resources minted outside tree history
// must survive lifecycle package undo/redo so story redo cannot leave dead numId / rId.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPackage } from '../package/ooxml-package.ts';
import { serializeOoxmlPart } from '../package/ooxml-serialize.ts';
import { ensureListDefinition } from '../package/numbering-part.ts';
import { ensureHyperlinkRelationship } from '../package/hyperlink-part.ts';
import { HYPERLINK_RELATIONSHIP_TYPE } from '../package/hyperlink.ts';
import { resolveNotesPart } from '../package/note-references.ts';
import { TreePackageStore } from '../store/tree-package-store.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = `${R}/officeDocument`;
const NUMBERING_PART = '/word/numbering.xml';

function blankDoc(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        '<w:p><w:r><w:t>body</w:t></w:r></w:p>' +
        '<w:sectPr/>' +
        '</w:body></w:document>'
    ),
  });
}

function openStore(): TreePackageStore {
  const result = readOoxmlPackage(blankDoc());
  if (!result.ok) throw new Error(result.reason);
  const main = result.package.parts.get(result.package.mainDocumentPart);
  if (!main) throw new Error('no main');
  return new TreePackageStore(result.package, main);
}

function firstParagraphId(store: TreePackageStore): string {
  const ids: string[] = [];
  const walk = (node: { kind?: string; id?: string; children?: readonly unknown[] }): void => {
    if (!node || node.kind === 'textValue') return;
    if (node.kind === 'paragraph' && node.id) ids.push(node.id);
    for (const child of node.children ?? []) walk(child as typeof node);
  };
  walk(store.bodyStore().part.root);
  const id = ids[0];
  if (!id) throw new Error('no paragraph');
  return id;
}

function numberingNumIds(store: TreePackageStore): string[] {
  const part = store.currentPackage().parts.get(NUMBERING_PART);
  if (!part) return [];
  return [...serializeOoxmlPart(part).matchAll(/<w:num w:numId="([^"]+)"/g)].map((m) => m[1]!);
}

function documentNumIds(store: TreePackageStore): string[] {
  const pkg = store.currentPackage();
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) return [];
  return [...serializeOoxmlPart(main).matchAll(/<w:numId w:val="([^"]+)"/g)].map((m) => m[1]!);
}

function hyperlinkExternalIds(store: TreePackageStore): string[] {
  const pkg = store.currentPackage();
  return pkg.externalTargets
    .filter(
      (entry) =>
        entry.ownerPart === pkg.mainDocumentPart && entry.type === HYPERLINK_RELATIONSHIP_TYPE
    )
    .map((entry) => entry.id);
}

function documentHyperlinkIds(store: TreePackageStore): string[] {
  const pkg = store.currentPackage();
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) return [];
  return [...serializeOoxmlPart(main).matchAll(/<w:hyperlink[^>]*r:id="([^"]+)"/g)].map(
    (m) => m[1]!
  );
}

function hasHeaderPart(store: TreePackageStore): boolean {
  return [...store.currentPackage().parts.keys()].some((name) => String(name).includes('header'));
}

describe('package shell persistence across lifecycle undo/redo', () => {
  test('HF lifecycle then numbering: undo×2 redo×2 keeps numId resolvable', () => {
    const store = openStore();
    const paragraphId = firstParagraphId(store);

    expect(
      store.applyLifecycleOp({
        op: 'createHeaderFooter',
        sectionIndex: 0,
        kind: 'header',
        variant: 'default',
      }).ok
    ).toBe(true);
    expect(hasHeaderPart(store)).toBe(true);

    const ensured = ensureListDefinition(store.currentPackage(), 'bullet');
    expect(ensured).toBeTruthy();
    store.replacePackageShell(ensured!.pkg);

    expect(
      store.transact({ kind: 'body' }, (ctx) => {
        ctx.apply({
          op: 'setListNumbering',
          paragraphId,
          numId: ensured!.numId,
        });
      }).ok
    ).toBe(true);

    expect(numberingNumIds(store)).toContain(ensured!.numId);
    expect(documentNumIds(store)).toContain(ensured!.numId);

    expect(store.undo()).not.toBeNull(); // story numPr
    expect(store.undo()).not.toBeNull(); // package header create
    expect(hasHeaderPart(store)).toBe(false);
    // Shell persists across package snapshot install.
    expect(numberingNumIds(store)).toContain(ensured!.numId);

    expect(store.redo()).not.toBeNull(); // header
    expect(hasHeaderPart(store)).toBe(true);
    expect(numberingNumIds(store)).toContain(ensured!.numId);

    expect(store.redo()).not.toBeNull(); // story numPr
    expect(documentNumIds(store)).toContain(ensured!.numId);
    expect(numberingNumIds(store)).toContain(ensured!.numId);
  });

  test('note lifecycle then hyperlink: undo×2 redo×2 keeps rId resolvable', () => {
    const store = openStore();
    const paragraphId = firstParagraphId(store);

    expect(
      store.applyLifecycleOp({
        op: 'insertNote',
        noteKind: 'footnote',
        paragraphId,
        offset: 4,
      }).ok
    ).toBe(true);
    expect(resolveNotesPart(store.currentPackage(), 'footnote')).not.toBeNull();

    const ensured = ensureHyperlinkRelationship(store.currentPackage(), 'https://example.com');
    expect(ensured).toBeTruthy();
    store.replacePackageShell(ensured!.pkg);
    const rId = ensured!.relationshipId;

    expect(
      store.transact({ kind: 'body' }, (ctx) => {
        ctx.apply({
          op: 'insertHyperlink',
          paragraphId,
          start: 0,
          end: 4,
          relationshipId: rId,
        });
      }).ok
    ).toBe(true);

    expect(hyperlinkExternalIds(store)).toContain(rId);
    expect(documentHyperlinkIds(store)).toContain(rId);

    expect(store.undo()).not.toBeNull(); // story hyperlink
    expect(store.undo()).not.toBeNull(); // package note insert
    expect(resolveNotesPart(store.currentPackage(), 'footnote')).toBeNull();
    expect(hyperlinkExternalIds(store)).toContain(rId);

    expect(store.redo()).not.toBeNull(); // note
    expect(resolveNotesPart(store.currentPackage(), 'footnote')).not.toBeNull();
    expect(hyperlinkExternalIds(store)).toContain(rId);

    expect(store.redo()).not.toBeNull(); // story hyperlink
    expect(documentHyperlinkIds(store)).toContain(rId);
    expect(hyperlinkExternalIds(store)).toContain(rId);
  });

  test('undo of HF create still removes furniture while keeping later numbering', () => {
    const store = openStore();
    const paragraphId = firstParagraphId(store);

    expect(
      store.applyLifecycleOp({
        op: 'createHeaderFooter',
        sectionIndex: 0,
        kind: 'header',
        variant: 'default',
      }).ok
    ).toBe(true);

    const ensured = ensureListDefinition(store.currentPackage(), 'ordered');
    expect(ensured).toBeTruthy();
    store.replacePackageShell(ensured!.pkg);
    store.transact({ kind: 'body' }, (ctx) => {
      ctx.apply({ op: 'setListNumbering', paragraphId, numId: ensured!.numId });
    });

    store.undo(); // numPr
    store.undo(); // header

    expect(hasHeaderPart(store)).toBe(false);
    expect(
      store.currentPackage().contentTypes.overrides.has('/word/header1.xml') ||
        [...store.currentPackage().contentTypes.overrides.keys()].some((k) => k.includes('header'))
    ).toBe(false);
    expect(numberingNumIds(store)).toContain(ensured!.numId);
  });
});
