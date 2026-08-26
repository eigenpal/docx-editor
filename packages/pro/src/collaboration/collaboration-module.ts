/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * The collaboration module: a replica as an `EditorModule` for
 * `createDocxEditor({ modules })`.
 *
 * Registering it is the whole enablement story: the surface attaches the
 * session, remote selections paint, and undo routes through the session.
 * This file imports no Yjs, so the main Pro entry can re-export it without
 * pulling a CRDT into a review-only bundle.
 */

import type {
  CollaborationModuleContribution,
  CollaborationSessionFactory,
  EditorModule,
} from '@docx-editor.dev/core/editor';
import type { EditorCollaborationSession } from '@docx-editor.dev/core/collaboration';
import { rememberLicenseKey, type ProLicenseOptions } from '../license.ts';

/**
 * How {@link collaborationModule} is configured. The session is required;
 * the licence key is optional and never validated.
 *
 * @public
 */
export interface CollaborationModuleOptions extends ProLicenseOptions {
  readonly session: EditorCollaborationSession | CollaborationSessionFactory;
}

/** Build the collaboration module. Construction never validates the key and never touches the network. */
export function collaborationModule(options: CollaborationModuleOptions): EditorModule {
  rememberLicenseKey(options.licenseKey);
  const contribution: CollaborationModuleContribution = { session: options.session };
  return {
    id: 'collaboration',
    collaboration: contribution,
  };
}
