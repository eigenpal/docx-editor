import { useState } from 'react';
import { useDocxEditor, useTranslation } from '@docx-editor.dev/react';
import {
  DocxEditor as AutomationDocxEditor,
  isDocxEditorError,
  type DocxEditorRuntime,
} from '@docx-editor.dev/editor-api/browser';
import { keepCaret } from './demoButtons';

type RecipeStatus = 'idle' | 'running' | 'success' | 'error' | 'expected-error';

interface RecipeReading {
  readonly label: string;
  readonly status: RecipeStatus;
  readonly output?: string;
  readonly error?: string;
}

const IDLE_READING: RecipeReading = { label: '', status: 'idle' };
const INSERTED_TEXT = ' [automation]';

function errorText(error: unknown): string {
  if (isDocxEditorError(error)) {
    return `${error.code}${error.target ? ` · ${error.target}` : ''}\n${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function printable(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

/**
 * Host-only examples over the public browser automation entry point.
 *
 * Each click borrows the live editor for one recipe and disposes only that runtime afterward.
 * The editor, its selection, and its undo history remain owned by `DocxEditor.Root`.
 */
export function AutomationRecipes() {
  const { t } = useTranslation();
  const editor = useDocxEditor();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('the');
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

  const inspectDocument = () =>
    runRecipe(t('automationRecipes.inspect'), async (runtime) =>
      runtime.run(async (context) => {
        const body = context.document.body;
        const paragraphs = body.paragraphs;
        body.load('text');
        paragraphs.load();
        await context.sync();
        for (const paragraph of paragraphs.items.slice(0, 8)) {
          paragraph.load(['text', 'uniqueLocalId']);
        }
        await context.sync();
        return {
          bodyTextLength: body.text.length,
          bodyTextPreview: body.text.slice(0, 2_000),
          paragraphCount: paragraphs.items.length,
          firstParagraphs: paragraphs.items.slice(0, 8).map((paragraph) => ({
            id: paragraph.uniqueLocalId,
            text: paragraph.text,
          })),
        };
      })
    );

  const searchDocument = () =>
    runRecipe(t('automationRecipes.search'), async (runtime) =>
      runtime.run(async (context) => {
        const matches = context.document.body.search(query);
        matches.load();
        await context.sync();
        for (const match of matches.items.slice(0, 20)) match.load('text');
        await context.sync();
        return {
          query,
          matchCount: matches.items.length,
          firstMatches: matches.items.slice(0, 20).map((match) => match.text),
        };
      })
    );

  const insertText = () =>
    runRecipe(t('automationRecipes.insert'), async (runtime) =>
      runtime.run(async (context) => {
        const paragraphs = context.document.body.paragraphs;
        paragraphs.load();
        await context.sync();
        const first = paragraphs.items[0];
        if (!first) throw new Error(t('automationRecipes.noParagraphs'));
        const written = first.insertText(INSERTED_TEXT, 'End');
        await context.sync();
        written.load('text');
        first.load('text');
        await context.sync();
        return { inserted: written.text, paragraphText: first.text };
      })
    );

  const toggleBold = () =>
    runRecipe(t('automationRecipes.format'), async (runtime) =>
      runtime.run(async (context) => {
        const paragraphs = context.document.body.paragraphs;
        paragraphs.load();
        await context.sync();
        const first = paragraphs.items[0];
        if (!first) throw new Error(t('automationRecipes.noParagraphs'));
        first.font.load('bold');
        await context.sync();
        const before = first.font.bold;
        first.font.bold = before !== true;
        await context.sync();
        first.font.load('bold');
        await context.sync();
        return { property: 'font.bold', before, after: first.font.bold };
      })
    );

  const selectFirstMatch = () =>
    runRecipe(t('automationRecipes.select'), async (runtime) => {
      if (!runtime.capabilities.selection) {
        throw new Error(t('automationRecipes.selectionUnavailable'));
      }
      return runtime.run(async (context) => {
        const matches = context.document.body.search(query);
        matches.load();
        await context.sync();
        const first = matches.items[0];
        if (!first) throw new Error(t('automationRecipes.noMatch'));
        first.load('text');
        first.select();
        await context.sync();
        return { selected: first.text, selection: runtime.capabilities.selection };
      });
    });

  const showCapabilities = () =>
    runRecipe(t('automationRecipes.capabilities'), async (runtime) => runtime.capabilities);

  const showExpectedError = async (): Promise<void> => {
    if (!editor || busy) return;
    const label = t('automationRecipes.expectedError');
    setReading({ label, status: 'running' });
    const runtime = AutomationDocxEditor.createBrowser(editor);
    try {
      await runtime.run(async (context) => context.document.body.text);
      setReading({
        label,
        status: 'error',
        error: t('automationRecipes.expectedErrorMissing'),
      });
    } catch (error) {
      const expected = isDocxEditorError(error) && error.code === 'PropertyNotLoaded';
      setReading({
        label,
        status: expected ? 'expected-error' : 'error',
        error: errorText(error),
      });
    } finally {
      runtime.dispose();
    }
  };

  const actionProps = {
    disabled: !editor || busy,
    onMouseDown: keepCaret,
  } as const;

  return (
    <aside className={`automation-recipes${open ? ' automation-recipes--open' : ''}`}>
      <button
        type="button"
        className="automation-recipes__toggle"
        aria-expanded={open}
        aria-label={open ? t('automationRecipes.hide') : t('automationRecipes.show')}
        title={open ? t('automationRecipes.hide') : t('automationRecipes.show')}
        onMouseDown={keepCaret}
        onClick={() => setOpen((current) => !current)}
      >
        {t('automationRecipes.badge')}
      </button>

      {open ? (
        <div className="automation-recipes__card" data-testid="automation-recipes">
          <header className="automation-recipes__heading">
            <div>
              <strong>{t('automationRecipes.title')}</strong>
              <span>{t('automationRecipes.subtitle')}</span>
            </div>
            <button
              type="button"
              className="automation-recipes__close"
              aria-label={t('automationRecipes.hide')}
              onMouseDown={keepCaret}
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </header>

          <div className="automation-recipes__controls">
            <button {...actionProps} type="button" onClick={inspectDocument}>
              {t('automationRecipes.inspect')}
            </button>
            <label>
              <span>{t('automationRecipes.query')}</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label={t('automationRecipes.query')}
              />
            </label>
            <div className="automation-recipes__row">
              <button
                {...actionProps}
                type="button"
                disabled={!editor || busy || !query}
                onClick={searchDocument}
              >
                {t('automationRecipes.search')}
              </button>
              <button
                {...actionProps}
                type="button"
                disabled={!editor || busy || !query}
                onClick={selectFirstMatch}
              >
                {t('automationRecipes.select')}
              </button>
            </div>
            <div className="automation-recipes__row">
              <button {...actionProps} type="button" onClick={insertText}>
                {t('automationRecipes.insert')}
              </button>
              <button {...actionProps} type="button" onClick={toggleBold}>
                {t('automationRecipes.format')}
              </button>
            </div>
            <div className="automation-recipes__row">
              <button {...actionProps} type="button" onClick={showCapabilities}>
                {t('automationRecipes.capabilities')}
              </button>
              <button {...actionProps} type="button" onClick={showExpectedError}>
                {t('automationRecipes.expectedError')}
              </button>
            </div>
          </div>

          <section className="automation-recipes__result" aria-live="polite">
            <h3>{t('automationRecipes.result')}</h3>
            <p data-status={reading.status}>
              {reading.status === 'idle'
                ? t('automationRecipes.idle')
                : reading.status === 'running'
                  ? t('automationRecipes.running', { recipe: reading.label })
                  : reading.status === 'expected-error'
                    ? t('automationRecipes.expectedErrorStatus', { recipe: reading.label })
                    : reading.status === 'success'
                      ? t('automationRecipes.succeeded', { recipe: reading.label })
                      : t('automationRecipes.failed', { recipe: reading.label })}
            </p>
            {reading.output ? <pre>{reading.output}</pre> : null}
            {reading.error ? (
              <pre className="automation-recipes__error">{reading.error}</pre>
            ) : null}
          </section>

          <p className="automation-recipes__license">{t('automationRecipes.license')}</p>
        </div>
      ) : null}
    </aside>
  );
}
