---
'@docx-editor.dev/react': minor
---

`useDocxSource` opens a document in one call: fetch the bytes, load the fonts, compose them, and cancel both on unmount.

```tsx
const { document, fonts, error } = useDocxSource(url, { fonts: defaultFonts });
return <DocxEditor document={document} fonts={fonts} />;
```

It holds the document back until fonts settle, because layout measures with them — handing the editor bytes first paginates on the fixed fallback and then re-paginates, which reads as the text jumping.

`defaultFonts()` from `@docx-editor.dev/fonts` is the matching one-call loader: it loads the byte sources and registers the paint-side faces together, which previously had to be paired by hand.
