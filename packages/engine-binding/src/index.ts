// Compatibility alias for the binding lane (task 10.3).
//
// The implementation moved to `packages/core/src/binding`. This package stays behind only
// so importers still naming `@docx-editor.dev/engine-binding` keep resolving while task 10.5
// migrates them to the subpath; task 10.6 deletes it. Nothing new belongs here.
export * from '@docx-editor.dev/core-contract/binding';
