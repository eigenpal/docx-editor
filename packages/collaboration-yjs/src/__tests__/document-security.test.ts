import { describe, expect, test } from 'bun:test';
import { collaborationDocx } from './support.ts';
import {
  destroyReplica,
  findText,
  loadPackage,
  packageFingerprint,
  packageOf,
  seedReplica,
} from './document-support.ts';
import {
  DocumentRegistry,
  applyPrimitiveJournal,
  seedPackage,
  MemoryBlobStore,
} from '../document/index.ts';
import * as Y from 'yjs';

describe('shared-state security and limits', () => {
  test('rejects prototype-polluting keys on putNode and attributes', async () => {
    const replica = await seedReplica(loadPackage(collaborationDocx()));
    try {
      const proto = applyPrimitiveJournal(replica.registry, {
        effects: [{ kind: 'putNode', descriptor: { logicalId: '__proto__', kind: 'textValue' } }],
      });
      expect(proto.ok).toBe(false);
      if (proto.ok) throw new Error('expected refusal');
      expect(proto.code).toBe('invalid-logical-id');

      const ctor = applyPrimitiveJournal(replica.registry, {
        effects: [{ kind: 'putNode', descriptor: { logicalId: 'constructor', kind: 'textValue' } }],
      });
      expect(ctor.ok).toBe(false);

      const text = findText(packageOf(replica), 'Alpha paragraph');
      const attr = applyPrimitiveJournal(replica.registry, {
        effects: [
          {
            kind: 'setAttribute',
            logicalId: text.id,
            qname: { namespaceUri: '', localName: '__proto__' },
            value: 'x',
          },
        ],
      });
      expect(attr.ok).toBe(false);
      if (attr.ok) throw new Error('expected refusal');
      expect(attr.code).toBe('prototype-key');

      const prefix = applyPrimitiveJournal(replica.registry, {
        effects: [
          { kind: 'setNamespaceBinding', logicalId: text.id, prefix: 'prototype', uri: 'urn:x' },
        ],
      });
      expect(prefix.ok).toBe(false);
    } finally {
      destroyReplica(replica);
    }
  });

  test('rejects traversing and non-absolute part names', async () => {
    const replica = await seedReplica(loadPackage(collaborationDocx()));
    try {
      const text = findText(packageOf(replica), 'Alpha paragraph');
      for (const name of ['../etc/passwd', '/word/../../../etc/passwd', 'word/document.xml', '']) {
        const result = applyPrimitiveJournal(replica.registry, {
          effects: [{ kind: 'putXmlPart', name, rootLogicalId: text.id }],
        });
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error(`expected refusal for ${name}`);
        expect(result.code === 'unsafe-part-name' || result.code === 'prototype-key').toBe(true);
      }
    } finally {
      destroyReplica(replica);
    }
  });

  test('enforces node, child, text, attribute, part, and blob limits', async () => {
    const doc = new Y.Doc();
    const registry = new DocumentRegistry(doc, {
      maxNodes: 3,
      maxChildren: 1,
      maxTextLength: 4,
      maxAttributes: 1,
      maxParts: 1,
      maxBlobBytes: 4,
    });
    const blobs = new MemoryBlobStore();
    const seeded = await seedPackage(registry, loadPackage(collaborationDocx()), blobs);
    expect(seeded.ok).toBe(false);

    const replica = await seedReplica(loadPackage(collaborationDocx()));
    try {
      const limited = new DocumentRegistry(replica.doc, {
        maxTextLength: 4,
        maxChildren: 0,
        maxParts: replica.registry.partEntries().length,
        maxBlobBytes: 2,
      });
      const text = findText(packageOf(replica), 'Alpha paragraph');
      const tooLong = applyPrimitiveJournal(limited, {
        effects: [
          { kind: 'spliceText', logicalId: text.id, utf16Start: 0, deleteCount: 0, insert: 'LONG' },
        ],
      });
      expect(tooLong.ok).toBe(false);
      if (tooLong.ok) throw new Error('expected refusal');
      expect(tooLong.code).toBe('text-too-long');

      const extraRoot = replica.mint.take();
      replica.doc.transact(() => {
        replica.registry.putText(extraRoot, 'x');
      });
      const tooManyParts = applyPrimitiveJournal(limited, {
        effects: [{ kind: 'putXmlPart', name: '/word/extra.xml', rootLogicalId: extraRoot }],
      });
      expect(tooManyParts.ok).toBe(false);
      if (tooManyParts.ok) throw new Error('expected refusal');
      expect(tooManyParts.code).toBe('too-many-parts');

      const blob = applyPrimitiveJournal(replica.registry, {
        effects: [
          {
            kind: 'putBinary',
            descriptor: {
              storageKey: '/word/media/huge.bin',
              digest: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
              size: 33 * 1024 * 1024,
              mediaType: 'application/octet-stream',
            },
          },
        ],
      });
      expect(blob.ok).toBe(false);
      if (blob.ok) throw new Error('expected refusal');
      expect(blob.code).toBe('blob-too-large');
    } finally {
      destroyReplica(replica);
    }
  });

  test('skips hostile Y.Map keys while reading shared records', async () => {
    const replica = await seedReplica(loadPackage(collaborationDocx()));
    try {
      const text = findText(packageOf(replica), 'Alpha paragraph');
      const paragraph = replica.registry.parentOf(text.id);
      expect(paragraph).toBeTruthy();
      replica.doc.transact(() => {
        replica.registry.schema.nodes.get(paragraph!)?.set('parent', 'nope');
      });
      expect(() => replica.registry.assertNoParentFields()).toThrow();
    } finally {
      destroyReplica(replica);
    }
  });

  test('skips hostile namespace dictionary and side-map keys', async () => {
    const replica = await seedReplica(loadPackage(collaborationDocx()));
    try {
      const before = packageOf(replica);
      replica.doc.transact(() => {
        replica.registry.schema.namespaces.set('__proto__', 'http://evil.example');
        replica.registry.schema.namespaces.set('constructor', 'http://evil.example');
        replica.registry.schema.attributes.set('__proto__', 'x');
        replica.registry.schema.bindings.set('prototype', 'w');
      });
      const after = replica.materializer.rebuild();
      if (!after.ok) throw new Error(after.code);
      expect(packageFingerprint(after.package)).toBe(packageFingerprint(before));
      expect(({} as Record<string, unknown>)['http://evil.example']).toBeUndefined();
    } finally {
      destroyReplica(replica);
    }
  });

  test('does not store deleted false on live nodes', async () => {
    const replica = await seedReplica(loadPackage(collaborationDocx()));
    try {
      replica.registry.schema.nodes.forEach((record) => {
        expect(record.get('deleted')).not.toBe(false);
        expect(record.has('deleted')).toBe(false);
        expect(record.has('attributes')).toBe(false);
        expect(record.has('bindings')).toBe(false);
      });
    } finally {
      destroyReplica(replica);
    }
  });
});
