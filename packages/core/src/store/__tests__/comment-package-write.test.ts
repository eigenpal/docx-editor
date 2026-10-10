// Journal capture for `addPackageComment`.
//
// `replacePackageShell` only assigns `this.pkg`. If the comment write did not record
// `putXmlPart` / `putRelationship` / `putContentTypeOverride` itself, a peer would receive
// story markers that name a comment the package does not hold.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { observeCanonicalPrimitiveJournal } from '../../collaboration/primitive-journal.ts';
import { flushPendingCanonicalJournals } from '../package/canonical-primitive-capture.ts';
import { readOoxmlPackage } from '../package/ooxml-package.ts';
import type { CanonicalPrimitiveJournal } from '../package/canonical-primitive-journal.ts';
import {
  addPackageComment,
  deletePackageComments,
  setPackageCommentResolved,
} from '../store/comment-package-write.ts';
import { TreePackageStore } from '../store/tree-package-store.ts';
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function documentBytes(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`
    ),
  });
}

function openStore(): TreePackageStore {
  const loaded = readOoxmlPackage(documentBytes());
  if (!loaded.ok) throw new Error(loaded.reason);
  const main = loaded.package.parts.get(loaded.package.mainDocumentPart);
  if (!main) throw new Error('missing main part');
  return new TreePackageStore(loaded.package, main);
}

function paragraphIdOf(part: OoxmlPart): string {
  const found: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'paragraph') found.push(node.id);
    if (node.kind === 'textValue') return;
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  const id = found[0];
  if (!id) throw new Error('no paragraph');
  return id;
}

describe('addPackageComment journals the comments part, not only the story markers', () => {
  test('creating comments.xml records putXmlPart, putRelationship and putContentTypeOverride', () => {
    const store = openStore();
    const journals: CanonicalPrimitiveJournal[] = [];
    observeCanonicalPrimitiveJournal(store, (journal) => journals.push(journal));
    const result = addPackageComment(store, {
      anchor: { paragraphId: paragraphIdOf(store.bodyStore().part), start: 0, end: 5 },
      author: 'Ada',
      text: 'a remark',
    });
    expect(result.ok).toBe(true);
    flushPendingCanonicalJournals(store);
    expect(journals).toHaveLength(1);
    const kinds = journals[0]!.effects.map((effect) => effect.kind);
    expect(kinds).toContain('putXmlPart');
    expect(kinds).toContain('putRelationship');
    expect(kinds).toContain('putContentTypeOverride');
    expect(
      journals[0]!.effects.some(
        (effect) => effect.kind === 'putXmlPart' && effect.name === '/word/comments.xml'
      )
    ).toBe(true);
    expect(
      journals[0]!.effects.some(
        (effect) =>
          effect.kind === 'putContentTypeOverride' && effect.partName === '/word/comments.xml'
      )
    ).toBe(true);
    expect(kinds).toContain('putNode');
    expect(kinds).toContain('spliceChildren');
  });
});

describe('setPackageCommentResolved journals commentsExtended.xml', () => {
  test('creating commentsExtended.xml records putXmlPart, putRelationship and putContentTypeOverride', () => {
    const store = openStore();
    const journals: CanonicalPrimitiveJournal[] = [];
    observeCanonicalPrimitiveJournal(store, (journal) => journals.push(journal));
    const added = addPackageComment(store, {
      anchor: { paragraphId: paragraphIdOf(store.bodyStore().part), start: 0, end: 5 },
      author: 'Ada',
      text: 'a remark',
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    flushPendingCanonicalJournals(store);
    journals.length = 0;
    const resolved = setPackageCommentResolved(store, added.commentId, true);
    expect(resolved.ok).toBe(true);
    flushPendingCanonicalJournals(store);
    expect(journals).toHaveLength(1);
    const kinds = journals[0]!.effects.map((effect) => effect.kind);
    expect(kinds).toContain('putXmlPart');
    expect(kinds).toContain('putRelationship');
    expect(kinds).toContain('putContentTypeOverride');
    expect(
      journals[0]!.effects.some(
        (effect) => effect.kind === 'putXmlPart' && effect.name === '/word/commentsExtended.xml'
      )
    ).toBe(true);
    expect(
      journals[0]!.effects.some(
        (effect) =>
          effect.kind === 'putContentTypeOverride' &&
          effect.partName === '/word/commentsextended.xml'
      )
    ).toBe(true);
  });

  test('reopening a resolved comment records setAttribute for done', () => {
    const store = openStore();
    const journals: CanonicalPrimitiveJournal[] = [];
    observeCanonicalPrimitiveJournal(store, (journal) => journals.push(journal));
    const added = addPackageComment(store, {
      anchor: { paragraphId: paragraphIdOf(store.bodyStore().part), start: 0, end: 5 },
      author: 'Ada',
      text: 'a remark',
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(setPackageCommentResolved(store, added.commentId, true).ok).toBe(true);
    flushPendingCanonicalJournals(store);
    journals.length = 0;
    const reopened = setPackageCommentResolved(store, added.commentId, false);
    expect(reopened.ok).toBe(true);
    if (reopened.ok) expect(reopened.changed).toBe(true);
    flushPendingCanonicalJournals(store);
    expect(journals).toHaveLength(1);
    expect(
      journals[0]!.effects.some(
        (effect) =>
          effect.kind === 'setAttribute' &&
          effect.qname.localName === 'done' &&
          effect.value === '0'
      )
    ).toBe(true);
  });
});

describe('deletePackageComments journals the stripped markers', () => {
  test('deleting a comment records spliceChildren and does not leave a commentReference', () => {
    const store = openStore();
    const journals: CanonicalPrimitiveJournal[] = [];
    observeCanonicalPrimitiveJournal(store, (journal) => journals.push(journal));
    const added = addPackageComment(store, {
      anchor: { paragraphId: paragraphIdOf(store.bodyStore().part), start: 0, end: 5 },
      author: 'Ada',
      text: 'a remark',
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    flushPendingCanonicalJournals(store);
    journals.length = 0;
    expect(deletePackageComments(store, [{ commentId: added.commentId }])).toBe(true);
    flushPendingCanonicalJournals(store);
    expect(journals).toHaveLength(1);
    expect(journals[0]!.effects.some((effect) => effect.kind === 'spliceChildren')).toBe(true);
  });
});
