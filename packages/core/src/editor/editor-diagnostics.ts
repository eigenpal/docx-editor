/**
 * The facade's anonymous diagnostics: builds each {@link EditorDiagnostic} from codes and
 * buckets, and delivers it to module listeners and `editor.on('diagnostic')`.
 *
 * Privacy is decided here, where the event is made. Nothing below reads document text, part
 * names, relationship targets, author names or font names: a raw reason goes through
 * `diagnostic-codes.ts` and only the public code comes out.
 */
import type {
  ByteSizeBucket,
  CollaborationDiagnosticCode,
  DocumentShape,
  EditDiagnosticCode,
  EditorDiagnostic,
  HistoryDiagnosticCode,
} from '../contracts/diagnostics.ts';
import type { HistoryDiagnostic } from '../contracts/editor-scope.ts';
import type { CustomNodeDiagnosticReporter } from './custom-node-wiring.ts';
import type { PaginatedSurface } from './paginated-surface.ts';
import { totalPages } from './docx-editor-derive.ts';
import type { EditorCommand, EditorError, EditorFontError } from '../contracts/editor.ts';
import type { DocxEditorInstance } from './docx-editor.ts';
import type { EditorModuleRegistry } from '../contracts/modules.ts';
import type { ExecResult } from '../contracts/types.ts';
import type { CollaborationStatus, EditorCollaborationSession } from '../collaboration/index.ts';
import {
  byteSizeBucket,
  countBucket,
  createDiagnosticEmitter,
  type DiagnosticEmitter,
} from '@docx-editor.dev/core/automation';
import { HarfBuzzShapingError } from '@docx-editor.dev/core/layout';
import {
  diagnosticCodeOfRefusal,
  fontDiagnosticCode,
  openDiagnosticCode,
  reviewDiagnosticCode,
} from './diagnostic-codes.ts';
import { warnFontFailureOnce } from './font-configuration.ts';
import { createPerformanceSampler, type PerformanceClock } from './editor-performance.ts';
import { setCommandReporter } from './command-reporting.ts';
import { classifyCommand, unknownCommandReason } from './docx-editor-support.ts';

/** Commands the facade answers itself, before the command classifier sees them. */
const FACADE_COMMANDS: ReadonlySet<string> = new Set<EditorCommand['type']>([
  'insertImage',
  'openRevisionMarkupDialog',
  'proposeDeletion',
  'proposeInsertion',
  'proposeReplacement',
  'replaceImage',
  'setEditingMode',
  'setReviewDisplayMode',
  'toggleDocumentProtection',
  'toggleParagraphMarks',
  'toggleReviewPane',
]);

/**
 * The command type, when it is one of the editor's own. `EditorCommands` is open to declaration
 * merging, so a host's own command type could be any word; only built-in names are reported.
 */
function builtInCommand(command: EditorCommand): EditorCommand['type'] | undefined {
  if (FACADE_COMMANDS.has(command.type)) return command.type;
  // The classifier has a case for every built-in command, including one it refuses for bad
  // arguments; only a type it has never heard of reaches its default branch.
  try {
    const support = classifyCommand(command);
    return support.supported || support.reason !== unknownCommandReason(command.type)
      ? command.type
      : undefined;
  } catch {
    return undefined;
  }
}

/** Each editor's automation scope: input refusals inside it belong to an automation batch. */
const AUTOMATION_SCOPES = new WeakMap<object, <T>(run: () => T) => T>();

/**
 * Run an editing API batch on this editor. Refusals the surface raises inside it are the
 * batch's, which its runtime reports with `origin: 'automation'`, so they are not also input.
 */
export function runAsAutomation<T>(editor: object, run: () => T): T {
  const scope = AUTOMATION_SCOPES.get(editor);
  return scope ? scope(run) : run();
}

/** Each editor's automation reporter, for a runtime that borrows the editor. */
const AUTOMATION_REPORTERS = new WeakMap<
  object,
  (code: EditDiagnosticCode, tracked: boolean) => void
>();

