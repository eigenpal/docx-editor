/**
 * Integration test for the real customer story: build your own server-side
 * MCP server by composing `McpServer` + `createReviewerBridge` + `DocxReviewer`.
 *
 * This is what a legal-tech SaaS or contract-management platform actually
 * does — wraps the bridge inside its own auth/storage layer, exposes MCP
 * over its preferred transport (HTTP, websocket, stdio in a managed worker,
 * etc.), and bills customers per seat.
 *
 * No subprocess. No bin. The library is the product; customers wire the
 * transport themselves.
 */

import { describe, test, expect } from 'bun:test';
import type {
  Document,
  DocumentBody,
  Paragraph,
  ParagraphContent,
  Run,
} from '@eigenpal/docx-core/headless';
import { DocxReviewer } from '../DocxReviewer';
import { createReviewerBridge } from '../reviewerBridge';
import { McpServer } from '../mcp/server';
import type {
  JsonRpcSuccess,
  McpInitializeResult,
  McpToolsCallResult,
  McpToolsListResult,
} from '../mcp/protocol';

// ── Fixture ────────────────────────────────────────────────────────────────

function makeRun(text: string): Run {
  return { type: 'run', content: [{ type: 'text', text }] } as Run;
}

function makeParagraph(text: string, paraId?: string): Paragraph {
  return {
    type: 'paragraph',
    content: [makeRun(text)] as ParagraphContent[],
    formatting: {},
    paraId,
  } as Paragraph;
}

function makeContractReviewer(): DocxReviewer {
  const doc = {
    package: {
      document: {
        content: [
          makeParagraph('Section 1: Payment Terms', 'p_h1'),
          makeParagraph('The buyer shall pay $50k within 30 days of invoice.', 'p_pay'),
          makeParagraph('Section 2: Liability', 'p_h2'),
          makeParagraph('Total liability is capped at the contract value.', 'p_liab'),
        ],
        comments: [],
      } as DocumentBody,
    },
  } as Document;
  return new DocxReviewer(doc, 'AI Reviewer');
}

// ── End-to-end: customer builds their own MCP server ──────────────────────

describe('Customer story: server-side MCP server using the published library', () => {
  test('handshake → catalog → review flow → flush back to DOCX-shaped doc', () => {
    // 1. Customer parses a DOCX (in real life: from S3, Postgres, an upload).
    const reviewer = makeContractReviewer();

    // 2. Customer wires the reviewer through the bridge into McpServer. This is
    //    the entire integration. They drop McpServer behind their own auth +
    //    transport (HTTP/SSE, websocket, queue worker, whatever they prefer).
    const bridge = createReviewerBridge(reviewer);
    const server = new McpServer(bridge, {
      name: 'acme-contract-review',
      version: '0.1.0',
    });

    // 3. MCP client (Claude in this fictional SaaS) handshakes.
    const init = server.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {} },
    });
    const initResult = (init as JsonRpcSuccess).result as McpInitializeResult;
    expect(initResult.protocolVersion).toBe('2025-06-18');
    expect(initResult.serverInfo.name).toBe('acme-contract-review');

    // 4. Client lists tools.
    const list = server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = ((list as JsonRpcSuccess).result as McpToolsListResult).tools;
    expect(tools.length).toBe(10);

    // 5. Client reads the document.
    const read = server.handle({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'read_document', arguments: {} },
    });
    const readResult = (read as JsonRpcSuccess).result as McpToolsCallResult;
    expect(readResult.isError).toBeUndefined();
    expect(readResult.content[0].text).toContain('p_pay');
    expect(readResult.content[0].text).toContain('$50k');

    // 6. Client comments on the payment paragraph.
    const comment = server.handle({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'add_comment',
        arguments: {
          paraId: 'p_pay',
          text: 'Liability cap and payment terms should be aligned. Verify $50k is appropriate for deal size.',
        },
      },
    });
    const commentResult = (comment as JsonRpcSuccess).result as McpToolsCallResult;
    expect(commentResult.isError).toBeUndefined();

    // 7. Client suggests a tracked-change replacement.
    const change = server.handle({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'suggest_change',
        arguments: { paraId: 'p_pay', search: '$50k', replaceWith: '$500k' },
      },
    });
    const changeResult = (change as JsonRpcSuccess).result as McpToolsCallResult;
    expect(changeResult.isError).toBeUndefined();
    expect(changeResult.content[0].text).toContain('$500k');

    // 8. Client lists comments to confirm.
    const listComments = server.handle({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'read_comments', arguments: {} },
    });
    const listResult = (listComments as JsonRpcSuccess).result as McpToolsCallResult;
    expect(listResult.content[0].text).toContain('Liability cap and payment terms');

    // 9. Customer pulls the modified document model out of the reviewer.
    //    In real life they'd also call reviewer.toBuffer() to serialize back
    //    to DOCX bytes, then push to wherever the user's documents live.
    const finalDoc = reviewer.toDocument();
    expect(finalDoc.package?.document?.comments?.length).toBe(1);
    expect(reviewer.getChanges().length).toBeGreaterThan(0);
  });

  test('tool errors propagate as MCP isError envelopes (per spec)', () => {
    const server = new McpServer(createReviewerBridge(makeContractReviewer()));

    const reply = server.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'add_comment',
        arguments: { paraId: 'NOT_A_REAL_PARA', text: 'nope' },
      },
    });
    const result = (reply as JsonRpcSuccess).result as McpToolsCallResult;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('paraId');
  });

  test('multiple documents in one process — customer hosts many concurrent reviewers', () => {
    // Real SaaS shape: each user request creates a fresh reviewer + bridge +
    // server. The library is fully stateless at the module level.
    const docs = ['contract A', 'contract B', 'contract C'].map((label) => {
      const r = makeContractReviewer();
      const s = new McpServer(createReviewerBridge(r), { name: label });
      return { label, server: s };
    });

    for (const { label, server } of docs) {
      const init = server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize' });
      const result = (init as JsonRpcSuccess).result as McpInitializeResult;
      expect(result.serverInfo.name).toBe(label);
    }
  });
});
