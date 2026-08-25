import { describe, expect, test } from 'bun:test';
import {
  relsPartNameFor,
  writeOoxmlPackage,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPackage,
} from '@docx-editor.dev/core/store';
import { collaborationDocx } from './support.ts';
import {
  applyJournal,
  destroyReplica,
  findText,
  joinReplica,
  loadPackage,
  packageOf,
  saveReopenDigest,
  seedReplica,
  spliceTextJournal,
  syncOne,
} from './document-support.ts';

const IMAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const HYPERLINK_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';
const PACKAGE_RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';

function relationshipElements(pkg: OoxmlPackage, owner: string): OoxmlElement[] {
  const part = pkg.parts.get(relsPartNameFor(owner));
  if (!part) return [];
  const found: OoxmlElement[] = [];
  for (const child of part.root.children) {
    if (child.kind === 'textValue') continue;
    if (child.namespaceUri !== PACKAGE_RELS || child.localName !== 'Relationship') continue;
    found.push(child);
  }
  return found;
}

function attributeOf(node: OoxmlNode, localName: string): string | undefined {
  if (node.kind === 'textValue') return undefined;
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

describe('materialized .rels trees follow the relationship map', () => {
  test('a receiving peer materializes putRelationship and round-trips through the zip', async () => {
    const left = await seedReplica(loadPackage(collaborationDocx()));
    const right = joinReplica(left);
    try {
      const owner = packageOf(left).mainDocumentPart;
      applyJournal(left, {
        effects: [
          {
            kind: 'putRelationship',
            owner,
            record: {
              ownerPart: owner,
              id: 'rId99',
              type: IMAGE_REL,
              rawTarget: 'media/a.png',
              targetMode: 'Internal',
              order: 20,
            },
          },
        ],
      });
      syncOne(left, right);

      for (const replica of [left, right]) {
        const pkg = packageOf(replica);
        expect(pkg.relationships.get(owner)?.some((record) => record.id === 'rId99')).toBe(true);
        const rels = relationshipElements(pkg, owner);
        expect(rels.map((node) => attributeOf(node, 'Id'))).toContain('rId99');
        const added = rels.find((node) => attributeOf(node, 'Id') === 'rId99');
        expect(added).toBeDefined();
        expect(attributeOf(added!, 'Type')).toBe(IMAGE_REL);
        expect(attributeOf(added!, 'Target')).toBe('media/a.png');
        expect(attributeOf(added!, 'TargetMode')).toBeUndefined();
      }

      const bytes = writeOoxmlPackage(packageOf(right));
      const reloaded = loadPackage(bytes);
      expect(reloaded.relationships.get(owner)?.some((record) => record.id === 'rId99')).toBe(true);
      expect(
        relationshipElements(reloaded, owner).some((node) => attributeOf(node, 'Id') === 'rId99')
      ).toBe(true);
      expect(saveReopenDigest(packageOf(right))).toEqual(saveReopenDigest(packageOf(left)));
    } finally {
      destroyReplica(left);
      destroyReplica(right);
    }
  });

  test('deleteRelationship removes the child from the materialized .rels part', async () => {
    const left = await seedReplica(loadPackage(collaborationDocx()));
    const right = joinReplica(left);
    try {
      const owner = packageOf(left).mainDocumentPart;
      applyJournal(left, {
        effects: [
          {
            kind: 'putRelationship',
            owner,
            record: {
              ownerPart: owner,
              id: 'rIdDel',
              type: IMAGE_REL,
              rawTarget: 'media/gone.png',
              targetMode: 'Internal',
              order: 21,
            },
          },
        ],
      });
      syncOne(left, right);
      expect(
        relationshipElements(packageOf(right), owner).some(
          (node) => attributeOf(node, 'Id') === 'rIdDel'
        )
      ).toBe(true);

      applyJournal(left, {
        effects: [{ kind: 'deleteRelationship', owner, relationshipId: 'rIdDel' }],
      });
      syncOne(left, right);

      for (const replica of [left, right]) {
        const pkg = packageOf(replica);
        expect(
          pkg.relationships.get(owner)?.some((record) => record.id === 'rIdDel') ?? false
        ).toBe(false);
        expect(
          relationshipElements(pkg, owner).some((node) => attributeOf(node, 'Id') === 'rIdDel')
        ).toBe(false);
      }

      const reloaded = loadPackage(writeOoxmlPackage(packageOf(right)));
      expect(
        reloaded.relationships.get(owner)?.some((record) => record.id === 'rIdDel') ?? false
      ).toBe(false);
    } finally {
      destroyReplica(left);
      destroyReplica(right);
    }
  });

  test('an external target emits TargetMode=External and round-trips', async () => {
    const left = await seedReplica(loadPackage(collaborationDocx()));
    const right = joinReplica(left);
    try {
      const owner = packageOf(left).mainDocumentPart;
      applyJournal(left, {
        effects: [
          {
            kind: 'putRelationship',
            owner,
            record: {
              ownerPart: owner,
              id: 'rIdExt',
              type: HYPERLINK_REL,
              rawTarget: 'https://example.com/doc',
              targetMode: 'External',
              order: 22,
            },
          },
        ],
      });
      syncOne(left, right);

      const added = relationshipElements(packageOf(right), owner).find(
        (node) => attributeOf(node, 'Id') === 'rIdExt'
      );
      expect(added).toBeDefined();
      expect(attributeOf(added!, 'Target')).toBe('https://example.com/doc');
      expect(attributeOf(added!, 'TargetMode')).toBe('External');
      expect(
        packageOf(right).externalTargets.some(
          (entry) => entry.ownerPart === owner && entry.id === 'rIdExt'
        )
      ).toBe(true);

      const reloaded = loadPackage(writeOoxmlPackage(packageOf(right)));
      const record = reloaded.relationships.get(owner)?.find((entry) => entry.id === 'rIdExt');
      expect(record?.targetMode).toBe('External');
      expect(record?.rawTarget).toBe('https://example.com/doc');
      expect(
        relationshipElements(reloaded, owner).some(
          (node) =>
            attributeOf(node, 'Id') === 'rIdExt' && attributeOf(node, 'TargetMode') === 'External'
        )
      ).toBe(true);
    } finally {
      destroyReplica(left);
      destroyReplica(right);
    }
  });

  test('a text insert keeps the projected .rels part by identity', async () => {
    const replica = await seedReplica(loadPackage(collaborationDocx()));
    try {
      const owner = packageOf(replica).mainDocumentPart;
      applyJournal(replica, {
        effects: [
          {
            kind: 'putRelationship',
            owner,
            record: {
              ownerPart: owner,
              id: 'rIdKeep',
              type: IMAGE_REL,
              rawTarget: 'media/keep.png',
              targetMode: 'Internal',
              order: 30,
            },
          },
        ],
      });
      const relsName = relsPartNameFor(owner);
      const before = packageOf(replica).parts.get(relsName);
      expect(before).toBeDefined();
      const text = findText(packageOf(replica), 'Alpha paragraph');
      applyJournal(replica, spliceTextJournal(text.id, 0, 'Z'));
      expect(packageOf(replica).parts.get(relsName)).toBe(before);
    } finally {
      destroyReplica(replica);
    }
  });
});
