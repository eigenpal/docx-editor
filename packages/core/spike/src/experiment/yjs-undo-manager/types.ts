/** @spike-features origin-metadata, yjs-backend */
import type { UNDO_EXPERIMENT_JOURNAL_VERSION } from './quotas';

export interface StackItemMeta {
  readonly actorId: string;
  readonly sessionId: string;
  readonly groupId: string;
  readonly constituentIds: readonly string[];
  readonly originKind: 'human' | 'agent' | 'undo' | 'redo';
}

export interface ActorHistoryInspection {
  readonly actorId: string;
  readonly sessionId: string;
  readonly undoEntries: number;
  readonly redoEntries: number;
  readonly redoEligible: boolean;
  readonly stackItemMeta: readonly StackItemMeta[];
  readonly undoStackMeta: readonly StackItemMeta[];
  readonly redoStackMeta: readonly StackItemMeta[];
}

export type JournalEvent =
  | {
      readonly kind: 'tracked-update';
      readonly sequence: number;
      readonly updateBytesHex: string;
      readonly stateVectorBeforeHex: string;
      readonly actorId: string;
      readonly sessionId: string;
      readonly groupId: string;
      readonly originKind: 'human' | 'agent';
      readonly constituentIds: readonly string[];
      readonly sourceClientId: number;
      readonly trackedOrigin: string;
    }
  | {
      readonly kind: 'untracked-update';
      readonly sequence: number;
      readonly updateBytesHex: string;
      readonly stateVectorBeforeHex: string;
      readonly actorId: string;
      readonly sessionId: string;
      readonly updateId: string;
      readonly originKind: 'remote' | 'repair';
      readonly trackedOrigin: string;
    }
  | {
      readonly kind: 'group-boundary';
      readonly sequence: number;
      readonly actorId: string;
      readonly sessionId: string;
      readonly groupId: string;
      readonly trackedOrigin: string;
    }
  | {
      readonly kind: 'undo-control';
      readonly sequence: number;
      readonly actorId: string;
      readonly sessionId: string;
      readonly sourceClientId: number;
      readonly updateBytesHex: string;
      readonly stateVectorBeforeHex: string;
      readonly trackedOrigin: string;
    }
  | {
      readonly kind: 'redo-control';
      readonly sequence: number;
      readonly actorId: string;
      readonly sessionId: string;
      readonly sourceClientId: number;
      readonly updateBytesHex: string;
      readonly stateVectorBeforeHex: string;
      readonly trackedOrigin: string;
    }
  | {
      readonly kind: 'commit';
      readonly sequence: number;
      readonly revision: number;
      readonly authoredFingerprint: string;
      readonly yjsFingerprint: string;
      readonly actorHistories: readonly ActorHistoryInspection[];
    };

export interface ReconstructionJournalGenesis {
  readonly stateBytesHex: string;
  readonly stateVectorHex: string;
  readonly revision: number;
  readonly fingerprint: string;
  readonly yjsFingerprint: string;
  readonly actorHistories: readonly ActorHistoryInspection[];
}

export interface ReconstructionJournal {
  readonly version: typeof UNDO_EXPERIMENT_JOURNAL_VERSION;
  readonly genesis: ReconstructionJournalGenesis;
  readonly events: readonly JournalEvent[];
  readonly retainedFromSequence: number;
}

export interface JournalReplayValidation {
  readonly fingerprint: string;
  readonly revision: number;
  readonly actorInspections: readonly ActorHistoryInspection[];
}
