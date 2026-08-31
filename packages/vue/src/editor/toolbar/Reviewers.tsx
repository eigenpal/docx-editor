import { computed, defineComponent, nextTick, ref, watch, type PropType } from 'vue';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { localizeDisabledReason } from '@docx-editor.dev/i18n';
import { toolbarCommandState } from '@docx-editor.dev/core/editor';
import { useTranslation } from '../../i18n';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import { useReviewAuthors } from '../useReviewAuthors';
import { useToolbarLabel } from './toolbar-context';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from './ToolbarButton';

const selectHiddenAuthors = (snapshot: EditorSnapshot): readonly string[] =>
  snapshot.hiddenReviewAuthors ?? [];

/** @public */
export interface ToolbarReviewersProps {
  className?: string;
  hidden?: boolean;
}

/** Word for Mac's reviewer visibility menu. It changes view state only. @public */
export const ToolbarReviewers = Object.assign(
  defineComponent({
    name: 'ToolbarReviewers',
    props: {
      className: { type: String, default: undefined },
      hidden: { type: Boolean, default: undefined },
    },
    setup(props) {
      const editorRef = useDocxEditor();
      const authors = useReviewAuthors();
      const hiddenAuthors = useEditorState(selectHiddenAuthors);
      const hiddenSet = computed(() => new Set(hiddenAuthors.value));
      const open = ref(false);
      const rootRef = ref<HTMLDivElement | null>(null);
      const triggerRef = ref<HTMLButtonElement | null>(null);
      const menuRef = ref<HTMLDivElement | null>(null);
      const label = useToolbarLabel();
      const { t } = useTranslation();

      watch(
        open,
        (isOpen, _, onCleanup) => {
          if (!isOpen) return;
          menuRef.value?.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')?.focus();
          const onMouseDown = (event: MouseEvent) => {
            if (rootRef.value?.contains(event.target as Node)) return;
            open.value = false;
          };
          const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            open.value = false;
            void nextTick(() => triggerRef.value?.focus());
          };
          document.addEventListener('mousedown', onMouseDown, true);
          document.addEventListener('keydown', onKeyDown);
          onCleanup(() => {
            document.removeEventListener('mousedown', onMouseDown, true);
            document.removeEventListener('keydown', onKeyDown);
          });
        },
        { flush: 'post' }
      );

      const onMenuKeyDown = (event: KeyboardEvent) => {
        const items = [
          ...(menuRef.value?.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]') ??
            []),
        ];
        const at = items.indexOf(document.activeElement as HTMLButtonElement);
        const move = (to: number) => {
          event.preventDefault();
          items[(to + items.length) % items.length]?.focus();
        };
        if (event.key === 'ArrowDown') move(at + 1);
        else if (event.key === 'ArrowUp') move(at - 1);
        else if (event.key === 'Home') move(0);
        else if (event.key === 'End') move(items.length - 1);
        else if (event.key === 'Tab') open.value = false;
      };

      return () => {
        if (props.hidden) return null;
        const reviewerAuthors = authors.value;
        const control = chromeControlForSlot('review.authors');
        const state = toolbarCommandState(editorRef.value, 'review.authors');
        const disabledReason = localizeDisabledReason(state.disabledReason, t);
        const text = label(control?.labelKey ?? 'reviewers.label');
        return (
          <div
            ref={rootRef}
            class={`docx-toolbar__reviewers${props.className ? ` ${props.className}` : ''}`}
            data-slot="review.authors"
          >
            <button
              ref={triggerRef}
              type="button"
              class="docx-toolbar__picker"
              data-testid="reviewers-trigger"
              aria-haspopup="menu"
              aria-expanded={open.value}
              aria-label={text}
              disabled={!state.enabled}
              title={disabledReason ?? text}
              onMousedown={guardToolbarMousedown}
              onClick={() => {
                open.value = !open.value;
              }}
            >
              {chromeIcon(control?.paths)}
              <span class="docx-toolbar__picker-value">{text}</span>
              <span class="docx-toolbar__picker-caret" aria-hidden="true">
                ▾
              </span>
            </button>
            {open.value ? (
              <div
                ref={menuRef}
                class="docx-toolbar__reviewers-menu"
                role="menu"
                aria-label={text}
                data-testid="reviewers-menu"
                onKeydown={onMenuKeyDown}
              >
                <ReviewerRow
                  checked={reviewerAuthors.every((info) => !hiddenSet.value.has(info.author))}
                  label={t('reviewers.all')}
                  testId="reviewer-all"
                  onChoose={() =>
                    editorRef.value?.setAllReviewAuthorsVisible(
                      !reviewerAuthors.every((info) => !hiddenSet.value.has(info.author))
                    )
                  }
                />
                <div class="docx-toolbar__menu-separator" role="separator" />
                {reviewerAuthors.map((info) => (
                  <ReviewerRow
                    key={info.author}
                    checked={!hiddenSet.value.has(info.author)}
                    label={info.author || '—'}
                    testId={`reviewer-${info.slot}`}
                    color={info.color}
                    onChoose={() =>
                      editorRef.value?.setReviewAuthorVisible(
                        info.author,
                        hiddenSet.value.has(info.author)
                      )
                    }
                  />
                ))}
              </div>
            ) : null}
          </div>
        );
      };
    },
  }),
  { docxSlot: 'review.authors' as const }
);

const ReviewerRow = defineComponent({
  name: 'ReviewerRow',
  props: {
    checked: { type: Boolean, required: true },
    label: { type: String, required: true },
    testId: { type: String, required: true },
    color: { type: String, default: undefined },
    onChoose: { type: Function as PropType<() => void>, required: true },
  },
  setup(props) {
    return () => (
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={props.checked}
        class="docx-toolbar__reviewer-item"
        data-testid={props.testId}
        onMousedown={guardToolbarMousedown}
        onClick={props.onChoose}
      >
        <span class="docx-toolbar__menu-check" aria-hidden="true">
          {props.checked ? '✓' : ''}
        </span>
        {props.color ? (
          <span class="docx-toolbar__reviewer-swatch" style={{ background: props.color }} />
        ) : null}
        <span class="docx-toolbar__reviewer-name">{props.label}</span>
      </button>
    );
  },
});
