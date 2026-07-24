# M4-R2 manual Chrome shell checklist

Recorded: 2026-07-25. Chrome DevTools against the production React adapter with
the M4 shell mounted.

**Server:** `bun run dev:react -- --port 5273 --strictPort`
**URL:** `http://localhost:5273/?realAdapter=1`

> Port note carried from M3.2: vite binds only to IPv6 `[::1]`, so the runbook's
> `127.0.0.1` refuses the connection and `localhost` is the working address.

## Required checks

| # | Check | Result |
| --- | --- | --- |
| 1 | Toolbar enabled state matches `Editor.can({ type: 'toggleMark', mark: 'bold' })` | **Pass** — `can.ok` true, button enabled, agree |
| 1b | A refused control matches its `can` answer | **Pass** — underline `can.ok` false, button disabled, agree; tooltip is the engine's own sentence |
| 2 | Clicking invokes `Editor.exec({ type: 'toggleMark', mark: 'bold' })` | **Pass** — exactly one `exec` call recorded, `{type:'toggleMark',mark:'bold'}`, and `Edit` repainted bold |
| 3 | Save uses `Editor.save()` | **Pass** — one `save()` call, not routed through can/exec |
| 4 | Rulers are display-only | **Pass** — both present, `pointer-events: none`, **0** drag handles or buttons, 69 ticks from `getPageGeometry()` |
| 5 | Backdrop and shadows | **Pass** — page `rgb(255,255,255)` with `rgba(0,0,0,0.15) 0 1px 3px`, shell backdrop `rgb(248,249,250)` |
| 6 | M3.2 click and type still pass through the shell | **Pass** — `test:e2e:react-one-surface-interaction` 11/11 against the shell (M4-R1) |

## Instrumentation

Checks 2 and 3 wrap `editor.exec` and `editor.save` for the duration of the
click and count invocations, then restore them. That distinguishes "the button
did the right thing" from "something changed on screen" — a toolbar that mutated
the document by some other route would fail this check while looking correct.

## Shell composition observed

`docx-editor-shell` → `document-title-bar` (+ `document-title`) →
`docx-editor-toolbar` (`toolbar-undo`, `toolbar-redo`, `toolbar-bold`,
`toolbar-italic`, `toolbar-underline`, `toolbar-save`) → `horizontal-ruler` →
`vertical-ruler` → `docx-editor-scroll` → `one-surface-click-target`.

## Known cosmetic gaps

- The vertical ruler sits at the canvas's left edge rather than beside the page.
  This matches the retired shell, whose vertical ruler was also absolutely
  positioned at its content container's left edge.
- Selection highlights still show hairline gaps between words (per shaped
  cluster). Carried from M3.
- Typing bursts are still not coalesced into one undo step. Carried from M3.
