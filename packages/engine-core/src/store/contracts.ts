// The four distinct state contracts (document-engine task 4.1 / design D2 /
// semantic-document-store "Four distinct state contracts"). Each is a separate
// type with its own discriminant so one can never be accepted as another:
//   - DocOp             — JSON-safe semantic mutation request
//   - ModelChange       — committed notification after a normalized transaction
//   - ReplicationUpdate — opaque incremental backend bytes
//   - Snapshot          — full encoded backend state
// The discriminant literals make them structurally non-assignable at compile
// time; the guards below enforce the same at runtime.

import type { RunProps, RunRecord } from '../model/index.ts';

/** JSON-safe semantic mutation. `op` is the capability-owned operation id. */
export type DocOp =
  | { readonly op: 'appendParagraph'; readonly storyId: string; readonly symbolicId?: string }
  | {
      readonly op: 'insertParagraph';
      readonly storyId: string;
      readonly index: number;
      readonly runs: readonly RunRecord[];
      readonly symbolicId?: string;
    }
  | { readonly op: 'insertText'; readonly paragraphId: string; readonly text: string; readonly props?: RunProps }
  | { readonly op: 'splitParagraph'; readonly paragraphId: string; readonly offset: number }
  | { readonly op: 'joinParagraphs'; readonly firstId: string; readonly secondId: string }
  | { readonly op: 'moveBlock'; readonly storyId: string; readonly fromIndex: number; readonly toIndex: number }
  | { readonly op: 'replaceParagraph'; readonly paragraphId: string; readonly runs: readonly RunRecord[] }
  | { readonly op: 'setParagraphRuns'; readonly paragraphId: string; readonly runs: readonly RunRecord[] }
  | { readonly op: 'deleteParagraph'; readonly paragraphId: string };

export type DocOpKind = DocOp['op'];

/** Structural effect of one applied op, feeding ModelChange (task 4.7). */
export interface OpEffect {
  readonly dirty: readonly string[];
  readonly deleted: readonly string[];
  readonly created: readonly string[];
  readonly moves?: readonly { readonly id: string; readonly from: number; readonly to: number }[];
  readonly split?: { readonly from: string; readonly tail: string };
  readonly join?: { readonly kept: string; readonly removed: string };
  readonly dependencyKeys?: readonly string[];
}

/** Committed notification. Carries reverse-reconciliation evidence (task 4.7). */
export interface ModelChange {
  readonly change: 'model-change';
  readonly fromRevision: number;
  readonly toRevision: number;
  readonly commitId: string;
  readonly origin: string;
  readonly dirty: readonly string[];
  readonly deleted: readonly string[];
  readonly created: readonly string[];
  readonly moves: readonly { readonly id: string; readonly from: number; readonly to: number }[];
  readonly splitJoin: readonly ({ readonly split: { from: string; tail: string } } | { readonly join: { kept: string; removed: string } })[];
  readonly dependencyKeys: readonly string[];
  readonly normalized: boolean;
}

/** Opaque incremental backend bytes. NEVER carries semantic ops. */
export interface ReplicationUpdate {
  readonly envelope: 'update';
  readonly protocolVersion: number;
  readonly documentId: string;
  readonly updateId: string;
  readonly bytesHex: string;
}

/** Full encoded backend state for initial sync / persistence / recovery. */
export interface Snapshot {
  readonly envelope: 'snapshot';
  readonly protocolVersion: number;
  readonly documentId: string;
  readonly revision: number;
  readonly bytesHex: string;
}

export function isDocOp(v: unknown): v is DocOp {
  return typeof v === 'object' && v !== null && typeof (v as { op?: unknown }).op === 'string';
}
export function isModelChange(v: unknown): v is ModelChange {
  return typeof v === 'object' && v !== null && (v as { change?: unknown }).change === 'model-change';
}
export function isReplicationUpdate(v: unknown): v is ReplicationUpdate {
  return typeof v === 'object' && v !== null && (v as { envelope?: unknown }).envelope === 'update';
}
export function isSnapshot(v: unknown): v is Snapshot {
  return typeof v === 'object' && v !== null && (v as { envelope?: unknown }).envelope === 'snapshot';
}

// Compile-time proof the contracts are mutually non-assignable (tsc-checked).
// If any pair became assignable, `Distinct` would collapse to `never` and the
// const initializer below would fail to typecheck.
type Distinct<A, B> = [A] extends [B] ? never : [B] extends [A] ? never : true;
const _distinct: [
  Distinct<DocOp, ModelChange>,
  Distinct<ModelChange, ReplicationUpdate>,
  Distinct<ReplicationUpdate, Snapshot>,
  Distinct<Snapshot, DocOp>,
] = [true, true, true, true];
void _distinct;
