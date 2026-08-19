/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { inject, provide, type InjectionKey } from 'vue';
import { useEditorState } from '@docx-editor.dev/vue';

export interface EditorRenderRevision {
  readonly value: unknown;
}

const editorRenderRevisionKey: InjectionKey<EditorRenderRevision> =
  Symbol('proEditorRenderRevision');

/** Publishes an existing adapter snapshot subscription to the rail subtree. @internal */
export function provideEditorRenderRevision(revision: EditorRenderRevision): EditorRenderRevision {
  provide(editorRenderRevisionKey, revision);
  return revision;
}

/** Reads the rail revision, with a standalone-part snapshot subscription. @internal */
export function useEditorRenderRevision(): EditorRenderRevision {
  return inject(editorRenderRevisionKey, null) ?? useEditorState((snapshot) => snapshot);
}
