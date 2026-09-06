import { computed, defineComponent, ref, shallowRef, watch } from 'vue';
import type { DocumentEditingMode, EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import {
  runToolbarCommand,
  toolbarCommandState,
  type DocxEditorInstance,
} from '@docx-editor.dev/core/editor';
import { localizeDisabledReason } from '@docx-editor.dev/i18n';
import { useTranslation } from '../../i18n';
import { useDocxEditor } from '../context';
import { useEditorEvent } from '../useEditorEvent';
import { useEditorState } from '../useEditorState';
import { useToolbarLabel } from './toolbar-context';
import { chromeControlForSlot, guardToolbarMousedown } from './ToolbarButton';
import type { ToolbarSlotPartComponent } from './parts';

const selectMode = (snapshot: EditorSnapshot): DocumentEditingMode =>
  snapshot.editingMode ?? 'editing';
// Keyboard travel skips a refused item; see the React twin.
const MENU_ITEMS = '[role="menuitemradio"]:not([disabled])';

type ItemReasons = readonly (string | null)[];
const sameReasons = (a: ItemReasons, b: ItemReasons): boolean =>
  a.length === b.length && a.every((reason, index) => reason === b[index]);
const selectLoading = (snapshot: EditorSnapshot) =>
  snapshot.isLoading || snapshot.isOpening === true;

interface ModeOption {
  readonly mode: DocumentEditingMode;
  readonly labelKey: 'editingMode.editing' | 'editingMode.suggesting' | 'editingMode.viewing';
  readonly hintKey:
    | 'editingMode.editingHint'
    | 'editingMode.suggestingHint'
    | 'editingMode.viewingHint';
  readonly path: string;
}

const MODE_OPTIONS: readonly ModeOption[] = [
  {
    mode: 'editing',
    labelKey: 'editingMode.editing',
    hintKey: 'editingMode.editingHint',
    path: 'M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56Zm-141 85-28-29 57 57-29-28Z',
  },
  {
    mode: 'suggesting',
    labelKey: 'editingMode.suggesting',
    hintKey: 'editingMode.suggestingHint',
    path: 'M240-400h122l40-40H240v40Zm0-100h222l40-40H240v40Zm0-100h322l40-40H240v40ZM80-80v-720q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v320h-80v-320H160v525l46-45h274v80H240L80-80Zm520-80v-123l221-220q9-9 20-13t22-4q12 0 23 4.5t20 13.5l37 37q8 9 12.5 20t4.5 22q0 11-4 22.5T943-380L723-160H600Zm300-263-37-37 37 37ZM660-220h38l121-122-19-18-18-19-122 121v38Zm140-141-18-19 37 37-19-18Z',
  },
  {
    mode: 'viewing',
    labelKey: 'editingMode.viewing',
    hintKey: 'editingMode.viewingHint',
    path: 'M480-320q75 0 127.5-52.5T660-500q0-75-52.5-127.5T480-680q-75 0-127.5 52.5T300-500q0 75 52.5 127.5T480-320Zm0-72q-45 0-76.5-31.5T372-500q0-45 31.5-76.5T480-608q45 0 76.5 31.5T588-500q0 45-31.5 76.5T480-392Zm0 192q-146 0-266-81.5T40-500q54-137 174-218.5T480-800q146 0 266 81.5T920-500q-54 137-174 218.5T480-200Z',
  },
];

const NO_REASONS: ItemReasons = Object.freeze(MODE_OPTIONS.map(() => null));

/** Each item's refusal from the engine, or null where its mode can be entered. */
function itemReasonsOf(editor: DocxEditorInstance | null): ItemReasons {
  if (!editor) return NO_REASONS;
  return MODE_OPTIONS.map((option) => {
    const probe = editor.can({ type: 'setEditingMode', mode: option.mode });
    return probe.ok ? null : probe.reason;
  });
}

const CHECK_PATH = 'M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z';

function glyph(path: string) {
  return (
    <svg viewBox="0 -960 960 960" width={18} height={18} aria-hidden="true" focusable="false">
      <path d={path} fill="currentColor" />
    </svg>
  );
}

/** @public */
export interface ToolbarEditingModeProps {
  className?: string;
  hidden?: boolean;
}

/** @public */
export const ToolbarEditingMode = defineComponent({
  name: 'ToolbarEditingMode',
  props: {
    className: { type: String, default: undefined },
    hidden: { type: Boolean, default: undefined },
  },
  setup(props) {
    const editorRef = useDocxEditor();
    const mode = useEditorState(selectMode);
    const loading = useEditorState(selectLoading);
    // The per-item refusals, live — from the store EVENTS, not a snapshot slice: the author
    // is not in the snapshot, so a slice would never re-run for it. See the React twin.
    const itemReasons = shallowRef<ItemReasons>(itemReasonsOf(editorRef.value));
    const refreshItemReasons = () => {
      const next = itemReasonsOf(editorRef.value);
      if (!sameReasons(itemReasons.value, next)) itemReasons.value = next;
    };
    watch(() => editorRef.value, refreshItemReasons);
    useEditorEvent('change', refreshItemReasons);
    useEditorEvent('selectionChange', refreshItemReasons);
    const label = useToolbarLabel();
    const { t } = useTranslation();
    const open = ref(false);
    const rootRef = ref<HTMLDivElement | null>(null);
    const menuRef = ref<HTMLDivElement | null>(null);

    watch(
      open,
      (isOpen) => {
        if (!isOpen) return;
        const items = menuRef.value?.querySelectorAll<HTMLButtonElement>(MENU_ITEMS);
        // Only an ENABLED checked item; see the React twin.
        const checked = menuRef.value?.querySelector<HTMLButtonElement>(
          `${MENU_ITEMS}[aria-checked="true"]`
        );
        (checked ?? items?.[0] ?? undefined)?.focus();
      },
      { flush: 'post' }
    );

    watch(open, (isOpen, _, onCleanup) => {
      if (!isOpen) return;
      const onMouseDown = (event: MouseEvent) => {
        const root = rootRef.value;
        if (root && event.target instanceof Node && root.contains(event.target)) return;
        open.value = false;
      };
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        open.value = false;
      };
      document.addEventListener('mousedown', onMouseDown, true);
      document.addEventListener('keydown', onKeyDown);
      onCleanup(() => {
        document.removeEventListener('mousedown', onMouseDown, true);
        document.removeEventListener('keydown', onKeyDown);
      });
    });

    const onMenuKeyDown = (event: KeyboardEvent) => {
      const items = [...(menuRef.value?.querySelectorAll<HTMLButtonElement>(MENU_ITEMS) ?? [])];
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      const move = (to: number) => {
        event.preventDefault();
        items[(to + items.length) % items.length]?.focus();
      };
      if (event.key === 'ArrowDown') move(at + 1);
      else if (event.key === 'ArrowUp') move(at - 1);
      else if (event.key === 'Home') move(0);
      else if (event.key === 'End') move(items.length - 1);
    };

    const choose = (next: DocumentEditingMode) => {
      open.value = false;
      runToolbarCommand(editorRef.value, 'review.editingMode', next);
      editorRef.value?.focus();
    };

    const current = computed(
      () => MODE_OPTIONS.find((option) => option.mode === mode.value) ?? MODE_OPTIONS[0]!
    );

    return () => {
      if (props.hidden) return null;
      const control = chromeControlForSlot('review.editingMode');
      const state = toolbarCommandState(editorRef.value, 'review.editingMode');
      const disabledReason = localizeDisabledReason(state.disabledReason, t);
      return (
        <div
          ref={rootRef}
          class={`docx-toolbar__mode${props.className ? ` ${props.className}` : ''}`}
          data-slot="review.editingMode"
        >
          <button
            type="button"
            class="docx-toolbar__picker"
            data-testid="editing-mode-trigger"
            data-mode={mode.value}
            aria-haspopup="menu"
            aria-expanded={open.value}
            aria-label={label(control?.labelKey ?? 'editingMode.label')}
            disabled={loading.value || !state.enabled}
            {...(disabledReason ? { title: disabledReason } : {})}
            onMousedown={guardToolbarMousedown}
            onClick={() => {
              open.value = !open.value;
            }}
          >
            {glyph(current.value.path)}
            <span class="docx-toolbar__picker-value">{label(current.value.labelKey)}</span>
            <span class="docx-toolbar__picker-caret" aria-hidden="true">
              ▾
            </span>
          </button>
          {open.value ? (
            <div
              ref={menuRef}
              class="docx-toolbar__mode-menu"
              role="menu"
              aria-label={label(control?.labelKey ?? 'editingMode.label')}
              data-testid="editing-mode-menu"
              onKeydown={onMenuKeyDown}
            >
              {MODE_OPTIONS.map((option, index) => {
                const reason = localizeDisabledReason(itemReasons.value[index] ?? null, t);
                return (
                  <button
                    key={option.mode}
                    type="button"
                    role="menuitemradio"
                    aria-checked={option.mode === mode.value}
                    class="docx-toolbar__mode-item"
                    data-testid={`editing-mode-${option.mode}`}
                    disabled={reason !== null}
                    {...(reason ? { title: reason } : {})}
                    onMousedown={guardToolbarMousedown}
                    onClick={() => choose(option.mode)}
                  >
                    {glyph(option.path)}
                    <span class="docx-toolbar__mode-text">
                      <span class="docx-toolbar__mode-label">{label(option.labelKey)}</span>
                      <span class="docx-toolbar__mode-hint">{label(option.hintKey)}</span>
                    </span>
                    <span class="docx-toolbar__mode-check" aria-hidden="true">
                      {option.mode === mode.value ? glyph(CHECK_PATH) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      );
    };
  },
}) as unknown as ToolbarSlotPartComponent;

ToolbarEditingMode.docxSlot = 'review.editingMode';
