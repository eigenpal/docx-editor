import { defineComponent, ref, watch } from 'vue';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { commandForSlotValue } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import { useEditorCommand } from '../useEditorCommand';
import { useParagraphDialog } from '../paragraph-dialog-host';
import { useToolbarLabel } from './toolbar-context';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from './ToolbarButton';
import type { ToolbarSlotPartComponent } from './parts';

const LINE_SPACING_PRESETS: readonly number[] = [1, 1.15, 1.5, 2, 2.5, 3];
const DEFAULT_PARAGRAPH_SPACE_PT = 10;
// Remove writes an explicit ZERO, not nothing: dropping the attribute lets the style's own
// space come back, so on a Word default document Remove gave the space straight back.
const REMOVED_PARAGRAPH_SPACE_PT = 0;

const selectSpacing = (snapshot: EditorSnapshot) => ({
  lineSpacing: snapshot.formatting?.lineSpacing ?? null,
  spaceBeforePt: snapshot.formatting?.spaceBeforePt ?? null,
  spaceAfterPt: snapshot.formatting?.spaceAfterPt ?? null,
});

const sameSpacing = (a: ReturnType<typeof selectSpacing>, b: ReturnType<typeof selectSpacing>) =>
  a.spaceBeforePt === b.spaceBeforePt &&
  a.spaceAfterPt === b.spaceAfterPt &&
  a.lineSpacing?.rule === b.lineSpacing?.rule &&
  a.lineSpacing?.value === b.lineSpacing?.value;

/** @public */
export const ToolbarLineSpacing = defineComponent({
  name: 'ToolbarLineSpacing',
  props: {
    className: { type: String, default: undefined },
    hidden: { type: Boolean, default: undefined },
  },
  setup(props) {
    const editorRef = useDocxEditor();
    const spacing = useEditorState(selectSpacing, sameSpacing);
    const command = useEditorCommand('list.lineSpacing');
    // The row opens a `setParagraphFormat` editor, so THAT is the command whose
    // availability decides whether it works — not `list.lineSpacing`, whose gate it used to
    // borrow. Asked through the same composable the dialog itself uses.
    // Through the registry, so the row's enabled state has the same single source every
    // other control does — `toolbarCommandState`, via the `paragraph.dialog` slot's probe.
    const paragraphDialogCommand = useEditorCommand('paragraph.dialog');
    const paragraphDialog = useParagraphDialog();
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

    const applyLines = (lines: number) => {
      open.value = false;
      if (!editorRef.value) return;
      const cmd = commandForSlotValue('list.lineSpacing', lines);
      if (cmd && editorRef.value!.can(cmd).ok) editorRef.value!.exec(cmd);
    };

    const applySpace = (field: 'beforePt' | 'afterPt', points: number | null) => {
      open.value = false;
      if (!editorRef.value) return;
      const cmd = { type: 'setParagraphSpacing' as const, [field]: points };
      if (editorRef.value!.can(cmd).ok) editorRef.value!.exec(cmd);
    };

    return () => {
      if (props.hidden) return null;
      const control = chromeControlForSlot('list.lineSpacing');
      const hasBefore = (spacing.value.spaceBeforePt ?? 0) > 0;
      const hasAfter = (spacing.value.spaceAfterPt ?? 0) > 0;
      const ticked =
        spacing.value.lineSpacing?.rule === 'multiple'
          ? (spacing.value.lineSpacing?.value ?? null)
          : null;

      return (
        <span ref={rootRef} class="docx-toolbar__line-spacing" data-slot="list.lineSpacing">
          <button
            type="button"
            class={`docx-toolbar__button docx-toolbar__line-spacing-trigger${props.className ? ` ${props.className}` : ''}`}
            disabled={!command.isEnabled.value}
            {...(!command.isEnabled.value ? { 'data-disabled': '' } : {})}
            aria-haspopup="menu"
            aria-expanded={open.value}
            aria-label={label('lineSpacing.label')}
            title={command.disabledReason.value ?? label('lineSpacing.label')}
            onMousedown={guardToolbarMousedown}
            onClick={() => {
              open.value = !open.value;
            }}
          >
            {chromeIcon(control?.paths)}
            <span class="docx-toolbar__picker-caret" aria-hidden="true">
              ▾
            </span>
          </button>
          {open.value && command.isEnabled.value ? (
            <div class="docx-toolbar__menu docx-toolbar__line-spacing-menu" role="menu">
              {LINE_SPACING_PRESETS.map((lines) => {
                const selected = ticked === lines;
                return (
                  <button
                    key={lines}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    {...(selected ? { 'data-selected': '' } : {})}
                    class="docx-toolbar__menu-item"
                    onMousedown={guardToolbarMousedown}
                    onClick={() => applyLines(lines)}
                  >
                    {Number.isInteger(lines * 10) ? lines.toFixed(1) : lines.toFixed(2)}
                  </button>
                );
              })}
              <div class="docx-toolbar__menu-separator" role="separator" />
              <button
                type="button"
                role="menuitem"
                class="docx-toolbar__menu-item"
                // Its OWN slot, not line spacing's: the row opens a `setParagraphFormat`
                // editor, so that is the command whose availability decides whether it works.
                data-slot="paragraph.dialog"
                disabled={!paragraphDialogCommand.isEnabled.value}
                title={paragraphDialogCommand.disabledReason.value ?? undefined}
                onMousedown={guardToolbarMousedown}
                onClick={() => {
                  open.value = false;
                  // The trigger, not the menu item: the menu closes in this same gesture,
                  // so the row the user clicked is gone by the time the dialog does. The
                  // dialog itself lives above the toolbar, because this part moves.
                  const trigger = rootRef.value?.querySelector(
                    '.docx-toolbar__line-spacing-trigger'
                  );
                  paragraphDialog?.open(trigger instanceof HTMLElement ? trigger : null);
                }}
              >
                {label('lineSpacing.options')}
              </button>
              <div class="docx-toolbar__menu-separator" role="separator" />
              <button
                type="button"
                role="menuitem"
                class="docx-toolbar__menu-item"
                onMousedown={guardToolbarMousedown}
                onClick={() =>
                  applySpace(
                    'beforePt',
                    hasBefore ? REMOVED_PARAGRAPH_SPACE_PT : DEFAULT_PARAGRAPH_SPACE_PT
                  )
                }
              >
                {label(hasBefore ? 'lineSpacing.removeSpaceBefore' : 'lineSpacing.addSpaceBefore')}
              </button>
              <button
                type="button"
                role="menuitem"
                class="docx-toolbar__menu-item"
                onMousedown={guardToolbarMousedown}
                onClick={() =>
                  applySpace(
                    'afterPt',
                    hasAfter ? REMOVED_PARAGRAPH_SPACE_PT : DEFAULT_PARAGRAPH_SPACE_PT
                  )
                }
              >
                {label(hasAfter ? 'lineSpacing.removeSpaceAfter' : 'lineSpacing.addSpaceAfter')}
              </button>
            </div>
          ) : null}
          {/* The rows above are Word's shortcuts — a fixed Add, a zeroing Remove. The
              dialog is the escape hatch for an exact value, which is what "Line spacing
              options…" opens in Word and what this menu had no answer for. */}
        </span>
      );
    };
  },
}) as unknown as ToolbarSlotPartComponent;

ToolbarLineSpacing.docxSlot = 'list.lineSpacing';
