# @gw/docx-review

Comments and tracked-changes review for the docx-editor engine, written only against its Apache-2.0 packages (`@docx-editor.dev/core`, `@docx-editor.dev/react`). It does not use or contain any code from `@docx-editor.dev/pro` or other EigenPal Pro License packages.

## What it gives you

- `reviewModule()` — pass in the editor's `modules`. Turns on Suggesting mode, the review display modes (All Markup, Simple Markup, Original), Previous/Next change, and Accept/Reject all in the Review menu.
- `<ReviewPanel />` — a list of every tracked change and comment thread:
  - change cards with Accept and Reject;
  - comment threads with Reply, Edit, Resolve/Reopen and Delete;
  - the new-comment draft opened by the toolbar or context-menu Add comment control;
  - clicking a card selects that place in the document.

Everything saves as standard Word markup: `w:ins`/`w:del`, `comments.xml`, threaded replies and resolved state in `commentsExtended.xml`.

## Use

```tsx
import { DocxEditor } from '@docx-editor.dev/react';
import { ReviewPanel, reviewModule } from '@gw/docx-review';
import '@docx-editor.dev/core/styles/editor.css';
import '@gw/docx-review/styles.css';

const modules = [reviewModule()];

<DocxEditor.Root document={bytes} modules={modules} author="Advisor">
  <DocxEditor.Toolbar>
    <DocxEditor.Toolbar.Group id="review">
      <DocxEditor.Toolbar.AddComment />
    </DocxEditor.Toolbar.Group>
  </DocxEditor.Toolbar>
  <div style={{ display: 'flex', flex: 1 }}>
    <DocxEditor.Viewport style={{ flex: 1 }}>
      <DocxEditor.Content />
    </DocxEditor.Viewport>
    <ReviewPanel />
  </div>
</DocxEditor.Root>;
```

Theme the panel by overriding the `--gw-review-*` custom properties on `.gw-review`. Labels are replaceable through the `labels` prop.

## Try it

```bash
bun install
bun run build:packages   # or build core, fonts, i18n, react
bun run --filter '@gw/docx-review' build
cd examples/free-review && npx vite
```

## Licence

Apache-2.0. See `LICENSE` and `NOTICE`.
