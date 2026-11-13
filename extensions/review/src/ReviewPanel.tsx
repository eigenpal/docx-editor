// The review panel: one list of every pending tracked change and comment thread.
//
// Built only on the public Editor API of @docx-editor.dev/core and the React adapter's
// hooks (Apache-2.0). Mount it anywhere under <DocxEditor.Root> (or as a child of the
// packaged <DocxEditor>), together with `reviewModule()` in the editor's `modules`.
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  Editor,
  ExecResult,
  ReviewCommentPlacement,
  ReviewItemPlacement,
  ReviewRevisionPlacement,
} from '@docx-editor.dev/core/contracts/editor';
import {
  ReviewRailContext,
  useCommentDraftRequest,
  useDocxEditor,
  useEditorState,
} from '@docx-editor.dev/react';
import { useReviewItems } from './useReviewItems';

export interface ReviewPanelLabels {
  readonly title: string;
  readonly empty: string;
  readonly accept: string;
  readonly reject: string;
  readonly reply: string;
  readonly edit: string;
  readonly resolve: string;
  readonly reopen: string;
  readonly delete: string;
  readonly save: string;
  readonly cancel: string;
  readonly comment: string;
  readonly showResolved: string;
  readonly kinds: Readonly<Record<string, string>>;
}

export const DEFAULT_REVIEW_LABELS: ReviewPanelLabels = {
  title: 'Review',
  empty: 'No comments or changes',
  accept: 'Accept',
  reject: 'Reject',
  reply: 'Reply',
  edit: 'Edit',
  resolve: 'Resolve',
  reopen: 'Reopen',
  delete: 'Delete',
  save: 'Save',
  cancel: 'Cancel',
  comment: 'Comment',
  showResolved: 'Resolved',
  kinds: {
    insert: 'Inserted',
    delete: 'Deleted',
    replace: 'Replaced',
    moveFrom: 'Moved from',
    moveTo: 'Moved to',
    format: 'Formatted',
    paragraphMark: 'Paragraph',
    structural: 'Table or section',
  },
};

export interface ReviewPanelProps {
  readonly className?: string;
  readonly labels?: Partial<ReviewPanelLabels>;
  /** Show resolved comment threads. Uncontrolled default: false. */
  readonly defaultShowResolved?: boolean;
  /** Called with every refused command, so a host can surface or log the engine's reason. */
  readonly onRefused?: (action: string, result: Extract<ExecResult, { ok: false }>) => void;
  /** Rendered above the list, beside the title. */
  readonly headerExtra?: ReactNode;
  /**
   * Register with the editor as its review column, so the toolbar's and context menu's
   * Add comment controls appear and open the draft here. Default: true.
   */
  readonly registerAsRail?: boolean;
}

interface Thread {
  readonly root: ReviewCommentPlacement;
  readonly replies: readonly ReviewCommentPlacement[];
}

type Entry =
  | { readonly kind: 'revision'; readonly item: ReviewRevisionPlacement }
  | { readonly kind: 'thread'; readonly thread: Thread };

function buildEntries(items: readonly ReviewItemPlacement[], showResolved: boolean): Entry[] {
  const byId = new Map<string, ReviewCommentPlacement>();
  for (const item of items) if (item.kind === 'comment') byId.set(item.id, item);
  const replies = new Map<string, ReviewCommentPlacement[]>();
  const entries: Entry[] = [];
  for (const item of items) {
    if (item.kind === 'revision') {
      entries.push({ kind: 'revision', item });
    } else if (item.kind === 'comment') {
      if (item.parentId && byId.has(item.parentId)) {
        const list = replies.get(item.parentId) ?? [];
        list.push(item);
        replies.set(item.parentId, list);
      } else {
        entries.push({ kind: 'thread', thread: { root: item, replies: [] } });
      }
    }
  }
  return entries
    .map((entry) =>
      entry.kind === 'thread'
        ? {
            kind: 'thread' as const,
            thread: { root: entry.thread.root, replies: replies.get(entry.thread.root.id) ?? [] },
          }
        : entry
    )
    .filter((entry) => showResolved || entry.kind !== 'thread' || !entry.thread.root.resolved);
}

