// The Watermark dialog as a context-fed part (`DocxEditor.WatermarkDialog`). The Vue twin
// of the React dialog: the same model module, the same fields, one `setWatermark` on Apply.

import type { DocxEditorChildren } from '../docx-editor-children';
import {
  Fragment,
  computed,
  defineComponent,
  getCurrentInstance,
  ref,
  watch,
  type CSSProperties,
  type PropType,
  type VNode,
} from 'vue';
import {
  createDialogComposition,
  NativeDialog,
  useDialogGeneration,
  type DialogCustomizationProps,
  type UseDialogReturn,
} from './dialog-parts';
import { useTranslation } from '../i18n';
import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';
import { selectDocumentAbsent } from './document-presence';
import { useWatermark } from './useWatermark';
import {
  DEFAULT_WATERMARK_FIELDS,
  DEFAULT_WATERMARK_PRESETS,
  WATERMARK_IMAGE_ACCEPT,
  WATERMARK_SCALES,
  WATERMARK_SIZES,
  colorFromInput,
  colorInputValue,
  seedWatermarkFields,
  transparencyFromPercent,
  transparencyPercent,
  watermarkFromFields,
  type WatermarkDialogFields,
} from './watermark-dialog-model';

/** Named controls a host can replace with `DocxEditor.WatermarkDialog.Field`. @public */
export type WatermarkDialogFieldName =
  | 'noWatermark'
  | 'pictureWatermark'
  | 'picture'
  | 'scale'
  | 'washout'
  | 'textWatermark'
  | 'text'
  | 'fontFamily'
  | 'fontSizePt'
  | 'bold'
  | 'italic'
  | 'transparency'
  | 'color'
  | 'layout';

/** Watermark dialog draft and actions. @public */
export interface UseWatermarkDialogReturn extends UseDialogReturn<WatermarkDialogFields> {}

const composition = createDialogComposition<WatermarkDialogFields, WatermarkDialogFieldName>(
  'WatermarkDialog'
);

/** Read the enclosing Watermark dialog draft. @public */
export function useWatermarkDialog(): UseWatermarkDialogReturn {
  return composition.useContext();
}

/** Props for `DocxEditor.WatermarkDialog`. @public */
export interface DocxEditorWatermarkDialogProps extends DialogCustomizationProps {
  /** Whether the dialog is shown. The host owns this state. */
  open: boolean;
  /** Called on Cancel, Escape, overlay click, and after a successful Apply. */
  onClose: () => void;
  /** The text choices offered for a text watermark. Defaults to `DEFAULT_WATERMARK_PRESETS`. */
  presets?: readonly string[];
}

const percentLabel = (factor: number): string => `${Math.round(factor * 100)}%`;

