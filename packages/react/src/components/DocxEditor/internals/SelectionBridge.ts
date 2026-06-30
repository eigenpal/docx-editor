/**
 * The state↔paint synchronisation seam, re-exported from core.
 *
 * React and Vue both need it and it contains no framework code, so it lives in
 * core. This file exists only so the adapter's own imports read as local ones —
 * see `@eigenpal/docx-editor-core/prosemirror` for the actual implementation and
 * the reason it exists.
 */

export { SelectionBridge } from '@eigenpal/docx-editor-core/prosemirror';
