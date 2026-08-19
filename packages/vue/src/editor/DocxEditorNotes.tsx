import { computed, defineComponent, h, ref, watch, type CSSProperties, type PropType } from 'vue';
import type { EditorCommand } from '@docx-editor.dev/core/contracts/editor';
import { useTranslation } from '../i18n';
import { Z_INDEX } from '../styles/zIndex';
import { useDocxEditor } from './context';
import { guardToolbarMousedown } from './toolbar/ToolbarButton';
import { useNotePropertiesState, useNoteScopeState } from './useNoteScopeState';
import { useScopedChromeAnchor } from './useScopedChromeAnchor';

const NOTE_SCOPE_RE = /^(footnote|endnote):(-?\d{1,10})$/;

function parseNoteScopeId(
  id: string
): { readonly noteKind: 'footnote' | 'endnote'; readonly noteId: number } | null {
  const match = NOTE_SCOPE_RE.exec(id);
  if (!match) return null;
  const noteId = Number(match[2]);
  if (!Number.isInteger(noteId)) return null;
  return { noteKind: match[1] as 'footnote' | 'endnote', noteId };
}

/** @public */
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

const NoteStoryOptions = defineComponent({
  name: 'NoteStoryOptions',
  props: {
    onOpenProperties: { type: Function as PropType<() => void>, required: true },
    onClose: { type: Function as PropType<() => void>, required: true },
  },
  setup(props) {
    const { t } = useTranslation();
    const open = ref(false);
    const menuRef = ref<HTMLDivElement | null>(null);

    watch(open, (isOpen, _, onCleanup) => {
      if (!isOpen) return;
      const onDocumentMouseDown = (event: globalThis.MouseEvent) => {
        if (menuRef.value?.contains(event.target as Node)) return;
        open.value = false;
      };
      document.addEventListener('mousedown', onDocumentMouseDown);
      onCleanup(() => document.removeEventListener('mousedown', onDocumentMouseDown));
    });

    return () => (
      <div ref={menuRef} class="docx-hf-chrome__options">
        <button
          type="button"
          class="docx-context-bar__options-trigger"
          data-testid="docx-notes-options"
          aria-expanded={open.value}
          aria-haspopup="menu"
          onMousedown={guardToolbarMousedown}
          onClick={() => {
            open.value = !open.value;
          }}
        >
          {t('headerFooter.options')}
        </button>
        {open.value ? (
          <div class="docx-hf-chrome__options-menu" role="menu" onMousedown={guardToolbarMousedown}>
            <button
              type="button"
              role="menuitem"
              class="docx-hf-chrome__menu-item"
              data-testid="docx-notes-properties"
              onClick={() => {
                props.onOpenProperties();
                open.value = false;
              }}
            >
              {t('dialogs.footnoteProperties.title')}
            </button>
            <div class="docx-hf-chrome__menu-separator" role="separator" />
            <button
              type="button"
              role="menuitem"
              class="docx-hf-chrome__menu-item"
              data-testid="docx-notes-close"
              onClick={() => {
                props.onClose();
                open.value = false;
              }}
            >
              {t('common.close')}
            </button>
          </div>
        ) : null}
      </div>
    );
  },
});

