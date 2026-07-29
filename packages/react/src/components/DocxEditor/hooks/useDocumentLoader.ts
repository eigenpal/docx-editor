/**
 * Document lifecycle: load bytes, react to the document prop changing, and publish the
 * font inventory the pickers show.
 *
 * PORTED from the legacy hook of the same name, but MOST OF ITS BODY HAS NO COUNTERPART
 * and is deliberately absent rather than reproduced hollow. Legacy owned the whole parse
 * pipeline in the adapter: `parseDocx`, a `DocumentAgent` kept in sync with the latest
 * tree, `loadDocumentFonts`/`getEmbeddedFontFamilies`, seeding a comment-id allocator
 * from the parsed comments, and a `resetForNewDocument` callback the parent assembled
 * because a fresh load touched roughly ten state setters across several hooks.
 *
 * The engine is byte-native and owns all of that: `load(bytes)` parses into the canonical
 * package, and there is no adapter-side tree, agent, or allocator to keep in sync. What
 * remains is the lifecycle legacy also had — notice the document prop changed, load it,
 * and republish what the toolbar reads.
 *
 * The initial document is loaded by `createEditor`, so the first prop value must NOT be
 * loaded again: doing so discards the editor's undo history and selection on mount.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocumentSource, Editor } from '@docx-editor.dev/core-contract/contracts/editor';
import type { FontOption } from '../../ui/FontPicker';

export function useDocumentLoader({
  editorRef,
  document,
  onError,
}: {
  editorRef: React.RefObject<Editor | null>;
  /** The current document prop. Identity change means "load this". */
  document: DocumentSource | undefined;
  onError?: ((error: Error) => void) | undefined;
}) {
  const [documentFonts, setDocumentFonts] = useState<readonly FontOption[]>([]);

  const refreshDocumentFonts = useCallback(() => {
    const names = editorRef.current?.getDocumentFonts() ?? [];
    setDocumentFonts(names.map((name) => ({ name, fontFamily: name })));
  }, [editorRef]);

  const loadBuffer = useCallback(
    (source: DocumentSource) => {
      try {
        editorRef.current?.load(source);
        refreshDocumentFonts();
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error('Failed to load document'));
      }
    },
    [editorRef, onError, refreshDocumentFonts]
  );

  // Skip the first value: `createEditor` already loaded it, and loading it again would
  // throw away undo history and the selection on mount.
  const seededRef = useRef(true);
  useEffect(() => {
    if (seededRef.current) {
      seededRef.current = false;
      refreshDocumentFonts();
      return;
    }
    if (document) loadBuffer(document);
  }, [document, loadBuffer, refreshDocumentFonts]);

  return { loadBuffer, documentFonts, refreshDocumentFonts };
}
