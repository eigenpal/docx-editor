// Refuse an endpoint whose position moved after the endpoint was read.
//
// Offsets are raw UTF-16 positions in one paragraph. An edit before an offset moves it, so an
// endpoint read before that edit names different text afterwards. Written through, it edits
// whatever now sits at the old offset: the wrong words, silently.
//
// The host stamps every endpoint it answers with the revision it was read at (`readAt`), and
// records the text of the endpoint's paragraph at that revision. An endpoint at offset k read at
// an older revision is still valid while the paragraph's first k characters are unchanged: an
// edit after it, or a formatting edit anywhere, moves nothing. A span's end endpoint covers its
// content, so an edit inside the span makes it stale. A revision the history no longer holds
// cannot be checked, so it is stale too: the caller reads again, as any stale answer asks.

import type { AutomationHandleTable } from './handles.ts';
import type { AutomationPackageReads } from './reads.ts';
import { resolveParagraphHandle } from './spans.ts';

/** Revisions the host remembers for this check. Older endpoints must be read again. */
export const STALE_SPAN_HISTORY = 64;

/** Nesting a request or answer may use before the walk stops looking for endpoints. */
const MAX_DEPTH = 12;

interface StampedEndpoint {
  readonly paragraph: unknown;
  readonly offset: number;
  readonly readAt?: unknown;
}

function isPlain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isEndpoint(
  value: Record<string, unknown>
): value is Record<string, unknown> & StampedEndpoint {
  return 'paragraph' in value && typeof value.offset === 'number';
}

/**
 * The text of each answered endpoint's paragraph, by the revision it was answered at.
 *
 * Holds strings the reads already cached, for the most recent revisions only; the oldest
 * revision goes first.
 */
export function createReadTexts(limit = STALE_SPAN_HISTORY) {
  const byRevision = new Map<number, Map<string, string>>();
  return {
    record(revision: number, paragraphId: string, text: string): void {
      let texts = byRevision.get(revision);
      if (!texts) {
        texts = new Map();
        byRevision.set(revision, texts);
        while (byRevision.size > limit) byRevision.delete(byRevision.keys().next().value!);
      }
      texts.set(paragraphId, text);
    },
    at(revision: number, paragraphId: string): string | undefined {
      return byRevision.get(revision)?.get(paragraphId);
    },
  };
}

export type ReadTexts = ReturnType<typeof createReadTexts>;

function paragraphOf(
  endpoint: StampedEndpoint,
  handles: AutomationHandleTable,
  reads: AutomationPackageReads
) {
  const point = resolveParagraphHandle(
    endpoint.paragraph as Parameters<typeof resolveParagraphHandle>[0],
    handles,
    reads
  );
  if (!point.ok) return null;
  const text = reads.story(point.value.story)?.rawText(point.value.paragraphId);
  return text === null || text === undefined ? null : { id: point.value.paragraphId, text };
}

/**
 * The answer with every endpoint stamped `readAt: revision`, its paragraph text recorded.
 *
 * `reads` must be the package the answer describes. Only plain objects and arrays are rebuilt,
 * and only along paths that hold an endpoint, so byte arrays and opaque handles pass through.
 */
export function stampEndpoints<T>(
  value: T,
  revision: number,
  texts: ReadTexts,
  handles: AutomationHandleTable,
  reads: AutomationPackageReads,
  depth = 0
): T {
  if (depth > MAX_DEPTH) return value;
  if (Array.isArray(value)) {
    let changed = false;
    const mapped = value.map((item) => {
      const next = stampEndpoints(item, revision, texts, handles, reads, depth + 1);
      if (next !== item) changed = true;
      return next;
    });
    return (changed ? Object.freeze(mapped) : value) as T;
  }
  if (!isPlain(value)) return value;
  if (isEndpoint(value)) {
    const paragraph = paragraphOf(value, handles, reads);
    // An endpoint the host cannot place is not stamped: there is nothing to check it against.
    if (!paragraph) return value;
    texts.record(revision, paragraph.id, paragraph.text);
    return Object.freeze({ ...value, readAt: revision }) as T;
  }
  let copy: Record<string, unknown> | null = null;
  for (const [key, child] of Object.entries(value)) {
    const next = stampEndpoints(child, revision, texts, handles, reads, depth + 1);
    if (next === child) continue;
    copy ??= { ...value };
    copy[key] = next;
  }
  return (copy ? Object.freeze(copy) : value) as T;
}

function endpointsOf(value: unknown, into: StampedEndpoint[], depth = 0): void {
  if (depth > MAX_DEPTH) return;
  if (Array.isArray(value)) {
    for (const item of value) endpointsOf(item, into, depth + 1);
    return;
  }
  if (!isPlain(value)) return;
  if (isEndpoint(value)) {
    if (value.readAt !== undefined) into.push(value);
    return;
  }
  for (const child of Object.values(value)) endpointsOf(child, into, depth + 1);
}

/**
 * Why this operation addresses text that moved since it was read, or null when it does not.
 *
 * An endpoint whose handle does not resolve is left to the planner, which reports it as the
 * invalid handle it is.
 */
export function staleEndpointDetail(
  operation: unknown,
  revision: number,
  texts: ReadTexts,
  handles: AutomationHandleTable,
  reads: AutomationPackageReads
): string | null {
  const endpoints: StampedEndpoint[] = [];
  endpointsOf(operation, endpoints);
  for (const endpoint of endpoints) {
    if (endpoint.readAt === revision) continue;
    if (typeof endpoint.readAt !== 'number' || !Number.isSafeInteger(endpoint.readAt))
      return 'invalid-read-revision';
    const paragraph = paragraphOf(endpoint, handles, reads);
    if (!paragraph) continue;
    const before = texts.at(endpoint.readAt, paragraph.id);
    if (before === undefined) return `read-at ${String(endpoint.readAt)} is no longer checkable`;
    const now = paragraph.text;
    const k = endpoint.offset;
    if (before.length < k || now.length < k || before.slice(0, k) !== now.slice(0, k))
      return `text before offset ${String(k)} changed since revision ${String(endpoint.readAt)}`;
  }
  return null;
}
