import type { DocxEditorChildren } from '../docx-editor-children';
import {
  defineComponent,
  getCurrentInstance,
  nextTick,
  watch,
  type CSSProperties,
  type PropType,
} from 'vue';
import { useTranslation } from '../i18n';
import {
  CHROME_PRINT_DISPLAY_MODES,
  isChromePrintShortcut,
  isHTMLElementNode,
  type ChromePrintSettings,
  type ResolvedChromePrintSettings,
} from '@docx-editor.dev/core/editor';
import { NativeDialog } from './dialog-parts';

/** State and presentation for the File menu print dialog. @public */
export interface DocxEditorPrintDialogProps {
  /** Controls visibility when rendering the dialog directly. */
  open: boolean;
  /** True while the PDF handler converts the document. */
  pending: boolean;
  /** Localized failure text, or an empty string. */
  error: string;
  /**
   * An object URL for the converted PDF when printing failed after conversion, such as in a
   * browser without a PDF viewer. Otherwise an empty string. The default dialog links only
   * to `blob:` URLs.
   */
  url: string;
  /** Closes the dialog. While `pending` is true, closing also cancels printing. */
  onClose(): void;
  /**
   * True while the dialog shows print settings, before conversion starts. Present only when
   * the menu's `printSettings` step is on.
   */
  choosing?: boolean;
  /** The settings the form shows. */
  settings?: ResolvedChromePrintSettings;
  /** Changes one or both settings. */
  onSettingsChange?: (change: ChromePrintSettings) => void;
  /** Starts conversion with `settings`. */
  onPrint?: () => void;
  /** Additional class on the dialog element. */
  className?: string;
  /** Inline styles on the dialog element. */
  style?: CSSProperties;
  /** Replaces the default contents while retaining the modal and focus behavior. */
  children?: DocxEditorChildren;
}

/**
 * Confirming the settings form removes its focused Print button, which leaves focus on the
 * page body behind the modal. The progress view's button takes it, so Escape and Enter
 * still reach the dialog.
 */
function takeFocusFromForm(button: unknown): void {
  if (!isHTMLElementNode(button)) return;
  const active = button.ownerDocument.activeElement;
  if (!active || !button.closest('dialog')?.contains(active)) {
    button.focus({ preventScroll: true });
  }
}

/**
 * Default progress and error dialog for `popups.print`. The editor closes it when the
 * browser print dialog opens.
 * @public
 */
