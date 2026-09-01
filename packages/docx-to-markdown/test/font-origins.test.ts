import { expect, test } from 'bun:test';
import { defineFontResolver, type FontResolutionRequest } from '@docx-editor.dev/core/editor';
import { createFixedMeasurer } from '@docx-editor.dev/core/layout';
import { openHeadlessDocument } from '@docx-editor.dev/core/store';
import { ExportResourceError, exportMarkdown, openDocumentForExport } from '../src/index.ts';
import { docx } from './fixture.ts';

test('caller fonts precede packaged defaults and opt-in missing-family origins', async () => {
  const calls: { caller?: FontResolutionRequest; fallback?: FontResolutionRequest } = {};
  const caller = defineFontResolver((request: FontResolutionRequest) => {
    calls.caller = request;
    return undefined;
  });
  const fallback = defineFontResolver((request: FontResolutionRequest) => {
    calls.fallback = request;
    return undefined;
  });
  const bytes = docx(
    '<w:p><w:r><w:rPr><w:rFonts w:ascii="Roboto" w:hAnsi="Roboto"/></w:rPr><w:t>Fonts</w:t></w:r></w:p>'
  );

  const opened = await openDocumentForExport(bytes, { fonts: caller, fallbackFonts: fallback });
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    expect(calls.caller?.families).toEqual(['Roboto']);
    expect(calls.caller?.resolvedFaces).toBeUndefined();
    expect(calls.fallback?.families).toEqual(['Roboto']);
    expect(calls.fallback?.resolvedFaces?.some((face) => face.family === 'Calibri')).toBe(true);
    expect(calls.fallback?.resolvedFaces?.some((face) => face.family === 'Carlito')).toBe(true);
    expect((await opened.session.layout()).pages).toHaveLength(1);
  } finally {
    opened.session.dispose();
  }
});

test('custom origins reject live views before resolution, while a host measurer takes precedence', async () => {
  const parsed = openHeadlessDocument(docx('<w:p><w:r><w:t>Live</w:t></w:r></w:p>'));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  let calls = 0;
  const fonts = defineFontResolver(() => {
    calls += 1;
    return undefined;
  });

  try {
    await openDocumentForExport(parsed.view, { fonts });
    throw new Error('expected immutable-byte restriction');
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError);
    expect(String(error)).toContain('immutable DOCX bytes');
  }
  expect(calls).toBe(0);

  const opened = await openDocumentForExport(parsed.view, {
    fonts,
    measurer: createFixedMeasurer(),
    producer: 'test:revision-stable-measurer',
  });
  expect(opened.ok).toBe(true);
  expect(calls).toBe(0);
  if (opened.ok) opened.session.dispose();

  await expect(
    openDocumentForExport(parsed.view, {
      measurer: createFixedMeasurer(),
      fontPolicy: 'strict',
    })
  ).rejects.toThrow('cannot verify a caller-supplied measurer');
  await expect(
    openDocumentForExport(parsed.view, {
      measurer: createFixedMeasurer(),
      onFontResolution: () => {},
    })
  ).rejects.toThrow('cannot verify a caller-supplied measurer');
});

test('default packaged-font startup honors a pre-aborted export before loading resources', async () => {
  const controller = new AbortController();
  controller.abort('cancel-before-open');
  const opened = await openDocumentForExport(docx('<w:p><w:r><w:t>Stopped</w:t></w:r></w:p>'), {
    signal: controller.signal,
  });
  expect(opened).toEqual({ ok: false, reason: 'aborted' });
  const oneShotError = await exportMarkdown(docx('<w:p><w:r><w:t>Stopped</w:t></w:r></w:p>'), {
    signal: controller.signal,
  }).catch((error: unknown) => error);
  expect(oneShotError).toBeInstanceOf(ExportResourceError);
  expect(oneShotError).toMatchObject({ code: 'aborted', cause: 'cancel-before-open' });
});

