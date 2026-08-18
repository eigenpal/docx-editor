import { computed, defineComponent, ref, watch, type CSSProperties, type PropType } from 'vue';
import type { EditorCommand } from '@docx-editor.dev/core/contracts/editor';
import { useTranslation } from '../i18n';
import type { TranslationKey } from '../i18n';
import { Z_INDEX } from '../styles/zIndex';
import { useDocxEditor } from './context';
import { guardToolbarMousedown } from './toolbar/ToolbarButton';
import { inchesToTwips, twipsToInches } from './header-footer-units';
import { useHeaderFooterState, type HeaderFooterState } from './useHeaderFooterState';
import { useScopedChromeAnchor } from './useScopedChromeAnchor';

/** Props for `DocxEditor.HeaderFooterChrome`. @public */
export interface DocxEditorHeaderFooterChromeProps {
  className?: string;
}

function regionLabelKey(
  editing: 'header' | 'footer',
  variant: 'default' | 'first' | 'even' | undefined
): TranslationKey {
  if (variant === 'first') {
    return editing === 'header' ? 'headerFooter.firstPageHeader' : 'headerFooter.firstPageFooter';
  }
  if (variant === 'even') {
    return editing === 'header' ? 'headerFooter.evenPageHeader' : 'headerFooter.evenPageFooter';
  }
  return editing === 'header' ? 'headerFooter.header' : 'headerFooter.footer';
}

const PAGE_FIELDS = [
  { field: 'PAGE', labelKey: 'headerFooter.insertPageNumber' },
  { field: 'NUMPAGES', labelKey: 'headerFooter.insertTotalPages' },
  { field: 'SECTIONPAGES', labelKey: 'headerFooter.insertSectionPages' },
  { field: 'PAGE_X_OF_Y', labelKey: 'headerFooter.insertPageXofY' },
] as const;

function useCommandGate(command: EditorCommand) {
  const editorRef = useDocxEditor();
  return computed(() => {
    if (!editorRef.value) return { enabled: false, reason: 'editor is not ready' };
    const result = editorRef.value.can(command);
    return result.ok
      ? { enabled: true, reason: null }
      : { enabled: false, reason: result.reason ?? null };
  });
}

