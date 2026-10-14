/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A batch that throws an engine error, not a refusal, still reaches diagnostics: as
// `edit.internal-invariant` with the error's class and the `automation` stage, never its message.
// The caller still receives the original error.
import { expect, test } from 'bun:test';
import type { AutomationHost } from '@docx-editor.dev/core/automation';
import type { EditorDiagnostic } from '@docx-editor.dev/core/contracts/editor';
import { createRuntime } from '../runtime.ts';
import { runtimeDiagnostics } from '../diagnostics.ts';
import { docx, p } from './support/docx.ts';
import { openHost } from './support/hosts.ts';

const SECRET = 'Confidential settlement terms';

/** The host, except that every batch past the root lookups throws an error quoting the text. */
function throwingHost(host: AutomationHost): AutomationHost {
  return new Proxy(host, {
    get(target, property, receiver) {
      if (property === 'execute')
        return (request: Parameters<AutomationHost['execute']>[0]) => {
          const roots = request.operations.every(
            (operation) => operation.op === 'getDocument' || operation.op === 'getBody'
          );
          if (roots) return target.execute(request);
          throw new TypeError(`cannot apply ${SECRET}`);
        };
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

test('a batch that throws reports its class and stage, and rethrows the original error', async () => {
  const events: EditorDiagnostic[] = [];
  const diagnostics = runtimeDiagnostics([(event) => events.push(event as EditorDiagnostic)])!;
  const host = throwingHost(openHost(docx(p(SECRET))));
  const runtime = createRuntime({
    host,
    save: true,
    onException: (error, operations) => diagnostics.crashed(error, host, operations),
  });
  try {
    const failure = await runtime
      .run(async (context) => {
        context.document.body.insertParagraph('More', 'End');
        await context.sync();
      })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TypeError);
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'edit.rejected',
        code: 'edit.internal-invariant',
        origin: 'automation',
        cause: 'exception',
        errorName: 'TypeError',
        stage: 'automation',
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain(SECRET);
  } finally {
    runtime.dispose();
  }
});
