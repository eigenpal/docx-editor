// The Bookmarks tab of the navigation pane: `DocxEditor.Navigation.GoTo`. The Vue twin of the
// React part.
//
// A search box that is a combobox over the document's bookmarks. Typing filters the list, the
// arrow keys move through it, and Enter or a click jumps: the bookmark's text is selected in
// whichever story holds it, scrolled into view, and the document takes focus so typing goes
// on there. A name no bookmark has says so in the pane rather than in a dialog. Escape clears
// the search first; with nothing typed it closes the pane, the same as on the other tabs.
//
// Nothing here moves on the keyboard: no list animation, no transition on the active row.
//
// Bookmark names come from the file. They go into text content only, never into markup.

import { defineComponent, shallowRef, useId, watch, type CSSProperties, type PropType } from 'vue';
import { scopeDispose } from '../scope-dispose';
import type { BookmarkPlace, BookmarkSummary } from '@docx-editor.dev/core/contracts/editor';
import { goToBookmarkGroups, goToBookmarkMatch } from '@docx-editor.dev/core/editor';
import { MaterialSymbol } from '../../components/ui/Icons';
import { selectDocumentAbsent } from '../document-presence';
import { useDocxEditor } from '../context';
import { useEditorCommand } from '../useEditorCommand';
import { useEditorState } from '../useEditorState';
import { useLiveNavigationContext } from './navigation-context';
import { useGoToBookmark } from './useGoToBookmark';

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

/** The tag for a place that is not the main text, on a row of the list sorted by name. */
const PLACE_KEYS: Record<Exclude<BookmarkPlace, 'body'>, string> = {
  header: 'navigation.goTo.places.header',
  footer: 'navigation.goTo.places.footer',
  footnote: 'navigation.goTo.places.footnote',
  endnote: 'navigation.goTo.places.endnote',
};

/** The section heading for each place, on the list sorted by location. */
const GROUP_KEYS: Record<BookmarkPlace, string> = {
  body: 'navigation.goTo.groups.body',
  header: 'navigation.goTo.groups.header',
  footer: 'navigation.goTo.groups.footer',
  footnote: 'navigation.goTo.groups.footnote',
  endnote: 'navigation.goTo.groups.endnote',
};

/** A thin I-beam: the icon of a bookmark that marks a point, not a range of text. */
const pointIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path
      d="M5.5 2.5h5M5.5 13.5h5M8 2.5v11"
      fill="none"
      stroke="currentColor"
      stroke-width="1.25"
      stroke-linecap="round"
    />
  </svg>
);

/** The name, with the part the search matched in medium weight. */
const matchedName = (name: string, query: string) => {
  const match = goToBookmarkMatch(name, query);
  if (!match) return name;
  return [
    name.slice(0, match.start),
    <span class="docx-nav__goto-match">{name.slice(match.start, match.end)}</span>,
    name.slice(match.end),
  ];
};

