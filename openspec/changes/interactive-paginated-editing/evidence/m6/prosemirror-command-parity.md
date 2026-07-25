# M6K.1 — ProseMirror command parity (React)

The one-surface bridge had taken over semantic editing and implemented less of it than
ProseMirror already does, so familiar platform behavior was simply dead.

## What was wrong

`beforeinput` handled only `deleteContentBackward` and `deleteContentForward`, and
everything else fell through to a catch-all that recorded `unsupportedInputType` and
called `preventDefault()`. That silently killed **Cmd/Ctrl+Backspace**,
**Alt/Option+Backspace**, their forward variants, and `deleteEntireSoftLine`.
**Shift+Enter** was dead too, and remains unavailable — see "Shift+Enter" below.

The bridge also claimed logical **Left/Right** as "geometry keys" and reimplemented
grapheme movement, including every Shift/Cmd/Ctrl/Alt word- and line-jump variant that
PM already handles correctly.

## Ownership, restored

| Owner | Commands |
| --- | --- |
| **ProseMirror** | Backspace/Delete, word and soft/hard-line deletion, Enter, Select All, undo/redo, formatting shortcuts, logical Left/Right and every modifier variant |
| **Engine** | ArrowUp/ArrowDown, Home/End, PageUp/PageDown, painted-page boundaries, stale-frame validation, read-only and capability preflight, all hit-test and layout geometry |

The split is **"needs geometry"** versus **"needs the document"**, not "navigation" versus
"editing". Vertical movement and line/page edges genuinely require layout — only the
engine knows where a visual line begins or which page is mounted. Horizontal movement by
one grapheme does not.

Delegated `beforeinput` types return `false`, so the contenteditable performs the edit and
PM's DOM observer reconciles it into a transaction — exactly how raw PM behaves. The store
still updates through `dispatchTransaction`, so the model stays canonical. Safe at the
trust boundary: each delegated type removes a RANGE and carries no external payload,
unlike paste and drop, which keep their bounded handling. Nothing in the delegated set
inserts content.

## Shift+Enter — refused, not delegated

`insertLineBreak` was in the delegated set and is not. The composed schema registers no
hard-break node and the model has no `w:br` run, so the browser inserted a break that
ProseMirror then dropped: the revision moved 0 → 0 and zero DOCX parts differed. The user
pressed a key, saw nothing, and got no diagnostic. The input policy now refuses it, which
is honest about a capability the engine does not have.

This is an accepted deviation from M6K.1 as originally written, recorded there, and the
missing capability is owned by task **M6K.2** (`w:br` round-trip). Note the refusal is
currently observable only through `InputRejectionObservation`; no adapter surfaces it to
the user yet, so from the user's seat the key still appears inert.

## Selection publication

PM now owns commands that change the selection **without changing the document**, and
those commit nothing. Without a hook the interaction frame kept the selection from the
last commit, so the painted caret stopped following the caret the user was moving the
moment they pressed an arrow. `onSelectionChanged` publishes PM's selection into the
current frame. This was caught by the React interaction gate, not by inspection.

## Differential gate

`bun run test:e2e:react-pm-command-parity` — **8 passed**. It mounts a RAW ProseMirror
editor beside the production surface (behind `?pmref=1`, never in the normal demo) and
drives both with the same real keystrokes.

The first version of this gate was **unfalsifiable**: it resolved the production surface
with a bare `[contenteditable="true"]`, which on this page is the raw PM reference
(rendered first), so it passed 7/7 with the delegation set emptied and never touched
production. It now uses a scoped `[data-docx-input-host-mount]` selector, seeds the
reference from the OPEN DOCUMENT so both surfaces hold the same paragraphs, and drives
both from the same caret offset. Verified falsifiable: disabling delegation fails 3 of the
8 assertions.

| Assertion | Result |
| --- | --- |
| Reference and production start from the same text | pass |
| Word-wise deletion in production removes a **word**, and never less than raw PM | pass |
| `deleteWordBackward/Forward`, `deleteSoftLineBackward`, `deleteHardLineBackward` are **not rejected** by the production input policy | pass — zero rejected |
| `insertLineBreak` **is** rejected, rather than silently dropped | pass |
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
