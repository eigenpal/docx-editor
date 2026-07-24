# M1 summary (task M1-R2)

Recorded: 2026-07-24. Milestone **M1 — finish 5.5 + body-paragraph 5.6a +
synchronous stale 5.7a**.

## Progress ledger

| Snapshot | Count | Notes |
| --- | --- | --- |
| After **M0-R2** | **35 / 114** | Authority/import re-check recorded |
| After **5.6a** (commit **`checkpoint-aef0c191`**) | **36 / 114** | Body-paragraph interaction roles |
| After **5.7a** (commit **`checkpoint-c2e4721a`**) | **37 / 114** | Synchronous stale-frame protection |
| After **M1-R1** (commit **`checkpoint-f5fe70c3`**) | **38 / 114** | Verification evidence |
| After **M1-R2** (this artifact) | **39 / 114** | Milestone summary |

## What M1 landed

### 5.5 — geometry-owned keyboard navigation (commit `checkpoint-a7763cfb`)

Landed before this session picked up the queue; not re-opened here.

### 5.6a — body-paragraph interaction safety subset (commit `checkpoint-aef0c191`)

| Region / role | Declared behavior |
| --- | --- |
| Editable body text | Accepted — caret, shift-extend, word, block selection |
| Read-only / selectable body text | Fail closed with typed `readOnly` at every click count; never yields an editable caret |
| Page background, page margins | Typed `invalidTarget` naming the region; selection unchanged |
| Inter-page gap | Typed `invalidTarget` with its own reason; selection unchanged |
| `atomicObject`, `control`, `annotation`, `background` roles | Fail closed with typed `unsupported` |

Both empty regions stay `invalidTarget` rather than gaining a second code. The
normative page-gap scenario is "return no target and SHALL NOT move the
selection", which is an empty region, not a capability gap — and two committed
tests (`interaction-planner-click.test.ts`,
`interaction-planner-word-click.test.ts`) already pin that code for gaps.

**Fail-open defect closed in the same task:** a mutating command or native input
delivered while the selection covered a read-only block reached the store
unchecked. Both are now refused with a typed `readOnly`. `undo`, `redo`, and
`setSelection` stay available, so a caret parked in read-only text cannot wedge
history.

### 5.7a — synchronous stale-frame protection (commit `checkpoint-c2e4721a`)

Three fail-open paths were confirmed by probe before the fix and now return
typed outcomes:

| Input | Was | Now |
| --- | --- | --- |
| Selection minted on a superseded frame (`frameId` 0 applied to frame 1) | Synced | `staleFrame` |
| Grapheme offset past current canonical count (999 on a 5-grapheme block) | Synced at the stale offset | `invalidTarget` — refused, never clamped |
| Story or block absent from current canonical state | Synced | `invalidTarget` |

Non-integer, negative, `NaN`, and `Infinity` offsets fail closed. Shift-click
composes its range from the frame's retained anchor, so the composed selection
is re-resolved against canonical state before it can reach the store.

Resolution reads the frame handed to the planner, never a retained one — proven
by a test where the same selection is valid against one frame and refused
against a later frame whose canonical state shrank.

## Interpretation recorded for review

Task 5.6a's pass boundary says "supported read-only body text remains
selectable". This landed as **fail-closed classification**: read-only body text
keeps the `selectableText` role and consistently returns a typed `readOnly`
outcome, rather than becoming user-selectable.

Reasons:

- Drag selection (`drag-session.ts`) and keyboard navigation
  (`keyboard-navigation.ts`) both already reject read-only text, and neither is
  in the 5.6a staging manifest. Making click-selection permissive alone would
  create a seam where a user can click into read-only text but cannot arrow out
  of it or drag across it.
- The alternative opens a mutation path into read-only content, which the same
  pass boundary forbids.

If the intent was user-selectable read-only text (select and copy, no typing),
it is a small follow-up that must move click, drag, and keyboard together in one
manifest. **This is the one M1 decision worth a second opinion.**

## Gate status

| M1 requirement | Status |
| --- | --- |
| 5.5 complete | Pass (`checkpoint-a7763cfb`) |
| 5.6a complete | Pass (`checkpoint-aef0c191`) |
| 5.7a complete | Pass (`checkpoint-c2e4721a`) |
| M1-R1 test bundle | Pass — 82 pass, 0 fail |
| Strict OpenSpec validation | Pass |
| `git diff --check` | Pass |
| `bun run typecheck` | **Fail — pre-existing `@docx-editor.dev/nuxt` TS5097, outside M1 scope; see `verification-log.md`** |

**5.6**, **5.7**, and **5.8** remain unchecked and deferred per the milestone
map: full role matrix after M6, async anchor rebase with section 7, collaboration
after the sync prerequisite.

## Claim allowed after M1

**None.** M1 is engine-internal. React and Vue still do not forward visible-page
pointer or keyboard events into the controller, so there is still no manually
editable surface. That is M2 (shared CSS, event bridge, overlays, deterministic
click target) and M3 (React painted-page wiring with real browser evidence).
