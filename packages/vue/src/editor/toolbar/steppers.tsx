import { defineComponent, ref, watch } from 'vue';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import {
  AUTO_ZOOM_MODE,
  FIT_WIDTH_ZOOM_MODE,
  commandForSlotValue,
  sameZoomMode,
} from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { editorScopeFor } from '../editor-scope';
import { useEditorState } from '../useEditorState';
import { useEditorCommand } from '../useEditorCommand';
import { useToolbarLabel } from './toolbar-context';
import { guardToolbarMousedown } from './ToolbarButton';
import type { ToolbarSlotPartComponent } from './parts';
import { useZoom } from '../useZoom';

const MIN_HALF_POINTS = 2;
const MAX_HALF_POINTS = 3276;
const FONT_SIZE_PRESETS_PT: readonly number[] = [
  8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72,
];

const selectFontSizePt = (snapshot: EditorSnapshot) => snapshot.formatting?.fontSizePt ?? null;

function nextPreset(current: number, presets: readonly number[], max: number): number {
  for (const preset of presets) if (preset > current) return preset;
  return Math.min(current + 1, max);
}

function prevPreset(current: number, presets: readonly number[], min: number): number {
  for (let index = presets.length - 1; index >= 0; index -= 1) {
    if (presets[index]! < current) return presets[index]!;
  }
  return Math.max(current - 1, min);
}

function parseTypedSize(text: string): number | null {
  const trimmed = text.trim().replace(/pt$/i, '').trim();
  if (trimmed === '') return null;
  const points = Number(trimmed);
  if (!Number.isFinite(points)) return null;
  const halfPoints = Math.round(points * 2);
  if (halfPoints < MIN_HALF_POINTS || halfPoints > MAX_HALF_POINTS) return null;
  return halfPoints;
}

function editorFocus(from: HTMLElement | null): void {
  const root = editorScopeFor(from) ?? from?.ownerDocument?.body;
  root?.querySelector<HTMLElement>('.docx-pages')?.focus();
}

const StepperShell = defineComponent({
  name: 'StepperShell',
  props: {
    slotId: { type: String, default: undefined },
    groupLabel: { type: String, required: true },
    decreaseLabel: { type: String, required: true },
    increaseLabel: { type: String, required: true },
    canDecrease: { type: Boolean, required: true },
    canIncrease: { type: Boolean, required: true },
    title: { type: String, default: undefined },
    className: { type: String, default: undefined },
  },
  emits: ['decrease', 'increase'],
  setup(props, { emit, slots }) {
    return () => (
      <span
        class={`docx-toolbar__stepper${props.className ? ` ${props.className}` : ''}`}
        {...(props.slotId !== undefined ? { 'data-slot': props.slotId } : {})}
        role="group"
        aria-label={props.groupLabel}
        title={props.title ?? props.groupLabel}
      >
        <button
          type="button"
          class="docx-toolbar__stepper-button"
          disabled={!props.canDecrease}
          aria-label={props.decreaseLabel}
          onMousedown={guardToolbarMousedown}
          onClick={() => emit('decrease')}
        >
          −
        </button>
        {slots.default?.()}
        <button
          type="button"
          class="docx-toolbar__stepper-button"
          disabled={!props.canIncrease}
          aria-label={props.increaseLabel}
          onMousedown={guardToolbarMousedown}
          onClick={() => emit('increase')}
        >
          +
        </button>
      </span>
    );
  },
});

