import { useState } from 'react';
import { useDocxEditor, useTranslation } from '@docx-editor.dev/react';
import {
  DocxEditor as AutomationDocxEditor,
  isDocxEditorError,
  type DocxEditorRuntime,
} from '@docx-editor.dev/editor-api/browser';
import { keepCaret } from './demoButtons';

type RecipeStatus = 'idle' | 'running' | 'success' | 'error';

interface RecipeReading {
  readonly label: string;
  readonly status: RecipeStatus;
  readonly output?: string;
  readonly error?: string;
}

const IDLE_READING: RecipeReading = { label: '', status: 'idle' };
const CONTROL_MARKER = ' [structured automation]';

function errorText(error: unknown): string {
  if (isDocxEditorError(error)) {
    return `${error.code}${error.target ? ` · ${error.target}` : ''}\n${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function printable(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function textSample(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 160);
}

/**
 * Structured-model test equipment over the public browser automation entry.
 *
 * The recipes intentionally expose their sync counts and refusals. This is a DX probe, so an empty
 * collection is useful output rather than an exception hidden behind demo-specific fallbacks.
 */
export function StructuredAutomationRecipes() {
  const { t } = useTranslation();
  const editor = useDocxEditor();
  const [open, setOpen] = useState(false);
  const [reading, setReading] = useState<RecipeReading>(IDLE_READING);
  const busy = reading.status === 'running';

  const runRecipe = async (
    label: string,
    recipe: (runtime: DocxEditorRuntime) => Promise<unknown>
  ): Promise<void> => {
    if (!editor || busy) return;
    setReading({ label, status: 'running' });
    const runtime = AutomationDocxEditor.createBrowser(editor);
    try {
      const output = await recipe(runtime);
      setReading({ label, status: 'success', output: printable(output) });
    } catch (error) {
      setReading({ label, status: 'error', error: errorText(error) });
    } finally {
      runtime.dispose();
    }
  };

  const inspectSections = () =>
    runRecipe(t('structuredAutomation.sections'), async (runtime) =>
      runtime.run(async (context) => {
        let syncRounds = 0;
        const sections = context.document.sections;
        sections.load();
        await context.sync();
        syncRounds += 1;

        if (sections.items.length === 0) {
          return {
            syncRounds,
            sections: [],
            pageSetupChange: {
              status: 'not-run',
              reason: t('structuredAutomation.emptyCollection'),
            },
          };
        }

        for (const section of sections.items) {
          section.pageSetup.load([
            'pageWidth',
            'pageHeight',
            'orientation',
            'topMargin',
            'rightMargin',
            'bottomMargin',
            'leftMargin',
          ]);
        }
        await context.sync();
        syncRounds += 1;

        const before = sections.items.map(({ pageSetup }) => ({
          pageWidth: pageSetup.pageWidth,
          pageHeight: pageSetup.pageHeight,
          orientation: pageSetup.orientation,
          topMargin: pageSetup.topMargin,
          rightMargin: pageSetup.rightMargin,
          bottomMargin: pageSetup.bottomMargin,
          leftMargin: pageSetup.leftMargin,
        }));
        const first = sections.items[0]!.pageSetup;
        const changedTopMargin = first.topMargin === 72 ? 66 : 72;
        first.topMargin = changedTopMargin;
        await context.sync();
        syncRounds += 1;

        first.load('topMargin');
        await context.sync();
        syncRounds += 1;
        return {
          syncRounds,
          sections: before,
          pageSetupChange: {
            section: 1,
            property: 'topMargin',
            before: before[0]!.topMargin,
            after: first.topMargin,
            unit: 'points',
            undo: t('structuredAutomation.undoMargin'),
          },
        };
      })
    );

  const inspectBookmarks = () =>
    runRecipe(t('structuredAutomation.bookmarks'), async (runtime) => {
      if (!runtime.capabilities.selection || !runtime.capabilities.scrolling) {
        return {
          syncRounds: 0,
          count: 0,
          names: [],
          selection: 'unsupported',
          reason: t('structuredAutomation.selectionUnsupported'),
        };
      }
      return runtime.run(async (context) => {
        let syncRounds = 0;
        const bookmarks = context.document.body.bookmarks;
        bookmarks.load();
        await context.sync();
        syncRounds += 1;

        for (const bookmark of bookmarks.items) bookmark.load('name');
        await context.sync();
        syncRounds += 1;

        const first = bookmarks.items[0];
        if (first) {
          first.select();
          await context.sync();
          syncRounds += 1;
        }
        return {
          syncRounds,
          count: bookmarks.items.length,
          names: bookmarks.items.map((bookmark) => bookmark.name),
          selection: first
            ? t('structuredAutomation.bookmarkSelected', { name: first.name })
            : t('structuredAutomation.bookmarkNotRun'),
          scope: t('structuredAutomation.bookmarkScope'),
        };
      });
    });

  const inspectNotes = () =>
    runRecipe(t('structuredAutomation.notes'), async (runtime) =>
      runtime.run(async (context) => {
        let syncRounds = 0;
        const footnotes = context.document.footnotes;
        const endnotes = context.document.endnotes;
        footnotes.load();
        endnotes.load();
        await context.sync();
        syncRounds += 1;

        const notes = [...footnotes.items, ...endnotes.items];
        for (const note of notes) {
          note.load(['type', 'text']);
        }
        await context.sync();
        syncRounds += 1;
        return {
          syncRounds,
          footnoteCount: footnotes.items.length,
          endnoteCount: endnotes.items.length,
          notes: notes.map((note) => ({
            type: note.type,
            sample: textSample(note.text),
          })),
        };
      })
    );

  const inspectContentControls = () =>
    runRecipe(t('structuredAutomation.contentControls'), async (runtime) =>
      runtime.run(async (context) => {
        let syncRounds = 0;
        const controls = context.document.contentControls;
        controls.load();
        await context.sync();
        syncRounds += 1;

        for (const control of controls.items) {
          control.load([
            'subtype',
            'tag',
            'title',
            'cannotEdit',
            'cannotDelete',
            'isBound',
            'text',
          ]);
        }
        await context.sync();
        syncRounds += 1;

        const metadata = () =>
          controls.items.map((control) => ({
            subtype: control.subtype,
            tag: control.tag,
            title: control.title,
            cannotEdit: control.cannotEdit,
            cannotDelete: control.cannotDelete,
            isBound: control.isBound,
            textSample: textSample(control.text),
          }));
        const before = metadata();
        const candidate = controls.items.find(
          (control) =>
            control.subtype === 'plainText' &&
            !control.cannotEdit &&
            !control.isBound &&
            control.text.length + CONTROL_MARKER.length <= 4_096
        );
        if (!candidate) {
          return {
            syncRounds,
            count: controls.items.length,
            controls: before,
            update: {
              status: 'not-run',
              reason: t('structuredAutomation.noWritableControl'),
            },
          };
        }

        const previousText = candidate.text;
        try {
          candidate.setValue({
            kind: 'text',
            text: previousText.endsWith(CONTROL_MARKER)
              ? previousText.slice(0, -CONTROL_MARKER.length)
              : `${previousText}${CONTROL_MARKER}`,
          });
          await context.sync();
          syncRounds += 1;
          candidate.load('text');
          await context.sync();
          syncRounds += 1;
          return {
            syncRounds,
            count: controls.items.length,
            controls: before,
            update: {
              status: 'applied',
              tag: candidate.tag,
              before: previousText,
              after: candidate.text,
              undo: t('structuredAutomation.undoControlValue'),
            },
          };
        } catch (error) {
          return {
            syncRounds: syncRounds + 1,
            count: controls.items.length,
            controls: before,
            update: {
              status: 'refused',
              reason: errorText(error),
              limitation: t('structuredAutomation.syncAuthority'),
            },
          };
        }
      })
    );

  const actionProps = {
    disabled: !editor || busy,
    onMouseDown: keepCaret,
  } as const;

  return (
    <aside
      className={`automation-recipes structured-automation${open ? ' automation-recipes--open' : ''}`}
    >
      <button
        type="button"
        className="automation-recipes__toggle"
        aria-expanded={open}
        aria-label={open ? t('structuredAutomation.hide') : t('structuredAutomation.show')}
        title={open ? t('structuredAutomation.hide') : t('structuredAutomation.show')}
        onMouseDown={keepCaret}
        onClick={() => setOpen((current) => !current)}
      >
        {t('structuredAutomation.badge')}
      </button>

      {open ? (
        <div className="automation-recipes__card" data-testid="structured-automation-recipes">
          <header className="automation-recipes__heading">
            <div>
              <strong>{t('structuredAutomation.title')}</strong>
              <span>{t('structuredAutomation.subtitle')}</span>
            </div>
            <button
              type="button"
              className="automation-recipes__close"
              aria-label={t('structuredAutomation.hide')}
              onMouseDown={keepCaret}
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </header>

          <div className="automation-recipes__controls">
            <div className="automation-recipes__row">
              <button {...actionProps} type="button" onClick={inspectSections}>
                {t('structuredAutomation.sections')}
              </button>
              <button {...actionProps} type="button" onClick={inspectBookmarks}>
                {t('structuredAutomation.bookmarks')}
              </button>
            </div>
            <div className="automation-recipes__row">
              <button {...actionProps} type="button" onClick={inspectNotes}>
                {t('structuredAutomation.notes')}
              </button>
              <button {...actionProps} type="button" onClick={inspectContentControls}>
                {t('structuredAutomation.contentControls')}
              </button>
            </div>
          </div>

          <section className="automation-recipes__result" aria-live="polite">
            <h3>{t('structuredAutomation.result')}</h3>
            <p data-status={reading.status}>
              {reading.status === 'idle'
                ? t('structuredAutomation.idle')
                : reading.status === 'running'
                  ? t('structuredAutomation.running', { recipe: reading.label })
                  : reading.status === 'success'
                    ? t('structuredAutomation.succeeded', { recipe: reading.label })
                    : t('structuredAutomation.failed', { recipe: reading.label })}
            </p>
            {reading.output ? <pre>{reading.output}</pre> : null}
            {reading.error ? (
              <pre className="automation-recipes__error">{reading.error}</pre>
            ) : null}
          </section>
        </div>
      ) : null}
    </aside>
  );
}
