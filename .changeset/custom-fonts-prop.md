---
'@eigenpal/docx-editor-react': minor
'@eigenpal/docx-editor-vue': minor
'@eigenpal/docx-editor-core': minor
---

Add `fonts` prop on `<DocxEditor>` for declarative custom font registration. Each entry injects an `@font-face` pointing at the URL you provide. Multiple entries can share `family` to register different weights. Fixes #620.

```tsx
<DocxEditor
  fonts={[
    { family: 'Custom Sans', src: '/fonts/CustomSans-Regular.woff2' },
    { family: 'Custom Sans', src: '/fonts/CustomSans-Bold.woff2', weight: 700 },
  ]}
/>
```

For Google Fonts, keep using `loadFont(name)` from `@eigenpal/docx-editor-core/utils` — it loads the family from the Google Fonts CSS API directly:

```ts
import { loadFont } from '@eigenpal/docx-editor-core/utils';
import { useEffect } from 'react';

useEffect(() => {
  void loadFont('Pacifico');
}, []);
```

Also exposes `loadFontFromUrl`, `loadFontDefinitions`, and the `FontDefinition` type from `@eigenpal/docx-editor-core/utils`.
