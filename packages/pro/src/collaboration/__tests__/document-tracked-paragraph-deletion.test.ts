/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A tracked deletion of whole paragraphs in a collaboration room. One participant proposes
// removing paragraphs while the other edits them. The text the other participant typed is
// never lost: it joins the struck text it was typed into, so reject restores it and accept
// removes it with the paragraphs. Both replicas stay ready and converge through concurrent
// edits in either client order, undo, redo, reconnect, and save and reopen.
import { afterAll, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { canonicalOoxmlFingerprint, readOoxmlPackage } from '@docx-editor.dev/core/store';
import { DocxEditor, type Range, type RequestContext } from '@docx-editor.dev/editor-api/browser';
import { collaborationModule, reviewModule } from '../../index';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support';

const registered = !GlobalRegistrator.isRegistered;
if (registered) GlobalRegistrator.register();
afterAll(() => {
  if (registered) GlobalRegistrator.unregister();
});

const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const THREE = p('First clause') + p('Middle clause') + p('Last clause');
const THREE_WITH_PROPERTIES =
  p('First clause') +
  '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>' +
  '<w:r><w:t xml:space="preserve">Middle clause</w:t></w:r></w:p>' +
  p('Last clause');
const fixture = (body = THREE) => zipDocument(body);

/** Concurrent inserts at one position order by Yjs client id; tests run both orders. */
const ORDERS = { 'Alice first': { alice: 1, bob: 2 }, 'Bob first': { alice: 2, bob: 1 } };
type Order = keyof typeof ORDERS;

async function room(bytes: Uint8Array, order: Order = 'Alice first') {
  const harness = createPeerHarness(
    'tracked-paragraph-deletion',
    { offlineEditing: true },
    ORDERS[order]
  );
  const pair = await harness.pair(bytes);
  const mount = (peer: Peer, author: string) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [reviewModule(), collaborationModule({ session: peer.room.session })],
    });
    const runtime = DocxEditor.createBrowser(editor, {
      author,
      revisionTextView: 'original',
    });
    return {
      peer,
      editor,
      runtime,
      close() {
        runtime.dispose();
        editor.destroy();
        container.remove();
      },
    };
  };
  const peers = [mount(pair.alice, 'Alice'), mount(pair.bob, 'Bob')];
  return {
    pair,
    harness,
    peers,
    mount,
    sync() {
      for (const { peer } of peers) peer.room.session.flushPendingJournals();
    },
    close() {
      for (const peer of peers) peer.close();
      harness.cleanup();
    },
  };
}
type Room = Awaited<ReturnType<typeof room>>;
type Edit = (c: RequestContext) => Promise<void>;

async function main(editor: { save(): Promise<ArrayBuffer | Uint8Array> }) {
  const loaded = readOoxmlPackage(new Uint8Array(await editor.save()));
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package.parts.get(loaded.package.mainDocumentPart)!;
}

/** Both replicas are ready and hold the same canonical tree. Answers its fingerprint. */
async function converged(r: Room): Promise<string> {
  for (const { peer } of r.peers) expect(peer.room.session.statusSnapshot().status).toBe('ready');
  const [left, right] = await Promise.all(r.peers.map((peer) => main(peer.editor)));
  expect(canonicalOoxmlFingerprint(left!)).toBe(canonicalOoxmlFingerprint(right!));
  return canonicalOoxmlFingerprint(left!);
}

const text = (c: RequestContext) => {
  c.document.body.load('text');
  return c.sync().then(() => c.document.body.text);
};

async function decided(bytes: Uint8Array, action: 'acceptAll' | 'rejectAll') {
  const reopened = await DocxEditor.createServer(bytes);
  try {
    return await reopened.run(async (c) => {
      c.document.body.revisions[action]();
      await c.sync();
      return text(c);
    });
  } finally {
    reopened.dispose();
  }
}

