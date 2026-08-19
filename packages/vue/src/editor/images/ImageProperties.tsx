import { computed, defineComponent, nextTick, ref, watch, type PropType } from 'vue';
import type { DocxEditorChildren } from '../../docx-editor-children';
import { refAsRefObject, type RefObject } from '../../docx-editor-ref-object';
// Image properties dialog — one atomic `setImageProperties` on Apply.

import type { EditorSnapshot, SelectedImageState } from '@docx-editor.dev/core/contracts/editor';
import type { DrawingPositionInput, ImageWrapTarget } from '@docx-editor.dev/core/editor';
import {
  DRAWING_REL_FROM_H,
  DRAWING_REL_FROM_V,
  IMAGE_WRAP_TARGETS,
  positionInputFromPropertiesCommand,
  validateDrawingPositionInput,
} from '@docx-editor.dev/core/editor';
import { useTranslation } from '../../i18n';
import { useStableDocxId } from '../../lib/stable-id';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from '../toolbar/ToolbarButton';
import { Slot } from '../toolbar/Slot';
import { emuToPoints, pointsToEmu } from './normalizeImageFile';

const selectImage = (snapshot: EditorSnapshot) => snapshot.image;

function dialogFocusables(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => element.offsetParent !== null || element === document.activeElement);
}

