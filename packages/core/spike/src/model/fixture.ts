/** @spike-features one-body-story, paragraphs, text, bold-mark, italic-mark, stable-paragraph-ids, one-preservation-capsule, synthetic-128-paragraph-fixture */
import manifest from '../../oracles/manifest.v1.json';
import { hexToBytes } from '../oracle-hash';
import { freezeAuthoredPackage } from './immutability';
import { snapshotAndValidateAuthoredPackage } from './validators';
import type { AuthoredPackageModel, AuthoredPackageModelInput, AuthoredParagraph, DocumentModel } from './types';
import type { AuthoredProperty } from './authored-property';

function paragraphIdForIndex(index: number): string {
  return `para-${String(index).padStart(3, '0')}`;
}

function blockIdForIndex(index: number): string {
  return `block-para-${String(index).padStart(3, '0')}`;
}

function buildParagraph(index: number): AuthoredParagraph {
  const paragraphId = paragraphIdForIndex(index);
  const styleId = manifest.fixture.sourceParagraphPattern.styleAIndices.includes(index)
    ? manifest.styleMutation.styleId
    : manifest.fixture.sourceParagraphPattern.defaultStyleId;
  const text = `p${String(index).padStart(3, '0')}`;
  const marks =
    index === 1
      ? ([
          { markId: 'mark-para-001-bold', kind: 'bold', start: 0, end: 1 },
          { markId: 'mark-para-001-italic', kind: 'italic', start: 1, end: 4 },
        ] as const)
      : ([] as const);
  const authoredProperties: Readonly<Record<string, AuthoredProperty>> =
    index === 2
      ? { keepLines: { state: 'value', value: true } }
      : styleId === manifest.styleMutation.styleId
        ? { lineHeightTwips: { state: 'raw', rawLexical: '288' } }
        : { lineHeightTwips: { state: 'omitted' } };
  return {
    blockId: blockIdForIndex(index),
    paragraphId,
    text,
    styleId,
    marks,
    authoredProperties,
  };
}

export function createFrozenAuthoredPackage(): AuthoredPackageModel {
  const paragraphOrder: string[] = [];
  const paragraphs = new Map<string, ReturnType<typeof buildParagraph>>();
  for (let index = 0; index < manifest.fixture.paragraphCount; index += 1) {
    const paragraph = buildParagraph(index);
    paragraphOrder.push(paragraph.paragraphId);
    paragraphs.set(paragraph.paragraphId, paragraph);
  }
  const capsuleManifest = manifest.unsupportedCapsule;
  const authored: AuthoredPackageModelInput = {
    body: {
      storyId: manifest.fixture.storyId,
      paragraphOrder,
      paragraphs,
    },
    capsules: [
      {
        capsuleId: 'capsule-spike-unsupported-0',
        ownerStoryId: capsuleManifest.ownerSlot.storyId,
        ownerBlockId: capsuleManifest.ownerSlot.blockId,
        childIndex: capsuleManifest.ownerSlot.childIndex,
        byteBoundaryStart: capsuleManifest.byteBoundaryStart,
        byteBoundaryEnd: capsuleManifest.byteBoundaryEnd,
        bytes: hexToBytes(capsuleManifest.bytesHex),
        namespaceBindings: { ...capsuleManifest.namespaceBindings },
        previousSiblingBytes: hexToBytes(capsuleManifest.previousSiblingBytesHex),
        nextSiblingBytes: hexToBytes(capsuleManifest.nextSiblingBytesHex),
      },
    ],
  };
  return freezeAuthoredPackage(authored);
}

export function createFrozenAuthoredFixture(revision = 0): DocumentModel {
  return createDocumentModel(createFrozenAuthoredPackage(), revision);
}

export function createDocumentModel(
  authored: AuthoredPackageModel | AuthoredPackageModelInput | unknown,
  revision: number
): DocumentModel {
  if (!Number.isInteger(revision) || revision < 0) {
    throw new TypeError('revision must be a non-negative integer');
  }
  const validation = snapshotAndValidateAuthoredPackage(authored);
  if (!validation.snapshot || validation.errors.length > 0) {
    throw new TypeError(validation.errors.join('; '));
  }
  const frozen = freezeAuthoredPackage(validation.snapshot);
  const model: DocumentModel = Object.freeze({
    authored: frozen,
    revision,
  });
  return model;
}
