// The Watermark dialog as a context-fed part (`DocxEditor.WatermarkDialog`).
//
// Three choices: no watermark, a picture, or text. The form seeds from the document's
// current watermark when the dialog opens and writes back ONE `setWatermark` command on
// Apply, so the whole dialog is a single undo step. The host owns visibility
// (`open`/`onClose`); the engine owns everything else.

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import {
  createDialogParts,
  useDialogDocument,
  DialogFrame,
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

/** Props for `DocxEditor.WatermarkDialog`. @public */
export interface DocxEditorWatermarkDialogProps extends DialogCustomizationProps {
  /** Whether the dialog is shown. The host owns this state. */
  open: boolean;
  /** Called on Cancel, Escape, overlay click, and after a successful Apply. */
  onClose: () => void;
  /** The text choices offered for a text watermark. Defaults to `DEFAULT_WATERMARK_PRESETS`. */
  presets?: readonly string[];
}

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

const parts = createDialogParts<WatermarkDialogFieldName, UseWatermarkDialogReturn>();

/** Read the enclosing Watermark dialog draft. @public */
export function useWatermarkDialog(): UseWatermarkDialogReturn {
  return parts.useState();
}

const percentLabel = (factor: number): string => `${Math.round(factor * 100)}%`;

function WatermarkDialogRoot({
  open,
  onClose,
  presets = DEFAULT_WATERMARK_PRESETS,
  className,
  style,
  children,
  preset = true,
}: DocxEditorWatermarkDialogProps): ReactElement | null {
  const { t } = useTranslation();
  const editor = useDocxEditor();
  const validDocument = useDialogDocument(open, onClose);
  const { isEnabled, read, apply } = useWatermark();
  const absent = useEditorState(selectDocumentAbsent);
  const [fields, setFields] = useState<WatermarkDialogFields>({ ...DEFAULT_WATERMARK_FIELDS });
  const [fonts, setFonts] = useState<readonly string[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [pictureFailed, setPictureFailed] = useState(false);
  const panelRef = useRef<HTMLDialogElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const id = useId();

  // Seed when the dialog OPENS on a loaded document, never on later ticks, or a
  // concurrent edit would fight the user's choices. An unload while open re-seeds from
  // the next document instead of stamping the old draft over it.
  const seeded = useRef(false);
  useEffect(() => {
    if (!open || absent || !editor) {
      seeded.current = false;
      return;
    }
    if (seeded.current) return;
    seeded.current = true;
    setFields(seedWatermarkFields(editor.getWatermark(), read()));
    setFonts(editor.getAvailableFonts());
    setRefusal(null);
    setPictureFailed(false);
  }, [open, absent, editor, read]);

  const setValue = useCallback(
    <K extends keyof WatermarkDialogFields>(name: K, value: WatermarkDialogFields[K]) => {
      setRefusal(null);
      setFields((previous) => ({ ...previous, [name]: value }));
    },
    []
  );

  const next = watermarkFromFields(fields);
  const canApply = isEnabled && next !== undefined;

  const handleApply = useCallback(() => {
    if (!canApply || next === undefined) return;
    if (!validDocument()) {
      onClose();
      return;
    }
    // A refused write keeps the dialog OPEN: closing would claim success.
    const result = apply(next);
    if (result.ok) onClose();
    else setRefusal(result.reason);
  }, [canApply, next, validDocument, apply, onClose]);

  const choosePicture = useCallback((file: File | undefined) => {
    if (!file) return;
    setPictureFailed(false);
    void file
      .arrayBuffer()
      .then((buffer) => {
        setFields((previous) => ({
          ...previous,
          kind: 'picture',
          imageData: new Uint8Array(buffer),
          imageName: file.name,
        }));
        setRefusal(null);
      })
      .catch(() => setPictureFailed(true));
  }, []);

  if (!open) return null;

  const picture = fields.kind === 'picture';
  const text = fields.kind === 'text';
  const fontChoices = fonts.includes(fields.fontFamily) ? fonts : [fields.fontFamily, ...fonts];
  const pictureLabel = fields.imageData
    ? (fields.imageName ?? t('dialogs.watermark.currentPicture'))
    : t('dialogs.watermark.noPictureSelected');
  const errorText = refusal !== null ? t('dialogs.watermark.refused') : null;

  const radio = (
    field: WatermarkDialogFieldName,
    kind: WatermarkDialogFields['kind'],
    label: string
  ) => (
    <label data-docx-part="field" data-docx-field={field} className="docx-dialog__checkbox-row">
      <input
        type="radio"
        name={`${id}-kind`}
        checked={fields.kind === kind}
        onChange={() => setValue('kind', kind)}
      />
      <span>{label}</span>
    </label>
  );
  const row = (field: WatermarkDialogFieldName, label: string, control: ReactNode) => (
    <div data-docx-part="field" data-docx-field={field} className="docx-dialog__row">
      <label className="docx-dialog__label" htmlFor={`${id}-${field}`}>
        {label}
      </label>
      {control}
    </div>
  );
  const checkbox = (field: 'washout' | 'bold' | 'italic', label: string, enabled: boolean) => (
    <label data-docx-part="field" data-docx-field={field} className="docx-dialog__checkbox-row">
      <input
        type="checkbox"
        disabled={!enabled}
        checked={fields[field]}
        onChange={(event) => setValue(field, event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );

  const state: UseWatermarkDialogReturn = {
    values: fields,
    setValue,
    errors: errorText ? { form: errorText } : {},
    isEnabled: canApply,
    apply: handleApply,
    cancel: onClose,
  };

  return (
    <DialogFrame
      kind="watermark"
      className={className}
      style={style}
      panelRef={panelRef}
      label={t('dialogs.watermark.title')}
      onClose={onClose}
      onKeyDown={(event) => {
        const target = event.target;
        if (
          event.key === 'Enter' &&
          target instanceof HTMLInputElement &&
          (target.type === 'text' || target.type === 'number') &&
          canApply
        ) {
          event.preventDefault();
          handleApply();
        }
      }}
    >
      <parts.Composition
        state={state}
        preset={preset}
        defaults={
          <>
            <div data-docx-part="header" className="docx-dialog__header">
              <span data-docx-part="title" className="docx-dialog__title">
                {t('dialogs.watermark.title')}
              </span>
            </div>

            <div data-docx-part="body" className="docx-dialog__body">
              {radio('noWatermark', 'none', t('dialogs.watermark.noWatermark'))}

              {radio('pictureWatermark', 'picture', t('dialogs.watermark.picture'))}
              <div className="docx-dialog__section docx-dialog__section--indented">
                <div data-docx-part="field" data-docx-field="picture" className="docx-dialog__row">
                  <button
                    type="button"
                    className="docx-dialog__button"
                    disabled={!picture}
                    onClick={() => fileRef.current?.click()}
                  >
                    {t('dialogs.watermark.selectPicture')}
                  </button>
                  <span className="docx-dialog__hint" data-docx-watermark-picture="">
                    {pictureFailed ? t('dialogs.watermark.pictureFailed') : pictureLabel}
                  </span>
                  <input
                    ref={fileRef}
                    type="file"
                    accept={WATERMARK_IMAGE_ACCEPT}
                    hidden
                    aria-label={t('dialogs.watermark.selectPicture')}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      // Cleared so choosing the SAME file twice fires a change event again.
                      event.target.value = '';
                      choosePicture(file);
                    }}
                  />
                </div>
                {row(
                  'scale',
                  t('dialogs.watermark.scale'),
                  <select
                    id={`${id}-scale`}
                    className="docx-dialog__select"
                    disabled={!picture}
                    value={fields.scale === null ? 'auto' : String(fields.scale)}
                    onChange={(event) =>
                      setValue(
                        'scale',
                        event.target.value === 'auto' ? null : Number(event.target.value)
                      )
                    }
                  >
                    {WATERMARK_SCALES.map((scale) => (
                      <option key={String(scale)} value={scale === null ? 'auto' : String(scale)}>
                        {scale === null ? t('dialogs.watermark.auto') : percentLabel(scale)}
                      </option>
                    ))}
                    {fields.scale !== null && !WATERMARK_SCALES.includes(fields.scale) ? (
                      <option value={String(fields.scale)}>{percentLabel(fields.scale)}</option>
                    ) : null}
                  </select>
                )}
                {checkbox('washout', t('dialogs.watermark.washout'), picture)}
              </div>

              {radio('textWatermark', 'text', t('dialogs.watermark.text'))}
              <div className="docx-dialog__section docx-dialog__section--indented">
                {row(
                  'text',
                  t('dialogs.watermark.textLabel'),
                  <>
                    <input
                      id={`${id}-text`}
                      type="text"
                      className="docx-dialog__input"
                      disabled={!text}
                      maxLength={256}
                      list={`${id}-presets`}
                      value={fields.text}
                      onChange={(event) => setValue('text', event.target.value)}
                    />
                    <datalist id={`${id}-presets`}>
                      {presets.map((choice) => (
                        <option key={choice} value={choice} />
                      ))}
                    </datalist>
                  </>
                )}
                {row(
                  'fontFamily',
                  t('dialogs.watermark.font'),
                  <select
                    id={`${id}-fontFamily`}
                    className="docx-dialog__select"
                    disabled={!text}
                    value={fields.fontFamily}
                    onChange={(event) => setValue('fontFamily', event.target.value)}
                  >
                    {fontChoices.map((family) => (
                      <option key={family} value={family}>
                        {family}
                      </option>
                    ))}
                  </select>
                )}
                {row(
                  'fontSizePt',
                  t('dialogs.watermark.size'),
                  <select
                    id={`${id}-fontSizePt`}
                    className="docx-dialog__select"
                    disabled={!text}
                    value={fields.fontSizePt === null ? 'auto' : String(fields.fontSizePt)}
                    onChange={(event) =>
                      setValue(
                        'fontSizePt',
                        event.target.value === 'auto' ? null : Number(event.target.value)
                      )
                    }
                  >
                    {WATERMARK_SIZES.map((size) => (
                      <option key={String(size)} value={size === null ? 'auto' : String(size)}>
                        {size === null ? t('dialogs.watermark.auto') : String(size)}
                      </option>
                    ))}
                    {fields.fontSizePt !== null && !WATERMARK_SIZES.includes(fields.fontSizePt) ? (
                      <option value={String(fields.fontSizePt)}>{fields.fontSizePt}</option>
                    ) : null}
                  </select>
                )}
                <div className="docx-dialog__row">
                  {checkbox('bold', t('dialogs.watermark.bold'), text)}
                  {checkbox('italic', t('dialogs.watermark.italic'), text)}
                </div>
                {row(
                  'transparency',
                  t('dialogs.watermark.transparency'),
                  <>
                    <input
                      type="range"
                      className="docx-dialog__range"
                      min={0}
                      max={100}
                      step={1}
                      disabled={!text}
                      aria-label={t('dialogs.watermark.transparency')}
                      value={transparencyPercent(fields.transparency)}
                      onChange={(event) =>
                        setValue(
                          'transparency',
                          transparencyFromPercent(event.target.value, fields.transparency)
                        )
                      }
                    />
                    <input
                      id={`${id}-transparency`}
                      type="number"
                      className="docx-dialog__input docx-dialog__input--narrow"
                      min={0}
                      max={100}
                      step={1}
                      disabled={!text}
                      value={transparencyPercent(fields.transparency)}
                      onChange={(event) =>
                        setValue(
                          'transparency',
                          transparencyFromPercent(event.target.value, fields.transparency)
                        )
                      }
                    />
                    <span className="docx-dialog__unit">%</span>
                  </>
                )}
                {row(
                  'color',
                  t('dialogs.watermark.color'),
                  <input
                    id={`${id}-color`}
                    type="color"
                    className="docx-dialog__color"
                    disabled={!text}
                    value={colorInputValue(fields.color)}
                    onChange={(event) => {
                      const color = colorFromInput(event.target.value);
                      if (color) setValue('color', color);
                    }}
                  />
                )}
                <div
                  data-docx-part="field"
                  data-docx-field="layout"
                  className="docx-dialog__row"
                  role="radiogroup"
                  aria-label={t('dialogs.watermark.layout')}
                >
                  <span className="docx-dialog__label">{t('dialogs.watermark.layout')}</span>
                  {(['diagonal', 'horizontal'] as const).map((layout) => (
                    <label key={layout} className="docx-dialog__checkbox-row">
                      <input
                        type="radio"
                        name={`${id}-layout`}
                        disabled={!text}
                        checked={fields.layout === layout}
                        onChange={() => setValue('layout', layout)}
                      />
                      <span>{t(`dialogs.watermark.${layout}`)}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div data-docx-part="footer" className="docx-dialog__footer">
              <span
                data-docx-part="error"
                role="alert"
                className="docx-dialog__error"
                {...(refusal ? { title: refusal } : {})}
              >
                {errorText}
              </span>
              <button
                type="button"
                className="docx-dialog__button"
                data-docx-part="cancel"
                onClick={onClose}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="docx-dialog__button docx-dialog__apply"
                disabled={!canApply}
                data-docx-part="apply"
                onClick={handleApply}
              >
                {t('common.apply')}
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

/**
 * Watermark dialog: no watermark, a picture, or text, with replaceable controls and
 * layout. Applies the whole form as one undoable `setWatermark` command.
 *
 * @public
 */
export const DocxEditorWatermarkDialog = Object.assign(WatermarkDialogRoot, {
  Header: parts.Header,
  Title: parts.Title,
  Body: parts.Body,
  Footer: parts.Footer,
  Apply: parts.Apply,
  Cancel: parts.Cancel,
  Error: parts.Error,
  Field: parts.Field,
});
