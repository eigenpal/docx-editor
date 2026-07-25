# Independent review — round 3, and the fixes it forced

Four independent reviewers with fresh context, dispatched against a frozen HEAD,
each told to work read-only and to prove claims by execution rather than reading.

| Lane | Frozen HEAD reviewed | Verdict returned |
| --- | --- | --- |
| Correctness / stale-frame / fail-open | `checkpoint-e3a55ad9` | Blocker/High present (3 High) |
| Security / hostile DOCX | `checkpoint-e3a55ad9` | Blocker/High present (1 High) |
| Architecture / geometry / parity | `checkpoint-e3a55ad9` | Blocker/High present (2 High) |
| Evidence accuracy | `checkpoint-e3a55ad9` | No open Blocker/High; 6 Medium + 8 Low record defects |

Reviewed range: `checkpoint-90e74c0a..checkpoint-e3a55ad9` (51 commits). Fix range: `checkpoint-e3a55ad9..checkpoint-fd4db029`
(5 commits, 15 files, +865/−69).

## The six High findings and their fixes

| # | Finding | Fix |
| --- | --- | --- |
| 1 | After **every** keystroke and relayout the reconciled selection was published with `affinity: 'downstream'`, while the caret-stop index makes `upstream` canonical for interior offsets and the caret-rect lookup required an exact match. Result: `frame.caret` null, no caret element in the DOM, and Home/End/PageUp/PageDown/ArrowUp/ArrowDown all refused with `invalidTarget` — dead keys, because the bridge swallows them in capture phase. Both adapters, primary editing loop. | `checkpoint-a5bf5b95` |
| 2 | `Editor.focus()` could never succeed after any dispatched interaction (`staleFrame`), because the retained selection is tagged with the frame current when it was applied and publishing the overlay immediately mints the next one. Both adapters expose this as `ref.focus()`. Separately, blur never republished `focused: false`, so a caret painted on the page while keystrokes went to the shell's title input. | `checkpoint-f685eede` |
| 3 | `frame.composition` was hardcoded `{ active: false }` and the surface's composition observation was never read, so the public `EditorDriver.compositionState()` was a constant and **no layer could gate on it**. Measured: ArrowDown during a live composition returned `ok: true` and moved the painted caret to a different paragraph while the IME kept composing in the original. | `checkpoint-1a2d48bc` |
| 4 | Paragraph layout still quadratic. `segmentGraphemes(token.text)` evicted the single-entry memo holding the paragraph text once per token (801 full-paragraph passes on 800 words). A **1,897-byte** .docx froze the main thread 41 s on open; 2,585 bytes → 4 m 25 s; re-paid per keystroke. | `checkpoint-b3254bbd` |
| 5 | The input host tracked `scroll` on one element only, so window/ancestor scroll left it at a stale client position — measured **300 px** drift in React, **400 px** in Vue — while `placementReason` still reported `'applied'`. | `checkpoint-fd4db029` |
| 6 | The Vue demo viewport never scrolled (`clientHeight === scrollHeight`, assigned `scrollTop` did not stick), so Vue's only scroll path never fired, drag autoscroll was a silent no-op, and the `scrollEditor(48)` leg of the paired gate **passed vacuously**. | `checkpoint-fd4db029` |

## Fix-quality notes worth keeping

- **Finding 4 was the third attempt at this defect.** The prior two each bought a
  constant factor and left the mechanism running, and the guarding test made it
  worse: it asserted an absolute 2,000 ms at 6,000 chars and its comment recorded
  the residual quadratic as *accepted*, so it passed at 8 ms while the DoS was
  live. The guard is now a deterministic count of characters segmented per layout,
  which measures the amplifier rather than the machine. Verified failing before the
  fix at 80,036,000 characters segmented for a 20,000-character paragraph (4,000x),
  with the size ratio exactly 16x for 4x the text.
- **Finding 1's headless test existed and passed** because it typed at the
  paragraph END — the one offset where the hardcoded affinity is correct. The new
  test types at an interior offset. Same class of near-miss as the gates the
  earlier rounds found.
- **Finding 2's first fix was wrong and a pre-existing test caught it.** Relaxing
  the stale-frame check in `focus()` broke "stale frame focus then beforeinput
  rejects without mutation", which asserts a real guard: a caller holding a
  superseded frame must not be granted input authorization. The fix moved to
  keeping the retained tag truthful (`retainSelectionOnFrame`) rather than
  stopping the check.
- Every fix was verified to FAIL before it was applied, by temporary reversion
  rather than by assumption.

## Also fixed while in the same code

- `utf16AtGraphemeBoundary` returned the grapheme index into a field named
  `utf16Offset` — identical for ASCII, wrong for any astral or combining text, so
  every caret edge of such a paragraph published a wrong UTF-16 offset. Not found
  by any reviewer; found while rewriting the line.
