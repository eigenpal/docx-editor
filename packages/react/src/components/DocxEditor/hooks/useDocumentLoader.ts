import { useCallback, useEffect, useRef } from 'react';
import type { Document } from '@eigenpal/docx-editor-core/types/document';
import type { Comment } from '@eigenpal/docx-editor-core/types/content';
import { parseDocx } from '@eigenpal/docx-editor-core/docx';
import { DocumentAgent } from '@eigenpal/docx-editor-core/agent';
import { loadDocumentFonts, type DocxInput } from '@eigenpal/docx-editor-core/utils';
import type { UseHistoryReturn } from '../../../hooks/useHistory';
import type { PagedEditorRef } from '../PagedEditor';
import type { CommentIdAllocator } from '../commentFactories';
import { seedCommentAllocator } from '@eigenpal/docx-editor-core/prosemirror/commentIdAllocator';

/**
 * Document lifecycle: load buffer / pre-parsed doc, keep the agent in
 * sync with the latest doc, react to `documentBuffer` / `document` prop
 * changes, and extract any baked-in comments from the document model on
 * initial load.
 *
 * State reset across the editor on a fresh load is heavy (~10 distinct
 * state setters across multiple hooks), so the parent assembles a
 * single `resetForNewDocument` callback and threads it in.
 */
export function useDocumentLoader({
  documentBuffer,
  initialDocument,
  externalContent,
  history,
  agentRef,
  pagedEditorRef,
  setLoadingState,
  setComments,
  setShowCommentsSidebar,
  onError,
  resetForNewDocument,
  commentsLoadedRef,
  commentIdAllocator,
}: {
  documentBuffer: DocxInput | null | undefined;
  initialDocument: Document | null | undefined;
  externalContent: boolean | undefined;
  history: UseHistoryReturn<Document | null>;
  agentRef: React.RefObject<DocumentAgent | null>;
  pagedEditorRef: React.RefObject<PagedEditorRef | null>;
  // The full EditorState shape lives in the parent; we only need to flip
  // `isLoading` and `parseError`, so the parent exposes a focused callback.
  setLoadingState: (state: { isLoading: boolean; parseError: string | null }) => void;
  setComments: React.Dispatch<React.SetStateAction<Comment[]>>;
  setShowCommentsSidebar: React.Dispatch<React.SetStateAction<boolean>>;
  onError: ((error: Error) => void) | undefined;
  resetForNewDocument: () => void;
  // `resetForNewDocument` (declared earlier in the parent) needs to clear
  // this ref on every load. Lifted out of the hook for that reason.
  commentsLoadedRef: React.RefObject<boolean>;
  // Per-editor-instance ID allocator; seeded above the loaded doc's max ID.
  commentIdAllocator: CommentIdAllocator;
}) {
  // Monotonically increasing generation counter so a late `parseDocx`
  // result doesn't overwrite a newer load that started while we were
  // parsing.
  const loadGenerationRef = useRef(0);

  const loadParsedDocument = useCallback(
    (doc: Document) => {
      resetForNewDocument();
      history.reset(doc);
      setLoadingState({ isLoading: false, parseError: null });
      loadDocumentFonts(doc).catch((err) => {
        console.warn('Failed to load document fonts:', err);
      });
    },
    [resetForNewDocument, history, setLoadingState]
  );

  const loadBuffer = useCallback(
    async (buffer: DocxInput) => {
      const generation = ++loadGenerationRef.current;
      resetForNewDocument();
      setLoadingState({ isLoading: true, parseError: null });
      try {
        const doc = await parseDocx(buffer);
        if (loadGenerationRef.current !== generation) return;
        loadParsedDocument(doc);
      } catch (error) {
        if (loadGenerationRef.current !== generation) return;
        const message = error instanceof Error ? error.message : 'Failed to parse document';
        setLoadingState({ isLoading: false, parseError: message });
        onError?.(error instanceof Error ? error : new Error(message));
      }
    },
    [resetForNewDocument, loadParsedDocument, onError, setLoadingState]
  );

  // React to documentBuffer / document prop changes.
  useEffect(() => {
    // External-content mode: the caller (e.g. ySyncPlugin) populates PM
    // directly — skip the load.
    if (externalContent) return;

    if (!documentBuffer) {
      if (initialDocument) {
        loadParsedDocument(initialDocument);
      }
      return;
    }

    loadBuffer(documentBuffer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentBuffer, initialDocument, externalContent]);

  // Keep the DocumentAgent in sync with the latest history state.
  useEffect(() => {
    if (history.state) {
      agentRef.current = new DocumentAgent(history.state);
    } else {
      agentRef.current = null;
    }
  }, [history.state, agentRef]);

  // Extract any baked-in comments from the document model on first load.
  // Bumps the shared comment/revision ID counter above all loaded IDs so new
  // comments and tracked changes don't collide with existing ones (they
  // share the OOXML ID space).
  useEffect(() => {
    if (commentsLoadedRef.current) return;
    const doc = history.state;
    if (!doc) return;
    commentsLoadedRef.current = true;
    const bodyComments = doc.package?.document?.comments;
    if (bodyComments && bodyComments.length > 0) {
      setComments(bodyComments);
      setShowCommentsSidebar(true);
    }
    // Seed the shared allocator above every existing comment + revision ID —
    // unconditionally, so a doc with tracked changes but no comments still
    // can't allocate a revisionId that collides with an existing w:ins/w:del.
    seedCommentAllocator(
      commentIdAllocator,
      bodyComments,
      pagedEditorRef.current?.getView() ?? null
    );
  }, [
    history.state,
    pagedEditorRef,
    setComments,
    setShowCommentsSidebar,
    commentsLoadedRef,
    commentIdAllocator,
  ]);

  return {
    loadParsedDocument,
    loadBuffer,
  };
}
