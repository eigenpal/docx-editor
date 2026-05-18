import { useCallback, useRef } from 'react';
import type { Comment } from '@eigenpal/docx-editor-core/types/content';
import { DocumentAgent } from '@eigenpal/docx-editor-core/agent';
import {
  injectReplyRangeMarkers,
  injectTCReplyRangeMarkers,
} from '@eigenpal/docx-editor-core/docx';
import {
  getChangedParagraphIds,
  hasStructuralChanges,
  hasUntrackedChanges,
  clearTrackedChanges,
} from '@eigenpal/docx-editor-core/prosemirror/extensions';
import { readDocxFileFromInput, type DocxInput } from '@eigenpal/docx-editor-core/utils';
import type { EditorView } from 'prosemirror-view';
import type { PagedEditorRef } from '../PagedEditor';

/**
 * File-IO surface of the editor: save (to buffer), download, print, open
 * a DOCX from disk, insert an image from disk. The two file <input> refs
 * live here too because they're hidden inputs whose `click()` is wrapped
 * by the trigger callbacks.
 *
 * `getActiveEditorView` and `focusActiveEditor` come from the parent
 * because they switch targets when the header/footer editor is active.
 */
export function useFileIO({
  agentRef,
  pagedEditorRef,
  containerRef,
  comments,
  documentName,
  onSave,
  onError,
  onPrint,
  onDocumentNameChange,
  loadBuffer,
  getActiveEditorView,
  focusActiveEditor,
}: {
  agentRef: React.RefObject<DocumentAgent | null>;
  pagedEditorRef: React.RefObject<PagedEditorRef | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  comments: Comment[];
  documentName: string | undefined;
  onSave: ((buffer: ArrayBuffer) => void) | undefined;
  onError: ((error: Error) => void) | undefined;
  onPrint: (() => void) | undefined;
  onDocumentNameChange: ((name: string) => void) | undefined;
  loadBuffer: (buffer: DocxInput) => Promise<void>;
  getActiveEditorView: () => EditorView | null | undefined;
  focusActiveEditor: () => void;
}) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const docxInputRef = useRef<HTMLInputElement>(null);

  const handleSave = useCallback(
    async (options?: { selective?: boolean }): Promise<ArrayBuffer | null> => {
      if (!agentRef.current) return null;

      try {
        const agentDoc = agentRef.current.getDocument();

        // Get the document from the PM editor state — this runs fromProseDoc which
        // converts PM comment marks into commentRangeStart/End in the document body.
        // The agent's internal document has the original parsed content and won't
        // include markers for newly added comments.
        const pmDoc = pagedEditorRef.current?.getDocument();
        if (pmDoc?.package?.document) {
          agentDoc.package.document.content = pmDoc.package.document.content;
        }

        // Sync React comments state (including new replies) back to the document model
        agentDoc.package.document.comments = comments;

        // Inject commentRangeStart/End for reply comments that share the parent's range.
        // Pages/Word require every comment (including replies) to have range markers in document.xml.
        injectReplyRangeMarkers(agentDoc.package.document.content, comments);
        // Also inject range markers for comments that reply to tracked changes.
        injectTCReplyRangeMarkers(agentDoc.package.document.content, comments);

        // Build selective save options from change tracker state
        const useSelective = options?.selective !== false;
        const view = pagedEditorRef.current?.getView();
        let selectiveOptions: Parameters<typeof agentRef.current.toBuffer>[0] = undefined;

        if (useSelective && view) {
          const editorState = view.state;
          // Force full repack if any reply comments exist (both comment replies and
          // tracked-change replies need range markers injected into document.xml,
          // which selective save can't handle since the affected paragraphs may not
          // be in changedParaIds)
          const hasInjectedReplies = comments.some((c) => c.parentId != null);
          selectiveOptions = {
            selective: {
              changedParaIds: getChangedParagraphIds(editorState),
              structuralChange: hasStructuralChanges(editorState) || hasInjectedReplies,
              hasUntrackedChanges: hasUntrackedChanges(editorState),
            },
          };
        }

        const buffer = await agentRef.current.toBuffer(selectiveOptions);

        // Clear change tracker after successful save
        if (view) {
          view.dispatch(clearTrackedChanges(view.state));
        }

        onSave?.(buffer);
        return buffer;
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error('Failed to save document'));
        return null;
      }
    },
    [agentRef, pagedEditorRef, comments, onSave, onError]
  );

  const handleDirectPrint = useCallback(() => {
    // Find the pages container and clone its content into a clean print window
    const pagesEl = containerRef.current?.querySelector('.paged-editor__pages');
    if (!pagesEl) {
      window.print();
      onPrint?.();
      return;
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      // Popup blocked — fall back to window.print()
      window.print();
      onPrint?.();
      return;
    }

    // Collect all @font-face rules from the current page
    const fontFaceRules: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules)) {
          if (rule instanceof CSSFontFaceRule) {
            fontFaceRules.push(rule.cssText);
          }
        }
      } catch {
        // Cross-origin stylesheets can't be read — skip
      }
    }

    // Clone pages and remove transforms/shadows
    const pagesClone = pagesEl.cloneNode(true) as HTMLElement;
    pagesClone.style.cssText = 'display: block; margin: 0; padding: 0;';
    for (const page of Array.from(pagesClone.querySelectorAll('.layout-page'))) {
      const el = page as HTMLElement;
      el.style.boxShadow = 'none';
      el.style.margin = '0';
    }

    printWindow.document.write(`<!DOCTYPE html>
<html><head><title>Print</title>
<style>
${fontFaceRules.join('\n')}
* { margin: 0; padding: 0; }
body { background: white; }
.layout-page { break-after: page; }
.layout-page:last-child { break-after: auto; }
@page { margin: 0; size: auto; }
</style>
</head><body>${pagesClone.outerHTML}</body></html>`);
    printWindow.document.close();

    // Wait for fonts/images then print
    printWindow.onload = () => {
      printWindow.print();
      printWindow.close();
    };

    // Fallback if onload doesn't fire (some browsers)
    setTimeout(() => {
      if (!printWindow.closed) {
        printWindow.print();
        printWindow.close();
      }
    }, 1000);

    onPrint?.();
  }, [containerRef, onPrint]);

  const handleDownloadDocument = useCallback(async () => {
    const buffer = await handleSave();
    if (!buffer) return;
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = `${(documentName?.trim() || 'document').replace(/\.docx$/i, '')}.docx`;
    a.click();
    // Defer revoke so Safari has time to start the download.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [handleSave, documentName]);

  const handleOpenDocument = useCallback(() => {
    docxInputRef.current?.click();
  }, []);

  const handleDocxFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      try {
        const result = await readDocxFileFromInput(event.nativeEvent);
        if (!result) return;
        await loadBuffer(result.buffer);
        onDocumentNameChange?.(result.name);
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error('Failed to open document'));
      }
    },
    [loadBuffer, onDocumentNameChange, onError]
  );

  const handleInsertImageClick = useCallback(() => {
    imageInputRef.current?.click();
  }, []);

  const handleImageFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const view = getActiveEditorView();
      if (!view) return;

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;

        const img = new Image();
        img.onload = () => {
          let width = img.naturalWidth;
          let height = img.naturalHeight;

          // Constrain to reasonable max width (content area of US Letter page at 96dpi)
          const maxWidth = 612; // ~6.375 inches
          if (width > maxWidth) {
            const scale = maxWidth / width;
            width = maxWidth;
            height = Math.round(height * scale);
          }

          const rId = `rId_img_${Date.now()}`;
          const imageNode = view.state.schema.nodes.image.create({
            src: dataUrl,
            alt: file.name,
            width,
            height,
            rId,
            wrapType: 'inline',
            displayMode: 'inline',
          });

          const { from } = view.state.selection;
          const tr = view.state.tr.insert(from, imageNode);
          view.dispatch(tr.scrollIntoView());
          focusActiveEditor();
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);

      // Reset the input so the same file can be selected again
      e.target.value = '';
    },
    [getActiveEditorView, focusActiveEditor]
  );

  return {
    imageInputRef,
    docxInputRef,
    handleSave,
    handleDirectPrint,
    handleDownloadDocument,
    handleOpenDocument,
    handleDocxFileChange,
    handleInsertImageClick,
    handleImageFileChange,
  };
}
