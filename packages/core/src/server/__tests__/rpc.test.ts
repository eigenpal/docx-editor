// RPC server/client tests (document-engine tasks 11.1, 11.4; goal gate 11 over a
// transport boundary): direct-vs-RPC equivalence, the exception boundary, and
// tenant/schema-bound idempotency.

import { describe, expect, test } from 'bun:test';
import { RpcServer, RpcClient, RpcTransportError, RPC_PROTOCOL_VERSION, COMMAND_SCHEMA_VERSION, DEFAULT_TENANT } from '../index.ts';
import { DocxEditor, bodyStoryId, paragraphText, type DocumentStore, type ParagraphRecord } from '@docx-editor.dev/core-contract/store';

function bodyText(store: DocumentStore): string {
  return store.currentModel.stories
    .get(bodyStoryId(store.currentModel))!
    .blocks.map((b) => (b as ParagraphRecord).runs.map((r) => r.text).join(''))
    .join('|');
}

/** A well-formed raw envelope with the required tenant/schema fields. */
function envelope(over: Partial<Parameters<RpcServer['handle']>[0]>): Parameters<RpcServer['handle']>[0] {
  return {
    protocolVersion: RPC_PROTOCOL_VERSION,
    tenantId: DEFAULT_TENANT,
    schemaVersion: COMMAND_SCHEMA_VERSION,
    documentId: 'doc1',
    method: 'appendParagraph',
    params: { scope: 'body' },
    ...over,
  };
}

describe('direct vs RPC equivalence (gate 11)', () => {
  test('the same workflow via RPC and direct yields equivalent authored state', () => {
    // Direct.
    const direct = DocxEditor.create();
    let directText = '';
    DocxEditor.run(direct, (ctx) => {
      const p = ctx.document.body.insertParagraph('over the wire');
      ctx.sync();
      directText = paragraphText((direct as unknown as { internalStore: DocumentStore }).internalStore.currentModel, p.id) ?? '';
    });

    // RPC: append a body paragraph, then insert text into it, across the wire.
    const server = new RpcServer();
    server.createDocument('doc1');
    const client = new RpcClient(server);
    const appended = client.call('doc1', 'appendParagraph', { scope: 'body' });
    expect(appended.status).toBe('ok');
    const pid = appended.status === 'ok' ? (appended.value as string) : '';
    const inserted = client.call('doc1', 'insertText', { paragraphId: pid, text: 'over the wire' });
    expect(inserted.status).toBe('ok');

    const rpcText = paragraphText(server.store('doc1')!.currentModel, pid);
    expect(rpcText).toBe('over the wire');
    expect(rpcText).toBe(directText);
    // The RPC and direct bodies match verbatim (both start with the empty seed paragraph).
    expect(bodyText(server.store('doc1')!)).toBe(bodyText((direct as unknown as { internalStore: DocumentStore }).internalStore));
  });
});

describe('exception boundary (task 11.4)', () => {
  test('application failures return a Result; they do NOT throw', () => {
    const server = new RpcServer();
    server.createDocument('doc1');
    const client = new RpcClient(server);
    // Invalid params (missing text) -> validation RESULT, no throw.
    const r = client.call('doc1', 'insertText', { paragraphId: 'p-1' });
    expect(r.status).toBe('validation');
    expect(server.store('doc1')!.currentRevision).toBe(0); // no mutation
  });

  test('only transport/protocol failures throw', () => {
    const server = new RpcServer();
    server.createDocument('doc1');
    // Unknown document / bad protocol version / missing tenant -> RpcTransportError.
    expect(() => server.handle(envelope({ documentId: 'nope' }))).toThrow(RpcTransportError);
    expect(() => server.handle(envelope({ protocolVersion: 999 }))).toThrow(/protocol/);
    expect(() => server.handle(envelope({ tenantId: '' }))).toThrow(/tenant/);
  });
});

describe('idempotency (task 11.1)', () => {
  test('same key + same request replays without a second commit', () => {
    const server = new RpcServer();
    server.createDocument('doc1');
    const client = new RpcClient(server);
    const first = client.call('doc1', 'appendParagraph', { scope: 'body' }, { idempotencyKey: 'key-1' });
    const replay = client.call('doc1', 'appendParagraph', { scope: 'body' }, { idempotencyKey: 'key-1' });
    expect(first).toEqual(replay); // identical response
    expect(server.store('doc1')!.currentRevision).toBe(1); // committed once, not twice
  });

  test('after the retention window expires, the same key is a new attempt', () => {
    let now = 0;
    const server = new RpcServer({ clock: () => now, retentionWindow: 2 });
    server.createDocument('doc1');
    const client = new RpcClient(server);

    now = 1;
    client.call('doc1', 'appendParagraph', { scope: 'body' }, { idempotencyKey: 'k' }); // commit #1, stored at=1
    now = 2;
    client.call('doc1', 'appendParagraph', { scope: 'body' }, { idempotencyKey: 'k' }); // within window -> replay
    expect(server.store('doc1')!.currentRevision).toBe(1);

    now = 10; // past the retention window (10 - 1 > 2)
    client.call('doc1', 'appendParagraph', { scope: 'body' }, { idempotencyKey: 'k' }); // expired -> fresh attempt, commit #2
    expect(server.store('doc1')!.currentRevision).toBe(2);
  });

  test('same key + different request is a conflict', () => {
    const server = new RpcServer();
    server.createDocument('doc1');
    const seed = server.handle(envelope({}));
    const pid = seed.result.status === 'ok' ? (seed.result.value as string) : '';
    const client = new RpcClient(server);
    client.call('doc1', 'insertText', { paragraphId: pid, text: 'A' }, { idempotencyKey: 'key-x' });
    const conflict = client.call('doc1', 'insertText', { paragraphId: pid, text: 'DIFFERENT' }, { idempotencyKey: 'key-x' });
    expect(conflict.status).toBe('conflict');
  });
});

