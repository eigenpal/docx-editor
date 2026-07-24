# M4.7 demo boundary

Recorded: 2026-07-25. Which demo surface means what, and what may be claimed
about each.

## Surfaces

| URL | Surface | What it is | Claim allowed |
| --- | --- | --- | --- |
| `?realAdapter=1` | **One-surface editor** | The production `@docx-editor.dev/react` adapter with the M4 shell. Real pointer and keyboard input on painted pages. | **Internal React alpha with shell.** The only surface any interaction claim is made about. |
| `?edit=1` | **Diagnostic split edit/preview** | A visible/hidden ProseMirror pane beside a paginated preview. Proves the model pipeline commits and repaints. | **Non-conformance UI.** Explicitly **not** painted-page interaction. Task 6.6 removes it from normal startup. |
| `?enginePreview=1` | Read-only engine preview | Paginated paint, no editing. | Paginated preview repaint only. |
| `/` (default `App`) | Retired museum | Reference only. | **None.** Never a claim surface. |

The routing comment in `examples/vite/src/main.tsx` states this at the branch
itself, so the next person reading the code sees the boundary without finding
this file.

## The `/` default is unchanged in M4

M4 does **not** switch the root URL. That is **M6 / task 6.6**, and it is gated
on the paired one-surface baseline passing in *both* adapters. Vue has no
one-surface wiring yet (6.3 / M5), so switching `/` now would make the default
demo better in React and broken in Vue.

## What the shell does not add

The shell is chrome. It introduces no document state, no measurement, and no
horizontal offset of its own — page centering stays the page stack's job,
because a shell-introduced offset is precisely what broke hit testing in M3.

Controls with no contract behind them are **disabled or absent, never faked**:

| Control | State | Reason |
| --- | --- | --- |
| Underline | Rendered, disabled, engine reason as tooltip | `w:u` carries a style; `RunProps.underline` is a boolean; the serializer fails closed |
| Ruler margin / indent / tab handles | Absent | No section-geometry contract in this change |
| Toolbar active-state highlight | Absent | `selectionFormatting` still returns a neutral default |
| Find/replace, hyperlink, insert image/table/symbol, image and footnote properties | Absent | Each needs an insert or mutate contract this change does not own |
| Comments, tracked changes, outline, agent panel | Absent | Annotations are section 9 |

## Standing gate

`bun run test:e2e:react-one-surface-interaction` re-runs at **M4-R1** against the
shell. Chrome that breaks click-to-caret is a failed port however good it looks;
all 11 scenarios pass through the shell as of commit `checkpoint-78c75dee`.