test('one-shot cancellation during font loading stays an aborted resource error', async () => {
  const controller = new AbortController();
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const pending = exportMarkdown(docx('<w:p><w:r><w:t>Stopped</w:t></w:r></w:p>'), {
    signal: controller.signal,
    fonts: defineFontResolver(
      (request: FontResolutionRequest) =>
        new Promise<undefined>((resolve) => {
          markStarted?.();
          request.signal?.addEventListener('abort', () => resolve(undefined), { once: true });
        })
    ),
  });
  await started;
  controller.abort('cancel-during-fonts');
  const error = await pending.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ExportResourceError);
  expect(error).toMatchObject({ code: 'aborted', cause: 'cancel-during-fonts' });
});

test('document-aware byte sessions reject incremental reuse instead of ignoring it', async () => {
  await expect(
    openDocumentForExport(docx('<w:p><w:r><w:t>Immutable</w:t></w:r></w:p>'), {
      reuseAcrossRevisions: true,
    })
  ).rejects.toThrow('document-aware byte sessions are immutable');
});

test('public best-effort font failure reports approximation while strict mode refuses it', async () => {
  const bytes = docx('<w:p><w:r><w:t>Bounded fallback</w:t></w:r></w:p>');
  const oneByteFontBudget = {
    epoch: 0,
    maxFontBytes: 1,
    sources: [],
    defaultFont: { family: 'Calibri', sizeHalfPoints: 22 },
  } as const;
  let failures = 0;
  let coverage: readonly string[] = [];
  const opened = await openDocumentForExport(bytes, {
    // Establish a valid caller ceiling that intentionally refuses every bundled face.
    fonts: oneByteFontBudget,
    onFontResolution: (report) => {
      failures = report.originFailures.length;
      coverage = report.families.map((family) => family.coverage);
    },
  });
  expect(opened.ok).toBe(true);
  // Font faults degrade per FACE: each refused bundled face reports its own failure while
  // the origin's substitution map still composes, instead of one opaque whole-origin skip.
  expect(failures).toBe(4);
  expect(coverage.length).toBeGreaterThan(0);
  expect(coverage.every((entry) => entry === 'none')).toBe(true);
  if (!opened.ok) return;
  expect((await opened.session.layout()).pages).toHaveLength(1);
  opened.session.dispose();
  await expect(opened.session.layout()).rejects.toMatchObject({ code: 'disposed' });

  try {
    await openDocumentForExport(bytes, {
      fonts: oneByteFontBudget,
      fontPolicy: 'strict',
      onFontResolution: () => {},
    });
    throw new Error('expected strict font policy to refuse approximate pagination');
  } catch (error) {
    expect(error).toBeInstanceOf(ExportResourceError);
    expect((error as ExportResourceError).code).toBe('layoutFailed');
  }
});

test('no-options byte export uses document-aware packaged fonts for Century Gothic', async () => {
  const bytes = docx(
    '<w:p><w:r><w:rPr><w:rFonts w:ascii="Century Gothic" w:hAnsi="Century Gothic"/></w:rPr>' +
      '<w:t>Document-aware pagination uses the named family.</w:t></w:r></w:p>'
  );
  const ordinary = await openDocumentForExport(bytes);
  expect(ordinary.ok).toBe(true);
  if (!ordinary.ok) return;
  const ordinaryLayout = await ordinary.session.layout();
  ordinary.session.dispose();

  let coverage: string | undefined;
  const inspected = await openDocumentForExport(bytes, {
    onFontResolution: (report) => {
      coverage = report.families.find((family) => family.family === 'Century Gothic')?.coverage;
    },
  });
  expect(inspected.ok).toBe(true);
  if (!inspected.ok) return;
  const inspectedLayout = await inspected.session.layout();
  inspected.session.dispose();

  expect(coverage).toBe('complete');
  expect(ordinaryLayout.pages).toEqual(inspectedLayout.pages);
});
