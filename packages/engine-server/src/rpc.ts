// Minimal RPC server/client over the shared command registry (document-engine
// tasks 11.1, 11.3, 11.4 core / design D11). Requests and responses cross a JSON
// wire boundary. The exception boundary is strict: application/validation/
// conflict/resource outcomes are returned as DocxEditor.Result in the response;
// ONLY a transport/protocol failure that prevents a valid envelope throws
// RpcTransportError. Idempotency keys bind to a request hash. Full Connect/gRPC
// framing + generated language clients extend this; the semantics are identical.

import { DocxEditor, stableHash, type DocumentStore } from '@docx-editor.dev/engine-core';

export const RPC_PROTOCOL_VERSION = 1;

export interface RpcRequest {
  readonly protocolVersion: number;
  readonly documentId: string;
  readonly method: string;
  readonly params: unknown;
  readonly idempotencyKey?: string;
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
  private readonly idempotency = new Map<string, { hash: string; response: RpcResponse; at: number }>();
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
    const doc = this.docs.get(req.documentId);
    if (!doc) throw new RpcTransportError(`unknown document ${req.documentId}`);

    // --- idempotency with finite retention (task 11.1) ---
    if (req.idempotencyKey !== undefined) {
      const now = this.clock();
      const hash = stableHash({ documentId: req.documentId, method: req.method, params: req.params });
      const prior = this.idempotency.get(req.idempotencyKey);
      const live = prior !== undefined && now - prior.at <= this.retentionWindow;
      if (prior && live) {
        if (prior.hash !== hash) {
          // Same key, different request hash within retention -> conflict RESULT.
          return { result: { status: 'conflict', message: 'idempotency key reused with a different request', revision: doc.revision } };
        }
        return prior.response; // idempotent replay
      }
      // No live entry (new or expired) -> a fresh attempt.
      const response: RpcResponse = { result: DocxEditor.mcp.dispatch(doc, req.method, req.params) };
      this.idempotency.set(req.idempotencyKey, { hash, response, at: now });
      return response;
    }

    // --- application boundary: returns a Result, never throws ---
    return { result: DocxEditor.mcp.dispatch(doc, req.method, req.params) };
  }
}

export class RpcClient {
  constructor(private readonly server: RpcServer) {}

  /** Call an RPC method; JSON round-trips the request AND response (wire boundary). */
  call(
    documentId: string,
    method: string,
    params: unknown,
    idempotencyKey?: string,
  ): DocxEditor.Result<string | undefined> {
    const wire: RpcRequest = JSON.parse(
      JSON.stringify({ protocolVersion: RPC_PROTOCOL_VERSION, documentId, method, params, idempotencyKey }),
    );
    const response = this.server.handle(wire);
    return JSON.parse(JSON.stringify(response)).result;
  }
}
