import type {
  CanResult,
  EditorCommand,
  EditorExecOptions,
  ExecResult,
  HistoryGroup,
} from '../contracts/editor.ts';
import type { HistoryGroupOutcome, HistoryDiagnostic } from '../contracts/editor-scope.ts';
import { observeHistoryGroup, type HistoryCaptureKind } from '@docx-editor.dev/core/store';
import { runWithHistoryGroup } from './history-group-scope.ts';

// These commands write synchronous formatting only. Structural edits can promote a story
// transaction into a package unit; refuse those before writing rather than promise a group.
const GROUPABLE = new Set<EditorCommand['type']>([
  'toggleMark',
  'setMarkAttr',
  'setAlignment',
  'setParagraphDirection',
  'clearFormatting',
  'setLineSpacing',
  'setParagraphSpacing',
  'setParagraphStyle',
  'setParagraphFormat',
]);
interface GroupRecord {
  readonly token: symbol;
  owner: WeakRef<object> | undefined;
  closed: boolean;
  committed: boolean;
  undoEpoch: number;
}

/** Owns handles, admission and reporting, but never a second history stack. */
export class EditorHistoryGroups {
  private readonly records = new WeakMap<HistoryGroup, GroupRecord>();
  private undoEpoch = 0;
  private burst: { key: string; time: number; count: number } | undefined;
  constructor(
    private readonly owner: () => object | null,
    private readonly diagnose: (diagnostic: HistoryDiagnostic) => void,
    private readonly target: () => string
  ) {}
  private diagnoseWrites(command: EditorCommand, result: ExecResult, grouped = false): void {
    if (command.type !== 'setMarkAttr' || !result.ok || !result.changed) return;
    const key = `${grouped}:${command.mark}:${command.attr}:${this.target()}`;
    const time = Date.now();
    const previous = this.burst;
    const count = previous?.key === key && time - previous.time <= 250 ? previous.count + 1 : 1;
    this.burst = { key, time, count };
    if (count === 3)
      this.diagnose({
        kind: grouped ? 'possible-fragmented-gesture' : 'possible-ungrouped-gesture',
        reason:
          'Three rapid formatting writes started separate groups at the same selection. For a continuous control, retain one handle with bindHistoryGroup; separate clicks may be intentional.',
      });
  }

  begin(): HistoryGroup {
    const owner = this.owner();
    const record: GroupRecord = {
      token: Symbol('gesture'),
      owner: owner ? new WeakRef(owner) : undefined,
      closed: false,
      committed: false,
      undoEpoch: this.undoEpoch,
    };
    const handle = createHandle(record, new WeakRef(this));
    this.records.set(handle, record);
    return handle;
  }

  owns(owner: object | undefined): boolean {
    return owner !== undefined && owner === this.owner();
  }

  gate(
    command: EditorCommand,
    options?: EditorExecOptions
  ): Extract<CanResult, { ok: false }> | null {
    const group = options?.historyGroup;
    if (group === undefined) return null;
    const record = this.records.get(group);
    if (!record || group.state !== 'open') {
      return {
        ok: false,
        code: 'unsupported',
        reason: 'historyGroup must be an open handle from this editor and document',
      };
    }
    if (!GROUPABLE.has(command.type)) {
      return {
        ok: false,
        code: 'unsupported',
        reason: `${command.type} does not support history grouping`,
      };
    }
    return null;
  }

  note(command: EditorCommand): void {
    if (command.type === 'undo' || command.type === 'redo') this.undoEpoch++;
  }

  run(
    owner: object,
    command: EditorCommand,
    options: EditorExecOptions | undefined,
    run: () => ExecResult
  ): ExecResult {
    const group = options?.historyGroup;
    const record = group && this.records.get(group);
    if (!record) {
      const result = runWithHistoryGroup(owner, undefined, run);
      this.diagnoseWrites(command, result);
      return result;
    }
    const committedBefore = record.committed;
    let capture: HistoryCaptureKind | undefined;
    let boundary: HistoryGroupOutcome['reason'];
    const result = observeHistoryGroup(
      record.token,
      (kind, reason) => {
        capture = kind;
        boundary = reason;
      },
      () => runWithHistoryGroup(owner, record.token, run)
    );
    if (!result.ok) return result;
    const split = capture === 'split' || (capture === 'started' && committedBefore);
    const history: HistoryGroupOutcome =
      capture === undefined
        ? { kind: 'none', reason: 'no-history' }
        : split
          ? {
              kind: 'split',
              reason:
                boundary ??
                (record.undoEpoch !== this.undoEpoch ? 'undo-redo' : 'history-boundary'),
            }
          : { kind: capture };
    if (capture) {
      record.committed = true;
      record.undoEpoch = this.undoEpoch;
    }
    if (history.kind === 'started') this.diagnoseWrites(command, result, true);
    else this.burst = undefined;
    if (history.kind === 'split')
      this.diagnose({ kind: 'split', reason: history.reason ?? 'history-boundary' });
    return { ...result, history };
  }
}

// This factory captures weak ownership only. Keeping an expired handle must not keep
// a destroyed editor or an old document's surface, package, and layout alive.
function createHandle(record: GroupRecord, manager: WeakRef<EditorHistoryGroups>): HistoryGroup {
  return Object.freeze({
    get state() {
      return !record.closed && manager.deref()?.owns(record.owner?.deref())
        ? ('open' as const)
        : ('closed' as const);
    },
    end() {
      record.closed = true;
      record.owner = undefined;
    },
  }) as HistoryGroup;
}
