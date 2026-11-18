/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The remote participant of the review rail collaboration tests, shared by the React and Vue
// files: a bare editor on the same room, without a rail of its own.

import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { collaborationModule, reviewModule } from '../../index.ts';
import type { Peer } from './document-peer-support';

const mounted: (() => void)[] = [];

/**
 * A bare editor for `peer`, with the author `Bob`. `unmountRemoteEditors` destroys it and
 * takes its container out of the document.
 */
export function mountRemoteEditor(peer: Peer): DocxEditorInstance {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: peer.room.document,
    author: 'Bob',
    modules: [reviewModule(), collaborationModule({ session: peer.room.session })],
  });
  mounted.push(() => {
    editor.destroy();
    container.remove();
  });
  return editor;
}

/** Destroy every editor `mountRemoteEditor` made. Call it after each test. */
export function unmountRemoteEditors(): void {
  for (const unmount of mounted.splice(0)) unmount();
}

/** The key, on `editor`, of the review item whose text is `text`. */
export function remoteKeyOf(editor: DocxEditorInstance, text: string): string {
  const item = editor.getReviewItems({ placement: false }).find((entry) => entry.text === text);
  if (!item) throw new Error(`no review item with the text "${text}"`);
  return item.key;
}
