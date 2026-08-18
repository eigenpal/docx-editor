import { computed, defineComponent, ref, type CSSProperties, type PropType } from 'vue';
import type { TextMatch } from '@docx-editor.dev/core/contracts/editor';
import { MaterialSymbol } from '../../components/ui/Icons';
import { selectDocumentAbsent } from '../document-presence';
import { useEditorState } from '../useEditorState';
import { useNavigationContext } from './navigation-context';
import type { NavigationTab as NavigationTabId } from './useNavigationPane';

/** Shared props for the pane's structural parts. @public */
export interface NavigationPartProps {
  className?: string;
  style?: CSSProperties;
  children?: import('vue').VNode;
}

/** @public */
export interface NavigationTabProps extends NavigationPartProps {
  value: NavigationTabId;
}

const TABS: NavigationTabId[] = ['headings', 'find'];

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

/** @public */
export const NavigationHeader = defineComponent({
  name: 'NavigationHeader',
  props: {
    className: { type: String, default: undefined },
    style: { type: Object as PropType<CSSProperties>, default: undefined },
  },
  setup(props, { slots }) {
    return () => (
      <div class={cx('docx-nav__header', props.className)} style={props.style}>
        {slots.default?.() ?? (
          <>
            <NavigationClose />
            <NavigationTitle />
          </>
        )}
      </div>
    );
  },
});

/** @public */
export const NavigationClose = defineComponent({
  name: 'NavigationClose',
  props: {
    className: { type: String, default: undefined },
    style: { type: Object as PropType<CSSProperties>, default: undefined },
  },
  setup(props, { slots }) {
    const { pane, t } = useNavigationContext('Close');
    return () => (
      <button
        type="button"
        class={cx('docx-nav__close', props.className)}
        style={props.style}
        aria-label={t('navigation.closeAriaLabel')}
        title={t('navigation.closeTitle')}
        onClick={() => pane.setOpen(false)}
      >
        {slots.default?.() ?? <MaterialSymbol name="arrow_back" size={20} />}
      </button>
    );
  },
});

/** @public */
export const NavigationTitle = defineComponent({
  name: 'NavigationTitle',
  props: {
    className: { type: String, default: undefined },
    style: { type: Object as PropType<CSSProperties>, default: undefined },
  },
  setup(props, { slots }) {
    const { t } = useNavigationContext('Title');
    return () => (
      <h2 class={cx('docx-nav__title', props.className)} style={props.style}>
        {slots.default?.() ?? t('navigation.title')}
      </h2>
    );
  },
});

/** @public */
export const NavigationTabs = defineComponent({
  name: 'NavigationTabs',
  props: {
    className: { type: String, default: undefined },
    style: { type: Object as PropType<CSSProperties>, default: undefined },
  },
  setup(props, { slots }) {
    const { pane, t } = useNavigationContext('Tabs');
    const onKeyDown = (event: KeyboardEvent) => {
      const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (delta === 0) return;
      event.preventDefault();
      const index = TABS.indexOf(pane.tab.value);
      pane.setTab(TABS[(index + delta + TABS.length) % TABS.length]!);
    };
    return () => (
      <div
        class={cx('docx-nav__tabs', props.className)}
        style={props.style}
        role="tablist"
        aria-label={t('navigation.title')}
        onKeydown={onKeyDown}
      >
        {slots.default?.() ?? TABS.map((value) => <NavigationTab key={value} value={value} />)}
      </div>
    );
  },
});

/** @public */
export const NavigationTab = defineComponent({
  name: 'NavigationTab',
  props: {
    value: { type: String as PropType<NavigationTabId>, required: true },
    className: { type: String, default: undefined },
    style: { type: Object as PropType<CSSProperties>, default: undefined },
  },
  setup(props, { slots }) {
    const { pane, t } = useNavigationContext('Tab');
    return () => {
      const selected = pane.tab.value === props.value;
      return (
        <button
          type="button"
          role="tab"
          id={`docx-nav-tab-${props.value}`}
          aria-selected={selected}
          aria-controls={`docx-nav-panel-${props.value}`}
          tabindex={selected ? 0 : -1}
          class={cx('docx-nav__tab', selected && 'docx-nav__tab--selected', props.className)}
          style={props.style}
          onClick={() => pane.setTab(props.value)}
        >
          {slots.default?.() ?? t(`navigation.tabs.${props.value}`)}
        </button>
      );
    };
  },
});

