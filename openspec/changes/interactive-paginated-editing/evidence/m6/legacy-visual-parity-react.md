# M6V.1 — retired chrome visual parity (React) — REOPENED

> **This task is REOPENED and its checkbox is unchecked again.** Owner review of
> `checkpoint-3315fd89` found it proved only STRUCTURAL PRESENCE — the named regions exist and the
> control counts match — which is not visual parity. The chrome was still built from a
> neutral metadata model rather than from the retired components themselves, so it does
> not look like the reference at
> https://www.docx-editor.dev/editor.
>
> The accepted approach is now to REUSE the actual retired React presentation from
> the recorded presentation baseline — `TitleBar.tsx`, `Toolbar.tsx`,
> `EditorToolbar.tsx`, `ResponsiveToolbar.tsx`, `UnifiedSidebar.tsx`, the ruler
> components and their CSS — behind one thin compatibility adapter onto the public
> `Editor` facade, integrated into `DocxEditor.tsx` directly rather than into a new
> shell. The neutral metadata may supply labels, icons, and ordering; it may not
> substitute for the retired structure or presentation.
>
> Also corrected: parity must be captured against the comprehensive
> `examples/vite/public/sample.docx`, not `editable-sample.docx`, with the preview and
> status diagnostic banners excluded, and both reference and current screenshots
> COMMITTED under evidence rather than left in a gitignored directory.
>
> What follows is the record of the superseded attempt, kept because its measurements
> and the two deviations it documents remain accurate.

---

Reference: the recorded presentation baseline.
Screenshot: `screenshots/m6v1-react-retired-chrome.png`, fixed viewport **1440 x 900**.

> `screenshots/` is gitignored, so the image is a LOCAL artifact and is not part of this
> commit. Regenerate it with `bun run test:e2e:react-retired-chrome-visual`, which also
> asserts every region below — so the structural claims here are enforced by a gate even
> though the image itself is not committed. Do not read the absence of a committed PNG as
> the comparison not having been done.

## Why an earlier commit did not satisfy this task

`checkpoint-fd410052` built generic toolbar metadata and renderers and was titled M6V.1. It did
not satisfy it: the shell was still the simplified M4.2 four-div frame with invented
`ep-shell__*` class names, and the formatting bar was a full-width flat bar with a
bottom border that WRAPPED. The retired bar is a **pill** — `flex items-center px-2 py-1
bg-muted rounded-full min-h-[36px] overflow-x-auto mx-2 mb-1` — which scrolls
horizontally and stays one row tall. A generic toolbar is not visual parity.

## Named regions, verified present in the browser

| Retired region | Present | Evidence |
| --- | --- | --- |
| Shell container | yes | `[data-testid="docx-editor"]`, retired `containerStyle` |
| Title bar | yes | `[data-testid="document-title-bar"]` |
| Menu region | yes | `[data-testid="menu-bar"]`, **4** items (File / Format / Insert / Help) |
| Formatting pill | yes | `.ep-toolbar`, computed `border-radius: 9999px`, `overflow-x: auto` |
| Complete toolbar / ribbon | yes | **29** controls in **11** groups |
| Horizontal ruler | yes | `.docx-editor__ruler-row`, computed `position: sticky` |
| Vertical ruler | yes | `.ep-ruler--vertical`, absolute at the content's left edge, `padding-top: 48` |
| Scroll container | yes | `.docx-editor__scroll-container` |
| Workspace / page chrome | yes | `.docx-editor__content`, 1 painted page |
| Page indicator | conditional | rendered only above 1 page, matching retired (`totalPages > 1`) |
| Sidebar | yes | `[data-testid="docx-editor-sidebar"]` |
| Dialog launch surfaces | yes | **7** launchers, all disabled |

## Enabled controls — exactly the five M6V.1 permits

Measured: `toolbar-undo`, `toolbar-redo`, `toolbar-bold`, `toolbar-italic`,
`toolbar-save`. Nothing else is actionable. Undo/redo/bold/italic each gate on
`Editor.can(command)` before `Editor.exec(command)`; save calls `Editor.save()`.

The other **24** toolbar controls, **4** menu items, and **7** dialog launchers are
visible and permanently disabled, each carrying a localized reason
(`formattingBar.unavailableInPreview`) as `title` and `aria-label`. Underline is
deliberately among them: `RunProps.underline` is a boolean while `w:u` carries a style,
so enabling it would throw on save or silently downgrade a double underline.

## Authority

No ProseMirror import, no retired layout or painter, no DOM-selection authority, and no
adapter-owned geometry. The shell measures nothing and passes no editor to its chrome
slots. `bun test packages/engine-core/test/adapter-authority.test.ts` → 14 pass.

Retired authority NOT implemented, and this is the bulk of what the retired shell was: ruler
mutation callbacks, outline headings, tracked-change style injection, comment sidebar
shift, agent panels, PM-derived overlays, and `onEditorBgMouseDown` /
`onEditorContextMenu` handlers that read DOM selection.

## Two deviations, recorded rather than hidden

1. **Scroll authority.** Retired made `.docx-editor__scroll-container` the sole scroller
   with the ruler sticky inside it. Here the editor's own `.ep-one-surface__viewport`
   remains the scroller, because the engine's input-host tracking, drag autoscroll, and
   twelve React interaction scenarios are wired to it. Moving scroll authority is a
   behavioural change and belongs in its own task, not inside a visual port.
2. **Export parity.** React now exports `DocxEditorMenuBar` and its prop type, which Vue
   does not have. Registered in `notes/intentional-export-divergence.md` with 10V.1 as
   the closing task. That file also repairs the parity gate, whose opt-out pointed at an
   archived path — so `existsSync` was false, no divergence could ever be registered,
   and it still printed "0 documented divergences". Verified the repaired gate still
   FAILS on undocumented drift by injecting a React-only export.

## Gates

| Gate | Result |
| --- | --- |
| `test:e2e:react-one-surface-interaction` | **12/12** |
| `check:adapter-css-thin` | pass |
| `adapter-authority.test.ts` | 14 pass |
| `check:export-parity` | pass, 49 names, divergence documented |
| `test:e2e:paired-one-surface-interaction` | 14/14 |

One React scenario was corrected while landing this: the disabled-control focus probe
measured `boundingBox()` and then clicked by coordinate, which races the pill's
horizontal scroll and lands the click outside the control — indistinguishable from the
defect it guards. It now scrolls into view before measuring.

## Not claimed

Visual parity of the chrome only. No widening of feature support or of the
`interactive-paginated` claim, which remains task **8.10**.
