// Note package lifecycle: insert/delete/convert/properties + package undo + bounds.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8, unzipSync } from 'fflate';
import {
  applyNoteLifecycleOp,
  canonicalOoxmlFingerprint,
  collectNoteReferences,
  diagnoseNoteReferences,
  findNoteById,
  noteIdOf,
  noteKindOf,
  noteReferenceKindOf,
  readOoxmlPackage,
  resolveNotesPart,
  writeOoxmlPackage,
  type OoxmlPackage,
} from '../package/index.ts';
import { diffSemanticDigests, semanticDigest } from '../package/ooxml-digest.ts';
import { TreePackageStore } from '../store/tree-package-store.ts';
import { paragraphTextOf } from '../store/tree-ops.ts';
import {
  authoredDocumentFootnoteProperties,
  resolveFootnoteProperties,
  settingsPartOf,
} from '../package/note-properties.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = `${R}/officeDocument`;

function build(options: {
  readonly body?: string;
  readonly footnotes?: string;
  readonly endnotes?: string;
  readonly settings?: string;
  readonly rels?: string;
  readonly overrides?: string;
}): Uint8Array {
  const hasFn = options.footnotes !== undefined;
  const hasEn = options.endnotes !== undefined;
  const rels =
    options.rels ??
    [
      hasFn ? `<Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/>` : '',
      hasEn ? `<Relationship Id="rIdEn" Type="${R}/endnotes" Target="endnotes.xml"/>` : '',
      options.settings
        ? `<Relationship Id="rIdSet" Type="${R}/settings" Target="settings.xml"/>`
        : '',
    ].join('');
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (hasFn
          ? '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>'
          : '') +
        (hasEn
          ? '<Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/>'
          : '') +
        (options.settings
          ? '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
          : '') +
        (options.overrides ?? '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
        (options.body ?? '<w:p><w:r><w:t>Hello</w:t></w:r></w:p><w:sectPr/>') +
        (options.body?.includes('sectPr') ? '' : '<w:sectPr/>') +
        '</w:body></w:document>'
    ),
  };
  if (rels) {
    entries['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}">${rels}</Relationships>`
    );
  }
  if (hasFn) {
    entries['word/footnotes.xml'] = strToU8(
      `<w:footnotes xmlns:w="${W}">${options.footnotes}</w:footnotes>`
    );
  }
  if (hasEn) {
    entries['word/endnotes.xml'] = strToU8(
      `<w:endnotes xmlns:w="${W}">${options.endnotes}</w:endnotes>`
    );
  }
  if (options.settings) entries['word/settings.xml'] = strToU8(options.settings);
  return zipSync(entries);
}

function load(bytes: Uint8Array): OoxmlPackage {
  const result = readOoxmlPackage(bytes);
  if (!result.ok) throw new Error(result.reason);
  return result.package;
}

function openStore(bytes: Uint8Array): TreePackageStore {
  const pkg = load(bytes);
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) throw new Error('no main');
  return new TreePackageStore(pkg, main);
}

function firstParagraphId(pkg: OoxmlPackage): string {
  const main = pkg.parts.get(pkg.mainDocumentPart)!;
  const body = main.root.children.find((child) => child.kind === 'body')!;
  const p = body.children.find((child) => child.kind === 'paragraph')!;
  return p.id;
}

const seededNotes =
  `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
  `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
  `<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t>one</w:t></w:r></w:p></w:footnote>` +
  `<w:footnote w:id="3"><w:p><w:r><w:t>three</w:t></w:r></w:p></w:footnote>`;

