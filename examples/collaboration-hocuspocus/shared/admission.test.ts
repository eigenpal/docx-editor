import { describe, expect, test } from 'bun:test';
import {
  COLLABORATION_FORMAT_VERSION,
  DOCUMENT_COLLABORATION_VERSIONS,
} from '@docx-editor.dev/pro/collaboration';
import { authenticateDemoToken, encodeDemoToken } from './admission.ts';
import { failureMessage } from './failure-message.ts';

const TOKEN = 'demo-secret';
const versions = DOCUMENT_COLLABORATION_VERSIONS;
const context = { serverUrl: 'ws://localhost:1234', serverCommand: 'start-demo-server' };

function refusal(encoded: string, secret = TOKEN): Error & { reason?: string } {
  try {
    authenticateDemoToken(encoded, secret);
  } catch (error) {
    return error as Error & { reason?: string };
  }
  throw new Error('expected admission refusal');
}

describe('demo admission before sync', () => {
  test('accepts the shared client envelope with every current version', () => {
    const encoded = encodeDemoToken(TOKEN);
    expect(JSON.parse(encoded)).toEqual({
      token: TOKEN,
      collaborationVersion: COLLABORATION_FORMAT_VERSION,
    });
    expect(() => authenticateDemoToken(encoded, TOKEN)).not.toThrow();
  });

  test('keeps compatible clients using the previous envelope working', () => {
    expect(() =>
      authenticateDemoToken(JSON.stringify({ token: TOKEN, versions }), TOKEN)
    ).not.toThrow();
  });

  test('rejects missing or incompatible format claims without falling back to legacy claims', () => {
    for (const collaborationVersion of [null, 3, {}, '', `${COLLABORATION_FORMAT_VERSION}-other`]) {
      expect(refusal(JSON.stringify({ token: TOKEN, collaborationVersion, versions })).reason).toBe(
        'collaboration-format-mismatch'
      );
    }
  });

  test.each([TOKEN, '1234', '"secret"'])(
    'rejects old raw token %s with upgrade guidance',
    (token) => {
      const error = refusal(token, token);
      expect(error.reason).toBe('collaboration-format-mismatch');
      expect(error.message).not.toContain(token);
    }
  );

  test('rejects an envelope without version claims', () => {
    expect(refusal(JSON.stringify({ token: TOKEN })).reason).toBe('collaboration-format-mismatch');
  });

  test.each(Object.keys(versions) as (keyof typeof versions)[])(
    'rejects missing, old, future, and malformed %s',
    (field) => {
      const expected =
        field === 'protocolVersion' ? 'protocol-version-mismatch' : 'schema-version-mismatch';
      for (const value of [
        undefined,
        versions[field] - 1,
        versions[field] + 1,
        String(versions[field]),
      ]) {
        expect(
          refusal(JSON.stringify({ token: TOKEN, versions: { ...versions, [field]: value } }))
            .reason
        ).toBe(expected);
      }
    }
  );

  test.each([[null], [[]], ['3']])('refuses malformed version descriptor %j', (value) => {
    expect(refusal(JSON.stringify({ token: TOKEN, versions: value })).reason).toBe(
      'protocol-version-mismatch'
    );
  });

  test('checks the secret even when all version claims match', () => {
    expect(refusal(encodeDemoToken('wrong-secret')).reason).toBe('invalid token');
    expect(refusal(JSON.stringify({ token: 'wrong-secret' })).reason).toBe('invalid token');
  });

  test.each(['not-json', 'null', '[]', '{}'])(
    'refuses malformed authentication envelope %s',
    (encoded) => {
      expect(refusal(encoded).reason).toBe('invalid token');
    }
  );
});

describe('demo version recovery', () => {
  for (const code of [
    'collaboration-format-mismatch',
    'protocol-version-mismatch',
    'schema-version-mismatch',
  ] as const) {
    test(`explains both persisted and admission ${code} failures`, () => {
      const direct = failureMessage({ code }, context);
      const admission = failureMessage(
        { code, detail: 'Diagnostic text does not select the recovery action.' },
        context
      );
      expect(admission).toEqual(direct);
      expect(direct.body).toContain('reload every open tab');
      expect(direct.body).toContain('matching older build');
      expect(direct.body).toContain('Keep the saved room');
      expect(direct.body).toContain('Save a copy of any local changes first');
      expect(direct.documentation).toEqual({
        url: 'https://www.docx-editor.dev/docs/latest/pro/collaboration-versions',
        label: 'Read the collaboration upgrade guide',
      });
    });
  }
  test('old clients get upgrade recovery instead of a token error', () => {
    expect(
      failureMessage(
        {
          code: 'collaboration-format-mismatch',
        },
        context
      ).body
    ).toContain('compatible builds');
  });
  test('wrong tokens get connection configuration guidance', () => {
    expect(
      failureMessage(
        { code: 'initialization-aborted', detail: 'authentication failed: invalid token' },
        context
      ).body
    ).toContain('COLLAB_TOKEN');
  });
  test.each(['saved-room-unavailable', 'invalid-saved-room'])(
    'explains saved-room failure %s without token advice',
    (reason) => {
      const message = failureMessage(
        { code: reason as 'saved-room-unavailable' | 'invalid-saved-room' },
        context
      );
      expect(message.body).toContain('server storage access');
      expect(message.body).not.toContain('COLLAB_TOKEN');
    }
  );
  test('timeout guidance does not assume the server is absent', () => {
    const message = failureMessage({ code: 'initialization-timeout' }, context);
    expect(message.body).toContain('network connection');
    expect(message.body).not.toContain('Nothing is listening');
    expect(message.command).toBe(context.serverCommand);
  });
  test('other failures preserve local work without exposing diagnostics or blaming storage', () => {
    const message = failureMessage(
      { code: 'concurrent-seed', detail: 'private diagnostics' },
      context
    );
    expect(message.body).toContain('Save a copy of any local changes');
    expect(message.body).not.toContain('server storage');
    expect(message.body).not.toContain('private diagnostics');
  });
});