export const DocxEditorPrintDialog = defineComponent({
  name: 'DocxEditorPrintDialog',
  inheritAttrs: false,
  props: {
    open: { type: Boolean, required: true },
    pending: { type: Boolean, required: true },
    className: String,
    style: Object as PropType<CSSProperties>,
    children: Object as PropType<DocxEditorChildren>,
    error: { type: String, required: true },
    url: { type: String, required: true },
    onClose: { type: Function as PropType<() => void>, required: true },
    choosing: { type: Boolean, default: false },
    settings: { type: Object as PropType<ResolvedChromePrintSettings>, default: undefined },
    onSettingsChange: {
      type: Function as PropType<(change: ChromePrintSettings) => void>,
      default: undefined,
    },
    onPrint: { type: Function as PropType<() => void>, default: undefined },
  },
  setup(props, { attrs, slots }) {
    const { t } = useTranslation();
    const id = `docx-print-${getCurrentInstance()?.uid ?? 0}`;
    // One stable ref, so Vue does not rerun it on every patch. Focus moves only when the
    // settings step ends, after the patch has removed its Print button.
    let progressButton: unknown = null;
    const setProgressButton = (button: unknown) => {
      progressButton = button;
    };
    watch(
      () => props.choosing,
      (now, before) => {
        if (before && !now) void nextTick(() => takeFocusFromForm(progressButton));
      }
    );
    const settingsForm = (
      title: string,
      settings: ResolvedChromePrintSettings,
      change: (change: ChromePrintSettings) => void,
      print: () => void
    ) => {
      const commentsInPane = settings.displayMode === 'all-markup';
      return (
        <>
          <header class="docx-dialog__header" data-docx-part="print-settings">
            <h2 class="docx-dialog__title">{title}</h2>
          </header>
          <div class="docx-dialog__body">
            <fieldset class="docx-dialog__fieldset">
              <legend class="docx-dialog__section-label">{t('toolbar.printMarkup')}</legend>
              {CHROME_PRINT_DISPLAY_MODES.map(({ mode, labelKey }) => (
                <label
                  key={mode}
                  data-docx-part="field"
                  data-docx-field={mode}
                  class="docx-dialog__checkbox-row"
                >
                  <input
                    type="radio"
                    name={`${id}-mode`}
                    checked={settings.displayMode === mode}
                    onChange={() => change({ displayMode: mode })}
                  />
                  {t(labelKey)}
                </label>
              ))}
            </fieldset>
            <label
              data-docx-part="field"
              data-docx-field="comments"
              class="docx-dialog__checkbox-row"
            >
              <input
                type="checkbox"
                checked={settings.comments}
                aria-describedby={commentsInPane ? undefined : `${id}-comments-note`}
                onChange={(event: Event) =>
                  change({ comments: (event.target as HTMLInputElement).checked })
                }
              />
              {t('toolbar.printComments')}
            </label>
            {!commentsInPane && (
              <p id={`${id}-comments-note`} class="docx-dialog__note">
                {t('toolbar.printCommentsNote', { mode: t('review.allMarkup') })}
              </p>
            )}
          </div>
          <footer class="docx-dialog__footer">
            <button type="button" class="docx-dialog__button" onClick={props.onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              class="docx-dialog__button docx-dialog__button--primary"
              onClick={print}
            >
              {t('toolbar.print')}
            </button>
          </footer>
        </>
      );
    };
    return () => {
      if (!props.open) return null;
      const settings = props.settings;
      const change = props.onSettingsChange;
      const print = props.onPrint;
      const form = props.choosing && settings && change && print;
      const title = t(
        props.error ? 'toolbar.printFailed' : form ? 'toolbar.print' : 'toolbar.printPreparing'
      );
      // Only the editor's own object URL becomes a link.
      const openUrl = props.url.startsWith('blob:') ? props.url : '';
      return (
        <NativeDialog
          kind="print"
          label={title}
          role={props.error ? 'alertdialog' : 'dialog'}
          class={[
            'docx-export-dialog',
            'docx-print-dialog',
            props.pending && 'docx-export-dialog--pending',
            props.className,
            attrs.class,
          ]}
          style={props.style}
          dismissOutside={false}
          onClose={props.onClose}
          // The dialog stops key events, so it claims the print shortcut itself. Otherwise
          // the browser prints the editor page while the PDF is prepared.
          onKeydown={(event: KeyboardEvent) => {
            if (!isChromePrintShortcut(event)) return;
            event.preventDefault();
            // On the settings step a second press confirms. A held key's auto-repeat does not,
            // or the press that opened the dialog would print before the user sees the settings.
            if (form && !event.repeat) print();
          }}
          content={() =>
            slots.default?.() ??
            props.children ??
            (form ? (
              settingsForm(title, settings, change, print)
            ) : (
              <>
                <header class="docx-dialog__header">
                  {props.pending && (
                    <div class="docx-export-dialog__progress" aria-hidden="true">
                      <span class="docx-export-dialog__spinner" />
                    </div>
                  )}
                  <h2 class="docx-dialog__title">{title}</h2>
                </header>
                {props.error && (
                  <div class="docx-dialog__body">
                    <p class="docx-export-dialog__message" role="alert">
                      {props.error}
                    </p>
                  </div>
                )}
                <footer class="docx-dialog__footer">
                  {props.error && openUrl && (
                    <a
                      class="docx-dialog__link-button docx-print-dialog__open"
                      href={openUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t('toolbar.printOpenPdf')}
                    </a>
                  )}
                  <button
                    type="button"
                    class="docx-dialog__button"
                    ref={setProgressButton}
                    onClick={props.onClose}
                  >
                    {t(props.error ? 'common.close' : 'common.cancel')}
                  </button>
                </footer>
              </>
            ))
          }
        />
      );
    };
  },
});
