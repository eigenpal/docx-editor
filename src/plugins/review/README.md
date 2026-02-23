# Review Plugin

Review existing tracked changes in DOCX documents using per-page rails rendered next to the page.

## Features (Current V1)

- Extract revisions (`insertion`, `deletion`, `moveFrom`, `moveTo`)
- Render page-local, scrollable rails on the right side of visible pages
- Jump from rail item to exact document location
- Accept/Reject each supported revision directly from the rail
- Include header/footer tracked changes so review coverage is complete
- Mark unsupported revision structures safely
- Virtualize rendering by visible pages (+ small buffer) for large docs

## Usage

```tsx
import { DocxEditor, PluginHost, createReviewPlugin } from '@eigenpal/docx-js-editor';

const reviewPlugin = createReviewPlugin({
  railWidth: 300, // optional, defaults to 300
});

function Editor({ file }: { file: ArrayBuffer }) {
  return (
    <PluginHost plugins={[reviewPlugin]}>
      <DocxEditor documentBuffer={file} />
    </PluginHost>
  );
}
```

## Notes

- This plugin reviews already-tracked changes found in input DOCX files.
- It does not create new tracked changes while typing.
- Header/footer revisions are actionable in V1 (Accept/Reject), not just view-only.
