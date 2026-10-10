/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A local caret follows remote edits: text a peer
// inserts or deletes before the caret moves it, so the next keystroke lands where the user
// was, not at the old offset.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { collaborationDocx } from './support.ts';
import type { OoxmlNode } from '@docx-editor.dev/core/store';
import { createPeerHarness, nodeText, walk, type Peer } from './document-peer-support.ts';

let registeredDom = false;
beforeAll(() => {
  if (typeof document !== 'undefined') return;
  GlobalRegistrator.register();
  registeredDom = true;
});
afterAll(() => {
  if (registeredDom) GlobalRegistrator.unregister();
});

const DOCUMENT_ID = 'remote-caret-room';

type Surface = NonNullable<
  ReturnType<typeof import('@docx-editor.dev/core/editor').createDocxEditor>['surface']
>;

async function editorWithPeer() {
  const { createDocxEditor } = await import('@docx-editor.dev/core/editor');
  const harness = createPeerHarness(DOCUMENT_ID);
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: DOCUMENT_ID,
    identity: { actorId: 'editor-user', name: 'Editor user' },
    bootstrap: { kind: 'create', document: collaborationDocx() },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: room.document,
    modules: [collaborationModule({ session: room.session })],
  });
  // The peer joins from the editor's state and relays every later update both ways.
  const host = { ydoc } as unknown as Peer;
  const peer = await harness.join(host, 'peer');
  const forward = (target: Y.Doc) => (update: Uint8Array, origin: unknown) => {
    if (origin !== 'relay') Y.applyUpdate(target, update, 'relay');
  };
  ydoc.on('update', forward(peer.ydoc));
  peer.ydoc.on('update', forward(ydoc));
  // Presence travels too, as a provider would carry it.
  awareness.on('update', ({ added, updated }: { added: number[]; updated: number[] }) => {
    const changed = [...added, ...updated];
    applyAwarenessUpdate(peer.awareness, encodeAwarenessUpdate(awareness, changed), 'relay');
  });
  const surface = editor.surface!;
  // Text as the peer sees it: every edit here reached the peer through the relay.
  const textOf = (index: number) => {
    const pkg = harness.packageOf(peer);
    const paragraphs: OoxmlNode[] = [];
    walk(pkg.parts.get(pkg.mainDocumentPart)!.root, (node) => {
      if (node.kind !== 'textValue' && node.localName === 'p') paragraphs.push(node);
    });
    return nodeText(paragraphs[index]!);
  };
  return {
    surface,
    room,
    ydoc,
    peer,
    harness,
    textOf,
    cleanup() {
      editor.destroy();
      container.remove();
      harness.cleanup();
      room.destroy();
      ydoc.destroy();
    },
  };
}

