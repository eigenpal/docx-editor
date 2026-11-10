/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createRuntime } from '../runtime.ts';
import { openHost } from './support/hosts.ts';
import { commentedDocx } from './support/docx.ts';

const AUTHOR = 'Ada Lovelace';
function setup(bytes = commentedDocx(), author: string | undefined = AUTHOR) {
  const host = openHost(bytes);
  const runtime = createRuntime({ host, save: true, author });
  return { host, runtime };
}

function unsupportedBody(body: string): Uint8Array {
  const files = unzipSync(commentedDocx());
  files['word/comments.xml'] = strToU8(
    strFromU8(files['word/comments.xml']!).replace(
      '<w:p><w:r><w:t>Is this the right clause?</w:t></w:r></w:p>',
      body
    )
  );
  return zipSync(files);
}

test('content loads explicitly and queues an escaped, multiline replacement until sync', async () => {
  const { host, runtime } = setup();
  try {
    await runtime.run(async (context) => {
      const comment = context.document.comments.getFirst();
      expect(() => comment.content).toThrow();
      comment.load('content,authorName,id');
      await context.sync();
      expect(comment.content).toBe('Is this the right clause?');
      const before = host.revision();
      comment.content = 'Use <30> & "days".\nSecond line 😀';
      expect(host.revision()).toBe(before);
      expect(comment.content).toBe('Is this the right clause?');
      await context.sync();
      comment.load('content,text,authorName,id');
      await context.sync();
      expect(comment.content).toBe('Use <30> & "days".\nSecond line 😀');
      expect(comment.text).toBe(comment.content);
      expect(comment.authorName).toBe(AUTHOR);
      expect(comment.id).toBe('7');
    });
    const saved = host.save();
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error('save refused');
    const reopened = setup(saved.bytes);
    try {
      await reopened.runtime.run(async (context) => {
        const comment = context.document.comments.getFirst();
        comment.load('content');
        await context.sync();
        expect(comment.content).toBe('Use <30> & "days".\nSecond line 😀');
      });
    } finally {
      reopened.runtime.dispose();
    }
  } finally {
    runtime.dispose();
  }
});

test('a no-op edit keeps the revision and resolved thread; reply content remains independently editable', async () => {
  const { host, runtime } = setup();
  try {
    await runtime.run(async (context) => {
      const comment = context.document.comments.getFirst();
      comment.load('content');
      await context.sync();
      const before = host.revision();
      comment.content = comment.content;
      await context.sync();
      expect(host.revision()).toBe(before);
      const reply = comment.reply('Original reply');
      await context.sync();
      comment.resolved = true;
      await context.sync();
      reply.content = 'Revised reply';
      await context.sync();
      comment.load('content,resolved');
      reply.load('content,authorName');
      await context.sync();
      expect(reply.content).toBe('Revised reply');
      expect(reply.authorName).toBe(AUTHOR);
      expect(comment.content).toBe('Is this the right clause?');
      expect(comment.resolved).toBe(true);
    });
  } finally {
    runtime.dispose();
  }
});

test('a pending comment edge can be edited without a redundant initial sync', async () => {
  const { runtime } = setup();
  try {
    await runtime.run(async (context) => {
      const comment = context.document.comments.getFirst();
      comment.content = 'Direct replacement';
      await context.sync();
      comment.load('content');
      await context.sync();
      expect(comment.content).toBe('Direct replacement');
    });
  } finally {
    runtime.dispose();
  }
});

test('runtime identity cannot edit another author and a missing identity fails explicitly', async () => {
  for (const author of ['Other author', '']) {
    const { host, runtime } = setup(commentedDocx(), author);
    const before = host.revision();
    try {
      await expect(
        runtime.run(async (context) => {
          context.document.comments.getFirst().content = 'Not mine';
          await context.sync();
        })
      ).rejects.toMatchObject({
        code: 'NotSupported',
        debugInfo: {
          innerError: {
            code: author ? 'edit.comment-author-mismatch' : 'edit.comment-author-required',
          },
        },
      });
      expect(host.revision()).toBe(before);
    } finally {
      runtime.dispose();
    }
  }
});

