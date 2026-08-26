// Headless `applyLifecycle` must bind the collaboration actor before minting furniture `rId`s.
//
// `apply` and the comment/custom-node entries wrap in `runWithTransactionActor`. The
// lifecycle path used to call `store.applyLifecycleOp` bare, so two hosts creating a header
// from the same snapshot both took `rId${max + 1}`.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  MAX_RELATIONSHIP_NUMBER,
  nextStripedDecimalId,
  relationshipIdFromNumber,
} from '../../store/package/actor-scoped-ids.ts';
import { normalizeParagraphIdentity } from '../../store/package/para-id.ts';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { TreePackageStore } from '../../store/store/tree-package-store.ts';
import { stubCollaborationSession } from '../../editor/__tests__/collaboration-test-module.ts';
import { packageStorePort } from '../server-host.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function blankDoc(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>body</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`
    ),
  });
}

function portFor(actorId: string) {
  const loaded = readOoxmlPackage(blankDoc());
  if (!loaded.ok) throw new Error(loaded.reason);
  const main = loaded.package.parts.get(loaded.package.mainDocumentPart);
  if (!main) throw new Error('no main');
  const store = new TreePackageStore(loaded.package, normalizeParagraphIdentity(main));
  const port = packageStorePort(
    store,
    stubCollaborationSession({ identity: { actorId, name: actorId } })
  );
  return { port, store };
}

function headerRId(store: TreePackageStore): string {
  const rels = store.currentPackage().relationships.get(store.currentPackage().mainDocumentPart);
  const header = rels?.find((rel) => rel.type.endsWith('/header'));
  if (!header) throw new Error('no header relationship');
  return header.id;
}

describe('headless applyLifecycle binds the collaboration actor', () => {
  test('two actors mint different header rIds from the same snapshot', () => {
    const left = portFor('alice');
    const right = portFor('bob');
    const op = {
      op: 'createHeaderFooter' as const,
      sectionIndex: 0,
      kind: 'header' as const,
      variant: 'default' as const,
    };
    expect(left.port.applyLifecycle(op).ok).toBe(true);
    expect(right.port.applyLifecycle(op).ok).toBe(true);
    const leftId = headerRId(left.store);
    const rightId = headerRId(right.store);
    expect(leftId).not.toBe(rightId);
    const used = new Set(['1']);
    expect(leftId).toBe(
      relationshipIdFromNumber(Number(nextStripedDecimalId(used, 'alice', MAX_RELATIONSHIP_NUMBER)))
    );
    expect(rightId).toBe(
      relationshipIdFromNumber(Number(nextStripedDecimalId(used, 'bob', MAX_RELATIONSHIP_NUMBER)))
    );
  });
});
