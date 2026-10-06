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
} from 'vue';
import {
  DEFAULT_REVISION_MARKUP,
  REVISION_MARKUP_COLORS,
  type ResolvedRevisionMarkup,
  type RevisionMarkupOptions,
  type RevisionMarkupDialogSession,
} from '@docx-editor.dev/core/editor';
import type { DocxEditorChildren } from '../docx-editor-children';
import { useTranslation } from '../i18n';
import {
  NativeDialog,
  createDialogComposition,
  type DialogCustomizationProps,
  type UseDialogReturn,
} from './dialog-parts';
import { RevisionMarkupColorPicker } from './revision-markup-color-picker';

const composition = createDialogComposition<ResolvedRevisionMarkup>('RevisionMarkupDialog');
/** Viewer markup draft state and actions. @public */
export interface UseRevisionMarkupDialogReturn extends UseDialogReturn<ResolvedRevisionMarkup> {
  reset(): void;
}
/** Access the markup dialog draft and actions. @public */
export function useRevisionMarkupDialog(): UseRevisionMarkupDialogReturn {
  return composition.useContext() as UseRevisionMarkupDialogReturn;
}
/** A markup settings session with customizable dialog parts. @public */
export interface DocxEditorRevisionMarkupDialogProps extends DialogCustomizationProps {
  session: RevisionMarkupDialogSession | null;
}
const marks = [
  'none',
  'colorOnly',
  'bold',
  'italic',
  'underline',
  'doubleUnderline',
  'strikethrough',
  'doubleStrikethrough',
];
const deletionMarks = [...marks, 'hidden', 'caret', 'pound'];
type StyleKey =
  | 'insertions'
  | 'deletions'
  | 'changedLines'
  | 'movedFrom'
  | 'movedTo'
  | 'formatting';

