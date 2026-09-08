/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { DocxEditor } from '../../index.ts';
import type { DocxEditorServerRuntime } from '../runtime.ts';
import { docx, p } from './support/docx.ts';

const bytes = docx(p('The supplier may terminate immediately.') + p('Fees are fixed.'));
async function xml(runtime: DocxEditorServerRuntime) {
  return strFromU8(unzipSync(await runtime.save())['word/document.xml']!);
}
async function text(runtime: DocxEditorServerRuntime) {
  return runtime.run(async (c) => {
    c.document.body.load('text');
    await c.sync();
    return c.document.body.text;
  });
}
async function propose(runtime: DocxEditorServerRuntime, kind: 'insert' | 'delete' | 'replace') {
  await runtime.run(async (c) => {
    const range = c.document.body.search('immediately').getFirstOrNullObject();
    await c.sync();
    range.load('text');
    await c.sync();
    if (kind === 'insert') range.proposeInsertion(' upon written notice', 'After');
    else if (kind === 'delete') range.proposeDeletion();
    else range.proposeReplacement('with 30 days’ notice');
    await c.sync();
  });
}

describe('explicit inline proposals', () => {
  for (const kind of ['insert', 'delete', 'replace'] as const) {
    for (const decision of ['accept', 'reject'] as const) {
      test(`${kind} round-trips and ${decision}s`, async () => {
        const runtime = await DocxEditor.createServer(bytes, { author: 'Review agent' });
        try {
          await propose(runtime, kind);
          const markup = await xml(runtime);
          expect(markup).toContain('w:author="Review agent"');
          expect(markup).toContain('w:date=');
          if (kind !== 'delete') expect(markup).toContain('<w:ins');
          if (kind !== 'insert') expect(markup).toContain('<w:del');
          const reopened = await DocxEditor.createServer(await runtime.save());
          try {
            await reopened.run(async (c) => {
              if (decision === 'accept') c.document.revisions.acceptAll();
              else c.document.revisions.rejectAll();
              await c.sync();
            });
            const actual = await text(reopened);
            const original = 'The supplier may terminate immediately.\rFees are fixed.';
            const expected =
              kind === 'insert'
                ? original.replace('immediately', 'immediately upon written notice')
                : kind === 'delete'
                  ? original.replace('immediately', '')
                  : original.replace('immediately', 'with 30 days’ notice');
            expect(actual).toBe(decision === 'reject' ? original : expected);
          } finally {
            reopened.dispose();
          }
        } finally {
          runtime.dispose();
        }
      });
    }
  }

  test('ordinary writes with an author remain ordinary', async () => {
    const r = await DocxEditor.createServer(bytes, { author: 'Review agent' });
    try {
      await r.run(async (c) => {
        c.document.body.insertText('Plain', 'End');
        await c.sync();
      });
      expect(await xml(r)).not.toContain('<w:ins');
    } finally {
      r.dispose();
    }
  });

  test('stale decision refuses without publishing it', async () => {
    const r = await DocxEditor.createServer(bytes, { author: 'Agent' });
    try {
      await expect(
        r.run(async (c) => {
          const range = c.document.body.search('immediately').getFirstOrNullObject();
          await c.sync();
          range.load('text');
          await c.sync();
          await r.run(async (other) => {
            other.document.body.insertText('Human edit', 'End');
            await other.sync();
          });
          range.proposeReplacement('later');
          await c.sync();
        })
      ).rejects.toMatchObject({ code: 'StaleDocument' });
      expect(await xml(r)).not.toContain('<w:ins');
    } finally {
      r.dispose();
    }
  });

  test('pending revision overlap refuses and preserves the document', async () => {
    const r = await DocxEditor.createServer(bytes, { author: 'Agent' });
    try {
      await propose(r, 'replace');
      const before = await xml(r);
      await expect(propose(r, 'replace')).rejects.toBeDefined();
      expect(await xml(r)).toBe(before);
    } finally {
      r.dispose();
    }
  });

  for (const kind of [
    'insertBefore',
    'insertAfter',
    'deleteBefore',
    'deleteAfter',
    'replaceBefore',
    'replaceAfter',
  ] as const) {
    test(`pending revision boundary refuses ${kind} without merging decisions`, async () => {
      const r = await DocxEditor.createServer(docx(p('left middle right')), { author: 'Agent' });
      try {
        await r.run(async (c) => {
          const range = c.document.body.search('middle').getFirstOrNullObject();
          await c.sync();
          range.proposeDeletion();
          await c.sync();
        });
        const before = await xml(r);
        await expect(
          r.run(async (c) => {
            const beforeBoundary = kind.endsWith('Before');
            const range = c.document.body
              .search(beforeBoundary ? 'left ' : ' right')
              .getFirstOrNullObject();
            await c.sync();
            if (kind.startsWith('insert'))
              range.proposeInsertion('X', beforeBoundary ? 'After' : 'Before');
            else if (kind.startsWith('delete')) range.proposeDeletion();
            else range.proposeReplacement('X');
            await c.sync();
          })
        ).rejects.toBeDefined();
        expect(await xml(r)).toBe(before);
      } finally {
        r.dispose();
      }
    });
  }

  for (const bad of ['', 'two\nparagraphs', 'invalid\u0000xml']) {
    test(`invalid replacement ${JSON.stringify(bad)} rolls back other writes`, async () => {
      const r = await DocxEditor.createServer(bytes, { author: 'Agent' });
      try {
        const before = await xml(r);
        await expect(
          r.run(async (c) => {
            const range = c.document.body.search('immediately').getFirstOrNullObject();
            await c.sync();
            range.load('text');
            await c.sync();
            c.document.body.insertText('Must not survive', 'End');
            range.proposeReplacement(bad);
            await c.sync();
          })
        ).rejects.toBeDefined();
        expect(await xml(r)).toBe(before);
      } finally {
        r.dispose();
      }
    });
  }

  test('missing author refuses', async () => {
    const r = await DocxEditor.createServer(bytes);
    try {
      await expect(propose(r, 'delete')).rejects.toMatchObject({ code: 'NotSupported' });
    } finally {
      r.dispose();
    }
  });

  test('table-cell text and UTF-16 offsets preserve inline formatting', async () => {
    const r = await DocxEditor.createServer(
      docx(
        '<w:tbl><w:tr><w:tc>' +
          '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>😀 immediately</w:t></w:r></w:p>' +
          '</w:tc></w:tr></w:tbl>'
      ),
      { author: 'Agent' }
    );
    try {
      await propose(r, 'replace');
      const markup = await xml(r);
      expect(markup).toContain('😀');
      expect(markup).toContain('<w:b');
      expect(markup).toContain('<w:tbl');
      await r.run(async (c) => {
        c.document.revisions.rejectAll();
        await c.sync();
      });
      expect(await text(r)).toContain('😀 immediately');
    } finally {
      r.dispose();
    }
  });
});

test('accepting a replacement of a whole formatted run preserves its direct formatting', async () => {
  const runtime = await DocxEditor.createServer(
    docx(
      '<w:p><w:r><w:rPr><w:b/><w:i/><w:color w:val="123456"/></w:rPr><w:t>immediately</w:t></w:r></w:p>'
    ),
    { author: 'Agent' }
  );
  try {
    await propose(runtime, 'replace');
    await runtime.run(async (c) => {
      c.document.revisions.acceptAll();
      await c.sync();
    });
    const accepted = await xml(runtime);
    expect(accepted).not.toContain('<w:del');
    expect(accepted).toContain('with 30 days’ notice');
    expect(accepted).toContain('<w:b');
    expect(accepted).toContain('<w:i');
    expect(accepted).toContain('123456');
  } finally {
    runtime.dispose();
  }
});
