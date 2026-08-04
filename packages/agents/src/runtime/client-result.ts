// A value a method promised to produce.
//
// The reason this is not a `Promise`: a method call inside a batch has not been sent yet, so
// there is no pending work to await and nothing that could ever resolve on its own. Awaiting one
// would deadlock a consumer who then never calls `sync()`. A result is a box that is EMPTY until
// the sync that fills it, and reading it early is a mistake with its own code
// (`ValueNotLoaded`) rather than `undefined` flowing onwards into something that misinterprets
// it.
//
// The box and the way to fill it come back as separate values from `clientResult()`, so an
// action can settle a result it created while a consumer holding the result cannot.

import { fail } from './errors.ts';

export class ClientResult<T> {
  #filled = false;
  #value: T | undefined;
  readonly #target: string;

  /** @internal Use `clientResult()`; only the creator gets the filling half. */
  private constructor(target: string) {
    this.#target = target;
  }

  get value(): T {
    if (!this.#filled) fail({ code: 'ValueNotLoaded', target: this.#target });
    return this.#value as T;
  }

  /** Whether the sync that fills this has happened. */
  get isLoaded(): boolean {
    return this.#filled;
  }

  /** @internal */
  static create<T>(target: string): {
    result: ClientResult<T>;
    fill: (value: T) => void;
  } {
    const result = new ClientResult<T>(target);
    return {
      result,
      fill(value: T) {
        result.#filled = true;
        result.#value = value;
      },
    };
  }
}

export function clientResult<T>(target: string): {
  result: ClientResult<T>;
  fill: (value: T) => void;
} {
  return ClientResult.create<T>(target);
}
