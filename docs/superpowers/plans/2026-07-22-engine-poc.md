# Browser/Yjs/DOCX Engine POC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Deliver a browser-visible editor that loads one minimal DOCX, edits
and formats text, synchronizes two Yjs replicas, performs actor-local undo,
saves, and reopens while preserving semantic state and one captured unsupported
capsule substring.

**Architecture:** A bounded DOCX adapter owns ZIP/XML I/O. A tiny canonical
store owns one Yjs body sequence and immutable mark contributions. A minimal
ProseMirror binding projects that store through the existing `EditorDriver`.
Save/reopen integration closes the file loop, and one Playwright test is the
binary completion boundary.

**Tech stack:** TypeScript, Bun, Yjs, JSZip, ProseMirror, Vite, Playwright.

## Setup already completed

The OpenSpec scope rewrite is completed decision/setup history. It is not a POC
product task and does not count as product progress. All five tasks below are
initially pending.

## Global constraints

- No production package migration or full adapter/browser parity claim.
- No new oracle/protocol/review suite unless a failing POC product behavior
  requires it; direct behavior tests own expectations.
- Treat loaded DOCX bytes as untrusted: bounded ZIP/XML, no DTD, no traversal,
  no external relationships, no HTML-from-strings.
- One body story, one paragraph, text, bold, italic, one unsupported capsule.
- One opening boundary per paragraph; the last paragraph ends at sequence end.
- Candidate B immutable mark contributions only.
- Exact byte preservation applies only to the captured unsupported capsule
  substring in uncompressed `word/document.xml`. The owned paragraph region may
  be rebuilt; ZIP metadata/entry compression may change; other required parts
  remain semantically valid but are not archive-byte comparators.
- Existing unrelated tests remain green.

---

### Task 1: Bounded minimal DOCX boundary

**Files:**
- Create: `spike/engine-core-spike-harness/src/poc/docx.ts`
- Create: `spike/engine-core-spike-harness/tests/poc-docx.test.ts`
- Modify: harness dependencies/exports as required

```ts
interface LoadedPocDocx {
  readonly text: string;
  readonly runs: readonly { text: string; bold: boolean; italic: boolean }[];
  readonly paragraphId: string;
  readonly capsuleBytes: Uint8Array;
  readonly sourceBytes: Uint8Array;
}

createPocDocxFixture(): Promise<Uint8Array>;
loadPocDocx(bytes: Uint8Array): Promise<LoadedPocDocx>;
```

- [ ] Write direct tests for deterministic load, formatting parse, ZIP/XML
  bounds, DTD, traversal, oversized parts, and external relationships.
- [ ] Generate one standards-minimal deterministic DOCX in memory.
- [ ] Capture one unsupported capsule substring from uncompressed
  `word/document.xml`.
- [ ] Run focused/full/typecheck/OpenSpec checks and commit.

### Task 2: Tiny canonical Yjs store

**Files:**
- Create: `spike/engine-core-spike-harness/src/poc/store.ts`
- Create: `spike/engine-core-spike-harness/tests/poc-store.test.ts`
- Modify: `spike/engine-core-spike-harness/src/index.ts`

```ts
interface PocStore {
  snapshot(): PocSnapshot;
  insert(offset: number, text: string): void;
  delete(start: number, end: number): void;
  toggleMark(start: number, end: number, kind: 'bold' | 'italic'): void;
  undo(): boolean;
  encodeUpdate(): Uint8Array;
  applyRemoteUpdate(update: Uint8Array): void;
}
```

- [ ] Write direct tests for load state, edits, formatting, deterministic
  snapshots, two-replica convergence, and actor-local undo preserving remote
  work.
- [ ] Implement one `Y.Text`, opening-boundary grammar, and Candidate B
  `markContributions`.
- [ ] Use the retained synchronous executor and one `Y.UndoManager` per
  actor/session; remote updates remain untracked.
- [ ] Run focused/full/typecheck/OpenSpec checks and commit.

### Task 3: Visible ProseMirror editor through EditorDriver

**Files:**
- Create: `spike/engine-core-spike-harness/poc/index.html`
- Create: `spike/engine-core-spike-harness/poc/main.ts`
- Create: `spike/engine-core-spike-harness/src/poc/browser-editor-driver.ts`
- Create: `spike/engine-core-spike-harness/tests/poc-browser-binding.test.ts`
- Modify: harness scripts/dependencies

- [ ] Write direct tests for model-first text mapping, selection-assisted mark
  toggles, reconciliation, and loop prevention.
- [ ] Mount a minimal ProseMirror editor plus read-only synchronized replica.
- [ ] Implement existing `EditorDriver` operations without exposing
  `EditorView`.
- [ ] Add accessible controls/status and `poc:dev`/`poc:build`.
- [ ] Run focused/build/full/typecheck checks and commit.

### Task 4: Save and reopen integration

**Files:**
- Modify: `spike/engine-core-spike-harness/src/poc/docx.ts`
- Modify: `spike/engine-core-spike-harness/src/poc/browser-editor-driver.ts`
- Create: `spike/engine-core-spike-harness/tests/poc-save-reopen.test.ts`

```ts
savePocDocx(
  source: LoadedPocDocx,
  runs: readonly { text: string; bold: boolean; italic: boolean }[]
): Promise<Uint8Array>;
```

- [ ] Write direct save/reopen tests before implementation.
- [ ] Rebuild only the owned paragraph region and XML-escape authored text.
- [ ] Reopen through the same bounded adapter.
- [ ] Assert semantic text/formatting, stable paragraph identity, and exact
  captured capsule substring; keep other required DOCX parts semantically valid.
- [ ] Run focused/full/typecheck/OpenSpec checks and commit.

### Task 5: One Playwright E2E finish line

**Files:**
- Create: `e2e/engine-poc.spec.ts`
- Create: `e2e/helpers/poc-editor-driver.ts`
- Modify: POC code only where the behavior test reveals a defect
- Create: `openspec/changes/engine-core-spike/poc-result.md`

- [ ] Start the POC dev server.
- [ ] Drive load → edit → formatting → replica convergence → remote edit →
  local undo preserving remote work → save → reopen through `EditorDriver`.
- [ ] Assert reopened semantic state, stable paragraph identity, and exact
  captured capsule substring.
- [ ] Run focused Playwright and core spike checks.
- [ ] Record command/URL, result, and deferred risks; mark all five POC
  milestones complete only when this final flow passes.
