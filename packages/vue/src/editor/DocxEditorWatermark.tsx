// The Watermark dialog as a context-fed part (`DocxEditor.WatermarkDialog`). The Vue twin
// of the React dialog: the same model module, the same fields and live page preview, one
// `setWatermark` on Apply, and no write at all when the form is unchanged.

import type { DocxEditorChildren } from '../docx-editor-children';
import {
  Fragment,
  computed,
  defineComponent,
  getCurrentInstance,
  nextTick,
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
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { useWatermark } from './useWatermark';
import {
  DEFAULT_WATERMARK_FIELDS,
  DEFAULT_WATERMARK_PRESETS,
  WATERMARK_IMAGE_ACCEPT,
  WATERMARK_SCALES,
  WATERMARK_SIZES,
  WATERMARK_WASHOUT_FILTER,
  colorFromInput,
  colorInputValue,
  seedWatermarkFields,
  transparencyFromPercent,
  transparencyPercent,
  watermarkBaseline,
  watermarkFieldsEqual,
  watermarkFromFields,
  watermarkPresetValue,
  watermarkPreviewLines,
  watermarkPreviewPage,
  watermarkPreviewPicture,
  watermarkPreviewInk,
  watermarkPreviewText,
  watermarkPreviewTextTransform,
  WATERMARK_PREVIEW_FONT_SIZE,
  type WatermarkDialogFields,
} from './watermark-dialog-model';

const selectPageSetup = (snapshot: EditorSnapshot) => snapshot.pageSetup ?? null;

/** Named controls a host can replace with `DocxEditor.WatermarkDialog.Field`. @public */
export type WatermarkDialogFieldName =
  | 'noWatermark'
  | 'pictureWatermark'
  | 'picture'
  | 'scale'
  | 'washout'
  | 'textWatermark'
  | 'preset'
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

const PreviewPart = composition.part('Preview');

/** The page thumbnail with the current draft drawn over it. Decorative: the fields say it all. */
const WatermarkPreview = defineComponent({
  name: 'DocxEditorWatermarkDialogPreviewView',
  setup() {
    const dialog = useWatermarkDialog();
    const pageSetup = useEditorState(selectPageSetup);
    const previewPage = computed(() => watermarkPreviewPage(pageSetup.value));
    const pictureUrl = ref<string | null>(null);
    // An object URL for the picture bytes, revoked when the bytes change or on unmount.
    watch(
      () => (dialog.values.value.kind === 'picture' ? dialog.values.value.imageData : null),
      (bytes, _previous, onCleanup) => {
        if (!bytes || typeof URL.createObjectURL !== 'function') {
          pictureUrl.value = null;
          return;
        }
        const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
        pictureUrl.value = url;
        onCleanup(() => URL.revokeObjectURL(url));
      },
      { immediate: true }
    );
    return () => {
      const values = dialog.values.value;
      const page = previewPage.value;
      const text = watermarkPreviewText(values, page);
      const picture = pictureUrl.value ? watermarkPreviewPicture(values, page) : null;
      return (
        <div data-docx-part="preview" aria-hidden="true" class="docx-dialog__preview">
          <svg
            class="docx-dialog__preview-page"
            viewBox={`0 0 ${page.width} ${page.height}`}
            focusable="false"
          >
            <rect
              class="docx-dialog__preview-sheet"
              x={0}
              y={0}
              width={page.width}
              height={page.height}
            />
            {/* The watermark paints behind the text lines, as it does on the page. */}
            {text ? (
              <text
                data-docx-watermark-preview="text"
                x={0}
                y={0}
                font-family={text.fontFamily}
                font-size={WATERMARK_PREVIEW_FONT_SIZE}
                font-weight={text.fontWeight}
                font-style={text.fontStyle}
                fill={text.fill}
                fill-opacity={text.opacity}
                transform={watermarkPreviewTextTransform(text, watermarkPreviewInk(text))}
              >
                {text.text}
              </text>
            ) : null}
            {pictureUrl.value && picture ? (
              <image
                data-docx-watermark-preview="picture"
                class="docx-dialog__preview-picture"
                href={pictureUrl.value}
                x={picture.x}
                y={picture.y}
                width={picture.width}
                height={picture.height}
                preserveAspectRatio="none"
                style={values.washout ? { filter: WATERMARK_WASHOUT_FILTER } : undefined}
              />
            ) : null}
            {watermarkPreviewLines(page).map((line) => (
              <rect
                class="docx-dialog__preview-line"
                x={line.x}
                y={line.y}
                width={line.width}
                height={line.height}
              />
            ))}
          </svg>
        </div>
      );
    };
  },
});

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
    let baseline: WatermarkDialogFields | null = null;

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
        const state = editor.getWatermark();
        const seed = seedWatermarkFields(state, watermark.read());
        baseline = watermarkBaseline(state, seed);
        fields.value = seed;
        fonts.value = editor.getAvailableFonts();
        refusal.value = null;
        pictureFailed.value = false;
        // Focus follows the seed: the checked kind, not the first choice.
        void nextTick(() => {
          document
            .querySelector<HTMLInputElement>(`input[name="${id}-kind"]:checked`)
            ?.focus({ preventScroll: true });
        });
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
      // An unchanged draft writes nothing, so it leaves no empty undo step.
      if (baseline && watermarkFieldsEqual(baseline, fields.value)) {
        props.onClose();
        return;
      }
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
          <span id={`${id}-${field}-label`}>{label}</span>
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
            <div class="docx-dialog__watermark-layout">
              <WatermarkPreview data-docx-part="preview" />
              <fieldset class="docx-dialog__fieldset">
                <legend class="docx-editor-sr-only">{t('dialogs.watermark.kind')}</legend>
                {radio('noWatermark', 'none', t('dialogs.watermark.noWatermark'))}

                {radio('pictureWatermark', 'picture', t('dialogs.watermark.picture'))}
                <div
                  class="docx-dialog__section docx-dialog__section--indented"
                  role="group"
                  aria-labelledby={`${id}-pictureWatermark-label`}
                >
                  <div data-docx-part="field" data-docx-field="picture" class="docx-dialog__row">
                    <button
                      type="button"
                      class="docx-dialog__button"
                      onClick={() => {
                        setValue('kind', 'picture');
                        fileInput.value?.click();
                      }}
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
                <div
                  class="docx-dialog__section docx-dialog__section--indented"
                  role="group"
                  aria-labelledby={`${id}-textWatermark-label`}
                >
                  {row(
                    'preset',
                    t('dialogs.watermark.preset'),
                    <select
                      id={`${id}-preset`}
                      class="docx-dialog__select"
                      disabled={!text}
                      value={watermarkPresetValue(f.text, presets)}
                      onChange={(event: Event) => {
                        const value = (event.target as HTMLSelectElement).value;
                        if (value !== '') setValue('text', value);
                      }}
                    >
                      <option value="">{t('dialogs.watermark.custom')}</option>
                      {presets.map((choice) => (
                        <option value={choice}>{choice}</option>
                      ))}
                    </select>
                  )}
                  {row(
                    'text',
                    t('dialogs.watermark.textLabel'),
                    <input
                      id={`${id}-text`}
                      type="text"
                      class="docx-dialog__input"
                      disabled={!text}
                      maxlength={256}
                      value={f.text}
                      onInput={(event: Event) =>
                        setValue('text', (event.target as HTMLInputElement).value)
                      }
                    />
                  )}
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
              </fieldset>
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
 * Watermark dialog: no watermark, a picture, or text, with a live page preview and
 * replaceable controls and layout. Applies the whole form as one undoable `setWatermark`
 * command, and writes nothing when the form is unchanged.
 *
 * @public
 */
export const DocxEditorWatermarkDialog = Object.assign(WatermarkDialogImpl, {
  ...composition.parts,
  /** The page preview of the current draft. Decorative (`aria-hidden`). */
  Preview: PreviewPart,
});