/** Both peers' saved bytes decide to the same texts. */
async function expectDecisions(r: Room, reject: string, accept: string | readonly string[]) {
  for (const { editor } of r.peers) {
    const bytes = new Uint8Array(await editor.save());
    expect(await decided(bytes, 'rejectAll')).toBe(reject);
    const accepted = await decided(bytes, 'acceptAll');
    if (typeof accept === 'string') expect(accepted).toBe(accept);
    else expect(accept).toContain(accepted);
  }
}

const tracked =
  (edit: Edit): Edit =>
  async (c) => {
    c.document.changeTrackingMode = 'TrackMineOnly';
    await edit(c);
  };

const deleteParagraph = (index: number) =>
  tracked(async (c) => {
    const paragraphs = c.document.body.paragraphs;
    paragraphs.load('items');
    await c.sync();
    paragraphs.items[index]!.delete();
    await c.sync();
  });
const deleteMiddleParagraph = deleteParagraph(1);

const typeInto =
  (index: number, words: string, where: 'Start' | 'End'): Edit =>
  async (c) => {
    const paragraphs = c.document.body.paragraphs;
    paragraphs.load('items');
    await c.sync();
    paragraphs.items[index]!.insertText(words, where);
    await c.sync();
  };

const onWord =
  (word: string, change: (range: Range) => void): Edit =>
  async (c) => {
    const found = c.document.body.search(word).getFirst();
    await c.sync();
    change(found);
    await c.sync();
  };

/** Alice edits, Bob edits while disconnected, then they reconnect. */
async function concurrently(r: Room, alice: Edit, bob: Edit) {
  r.pair.pause();
  await r.peers[0]!.runtime.run(alice);
  await r.peers[1]!.runtime.run(bob);
  r.sync();
  r.pair.resume();
  r.sync();
}

/** Both peers' saved bytes decide to the same texts, whatever those are. */
async function expectSameDecisions(r: Room) {
  const decisions: string[][] = [];
  for (const { editor } of r.peers) {
    const bytes = new Uint8Array(await editor.save());
    decisions.push([await decided(bytes, 'rejectAll'), await decided(bytes, 'acceptAll')]);
  }
  expect(decisions[0]).toEqual(decisions[1]!);
}

/**
 * Edits that split the same run concurrently keep both splits' text, a known limit of the
 * collaboration model, so those cases check only that the room stays ready and converges.
 */
const CONCURRENT: Record<
  string,
  { bob: Edit; reject?: string; accept?: string | readonly string[] }
> = {
  'types at the paragraph start': {
    bob: typeInto(1, 'Note ', 'Start'),
    reject: 'First clause\rNote Middle clause\rLast clause',
    accept: 'First clause\rLast clause',
  },
  // Typing at the edge of the struck text joins the deletion or stays ordinary text,
  // depending on client order. Ordinary text joins the next paragraph on accept.
  'types at the paragraph end': {
    bob: typeInto(1, ' note', 'End'),
    reject: 'First clause\rMiddle clause note\rLast clause',
    accept: ['First clause\rLast clause', 'First clause\r noteLast clause'],
  },
  'bolds the first word': {
    bob: onWord('Middle', (range) => (range.font.bold = true)),
  },
  'links the first word': {
    bob: onWord('Middle', (range) => (range.hyperlink = 'https://example.com')),
  },
  'proposes deleting the first word': {
    bob: tracked(onWord('Middle ', (range) => range.delete())),
  },
  'inserts a paragraph after it': {
    bob: async (c) => {
      const paragraphs = c.document.body.paragraphs;
      paragraphs.load('items');
      await c.sync();
      paragraphs.items[1]!.insertParagraph('Inserted', 'After');
      await c.sync();
    },
  },
  'centers it': {
    bob: async (c) => {
      const paragraphs = c.document.body.paragraphs;
      paragraphs.load('items');
      await c.sync();
      paragraphs.items[1]!.alignment = 'Centered';
      await c.sync();
    },
    reject: 'First clause\rMiddle clause\rLast clause',
    accept: 'First clause\rLast clause',
  },
  'deletes the same paragraph': {
    bob: deleteMiddleParagraph,
  },
};