- `clearGraphemeMemo` left the utf16→grapheme index alive across
  `setGraphemeBoundary`/`resetGraphemeBoundary`, so it answered for a boundary
  implementation no longer installed (proved by review).
- The cumulative geometry-trust watermark was not keyed on the metrics port, so a
  permissive port could warm an answer a stricter port then read — publishing a
  caret edge as navigable whose advance is unprovable (proved by review).
- `horizontal-boundary.ts` kept its own duplicate segment memo with no
  invalidation path at all; deleted rather than duplicated.

## Gates at `checkpoint-fd4db029`

| Gate | Result |
| --- | --- |
| `bun test` (whole repo) | 1853 pass / 5 fail / 2 errors — all pre-existing, all in `packages/core/spike/tests/**` |
| `verify:real-adapter-smoke` | 2/2 |
| `verify:real-adapter-gate` | 12/12 |
| `test:e2e:paired-one-surface-interaction` | **14/14** (was 11; +3 scenarios from this round) |
| `bun run typecheck` | only `@docx-editor.dev/nuxt` TS5097, pre-existing |

New paired scenarios added by this round, each verified to fail before its fix:
caret painted and geometry keys alive after typing; a live composition visible to
the frame and blocking geometry keys; the input host following the caret through
container **and** window scroll.

## Record defects the evidence audit found, and their disposition

| Finding | Disposition |
| --- | --- |
| `evidence/m2/summary.md` stated the opposite of the shipped key policy | Corrected, with the reversal and its consequence recorded |
| `browser-platform-matrix.md` contradicted itself (lanes "Planned" vs "AUTOMATED"; paired "7 scenarios") | Corrected; counts now 11/11/14 |
| `full-repo-sweep.md` 14 commits stale, its "no regressions" conclusion falsified in-session | Re-run and rewritten at `checkpoint-fd4db029`, with the falsification recorded |
| Manifest does not account for 16 of 51 commits; `checkpoint-78c75dee` landed five checkboxes | Recorded in the commit protocol; review-fix commits have no checkbox by design, `checkpoint-78c75dee` is a real violation left in the history |
| M4.0's API-snapshot deliverable does not exist (both files untracked) | Recorded as NOT met. Cannot be closed here: those paths are under an explicit never-stage instruction, so it needs an owner decision |
| "8 MB at 0.98–1.16x" wrong by ~40x at HEAD | Replaced with the property that actually matters, measured: capsule cost is FLAT in paragraph length (300/1,200/6,000 chars → +402/+406/+402 ms at ~8 MB). The test now asserts flatness rather than a ceiling |
| Task 6.5's four added legs had no recorded run | Now recorded: 14/14 |
| `demo-boundary.md` documented `?enginePreview=1` as the read-only preview when it mounts the editor | Corrected to `?preview=engine`, with the reason |
| `examples/vite/src/main.tsx` comment contradicted its own code | Corrected |
| `evidence/m1/verification-log.md` supported a correct conclusion with a false claim about TS5097 distribution | Corrected with measured counts (163/54/31/21) |
| Two irreconcilable pre-fix capsule measurements | Both retired; neither is reproducible and nothing relies on them |
| Public `exec`/`can` can still throw for untyped JS callers | Open, Low — tracked below |

## Still open (none Blocker/High)

- `rangeToSelection`'s final branch does `'from' in range` unguarded, so an
  untyped JS caller can raise a `TypeError` out of public `exec`. TypeScript
  prevents it; the contract promises a typed refusal.
- Clamping remains at the `engine-binding/grapheme.ts` sink as well as being
  refused at the boundary; defense in depth wants refuse-or-throw at both.
- Duplicated page-gap authority: `--doc-page-gap` (CSS, overridable) vs
  `DEFAULT_PAGE_GAP_PX` (engine constant), unbound to each other.
- `InteractionHostMetrics` is described three incompatible ways across the
  contract TSDoc, the shipped helper, and its unit test.
- Five shell-component divergences the paired spec cannot see, and no parity
  contract covering the seven shell components.
- Hardcoded English in both adapters' shell components; `packages/i18n/en.json`
  already defines the keys.
- No changeset for a range adding ~19 public exports to two published packages.
- `check:public-docs-surface` fails, correctly, on surfaces the greenfield
  packages do not export; clearing it is a product decision about the published
  contract, and two of the three groups are retired authority forbidden here.

## Round 4

Fresh correctness and security reviewers were dispatched against `checkpoint-fd4db029` with
the same read-only rules, specifically instructed to assume this round's fixes
introduced new defects — each previous round's fixes did.
