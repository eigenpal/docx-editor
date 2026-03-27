/**
 * @eigenpal/docx-collab — Real-time collaborative editing for docx-js-editor.
 *
 * Client-side: useCollaboration hook + CollabPresence component
 * Server-side: createCollabServer (import from '@eigenpal/docx-collab/server')
 */

// Client-side exports
export {
  createCollabProvider,
  type CollabProviderOptions,
  type CollabProviderResult,
  type CollabUser,
  yUndoPluginKey,
} from './provider';

export {
  useCollaboration,
  type UseCollaborationOptions,
  type UseCollaborationResult,
  type CollabStatus,
} from './useCollaboration';

export { CollabPresence } from './CollabPresence';

// Server-side exports are in a separate entry point:
// import { createCollabServer } from '@eigenpal/docx-collab/server'
