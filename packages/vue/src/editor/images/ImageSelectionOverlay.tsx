// Selection ring and eight resize handles for the selected drawing — geometry from layout records.

import {
  computed,
  defineComponent,
  ref,
  shallowRef,
  Teleport,
  watch,
  type PropType,
  type Ref,
} from 'vue';
import {
  captureImageMutationPreconditions,
  computeMovedImagePosition,
  IMAGE_OVERLAY_NUDGE_PT,
  IMAGE_OVERLAY_NUDGE_SHIFT_PT,
  isStaleImageInteractionCommit,
  selectedDrawingOverlayTargetOf,
  type ImageInteractionSession,
  type ImageOverlayScrollPort,
  type ImageResizeHandle,
  type SelectedDrawingOverlayTarget,
} from '@docx-editor.dev/core/editor';
import {
  computeImageResizeResult,
  createImageOverlayScrollPort,
  cssPixelsToLayoutPoints,
  finalizeImageOverlayInteraction,
  overlayFrameToSheetCssPixels,
  resizePreservesAspect,
} from '@docx-editor.dev/core/editor';
import type { DrawingPositionInput } from '@docx-editor.dev/core/editor';
import { useTranslation } from '../../i18n';
import { useDocxEditor } from '../context';
import { guardToolbarMousedown } from '../toolbar/ToolbarButton';

const HANDLES: readonly ImageResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const AUTO_SCROLL_EDGE_PX = 40;
const AUTO_SCROLL_MAX_PT = 12;

interface PreviewState {
  readonly session: ImageInteractionSession;
  readonly bounds: SelectedDrawingOverlayTarget;
  readonly accumulatedScrollPt: number;
}

/** @public */
export interface ImageSelectionOverlayProps {
  containerRef: Ref<HTMLElement | null>;
  portalRef: Ref<HTMLElement | null>;
  scrollPort?: ImageOverlayScrollPort;
}

function handleLabelKey(handle: ImageResizeHandle): `imageOverlay.handle.${ImageResizeHandle}` {
  return `imageOverlay.handle.${handle}`;
}

function cursorForHandle(handle: ImageResizeHandle): string {
  switch (handle) {
    case 'nw':
    case 'se':
      return 'nwse-resize';
    case 'ne':
    case 'sw':
      return 'nesw-resize';
    case 'n':
    case 's':
      return 'ns-resize';
    default:
      return 'ew-resize';
  }
}

function handlePosition(handle: ImageResizeHandle): { readonly x: string; readonly y: string } {
  const map: Record<ImageResizeHandle, { x: string; y: string }> = {
    nw: { x: '0%', y: '0%' },
    n: { x: '50%', y: '0%' },
    ne: { x: '100%', y: '0%' },
    e: { x: '100%', y: '50%' },
    se: { x: '100%', y: '100%' },
    s: { x: '50%', y: '100%' },
    sw: { x: '0%', y: '100%' },
    w: { x: '0%', y: '50%' },
  };
  return map[handle];
}

function handleFromDelta(dx: number, dy: number): ImageResizeHandle {
  if (dx > 0 && dy > 0) return 'se';
  if (dx > 0 && dy < 0) return 'ne';
  if (dx < 0 && dy > 0) return 'sw';
  if (dx < 0 && dy < 0) return 'nw';
  if (dx > 0) return 'e';
  if (dx < 0) return 'w';
  if (dy > 0) return 's';
  return 'n';
}