// Regression for the reviewer finding: idempotency was globally keyed and hashed
// only document/method/params, so two tenants' identical keys collided. The key is
// now scoped to (tenant, document) and the hash binds tenant + document + schema.
describe('tenant- and schema-bound idempotency (task 11.1)', () => {
  test("one tenant's idempotency key never collides with another tenant's", () => {
    const server = new RpcServer();
    server.createDocument('doc1');
    const client = new RpcClient(server);

    // Tenant A commits under key "shared".
    const a = client.call('doc1', 'appendParagraph', { scope: 'body' }, { tenantId: 'tenant-A', idempotencyKey: 'shared' });
    expect(a.status).toBe('ok');
    // Tenant B uses the SAME key. Under the old global keyspace this would have
    // been a false conflict (leaking that A used the key) or a cross-tenant replay.
    const b = client.call('doc1', 'appendParagraph', { scope: 'body' }, { tenantId: 'tenant-B', idempotencyKey: 'shared' });
    expect(b.status).toBe('ok'); // independent entry, not a conflict
    // Both writes committed: two separate paragraphs.
    expect(server.store('doc1')!.currentRevision).toBe(2);
    // And B does not read A's cached response.
    expect(a.status === 'ok' && b.status === 'ok' && a.value !== b.value).toBe(true);
  });

  test('same tenant + same key + different schema version is a conflict', () => {
    const server = new RpcServer();
    server.createDocument('doc1');
    const client = new RpcClient(server);
    client.call('doc1', 'appendParagraph', { scope: 'body' }, { tenantId: 't', schemaVersion: 1, idempotencyKey: 'k' });
    const conflict = client.call('doc1', 'appendParagraph', { scope: 'body' }, { tenantId: 't', schemaVersion: 2, idempotencyKey: 'k' });
    expect(conflict.status).toBe('conflict'); // schema is part of the bound hash
  });

  test('the same key on a different document is independent', () => {
    const server = new RpcServer();
    server.createDocument('doc1');
    server.createDocument('doc2');
    const client = new RpcClient(server);
    const r1 = client.call('doc1', 'appendParagraph', { scope: 'body' }, { tenantId: 't', idempotencyKey: 'k' });
    const r2 = client.call('doc2', 'appendParagraph', { scope: 'body' }, { tenantId: 't', idempotencyKey: 'k' });
    expect(r1.status).toBe('ok');
    expect(r2.status).toBe('ok'); // different document -> different scoped key
    expect(server.store('doc1')!.currentRevision).toBe(1);
    expect(server.store('doc2')!.currentRevision).toBe(1);
  });
});

// Compare-and-swap revision precondition (task 11.1: immutable reads / CAS).
describe('CAS revision preconditions (task 11.1)', () => {
  test('a write against the current revision succeeds', () => {
    const server = new RpcServer();
    server.createDocument('doc1');
    const client = new RpcClient(server);
    const r = client.call('doc1', 'appendParagraph', { scope: 'body' }, { expectedRevision: 0 });
    expect(r.status).toBe('ok');
    expect(server.store('doc1')!.currentRevision).toBe(1);
  });

  test('a stale base revision is a conflict and mutates nothing', () => {
    const server = new RpcServer();
    server.createDocument('doc1');
    const client = new RpcClient(server);
    client.call('doc1', 'appendParagraph', { scope: 'body' }); // -> revision 1
    // A caller who read revision 0 now tries to write; the CAS precondition fails.
    const stale = client.call('doc1', 'appendParagraph', { scope: 'body' }, { expectedRevision: 0 });
    expect(stale.status).toBe('conflict');
    expect(stale.revision).toBe(1); // reports the actual current revision to rebase on
    expect(server.store('doc1')!.currentRevision).toBe(1); // no mutation
  });

  test('a CAS conflict is not cached under its idempotency key; a retry at the right revision succeeds', () => {
    const server = new RpcServer();
    server.createDocument('doc1');
    const client = new RpcClient(server);
    client.call('doc1', 'appendParagraph', { scope: 'body' }); // -> revision 1
    const stale = client.call('doc1', 'appendParagraph', { scope: 'body' }, { idempotencyKey: 'k', expectedRevision: 0 });
    expect(stale.status).toBe('conflict');
    // Same key, now with the correct base revision -> a fresh attempt that commits.
    const ok = client.call('doc1', 'appendParagraph', { scope: 'body' }, { idempotencyKey: 'k', expectedRevision: 1 });
    expect(ok.status).toBe('ok');
    expect(server.store('doc1')!.currentRevision).toBe(2);
  });
});