/** @public */
export const ToolbarFontSize = defineComponent({
  name: 'ToolbarFontSize',
  props: {
    className: { type: String, default: undefined },
    hidden: { type: Boolean, default: undefined },
  },
  setup(props) {
    const editorRef = useDocxEditor();
    const sizePt = useEditorState(selectFontSizePt);
    const command = useEditorCommand('font.size');
    const label = useToolbarLabel();
    const open = ref(false);
    const draft = ref<string | null>(null);
    const rootRef = ref<HTMLSpanElement | null>(null);
    const inputRef = ref<HTMLInputElement | null>(null);

    const applyHalfPoints = (halfPoints: number) => {
      const editor = editorRef.value;
      if (!editor) return;
      const cmd = commandForSlotValue('font.size', halfPoints);
      if (cmd && editor.can(cmd).ok) editor.exec(cmd);
    };

    const apply = (points: number) => {
      applyHalfPoints(Math.min(MAX_HALF_POINTS, Math.max(MIN_HALF_POINTS, Math.round(points * 2))));
    };

    const dismiss = (refocus: boolean) => {
      open.value = false;
      draft.value = null;
      inputRef.value?.blur();
      if (refocus) editorFocus(rootRef.value);
    };

    watch(open, (isOpen, _, onCleanup) => {
      if (!isOpen) return;
      const onMouseDown = (event: MouseEvent) => {
        const root = rootRef.value;
        if (root && event.target instanceof Node && root.contains(event.target)) return;
        open.value = false;
        draft.value = null;
      };
      document.addEventListener('mousedown', onMouseDown);
      onCleanup(() => document.removeEventListener('mousedown', onMouseDown));
    });

    return () => {
      if (props.hidden) return null;
      const canStep = command.isEnabled.value && sizePt.value !== null;
      const documentValue = sizePt.value === null ? '—' : String(Math.round(sizePt.value * 2) / 2);
      const shown = draft.value ?? documentValue;
      const selectedPreset = sizePt.value === null ? null : Math.round(sizePt.value * 2) / 2;

      const commitDraft = () => {
        if (draft.value === null) return;
        const halfPoints = parseTypedSize(draft.value);
        if (halfPoints !== null) applyHalfPoints(halfPoints);
      };

      return (
        <span
          ref={rootRef}
          class="docx-toolbar__font-size"
          data-slot="font.size"
          title={command.disabledReason.value ?? undefined}
        >
          <StepperShell
            class={props.className}
            slotId="font.size"
            groupLabel={label('fontSize.label')}
            decreaseLabel={label('fontSize.decrease')}
            increaseLabel={label('fontSize.increase')}
            canDecrease={canStep && Math.round(sizePt.value! * 2) > MIN_HALF_POINTS}
            canIncrease={canStep && Math.round(sizePt.value! * 2) < MAX_HALF_POINTS}
            onDecrease={() =>
              apply(prevPreset(sizePt.value ?? 0, FONT_SIZE_PRESETS_PT, MIN_HALF_POINTS / 2))
            }
            onIncrease={() =>
              apply(nextPreset(sizePt.value ?? 0, FONT_SIZE_PRESETS_PT, MAX_HALF_POINTS / 2))
            }
          >
            <input
              ref={inputRef}
              type="text"
              inputmode="decimal"
              class="docx-toolbar__stepper-value docx-toolbar__stepper-value--boxed docx-toolbar__font-size-input"
              value={shown}
              disabled={!command.isEnabled.value}
              role="combobox"
              aria-expanded={open.value}
              aria-haspopup="listbox"
              aria-label={label('fontSize.label')}
              autocomplete="off"
              onInput={(event: Event) => {
                draft.value = (event.target as HTMLInputElement).value;
                open.value = true;
              }}
              onFocus={(event: FocusEvent) => {
                (event.target as HTMLInputElement).select();
                open.value = true;
              }}
              onClick={() => {
                open.value = true;
              }}
              onKeydown={(event: KeyboardEvent) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitDraft();
                  dismiss(true);
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  dismiss(true);
                } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  open.value = true;
                  if (sizePt.value !== null) {
                    apply(
                      event.key === 'ArrowDown'
                        ? prevPreset(sizePt.value, FONT_SIZE_PRESETS_PT, MIN_HALF_POINTS / 2)
                        : nextPreset(sizePt.value, FONT_SIZE_PRESETS_PT, MAX_HALF_POINTS / 2)
                    );
                  }
                }
              }}
              onBlur={() => {
                commitDraft();
                draft.value = null;
              }}
            />
          </StepperShell>
          {open.value && command.isEnabled.value ? (
            <div
              class="docx-toolbar__menu docx-toolbar__font-size-menu"
              role="listbox"
              aria-label={label('fontSize.listLabel')}
            >
              {FONT_SIZE_PRESETS_PT.map((preset) => {
                const selected = selectedPreset === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    {...(selected ? { 'data-selected': '' } : {})}
                    class="docx-toolbar__menu-item"
                    onMousedown={guardToolbarMousedown}
                    onClick={() => {
                      apply(preset);
                      dismiss(true);
                    }}
                  >
                    {preset}
                  </button>
                );
              })}
            </div>
          ) : null}
        </span>
      );
    };
  },
}) as unknown as ToolbarSlotPartComponent;

