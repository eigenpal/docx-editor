// Generated-client equivalence (document-engine tasks 11.6, 11.8; goal gate 11).
// The schema-generated client, driven over the RPC transport, produces authored
// state and results equivalent to the direct path.

import { describe, expect, test } from 'bun:test';
import { DocxClient, makeGeneratedClient, type ClientTransport } from '../index.ts';
import { RpcServer, RpcClient } from '@docx-editor.dev/core-contract/server';
import { DocxEditor, paragraphText, bodyStoryId, type DocumentStore } from '@docx-editor.dev/core-contract/store';

function rpcTransport(server: RpcServer, docId: string): ClientTransport {
  const rpc = new RpcClient(server);
  return { call: (method, params) => rpc.call(docId, method, params) };
}

describe('generated client', () => {
  test('methods are generated from the registry (no hand-wiring)', () => {
    const client = new DocxClient({ call: () => ({ status: 'ok', value: undefined, revision: 0 }) });
    expect(client.methods.sort()).toEqual(['appendParagraph', 'getParagraphText', 'insertText']);
  });

  test('generated client over RPC equals the direct path', () => {
    // Direct.
    const direct = DocxEditor.create();
    let directText = '';
    DocxEditor.run(direct, (ctx) => {
      const p = ctx.document.body.insertParagraph('generated client');
      ctx.sync();
      directText = paragraphText((direct as unknown as { internalStore: DocumentStore }).internalStore.currentModel, p.id) ?? '';
    });

    // Generated client -> RPC -> server.
    const server = new RpcServer();
    server.createDocument('doc1');
    const client = new DocxClient(rpcTransport(server, 'doc1'));
    const appended = client.appendParagraph();
    expect(appended.status).toBe('ok');
    const pid = appended.status === 'ok' ? (appended.value as string) : '';
    expect(client.insertText(pid, 'generated client').status).toBe('ok');

    const clientText = paragraphText(server.store('doc1')!.currentModel, pid);
    expect(clientText).toBe('generated client');
    expect(clientText).toBe(directText);
  });

  test('a query through the generated client matches server state', () => {
    const server = new RpcServer();
    server.createDocument('doc1');
    const gen = makeGeneratedClient(rpcTransport(server, 'doc1'));
    const pid = (gen.appendParagraph({ scope: 'body' }).value as string) ?? '';
    gen.insertText({ paragraphId: pid, text: 'q' });
    const q = gen.getParagraphText({ paragraphId: pid });
    expect(q).toMatchObject({ status: 'ok', value: 'q' });
    // Same story exists on the server.
    expect(server.store('doc1')!.currentModel.stories.get(bodyStoryId(server.store('doc1')!.currentModel))).toBeDefined();
  });

  test('an invalid call returns a validation Result (no throw over the wire)', () => {
    const server = new RpcServer();
    server.createDocument('doc1');
    const client = new DocxClient(rpcTransport(server, 'doc1'));
    // Invalid targets return a validation Result over the wire — no exception.
    expect(client.insertText('', 'x').status).toBe('validation'); // empty paragraph id
    expect(client.getParagraphText('nope').status).toBe('validation'); // unknown paragraph
  });
});
