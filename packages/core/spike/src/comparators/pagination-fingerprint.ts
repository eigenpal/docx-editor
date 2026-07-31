/** @spike-features fixture-comparators, minimal-canonical-layout */
import { computePaginationHash } from '../oracle-hash';
import { canonicalJson } from '../canonical-json';

export interface PaginationFingerprintInput {
  readonly restartParagraphIndex: number;
  readonly passes: number;
  readonly pages: readonly {
    readonly pageIndex: number;
    readonly paragraphIds: readonly string[];
    readonly usedHeightFixed: number;
    readonly nextFlowId: string | null;
  }[];
}

export interface ExpectedPaginationFingerprint {
  readonly canonicalBytesHex: string;
  readonly expectedHash: string;
}

export function canonicalizePagination(input: PaginationFingerprintInput): Uint8Array {
  if (
    !Number.isInteger(input.restartParagraphIndex) ||
    input.restartParagraphIndex < 0 ||
    !Number.isInteger(input.passes) ||
    input.passes < 1
  ) {
    throw new TypeError('pagination restart and passes must be positive integers');
  }
  let previousPageIndex = -1;
  const seenParagraphs = new Set<string>();
  for (const page of input.pages) {
    if (
      !Number.isInteger(page.pageIndex) ||
      page.pageIndex < 0 ||
      !Number.isInteger(page.usedHeightFixed) ||
      page.usedHeightFixed < 0
    ) {
      throw new TypeError('page index and used height must be nonnegative integers');
    }
    if (page.pageIndex <= previousPageIndex) throw new TypeError('page indices must increase');
    previousPageIndex = page.pageIndex;
    if (
      page.paragraphIds.length === 0 ||
      page.paragraphIds.some((id) => id.length === 0 || seenParagraphs.has(id)) ||
      (page.nextFlowId !== null && page.nextFlowId.length === 0)
    ) {
      throw new TypeError('pagination flow IDs must be non-empty and ordered once');
    }
    page.paragraphIds.forEach((id) => seenParagraphs.add(id));
  }
  return new TextEncoder().encode(canonicalJson(input));
}

export function comparePaginationFingerprint(
  input: PaginationFingerprintInput,
  expected: ExpectedPaginationFingerprint
): {
  equal: boolean;
  actualHash: string;
  actualBytesHex: string;
} {
  const bytes = canonicalizePagination(input);
  const actualBytesHex = bytesToHex(bytes);
  const actualHash = computePaginationHash(new TextDecoder().decode(bytes));
  return {
    equal: actualHash === expected.expectedHash && actualBytesHex === expected.canonicalBytesHex,
    actualHash,
    actualBytesHex,
  };
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const PAGINATION_FINGERPRINT_COMPARATOR_VERSION = '4.0.0';
