/**
 * Hyperlink dialog and popup actions.
 *
 * PORTED from the legacy hook of the same name. The popup state, the handler names and
 * the clipboard fallback for browsers without the async Clipboard API are legacy's.
 *
 * Legacy branched on whether the selection was empty: insert link text when it was, mark
 * the existing selection when it was not. The contract has `insertHyperlink` and
 * `removeHyperlink`, both selection-targeted, so the branch becomes which command runs.
 *
 * ONE DELIBERATE DEPARTURE FROM THE SOURCE: legacy opened the popup's href with
 * `window.open(href, ...)` directly. An href out of a `.docx` is attacker-controlled, and
 * this repo's security rules require every one through `sanitizeHref` — allowlist
 * http(s)/mailto/tel/ftp, drop `javascript:`/`data:`/`vbscript:`/`file:`. Copying that
 * line verbatim would open a `javascript:` URL from a hostile document. The sanitizer is
 * legacy's own (`core/utils/sanitizeHref`), ported alongside.
 */
import { useCallback, useState } from 'react';
import type { Editor } from '@docx-editor.dev/core-contract/editor';
import type { HyperlinkData, useHyperlinkDialog } from '../../dialogs/HyperlinkDialog';
import type { HyperlinkPopupData } from '../../ui/HyperlinkPopup';
import { sanitizeHref } from '../../../lib/sanitizeHref';

export function useHyperlinkActions({
  editorRef,
  focusActiveEditor,
  hyperlinkDialog,
}: {
  editorRef: React.RefObject<Editor | null>;
  focusActiveEditor: () => void;
  hyperlinkDialog: ReturnType<typeof useHyperlinkDialog>;
}) {
  const [hyperlinkPopupData, setHyperlinkPopupData] = useState<HyperlinkPopupData | null>(null);

  const handleHyperlinkSubmit = useCallback(
    (data: HyperlinkData) => {
      const editor = editorRef.current;
      if (!editor) return;
      const target = editor.query({ type: 'selection' });
      if (target) {
        editor.exec({
          type: 'insertHyperlink',
          target,
          href: data.url || '',
          ...(data.displayText ? { text: data.displayText } : {}),
        });
      }
      hyperlinkDialog.close();
      focusActiveEditor();
    },
    [editorRef, hyperlinkDialog, focusActiveEditor]
  );

  const doRemoveHyperlink = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const target = editor.query({ type: 'selection' });
    if (target) editor.exec({ type: 'removeHyperlink', target });
    focusActiveEditor();
  }, [editorRef, focusActiveEditor]);

  const handleHyperlinkRemove = useCallback(() => {
    doRemoveHyperlink();
    hyperlinkDialog.close();
  }, [hyperlinkDialog, doRemoveHyperlink]);

  const handleHyperlinkClick = useCallback(
    (data: HyperlinkPopupData) => setHyperlinkPopupData(data),
    []
  );

  const handleHyperlinkPopupNavigate = useCallback((href: string) => {
    const safe = sanitizeHref(href);
    if (!safe) return; // refused scheme — open nothing rather than the raw value
    window.open(safe, '_blank', 'noopener,noreferrer');
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

  return {
    hyperlinkPopupData,
    setHyperlinkPopupData,
    handleHyperlinkSubmit,
    handleHyperlinkRemove,
    handleHyperlinkClick,
    handleHyperlinkPopupNavigate,
    handleHyperlinkPopupCopy,
  };
}
