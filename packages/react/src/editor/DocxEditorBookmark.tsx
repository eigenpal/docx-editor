import {
  createDialogParts,
  useDialogDocument,
  DialogFrame,
  type DialogCustomizationProps,
  type DialogPartProps,
  type UseDialogReturn,
} from './dialog-parts';
// The Bookmark dialog as a context-fed part (`DocxEditor.BookmarkDialog`).
//
// Lists the document's bookmarks, sorted by name or by location, with hidden bookmarks on
// request. Add bookmarks the selection under the typed name and closes; Delete removes the
// named bookmark; Go To selects it and keeps the dialog open. The list order and the name
// rules come from the engine (`bookmarkDialogRows`, `bookmarkDialogNameState`), so the React
// and Vue dialogs answer alike.

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import {
  bookmarkDialogInitialName,
  bookmarkDialogNameState,
  bookmarkDialogRows,
  isHTMLElementNode,
  type BookmarkSortOrder,
} from '@docx-editor.dev/core/editor';
import type { BookmarkSummary } from '@docx-editor.dev/core/contracts/editor';
import type { TranslationKey } from '@docx-editor.dev/i18n';
import { useTranslation } from '../i18n';
import { useBookmarks } from './useBookmarks';

/** Props for `DocxEditor.BookmarkDialog`. @public */
export interface DocxEditorBookmarkDialogProps extends DialogCustomizationProps {
  /** Whether the dialog is shown. The host owns this state. */
  open: boolean;
  /** Called on Cancel, Escape, overlay click, and after a successful Add. */
  onClose: () => void;
}

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
  readonly rows: readonly BookmarkSummary[];
  /** Whether Delete and Go To can act on the typed name. */
  readonly canDelete: boolean;
  readonly canGoTo: boolean;
  remove(): void;
  goTo(): void;
}

const PROBLEM_KEYS = {
  empty: 'dialogs.bookmark.nameEmpty',
  tooLong: 'dialogs.bookmark.nameTooLong',
  invalidStart: 'dialogs.bookmark.nameInvalidStart',
  invalidCharacter: 'dialogs.bookmark.nameInvalidCharacter',
} as const satisfies Record<string, TranslationKey>;

