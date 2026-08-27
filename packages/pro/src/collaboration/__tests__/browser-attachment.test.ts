/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { createTextCollaboration } from '../session.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { collaborationDocx } from './support.ts';

let registeredDom = false;
beforeAll(() => {
  if (typeof document !== 'undefined') return;
  GlobalRegistrator.register();
  registeredDom = true;
});
afterAll(() => {
  if (registeredDom) GlobalRegistrator.unregister();
});

describe('browser collaboration attachment', () => {
  test('attach, unsupported input refusal, destroy, and remount keep the room usable', async () => {
    const { createDocxEditor } = await import('@docx-editor.dev/core/editor');
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const room = await createTextCollaboration({
      ydoc,
      awareness,
      documentId: 'browser-attachment-room',
      identity: { actorId: 'browser-user', name: 'Browser user' },
      bootstrap: { kind: 'create', document: collaborationDocx() },
    });
    const firstContainer = document.createElement('div');
    document.body.append(firstContainer);
    const first = createDocxEditor({
      container: firstContainer,
      document: room.document,
      modules: [collaborationModule({ session: room.session })],
    });
    try {
      const before = new Uint8Array(await first.save());
      const pages = firstContainer.querySelector<HTMLElement>('.docx-pages');
      expect(pages).not.toBeNull();
      pages!.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: 'Z',
        })
      );
      expect(new Uint8Array(await first.save())).not.toEqual(before);
      expect(first.snapshot().canUndo).toBe(true);
      expect(first.exec({ type: 'undo' }).ok).toBe(true);
      expect(new Uint8Array(await first.save())).toEqual(before);
      pages!.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertParagraph',
        })
      );
      expect(new Uint8Array(await first.save())).toEqual(before);
    } finally {
      first.destroy();
      firstContainer.remove();
    }

    const secondContainer = document.createElement('div');
    document.body.append(secondContainer);
    const second = createDocxEditor({
      container: secondContainer,
      document: room.document,
      modules: [collaborationModule({ session: room.session })],
    });
    try {
      expect(second.snapshot().parseError).toBeNull();
      expect(room.session.status()).toBe('ready');
    } finally {
      second.destroy();
      secondContainer.remove();
      room.destroy();
      awareness.destroy();
      ydoc.destroy();
    }
  });
});
