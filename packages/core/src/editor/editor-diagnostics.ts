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
  CountBucket,
  EditRejectionOrigin,
  EditorDiagnostic,
} from '../contracts/diagnostics.ts';
import { DIAGNOSTIC_SCHEMA_VERSION } from '../contracts/diagnostics.ts';
import type { EditorCommand, EditorError, EditorFontError } from '../contracts/editor.ts';
import type { EditorModuleRegistry } from '../contracts/modules.ts';
import type { ExecResult } from '../contracts/types.ts';
import { HarfBuzzShapingError } from '@docx-editor.dev/core/layout';
import {
  editDiagnosticCode,
  fontDiagnosticCode,
  openDiagnosticCode,
  reviewDiagnosticCode,
} from './diagnostic-codes.ts';
import { warnFontFailureOnce } from './font-configuration.ts';

/** Distributes the payload type over the union, so each variant keeps its own fields. */
type DiagnosticPayload<T> = T extends unknown
  ? Omit<T, 'schemaVersion' | 'editorSessionId' | 'time'>
  : never;

const KIB = 1024;
const SIZE_BUCKETS: readonly (readonly [number, ByteSizeBucket])[] = [
  [64 * KIB, '0-64KiB'],
  [128 * KIB, '64-128KiB'],
  [256 * KIB, '128-256KiB'],
  [512 * KIB, '256-512KiB'],
  [1024 * KIB, '512KiB-1MiB'],
  [2 * 1024 * KIB, '1-2MiB'],
  [4 * 1024 * KIB, '2-4MiB'],
  [8 * 1024 * KIB, '4-8MiB'],
  [16 * 1024 * KIB, '8-16MiB'],
  [32 * 1024 * KIB, '16-32MiB'],
  [64 * 1024 * KIB, '32-64MiB'],
  [128 * 1024 * KIB, '64-128MiB'],
  [256 * 1024 * KIB, '128-256MiB'],
  [512 * 1024 * KIB, '256-512MiB'],
];

/** The power-of-two bucket of a byte size. */
export function byteSizeBucket(bytes: number): ByteSizeBucket {
  for (const [limit, bucket] of SIZE_BUCKETS) if (bytes < limit) return bucket;
  return '512MiB+';
}

/** The order-of-magnitude bucket of a count. */
export function countBucket(count: number): CountBucket {
  if (count <= 0) return '0';
  if (count === 1) return '1';
  if (count < 10) return '2-9';
  if (count < 100) return '10-99';
  return count < 1000 ? '100-999' : '1000+';
}

function randomSessionId(): string {
  const crypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (crypto?.randomUUID) return `e_${crypto.randomUUID()}`;
  return `e_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
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
  const editorSessionId = randomSessionId();
  const now = options.now ?? (() => Date.now());
  const clock = () => globalThis.performance?.now() ?? now();
  let opening: Opening | null = null;
  /** Depth of `exec` calls, so a surface refusal inside one is reported once, as a command. */
  let execDepth = 0;

  function deliver(payload: DiagnosticPayload<EditorDiagnostic>): void {
    const event = Object.freeze({
      ...payload,
      schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
      editorSessionId,
      time: now(),
    }) as EditorDiagnostic;
    for (const listener of options.modules.diagnosticListeners) {
      try {
        listener(event);
      } catch {
        /* an observer must never break the editor it observes */
      }
    }
    options.emit(event);
  }

  return {
    editorSessionId,

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
        deliver({
          kind: 'edit.rejected',
          code: editDiagnosticCode(result.reason, result.code),
          origin: 'command',
          tracked,
          command: command.type,
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
      const origin: EditRejectionOrigin = 'input';
      deliver({ kind: 'edit.rejected', code: editDiagnosticCode(reason), origin, tracked });
    },

    fontFailed(code: string | undefined): void {
      deliver({ kind: 'font.failed', code: fontDiagnosticCode(code) });
    },
  };
}

/** What reporting a font failure needs from the facade. */
export interface FontErrorReporting {
  readonly onFontError?: (error: EditorFontError) => void;
  readonly hasErrorHandlers: () => boolean;
  readonly emitError: (error: EditorError) => void;
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
  if (shaperNeverLoaded && !host.onFontError && !host.hasErrorHandlers()) {
    warnFontFailureOnce(error);
  }
  // A host handler that throws must not abort font resolution — reporting a dropped
  // face would then cost the whole shaped measurer, and the catch's own report would
  // throw again as an unhandled rejection.
  try {
    host.onFontError?.(error);
  } catch {
    /* the host's reporting problem, not the document's */
  }
  host.emitError(error);
  host.diagnostics.fontFailed(shaperNeverLoaded ? 'wasmUnavailable' : error.code);
}