const OptionsMenu = defineComponent({
  name: 'HeaderFooterOptionsMenu',
  props: {
    state: { type: Object as PropType<HeaderFooterState>, required: true },
    onChromeMousedown: { type: Function as PropType<(event: MouseEvent) => void>, required: true },
  },
  setup(props) {
    const { t } = useTranslation();
    const editorRef = useDocxEditor();
    const open = ref(false);
    const menuRef = ref<HTMLDivElement | null>(null);
    const headerInches = ref('');
    const footerInches = ref('');

    watch(open, (isOpen, _, onCleanup) => {
      if (!isOpen) return;
      const onDocMouseDown = (event: globalThis.MouseEvent) => {
        if (menuRef.value?.contains(event.target as Node)) return;
        open.value = false;
      };
      document.addEventListener('mousedown', onDocMouseDown);
      onCleanup(() => document.removeEventListener('mousedown', onDocMouseDown));
    });

    watch(
      () => [open.value, props.state.headerDistanceTwips, props.state.footerDistanceTwips] as const,
      ([isOpen, headerTwips, footerTwips]) => {
        if (!isOpen) return;
        if (headerTwips === undefined || footerTwips === undefined) return;
        headerInches.value = String(twipsToInches(headerTwips));
        footerInches.value = String(twipsToInches(footerTwips));
      }
    );

    const titlePageCmd = computed(
      (): EditorCommand => ({ type: 'setHeaderFooterOptions', titlePage: !props.state.titlePage })
    );
    const evenOddCmd = computed(
      (): EditorCommand => ({
        type: 'setHeaderFooterOptions',
        evenAndOddHeaders: !props.state.evenAndOddHeaders,
      })
    );
    const linkCmd = computed((): EditorCommand => ({ type: 'linkHeaderFooterToPrevious' }));
    const unlinkCmd = computed((): EditorCommand => ({ type: 'unlinkHeaderFooterFromPrevious' }));
    const removeCmd = computed(
      (): EditorCommand => ({
        type: 'removeHeaderFooter',
        position: props.state.editing!,
      })
    );

    const titlePageGate = useCommandGate(titlePageCmd.value);
    const evenOddGate = useCommandGate(evenOddCmd.value);
    const linkGate = useCommandGate(linkCmd.value);
    const unlinkGate = useCommandGate(unlinkCmd.value);
    const removeGate = useCommandGate(removeCmd.value);

    const applyDistance = (field: 'headerDistanceTwips' | 'footerDistanceTwips', raw: string) => {
      if (!editorRef.value) return;
      const inches = Number.parseFloat(raw);
      if (!Number.isFinite(inches)) return;
      editorRef.value.exec({
        type: 'setHeaderFooterOptions',
        [field]: inchesToTwips(inches),
      });
    };

    return () => (
      <div ref={menuRef} class="docx-hf-chrome__options" onMousedown={props.onChromeMousedown}>
        <button
          type="button"
          class="docx-context-bar__options-trigger"
          aria-expanded={open.value}
          aria-haspopup="menu"
          onClick={() => {
            open.value = !open.value;
          }}
          onMousedown={props.onChromeMousedown}
        >
          {t('headerFooter.options')}
        </button>
        {open.value ? (
          <div
            class="docx-hf-chrome__options-menu"
            role="menu"
            onMousedown={props.onChromeMousedown}
          >
            {PAGE_FIELDS.map((item) => {
              const command: EditorCommand = { type: 'insertPageField', field: item.field };
              const gate = editorRef.value?.can(command);
              return (
                <button
                  key={item.field}
                  type="button"
                  role="menuitem"
                  class="docx-hf-chrome__menu-item"
                  disabled={!gate?.ok}
                  title={gate && !gate.ok ? gate.reason : undefined}
                  onClick={() => {
                    editorRef.value?.exec(command);
                    open.value = false;
                  }}
                  onMousedown={props.onChromeMousedown}
                >
                  {t(item.labelKey)}
                </button>
              );
            })}
            <div class="docx-hf-chrome__menu-separator" role="separator" />
            <label class="docx-hf-chrome__menu-row">
              <input
                type="checkbox"
                checked={props.state.titlePage === true}
                disabled={!titlePageGate.value.enabled}
                title={titlePageGate.value.reason ?? undefined}
                onChange={() => editorRef.value?.exec(titlePageCmd.value)}
              />
              <span>{t('headerFooter.differentFirstPage')}</span>
            </label>
            <label class="docx-hf-chrome__menu-row">
              <input
                type="checkbox"
                checked={props.state.evenAndOddHeaders === true}
                disabled={!evenOddGate.value.enabled}
                title={evenOddGate.value.reason ?? undefined}
                onChange={() => editorRef.value?.exec(evenOddCmd.value)}
              />
              <span>
                {t('headerFooter.differentOddEven')}
                <span class="docx-hf-chrome__menu-hint">
                  {t('headerFooter.differentOddEvenHint')}
                </span>
              </span>
            </label>
            <div class="docx-hf-chrome__menu-separator" role="separator" />
            {props.state.inherited ? (
              <button
                type="button"
                role="menuitem"
                class="docx-hf-chrome__menu-item"
                disabled={!unlinkGate.value.enabled}
                title={unlinkGate.value.reason ?? undefined}
                onClick={() => editorRef.value?.exec(unlinkCmd.value)}
                onMousedown={props.onChromeMousedown}
              >
                {t('headerFooter.unlinkFromPrevious')}
              </button>
            ) : (
              <button
                type="button"
                role="menuitem"
                class="docx-hf-chrome__menu-item"
                disabled={!linkGate.value.enabled}
                title={linkGate.value.reason ?? undefined}
                onClick={() => editorRef.value?.exec(linkCmd.value)}
                onMousedown={props.onChromeMousedown}
              >
                {t('headerFooter.linkToPrevious')}
              </button>
            )}
            <div class="docx-hf-chrome__menu-separator" role="separator" />
            <label class="docx-hf-chrome__menu-row docx-hf-chrome__menu-row--distance">
              <span>{t('headerFooter.headerDistance')}</span>
              <input
                type="number"
                min={0}
                step={0.01}
                aria-label={t('headerFooter.headerDistance')}
                value={headerInches.value}
                onInput={(event) => {
                  headerInches.value = (event.target as HTMLInputElement).value;
                }}
                onBlur={() => applyDistance('headerDistanceTwips', headerInches.value)}
              />
              <span class="docx-hf-chrome__unit">in</span>
            </label>
            <label class="docx-hf-chrome__menu-row docx-hf-chrome__menu-row--distance">
              <span>{t('headerFooter.footerDistance')}</span>
              <input
                type="number"
                min={0}
                step={0.01}
                aria-label={t('headerFooter.footerDistance')}
                value={footerInches.value}
                onInput={(event) => {
                  footerInches.value = (event.target as HTMLInputElement).value;
                }}
                onBlur={() => applyDistance('footerDistanceTwips', footerInches.value)}
              />
              <span class="docx-hf-chrome__unit">in</span>
            </label>
            <div class="docx-hf-chrome__menu-separator" role="separator" />
            <button
              type="button"
              role="menuitem"
              class="docx-hf-chrome__menu-item"
              disabled={!removeGate.value.enabled}
              title={removeGate.value.reason ?? undefined}
              onClick={() => editorRef.value?.exec(removeCmd.value)}
              onMousedown={props.onChromeMousedown}
            >
              {props.state.editing === 'header'
                ? t('headerFooter.removeHeader')
                : t('headerFooter.removeFooter')}
            </button>
            <div class="docx-hf-chrome__menu-separator" role="separator" />
            <button
              type="button"
              role="menuitem"
              class="docx-hf-chrome__menu-item"
              data-testid="docx-hf-close"
              onClick={() => {
                editorRef.value?.exec({ type: 'exitHeaderFooter' });
                open.value = false;
              }}
              onMousedown={props.onChromeMousedown}
            >
              {t('common.close')}
            </button>
          </div>
        ) : null}
      </div>
    );
  },
});

