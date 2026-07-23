// DocxEditor.* public object model tests (document-engine section 7): create,
// run/RequestContext, lazy proxies, atomic sync (7.4), Result taxonomy (7.8),
// and proxy lifecycle/invalidation (7.3).

import { describe, expect, test } from 'bun:test';
import { DocxEditor } from '../src/index.ts';

describe('lifecycle', () => {
  test('create yields an editable handle; close disposes it', () => {
    const doc = DocxEditor.create();
    expect(doc.revision).toBe(0);
    doc.close();
    expect(doc.isClosed).toBe(true);
    expect(() => doc.internalStore).toThrow(/closed/);
  });

  test('proxies are invalid once the run completes', () => {
    const doc = DocxEditor.create();
    let escaped: DocxEditor.RequestContext | undefined;
    DocxEditor.run(doc, (ctx) => {
      escaped = ctx;
      expect(ctx.isValid).toBe(true);
    });
    expect(escaped!.isValid).toBe(false);
    expect(() => escaped!.sync()).toThrow(/no longer valid/);
  });
});

describe('batched edits and sync', () => {
  test('insertParagraph + sync commits atomically and resolves the proxy', () => {
    const doc = DocxEditor.create();
    const rev = DocxEditor.run(doc, (ctx) => {
      const p = ctx.document.body.insertParagraph('Hello');
      p.insertText(' world');
      const result = ctx.sync();
      expect(result.status).toBe('ok');
      // The created paragraph resolves after sync and reads its live text.
      expect(p.text).toBe('Hello world');
      return result;
    });
    expect(rev.status).toBe('ok');
    expect(doc.revision).toBe(1); // one atomic commit for the whole batch
  });

  test('body.paragraphs reflects committed state', () => {
    const doc = DocxEditor.create();
    DocxEditor.run(doc, (ctx) => {
      ctx.document.body.insertParagraph('one');
      ctx.document.body.insertParagraph('two');
      ctx.sync();
      const texts = ctx.document.body.paragraphs.map((p) => p.text);
      expect(texts).toEqual(['', 'one', 'two']); // initial empty paragraph + two
    });
  });

  test('a paragraph id is unavailable before its creating sync', () => {
    const doc = DocxEditor.create();
    DocxEditor.run(doc, (ctx) => {
      const p = ctx.document.body.insertParagraph('x');
      expect(() => p.id).toThrow(/until sync/);
      ctx.sync();
      expect(typeof p.id).toBe('string');
    });
  });
});

describe('query + Result taxonomy', () => {
  test('query returns ok with value or a validation result', () => {
    const doc = DocxEditor.create();
    let pid = '';
    DocxEditor.run(doc, (ctx) => {
      const p = ctx.document.body.insertParagraph('queried');
      ctx.sync();
      pid = p.id;
    });
    const okResult = DocxEditor.query(doc, { kind: 'paragraphText', paragraphId: pid });
    expect(okResult).toMatchObject({ status: 'ok', value: 'queried' });
    const missing = DocxEditor.query(doc, { kind: 'paragraphText', paragraphId: 'nope' });
    expect(missing.status).toBe('validation');
  });
});
