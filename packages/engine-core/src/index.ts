// Compatibility alias for the store lane (task 10.2).
//
// The implementation moved to `packages/core/src/store`. This package stays behind only so
// the importers that still name `@docx-editor.dev/engine-core` keep resolving while task
// 10.5 migrates them to the `@docx-editor.dev/core-contract/store` subpath; task 10.6 deletes
// it. Nothing new should be added here, and nothing should import this in new code.
export * from '@docx-editor.dev/core-contract/store';
