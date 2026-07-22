/** @spike-features one-body-story, paragraphs, text, bold-mark, italic-mark, stable-paragraph-ids, one-preservation-capsule, synthetic-128-paragraph-fixture */
import manifest from '../../oracles/manifest.v1.json';
import {
  isUnsafeAuthoredPropertyName,
  isValidAuthoredProperty,
  rejectsResolvedOrCacheAuthoredPropertyName,
} from './authored-property';
import { isRegisteredCanonicalAuthoredBody, validateBlockIdIndex } from './block-id-index';
import { readClosedDataObject, snapshotAuthoredPackage } from './immutability';
import type { AuthoredBodyStory, AuthoredPackageModel, AuthoredPackageModelInput, DocumentModel } from './types';

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9-]{0,127}$/;
const STRUCTURAL_ERROR = 'unknown or derived authored field';
const CAPSULE_ERROR = 'frozen capsule evidence mismatch';

export interface AuthoredValidationSnapshot {
  readonly snapshot: AuthoredPackageModelInput | null;
  readonly errors: readonly string[];
}

export function snapshotAndValidateAuthoredPackage(input: unknown): AuthoredValidationSnapshot {
  try {
    const snapshot = snapshotAuthoredPackage(input);
    return { snapshot, errors: validateTrustedAuthoredPackage(snapshot) };
  } catch (error) {
    return {
      snapshot: null,
      errors: [normalizeSnapshotError(error)],
    };
  }
}

export function validateAuthoredPackage(input: AuthoredPackageModel | unknown): string[] {
  return [...snapshotAndValidateAuthoredPackage(input).errors];
}

function validateTrustedAuthoredPackage(authored: AuthoredPackageModelInput): string[] {
  const errors: string[] = [];
  if (!isPlainRecord(authored)) return ['authored package must be a plain object'];
  if (!hasExactKeys(authored, ['body', 'capsules'])) errors.push(STRUCTURAL_ERROR);
  const body = authored.body;
  const capsules = authored.capsules;
  if (!isPlainRecord(body)) return [...errors, 'invalid body story'];
  const bodyKeys = Object.keys(body).sort();
  const inputBodyKeys = ['paragraphOrder', 'paragraphs', 'storyId'];
  if (!sameStringKeys(bodyKeys, inputBodyKeys)) {
    errors.push(STRUCTURAL_ERROR);
  }
  if (body.storyId !== manifest.fixture.storyId) errors.push('invalid body story');
  if (!Array.isArray(body.paragraphOrder) || !isLookup(body.paragraphs)) {
    return [...errors, 'invalid body story'];
  }

  const allIds = new Set<string>();
  const blockIds = new Set<string>();
  const registerId = (id: unknown): boolean => {
    if (typeof id !== 'string' || !ID_PATTERN.test(id) || allIds.has(id)) return false;
    allIds.add(id);
    return true;
  };
  if (
    body.paragraphOrder.some((id) => typeof id !== 'string' || !ID_PATTERN.test(id)) ||
    body.paragraphOrder.length !== body.paragraphs.size
  ) {
    errors.push('paragraph order must reference every paragraph exactly once');
  }

  for (const paragraphId of body.paragraphOrder) {
    if (typeof paragraphId !== 'string') continue;
    const paragraph = body.paragraphs.get(paragraphId);
    if (!isPlainRecord(paragraph)) {
      errors.push('paragraph order references missing paragraph');
      continue;
    }
    if (
      !hasExactKeys(paragraph, [
        'blockId',
        'paragraphId',
        'text',
        'styleId',
        'marks',
        'authoredProperties',
      ])
    ) {
      errors.push(STRUCTURAL_ERROR);
    }
    if (
      !registerId(paragraph.blockId) ||
      !registerId(paragraph.paragraphId) ||
      paragraph.paragraphId !== paragraphId
    ) {
      errors.push('duplicate paragraph ID');
    }
    if (typeof paragraph.blockId === 'string') blockIds.add(paragraph.blockId);
    if (typeof paragraph.text !== 'string') {
      errors.push('paragraph text must be a string');
    } else if (!isWellFormedUtf16(paragraph.text)) {
      errors.push('paragraph text must be well-formed UTF-16');
    }
    if (typeof paragraph.styleId !== 'string' || !ID_PATTERN.test(paragraph.styleId)) {
      errors.push('invalid paragraph style ID');
    }
    if (!Array.isArray(paragraph.marks)) {
      errors.push('invalid marks collection');
    } else {
      for (const mark of paragraph.marks) {
        if (!isPlainRecord(mark) || !hasExactKeys(mark, ['markId', 'kind', 'start', 'end'])) {
          errors.push(STRUCTURAL_ERROR);
        }
        if (
          !isPlainRecord(mark) ||
          !registerId(mark.markId) ||
          !['bold', 'italic'].includes(mark.kind as string) ||
          !Number.isInteger(mark.start) ||
          !Number.isInteger(mark.end) ||
          (mark.start as number) < 0 ||
          (mark.end as number) <= (mark.start as number) ||
          typeof paragraph.text !== 'string' ||
          (mark.end as number) > paragraph.text.length
        ) {
          errors.push('invalid mark');
        }
      }
    }
    if (!isPlainOrNullRecord(paragraph.authoredProperties)) {
      errors.push('invalid authored properties');
    } else {
      for (const [propertyName, property] of Object.entries(paragraph.authoredProperties)) {
        if (isUnsafeAuthoredPropertyName(propertyName)) {
          errors.push('unsafe authored property key');
        }
        if (propertyName.length === 0 || !isValidAuthoredProperty(property)) {
          errors.push('invalid authored property variant');
        }
        if (rejectsResolvedOrCacheAuthoredPropertyName(propertyName)) {
          errors.push('resolved or cache value in authored state');
        }
      }
    }
  }

  if (errors.length === 0 && isRegisteredCanonicalAuthoredBody(body as AuthoredBodyStory)) {
    errors.push(...validateBlockIdIndex(body as AuthoredBodyStory));
  }

  if (!Array.isArray(capsules) || capsules.length !== 1) {
    errors.push('exactly one frozen capsule is required');
    return errors;
  }
  const capsule = capsules[0];
  if (
    !isPlainRecord(capsule) ||
    !hasExactKeys(capsule, [
      'capsuleId',
      'ownerStoryId',
      'ownerBlockId',
      'childIndex',
      'byteBoundaryStart',
      'byteBoundaryEnd',
      'bytes',
      'namespaceBindings',
      'previousSiblingBytes',
      'nextSiblingBytes',
    ])
  ) {
    errors.push(STRUCTURAL_ERROR);
  }
  if (
    !isPlainRecord(capsule) ||
    capsule.capsuleId !== 'capsule-spike-unsupported-0' ||
    capsule.ownerStoryId !== manifest.unsupportedCapsule.ownerSlot.storyId ||
    capsule.ownerBlockId !== manifest.unsupportedCapsule.ownerSlot.blockId ||
    !blockIds.has(manifest.unsupportedCapsule.ownerSlot.blockId) ||
    capsule.childIndex !== manifest.unsupportedCapsule.ownerSlot.childIndex ||
    capsule.byteBoundaryStart !== manifest.unsupportedCapsule.byteBoundaryStart ||
    capsule.byteBoundaryEnd !== manifest.unsupportedCapsule.byteBoundaryEnd ||
    !bytesEqualHex(capsule.bytes, manifest.unsupportedCapsule.bytesHex) ||
    !exactStringRecord(capsule.namespaceBindings, manifest.unsupportedCapsule.namespaceBindings) ||
    !bytesEqualHex(
      capsule.previousSiblingBytes,
      manifest.unsupportedCapsule.previousSiblingBytesHex
    ) ||
    !bytesEqualHex(capsule.nextSiblingBytes, manifest.unsupportedCapsule.nextSiblingBytesHex)
  ) {
    errors.push(CAPSULE_ERROR);
  }
  return errors;
}

