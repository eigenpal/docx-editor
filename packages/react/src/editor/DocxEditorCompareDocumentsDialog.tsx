import { useEffect, useId, useRef, useState } from 'react';
import type { CompareDocumentsDialogSession } from '@docx-editor.dev/core/editor';
import type { TranslationKey } from '@docx-editor.dev/i18n';
import { useTranslation } from '../i18n';
import {
  createDialogParts,
  DialogFrame,
  type DialogCustomizationProps,
  type UseDialogReturn,
} from './dialog-parts';

/** File types the revised-document picker offers. */
const ACCEPT = '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

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
  const [busy, setBusy] = useState(false);
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
    const outcome = await session.apply({
      revised,
      authorName: values.authorName,
      detectFormatChanges: values.detectFormatChanges,
    });
    if (outcome.ok || session.signal.aborted) return;
    setError(translate('compareDocuments.failed' as TranslationKey, { message: outcome.message }));
    setBusy(false);
  };
  const state: UseCompareDocumentsDialogReturn = {
    values,
    setValue(name, value) {
      setError(undefined);
      setValues((previous) => ({ ...previous, [name]: value }));
    },
    errors: error === undefined ? {} : { form: error },
    isEnabled: !closed && !busy && values.revised !== null && session.canApply(),
    busy,
    apply() {
      void compare();
    },
    cancel() {
      if (!busy) session.cancel();
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
                  accept={ACCEPT}
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
            <p data-docx-part="error" role="alert" className="docx-compare-documents-error">
              {state.errors.form}
            </p>
            <div data-docx-part="footer" className="docx-compare-documents-actions">
              <button data-docx-part="cancel" type="button" disabled={busy} onClick={state.cancel}>
                {t('cancel')}
              </button>
              <button
                data-docx-part="apply"
                type="button"
                disabled={!state.isEnabled}
                aria-busy={busy}
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
