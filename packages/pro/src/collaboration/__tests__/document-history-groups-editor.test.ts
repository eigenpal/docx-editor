/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// End to end: `Editor.exec` with a history group on a collaborating surface. The token has
// to survive the surface's write path — the one place it rides beside `recordsHistory:
// false` — into the journal, and from there into the shared undo authority.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import type { OoxmlNode } from '@docx-editor.dev/core/store';
import { createDocumentCollaboration } from '../document-session.ts';
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

/** The `w:color` values the body's runs author, in document order. */
function colors(root: OoxmlNode): string[] {
  const found: string[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.localName === 'color') {
      const value = node.attributes.find((attribute) => attribute.localName === 'val')?.value;
      if (value) found.push(value);
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(root);
  return found;
}

describe('history groups through Editor.exec on a collaborating surface', () => {
  test('frames of one gesture are one shared undo item', async () => {
    const { createDocxEditor } = await import('@docx-editor.dev/core/editor');
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const room = await createDocumentCollaboration({
      ydoc,
      awareness,
      documentId: 'history-groups-editor-room',
      identity: { actorId: 'browser-user', name: 'Browser user' },
      bootstrap: { kind: 'create', document: collaborationDocx() },
    });
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      container,
      document: room.document,
      modules: [collaborationModule({ session: room.session })],
    });
    try {
      const surface = editor.surface!;
      const ids = surface.session.paragraphIds();
      surface.setSelection({
        anchor: { paragraphId: ids[0]!, offset: 0 },
        head: { paragraphId: ids[0]!, offset: 5 },
      });
      const gesture = editor.beginHistoryGroup();
      for (const value of ['FF0000', '00FF00', '0000FF']) {
        const result = editor.exec(
          { type: 'setMarkAttr', mark: 'color', attr: 'val', value },
          { historyGroup: gesture }
        );
        expect(result).toMatchObject({
          ok: true,
          changed: true,
          history: { kind: value === 'FF0000' ? 'started' : 'extended' },
        });
      }
      expect(colors(surface.session.part().root)).toEqual(['0000FF']);
      expect(editor.snapshot().canUndo).toBe(true);
      expect(editor.exec({ type: 'undo' }).ok).toBe(true);
      expect(colors(surface.session.part().root)).toEqual([]);
      expect(editor.snapshot().canUndo).toBe(false);
    } finally {
      editor.destroy();
      container.remove();
      room.destroy();
      awareness.destroy();
      ydoc.destroy();
    }
  });
});
