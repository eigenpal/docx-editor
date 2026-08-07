import { useState } from 'react';
import { useDocxEditor, useTranslation } from '@docx-editor.dev/react';
import {
  DocxEditor as BrowserAutomationDocxEditor,
  type DocxEditorRuntime,
} from '@docx-editor.dev/editor-api/browser';
import {
  DocxEditor as ServerAutomationDocxEditor,
  isDocxEditorError,
  type DocxEditorErrorCode,
  type DocumentCapabilities,
} from '@docx-editor.dev/editor-api';
import { keepCaret } from './demoButtons';

interface DocumentReading {
  readonly bodyText: string;
  readonly firstParagraph: null | {
    readonly text: string;
    readonly bold: boolean | null;
  };
}

interface ErrorReading {
  readonly expected: DocxEditorErrorCode;
  readonly actual: string;
  readonly target?: string;
  readonly expectedRevision?: number;
  readonly actualRevision?: number;
}

interface PreparedHandoff {
  readonly bytes: Uint8Array;
  readonly expected: DocumentReading;
  readonly report: Record<string, unknown>;
}

const DETACHED_MARKER = ' [detached server]';

function errorReading(error: unknown, expected: DocxEditorErrorCode): ErrorReading {
  if (!isDocxEditorError(error)) {
    return { expected, actual: error instanceof Error ? error.name : typeof error };
  }
  return {
    expected,
    actual: error.code,
    ...(error.target === undefined ? {} : { target: error.target }),
    ...(error.expectedRevision === undefined ? {} : { expectedRevision: error.expectedRevision }),
    ...(error.actualRevision === undefined ? {} : { actualRevision: error.actualRevision }),
  };
}

async function captureError(
  expected: DocxEditorErrorCode,
  action: () => unknown | Promise<unknown>
): Promise<ErrorReading> {
  try {
    await action();
    return { expected, actual: 'no error' };
  } catch (error) {
    return errorReading(error, expected);
  }
}

async function readDocument(runtime: DocxEditorRuntime): Promise<DocumentReading> {
  return runtime.run(async (context) => {
    const body = context.document.body;
    const paragraphs = body.paragraphs;
    body.load('text');
    paragraphs.load();
    await context.sync();
    const first = paragraphs.items[0];
    if (first) {
      first.load('text');
      first.font.load('bold');
      await context.sync();
    }
    return {
      bodyText: body.text,
      firstParagraph: first ? { text: first.text, bold: first.font.bold } : null,
    };
  });
}

async function staleError(bytes: Uint8Array): Promise<ErrorReading> {
  const runtime = await ServerAutomationDocxEditor.createServer(bytes);
  try {
    return await runtime.run(async (outer) => {
      const paragraphs = outer.document.body.paragraphs;
      paragraphs.load();
      await outer.sync();
      const first = paragraphs.items[0];
      if (!first) throw new Error('The document has no paragraph for the stale-write probe.');

      await runtime.run(async (inner) => {
        const competing = inner.document.body.paragraphs;
        competing.load();
        await inner.sync();
        competing.items[0]?.insertText('[competing write] ', 'Start');
        await inner.sync();
      });

      first.insertText('[stale write] ', 'Start');
      return captureError('StaleDocument', () => outer.sync());
    });
  } finally {
    runtime.dispose();
  }
}

function sameReading(left: DocumentReading, right: DocumentReading): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * A bytes-to-bytes server workflow beside the live browser editor.
 *
 * Preparing never loads into the editor. The second button is the explicit ownership handoff.
 */
