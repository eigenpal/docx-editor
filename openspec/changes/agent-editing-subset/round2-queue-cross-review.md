# Round 2 queue capture cross-review

The structural reviewer independently reviewed the root reviewer's queue capture fix.
No additional defect was confirmed in that fix.

## Source review

Reviewed `ActionQueue.take()`, `RequestContext.sync()`, `ClientObject.enqueue()`, and the model command helpers.
Reviewed all changed coalescers: fonts, paragraph formatting, lists, pictures, fields, page setup, and control locks.

The ownership sequence is consistent:

1. `take()` removes the queued actions before read prerequisites can yield.
2. Each capture callback detaches only its own pending property bag.
3. Later setters create a separate bag and action.
4. Earlier completion or failure cleanup checks bag identity before clearing state.
5. Earlier cleanup therefore preserves a later queued bag.

Removing unconditional plan-time clearing is necessary.
Otherwise the first write can clear the second bag after prerequisite reads finish.
The capture callbacks are internal, synchronous, and idempotent in all reviewed callers.
Independent aliases keep the existing conflict rules; the fix does not merge distinct proxies.

## Additional tests

Added `packages/editor-api/src/runtime/__tests__/runtime-queue-capture-cross-review.test.ts`.
The tests delay a real host's preparation boundary without replacing document behavior.
Structural fixtures use the public server API.

Six tests cover:

- An invalid first font write, followed by later setters on the same proxy.
- List formatting captured before its lookup completes.
- Page setup captured before its section lookup completes.
- Field code captured before its field lookup completes.
- Picture properties captured before their picture lookup completes.
- Content-control locks captured before their control lookup completes.

The tests verify the first transaction's exact requested value.
They then add later setters and verify one separate coalesced operation.
They also verify saved list markup or public property reads after save/reopen.

## Results

- Six additional tests pass with 38 assertions.
- The broader runtime run passes 66 tests across seven files, with 163 assertions.
- The broader run includes queue capture, concurrency, failures, lifecycle, adoption, and read dependencies.
- The editor-api typecheck passes.
- Scoped ESLint and diff checks pass.

Test log: `/tmp/pr811-word-round2/queue-cross-review-tests.log`.
No production source changed during this cross-review.