for (const properties of [false, true])
  for (const order of Object.keys(ORDERS) as Order[])
    for (const [name, { bob, reject, accept }] of Object.entries(CONCURRENT))
      test(`${order}${properties ? ', paragraph properties' : ''}: a peer that ${name} while another deletes the paragraph stays ready`, async () => {
        const r = await room(fixture(properties ? THREE_WITH_PROPERTIES : THREE), order);
        try {
          await concurrently(r, deleteMiddleParagraph, bob);
          await converged(r);
          if (reject === undefined || accept === undefined) await expectSameDecisions(r);
          else await expectDecisions(r, reject, accept);
        } finally {
          r.close();
        }
      });

const MULTI_RUN: Record<string, string> = {
  'formatting runs':
    '<w:p><w:r><w:t xml:space="preserve">Middle </w:t></w:r>' +
    '<w:r><w:rPr><w:b/></w:rPr><w:t>clause</w:t></w:r></w:p>',
  hyperlink:
    '<w:p><w:r><w:t xml:space="preserve">Middle </w:t></w:r>' +
    '<w:hyperlink w:anchor="target"><w:r><w:t>clause</w:t></w:r></w:hyperlink></w:p>',
  'field result':
    '<w:p><w:r><w:t xml:space="preserve">Middle </w:t></w:r>' +
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    '<w:r><w:instrText xml:space="preserve"> QUOTE "x" </w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    '<w:r><w:t>clause</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
};

for (const order of Object.keys(ORDERS) as Order[])
  for (const [name, middle] of Object.entries(MULTI_RUN)) {
    const bytes = () => fixture(p('First clause') + middle + p('Last clause'));
    test(`${order}: typing in a paragraph of ${name} that another deletes is kept`, async () => {
      const r = await room(bytes(), order);
      try {
        await concurrently(r, deleteMiddleParagraph, typeInto(1, 'Note ', 'Start'));
        await converged(r);
        await expectDecisions(
          r,
          'First clause\rNote Middle clause\rLast clause',
          'First clause\rLast clause'
        );
      } finally {
        r.close();
      }
    });
    test(`${order}: a concurrent deletion of one run of ${name} stays deleted after reject`, async () => {
      const r = await room(bytes(), order);
      try {
        await concurrently(
          r,
          deleteMiddleParagraph,
          onWord('Middle ', (range) => range.delete())
        );
        await converged(r);
        await expectDecisions(r, 'First clause\rclause\rLast clause', 'First clause\rLast clause');
      } finally {
        r.close();
      }
    });
  }

for (const order of Object.keys(ORDERS) as Order[])
  test(`${order}: centering a paragraph without properties while a peer bolds its first word stays ready`, async () => {
    const r = await room(fixture(), order);
    try {
      const center: Edit = async (c) => {
        const paragraphs = c.document.body.paragraphs;
        paragraphs.load('items');
        await c.sync();
        paragraphs.items[1]!.alignment = 'Centered';
        await c.sync();
      };
      await concurrently(
        r,
        center,
        onWord('Middle', (range) => (range.font.bold = true))
      );
      const xml = await converged(r);
      expect(xml).toContain('center');
    } finally {
      r.close();
    }
  });

const centerMiddle: Edit = async (c) => {
  const paragraphs = c.document.body.paragraphs;
  paragraphs.load('items');
  await c.sync();
  paragraphs.items[1]!.alignment = 'Centered';
  await c.sync();
};

for (const properties of [false, true])
  for (const order of Object.keys(ORDERS) as Order[])
    test(`${order}${properties ? ', paragraph properties' : ''}: the author rejects a deletion a peer centered concurrently`, async () => {
      const r = await room(fixture(properties ? THREE_WITH_PROPERTIES : THREE), order);
      try {
        await concurrently(r, deleteMiddleParagraph, centerMiddle);
        await converged(r);
        await r.peers[0]!.runtime.run(async (c) => {
          c.document.body.revisions.rejectAll();
          await c.sync();
        });
        r.sync();
        await converged(r);
        for (const { runtime } of r.peers)
          await runtime.run(async (c) => {
            expect(await text(c)).toBe('First clause\rMiddle clause\rLast clause');
          });
      } finally {
        r.close();
      }
    });

