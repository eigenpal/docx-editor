// The Go to tab of the navigation pane: `DocxEditor.Navigation.GoTo`. The Vue twin of the
// React part.
//
// A name box that is a combobox over the document's bookmarks. Typing filters the list, the
// arrow keys move through it, and Enter or Go to jumps: the bookmark's text is selected in
// whichever story holds it, scrolled into view, and the document takes focus so typing goes
// on there. A name no bookmark has says so in the pane rather than in a dialog. Escape closes
// the pane, the same as on the other tabs.
//
// Bookmark names come from the file. They go into text content only, never into markup.

import { defineComponent, useId, type CSSProperties, type PropType } from 'vue';
import type { BookmarkPlace } from '@docx-editor.dev/core/contracts/editor';
import { MaterialSymbol } from '../../components/ui/Icons';
import { selectDocumentAbsent } from '../document-presence';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import { useLiveNavigationContext } from './navigation-context';
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
export const NavigationGoTo = defineComponent({
  name: 'NavigationGoTo',
  props: {
    className: { type: String, default: undefined },
    style: { type: Object as PropType<CSSProperties>, default: undefined },
  },
  setup(props) {
    // Live: `t` and the intents follow the pane's props without a remount.
    const nav = useLiveNavigationContext('GoTo');
    const t = (key: string, params?: Record<string, string | number>) => nav.t(key, params);
    const editorRef = useDocxEditor();
    // The document's bookmarks are read only while this tab is on screen.
    const goTo = useGoToBookmark({
      enabled: () => nav.pane.open.value && nav.pane.tab.value === 'goto',
    });
    const documentAbsent = useEditorState(selectDocumentAbsent);
    const listId = useId();
    const optionId = (index: number) => `${listId}-option-${index}`;

    const jump = (name?: string) => {
      if (!goTo.go(name).ok) return;
      // An overlaying pane closes on a pick; either way the document takes focus, so typing
      // goes on at the bookmark.
      nav.intents.picked();
      editorRef.value?.focus();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        goTo.move(event.key === 'ArrowDown' ? 1 : -1);
      } else if ((event.key === 'Home' || event.key === 'End') && goTo.activeIndex.value >= 0) {
        // Home and End move the caret in the text until a row is highlighted.
        event.preventDefault();
        goTo.setActiveIndex(event.key === 'Home' ? 0 : goTo.rows.value.length - 1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        jump();
      }
    };

    return () => {
      const rows = goTo.rows.value;
      const activeIndex = goTo.activeIndex.value;
      const message =
        goTo.problem.value === 'notFound'
          ? t('navigation.goTo.notFound', { name: goTo.problemName.value })
          : goTo.problem.value === 'failed'
            ? t('navigation.goTo.failed')
            : goTo.problem.value === 'empty'
              ? t('navigation.goTo.typeName')
              : goTo.bookmarks.value.length === 0
                ? documentAbsent.value
                  ? ''
                  : t('navigation.goTo.empty')
                : rows.length === 0
                  ? t('navigation.goTo.noMatches')
                  : '';
      return (
        <div
          class={cx('docx-nav__panel', props.className)}
          style={props.style}
          role="tabpanel"
          id="docx-nav-panel-goto"
          aria-labelledby="docx-nav-tab-goto"
          hidden={nav.pane.tab.value !== 'goto'}
        >
          <div class="docx-nav__searchbox">
            <MaterialSymbol name="bookmark" size={18} className="docx-nav__search-icon" />
            <input
              type="text"
              role="combobox"
              class="docx-nav__search-input"
              value={goTo.query.value}
              placeholder={t('navigation.goTo.placeholder')}
              aria-label={t('navigation.goTo.label')}
              aria-expanded={rows.length > 0}
              aria-controls={rows.length > 0 ? listId : undefined}
              aria-autocomplete="list"
              aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
              autocomplete="off"
              spellcheck={false}
              onInput={(event: Event) => goTo.setQuery((event.target as HTMLInputElement).value)}
              onKeydown={onKeyDown}
            />
          </div>

          <div class="docx-nav__options" role="group" aria-label={t('dialogs.bookmark.sortBy')}>
            {(['name', 'location'] as const).map((order) => (
              <label key={order} class="docx-nav__option">
                <input
                  type="radio"
                  name={`${listId}-sort`}
                  checked={goTo.sortBy.value === order}
                  onChange={() => goTo.setSortBy(order)}
                />
                {t(
                  order === 'name' ? 'dialogs.bookmark.sortName' : 'dialogs.bookmark.sortLocation'
                )}
              </label>
            ))}
            <label class="docx-nav__option">
              <input
                type="checkbox"
                checked={goTo.showHidden.value}
                onChange={(event: Event) =>
                  goTo.setShowHidden((event.target as HTMLInputElement).checked)
                }
              />
              {t('dialogs.bookmark.showHidden')}
            </label>
          </div>

          <div class="docx-nav__resultbar">
            <span class="docx-nav__count docx-nav__goto-message" role="status">
              {message}
            </span>
            <button
              type="button"
              class="docx-nav__goto-button"
              disabled={rows.length === 0}
              onClick={() => jump()}
            >
              {t('navigation.goTo.go')}
            </button>
          </div>

          {rows.length > 0 && (
            <ul
              id={listId}
              class="docx-nav__list"
              role="listbox"
              aria-label={t('navigation.goTo.listAriaLabel')}
            >
              {rows.map((row, index) => (
                <li
                  key={row.name}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === activeIndex}
                  class={cx(
                    'docx-nav__result docx-nav__goto-row',
                    index === activeIndex && 'docx-nav__result--active'
                  )}
                  // Keep focus in the name box: a press on a row must not blur it first.
                  onMousedown={(event: MouseEvent) => event.preventDefault()}
                  onClick={() => jump(row.name)}
                >
                  <span class="docx-nav__result-text">{row.name}</span>
                  {row.place !== 'body' && (
                    <span class="docx-nav__goto-place">{t(PLACE_KEYS[row.place])}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    };
  },
});