/**
 * Report a refused editing API batch into the diagnostics of the editor it ran on. A runtime
 * from `DocxEditor.createBrowser` calls this, so its refusals reach the editor's telemetry.
 * Does nothing for an object that is not an editor.
 */
export function reportAutomationRefusal(
  editor: object,
  code: EditDiagnosticCode,
  tracked: boolean
): void {
  AUTOMATION_REPORTERS.get(editor)?.(code, tracked);
}

/** What the facade tells the reporter about the opening document. */
interface Opening {
  readonly sizeBucket: ByteSizeBucket;
  /** Null while the bytes wait, detached, for a container: that wait is not open time. */
  start: number | null;
}

export interface EditorDiagnosticsOptions {
  readonly modules: EditorModuleRegistry;
  /** The instance's event bus: diagnostics go out on it, history diagnostics come in on it. */
  readonly events: {
    readonly emitDiagnostic: (event: EditorDiagnostic) => void;
    readonly on: <K extends 'historyDiagnostic'>(
      event: K,
      handler: (diagnostic: HistoryDiagnostic) => void
    ) => () => void;
    /**
     * Whether `editor.on('diagnostic')` has a handler. Performance is measured only then, or
     * while a module wants it.
     */
    readonly hasDiagnosticHandlers?: () => boolean;
  };
  /** The custom-node reporter, observed so its codes join the stream. */
  readonly customNodes?: CustomNodeDiagnosticReporter;
  readonly now?: () => number;
  /** Performance window and scheduling, for tests. */
  readonly performance?: { readonly windowMs?: number; readonly clock?: PerformanceClock };
}

const HISTORY_KINDS: ReadonlySet<string> = new Set([
  'split',
  'possible-ungrouped-gesture',
  'possible-fragmented-gesture',
]);

export type EditorDiagnostics = ReturnType<typeof createEditorDiagnostics>;

