import { useEffect, useId, useRef, useState } from 'react';
import {
  COMPARE_DOCUMENTS_ACCEPT,
  compareDocumentsErrorKey,
  type CompareDocumentsDialogSession,
  type CompareDocumentsProgress,
} from '@docx-editor.dev/core/editor';
import type { TranslationKey } from '@docx-editor.dev/i18n';
import { useTranslation } from '../i18n';
import {
  createDialogParts,
  DialogFrame,
  type DialogCustomizationProps,
  type UseDialogReturn,
} from './dialog-parts';

/** Compare documents session and presentation. @public */
export interface DocxEditorCompareDocumentsDialogProps extends DialogCustomizationProps {
  session: CompareDocumentsDialogSession | null;
}
/** The Compare documents draft. @public */
export interface CompareDocumentsDialogValues {
  /** The revised document. The open document is the original. */
  readonly revised: File | null;
  readonly authorName: string;
  readonly detectFormatChanges: boolean;
}
/** Compare documents draft and actions. @public */
export interface UseCompareDocumentsDialogReturn extends UseDialogReturn<CompareDocumentsDialogValues> {
  /** True while the chosen file is read and compared. */
  readonly busy: boolean;
  /**
   * How far the running compare is, when the editor compares in the background (see
   * `reviewModule({ compareWorker })`). Null when no compare runs or none reports its steps.
   */
  readonly progress: CompareDocumentsProgress | null;
  /** Whether `cancel()` stops a running compare. True when the editor compares in the background. */
  readonly cancelable: boolean;
  /** A message that is not an error, such as that the documents have no differences. */
  readonly notice: string | undefined;
}
const parts = createDialogParts<
  keyof CompareDocumentsDialogValues,
  UseCompareDocumentsDialogReturn
>();
/** Read the enclosing Compare documents draft. @public */
export function useCompareDocumentsDialog(): UseCompareDocumentsDialogReturn {
  return parts.useState();
}

