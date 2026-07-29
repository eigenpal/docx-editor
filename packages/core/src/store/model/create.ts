// Create-from-scratch authored package initialization (document-engine task 2.9
// / lossless-package-model "Create from scratch"). Produces a valid minimal OPC
// model — content types, root relationships, document/styles/numbering parts, a
// default Normal style, and identity state — that is semantically editable
// BEFORE any serializer exists. No bytes are produced here.

import {
  type PackageModel,
  type Story,
  type PartRecord,
  type StyleRecord,
  REL_TYPES,
  CONTENT_TYPES,
} from './authored-model.ts';
import type { RelationshipRecord } from '../package/index.ts';
import { IdentityAllocator } from './identity.ts';

export function createEmptyModel(): PackageModel {
  const alloc = new IdentityAllocator();
  const bodyId = alloc.allocate('story');
  const paraId = alloc.allocate('paragraph');

  const body: Story = {
    id: bodyId,
    kind: 'body',
    blocks: [{ kind: 'paragraph', id: paraId, runs: [] }],
  };

  const contentTypes = {
    defaults: [
      { extension: 'rels', contentType: CONTENT_TYPES.relationships, order: 0 },
      { extension: 'xml', contentType: CONTENT_TYPES.xml, order: 1 },
    ],
    overrides: [
      { partName: '/word/document.xml', contentType: CONTENT_TYPES.documentMain, order: 0 },
      { partName: '/word/styles.xml', contentType: CONTENT_TYPES.styles, order: 1 },
      { partName: '/word/numbering.xml', contentType: CONTENT_TYPES.numbering, order: 2 },
    ],
  };

  // Root package relationship -> main document; document -> styles, numbering.
  const relationships: RelationshipRecord[] = [
    {
      ownerPart: '/',
      id: 'rId1',
      type: REL_TYPES.officeDocument,
      rawTarget: 'word/document.xml',
      targetMode: 'Internal',
      order: 0,
    },
    {
      ownerPart: '/word/document.xml',
      id: 'rId1',
      type: REL_TYPES.styles,
      rawTarget: 'styles.xml',
      targetMode: 'Internal',
      order: 0,
    },
    {
      ownerPart: '/word/document.xml',
      id: 'rId2',
      type: REL_TYPES.numbering,
      rawTarget: 'numbering.xml',
      targetMode: 'Internal',
      order: 1,
    },
  ];

  const styles: StyleRecord[] = [
    { id: 'Normal', name: 'Normal', type: 'paragraph', isDefault: true },
  ];

  const parts = new Map<string, PartRecord>([
    ['/word/document.xml', { kind: 'xml', partName: '/word/document.xml', storyId: bodyId }],
    ['/word/styles.xml', { kind: 'xml', partName: '/word/styles.xml' }],
    ['/word/numbering.xml', { kind: 'xml', partName: '/word/numbering.xml' }],
  ]);

  return {
    contentTypes,
    relationships,
    stories: new Map([[bodyId, body]]),
    styles,
    numbering: [],
    parts,
    identity: alloc.state(),
    provenance: 'created',
  };
}

/** The body story id of a freshly created (or any single-body) model. */
export function bodyStoryId(model: PackageModel): string {
  for (const [id, story] of model.stories) if (story.kind === 'body') return id;
  throw new Error('model has no body story');
}
