/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor, createDocumentRefresh } from '@docx-editor.dev/core/editor';
import { DocxEditor } from '@docx-editor.dev/editor-api/browser';
import { collaborationModule, reviewModule } from '../../index';
import { createPeerHarness, zipDocument } from './document-peer-support';
const sample = () => zipDocument('<w:p><w:r><w:t>Anchor</w:t></w:r></w:p>');

const registered = !GlobalRegistrator.isRegistered;
if (registered) GlobalRegistrator.register();
afterAll(() => {
  if (registered) GlobalRegistrator.unregister();
});

async function room(bytes: Uint8Array) {
  const harness = createPeerHarness('rich-api', { offlineEditing: true });
  const pair = await harness.pair(bytes);
  const peers = [pair.alice, pair.bob].map((peer) => {
    peer.detach();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = createDocxEditor({
      container,
      document: peer.room.document,
      modules: [reviewModule(), collaborationModule({ session: peer.room.session })],
    });
    return {
      ...peer,
      editor,
      runtime: DocxEditor.createBrowser(editor, { author: 'Writer', revisionTextView: 'original' }),
      container,
    };
  });
  return {
    pair,
    harness,
    peers,
    sync() {
      for (const peer of peers) peer.room.session.flushPendingJournals();
    },
    close() {
      for (const peer of peers) {
        peer.runtime.dispose();
        peer.editor.destroy();
        peer.container.remove();
      }
      harness.cleanup();
    },
  };
}

test('new table suggestions and concurrent cell edits converge and survive review, undo, and reopen', async () => {
  const r = await room(
    zipDocument(
      '<w:p><w:r><w:t>Title</w:t></w:r></w:p>' +
        '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4680"/></w:tblGrid>' +
        '<w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>Before</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
        '<w:p><w:r><w:t>Tail</w:t></w:r></w:p>'
    )
  );
  try {
    r.pair.pause();
    await r.peers[0]!.runtime.run(async (c) => {
      c.document.changeTrackingMode = 'TrackMineOnly';
      const table = c.document.body.paragraphs
        .getLast()
        .getRange('Content')
        .insertTable(2, 1, 'Before', [['Header'], ['Added']]);
      await c.sync();
      table.headerRowCount = 1;
      await c.sync();
    });
    await r.peers[1]!.runtime.run(async (c) => {
      c.document.body.tables.getFirst().getCell(0, 0).value = 'After';
      await c.sync();
    });
    r.sync();
    r.pair.resume();
    r.sync();
    expect(r.peers[0]!.editor.surface!.session.bodyText()).toBe(
      r.peers[1]!.editor.surface!.session.bodyText()
    );
    const [alice, bob] = r.peers;
    const paragraphId = await alice!.runtime.run(async (c) => {
      c.document.body.tables.load('items');
      await c.sync();
      const paragraph = c.document.body.tables.items[1]!.getCell(1, 0).body.paragraphs.getFirst();
      paragraph.load('uniqueLocalId');
      await c.sync();
      return paragraph.uniqueLocalId;
    });
    alice!.room.session.setLocalSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 3 },
    });
    applyAwarenessUpdate(
      bob!.awareness,
      encodeAwarenessUpdate(alice!.awareness, [alice!.awareness.clientID]),
      'test'
    );
    expect(bob!.room.session.remoteSelections()[0]?.head).toMatchObject({ paragraphId, offset: 3 });
    const rejoined = await r.harness.join(r.pair.alice, 'rejoined');
    const joinedContainer = document.createElement('div');
    document.body.append(joinedContainer);
    const joinedEditor = createDocxEditor({
      container: joinedContainer,
      document: rejoined.room.document,
      modules: [reviewModule(), collaborationModule({ session: rejoined.room.session })],
    });
    const joinedRuntime = DocxEditor.createBrowser(joinedEditor);
    try {
      await joinedRuntime.run(async (c) => {
        c.document.body.tables.load('items');
        await c.sync();
        for (const table of c.document.body.tables.items) table.load(['values', 'headerRowCount']);
        await c.sync();
        expect(c.document.body.tables.items.map((table) => table.values)).toEqual([
          [['After']],
          [['Header'], ['Added']],
        ]);
        expect(c.document.body.tables.items[1]!.headerRowCount).toBe(1);
      });
    } finally {
      joinedRuntime.dispose();
      joinedEditor.destroy();
      joinedContainer.remove();
      r.harness.leave(rejoined);
    }
    for (const peer of r.peers) {
      const bytes = new Uint8Array(await peer.editor.save());
      for (const decision of ['acceptAll', 'rejectAll'] as const) {
        const reopened = await DocxEditor.createServer(bytes);
        try {
          await reopened.run(async (c) => {
            c.document.body.revisions[decision]();
            await c.sync();
            c.document.body.tables.load('items');
            c.document.revisions.load('items');
            await c.sync();
            expect(c.document.revisions.items).toHaveLength(0);
            expect(c.document.body.tables.items).toHaveLength(decision === 'acceptAll' ? 2 : 1);
            for (const table of c.document.body.tables.items) table.load('values');
            await c.sync();
            expect(c.document.body.tables.items[0]!.values).toEqual([['After']]);
            if (decision === 'acceptAll')
              expect(c.document.body.tables.items[1]!.values).toEqual([['Header'], ['Added']]);
          });
        } finally {
          reopened.dispose();
        }
      }
    }
    expect(r.peers[0]!.editor.exec({ type: 'undo' }).ok).toBe(true);
    r.sync();
    expect(r.peers[0]!.editor.surface!.session.bodyText()).toBe(
      r.peers[1]!.editor.surface!.session.bodyText()
    );
    expect(r.peers[0]!.editor.exec({ type: 'redo' }).ok).toBe(true);
    r.sync();
    expect(r.peers[0]!.editor.surface!.session.bodyText()).toBe(
      r.peers[1]!.editor.surface!.session.bodyText()
    );
  } finally {
    r.close();
  }
});

