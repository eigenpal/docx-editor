import { exampleText as t } from '../../shared/example-text';
import type { CollaborationFailure } from '@docx-editor.dev/core/collaboration';

export interface DemoFailureMessage {
  readonly title: string;
  readonly body: string;
  readonly command?: string;
  readonly documentation?: { readonly url: string; readonly label: string };
}

/** English copy for this demo's recovery screen, shared with its admission tests. */
export function failureMessage(
  failure: CollaborationFailure,
  connection: { readonly serverUrl: string; readonly serverCommand: string }
): DemoFailureMessage {
  if (
    failure.code === 'collaboration-format-mismatch' ||
    failure.code === 'protocol-version-mismatch' ||
    failure.code === 'schema-version-mismatch'
  ) {
    return {
      title: t('collaborationDemo.serverRecovery.versionTitle'),
      body: t('collaborationDemo.serverRecovery.versionBody'),
      documentation: {
        url: 'https://www.docx-editor.dev/docs/2.x/pro/collaboration-versions',
        label: t('collaborationDemo.serverRecovery.upgradeGuide'),
      },
    };
  }
  if (failure.code === 'saved-room-unavailable' || failure.code === 'invalid-saved-room') {
    return {
      title: t('collaborationDemo.serverRecovery.savedRoomTitle'),
      body: t('collaborationDemo.serverRecovery.savedRoomBody'),
    };
  }
  if (failure.code === 'initialization-timeout') {
    return {
      title: t('collaborationDemo.serverRecovery.timeoutTitle'),
      body: t('collaborationDemo.serverRecovery.timeoutBody', { serverUrl: connection.serverUrl }),
      command: connection.serverCommand,
    };
  }
  // The server refuses an invite to a room it does not know with the demo reason
  // `unknown-room`, which is not a library failure code, so it arrives only in the detail.
  if (failure.code === 'initialization-aborted' && failure.detail?.endsWith('unknown-room')) {
    return {
      title: t('collaborationDemo.serverRecovery.unknownRoomTitle'),
      body: t('collaborationDemo.serverRecovery.unknownRoomBody'),
    };
  }
  if (failure.code === 'initialization-aborted' || failure.code === 'authentication-failed') {
    return {
      title: t('collaborationDemo.connectFailed'),
      body: t('collaborationDemo.serverRecovery.tokenBody'),
    };
  }
  return {
    title: t('collaborationDemo.connectFailed'),
    body: t('collaborationDemo.serverRecovery.generalBody'),
  };
}