function CompareDocumentsDialogRoot({ session, ...props }: DocxEditorCompareDocumentsDialogProps) {
  return session ? <CompareDocumentsForm session={session} {...props} /> : null;
}
function CompareDocumentsForm({
  session,
  children,
  preset,
  className,
  style,
}: DialogCustomizationProps & { session: CompareDocumentsDialogSession }) {
  const ids = useId();
  const { t: translate } = useTranslation();
  const t = (key: string) => translate(`compareDocuments.${key}` as TranslationKey);
  const [values, setValues] = useState<CompareDocumentsDialogValues>(() => ({
    revised: null,
    authorName: session.defaultAuthor,
    detectFormatChanges: true,
  }));
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<CompareDocumentsProgress | null>(null);
  const [closed, setClosed] = useState(session.signal.aborted);
  const lifetime = useRef<CompareDocumentsDialogSession | null>(null);
  useEffect(() => {
    lifetime.current = session;
    const close = () => setClosed(true);
    setClosed(session.signal.aborted);
    session.signal.addEventListener('abort', close);
    return () => {
      session.signal.removeEventListener('abort', close);
      lifetime.current = null;
      queueMicrotask(() => {
        if (lifetime.current !== session) session.cancel();
      });
    };
  }, [session]);
  const compare = async () => {
    const file = values.revised;
    if (!file) {
      setError(t('fileRequired'));
      return;
    }
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    let revised: Uint8Array;
    try {
      revised = new Uint8Array(await file.arrayBuffer());
    } catch {
      if (!session.signal.aborted) {
        setError(t('readFailed'));
        setBusy(false);
      }
      return;
    }
    if (session.signal.aborted) return;
    const outcome = await session.apply(
      {
        revised,
        authorName: values.authorName,
        detectFormatChanges: values.detectFormatChanges,
      },
      { onProgress: setProgress }
    );
    if (session.signal.aborted) return;
    setProgress(null);
    // With no differences the dialog stays open and says so; nothing changed.
    if (outcome.ok) setNotice(translate('compareDocuments.noDifferences'));
    else setError(translate(compareDocumentsErrorKey(outcome)));
    setBusy(false);
  };
  const state: UseCompareDocumentsDialogReturn = {
    values,
    setValue(name, value) {
      setError(undefined);
      setNotice(undefined);
      setValues((previous) => ({ ...previous, [name]: value }));
    },
    errors: error === undefined ? {} : { form: error },
    isEnabled: !closed && !busy && values.revised !== null && session.canApply(),
    busy,
    progress,
    cancelable: session.cancelable,
    notice,
    apply() {
      void compare();
    },
    cancel() {
      if (!busy || session.cancelable) session.cancel();
    },
  };
  if (closed) return null;
  return (
    <DialogFrame
      kind="compareDocuments"
      label={t('title')}
      className={['docx-compare-documents-dialog', className].filter(Boolean).join(' ')}
      style={style}
      onClose={state.cancel}
      dismissOutside={false}
      sessionSignal={session.signal}
      describedBy={`${ids}-description`}
      busy={busy}
    >
      <parts.Composition
        state={state}
        preset={preset}
        defaults={
          <>
            <div data-docx-part="header">
              <h2 data-docx-part="title">{t('title')}</h2>
              <p id={`${ids}-description`}>{t('description')}</p>
            </div>
            <div data-docx-part="body" className="docx-compare-documents-body">
              <label data-docx-part="field" data-docx-field="revised">
                <span>{t('revisedFile')}</span>
                <input
                  type="file"
                  accept={COMPARE_DOCUMENTS_ACCEPT}
                  disabled={busy}
                  onChange={(event) =>
                    state.setValue('revised', event.currentTarget.files?.[0] ?? null)
                  }
                />
              </label>
              <label data-docx-part="field" data-docx-field="authorName">
                <span>{t('author')}</span>
                <input
                  type="text"
                  autoComplete="off"
                  value={values.authorName}
                  disabled={busy}
                  onChange={(event) => state.setValue('authorName', event.currentTarget.value)}
                />
              </label>
              <label
                data-docx-part="field"
                data-docx-field="detectFormatChanges"
                className="docx-compare-documents-check"
              >
                <input
                  type="checkbox"
                  checked={values.detectFormatChanges}
                  disabled={busy}
                  onChange={(event) =>
                    state.setValue('detectFormatChanges', event.currentTarget.checked)
                  }
                />
                {t('detectFormatting')}
              </label>
            </div>
            {busy ? (
              <progress
                data-docx-part="progress"
                className="docx-compare-documents-progress"
                max={1}
                value={progress?.fraction}
                aria-label={t('comparing')}
              />
            ) : null}
            <p data-docx-part="error" role="alert" className="docx-compare-documents-error">
              {state.errors.form}
            </p>
            <p data-docx-part="notice" role="status" className="docx-compare-documents-notice">
              {notice}
            </p>
            <div data-docx-part="footer" className="docx-compare-documents-actions">
              <button
                data-docx-part="cancel"
                type="button"
                disabled={busy && !session.cancelable}
                onClick={state.cancel}
              >
                {/* After a compare with no differences, nothing remains to cancel. */}
                {notice ? translate('common.close') : t('cancel')}
              </button>
              <button
                data-docx-part="apply"
                type="button"
                disabled={!state.isEnabled}
                onClick={state.apply}
              >
                {t(busy ? 'comparing' : 'compare')}
              </button>
            </div>
          </>
        }
      >
        {children}
      </parts.Composition>
    </DialogFrame>
  );
}
/** Compare documents with replaceable controls and layout. @public */
export const DocxEditorCompareDocumentsDialog = Object.assign(CompareDocumentsDialogRoot, {
  Header: parts.Header,
  Title: parts.Title,
  Body: parts.Body,
  Footer: parts.Footer,
  Apply: parts.Apply,
  Cancel: parts.Cancel,
  Error: parts.Error,
  Field: parts.Field,
});
