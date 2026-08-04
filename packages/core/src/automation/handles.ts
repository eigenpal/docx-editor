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
// DETERMINISTIC — refs are allocated in first-seen order per kind, so two hosts opened on the
// same bytes and asked the same questions mint the same names. That is what lets a
// differential test compare two hosts' responses whole, rather than comparing everything
// except the identifiers, which is where a real divergence would hide.
//
// Lookup is by Map, never by object key: a forged ref is untrusted input, and `__proto__` as
// a property name on a plain object is the prototype-pollution hazard this avoids by
// construction.

import type { AutomationHandle, AutomationHandleRef, AutomationObjectKind } from './protocol.ts';

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
  let documentHandle: AutomationHandle<'document'> | null = null;
  let bodyHandle: AutomationHandle<'body'> | null = null;

  const mint = <K extends AutomationObjectKind>(
    kind: K,
    target: AutomationHandleTarget
  ): AutomationHandle<K> => {
    const next = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, next);
    const ref = `${kind}:${next}` as AutomationHandleRef;
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
    resolve(handle, expected) {
      if (!isHandleShaped(handle)) return null;
      if (handle.kind !== expected || typeof handle.ref !== 'string') return null;
      const target = targets.get(handle.ref);
      if (!target || target.kind !== expected) return null;
      return target;
    },
  };
}
