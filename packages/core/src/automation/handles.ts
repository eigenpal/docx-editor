// Handle minting and resolution.
//
// INTERNAL. A handle is a name this table invented, mapped privately to the engine identity
// it stands for. Consumers get the name; nothing else ever leaves.
//
// Two properties matter and both are easy to lose:
//
// STABLE — the same document object asked for twice yields the same ref, so an object model
// can hold a reference across batches and compare two references for identity. A table that
// minted per read would make every held reference a distinct object naming the same thing.
//
// HOST-SCOPED — every ref carries a token drawn from the platform CSPRNG when the table is
// created. Without it, refs were numbered per host and every host's first paragraph was
// `paragraph:1`: two hosts open on two different documents accepted each other's refs and
// resolved them against their own tree, so a ref legitimately obtained from one document named
// a paragraph in another. An opaque name that collides is not opaque. The token makes a ref
// neither transplantable nor guessable, which is what an object model behind a transport needs.
//
// The ORDINAL half is still allocated in first-seen order per kind, so two hosts asked the same
// questions in the same order agree about everything except the token — which is what lets the
// differential tests compare two hosts' responses whole, normalizing only the token.
//
// Lookup is by Map, never by object key: a forged ref is untrusted input, and `__proto__` as
// a property name on a plain object is the prototype-pollution hazard this avoids by
// construction.

import type { AutomationHandle, AutomationHandleRef, AutomationObjectKind } from './protocol.ts';

/**
 * 128 bits of hex from the platform CSPRNG.
 *
 * `globalThis.crypto.getRandomValues` and nothing else: it is the one random source that exists
 * in a browser, in Bun and in Node without importing anything, which is what a lane compiled
 * without the DOM lib and without Node builtins can reach. Read through a narrow structural
 * type for the same reason — the typed global differs between those environments.
 *
 * FAILS CLOSED. A runtime without it throws here rather than falling back to a counter or a
 * clock: a guessable token restores the collision this exists to prevent while every test that
 * checks refs are distinct keeps passing, so the fallback would be invisible.
 */
function hostToken(): string {
  const source = (globalThis as { crypto?: { getRandomValues?: unknown } }).crypto;
  const fill = source?.getRandomValues;
  if (typeof fill !== 'function') {
    throw new Error(
      'automation: no secure random source. globalThis.crypto.getRandomValues is required to ' +
        'scope document handles to one host.'
    );
  }
  const bytes = (fill as (array: Uint8Array) => Uint8Array).call(source, new Uint8Array(16));
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

export type AutomationHandleTarget =
  | { readonly kind: 'document' }
  | { readonly kind: 'body' }
  | { readonly kind: 'paragraph'; readonly paragraphId: string };

export interface AutomationHandleTable {
  /** The document handle. One per host, minted on first ask. */
  document(): AutomationHandle<'document'>;
  /** The body handle. One per host — this protocol slice addresses the main story only. */
  body(): AutomationHandle<'body'>;
  /** The handle for a canonical paragraph id, minted once and reused thereafter. */
  paragraph(paragraphId: string): AutomationHandle<'paragraph'>;
  /**
   * Point an already-issued paragraph handle at a different canonical id.
   *
   * For the one structural case where a paragraph's CONTENT moves to a new node while the old
   * node keeps the id: inserting a paragraph before another one is a text insert plus a split,
   * and the split leaves the head — the new paragraph — on the original node. Without this, a
   * consumer's reference to the paragraph it inserted before would silently name the paragraph
   * it just created. Nothing else in the lane may call this: an identity that can be re-aimed
   * for convenience is not an identity.
   */
  retarget(fromParagraphId: string, toParagraphId: string): void;
  /**
   * What a handle names, or null when this table never minted it or the caller's declared
   * kind disagrees with what was minted. Both are `invalid-handle` to the protocol: a ref
   * whose kind can be talked into something else is not opaque.
   */
  resolve(handle: unknown, expected: AutomationObjectKind): AutomationHandleTarget | null;
}

function isHandleShaped(value: unknown): value is { kind: unknown; ref: unknown } {
  return typeof value === 'object' && value !== null && 'kind' in value && 'ref' in value;
}

export function createHandleTable(): AutomationHandleTable {
  const targets = new Map<string, AutomationHandleTarget>();
  const refByParagraph = new Map<string, AutomationHandleRef>();
  const counters = new Map<AutomationObjectKind, number>();
  // Minted eagerly, so a host that cannot scope its handles never comes into existence at all.
  const token = hostToken();
  let documentHandle: AutomationHandle<'document'> | null = null;
  let bodyHandle: AutomationHandle<'body'> | null = null;

  const mint = <K extends AutomationObjectKind>(
    kind: K,
    target: AutomationHandleTarget
  ): AutomationHandle<K> => {
    const next = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, next);
    const ref = `${kind}:${token}:${next}` as AutomationHandleRef;
    targets.set(ref, target);
    return Object.freeze({ kind, ref });
  };

  return {
    document() {
      documentHandle ??= mint('document', { kind: 'document' });
      return documentHandle;
    },
    body() {
      bodyHandle ??= mint('body', { kind: 'body' });
      return bodyHandle;
    },
    paragraph(paragraphId) {
      const existing = refByParagraph.get(paragraphId);
      if (existing) return Object.freeze({ kind: 'paragraph' as const, ref: existing });
      const handle = mint('paragraph', { kind: 'paragraph', paragraphId });
      refByParagraph.set(paragraphId, handle.ref);
      return handle;
    },
    retarget(fromParagraphId, toParagraphId) {
      const ref = refByParagraph.get(fromParagraphId);
      // Nobody ever asked for this paragraph, so no reference can be pointing at the wrong one.
      if (!ref || fromParagraphId === toParagraphId) return;
      refByParagraph.delete(fromParagraphId);
      targets.set(ref, { kind: 'paragraph', paragraphId: toParagraphId });
      // The destination is a node this transaction created, so it cannot already have a ref;
      // guarded anyway, because two refs naming one paragraph would break handle identity.
      if (!refByParagraph.has(toParagraphId)) refByParagraph.set(toParagraphId, ref);
    },
    resolve(handle, expected) {
      if (!isHandleShaped(handle)) return null;
      if (handle.kind !== expected || typeof handle.ref !== 'string') return null;
      const target = targets.get(handle.ref);
      if (!target || target.kind !== expected) return null;
      return target;
    },
  };
}