test('whole-file refresh refuses real collaborative editors while ordinary edits still converge', async () => {
  const r = await room(sample());
  try {
    r.pair.pause();
    for (const [index, peer] of r.peers.entries()) {
      const refresh = createDocumentRefresh(peer.editor);
      const before = new Uint8Array(await peer.editor.save());
      await expect(refresh.capture()).rejects.toMatchObject({ code: 'collaboration' });
      expect(
        await refresh.applyUpdate({
          submission: { id: 'foreign', bytes: before.buffer as ArrayBuffer },
          sequence: 1,
          bytes: sample(),
        })
      ).toMatchObject({ ok: false, code: 'collaboration' });
      expect(new Uint8Array(await peer.editor.save())).toEqual(before);
      await peer.runtime.run(async (c) => {
        c.document.body.insertParagraph(`Peer ${index}`, 'End');
        await c.sync();
      });
      r.sync();
    }
    r.pair.resume();
    r.sync();
    expect(r.peers[0]!.editor.surface!.session.bodyText()).toBe(
      r.peers[1]!.editor.surface!.session.bodyText()
    );
    expect(r.peers[0]!.editor.exec({ type: 'undo' }).ok).toBe(true);
    r.sync();
    expect(r.peers[0]!.editor.exec({ type: 'redo' }).ok).toBe(true);
    r.sync();
    for (const peer of r.peers) {
      const container = document.createElement('div');
      document.body.append(container);
      const reopened = createDocxEditor({ container, document: await peer.editor.save() });
      try {
        expect(reopened.surface!.session.bodyText()).toBe(peer.editor.surface!.session.bodyText());
      } finally {
        reopened.destroy();
        container.remove();
      }
    }
  } finally {
    r.close();
  }
});

