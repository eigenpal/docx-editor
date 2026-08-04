# Igloo Editor

A fully themed editor, built to answer one question: **how much of this is mine?**

```bash
bun run dev:igloo   # http://localhost:5178
```

Everything on screen composes under `<DocxEditor.Root>`. The arrangement, the icons, the
labels, the colours and the art are the demo's. The engine, the rows, the pickers and every
enabled state are the library's — and none of them had to be reimplemented to be re-skinned.

## What each file demonstrates

| File | Customization point |
| --- | --- |
| `IglooEditor.tsx` | The composition root: `Root` / `Viewport` / `Content` / `Loading`, the workspace row a floating navigation pane anchors to, and where host art goes relative to the page |
| `IglooToolbar.tsx` | `Toolbar preset={false}` — a hand-ordered bar, every packaged part re-iconed, plus two `Toolbar.Action`s of the demo's own |
| `IglooContextMenu.tsx` | `ContextMenu` — packaged rows re-iconed, one removed, a chrome slot pulled in, three host rows, and a submenu |
| `IglooMenu.tsx` | `Menu` — a whole menu the library has never heard of, and Help replaced |
| `frost.ts` | One host action shared by the toolbar and the menu, gated on `Editor.can` |
| `labels.ts` | A `t` catalogue: the same override path a real locale takes |
| `igloo.css` | The theme. Almost entirely `--doc-*` token overrides |
| `IceSea.tsx`, `Iceberg.tsx`, `Blizzard.tsx` | The demo's own art, which the library knows nothing about |

## Three things worth copying

**Re-skinning is token overrides, not component rewrites.** The library's chrome is built on
the `--doc-*` palette, so restating that palette under one scope re-themes the toolbar, menu
bar, panels, pickers, rulers and navigation pane at once. `igloo.css` is mostly that list.

**A host action still asks the engine.** `Freeze this passage` has no chrome slot, so its
label, glyph and effect are the demo's — but whether it may run comes from `Editor.can` on
the very command it will exec, so it cannot offer something about to be refused, and its
tooltip carries the engine's words rather than a guess. `frost.ts` is that pattern, shared by
both surfaces that expose the action.

**The document canvas is not themed, on purpose.** Painter output stays Word-faithful. A page
that looked like ice would be a lie about what the file contains, so the theme lives in the
chrome, in the sea behind, and in the berg the page rides on.

## Notes

- The berg is `position: fixed` rather than stretched behind the page. A document is any
  number of pages tall; one berg stretched over that box smears the crown into a spike.
- Neither the workspace row nor the viewport sets a `z-index`. Either would open a stacking
  context around the context menu, and a `position: fixed` panel cannot escape the context it
  is declared in — it would render under the chrome bar however high its own z-index went.
- The sea and the blizzard both honour `prefers-reduced-motion`.
- The document is served straight from `e2e/fixtures/` by a vite plugin, so this demo and the
  e2e suite read the same bytes. `?fixture=<name>.docx` picks a different one.