/**
 * Thin overlay while a header or footer scope is open: region label and contextual options.
 *
 * @public
 */
export const DocxEditorHeaderFooterChrome = defineComponent({
  name: 'DocxEditorHeaderFooterChrome',
  props: {
    className: { type: String, default: undefined },
  },
  setup(props) {
    const { t } = useTranslation();
    const state = useHeaderFooterState();
    const findActiveFurniture = (viewport: HTMLElement) =>
      viewport.querySelector<HTMLElement>('[data-docx-hf-active]');
    const anchor = useScopedChromeAnchor(findActiveFurniture, 'story-label');
    const onChromeMouseDown = guardToolbarMousedown;

    return () => {
      if (!state.value?.editing) return null;
      const regionKey = regionLabelKey(state.value.editing, state.value.variant);
      return (
        <div
          ref={anchor.ref as never}
          class={`docx-context-bar docx-hf-chrome${props.className ? ` ${props.className}` : ''}`}
          role="region"
          aria-label={t('headerFooter.chromeAriaLabel')}
          data-testid="docx-hf-chrome"
          onMousedown={onChromeMouseDown}
          style={{ ...anchor.style.value, zIndex: Z_INDEX.hfInlineEditor } as CSSProperties}
        >
          <div class="docx-context-bar__label">
            <span class="docx-context-bar__title">{t(regionKey)}</span>
            {state.value.inherited ? (
              <span
                class="docx-context-bar__status"
                data-testid="docx-hf-inherited"
                title={t('headerFooter.sameAsPreviousHint')}
              >
                {t('headerFooter.sameAsPrevious')}
              </span>
            ) : null}
          </div>
          <OptionsMenu state={state.value} onChromeMousedown={onChromeMouseDown} />
        </div>
      );
    };
  },
});
