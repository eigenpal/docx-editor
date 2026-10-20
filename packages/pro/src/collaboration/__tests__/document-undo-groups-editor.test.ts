/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// An editor shows undo state to the person who edits through it. A session that an editor
// attached refuses an undo group, so the editor never shows an undo that does nothing, and
// an editor that attaches closes a group a host left open.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createDocumentCollaboration } from '../document-session.ts';
import { CollaborationUndoGroupError } from '../document-undo-group.ts';
import { collaborationDocx } from './support.ts';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const stop of cleanup.splice(0).reverse()) stop();
});

async function room() {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  const handle = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'undo-groups-editor-room',
    identity: { actorId: 'person', name: 'Person' },
    bootstrap: { kind: 'create', document: collaborationDocx() },
  });
  cleanup.push(() => {
    handle.destroy();
    awareness.destroy();
    ydoc.destroy();
  });
  return handle;
}

function mount(handle: Awaited<ReturnType<typeof room>>) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: handle.document,
    author: 'Person',
    modules: [collaborationModule({ session: handle.session })],
  });
  cleanup.push(() => {
    editor.destroy();
    container.remove();
  });
  return editor;
}

describe('undo groups with an editor', () => {
  test('a session an editor attached refuses a group, and its undo state stays true', async () => {
    const handle = await room();
    const editor = mount(handle);
    expect(handle.session.attached).toBe(true);
    let thrown: unknown;
    try {
      handle.session.beginUndoGroup();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CollaborationUndoGroupError);
    expect((thrown as CollaborationUndoGroupError).code).toBe('editor-attached');
    expect(handle.session.undoGroupOpen).toBe(false);
    expect(editor.exec({ type: 'insertText', text: 'typed ' })).toMatchObject({ ok: true });
    expect(editor.snapshot().canUndo).toBe(true);
    expect(handle.session.canUndo()).toBe(true);
  });

  test('an editor that attaches closes a group the host left open', async () => {
    const handle = await room();
    const group = handle.session.beginUndoGroup();
    expect(group.state).toBe('open');
    mount(handle);
    expect(group.state).toBe('closed');
    expect(handle.session.undoGroupOpen).toBe(false);
  });
});
