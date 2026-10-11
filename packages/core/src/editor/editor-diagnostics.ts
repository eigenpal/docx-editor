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
  EditorDiagnostic,
} from '../contracts/diagnostics.ts';
import type { EditorCommand, EditorError, EditorFontError } from '../contracts/editor.ts';
import type { EditorModuleRegistry } from '../contracts/modules.ts';
import type { ExecResult } from '../contracts/types.ts';
import type {
  CollaborationStatus,
  EditorCollaborationSession,
} from '@docx-editor.dev/core/collaboration';
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

/** What the facade tells the reporter about the opening document. */
interface Opening {
  readonly sizeBucket: ByteSizeBucket;
  /** Null while the bytes wait, detached, for a container: that wait is not open time. */
  start: number | null;
}

export interface EditorDiagnosticsOptions {
  readonly modules: EditorModuleRegistry;
  readonly emit: (event: EditorDiagnostic) => void;
  readonly now?: () => number;
}

export type EditorDiagnostics = ReturnType<typeof createEditorDiagnostics>;

/** One reporter per editor instance. */
export function createEditorDiagnostics(options: EditorDiagnosticsOptions) {
  const clock = () => globalThis.performance?.now() ?? Date.now();
  const emitter = createDiagnosticEmitter<EditorDiagnostic>(
    () => [...options.modules.diagnosticListeners, options.emit],
    options.now
  );
  const deliver = emitter.deliver;
  let opening: Opening | null = null;
  /** Depth of `exec` calls, so a surface refusal inside one is reported once, as a command. */
  let execDepth = 0;
  const session = options.modules.collaboration?.session;
  const stopCollaboration = session ? observeCollaboration(session, deliver, clock) : () => {};

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
    openSettled(pages: number): void {
      if (!opening) return;
      const { sizeBucket, start } = opening;
      opening = null;
      deliver({
        kind: 'document.open',
        outcome: 'opened',
        sizeBucket,
        pagesBucket: countBucket(pages),
        durationMs: start === null ? 0 : Math.max(0, Math.round(clock() - start)),
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
      if (execDepth > 0) return;
      const code = diagnosticCodeOfRefusal(reason);
      deliver({ kind: 'edit.rejected', code, origin: 'input', tracked });
    },

    fontFailed(code: string | undefined): void {
      deliver({ kind: 'font.failed', code: fontDiagnosticCode(code) });
    },

    /** Stop observing the collaboration session. The editor calls this when destroyed. */
    dispose(): void {
      stopCollaboration();
    },
  };
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
    if (firstReady) readyOnce = true;
    deliver({
      kind: 'collab.status',
      status: snapshot.status,
      previous,
      ...(failure ? { code: `collab.${failure}` as CollaborationDiagnosticCode } : {}),
      recovering,
      ...(firstReady ? { connectMs: Math.max(0, Math.round(clock() - joined)) } : {}),
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
