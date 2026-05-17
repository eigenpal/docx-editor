// Type-level: `DocxEditorRef` satisfies the shared agent bridge contract.

import type { EditorRefLike } from '@eigenpal/docx-editor-agents/bridge';
import type { DocxEditorRef } from '../editor-ref';
import type { DocxEditorHandle } from '../renderAsync';

function assertAssignable<T>(_value: T): void {}

declare const vueRef: DocxEditorRef;
assertAssignable<EditorRefLike>(vueRef);
assertAssignable<{
  setZoom(zoom: number): void;
  getZoom(): number;
  scrollToPage(pageNumber: number): void;
  scrollToPosition(pmPos: number): void;
  print(): void;
  loadDocumentBuffer(buffer: ArrayBuffer): Promise<void>;
}>(vueRef);

declare const vueHandle: DocxEditorHandle;
assertAssignable<{
  setZoom(zoom: number): void;
  scrollToParaId(paraId: string): boolean;
  scrollToPosition(pmPos: number): void;
}>(vueHandle);
