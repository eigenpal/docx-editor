// Minimal RPC server/client over the shared command registry (document-engine
// tasks 11.1, 11.3, 11.4 core / design D11). Requests and responses cross a JSON
// wire boundary. The exception boundary is strict: application/validation/
// conflict/resource outcomes are returned as DocxEditor.Result in the response;
// ONLY a transport/protocol failure that prevents a valid envelope throws
// RpcTransportError. Idempotency keys are SCOPED to (tenant, document) and BOUND to
// a tenant/document/schema/operation hash, so one tenant's key can never collide
// with another's; a compare-and-swap `expectedRevision` gives optimistic
// concurrency. Full Connect/gRPC framing + generated language clients extend this;
// the semantics are identical.

import { DocxEditor, stableHash, type DocumentStore } from '@docx-editor.dev/engine-core';

export const RPC_PROTOCOL_VERSION = 1;
/** Version of the command/query schema bundle the idempotency binding is scoped to. */
export const COMMAND_SCHEMA_VERSION = 1;
/** Tenant used when a single-tenant caller does not declare one. */
export const DEFAULT_TENANT = 'default';

export interface RpcRequest {
  readonly protocolVersion: number;
  /** The calling tenant. Idempotency keys are scoped and bound to this. */
  readonly tenantId: string;
  /** Command-schema version the client targets; part of the idempotency binding. */
  readonly schemaVersion: number;
  readonly documentId: string;
  readonly method: string;
  readonly params: unknown;
  readonly idempotencyKey?: string;
  /** Optional scope context (e.g. the session's active story) for the dispatch. */
  readonly scopeContext?: DocxEditor.ScopeContext;
  /** Optional compare-and-swap precondition: the base revision the caller read
   *  and expects to still hold. A mismatch is a conflict Result — no mutation. */
  readonly expectedRevision?: number;
}

/** Compose the tenant-scoped idempotency map key. A key is private to its
 *  (tenant, document) pair, so one tenant's key can never collide with another's. */
function idempotencyMapKey(tenantId: string, documentId: string, key: string): string {
  return JSON.stringify([tenantId, documentId, key]);
}

export interface RpcResponse {
  readonly result: DocxEditor.Result<string | undefined>;
}

export class RpcTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RpcTransportError';
  }
}

export class RpcServer {
  private readonly docs = new Map<string, DocxEditor.DocumentHandle>();
  private readonly idempotency = new Map<
    string,
    { hash: string; response: RpcResponse; at: number }
  >();
  private readonly clock: () => number;
  private readonly retentionWindow: number;

  constructor(opts: { clock?: () => number; retentionWindow?: number } = {}) {
    let tick = 0;
    this.clock = opts.clock ?? (() => (tick += 1));
    // Idempotency keys are retained for this window; after it, a repeat is a NEW attempt.
    this.retentionWindow = opts.retentionWindow ?? Number.MAX_SAFE_INTEGER;
  }

  createDocument(documentId: string): DocxEditor.DocumentHandle {
    const handle = DocxEditor.create();
    this.docs.set(documentId, handle);
    return handle;
  }

  /** Engine-internal access to a hosted document's store (for conformance comparison). */
  store(documentId: string): DocumentStore | undefined {
    const h = this.docs.get(documentId);
    return h ? (h as unknown as { internalStore: DocumentStore }).internalStore : undefined;
  }

