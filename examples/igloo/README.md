# Igloo Editor

Igloo Editor shows how you can theme and compose the editor.

## Run the example

From the repository root, install dependencies and build the workspace packages:

```bash
bun install
bun run build:packages
bun run dev:igloo
```

Open `http://localhost:5178`.

## Customization points

Everything on the screen composes under `<DocxEditor.Root>`. The demo owns the
arrangement, icons, labels, colors, and art. The library owns the engine,
controls, and enabled states.

| File                       | Customization point                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| `src/IglooEditor.tsx`      | Composes `Root`, `Viewport`, `Content`, `Loading`, the workspace, and host art.               |
| `src/IglooToolbar.tsx`     | Builds a custom toolbar with `preset={false}`, custom icons, editing modes, and host actions. |
| `src/IglooContextMenu.tsx` | Changes packaged rows and adds host rows, submenus, and custom nodes.                         |
| `src/IglooMenu.tsx`        | Changes registry menus, adds an Insert row, and defines a host menu.                          |
| `src/IglooReview.tsx`      | Changes the EigenPal Pro License review rail with part overrides and host content.            |
| `src/specimens.ts`         | Defines two custom nodes with recognition, chip colors, and rail cards.                       |
| `src/useSpecimens.tsx`     | Owns custom-node writes, caret capture, dialogs, popovers, and notices.                       |
| `src/SpecimenDialog.tsx`   | Collects custom-node attributes and inserts one node.                                         |
| `src/SpecimenPopover.tsx`  | Opens custom-node details at the activation rectangle.                                        |
| `src/useFrost.ts`          | Shares one host action and checks it with `Editor.can`.                                       |
| `src/labels.ts`            | Defines label overrides through the same path as a locale.                                    |
| `src/igloo.css`            | Changes the theme through `--doc-*` token overrides.                                          |
| `src/icons/`               | Contains the demo SVG components.                                                             |
| `src/art/`                 | Contains the background art and custom-node glyphs.                                           |

The top-level files demonstrate the API. The `icons/` and `art/` directories
contain theme decoration.

## Customize the review rail

`DocxEditorReview` from `@docx-editor.dev/pro/react` provides the review rail.
The library keeps anchoring, stacking, virtualization, review actions, and the
reply box.

The demo changes the rail through these extension points:

- The `furniture` prop adds the ice core log.
- Part `className` and `icon` props change packaged controls.
- `<Review.Summary>` replaces the card summary content.
- Unrecognized children add host content to each card.
- `--doc-*` tokens change the author color ramp.

`Toolbar.Comments` controls the `review.comments` slot. Its pressed state stays
synchronized when another action opens the rail.

The page wrapper changes `--doc-revision-*` tokens for tracked changes. These
marks belong to review chrome. The document canvas remains Word-faithful.

## Organize host actions

Keep familiar menu names such as File, Format, Insert, and Help. You can change
rows inside each menu without changing its navigation label.

Add existing editor commands where users expect them. The demo appends the page
break command to **Insert** and keeps the registry rows.

Put product-specific commands in a separate menu. Igloo Editor uses **Custom
Actions** for custom nodes and host actions.

Keep engine and host actions in separate context-menu submenus. The demo uses
**Carve** for engine inserts and **Custom elements** for custom nodes.

Ask the engine before you run a host action. `useFrost.ts` calls `Editor.can`
with the command that it will run. It also uses the engine refusal as the
disabled reason.

## Define custom nodes

`defineCustomNode` registers an iceberg and an igloo. Each node uses a run-level
`w:sdt`. Its `w:tag` stores the identity and attributes.

Word and readers without the definition show each node as plain text. They
preserve the content during a save and reopen cycle.

Use **Custom Actions** or the **Custom elements** context menu to insert a node.
The dialog collects attributes and calls `insertCustomNode`. The popover calls
`updateCustomNode` for later changes.

Word limits `w:tag` to 64 characters. The engine refuses an oversized tag, and
the demo shows the refusal in the notice strip.

## Reuse the theme patterns

Set `--doc-*` tokens under one host scope to theme the editor chrome.
`igloo.css` uses this pattern for the toolbar, menus, panels, pickers, rulers,
and navigation pane.

Use props and public tokens instead of `docx-*` implementation classes. The
demo does not use `!important`.

Keep the document canvas Word-faithful. Put host art behind the pages and keep
document formatting separate from chrome formatting.

For more information, see the
[editor customization guide](../../docs/CUSTOMIZING.md).

## Implementation notes

- The background art uses `position: fixed` so long documents do not stretch it.
- The workspace and viewport avoid a `z-index` that would trap fixed overlays.
- `--igloo-stage-top` aligns the stage padding, vertical ruler, and rail log.
- Custom menu headings use `role="presentation"` to preserve menu ownership.
- The sea and blizzard follow `prefers-reduced-motion`.
- `public/sample-igloo.docx` includes the custom nodes used by the first screen.

## Deploy the example

`vercel.json` defines the build for a Vercel project with **Root Directory** set
to `examples/igloo`.

Enable **Include source files outside of the Root Directory**. The Vite
configuration imports workspace source and a fixture outside this directory.

The deployment build runs `build:packages:demo`. Packages that resolve through
`node_modules` need their `dist/` files in a clean clone.

Use this **Ignored Build Step** to skip unrelated changes:

```bash
git diff --quiet HEAD^ HEAD -- examples/igloo packages
```
