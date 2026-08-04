// Header/footer scope chrome — region label, inheritance warning, field inserts, options.
//
// UI-only overlay: no layout records, no canonical nodes. Reads reference-stable engine
// state via `useHeaderFooterState`; every action dispatches through `Editor.exec` or
// `useEditorCommand` (slot → command table). Double-click enter and Escape leave remain
// core-owned.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, ReactElement } from 'react';
import type { EditorCommand } from '@docx-editor.dev/core-contract/contracts/editor';
import { CHROME_GROUPS, chromeSlotId } from '@docx-editor.dev/core-contract/editor';
import { useTranslation } from '../i18n';
import type { TranslationKey } from '../i18n';
import { Z_INDEX } from '../styles/zIndex';
import { useDocxEditor } from './context';
import { guardToolbarMousedown } from './toolbar/ToolbarButton';
import { ToolbarButton } from './toolbar/ToolbarButton';
import { ToolbarContext } from './toolbar/toolbar-context';
import { inchesToTwips, twipsToInches } from './header-footer-units';
import { useHeaderFooterState } from './useHeaderFooterState';

/** Props for `DocxEditor.HeaderFooterChrome`. @public */
export interface DocxEditorHeaderFooterChromeProps {
  className?: string;
}

const INSERT_GROUP = CHROME_GROUPS.find((group) => group.id === 'insert')!;

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

function useCommandGate(command: EditorCommand): { enabled: boolean; reason: string | null } {
  const editor = useDocxEditor();
  return useMemo(() => {
    if (!editor) return { enabled: false, reason: 'editor is not ready' };
    const result = editor.can(command);
    return result.ok ? { enabled: true, reason: null } : { enabled: false, reason: result.reason };
  }, [editor, command]);
}