  handle(req: RpcRequest): RpcResponse {
    // --- transport/protocol boundary: these THROW ---
    if (req.protocolVersion !== RPC_PROTOCOL_VERSION) {
      throw new RpcTransportError(`unsupported protocol version ${req.protocolVersion}`);
    }
    if (typeof req.tenantId !== 'string' || req.tenantId.length === 0) {
      throw new RpcTransportError('missing tenantId');
    }
    const doc = this.docs.get(req.documentId);
    if (!doc) throw new RpcTransportError(`unknown document ${req.documentId}`);

    // --- idempotency with finite retention (task 11.1) ---
    if (req.idempotencyKey !== undefined) {
      const now = this.clock();
      // The stored hash binds tenant + document + schema + operation, so the same
      // key with any differing dimension is a same-key/different-hash conflict.
      const hash = stableHash({
        tenantId: req.tenantId,
        documentId: req.documentId,
        schemaVersion: req.schemaVersion,
        method: req.method,
        params: req.params,
      });
      // The lookup key is scoped to (tenant, document): one tenant's idempotency
      // key can never read or collide with another tenant's entry.
      const mapKey = idempotencyMapKey(req.tenantId, req.documentId, req.idempotencyKey);
      const prior = this.idempotency.get(mapKey);
      const live = prior !== undefined && now - prior.at <= this.retentionWindow;
      if (prior && live) {
        if (prior.hash !== hash) {
          // Same key, different bound hash within retention -> conflict RESULT.
          return {
            result: {
              status: 'conflict',
              message: 'idempotency key reused with a different request',
              revision: doc.revision,
            },
          };
        }
        return prior.response; // idempotent replay (a satisfied request is not re-CAS'd)
      }
      // Fresh attempt: the CAS precondition gates the mutation and is NOT cached,
      // so a stale caller can retry against the current revision.
      const cas = this.casConflict(req, doc);
      if (cas) return cas;
      const response: RpcResponse = {
        result: DocxEditor.mcp.dispatch(doc, req.method, req.params, req.scopeContext),
      };
      this.idempotency.set(mapKey, { hash, response, at: now });
      return response;
    }

    // --- compare-and-swap precondition (task 11.1) ---
    const cas = this.casConflict(req, doc);
    if (cas) return cas;

    // --- application boundary: returns a Result, never throws ---
    return { result: DocxEditor.mcp.dispatch(doc, req.method, req.params, req.scopeContext) };
  }

  /** Optimistic-concurrency check: if the caller pinned a base revision that no
   *  longer holds, return a conflict Result and perform no mutation. */
  private casConflict(req: RpcRequest, doc: DocxEditor.DocumentHandle): RpcResponse | undefined {
    if (req.expectedRevision === undefined || req.expectedRevision === doc.revision)
      return undefined;
    return {
      result: {
        status: 'conflict',
        message: `revision precondition failed: expected ${req.expectedRevision}, actual ${doc.revision}`,
        revision: doc.revision,
      },
    };
  }
}

export interface RpcCallOptions {
  /** The calling tenant. Defaults to {@link DEFAULT_TENANT} for single-tenant callers. */
  readonly tenantId?: string;
  /** Command-schema version. Defaults to {@link COMMAND_SCHEMA_VERSION}. */
  readonly schemaVersion?: number;
  readonly idempotencyKey?: string;
  /** Scope context (e.g. the session's active story) forwarded to dispatch. */
  readonly scopeContext?: DocxEditor.ScopeContext;
  /** Compare-and-swap precondition: the base revision the caller expects to hold. */
  readonly expectedRevision?: number;
}

export class RpcClient {
  constructor(private readonly server: RpcServer) {}

  /** Call an RPC method; JSON round-trips the request AND response (wire boundary). */
  call(
    documentId: string,
    method: string,
    params: unknown,
    opts: RpcCallOptions = {}
  ): DocxEditor.Result<string | undefined> {
    const wire: RpcRequest = JSON.parse(
      JSON.stringify({
        protocolVersion: RPC_PROTOCOL_VERSION,
        tenantId: opts.tenantId ?? DEFAULT_TENANT,
        schemaVersion: opts.schemaVersion ?? COMMAND_SCHEMA_VERSION,
        documentId,
        method,
        params,
        idempotencyKey: opts.idempotencyKey,
        scopeContext: opts.scopeContext,
        expectedRevision: opts.expectedRevision,
      })
    );
    const response = this.server.handle(wire);
    return JSON.parse(JSON.stringify(response)).result;
  }
}