/** One reporter per editor instance. */
export function createEditorDiagnostics(options: EditorDiagnosticsOptions) {
  const clock = () => globalThis.performance?.now() ?? Date.now();
  const emitter = createDiagnosticEmitter<EditorDiagnostic>(
    () => [...options.modules.diagnosticListeners, options.events.emitDiagnostic],
    options.now
  );
  const deliver = emitter.deliver;
  let opening: Opening | null = null;
  /** Depth of `exec` calls, so a surface refusal inside one is reported once, as a command. */
  let execDepth = 0;
  /** Depth of editing API batches on this editor; their refusals are reported as automation. */
  let automationDepth = 0;
  // History and custom-node diagnostics keep their own channels and join this one by code only:
  // the history reason and the node's name and payload issues stay out of it.
  options.events.on('historyDiagnostic', (diagnostic) => {
    if (HISTORY_KINDS.has(diagnostic.kind))
      deliver({ kind: 'history', code: `history.${diagnostic.kind}` as HistoryDiagnosticCode });
  });
  options.customNodes?.observe((diagnostic) => {
    const code = (diagnostic as { code?: unknown } | null)?.code;
    if (code === 'payload-invalid' || code === 'payload-missing')
      deliver({ kind: 'custom-node', code: `custom-node.${code}` });
  });
  const session = options.modules.collaboration?.session;
  const stopCollaboration = session ? observeCollaboration(session, deliver, clock) : () => {};
  const performance = createPerformanceSampler({
    deliver,
    enabled: () =>
      options.events.hasDiagnosticHandlers?.() === true ||
      options.modules.wantsDiagnostic('performance'),
    ...options.performance,
  });

  return {
    editorSessionId: emitter.editorSessionId,

    /** A new document starts opening. A remount of the same document is not a new open. */
    openStarted(bytes: Uint8Array): void {
      opening = { sizeBucket: byteSizeBucket(bytes.byteLength), start: clock() };
    },
    /** The opening document waits detached; its clock restarts when it mounts. */
    openDeferred(): void {
      if (opening) opening.start = null;
    },
    /** A container is present and the mount begins. */
    openMounting(): void {
      if (opening && opening.start === null) opening.start = clock();
    },
    /** The opening document laid out. Reports once per open, never for a remount. */
    openSettled(surface: PaginatedSurface): void {
      if (!opening) return;
      const { sizeBucket, start } = opening;
      opening = null;
      deliver({
        kind: 'document.open',
        outcome: 'opened',
        sizeBucket,
        pagesBucket: countBucket(totalPages(surface)),
        durationMs: start === null ? 0 : Math.max(0, Math.round(clock() - start)),
        ...shapeOf(surface),
      });
    },
    /** The open was refused. `limit` disambiguates the one reason two layers share. */
    openRejected(reason: string, limit?: string): void {
      const sizeBucket = opening?.sizeBucket;
      opening = null;
      deliver({
        kind: 'document.open',
        outcome: 'rejected',
        code: openDiagnosticCode(reason, limit),
        ...(sizeBucket ? { sizeBucket } : {}),
      });
    },

    /** Wraps `exec`, so its refusal and its skipped tracked changes are reported once. */
    exec(command: EditorCommand, tracked: boolean, run: () => ExecResult): ExecResult {
      execDepth += 1;
      let result: ExecResult;
      try {
        result = run();
      } finally {
        execDepth -= 1;
      }
      if (execDepth > 0) return result;
      if (!result.ok) {
        const type = builtInCommand(command);
        deliver({
          kind: 'edit.rejected',
          code: diagnosticCodeOfRefusal(result.reason, result.code),
          origin: 'command',
          tracked,
          ...(type ? { command: type } : {}),
        });
      }
      const skipped = [
        ...(result.revisions?.skipped ?? []),
        ...(result.revisionAuthors?.skipped ?? []),
      ];
      const counts = new Map<string, number>();
      for (const { reason } of skipped) counts.set(reason, (counts.get(reason) ?? 0) + 1);
      for (const [reason, count] of counts) {
        const code = reviewDiagnosticCode(reason);
        if (code) deliver({ kind: 'review.skipped', code, count });
      }
      return result;
    },
    /** A refusal from typing, the clipboard, a drag or the pointer. Inside `exec` it is not new. */
    inputRejected(reason: string, tracked: boolean): void {
      if (execDepth > 0 || automationDepth > 0) return;
      const code = diagnosticCodeOfRefusal(reason);
      deliver({ kind: 'edit.rejected', code, origin: 'input', tracked });
    },

    fontFailed(code: string | undefined): void {
      deliver({ kind: 'font.failed', code: fontDiagnosticCode(code) });
    },

    /**
     * Report `exec` refusals and automation refusals for this editor instance: wraps `exec`, and
     * lets a runtime borrowing the editor report its refused batches into the same stream.
     */
    attach(editor: { exec: DocxEditorInstance['exec'] }, tracked: () => boolean): void {
      const execNow = editor.exec;
      editor.exec = (command, options) =>
        this.exec(command, tracked(), () => execNow(command, options));
      AUTOMATION_SCOPES.set(editor, (run) => {
        automationDepth += 1;
        try {
          return run();
        } finally {
          automationDepth -= 1;
        }
      });
      // Image inserts and replaces are asynchronous and run outside `exec`.
      setCommandReporter(
        editor,
        (command, result) => void this.exec(command, tracked(), () => result)
      );
      AUTOMATION_REPORTERS.set(editor, (code, automationTracked) =>
        deliver({ kind: 'edit.rejected', code, origin: 'automation', tracked: automationTracked })
      );
    },

    /** A layout or paint duration, or a press timestamp, from the surface. */
    timing(phase: 'layout' | 'paint' | 'input', value: number, surface?: PaginatedSurface): void {
      performance.timing(
        phase,
        value,
        // Read only when measured: the page count is not free on every paint.
        phase === 'paint' && surface ? () => totalPages(surface) : undefined
      );
    },
    /**
     * Send the last performance summary and stop observing the collaboration session. The
     * editor calls this when destroyed, before it drops its event handlers.
     */
    dispose(): void {
      performance.dispose();
      stopCollaboration();
    },
  };
}