for (const properties of [false, true])
  for (const order of Object.keys(ORDERS) as Order[])
    test(`${order}${properties ? ', paragraph properties' : ''}: a peer bolds the whole paragraph another deletes`, async () => {
      const r = await room(fixture(properties ? THREE_WITH_PROPERTIES : THREE), order);
      try {
        const boldWhole: Edit = async (c) => {
          const paragraphs = c.document.body.paragraphs;
          paragraphs.load('items');
          await c.sync();
          paragraphs.items[1]!.font.bold = true;
          await c.sync();
        };
        await concurrently(r, deleteMiddleParagraph, boldWhole);
        await converged(r);
        await expectDecisions(
          r,
          'First clause\rMiddle clause\rLast clause',
          'First clause\rLast clause'
        );
      } finally {
        r.close();
      }
    });

test('typing after a tracked deletion in the same run stays ordinary text', async () => {
  const r = await room(fixture());
  try {
    await concurrently(
      r,
      tracked(onWord('Middle', (range) => range.delete())),
      typeInto(1, ' kept', 'End')
    );
    await converged(r);
    await expectDecisions(
      r,
      'First clause\rMiddle clause kept\rLast clause',
      'First clause\r clause kept\rLast clause'
    );
  } finally {
    r.close();
  }
});

test('typing in a paragraph outside the deletion stays ordinary text', async () => {
  const r = await room(fixture());
  try {
    await concurrently(r, deleteMiddleParagraph, typeInto(2, ' kept', 'End'));
    await converged(r);
    await expectDecisions(
      r,
      'First clause\rMiddle clause\rLast clause kept',
      'First clause\rLast clause kept'
    );
  } finally {
    r.close();
  }
});

test('a whole-story tracked deletion converges with concurrent typing', async () => {
  const r = await room(fixture());
  try {
    const story = tracked(async (c) => {
      const range = c.document.body.getRange('Content');
      await c.sync();
      range.delete();
      await c.sync();
    });
    await concurrently(r, story, typeInto(1, 'User note: ', 'Start'));
    await converged(r);
    await expectDecisions(r, 'First clause\rUser note: Middle clause\rLast clause', '');
  } finally {
    r.close();
  }
});

test('undo and redo of a tracked paragraph deletion converge on both peers', async () => {
  const r = await room(fixture());
  try {
    const original = await converged(r);
    await r.peers[0]!.runtime.run(deleteMiddleParagraph);
    r.sync();
    const deleted = await converged(r);
    expect(deleted).not.toBe(original);

    expect(r.peers[0]!.editor.exec({ type: 'undo' }).ok).toBe(true);
    r.sync();
    expect(await converged(r)).toBe(original);

    expect(r.peers[0]!.editor.exec({ type: 'redo' }).ok).toBe(true);
    r.sync();
    expect(await converged(r)).toBe(deleted);
  } finally {
    r.close();
  }
});

async function mainXml(editor: { save(): Promise<ArrayBuffer | Uint8Array> }) {
  const xml = strFromU8(unzipSync(new Uint8Array(await editor.save()))['word/document.xml']!);
  return xml.slice(xml.indexOf('<w:body>'), xml.indexOf('</w:body>'));
}

test('a peer that did not propose the deletion rejects it', async () => {
  const r = await room(fixture());
  try {
    await r.peers[0]!.runtime.run(deleteMiddleParagraph);
    r.sync();
    await r.peers[1]!.runtime.run(async (c) => {
      c.document.body.revisions.rejectAll();
      await c.sync();
    });
    r.sync();
    await converged(r);
    // The text and paragraph come back. The containers the author's replica created keep
    // replica-scoped ids elsewhere, so this replica cannot tell them from source containers
    // and leaves them empty, which reads the same as no properties.
    const xml = await mainXml(r.peers[0]!.editor);
    expect(xml).toContain('<w:pPr><w:rPr/></w:pPr><w:r><w:t>Middle clause</w:t></w:r>');
    expect(xml).not.toContain('<w:del');
    for (const { runtime } of r.peers)
      await runtime.run(async (c) => {
        expect(await text(c)).toBe('First clause\rMiddle clause\rLast clause');
      });
  } finally {
    r.close();
  }
});

