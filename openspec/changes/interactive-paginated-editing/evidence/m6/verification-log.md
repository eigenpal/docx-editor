# M6 verification log

Milestone: **M6 — paired bounded-document internal/preview alpha**
Recorded: 2026-07-25. Branch `spec/greenfield-pipeline`.

| Task | Commit |
| --- | --- |
| 6.5 | `checkpoint-3a6a2f6f` |
| 6.6 | `checkpoint-69f92141` |
| M6.1 | `checkpoint-7d870dcc` |

## Gate commands

| Command | Result |
| --- | --- |
| `bun run verify:real-adapter-smoke` | **2 passed** |
| `bun run verify:real-adapter-gate` | **12 passed** |
| `bun run verify:a11y-tree` | **9 passed**, Lighthouse `failedAuditIds: []` |
| `bun run test:e2e:paired-one-surface-interaction` | **7 passed** |
| `bun run check:parity-contract` | **Parity check passed** |
| `openspec validate … --strict` | **valid** |
| `git diff --check` / `git diff --cached --check` | **clean** |
| `bun run typecheck` | Fail — unchanged pre-existing `@docx-editor.dev/nuxt` TS5097 |

Individual suites at the same commit: React one-surface 11/11, Vue one-surface
11/11. Every package typechecks individually.

> `verify:a11y-tree` first failed with `http://127.0.0.1:5299 is already used`.
> That was a leftover dev server from this session's own Chrome work, not a
> product failure; it passes cleanly once the port is free. Recorded because a
> port collision and a real failure look identical in a log.

## What the paired gate proves

The React and Vue specs each prove their own adapter works. The paired spec runs
one scenario set against **both** and compares the results to each other, so a
divergence fails even when both adapters pass their own suite.

| Scenario | Compared across adapters |
| --- | --- |
| Public interaction surface | Identical `data-testid` set |
| Click at the same glyph fraction | Identical caret offsets |
| Typing at the same place | Identical resulting document |
| The same drag | Identical selected range |
| An unsupported command | Identical typed refusal code and reason |
| A margin click | Identical refusal, and no caret movement in either |
| Save and reopen | Identical text after the round trip |

**It found a real divergence on its first run.** Vue painted a caret at mount
while React did not, because whichever adapter synced overlays first showed a
caret for an editor nobody had focused. `overlaysForFrame` now paints a caret
only for a focused frame — Word does not blink a caret at a document nobody is
editing — and the adapters agree.

## The default demo switch (6.6)

`/` mounts the one-surface editor in **both** adapters with no query parameter.
Verified in Chrome at bare `http://localhost:5273/` and `http://localhost:5274/`:
both mount the shell, and clicking a painted glyph places the caret at offset 2
with a painted caret on a focused surface.

`?realAdapter=1` still resolves so existing gates and bookmarks keep working.
The diagnostic split pane (`?edit=1`) and the retired museum App (`?museum=1`)
are reachable only by explicit opt-in; the museum is no longer what a visitor
lands on.

The switch waited for the paired baseline deliberately: M4 left the root URL
alone because Vue had no one-surface wiring then, so switching would have made
the default demo good in React and broken in Vue.

## Gate status

| M6-R1 requirement | Status |
| --- | --- |
| `verify:real-adapter-smoke` | Pass |
| `verify:real-adapter-gate` | Pass |
| `verify:a11y-tree` | Pass |
| `test:e2e:paired-one-surface-interaction` | Pass |
| `check:parity-contract` | Pass |
| Strict validation, diff checks | Pass |
| `bun run typecheck` | Fail — pre-existing nuxt TS5097, outside this change |