/** @public */
export const ImageSelectionOverlay = defineComponent({
  name: 'ImageSelectionOverlay',
  props: {
    containerRef: { type: Object as PropType<Ref<HTMLElement | null>>, required: true },
    portalRef: { type: Object as PropType<Ref<HTMLElement | null>>, required: true },
    scrollPort: { type: Object as PropType<ImageOverlayScrollPort>, default: undefined },
  },
  setup(props) {
    const editorRef = useDocxEditor();
    const { t } = useTranslation();
    const target = ref<SelectedDrawingOverlayTarget | null>(null);
    const preview = ref<PreviewState | null>(null);
    const previewRef = shallowRef<PreviewState | null>(null);
    watch(preview, (next) => {
      previewRef.value = next;
    });
    const pointerStartRef = shallowRef<{ readonly x: number; readonly y: number } | null>(null);
    const captureTargetRef = shallowRef<HTMLElement | null>(null);
    const overlayRef = shallowRef<HTMLDivElement | null>(null);
    const focusRequestedForDrawingRef = shallowRef<string | null>(null);
    const scrollPortRef = shallowRef<ImageOverlayScrollPort | null>(null);

    watch(
      [() => props.containerRef.value, () => target.value?.id],
      ([container], _, onCleanup) => {
        if (!container) return;
        const onPointerDown = (event: PointerEvent): void => {
          const element = event.target instanceof Element ? event.target : null;
          const drawingId = element
            ?.closest<HTMLElement>('[data-drawing-node-id]')
            ?.getAttribute('data-drawing-node-id');
          focusRequestedForDrawingRef.value = drawingId ?? null;
          if (drawingId && drawingId === target.value?.id) {
            queueMicrotask(() => overlayRef.value?.focus({ preventScroll: true }));
          }
        };
        container.addEventListener('pointerdown', onPointerDown, { capture: true });
        onCleanup(() =>
          container.removeEventListener('pointerdown', onPointerDown, { capture: true })
        );
      },
      { flush: 'post' }
    );

    watch(
      editorRef,
      (editor, _, onCleanup) => {
        if (!editor) {
          target.value = null;
          return;
        }
        const sync = (): void => {
          target.value = selectedDrawingOverlayTargetOf(editor.surface);
        };
        const syncAfterCommit = (): void => {
          queueMicrotask(sync);
        };
        sync();
        const off = [editor.on('change', syncAfterCommit), editor.on('selectionChange', sync)];
        onCleanup(() => {
          for (const unsubscribe of off) unsubscribe();
        });
      },
      { immediate: true, flush: 'post' }
    );

    watch(
      [() => props.scrollPort, () => props.containerRef.value, editorRef],
      ([scrollPortOverride, container, editor], _, onCleanup) => {
        if (scrollPortOverride) {
          scrollPortRef.value = scrollPortOverride;
          return;
        }
        if (!container || !editor?.surface) return;
        const scroller = container.closest('.docx-editor__scroll-container') as HTMLElement | null;
        if (!scroller) return;
        const coordinates = editor.surface.overlayCoordinates();
        scrollPortRef.value = createImageOverlayScrollPort(scroller, coordinates.paintScale);
        onCleanup(() => {
          scrollPortRef.value = null;
        });
      },
      { flush: 'post' }
    );

    const clearPreview = (): void => {
      preview.value = null;
      pointerStartRef.value = null;
      const captured = captureTargetRef.value;
      captureTargetRef.value = null;
      if (captured) {
        try {
          captured.releasePointerCapture(
            (captured as HTMLElement & { _lastPointerId?: number })._lastPointerId ?? 0
          );
        } catch {
          // Already released.
        }
      }
    };

    const beginSession = (
      mode: 'move' | 'resize',
      handle: ImageResizeHandle | null,
      active: SelectedDrawingOverlayTarget,
      clientX: number,
      clientY: number,
      captureTarget: HTMLElement,
      pointerId: number
    ): void => {
      const editor = editorRef.value;
      if (!editor?.surface) return;
      const pre = captureImageMutationPreconditions(editor);
      if (!pre) return;
      const layout = editor.surface.publishedLayout();
      pointerStartRef.value = Object.freeze({ x: clientX, y: clientY });
      captureTargetRef.value = captureTarget;
      (captureTarget as HTMLElement & { _lastPointerId?: number })._lastPointerId = pointerId;
      try {
        captureTarget.setPointerCapture(pointerId);
      } catch {
        // Capture is best-effort.
      }
      preview.value = {
        session: Object.freeze({
          drawingNodeId: active.id,
          startBounds: Object.freeze({
            x: active.x,
            y: active.y,
            width: active.width,
            height: active.height,
          }),
          startWidthEmu: active.widthEmu,
          startHeightEmu: active.heightEmu,
          startPosition: active.position,
          anchorFrameOrigin: active.anchorFrameOrigin,
          transform: active.transform,
          mode,
          handle,
          preconditions: pre,
          layoutRevision: layout.revision,
          packageRevision: editor.surface.session.packageRevision(),
          kind: active.kind,
        }),
        bounds: active,
        accumulatedScrollPt: 0,
      };
      overlayRef.value?.focus({ preventScroll: true });
    };

    const commitSession = (
      session: ImageInteractionSession,
      widthEmu: number,
      heightEmu: number,
      _bounds: {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
      },
      position: DrawingPositionInput | null
    ): void => {
      const editor = editorRef.value;
      if (!editor) return;
      if (isStaleImageInteractionCommit(editor, session)) {
        clearPreview();
        return;
      }
      if (session.mode === 'resize') {
        editor.exec({
          type: 'setImageProperties',
          widthEmu,
          heightEmu,
          ...(position?.mode === 'simple'
            ? {
                horizontalEmu: position.horizontalEmu,
                verticalEmu: position.verticalEmu,
              }
            : {}),
          ...(position?.mode === 'frame'
            ? {
                ...(position.horizontalEmu !== undefined
                  ? { horizontalEmu: position.horizontalEmu }
                  : {}),
                ...(position.verticalEmu !== undefined
                  ? { verticalEmu: position.verticalEmu }
                  : {}),
              }
            : {}),
        });
      } else if (session.mode === 'move' && position) {
        editor.exec({ type: 'setImagePosition', ...position });
      }
      clearPreview();
    };

    const onOverlayKeyDown = (event: KeyboardEvent): void => {
      const editor = editorRef.value;
      if (!editor) return;
      const active = previewRef.value?.bounds ?? selectedDrawingOverlayTargetOf(editor.surface);
      if (!active) return;
      if (previewRef.value && event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        clearPreview();
        return;
      }
      if (previewRef.value) return;
      const step = event.shiftKey ? IMAGE_OVERLAY_NUDGE_SHIFT_PT : IMAGE_OVERLAY_NUDGE_PT;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        event.stopPropagation();
        editor.exec({ type: 'deleteImage' });
        return;
      }
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      if (event.altKey) {
        if (!active.canResize) return;
        const handle = handleFromDelta(dx, dy);
        const resized = computeImageResizeResult({
          handle,
          startWidthEmu: active.widthEmu,
          startHeightEmu: active.heightEmu,
          startBounds: { x: active.x, y: active.y, width: active.width, height: active.height },
          startPosition: active.position,
          anchorFrameOrigin: active.anchorFrameOrigin,
          deltaXPt: dx,
          deltaYPt: dy,
          transform: active.transform,
          preserveAspect: resizePreservesAspect(handle, active.aspectLocked, event.shiftKey),
          kind: active.kind,
        });
        editor.exec({
          type: 'setImageProperties',
          widthEmu: resized.widthEmu,
          heightEmu: resized.heightEmu,
          ...(resized.position?.mode === 'simple'
            ? {
                horizontalEmu: resized.position.horizontalEmu,
                verticalEmu: resized.position.verticalEmu,
              }
            : {}),
          ...(resized.position?.mode === 'frame'
            ? {
                ...(resized.position.horizontalEmu !== undefined
                  ? { horizontalEmu: resized.position.horizontalEmu }
                  : {}),
                ...(resized.position.verticalEmu !== undefined
                  ? { verticalEmu: resized.position.verticalEmu }
                  : {}),
              }
            : {}),
        });
        return;
      }
      if (active.kind !== 'anchored' || !active.canMove || !active.position) return;
      const moved = computeMovedImagePosition(active.position, dx, dy);
      editor.exec({ type: 'setImagePosition', ...moved });
    };

    watch(
      [preview, editorRef, () => props.containerRef.value],
      ([currentPreview, editor, container], _, onCleanup) => {
        if (!currentPreview || !editor?.surface) return;
        const coordinates = editor.surface.overlayCoordinates();
        const onPointerMove = (event: PointerEvent) => {
          const current = previewRef.value;
          const startPointer = pointerStartRef.value;
          if (!current || !startPointer) return;
          const deltaX = cssPixelsToLayoutPoints(
            event.clientX - startPointer.x,
            coordinates.paintScale
          );
          const deltaY = cssPixelsToLayoutPoints(
            event.clientY - startPointer.y,
            coordinates.paintScale
          );
          if (current.session.mode === 'move') {
            let scrollDelta = 0;
            const scrollPort = scrollPortRef.value;
            const scroller = container?.closest(
              '.docx-editor__scroll-container'
            ) as HTMLElement | null;
            if (scrollPort && scroller) {
              const scrollerRect = scroller.getBoundingClientRect();
              if (event.clientY > scrollerRect.bottom - AUTO_SCROLL_EDGE_PX)
                scrollDelta = AUTO_SCROLL_MAX_PT;
              else if (event.clientY < scrollerRect.top + AUTO_SCROLL_EDGE_PX)
                scrollDelta = -AUTO_SCROLL_MAX_PT;
              if (scrollDelta !== 0) scrollDelta = scrollPort.scrollBy(scrollDelta);
            }
            const accumulatedScrollPt = current.accumulatedScrollPt + scrollDelta;
            preview.value = {
              ...current,
              accumulatedScrollPt,
              bounds: Object.freeze({
                ...current.bounds,
                x: current.session.startBounds.x + deltaX,
                y: current.session.startBounds.y + deltaY + accumulatedScrollPt,
              }),
            };
            return;
          }
          if (!current.session.handle) return;
          const resized = computeImageResizeResult({
            handle: current.session.handle,
            startWidthEmu: current.session.startWidthEmu,
            startHeightEmu: current.session.startHeightEmu,
            startBounds: current.session.startBounds,
            startPosition: current.session.startPosition,
            anchorFrameOrigin: current.session.anchorFrameOrigin,
            deltaXPt: deltaX,
            deltaYPt: deltaY,
            transform: current.session.transform,
            preserveAspect: resizePreservesAspect(
              current.session.handle,
              current.bounds.aspectLocked,
              event.shiftKey
            ),
            kind: current.session.kind,
          });
          preview.value = {
            ...current,
            bounds: Object.freeze({
              ...current.bounds,
              x: resized.previewBounds.x,
              y: resized.previewBounds.y,
              width: resized.previewBounds.width,
              height: resized.previewBounds.height,
              widthEmu: resized.widthEmu,
              heightEmu: resized.heightEmu,
            }),
          };
        };
        const finish = (event: PointerEvent) => {
          const current = previewRef.value;
          if (!current) return;
          if (event.type === 'pointerup') {
            const deltaX = cssPixelsToLayoutPoints(
              event.clientX - (pointerStartRef.value?.x ?? event.clientX),
              coordinates.paintScale
            );
            const deltaY = cssPixelsToLayoutPoints(
              event.clientY - (pointerStartRef.value?.y ?? event.clientY),
              coordinates.paintScale
            );
            const finalized = finalizeImageOverlayInteraction({
              session: current.session,
              deltaXPt: deltaX,
              deltaYPt: deltaY,
              accumulatedScrollPt: current.accumulatedScrollPt,
              aspectLocked: current.bounds.aspectLocked,
              shiftKey: event.shiftKey,
              anchorFrameOrigin: current.session.anchorFrameOrigin,
            });
            commitSession(
              current.session,
              finalized.widthEmu,
              finalized.heightEmu,
              finalized.previewBounds,
              finalized.position
            );
          } else clearPreview();
        };
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', finish);
        window.addEventListener('pointercancel', finish);
        onCleanup(() => {
          window.removeEventListener('pointermove', onPointerMove);
          window.removeEventListener('pointerup', finish);
          window.removeEventListener('pointercancel', finish);
        });
      },
      { flush: 'post' }
    );

    watch(
      target,
      (nextTarget) => {
        if (!nextTarget || focusRequestedForDrawingRef.value !== nextTarget.id) return;
        focusRequestedForDrawingRef.value = null;
        overlayRef.value?.focus({ preventScroll: true });
      },
      { flush: 'post' }
    );

    const active = computed(() => preview.value?.bounds ?? target.value);

    return () => {
      const editor = editorRef.value;
      const current = active.value;
      const portal = props.portalRef.value;
      if (!editor?.surface || !current || !portal) return null;
      const layout = editor.surface.publishedLayout();
      const coordinates = editor.surface.overlayCoordinates();
      const rect = overlayFrameToSheetCssPixels(
        layout,
        {
          pageIndex: current.pageIndex,
          x: current.x,
          y: current.y,
          width: current.width,
          height: current.height,
        },
        coordinates
      );
      const showHandles = current.canResize;
      const showMove = current.kind === 'anchored' && current.canMove;
      return (
        <Teleport to={portal}>
          <div
            ref={(el: unknown) => {
              overlayRef.value = el instanceof HTMLDivElement ? el : null;
            }}
            class="docx-image-selection-overlay docx-editor-one-surface__overlay-control"
            data-drawing-node-id={current.id}
            tabindex={0}
            onKeydown={onOverlayKeyDown}
          >
            <div
              class="docx-image-selection-overlay__frame"
              role="group"
              aria-label={t('imageOverlay.selection')}
              style={{
                left: `${rect.left}px`,
                top: `${rect.top}px`,
                width: `${rect.width}px`,
                height: `${rect.height}px`,
                cursor: showMove ? 'move' : 'default',
              }}
              onPointerdown={(event: PointerEvent) => {
                guardToolbarMousedown(event as unknown as MouseEvent);
                if (!showMove || !current.position) return;
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                beginSession(
                  'move',
                  null,
                  current,
                  event.clientX,
                  event.clientY,
                  event.currentTarget as HTMLElement,
                  event.pointerId
                );
              }}
            />
            {showHandles
              ? HANDLES.map((handle) => {
                  const pos = handlePosition(handle);
                  return (
                    <button
                      key={handle}
                      type="button"
                      class="docx-image-selection-overlay__handle"
                      aria-label={t(handleLabelKey(handle))}
                      tabindex={0}
                      style={{
                        left: `calc(${rect.left}px + ${rect.width}px * ${parseFloat(pos.x) / 100} - 5px)`,
                        top: `calc(${rect.top}px + ${rect.height}px * ${parseFloat(pos.y) / 100} - 5px)`,
                        cursor: cursorForHandle(handle),
                      }}
                      onPointerdown={(event: PointerEvent) => {
                        guardToolbarMousedown(event as unknown as MouseEvent);
                        if (event.button !== 0) return;
                        event.preventDefault();
                        event.stopPropagation();
                        beginSession(
                          'resize',
                          handle,
                          current,
                          event.clientX,
                          event.clientY,
                          event.currentTarget as HTMLElement,
                          event.pointerId
                        );
                      }}
                    />
                  );
                })
              : null}
          </div>
        </Teleport>
      );
    };
  },
});
