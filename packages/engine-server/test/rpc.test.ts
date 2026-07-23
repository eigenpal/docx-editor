// RPC server/client tests (document-engine tasks 11.1, 11.4; goal gate 11 over a
// transport boundary): direct-vs-RPC equivalence, the exception boundary, and
// idempotency.

import { describe, expect, test } from 'bun:test';
import { RpcServer, RpcClient, RpcTransportError, RPC_PROTOCOL_VERSION } from '../src/index.ts';
import { DocxEditor, bodyStoryId, paragraphText, type DocumentStore, type ParagraphRecord } from '@docx-editor.dev/engine-core';

function bodyText(store: DocumentStore): string {
  return store.currentModel.stories
    .get(bodyStoryId(store.currentModel))!
    .blocks.map((b) => (b as ParagraphRecord).runs.map((r) => r.text).join(''))
    .join('|');
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

    // RPC: append a paragraph, then insert text into it, across the wire.
    const server = new RpcServer();
    server.createDocument('doc1');
    const client = new RpcClient(server);
    const appended = client.call('doc1', 'appendParagraph', {});
    expect(appended.status).toBe('ok');
    const pid = appended.status === 'ok' ? (appended.value as string) : '';
    const inserted = client.call('doc1', 'insertText', { paragraphId: pid, text: 'over the wire' });
    expect(inserted.status).toBe('ok');

    const rpcText = paragraphText(server.store('doc1')!.currentModel, pid);
    expect(rpcText).toBe('over the wire');
    expect(rpcText).toBe(directText);
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
    // Unknown document / bad protocol version -> RpcTransportError.
    expect(() => server.handle({ protocolVersion: RPC_PROTOCOL_VERSION, documentId: 'nope', method: 'appendParagraph', params: {} })).toThrow(RpcTransportError);
    expect(() => server.handle({ protocolVersion: 999, documentId: 'doc1', method: 'appendParagraph', params: {} })).toThrow(/protocol/);
  });
});

describe('idempotency (task 11.1)', () => {
  test('same key + same request replays without a second commit', () => {
    const server = new RpcServer();
    server.createDocument('doc1');
    const client = new RpcClient(server);
    const first = client.call('doc1', 'appendParagraph', {}, 'key-1');
    const replay = client.call('doc1', 'appendParagraph', {}, 'key-1');
    expect(first).toEqual(replay); // identical response
    expect(server.store('doc1')!.currentRevision).toBe(1); // committed once, not twice
  });

  test('after the retention window expires, the same key is a new attempt', () => {
    let now = 0;
    const server = new RpcServer({ clock: () => now, retentionWindow: 2 });
    server.createDocument('doc1');
    const client = new RpcClient(server);

    now = 1;
    client.call('doc1', 'appendParagraph', {}, 'k'); // commit #1, stored at=1
    now = 2;
    client.call('doc1', 'appendParagraph', {}, 'k'); // within window -> replay, no new commit
    expect(server.store('doc1')!.currentRevision).toBe(1);

    now = 10; // past the retention window (10 - 1 > 2)
    client.call('doc1', 'appendParagraph', {}, 'k'); // expired -> fresh attempt, commit #2
    expect(server.store('doc1')!.currentRevision).toBe(2);
  });

  test('same key + different request is a conflict', () => {
    const server = new RpcServer();
    const doc = server.createDocument('doc1');
    const pid = (() => {
      const r = server.handle({ protocolVersion: RPC_PROTOCOL_VERSION, documentId: 'doc1', method: 'appendParagraph', params: {} });
      return r.result.status === 'ok' ? (r.result.value as string) : '';
    })();
    void doc;
    const client = new RpcClient(server);
    client.call('doc1', 'insertText', { paragraphId: pid, text: 'A' }, 'key-x');
    const conflict = client.call('doc1', 'insertText', { paragraphId: pid, text: 'DIFFERENT' }, 'key-x');
    expect(conflict.status).toBe('conflict');
  });
});
