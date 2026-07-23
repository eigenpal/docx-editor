// The DocxEditor.* public object model (document-engine section 7 / design D8).
// The ONLY public high-level API namespace: familiar Office JavaScript-style
// `run`/`RequestContext`/`load`/`sync` semantics as a lazy facade over the
// authored model. Proxies queue writes; `sync()` applies them atomically as one
// store batch and returns a typed Result. Tracked proxies are valid only while
// their run is open. No ProseMirror, DOM, or backend type crosses this surface.

import {
  DocumentStore,
  type DocOp,
} from '../store/index.ts';
import { createEmptyModel, bodyStoryId, paragraphText, type ParagraphRecord } from '../model/index.ts';
import { ORIGIN_IDS } from '../registry/frozen-ids.ts';
import { ok, type Result } from './result.ts';

const HUMAN = ORIGIN_IDS.mutationHuman;

/** Owns a document/store; the unit callers open contexts over. */
export class DocumentHandle {
  private closed = false;

  /** @internal */
  constructor(private readonly store: DocumentStore) {}

  get revision(): number {
    return this.store.currentRevision;
  }

  /** @internal engine access; not part of the public object model. */
  get internalStore(): DocumentStore {
    this.assertOpen();
    return this.store;
  }

  close(): void {
    this.closed = true;
  }
  dispose(): void {
    this.close();
  }
  get isClosed(): boolean {
    return this.closed;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('DocumentHandle is closed');
  }
}

/** Create an empty authored document. */
export function create(): DocumentHandle {
  return new DocumentHandle(new DocumentStore(createEmptyModel()));
}

interface PendingParagraph {
  readonly symbolicId: string;
  readonly proxy: ParagraphProxy;
}

/** Batched request context (Office JS `RequestContext`). */
export class RequestContext {
  private queued: DocOp[] = [];
  private symbolCounter = 0;
  private readonly pending: PendingParagraph[] = [];
  private valid = true;
  readonly document: DocumentProxy;

  /** @internal */
  constructor(private readonly store: DocumentStore) {
    this.document = new DocumentProxy(this, store);
  }

  /** @internal */
  queue(op: DocOp): void {
    this.assertValid();
    this.queued.push(op);
  }

  /** @internal allocate a transaction-local symbolic id for a created paragraph. */
  newSymbol(proxy: ParagraphProxy): string {
    this.symbolCounter += 1;
    const symbolicId = `$p${this.symbolCounter}`;
    this.pending.push({ symbolicId, proxy });
    return symbolicId;
  }

  /** Atomically apply queued writes as one batch and materialize loads. */
  sync(): Result {
    this.assertValid();
    if (this.queued.length === 0) return ok(undefined, this.store.currentRevision);
    const batch = this.store.applyEdits(this.queued, HUMAN);
    this.queued = [];
    if (!batch.ok) {
      const failing = batch.results.flatMap((r, i) => (r.status === 'failed' ? [i] : []));
      return { status: 'validation', message: 'batch rejected', revision: batch.revision, failingIndices: failing };
    }
    // Resolve created-paragraph proxies from the symbolic map.
    for (const p of this.pending) {
      const real = batch.createdSymbols[p.symbolicId];
      if (real) p.proxy.resolve(real);
    }
    this.pending.length = 0;
    return ok(undefined, batch.revision);
  }

  /** @internal invalidate all tracked proxies at run completion. */
  invalidate(): void {
    this.valid = false;
  }

  private assertValid(): void {
    if (!this.valid) throw new Error('RequestContext is no longer valid');
  }
  get isValid(): boolean {
    return this.valid;
  }
}

export class DocumentProxy {
  readonly body: BodyProxy;
  /** @internal */
  constructor(ctx: RequestContext, store: DocumentStore) {
    this.body = new BodyProxy(ctx, store);
  }
}

export class BodyProxy {
  /** @internal */
  constructor(
    private readonly ctx: RequestContext,
    private readonly store: DocumentStore,
  ) {}

  /** Live paragraph proxies for the body story. */
  get paragraphs(): ParagraphProxy[] {
    const storyId = bodyStoryId(this.store.currentModel);
    const story = this.store.currentModel.stories.get(storyId)!;
    return story.blocks.map((b) => ParagraphProxy.forReal(this.ctx, this.store, (b as ParagraphRecord).id));
  }

  /** Queue creation of a paragraph; returns a proxy that resolves after sync. */
  insertParagraph(text = ''): ParagraphProxy {
    const storyId = bodyStoryId(this.store.currentModel);
    const proxy = ParagraphProxy.pending(this.ctx, this.store);
    const symbolicId = this.ctx.newSymbol(proxy);
    proxy.bindSymbol(symbolicId);
    this.ctx.queue({ op: 'appendParagraph', storyId, symbolicId });
    if (text) this.ctx.queue({ op: 'insertText', paragraphId: symbolicId, text });
    return proxy;
  }
}

export class ParagraphProxy {
  private realId?: string;
  private symbolicId?: string;

  private constructor(
    private readonly ctx: RequestContext,
    private readonly store: DocumentStore,
    realId?: string,
  ) {
    this.realId = realId;
  }

  static forReal(ctx: RequestContext, store: DocumentStore, id: string): ParagraphProxy {
    return new ParagraphProxy(ctx, store, id);
  }
  static pending(ctx: RequestContext, store: DocumentStore): ParagraphProxy {
    return new ParagraphProxy(ctx, store);
  }

  /** @internal */
  bindSymbol(symbolicId: string): void {
    this.symbolicId = symbolicId;
  }
  /** @internal resolve to the allocated real id after sync. */
  resolve(realId: string): void {
    this.realId = realId;
  }

  /** The stable paragraph id (throws if referenced before its creating sync). */
  get id(): string {
    if (!this.realId) throw new Error('paragraph id is not available until sync');
    return this.realId;
  }

  /** Current authored text (live read of the model). */
  get text(): string {
    return paragraphText(this.store.currentModel, this.id) ?? '';
  }

  /** Queue text insertion into this paragraph (uses the symbolic id before sync). */
  insertText(text: string): void {
    const target = this.realId ?? this.symbolicId;
    if (!target) throw new Error('paragraph is not addressable');
    this.ctx.queue({ op: 'insertText', paragraphId: target, text });
  }
}

/** Open a batched request context over a handle; proxies invalidate on completion. */
export function run<T>(handle: DocumentHandle, callback: (ctx: RequestContext) => T): T {
  const ctx = new RequestContext(handle.internalStore);
  try {
    return callback(ctx);
  } finally {
    ctx.invalidate();
  }
}

/** Read-only query surface (design D8). */
export function query(handle: DocumentHandle, q: { kind: 'paragraphText'; paragraphId: string }): Result<string> {
  const store = handle.internalStore;
  const text = paragraphText(store.currentModel, q.paragraphId);
  if (text === undefined) return { status: 'validation', message: 'paragraph not found', revision: store.currentRevision };
  return ok(text, store.currentRevision);
}
