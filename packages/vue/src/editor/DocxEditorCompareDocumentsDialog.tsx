import {
  Fragment,
  computed,
  defineComponent,
  getCurrentInstance,
  ref,
  shallowRef,
  watch,
  type CSSProperties,
  type PropType,
  type Ref,
} from 'vue';
import {
  COMPARE_DOCUMENTS_ACCEPT,
  compareDocumentsErrorKey,
  type CompareDocumentsDialogSession,
  type CompareDocumentsProgress,
} from '@docx-editor.dev/core/editor';
import type { DocxEditorChildren } from '../docx-editor-children';
import { useTranslation } from '../i18n';
import { useEditorState } from './useEditorState';
import {
  NativeDialog,
  createDialogComposition,
  type DialogCustomizationProps,
  type UseDialogReturn,
} from './dialog-parts';

/** The Compare documents draft. @public */
export interface CompareDocumentsDialogValues {
  /** The revised document. The open document is the original. */
  readonly revised: File | null;
  readonly authorName: string;
  readonly detectFormatChanges: boolean;
}
const composition = createDialogComposition<CompareDocumentsDialogValues>('CompareDocumentsDialog');
/** Compare documents draft and actions. @public */
export interface UseCompareDocumentsDialogReturn extends UseDialogReturn<CompareDocumentsDialogValues> {
  /** True while the chosen file is read and compared. */
  readonly busy: Readonly<Ref<boolean>>;
  /**
   * How far the running compare is, when the editor compares in the background (see
   * `reviewModule({ compareWorker })`). Null when no compare runs or none reports its steps.
   */
  readonly progress: Readonly<Ref<CompareDocumentsProgress | null>>;
  /** Whether `cancel()` stops a running compare. True when the editor compares in the background. */
  readonly cancelable: Readonly<Ref<boolean>>;
  /** A message that is not an error, such as that the documents have no differences. */
  readonly notice: Readonly<Ref<string | undefined>>;
}
/** Access the Compare documents draft and actions. @public */
export function useCompareDocumentsDialog(): UseCompareDocumentsDialogReturn {
  return composition.useContext() as UseCompareDocumentsDialogReturn;
}
/** A Compare documents session with customizable dialog parts. @public */
export interface DocxEditorCompareDocumentsDialogProps extends DialogCustomizationProps {
  session: CompareDocumentsDialogSession | null;
}

