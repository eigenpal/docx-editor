/** @spike-features one-body-story, paragraphs, stable-paragraph-ids, synthetic-128-paragraph-fixture */
import { recordAuthoredBlockIdLookupWorkForTests } from './internal/block-id-index-instrumentation';
import { createImmutableLookup } from './immutability';
import type { AuthoredBodyStory, AuthoredParagraph, ImmutableLookup } from './types';

const TRUSTED_CANONICAL_BODIES = new WeakSet<AuthoredBodyStory>();
const BLOCK_ID_INDEX_BY_BODY = new WeakMap<AuthoredBodyStory, ImmutableLookup<string, string>>();

export function isRegisteredCanonicalAuthoredBody(body: AuthoredBodyStory): boolean {
  return TRUSTED_CANONICAL_BODIES.has(body);
}

export function buildBlockIdIndex(
  paragraphOrder: readonly string[],
  paragraphs: ImmutableLookup<string, AuthoredParagraph>
): ImmutableLookup<string, string> {
  const entries: Array<readonly [string, string]> = [];
  const seenBlockIds = new Set<string>();
  for (const paragraphId of paragraphOrder) {
    const paragraph = paragraphs.get(paragraphId);
    if (!paragraph) throw new TypeError('paragraph order references missing paragraph');
    if (seenBlockIds.has(paragraph.blockId)) {
      throw new TypeError('duplicate block ID in block index');
    }
    seenBlockIds.add(paragraph.blockId);
    entries.push([paragraph.blockId, paragraphId]);
  }
  return createImmutableLookup(entries);
}

export function registerCanonicalBodyIndex(
  body: AuthoredBodyStory,
  index: ImmutableLookup<string, string>
): void {
  TRUSTED_CANONICAL_BODIES.add(body);
  BLOCK_ID_INDEX_BY_BODY.set(body, index);
}

export function resolveAuthoredParagraphByBlockId(
  body: AuthoredBodyStory,
  blockId: string
): AuthoredParagraph | undefined {
  if (!TRUSTED_CANONICAL_BODIES.has(body)) return undefined;
  const blockIdIndex = BLOCK_ID_INDEX_BY_BODY.get(body);
  if (!blockIdIndex) return undefined;
  const paragraphId = blockIdIndex.get(blockId);
  if (paragraphId === undefined) return undefined;
  recordAuthoredBlockIdLookupWorkForTests();
  return body.paragraphs.get(paragraphId);
}

export function validateBlockIdIndex(body: AuthoredBodyStory): string[] {
  const errors: string[] = [];
  if (!TRUSTED_CANONICAL_BODIES.has(body)) {
    errors.push('block ID index requires canonical registered body');
    return errors;
  }
  const blockIdIndex = BLOCK_ID_INDEX_BY_BODY.get(body);
  if (!blockIdIndex) {
    errors.push('missing derived block ID index');
    return errors;
  }
  if (blockIdIndex.size !== body.paragraphOrder.length) {
    errors.push('block ID index size must match paragraph count');
  }
  for (const paragraphId of body.paragraphOrder) {
    const paragraph = body.paragraphs.get(paragraphId);
    if (!paragraph) continue;
    if (blockIdIndex.get(paragraph.blockId) !== paragraphId) {
      errors.push('block ID index entry mismatch');
    }
  }
  return errors;
}
