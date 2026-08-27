// Automation over an editor that is already open.
//
// This is an ADAPTER, not a second host: it builds the neutral lane's port over the live
// session and hands it to the same composition factory the headless host uses. Every
// operation, every validation and every read is the neutral lane's, so a document operation
// cannot mean one thing here and another on a server.
//
// Three things it deliberately does not do:
//
// - It owns no document. Authority is the session's canonical package, reached per call, and
//   never the painted DOM. Writes go through `applyTreeOps`, which is one
//   `TreePackageStore.transact` — the same path a keystroke takes — so the surface repaints
//   from the commit like any other, and undo sees one unit per batch.
// - It does not widen the adapter contract. It takes the core editor instance a host already
//   has; the seven-member React/Vue `DocxEditorRef` is untouched.
// - It does not own the editor's lifetime. `dispose()` releases this host's subscription and
//   nothing else: the editor it borrowed keeps working.
//
// Detach and destroy are ordinary states here rather than errors. A detached editor has no
// session, so operations answer `document-unavailable` — the host may well answer again after
// the next `attach`.

import type { AutomationCapabilities, AutomationHost } from '../automation/index.ts';
import { DEFAULT_FORMATTING_DISPLAY_MODE } from '../store/store/formattable-runs.ts';
import type {
  AutomationCommentWrite,
  AutomationCommentWriteResult,
  AutomationDocumentPort,
  AutomationPortApplyResult,
  AutomationStagedOps,
} from '../automation/document-port.ts';
import type { ReviewWriteIntent } from './paginated-surface-contract.ts';
import { createAutomationHost } from '../automation/host.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';
import type { StoryScope } from '../store/store/tree-package-store.ts';
import type { TreeDocxSessionView } from '../binding/tree-session.ts';
import type { DocxEditorInstance } from './docx-editor-types.ts';

/**
 * What a browser host can do.
 *
 * `selection`, `scrolling` and `layout` are true because a mounted editor genuinely has a
 * caret, a scroll container and paginated layout — a consumer may branch on them. The
 * DOCUMENT operations behave identically to the headless host regardless; the extra
 * capabilities widen what may be asked later, never what an existing operation means.
 */
export const BROWSER_AUTOMATION_CAPABILITIES: AutomationCapabilities = Object.freeze({
  document: true,
  save: true,
  events: true,
  selection: true,
  scrolling: true,
  layout: true,
});

/**
 * Which review write a comment batch amounts to, decided BEFORE the commit.
 *
 * The callback below branches on the batch, so the gate cannot read the kind off it. `undefined`
 * for a batch this lane refuses anyway (empty, or mixed kinds) — a caller that cannot be named is
 * one a replica must not admit, and the branch inside reports the specific reason.
 */
function automationCommentIntent(
  writes: readonly AutomationCommentWrite[]
): ReviewWriteIntent | undefined {
  if (writes.length === 0) return undefined;
  if (writes.every((write) => write.kind === 'delete')) return 'comment-delete';
  if (writes.length !== 1) return undefined;
  const write = writes[0]!;
  if (write.kind === 'resolve') return 'comment-resolve';
  if (write.kind === 'create') return 'comment-add';
  if (write.kind === 'reply') return 'comment-reply';
  return undefined;
}

/**
 * An automation host over a live editor.
 *
 * The editor keeps its own lifetime: `dispose()` on the returned host releases the change
 * subscription this adapter took and leaves the editor mounted and editable.
 */
export function createBrowserAutomationHost(editor: DocxEditorInstance): AutomationHost {
  return createAutomationHost({
    port: sessionPort(editor),
    capabilities: BROWSER_AUTOMATION_CAPABILITIES,
  });
}

