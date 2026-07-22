# Engine core spike: KISS execution

## Goal

Produce a usable falsification result quickly. Prefer executable evidence over
large frozen oracle frameworks.

## Scope

Implement one small, isolated Yjs formatting experiment that compares:

- Candidate A: native `Y.Text` formatting attributes.
- Candidate B: immutable actor-owned mark contributions.

The experiment covers six decisive cases: overlapping actor undo, observed
disable versus unseen enable, bold/italic independence, endpoint affinity,
split-tail concurrency, and close/reopen undo/redo.

## Shape

- One executable experiment module.
- One focused behavior test.
- Real `Y.Doc`, encoded updates, and `Y.UndoManager`.
- A concise deterministic result containing case outcomes, encoded byte totals,
  and the winner.

No production backend migration, generalized event framework, generated oracle
corpus, or additional architecture is part of this task.

## Acceptance

The experiment runs from a single command, reports failures honestly, and names
a winner only when that candidate passes all six cases. The focused test,
spike typecheck, and existing spike suite must remain green.