const SearchBox = defineComponent({
  name: 'SearchBox',
  props: {
    value: { type: String, required: true },
    onChange: { type: Function as PropType<(next: string) => void>, required: true },
    onClear: { type: Function as PropType<() => void>, required: true },
    placeholder: { type: String, required: true },
    label: { type: String, required: true },
    clearLabel: { type: String, required: true },
    autoFocus: { type: Boolean, default: undefined },
  },
  setup(props) {
    return () => (
      <div class="docx-nav__searchbox">
        <MaterialSymbol name="search" size={18} className="docx-nav__search-icon" />
        <input
          type="search"
          class="docx-nav__search-input"
          value={props.value}
          placeholder={props.placeholder}
          aria-label={props.label}
          autofocus={props.autoFocus}
          onInput={(event) => props.onChange((event.target as HTMLInputElement).value)}
        />
        {props.value.length > 0 && (
          <button
            type="button"
            class="docx-nav__search-clear"
            aria-label={props.clearLabel}
            onClick={props.onClear}
          >
            <MaterialSymbol name="close" size={16} />
          </button>
        )}
      </div>
    );
  },
});

/** @public */
export const NavigationHeadings = defineComponent({
  name: 'NavigationHeadings',
  props: {
    className: { type: String, default: undefined },
    style: { type: Object as PropType<CSSProperties>, default: undefined },
  },
  setup(props) {
    const { pane, outline, t } = useNavigationContext('Headings');
    const filter = ref('');
    const documentAbsent = useEditorState(selectDocumentAbsent);
    const items = computed(() => {
      const needle = filter.value.trim().toLowerCase();
      if (needle.length === 0) return outline.items.value;
      return outline.items.value.filter((item) => item.heading.text.toLowerCase().includes(needle));
    });
    return () => {
      const hidden = pane.tab.value !== 'headings';
      return (
        <div
          class={cx('docx-nav__panel', props.className)}
          style={props.style}
          role="tabpanel"
          id="docx-nav-panel-headings"
          aria-labelledby="docx-nav-tab-headings"
          hidden={hidden}
        >
          <SearchBox
            value={filter.value}
            onChange={(next) => {
              filter.value = next;
            }}
            onClear={() => {
              filter.value = '';
            }}
            placeholder={t('navigation.find.placeholder')}
            label={t('navigation.find.inputAriaLabel')}
            clearLabel={t('navigation.find.clearAriaLabel')}
          />
          {documentAbsent.value ? null : outline.isEmpty.value ? (
            <p class="docx-nav__empty">{t('navigation.headings.noHeadings')}</p>
          ) : items.value.length === 0 ? (
            <p class="docx-nav__empty">{t('navigation.find.noResults')}</p>
          ) : (
            <ul class="docx-nav__list">
              {items.value.map((item, index) => (
                <li key={`${item.heading.blockId}-${index}`}>
                  <button
                    type="button"
                    class={cx(
                      'docx-nav__heading',
                      outline.selectedBlockId.value === item.heading.blockId &&
                        'docx-nav__heading--current'
                    )}
                    style={{ paddingInlineStart: `${8 + item.depth * 14}px` }}
                    title={item.heading.text}
                    onClick={() => outline.goTo(item.heading.blockId)}
                  >
                    {item.heading.text}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    };
  },
});

const ResultRow = defineComponent({
  name: 'ResultRow',
  props: {
    match: { type: Object as PropType<TextMatch>, required: true },
    active: { type: Boolean, required: true },
    onSelect: { type: Function as PropType<() => void>, required: true },
  },
  setup(props) {
    return () => (
      <li>
        <button
          type="button"
          class={cx('docx-nav__result', props.active && 'docx-nav__result--active')}
          aria-current={props.active ? 'true' : undefined}
          onClick={props.onSelect}
        >
          <span class="docx-nav__result-text">
            {props.match.contextBefore}
            <mark class="docx-nav__result-hit">{props.match.text}</mark>
            {props.match.contextAfter}
          </span>
        </button>
      </li>
    );
  },
});

/** @public */
export const NavigationFind = defineComponent({
  name: 'NavigationFind',
  props: {
    className: { type: String, default: undefined },
    style: { type: Object as PropType<CSSProperties>, default: undefined },
  },
  setup(props) {
    const { pane, search, t } = useNavigationContext('Find');
    return () => {
      const hidden = pane.tab.value !== 'find';
      const hasQuery = search.query.value.trim().length > 0;
      const counter =
        search.matches.value.length === 0
          ? null
          : search.activeIndex.value < 0
            ? t(
                search.truncated.value ? 'navigation.find.totalTruncated' : 'navigation.find.total',
                {
                  total: search.matches.value.length,
                }
              )
            : t(
                search.truncated.value
                  ? 'navigation.find.counterTruncated'
                  : 'navigation.find.counter',
                {
                  current: search.activeIndex.value + 1,
                  total: search.matches.value.length,
                }
              );
      return (
        <div
          class={cx('docx-nav__panel', props.className)}
          style={props.style}
          role="tabpanel"
          id="docx-nav-panel-find"
          aria-labelledby="docx-nav-tab-find"
          hidden={hidden}
        >
          <SearchBox
            value={search.query.value}
            onChange={search.setQuery}
            onClear={search.clear}
            placeholder={t('navigation.find.placeholder')}
            label={t('navigation.find.inputAriaLabel')}
            clearLabel={t('navigation.find.clearAriaLabel')}
          />
          <div
            class="docx-nav__options"
            role="group"
            aria-label={t('navigation.find.optionsAriaLabel')}
          >
            <label class="docx-nav__option">
              <input
                type="checkbox"
                checked={search.matchCase.value}
                onChange={(event) =>
                  search.setMatchCase((event.target as HTMLInputElement).checked)
                }
              />
              {t('navigation.find.matchCase')}
            </label>
            <label class="docx-nav__option">
              <input
                type="checkbox"
                checked={search.wholeWord.value}
                onChange={(event) =>
                  search.setWholeWord((event.target as HTMLInputElement).checked)
                }
              />
              {t('navigation.find.wholeWord')}
            </label>
          </div>
          <div class="docx-nav__resultbar">
            <span class="docx-nav__count" aria-live="polite">
              {!hasQuery
                ? ''
                : search.isPending.value
                  ? t('navigation.find.searching')
                  : (counter ?? t('navigation.find.noResults'))}
            </span>
            <span class="docx-nav__steppers">
              <button
                type="button"
                class="docx-nav__stepper"
                aria-label={t('navigation.find.previousAriaLabel')}
                disabled={search.matches.value.length === 0}
                onClick={search.previous}
              >
                <MaterialSymbol name="keyboard_arrow_up" size={18} />
              </button>
              <button
                type="button"
                class="docx-nav__stepper"
                aria-label={t('navigation.find.nextAriaLabel')}
                disabled={search.matches.value.length === 0}
                onClick={search.next}
              >
                <MaterialSymbol name="keyboard_arrow_down" size={18} />
              </button>
            </span>
          </div>
          {search.matches.value.length > 0 && (
            <ul class="docx-nav__list" aria-label={t('navigation.find.resultsAriaLabel')}>
              {search.matches.value.map((match, index) => (
                <ResultRow
                  key={`${match.blockId}-${match.start}-${index}`}
                  match={match}
                  active={index === search.activeIndex.value}
                  onSelect={() => search.goTo(index)}
                />
              ))}
            </ul>
          )}
        </div>
      );
    };
  },
});

/** @public */
export const NavigationToggle = defineComponent({
  name: 'NavigationToggle',
  props: {
    className: { type: String, default: undefined },
    style: { type: Object as PropType<CSSProperties>, default: undefined },
  },
  setup(props, { slots }) {
    const { pane, t } = useNavigationContext('Toggle');
    return () => (
      <button
        type="button"
        class={cx('docx-nav__toggle', props.className)}
        style={props.style}
        aria-label={t('navigation.openAriaLabel')}
        aria-expanded={pane.open.value}
        title={t('navigation.openTitle')}
        onMousedown={(event) => event.preventDefault()}
        onClick={pane.toggle}
      >
        {slots.default?.() ?? <MaterialSymbol name="toc" size={20} />}
      </button>
    );
  },
});
