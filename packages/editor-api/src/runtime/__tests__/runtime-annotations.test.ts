/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Proofing annotations on a server runtime: insert, list, find, accept, reject, and delete,
// as data. Annotations are view state, so they never reach the saved file.

import { describe, expect, test } from 'bun:test';
import {
  DocxEditor,
  type AnnotationSet,
  type CritiquePopupOptions,
  type DocxEditorServerRuntime,
  type RequestContext,
} from '../../index.ts';
import { docx, p } from './support/docx.ts';

const t = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const open = (body: string) => DocxEditor.createServer(docx(body), { author: 'Checker' });

const popup = (...suggestions: string[]): CritiquePopupOptions => ({
  brandingTextResourceId: '',
  subtitleResourceId: '',
  titleResourceId: '',
  suggestions,
});

async function firstText(runtime: DocxEditorServerRuntime): Promise<string> {
  return runtime.run(async (context) => {
    const paragraph = context.document.body.paragraphs.getFirst();
    paragraph.load('text');
    await context.sync();
    return paragraph.text;
  });
}

async function insert(context: RequestContext, set: AnnotationSet): Promise<string[]> {
  const ids = context.document.body.paragraphs.getFirst().insertAnnotations(set);
  await context.sync();
  return ids.value;
}

async function failure(work: Promise<unknown>): Promise<unknown> {
  return work.then(
    () => {
      throw new Error('expected a refusal');
    },
    (error: unknown) => error
  );
}

describe('insertAnnotations and getAnnotations', () => {
  test('answers ids, lists annotations in text order, and loads their critiques', async () => {
    const runtime = await open(p('Teh cat sat on teh mat.'));
    try {
      await runtime.run(async (context) => {
        const ids = await insert(context, {
          critiques: [
            { colorScheme: 'Red', start: 15, length: 3, popupOptions: popup('the') },
            { colorScheme: 'Blue', start: 0, length: 3 },
          ],
        });
        expect(ids).toHaveLength(2);
        expect(new Set(ids).size).toBe(2);

        const annotations = context.document.body.paragraphs.getFirst().getAnnotations();
        annotations.load('id,state,critiqueAnnotation');
        await context.sync();
        expect(annotations.items.map((item) => item.id)).toEqual([ids[1], ids[0]]);
        expect(annotations.items.map((item) => item.state)).toEqual(['Created', 'Created']);
        expect(annotations.items[1]!.critiqueAnnotation.critique).toEqual({
          colorScheme: 'Red',
          start: 15,
          length: 3,
          popupOptions: popup('the'),
        });

        const range = annotations.items[1]!.critiqueAnnotation.range;
        range.load('text');
        await context.sync();
        expect(range.text).toBe('teh');
      });
    } finally {
      runtime.dispose();
    }
  });

  test('getAnnotationById finds an annotation from a later run', async () => {
    const runtime = await open(p('Teh cat.'));
    try {
      const [id] = await runtime.run((context) =>
        insert(context, { critiques: [{ colorScheme: 'Green', start: 0, length: 3 }] })
      );
      const loaded = await runtime.run(async (context) => {
        const annotation = context.document.getAnnotationById(id!);
        annotation.load('id,state');
        const first = context.document.body.paragraphs.getFirst().getAnnotations().getFirst();
        first.load('id');
        await context.sync();
        return { id: annotation.id, state: annotation.state, first: first.id };
      });
      expect(loaded).toEqual({ id: id!, state: 'Created', first: id! });
      const missing = await failure(
        runtime.run(async (context) => {
          context.document.getAnnotationById('no-such-id').load('id');
          await context.sync();
        })
      );
      expect(missing).toMatchObject({ code: 'ItemNotFound' });
    } finally {
      runtime.dispose();
    }
  });

  test('getFirstOrNullObject answers a null object on a paragraph with none', async () => {
    const runtime = await open(p('Clean text.'));
    try {
      const isNull = await runtime.run(async (context) => {
        const first = context.document.body.paragraphs
          .getFirst()
          .getAnnotations()
          .getFirstOrNullObject();
        await context.sync();
        return first.isNullObject;
      });
      expect(isNull).toBe(true);
    } finally {
      runtime.dispose();
    }
  });
});

