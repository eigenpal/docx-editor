// The Bookmark dialog as a context-fed part (`DocxEditor.BookmarkDialog`). The Vue twin of
// the React dialog: the list order and the name rules come from the engine
// (`bookmarkDialogRows`, `bookmarkDialogNameState`), so both adapters answer alike.

import type { DocxEditorChildren } from '../docx-editor-children';
import {
  bookmarkDialogInitialName,
  bookmarkDialogNameState,
  bookmarkDialogRows,
  isHTMLElementNode,
  type BookmarkSortOrder,
} from '@docx-editor.dev/core/editor';
import type { BookmarkSummary } from '@docx-editor.dev/core/contracts/editor';
import {
  Fragment,
  computed,
  defineComponent,
  h,
  ref,
  useId,
  type CSSProperties,
  type ComputedRef,
  type PropType,
} from 'vue';
import {
  createDialogComposition,
  NativeDialog,
  useDialogGeneration,
  type DialogCustomizationProps,
  type UseDialogReturn,
} from './dialog-parts';
import { useTranslation } from '../i18n';
import { useBookmarks } from './useBookmarks';

/** The Bookmark dialog's draft. @public */
export interface BookmarkDialogFields {
  /** The name typed or picked from the list. */
  name: string;
  sortBy: BookmarkSortOrder;
  /** Whether hidden bookmarks (names starting with an underscore) are listed. */
  showHidden: boolean;
}

/** Bookmark dialog draft and actions. `apply` is Add. @public */
export interface UseBookmarkDialogReturn extends UseDialogReturn<BookmarkDialogFields> {
  /** The bookmarks the list shows, in the chosen order. */
  readonly rows: ComputedRef<readonly BookmarkSummary[]>;
  /** Whether Delete and Go To can act on the typed name. */
  readonly canDelete: ComputedRef<boolean>;
  readonly canGoTo: ComputedRef<boolean>;
  remove(): void;
  goTo(): void;
}

const composition = createDialogComposition<
  BookmarkDialogFields,
  'name' | 'list' | 'sortBy' | 'showHidden'
>('BookmarkDialog');

/** Read the enclosing Bookmark dialog draft. @public */
export function useBookmarkDialog(): UseBookmarkDialogReturn {
  return composition.useContext() as UseBookmarkDialogReturn;
}

/** Props for `DocxEditor.BookmarkDialog`. @public */
export interface DocxEditorBookmarkDialogProps extends DialogCustomizationProps {
  /** Whether the dialog is shown. The host owns this state. */
  open: boolean;
  /** Called on Cancel, Escape, overlay click, and after a successful Add. */
  onClose: () => void;
}

const PROBLEM_KEYS = {
  empty: 'dialogs.bookmark.nameEmpty',
  tooLong: 'dialogs.bookmark.nameTooLong',
  invalidStart: 'dialogs.bookmark.nameInvalidStart',
  invalidCharacter: 'dialogs.bookmark.nameInvalidCharacter',
} as const;

const dialogProps = {
  children: Object as PropType<DocxEditorChildren>,
  open: { type: Boolean, required: true },
  onClose: { type: Function as PropType<() => void>, required: true },
  className: { type: String, default: undefined },
  style: Object as PropType<CSSProperties>,
  preset: { type: Boolean, default: true },
} as const;

