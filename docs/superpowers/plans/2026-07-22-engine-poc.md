# Browser/Yjs/DOCX Engine POC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a browser-visible editor that loads one minimal DOCX, edits and formats text, synchronizes two Yjs replicas, performs actor-local undo, saves, and reopens without changing an unsupported capsule.

**Architecture:** A bounded DOCX adapter owns ZIP/XML I/O. A tiny canonical store owns one Yjs body sequence and immutable mark contributions. A minimal ProseMirror binding projects that store through the existing `EditorDriver`; one Playwright test is the completion boundary.

**Tech Stack:** TypeScript, Bun, Yjs, JSZip, ProseMirror, Vite, Playwright.

## Global constraints

- No production package migration.
- No new oracle/protocol/review suite unless a failing POC behavior requires it.
- Treat loaded DOCX bytes as untrusted: bounded ZIP/XML, no DTD, no traversal, no external fetch, no HTML-from-strings.
- One body story, one paragraph, text, bold, italic, one unsupported capsule.
- One opening boundary per paragraph; the last paragraph ends at sequence end.
- Candidate B immutable mark contributions only.
- Existing unrelated tests remain green.

---

### Task 1: Rewrite OpenSpec around the POC finish line

**Files:**
- Modify: `openspec/changes/engine-core-spike/proposal.md`
- Modify: `openspec/changes/engine-core-spike/design.md`
- Modify: `openspec/changes/engine-core-spike/tasks.md`
- Modify: `openspec/changes/engine-core-spike/specs/engine-falsification-spike/spec.md`
- Modify: other spike specs only where they impose superseded gate prerequisites

- [ ] Replace the remaining falsification tasks with five POC milestones.
- [ ] Preserve completed v1 rejection, Candidate B, lean contracts, and transaction executor as historical/retained decisions.
- [ ] Move the fifteen gates to deferred risks; they are not POC prerequisites.
- [ ] Declare the single Playwright flow as the binary completion condition.
- [ ] Run `openspec validate engine-core-spike --strict`.
- [ ] Commit with `--no-verify`.

### Task 2: Bounded minimal DOCX adapter

**Files:**
- Create: `spike/engine-core-spike-harness/src/poc/docx.ts`
- Create: `spike/engine-core-spike-harness/tests/poc-docx.test.ts`
- Modify: harness package dependencies/exports as required

**Interface:**

```ts
export interface LoadedPocDocx {
  readonly text: string;
  readonly runs: readonly { text: string; bold: boolean; italic: boolean }[];
  readonly paragraphId: string;
  readonly capsuleBytes: Uint8Array;
  readonly sourceBytes: Uint8Array;
}

export function createPocDocxFixture(): Promise<Uint8Array>;
export function loadPocDocx(bytes: Uint8Array): Promise<LoadedPocDocx>;
export function savePocDocx(
  source: LoadedPocDocx,
  runs: readonly { text: string; bold: boolean; italic: boolean }[]
): Promise<Uint8Array>;
```

- [ ] Write RED tests for fixture load, bounds, DTD/traversal/external relationships, formatting parse, save/reopen, and exact capsule bytes.
- [ ] Generate a deterministic standards-minimal DOCX in memory.
- [ ] Implement bounded JSZip entry validation and parser-neutral XML checks.
- [ ] Patch only the owned paragraph range; XML-escape all text.
- [ ] Run focused/full/typecheck/OpenSpec checks and commit.

### Task 3: Tiny canonical Yjs store and collaboration

**Files:**
- Create: `spike/engine-core-spike-harness/src/poc/store.ts`
- Create: `spike/engine-core-spike-harness/tests/poc-store.test.ts`
- Modify: `spike/engine-core-spike-harness/src/index.ts`

**Interface:**

```ts
export interface PocSnapshot {
  readonly paragraphId: string;
  readonly text: string;
  readonly runs: readonly { text: string; bold: boolean; italic: boolean }[];
}

export interface PocStore {
  readonly actorId: string;
  snapshot(): PocSnapshot;
  insert(offset: number, text: string): void;
  delete(start: number, end: number): void;
  toggleMark(start: number, end: number, kind: 'bold' | 'italic'): void;
  undo(): boolean;
  encodeUpdate(): Uint8Array;
  applyRemoteUpdate(update: Uint8Array): void;
  subscribe(listener: (snapshot: PocSnapshot) => void): () => void;
}
```

- [ ] Write RED tests for load state, edits, formatting, two-way convergence, remote preservation under local undo, and deterministic snapshots.
- [ ] Implement one `Y.Text` plus creation-only `markContributions`.
- [ ] Use the synchronous transaction executor for local mutations.
- [ ] Use one `Y.UndoManager` per actor/session; remote updates remain untracked.
- [ ] Keep projection direct and bounded to the one POC paragraph.
- [ ] Run focused/full/typecheck/OpenSpec checks and commit.

### Task 4: ProseMirror browser POC and EditorDriver

**Files:**
- Create: `spike/engine-core-spike-harness/poc/index.html`
- Create: `spike/engine-core-spike-harness/poc/main.ts`
- Create: `spike/engine-core-spike-harness/src/poc/browser-editor-driver.ts`
- Create: `spike/engine-core-spike-harness/tests/poc-browser-binding.test.ts`
- Modify: harness scripts/dependencies

- [ ] Write RED tests for model-first text mapping, selection, mark toggle, reconciliation, and loop prevention.
- [ ] Mount a minimal ProseMirror editor plus read-only replica view.
- [ ] Map text transactions through the store, then reconcile from snapshots.
- [ ] Implement the existing `EditorDriver` methods without exposing `EditorView`.
- [ ] Add accessible controls/status for load, bold, italic, undo, save, and reopen.
- [ ] Add `poc:dev` and `poc:build` scripts.
- [ ] Run focused/build/full/typecheck checks and commit.

### Task 5: Save/reopen Playwright finish line

**Files:**
- Create: `e2e/engine-poc.spec.ts`
- Create: `e2e/helpers/poc-editor-driver.ts`
- Modify: POC code only where the behavior test reveals a defect
- Update: `openspec/changes/engine-core-spike/tasks.md`
- Create: `openspec/changes/engine-core-spike/poc-result.md`

- [ ] Start the POC dev server.
- [ ] Drive load → edit → bold → replica convergence → remote edit → local undo → save → reopen through `EditorDriver`.
- [ ] Assert reopened text/formatting/paragraph identity and exact capsule hash.
- [ ] Run the focused Playwright test and core spike checks.
- [ ] Record the URL/command, result, and deferred risks.
- [ ] Mark the POC complete and commit with `--no-verify`.
