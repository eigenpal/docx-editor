import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { strToU8, zipSync } from 'fflate';
import { collaborationDocx } from './support.ts';
import {
  destroyReplica,
  loadFixture,
  loadPackage,
  packageDigest,
  packageFingerprint,
  packageOf,
  saveReopenDigest,
  seedReplica,
  spliceTextJournal,
  applyJournal,
  findText,
  joinReplica,
  mainPart,
  nodeText,
  collectKind,
} from './document-support.ts';
import { PackageMaterializer, assertIndependentIdentity } from '../document/index.ts';

function manyParagraphs(count: number): Uint8Array {
  const paragraphs = Array.from(
    { length: count },
    (_, index) =>
      `<w:p w14:paraId="${(index + 1).toString(16).padStart(8, '0')}"><w:r><w:t>P${index} text</w:t></w:r></w:p>`
  ).join('');
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:body>${paragraphs}<w:sectPr/></w:body>
</w:document>`;
  return zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    'word/document.xml': strToU8(document),
  });
}

describe('full-document registry round trip', () => {
  test('seeds a real fixture, materializes, and matches fingerprint plus save/reopen digest', async () => {
    const original = await loadFixture('editable-sample.docx');
    const replica = await seedReplica(original);
    try {
      const materialized = packageOf(replica);
      expect(packageFingerprint(materialized)).toBe(packageFingerprint(original));
      expect(packageDigest(materialized)).toEqual(packageDigest(original));
      expect(saveReopenDigest(materialized)).toEqual(packageDigest(original));
      replica.registry.assertNoParentFields();
      const paragraph = collectKind(materialized, 'paragraph')[0]!;
      const meta = replica.registry.identityMeta(paragraph.id);
      expect(meta).not.toBeNull();
      assertIndependentIdentity(meta!);
    } finally {
      destroyReplica(replica);
    }
  });

  test('seeds the collaboration fixture including relationships and opaque parts', async () => {
    const original = loadPackage(collaborationDocx());
    const replica = await seedReplica(original);
    try {
      const materialized = packageOf(replica);
      expect(packageFingerprint(materialized)).toBe(packageFingerprint(original));
      expect(materialized.relationships.size).toBeGreaterThan(0);
      expect(replica.registry.binaries().length).toBeGreaterThan(0);
      expect(replica.registry.contentTypeOverrides().size).toBeGreaterThan(0);
    } finally {
      destroyReplica(replica);
    }
  });

  test('preserves reference identity for an untouched sibling after a one-character insert', async () => {
    const replica = await seedReplica(loadPackage(collaborationDocx()));
    try {
      const before = packageOf(replica);
      const bravo = collectKind(before, 'paragraph').find((node) =>
        nodeText(node).includes('Bravo')
      );
      expect(bravo).toBeDefined();
      const text = findText(before, 'Alpha paragraph');
      applyJournal(replica, spliceTextJournal(text.id, 5, '!'));
      const after = packageOf(replica);
      const bravoAfter = collectKind(after, 'paragraph').find((node) =>
        nodeText(node).includes('Bravo')
      );
      expect(bravoAfter).toBe(bravo);
      expect(nodeText(collectKind(after, 'paragraph')[0]!)).toContain('Alpha!');
    } finally {
      destroyReplica(replica);
    }
  });

  test('incremental materialization equals a fresh materialization and stays bounded', async () => {
    const replica = await seedReplica(loadPackage(manyParagraphs(200)));
    const remote = joinReplica(replica);
    try {
      const beforeRemote = mainPart(packageOf(remote)).root;
      const text = findText(packageOf(replica), 'P100 text');
      applyJournal(replica, spliceTextJournal(text.id, 0, 'X'));
      const update = Y.encodeStateAsUpdate(replica.doc, Y.encodeStateVector(remote.doc));
      Y.applyUpdate(remote.doc, update, 'sync');
      const start = performance.now();
      const incremental = remote.materializer.rebuild();
      const incrementalMs = performance.now() - start;
      if (!incremental.ok) throw new Error(incremental.code);
      const fresh = new PackageMaterializer(remote.registry, remote.blobs);
      const freshStart = performance.now();
      const freshResult = fresh.rebuild();
      const freshMs = performance.now() - freshStart;
      if (!freshResult.ok) throw new Error(freshResult.code);
      expect(packageFingerprint(incremental.package)).toBe(packageFingerprint(freshResult.package));
      expect(remote.materializer.dirtyLogicalIds().size).toBeGreaterThan(0);
      expect(remote.materializer.dirtyLogicalIds().size).toBeLessThan(12);
      expect(mainPart(incremental.package).root).not.toBe(beforeRemote);
      expect(incrementalMs).toBeLessThan(100);
      expect(freshMs).toBeLessThan(250);
      fresh.destroy();
    } finally {
      destroyReplica(replica);
      destroyReplica(remote);
    }
  });

  test('duplicate update delivery is a no-op', async () => {
    const left = await seedReplica(loadPackage(collaborationDocx()));
    const right = joinReplica(left);
    try {
      applyJournal(
        left,
        spliceTextJournal(findText(packageOf(left), 'Alpha paragraph').id, 0, 'Z')
      );
      const update = Y.encodeStateAsUpdate(left.doc, Y.encodeStateVector(right.doc));
      Y.applyUpdate(right.doc, update, 'once');
      const first = right.materializer.rebuild();
      if (!first.ok) throw new Error(first.code);
      Y.applyUpdate(right.doc, update, 'twice');
      const second = right.materializer.rebuild();
      if (!second.ok) throw new Error(second.code);
      expect(second.package).toBe(first.package);
      expect(packageFingerprint(first.package)).toBe(packageFingerprint(packageOf(left)));
    } finally {
      destroyReplica(left);
      destroyReplica(right);
    }
  });
});