test('another run changes the document after load: old content write refuses and a fresh read permits retry', async () => {
  const { runtime } = setup();
  try {
    await runtime.run(async (context) => {
      const comment = context.document.comments.getFirst();
      comment.load('content');
      await context.sync();
      await runtime.run(async (other) => {
        other.document.comments.getFirst().content = 'Remote edit';
        await other.sync();
      });
      comment.content = 'Stale edit';
      await expect(context.sync()).rejects.toMatchObject({ code: 'StaleDocument' });
      comment.load('content');
      await context.sync();
      expect(comment.content).toBe('Remote edit');
      comment.content = 'Considered replacement';
      await context.sync();
    });
  } finally {
    runtime.dispose();
  }
});

test('mixed comment edits and document writes refuse atomically', async () => {
  const { host, runtime } = setup();
  try {
    const before = host.revision();
    await expect(
      runtime.run(async (context) => {
        context.document.comments.getFirst().content = 'Must not land';
        context.document.body.insertText('Also must not land', 'End');
        await context.sync();
      })
    ).rejects.toMatchObject({ code: 'ConflictingChanges' });
    expect(host.revision()).toBe(before);
  } finally {
    runtime.dispose();
  }
});

for (const body of [
  '<w:p><w:ins w:id="1" w:author="Ada"><w:r><w:t>Pending</w:t></w:r></w:ins></w:p>',
  '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:t>Field</w:t></w:r></w:p>',
  '<w:p><w:hyperlink w:anchor="target"><w:r><w:t>Linked</w:t></w:r></w:hyperlink></w:p>',
]) {
  test(`unsupported comment structure refuses before write: ${body.slice(0, 30)}`, async () => {
    const { host, runtime } = setup(unsupportedBody(body));
    try {
      const before = host.revision();
      await expect(
        runtime.run(async (context) => {
          context.document.comments.getFirst().content = 'Replacement';
          await context.sync();
        })
      ).rejects.toMatchObject({
        code: 'NotSupported',
        debugInfo: { innerError: { code: 'edit.unsupported-content' } },
      });
      expect(host.revision()).toBe(before);
    } finally {
      runtime.dispose();
    }
  });
}

for (const text of ['', '\u0001', 'x'.repeat(65536)]) {
  test(`invalid replacement refuses without mutation: ${text.length}`, async () => {
    const { host, runtime } = setup();
    try {
      const before = host.revision();
      await expect(
        runtime.run(async (context) => {
          context.document.comments.getFirst().content = text;
          await context.sync();
        })
      ).rejects.toMatchObject({ code: 'InvalidArgument' });
      expect(host.revision()).toBe(before);
    } finally {
      runtime.dispose();
    }
  });
}

test('comment and reply replacements batch atomically; duplicate setters follow queue order', async () => {
  const { host, runtime } = setup();
  try {
    await runtime.run(async (context) => {
      const root = context.document.comments.getFirst();
      const reply = root.reply('Before reply');
      await context.sync();
      const before = host.revision();
      root.content = 'Intermediate';
      root.content = 'After root';
      reply.content = 'After reply';
      root.load('content');
      reply.load('content');
      await context.sync();
      expect(host.revision()).toBe(before + 1);
      expect(root.content).toBe('After root');
      expect(reply.content).toBe('After reply');
    });
  } finally {
    runtime.dispose();
  }
});

test('loads before and after replacement observe their ordered text without extra syncs', async () => {
  const { runtime } = setup();
  try {
    await runtime.run(async (context) => {
      const before = context.document.comments.getFirst();
      const after = context.document.comments.getFirst();
      await context.sync();
      before.load('content');
      after.content = 'Changed\r\nwith tab\tand break';
      after.load('content');
      await context.sync();
      expect(before.content).toBe('Is this the right clause?');
      expect(after.content).toBe('Changed\nwith tab\tand break');
      after.load('content');
      await context.sync();
      expect(after.content).toBe('Changed\nwith tab\tand break');
    });
  } finally {
    runtime.dispose();
  }
});

test('one refused edit rolls back every replacement and does not hydrate speculative loads', async () => {
  const { host, runtime } = setup();
  try {
    await runtime.run(async (context) => {
      const root = context.document.comments.getFirst();
      const reply = root.reply('Before reply');
      await context.sync();
      root.load('content');
      reply.load('content');
      await context.sync();
      const before = host.revision();
      root.content = 'Must not land';
      root.load('content');
      reply.content = '\u0001';
      await expect(context.sync()).rejects.toMatchObject({ code: 'InvalidArgument' });
      expect(host.revision()).toBe(before);
      expect(root.content).toBe('Is this the right clause?');
      expect(reply.content).toBe('Before reply');
    });
  } finally {
    runtime.dispose();
  }
});
