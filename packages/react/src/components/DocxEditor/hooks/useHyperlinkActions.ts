import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import {
  findHyperlinkRangeAt,
  setHyperlink,
  removeHyperlink,
  insertHyperlink,
} from '@eigenpal/docx-editor-core/prosemirror/commands';
import type { EditorView } from 'prosemirror-view';
import type { HyperlinkData, useHyperlinkDialog } from '../../dialogs/HyperlinkDialog';
import type { HyperlinkPopupData } from '../../ui/HyperlinkPopup';

/**
 * Owns the dialog-driven hyperlink flow (insert / edit / remove) and the
 * Google-Docs-style floating popup that opens when the cursor lands on
 * an existing link. The dialog handle (`hyperlinkDialog`) is owned by
 * the parent and threaded in — Cmd/Ctrl+K in `useKeyboardShortcuts`
 * also opens it.
 */
export function useHyperlinkActions({
  hyperlinkDialog,
  getActiveEditorView,
  focusActiveEditor,
}: {
  hyperlinkDialog: ReturnType<typeof useHyperlinkDialog>;
  getActiveEditorView: () => EditorView | null | undefined;
  focusActiveEditor: () => void;
}) {
  const [hyperlinkPopupData, setHyperlinkPopupData] = useState<HyperlinkPopupData | null>(null);

  const handleHyperlinkSubmit = useCallback(
    (data: HyperlinkData) => {
      const view = getActiveEditorView();
      if (!view) return;

      const url = data.url || '';
      const tooltip = data.tooltip;
      const { empty } = view.state.selection;

      if (empty && data.displayText) {
        insertHyperlink(data.displayText, url, tooltip)(view.state, view.dispatch);
      } else if (!empty) {
        setHyperlink(url, tooltip)(view.state, view.dispatch);
      } else if (data.displayText) {
        insertHyperlink(data.displayText, url, tooltip)(view.state, view.dispatch);
      }

      hyperlinkDialog.close();
      focusActiveEditor();
    },
    [hyperlinkDialog, getActiveEditorView, focusActiveEditor]
  );

  const doRemoveHyperlink = useCallback(() => {
    const view = getActiveEditorView();
    if (!view) return;
    removeHyperlink(view.state, view.dispatch);
    focusActiveEditor();
  }, [getActiveEditorView, focusActiveEditor]);

  const handleHyperlinkRemove = useCallback(() => {
    doRemoveHyperlink();
    hyperlinkDialog.close();
  }, [hyperlinkDialog, doRemoveHyperlink]);

  const handleHyperlinkClick = useCallback(
    (data: HyperlinkPopupData) => setHyperlinkPopupData(data),
    []
  );

  const handleHyperlinkPopupNavigate = useCallback((href: string) => {
    window.open(href, '_blank', 'noopener,noreferrer');
  }, []);

  const handleHyperlinkPopupCopy = useCallback((href: string) => {
    navigator.clipboard.writeText(href).catch(() => {
      // Fallback for browsers without async clipboard (older Safari, embedded webviews)
      const textarea = document.createElement('textarea');
      textarea.value = href;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    });
  }, []);

  const handleHyperlinkPopupEdit = useCallback(
    (displayText: string, href: string) => {
      const view = getActiveEditorView();
      if (!view) return;

      const hit = findHyperlinkRangeAt(view.state);
      if (hit) {
        const hlType = view.state.schema.marks.hyperlink;
        const { $from } = view.state.selection;
        const newMark = hlType.create({ href, tooltip: hit.mark.attrs.tooltip });
        const textNode = view.state.schema.text(displayText, [
          ...$from.marks().filter((m) => m.type !== hlType),
          newMark,
        ]);
        const tr = view.state.tr.replaceWith(hit.start, hit.end, textNode);
        view.dispatch(tr.scrollIntoView());
      }

      setHyperlinkPopupData(null);
      focusActiveEditor();
    },
    [getActiveEditorView, focusActiveEditor]
  );

  const handleHyperlinkPopupRemove = useCallback(() => {
    const view = getActiveEditorView();
    if (!view) return;

    const hit = findHyperlinkRangeAt(view.state, hyperlinkPopupData?.href);
    if (!hit) return;

    const hlType = view.state.schema.marks.hyperlink;
    view.dispatch(view.state.tr.removeMark(hit.start, hit.end, hlType).scrollIntoView());

    setHyperlinkPopupData(null);
    focusActiveEditor();
    toast('Link removed');
  }, [getActiveEditorView, focusActiveEditor, hyperlinkPopupData]);

  const handleHyperlinkPopupClose = useCallback(() => {
    setHyperlinkPopupData(null);
  }, []);

  return {
    hyperlinkPopupData,
    setHyperlinkPopupData,
    handleHyperlinkSubmit,
    handleHyperlinkRemove,
    handleHyperlinkClick,
    handleHyperlinkPopupNavigate,
    handleHyperlinkPopupCopy,
    handleHyperlinkPopupEdit,
    handleHyperlinkPopupRemove,
    handleHyperlinkPopupClose,
  };
}
