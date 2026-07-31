/** @spike-features insert-delete-split-join-operations, origin-metadata */
import type { ModelChange } from '../contracts/model-change';
import type { MutationOrigin } from '../contracts/origins';

export interface SubscriberError {
  readonly index: number;
  readonly message: string;
}

export interface NotificationDiagnostic {
  readonly revision: number;
  readonly subscriberIndex: number;
  readonly message: string;
}

export type ApplyResult =
  | {
      readonly status: 'applied';
      readonly change: ModelChange;
      readonly delivery: 'delivered' | 'queued';
      readonly subscriberErrors: readonly SubscriberError[];
    }
  | {
      readonly status: 'noOp';
      readonly reason: string;
    }
  | {
      readonly status: 'failed';
      readonly code: string;
      readonly reason: string;
    };

export type ModelChangeSubscriber = (change: ModelChange, origin: MutationOrigin) => void;
