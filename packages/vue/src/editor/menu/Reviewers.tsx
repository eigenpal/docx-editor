import { defineComponent, h, type PropType } from 'vue';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { toolbarCommandState } from '@docx-editor.dev/core/editor';
import { localizeDisabledReason } from '@docx-editor.dev/i18n';
import { useTranslation } from '../../i18n';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import { useReviewAuthors } from '../useReviewAuthors';
import { useMenuLabel } from './menu-context';
import { Menu, MenuRow, MenuSubmenu, menuRowSlot } from './parts';

const selectHiddenAuthors = (snapshot: EditorSnapshot): readonly string[] =>
  snapshot.hiddenReviewAuthors ?? [];

/** @public */
export type MenuReviewersProps = {
  className?: string;
  hidden?: boolean;
};

/** The document-dependent Reviewers submenu. It changes view state only. @public */
export const MenuReviewers = defineComponent({
  name: 'MenuReviewers',
  props: {
    className: { type: String, default: undefined },
    hidden: { type: Boolean, default: undefined },
  },
  setup(props) {
    const editorRef = useDocxEditor();
    const authors = useReviewAuthors();
    const hiddenAuthors = useEditorState(selectHiddenAuthors);
    const label = useMenuLabel();
    const { t } = useTranslation();
    return () => {
      if (props.hidden) return null;
      const text = label('reviewers.label');
      const state = toolbarCommandState(editorRef.value, 'review.authors');
      const disabledReason = localizeDisabledReason(state.disabledReason, t);
      if (!state.enabled) {
        return (
          <MenuRow disabled title={disabledReason ?? undefined} {...menuRowSlot('review.authors')}>
            {text}
          </MenuRow>
        );
      }

      const hiddenSet = new Set(hiddenAuthors.value);
      const reviewerAuthors = authors.value;
      const allVisible = reviewerAuthors.every((info) => !hiddenSet.has(info.author));
      return (
        <MenuSubmenu labelKey="reviewers.label" className={props.className}>
          <ReviewerRow
            checked={allVisible}
            label={label('reviewers.all')}
            rowSlot="reviewer-all"
            onChoose={() => editorRef.value?.setAllReviewAuthorsVisible(!allVisible)}
          />
          <div class="docx-toolbar__menu-separator" role="separator" />
          {reviewerAuthors.map((info) => (
            <ReviewerRow
              key={info.author}
              checked={!hiddenSet.has(info.author)}
              label={info.author || '—'}
              rowSlot={`reviewer-${info.slot}`}
              onChoose={() =>
                editorRef.value?.setReviewAuthorVisible(info.author, hiddenSet.has(info.author))
              }
            />
          ))}
        </MenuSubmenu>
      );
    };
  },
});

const ReviewerRow = defineComponent({
  name: 'MenuReviewerRow',
  props: {
    checked: { type: Boolean, required: true },
    label: { type: String, required: true },
    rowSlot: { type: String, required: true },
    onChoose: { type: Function as PropType<() => void>, required: true },
  },
  setup(props) {
    return () => (
      <MenuRow
        active={props.checked}
        {...menuRowSlot(props.rowSlot)}
        className="docx-menubar__reviewer-item"
        icon={<span class="docx-menubar__reviewer-check">{props.checked ? '✓' : ''}</span>}
        selectHandler={props.onChoose}
      >
        {props.label}
      </MenuRow>
    );
  },
});

const MenuReviewImpl = defineComponent({
  name: 'MenuReview',
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    return () =>
      h(
        Menu,
        { id: 'review', ...attrs },
        {
          default: () => [
            h(
              MenuSubmenu,
              { labelKey: 'reviewers.markupOptions', className: 'docx-menubar__markup-options' },
              { default: () => h(MenuReviewers, { className: 'docx-menubar__reviewers-submenu' }) }
            ),
            ...(slots.default?.() ?? []),
          ],
        }
      );
  },
});

/** The packaged top-level Review menu. @public */
export const MenuReview = Object.assign(MenuReviewImpl, { docxMenu: 'review' as const });
