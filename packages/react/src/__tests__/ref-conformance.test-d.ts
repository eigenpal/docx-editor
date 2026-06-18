// Type-level: `DocxEditorRef` must stay assignable to `EditorRefLike`.
// Drift guard for the agent SDK surface. See openspec §8b.1.

import type { EditorRefLike } from '@eigenpal/docx-editor-agents/bridge';
import type { DocxEditorRef } from '../components/DocxEditor';

function assertAssignable<T>(_value: T): void {}

declare const reactRef: DocxEditorRef;
assertAssignable<EditorRefLike>(reactRef);
assertAssignable<{
  scrollToParaId(
    paraId: string,
    options?: { highlight?: { color?: string; durationMs?: number } }
  ): boolean;
}>(reactRef);

// Drop a required method → typecheck must fail. If a contributor renames
// or removes an EditorRefLike method on the React ref, the @ts-expect-error
// becomes "unused" and tsc fails — pointing at the offending line.
declare const missingAddComment: Omit<DocxEditorRef, 'addComment'>;
// @ts-expect-error — dropping a required EditorRefLike method must fail
assertAssignable<EditorRefLike>(missingAddComment);
