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
import type { StoryScope } from '../store/store/tree-package-store.ts';
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
    apply(ops: readonly TreeDocOp[], scope: StoryScope): AutomationPortApplyResult {
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
      const result = surface.applyAutomationOps(ops, scope);
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
      const result = surface.applyAutomationOps([op]);
      if (result.rejected) return { ok: false, reason: String(result.reason ?? 'refused') };
      return { ok: true, changed: result.committed };
    },
    ensureExternalTarget(url: string, scope: StoryScope): string | null {
      // The SESSION's minting, which is the same `ensureHyperlinkRelationship` the headless host
      // reaches and the same one Ctrl+K in the editor uses: one relationship per target per
      // owner part, refused for a scheme this engine would not open.
      return sync()?.ensureHyperlinkRelationship(url, scope) ?? null;
    },
    save: () => sync()?.save() ?? null,
    // The one genuinely browser-only operation, and the reason the port declares it optional:
    // a headless host has no caret. Positions arrive as canonical paragraph ids and model
    // offsets — the same vocabulary `SemanticSelection` already uses — so nothing is translated
    // and there is no second coordinate space that could drift. Collapsing to one end is done
    // by pointing both ends at it, which is what a caret IS to the surface.
    select(range, mode) {
      const surface = editor.surface;
      if (!surface) return;
      const anchor = mode === 'end' ? range.end : range.start;
      const head = mode === 'start' ? range.start : range.end;
      surface.setSelection({
        anchor: { paragraphId: anchor.paragraphId, offset: anchor.offset },
        head: { paragraphId: head.paragraphId, offset: head.offset },
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
