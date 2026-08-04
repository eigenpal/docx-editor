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
import type {
  AutomationDocumentPort,
  AutomationPortApplyResult,
} from '../automation/document-port.ts';
import { createAutomationHost } from '../automation/host.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import type { TreeDocOp } from '../store/store/tree-ops.ts';
import type { TreeDocxSession } from '../binding/tree-session.ts';
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
  let session: TreeDocxSession | null = null;
  let started = false;
  let released = false;

  const sync = (): TreeDocxSession | null => {
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
    apply(ops: readonly TreeDocOp[]): AutomationPortApplyResult {
      const live = sync();
      if (!live) return { ok: false, reason: 'no-document' };
      // One call, every op: `applyTreeOps` stages them in a single transaction, so a
      // rejection anywhere leaves the session, its history and the painted pages untouched.
      const result = live.applyTreeOps(ops);
      if (result.rejected) return { ok: false, reason: String(result.reason ?? 'refused') };
      // A commit that came through the surface repaints as part of that commit; one made
      // straight on the session only ARMS a layout, and nothing disarms it until the next
      // keystroke or scroll. Flushing here is what keeps a scripted edit from leaving the
      // painted pages showing a revision the model has already left — the same reason
      // `surface.layout()` flushes before it answers.
      if (result.committed) editor.surface?.layout();
      return { ok: true, changed: result.committed };
    },
    save: () => sync()?.save() ?? null,
    // The EDITOR's change event, not the session's: the facade re-subscribes to each new
    // session across a remount, so a subscription taken here survives one.
    subscribe: (listener) => editor.on('change', () => listener()),
    dispose() {
      released = true;
      session = null;
    },
  };
}
