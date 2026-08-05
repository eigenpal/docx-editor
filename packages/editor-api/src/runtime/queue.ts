// The action queue: what a proxy call leaves behind instead of doing something.
//
// A queued action is a closure pair — how to say it to the host (`plan`), and what to do with
// the answer (`settle`) — plus the label an error may name. Keeping both halves on one object
// is what makes hydration positional rather than guessed: the answer at index i belongs to the
// action at index i, and there is no lookup table to get out of step with the request.
//
// `take()` is the important method. Dispatching a batch REMOVES its actions from the queue and
// nothing ever puts them back, including when the batch fails. A queue that re-queued a failed
// batch would replay writes the consumer had already been told about, at a revision they never
// saw; a queue that kept them would send them twice. So a failed sync loses its batch, says so
// with a typed error, and whatever is queued afterwards is a new batch that can succeed on its
// own.

import type {
  AutomationOperation,
  AutomationValue,
} from '@docx-editor.dev/core-contract/automation';

/** Whether an action reads or writes. Drives the conditional-revision rule in `sync()`. */
export type ActionSort = 'read' | 'write';

export interface QueuedAction {
  readonly sort: ActionSort;
  /** The consumer-facing name of what this action is for, for errors. Never a handle. */
  readonly label: string;
  /**
   * The host operation for this action.
   *
   * Called once, at dispatch. May throw `InvalidObjectPath` if the object it addresses stopped
   * being addressable between the call that queued it and the sync — which refuses the batch
   * before anything is sent.
   */
  plan(): AutomationOperation;
  /** The host's answer for this action, in batch order. */
  settle(value: AutomationValue): void;
}

export class ActionQueue {
  #actions: QueuedAction[] = [];

  get size(): number {
    return this.#actions.length;
  }

  /** What is queued right now, for tests and for the empty-batch shortcut. */
  get pending(): readonly QueuedAction[] {
    return this.#actions;
  }

  push(action: QueuedAction): void {
    this.#actions.push(action);
  }

  /** Hand over everything queued and forget it. Never replayed — see the file header. */
  take(): readonly QueuedAction[] {
    const taken = this.#actions;
    this.#actions = [];
    return taken;
  }

  /** Drop everything queued: what a finished run does with actions nobody synced. */
  clear(): void {
    this.#actions = [];
  }
}