/**
 * The Bookmarks panel: a bookmark search box, the sort order and hidden-bookmarks toggle, and
 * the bookmarks it offers, grouped by place when sorted by location.
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
    const goTo = useGoToBookmark(() => ({
      enabled: nav.pane.open.value && nav.pane.tab.value === 'goto',
    }));
    const addBookmark = useEditorCommand('insert.bookmark');
    const documentAbsent = useEditorState(selectDocumentAbsent);
    const baseId = useId();
    const listId = `${baseId}-list`;
    const labelId = `${baseId}-label`;
    const hintId = `${baseId}-hint`;
    const optionId = (index: number) => `${baseId}-option-${index}`;
    // The arrow keys move the highlight; keep that row in view in a long list.
    const listRef = shallowRef<HTMLUListElement | null>(null);
    scopeDispose(
      watch(
        goTo.activeIndex,
        (index) => {
          if (index < 0) return;
          const row = listRef.value?.querySelector<HTMLElement>(`[id="${optionId(index)}"]`);
          row?.scrollIntoView?.({ block: 'nearest' });
        },
        { flush: 'post' }
      )
    );

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
      } else if (event.key === 'Escape' && goTo.query.value.length > 0) {
        // The first Escape clears the search; the pane's own Escape handling sees it prevented.
        event.preventDefault();
        goTo.setQuery('');
      }
    };

    return () => {
      const rows = goTo.rows.value;
      const activeIndex = goTo.activeIndex.value;
      const query = goTo.query.value;
      const byLocation = goTo.sortBy.value === 'location';
      const noBookmarks = goTo.bookmarks.value.length === 0;
      const message =
        goTo.problem.value === 'notFound'
          ? t('navigation.goTo.notFound', { name: goTo.problemName.value })
          : goTo.problem.value === 'failed'
            ? t('navigation.goTo.failed')
            : goTo.problem.value === 'empty'
              ? t('navigation.goTo.typeName')
              : !noBookmarks && rows.length === 0
                ? t('navigation.goTo.noMatches')
                : '';

      const renderRow = (row: BookmarkSummary, index: number) => {
        const isActive = index === activeIndex;
        return (
          <li
            key={row.name}
            id={optionId(index)}
            role="option"
            aria-selected={isActive}
            class={cx('docx-nav__goto-row', isActive && 'docx-nav__goto-row--active')}
            data-point={row.empty || undefined}
            // Keep focus in the search box: a press on a row must not blur it first.
            onMousedown={(event: MouseEvent) => event.preventDefault()}
            onClick={() => jump(row.name)}
          >
            <span class="docx-nav__goto-icon" aria-hidden="true">
              {row.empty ? pointIcon() : <MaterialSymbol name="bookmark" size={16} />}
            </span>
            <span class="docx-nav__result-text">
              <bdi>{matchedName(row.name, query)}</bdi>
            </span>
            {row.atSelection && (
              <span class="docx-nav__goto-here" title={t('navigation.goTo.atCaret')}>
                <span class="docx-editor-sr-only">{t('navigation.goTo.atCaret')}</span>
              </span>
            )}
            {!byLocation && row.place !== 'body' && (
              <span class="docx-nav__goto-place">{t(PLACE_KEYS[row.place])}</span>
            )}
          </li>
        );
      };

      return (
        <div
          class={cx('docx-nav__panel docx-nav__panel--goto', props.className)}
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
              value={query}
              placeholder={t('navigation.goTo.placeholder')}
              aria-label={t('navigation.goTo.label')}
              aria-describedby={activeIndex >= 0 ? hintId : undefined}
              aria-expanded={rows.length > 0}
              aria-controls={rows.length > 0 ? listId : undefined}
              aria-autocomplete="list"
              aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
              autocomplete="off"
              spellcheck={false}
              onInput={(event: Event) => goTo.setQuery((event.target as HTMLInputElement).value)}
              onKeydown={onKeyDown}
            />
            {activeIndex >= 0 && (
              <kbd class="docx-nav__goto-enter" aria-hidden="true">
                ↵
              </kbd>
            )}
            <span id={hintId} class="docx-editor-sr-only">
              {t('navigation.goTo.enterHint')}
            </span>
          </div>

          <div class="docx-nav__goto-controls">
            <div
              class="docx-nav__segmented"
              role="radiogroup"
              aria-label={t('dialogs.bookmark.sortBy')}
            >
              {(['name', 'location'] as const).map((order) => (
                <label
                  key={order}
                  class="docx-nav__segment"
                  data-checked={goTo.sortBy.value === order || undefined}
                >
                  <input
                    type="radio"
                    class="docx-nav__segment-input"
                    name={`${baseId}-sort`}
                    checked={goTo.sortBy.value === order}
                    onChange={() => goTo.setSortBy(order)}
                  />
                  {t(
                    order === 'name' ? 'dialogs.bookmark.sortName' : 'dialogs.bookmark.sortLocation'
                  )}
                </label>
              ))}
            </div>
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

          {noBookmarks && !documentAbsent.value && (
            <div class="docx-nav__goto-empty">
              <MaterialSymbol name="bookmark" size={24} className="docx-nav__goto-empty-icon" />
              <p class="docx-nav__goto-empty-title">{t('navigation.goTo.empty')}</p>
              <p class="docx-nav__goto-empty-hint">{t('navigation.goTo.emptyHint')}</p>
              <button
                type="button"
                class="docx-nav__goto-add"
                disabled={!addBookmark.isEnabled.value}
                title={addBookmark.disabledReason.value ?? undefined}
                onClick={() => addBookmark.execute()}
              >
                {t('navigation.goTo.add')}
              </button>
            </div>
          )}

          {!noBookmarks && (
            <div class="docx-nav__goto-heading">
              <span id={labelId}>{t('navigation.goTo.listAriaLabel')}</span>
              <span class="docx-nav__goto-count">
                {query.trim().length > 0
                  ? t('navigation.goTo.countFiltered', {
                      shown: rows.length,
                      total: goTo.bookmarks.value.filter(
                        (row) => goTo.showHidden.value || !row.hidden
                      ).length,
                    })
                  : rows.length}
              </span>
            </div>
          )}

          <p class="docx-nav__goto-message" role="status">
            {message}
          </p>

          {rows.length > 0 && (
            <ul
              ref={listRef}
              id={listId}
              class="docx-nav__list docx-nav__goto-list"
              role="listbox"
              aria-labelledby={labelId}
            >
              {byLocation
                ? goToBookmarkGroups(rows).map((group) => (
                    <li
                      key={group.place}
                      role="group"
                      aria-labelledby={`${baseId}-group-${group.place}`}
                      class="docx-nav__goto-group"
                    >
                      <div id={`${baseId}-group-${group.place}`} class="docx-nav__goto-group-label">
                        {t(GROUP_KEYS[group.place])}
                      </div>
                      <ul role="none" class="docx-nav__goto-sublist">
                        {group.rows.map(({ row, index }) => renderRow(row, index))}
                      </ul>
                    </li>
                  ))
                : rows.map((row, index) => renderRow(row, index))}
            </ul>
          )}
        </div>
      );
    };
  },
});
