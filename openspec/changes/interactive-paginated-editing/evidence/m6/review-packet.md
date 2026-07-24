# Review packet — M4-R3 and M6-R2

Prepared 2026-07-25 for the **independent reviewer** those two gates require.
Written by the author of the change, which is exactly why it cannot substitute
for the review: it tells you where to look, not whether the work is sound.

**Scope:** `checkpoint-90e74c0a..HEAD`, 40 commits, 84 files, +6644 / −259.
**Both gates ask the same thing:** no open Blocker/High.

## Re-verify every claim in ~10 minutes

```bash
bun test                                          # 1814 pass / 6 fail (all pre-existing)
bun run check:export-parity                       # 47 names match
bun run check:parity-contract                     # pass
bun run check:editor-contract                     # pass
bun run check:adapter-css-thin                    # pass
openspec validate interactive-paginated-editing --strict

# Browser gates (vite binds IPv6 [::1] — use localhost, not 127.0.0.1)
bun run verify:real-adapter-smoke                 # 2/2
bun run verify:real-adapter-gate                  # 12/12
bun run verify:a11y-tree                          # 9/9  (free port 5299 first)
bun run test:e2e:react-one-surface-interaction    # 11/11
bun run test:e2e:vue-one-surface-interaction      # 11/11
bun run test:e2e:paired-one-surface-interaction   # 7/7
```

Any pre-existing failure can be confirmed by re-running it at `checkpoint-90e74c0a`.

## The six places I would look first

Ordered by how much damage a mistake there would do.

### 1. `runEditCommand` dry-run — `engine-binding/src/edit-surface.ts`

`can()` answers by running the real ProseMirror command with **no dispatch**.
That is the standard PM idiom and cannot mutate, but it is the one place where a
"read-only question" executes command code. If it can be made to mutate, every
toolbar `can()` call becomes a silent edit.

### 2. Selection re-resolution — `engine-editor/src/interaction-planner.ts` (5.7a)

`resolveSelectionAgainstCanonicalState` is the only thing standing between a
stale selection and the store. It refuses rather than clamps. **Check the
inverse:** is there any path to `syncSelection` that does *not* pass through it?
I closed `semanticSelection` and shift-click; drag lives in `drag-session.ts`
and resolves through `hitTestPointer` instead.

### 3. Capsule formatting reader — `engine-layout/src/capsule-run-style.ts`

Parses attacker-controlled `w:rPr` text from a `.docx`. Bounded character walk,
no backtracking regex, explicit-off `w:val` respected, `w:bCs` must never
satisfy `w:b`. Worth an adversarial read: it is new code on the untrusted-input
path.

### 4. Read-only fail-open guard — `interaction-planner.ts` (5.6a)

Mutating commands and native input are refused when the selection covers a
read-only block; `undo`/`redo`/`setSelection` are exempted so a caret parked in
read-only text cannot wedge history. **Check the exemption list is not too
broad.**

### 5. `useEditorSnapshot` re-render cost — both adapters

Subscribes to `change`, `selectionChange`, and `display`, unthrottled. Under
sustained typing the toolbar re-renders per keystroke. No measured problem, but
it is the most likely performance complaint and the easiest thing to have got
wrong.

### 6. The underline decision — M4.0

Underline is **wired but refused**, because `w:u` carries a style
(single/double/wave) while `RunProps.underline` is a boolean, and the serializer
already fails closed on it. A reviewer may reasonably want underline modelled as
a style instead — a `document-engine` lossless-package-model change, not a
toolbar one. This is a judgement call, not a defect, and it deserves a second
opinion.

## Things I got wrong during the session, and corrected

Listed because a reviewer should weigh how much to trust the rest.

| What | Correction |
| --- | --- |
| Reported bold as **silently lost on save** | Wrong. Inflating `word/document.xml` from the editor's own `save()` showed `<w:b/>` intact. The real defect was that layout read only `props` and ignored the preservation capsule, so reopened runs painted unstyled. Rendering, not data loss. |
| Reported **6.5 complete** while its checkbox was unflipped | My edit targeted wording the task does not use and silently matched nothing. Progress header had drifted one ahead of the real count. |
| Introduced a **React/Vue export gap** (24 react-only symbols) across M4/M5.1 | Caught only by the full-repo sweep, after eleven targeted suites and six browser gates were all green. Fixed; 47 names now match. |
| Called `check:public-docs-surface` a stale-path gate | It is not. It accurately reports that the greenfield packages do not export a surface the docs still promise. |

## Known-open, deliberately not fixed

| Item | Why |
| --- | --- |
| Undo bursts not coalesced into one step | No granularity policy specified; specs assert a single character rather than pin one |
| Selection rects per shaped cluster (hairline gaps between words) | Cosmetic; geometry is correct |
| `check:public-docs-surface` | Needs a product decision, and two of its three groups are retired authority forbidden here |
| `@docx-editor.dev/nuxt` TS5097 | Pre-existing, unrelated, fails identically at `checkpoint-90e74c0a` |
| React/Vue API snapshots | Untracked, on the preserve-list, extract from a stale `dist` |

## Sign-off

If nothing above rises to Blocker/High, check **M4-R3** and **M6-R2** in
`tasks.md` and record the reviewer and date here. Allowed claim on sign-off is
**internal/preview alpha for a bounded document** — not public
`interactive-paginated`, which remains task **8.10**.

Reviewer: ______________________  Date: ____________  Blocker/High found: ______
