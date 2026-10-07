/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Tracked edits that border the same author's pending proposals.
//
// An agent redlines a clause in steps: replace one sentence, then delete the next. The second
// range starts where the first proposal's inserted text ends. A strike there cannot join any
// decision, so it proceeds and stays separately reviewable. Beside the author's own struck
// text it would join their earlier decision, so that still refuses, as does covering their
// pending text or touching another author's.

import { expect, test } from 'bun:test';
import { DocxEditor, type DocxEditorServerRuntime, type RequestContext } from '../../index.ts';
import { docx, p } from './support/docx.ts';

const open = (body: string, author = 'Agent') => DocxEditor.createServer(docx(body), { author });

async function first(c: RequestContext, text: string) {
  const range = c.document.body.search(text, { matchCase: true }).getFirst();
  await c.sync();
  return range;
}

async function bodyText(r: DocxEditorServerRuntime): Promise<string> {
  return r.run(async (c) => {
    const body = c.document.body;
    body.load('text');
    await c.sync();
    return body.text;
  });
}

async function trackedSteps(
  r: DocxEditorServerRuntime,
  steps: ((c: RequestContext) => Promise<void>)[]
) {
  await r.run(async (c) => {
    c.document.changeTrackingMode = 'TrackMineOnly';
    await c.sync();
    for (const step of steps) {
      await step(c);
      await c.sync();
    }
  });
}

/** Reject the decision covering `text`, leaving every other decision pending. */
async function rejectOne(r: DocxEditorServerRuntime, text: string) {
  await r.run(async (c) => {
    const revisions = c.document.revisions;
    revisions.load('items');
    await c.sync();
    const ranges = revisions.items.map((revision) => {
      const range = revision.range;
      range.load('text');
      return range;
    });
    await c.sync();
    const index = ranges.findIndex((range) => range.text.includes(text));
    expect(index).toBeGreaterThan(-1);
    revisions.items[index]!.reject();
    await c.sync();
  });
}

const replaceThenDelete = (r: DocxEditorServerRuntime) =>
  trackedSteps(r, [
    async (c) => {
      (await first(c, 'Alpha beta.')).insertText('Omitted.', 'Replace');
    },
    async (c) => (await first(c, ' Gamma delta.')).delete(),
  ]);

test('a tracked deletion may begin where the same author’s replacement text ends', async () => {
  for (const action of ['accept', 'reject'] as const) {
    const r = await open(p('Alpha beta. Gamma delta.'));
    try {
      await replaceThenDelete(r);
      await r.run(async (c) => {
        if (action === 'accept') c.document.revisions.acceptAll();
        else c.document.revisions.rejectAll();
        await c.sync();
      });
      expect(await bodyText(r)).toBe(action === 'accept' ? 'Omitted.' : 'Alpha beta. Gamma delta.');
    } finally {
      r.dispose();
    }
  }
});

test('the bordering deletion stays a separate decision from the replacement', async () => {
  const r = await open(p('Alpha beta. Gamma delta.'));
  try {
    await replaceThenDelete(r);
    await rejectOne(r, 'Gamma');
    await r.run(async (c) => {
      c.document.revisions.acceptAll();
      await c.sync();
    });
    expect(await bodyText(r)).toBe('Omitted. Gamma delta.');
  } finally {
    r.dispose();
  }
});

test('a tracked replacement may start where the same author’s insertion ends', async () => {
  const r = await open(p('One two three.'));
  try {
    await trackedSteps(r, [
      async (c) => {
        (await first(c, 'One')).insertText(' and a half', 'After');
      },
      async (c) => {
        (await first(c, ' two')).insertText(' 2', 'Replace');
      },
    ]);
    await rejectOne(r, 'and a half');
    await r.run(async (c) => {
      c.document.revisions.acceptAll();
      await c.sync();
    });
    expect(await bodyText(r)).toBe('One 2 three.');
  } finally {
    r.dispose();
  }
});

for (const [name, replace, target] of [
  ['beside the same author’s deletion', false, ' three.'],
  ['at the start of the same author’s replacement', true, 'One '],
] as const) {
  test(`a tracked deletion still refuses ${name}`, async () => {
    const r = await open(p('One two three.'));
    try {
      await trackedSteps(r, [
        async (c) => {
          const two = await first(c, 'two');
          if (replace) two.insertText('2', 'Replace');
          else two.delete();
        },
      ]);
      await expect(
        trackedSteps(r, [async (c) => (await first(c, target)).delete()])
      ).rejects.toMatchObject({ code: 'NotImplemented' });
    } finally {
      r.dispose();
    }
  });
}

test('a tracked deletion still refuses to cover the same author’s pending text', async () => {
  const r = await open(p('One two three.'));
  try {
    await trackedSteps(r, [
      async (c) => {
        (await first(c, 'two')).insertText('2', 'Replace');
      },
    ]);
    await expect(
      trackedSteps(r, [async (c) => (await first(c, 'One two2 three')).delete()])
    ).rejects.toMatchObject({ code: 'NotImplemented' });
  } finally {
    r.dispose();
  }
});

test('a tracked deletion still refuses to border another author’s proposal', async () => {
  const other = await open(p('One two three.'), 'Other');
  let bytes: Uint8Array;
  try {
    await trackedSteps(other, [
      async (c) => {
        (await first(c, 'two')).insertText('2', 'Replace');
      },
    ]);
    bytes = await other.save();
  } finally {
    other.dispose();
  }
  const r = await DocxEditor.createServer(bytes, { author: 'Agent' });
  try {
    await expect(
      trackedSteps(r, [async (c) => (await first(c, ' three.')).delete()])
    ).rejects.toMatchObject({ code: 'NotImplemented' });
  } finally {
    r.dispose();
  }
});