const Impl = defineComponent({
  name: 'DocxEditorRevisionMarkupDialog',
  props: {
    session: { type: Object as PropType<RevisionMarkupDialogSession | null>, default: null },
    children: Object as PropType<DocxEditorChildren>,
    preset: { type: Boolean, default: true },
    className: String,
    style: Object as PropType<CSSProperties>,
  },
  setup(p, { slots }) {
    const { t: translate } = useTranslation();
    const t = (key: string) =>
      translate(`revisionMarkup.${key}` as Parameters<typeof translate>[0]);
    const id = `docx-revision-markup-${getCurrentInstance()!.uid}`;
    const values = shallowRef<ResolvedRevisionMarkup>(DEFAULT_REVISION_MARKUP);
    const closed = ref(false);
    const refused = ref(false);
    const enabled = ref(false);
    watch(
      () => p.session,
      (session, _old, cleanup) => {
        closed.value = !session || session.signal.aborted;
        refused.value = false;
        if (!session) {
          enabled.value = false;
          return;
        }
        const update = () => {
          values.value = session.get();
          enabled.value = session.canApply();
        };
        update();
        const unsubscribe = session.subscribe(update);
        const abort = () => {
          closed.value = true;
          enabled.value = false;
        };
        session.signal.addEventListener('abort', abort, { once: true });
        cleanup(() => {
          unsubscribe();
          session.signal.removeEventListener('abort', abort);
          session.cancel();
        });
      },
      { immediate: true }
    );
    const set = (patch: RevisionMarkupOptions) => p.session?.set(patch);
    const cancel = () => p.session?.cancel();
    const apply = () => {
      refused.value = !p.session?.apply();
    };
    const reset = () => p.session?.reset();
    const renderParts = composition.provideContext({
      values,
      errors: computed(() =>
        refused.value ? { form: translate('dialogs.paragraph.refused') } : {}
      ),
      isEnabled: enabled,
      setValue: (name, value) => set({ [name]: value }),
      apply,
      cancel,
      reset,
    });
    return () => {
      if (!p.session || closed.value) return null;
      const v = values.value;
      const color = (
        label: string,
        value: string,
        colors: readonly string[],
        change: (value: string) => void,
        disabled = false
      ) => (
        <RevisionMarkupColorPicker
          label={t(label)}
          value={value}
          colors={colors}
          onChange={change}
          disabled={disabled}
          translate={(value) => t(`values.${value}`)}
        />
      );
      const style = (key: StyleKey, choices: readonly string[]) => {
        const disabled =
          !enabled.value || ((key === 'movedFrom' || key === 'movedTo') && !v.trackMoves);
        return (
          <div
            {...(key === 'changedLines'
              ? {}
              : { 'data-docx-part': 'field', 'data-docx-field': key })}
          >
            <div class="docx-revision-markup-row">
              <span aria-hidden="true" class="docx-revision-markup-row-title">
                {t(key)}
              </span>
              <label>
                <span class="docx-revision-markup-field-label">{t(key)}</span>
                <select
                  value={v[key].mark}
                  disabled={disabled}
                  onChange={(event) =>
                    set({ [key]: { mark: (event.target as HTMLSelectElement).value } })
                  }
                >
                  {choices.map((value) => (
                    <option value={value} key={value}>
                      {t(`values.${value}`)}
                    </option>
                  ))}
                </select>
              </label>
              {color(
                `${key}Color`,
                v[key].color,
                ['byAuthor', 'auto', ...REVISION_MARKUP_COLORS],
                (value) => set({ [key]: { color: value } }),
                disabled
              )}
            </div>
            {key !== 'changedLines' && (
              <div class="docx-revision-markup-background">
                {color(
                  `${key}Background`,
                  v[key].background,
                  ['none', 'byAuthor', ...REVISION_MARKUP_COLORS],
                  (value) => set({ [key]: { background: value } }),
                  disabled
                )}
              </div>
            )}
          </div>
        );
      };
      const checkbox = (key: 'trackMoves' | 'trackFormatting') => (
        <div data-docx-part="field" data-docx-field={key}>
          <label>
            <input
              type="checkbox"
              checked={v[key]}
              disabled={!enabled.value}
              aria-describedby={`${id}-${key}`}
              onChange={(event) => set({ [key]: (event.target as HTMLInputElement).checked })}
            />
            {t(key)}
          </label>
          <p id={`${id}-${key}`}>{t(`${key}Note`)}</p>
        </div>
      );
      const defaults = (
        <Fragment>
          <div data-docx-part="header">
            <h2 data-docx-part="title">{t('title')}</h2>
          </div>
          <div data-docx-part="body" class="docx-revision-markup-body">
            <fieldset class="docx-revision-markup-markup">
              <legend>{t('markup')}</legend>
              {style('insertions', marks)}
              {style('deletions', deletionMarks)}
              <div data-docx-part="field" data-docx-field="changedLines">
                {style('changedLines', ['none', 'leftBorder', 'rightBorder', 'outsideBorder'])}
              </div>
            </fieldset>
            <fieldset class="docx-revision-markup-moves">
              <legend>{t('moves')}</legend>
              {checkbox('trackMoves')}
              {style('movedFrom', deletionMarks)}
              {style('movedTo', marks)}
            </fieldset>
            <fieldset
              data-docx-part="field"
              data-docx-field="cells"
              class="docx-revision-markup-tableCells"
            >
              <legend>{t('tableCells')}</legend>
              {(['inserted', 'deleted', 'merged', 'split'] as const).map((key) =>
                color(
                  `${key}Cells`,
                  v.cells[key],
                  ['byAuthor', 'none', ...REVISION_MARKUP_COLORS],
                  (value) => set({ cells: { [key]: value } }),
                  !enabled.value
                )
              )}
            </fieldset>
            <fieldset class="docx-revision-markup-formatting">
              <legend>{t('formatting')}</legend>
              {checkbox('trackFormatting')}
              {style('formatting', marks)}
            </fieldset>
            <div data-docx-part="error" role="alert">
              {refused.value ? translate('dialogs.paragraph.refused') : null}
            </div>
          </div>
          <div data-docx-part="footer" class="docx-revision-markup-actions">
            <button data-docx-part="reset" type="button" disabled={!enabled.value} onClick={reset}>
              {t('reset')}
            </button>
            <button data-docx-part="cancel" type="button" onClick={cancel}>
              {t('cancel')}
            </button>
            <button data-docx-part="apply" type="button" disabled={!enabled.value} onClick={apply}>
              {t('ok')}
            </button>
          </div>
        </Fragment>
      );
      return (
        <NativeDialog
          kind="revisionMarkup"
          label={t('title')}
          onClose={cancel}
          sessionSignal={p.session.signal}
          dismissOutside={false}
          class={['docx-revision-markup-dialog', p.className]}
          style={p.style}
          content={() =>
            renderParts(defaults, slots.default?.() ?? (p.children ? [p.children] : []), p.preset)
          }
        />
      );
    };
  },
});
/** Customizable viewer-local Track changes options. @public */
export const DocxEditorRevisionMarkupDialog = Object.assign(Impl, composition.parts);
