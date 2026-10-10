/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import type { AutomationHost, AutomationBatchRequest } from '@docx-editor.dev/core/automation';
import { DocxEditor, type RequestContext } from '../../index.ts';
import { createRuntime } from '../runtime.ts';
import { openHost } from './support/hosts.ts';
import { docx, p } from './support/docx.ts';

function delayedHost(bytes?: Uint8Array) {
  const inner = openHost(bytes);
  let reached!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  const requests: AutomationBatchRequest[] = [];
  const host: AutomationHost = {
    ...inner,
    async prepare() {
      if (held) return;
      held = true;
      reached();
      await gate;
    },
    execute(request) {
      requests.push(request);
      return inner.execute(request);
    },
  };
  return { host, entered, release: () => release(), requests };
}

test('a refused captured write does not discard later setters on the same proxy', async () => {
  const delayed = delayedHost();
  const runtime = createRuntime({ host: delayed.host, save: true });
  try {
    await runtime.run(async (context) => {
      const font = context.document.body.paragraphs.getFirst().font;
      font.size = -1;
      const first = context.sync();
      await delayed.entered;
      font.italic = true;
      delayed.release();
      await expect(first).rejects.toMatchObject({ code: 'InvalidArgument' });
      font.bold = true;
      await context.sync();
      font.load('bold,italic');
      await context.sync();
      expect(font.bold).toBe(true);
      expect(font.italic).toBe(true);
    });
  } finally {
    runtime.dispose();
  }
});

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
async function structuralInput(): Promise<Uint8Array> {
  const runtime = await DocxEditor.createServer(
    docx(
      '<w:sdt><w:sdtPr><w:id w:val="8"/></w:sdtPr><w:sdtContent>' +
        p('anchor') +
        '</w:sdtContent></w:sdt>'
    )
  );
  try {
    await runtime.run(async (context) => {
      const paragraph = context.document.body.paragraphs.getFirst();
      await context.sync();
      paragraph.startNewList();
      await context.sync();
      paragraph.getRange('End').insertField('After', 'Page');
      await context.sync();
      paragraph.getRange('End').insertInlinePictureFromBase64(png, 'After');
      await context.sync();
    });
    return await runtime.save();
  } finally {
    runtime.dispose();
  }
}

interface Probe {
  kind: string;
  operation: string;
  firstExpected: Record<string, unknown>;
  prepare(context: RequestContext): {
    first(): void;
    next(): void;
    extend(): void;
    verify?(): Promise<void>;
  };
}
const probes: Probe[] = [
  {
    kind: 'list',
    operation: 'setListLevelFormat',
    firstExpected: { format: { startingNumber: 3 } },
    prepare(context) {
      const list = context.document.body.lists.getFirst();
      return {
        first: () => list.setLevelStartingNumber(0, 3),
        next: () => list.setLevelStartingNumber(0, 8),
        extend: () => list.setLevelIndents(0, 36, -18),
      };
    },
  },
  {
    kind: 'page setup',
    operation: 'setPageSetup',
    firstExpected: { setup: { leftMargin: 40 } },
    prepare(context) {
      const setup = context.document.sections.getFirst().pageSetup;
      return {
        first: () => {
          setup.leftMargin = 40;
        },
        next: () => {
          setup.leftMargin = 50;
        },
        extend: () => {
          setup.rightMargin = 60;
        },
        async verify() {
          setup.load('leftMargin,rightMargin');
          await context.sync();
          expect([setup.leftMargin, setup.rightMargin]).toEqual([50, 60]);
        },
      };
    },
  },
  {
    kind: 'field',
    operation: 'setFieldCode',
    firstExpected: { code: 'NUMPAGES' },
    prepare(context) {
      const field = context.document.body.fields.getFirst();
      return {
        first: () => {
          field.code = 'NUMPAGES';
        },
        next: () => {
          field.code = 'PAGE';
        },
        extend: () => {
          field.code = 'PAGE';
        },
        async verify() {
          field.load('code');
          await context.sync();
          expect(field.code).toBe('PAGE');
        },
      };
    },
  },
  {
    kind: 'picture',
    operation: 'setInlinePicture',
    firstExpected: { properties: { width: 30 } },
    prepare(context) {
      const picture = context.document.body.inlinePictures.getFirst();
      return {
        first: () => {
          picture.width = 30;
        },
        next: () => {
          picture.width = 60;
        },
        extend: () => {
          picture.altTextDescription = 'later description';
        },
        async verify() {
          picture.load('width,altTextDescription');
          await context.sync();
          expect([picture.width, picture.altTextDescription]).toEqual([60, 'later description']);
        },
      };
    },
  },
  {
    kind: 'content control',
    operation: 'setContentControlProperties',
    firstExpected: { cannotDelete: true },
    prepare(context) {
      const control = context.document.contentControls.getFirst();
      return {
        first: () => {
          control.cannotDelete = true;
        },
        next: () => {
          control.cannotDelete = false;
        },
        extend: () => {
          control.cannotEdit = true;
        },
        async verify() {
          control.load('cannotDelete,cannotEdit');
          await context.sync();
          expect([control.cannotDelete, control.cannotEdit]).toEqual([false, true]);
        },
      };
    },
  },
];
for (const probe of probes) {
  test(`${probe.kind} setters capture separate bags before prerequisite reads`, async () => {
    const delayed = delayedHost(await structuralInput());
    const runtime = createRuntime({ host: delayed.host, save: true });
    try {
      await runtime.run(async (context) => {
        const actions = probe.prepare(context);
        actions.first();
        const first = context.sync();
        await delayed.entered;
        actions.next();
        delayed.release();
        await first;
        const initial = delayed.requests
          .flatMap((r) => r.operations)
          .filter((op) => op.op === probe.operation);
        expect(initial).toHaveLength(1);
        expect(initial[0]).toMatchObject(probe.firstExpected);
        const snapshot = JSON.stringify(initial);
        actions.extend();
        await context.sync();
        const writes = delayed.requests
          .flatMap((r) => r.operations)
          .filter((op) => op.op === probe.operation);
        expect(writes).toHaveLength(2);
        expect(JSON.stringify(writes.slice(0, 1))).toBe(snapshot);
        expect(writes[1]).not.toEqual(writes[0]);
        await actions.verify?.();
      });
      const saved = await runtime.save();
      if (probe.kind === 'list') {
        const numbering = strFromU8(unzipSync(saved)['word/numbering.xml']!);
        expect(numbering).toContain('<w:start w:val="8"');
        expect(numbering).toContain('w:left="720"');
      }
      const reopened = await DocxEditor.createServer(saved);
      try {
        await reopened.run(async (context) => {
          const actions = probe.prepare(context);
          await context.sync();
          await actions.verify?.();
        });
      } finally {
        reopened.dispose();
      }
    } finally {
      runtime.dispose();
    }
  });
}
