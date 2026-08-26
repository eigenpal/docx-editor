// The demos mount the editor Root BEFORE the document bytes arrive, so the packaged
// loading overlay paints a skeleton sheet that also carries `.docx-page`
// (`DocxEditorLoading` renders `docx-page docx-editor__loading-page`). Waiting on the bare
// class clears the gate on that placeholder, which reports the 816px default sheet rather
// than the real page. Gate on this instead, so "the page is here" means the document is
// painted.
//
// `docx-editor__loading-page` is the Loading part's own class, so this exclusion lives in
// ONE place: a rename there has a single call site to follow, not one per spec.
export const PAINTED_PAGE = '.docx-page:not(.docx-editor__loading-page)';
