import { createT, en, type TFunction } from '@docx-editor.dev/i18n';
import type { CollaborationFailure } from '@docx-editor.dev/core/collaboration';

const english = createT(en);

export interface DemoFailureMessage {
  readonly title: string;
  readonly body: string;
  readonly command?: string;
}

/** English copy for this demo's recovery screen, shared with its admission tests. */
export function failureMessage(
  failure: CollaborationFailure,
  connection: { readonly serverUrl: string; readonly serverCommand: string },
  t: TFunction = english
): DemoFailureMessage {
  const admissionCode =
    failure.code === 'initialization-aborted'
      ? /^authentication failed: (protocol-version-mismatch|schema-version-mismatch|collaboration-version-required)$/.exec(
          failure.detail ?? ''
        )?.[1]
      : undefined;
  if (
    failure.code === 'protocol-version-mismatch' ||
    failure.code === 'schema-version-mismatch' ||
    admissionCode
  ) {
    return {
      title: t('collaborationDemo.serverRecovery.versionTitle'),
      body: t('collaborationDemo.serverRecovery.versionBody'),
    };
  }
  if (
    failure.code === 'initialization-aborted' &&
    /^authentication failed: (saved-room-unavailable|invalid-saved-room)$/.test(
      failure.detail ?? ''
    )
  ) {
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
  if (failure.code === 'initialization-aborted') {
    return {
      title: 'The room server refused the connection.',
      body:
        failure.detail === 'authentication failed: invalid token' || !failure.detail
          ? t('collaborationDemo.serverRecovery.tokenBody')
          : failure.detail,
    };
  }
  return {
    title: 'Could not join the room.',
    body: failure.detail ?? `The room reported ${failure.code}. Reload to try again.`,
  };
}
