import { expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { customFonts } from '../../../core/src/editor/custom-fonts.ts';
import { composeFontOrigins } from '../../../core/src/editor/font-resolver.ts';
import { registerEmbeddedFontFaces } from '../../../core/src/editor/embedded-font-faces.ts';
import { packagedFonts } from '../index.ts';
import { googleFonts } from '../google-fonts.ts';

const bytes = new Uint8Array(
  readFileSync(new URL('../../assets/LiberationSans-Regular.ttf', import.meta.url))
);

test('company fonts compose before packaged and Google fonts without duplicate downloads', async () => {
  const fetchCompany = mock(async () => new Response(bytes.slice()));
  const fetchFallback = mock(async () => new Response(null, { status: 404 }));
  const sources = ([400, 700] as const).flatMap((weight) =>
    (['normal', 'italic'] as const).map((style) => ({
      family: 'Arial',
      weight,
      style,
      url: `/company/Arial-${weight}-${style}.ttf`,
    }))
  );
  const composed = await composeFontOrigins(
    [
      customFonts({ sources, fetcher: fetchCompany as unknown as typeof fetch }),
      packagedFonts({ fetcher: fetchFallback as unknown as typeof fetch }),
      googleFonts({ fetcher: fetchFallback as unknown as typeof fetch }),
    ],
    { families: ['arial'], defaultFamily: 'Arial' }
  );
  expect(composed!.sources).toHaveLength(4);
  expect(composed!.sources!.every((source) => source.id.startsWith('url:/company/'))).toBe(true);
  expect(fetchCompany).toHaveBeenCalledTimes(4);
  expect(fetchFallback).not.toHaveBeenCalled();

  const faces = new Set<{ family: string; load(): Promise<void> }>();
  const registration = await registerEmbeddedFontFaces(composed!.sources!, {
    fontSet: {
      add(face) {
        faces.add(face as { family: string; load(): Promise<void> });
      },
      delete(face) {
        faces.delete(face as { family: string; load(): Promise<void> });
      },
    },
    createFontFace(family) {
      return { family, async load() {} };
    },
  });
  expect(registration.installed).toBe(4);
  expect(registration.alias('arial')).toMatch(/^docx-embedded-/);
  expect([...faces].every((face) => face.family === registration.alias('Arial'))).toBe(true);
  registration.dispose();
  expect(faces.size).toBe(0);
});
