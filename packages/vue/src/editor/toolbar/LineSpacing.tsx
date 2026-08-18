import { defineComponent, ref, watch } from 'vue';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { commandForSlotValue } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import { useEditorCommand } from '../useEditorCommand';
import { useToolbarLabel } from './toolbar-context';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from './ToolbarButton';
import type { ToolbarSlotPartComponent } from './parts';

const LINE_SPACING_PRESETS: readonly number[] = [1, 1.15, 1.5, 2, 2.5, 3];
const DEFAULT_PARAGRAPH_SPACE_PT = 10;

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
      const editor = editorRef.value;
      if (!editor) return;
      const cmd = commandForSlotValue('list.lineSpacing', lines);
      if (cmd && editor.can(cmd).ok) editor.exec(cmd);
    };

    const applySpace = (field: 'beforePt' | 'afterPt', points: number | null) => {
      open.value = false;
      const editor = editorRef.value;
      if (!editor) return;
      const cmd = { type: 'setParagraphSpacing' as const, [field]: points };
      if (editor.can(cmd).ok) editor.exec(cmd);
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
                onMousedown={guardToolbarMousedown}
                onClick={() =>
                  applySpace('beforePt', hasBefore ? null : DEFAULT_PARAGRAPH_SPACE_PT)
                }
              >
                {label(hasBefore ? 'lineSpacing.removeSpaceBefore' : 'lineSpacing.addSpaceBefore')}
              </button>
              <button
                type="button"
                role="menuitem"
                class="docx-toolbar__menu-item"
                onMousedown={guardToolbarMousedown}
                onClick={() => applySpace('afterPt', hasAfter ? null : DEFAULT_PARAGRAPH_SPACE_PT)}
              >
                {label(hasAfter ? 'lineSpacing.removeSpaceAfter' : 'lineSpacing.addSpaceAfter')}
              </button>
            </div>
          ) : null}
        </span>
      );
    };
  },
}) as unknown as ToolbarSlotPartComponent;

ToolbarLineSpacing.docxSlot = 'list.lineSpacing';