export function validateDocumentModel(model: DocumentModel | unknown): string[] {
  let input: Record<string, unknown>;
  try {
    input = readClosedDataObject(model, ['authored', 'revision'], 'document model');
  } catch (error) {
    return [normalizeSnapshotError(error)];
  }
  const errors = [...snapshotAndValidateAuthoredPackage(input.authored).errors];
  if (!Number.isInteger(input.revision) || (input.revision as number) < 0) {
    errors.push('invalid revision');
  }
  return errors;
}

function normalizeSnapshotError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'invalid authored input';
  return /^invalid .+ fields$/.test(message) ? STRUCTURAL_ERROR : message;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isPlainOrNullRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isLookup(value: unknown): value is {
  readonly size: number;
  get(key: string): unknown;
  [Symbol.iterator](): Iterator<readonly [string, unknown]>;
} {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { get?: unknown }).get === 'function' &&
    typeof (value as { size?: unknown }).size === 'number' &&
    typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function'
  );
}

function sameStringKeys(actual: readonly string[], expected: readonly string[]): boolean {
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  return (
    sortedActual.length === sortedExpected.length &&
    sortedActual.every((key, index) => key === sortedExpected[index])
  );
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function bytesEqualHex(value: unknown, expectedHex: string): boolean {
  return value instanceof Uint8Array && Buffer.from(value).toString('hex') === expectedHex;
}

function exactStringRecord(value: unknown, expected: Readonly<Record<string, string>>): boolean {
  if (!isPlainRecord(value) || !hasExactKeys(value, Object.keys(expected))) return false;
  return Object.entries(expected).every(([key, expectedValue]) => value[key] === expectedValue);
}

function isWellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}