const OpenBookmarkDialog = defineComponent({
  name: 'DocxEditorOpenBookmarkDialog',
  props: dialogProps,
  setup(props, { slots }) {
    const { t } = useTranslation();
    const currentGeneration = useDialogGeneration(() => props.open, props.onClose);
    const { bookmarks, isWritable, insert, remove, goTo } = useBookmarks();
    // Opened inside a bookmark, the dialog names it, ready for Go To or Delete.
    const name = ref(bookmarkDialogInitialName(bookmarks.value));
    const sortBy = ref<BookmarkSortOrder>('name');
    const showHidden = ref(false);
    const refused = ref(false);
    const attempted = ref(false);
    // After Go To the dialog has done something, so its dismiss button reads Close.
    const visited = ref(false);
    const nameId = useId();
    const messageId = useId();

    const rows = computed(() =>
      bookmarkDialogRows(bookmarks.value, { sortBy: sortBy.value, showHidden: showHidden.value })
    );
    const nameState = computed(() =>
      bookmarkDialogNameState(bookmarks.value, name.value, isWritable.value)
    );
    const problem = computed(() =>
      // A picked existing name (a hidden one, say) is for Go To and Delete: no complaint.
      nameState.value.problem &&
      !nameState.value.existing &&
      (attempted.value || name.value.length > 0)
        ? nameState.value.problem
        : null
    );
    const message = computed(() =>
      refused.value
        ? t('dialogs.bookmark.refused')
        : problem.value
          ? t(PROBLEM_KEYS[problem.value])
          : nameState.value.existing && nameState.value.canAdd
            ? t('dialogs.bookmark.nameExists')
            : null
    );

    const handleAdd = () => {
      attempted.value = true;
      if (!nameState.value.canAdd || !currentGeneration()) return;
      const result = insert(name.value);
      refused.value = !result.ok;
      if (result.ok) props.onClose();
    };
    const handleRemove = () => {
      const existing = nameState.value.existing;
      if (!nameState.value.canDelete || !existing) return;
      const result = remove(existing.name);
      refused.value = !result.ok;
      if (result.ok) name.value = '';
    };
    const handleGoTo = () => {
      const existing = nameState.value.existing;
      if (!nameState.value.canGoTo || !existing) return;
      const result = goTo(existing.name);
      refused.value = !result.ok;
      if (result.ok) visited.value = true;
    };

    const setValue: UseBookmarkDialogReturn['setValue'] = (field, value) => {
      if (field === 'name') name.value = value as string;
      else if (field === 'sortBy') sortBy.value = value as BookmarkSortOrder;
      else showHidden.value = value as boolean;
      refused.value = false;
    };
    const context: UseBookmarkDialogReturn = {
      values: computed(() => ({
        name: name.value,
        sortBy: sortBy.value,
        showHidden: showHidden.value,
      })),
      errors: computed(() =>
        problem.value
          ? { name: t(PROBLEM_KEYS[problem.value]) }
          : refused.value
            ? { form: t('dialogs.bookmark.refused') }
            : {}
      ),
      isEnabled: computed(() => nameState.value.canAdd),
      setValue,
      apply: handleAdd,
      cancel: () => props.onClose(),
      rows,
      canDelete: computed(() => nameState.value.canDelete),
      canGoTo: computed(() => nameState.value.canGoTo),
      remove: handleRemove,
      goTo: handleGoTo,
    };
    const renderParts = composition.provideContext(context);

    return () => {
      if (!props.open) return null;
      const state = nameState.value;
      const selected = state.existing?.name ?? '';
      const defaults = (
        <Fragment>
          <div data-docx-part="header" class="docx-dialog__header">
            <span data-docx-part="title" class="docx-dialog__title">
              {t('dialogs.bookmark.title')}
            </span>
          </div>
          <div data-docx-part="body" class="docx-dialog__body">
            <div data-docx-part="field" data-docx-field="name" class="docx-dialog__row">
              <label class="docx-dialog__label" for={nameId}>
                {t('dialogs.bookmark.name')}
              </label>
              <input
                id={nameId}
                type="text"
                class="docx-dialog__input"
                value={name.value}
                maxlength={40}
                autocomplete="off"
                spellcheck={false}
                aria-invalid={problem.value ? true : undefined}
                aria-describedby={messageId}
                onInput={(event: Event) =>
                  setValue('name', (event.target as HTMLInputElement).value)
                }
              />
            </div>
            <div data-docx-part="field" data-docx-field="list" class="docx-dialog__row">
              <select
                class="docx-dialog__input docx-dialog__input--full docx-bookmark-dialog__list"
                size={8}
                value={selected}
                aria-label={t('dialogs.bookmark.list')}
                onChange={(event: Event) =>
                  setValue('name', (event.target as HTMLSelectElement).value)
                }
                onDblclick={handleGoTo}
              >
                {rows.value.map((row) => (
                  <option key={row.name} value={row.name} selected={row.name === selected}>
                    {row.name}
                  </option>
                ))}
              </select>
            </div>
            {rows.value.length === 0 ? (
              <div class="docx-dialog__hint">{t('dialogs.bookmark.empty')}</div>
            ) : null}
            <div
              data-docx-part="field"
              data-docx-field="sortBy"
              class="docx-dialog__row"
              role="radiogroup"
              aria-label={t('dialogs.bookmark.sortBy')}
            >
              <span class="docx-dialog__label">{t('dialogs.bookmark.sortBy')}</span>
              {(['name', 'location'] as const).map((order) => (
                <label key={order} class="docx-dialog__checkbox-row">
                  <input
                    type="radio"
                    name={`${nameId}-sort`}
                    checked={sortBy.value === order}
                    onChange={() => setValue('sortBy', order)}
                  />
                  {t(
                    order === 'name' ? 'dialogs.bookmark.sortName' : 'dialogs.bookmark.sortLocation'
                  )}
                </label>
              ))}
            </div>
            <div data-docx-part="field" data-docx-field="showHidden" class="docx-dialog__row">
              <label class="docx-dialog__checkbox-row">
                <input
                  type="checkbox"
                  checked={showHidden.value}
                  onChange={(event: Event) =>
                    setValue('showHidden', (event.target as HTMLInputElement).checked)
                  }
                />
                {t('dialogs.bookmark.showHidden')}
              </label>
            </div>
          </div>
          <div data-docx-part="footer" class="docx-dialog__footer">
            <span id={messageId} data-docx-part="error" class="docx-dialog__error" role="status">
              {message.value}
            </span>
            <button
              data-docx-part="apply"
              class="docx-dialog__button docx-dialog__apply"
              type="button"
              disabled={!state.canAdd}
              onClick={handleAdd}
            >
              {t('dialogs.bookmark.add')}
            </button>
            <button
              data-docx-part="delete"
              class="docx-dialog__button"
              type="button"
              disabled={!state.canDelete}
              onClick={handleRemove}
            >
              {t('dialogs.bookmark.delete')}
            </button>
            <button
              data-docx-part="goto"
              class="docx-dialog__button"
              type="button"
              disabled={!state.canGoTo}
              onClick={handleGoTo}
            >
              {t('dialogs.bookmark.goTo')}
            </button>
            <button
              data-docx-part="cancel"
              class="docx-dialog__button docx-dialog__cancel"
              type="button"
              onClick={props.onClose}
            >
              {t(visited.value ? 'common.close' : 'common.cancel')}
            </button>
          </div>
        </Fragment>
      );
      return (
        <NativeDialog
          kind="bookmark"
          label={t('dialogs.bookmark.title')}
          onClose={props.onClose}
          class={props.className}
          style={props.style}
          onKeydown={(event: KeyboardEvent) => {
            if (
              event.key === 'Enter' &&
              !event.isComposing &&
              isHTMLElementNode(event.target) &&
              event.target.localName === 'input' &&
              event.target.getAttribute('type') === 'text'
            ) {
              event.preventDefault();
              handleAdd();
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
 * The dialog is mounted only while it is open, so a closed dialog reads no bookmarks on each
 * editor update. Each opening starts a fresh draft.
 */
const BookmarkDialogImpl = defineComponent({
  name: 'DocxEditorBookmarkDialog',
  props: dialogProps,
  setup(props, { slots }) {
    return () => (props.open ? h(OpenBookmarkDialog, { ...props }, slots) : null);
  },
});

/** The Bookmark dialog with replaceable controls and layout. @public */
export const DocxEditorBookmarkDialog = Object.assign(BookmarkDialogImpl, {
  ...composition.parts,
  Delete: composition.part('Delete'),
  GoTo: composition.part('Goto'),
});
