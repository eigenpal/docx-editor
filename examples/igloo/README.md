# Igloo Editor

A fully themed editor, built to answer one question: **how much of this is mine?**

```bash
bun run dev:igloo   # http://localhost:5178
```

Everything on screen composes under `<DocxEditor.Root>`. The arrangement, the icons, the
labels, the colours and the art are the demo's. The engine, the rows, the pickers and every
enabled state are the library's — and none of them had to be reimplemented to be re-skinned.

## What each file demonstrates

| File                   | Customization point                                                                                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IglooEditor.tsx`      | The composition root: `Root` / `Viewport` / `Content` / `Loading`, the workspace row a floating navigation pane anchors to, and where host art goes relative to the page          |
| `IglooToolbar.tsx`     | `Toolbar preset={false}` — a hand-ordered bar, every packaged part re-iconed, the Editing/Suggesting/Viewing pill, and two `Toolbar.Action`s of the demo's own on their own plate |
| `IglooContextMenu.tsx` | `ContextMenu` — packaged rows re-iconed, one removed, a chrome slot pulled in, host rows, two submenus, and the PRO custom-node section                                           |
| `IglooMenu.tsx`        | `Menu` — the registry's menus re-iconed in place, one row appended to Insert, a whole menu the library has never heard of, and Help replaced                                      |
| `IglooReview.tsx`      | The PRO review rail, re-cut: `furniture`, part overrides, a replaced card body, and an appended element of the demo's own                                                         |
| `specimens.ts`         | `defineCustomNode` — two document nodes the library has never heard of, with recognition, chip colour and rail cards                                                              |
| `useSpecimens.tsx`     | The write side: `insertCustomNode` / `updateCustomNode`, the caret capture, and one owner for the dialog, the popover and the notice                                              |
| `SpecimenDialog.tsx`   | Authoring a node: collect attrs, then one call. The whole form is the host's                                                                                                      |
| `SpecimenPopover.tsx`  | What a chip click opens, anchored on the activation's own rect                                                                                                                    |
| `useFrost.ts`          | One host action shared by the toolbar, the menu and the context menu, gated on `Editor.can`                                                                                       |
| `labels.ts`            | A `t` catalogue: the same override path a real locale takes                                                                                                                       |
| `igloo.css`            | The theme. Almost entirely `--doc-*` token overrides                                                                                                                              |
| `icons/`               | The demo's own glyphs — `Frost.tsx` is the shared SVG frame, `toolbar.tsx`, `menu.tsx` and `review.tsx` the three sets                                                            |
| `art/`                 | `IceSea`, `Iceberg`, `Blizzard`, the two specimen glyphs, and their shared seeded RNG. The library knows nothing about any of it                                                  |

Everything at the top level is the API demonstration; `icons/` and `art/` are the theme's own
decoration, kept apart so the composition reads without them.

## The review rail

`DocxEditorReview` from `@docx-editor.dev/pro/react` is the rail. Anchoring, stacking,
virtualization, the collapse-when-displaced rule, accept/reject and the reply box stay the
library's; everything a reader sees is this demo's, through five different rungs at once:

- **`furniture`** — the ice core log above the cards, reading the same `useReview()` the rail
  reads.
- **part `className` / `icon`** — the avatar's rime ring; thaw and refreeze in place of the
  packaged tick and cross. The accessible names stay the library's, which is right: a screen
  reader should hear what the button does, not what the theme calls it.
- **a part's `children`** — `<Review.Summary>` wraps the demo's own body, so `Added` and
  `Deleted` become `Frozen in` and `Calved off` while the packaged wrapper (and its test id,
  and its selectable marking) stays.
- **an unrecognized child** — appended inside every card. That is how the icicle fringe and
  the specimen panel get into a card whose body the library owns.
- **`--doc-*` tokens on the rail** — the author colour ramp restated in cold hues, so Word's
  per-author identity survives the theme instead of being overridden away.

`Toolbar.Comments` opens and shuts it. That is the packaged part on the `review.comments`
slot, so its pressed state is the engine's answer to "is the pane open" — which matters,
because the pane also opens when you click a margin marker or start a comment, and a boolean
kept in this demo would be a third opinion about it. A shut rail gives up its width for a
32px strip of markers, and the rail unmounts its own `furniture` when that happens — the core
log here does nothing to arrange it.

**Tracked changes on the page are themed too, and they are the only canvas thing that is.**
Every mark reads `--doc-revision-*`, so restating those on the page wrapper turns insertions
glacier and deletions meltwater grey. That is not a contradiction of the rule below: revision
marks are the reviewer's chrome drawn over the document, not the document. Switch the toolbar
pill to **Suggesting** and type to see them.

## Where the custom things are

The demo has to answer "which of this did the product add?" as clearly as it answers "how much
of this is mine?", so origin decides placement:

- **The menu bar keeps its conventional names.** File, Format, Insert, Help. An earlier pass
  renamed them to Expedition, Sculpt, Deposit and Survival guide, and it was a mistake twice
  over: a menu bar is navigation, and those four names are the one part of an editor a user
  arrives already knowing — and with every trigger renamed, the product's own menu was just a
  fifth invented word in a row of invented words. Rows _inside_ a menu are fair game, and
  `labels.ts` renames plenty; by then the user has already found the menu they wanted.
- **A capability the editor already has goes where a Word user expects it**, under a themed
  name. A page break is an ordinary insert, so `Split the floe` sits at the bottom of
  **Insert** — appended to the registry's rows, not replacing them (`preset` defaults to
  `true`, which is what appends).
- **What the product added lives in its own menu**, `Custom Actions`, under a `Custom
elements` heading. It holds the two custom node types and nothing else; the host actions
  that drive real engine commands sit below a separator, under their own heading.
- **The right-click menu keeps two submenus** rather than one mixed list — engine inserts in
  `Carve…`, custom nodes in `Custom elements…`.
- **In the toolbar, the demo's own buttons sit on a dashed plate.** A hand-ordered bar loses
  the one signal the packaged arrangement gives for free: everything else there is a chrome
  slot, and these two are not.
- **Every greyed row says why.** `Freeze` carries the engine's own words, from `Editor.can`.
  The node rows carry the host's, because there is no `can` for a node write — the engine's
  verbatim refusal arrives in the notice strip if you get as far as attempting one.

The Editing / Suggesting / Viewing pill is the **packaged** `Toolbar.EditingMode`, restyled by
class. The modes, the radio semantics, the keyboard menu and the engine's refusal on a
read-only document are all the library's — writing a host toggle instead would have been the
mistake this demo is about.

## Custom nodes

`defineCustomNode` registers an **iceberg** and an **igloo**. On disk each is an ordinary
run-level `w:sdt` whose `w:tag` carries the identity and attrs (`igloo:iceberg?depth=412`),
with the label as its content — Word and the free tier open both as plain text, so nothing is
lost either way.

From that one registration the library supplies the chip tint, the click dispatch, the
context-menu Edit/Remove section, and a rail card per node. What each node _means_ is the
demo's:

- an **iceberg** shows its tip in the paragraph; clicking it surfaces what is under the
  water,
- an **igloo** lays another block on every click — a real `updateCustomNode` write, so the
  paragraph's label, the rail card and the saved file all move in one undo step.

Insert one from the **Custom Actions** menu or the right-click **Custom elements…** submenu:
author your own, or
take whatever the water gives. Attrs ride in a `w:tag` Word caps at 64 characters, so the
engine refuses an oversized one with its own reason — which the notice strip repeats verbatim
rather than inventing.

## Three things worth copying

**Re-skinning is token overrides, not component rewrites.** The library's chrome is built on
the `--doc-*` palette, so restating that palette under one scope re-themes the toolbar, menu
bar, panels, pickers, rulers and navigation pane at once. `igloo.css` is mostly that list.

The navigation pane is the sharpest example: it has no panel at all here, just white headings
floating on the sea. That is `--doc-*` restated on `.igloo-nav` and nothing else — custom
properties inherit, so the scope IS the override, and the shell, tabs, search box, rows,
hover and current-item states all follow without one library class being touched.

**A host action still asks the engine.** `Freeze this passage` has no chrome slot, so its
label, glyph and effect are the demo's — but whether it may run comes from `Editor.can` on
the very command it will exec, so it cannot offer something about to be refused, and its
tooltip carries the engine's words rather than a guess. `frost.ts` is that pattern, shared by
both surfaces that expose the action.

**The document canvas is not themed, on purpose.** Painter output stays Word-faithful. A page
that looked like ice would be a lie about what the file contains, so the theme lives in the
chrome, in the sea behind, and in the berg the page rides on. Tracked-change marks are the one
exception, and for a reason: they are the reviewer's chrome drawn over the document rather
than anything the file says.

Full reference: [`docs/CUSTOMIZING.md`](../../docs/CUSTOMIZING.md).

## Notes

- The berg is `position: fixed` rather than stretched behind the page. A document is any
  number of pages tall; one berg stretched over that box smears the crown into a spike.
- Neither the workspace row nor the viewport sets a `z-index`. Either would open a stacking
  context around the context menu, and a `position: fixed` panel cannot escape the context it
  is declared in — it would render under the chrome bar however high its own z-index went.
- Nothing here styles a `docx-*` class or uses `!important`. Those names are implementation
  details, so every visual change goes through a prop, a `--doc-*` token, or an element this
  demo owns. Where that was not possible the library grew a prop instead — trigger icons,
  colour-split icons, and the page's centring margin all came out of writing this. So did
  four fixes: the review rail measures its position from client rects rather than `offsetLeft`
  (a positioned page wrapper used to land it a page-width to the left), `furniture` no longer
  pushes every card down by its own height, a custom node's context-menu card wraps instead of
  setting the width of the whole menu, and the editing-mode menu right-aligns to its pill so a
  toolbar-end control does not open off-screen.
- One constant, `--igloo-stage-top`, is how far below the scroll container the first page
  starts. Three things have to agree with it or they describe a page they are not level with:
  the stage's own top padding, the vertical ruler's zero, and the rail's core log.
- The rail takes no `t` prop, so its own strings (`Accept`, `Reject`, the reply placeholder)
  come from the bundled catalogue. The theme's vocabulary for the tracked-change kinds goes
  through the summary override instead, which is the honest place for it — those are the
  theme's words for the decisions, not a translation of them.
- Help's one packaged row is removed with `<Menu.ReportIssue hidden />`, not with
  `preset={false}`. Help passes that row as a child of its own so the ordinary merge rules
  can reach it, which means `preset={false}` renders it too.
- The menu parts are rows, separators and submenus — no group or heading among them — so the
  section headings are this demo's own `role="presentation"` elements, rendered as
  unrecognized children. Visual grouping only: a bare `div` carrying a role inside
  `role="menu"` would break the ownership a screen reader derives its counts from.
- The sea and the blizzard both honour `prefers-reduced-motion`.
- The share card in `public/og/` is drawn from the same palette the theme is: `igloo-card.svg`
  is the source and `igloo.png` the checked-in render, so a link preview shows this demo's ice
  rather than the site's. Re-render with
  `rsvg-convert -w 1200 -h 630 public/og/igloo-card.svg -o public/og/igloo.png`.
- The default document is `public/sample-igloo.docx` — the shared sample with an iceberg and
  an igloo already saved into it, so the custom nodes and their rail cards are on screen
  before anyone touches a menu. `?fixture=sample.docx` swaps in the Vite example's copy,
  mapped onto the real path by a vite plugin so a second copy of somebody else's file cannot
  drift. That is the only fixture the plugin serves; `e2e/fixtures/` is off limits, because
  those files change to suit a test run and this demo is deployed.

## Deploying

`vercel.json` covers the build. It is its own Vercel project, separate from the parity demo
the repo root deploys, with **Root Directory** set to `examples/igloo`.

Two settings live in the project rather than the file, and it does not build without either:

- **Include source files outside of the Root Directory: on.** `vite.config.ts` aliases the
  library to `../../packages/*/src`, and the fixture plugin reads
  `../../examples/vite/public/sample.docx` and emits it into the bundle.
- **Production Branch: `docx-editor-v2`.** This directory does not exist on `main`.

`build:packages:demo` runs first because only `react`, `vue`, `i18n` and the `core/*` subpaths are
aliased to source. `pro` and `fonts` resolve through node_modules to their `dist/`, which a
clean clone does not have. The install step clears `node_modules` for the reason the root
`vercel.json` does: the build cache and a symlinked workspace disagree.

An **Ignored Build Step** of `git diff --quiet HEAD^ HEAD -- examples/igloo packages` keeps
docs and spec commits from rebuilding it.