ToolbarFontSize.docxSlot = 'font.size';

/** @public */
export const ToolbarZoom = defineComponent({
  name: 'ToolbarZoom',
  props: {
    className: { type: String, default: undefined },
    hidden: { type: Boolean, default: undefined },
  },
  setup(props) {
    const editorRef = useDocxEditor();
    const zoomState = useZoom();
    const label = useToolbarLabel();
    const open = ref(false);
    const rootRef = ref<HTMLSpanElement | null>(null);

    watch(open, (isOpen, _, onCleanup) => {
      if (!isOpen) return;
      const onMouseDown = (event: MouseEvent) => {
        const root = rootRef.value;
        if (root && event.target instanceof Node && root.contains(event.target)) return;
        open.value = false;
      };
      document.addEventListener('mousedown', onMouseDown);
      onCleanup(() => document.removeEventListener('mousedown', onMouseDown));
    });

    return () => {
      if (props.hidden) return null;
      const display = `${Math.round(zoomState.zoom.value * 100)}%`;
      const autoSelected = sameZoomMode(zoomState.mode.value, AUTO_ZOOM_MODE);
      const fitWidthSelected = sameZoomMode(zoomState.mode.value, FIT_WIDTH_ZOOM_MODE);

      return (
        <span ref={rootRef} class="docx-toolbar__zoom" data-slot="zoom.level">
          <StepperShell
            class={props.className}
            groupLabel={label('zoom.zoomLevel')}
            decreaseLabel={label('zoom.zoomOut')}
            increaseLabel={label('zoom.zoomIn')}
            canDecrease={zoomState.canZoomOut.value}
            canIncrease={zoomState.canZoomIn.value}
            onDecrease={zoomState.zoomOut}
            onIncrease={zoomState.zoomIn}
          >
            <button
              type="button"
              class="docx-toolbar__stepper-value docx-toolbar__stepper-value--menu"
              disabled={!editorRef.value}
              aria-haspopup="listbox"
              aria-expanded={open.value}
              aria-label={label('zoom.zoomLevel')}
              onMousedown={guardToolbarMousedown}
              onClick={() => {
                open.value = !open.value;
              }}
            >
              {display}
              <span class="docx-toolbar__picker-caret" aria-hidden="true">
                ▾
              </span>
            </button>
          </StepperShell>
          {open.value ? (
            <div
              class="docx-toolbar__menu docx-toolbar__zoom-menu"
              role="listbox"
              aria-label={label('zoom.zoomLevel')}
            >
              <button
                type="button"
                role="option"
                aria-selected={autoSelected}
                {...(autoSelected ? { 'data-selected': '' } : {})}
                class="docx-toolbar__menu-item"
                onMousedown={guardToolbarMousedown}
                onClick={() => {
                  open.value = false;
                  zoomState.setMode('auto');
                }}
              >
                {label('zoom.automatic')}
              </button>
              <button
                type="button"
                role="option"
                aria-selected={fitWidthSelected}
                {...(fitWidthSelected ? { 'data-selected': '' } : {})}
                class="docx-toolbar__menu-item"
                onMousedown={guardToolbarMousedown}
                onClick={() => {
                  open.value = false;
                  zoomState.setMode(FIT_WIDTH_ZOOM_MODE);
                }}
              >
                {label('zoom.fitWidth')}
              </button>
              <hr class="docx-toolbar__menu-separator" role="presentation" />
              {zoomState.levels.map((level) => {
                const selected =
                  !zoomState.isFit.value && Math.abs(level - zoomState.zoom.value) < 0.001;
                return (
                  <button
                    key={level}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    {...(selected ? { 'data-selected': '' } : {})}
                    class="docx-toolbar__menu-item"
                    onMousedown={guardToolbarMousedown}
                    onClick={() => {
                      open.value = false;
                      zoomState.setZoom(level);
                    }}
                  >
                    {`${Math.round(level * 100)}%`}
                  </button>
                );
              })}
            </div>
          ) : null}
        </span>
      );
    };
  },
}) as unknown as ToolbarSlotPartComponent;

ToolbarZoom.docxSlot = 'zoom.level';