test('a peer undoes its edit after a concurrent tracked paragraph deletion', async () => {
  const r = await room(fixture());
  try {
    await concurrently(r, deleteMiddleParagraph, typeInto(1, 'Note ', 'Start'));
    await converged(r);
    expect(r.peers[1]!.editor.exec({ type: 'undo' }).ok).toBe(true);
    r.sync();
    await converged(r);
    await expectDecisions(
      r,
      'First clause\rMiddle clause\rLast clause',
      'First clause\rLast clause'
    );
  } finally {
    r.close();
  }
});

test('a peer that edits offline and reconnects converges with a tracked paragraph deletion', async () => {
  const r = await room(fixture());
  try {
    r.pair.pause();
    await r.peers[0]!.runtime.run(deleteMiddleParagraph);
    await r.peers[1]!.runtime.run(typeInto(1, 'Offline ', 'Start'));
    r.sync();
    // Bob's session closes with his edit still held back, then reconnects on the same replica.
    const bob = r.peers.pop()!;
    bob.close();
    const remounted = await r.harness.remount(bob.peer);
    r.peers.push(r.mount(remounted, 'Bob'));
    r.pair.resume();
    r.sync();
    await converged(r);
    await expectDecisions(
      r,
      'First clause\rOffline Middle clause\rLast clause',
      'First clause\rLast clause'
    );
  } finally {
    r.close();
  }
});

test('collaboration still refuses a tracked replacement across paragraphs', async () => {
  const r = await room(fixture());
  try {
    const before = await converged(r);
    await expect(
      r.peers[0]!.runtime.run(
        tracked(async (c) => {
          const range = c.document.body.getRange('Content');
          await c.sync();
          range.insertText('Replaced', 'Replace');
          await c.sync();
        })
      )
    ).rejects.toMatchObject({ code: 'NotSupported' });
    expect(await converged(r)).toBe(before);
  } finally {
    r.close();
  }
});

test('a tracked deletion of a paragraph with many runs costs time linear in its runs', async () => {
  const runs = Array.from(
    { length: 2000 },
    (_, index) =>
      `<w:r>${index % 2 ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">w${index} </w:t></w:r>`
  ).join('');
  const r = await room(fixture(p('First clause') + `<w:p>${runs}</w:p>` + p('Last clause')));
  try {
    const started = performance.now();
    await r.peers[0]!.runtime.run(deleteMiddleParagraph);
    r.sync();
    // About 1 s here. A cost that grows with runs times struck text would take over 10 s.
    expect(performance.now() - started).toBeLessThan(6000);
    await converged(r);
  } finally {
    r.close();
  }
}, 120_000);

test('a tracked deletion of 2000 paragraphs in a room stays fast', async () => {
  const count = 2000;
  const body = Array.from({ length: count }, (_, index) => p(`Paragraph ${index}`)).join('');
  const r = await room(fixture(body));
  try {
    const started = performance.now();
    await r.peers[0]!.runtime.run(
      tracked(async (c) => {
        const range = c.document.body.getRange('Content');
        await c.sync();
        range.delete();
        await c.sync();
      })
    );
    r.sync();
    // About 1.5 s here, and close to linear in paragraphs; it took 7.5 to 11 s before. The
    // budget leaves room for a suite that runs files in parallel.
    expect(performance.now() - started).toBeLessThan(15_000);
    await converged(r);
    const xml = await mainXml(r.peers[1]!.editor);
    expect(xml.match(/<w:rPr><w:del /g)).toHaveLength(count - 1);
    expect(xml.match(/<w:delText>/g)).toHaveLength(count);
  } finally {
    r.close();
  }
}, 300_000);