function OptionsMenu(props: {
  readonly state: NonNullable<ReturnType<typeof useHeaderFooterState>>;
  readonly onMouseDown: (event: MouseEvent) => void;
}): ReactElement {
  const { state, onMouseDown } = props;
  const { t } = useTranslation();
  const editor = useDocxEditor();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const [headerInches, setHeaderInches] = useState('');
  const [footerInches, setFooterInches] = useState('');

  useEffect(() => {
    if (!open) return;
    if (state.headerDistanceTwips === undefined || state.footerDistanceTwips === undefined) return;
    setHeaderInches(String(twipsToInches(state.headerDistanceTwips)));
    setFooterInches(String(twipsToInches(state.footerDistanceTwips)));
  }, [open, state.headerDistanceTwips, state.footerDistanceTwips]);

  useEffect(() => {
    if (!open) return undefined;
    const onDocMouseDown = (event: globalThis.MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  const titlePageCmd = useMemo(
    () => ({ type: 'setHeaderFooterOptions' as const, titlePage: !state.titlePage }),
    [state.titlePage]
  );
  const evenOddCmd = useMemo(
    () => ({
      type: 'setHeaderFooterOptions' as const,
      evenAndOddHeaders: !state.evenAndOddHeaders,
    }),
    [state.evenAndOddHeaders]
  );
  const linkCmd = useMemo(() => ({ type: 'linkHeaderFooterToPrevious' as const }), []);
  const unlinkCmd = useMemo(() => ({ type: 'unlinkHeaderFooterFromPrevious' as const }), []);
  const removeCmd = useMemo(
    () => ({
      type: 'removeHeaderFooter' as const,
      position: state.editing!,
    }),
    [state.editing]
  );

  const titlePageGate = useCommandGate(titlePageCmd);
  const evenOddGate = useCommandGate(evenOddCmd);
  const linkGate = useCommandGate(linkCmd);
  const unlinkGate = useCommandGate(unlinkCmd);
  const removeGate = useCommandGate(removeCmd);

  const applyDistance = (field: 'headerDistanceTwips' | 'footerDistanceTwips', raw: string) => {
    if (!editor) return;
    const inches = Number.parseFloat(raw);
    if (!Number.isFinite(inches)) return;
    editor.exec({
      type: 'setHeaderFooterOptions',
      [field]: inchesToTwips(inches),
    });
  };

  return (
    <div ref={menuRef} className="docx-hf-chrome__options" onMouseDown={onMouseDown}>
      <button
        type="button"
        className="docx-hf-chrome__options-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        onMouseDown={onMouseDown}
      >
        {t('headerFooter.options')}
      </button>
      {open ? (
        <div className="docx-hf-chrome__options-menu" role="menu" onMouseDown={onMouseDown}>
          <label className="docx-hf-chrome__menu-row">
            <input
              type="checkbox"
              checked={state.titlePage === true}
              disabled={!titlePageGate.enabled}
              title={titlePageGate.reason ?? undefined}
              onChange={() => editor?.exec(titlePageCmd)}
            />
            <span>{t('headerFooter.differentFirstPage')}</span>
          </label>
          <label className="docx-hf-chrome__menu-row">
            <input
              type="checkbox"
              checked={state.evenAndOddHeaders === true}
              disabled={!evenOddGate.enabled}
              title={evenOddGate.reason ?? undefined}
              onChange={() => editor?.exec(evenOddCmd)}
            />
            <span>
              {t('headerFooter.differentOddEven')}
              <span className="docx-hf-chrome__menu-hint">
                {t('headerFooter.differentOddEvenHint')}
              </span>
            </span>
          </label>
          <div className="docx-hf-chrome__menu-separator" role="separator" />
          {state.inherited ? (
            <button
              type="button"
              role="menuitem"
              className="docx-hf-chrome__menu-item"
              disabled={!unlinkGate.enabled}
              title={unlinkGate.reason ?? undefined}
              onClick={() => editor?.exec(unlinkCmd)}
              onMouseDown={onMouseDown}
            >
              {t('headerFooter.unlinkFromPrevious')}
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              className="docx-hf-chrome__menu-item"
              disabled={!linkGate.enabled}
              title={linkGate.reason ?? undefined}
              onClick={() => editor?.exec(linkCmd)}
              onMouseDown={onMouseDown}
            >
              {t('headerFooter.linkToPrevious')}
            </button>
          )}
          <div className="docx-hf-chrome__menu-separator" role="separator" />
          <label className="docx-hf-chrome__menu-row docx-hf-chrome__menu-row--distance">
            <span>{t('headerFooter.headerDistance')}</span>
            <input
              type="number"
              min={0}
              step={0.01}
              aria-label={t('headerFooter.headerDistance')}
              value={headerInches}
              onChange={(event) => setHeaderInches(event.target.value)}
              onBlur={() => applyDistance('headerDistanceTwips', headerInches)}
            />
            <span className="docx-hf-chrome__unit">in</span>
          </label>
          <label className="docx-hf-chrome__menu-row docx-hf-chrome__menu-row--distance">
            <span>{t('headerFooter.footerDistance')}</span>
            <input
              type="number"
              min={0}
              step={0.01}
              aria-label={t('headerFooter.footerDistance')}
              value={footerInches}
              onChange={(event) => setFooterInches(event.target.value)}
              onBlur={() => applyDistance('footerDistanceTwips', footerInches)}
            />
            <span className="docx-hf-chrome__unit">in</span>
          </label>
          <div className="docx-hf-chrome__menu-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="docx-hf-chrome__menu-item"
            disabled={!removeGate.enabled}
            title={removeGate.reason ?? undefined}
            onClick={() => editor?.exec(removeCmd)}
            onMouseDown={onMouseDown}
          >
            {state.editing === 'header'
              ? t('headerFooter.removeHeader')
              : t('headerFooter.removeFooter')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Thin overlay while a header or footer scope is open: region label, inheritance warning,
 * page-number insert slots, options menu, and close. Mount beside `DocxEditor.Content`.
 *
 * @public
 */
export function DocxEditorHeaderFooterChrome({
  className,
}: DocxEditorHeaderFooterChromeProps): ReactElement | null {
  const { t } = useTranslation();
  const editor = useDocxEditor();
  const state = useHeaderFooterState();

  const onChromeMouseDown = guardToolbarMousedown;

  const close = useCallback(() => {
    editor?.exec({ type: 'exitHeaderFooter' });
  }, [editor]);

  if (!state?.editing) return null;

  const regionKey = regionLabelKey(state.editing, state.variant);
  const title = t('headerFooter.regionSection', {
    region: t(regionKey),
    section: state.sectionIndex + 1,
  });

  return (
    <div
      className={`docx-hf-chrome${className ? ` ${className}` : ''}`}
      role="region"
      aria-label={t('headerFooter.chromeAriaLabel')}
      data-testid="docx-hf-chrome"
      onMouseDown={onChromeMouseDown}
      style={{ zIndex: Z_INDEX.hfInlineEditor } as CSSProperties}
    >
      <div className="docx-hf-chrome__title-block">
        <span className="docx-hf-chrome__title">{title}</span>
        {state.inherited ? (
          <span className="docx-hf-chrome__inheritance" data-testid="docx-hf-inherited">
            {t('headerFooter.sameAsPrevious')}
            <span className="docx-hf-chrome__inheritance-hint">
              {t('headerFooter.sameAsPreviousHint')}
            </span>
          </span>
        ) : null}
      </div>
      <ToolbarContext.Provider value={{ t: (key) => t(key as TranslationKey), onSave: undefined }}>
        <div className="docx-hf-chrome__inserts" aria-label={t('formattingBar.groups.insert')}>
          {INSERT_GROUP.controls.map((control) => {
            const slot = chromeSlotId(INSERT_GROUP, control);
            return <ToolbarButton key={slot} slot={slot} />;
          })}
        </div>
      </ToolbarContext.Provider>
      <div className="docx-hf-chrome__actions">
        <OptionsMenu state={state} onMouseDown={onChromeMouseDown} />
        <button
          type="button"
          className="docx-hf-chrome__close"
          data-testid="docx-hf-close"
          aria-label={t('headerFooter.closeEditing', { label: t(regionKey) })}
          onClick={close}
          onMouseDown={onChromeMouseDown}
        >
          {t('headerFooter.closeEditing', { label: t(regionKey) })}
        </button>
      </div>
    </div>
  );
}
