// Messages between the benchmark runner and its client worker processes.

import type { EditProfile } from './edit-model.ts';

export interface WorkerConfig {
  readonly workerId: number;
  readonly url: string;
  readonly roomId: string;
  readonly token: string;
  /** Global participant indexes this worker hosts. */
  readonly clients: readonly number[];
  /** When set, the first client creates the room from this file. Others join. */
  readonly seedDocumentPath?: string;
  /**
   * Connected participants who do not type: a Hocuspocus provider and a Yjs document, with
   * presence. The server sends them every update, as it does an idle person, but they keep
   * no document store, so a 50-person room fits on one load machine.
   */
  readonly observers?: boolean;
  readonly durationMs: number;
  readonly seed: number;
  readonly profile: EditProfile;
  readonly reportPath: string;
}

export type RunnerMessage =
  | { readonly type: 'start-load'; readonly startAt: number }
  | { readonly type: 'digest' }
  | { readonly type: 'shutdown' };

export interface ClientDigest {
  readonly index: number;
  readonly status: string;
  readonly stateVector: string;
  /** Deleted ranges; the state vector alone misses a lost delete-only update. */
  readonly deleteSet: string;
  /** Null for an observer, which keeps no document store. */
  readonly text: string | null;
}

export type WorkerMessage =
  | { readonly type: 'joined'; readonly failures: readonly string[] }
  | { readonly type: 'load-finished' }
  | { readonly type: 'digest'; readonly digests: readonly ClientDigest[] }
  | { readonly type: 'reported' }
  | { readonly type: 'fatal'; readonly error: string };

export interface StatusEvent {
  readonly t: number;
  readonly status: string;
  readonly reason?: string;
  readonly detail?: string;
}

export interface ClientReport {
  readonly index: number;
  /** A connected participant who does not type and keeps no document store. */
  readonly observer?: boolean;
  /** The Yjs client id the room sees for this participant. */
  readonly clientId: number;
  readonly joinMs: number;
  /** `[clock, startedAt]` for each local edit that advanced this client's clock. */
  readonly sent: readonly (readonly [number, number])[];
  /** `[senderClientId, clock, appliedAt]` for each remote transaction this client applied. */
  readonly received: readonly (readonly [number, number, number])[];
  readonly planned: number;
  readonly applied: number;
  readonly refused: Readonly<Record<string, number>>;
  /** How late each keystroke ran against its plan, in milliseconds. */
  readonly schedulerLagMs: readonly number[];
  /** How long this client took to integrate and materialize each remote transaction. */
  readonly remoteApplyMs: readonly number[];
  readonly statusEvents: readonly StatusEvent[];
}

export interface WorkerReport {
  readonly workerId: number;
  readonly clients: readonly ClientReport[];
  readonly joinFailures: readonly string[];
  readonly cpuUserMs: number;
  readonly cpuSystemMs: number;
  readonly loadWallMs: number;
  readonly peakRssMb: number;
  /** Totals since the worker started, including the join. */
  readonly traffic: Traffic;
  /** Traffic during the load phase only. */
  readonly loadTraffic: Traffic;
  /** Load-phase traffic by Hocuspocus message type: `sync`, `awareness`, and so on. */
  readonly loadTrafficByType: Readonly<Record<string, Traffic>>;
}

export type MessageTypeTraffic = {
  -readonly [K in keyof Traffic]: number;
};

export interface Traffic {
  readonly bytesSent: number;
  readonly bytesReceived: number;
  readonly messagesSent: number;
  readonly messagesReceived: number;
}

/** Epoch milliseconds with sub-millisecond precision, comparable across local processes. */
export function now(): number {
  return performance.timeOrigin + performance.now();
}
