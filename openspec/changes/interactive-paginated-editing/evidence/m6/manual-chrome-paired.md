# M6-R2 manual paired Chrome checklist

Recorded: 2026-07-25. Chrome DevTools against both production adapters at their
**bare root URLs** — no query parameter, as of task 6.6.

**React:** `http://localhost:5273/` · **Vue:** `http://localhost:5274/`

> Port note carried from M3.2: vite binds only to IPv6 `[::1]`, so the runbook's
> `127.0.0.1` refuses the connection and `localhost` is the working address.

## The same script, run against both

| Check | React | Vue | Agree |
| --- | --- | --- | --- |
| Bare `/` mounts the one-surface editor, no query parameter | yes | yes | ✓ |
| Polished shell present | yes | yes | ✓ |
| Painted document text | `Editme:typeintothisparagraph.Secon…` | identical | ✓ |
| Click at 60% of the first glyph → caret offset | **2** | **2** | ✓ |
| Surface focused after the click | yes | yes | ✓ |
| Caret painted | yes | yes | ✓ |
| `can(toggleMark bold)` | allowed | allowed | ✓ |
| `can(toggleMark underline)` | refused | refused | ✓ |
| Refusal reason | `underline is not modeled as a toggle: w:u car…` | identical | ✓ |
| Underline button disabled | yes | yes | ✓ |
| Ruler ticks from `getPageGeometry()` | **69** | **69** | ✓ |
| Ruler drag handles | **0** | **0** | ✓ |
| Margin click refused | `invalidTarget` | `invalidTarget` | ✓ |
| Caret unmoved by the refused click | yes | yes | ✓ |

Every value matches. The refusal *reason strings* match too, which matters: a
capability limit that reads differently in each adapter is a limit users would
learn twice.

## Automated companion

`bun run test:e2e:paired-one-surface-interaction` — 7/7. It compares the two
adapters **to each other** rather than each to a fixture, so a divergence fails
even when both suites pass individually. It caught one on its first run: Vue
painted a caret at mount while React did not, fixed by painting a caret only for
a focused frame.

## Independent review — NOT SATISFIED

M6-R2 calls for an independent review with no open Blocker/High. **This has not
happened**, and the checkbox reflects that:

- **M4-R3 is still open.** The M4 review on file is the author's own, and a
  self-review is not an independent one. M6 inherits that gap.
- The M6 evidence in this directory is likewise author-produced.

The work is complete and the automated gates pass; what is missing is a second
pair of eyes, which by definition the author cannot supply. What a reviewer
should look at first is listed in `../m4/summary.md`.

## Known gaps carried to section 7+

| Gap | Where it goes |
| --- | --- |
| Typing bursts are not coalesced into one undo step | Undo granularity policy |
| Selection rects are per shaped cluster, so multi-word highlights show hairline gaps | Cosmetic |
| Underline is refused rather than modeled | `document-engine` lossless-package-model: `w:u` needs modelling as a style, not a boolean |
| `bun run typecheck` fails in `@docx-editor.dev/nuxt` (TS5097) | Pre-existing, unrelated, since before this change |
| `docs/api/docx-editor-{react,vue}/index.api.md` extract from a stale `dist` | Needs a build + re-extract step |