const WatermarkDialogImpl = defineComponent({
  name: 'DocxEditorWatermarkDialog',
  props: {
    children: Object as PropType<DocxEditorChildren>,
    open: { type: Boolean, required: true },
    onClose: { type: Function as PropType<() => void>, required: true },
    presets: { type: Array as PropType<readonly string[]>, default: undefined },
    className: { type: String, default: undefined },
    style: Object as PropType<CSSProperties>,
    preset: { type: Boolean, default: true },
  },
  setup(props, { slots }) {
    const { t } = useTranslation();
    const editorRef = useDocxEditor();
    const currentGeneration = useDialogGeneration(() => props.open, props.onClose);
    const watermark = useWatermark();
    const absent = useEditorState(selectDocumentAbsent);
    const fields = ref<WatermarkDialogFields>({ ...DEFAULT_WATERMARK_FIELDS });
    const fonts = ref<readonly string[]>([]);
    const refusal = ref<string | null>(null);
    const pictureFailed = ref(false);
    const fileInput = ref<HTMLInputElement | null>(null);
    const id = `docx-watermark-${getCurrentInstance()?.uid ?? 0}`;

    // Seed when the dialog OPENS on a loaded document, never on later ticks, or a
    // concurrent edit would fight the user's choices. An unload while open re-seeds from
    // the next document instead of stamping the old draft over it.
    let seeded = false;
    watch(
      [() => props.open, absent, editorRef],
      ([open, isAbsent, editor]) => {
        if (!open || isAbsent || !editor) {
          seeded = false;
          return;
        }
        if (seeded) return;
        seeded = true;
        fields.value = seedWatermarkFields(editor.getWatermark(), watermark.read());
        fonts.value = editor.getAvailableFonts();
        refusal.value = null;
        pictureFailed.value = false;
      },
      { flush: 'post', immediate: true }
    );

    const setValue = <K extends keyof WatermarkDialogFields>(
      name: K,
      value: WatermarkDialogFields[K]
    ) => {
      refusal.value = null;
      fields.value = { ...fields.value, [name]: value };
    };

    const next = computed(() => watermarkFromFields(fields.value));
    const canApply = computed(() => watermark.isEnabled.value && next.value !== undefined);

    const handleApply = () => {
      const value = next.value;
      if (!canApply.value || value === undefined) return;
      if (!currentGeneration()) return;
      // A refused write keeps the dialog OPEN: closing would claim success.
      const result = watermark.apply(value);
      if (result.ok) props.onClose();
      else refusal.value = result.reason;
    };

    const choosePicture = (file: File | undefined) => {
      if (!file) return;
      pictureFailed.value = false;
      void file
        .arrayBuffer()
        .then((buffer) => {
          fields.value = {
            ...fields.value,
            kind: 'picture',
            imageData: new Uint8Array(buffer),
            imageName: file.name,
          };
          refusal.value = null;
        })
        .catch(() => {
          pictureFailed.value = true;
        });
    };

    const errorText = computed(() =>
      refusal.value !== null ? t('dialogs.watermark.refused') : null
    );

    const renderParts = composition.provideContext({
      values: computed(() => fields.value),
      errors: computed(() => (errorText.value ? { form: errorText.value } : {})),
      isEnabled: canApply,
      setValue,
      apply: handleApply,
      cancel: props.onClose,
    });

    return () => {
      if (!props.open) return null;
      const f = fields.value;
      const picture = f.kind === 'picture';
      const text = f.kind === 'text';
      const presets = props.presets ?? DEFAULT_WATERMARK_PRESETS;
      const fontChoices = fonts.value.includes(f.fontFamily)
        ? fonts.value
        : [f.fontFamily, ...fonts.value];
      const pictureLabel = f.imageData
        ? (f.imageName ?? t('dialogs.watermark.currentPicture'))
        : t('dialogs.watermark.noPictureSelected');

      const radio = (
        field: WatermarkDialogFieldName,
        kind: WatermarkDialogFields['kind'],
        label: string
      ) => (
        <label data-docx-part="field" data-docx-field={field} class="docx-dialog__checkbox-row">
          <input
            type="radio"
            name={`${id}-kind`}
            checked={f.kind === kind}
            onChange={() => setValue('kind', kind)}
          />
          <span>{label}</span>
        </label>
      );
      const row = (field: WatermarkDialogFieldName, label: string, control: VNode | VNode[]) => (
        <div data-docx-part="field" data-docx-field={field} class="docx-dialog__row">
          <label class="docx-dialog__label" for={`${id}-${field}`}>
            {label}
          </label>
          {control}
        </div>
      );
      const checkbox = (field: 'washout' | 'bold' | 'italic', label: string, enabled: boolean) => (
        <label data-docx-part="field" data-docx-field={field} class="docx-dialog__checkbox-row">
          <input
            type="checkbox"
            disabled={!enabled}
            checked={f[field]}
            onChange={(event: Event) => setValue(field, (event.target as HTMLInputElement).checked)}
          />
          <span>{label}</span>
        </label>
      );
      const onTransparency = (event: Event) =>
        setValue(
          'transparency',
          transparencyFromPercent((event.target as HTMLInputElement).value, f.transparency)
        );

      const defaults = (
        <Fragment>
          <div data-docx-part="header" class="docx-dialog__header">
            <span data-docx-part="title" class="docx-dialog__title">
              {t('dialogs.watermark.title')}
            </span>
          </div>
          <div data-docx-part="body" class="docx-dialog__body">
            {radio('noWatermark', 'none', t('dialogs.watermark.noWatermark'))}

            {radio('pictureWatermark', 'picture', t('dialogs.watermark.picture'))}
            <div class="docx-dialog__section docx-dialog__section--indented">
              <div data-docx-part="field" data-docx-field="picture" class="docx-dialog__row">
                <button
                  type="button"
                  class="docx-dialog__button"
                  disabled={!picture}
                  onClick={() => fileInput.value?.click()}
                >
                  {t('dialogs.watermark.selectPicture')}
                </button>
                <span class="docx-dialog__hint" data-docx-watermark-picture="">
                  {pictureFailed.value ? t('dialogs.watermark.pictureFailed') : pictureLabel}
                </span>
                <input
                  ref={fileInput}
                  type="file"
                  accept={WATERMARK_IMAGE_ACCEPT}
                  hidden
                  aria-label={t('dialogs.watermark.selectPicture')}
                  onChange={(event: Event) => {
                    const target = event.target as HTMLInputElement;
                    const file = target.files?.[0];
                    // Cleared so choosing the SAME file twice fires a change event again.
                    target.value = '';
                    choosePicture(file);
                  }}
                />
              </div>
              {row(
                'scale',
                t('dialogs.watermark.scale'),
                <select
                  id={`${id}-scale`}
                  class="docx-dialog__select"
                  disabled={!picture}
                  value={f.scale === null ? 'auto' : String(f.scale)}
                  onChange={(event: Event) => {
                    const value = (event.target as HTMLSelectElement).value;
                    setValue('scale', value === 'auto' ? null : Number(value));
                  }}
                >
                  {WATERMARK_SCALES.map((scale) => (
                    <option value={scale === null ? 'auto' : String(scale)}>
                      {scale === null ? t('dialogs.watermark.auto') : percentLabel(scale)}
                    </option>
                  ))}
                  {f.scale !== null && !WATERMARK_SCALES.includes(f.scale) ? (
                    <option value={String(f.scale)}>{percentLabel(f.scale)}</option>
                  ) : null}
                </select>
              )}
              {checkbox('washout', t('dialogs.watermark.washout'), picture)}
            </div>

            {radio('textWatermark', 'text', t('dialogs.watermark.text'))}
            <div class="docx-dialog__section docx-dialog__section--indented">
              {row('text', t('dialogs.watermark.textLabel'), [
                <input
                  id={`${id}-text`}
                  type="text"
                  class="docx-dialog__input"
                  disabled={!text}
                  maxlength={256}
                  list={`${id}-presets`}
                  value={f.text}
                  onInput={(event: Event) =>
                    setValue('text', (event.target as HTMLInputElement).value)
                  }
                />,
                <datalist id={`${id}-presets`}>
                  {presets.map((choice) => (
                    <option value={choice} />
                  ))}
                </datalist>,
              ])}
              {row(
                'fontFamily',
                t('dialogs.watermark.font'),
                <select
                  id={`${id}-fontFamily`}
                  class="docx-dialog__select"
                  disabled={!text}
                  value={f.fontFamily}
                  onChange={(event: Event) =>
                    setValue('fontFamily', (event.target as HTMLSelectElement).value)
                  }
                >
                  {fontChoices.map((family) => (
                    <option value={family}>{family}</option>
                  ))}
                </select>
              )}
              {row(
                'fontSizePt',
                t('dialogs.watermark.size'),
                <select
                  id={`${id}-fontSizePt`}
                  class="docx-dialog__select"
                  disabled={!text}
                  value={f.fontSizePt === null ? 'auto' : String(f.fontSizePt)}
                  onChange={(event: Event) => {
                    const value = (event.target as HTMLSelectElement).value;
                    setValue('fontSizePt', value === 'auto' ? null : Number(value));
                  }}
                >
                  {WATERMARK_SIZES.map((size) => (
                    <option value={size === null ? 'auto' : String(size)}>
                      {size === null ? t('dialogs.watermark.auto') : String(size)}
                    </option>
                  ))}
                  {f.fontSizePt !== null && !WATERMARK_SIZES.includes(f.fontSizePt) ? (
                    <option value={String(f.fontSizePt)}>{f.fontSizePt}</option>
                  ) : null}
                </select>
              )}
              <div class="docx-dialog__row">
                {checkbox('bold', t('dialogs.watermark.bold'), text)}
                {checkbox('italic', t('dialogs.watermark.italic'), text)}
              </div>
              {row('transparency', t('dialogs.watermark.transparency'), [
                <input
                  type="range"
                  class="docx-dialog__range"
                  min={0}
                  max={100}
                  step={1}
                  disabled={!text}
                  aria-label={t('dialogs.watermark.transparency')}
                  value={transparencyPercent(f.transparency)}
                  onInput={onTransparency}
                />,
                <input
                  id={`${id}-transparency`}
                  type="number"
                  class="docx-dialog__input docx-dialog__input--narrow"
                  min={0}
                  max={100}
                  step={1}
                  disabled={!text}
                  value={transparencyPercent(f.transparency)}
                  onInput={onTransparency}
                />,
                <span class="docx-dialog__unit">%</span>,
              ])}
              {row(
                'color',
                t('dialogs.watermark.color'),
                <input
                  id={`${id}-color`}
                  type="color"
                  class="docx-dialog__color"
                  disabled={!text}
                  value={colorInputValue(f.color)}
                  onInput={(event: Event) => {
                    const color = colorFromInput((event.target as HTMLInputElement).value);
                    if (color) setValue('color', color);
                  }}
                />
              )}
              <div
                data-docx-part="field"
                data-docx-field="layout"
                class="docx-dialog__row"
                role="radiogroup"
                aria-label={t('dialogs.watermark.layout')}
              >
                <span class="docx-dialog__label">{t('dialogs.watermark.layout')}</span>
                {(['diagonal', 'horizontal'] as const).map((layout) => (
                  <label class="docx-dialog__checkbox-row">
                    <input
                      type="radio"
                      name={`${id}-layout`}
                      disabled={!text}
                      checked={f.layout === layout}
                      onChange={() => setValue('layout', layout)}
                    />
                    <span>{t(`dialogs.watermark.${layout}`)}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div data-docx-part="footer" class="docx-dialog__footer">
            <span
              data-docx-part="error"
              class="docx-dialog__error"
              role="alert"
              {...(refusal.value ? { title: refusal.value } : {})}
            >
              {errorText.value}
            </span>
            <button
              data-docx-part="cancel"
              class="docx-dialog__button docx-dialog__cancel"
              type="button"
              onClick={props.onClose}
            >
              {t('common.cancel')}
            </button>
            <button
              data-docx-part="apply"
              class="docx-dialog__button docx-dialog__apply"
              type="button"
              disabled={!canApply.value}
              onClick={handleApply}
            >
              {t('common.apply')}
            </button>
          </div>
        </Fragment>
      );
      return (
        <NativeDialog
          kind="watermark"
          label={t('dialogs.watermark.title')}
          onClose={props.onClose}
          class={props.className}
          style={props.style}
          onKeydown={(event: KeyboardEvent) => {
            const target = event.target;
            if (
              event.key === 'Enter' &&
              !event.isComposing &&
              target instanceof HTMLInputElement &&
              (target.type === 'text' || target.type === 'number') &&
              canApply.value
            ) {
              event.preventDefault();
              handleApply();
            }
          }}
          content={() =>
            renderParts(
              defaults,
              slots.default?.() ?? (props.children ? [props.children] : []),
              props.preset
            )
          }
        />
      );
    };
  },
});

/**
 * Watermark dialog: no watermark, a picture, or text, with replaceable controls and
 * layout. Applies the whole form as one undoable `setWatermark` command.
 *
 * @public
 */
export const DocxEditorWatermarkDialog = Object.assign(WatermarkDialogImpl, composition.parts);