for (const { tracked, undoBeforeMerge } of [
  { tracked: false, undoBeforeMerge: false },
  { tracked: true, undoBeforeMerge: false },
  { tracked: false, undoBeforeMerge: true },
  { tracked: true, undoBeforeMerge: true },
]) {
  test(`concurrent new lists after rewrite converge with tracking ${tracked}, offline undo ${undoBeforeMerge}`, async () => {
    const r = await room(sample());
    try {
      await r.peers[0]!.runtime.run(async (c) => {
        c.document.body.clear();
        await c.sync();
        c.document.body.insertText('Title', 'Start');
        await c.sync();
        c.document.body.insertParagraph('First list', 'End');
        await c.sync();
        c.document.body.insertParagraph('Second list', 'End');
        await c.sync();
      });
      r.sync();
      r.pair.pause();
      for (const [i, peer] of r.peers.entries()) {
        await peer.runtime.run(async (c) => {
          c.document.body.paragraphs.load('items');
          await c.sync();
          c.document.changeTrackingMode = tracked ? 'TrackMineOnly' : 'Off';
          const list = c.document.body.paragraphs.items[i + 1]!.startNewList();
          await c.sync();
          list.setLevelNumbering(0, 'Arabic', [0, '.']);
          await c.sync();
        });
        r.sync();
      }
      if (undoBeforeMerge) {
        expect(r.peers[0]!.editor.exec({ type: 'undo' }).ok).toBe(true);
        r.sync();
      }
      r.pair.resume();
      r.sync();
      if (undoBeforeMerge) {
        expect(r.peers[0]!.room.session.statusSnapshot().status).toBe('ready');
        expect(r.peers[0]!.editor.exec({ type: 'redo' }).ok).toBe(true);
        r.sync();
      }
      for (const peer of r.peers) {
        expect(peer.editor.exec({ type: 'undo' }).ok).toBe(true);
        r.sync();
        const redo = peer.editor.exec({ type: 'redo' });
        expect(redo.ok, JSON.stringify({ redo, status: peer.room.session.statusSnapshot() })).toBe(
          true
        );
        r.sync();
        expect(peer.room.session.statusSnapshot().status).toBe('ready');
      }
      for (const peer of r.peers) {
        const bytes = new Uint8Array(await peer.editor.save());
        const numbering = strFromU8(unzipSync(bytes)['word/numbering.xml']!);
        expect(numbering.match(/<w:num\b/g)).toHaveLength(2);
        expect(numbering.match(/<w:numFmt w:val="decimal"/g)).toHaveLength(2);
        const saved = await DocxEditor.createServer(bytes);
        try {
          await saved.run(async (c) => {
            c.document.body.lists.load('items');
            await c.sync();
            expect(c.document.body.lists.items).toHaveLength(2);
            if (tracked) {
              c.document.body.revisions.rejectAll();
              await c.sync();
              c.document.body.lists.load('items');
              await c.sync();
              expect(c.document.body.lists.items).toHaveLength(0);
            }
          });
        } finally {
          saved.dispose();
        }
      }
    } finally {
      r.close();
    }
  });
}

test('row suggestions synchronize with concurrent cell edits and survive undo, redo, and reopen', async () => {
  const baseline = await DocxEditor.createServer(sample());
  await baseline.run(async (c) => {
    c.document.body.getRange('Start').insertTable(3, 2, 'Before', [
      ['Name', 'Date'],
      ['Remove', 'October'],
      ['Keep', 'November'],
    ]);
    await c.sync();
  });
  const bytes = await baseline.save();
  baseline.dispose();
  const r = await room(bytes);
  try {
    r.pair.pause();
    await r.peers[0]!.runtime.run(async (c) => {
      c.document.changeTrackingMode = 'TrackMineOnly';
      const table = c.document.body.tables.getFirst();
      table.addRows('End', 1, [['Added', 'December']]);
      await c.sync();
      table.deleteRows(1, 1);
      await c.sync();
    });
    r.sync();
    await r.peers[1]!.runtime.run(async (c) => {
      c.document.body.tables.getFirst().getCell(1, 0).value = 'Concurrent value';
      await c.sync();
    });
    r.sync();
    r.pair.resume();
    r.sync();
    // Neither participant can replace the existing row deletion proposal.
    for (const peer of r.peers) {
      const before = strFromU8(
        unzipSync(new Uint8Array(await peer.editor.save()))['word/document.xml']!
      );
      await expect(
        peer.runtime.run(async (c) => {
          c.document.changeTrackingMode = 'TrackMineOnly';
          c.document.body.tables.getFirst().deleteRows(1, 1);
          await c.sync();
        })
      ).rejects.toMatchObject({ code: 'NotImplemented' });
      expect(
        strFromU8(unzipSync(new Uint8Array(await peer.editor.save()))['word/document.xml']!)
      ).toBe(before);
      expect(peer.room.session.statusSnapshot().status).toBe('ready');
    }
    const [alice, bob] = r.peers;
    const paragraphId = await alice!.runtime.run(async (c) => {
      const paragraph = c.document.body.tables.getFirst().getCell(3, 0).body.paragraphs.getFirst();
      paragraph.load('uniqueLocalId');
      await c.sync();
      return paragraph.uniqueLocalId;
    });
    alice!.room.session.setLocalSelection({
      anchor: { paragraphId, offset: 0 },
      head: { paragraphId, offset: 3 },
    });
    applyAwarenessUpdate(
      bob!.awareness,
      encodeAwarenessUpdate(alice!.awareness, [alice!.awareness.clientID]),
      'test'
    );
    expect(bob!.room.session.remoteSelections()[0]?.head.offset).toBe(3);
    expect(r.peers[0]!.editor.exec({ type: 'undo' }).ok).toBe(true);
    r.sync();
    expect(r.peers[0]!.editor.exec({ type: 'redo' }).ok).toBe(true);
    r.sync();
    expect(bob!.room.session.remoteSelections()[0]?.head.offset).toBe(3);
    for (const peer of r.peers) {
      expect(peer.room.session.statusSnapshot().status).toBe('ready');
      for (const decision of ['acceptAll', 'rejectAll'] as const) {
        const saved = await DocxEditor.createServer(new Uint8Array(await peer.editor.save()));
        try {
          await saved.run(async (c) => {
            c.document.body.revisions[decision]();
            await c.sync();
            const table = c.document.body.tables.getFirst();
            table.load('values');
            await c.sync();
            expect(table.values).toEqual(
              decision === 'acceptAll'
                ? [
                    ['Name', 'Date'],
                    ['Keep', 'November'],
                    ['Added', 'December'],
                  ]
                : [
                    ['Name', 'Date'],
                    ['Concurrent value', 'October'],
                    ['Keep', 'November'],
                  ]
            );
          });
        } finally {
          saved.dispose();
        }
      }
    }
  } finally {
    r.close();
  }
});