function formatDate(value: string | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ReviewPanel({
  className,
  labels: labelOverrides,
  defaultShowResolved = false,
  onRefused,
  headerExtra,
  registerAsRail = true,
}: ReviewPanelProps) {
  const editor = useDocxEditor();
  // `register` is stable while the registry object changes with its counts.
  const register = useContext(ReviewRailContext)?.register;
  useEffect(
    () => (registerAsRail && register ? register() : undefined),
    [register, registerAsRail]
  );
  const labels = useMemo(() => ({ ...DEFAULT_REVIEW_LABELS, ...labelOverrides }), [labelOverrides]);
  const editingMode = useEditorState((snapshot) => snapshot.editingMode ?? 'editing');
  const canEdit = editingMode !== 'viewing';
  const { items, activeKey } = useReviewItems(editor);
  const [showResolved, setShowResolved] = useState(defaultShowResolved);
  const entries = useMemo(() => buildEntries(items, showResolved), [items, showResolved]);
  const resolvedCount = useMemo(
    () => items.filter((item) => item.kind === 'comment' && !item.parentId && item.resolved).length,
    [items]
  );

  const run = useCallback(
    (action: string, call: (editor: Editor) => ExecResult): boolean => {
      if (!editor) return false;
      const result = call(editor);
      if (!result.ok) onRefused?.(action, result);
      return result.ok;
    },
    [editor, onRefused]
  );

  // New comment draft: the toolbar's and context menu's Add comment controls come here.
  const [draft, setDraft] = useState<{ pin: ReturnType<Editor['retainSelection']> } | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const openDraft = useCallback(() => {
    if (!editor || draftRef.current) return;
    setDraft({ pin: editor.retainSelection() });
  }, [editor]);
  useCommentDraftRequest(canEdit ? openDraft : null);
  const closeDraft = useCallback(() => {
    const current = draftRef.current;
    if (editor && current?.pin) editor.releaseSelection(current.pin);
    setDraft(null);
  }, [editor]);
  useEffect(() => closeDraft, [closeDraft]);

  return (
    <aside className={`gw-review${className ? ` ${className}` : ''}`} data-testid="review-panel">
      <header className="gw-review__header">
        <span className="gw-review__title">{labels.title}</span>
        <span className="gw-review__count" data-testid="review-count">
          {entries.length}
        </span>
        {resolvedCount > 0 ? (
          <label className="gw-review__toggle">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(event) => setShowResolved(event.target.checked)}
            />
            {labels.showResolved} ({resolvedCount})
          </label>
        ) : null}
        {headerExtra}
      </header>
      {draft ? (
        <Composer
          className="gw-review__card gw-review__card--draft"
          labels={labels}
          submitLabel={labels.comment}
          testId="review-draft"
          onCancel={closeDraft}
          onSubmit={(text) => {
            if (run('addComment', (e) => e.addComment(text))) closeDraft();
          }}
        />
      ) : null}
      {entries.length === 0 && !draft ? (
        <div className="gw-review__empty">{labels.empty}</div>
      ) : null}
      <ol className="gw-review__list">
        {entries.map((entry) =>
          entry.kind === 'revision' ? (
            <RevisionCard
              key={entry.item.key}
              item={entry.item}
              active={entry.item.key === activeKey}
              canEdit={canEdit}
              labels={labels}
              editor={editor}
              run={run}
            />
          ) : (
            <ThreadCard
              key={entry.thread.root.key}
              thread={entry.thread}
              active={
                entry.thread.root.key === activeKey ||
                entry.thread.replies.some((reply) => reply.key === activeKey)
              }
              canEdit={canEdit}
              labels={labels}
              editor={editor}
              run={run}
            />
          )
        )}
      </ol>
    </aside>
  );
}

type Run = (action: string, call: (editor: Editor) => ExecResult) => boolean;

interface CardProps {
  readonly active: boolean;
  readonly canEdit: boolean;
  readonly labels: ReviewPanelLabels;
  readonly editor: Editor | null;
  readonly run: Run;
}

function activate(editor: Editor | null, key: string) {
  editor?.setActiveReviewItem(key);
}

function Meta({ author, date }: { author: string; date?: string }) {
  return (
    <div className="gw-review__meta">
      <span className="gw-review__author">{author}</span>
      <span className="gw-review__date">{formatDate(date)}</span>
    </div>
  );
}

function RevisionCard({
  item,
  active,
  canEdit,
  labels,
  editor,
  run,
}: CardProps & { item: ReviewRevisionPlacement }) {
  const kind = labels.kinds[item.revisionKind] ?? item.revisionKind;
  const actionable = canEdit && !item.readOnly;
  return (
    <li
      className={`gw-review__card gw-review__card--revision${active ? ' is-active' : ''}`}
      data-testid="review-revision"
      data-kind={item.revisionKind}
      onClick={() => activate(editor, item.key)}
    >
      <Meta author={item.author} {...(item.date ? { date: item.date } : {})} />
      <div className="gw-review__body">
        <span className="gw-review__kind">{kind}</span>
        {item.replacedText ? <del className="gw-review__deleted">{item.replacedText}</del> : null}
        {item.text ? (
          item.revisionKind === 'delete' || item.revisionKind === 'moveFrom' ? (
            <del className="gw-review__deleted">{item.text}</del>
          ) : (
            <ins className="gw-review__inserted">{item.text}</ins>
          )
        ) : null}
      </div>
      {actionable ? (
        <div className="gw-review__actions">
          <button
            type="button"
            className="gw-review__button gw-review__button--primary"
            onClick={(event) => {
              event.stopPropagation();
              run('acceptReviewItem', (e) => e.acceptReviewItem(item.key));
            }}
          >
            {labels.accept}
          </button>
          <button
            type="button"
            className="gw-review__button"
            onClick={(event) => {
              event.stopPropagation();
              run('rejectReviewItem', (e) => e.rejectReviewItem(item.key));
            }}
          >
            {labels.reject}
          </button>
        </div>
      ) : null}
    </li>
  );
}

