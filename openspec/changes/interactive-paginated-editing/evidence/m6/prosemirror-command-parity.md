# M6K.1 — ProseMirror command parity (React)

The one-surface bridge had taken over semantic editing and implemented less of it than
ProseMirror already does, so familiar platform behavior was simply dead.

## What was wrong

`beforeinput` handled only `deleteContentBackward` and `deleteContentForward`, and
everything else fell through to a catch-all that recorded `unsupportedInputType` and
called `preventDefault()`. That silently killed **Cmd/Ctrl+Backspace**,
**Alt/Option+Backspace**, their forward variants, `deleteEntireSoftLine`, and
**Shift+Enter**.

The bridge also claimed logical **Left/Right** as "geometry keys" and reimplemented
grapheme movement, including every Shift/Cmd/Ctrl/Alt word- and line-jump variant that
PM already handles correctly.

## Ownership, restored

| Owner | Commands |
| --- | --- |
| **ProseMirror** | Backspace/Delete, word and soft/hard-line deletion, Enter, Shift+Enter, Select All, undo/redo, formatting shortcuts, logical Left/Right and every modifier variant |
| **Engine** | ArrowUp/ArrowDown, Home/End, PageUp/PageDown, painted-page boundaries, stale-frame validation, read-only and capability preflight, all hit-test and layout geometry |

The split is **"needs geometry"** versus **"needs the document"**, not "navigation" versus
"editing". Vertical movement and line/page edges genuinely require layout — only the
engine knows where a visual line begins or which page is mounted. Horizontal movement by
one grapheme does not.

Delegated `beforeinput` types return `false`, so the contenteditable performs the edit and
PM's DOM observer reconciles it into a transaction — exactly how raw PM behaves. The store
still updates through `dispatchTransaction`, so the model stays canonical. Safe at the
trust boundary: each delegated type removes a range or inserts a break and carries no
external payload, unlike paste and drop, which keep their bounded handling.

## Selection publication

PM now owns commands that change the selection **without changing the document**, and
those commit nothing. Without a hook the interaction frame kept the selection from the
last commit, so the painted caret stopped following the caret the user was moving the
moment they pressed an arrow. `onSelectionChanged` publishes PM's selection into the
current frame. This was caught by the React interaction gate, not by inspection.

## Differential gate

`bun run test:e2e:react-pm-command-parity` — **7 passed**. It mounts a RAW ProseMirror
editor beside the production surface (behind `?pmref=1`, never in the normal demo) and
drives both with the same real keystrokes.

| Assertion | Result |
| --- | --- |
| Reference and production start from the same text | pass |
| Word-wise deletion removes a **word**, not a character | pass |
| `deleteWordBackward/Forward`, `deleteSoftLineBackward`, `deleteHardLineBackward`, `insertLineBreak` are **not rejected** by the input policy | pass — zero rejected |
| Select All + Backspace clears; undo restores | pass |
| Enter splits the paragraph | pass |
| Logical Left/Right are not routed to the engine | pass (bridge-level assertion is headless, in `adapter-event-bridge.test.ts`) |
| An engine-refused geometry key cannot be pre-empted — caret unmoved | pass |

Word deletion is measured as a **caret delta**, not against an expected string. The first
version of this test pressed `End` first, but `End` is not bound in PM's `baseKeymap`, so
the caret stayed mid-line and the test compared the wrong thing. The delta is independent
of where the click landed and of whether the browser includes the trailing space in the
word — and it still discriminates the regression, which reduced word deletion to a single
character or rejected it entirely.

## Not claimed

Undo granularity is unchanged (this undoes per keystroke; Word coalesces bursts) and is
recorded in the M3 summary. No feature-support claim is widened.

## Gates

React interaction 12/12, PM command parity 7/7, engine + react suites 592 pass,
`adapter-event-bridge.test.ts` pins the key ownership headlessly.