test('a remote pending deletion prevents proposing deletion of the final surviving row', async () => {
  const baseline = await DocxEditor.createServer(sample());
  await baseline.run(async (c) => {
    c.document.body.getRange('Start').insertTable(2, 1, 'Before', [['Remove'], ['Keep']]);
    await c.sync();
  });
  const bytes = await baseline.save();
  baseline.dispose();
  const r = await room(bytes);
  try {
    await r.peers[0]!.runtime.run(async (c) => {
      c.document.changeTrackingMode = 'TrackMineOnly';
      c.document.body.tables.getFirst().deleteRows(0, 1);
      await c.sync();
    });
    r.sync();
    const bob = r.peers[1]!;
    const before = strFromU8(
      unzipSync(new Uint8Array(await bob.editor.save()))['word/document.xml']!
    );
    await expect(
      bob.runtime.run(async (c) => {
        c.document.changeTrackingMode = 'TrackMineOnly';
        c.document.body.tables.getFirst().deleteRows(1, 1);
        await c.sync();
      })
    ).rejects.toMatchObject({ code: 'NotSupported' });
    expect(
      strFromU8(unzipSync(new Uint8Array(await bob.editor.save()))['word/document.xml']!)
    ).toBe(before);
    expect(r.peers[0]!.editor.exec({ type: 'undo' }).ok).toBe(true);
    r.sync();
    expect(r.peers[0]!.editor.exec({ type: 'redo' }).ok).toBe(true);
    r.sync();
    for (const peer of r.peers) {
      const reopened = await DocxEditor.createServer(new Uint8Array(await peer.editor.save()));
      try {
        await reopened.run(async (c) => {
          c.document.body.revisions.acceptAll();
          await c.sync();
          const table = c.document.body.tables.getFirst();
          table.load('values');
          await c.sync();
          expect(table.values).toEqual([['Keep']]);
        });
      } finally {
        reopened.dispose();
      }
    }
  } finally {
    r.close();
  }
});