function guardDialogMousedown(event: MouseEvent): void {
  const tag = (event.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  event.preventDefault();
}

/** Props for `DocxEditor.ImagePropertiesDialog`. @public */
export interface DocxEditorImagePropertiesDialogProps {
  open: boolean;
  onClose: () => void;
  className?: string;
  triggerRef?: RefObject<HTMLElement | null>;
}

interface DraftState {
  widthPoints: string;
  heightPoints: string;
  cropLeft: string;
  cropTop: string;
  cropRight: string;
  cropBottom: string;
  title: string;
  description: string;
  hyperlink: string;
  wrap: ImageWrapTarget;
  lockAspect: boolean;
  positionMode: 'frame' | 'simple';
  horizontalPoints: string;
  verticalPoints: string;
  relativeToH: DrawingPositionInput['relativeToH'];
  relativeToV: DrawingPositionInput['relativeToV'];
}

function positionDraftFrom(
  image: SelectedImageState
): Pick<
  DraftState,
  'positionMode' | 'horizontalPoints' | 'verticalPoints' | 'relativeToH' | 'relativeToV'
> {
  const position = image.position;
  if (!position || image.kind !== 'anchored') {
    return {
      positionMode: 'frame',
      horizontalPoints: '',
      verticalPoints: '',
      relativeToH: 'page',
      relativeToV: 'line',
    };
  }
  if (position.mode === 'simple') {
    return {
      positionMode: 'simple',
      horizontalPoints:
        position.horizontalEmu !== undefined ? String(emuToPoints(position.horizontalEmu)) : '',
      verticalPoints:
        position.verticalEmu !== undefined ? String(emuToPoints(position.verticalEmu)) : '',
      relativeToH: 'page',
      relativeToV: 'line',
    };
  }
  return {
    positionMode: 'frame',
    horizontalPoints:
      position.horizontalEmu !== undefined ? String(emuToPoints(position.horizontalEmu)) : '',
    verticalPoints:
      position.verticalEmu !== undefined ? String(emuToPoints(position.verticalEmu)) : '',
    relativeToH: position.relativeToH ?? 'page',
    relativeToV: position.relativeToV ?? 'line',
  };
}

function positionDraftChanged(
  draft: Pick<DraftState, 'horizontalPoints' | 'verticalPoints' | 'relativeToH' | 'relativeToV'>,
  basis: SelectedImageState
): boolean {
  const initial = positionDraftFrom(basis);
  return (
    draft.horizontalPoints !== initial.horizontalPoints ||
    draft.verticalPoints !== initial.verticalPoints ||
    draft.relativeToH !== initial.relativeToH ||
    draft.relativeToV !== initial.relativeToV
  );
}

function parseSignedOffsetPoints(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const emu = pointsToEmu(parsed);
  if (!Number.isInteger(emu)) return null;
  return emu;
}

function parsePositionCommandPayload(
  draft: DraftState,
  basis: SelectedImageState
):
  | { ok: true; value: Pick<EditorCommandPositionPayload, keyof EditorCommandPositionPayload> }
  | { ok: false } {
  const initial = positionDraftFrom(basis);
  if (draft.positionMode === 'simple' || basis.position?.mode === 'simple') {
    const horizontalChanged = draft.horizontalPoints !== initial.horizontalPoints;
    const verticalChanged = draft.verticalPoints !== initial.verticalPoints;
    const horizontalEmu = horizontalChanged
      ? parseSignedOffsetPoints(draft.horizontalPoints)
      : basis.position?.horizontalEmu;
    const verticalEmu = verticalChanged
      ? parseSignedOffsetPoints(draft.verticalPoints)
      : basis.position?.verticalEmu;
    if (horizontalChanged && horizontalEmu === null) return { ok: false };
    if (verticalChanged && verticalEmu === null) return { ok: false };
    if (horizontalEmu === undefined || verticalEmu === undefined) return { ok: false };
    return {
      ok: true,
      value: {
        horizontalEmu: horizontalEmu as number,
        verticalEmu: verticalEmu as number,
      },
    };
  }
  const horizontalChanged = draft.horizontalPoints !== initial.horizontalPoints;
  const verticalChanged = draft.verticalPoints !== initial.verticalPoints;
  const relativeHChanged = draft.relativeToH !== initial.relativeToH;
  const relativeVChanged = draft.relativeToV !== initial.relativeToV;
  const horizontalEmu = horizontalChanged
    ? parseSignedOffsetPoints(draft.horizontalPoints)
    : basis.position?.horizontalEmu;
  const verticalEmu = verticalChanged
    ? parseSignedOffsetPoints(draft.verticalPoints)
    : basis.position?.verticalEmu;
  if (horizontalChanged && horizontalEmu === null) return { ok: false };
  if (verticalChanged && verticalEmu === null) return { ok: false };
  return {
    ok: true,
    value: {
      ...(typeof horizontalEmu === 'number' ? { horizontalEmu } : {}),
      ...(typeof verticalEmu === 'number' ? { verticalEmu } : {}),
      ...(relativeHChanged || horizontalChanged || verticalChanged
        ? { relativeToH: draft.relativeToH }
        : {}),
      ...(relativeVChanged || horizontalChanged || verticalChanged
        ? { relativeToV: draft.relativeToV }
        : {}),
    },
  };
}

interface EditorCommandPositionPayload {
  horizontalEmu?: number;
  verticalEmu?: number;
  relativeToH?: string;
  relativeToV?: string;
}

function parsePercent(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null;
  return parsed;
}

function parsePoints(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

/**
 * Properties dialog for the selected picture.
 *
 * @public
 */
export const DocxEditorImagePropertiesDialog = defineComponent({
  name: 'DocxEditorImagePropertiesDialog',
  props: {
    open: { type: Boolean, required: true },
    onClose: { type: Function as PropType<() => void>, required: true },
    className: { type: String, default: undefined },
    triggerRef: { type: Object as PropType<RefObject<HTMLElement | null>>, default: undefined },
  },
  setup(props) {
    const editorRef = useDocxEditor();
    const { t } = useTranslation();
    const image = useEditorState(selectImage);
    const titleId = useStableDocxId('image-prop-title');
    const wrapSelectId = useStableDocxId('image-prop-wrap');
    const hyperlinkInputId = useStableDocxId('image-prop-hyperlink');
    const dialogRef = ref<HTMLDivElement | null>(null);
    const targetRef = ref<SelectedImageState | null>(null);
    const selectionRef = ref<{ paragraphId: string; offset: number } | null>(null);
    const packageRevisionRef = ref<number | null>(null);
    const draft = ref<DraftState | null>(null);
    const errorKey = ref<string | null>(null);

    watch(
      [
        () => props.open,
        () => image.value?.id,
        () => image.value?.widthEmu,
        () => image.value?.heightEmu,
        editorRef,
      ],
      () => {
        if (!props.open) {
          targetRef.value = null;
          selectionRef.value = null;
          packageRevisionRef.value = null;
          return;
        }
        const img = image.value;
        if (!img) return;
        targetRef.value = img;
        if (editorRef.value?.surface) {
          const { anchor } = editorRef.value.surface.state().selection;
          selectionRef.value = { paragraphId: anchor.paragraphId, offset: anchor.offset };
          packageRevisionRef.value = editorRef.value.surface.session.packageRevision();
        }
        errorKey.value = null;
        draft.value = {
          widthPoints: String(emuToPoints(img.widthEmu)),
          heightPoints: String(emuToPoints(img.heightEmu)),
          cropLeft: String(img.crop.left),
          cropTop: String(img.crop.top),
          cropRight: String(img.crop.right),
          cropBottom: String(img.crop.bottom),
          title: img.title,
          description: img.description,
          hyperlink: img.hyperlink ?? '',
          wrap: img.wrap,
          lockAspect: img.locks.changeAspect,
          ...positionDraftFrom(img),
        };
      },
      { flush: 'post' }
    );

    const restoreFocus = () => {
      props.triggerRef?.current?.focus();
      editorRef.value?.focus();
    };

    const dismiss = () => {
      props.onClose();
      restoreFocus();
    };

    watch(
      () => [props.open, dialogRef.value] as const,
      async ([isOpen, dialog], _, onCleanup) => {
        if (!isOpen || !dialog) return;
        let disposed = false;
        let onKeyDown: ((event: KeyboardEvent) => void) | null = null;
        onCleanup(() => {
          disposed = true;
          if (onKeyDown) document.removeEventListener('keydown', onKeyDown);
        });
        await nextTick();
        if (disposed || !props.open || dialogRef.value !== dialog) return;
        const focusables = dialogFocusables(dialog);
        const initial =
          focusables.find(
            (element) => element.id === 'image-prop-width' && !element.hasAttribute('disabled')
          ) ??
          focusables.find((element) => !element.hasAttribute('disabled')) ??
          dialog;
        initial.focus();
        onKeyDown = (event: KeyboardEvent): void => {
          if (event.key === 'Escape') {
            event.preventDefault();
            dismiss();
            return;
          }
          if (event.key !== 'Tab') return;
          const items = dialogFocusables(dialog);
          if (items.length === 0) return;
          const active = document.activeElement;
          const currentIndex = items.findIndex((element) => element === active);
          if (currentIndex === -1) return;
          event.preventDefault();
          const nextIndex = event.shiftKey
            ? (currentIndex - 1 + items.length) % items.length
            : (currentIndex + 1) % items.length;
          items[nextIndex]?.focus();
        };
        document.addEventListener('keydown', onKeyDown);
      },
      { flush: 'post' }
    );

    const aspectRatio = computed(() => {
      const basis = targetRef.value ?? image.value;
      if (!basis || basis.widthEmu <= 0) return 1;
      return basis.widthEmu / basis.heightEmu;
    });

    const setWidth = (next: string) => {
      const current = draft.value;
      if (!current) return;
      if (!current.lockAspect) {
        draft.value = { ...current, widthPoints: next };
        return;
      }
      const width = parsePoints(next);
      if (width === null) {
        draft.value = { ...current, widthPoints: next };
        return;
      }
      const height = Math.round((width / aspectRatio.value) * 100) / 100;
      draft.value = { ...current, widthPoints: next, heightPoints: String(height) };
    };

    const setHeight = (next: string) => {
      const current = draft.value;
      if (!current) return;
      if (!current.lockAspect) {
        draft.value = { ...current, heightPoints: next };
        return;
      }
      const height = parsePoints(next);
      if (height === null) {
        draft.value = { ...current, heightPoints: next };
        return;
      }
      const width = Math.round(height * aspectRatio.value * 100) / 100;
      draft.value = { ...current, widthPoints: String(width), heightPoints: next };
    };

    const resetNatural = () => {
      const basis = targetRef.value;
      if (!basis?.intrinsic) return;
      const width = (basis.intrinsic.pixelWidth * 72) / basis.intrinsic.dpiX;
      const height = (basis.intrinsic.pixelHeight * 72) / basis.intrinsic.dpiY;
      const current = draft.value;
      if (!current) return;
      draft.value = {
        ...current,
        widthPoints: String(Math.round(width * 100) / 100),
        heightPoints: String(Math.round(height * 100) / 100),
      };
    };

    const updateDraft = (patch: Partial<DraftState>) => {
      if (draft.value) draft.value = { ...draft.value, ...patch };
    };

    const apply = () => {
      const basis = targetRef.value;
      const capturedSelection = selectionRef.value;
      const capturedRevision = packageRevisionRef.value;
      const currentDraft = draft.value;
      if (
        !editorRef.value ||
        !basis ||
        !currentDraft ||
        !capturedSelection ||
        capturedRevision === null
      ) {
        return;
      }
      const resizeDisabledLocal = basis.canResize === false;
      const pictureOnlyDisabledLocal = basis.canCrop === false;
      const command: {
        type: 'setImageProperties';
        drawingNodeId: string;
        expectedPackageRevision: number;
        selectionParagraphId: string;
        selectionOffset: number;
        widthEmu?: number;
        heightEmu?: number;
        title?: string;
        description?: string;
        hyperlink?: string | null;
        crop?: { left: number; top: number; right: number; bottom: number };
        wrap?: ImageWrapTarget;
        horizontalEmu?: number;
        verticalEmu?: number;
        relativeToH?: string;
        relativeToV?: string;
      } = {
        type: 'setImageProperties',
        drawingNodeId: basis.id,
        expectedPackageRevision: capturedRevision,
        selectionParagraphId: capturedSelection.paragraphId,
        selectionOffset: capturedSelection.offset,
      };

      if (!resizeDisabledLocal) {
        const width = parsePoints(currentDraft.widthPoints);
        const height = parsePoints(currentDraft.heightPoints);
        if (width === null || height === null) {
          errorKey.value = 'imageProperties.errors.invalidDimensions';
          return;
        }
        const widthEmu = pointsToEmu(width);
        const heightEmu = pointsToEmu(height);
        if (widthEmu !== basis.widthEmu) command.widthEmu = widthEmu;
        if (heightEmu !== basis.heightEmu) command.heightEmu = heightEmu;
      }

      if (basis.canCrop && !pictureOnlyDisabledLocal) {
        const left = parsePercent(currentDraft.cropLeft);
        const top = parsePercent(currentDraft.cropTop);
        const right = parsePercent(currentDraft.cropRight);
        const bottom = parsePercent(currentDraft.cropBottom);
        if (left === null || top === null || right === null || bottom === null) {
          errorKey.value = 'imageProperties.errors.invalidCrop';
          return;
        }
        const basisCrop = basis.crop;
        if (
          left !== basisCrop.left ||
          top !== basisCrop.top ||
          right !== basisCrop.right ||
          bottom !== basisCrop.bottom
        ) {
          command.crop = { left, top, right, bottom };
        }
      }

      if (currentDraft.title !== basis.title) command.title = currentDraft.title;
      if (currentDraft.description !== basis.description)
        command.description = currentDraft.description;
      const trimmedHyperlink = currentDraft.hyperlink.trim();
      if (trimmedHyperlink !== (basis.hyperlink ?? '')) {
        command.hyperlink = trimmedHyperlink === '' ? null : trimmedHyperlink;
      }
      if (basis.canChangeWrap && currentDraft.wrap !== basis.wrap) command.wrap = currentDraft.wrap;

      const canEditPosition = basis.kind === 'anchored' && basis.canMove;
      if (canEditPosition && positionDraftChanged(currentDraft, basis)) {
        const parsed = parsePositionCommandPayload(currentDraft, basis);
        if (!parsed.ok) {
          errorKey.value = 'imageProperties.errors.invalidPosition';
          return;
        }
        if (
          !validateDrawingPositionInput(positionInputFromPropertiesCommand(parsed.value, basis))
        ) {
          errorKey.value = 'imageProperties.errors.invalidPosition';
          return;
        }
        Object.assign(command, parsed.value);
      }

      const hasMutation =
        command.widthEmu !== undefined ||
        command.heightEmu !== undefined ||
        command.title !== undefined ||
        command.description !== undefined ||
        command.hyperlink !== undefined ||
        command.crop !== undefined ||
        command.wrap !== undefined ||
        command.horizontalEmu !== undefined ||
        command.verticalEmu !== undefined ||
        command.relativeToH !== undefined ||
        command.relativeToV !== undefined;
      if (!hasMutation) {
        dismiss();
        return;
      }
      const allowed = editorRef.value!.can(command);
      if (!allowed.ok) {
        errorKey.value = 'imageProperties.errors.refused';
        return;
      }
      const result = editorRef.value!.exec(command);
      if (!result.ok) {
        errorKey.value = 'imageProperties.errors.refused';
        return;
      }
      dismiss();
    };

    return () => {
      if (!props.open || !draft.value) return null;
      const d = draft.value;
      const target = targetRef.value;
      const pictureOnlyDisabled = target?.canCrop === false;
      const resizeDisabled = target?.canResize === false;
      const aspectLockDisabled = target?.locks.changeAspect === true;
      const positionEditable = target?.kind === 'anchored' && target.canMove === true;
      const positionUnavailable = target?.kind === 'inline';
      const positionLocked = target?.kind === 'anchored' && target.canMove === false;
      return (
        <div
          class={`docx-dialog-overlay${props.className ? ` ${props.className}` : ''}`}
          onClick={dismiss}
          onMousedown={(event) => {
            event.stopPropagation();
            guardDialogMousedown(event);
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            class="docx-dialog docx-image-properties-dialog"
            onClick={(event) => event.stopPropagation()}
            onMousedown={(event) => event.stopPropagation()}
          >
            <div id={titleId} class="docx-dialog__header">
              {t('dialogs.imageProperties.title')}
            </div>
            <div class="docx-dialog__body">
              {errorKey.value ? (
                <p class="docx-dialog__error">
                  {t(errorKey.value as 'imageProperties.errors.invalidDimensions')}
                </p>
              ) : null}
              <section class="docx-dialog__section">
                <div class="docx-dialog__section-label">
                  {t('dialogs.imageProperties.dimensions')}
                </div>
                <div class="docx-dialog__row">
                  <label class="docx-dialog__field-label" for="image-prop-width">
                    {t('dialogs.imageProperties.widthLabel')}
                  </label>
                  <input
                    id="image-prop-width"
                    class="docx-dialog__input"
                    value={d.widthPoints}
                    disabled={resizeDisabled}
                    onChange={(event) => setWidth((event.target as HTMLInputElement).value)}
                  />
                  <span class="docx-dialog__unit">{t('imageProperties.units.points')}</span>
                </div>
                <div class="docx-dialog__row">
                  <label class="docx-dialog__field-label" for="image-prop-height">
                    {t('dialogs.imageProperties.heightLabel')}
                  </label>
                  <input
                    id="image-prop-height"
                    class="docx-dialog__input"
                    value={d.heightPoints}
                    disabled={resizeDisabled}
                    onChange={(event) => setHeight((event.target as HTMLInputElement).value)}
                  />
                  <span class="docx-dialog__unit">{t('imageProperties.units.points')}</span>
                </div>
                <label class="docx-dialog__checkbox-row">
                  <input
                    type="checkbox"
                    checked={d.lockAspect}
                    disabled={aspectLockDisabled}
                    onChange={(event) =>
                      (draft.value = draft.value
                        ? { ...draft.value, lockAspect: (event.target as HTMLInputElement).checked }
                        : draft.value)
                    }
                  />
                  {t('dialogs.imageProperties.lockAspectRatio')}
                </label>
                <button
                  type="button"
                  class="docx-dialog__link-button"
                  disabled={pictureOnlyDisabled || !target?.intrinsic}
                  onClick={resetNatural}
                >
                  {t('imageProperties.resetNaturalSize')}
                </button>
              </section>
              <section class="docx-dialog__section">
                <div class="docx-dialog__section-label">{t('imageProperties.position')}</div>
                {positionUnavailable ? (
                  <p class="docx-dialog__hint">{t('imageProperties.positionUnavailable')}</p>
                ) : null}
                {positionLocked ? (
                  <p class="docx-dialog__hint">{t('imageProperties.positionLocked')}</p>
                ) : null}
                {positionEditable ? (
                  <>
                    {d.positionMode === 'frame' ? (
                      <>
                        <div class="docx-dialog__row">
                          <label class="docx-dialog__field-label" for="image-pos-rel-h">
                            {t('imageProperties.relativeToHorizontal')}
                          </label>
                          <select
                            id="image-pos-rel-h"
                            class="docx-dialog__select"
                            value={d.relativeToH ?? 'page'}
                            onChange={(event) =>
                              (draft.value = draft.value
                                ? {
                                    ...draft.value,
                                    relativeToH: (event.target as HTMLInputElement)
                                      .value as DrawingPositionInput['relativeToH'],
                                  }
                                : draft.value)
                            }
                          >
                            {DRAWING_REL_FROM_H.map((frame) => (
                              <option key={frame} value={frame}>
                                {t(
                                  `dialogs.imagePosition.relativeOptions.${frame}` as 'dialogs.imagePosition.relativeOptions.page'
                                )}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div class="docx-dialog__row">
                          <label class="docx-dialog__field-label" for="image-pos-rel-v">
                            {t('imageProperties.relativeToVertical')}
                          </label>
                          <select
                            id="image-pos-rel-v"
                            class="docx-dialog__select"
                            value={d.relativeToV ?? 'line'}
                            onChange={(event) =>
                              (draft.value = draft.value
                                ? {
                                    ...draft.value,
                                    relativeToV: (event.target as HTMLInputElement)
                                      .value as DrawingPositionInput['relativeToV'],
                                  }
                                : draft.value)
                            }
                          >
                            {DRAWING_REL_FROM_V.map((frame) => (
                              <option key={frame} value={frame}>
                                {t(
                                  `dialogs.imagePosition.relativeOptions.${frame}` as 'dialogs.imagePosition.relativeOptions.page'
                                )}
                              </option>
                            ))}
                          </select>
                        </div>
                      </>
                    ) : null}
                    <div class="docx-dialog__row">
                      <label class="docx-dialog__field-label" for="image-pos-h">
                        {t('imageProperties.horizontalOffset')}
                      </label>
                      <input
                        id="image-pos-h"
                        class="docx-dialog__input"
                        value={d.horizontalPoints}
                        onChange={(event) =>
                          updateDraft({
                            horizontalPoints: (event.target as HTMLInputElement).value,
                          })
                        }
                      />
                      <span class="docx-dialog__unit">{t('imageProperties.units.points')}</span>
                    </div>
                    <div class="docx-dialog__row">
                      <label class="docx-dialog__field-label" for="image-pos-v">
                        {t('imageProperties.verticalOffset')}
                      </label>
                      <input
                        id="image-pos-v"
                        class="docx-dialog__input"
                        value={d.verticalPoints}
                        onChange={(event) =>
                          updateDraft({ verticalPoints: (event.target as HTMLInputElement).value })
                        }
                      />
                      <span class="docx-dialog__unit">{t('imageProperties.units.points')}</span>
                    </div>
                  </>
                ) : null}
              </section>
              <section class="docx-dialog__section">
                <div class="docx-dialog__section-label">{t('dialogs.imageProperties.altText')}</div>
                <div class="docx-dialog__row">
                  <label class="docx-dialog__field-label" for="image-prop-title">
                    {t('imageAltText.title')}
                  </label>
                  <input
                    id="image-prop-title"
                    class="docx-dialog__input"
                    value={d.title}
                    onChange={(event) =>
                      updateDraft({ title: (event.target as HTMLInputElement).value })
                    }
                  />
                </div>
                <div class="docx-dialog__row">
                  <label class="docx-dialog__field-label" for="image-prop-description">
                    {t('imageAltText.description')}
                  </label>
                  <textarea
                    id="image-prop-description"
                    class="docx-dialog__textarea"
                    value={d.description}
                    onChange={(event) =>
                      updateDraft({ description: (event.target as HTMLInputElement).value })
                    }
                    placeholder={t('dialogs.imageProperties.altTextPlaceholder')}
                  />
                </div>
              </section>
              <section class="docx-dialog__section">
                <div class="docx-dialog__section-label">{t('imageProperties.hyperlink')}</div>
                <label class="docx-dialog__field-label" for={hyperlinkInputId}>
                  {t('hyperlinkPopup.urlLabel')}
                </label>
                <input
                  id={hyperlinkInputId}
                  class="docx-dialog__input docx-dialog__input--full"
                  value={d.hyperlink}
                  onChange={(event) =>
                    updateDraft({ hyperlink: (event.target as HTMLInputElement).value })
                  }
                  placeholder={t('hyperlinkPopup.urlPlaceholder')}
                />
              </section>
              <section class="docx-dialog__section">
                <div class="docx-dialog__section-label">
                  {t('dialogs.imageProperties.textWrapping')}
                </div>
                <label class="docx-dialog__field-label" for={wrapSelectId}>
                  {t('formattingBar.imageWrap')}
                </label>
                <select
                  id={wrapSelectId}
                  class="docx-dialog__select docx-dialog__input--full"
                  value={d.wrap}
                  disabled={target?.canChangeWrap === false}
                  onChange={(event) =>
                    updateDraft({
                      wrap: (event.target as HTMLInputElement).value as ImageWrapTarget,
                    })
                  }
                >
                  {IMAGE_WRAP_TARGETS.map((target) => (
                    <option key={target} value={target}>
                      {t(`imageWrap.targets.${target}` as 'imageWrap.inline')}
                    </option>
                  ))}
                </select>
              </section>
              <section class="docx-dialog__section">
                <div class="docx-dialog__section-label">{t('imageProperties.crop')}</div>
                <div class="docx-dialog__row">
                  <label class="docx-dialog__field-label" for="image-crop-left">
                    {t('imageProperties.cropLeft')}
                  </label>
                  <input
                    id="image-crop-left"
                    class="docx-dialog__input"
                    disabled={pictureOnlyDisabled}
                    value={d.cropLeft}
                    onChange={(event) =>
                      updateDraft({ cropLeft: (event.target as HTMLInputElement).value })
                    }
                  />
                </div>
                <div class="docx-dialog__row">
                  <label class="docx-dialog__field-label" for="image-crop-top">
                    {t('imageProperties.cropTop')}
                  </label>
                  <input
                    id="image-crop-top"
                    class="docx-dialog__input"
                    disabled={pictureOnlyDisabled}
                    value={d.cropTop}
                    onChange={(event) =>
                      updateDraft({ cropTop: (event.target as HTMLInputElement).value })
                    }
                  />
                </div>
                <div class="docx-dialog__row">
                  <label class="docx-dialog__field-label" for="image-crop-right">
                    {t('imageProperties.cropRight')}
                  </label>
                  <input
                    id="image-crop-right"
                    class="docx-dialog__input"
                    disabled={pictureOnlyDisabled}
                    value={d.cropRight}
                    onChange={(event) =>
                      updateDraft({ cropRight: (event.target as HTMLInputElement).value })
                    }
                  />
                </div>
                <div class="docx-dialog__row">
                  <label class="docx-dialog__field-label" for="image-crop-bottom">
                    {t('imageProperties.cropBottom')}
                  </label>
                  <input
                    id="image-crop-bottom"
                    class="docx-dialog__input"
                    disabled={pictureOnlyDisabled}
                    value={d.cropBottom}
                    onChange={(event) =>
                      updateDraft({ cropBottom: (event.target as HTMLInputElement).value })
                    }
                  />
                </div>
                {pictureOnlyDisabled ? (
                  <p class="docx-dialog__hint">{t('imageProperties.nonPictureHint')}</p>
                ) : null}
              </section>
            </div>
            <div class="docx-dialog__footer">
              <button type="button" class="docx-dialog__button" onClick={dismiss}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                class="docx-dialog__button docx-dialog__button--primary"
                onClick={apply}
              >
                {t('common.apply')}
              </button>
            </div>
          </div>
        </div>
      );
    };
  },
});

/** Props for the toolbar properties trigger. @public */
export interface ImagePropertiesTriggerProps {
  className?: string;
  hidden?: boolean;
  asChild?: boolean;
  children?: DocxEditorChildren;
}

/**
 * Opens the image properties dialog for the selected drawing.
 *
 * @public
 */
export const ImagePropertiesTrigger = defineComponent({
  name: 'ImagePropertiesTrigger',
  props: {
    className: { type: String, default: undefined },
    hidden: { type: Boolean, default: undefined },
    asChild: { type: Boolean, default: undefined },
  },
  setup(props, { slots }) {
    const editorRef = useDocxEditor();
    const { t } = useTranslation();
    const image = useEditorState(selectImage);
    const open = ref(false);
    const triggerRef = ref<HTMLButtonElement | null>(null);
    const probe = { type: 'setImageProperties' as const, description: 'probe' };

    return () => {
      if (props.hidden) return null;
      const allowed = editorRef.value && image.value ? editorRef.value.can(probe) : null;
      const isEnabled = allowed?.ok === true;
      const disabledReason = allowed && !allowed.ok ? allowed.reason : null;
      const control = chromeControlForSlot('image.properties');
      const shared = {
        type: 'button' as const,
        ref: triggerRef,
        class: `docx-toolbar__button${props.className ? ` ${props.className}` : ''}`,
        'data-slot': 'image.properties',
        disabled: !isEnabled,
        ...(!isEnabled ? { 'data-disabled': '' } : {}),
        'aria-label': t('formattingBar.imagePropertiesShortcut'),
        title: disabledReason ?? t('formattingBar.imagePropertiesShortcut'),
        onMousedown: guardToolbarMousedown,
        onClick: () => {
          open.value = true;
        },
      };

      return (
        <>
          {props.asChild ? (
            <Slot {...shared}>{slots.default?.()}</Slot>
          ) : (
            <button {...shared}>{slots.default?.() ?? chromeIcon(control?.paths)}</button>
          )}
          <DocxEditorImagePropertiesDialog
            open={open.value}
            onClose={() => {
              open.value = false;
            }}
            triggerRef={refAsRefObject(triggerRef)}
          />
        </>
      );
    };
  },
});

ImagePropertiesTrigger.docxSlot = 'image.properties' as const;

export const ToolbarImageProperties = Object.assign(ImagePropertiesTrigger, {
  docxSlot: 'image.properties' as const,
});