/** The bucketed shape of the opened document. Counts only: nothing is read from the content. */
function shapeOf(surface: PaginatedSurface): { readonly shape?: DocumentShape } {
  try {
    const { session } = surface;
    return {
      shape: {
        parts: countBucket(session.currentPackage().parts.size),
        paragraphs: countBucket(session.paragraphIds().length),
        reviewItems: countBucket(session.reviewItems().length),
        embeddedFonts: countBucket(session.embeddedFonts().length),
      },
    };
  } catch {
    return {};
  }
}

/**
 * Reports each collaboration status change and each change in the number of people. A refusal
 * that heals inside one call still reports both of its transitions: the session notifies each.
 */
function observeCollaboration(
  session: EditorCollaborationSession,
  deliver: DiagnosticEmitter<EditorDiagnostic>['deliver'],
  clock: () => number
): () => void {
  const joined = clock();
  let previous: CollaborationStatus | 'none' = 'none';
  let previousCode: string | undefined;
  let previousRecovering = false;
  let readyOnce = false;
  let people = -1;

  const status = () => {
    const snapshot = session.statusSnapshot();
    const failure = snapshot.reason?.code;
    const recovering = snapshot.recovering === true;
    if (
      snapshot.status === previous &&
      failure === previousCode &&
      recovering === previousRecovering
    )
      return;
    const firstReady = snapshot.status === 'ready' && !readyOnce;
    // Timed only when this editor saw the wait. A session that was ready before the editor
    // attached, as a room hook makes it, joined before the clock started.
    const waited = firstReady && previous !== 'none';
    if (firstReady) readyOnce = true;
    deliver({
      kind: 'collab.status',
      status: snapshot.status,
      previous,
      ...(failure ? { code: `collab.${failure}` as CollaborationDiagnosticCode } : {}),
      recovering,
      ...(waited ? { connectMs: Math.max(0, Math.round(clock() - joined)) } : {}),
    });
    previous = snapshot.status;
    previousCode = failure;
    previousRecovering = recovering;
  };
  const participants = () => {
    const count = session.participants().length;
    if (count === people) return;
    people = count;
    deliver({ kind: 'collab.participants', count });
  };

  const stops = [session.subscribeStatus(status), session.subscribeParticipants(participants)];
  status();
  return () => {
    for (const stop of stops) stop();
  };
}

/** What reporting a font failure needs from the facade. */
export interface FontErrorReporting {
  readonly config: { readonly onFontError?: (error: EditorFontError) => void };
  readonly events: {
    readonly hasErrorHandlers: () => boolean;
    readonly emitError: (error: EditorError) => void;
  };
  readonly diagnostics: EditorDiagnostics;
}

/** Reports one font failure to the host's handler, the `error` event and the diagnostics. */
export function reportEditorFontError(error: EditorFontError, host: FontErrorReporting): void {
  // A shaper that never loaded is not a per-face degradation: NOTHING measures correctly,
  // and the fault is the host's build rather than the document's content. Said out loud
  // exactly once, and only when nobody is listening — a host that reports it in its own
  // UI does not need library noise it cannot switch off. Before this was fixed the same
  // misconfiguration failed the BUILD, so a green build with a silent console would be a
  // strictly worse trade (#282).
  const shaperNeverLoaded =
    error.code === 'wasmUnavailable' ||
    (error.cause instanceof HarfBuzzShapingError && error.cause.code === 'unsupportedRuntime');
  if (shaperNeverLoaded && !host.config.onFontError && !host.events.hasErrorHandlers()) {
    warnFontFailureOnce(error);
  }
  // A host handler that throws must not abort font resolution — reporting a dropped
  // face would then cost the whole shaped measurer, and the catch's own report would
  // throw again as an unhandled rejection.
  try {
    host.config.onFontError?.(error);
  } catch {
    /* the host's reporting problem, not the document's */
  }
  host.events.emitError(error);
  host.diagnostics.fontFailed(shaperNeverLoaded ? 'wasmUnavailable' : error.code);
}