test('independent concurrent row deletions converge and remain reviewable', async () => {
  const baseline = await DocxEditor.createServer(sample());
  await baseline.run(async (c) => {
    c.document.body.getRange('Start').insertTable(2, 1, 'Before', [['First'], ['Second']]);
    await c.sync();
  });
  const bytes = await baseline.save();
  baseline.dispose();
  const r = await room(bytes);
  try {
    r.pair.pause();
    for (const [index, peer] of r.peers.entries()) {
      await peer.runtime.run(async (c) => {
        c.document.changeTrackingMode = 'TrackMineOnly';
        c.document.body.tables.getFirst().deleteRows(index, 1);
        await c.sync();
      });
      r.sync();
    }
    r.pair.resume();
    r.sync();
    for (const peer of r.peers) {
      expect(peer.room.session.statusSnapshot().status).toBe('ready');
      for (const decision of ['acceptAll', 'rejectAll'] as const) {
        const saved = await DocxEditor.createServer(new Uint8Array(await peer.editor.save()));
        try {
          await saved.run(async (c) => {
            c.document.body.revisions[decision]();
            await c.sync();
            c.document.body.revisions.load('items');
            c.document.body.tables.load('items');
            await c.sync();
            expect(c.document.body.revisions.items).toHaveLength(0);
            expect(c.document.body.tables.items).toHaveLength(decision === 'acceptAll' ? 0 : 1);
          });
        } finally {
          saved.dispose();
        }
      }
    }
  } finally {
    r.close();
  }
});

test('collaboration refuses tracked paragraph-range deletion and preserves concurrent edits', async () => {
  const r = await room(
    zipDocument(
      '<w:p><w:r><w:t>First clause</w:t></w:r></w:p><w:p><w:r><w:t>Last clause</w:t></w:r></w:p>'
    )
  );
  try {
    r.pair.pause();
    const before = new Uint8Array(await r.peers[0]!.editor.save());
    await expect(
      r.peers[0]!.runtime.run(async (c) => {
        c.document.changeTrackingMode = 'TrackMineOnly';
        const range = c.document.body.getRange('Content');
        await c.sync();
        range.delete();
        await c.sync();
      })
    ).rejects.toMatchObject({ code: 'NotSupported' });
    expect(new Uint8Array(await r.peers[0]!.editor.save())).toEqual(before);
    await r.peers[1]!.runtime.run(async (c) => {
      c.document.body.paragraphs.getLast().insertText('User note: ', 'Start');
      await c.sync();
    });
    r.sync();
    r.pair.resume();
    r.sync();
    expect(r.peers[0]!.editor.surface!.session.bodyText()).toBe(
      r.peers[1]!.editor.surface!.session.bodyText()
    );
    expect(r.peers[0]!.editor.surface!.session.bodyText()).toContain('User note: ');
    for (const peer of r.peers) {
      const reopened = await DocxEditor.createServer(new Uint8Array(await peer.editor.save()));
      try {
        await reopened.run(async (c) => {
          c.document.body.load('text');
          c.document.revisions.load('items');
          await c.sync();
          expect(c.document.body.text).toBe('First clause\rUser note: Last clause');
          expect(c.document.revisions.items).toHaveLength(0);
        });
      } finally {
        reopened.dispose();
      }
    }
  } finally {
    r.close();
  }
});

test('collaboration refuses tracked whole-cell values before they can absorb concurrent text', async () => {
  const bytes = zipDocument(
    '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4680"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>Cell text</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p/>'
  );
  const r = await room(bytes);
  try {
    r.pair.pause();
    const before = new Uint8Array(await r.peers[0]!.editor.save());
    for (const matrix of [false, true]) {
      await expect(
        r.peers[0]!.runtime.run(async (c) => {
          c.document.changeTrackingMode = 'TrackMineOnly';
          const table = c.document.body.tables.getFirst();
          if (matrix) table.values = [['Updated']];
          else table.getCell(0, 0).value = 'Updated';
          await c.sync();
        })
      ).rejects.toMatchObject({ code: 'NotSupported' });
      expect(new Uint8Array(await r.peers[0]!.editor.save())).toEqual(before);
    }
    await r.peers[1]!.runtime.run(async (c) => {
      c.document.body.tables.getFirst().getCell(0, 0).body.insertText('User note: ', 'Start');
      await c.sync();
    });
    r.sync();
    r.pair.resume();
    r.sync();
    for (const peer of r.peers) {
      const reopened = await DocxEditor.createServer(new Uint8Array(await peer.editor.save()));
      try {
        await reopened.run(async (c) => {
          const table = c.document.body.tables.getFirst();
          table.load('values');
          await c.sync();
          expect(table.values).toEqual([['User note: Cell text']]);
        });
      } finally {
        reopened.dispose();
      }
    }
    expect(r.peers[0]!.editor.surface!.session.bodyText()).toBe(
      r.peers[1]!.editor.surface!.session.bodyText()
    );
  } finally {
    r.close();
  }
});
