import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  ChromeExportError,
  ChromePrintError,
  runChromePrint,
  type ChromeExportHandlers,
  type ChromePrintJob,
} from '@docx-editor.dev/core/editor';
import type { Editor } from '@docx-editor.dev/core';
import { useTranslation } from '../../i18n';

/**
 * File > Print state: converts through the PDF handler, then opens the browser print
 * dialog. The popup shows only while the PDF is prepared and after a failure.
 *
 * The popup stays up while the PDF loads and closes BEFORE printing starts. It is modal, and a modal dialog makes the rest
 * of the page, including the print frame, inert.
 *
 * `feedback` is false when the host suppresses the popup. A failure then ends the session
 * at once, because no popup remains to close it.
 *
 * The PDF stays loaded until the next print or unmount: removing a frame while the browser
 * still prints from it can cancel the printout, and an Open PDF tab can still be reading
 * its URL.
 */
export function useMenuPrint(
  editor: Editor | null,
  exporters: ChromeExportHandlers | undefined,
  feedback: boolean
) {
  const { t } = useTranslation();
  // The latest inputs, read when an action runs, so the actions keep one identity.
  const inputs = useRef({ editor, exporters, feedback, t });
  inputs.current = { editor, exporters, feedback, t };
  // The current print session. Closing the dialog clears it, so a conversion that
  // finishes afterward sees a stale session and discards its PDF instead of printing.
  const current = useRef<object | null>(null);
  const job = useRef<ChromePrintJob | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');
  const [visible, setVisible] = useState(false);
  // True from File > Print until the session ends, including while the popup is hidden.
  const [active, setActive] = useState(false);
  const [session, setSession] = useState<object>({});

  const failure = useCallback((cause: unknown) => {
    const { t } = inputs.current;
    if (cause instanceof ChromeExportError) return t('toolbar.printPdfMissing');
    if (cause instanceof ChromePrintError) {
      if (cause.code === 'pdf-viewer-unavailable') return t('toolbar.printNoViewer');
      if (cause.code === 'pdf-load-failed') return t('toolbar.printLoadFailed');
      if (cause.code === 'print-refused') return t('toolbar.printRefused');
    }
    return t('toolbar.printFailedMessage', {
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }, []);

  const end = useCallback(() => {
    current.current = null;
    setActive(false);
    setVisible(false);
    setPending(false);
  }, []);

  const execute = useCallback(
    async (container?: Element | Document) => {
      const { editor, exporters } = inputs.current;
      if (!editor || current.current) return;
      const token = {};
      current.current = token;
      job.current?.dispose();
      job.current = null;
      setSession(token);
      setActive(true);
      setVisible(true);
      setPending(true);
      setError('');
      setUrl('');
      try {
        const prepared = await runChromePrint(editor, exporters, container ?? document);
        if (current.current !== token) {
          prepared.dispose();
          return;
        }
        job.current = prepared;
        await prepared.print({
          // Commit the closed popup now, so its modal state is gone when printing starts.
          beforePrint: () => {
            // Cancel while the PDF loaded: stop before the print dialog opens.
            if (current.current !== token) throw new ChromePrintError('print-ended');
            flushSync(() => setVisible(false));
          },
        });
        if (current.current === token) end();
      } catch (cause) {
        if (current.current !== token) return;
        if (!inputs.current.feedback) {
          // No popup reports it, so the failure goes where a failed save goes.
          console.error('[docx-editor] print failed', cause);
          end();
          return;
        }
        setPending(false);
        setUrl(job.current?.url ?? '');
        setError(failure(cause));
        setVisible(true);
      }
    },
    [end, failure]
  );

  // Unmounting the menu ends the session and the job, which removes its frame and revokes
  // its URL. A conversion that finishes afterward sees no session and discards its PDF.
  useEffect(
    () => () => {
      current.current = null;
      job.current?.dispose();
      job.current = null;
    },
    []
  );

  return { pending, error, url, visible, active, session, execute, close: end };
}
