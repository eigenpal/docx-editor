# Engine Core Spike KISS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a small executable Yjs formatting bake-off with an honest, deterministic winner.

**Architecture:** One experiment module implements two tiny candidate adapters and six explicit scenario functions. One test executes the public runner; no generic event engine or generated oracle is introduced.

**Tech Stack:** TypeScript, Bun, Yjs 13, `Y.UndoManager`.

## Global Constraints

- Use real `Y.Doc`, encoded Yjs updates, and `Y.UndoManager`.
- Keep one long-lived `Y.Text`; paragraph boundaries are plain JSON embeds.
- Do not modify or consume the large formatting oracle.
- Do not migrate production or spike backends in this task.
- Name a winner only when it passes all six cases.

---

### Task 1: Executable formatting bake-off

**Files:**
- Create: `spike/engine-core-spike-harness/experiments/yjs-formatting-kiss.ts`
- Create: `spike/engine-core-spike-harness/tests/yjs-formatting-kiss.test.ts`
- Modify: `spike/engine-core-spike-harness/package.json`
- Modify: `openspec/changes/engine-core-spike/tasks.md`

**Interfaces:**
- Produces:

```ts
export type CandidateName = 'native-attributes' | 'mark-contributions';
export type CaseName =
  | 'overlap-undo'
  | 'observed-disable'
  | 'mark-independence'
  | 'endpoint-affinity'
  | 'split-tail'
  | 'reopen-history';
export interface CandidateResult {
  readonly passed: boolean;
  readonly encodedBytes: number;
  readonly cases: Readonly<Record<CaseName, { readonly passed: boolean; readonly diagnostic: string }>>;
}
export interface BakeoffResult {
  readonly cases: readonly CaseName[];
  readonly candidates: Readonly<Record<CandidateName, CandidateResult>>;
  readonly winner: CandidateName | null;
}
export function runFormattingBakeoff(): BakeoffResult;
```

- [ ] **Step 1: Write the failing focused test**

```ts
import { expect, test } from 'bun:test';
import { runFormattingBakeoff } from '../experiments/yjs-formatting-kiss.js';

test('runs six deterministic real-Yjs formatting cases', () => {
  const first = runFormattingBakeoff();
  expect(first).toEqual(runFormattingBakeoff());
  expect(Object.values(first.candidates).some((candidate) => candidate.passed)).toBe(true);
  expect(first.winner).not.toBeNull();
});
```

- [ ] **Step 2: Run RED**

Run: `bun test tests/yjs-formatting-kiss.test.ts`

Expected: FAIL because `yjs-formatting-kiss.ts` does not exist.

- [ ] **Step 3: Implement only the six explicit cases**

Implement overlapping actor undo, observed disable versus unseen enable,
bold/italic independence, endpoint affinity, split-tail concurrency, and
close/reopen undo/redo. Each case returns pass/fail and a short diagnostic.
Candidate A uses native `Y.Text` attributes; Candidate B uses immutable
plain-object mark records with `Y.RelativePosition` endpoints.

- [ ] **Step 4: Add the single execution command**

Add `"experiment:formatting": "bun experiments/yjs-formatting-kiss.ts"` and
print the `BakeoffResult` as canonical pretty JSON when the module is executed.

- [ ] **Step 5: Verify**

Run:

```bash
bun test tests/yjs-formatting-kiss.test.ts
bun run experiment:formatting
bun run typecheck
```

Expected: all commands exit zero and the command prints one non-null winner.

- [ ] **Step 6: Mark and commit**

Check OpenSpec task 2.4 only after the focused test, executable experiment,
typecheck, existing spike suite, and OpenSpec validation pass.
