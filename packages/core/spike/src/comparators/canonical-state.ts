/** @spike-features fixture-comparators */
import { sha256Hex } from '../oracle-hash';
import { canonicalJson } from '../canonical-json';

export interface CanonicalStateFingerprint {
  readonly revision: number;
  readonly paragraphs: readonly {
    readonly blockId: string;
    readonly paragraphId: string;
    readonly text: string;
    readonly styleId: string;
    readonly marks: readonly {
      readonly markId: string;
      readonly kind: 'bold' | 'italic';
      readonly start: number;
      readonly end: number;
    }[];
    readonly authoredProperties: Readonly<
      Record<
        string,
        | { readonly state: 'omitted' }
        | { readonly state: 'raw'; readonly rawLexical: string }
        | { readonly state: 'value'; readonly value: string | number | boolean }
      >
    >;
  }[];
  readonly capsules: readonly {
    readonly capsuleId: string;
    readonly ownerBlockId: string;
    readonly childIndex: number;
    readonly bytesHex: string;
    readonly namespaceBindings: Readonly<Record<string, string>>;
    readonly previousSiblingBytesHex: string;
    readonly nextSiblingBytesHex: string;
  }[];
  readonly anchors: readonly {
    readonly anchorId: string;
    readonly startEnvelope: string;
    readonly endEnvelope: string;
    readonly detached: boolean;
  }[];
  readonly resultData: unknown;
}

export function validateCanonicalState(state: CanonicalStateFingerprint): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(state.revision) || state.revision < 0) errors.push('invalid revision');
  const paragraphIds = new Set<string>();
  const blockIds = new Set<string>();
  const allIds = new Set<string>();
  const markIds = new Set<string>();
  const capsuleIds = new Set<string>();
  const anchorIds = new Set<string>();
  const capsuleSlots = new Set<string>();
  const registerId = (id: string): boolean => {
    if (id.length === 0 || allIds.has(id)) return false;
    allIds.add(id);
    return true;
  };
  for (const paragraph of state.paragraphs) {
    if (
      !registerId(paragraph.blockId) ||
      blockIds.has(paragraph.blockId) ||
      !registerId(paragraph.paragraphId) ||
      paragraphIds.has(paragraph.paragraphId)
    ) {
      errors.push('invalid or duplicate paragraph ID');
    }
    if (paragraph.styleId.length === 0) errors.push('paragraph style ID must be nonempty');
    blockIds.add(paragraph.blockId);
    paragraphIds.add(paragraph.paragraphId);
    for (const mark of paragraph.marks) {
      if (
        !registerId(mark.markId) ||
        markIds.has(mark.markId) ||
        !['bold', 'italic'].includes(mark.kind) ||
        !Number.isInteger(mark.start) ||
        !Number.isInteger(mark.end) ||
        mark.start < 0 ||
        mark.end <= mark.start ||
        mark.end > paragraph.text.length
      ) {
        errors.push('invalid mark');
      }
      markIds.add(mark.markId);
    }
    if (Object.getPrototypeOf(paragraph.authoredProperties) !== Object.prototype) {
      errors.push('authored properties must be a plain object');
    }
    for (const [propertyName, property] of Object.entries(paragraph.authoredProperties)) {
      if (propertyName.length === 0 || !isValidAuthoredProperty(property)) {
        errors.push('invalid authored property variant');
      }
    }
  }
  for (const capsule of state.capsules) {
    const slot = `${capsule.ownerBlockId}:${capsule.childIndex}`;
    if (
      !registerId(capsule.capsuleId) ||
      capsuleIds.has(capsule.capsuleId) ||
      !blockIds.has(capsule.ownerBlockId) ||
      !Number.isInteger(capsule.childIndex) ||
      capsule.childIndex < 0 ||
      capsuleSlots.has(slot) ||
      !isNonemptyEvenHex(capsule.bytesHex) ||
      !isNonemptyEvenHex(capsule.previousSiblingBytesHex) ||
      !isNonemptyEvenHex(capsule.nextSiblingBytesHex) ||
      Object.getPrototypeOf(capsule.namespaceBindings) !== Object.prototype ||
      Object.entries(capsule.namespaceBindings).some(
        ([prefix, namespace]) =>
          prefix.length === 0 || typeof namespace !== 'string' || namespace.length === 0
      )
    ) {
      errors.push('invalid capsule ownership or bytes');
    }
    capsuleIds.add(capsule.capsuleId);
    capsuleSlots.add(slot);
  }
  for (const anchor of state.anchors) {
    if (
      !registerId(anchor.anchorId) ||
      anchorIds.has(anchor.anchorId) ||
      typeof anchor.startEnvelope !== 'string' ||
      anchor.startEnvelope.length === 0 ||
      typeof anchor.endEnvelope !== 'string' ||
      anchor.endEnvelope.length === 0 ||
      typeof anchor.detached !== 'boolean'
    ) {
      errors.push('invalid anchor');
    }
    anchorIds.add(anchor.anchorId);
  }
  try {
    canonicalJson(state);
  } catch (error) {
    errors.push(`invalid canonical state data: ${(error as Error).message}`);
  }
  return errors;
}

function isNonemptyEvenHex(value: string): boolean {
  return /^(?:[0-9a-f]{2})+$/i.test(value);
}

function isValidAuthoredProperty(value: unknown): boolean {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  const property = value as Record<string, unknown>;
  if (property.state === 'omitted') return hasExactKeys(property, ['state']);
  if (property.state === 'raw') {
    return (
      hasExactKeys(property, ['state', 'rawLexical']) &&
      typeof property.rawLexical === 'string' &&
      /^-?[0-9]{1,32}$/.test(property.rawLexical)
    );
  }
  if (property.state === 'value') {
    if (!hasExactKeys(property, ['state', 'value'])) return false;
    return (
      typeof property.value === 'boolean' ||
      (typeof property.value === 'string' && property.value.length > 0) ||
      (typeof property.value === 'number' && Number.isSafeInteger(property.value))
    );
  }
  return false;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

export function fingerprintCanonicalState(state: CanonicalStateFingerprint): string {
  const errors = validateCanonicalState(state);
  if (errors.length > 0) throw new TypeError(errors.join('; '));
  return sha256Hex(canonicalJson(state));
}

export function compareCanonicalState(
  a: CanonicalStateFingerprint,
  b: CanonicalStateFingerprint
): { equal: boolean; aHash: string | null; bHash: string | null; errors: readonly string[] } {
  const errors = [...validateCanonicalState(a), ...validateCanonicalState(b)];
  const aHash = errors.length === 0 ? fingerprintCanonicalState(a) : null;
  const bHash = errors.length === 0 ? fingerprintCanonicalState(b) : null;
  return { equal: errors.length === 0 && aHash === bHash, aHash, bHash, errors };
}

export const CANONICAL_STATE_COMPARATOR_VERSION = '5.0.0';
