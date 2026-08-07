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
 * Comment-model test equipment over the public browser automation entry.
 *
 * Output keeps the API's property names verbatim. Authored labels and diagnostics go through the
 * shared catalog, while file-derived comment text is rendered only through React text nodes.
 */
export function CommentAutomationRecipes() {
  const { t } = useTranslation();
  const editor = useDocxEditor();
  const undo = useEditorCommand('history.undo');
  const [open, setOpen] = useState(false);
  const [commentText, setCommentText] = useState('Automation root comment');
  const [replyText, setReplyText] = useState('Automation reply');
  const [reading, setReading] = useState<RecipeReading>(IDLE_READING);
  const busy = reading.status === 'running';

  const runRecipe = async (
    label: string,
    recipe: (runtime: DocxEditorRuntime) => Promise<unknown>
  ): Promise<void> => {
    if (!editor || busy) return;
    setReading({ label, status: 'running' });
    const runtime = AutomationDocxEditor.createBrowser(editor, { author: 'Demo Reviewer' });
    try {
      const output = await recipe(runtime);
      setReading({ label, status: 'success', output: printable(output) });
    } catch (error) {
      setReading({ label, status: 'error', error: errorText(error) });
    } finally {
      runtime.dispose();
    }
  };

  const inspectComments = () =>
    runRecipe(t('commentAutomation.inspect'), async (runtime) =>
      runtime.run(async (context) => {
        let syncRounds = 0;
        const comments = context.document.comments;
        comments.load('items');
        await context.sync();
        syncRounds += 1;

        const ranges = comments.items.map((comment) => {
          comment.load(['id', 'authorName', 'creationDate', 'text', 'resolved']);
          comment.replies.load('items');
          return comment.getRange();
        });
        await context.sync();
        syncRounds += 1;

        for (const range of ranges) range.load('text');
        for (const comment of comments.items) {
          for (const reply of comment.replies.items) {
            reply.load(['id', 'authorName', 'creationDate', 'text']);
          }
        }
        await context.sync();
        syncRounds += 1;

        return {
          syncRounds,
          count: comments.items.length,
          comments: comments.items.map((comment, index) => ({
            id: comment.id,
            authorName: comment.authorName,
            creationDate: dateText(comment.creationDate),
            text: comment.text,
            anchorText: ranges[index]!.text,
            resolved: comment.resolved,
            replies: comment.replies.items.map((reply) => ({
              id: reply.id,
              authorName: reply.authorName,
              creationDate: dateText(reply.creationDate),
              text: reply.text,
            })),
          })),
        };
      })
    );

  const selectFirstAnchor = () =>
    runRecipe(t('commentAutomation.select'), async (runtime) => {
      if (!runtime.capabilities.selection) {
        return {
          syncRounds: 0,
          status: 'not-supported',
          reason: t('commentAutomation.selectionUnsupported'),
        };
      }
      return runtime.run(async (context) => {
        let syncRounds = 0;
        const comments = context.document.comments;
        comments.load('items');
        await context.sync();
        syncRounds += 1;
        const first = comments.items[0];
        if (!first) {
          return { syncRounds, status: 'not-run', reason: t('commentAutomation.noComments') };
        }

        first.load('id');
        const range = first.getRange();
        await context.sync();
        syncRounds += 1;
        range.load('text');
        range.select();
        await context.sync();
        syncRounds += 1;
        return {
          syncRounds,
          status: 'selected-and-revealed',
          commentId: first.id,
          anchorText: range.text,
        };
      });
    });

  const addReply = () =>
    runRecipe(t('commentAutomation.reply'), async (runtime) =>
      runtime.run(async (context) => {
        let syncRounds = 0;
        const comments = context.document.comments;
        comments.load('items');
        await context.sync();
        syncRounds += 1;
        const first = comments.items[0];
        if (!first) {
          return { syncRounds, status: 'not-run', reason: t('commentAutomation.noComments') };
        }

        // There is deliberately no static comment-write capability. The current Pro module,
        // editing mode, and document state are checked atomically when this sync reaches the host.
        const reply = first.reply(replyText);
        await context.sync();
        syncRounds += 1;
        reply.load(['id', 'authorName', 'creationDate', 'text']);
        await context.sync();
        syncRounds += 1;
        return {
          syncRounds,
          status: 'applied',
          reply: {
            id: reply.id,
            authorName: reply.authorName,
            creationDate: dateText(reply.creationDate),
            text: reply.text,
          },
          undo: t('commentAutomation.undoReply'),
        };
      })
    );

  const createComment = () =>
    runRecipe(t('commentAutomation.create'), async (runtime) =>
      runtime.run(async (context) => {
        const comments = context.document.comments;
        comments.load('items');
        await context.sync();
        const first = comments.items[0];
        if (!first) {
          return { status: 'not-run', reason: t('commentAutomation.noComments') };
        }
        const anchor = first.getRange();
        await context.sync();
        const created = anchor.insertComment(commentText);
        await context.sync();
        created.load(['id', 'authorName', 'text']);
        await context.sync();
        return {
          status: 'applied',
          comment: {
            id: created.id,
            authorName: created.authorName,
            text: created.text,
          },
          undo: t('commentAutomation.undoCreate'),
        };
      })
    );

  const toggleResolved = () =>
    runRecipe(t('commentAutomation.resolve'), async (runtime) =>
      runtime.run(async (context) => {
        let syncRounds = 0;
        const comments = context.document.comments;
        comments.load('items');
        await context.sync();
        syncRounds += 1;
        const first = comments.items[0];
        if (!first) {
          return { syncRounds, status: 'not-run', reason: t('commentAutomation.noComments') };
        }

        first.load(['id', 'resolved']);
        await context.sync();
        syncRounds += 1;
        const before = first.resolved;
        first.resolved = !before;
        await context.sync();
        syncRounds += 1;
        first.load('resolved');
        await context.sync();
        syncRounds += 1;
        return {
          syncRounds,
          status: 'applied',
          commentId: first.id,
          before,
          after: first.resolved,
          undo: t('commentAutomation.undoResolved'),
        };
      })
    );

  const deleteFirstReply = () =>
    runRecipe(t('commentAutomation.deleteReply'), async (runtime) =>
      runtime.run(async (context) => {
        const comments = context.document.comments;
        comments.load('items');
        await context.sync();
        const first = comments.items[0];
        if (!first) return { status: 'not-run', reason: t('commentAutomation.noComments') };
        first.replies.load('items');
        await context.sync();
        const reply = first.replies.items[0];
        if (!reply) return { status: 'not-run', reason: t('commentAutomation.noReplies') };
        reply.delete();
        await context.sync();
        return { status: 'applied', undo: t('commentAutomation.undoDeleteReply') };
      })
    );

  const deleteFirstComment = () =>
    runRecipe(t('commentAutomation.deleteComment'), async (runtime) =>
      runtime.run(async (context) => {
        const comments = context.document.comments;
        comments.load('items');
        await context.sync();
        const first = comments.items[0];
        if (!first) return { status: 'not-run', reason: t('commentAutomation.noComments') };
        first.delete();
        await context.sync();
        return { status: 'applied', undo: t('commentAutomation.undoDeleteComment') };
      })
    );

  const actionProps = {
    disabled: !editor || busy,
    onMouseDown: keepCaret,
  } as const;

  return (
    <aside
      className={`automation-recipes comment-automation${open ? ' automation-recipes--open' : ''}`}
    >
      <button
        type="button"
        className="automation-recipes__toggle"
        aria-expanded={open}
        aria-label={open ? t('commentAutomation.hide') : t('commentAutomation.show')}
        title={open ? t('commentAutomation.hide') : t('commentAutomation.show')}
        onMouseDown={keepCaret}
        onClick={() => setOpen((current) => !current)}
      >
        {t('commentAutomation.badge')}
      </button>

      {open ? (
        <div className="automation-recipes__card" data-testid="comment-automation-recipes">
          <header className="automation-recipes__heading">
            <div>
              <strong>{t('commentAutomation.title')}</strong>
              <span>{t('commentAutomation.subtitle')}</span>
            </div>
            <button
              type="button"
              className="automation-recipes__close"
              aria-label={t('commentAutomation.hide')}
              onMouseDown={keepCaret}
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </header>

          <div className="automation-recipes__controls">
            <div className="automation-recipes__row">
              <button {...actionProps} type="button" onClick={inspectComments}>
                {t('commentAutomation.inspect')}
              </button>
              <button {...actionProps} type="button" onClick={selectFirstAnchor}>
                {t('commentAutomation.select')}
              </button>
            </div>
            <label>
              <span>{t('commentAutomation.commentText')}</span>
              <input
                value={commentText}
                onChange={(event) => setCommentText(event.target.value)}
                aria-label={t('commentAutomation.commentText')}
              />
            </label>
            <button
              {...actionProps}
              type="button"
              disabled={!editor || busy || commentText.length === 0}
              onClick={createComment}
            >
              {t('commentAutomation.create')}
            </button>
            <label>
              <span>{t('commentAutomation.replyText')}</span>
              <input
                value={replyText}
                onChange={(event) => setReplyText(event.target.value)}
                aria-label={t('commentAutomation.replyText')}
              />
            </label>
            <div className="automation-recipes__row">
              <button
                {...actionProps}
                type="button"
                disabled={!editor || busy || replyText.length === 0}
                onClick={addReply}
              >
                {t('commentAutomation.reply')}
              </button>
              <button {...actionProps} type="button" onClick={toggleResolved}>
                {t('commentAutomation.resolve')}
              </button>
            </div>
            <div className="automation-recipes__row">
              <button {...actionProps} type="button" onClick={deleteFirstReply}>
                {t('commentAutomation.deleteReply')}
              </button>
              <button {...actionProps} type="button" onClick={deleteFirstComment}>
                {t('commentAutomation.deleteComment')}
              </button>
            </div>
            <button
              type="button"
              disabled={busy || !undo.isEnabled}
              title={undo.disabledReason ?? undefined}
              onMouseDown={keepCaret}
              onClick={undo.execute}
            >
              {t('commentAutomation.undo')}
            </button>
          </div>

          <section className="automation-recipes__result" aria-live="polite">
            <h3>{t('commentAutomation.result')}</h3>
            <p data-status={reading.status}>
              {reading.status === 'idle'
                ? t('commentAutomation.idle')
                : reading.status === 'running'
                  ? t('commentAutomation.running', { recipe: reading.label })
                  : reading.status === 'success'
                    ? t('commentAutomation.succeeded', { recipe: reading.label })
                    : t('commentAutomation.failed', { recipe: reading.label })}
            </p>
            {reading.output ? <pre>{reading.output}</pre> : null}
            {reading.error ? (
              <pre className="automation-recipes__error">{reading.error}</pre>
            ) : null}
          </section>

          <div className="automation-recipes__boundaries">
            <strong>{t('commentAutomation.boundaries')}</strong>
            <ul>
              <li>{t('commentAutomation.creationSemantics')}</li>
              <li>{t('commentAutomation.deleteSemantics')}</li>
              <li>{t('commentAutomation.replyCapability')}</li>
              <li>{t('commentAutomation.fixture')}</li>
            </ul>
          </div>
          <p className="automation-recipes__license">{t('commentAutomation.license')}</p>
        </div>
      ) : null}
    </aside>
  );
}
