---
'@eigenpal/docx-js-editor': minor
'@eigenpal/docx-editor-agents': minor
---

Add `fontFamilies` prop to `DocxEditor` to customize the toolbar's font dropdown.

Pass either bare strings or full `FontOption` objects (or a mix). Strings render in the "Other" group; `FontOption[]` enables CSS fallback chains and category grouping. Omitting the prop preserves the existing 12-font default. Closes #278.

```tsx
<DocxEditor
  fontFamilies={[
    'Arial',
    { name: 'Roboto', fontFamily: 'Roboto, sans-serif', category: 'sans-serif' },
  ]}
/>
```
