// Header/footer scope chrome — region label, inheritance warning, field inserts, options.
//
// UI-only overlay: no layout records, no canonical nodes. Reads reference-stable engine
// state via `useHeaderFooterState`; every action dispatches through `Editor.exec` or
// `useEditorCommand` (slot → command table). Double-click enter and Escape leave remain
// core-owned.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, ReactElement } from 'react';
import type { EditorCommand } from '@docx-editor.dev/core-contract/contracts/editor';
import { useTranslation } from '../i18n';
import type { TranslationKey } from '../i18n';
import { Z_INDEX } from '../styles/zIndex';
import { useDocxEditor } from './context';
import { guardToolbarMousedown } from './toolbar/ToolbarButton';
import { inchesToTwips, twipsToInches } from './header-footer-units';
import { useHeaderFooterState } from './useHeaderFooterState';
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

function PageFieldsMenu(props: {
  readonly onMouseDown: (event: MouseEvent) => void;
}): ReactElement {
  const { onMouseDown } = props;
  const { t } = useTranslation();
  const editor = useDocxEditor();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocMouseDown = (event: globalThis.MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  return (
    <div ref={menuRef} className="docx-hf-chrome__options" onMouseDown={onMouseDown}>
      <button
        type="button"
        className="docx-context-chip__button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        onMouseDown={onMouseDown}
      >
        {t('headerFooter.pageNumbers')}
      </button>
      {open ? (
        <div className="docx-hf-chrome__options-menu" role="menu" onMouseDown={onMouseDown}>
          {PAGE_FIELDS.map((item) => {
            const command: EditorCommand = { type: 'insertPageField', field: item.field };
            const gate = editor?.can(command);
            return (
              <button
                key={item.field}
                type="button"
                role="menuitem"
                className="docx-hf-chrome__menu-item"
                disabled={!gate?.ok}
                title={gate && !gate.ok ? gate.reason : undefined}
                onClick={() => {
                  editor?.exec(command);
                  setOpen(false);
                }}
                onMouseDown={onMouseDown}
              >
                {t(item.labelKey)}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
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
        className="docx-context-chip__button"
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
  const findActiveFurniture = useCallback(
    (viewport: HTMLElement) => viewport.querySelector<HTMLElement>('[data-docx-hf-active]'),
    []
  );
  const anchor = useScopedChromeAnchor(
    findActiveFurniture,
    state?.editing === 'footer' ? 'before' : 'after'
  );

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
      ref={anchor.ref}
      className={`docx-context-chip docx-hf-chrome${className ? ` ${className}` : ''}`}
      role="region"
      aria-label={t('headerFooter.chromeAriaLabel')}
      data-testid="docx-hf-chrome"
      onMouseDown={onChromeMouseDown}
      style={{ ...anchor.style, zIndex: Z_INDEX.hfInlineEditor } as CSSProperties}
    >
      <span className="docx-context-chip__title">{title}</span>
      {state.inherited ? (
        <span
          className="docx-context-chip__status"
          data-testid="docx-hf-inherited"
          title={t('headerFooter.sameAsPreviousHint')}
        >
          {t('headerFooter.sameAsPrevious')}
        </span>
      ) : null}
      <div className="docx-hf-chrome__actions">
        <PageFieldsMenu onMouseDown={onChromeMouseDown} />
        <OptionsMenu state={state} onMouseDown={onChromeMouseDown} />
        <button
          type="button"
          className="docx-context-chip__button docx-context-chip__button--primary"
          data-testid="docx-hf-close"
          aria-label={t('headerFooter.closeEditing', { label: t(regionKey) })}
          onClick={close}
          onMouseDown={onChromeMouseDown}
        >
          {t('common.close')}
        </button>
      </div>
    </div>
  );
}
