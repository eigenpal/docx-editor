// The Go to tab of the navigation pane: `DocxEditor.Navigation.GoTo`.
//
// A name box that is a combobox over the document's bookmarks. Typing filters the list, the
// arrow keys move through it, and Enter or Go to jumps: the bookmark's text is selected in
// whichever story holds it, scrolled into view, and the document takes focus so typing goes
// on there. A name no bookmark has says so in the pane rather than in a dialog. Escape closes
// the pane, the same as on the other tabs.
//
// Bookmark names come from the file. They go into `textContent` only, never into markup.

import { useId } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';
import type { BookmarkPlace } from '@docx-editor.dev/core/contracts/editor';
import { MaterialSymbol } from '../../components/ui/Icons';
import { selectDocumentAbsent } from '../document-presence';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import { useNavigationContext } from './navigation-context';
import type { NavigationPartProps } from './parts';
import { useGoToBookmark } from './useGoToBookmark';

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

/** The label key for a place that is not the main text. */
const PLACE_KEYS: Record<Exclude<BookmarkPlace, 'body'>, string> = {
  header: 'navigation.goTo.places.header',
  footer: 'navigation.goTo.places.footer',
  footnote: 'navigation.goTo.places.footnote',
  endnote: 'navigation.goTo.places.endnote',
};

/**
 * The Go to panel: a bookmark name box with the bookmarks it offers, the sort order, the
 * hidden-bookmarks toggle, and the Go to button.
 *
 * @public
 */
export function NavigationGoTo({ className, style }: NavigationPartProps): ReactElement {
  const { pane, intents, t } = useNavigationContext('GoTo');
  const editor = useDocxEditor();
  const goTo = useGoToBookmark();
  const documentAbsent = useEditorState(selectDocumentAbsent);
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;
  const hidden = pane.tab !== 'goto';

  const jump = (name?: string) => {
    if (!goTo.go(name).ok) return;
    // An overlaying pane closes on a pick; either way the document takes focus, so typing
    // goes on at the bookmark.
    intents.picked();
    editor?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      goTo.move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      jump();
    }
  };

  const message =
    goTo.problem === 'notFound'
      ? t('navigation.goTo.notFound', { name: goTo.query.trim() })
      : goTo.bookmarks.length === 0
        ? documentAbsent
          ? ''
          : t('navigation.goTo.empty')
        : goTo.rows.length === 0
          ? t('navigation.goTo.noMatches')
          : '';
  const active = goTo.activeIndex >= 0 ? optionId(goTo.activeIndex) : undefined;

  return (
    <div
      className={cx('docx-nav__panel', className)}
      style={style}
      role="tabpanel"
      id="docx-nav-panel-goto"
      aria-labelledby="docx-nav-tab-goto"
      hidden={hidden}
    >
      <div className="docx-nav__searchbox">
        <MaterialSymbol name="bookmark" size={18} className="docx-nav__search-icon" />
        <input
          type="text"
          role="combobox"
          className="docx-nav__search-input"
          value={goTo.query}
          placeholder={t('navigation.goTo.placeholder')}
          aria-label={t('navigation.goTo.label')}
          aria-expanded={goTo.rows.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => goTo.setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>

      <div className="docx-nav__options" role="group" aria-label={t('dialogs.bookmark.sortBy')}>
        {(['name', 'location'] as const).map((order) => (
          <label key={order} className="docx-nav__option">
            <input
              type="radio"
              name={`${listId}-sort`}
              checked={goTo.sortBy === order}
              onChange={() => goTo.setSortBy(order)}
            />
            {t(order === 'name' ? 'dialogs.bookmark.sortName' : 'dialogs.bookmark.sortLocation')}
          </label>
        ))}
        <label className="docx-nav__option">
          <input
            type="checkbox"
            checked={goTo.showHidden}
            onChange={(event) => goTo.setShowHidden(event.target.checked)}
          />
          {t('dialogs.bookmark.showHidden')}
        </label>
      </div>

      <div className="docx-nav__resultbar">
        <span className="docx-nav__count docx-nav__goto-message" role="status">
          {message}
        </span>
        <button
          type="button"
          className="docx-nav__goto-button"
          disabled={goTo.bookmarks.length === 0}
          onClick={() => jump()}
        >
          {t('navigation.goTo.go')}
        </button>
      </div>

      {goTo.rows.length > 0 && (
        <ul
          id={listId}
          className="docx-nav__list"
          role="listbox"
          aria-label={t('navigation.goTo.listAriaLabel')}
        >
          {goTo.rows.map((row, index) => (
            <li
              key={row.name}
              id={optionId(index)}
              role="option"
              aria-selected={index === goTo.activeIndex}
              className={cx(
                'docx-nav__result docx-nav__goto-row',
                index === goTo.activeIndex && 'docx-nav__result--active'
              )}
              // Keep focus in the name box: a press on a row must not blur it first.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => goTo.setActiveIndex(index)}
              onClick={() => jump(row.name)}
            >
              <span className="docx-nav__result-text">{row.name}</span>
              {row.place !== 'body' && (
                <span className="docx-nav__goto-place">{t(PLACE_KEYS[row.place])}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