const NotePropertiesDialog = defineComponent({
  name: 'NotePropertiesDialog',
  props: {
    onClose: { type: Function as PropType<() => void>, required: true },
    onApply: { type: Function as PropType<(command: EditorCommand) => void>, required: true },
  },
  setup(props) {
    const { t } = useTranslation();
    const editorRef = useDocxEditor();
    const engineState = useNotePropertiesState();
    const scope = ref<'document' | 'section'>('document');
    const footnoteFmt = ref('decimal');
    const footnoteRestart = ref('continuous');
    const footnotePosition = ref('pageBottom');
    const endnoteFmt = ref('decimal');
    const endnoteRestart = ref('continuous');
    const endnotePosition = ref('docEnd');

    watch(engineState, (state) => {
      if (!state) return;
      footnoteFmt.value = state.footnote.resolved.numFmt;
      footnoteRestart.value = state.footnote.resolved.numRestart;
      footnotePosition.value = state.footnote.resolved.pos;
      endnoteFmt.value = state.endnote.resolved.numFmt;
      endnoteRestart.value = state.endnote.resolved.numRestart;
      endnotePosition.value = state.endnote.resolved.pos;
    });

    return () => {
      const state = engineState.value;
      const footnoteInherited =
        !state?.footnote.documentAuthored && !state?.footnote.sectionAuthored;
      const endnoteInherited = !state?.endnote.documentAuthored && !state?.endnote.sectionAuthored;

      return (
        <div
          class="docx-note-properties"
          role="dialog"
          aria-modal="true"
          aria-label={t('dialogs.footnoteProperties.title')}
          data-testid="docx-notes-properties-dialog"
          style={{ zIndex: Z_INDEX.modal }}
          onClick={props.onClose}
          onKeydown={(event) => {
            if (event.key === 'Escape') props.onClose();
          }}
        >
          <div
            class="docx-note-properties__panel"
            onClick={(event) => event.stopPropagation()}
            onMousedown={(event) => event.stopPropagation()}
          >
            <h2 class="docx-note-properties__title">{t('dialogs.footnoteProperties.title')}</h2>
            <div class="docx-note-properties__body">
              <label class="docx-note-properties__scope">
                <span>{t('notes.scope')}</span>
                <select
                  class="docx-note-properties__select"
                  value={scope.value}
                  onChange={(event) => {
                    scope.value = (event.target as HTMLSelectElement).value as
                      | 'document'
                      | 'section';
                  }}
                >
                  <option value="document">{t('notes.scopeDocument')}</option>
                  <option value="section">{t('notes.scopeSection')}</option>
                </select>
              </label>
              <fieldset class="docx-note-properties__section">
                <legend class="docx-note-properties__legend">
                  <span>{t('dialogs.footnoteProperties.footnotes')}</span>
                  {footnoteInherited ? (
                    <span class="docx-note-properties__badge">{t('notes.inheritedValue')}</span>
                  ) : null}
                </legend>
                <div class="docx-note-properties__fields">
                  <label class="docx-note-properties__field">
                    <span>{t('dialogs.footnoteProperties.numberFormat')}</span>
                    <select
                      class="docx-note-properties__select"
                      value={footnoteFmt.value}
                      onChange={(event) => {
                        footnoteFmt.value = (event.target as HTMLSelectElement).value;
                      }}
                    >
                      <option value="decimal">
                        {t('dialogs.footnoteProperties.formats.decimal')}
                      </option>
                      <option value="lowerRoman">
                        {t('dialogs.footnoteProperties.formats.lowerRoman')}
                      </option>
                      <option value="upperRoman">
                        {t('dialogs.footnoteProperties.formats.upperRoman')}
                      </option>
                    </select>
                  </label>
                  <label class="docx-note-properties__field">
                    <span>{t('dialogs.footnoteProperties.numbering')}</span>
                    <select
                      class="docx-note-properties__select"
                      value={footnoteRestart.value}
                      onChange={(event) => {
                        footnoteRestart.value = (event.target as HTMLSelectElement).value;
                      }}
                    >
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
                  <label class="docx-note-properties__field">
                    <span>{t('dialogs.footnoteProperties.position')}</span>
                    <select
                      class="docx-note-properties__select"
                      value={footnotePosition.value}
                      onChange={(event) => {
                        footnotePosition.value = (event.target as HTMLSelectElement).value;
                      }}
                    >
                      <option value="pageBottom">
                        {t('dialogs.footnoteProperties.footnotePositions.bottomOfPage')}
                      </option>
                      <option value="beneathText">
                        {t('dialogs.footnoteProperties.footnotePositions.belowText')}
                      </option>
                    </select>
                  </label>
                </div>
              </fieldset>
              <fieldset class="docx-note-properties__section">
                <legend class="docx-note-properties__legend">
                  <span>{t('dialogs.footnoteProperties.endnotes')}</span>
                  {endnoteInherited ? (
                    <span class="docx-note-properties__badge">{t('notes.inheritedValue')}</span>
                  ) : null}
                </legend>
                <div class="docx-note-properties__fields">
                  <label class="docx-note-properties__field">
                    <span>{t('dialogs.footnoteProperties.numberFormat')}</span>
                    <select
                      class="docx-note-properties__select"
                      value={endnoteFmt.value}
                      onChange={(event) => {
                        endnoteFmt.value = (event.target as HTMLSelectElement).value;
                      }}
                    >
                      <option value="decimal">
                        {t('dialogs.footnoteProperties.formats.decimal')}
                      </option>
                      <option value="lowerRoman">
                        {t('dialogs.footnoteProperties.formats.lowerRoman')}
                      </option>
                      <option value="upperRoman">
                        {t('dialogs.footnoteProperties.formats.upperRoman')}
                      </option>
                    </select>
                  </label>
                  <label class="docx-note-properties__field">
                    <span>{t('dialogs.footnoteProperties.numbering')}</span>
                    <select
                      class="docx-note-properties__select"
                      value={endnoteRestart.value}
                      onChange={(event) => {
                        endnoteRestart.value = (event.target as HTMLSelectElement).value;
                      }}
                    >
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
                  <label class="docx-note-properties__field">
                    <span>{t('dialogs.footnoteProperties.position')}</span>
                    <select
                      class="docx-note-properties__select"
                      value={endnotePosition.value}
                      data-testid="docx-notes-endnote-position"
                      onChange={(event) => {
                        endnotePosition.value = (event.target as HTMLSelectElement).value;
                      }}
                    >
                      <option value="docEnd">
                        {t('dialogs.footnoteProperties.endnotePositions.endOfDocument')}
                      </option>
                      <option value="sectEnd">
                        {t('dialogs.footnoteProperties.endnotePositions.endOfSection')}
                      </option>
                    </select>
                  </label>
                </div>
              </fieldset>
            </div>
            <div class="docx-note-properties__footer">
              <button class="docx-note-properties__button" type="button" onClick={props.onClose}>
                {t('common.cancel')}
              </button>
              <button
                class="docx-note-properties__button docx-note-properties__button--primary"
                type="button"
                data-testid="docx-notes-properties-apply"
                onClick={() => {
                  const editor = editorRef.value;
                  if (!editor) return;
                  const command: EditorCommand = {
                    type: 'setNoteProperties',
                    scope: scope.value,
                    sectionIndex: scope.value === 'section' ? state?.sectionIndex : undefined,
                    footnote: {
                      numFmt: footnoteFmt.value,
                      numRestart: footnoteRestart.value,
                      position: footnotePosition.value,
                    },
                    endnote: {
                      numFmt: endnoteFmt.value,
                      numRestart: endnoteRestart.value,
                      position: endnotePosition.value,
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
    };
  },
});

/** @public */
export const DocxEditorNotesChrome = defineComponent({
  name: 'DocxEditorNotesChrome',
  props: {
    className: { type: String, default: undefined },
  },
  setup(props) {
    const { t } = useTranslation();
    const editorRef = useDocxEditor();
    const noteScope = useNoteScopeState();
    const preview = ref<NotePreview | null>(null);
    const menu = ref<{ scopeId: string; x: number; y: number } | null>(null);
    const propsOpen = ref(false);
    const hideTimer = ref<ReturnType<typeof setTimeout> | null>(null);
    const chromeRootRef = ref<HTMLDivElement | null>(null);

    const eventRootForEditor = (): HTMLElement | null =>
      chromeRootRef.value?.closest<HTMLElement>('.docx-editor') ?? null;

    const findActiveNoteArea = (viewport: HTMLElement) => {
      const scope = noteScope.value;
      if (!scope) return null;
      const candidates = viewport.querySelectorAll<HTMLElement>('[data-docx-note-scope]');
      const active =
        [...candidates].find(
          (candidate) =>
            candidate.matches('[data-docx-note]') && candidate.dataset.docxNoteScope === scope.id
        ) ?? null;
      return active?.closest<HTMLElement>('[data-docx-notes]') ?? active;
    };

    const anchor = useScopedChromeAnchor(findActiveNoteArea, 'story-label');

    const clearPreview = () => {
      if (hideTimer.value) clearTimeout(hideTimer.value);
      hideTimer.value = null;
      preview.value = null;
    };

    watch(
      [editorRef, chromeRootRef],
      ([editor], _, onCleanup) => {
        if (!editor) return;
        const root = eventRootForEditor();
        if (!root) return;

        const onClick = (event: Event) => {
          const target = event.target as HTMLElement | null;
          if (!target) return;
          const refEl = target.closest<HTMLElement>('[data-docx-note-ref]');
          if (refEl?.dataset.docxNoteScope) {
            event.preventDefault();
            clearPreview();
            menu.value = null;
            editor.setActiveScope({ kind: 'note', id: refEl.dataset.docxNoteScope });
            return;
          }
          const mark = target.closest<HTMLElement>('[data-docx-note-mark-back]');
          if (mark) {
            event.preventDefault();
            clearPreview();
            menu.value = null;
            editor.setActiveScope({ kind: 'body' });
          }
        };

        const onContextMenu = (event: Event) => {
          const mouse = event as globalThis.MouseEvent;
          const target = mouse.target as HTMLElement | null;
          const note = target?.closest<HTMLElement>('[data-docx-note-scope]');
          if (!note?.dataset.docxNoteScope) return;
          mouse.preventDefault();
          menu.value = {
            scopeId: note.dataset.docxNoteScope,
            x: mouse.clientX,
            y: mouse.clientY,
          };
        };

        const onPointerOver = (event: Event) => {
          if (isTouchPrimary()) return;
          const target = event.target as HTMLElement | null;
          const refEl = target?.closest<HTMLElement>('[data-docx-note-ref]');
          if (!refEl?.dataset.docxNoteScope) {
            clearPreview();
            return;
          }
          const scopeId = refEl.dataset.docxNoteScope;
          const engineText = editor.getNotePreviewText(scopeId);
          const text =
            engineText ?? refEl.getAttribute('aria-description') ?? t('notes.previewFallback');
          const rect = refEl.getBoundingClientRect();
          if (hideTimer.value) clearTimeout(hideTimer.value);
          hideTimer.value = setTimeout(() => {
            preview.value = { scopeId, text, x: rect.left, y: rect.bottom + 4 };
          }, 400);
        };

        root.addEventListener('click', onClick);
        root.addEventListener('contextmenu', onContextMenu);
        root.addEventListener('pointerover', onPointerOver);
        root.addEventListener('scroll', clearPreview, true);
        onCleanup(() => {
          root.removeEventListener('click', onClick);
          root.removeEventListener('contextmenu', onContextMenu);
          root.removeEventListener('pointerover', onPointerOver);
          root.removeEventListener('scroll', clearPreview, true);
          clearPreview();
        });
      },
      { flush: 'post' }
    );

    const runNoteCommand = (command: EditorCommand) => {
      editorRef.value?.exec(command);
      menu.value = null;
    };

    const menuParsed = computed(() => (menu.value ? parseNoteScopeId(menu.value.scopeId) : null));

    const deleteCmd = computed(() =>
      menuParsed.value
        ? {
            type: 'deleteNote' as const,
            noteKind: menuParsed.value.noteKind,
            noteId: menuParsed.value.noteId,
          }
        : null
    );
    const convertCmd = computed(() =>
      menuParsed.value
        ? {
            type: 'convertNote' as const,
            fromKind: menuParsed.value.noteKind,
            noteId: menuParsed.value.noteId,
          }
        : null
    );
    const convertAllCmd = computed(() =>
      menuParsed.value
        ? { type: 'convertAllNotes' as const, fromKind: menuParsed.value.noteKind }
        : null
    );

    const deleteGate = useCommandGate(
      deleteCmd.value ?? { type: 'deleteNote', noteKind: 'footnote', noteId: 0 }
    );
    const convertGate = useCommandGate(
      convertCmd.value ?? { type: 'convertNote', fromKind: 'footnote', noteId: 0 }
    );
    const convertAllGate = useCommandGate(
      convertAllCmd.value ?? { type: 'convertAllNotes', fromKind: 'footnote' }
    );

    const previewStyle = computed<CSSProperties>(() => ({
      position: 'fixed',
      left: preview.value?.x ?? 0,
      top: preview.value?.y ?? 0,
      zIndex: Z_INDEX.popover,
      maxWidth: 280,
      maxHeight: '40vh',
      overflowY: 'auto',
      padding: '8px 10px',
      background: 'var(--doc-popover-bg, #fff)',
      color: 'var(--doc-popover-fg, #111)',
      border: '1px solid var(--doc-border, #ddd)',
      boxShadow: 'var(--doc-shadow, 0 4px 16px rgba(0,0,0,.12))',
      fontSize: 12,
      lineHeight: 1.4,
      pointerEvents: 'none',
    }));

    return () => {
      if (!editorRef.value) return null;

      const parsedActive = noteScope.value ? parseNoteScopeId(noteScope.value.id) : null;
      const regionLabel = parsedActive
        ? t('notes.editingRegion', {
            kind:
              parsedActive.noteKind === 'footnote'
                ? t('notes.footnoteKind')
                : t('notes.endnoteKind'),
            number: parsedActive.noteId,
          })
        : null;

      return h(
        'div',
        {
          ref: (element: unknown) => {
            chromeRootRef.value = element instanceof HTMLDivElement ? element : null;
          },
          class: props.className,
          'data-docx-notes-chrome': '',
          'data-testid': 'docx-notes-chrome',
          'aria-hidden': noteScope.value ? undefined : true,
        },
        [
          noteScope.value && parsedActive ? (
            <div
              ref={anchor.ref as never}
              class="docx-context-bar docx-notes-chrome__banner"
              role="region"
              aria-label={t('notes.chromeAriaLabel')}
              data-testid="docx-notes-banner"
              data-note-scope={noteScope.value.id}
              style={{ ...anchor.style.value, zIndex: Z_INDEX.chrome }}
            >
              <span class="docx-context-bar__title">{regionLabel}</span>
              <NoteStoryOptions
                onOpenProperties={() => {
                  propsOpen.value = true;
                }}
                onClose={() => {
                  editorRef.value?.setActiveScope({ kind: 'body' });
                }}
              />
            </div>
          ) : null,

          preview.value ? (
            <div role="tooltip" data-testid="docx-notes-preview" style={previewStyle.value}>
              {preview.value.text}
            </div>
          ) : null,

          menu.value && menuParsed.value ? (
            <div
              role="menu"
              data-testid="docx-notes-menu"
              style={{
                position: 'fixed',
                left: menu.value.x,
                top: menu.value.y,
                zIndex: Z_INDEX.popover,
                minWidth: 160,
                background: 'var(--doc-popover-bg, #fff)',
                border: '1px solid var(--doc-border, #ddd)',
                boxShadow: 'var(--doc-shadow, 0 4px 16px rgba(0,0,0,.12))',
                padding: 4,
              }}
              onMousedown={guardToolbarMousedown}
            >
              <button
                type="button"
                role="menuitem"
                data-testid="docx-notes-menu-delete"
                disabled={!deleteGate.value.enabled}
                title={deleteGate.value.reason ?? undefined}
                onClick={() => deleteCmd.value && runNoteCommand(deleteCmd.value)}
              >
                {t('notes.delete')}
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="docx-notes-menu-convert"
                disabled={!convertGate.value.enabled}
                title={convertGate.value.reason ?? undefined}
                onClick={() => convertCmd.value && runNoteCommand(convertCmd.value)}
              >
                {menuParsed.value.noteKind === 'footnote'
                  ? t('notes.convertToEndnote')
                  : t('notes.convertToFootnote')}
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="docx-notes-menu-convert-all"
                disabled={!convertAllGate.value.enabled}
                title={convertAllGate.value.reason ?? undefined}
                onClick={() => convertAllCmd.value && runNoteCommand(convertAllCmd.value)}
              >
                {menuParsed.value.noteKind === 'footnote'
                  ? t('notes.convertAllFootnotes')
                  : t('notes.convertAllEndnotes')}
              </button>
              <button type="button" role="menuitem" onClick={() => (propsOpen.value = true)}>
                {t('dialogs.footnoteProperties.title')}
              </button>
            </div>
          ) : null,

          propsOpen.value ? (
            <NotePropertiesDialog
              onClose={() => {
                propsOpen.value = false;
              }}
              onApply={(command) => {
                runNoteCommand(command);
                propsOpen.value = false;
              }}
            />
          ) : null,
        ]
      );
    };
  },
});

/** @internal */
export function useNoteScopeProbe(): ReturnType<typeof useNoteScopeState> {
  return useNoteScopeState();
}