describe('refusals at insertAnnotations', () => {
  test('refuses a manifest resource id, a bad color, an empty length, and a range past the end', async () => {
    const runtime = await open(p('Short.'));
    try {
      const cases: [unknown, string][] = [
        [
          {
            critiques: [
              {
                colorScheme: 'Red',
                start: 0,
                length: 1,
                popupOptions: { ...popup('x'), titleResourceId: 'Title.Label' },
              },
            ],
          },
          'NotSupported',
        ],
        [{ critiques: [{ colorScheme: 'Orange', start: 0, length: 1 }] }, 'InvalidArgument'],
        [{ critiques: [{ colorScheme: 'Red', start: 0, length: 0 }] }, 'InvalidArgument'],
        [{ critiques: [{ colorScheme: 'Red', start: 4, length: 9 }] }, 'InvalidArgument'],
        [{ critiques: 'none' }, 'InvalidArgument'],
      ];
      for (const [set, code] of cases) {
        const error = await failure(
          runtime.run((context) => insert(context, set as AnnotationSet))
        );
        expect(error).toMatchObject({ code });
      }
      const resource = await failure(
        runtime.run((context) =>
          insert(context, {
            critiques: [
              {
                colorScheme: 'Red',
                start: 0,
                length: 1,
                popupOptions: { ...popup('x'), brandingTextResourceId: 'Brand' },
              },
            ],
          })
        )
      );
      expect(resource).toMatchObject({
        code: 'NotSupported',
        debugInfo: { innerError: { code: 'edit.operation-unsupported' } },
      });
      const listed = await runtime.run(async (context) => {
        const annotations = context.document.body.paragraphs.getFirst().getAnnotations();
        annotations.load('items');
        await context.sync();
        return annotations.items.length;
      });
      expect(listed).toBe(0);
    } finally {
      runtime.dispose();
    }
  });

  test('refuses a critique that starts or ends inside a surrogate pair', async () => {
    const runtime = await open(p('a😀b'));
    try {
      for (const [start, length] of [
        [2, 1],
        [1, 1],
      ] as const) {
        const error = await failure(
          runtime.run((context) =>
            insert(context, { critiques: [{ colorScheme: 'Red', start, length }] })
          )
        );
        expect(error).toMatchObject({ code: 'InvalidArgument' });
      }
      const ids = await runtime.run((context) =>
        insert(context, { critiques: [{ colorScheme: 'Red', start: 1, length: 2 }] })
      );
      expect(ids).toHaveLength(1);
    } finally {
      runtime.dispose();
    }
  });
});