function sessionPort(editor: DocxEditorInstance): AutomationDocumentPort {
  /**
   * Revision, made monotonic across remounts.
   *
   * A remount is a fresh session whose own revision restarts at zero (documented: the undo
   * stack and caret do not survive re-attach). Reporting that raw would let an
   * `expectedRevision` captured before a detach be satisfied by coincidence afterwards, on a
   * document that had been saved and reopened in between. So a session change carries the
   * previous count forward. An editor that never remounts reports the session's own revision
   * unchanged, which is what keeps this comparable with a headless host.
   */
  let base = 0;
  let seen = 0;
  let session: TreeDocxSessionView | null = null;
  let started = false;
  let released = false;

  const sync = (): TreeDocxSessionView | null => {
    // Released: report nothing and, crucially, move nothing. A disposed host that kept
    // re-adopting the editor's session would keep advancing the revision it no longer reads.
    if (released) return null;
    const live = editor.surface?.session ?? null;
    if (live !== session) {
      if (started) base += seen + 1;
      started = true;
      session = live;
      seen = 0;
    }
    if (live) seen = live.packageRevision();
    return live;
  };

  return {
    revision() {
      sync();
      return base + seen;
    },
    currentPackage: (): OoxmlPackage | null => sync()?.currentPackage() ?? null,
    // THE READER'S VIEW, so the object model's formatting reaches the runs the toolbar does.
    // Per call rather than captured: the editor remounts, and a detached editor has no
    // surface to ask — the lane then falls back to the resolved result, which is what a
    // caller with no view means.
    revisionDisplayMode: () =>
      editor.surface?.revisionDisplayMode() ?? DEFAULT_FORMATTING_DISPLAY_MODE,
    apply(staged: AutomationStagedOps, scope: StoryScope): AutomationPortApplyResult {
      sync();
      const surface = editor.surface;
      if (!surface) return { ok: false, reason: 'no-document' };
      // THROUGH THE SURFACE, NOT THE SESSION. `applyAutomationOps` is one gated transaction:
      // viewing refuses, suggesting proposes and attributes, the story the batch named is
      // addressed explicitly, and the pages repaint from the commit. Reaching
      // `session.applyTreeOps` from here — the
      // first version of this adapter — wrote into a document open for viewing and turned a
      // proposal into a permanent edit. A refusal anywhere leaves the session, its history and
      // the painted pages untouched, which is what makes the batch atomic.
      //
      // The ops are STAGED, so the relationship an external hyperlink needs is minted inside that
      // gate — see `applyAutomationOps`. Minting it out here would put a target in the `.rels` of a
      // document the very next line refuses to write to.
      const result = surface.applyAutomationOps(staged, scope);
      if (result.rejected) return { ok: false, reason: String(result.reason ?? 'refused') };
      return { ok: true, changed: result.committed };
    },
    applyLifecycle(op: TreeDocOp): AutomationPortApplyResult {
      sync();
      const surface = editor.surface;
      if (!surface) return { ok: false, reason: 'no-document' };
      // THE SAME SURFACE PATH. `applyTreeOps` routes a solitary lifecycle op to the package
      // store's own transaction, so this goes through the mode gates and the repaint like every
      // other write rather than reaching around them.
      const result = surface.applyAutomationOps(() => [op]);
      if (result.rejected) return { ok: false, reason: String(result.reason ?? 'refused') };
      return { ok: true, changed: result.committed };
    },
    applyCommentWrites(writes, scope): AutomationCommentWriteResult {
      const surface = editor.surface;
      const session = sync();
      if (!surface || !session) return { ok: false, reason: 'no-document' };
      if (writes.length === 0) return { ok: true, changed: false };
      // THE BODY'S COMMENTS, for as long as the session's comment lane is the body store's: the
      // scope is carried so this refuses a story it cannot write rather than silently commenting
      // on the wrong one.
      if (scope.kind !== 'body') return { ok: false, reason: 'unsupported-story' };
      const review = editor.can({ type: 'toggleReviewPane' });
      if (!review.ok) return { ok: false, reason: review.reason ?? 'review-module-required' };
      let outcome: AutomationCommentWriteResult = { ok: false, reason: 'refused' };
      // `commitReviewOps` is the gate a comment goes through in the editor: viewing refuses, and
      // the pages and the rail repaint from the commit. Reaching past it would let a script
      // comment on a document open for reading.
      surface.commitReviewOps(() => {
        if (writes.every((write) => write.kind === 'delete')) {
          const deletion = writes.find((write) => write.kind === 'delete');
          const done = session.deleteComments(
            writes.map((write) => {
              if (write.kind !== 'delete') throw new Error('unreachable mixed comment write');
              return {
                commentId: write.commentId,
                ...(write.parentCommentId === undefined
                  ? {}
                  : { parentCommentId: write.parentCommentId }),
              };
            }),
            scope,
            deletion?.kind === 'delete' ? deletion.noteId : undefined
          );
          outcome = done ? { ok: true, changed: true } : { ok: false, reason: 'unknown-comment' };
          return { committed: done };
        }
        if (writes.length !== 1) {
          outcome = { ok: false, reason: 'mixed-comment-writes' };
          return { committed: false };
        }
        const write = writes[0]!;
        if (write.kind === 'resolve') {
          const done = session.setCommentResolved(write.commentId, write.resolved);
          outcome = done ? { ok: true, changed: true } : { ok: false, reason: 'unknown-comment' };
          return { committed: done };
        }
        if (write.kind !== 'create' && write.kind !== 'reply') {
          outcome = { ok: false, reason: 'unsupported-comment-write' };
          return { committed: false };
        }
        const created = session.replyToComment(
          write.kind === 'reply' ? write.parentCommentId : null,
          write.anchor,
          write.text,
          write.author,
          write.date
        );
        outcome =
          created === null
            ? { ok: false, reason: 'refused' }
            : { ok: true, changed: true, commentId: created };
        return { committed: created !== null };
      }, automationCommentIntent(writes));
      return outcome;
    },
    applyCustomNodeWrite(write, scope): AutomationPortApplyResult {
      const surface = editor.surface;
      const live = sync();
      if (!surface || !live) return { ok: false, reason: 'no-document' };
      // THE BODY's store, for as long as the session's payload lane is the body store's: the
      // scope is carried so this refuses a story it cannot write rather than quietly authoring
      // the node somewhere else.
      if (scope.kind !== 'body') return { ok: false, reason: 'unsupported-story' };
      let outcome: AutomationPortApplyResult = { ok: false, reason: 'refused' };
      // Through `commitReviewOps`, the gate a package-scoped write goes through in the editor:
      // viewing refuses, and the pages repaint from the commit. Reaching past it would let a
      // script author a chip in a document open for reading.
      surface.commitReviewOps(() => {
        const result = live.insertCustomNode(write);
        outcome = result.ok
          ? { ok: true, changed: result.change !== null }
          : {
              ok: false,
              reason: result.detail ? `${result.reason}: ${result.detail}` : result.reason,
            };
        return { committed: result.ok };
      }, 'package-scoped');
      return outcome;
    },
    save: () => sync()?.save() ?? null,
    // The one genuinely browser-only operation, and the reason the port declares it optional:
    // a headless host has no caret. Positions arrive as canonical paragraph ids and model
    // offsets — the same vocabulary `SemanticSelection` already uses — so nothing is translated
    // and there is no second coordinate space that could drift. Collapsing to one end is done
    // by pointing both ends at it, which is what a caret IS to the surface.
    //
    // THROUGH THE EDITOR COMMAND, not `surface.setSelection` directly. The public Office-shaped
    // contract says selecting also navigates the reader to the range, and `setSelection` is the
    // canonical focus-independent path that installs the logical selection and reveals its head
    // from layout geometry. That keeps virtualized pages viable: the target usually has no DOM
    // node to measure yet, and the reveal materializes it on the way.
    select(range, mode) {
      const surface = editor.surface;
      if (!surface) return;
      const anchor = mode === 'end' ? range.end : range.start;
      const head = mode === 'start' ? range.start : range.end;
      editor.exec({
        type: 'setSelection',
        range: {
          anchor: { paragraphId: anchor.paragraphId, offset: anchor.offset },
          head: { paragraphId: head.paragraphId, offset: head.offset },
        },
      });
    },
    // The EDITOR's change event, not the session's: the facade re-subscribes to each new
    // session across a remount, so a subscription taken here survives one.
    subscribe: (listener) => editor.on('change', () => listener()),
    dispose() {
      released = true;
      session = null;
    },
  };
}