const Impl = defineComponent({
  name: 'DocxEditorCompareDocumentsDialog',
  props: {
    session: { type: Object as PropType<CompareDocumentsDialogSession | null>, default: null },
    children: Object as PropType<DocxEditorChildren>,
    preset: { type: Boolean, default: true },
    className: String,
    style: Object as PropType<CSSProperties>,
  },
  setup(p, { slots }) {
    const { t: translate } = useTranslation();
    const t = (key: string) =>
      translate(`compareDocuments.${key}` as Parameters<typeof translate>[0]);
    const id = `docx-compare-documents-${getCurrentInstance()!.uid}`;
    const values = shallowRef<CompareDocumentsDialogValues>({
      revised: null,
      authorName: '',
      detectFormatChanges: true,
    });
    const error = ref<string | undefined>();
    const notice = ref<string | undefined>();
    const busy = ref(false);
    const progress = shallowRef<CompareDocumentsProgress | null>(null);
    const cancelable = computed(() => p.session?.cancelable ?? false);
    const closed = ref(false);
    watch(
      () => p.session,
      (session, _old, cleanup) => {
        closed.value = !session || session.signal.aborted;
        error.value = undefined;
        notice.value = undefined;
        busy.value = false;
        progress.value = null;
        if (!session) return;
        values.value = {
          revised: null,
          authorName: session.defaultAuthor,
          detectFormatChanges: true,
        };
        const abort = () => {
          closed.value = true;
        };
        session.signal.addEventListener('abort', abort, { once: true });
        cleanup(() => {
          session.signal.removeEventListener('abort', abort);
          session.cancel();
        });
      },
      { immediate: true }
    );
    const setValue = <K extends keyof CompareDocumentsDialogValues>(
      name: K,
      value: CompareDocumentsDialogValues[K]
    ) => {
      error.value = undefined;
      notice.value = undefined;
      values.value = { ...values.value, [name]: value };
    };
    // The session's own state (viewing, protection, collaboration) moves with the editor.
    const canApply = useEditorState(() => p.session?.canApply() ?? false, Object.is, {
      extraDeps: () => p.session,
    });
    const enabled = computed(
      () => !closed.value && !busy.value && values.value.revised !== null && canApply.value
    );
    const cancel = () => {
      if (!busy.value || cancelable.value) p.session?.cancel();
    };
    const compare = async () => {
      const session = p.session;
      const file = values.value.revised;
      if (!session) return;
      if (!file) {
        error.value = t('fileRequired');
        return;
      }
      busy.value = true;
      error.value = undefined;
      notice.value = undefined;
      let revised: Uint8Array;
      try {
        revised = new Uint8Array(await file.arrayBuffer());
      } catch {
        if (!session.signal.aborted) {
          error.value = t('readFailed');
          busy.value = false;
        }
        return;
      }
      if (session.signal.aborted) return;
      const outcome = await session.apply(
        {
          revised,
          authorName: values.value.authorName,
          detectFormatChanges: values.value.detectFormatChanges,
        },
        { onProgress: (step) => (progress.value = step) }
      );
      if (session.signal.aborted) return;
      progress.value = null;
      // With no differences the dialog stays open and says so; nothing changed.
      if (outcome.ok) notice.value = translate('compareDocuments.noDifferences');
      else error.value = translate(compareDocumentsErrorKey(outcome));
      busy.value = false;
    };
    const apply = () => {
      void compare();
    };
    const state: UseCompareDocumentsDialogReturn = {
      values,
      errors: computed(() => (error.value === undefined ? {} : { form: error.value })),
      isEnabled: enabled,
      busy,
      progress,
      cancelable,
      notice,
      setValue,
      apply,
      cancel,
    };
    const renderParts = composition.provideContext(state);
    return () => {
      if (!p.session || closed.value) return null;
      const v = values.value;
      const defaults = (
        <Fragment>
          <div data-docx-part="header">
            <h2 data-docx-part="title">{t('title')}</h2>
            <p id={`${id}-description`}>{t('description')}</p>
          </div>
          <div data-docx-part="body" class="docx-compare-documents-body">
            <label data-docx-part="field" data-docx-field="revised">
              <span>{t('revisedFile')}</span>
              <input
                type="file"
                accept={COMPARE_DOCUMENTS_ACCEPT}
                disabled={busy.value}
                onChange={(event) =>
                  setValue('revised', (event.target as HTMLInputElement).files?.[0] ?? null)
                }
              />
            </label>
            <label data-docx-part="field" data-docx-field="authorName">
              <span>{t('author')}</span>
              <input
                type="text"
                autocomplete="off"
                value={v.authorName}
                disabled={busy.value}
                onInput={(event) =>
                  setValue('authorName', (event.target as HTMLInputElement).value)
                }
              />
            </label>
            <label
              data-docx-part="field"
              data-docx-field="detectFormatChanges"
              class="docx-compare-documents-check"
            >
              <input
                type="checkbox"
                checked={v.detectFormatChanges}
                disabled={busy.value}
                onChange={(event) =>
                  setValue('detectFormatChanges', (event.target as HTMLInputElement).checked)
                }
              />
              {t('detectFormatting')}
            </label>
          </div>
          {busy.value ? (
            <progress
              data-docx-part="progress"
              class="docx-compare-documents-progress"
              max={1}
              value={progress.value?.fraction}
              aria-label={t('comparing')}
            />
          ) : null}
          <p data-docx-part="error" role="alert" class="docx-compare-documents-error">
            {error.value ?? null}
          </p>
          <p data-docx-part="notice" role="status" class="docx-compare-documents-notice">
            {notice.value ?? null}
          </p>
          <div data-docx-part="footer" class="docx-compare-documents-actions">
            <button
              data-docx-part="cancel"
              type="button"
              disabled={busy.value && !cancelable.value}
              onClick={cancel}
            >
              {/* After a compare with no differences, nothing remains to cancel. */}
              {notice.value ? translate('common.close') : t('cancel')}
            </button>
            <button data-docx-part="apply" type="button" disabled={!enabled.value} onClick={apply}>
              {t(busy.value ? 'comparing' : 'compare')}
            </button>
          </div>
        </Fragment>
      );
      return (
        <NativeDialog
          kind="compareDocuments"
          label={t('title')}
          onClose={cancel}
          sessionSignal={p.session.signal}
          dismissOutside={false}
          describedBy={`${id}-description`}
          busy={busy.value}
          class={['docx-compare-documents-dialog', p.className]}
          style={p.style}
          content={() =>
            renderParts(defaults, slots.default?.() ?? (p.children ? [p.children] : []), p.preset)
          }
        />
      );
    };
  },
});
/** Compare documents with replaceable controls and layout. @public */
export const DocxEditorCompareDocumentsDialog = Object.assign(Impl, composition.parts);
