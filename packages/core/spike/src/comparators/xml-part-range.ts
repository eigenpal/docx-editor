/** @spike-features fixture-comparators, one-preservation-capsule */
export interface XmlPartRangeDiff {
  readonly ownedRangeStart: number;
  readonly ownedRangeEnd: number;
  readonly diffsOutsideOwned: readonly { offset: number; expected: number; actual: number }[];
}

export interface XmlOwnershipEvidence {
  readonly capsuleBytes: Uint8Array;
  readonly namespaceBindings: Readonly<Record<string, string>>;
  readonly ownerSlot: {
    readonly storyId: string;
    readonly blockId: string;
    readonly childIndex: number;
  };
  readonly previousSiblingBytes: Uint8Array;
  readonly nextSiblingBytes: Uint8Array;
}

/**
 * Limits differences to an owned uncompressed XML-part byte range.
 * Any byte change requires complete before/after ownership evidence. Byte-identical
 * inputs may omit evidence because no owned patch is being authorized.
 */
export function compareXmlPartRange(
  before: Uint8Array,
  after: Uint8Array,
  ownedRangeStart: number,
  ownedRangeEnd: number,
  evidence?: { readonly before: XmlOwnershipEvidence; readonly after: XmlOwnershipEvidence }
): { equal: boolean; diff?: XmlPartRangeDiff } {
  if (
    !Number.isInteger(ownedRangeStart) ||
    !Number.isInteger(ownedRangeEnd) ||
    ownedRangeStart < 0 ||
    ownedRangeEnd < ownedRangeStart ||
    ownedRangeEnd > before.length
  ) {
    return {
      equal: false,
      diff: {
        ownedRangeStart,
        ownedRangeEnd,
        diffsOutsideOwned: [{ offset: -1, expected: 0, actual: 1 }],
      },
    };
  }
  const prefix = before.slice(0, ownedRangeStart);
  const suffix = before.slice(ownedRangeEnd);
  const outside: XmlPartRangeDiff['diffsOutsideOwned'][number][] = compareBytes(
    prefix,
    after.slice(0, ownedRangeStart),
    0
  );
  const afterSuffixStart = after.length - suffix.length;
  if (afterSuffixStart < ownedRangeStart) {
    outside.push({ offset: -1, expected: suffix.length, actual: after.length - ownedRangeStart });
  } else {
    outside.push(...compareBytes(suffix, after.slice(afterSuffixStart), ownedRangeEnd));
  }
  const changed = compareBytes(before, after, 0).length > 0;
  if (changed && !evidence) {
    outside.push({ offset: -2, expected: 1, actual: 0 });
  } else if (
    evidence &&
    (!validOwnershipEvidence(evidence.before) ||
      !validOwnershipEvidence(evidence.after) ||
      !ownershipEvidenceEqual(evidence.before, evidence.after))
  ) {
    outside.push({ offset: -2, expected: 0, actual: 1 });
  }
  return outside.length === 0
    ? { equal: true }
    : { equal: false, diff: { ownedRangeStart, ownedRangeEnd, diffsOutsideOwned: outside } };
}

function compareBytes(
  expected: Uint8Array,
  actual: Uint8Array,
  offset: number
): { offset: number; expected: number; actual: number }[] {
  const diffs: { offset: number; expected: number; actual: number }[] = [];
  const length = Math.max(expected.length, actual.length);
  for (let i = 0; i < length; i++) {
    if (expected[i] !== actual[i]) {
      diffs.push({ offset: offset + i, expected: expected[i] ?? -1, actual: actual[i] ?? -1 });
    }
  }
  return diffs;
}

function ownershipEvidenceEqual(a: XmlOwnershipEvidence, b: XmlOwnershipEvidence): boolean {
  return (
    compareBytes(a.capsuleBytes, b.capsuleBytes, 0).length === 0 &&
    JSON.stringify(a.namespaceBindings) === JSON.stringify(b.namespaceBindings) &&
    JSON.stringify(a.ownerSlot) === JSON.stringify(b.ownerSlot) &&
    compareBytes(a.previousSiblingBytes, b.previousSiblingBytes, 0).length === 0 &&
    compareBytes(a.nextSiblingBytes, b.nextSiblingBytes, 0).length === 0
  );
}

function validOwnershipEvidence(value: XmlOwnershipEvidence): boolean {
  return (
    value !== null &&
    value.capsuleBytes instanceof Uint8Array &&
    value.capsuleBytes.length > 0 &&
    value.previousSiblingBytes instanceof Uint8Array &&
    value.nextSiblingBytes instanceof Uint8Array &&
    Object.getPrototypeOf(value.namespaceBindings) === Object.prototype &&
    Object.keys(value.namespaceBindings).every(
      (prefix) => prefix.length > 0 && value.namespaceBindings[prefix]!.length > 0
    ) &&
    typeof value.ownerSlot?.storyId === 'string' &&
    value.ownerSlot.storyId.length > 0 &&
    typeof value.ownerSlot.blockId === 'string' &&
    value.ownerSlot.blockId.length > 0 &&
    Number.isInteger(value.ownerSlot.childIndex) &&
    value.ownerSlot.childIndex >= 0
  );
}

export const XML_PART_RANGE_COMPARATOR_VERSION = '3.0.0';