function ThreadCard({
  thread,
  active,
  canEdit,
  labels,
  editor,
  run,
}: CardProps & { thread: Thread }) {
  const { root } = thread;
  const [replying, setReplying] = useState(false);
  const actionable = canEdit && !root.readOnly;
  return (
    <li
      className={`gw-review__card gw-review__card--comment${active ? ' is-active' : ''}${
        root.resolved ? ' is-resolved' : ''
      }`}
      data-testid="review-comment"
      onClick={() => activate(editor, root.key)}
    >
      <CommentBody item={root} canEdit={actionable} labels={labels} run={run} />
      {thread.replies.map((reply) => (
        <div className="gw-review__reply" key={reply.key} data-testid="review-reply">
          <CommentBody
            item={reply}
            canEdit={actionable && !reply.readOnly}
            labels={labels}
            run={run}
          />
        </div>
      ))}
      {actionable ? (
        replying ? (
          <Composer
            labels={labels}
            submitLabel={labels.reply}
            testId="review-reply-draft"
            onCancel={() => setReplying(false)}
            onSubmit={(text) => {
              if (run('replyToReviewItem', (e) => e.replyToReviewItem(root.key, text)))
                setReplying(false);
            }}
          />
        ) : (
          <div className="gw-review__actions">
            <button
              type="button"
              className="gw-review__button"
              onClick={(event) => {
                event.stopPropagation();
                setReplying(true);
              }}
            >
              {labels.reply}
            </button>
            <button
              type="button"
              className="gw-review__button"
              onClick={(event) => {
                event.stopPropagation();
                run('setCommentResolved', (e) => e.setCommentResolved(root.key, !root.resolved));
              }}
            >
              {root.resolved ? labels.reopen : labels.resolve}
            </button>
            <button
              type="button"
              className="gw-review__button gw-review__button--danger"
              onClick={(event) => {
                event.stopPropagation();
                run('deleteReviewItem', (e) => e.deleteReviewItem(root.key));
              }}
            >
              {labels.delete}
            </button>
          </div>
        )
      ) : null}
    </li>
  );
}

function CommentBody({
  item,
  canEdit,
  labels,
  run,
}: {
  item: ReviewCommentPlacement;
  canEdit: boolean;
  labels: ReviewPanelLabels;
  run: Run;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <>
      <Meta author={item.author} {...(item.date ? { date: item.date } : {})} />
      {editing ? (
        <Composer
          labels={labels}
          initial={item.text}
          submitLabel={labels.save}
          testId="review-edit-draft"
          onCancel={() => setEditing(false)}
          onSubmit={(text) => {
            if (run('setCommentText', (e) => e.setCommentText(item.key, text))) setEditing(false);
          }}
        />
      ) : (
        <div className="gw-review__text">
          {item.text}
          {canEdit ? (
            <button
              type="button"
              className="gw-review__link"
              onClick={(event) => {
                event.stopPropagation();
                setEditing(true);
              }}
            >
              {labels.edit}
            </button>
          ) : null}
        </div>
      )}
    </>
  );
}

function Composer({
  labels,
  initial = '',
  submitLabel,
  onSubmit,
  onCancel,
  className,
  testId,
}: {
  labels: ReviewPanelLabels;
  initial?: string;
  submitLabel: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
  className?: string;
  testId?: string;
}) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const submit = () => {
    const value = text.trim();
    if (value) onSubmit(value);
  };
  const body = (
    <div
      className="gw-review__composer"
      data-testid={testId}
      onClick={(event) => event.stopPropagation()}
    >
      <textarea
        ref={ref}
        className="gw-review__input"
        value={text}
        rows={3}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            submit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="gw-review__actions">
        <button
          type="button"
          className="gw-review__button gw-review__button--primary"
          disabled={!text.trim()}
          onClick={submit}
        >
          {submitLabel}
        </button>
        <button type="button" className="gw-review__button" onClick={onCancel}>
          {labels.cancel}
        </button>
      </div>
    </div>
  );
  return className ? <div className={className}>{body}</div> : body;
}
