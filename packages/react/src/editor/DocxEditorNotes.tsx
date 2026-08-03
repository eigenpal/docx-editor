// Thin React note chrome: hover preview, context menu, properties dialog.
//
// No model/layout logic — reads engine state and dispatches Editor.exec / setActiveScope.
// Hover preview mousedown is prevented so it cannot steal the caret. Touch skips preview
// and navigates only.

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
import { useNotePropertiesState, useNoteScopeState } from './useNoteScopeState';

const NOTE_SCOPE_RE = /^(footnote|endnote):(-?\d{1,10})$/;
const INSERT_GROUP = CHROME_GROUPS.find((group) => group.id === 'insert')!;

function parseNoteScopeId(
  id: string
): { readonly noteKind: 'footnote' | 'endnote'; readonly noteId: number } | null {
  const match = NOTE_SCOPE_RE.exec(id);
  if (!match) return null;
  const noteId = Number(match[2]);
  if (!Number.isInteger(noteId)) return null;
  return { noteKind: match[1] as 'footnote' | 'endnote', noteId };
}

/** Props for `DocxEditor.NotesChrome`. @public */
export interface DocxEditorNotesChromeProps {
  className?: string;
}

type NotePreview = {
  readonly scopeId: string;
  readonly text: string;
  readonly x: number;
  readonly y: number;
};

