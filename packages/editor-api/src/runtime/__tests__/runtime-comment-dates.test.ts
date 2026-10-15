// Comments and replies written through the editing API record when they were written, as tracked
// changes do: `Comment.creationDate` reads it back, and the saved file carries it as `w:date`.

import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { DocxEditor } from '../../index.ts';
import { docx, p } from './support/docx.ts';

describe('comment creation dates', () => {
  test('a new comment and its reply are stamped with the time they were written', async () => {
    const runtime = await DocxEditor.createServer(docx(p('server anchor')), {
      author: 'Server Reviewer',
    });
    const before = Date.now() - 1_000;
    const dates = await runtime.run(async (context) => {
      const matches = context.document.body.search('anchor', { matchCase: true });
      matches.load('items');
      await context.sync();
      const comment = matches.items[0]!.insertComment('Root comment.');
      await context.sync();
      comment.reply('A reply.');
      await context.sync();
      const comments = context.document.comments;
      comments.load('items');
      await context.sync();
      const root = comments.items[0]!;
      root.load('creationDate');
      root.replies.load('items/creationDate');
      await context.sync();
      return [root.creationDate, root.replies.items[0]!.creationDate];
    });
    const after = Date.now() + 1_000;
    for (const date of dates) {
      expect(date).toBeInstanceOf(Date);
      expect(date!.getTime()).toBeGreaterThanOrEqual(before);
      expect(date!.getTime()).toBeLessThanOrEqual(after);
    }

    const xml = strFromU8(unzipSync(await runtime.save())['word/comments.xml']!);
    const stamps = [...xml.matchAll(/<w:comment [^>]*w:date="([^"]+)"/g)].map((match) => match[1]);
    expect(stamps).toHaveLength(2);
    // Written to the second, as the editor's own comment writes are.
    for (const stamp of stamps) expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    runtime.dispose();
  });
});
