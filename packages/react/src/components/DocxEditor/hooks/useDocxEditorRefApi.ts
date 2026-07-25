/**
 * The imperative `DocxEditorRef` handle.
 *
 * PORTED from the legacy hook of the same name, with legacy's method names kept so a
 * host that held a ref keeps calling what it called.
 *
 * THREE OF LEGACY'S METHODS ARE DELIBERATELY ABSENT, because exposing them would break
 * the boundary this package is built on:
 *
 *  - `getAgent()` returned a `DocumentAgent` over the legacy document tree.
 *  - `getDocument()` returned that tree. The canonical state here is the engine's
 *    package, reachable through `getDocumentHandle()`.
 *  - `getEditorRef()` returned the paged editor's ref, and through it a ProseMirror
 *    view. No adapter API may hand one out.
 *
 * Everything else maps to a capability. The ones that are stubs today (comments,
 * scrolling, proposing changes) return the honest empty answer — `false`, `null`, `0` —
 * rather than pretending, so a host can tell "not supported yet" from "did nothing".
 */
import { useImperativeHandle } from 'react';
import type { DocumentSource, Editor } from '@docx-editor.dev/core-contract/editor';
import type { DocxEditorRef } from '../../../types';

export function useDocxEditorRefApi({
  ref,
  editorRef,
  focusActiveEditor,
  runTableOfContentsUpdate,
  handleSave,
  handleDirectPrint,
}: {
  ref: React.Ref<DocxEditorRef>;
  editorRef: React.RefObject<Editor | null>;
  focusActiveEditor: () => void;
  runTableOfContentsUpdate: () => boolean;
  handleSave: () => Promise<ArrayBuffer | null>;
  handleDirectPrint: () => void;
}) {
  useImperativeHandle(
    ref,
    (): DocxEditorRef => ({
      // ─── Document ────────────────────────────────────────────────────────────
      load: (document: DocumentSource) => editorRef.current?.load(document),
      loadDocumentBuffer: async (buffer: DocumentSource) => {
        editorRef.current?.load(buffer);
      },
      save: () => handleSave(),
      getDocumentHandle: () => editorRef.current?.getDocumentHandle() ?? null,
      getEditor: () => editorRef.current,

      // ─── View ────────────────────────────────────────────────────────────────
      focus: () => focusActiveEditor(),
      getZoom: () => editorRef.current?.getZoom() ?? 1,
      setZoom: (zoom: number) => {
        editorRef.current?.setZoom(zoom);
      },
      getCurrentPage: () => (editorRef.current?.getCurrentPage('viewport') ?? 0) + 1,
      getTotalPages: () => editorRef.current?.getTotalPages() ?? 0,
      scrollToPage: (pageNumber: number) => editorRef.current?.scrollToPage(pageNumber) ?? false,
      scrollToParaId: (paraId: string) => editorRef.current?.scrollToBlock(paraId) ?? false,
      print: () => handleDirectPrint(),

      // ─── Content ─────────────────────────────────────────────────────────────
      updateTableOfContents: () => runTableOfContentsUpdate(),
      findInDocument: (query: string, options?: { caseSensitive?: boolean; limit?: number }) => {
        const matches =
          editorRef.current?.findMatches(query, { matchCase: options?.caseSensitive ?? false }) ??
          [];
        return options?.limit ? matches.slice(0, options.limit) : matches;
      },

      // ─── Annotations — every one a stub on the contract ──────────────────────
      // `getComments` and `getTrackedChanges` are stubs, and there is no command to
      // author a comment or propose a change, so these report failure rather than
      // returning an id for something that was never created.
      addComment: () => null,
      replyToComment: () => null,
      resolveComment: () => false,
      proposeChange: () => null,
    }),
    [editorRef, focusActiveEditor, runTableOfContentsUpdate, handleSave, handleDirectPrint]
  );
}