describe('accept, reject, and delete', () => {
  test('accept applies the first suggestion as a minimal edit and decides the annotation', async () => {
    const runtime = await open(p('The recieve date.'));
    try {
      await runtime.run(async (context) => {
        const [id] = await insert(context, {
          critiques: [
            { colorScheme: 'Red', start: 4, length: 7, popupOptions: popup('receive', 'relieve') },
          ],
        });
        const annotation = context.document.getAnnotationById(id!);
        annotation.critiqueAnnotation.accept();
        await context.sync();
        annotation.load('state');
        const remaining = context.document.body.paragraphs.getFirst().getAnnotations();
        remaining.load('items');
        await context.sync();
        expect(annotation.state).toBe('Accepted');
        expect(remaining.items).toHaveLength(0);
      });
      expect(await firstText(runtime)).toBe('The receive date.');
    } finally {
      runtime.dispose();
    }
  });

  test('accept is a tracked change when tracking is on, and later annotations move with the text', async () => {
    const runtime = await open(p('Teh cat and teh dog.'));
    try {
      await runtime.run(async (context) => {
        context.document.changeTrackingMode = 'TrackMineOnly';
        const [first, second] = await insert(context, {
          critiques: [
            { colorScheme: 'Red', start: 0, length: 3, popupOptions: popup('The') },
            { colorScheme: 'Red', start: 12, length: 3, popupOptions: popup('the') },
          ],
        });
        context.document.getAnnotationById(first!).critiqueAnnotation.accept();
        await context.sync();

        const moved = context.document.getAnnotationById(second!).critiqueAnnotation;
        moved.load('critique');
        await context.sync();
        const paragraph = context.document.body.paragraphs.getFirst();
        paragraph.load('text');
        await context.sync();
        const { start, length } = moved.critique;
        expect(paragraph.text.slice(start, start + length)).toBe('teh');

        const revisions = context.document.body.paragraphs.getFirst().getRange().revisions;
        revisions.load('items');
        await context.sync();
        expect(revisions.items.length).toBeGreaterThan(0);
      });
      const reviewed = await runtime.run(async (context) => {
        const result = context.document.body.paragraphs.getFirst().getReviewedText('Current');
        await context.sync();
        return result.value;
      });
      expect(reviewed).toBe('The cat and teh dog.');
    } finally {
      runtime.dispose();
    }
  });

  test('two tracked accepts in one paragraph need one sync each', async () => {
    const runtime = await open(p('Teh cat and teh dog.'));
    try {
      const critiques = [
        { colorScheme: 'Red' as const, start: 0, length: 3, popupOptions: popup('The') },
        { colorScheme: 'Red' as const, start: 12, length: 3, popupOptions: popup('the') },
      ];
      const error = await failure(
        runtime.run(async (context) => {
          context.document.changeTrackingMode = 'TrackMineOnly';
          const ids = await insert(context, { critiques });
          for (const id of ids) context.document.getAnnotationById(id).critiqueAnnotation.accept();
          await context.sync();
        })
      );
      expect(error).toMatchObject({ code: 'ConflictingChanges' });
      expect(await firstText(runtime)).toBe('Teh cat and teh dog.');

      await runtime.run(async (context) => {
        context.document.changeTrackingMode = 'TrackMineOnly';
        const ids = await insert(context, { critiques });
        for (const id of ids) {
          context.document.getAnnotationById(id).critiqueAnnotation.accept();
          await context.sync();
        }
      });
      const reviewed = await runtime.run(async (context) => {
        const result = context.document.body.paragraphs.getFirst().getReviewedText('Current');
        await context.sync();
        return result.value;
      });
      expect(reviewed).toBe('The cat and the dog.');
    } finally {
      runtime.dispose();
    }
  });

  test('accept without a suggestion refuses, and changes nothing', async () => {
    const runtime = await open(p('Teh cat.'));
    try {
      const error = await failure(
        runtime.run(async (context) => {
          const [id] = await insert(context, {
            critiques: [{ colorScheme: 'Red', start: 0, length: 3 }],
          });
          context.document.getAnnotationById(id!).critiqueAnnotation.accept();
          await context.sync();
        })
      );
      expect(error).toMatchObject({
        code: 'NotSupported',
        debugInfo: { innerError: { code: 'edit.operation-unsupported' } },
      });
      expect(await firstText(runtime)).toBe('Teh cat.');
    } finally {
      runtime.dispose();
    }
  });

  test('an edit inside the critiqued text removes the annotation, and accept refuses', async () => {
    const runtime = await open(p('Teh cat.'));
    try {
      const [id] = await runtime.run((context) =>
        insert(context, {
          critiques: [{ colorScheme: 'Red', start: 0, length: 3, popupOptions: popup('The') }],
        })
      );
      await runtime.run(async (context) => {
        const found = context.document.body.search('Teh');
        found.load('items');
        await context.sync();
        found.items[0]!.insertText('Ten', 'Replace');
        await context.sync();
      });
      const error = await failure(
        runtime.run(async (context) => {
          const annotations = context.document.body.paragraphs.getFirst().getAnnotations();
          annotations.load('items');
          await context.sync();
          expect(annotations.items).toHaveLength(0);
          context.document.getAnnotationById(id!).critiqueAnnotation.accept();
          await context.sync();
        })
      );
      expect(error).toMatchObject({ code: 'ItemNotFound' });
      expect(await firstText(runtime)).toBe('Ten cat.');
    } finally {
      runtime.dispose();
    }
  });

  test('a held annotation refuses once an edit removed it', async () => {
    const runtime = await open(p('Teh cat.'));
    try {
      await runtime.run(async (context) => {
        const [id] = await insert(context, {
          critiques: [{ colorScheme: 'Red', start: 0, length: 3, popupOptions: popup('The') }],
        });
        const annotation = context.document.getAnnotationById(id!);
        annotation.load('id');
        await context.sync();
        context.document.body.paragraphs.getFirst().insertText('Ten cat.', 'Replace');
        await context.sync();
        annotation.critiqueAnnotation.accept();
        const error = await context.sync().catch((caught: unknown) => caught);
        expect(error).toMatchObject({
          code: 'InvalidObjectPath',
          debugInfo: { innerError: { code: 'edit.stale-target' } },
        });
      });
      expect(await firstText(runtime)).toBe('Ten cat.');
    } finally {
      runtime.dispose();
    }
  });

  test('an edit before the critique moves it; reject and delete remove it without editing', async () => {
    const runtime = await open(p('A teh b teh.'));
    try {
      await runtime.run(async (context) => {
        const [first, second] = await insert(context, {
          critiques: [
            { colorScheme: 'Red', start: 2, length: 3 },
            { colorScheme: 'Red', start: 8, length: 3 },
          ],
        });
        context.document.body.paragraphs.getFirst().insertText('Now: ', 'Start');
        await context.sync();
        const moved = context.document.getAnnotationById(second!).critiqueAnnotation;
        moved.load('critique');
        await context.sync();
        expect(moved.critique.start).toBe(13);

        context.document.getAnnotationById(first!).critiqueAnnotation.reject();
        const held = context.document.getAnnotationById(second!);
        held.delete();
        await context.sync();

        const rejected = context.document.getAnnotationById(first!);
        rejected.load('state');
        await context.sync();
        expect(rejected.state).toBe('Rejected');
        const gone = await failure(
          (async () => {
            context.document.getAnnotationById(second!).load('id');
            await context.sync();
          })()
        );
        expect(gone).toMatchObject({ code: 'ItemNotFound' });
      });
      expect(await firstText(runtime)).toBe('Now: A teh b teh.');
    } finally {
      runtime.dispose();
    }
  });

  test('accept refuses a critique over a field result, which is one object', async () => {
    const runtime = await open(
      `<w:p>${t('See ')}<w:fldSimple w:instr=" PAGE "><w:r><w:t>7</w:t></w:r></w:fldSimple>${t(' here.')}</w:p>`
    );
    try {
      const error = await failure(
        runtime.run(async (context) => {
          const [id] = await insert(context, {
            critiques: [{ colorScheme: 'Blue', start: 4, length: 1, popupOptions: popup('8') }],
          });
          context.document.getAnnotationById(id!).critiqueAnnotation.accept();
          await context.sync();
        })
      );
      expect(error).toMatchObject({
        code: 'NotSupported',
        debugInfo: { innerError: { code: 'edit.indivisible-content' } },
      });
    } finally {
      runtime.dispose();
    }
  });
});

describe('annotations are view state', () => {
  test('a save does not write them, and a new runtime on the saved bytes has none', async () => {
    const runtime = await open(p('Teh cat.'));
    let saved: Uint8Array;
    try {
      await runtime.run((context) =>
        insert(context, { critiques: [{ colorScheme: 'Red', start: 0, length: 3 }] })
      );
      saved = await runtime.save();
    } finally {
      runtime.dispose();
    }
    const reopened = await DocxEditor.createServer(saved, { author: 'Checker' });
    try {
      const count = await reopened.run(async (context) => {
        const annotations = context.document.body.paragraphs.getFirst().getAnnotations();
        annotations.load('items');
        await context.sync();
        return annotations.items.length;
      });
      expect(count).toBe(0);
    } finally {
      reopened.dispose();
    }
  });
});
