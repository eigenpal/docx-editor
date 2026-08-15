import { useState } from 'react';
import { useDocxEditor, useTranslation } from '@docx-editor.dev/react';
import {
  DocxEditor as BrowserAutomationDocxEditor,
  type DocxEditorRuntime,
} from '@docx-editor.dev/editor-api/browser';
import {
  DocxEditor as ServerAutomationDocxEditor,
  isDocxEditorError,
} from '@docx-editor.dev/editor-api';
import { keepCaret } from './demoButtons';

interface DocumentReading {
  readonly bodyText: string;
  readonly firstParagraph: null | {
    readonly text: string;
    readonly bold: boolean | null;
  };
}

interface PreparedHandoff {
  readonly bytes: Uint8Array;
  readonly expected: DocumentReading;
  readonly report: Record<string, unknown>;
}

const DETACHED_MARKER = ' [detached server]';

async function usingRuntime<R extends { dispose(): void }, T>(
  runtime: R,
  work: (runtime: R) => Promise<T>
): Promise<T> {
  try {
    return await work(runtime);
  } finally {
    runtime.dispose();
  }
}

function formatFailure(error: unknown): string {
  if (isDocxEditorError(error)) {
    return JSON.stringify(
      {
        code: error.code,
        ...(error.target === undefined ? {} : { target: error.target }),
        ...(error.expectedRevision === undefined
          ? {}
          : { expectedRevision: error.expectedRevision }),
        ...(error.actualRevision === undefined ? {} : { actualRevision: error.actualRevision }),
      },
      null,
      2
    );
  }
  return error instanceof Error ? error.stack || error.message : String(error);
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

function sameReading(left: DocumentReading, right: DocumentReading): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * A bytes-to-bytes server workflow beside the live browser editor.
 *
 * Preparing never loads into the editor. The second button is the explicit ownership handoff.
 */
export function ServerAutomationRecipe({ onClose }: { readonly onClose: () => void }) {
  const { t } = useTranslation();
  const editor = useDocxEditor();
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
      const liveBefore = await usingRuntime(
        BrowserAutomationDocxEditor.createBrowser(editor),
        readDocument
      );

      const callerOwnedInput = new Uint8Array(await editor.save());
      const { detachedBytes, edited } = await usingRuntime(
        await ServerAutomationDocxEditor.createServer(callerOwnedInput),
        async (detached) => {
          // `createServer` has finished its bounded parse and does not retain the caller's buffer.
          callerOwnedInput.fill(0);

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
          return { detachedBytes: await detached.save(), edited };
        }
      );

      const reopenedReading = await usingRuntime(
        await ServerAutomationDocxEditor.createServer(detachedBytes),
        readDocument
      );
      const liveBeforeLoad = await usingRuntime(
        BrowserAutomationDocxEditor.createBrowser(editor),
        readDocument
      );
      const report = {
        inspectionSearchMutationAndFormatting: edited,
        liveDocumentUnchangedBeforeExplicitLoad: sameReading(liveBefore, liveBeforeLoad),
        liveBefore,
        liveBeforeLoad,
        saveReopen: {
          matchesDetachedResult: sameReading(reopenedReading, edited.after),
          reopened: reopenedReading,
          returnedByteLength: detachedBytes.byteLength,
        },
      };
      setPrepared({ bytes: detachedBytes, expected: edited.after, report });
      setOutput(JSON.stringify(report, null, 2));
      setStatus('prepared');
    } catch (error) {
      setStatus('error');
      setOutput(formatFailure(error));
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
      const loaded = await usingRuntime(
        BrowserAutomationDocxEditor.createBrowser(editor),
        readDocument
      );
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
      setOutput(formatFailure(error));
    } finally {
      setBusy(false);
    }
  };

  const actionProps = {
    disabled: !editor || busy,
    onMouseDown: keepCaret,
  } as const;

  return (
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
          onClick={onClose}
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
      <p className="automation-recipes__license">{t('serverAutomation.license')}</p>
    </div>
  );
}
