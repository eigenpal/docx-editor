/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Character-format journals must not change document text.

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  TreePackageStore,
  normalizeParagraphIdentity,
  readOoxmlPackage,
  type OoxmlNode,
  type OoxmlPackage,
} from '@docx-editor.dev/core/store';
import {
  createCollaborationDocumentPort,
  type CanonicalPrimitiveJournal,
} from '@docx-editor.dev/core/collaboration/replication';
import {
  applyJournal,
  destroyReplica,
  nodeText,
  collectKind,
  packageOf,
  seedReplica,
} from './document-support.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function documentBytes(body: string): Uint8Array {
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
      `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`
    ),
  });
}

const ONE_RUN = documentBytes(
  '<w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri"/></w:rPr><w:t>Date: March 2 2026</w:t></w:r></w:p>'
);

const TWO_RUNS = documentBytes(
  '<w:p>' +
    '<w:r><w:rPr><w:b/><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">Date: </w:t></w:r>' +
    '<w:r><w:rPr><w:color w:val="000000"/><w:sz w:val="22"/></w:rPr>' +
    '<w:t xml:space="preserve">March 2 2026</w:t></w:r>' +
    '</w:p>'
);

const opened: Array<{ destroy(): void }> = [];

afterEach(() => {
  for (const replica of opened.splice(0)) replica.destroy();
});

function openStore(bytes: Uint8Array): TreePackageStore {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  const main = loaded.package.parts.get(loaded.package.mainDocumentPart);
  if (!main) throw new Error('no main part');
  return new TreePackageStore(loaded.package, normalizeParagraphIdentity(main));
}

function paragraphId(store: TreePackageStore): string {
  const found: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'paragraph') found.push(node.id);
    if (node.kind === 'textValue') return;
    for (const child of node.children) visit(child);
  };
  visit(store.bodyStore().part.root);
  if (!found[0]) throw new Error('no paragraph');
  return found[0];
}

function storeText(store: TreePackageStore): string {
  const chunks: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') {
      chunks.push(node.value);
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(store.bodyStore().part.root);
  return chunks.join('');
}

function captureFormatJournal(
  bytes: Uint8Array,
  start: number,
  end: number,
  localName: string
): { readonly store: TreePackageStore; readonly journal: CanonicalPrimitiveJournal } {
  const store = openStore(bytes);
  const port = createCollaborationDocumentPort(store, { documentId: 'format-text' });
  const journals: CanonicalPrimitiveJournal[] = [];
  const stop = port.observePrimitiveJournal((journal) => journals.push(journal));
  const result = store.transact({ kind: 'body' }, (context) => {
    context.apply({
      op: 'setRunProperties',
      paragraphId: paragraphId(store),
      start,
      end,
      properties: [{ localName }],
    });
  });
  port.flushPendingJournals();
  stop();
  if (!result.ok) throw new Error(result.detail ?? result.reason);
  if (!journals[0]) throw new Error('no journal');
  return { store, journal: journals[0] };
}

function packageText(pkg: OoxmlPackage): string {
  return collectKind(pkg, 'paragraph').map(nodeText).join('');
}

function hasLocalName(pkg: OoxmlPackage, localName: string): boolean {
  let found = false;
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.localName === localName) found = true;
    for (const child of node.children) visit(child);
  };
  for (const part of pkg.parts.values()) visit(part.root);
  return found;
}

describe('character format journals keep document text', () => {
  test('local split-range bold does not change text', () => {
    const { store } = captureFormatJournal(ONE_RUN, 6, 18, 'b');
    expect(storeText(store)).toBe('Date: March 2 2026');
    expect(hasLocalName(store.currentPackage(), 'b')).toBe(true);
  });

  test('Yjs replay of split-range bold keeps text once', async () => {
    const baseline = openStore(ONE_RUN).currentPackage();
    const { store, journal } = captureFormatJournal(ONE_RUN, 6, 18, 'b');
    expect(storeText(store)).toBe('Date: March 2 2026');
    const replica = await seedReplica(baseline);
    opened.push({ destroy: () => destroyReplica(replica) });
    applyJournal(replica, journal);
    expect(packageText(packageOf(replica))).toBe('Date: March 2 2026');
    expect(hasLocalName(packageOf(replica), 'b')).toBe(true);
  });

  test('replaying the same split-range bold journal twice keeps text once', async () => {
    const baseline = openStore(ONE_RUN).currentPackage();
    const { journal } = captureFormatJournal(ONE_RUN, 6, 18, 'b');
    const replica = await seedReplica(baseline);
    opened.push({ destroy: () => destroyReplica(replica) });
    applyJournal(replica, journal);
    applyJournal(replica, journal);
    expect(packageText(packageOf(replica))).toBe('Date: March 2 2026');
    expect(hasLocalName(packageOf(replica), 'b')).toBe(true);
  });

  test('two-run Date line full-range bold keeps text once on Yjs replay', async () => {
    const baseline = openStore(TWO_RUNS).currentPackage();
    const { store, journal } = captureFormatJournal(TWO_RUNS, 0, 18, 'b');
    expect(storeText(store)).toBe('Date: March 2 2026');
    const replica = await seedReplica(baseline);
    opened.push({ destroy: () => destroyReplica(replica) });
    applyJournal(replica, journal);
    expect(packageText(packageOf(replica))).toBe('Date: March 2 2026');
  });

  test('italic split-range keeps text once on Yjs replay and replay-twice', async () => {
    const baseline = openStore(ONE_RUN).currentPackage();
    const { store, journal } = captureFormatJournal(ONE_RUN, 6, 18, 'i');
    expect(storeText(store)).toBe('Date: March 2 2026');
    const replica = await seedReplica(baseline);
    opened.push({ destroy: () => destroyReplica(replica) });
    applyJournal(replica, journal);
    expect(packageText(packageOf(replica))).toBe('Date: March 2 2026');
    expect(hasLocalName(packageOf(replica), 'i')).toBe(true);
    applyJournal(replica, journal);
    expect(packageText(packageOf(replica))).toBe('Date: March 2 2026');
    expect(hasLocalName(packageOf(replica), 'i')).toBe(true);
  });

  test('underline split-range keeps text once on Yjs replay and replay-twice', async () => {
    const baseline = openStore(ONE_RUN).currentPackage();
    const { store, journal } = captureFormatJournal(ONE_RUN, 6, 18, 'u');
    expect(storeText(store)).toBe('Date: March 2 2026');
    const replica = await seedReplica(baseline);
    opened.push({ destroy: () => destroyReplica(replica) });
    applyJournal(replica, journal);
    applyJournal(replica, journal);
    expect(packageText(packageOf(replica))).toBe('Date: March 2 2026');
    expect(hasLocalName(packageOf(replica), 'u')).toBe(true);
  });
});