function isTouchPrimary(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

function useCommandGate(command: EditorCommand): { enabled: boolean; reason: string | null } {
  const editor = useDocxEditor();
  return useMemo(() => {
    if (!editor) return { enabled: false, reason: 'editor is not ready' };
    const result = editor.can(command);
    return result.ok ? { enabled: true, reason: null } : { enabled: false, reason: result.reason };
  }, [editor, command]);
}

export function DocxEditorNotesChrome({
  className,
}: DocxEditorNotesChromeProps): ReactElement | null {
  const { t } = useTranslation();
  const editor = useDocxEditor();
  const noteScope = useNoteScopeState();
  const [preview, setPreview] = useState<NotePreview | null>(null);
  const [menu, setMenu] = useState<{
    scopeId: string;
    x: number;
    y: number;
  } | null>(null);
  const [propsOpen, setPropsOpen] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPreview = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
    setPreview(null);
  }, []);

  useEffect(() => {
    if (!editor) return undefined;
    const root = document.querySelector('.docx-pages');
    if (!root) return undefined;

    const onClick = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const ref = target.closest<HTMLElement>('[data-docx-note-ref]');
      if (ref?.dataset.docxNoteScope) {
        event.preventDefault();
        editor.setActiveScope({ kind: 'note', id: ref.dataset.docxNoteScope });
        return;
      }
      const mark = target.closest<HTMLElement>('[data-docx-note-mark-back]');
      if (mark) {
        event.preventDefault();
        editor.setActiveScope({ kind: 'body' });
      }
    };

    const onContextMenu = (event: Event) => {
      const mouse = event as globalThis.MouseEvent;
      const target = mouse.target as HTMLElement | null;
      const note = target?.closest<HTMLElement>('[data-docx-note-scope]');
      if (!note?.dataset.docxNoteScope) return;
      mouse.preventDefault();
      setMenu({
        scopeId: note.dataset.docxNoteScope,
        x: mouse.clientX,
        y: mouse.clientY,
      });
    };

    const onPointerOver = (event: Event) => {
      if (isTouchPrimary()) return;
      const target = event.target as HTMLElement | null;
      const ref = target?.closest<HTMLElement>('[data-docx-note-ref]');
      if (!ref?.dataset.docxNoteScope) {
        clearPreview();
        return;
      }
      const scopeId = ref.dataset.docxNoteScope;
      const engineText = editor.getNotePreviewText(scopeId);
      const text = engineText ?? ref.getAttribute('aria-description') ?? t('notes.previewFallback');
      const rect = ref.getBoundingClientRect();
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => {
        setPreview({ scopeId, text, x: rect.left, y: rect.bottom + 4 });
      }, 400);
    };

    root.addEventListener('click', onClick);
    root.addEventListener('contextmenu', onContextMenu);
    root.addEventListener('pointerover', onPointerOver);
    root.addEventListener('scroll', clearPreview, true);
    return () => {
      root.removeEventListener('click', onClick);
      root.removeEventListener('contextmenu', onContextMenu);
      root.removeEventListener('pointerover', onPointerOver);
      root.removeEventListener('scroll', clearPreview, true);
      clearPreview();
    };
  }, [editor, clearPreview, t]);

  const runNoteCommand = useCallback(
    (command: EditorCommand) => {
      if (!editor) return;
      editor.exec(command);
      setMenu(null);
    },
    [editor]
  );

  const menuParsed = menu ? parseNoteScopeId(menu.scopeId) : null;

  const deleteCmd = useMemo(
    () =>
      menuParsed
        ? {
            type: 'deleteNote' as const,
            noteKind: menuParsed.noteKind,
            noteId: menuParsed.noteId,
          }
        : null,
    [menuParsed]
  );
  const convertCmd = useMemo(
    () =>
      menuParsed
        ? {
            type: 'convertNote' as const,
            fromKind: menuParsed.noteKind,
            noteId: menuParsed.noteId,
          }
        : null,
    [menuParsed]
  );
  const convertAllCmd = useMemo(
    () =>
      menuParsed
        ? {
            type: 'convertAllNotes' as const,
            fromKind: menuParsed.noteKind,
          }
        : null,
    [menuParsed]
  );

  const deleteGate = useCommandGate(
    deleteCmd ?? { type: 'deleteNote', noteKind: 'footnote', noteId: 0 }
  );
  const convertGate = useCommandGate(
    convertCmd ?? { type: 'convertNote', fromKind: 'footnote', noteId: 0 }
  );
  const convertAllGate = useCommandGate(
    convertAllCmd ?? { type: 'convertAllNotes', fromKind: 'footnote' }
  );

  const previewStyle: CSSProperties = useMemo(
    () => ({
      position: 'fixed',
      left: preview?.x ?? 0,
      top: preview?.y ?? 0,
      zIndex: Z_INDEX.popover,
      maxWidth: 280,
      padding: '8px 10px',
      background: 'var(--doc-popover-bg, #fff)',
      color: 'var(--doc-popover-fg, #111)',
      border: '1px solid var(--doc-border, #ddd)',
      boxShadow: 'var(--doc-shadow, 0 4px 16px rgba(0,0,0,.12))',
      fontSize: 12,
      lineHeight: 1.4,
      pointerEvents: 'auto',
    }),
    [preview]
  );

  const parsedActive = noteScope ? parseNoteScopeId(noteScope.id) : null;
  const regionLabel = parsedActive
    ? t('notes.editingRegion', {
        kind:
          parsedActive.noteKind === 'footnote' ? t('notes.footnoteKind') : t('notes.endnoteKind'),
        number: parsedActive.noteId,
      })
    : null;

  if (!editor) return null;

  return (
    <div
      className={className}
      data-docx-notes-chrome=""
      data-testid="docx-notes-chrome"
      aria-hidden={noteScope ? undefined : true}
    >
      {noteScope && parsedActive ? (
        <div
          className="docx-notes-chrome__banner"
          role="region"
          aria-label={t('notes.chromeAriaLabel')}
          data-testid="docx-notes-banner"
          data-note-scope={noteScope.id}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: Z_INDEX.chrome,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            padding: '4px 8px',
            background: 'var(--doc-banner-bg, #f5f5f5)',
            borderBottom: '1px solid var(--doc-border, #ddd)',
            fontSize: 12,
          }}
        >
          <span>{regionLabel}</span>
          <ToolbarContext.Provider
            value={{ t: (key) => t(key as TranslationKey), onSave: undefined }}
          >
            <div aria-label={t('formattingBar.groups.insert')}>
              {INSERT_GROUP.controls
                .filter((control) => control.id === 'footnote' || control.id === 'endnote')
                .map((control) => {
                  const slot = chromeSlotId(INSERT_GROUP, control);
                  return <ToolbarButton key={slot} slot={slot} />;
                })}
            </div>
          </ToolbarContext.Provider>
          <button
            type="button"
            data-testid="docx-notes-close"
            onMouseDown={guardToolbarMousedown}
            onClick={() => editor.setActiveScope({ kind: 'body' })}
          >
            {t('notes.closeNote')}
          </button>
          <button
            type="button"
            data-testid="docx-notes-properties"
            onMouseDown={guardToolbarMousedown}
            onClick={() => setPropsOpen(true)}
          >
            {t('dialogs.footnoteProperties.title')}
          </button>
        </div>
      ) : null}

      {preview ? (
        <div
          role="tooltip"
          data-testid="docx-notes-preview"
          style={previewStyle}
          onMouseDown={(event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {preview.text}
        </div>
      ) : null}

      {menu && menuParsed ? (
        <div
          role="menu"
          data-testid="docx-notes-menu"
          style={{
            position: 'fixed',
            left: menu.x,
            top: menu.y,
            zIndex: Z_INDEX.popover,
            minWidth: 160,
            background: 'var(--doc-popover-bg, #fff)',
            border: '1px solid var(--doc-border, #ddd)',
            boxShadow: 'var(--doc-shadow, 0 4px 16px rgba(0,0,0,.12))',
            padding: 4,
          }}
          onMouseDown={guardToolbarMousedown}
        >
          <button
            type="button"
            role="menuitem"
            data-testid="docx-notes-menu-delete"
            disabled={!deleteGate.enabled}
            title={deleteGate.reason ?? undefined}
            onClick={() => deleteCmd && runNoteCommand(deleteCmd)}
          >
            {t('notes.delete')}
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="docx-notes-menu-convert"
            disabled={!convertGate.enabled}
            title={convertGate.reason ?? undefined}
            onClick={() => convertCmd && runNoteCommand(convertCmd)}
          >
            {menuParsed.noteKind === 'footnote'
              ? t('notes.convertToEndnote')
              : t('notes.convertToFootnote')}
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="docx-notes-menu-convert-all"
            disabled={!convertAllGate.enabled}
            title={convertAllGate.reason ?? undefined}
            onClick={() => convertAllCmd && runNoteCommand(convertAllCmd)}
          >
            {menuParsed.noteKind === 'footnote'
              ? t('notes.convertAllFootnotes')
              : t('notes.convertAllEndnotes')}
          </button>
          <button type="button" role="menuitem" onClick={() => setPropsOpen(true)}>
            {t('dialogs.footnoteProperties.title')}
          </button>
        </div>
      ) : null}

      {propsOpen ? (
        <NotePropertiesDialog
          onClose={() => setPropsOpen(false)}
          onApply={(command) => {
            runNoteCommand(command);
            setPropsOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function NotePropertiesDialog(props: {
  readonly onClose: () => void;
  readonly onApply: (command: EditorCommand) => void;
}): ReactElement {
  const { t } = useTranslation();
  const editor = useDocxEditor();
  const engineState = useNotePropertiesState();
  const [scope, setScope] = useState<'document' | 'section'>('document');
  const [footnoteFmt, setFootnoteFmt] = useState('decimal');
  const [footnoteRestart, setFootnoteRestart] = useState('continuous');
  const [footnotePosition, setFootnotePosition] = useState('pageBottom');
  const [endnoteFmt, setEndnoteFmt] = useState('decimal');
  const [endnoteRestart, setEndnoteRestart] = useState('continuous');
  const [endnotePosition, setEndnotePosition] = useState('docEnd');

  useEffect(() => {
    if (!engineState) return;
    setFootnoteFmt(engineState.footnote.resolved.numFmt);
    setFootnoteRestart(engineState.footnote.resolved.numRestart);
    setFootnotePosition(engineState.footnote.resolved.pos);
    setEndnoteFmt(engineState.endnote.resolved.numFmt);
    setEndnoteRestart(engineState.endnote.resolved.numRestart);
    setEndnotePosition(engineState.endnote.resolved.pos);
  }, [engineState]);

  const footnoteInherited =
    !engineState?.footnote.documentAuthored && !engineState?.footnote.sectionAuthored;
  const endnoteInherited =
    !engineState?.endnote.documentAuthored && !engineState?.endnote.sectionAuthored;

  return (
    <div
      role="dialog"
      aria-label={t('dialogs.footnoteProperties.title')}
      data-testid="docx-notes-properties-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: Z_INDEX.modal,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(0,0,0,.32)',
      }}
      onMouseDown={guardToolbarMousedown}
    >
      <div
        style={{
          background: 'var(--doc-popover-bg, #fff)',
          padding: 16,
          minWidth: 280,
          borderRadius: 4,
        }}
      >
        <h2 style={{ margin: '0 0 12px', fontSize: 14 }}>
          {t('dialogs.footnoteProperties.title')}
        </h2>
        <label>
          {t('notes.scope')}
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as 'document' | 'section')}
          >
            <option value="document">{t('notes.scopeDocument')}</option>
            <option value="section">{t('notes.scopeSection')}</option>
          </select>
        </label>
        <fieldset style={{ marginTop: 8 }}>
          <legend>
            {t('dialogs.footnoteProperties.footnotes')}
            {footnoteInherited ? ` ${t('notes.inheritedValue')}` : ''}
          </legend>
          <label>
            {t('dialogs.footnoteProperties.numberFormat')}
            <select value={footnoteFmt} onChange={(e) => setFootnoteFmt(e.target.value)}>
              <option value="decimal">{t('dialogs.footnoteProperties.formats.decimal')}</option>
              <option value="lowerRoman">
                {t('dialogs.footnoteProperties.formats.lowerRoman')}
              </option>
              <option value="upperRoman">
                {t('dialogs.footnoteProperties.formats.upperRoman')}
              </option>
            </select>
          </label>
          <label>
            {t('dialogs.footnoteProperties.numbering')}
            <select value={footnoteRestart} onChange={(e) => setFootnoteRestart(e.target.value)}>
              <option value="continuous">
                {t('dialogs.footnoteProperties.numberingOptions.continuous')}
              </option>
              <option value="eachSect">
                {t('dialogs.footnoteProperties.numberingOptions.restartSection')}
              </option>
              <option value="eachPage">
                {t('dialogs.footnoteProperties.numberingOptions.restartPage')}
              </option>
            </select>
          </label>
          <label>
            {t('dialogs.footnoteProperties.position')}
            <select value={footnotePosition} onChange={(e) => setFootnotePosition(e.target.value)}>
              <option value="pageBottom">
                {t('dialogs.footnoteProperties.footnotePositions.bottomOfPage')}
              </option>
              <option value="beneathText">
                {t('dialogs.footnoteProperties.footnotePositions.belowText')}
              </option>
            </select>
          </label>
        </fieldset>
        <fieldset style={{ marginTop: 8 }}>
          <legend>
            {t('dialogs.footnoteProperties.endnotes')}
            {endnoteInherited ? ` ${t('notes.inheritedValue')}` : ''}
          </legend>
          <label>
            {t('dialogs.footnoteProperties.numberFormat')}
            <select value={endnoteFmt} onChange={(e) => setEndnoteFmt(e.target.value)}>
              <option value="decimal">{t('dialogs.footnoteProperties.formats.decimal')}</option>
              <option value="lowerRoman">
                {t('dialogs.footnoteProperties.formats.lowerRoman')}
              </option>
              <option value="upperRoman">
                {t('dialogs.footnoteProperties.formats.upperRoman')}
              </option>
            </select>
          </label>
          <label>
            {t('dialogs.footnoteProperties.numbering')}
            <select value={endnoteRestart} onChange={(e) => setEndnoteRestart(e.target.value)}>
              <option value="continuous">
                {t('dialogs.footnoteProperties.numberingOptions.continuous')}
              </option>
              <option value="eachSect">
                {t('dialogs.footnoteProperties.numberingOptions.restartSection')}
              </option>
              <option value="eachPage">
                {t('dialogs.footnoteProperties.numberingOptions.restartPage')}
              </option>
            </select>
          </label>
          <label>
            {t('dialogs.footnoteProperties.position')}
            <select
              value={endnotePosition}
              data-testid="docx-notes-endnote-position"
              onChange={(e) => setEndnotePosition(e.target.value)}
            >
              <option value="docEnd">
                {t('dialogs.footnoteProperties.endnotePositions.endOfDocument')}
              </option>
              <option value="sectEnd">
                {t('dialogs.footnoteProperties.endnotePositions.endOfSection')}
              </option>
            </select>
          </label>
        </fieldset>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
          <button type="button" onClick={props.onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            data-testid="docx-notes-properties-apply"
            onClick={() => {
              if (!editor) return;
              const command: EditorCommand = {
                type: 'setNoteProperties',
                scope,
                sectionIndex: scope === 'section' ? engineState?.sectionIndex : undefined,
                footnote: {
                  numFmt: footnoteFmt,
                  numRestart: footnoteRestart,
                  position: footnotePosition,
                },
                endnote: {
                  numFmt: endnoteFmt,
                  numRestart: endnoteRestart,
                  position: endnotePosition,
                },
              };
              const can = editor.can(command);
              if (!can.ok) return;
              props.onApply(command);
            }}
          >
            {t('common.apply')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Selector probe for reference-stability tests. @internal */
export function useNoteScopeProbe(): ReturnType<typeof useNoteScopeState> {
  return useNoteScopeState();
}
