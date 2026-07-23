// DocxEditor.Result taxonomy (document-engine task 7.8 / design D8). Application,
// validation, conflict, resource, and authorization outcomes are DATA returned to
// the caller; only a transport/protocol failure that prevents a valid envelope
// throws (that boundary lives at the RPC layer, section 11). Every result carries
// the reconciled revision so a caller can pin subsequent work.

import type { StoreFailure } from '../store/index.ts';

export type ResultStatus = 'ok' | 'validation' | 'conflict' | 'resource' | 'authorization' | 'aborted';

export type Result<T = void> =
  | { readonly status: 'ok'; readonly value: T; readonly revision: number }
  | {
      readonly status: Exclude<ResultStatus, 'ok'>;
      readonly message: string;
      readonly revision: number;
      /** Positional indices of the failing edits in a batch, when applicable. */
      readonly failingIndices?: readonly number[];
    };

export function ok<T>(value: T, revision: number): Result<T> {
  return { status: 'ok', value, revision };
}

export function fromStoreFailure(failure: StoreFailure, revision: number): Result<never> {
  const status: Exclude<ResultStatus, 'ok'> =
    failure.kind === 'validation' ||
    failure.kind === 'conflict' ||
    failure.kind === 'resource' ||
    failure.kind === 'authorization' ||
    failure.kind === 'aborted'
      ? failure.kind
      : 'validation';
  return { status, message: failure.message, revision };
}