describe('insertNote', () => {
  test('creates part/rel/content-type and allocates id from max+1', () => {
    const store = openStore(build({}));
    const paragraphId = firstParagraphId(store.currentPackage());
    const result = store.applyLifecycleOp({
      op: 'insertNote',
      noteKind: 'footnote',
      paragraphId,
      offset: 5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.change?.impact).toBe('global');

    const pkg = store.currentPackage();
    const notes = resolveNotesPart(pkg, 'footnote');
    expect(notes).not.toBeNull();
    expect(notes!.root.kind).toBe('footnotes');
    expect(findNoteById(notes!.root, 1)).toBeDefined();
    expect(pkg.contentTypes.overrides.get('/word/footnotes.xml')).toContain('footnotes');

    const refs = collectNoteReferences(pkg.parts.get(pkg.mainDocumentPart)!);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.noteId).toBe(1);

    // Undo restores absence of the part relationship content.
    store.undo();
    expect(resolveNotesPart(store.currentPackage(), 'footnote')).toBeNull();
    store.redo();
    expect(resolveNotesPart(store.currentPackage(), 'footnote')).not.toBeNull();
  });

  test('seeds from existing max and never allocates reserved ids', () => {
    const store = openStore(build({ footnotes: seededNotes }));
    const paragraphId = firstParagraphId(store.currentPackage());
    const result = applyNoteLifecycleOp(store.currentPackage(), {
      op: 'insertNote',
      noteKind: 'footnote',
      paragraphId,
      offset: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.noteId).toBe(4);
    expect(result.noteId).toBeGreaterThan(0);
  });

  test('refuses id exhaustion', () => {
    const huge =
      `<w:footnote w:type="separator" w:id="-1"><w:p/></w:footnote>` +
      `<w:footnote w:type="continuationSeparator" w:id="0"><w:p/></w:footnote>` +
      `<w:footnote w:id="2147483647"><w:p><w:r><w:t>max</w:t></w:r></w:p></w:footnote>`;
    const store = openStore(build({ footnotes: huge }));
    const paragraphId = firstParagraphId(store.currentPackage());
    const result = store.applyLifecycleOp({
      op: 'insertNote',
      noteKind: 'footnote',
      paragraphId,
      offset: 0,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('invalidArgs');
  });
});

describe('deleteNote / convertNote / cascade', () => {
  test('deleteNote removes reference and body; undo restores both', () => {
    const body = `<w:p><w:r><w:t>A</w:t><w:footnoteReference w:id="1"/><w:t>Z</w:t></w:r></w:p>`;
    const store = openStore(build({ body, footnotes: seededNotes }));
    const beforeFn = canonicalOoxmlFingerprint(
      resolveNotesPart(store.currentPackage(), 'footnote')!
    );
    const result = store.applyLifecycleOp({
      op: 'deleteNote',
      noteKind: 'footnote',
      noteId: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    const pkg = store.currentPackage();
    expect(findNoteById(resolveNotesPart(pkg, 'footnote')!.root, 1)).toBeUndefined();
    expect(collectNoteReferences(pkg.parts.get(pkg.mainDocumentPart)!)).toHaveLength(0);

    store.undo();
    const undone = store.currentPackage();
    expect(findNoteById(resolveNotesPart(undone, 'footnote')!.root, 1)).toBeDefined();
    expect(canonicalOoxmlFingerprint(resolveNotesPart(undone, 'footnote')!)).toBe(beforeFn);
  });

  test('deleteText across noteReference cascades body in one undo', () => {
    const body = `<w:p><w:r><w:t>A</w:t><w:footnoteReference w:id="1"/><w:t>Z</w:t></w:r></w:p>`;
    const store = openStore(build({ body, footnotes: seededNotes }));
    const main = store.bodyStore().part;
    const paragraph = main.root.children
      .find((child) => child.kind === 'body')!
      .children.find((child) => child.kind === 'paragraph')!;
    const text = paragraphTextOf(main, paragraph.id)!;
    expect(text.length).toBe(3);
    const result = store.transact({ kind: 'body' }, (ctx) => {
      ctx.apply({ op: 'deleteText', paragraphId: paragraph.id, start: 1, end: 2 });
    });
    expect(result.ok).toBe(true);
    expect(
      findNoteById(resolveNotesPart(store.currentPackage(), 'footnote')!.root, 1)
    ).toBeUndefined();
    store.undo();
    expect(
      findNoteById(resolveNotesPart(store.currentPackage(), 'footnote')!.root, 1)
    ).toBeDefined();
  });

  test('convertNote moves body and rewrites reference kind', () => {
    const body = `<w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p>`;
    const store = openStore(
      build({
        body,
        footnotes: seededNotes,
        endnotes:
          `<w:endnote w:type="separator" w:id="-1"><w:p/></w:endnote>` +
          `<w:endnote w:type="continuationSeparator" w:id="0"><w:p/></w:endnote>`,
      })
    );
    const result = store.applyLifecycleOp({
      op: 'convertNote',
      fromKind: 'footnote',
      noteId: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    const pkg = store.currentPackage();
    expect(findNoteById(resolveNotesPart(pkg, 'footnote')!.root, 1)).toBeUndefined();
    const end = resolveNotesPart(pkg, 'endnote')!;
    const converted = end.root.children.find(
      (child) => child.kind === 'note' && (noteIdOf(child) ?? 0) > 0
    );
    expect(converted).toBeDefined();
    expect(noteKindOf(converted!)).toBe('endnote');
    const refs = collectNoteReferences(pkg.parts.get(pkg.mainDocumentPart)!);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.noteKind).toBe('endnote');
    expect(refs[0]!.noteId).toBe(noteIdOf(converted!)!);
    const refNode = pkg.parts
      .get(pkg.mainDocumentPart)!
      .root.children.find((c) => c.kind === 'body')!
      .children.find((c) => c.kind === 'paragraph')!
      .children.find((c) => c.kind === 'run')!
      .children.find((c) => c.kind === 'noteReference')!;
    expect(noteReferenceKindOf(refNode)).toBe('endnote');
  });

  test('deleteNote on missing id fails closed', () => {
    const store = openStore(build({ footnotes: seededNotes }));
    const result = store.applyLifecycleOp({
      op: 'deleteNote',
      noteKind: 'footnote',
      noteId: 99,
    });
    expect(result.ok).toBe(false);
  });
});

describe('setNoteProperties', () => {
  test('refuses endnote pageBottom and invents nothing on unedited save', () => {
    const store = openStore(build({}));
    const refused = store.applyLifecycleOp({
      op: 'setNoteProperties',
      scope: 'document',
      endnote: { position: 'pageBottom' },
    });
    expect(refused.ok).toBe(false);

    const bytes = writeOoxmlPackage(store.currentPackage());
    const reopened = load(bytes);
    expect(settingsPartOf(reopened)).toBeNull();
    expect(
      reopened.parts
        .get(reopened.mainDocumentPart)!
        .root.children.some(
          (child) => child.kind !== 'textValue' && child.localName === 'footnotePr'
        )
    ).toBe(false);
  });

  test('document scope writes settings footnotePr', () => {
    const store = openStore(build({}));
    const result = store.applyLifecycleOp({
      op: 'setNoteProperties',
      scope: 'document',
      footnote: {
        numFmt: 'lowerRoman',
        numStart: 2,
        numRestart: 'eachSect',
        position: 'pageBottom',
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    const settings = settingsPartOf(store.currentPackage());
    expect(settings).not.toBeNull();
    const authored = authoredDocumentFootnoteProperties(settings);
    expect(authored?.numFmt).toBe('lowerRoman');
    expect(authored?.numStart).toBe(2);
    expect(resolveFootnoteProperties(undefined, authored).numFmt).toBe('lowerRoman');
  });
});

describe('D9 note fingerprint / digest', () => {
  test('unedited note parts fingerprint round-trip; edit changes digest', () => {
    const bytes = build({
      body: `<w:p><w:r><w:t>A</w:t><w:footnoteReference w:id="1"/><w:t>Z</w:t></w:r></w:p>`,
      footnotes: seededNotes,
    });
    const loaded = load(bytes);
    const fn = resolveNotesPart(loaded, 'footnote')!;
    const beforeFp = canonicalOoxmlFingerprint(fn);
    const beforeDigest = semanticDigest([fn]);
    const written = writeOoxmlPackage(loaded);
    const reopened = load(written);
    const fnAgain = resolveNotesPart(reopened, 'footnote')!;
    expect(canonicalOoxmlFingerprint(fnAgain)).toBe(beforeFp);
    expect(diffSemanticDigests(beforeDigest, semanticDigest([fnAgain]))).toEqual([]);

    const store = openStore(bytes);
    const note = findNoteById(resolveNotesPart(store.currentPackage(), 'footnote')!.root, 1)!;
    const para = note.children.find((c) => c.kind === 'paragraph')!;
    const text = paragraphTextOf(resolveNotesPart(store.currentPackage(), 'footnote')!, para.id)!;
    const ok = store.transact({ kind: 'notesPart', noteKind: 'footnote' }, (ctx) => {
      ctx.apply({
        op: 'insertText',
        paragraphId: para.id,
        offset: text.length,
        text: 'X',
      });
    });
    expect(ok.ok).toBe(true);
    const edited = resolveNotesPart(store.currentPackage(), 'footnote')!;
    expect(diffSemanticDigests(beforeDigest, semanticDigest([edited])).length).toBeGreaterThan(0);
  });
});

describe('TreePackageStore notes coexistence', () => {
  test('body / HF / footnotes / endnotes keep independent revisions', () => {
    const withHeader = build({
      body:
        '<w:p><w:r><w:t>body</w:t></w:r></w:p>' +
        `<w:sectPr><w:headerReference w:type="default" r:id="rId7"/></w:sectPr>`,
      footnotes: seededNotes,
      endnotes:
        `<w:endnote w:type="separator" w:id="-1"><w:p/></w:endnote>` +
        `<w:endnote w:type="continuationSeparator" w:id="0"><w:p/></w:endnote>` +
        `<w:endnote w:id="1"><w:p><w:r><w:t>e</w:t></w:r></w:p></w:endnote>`,
      rels:
        `<Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/>` +
        `<Relationship Id="rIdEn" Type="${R}/endnotes" Target="endnotes.xml"/>` +
        `<Relationship Id="rId7" Type="${R}/header" Target="header1.xml"/>`,
      overrides:
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
    });
    const unzipped = unzipSync(withHeader);
    unzipped['word/header1.xml'] = strToU8(
      `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>hdr</w:t></w:r></w:p></w:hdr>`
    );
    const store = openStore(zipSync(unzipped));

    const bodyRev = store.revisionFor({ kind: 'body' })!;
    const fn = store.resolveStory({ kind: 'notesPart', noteKind: 'footnote' });
    expect(fn.ok).toBe(true);
    if (!fn.ok) throw new Error(fn.reason);
    const enBefore = store.revisionFor({ kind: 'notesPart', noteKind: 'endnote' })!;
    const hf = store.resolveStory({ kind: 'headerFooter', rId: 'rId7' });
    expect(hf.ok).toBe(true);
    if (!hf.ok) throw new Error(hf.reason);

    const fnPara = fn.store.part.root.children
      .find((child) => child.kind === 'note' && noteIdOf(child) === 3)!
      .children.find((child) => child.kind === 'paragraph')!;
    const fnRevBefore = fn.store.revision;
    store.transact({ kind: 'notesPart', noteKind: 'footnote' }, (ctx) => {
      ctx.apply({ op: 'insertText', paragraphId: fnPara.id, offset: 0, text: '!' });
    });
    expect(store.revisionFor({ kind: 'body' })).toBe(bodyRev);
    expect(store.revisionFor({ kind: 'notesPart', noteKind: 'footnote' })).toBeGreaterThan(
      fnRevBefore
    );
    expect(store.revisionFor({ kind: 'notesPart', noteKind: 'endnote' })).toBe(enBefore);

    const saved = writeOoxmlPackage(store.currentPackage());
    const reopened = load(saved);
    expect(resolveNotesPart(reopened, 'footnote')).not.toBeNull();
    expect(diagnoseNoteReferences(reopened)).toEqual([]);
  });
});
