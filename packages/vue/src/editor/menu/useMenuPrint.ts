import { nextTick, onScopeDispose, ref, shallowRef, type Ref } from 'vue';
import {
  ChromeExportError,
  ChromePrintError,
  runChromePrint,
  type ChromeExportHandlers,
  type ChromePrintJob,
  type ChromePrintSettings,
  type ResolvedChromePrintSettings,
  hostDocumentOf,
  initialChromePrintSettings,
} from '@docx-editor.dev/core/editor';
import type { Editor } from '@docx-editor.dev/core';
import { useTranslation } from '../../i18n';

interface UseMenuPrintReturn {
  readonly pending: Ref<boolean>;
  readonly error: Ref<string>;
  readonly url: Ref<string>;
  readonly visible: Ref<boolean>;
  /** True from File > Print until the session ends, including while the popup is hidden. */
  readonly active: Ref<boolean>;
  readonly session: Ref<object>;
  /** True while the settings form shows, before conversion starts. */
  readonly choosing: Ref<boolean>;
  readonly settings: Ref<ResolvedChromePrintSettings>;
  readonly execute: (container?: Element | Document) => Promise<void>;
  readonly changeSettings: (change: ChromePrintSettings) => void;
  /** Starts conversion with the settings the form shows. */
  readonly confirm: () => void;
  readonly close: () => void;
}

/**
 * File > Print state: converts through the PDF handler, then opens the browser print
 * dialog. With `settingsStep` on, the popup first shows the print settings form, and
 * conversion starts when the user confirms. Otherwise the popup shows only while the PDF
 * is prepared and after a failure.
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
  editor: Ref<Editor | null>,
  exporters: () => ChromeExportHandlers | undefined,
  feedback: () => boolean,
  settingsStep: () => boolean = () => false
): UseMenuPrintReturn {
  const { t } = useTranslation();
  // The current print session. Closing the popup clears it, so a conversion that finishes
  // afterward sees a stale session and discards its PDF instead of printing.
  let current: object | null = null;
  let job: ChromePrintJob | null = null;
  const pending = ref(false);
  const error = ref('');
  const url = ref('');
  const visible = ref(false);
  const active = ref(false);
  const session = shallowRef<object>({});
  const choosing = ref(false);
  const settings = ref<ResolvedChromePrintSettings>(initialChromePrintSettings(null));
  let container: Element | Document | undefined;

  const failure = (cause: unknown) => {
    if (cause instanceof ChromeExportError) return t('toolbar.printPdfMissing');
    if (cause instanceof ChromePrintError) {
      if (cause.code === 'pdf-viewer-unavailable') return t('toolbar.printNoViewer');
      if (cause.code === 'pdf-load-failed') return t('toolbar.printLoadFailed');
      if (cause.code === 'print-refused') return t('toolbar.printRefused');
    }
    return t('toolbar.printFailedMessage', {
      message: cause instanceof Error ? cause.message : String(cause),
    });
  };

  const end = () => {
    current = null;
    active.value = false;
    visible.value = false;
    pending.value = false;
    choosing.value = false;
  };

  const convert = async (token: object, chosen: ChromePrintSettings) => {
    if (!editor.value || current !== token) return;
    choosing.value = false;
    pending.value = true;
    try {
      const prepared = await runChromePrint(
        editor.value,
        exporters(),
        container ?? hostDocumentOf(null),
        chosen
      );
      if (current !== token) {
        prepared.dispose();
        return;
      }
      job = prepared;
      await prepared.print({
        // Unmount the popup now, so its modal state is gone when printing starts.
        beforePrint: async () => {
          // Cancel while the PDF loaded: stop before the print dialog opens.
          if (current !== token) throw new ChromePrintError('print-ended');
          visible.value = false;
          await nextTick();
        },
      });
      if (current === token) end();
    } catch (cause) {
      if (current !== token) return;
      if (!feedback()) {
        // No popup reports it, so the failure goes where a failed save goes.
        console.error('[docx-editor] print failed', cause);
        end();
        return;
      }
      pending.value = false;
      url.value = job?.url ?? '';
      error.value = failure(cause);
      visible.value = true;
    }
  };

  const execute = async (target?: Element | Document) => {
    if (!editor.value || current) return;
    const token = {};
    current = token;
    container = target;
    job?.dispose();
    job = null;
    session.value = token;
    active.value = true;
    visible.value = true;
    error.value = '';
    url.value = '';
    // Without a popup there is no form, so printing starts with the current view. Without
    // a PDF handler, the setup error shows at once instead of after the form.
    if (!settingsStep() || !feedback() || !exporters()?.pdf) {
      await convert(token, {});
      return;
    }
    settings.value = initialChromePrintSettings(editor.value.snapshot());
    pending.value = false;
    choosing.value = true;
  };

  const changeSettings = (change: ChromePrintSettings) => {
    settings.value = { ...settings.value, ...change };
  };

  // A double click on Print, or Print and the shortcut together, must convert once.
  const confirm = () => {
    if (current && choosing.value) void convert(current, settings.value);
  };

  // Unmounting the menu ends the session and the job, which removes its frame and revokes
  // its URL. A conversion that finishes afterward sees no session and discards its PDF.
  onScopeDispose(() => {
    current = null;
    job?.dispose();
    job = null;
  });

  return {
    pending,
    error,
    url,
    visible,
    active,
    session,
    choosing,
    settings,
    execute,
    changeSettings,
    confirm,
    close: end,
  };
}