describe('local caret across remote edits', () => {
  test('text a peer inserts before the caret moves the caret', async () => {
    const { surface, peer, harness, textOf, cleanup } = await editorWithPeer();
    try {
      const id = surface.session.paragraphIds()[0]!;
      // "Alpha| paragraph"
      surface.setSelection({
        anchor: { paragraphId: id, offset: 5 },
        head: { paragraphId: id, offset: 5 },
      });
      harness.apply(peer, [
        { op: 'insertText', paragraphId: harness.paragraphIdAt(peer, 0), offset: 0, text: 'Big ' },
      ]);
      expect(textOf(0)).toBe('Big Alpha paragraph');
      // The remote commit reaches the screen on the next layout task, like any other.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(surface.state().selection.head).toEqual({ paragraphId: id, offset: 9 });
      // The peer sees the moved caret too, not the old offset that now points into its words.
      expect(peer.room.session.remoteSelections()[0]?.head.offset).toBe(9);
      surface.type('!');
      expect(textOf(0)).toBe('Big Alpha! paragraph');
    } finally {
      cleanup();
    }
  });

  test('a key pressed right after a peer edit, before any timer, lands at the moved caret', async () => {
    const { surface, peer, harness, textOf, cleanup } = await editorWithPeer();
    try {
      const id = surface.session.paragraphIds()[0]!;
      surface.setSelection({
        anchor: { paragraphId: id, offset: 5 },
        head: { paragraphId: id, offset: 5 },
      });
      harness.apply(peer, [
        { op: 'insertText', paragraphId: harness.paragraphIdAt(peer, 0), offset: 0, text: 'Big ' },
      ]);
      // Input is its own task; only microtasks run before it, never the layout timer. Edit
      // commands land pending layout before they read the selection.
      await Promise.resolve();
      surface.type('!');
      expect(textOf(0)).toBe('Big Alpha! paragraph');
    } finally {
      cleanup();
    }
  });

  for (const [name, edit, expected] of [
    ['Backspace', (s: Surface) => s.deleteBackward(), ['Big Alph paragraph']],
    ['Enter', (s: Surface) => s.splitParagraph(), ['Big Alpha', ' paragraph']],
  ] as const) {
    test(`${name} pressed right after a peer edit acts at the moved caret`, async () => {
      const { surface, peer, harness, textOf, cleanup } = await editorWithPeer();
      try {
        const id = surface.session.paragraphIds()[0]!;
        surface.setSelection({
          anchor: { paragraphId: id, offset: 5 },
          head: { paragraphId: id, offset: 5 },
        });
        harness.apply(peer, [
          {
            op: 'insertText',
            paragraphId: harness.paragraphIdAt(peer, 0),
            offset: 0,
            text: 'Big ',
          },
        ]);
        await Promise.resolve();
        edit(surface);
        expected.forEach((text, index) => expect(textOf(index)).toBe(text));
      } finally {
        cleanup();
      }
    });
  }

  test('text a peer deletes around the caret collapses the caret to the deletion', async () => {
    const { surface, peer, harness, textOf, cleanup } = await editorWithPeer();
    try {
      const id = surface.session.paragraphIds()[0]!;
      // "Alpha para|graph"
      surface.setSelection({
        anchor: { paragraphId: id, offset: 10 },
        head: { paragraphId: id, offset: 10 },
      });
      harness.apply(peer, [
        { op: 'deleteText', paragraphId: harness.paragraphIdAt(peer, 0), start: 2, end: 8 },
      ]);
      expect(textOf(0)).toBe('Alragraph');
      surface.type('!');
      expect(textOf(0)).toBe('Alra!graph');
    } finally {
      cleanup();
    }
  });

  test('a paragraph a peer joins into the one before carries the caret with its text', async () => {
    const { surface, peer, harness, textOf, cleanup } = await editorWithPeer();
    try {
      const second = surface.session.paragraphIds()[1]!;
      // "Bravo| paragraph"
      surface.setSelection({
        anchor: { paragraphId: second, offset: 5 },
        head: { paragraphId: second, offset: 5 },
      });
      harness.apply(peer, [
        {
          op: 'joinParagraphs',
          firstId: harness.paragraphIdAt(peer, 0),
          secondId: harness.paragraphIdAt(peer, 1),
        },
      ]);
      surface.type('!');
      expect(textOf(0)).toBe('Alpha paragraphBravo! paragraph');
    } finally {
      cleanup();
    }
  });

  test('a paragraph a peer deletes moves the caret to the next paragraph', async () => {
    const { surface, peer, harness, textOf, cleanup } = await editorWithPeer();
    try {
      const second = surface.session.paragraphIds()[1]!;
      surface.setSelection({
        anchor: { paragraphId: second, offset: 5 },
        head: { paragraphId: second, offset: 5 },
      });
      harness.apply(peer, [
        { op: 'deleteBlock', blockId: harness.paragraphIdAt(peer, 1) } as never,
      ]);
      surface.type('!');
      expect(textOf(1)).toBe('!Charlie paragraph');
    } finally {
      cleanup();
    }
  });

  test('undo puts the caret where the undone text was', async () => {
    const { surface, textOf, cleanup } = await editorWithPeer();
    try {
      const [first, , third] = surface.session.paragraphIds();
      // Type into the first paragraph, then move to the third.
      surface.setSelection({
        anchor: { paragraphId: first!, offset: 5 },
        head: { paragraphId: first!, offset: 5 },
      });
      surface.type('XYZ');
      expect(textOf(0)).toBe('AlphaXYZ paragraph');
      surface.setSelection({
        anchor: { paragraphId: third!, offset: 2 },
        head: { paragraphId: third!, offset: 2 },
      });
      surface.undo();
      expect(textOf(0)).toBe('Alpha paragraph');
      expect(surface.state().selection.head).toEqual({ paragraphId: first, offset: 5 });
      surface.redo();
      expect(textOf(0)).toBe('AlphaXYZ paragraph');
      expect(surface.state().selection.head).toEqual({ paragraphId: first, offset: 8 });
    } finally {
      cleanup();
    }
  });

  test('a peer pressing Enter before the caret carries the caret into the new paragraph', async () => {
    const { surface, peer, harness, textOf, cleanup } = await editorWithPeer();
    try {
      const id = surface.session.paragraphIds()[0]!;
      // "Alpha para|graph"
      surface.setSelection({
        anchor: { paragraphId: id, offset: 10 },
        head: { paragraphId: id, offset: 10 },
      });
      harness.apply(peer, [
        { op: 'splitParagraph', paragraphId: harness.paragraphIdAt(peer, 0), offset: 3 },
      ]);
      surface.type('!');
      expect(textOf(0)).toBe('Alp');
      expect(textOf(1)).toBe('ha para!graph');
    } finally {
      cleanup();
    }
  });

  test('undo brings back the selection the undone change was made from', async () => {
    const { surface, textOf, cleanup } = await editorWithPeer();
    try {
      const [first, , third] = surface.session.paragraphIds();
      // Select "Alpha", replace it with "X", move to another paragraph, undo.
      surface.setSelection({
        anchor: { paragraphId: first!, offset: 0 },
        head: { paragraphId: first!, offset: 5 },
      });
      surface.type('X');
      expect(textOf(0)).toBe('X paragraph');
      surface.setSelection({
        anchor: { paragraphId: third!, offset: 1 },
        head: { paragraphId: third!, offset: 1 },
      });
      surface.undo();
      expect(textOf(0)).toBe('Alpha paragraph');
      expect(surface.state().selection).toEqual({
        anchor: { paragraphId: first!, offset: 0 },
        head: { paragraphId: first!, offset: 5 },
      });
    } finally {
      cleanup();
    }
  });

  test('undo after a peer typed before the undone text restores the selection past their words', async () => {
    const { surface, peer, harness, textOf, cleanup } = await editorWithPeer();
    try {
      const [first, , third] = surface.session.paragraphIds();
      // Select "para" in "Alpha paragraph", replace it with "X", then a peer types at the
      // paragraph start.
      surface.setSelection({
        anchor: { paragraphId: first!, offset: 6 },
        head: { paragraphId: first!, offset: 10 },
      });
      surface.type('X');
      expect(textOf(0)).toBe('Alpha Xgraph');
      harness.apply(peer, [
        { op: 'insertText', paragraphId: harness.paragraphIdAt(peer, 0), offset: 0, text: 'Big ' },
      ]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      surface.setSelection({
        anchor: { paragraphId: third!, offset: 1 },
        head: { paragraphId: third!, offset: 1 },
      });
      surface.undo();
      expect(textOf(0)).toBe('Big Alpha paragraph');
      // "para" is selected again, after the peer's "Big ".
      expect(surface.state().selection).toEqual({
        anchor: { paragraphId: first!, offset: 10 },
        head: { paragraphId: first!, offset: 14 },
      });
    } finally {
      cleanup();
    }
  });

  test('the session carries the caret on the character before it into a new paragraph of a peer', async () => {
    const { surface, room, peer, harness, cleanup } = await editorWithPeer();
    try {
      const id = surface.session.paragraphIds()[0]!;
      // "Alpha para|graph"
      surface.setSelection({
        anchor: { paragraphId: id, offset: 10 },
        head: { paragraphId: id, offset: 10 },
      });
      harness.apply(peer, [
        { op: 'splitParagraph', paragraphId: harness.paragraphIdAt(peer, 0), offset: 3 },
      ]);
      // The move names the selection it carried, and where the "a" before the caret now shows.
      const second = surface.session.paragraphIds()[1]!;
      expect(room.session.remoteSelectionMove?.()).toEqual({
        from: { anchor: { nodeId: id, offset: 10 }, head: { nodeId: id, offset: 10 } },
        to: { anchor: { nodeId: second, offset: 7 }, head: { nodeId: second, offset: 7 } },
      });
    } finally {
      cleanup();
    }
  });

  test('a peer splitting and joining back the caret paragraph keeps the caret after its character', async () => {
    const { surface, peer, harness, textOf, cleanup } = await editorWithPeer();
    try {
      const id = surface.session.paragraphIds()[0]!;
      // "Alpha para|graph"
      surface.setSelection({
        anchor: { paragraphId: id, offset: 10 },
        head: { paragraphId: id, offset: 10 },
      });
      harness.apply(peer, [
        { op: 'splitParagraph', paragraphId: harness.paragraphIdAt(peer, 0), offset: 3 },
      ]);
      harness.apply(peer, [
        {
          op: 'joinParagraphs',
          firstId: harness.paragraphIdAt(peer, 0),
          secondId: harness.paragraphIdAt(peer, 1),
        },
      ]);
      expect(textOf(0)).toBe('Alpha paragraph');
      await new Promise((resolve) => setTimeout(resolve, 0));
      surface.type('!');
      expect(textOf(0)).toBe('Alpha para!graph');
    } finally {
      cleanup();
    }
  });

  test('typing while shared state holds back an unrelated update goes through', async () => {
    const { surface, room, ydoc, textOf, cleanup } = await editorWithPeer();
    try {
      // A second update from one client, without the first it depends on: Yjs holds it back.
      const other = new Y.Doc();
      const updates: Uint8Array[] = [];
      other.on('update', (update: Uint8Array) => updates.push(update));
      other.getMap('held').set('first', 1);
      other.getMap('held').set('second', 2);
      Y.applyUpdate(ydoc, updates[1]!, 'relay');
      const id = surface.session.paragraphIds()[0]!;
      surface.setSelection({
        anchor: { paragraphId: id, offset: 5 },
        head: { paragraphId: id, offset: 5 },
      });
      surface.type('!');
      // The editor shows all of shared state it needs, so nothing waits.
      expect(textOf(0)).toBe('Alpha! paragraph');
      expect(room.session.statusSnapshot().waiting).toBe(false);
      Y.applyUpdate(ydoc, updates[0]!, 'relay');
      expect(textOf(0)).toBe('Alpha! paragraph');
      other.destroy();
    } finally {
      cleanup();
    }
  });

  test('undo removes typing that a peer moved into a new paragraph, and redo restores it once', async () => {
    const { surface, peer, harness, textOf, cleanup } = await editorWithPeer();
    try {
      const id = surface.session.paragraphIds()[0]!;
      // "Alpha para|graph": type there, then a peer presses Enter after "Alp".
      surface.setSelection({
        anchor: { paragraphId: id, offset: 10 },
        head: { paragraphId: id, offset: 10 },
      });
      surface.type('XY');
      expect(textOf(0)).toBe('Alpha paraXYgraph');
      harness.apply(peer, [
        { op: 'splitParagraph', paragraphId: harness.paragraphIdAt(peer, 0), offset: 3 },
      ]);
      expect(textOf(1)).toBe('ha paraXYgraph');
      await new Promise((resolve) => setTimeout(resolve, 0));
      surface.undo();
      expect(textOf(0)).toBe('Alp');
      expect(textOf(1)).toBe('ha paragraph');
      surface.redo();
      expect(textOf(0)).toBe('Alp');
      expect(textOf(1)).toBe('ha paraXYgraph');
      // Undo and redo again: the same step, both ways.
      surface.undo();
      expect(textOf(1)).toBe('ha paragraph');
      surface.redo();
      expect(textOf(1)).toBe('ha paraXYgraph');
    } finally {
      cleanup();
    }
  });

  test('undo of typing a peer moved does not undo an older edit instead', async () => {
    const { surface, peer, harness, textOf, cleanup } = await editorWithPeer();
    try {
      const [first, second] = surface.session.paragraphIds();
      surface.setSelection({
        anchor: { paragraphId: second!, offset: 5 },
        head: { paragraphId: second!, offset: 5 },
      });
      surface.type('Q');
      expect(textOf(1)).toBe('BravoQ paragraph');
      // A separate step: move away first, so the typing is not one run.
      surface.setSelection({
        anchor: { paragraphId: first!, offset: 10 },
        head: { paragraphId: first!, offset: 10 },
      });
      surface.type('XY');
      harness.apply(peer, [
        { op: 'splitParagraph', paragraphId: harness.paragraphIdAt(peer, 0), offset: 3 },
      ]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      surface.undo();
      expect(textOf(1)).toBe('ha paragraph');
      expect(textOf(2)).toBe('BravoQ paragraph');
      surface.undo();
      expect(textOf(2)).toBe('Bravo paragraph');
    } finally {
      cleanup();
    }
  });

  test('a caret after the remote edit in another paragraph does not move', async () => {
    const { surface, peer, harness, textOf, cleanup } = await editorWithPeer();
    try {
      const second = surface.session.paragraphIds()[1]!;
      surface.setSelection({
        anchor: { paragraphId: second, offset: 5 },
        head: { paragraphId: second, offset: 5 },
      });
      harness.apply(peer, [
        { op: 'insertText', paragraphId: harness.paragraphIdAt(peer, 0), offset: 0, text: 'Big ' },
      ]);
      surface.type('!');
      expect(textOf(1)).toBe('Bravo! paragraph');
    } finally {
      cleanup();
    }
  });
});
