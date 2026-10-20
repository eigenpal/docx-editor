import { useState } from 'react';
import { DocxEditor, useDocxEditor, useDocxSource, useEditorState } from '@docx-editor.dev/react';
import { reviewModule } from '@docx-editor.dev/pro';
import { DocxEditorReview } from '@docx-editor.dev/pro/react';
import { DocxEditor as Automation } from '@docx-editor.dev/editor-api/browser';
import type { RevisionBatchResult } from '@docx-editor.dev/editor-api';
import { ReviewWritesE2eBridge } from './ReviewWritesE2eBridge';

const modules = [reviewModule()];

function Controls() {
  const editor = useDocxEditor();
  const [, update] = useState(0);
  const [author, setAuthor] = useState('all');
  const [report, setReport] = useState<RevisionBatchResult | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  useEditorState((snapshot) => snapshot);
  if (!editor) return null;
  const items = editor
    .getReviewItems({ placement: false })
    .filter((item) => item.kind === 'revision');
  const resolve = (action: 'accept' | 'reject', batch: boolean) => {
    const result = editor.exec({
      type: 'resolveAllReviewChanges',
      action,
      ...(batch ? { keys: selected } : {}),
    });
    setReport(result.revisions ?? null);
    setError(result.ok ? '' : result.reason);
    setSelected([]);
    update((value) => value + 1);
  };
  const resolveStory = async (action: 'accept' | 'reject') => {
    const runtime = Automation.createBrowser(editor);
    try {
      await runtime.run(async (context) => {
        const result = context.document.revisions.resolve(action);
        await context.sync();
        setReport(result.value);
        setError('');
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      runtime.dispose();
    }
  };
  return (
    <section
      style={{ padding: 16, background: 'white', color: '#17202a', borderBottom: '1px solid #ddd' }}
    >
      <h1>Review changes in batches</h1>
      <p>
        Filter by author, select individual decisions, or process the main story. Unsupported
        changes stay pending.
      </p>
      <label>
        Author{' '}
        <select
          aria-label="Author"
          value={author}
          onChange={(event) => {
            const value = event.target.value;
            setAuthor(value);
            editor.setTrackedChangesFilter(
              value === 'all' ? null : (revision) => revision.author === value
            );
            setSelected([]);
            update((tick) => tick + 1);
          }}
        >
          <option value="all">All authors</option>
          <option>Ada</option>
          <option>Grace</option>
        </select>
      </label>
      <div style={{ display: 'flex', gap: 8, margin: '8px 0', flexWrap: 'wrap' }}>
        {(['accept', 'reject'] as const).map((action) => (
          <button
            key={action}
            disabled={!editor.can({ type: 'resolveAllReviewChanges', action }).ok}
            onClick={() => resolve(action, false)}
          >
            {action === 'accept' ? 'Accept' : 'Reject'} all changes shown
          </button>
        ))}
        <button disabled={!selected.length} onClick={() => resolve('accept', true)}>
          Accept selected
        </button>
        <button disabled={!selected.length} onClick={() => resolve('reject', true)}>
          Reject selected
        </button>
        <button
          onClick={() => {
            editor.exec({ type: 'undo' });
            setReport(null);
            update((value) => value + 1);
          }}
        >
          Undo
        </button>
        <button
          onClick={() => {
            editor.exec({ type: 'redo' });
            setReport(null);
            update((value) => value + 1);
          }}
        >
          Redo
        </button>
        <button onClick={() => void resolveStory('accept')}>Accept main story (API)</button>
        <button onClick={() => void resolveStory('reject')}>Reject main story (API)</button>
        <button
          onClick={() =>
            void (async () => {
              try {
                const bytes = await editor.save();
                editor.load(bytes);
                setReport(null);
                setSelected([]);
                setError('');
                update((value) => value + 1);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : String(cause));
              }
            })()
          }
        >
          Save and reopen
        </button>
      </div>
      <div
        role="group"
        aria-label="Pending revisions"
        style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}
      >
        {items.map((item) => (
          <label key={item.key}>
            <input
              type="checkbox"
              checked={selected.includes(item.key)}
              onChange={(event) =>
                setSelected((keys) =>
                  event.target.checked
                    ? [...keys, item.key]
                    : keys.filter((key) => key !== item.key)
                )
              }
            />
            {item.author}: {item.text || item.revisionKind}
            {item.readOnly ? ' (unsupported)' : ''}
          </label>
        ))}
      </div>
      <p role="status" aria-label="Batch result">
        {report
          ? `${report.resolved.length} resolved; ${report.skipped.length} skipped; ${report.remaining} remaining.`
          : `${items.length} changes shown.`}
      </p>
      {report?.skipped.map((item) => (
        <p key={item.key}>
          {item.revision?.author ?? 'Unknown revision'}: {item.reason}
        </p>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

/** A runnable integration example using public editor and automation APIs. */
export function BulkReviewDemo({ fixtureUrl }: { fixtureUrl: string }) {
  const { document, error } = useDocxSource(fixtureUrl);
  if (error) return <p role="alert">{error.message}</p>;
  if (!document) return <p>Loading review document…</p>;
  return (
    <DocxEditor.Root document={document} modules={modules} author="Demo reviewer" mode="edit">
      <Controls />
      <ReviewWritesE2eBridge />
      <DocxEditor.Viewport style={{ flex: 1 }}>
        <DocxEditor.Content />
        <DocxEditorReview />
      </DocxEditor.Viewport>
    </DocxEditor.Root>
  );
}