function BookmarkDialogRoot({
  open,
  onClose,
  className,
  style,
  children,
  preset = true,
}: DocxEditorBookmarkDialogProps): ReactElement | null {
  const { t } = useTranslation();
  const validDocument = useDialogDocument(open, onClose);
  const { bookmarks, isWritable, insert, remove, goTo } = useBookmarks();
  const bookmarksRef = useRef(bookmarks);
  bookmarksRef.current = bookmarks;
  const [name, setName] = useState('');
  const [sortBy, setSortBy] = useState<BookmarkSortOrder>('name');
  const [showHidden, setShowHidden] = useState(false);
  const [refused, setRefused] = useState(false);
  const [attempted, setAttempted] = useState(false);
  // After Go To the dialog has done something, so its dismiss button reads Close.
  const [visited, setVisited] = useState(false);
  const panelRef = useRef<HTMLDialogElement | null>(null);
  const nameId = useId();
  const messageId = useId();

  useEffect(() => {
    if (!open) return;
    // Opened inside a bookmark, the dialog names it, ready for Go To or Delete.
    setName(bookmarkDialogInitialName(bookmarksRef.current));
    setRefused(false);
    setAttempted(false);
    setVisited(false);
  }, [open]);

  const rows = bookmarkDialogRows(bookmarks, { sortBy, showHidden });
  const nameState = bookmarkDialogNameState(bookmarks, name, isWritable);
  const problem = nameState.problem && (attempted || name.length > 0) ? nameState.problem : null;
  const message = refused
    ? t('dialogs.bookmark.refused')
    : problem
      ? t(PROBLEM_KEYS[problem])
      : nameState.existing && nameState.canAdd
        ? t('dialogs.bookmark.nameExists')
        : null;

  const handleAdd = useCallback(() => {
    setAttempted(true);
    if (!nameState.canAdd) return;
    if (!validDocument()) {
      onClose();
      return;
    }
    const result = insert(name);
    setRefused(!result.ok);
    if (result.ok) onClose();
  }, [nameState.canAdd, validDocument, insert, name, onClose]);

  const handleRemove = useCallback(() => {
    if (!nameState.canDelete || !nameState.existing) return;
    const result = remove(nameState.existing.name);
    setRefused(!result.ok);
    if (result.ok) setName('');
  }, [nameState, remove]);

  const handleGoTo = useCallback(() => {
    if (!nameState.canGoTo || !nameState.existing) return;
    const result = goTo(nameState.existing.name);
    setRefused(!result.ok);
    if (result.ok) setVisited(true);
  }, [nameState, goTo]);

  if (!open) return null;

  const selected = nameState.existing?.name ?? '';
  const state: UseBookmarkDialogReturn = {
    values: { name, sortBy, showHidden },
    setValue(field, value) {
      if (field === 'name') setName(value as string);
      else if (field === 'sortBy') setSortBy(value as BookmarkSortOrder);
      else setShowHidden(value as boolean);
      setRefused(false);
    },
    errors: problem
      ? { name: t(PROBLEM_KEYS[problem]) }
      : refused
        ? { form: t('dialogs.bookmark.refused') }
        : {},
    isEnabled: nameState.canAdd,
    apply: handleAdd,
    cancel: onClose,
    rows,
    canDelete: nameState.canDelete,
    canGoTo: nameState.canGoTo,
    remove: handleRemove,
    goTo: handleGoTo,
  };
  return (
    <DialogFrame
      kind="bookmark"
      className={className}
      style={style}
      panelRef={panelRef}
      label={t('dialogs.bookmark.title')}
      onClose={onClose}
      onKeyDown={(event) => {
        if (
          event.key === 'Enter' &&
          isHTMLElementNode(event.target) &&
          event.target.localName === 'input' &&
          event.target.getAttribute('type') === 'text'
        ) {
          event.preventDefault();
          handleAdd();
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
                {t('dialogs.bookmark.title')}
              </span>
            </div>

            <div data-docx-part="body" className="docx-dialog__body">
              <div data-docx-part="field" data-docx-field="name" className="docx-dialog__row">
                <label className="docx-dialog__label" htmlFor={nameId}>
                  {t('dialogs.bookmark.name')}
                </label>
                <input
                  id={nameId}
                  type="text"
                  className="docx-dialog__input"
                  value={name}
                  maxLength={40}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={problem ? true : undefined}
                  aria-describedby={messageId}
                  onChange={(event) => state.setValue('name', event.target.value)}
                />
              </div>

              <div data-docx-part="field" data-docx-field="list" className="docx-dialog__row">
                <select
                  className="docx-dialog__input docx-dialog__input--full docx-bookmark-dialog__list"
                  size={8}
                  value={selected}
                  aria-label={t('dialogs.bookmark.list')}
                  onChange={(event) => state.setValue('name', event.target.value)}
                  onDoubleClick={handleGoTo}
                >
                  {rows.map((row) => (
                    <option key={row.name} value={row.name}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </div>
              {rows.length === 0 ? (
                <div className="docx-dialog__hint">{t('dialogs.bookmark.empty')}</div>
              ) : null}

              <div
                data-docx-part="field"
                data-docx-field="sortBy"
                className="docx-dialog__row"
                role="radiogroup"
                aria-label={t('dialogs.bookmark.sortBy')}
              >
                <span className="docx-dialog__label">{t('dialogs.bookmark.sortBy')}</span>
                {(['name', 'location'] as const).map((order) => (
                  <label key={order} className="docx-dialog__checkbox-row">
                    <input
                      type="radio"
                      name="docx-bookmark-sort"
                      checked={sortBy === order}
                      onChange={() => state.setValue('sortBy', order)}
                    />
                    {t(
                      order === 'name'
                        ? 'dialogs.bookmark.sortName'
                        : 'dialogs.bookmark.sortLocation'
                    )}
                  </label>
                ))}
              </div>

              <div data-docx-part="field" data-docx-field="showHidden" className="docx-dialog__row">
                <label className="docx-dialog__checkbox-row">
                  <input
                    type="checkbox"
                    checked={showHidden}
                    onChange={(event) => state.setValue('showHidden', event.target.checked)}
                  />
                  {t('dialogs.bookmark.showHidden')}
                </label>
              </div>
            </div>

            <div data-docx-part="footer" className="docx-dialog__footer">
              <span
                id={messageId}
                data-docx-part="error"
                role="status"
                className="docx-dialog__error"
              >
                {message}
              </span>
              <button
                type="button"
                className="docx-dialog__button docx-dialog__apply"
                data-docx-part="apply"
                disabled={!nameState.canAdd}
                onClick={handleAdd}
              >
                {t('dialogs.bookmark.add')}
              </button>
              <button
                type="button"
                className="docx-dialog__button"
                data-docx-part="delete"
                disabled={!nameState.canDelete}
                onClick={handleRemove}
              >
                {t('dialogs.bookmark.delete')}
              </button>
              <button
                type="button"
                className="docx-dialog__button"
                data-docx-part="goto"
                disabled={!nameState.canGoTo}
                onClick={handleGoTo}
              >
                {t('dialogs.bookmark.goTo')}
              </button>
              <button
                type="button"
                className="docx-dialog__button"
                data-docx-part="cancel"
                onClick={onClose}
              >
                {t(visited ? 'common.close' : 'common.cancel')}
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

const parts = createDialogParts<
  'name' | 'list' | 'sortBy' | 'showHidden',
  UseBookmarkDialogReturn
>();

/** Read the enclosing Bookmark dialog draft. @public */
export function useBookmarkDialog(): UseBookmarkDialogReturn {
  return parts.useState();
}

type PartComponent = (props: DialogPartProps) => ReactNode;

/** The Bookmark dialog with replaceable controls and layout. @public */
export const DocxEditorBookmarkDialog = Object.assign(BookmarkDialogRoot, {
  Header: parts.Header,
  Title: parts.Title,
  Body: parts.Body,
  Footer: parts.Footer,
  /** Add: bookmark the selection under the typed name. */
  Apply: parts.Apply,
  Cancel: parts.Cancel,
  Error: parts.Error,
  Field: parts.Field,
  Delete: parts.part('delete') as PartComponent,
  GoTo: parts.part('goto') as PartComponent,
});