export function ServerAutomationRecipe() {
  const { t } = useTranslation();
  const editor = useDocxEditor();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('the');
  const [busy, setBusy] = useState(false);
  const [prepared, setPrepared] = useState<PreparedHandoff | null>(null);
  const [status, setStatus] = useState<'idle' | 'prepared' | 'loaded' | 'error'>('idle');
  const [output, setOutput] = useState('');

  const prepare = async (): Promise<void> => {
    if (!editor || busy || !query) return;
    setBusy(true);
    setPrepared(null);
    try {
      const liveBeforeRuntime = BrowserAutomationDocxEditor.createBrowser(editor);
      const liveBefore = await readDocument(liveBeforeRuntime);
      const browserCapabilities = liveBeforeRuntime.capabilities;
      liveBeforeRuntime.dispose();

      const saved = await editor.save();
      const sourceBytes = new Uint8Array(saved);
      const callerOwnedInput = sourceBytes.slice();
      const detached = await ServerAutomationDocxEditor.createServer(callerOwnedInput);
      const capabilities: DocumentCapabilities = detached.capabilities;

      // `createServer` has finished its bounded parse and does not retain the caller's buffer.
      callerOwnedInput.fill(0);

      const unloaded = await detached.run(async (context) =>
        captureError('PropertyNotLoaded', () => context.document.body.text)
      );
      const edited = await detached.run(async (context) => {
        const body = context.document.body;
        const paragraphs = body.paragraphs;
        const matches = body.search(query);
        body.load('text');
        paragraphs.load();
        matches.load();
        await context.sync();

        const first = paragraphs.items[0];
        for (const match of matches.items.slice(0, 8)) match.load('text');
        if (first) {
          first.load('text');
          first.font.load('bold');
        }
        await context.sync();

        const before = {
          bodyTextLength: body.text.length,
          query,
          matchCount: matches.items.length,
          firstMatches: matches.items.slice(0, 8).map((match) => match.text),
          firstParagraph: first ? { text: first.text, bold: first.font.bold } : null,
        };
        if (first) {
          first.insertText(DETACHED_MARKER, 'End');
          await context.sync();
          first.font.bold = true;
          await context.sync();
        }
        body.load('text');
        if (first) {
          first.load('text');
          first.font.load('bold');
        }
        await context.sync();
        return {
          before,
          after: {
            bodyText: body.text,
            firstParagraph: first ? { text: first.text, bold: first.font.bold } : null,
          },
        };
      });

      // Every save result is caller-owned. Corrupting one result cannot corrupt a later save.
      const discardedSave = await detached.save();
      discardedSave.fill(0);
      const detachedBytes = await detached.save();
      detached.dispose();
      const disposed = await captureError('RuntimeDisposed', () => detached.save());
      const stale = await staleError(sourceBytes);
      const reopened = await ServerAutomationDocxEditor.createServer(detachedBytes);
      const reopenedReading = await readDocument(reopened);
      reopened.dispose();

      const liveAfterRuntime = BrowserAutomationDocxEditor.createBrowser(editor);
      const liveBeforeLoad = await readDocument(liveAfterRuntime);
      liveAfterRuntime.dispose();
      const report = {
        capabilities: { server: capabilities, browser: browserCapabilities },
        inspectionSearchMutationAndFormatting: edited,
        liveDocumentUnchangedBeforeExplicitLoad: sameReading(liveBefore, liveBeforeLoad),
        liveBefore,
        liveBeforeLoad,
        saveReopen: {
          matchesDetachedResult: sameReading(reopenedReading, edited.after),
          reopened: reopenedReading,
        },
        byteOwnership: {
          inputBufferMayBeReusedAfterCreateServer: true,
          eachSaveReturnsCallerOwnedBytes: true,
          returnedByteLength: detachedBytes.byteLength,
        },
        expectedErrors: { unloaded, disposed, stale },
      };
      setPrepared({ bytes: detachedBytes, expected: edited.after, report });
      setOutput(JSON.stringify(report, null, 2));
      setStatus('prepared');
    } catch (error) {
      setStatus('error');
      setOutput(
        isDocxEditorError(error)
          ? JSON.stringify(errorReading(error, error.code), null, 2)
          : error instanceof Error
            ? error.stack || error.message
            : String(error)
      );
    } finally {
      setBusy(false);
    }
  };

  const loadPrepared = async (): Promise<void> => {
    if (!editor || !prepared || busy) return;
    setBusy(true);
    try {
      editor.load(prepared.bytes);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const runtime = BrowserAutomationDocxEditor.createBrowser(editor);
      const loaded = await readDocument(runtime);
      runtime.dispose();
      setOutput(
        JSON.stringify(
          {
            ...prepared.report,
            explicitLoad: {
              loadedMatchesDetachedResult: sameReading(loaded, prepared.expected),
              loaded,
            },
          },
          null,
          2
        )
      );
      setStatus('loaded');
    } catch (error) {
      setStatus('error');
      setOutput(error instanceof Error ? error.stack || error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const actionProps = {
    disabled: !editor || busy,
    onMouseDown: keepCaret,
  } as const;

  return (
    <aside
      className={`automation-recipes server-automation${open ? ' automation-recipes--open' : ''}`}
    >
      <button
        type="button"
        className="automation-recipes__toggle"
        aria-expanded={open}
        aria-label={open ? t('serverAutomation.hide') : t('serverAutomation.show')}
        title={open ? t('serverAutomation.hide') : t('serverAutomation.show')}
        onMouseDown={keepCaret}
        onClick={() => setOpen((current) => !current)}
      >
        {t('serverAutomation.badge')}
      </button>
      {open ? (
        <div className="automation-recipes__card" data-testid="server-automation-recipe">
          <header className="automation-recipes__heading">
            <div>
              <strong>{t('serverAutomation.title')}</strong>
              <span>{t('serverAutomation.subtitle')}</span>
            </div>
            <button
              type="button"
              className="automation-recipes__close"
              aria-label={t('serverAutomation.hide')}
              onMouseDown={keepCaret}
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </header>
          <div className="automation-recipes__controls">
            <label>
              <span>{t('serverAutomation.query')}</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label={t('serverAutomation.query')}
              />
            </label>
            <button
              {...actionProps}
              type="button"
              disabled={!editor || busy || !query}
              onClick={() => void prepare()}
            >
              {t('serverAutomation.prepare')}
            </button>
            <button
              {...actionProps}
              type="button"
              disabled={!editor || busy || !prepared}
              onClick={() => void loadPrepared()}
            >
              {t('serverAutomation.load')}
            </button>
          </div>
          <section className="automation-recipes__result" aria-live="polite">
            <h3>{t('serverAutomation.result')}</h3>
            <p data-status={status}>
              {busy
                ? t('serverAutomation.running')
                : status === 'prepared'
                  ? t('serverAutomation.prepared')
                  : status === 'loaded'
                    ? t('serverAutomation.loaded')
                    : status === 'error'
                      ? t('serverAutomation.failed')
                      : t('serverAutomation.idle')}
            </p>
            {output ? <pre>{output}</pre> : null}
          </section>
          <p className="automation-recipes__license">{t('automationRecipes.license')}</p>
        </div>
      ) : null}
    </aside>
  );
}
