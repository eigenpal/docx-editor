# M4.7 demo boundary

Recorded: 2026-07-25. Which demo surface means what, and what may be claimed
about each.

## Surfaces

> **Updated at task 6.6 (M6):** the one-surface editor is now the **default**.
> `/` mounts it in both adapters with no query parameter; `?realAdapter=1` still
> resolves so existing gates and bookmarks keep working. The museum App moved
> behind an explicit `?museum=1`.

| URL | Surface | What it is | Claim allowed |
| --- | --- | --- | --- |
| `/` (default) and `?realAdapter=1` | **One-surface editor** | The production adapter with the M4/M5.1 shell. Real pointer and keyboard input on painted pages. | **Internal/preview alpha only.** The only surface any interaction claim is made about. |
| `?edit=1` | **Diagnostic split edit/preview** | A visible/hidden ProseMirror pane beside a paginated preview. Proves the model pipeline commits and repaints. | **Non-conformance UI.** Explicitly **not** painted-page interaction. Task 6.6 removes it from normal startup. |
| `?preview=engine` | Read-only engine preview | Paginated paint, no editing. | Paginated preview repaint only. |

> **Corrected.** This row previously read `?enginePreview=1`. Both entrypoints test
> `params.get('preview') === 'engine'`, and `?enginePreview=1` satisfies none of the
> three opt-outs — so it falls through and mounts the **one-surface editor**, the
> opposite of what the row promised. Since M4.7's whole deliverable is this
> boundary record, a reviewer following it would have exercised the editor while
> believing they were in the read-only preview. Caught by the round-3 evidence
> audit.
| `?museum=1` | Retired museum | Reference only, no longer the default. | **None.** Never a claim surface. |

The routing comment in `examples/vite/src/main.tsx` states this at the branch
itself, so the next person reading the code sees the boundary without finding
this file.

## The `/` default switched at task 6.6

M4 deliberately did **not** switch the root URL: Vue had no one-surface wiring
yet, so switching then would have made the default demo good in React and broken
in Vue. Task 6.6 switched it only after the paired baseline passed in both
adapters (`test:e2e:paired-one-surface-interaction`, 7/7).

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
