/**
 * Public ref shape for `<DocxEditor>`. Where keys overlap with
 * `EditorRefLike` from `@eigenpal/docx-editor-agents/bridge`, the
 * signature is borrowed via `Pick<EditorRefLike, …>` so the Vue and
 * React adapters cannot drift on the agent SDK surface they share.
 *
 * Exposes the full editor-scope `EditorRefLike` contract so the agent
 * bridge can attach to either React or Vue without an adapter shim.
 *
 * Design ref: openspec Decision 10 — single bridge contract across
 * adapters. By typing the ref this way, expanding the Vue surface is a
 * matter of moving a method from "TODO" to a `Pick` line; the typechecker
 * then forces the runtime expose object to match.
 */

import type { EditorRefLike } from '@eigenpal/docx-editor-agents/bridge';
import type { DocxInput } from '@eigenpal/docx-editor-core/utils';
import type { Document } from '@eigenpal/docx-editor-core/types/document';

export type DocxEditorRef = EditorRefLike & {
  /** Agent instance access is React-only today; Vue returns null for API parity. */
  getAgent(): null;
  /** Save the document and return DOCX bytes, matching React's component ref. */
  save(): Promise<ArrayBuffer | null>;
  /** Set zoom level (1.0 = 100%). */
  setZoom(zoom: number): void;
  /** Get current zoom level. */
  getZoom(): number;
  /** Focus the editor's hidden ProseMirror view. Vue-only — not in EditorRefLike. */
  focus(): void;
  /** Scroll the visible pages to a 1-indexed page number. */
  scrollToPage(pageNumber: number): void;
  /** Scroll to a raw ProseMirror document position. */
  scrollToPosition(pmPos: number): void;
  /** Open print preview / browser print. */
  openPrintPreview(): void;
  /** Print the document. */
  print(): void;
  /** Load a pre-parsed document programmatically. */
  loadDocument(doc: Document): void;
  /** Load a DOCX buffer programmatically. */
  loadDocumentBuffer(buffer: DocxInput): Promise<void>;
  /** Tear down the editor (destroys the PM view + frees listeners). */
  destroy(): void;
};
