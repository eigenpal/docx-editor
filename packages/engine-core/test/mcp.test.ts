// MCP tool schemas + schema-bound dispatch (document-engine tasks 7.10, 7.11).

import { describe, expect, test } from 'bun:test';
import { DocxEditor } from '../src/index.ts';

describe('MCP tool generation (7.11)', () => {
  test('enumerated tool schemas equal the registry schemas', () => {
    const tools = DocxEditor.mcp.tools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    for (const cmd of DocxEditor.mcp.commands) {
      expect(byName.get(cmd.tool)!.inputSchema).toBe(cmd.input); // same schema object, not a copy
    }
    expect(tools.map((t) => t.name).sort()).toEqual(['appendParagraph', 'getParagraphText', 'insertText']);
  });
});

describe('schema-bound dispatch (7.11)', () => {
  test('valid insertText mutates through a semantic transaction', () => {
    const doc = DocxEditor.create();
    let pid = '';
    DocxEditor.run(doc, (ctx) => {
      const p = ctx.document.body.insertParagraph('');
      ctx.sync();
      pid = p.id;
    });
    const result = DocxEditor.mcp.dispatch(doc, 'insertText', { paragraphId: pid, text: 'via mcp' });
    expect(result.status).toBe('ok');
    expect(DocxEditor.query(doc, { kind: 'paragraphText', paragraphId: pid })).toMatchObject({ value: 'via mcp' });
  });

  test('invalid input opens NO write transaction (revision unchanged)', () => {
    const doc = DocxEditor.create();
    const before = doc.revision;
    // Missing required "text".
    const r1 = DocxEditor.mcp.dispatch(doc, 'insertText', { paragraphId: 'p-1' });
    expect(r1.status).toBe('validation');
    // Wrong type.
    const r2 = DocxEditor.mcp.dispatch(doc, 'insertText', { paragraphId: 'p-1', text: 42 });
    expect(r2.status).toBe('validation');
    // Extra property.
    const r3 = DocxEditor.mcp.dispatch(doc, 'insertText', { paragraphId: 'p-1', text: 'x', evil: true });
    expect(r3.status).toBe('validation');
    // Unknown tool.
    const r4 = DocxEditor.mcp.dispatch(doc, 'noSuchTool', {});
    expect(r4.status).toBe('validation');
    expect(doc.revision).toBe(before); // nothing committed
  });

  test('appendParagraph tool returns the created id and commits once', () => {
    const doc = DocxEditor.create();
    const r = DocxEditor.mcp.dispatch(doc, 'appendParagraph', {});
    expect(r.status).toBe('ok');
    expect(doc.revision).toBe(1);
    if (r.status === 'ok') expect(typeof r.value).toBe('string');
  });
});
