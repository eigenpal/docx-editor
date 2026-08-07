import { useState } from 'react';
import { useDocxEditor, useEditorCommand, useTranslation } from '@docx-editor.dev/react';
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

function errorText(error: unknown): string {
  if (isDocxEditorError(error)) {
    return `${error.code}${error.target ? ` · ${error.target}` : ''}\n${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function printable(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function dateText(value: Date | null): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

/**
 * Revision-model test equipment over the public browser automation entry.
 *
 * The collection contains only changes whose individual accept/reject operations are supported.
 * Whole-collection decisions are stricter: the canonical transaction refuses if the document also
 * contains structural revision markup that the engine cannot resolve.
 */
export function RevisionAutomationRecipes() {
  const { t } = useTranslation();
  const editor = useDocxEditor();
  const undo = useEditorCommand('history.undo');
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

  const inspectRevisions = () =>
    runRecipe(t('revisionAutomation.inspect'), async (runtime) =>
      runtime.run(async (context) => {
        let syncRounds = 0;
        const revisions = context.document.revisions;
        revisions.load('items');
        await context.sync();
        syncRounds += 1;

        const ranges = revisions.items.map((revision) => {
          revision.load(['author', 'date', 'type']);
          return revision.range;
        });
        await context.sync();
        syncRounds += 1;

        for (const range of ranges) range.load('text');
        await context.sync();
        syncRounds += 1;

        return {
          syncRounds,
          count: revisions.items.length,
          revisions: revisions.items.map((revision, index) => ({
            author: revision.author,
            date: dateText(revision.date),
            type: revision.type,
            text: ranges[index]!.text,
            range: 'main-body story range',
            individuallyResolvable: true,
          })),
          structuralBoundary: t('revisionAutomation.structuralBoundary'),
        };
      })
    );

  const selectFirst = () =>
    runRecipe(t('revisionAutomation.select'), async (runtime) => {
      if (!runtime.capabilities.selection) {
        return {
          status: 'not-supported',
          reason: t('revisionAutomation.selectionUnsupported'),
        };
      }
      return runtime.run(async (context) => {
        const revisions = context.document.revisions;
        revisions.load('items');
        await context.sync();
        const first = revisions.items[0];
        if (!first) return { status: 'not-run', reason: t('revisionAutomation.noRevisions') };

        first.load(['author', 'type']);
        const range = first.range;
        await context.sync();
        range.load('text');
        range.select();
        await context.sync();
        return {
          status: 'selected-and-revealed',
          author: first.author,
          type: first.type,
          text: range.text,
        };
      });
    });

  const decideFirst = (decision: 'accept' | 'reject') =>
    runRecipe(
      decision === 'accept'
        ? t('revisionAutomation.acceptFirst')
        : t('revisionAutomation.rejectFirst'),
      async (runtime) =>
        runtime.run(async (context) => {
          const revisions = context.document.revisions;
          revisions.load('items');
          await context.sync();
          const first = revisions.items[0];
          if (!first) return { status: 'not-run', reason: t('revisionAutomation.noRevisions') };

          first.load(['author', 'type']);
          const range = first.range;
          await context.sync();
          range.load('text');
          await context.sync();
          const before = {
            author: first.author,
            type: first.type,
            text: range.text,
            individuallyResolvable: true,
          };
          if (decision === 'accept') first.accept();
          else first.reject();
          await context.sync();
          return {
            status: 'applied',
            decision,
            before,
            undo: t('revisionAutomation.undoDecision'),
          };
        })
    );

  const decideAll = (decision: 'accept' | 'reject') =>
    runRecipe(
      decision === 'accept' ? t('revisionAutomation.acceptAll') : t('revisionAutomation.rejectAll'),
      async (runtime) =>
        runtime.run(async (context) => {
          const revisions = context.document.revisions;
          revisions.load('items');
          await context.sync();
          const visibleBefore = revisions.items.length;
          if (decision === 'accept') revisions.acceptAll();
          else revisions.rejectAll();
          await context.sync();
          return {
            status: 'applied-atomically',
            decision,
            visibleBefore,
            undo: t('revisionAutomation.undoCollection'),
            structuralBoundary: t('revisionAutomation.collectionBoundary'),
          };
        })
    );

  const saveAndReopen = async (): Promise<void> => {
    if (!editor || busy) return;
    const label = t('revisionAutomation.saveReopen');
    setReading({ label, status: 'running' });
    try {
      const bytes = await editor.save();
      editor.load(bytes);
      const runtime = AutomationDocxEditor.createBrowser(editor);
      try {
        const reopened = await runtime.run(async (context) => {
          const revisions = context.document.revisions;
          revisions.load('items');
          await context.sync();
          return revisions.items.length;
        });
        setReading({
          label,
          status: 'success',
          output: printable({
            status: 'saved-and-reopened',
            bytes: bytes.byteLength,
            revisionsAfterReopen: reopened,
            browserRuntimeSave: runtime.capabilities.save,
            note: t('revisionAutomation.saveBoundary'),
          }),
        });
      } finally {
        runtime.dispose();
      }
    } catch (error) {
      setReading({ label, status: 'error', error: errorText(error) });
    }
  };

  const actionProps = {
    disabled: !editor || busy,
    onMouseDown: keepCaret,
  } as const;

  return (
    <aside
      className={`automation-recipes revision-automation${open ? ' automation-recipes--open' : ''}`}
    >
      <button
        type="button"
        className="automation-recipes__toggle"
        aria-expanded={open}
        aria-label={open ? t('revisionAutomation.hide') : t('revisionAutomation.show')}
        title={open ? t('revisionAutomation.hide') : t('revisionAutomation.show')}
        onMouseDown={keepCaret}
        onClick={() => setOpen((current) => !current)}
      >
        {t('revisionAutomation.badge')}
      </button>

      {open ? (
        <div className="automation-recipes__card" data-testid="revision-automation-recipes">
          <header className="automation-recipes__heading">
            <div>
              <strong>{t('revisionAutomation.title')}</strong>
              <span>{t('revisionAutomation.subtitle')}</span>
            </div>
            <button
              type="button"
              className="automation-recipes__close"
              aria-label={t('revisionAutomation.hide')}
              onMouseDown={keepCaret}
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </header>

          <div className="automation-recipes__controls">
            <div className="automation-recipes__row">
              <button {...actionProps} type="button" onClick={inspectRevisions}>
                {t('revisionAutomation.inspect')}
              </button>
              <button {...actionProps} type="button" onClick={selectFirst}>
                {t('revisionAutomation.select')}
              </button>
            </div>
            <div className="automation-recipes__row">
              <button {...actionProps} type="button" onClick={() => decideFirst('accept')}>
                {t('revisionAutomation.acceptFirst')}
              </button>
              <button {...actionProps} type="button" onClick={() => decideFirst('reject')}>
                {t('revisionAutomation.rejectFirst')}
              </button>
            </div>
            <div className="automation-recipes__row">
              <button {...actionProps} type="button" onClick={() => decideAll('accept')}>
                {t('revisionAutomation.acceptAll')}
              </button>
              <button {...actionProps} type="button" onClick={() => decideAll('reject')}>
                {t('revisionAutomation.rejectAll')}
              </button>
            </div>
            <div className="automation-recipes__row">
              <button
                type="button"
                disabled={busy || !undo.isEnabled}
                title={undo.disabledReason ?? undefined}
                onMouseDown={keepCaret}
                onClick={undo.execute}
              >
                {t('revisionAutomation.undo')}
              </button>
              <button {...actionProps} type="button" onClick={saveAndReopen}>
                {t('revisionAutomation.saveReopen')}
              </button>
            </div>
          </div>

          <section className="automation-recipes__result" aria-live="polite">
            <h3>{t('revisionAutomation.result')}</h3>
            <p data-status={reading.status}>
              {reading.status === 'idle'
                ? t('revisionAutomation.idle')
                : reading.status === 'running'
                  ? t('revisionAutomation.running', { recipe: reading.label })
                  : reading.status === 'success'
                    ? t('revisionAutomation.succeeded', { recipe: reading.label })
                    : t('revisionAutomation.failed', { recipe: reading.label })}
            </p>
            {reading.output ? <pre>{reading.output}</pre> : null}
            {reading.error ? (
              <pre className="automation-recipes__error">{reading.error}</pre>
            ) : null}
          </section>

          <div className="automation-recipes__boundaries">
            <strong>{t('revisionAutomation.boundaries')}</strong>
            <ul>
              <li>{t('revisionAutomation.itemBoundary')}</li>
              <li>{t('revisionAutomation.collectionBoundary')}</li>
              <li>{t('revisionAutomation.fixture')}</li>
            </ul>
          </div>
          <p className="automation-recipes__license">{t('revisionAutomation.license')}</p>
        </div>
      ) : null}
    </aside>
  );
}
