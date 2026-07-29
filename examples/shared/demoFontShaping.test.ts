import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseDocx } from '@docx-editor.dev/core-contract/store';
import { FontResolutionError, layoutBody, sha256FontBytes } from '@docx-editor.dev/core-contract/layout';
import { createLayoutShaping } from '../../packages/engine-editor/src/index.ts';
import { createDemoFontConfiguration } from './demoFontShaping.ts';

const regular = new Uint8Array(readFileSync(new URL('./fonts/DejaVuSans.ttf', import.meta.url)));
const bold = new Uint8Array(readFileSync(new URL('./fonts/DejaVuSans-Bold.ttf', import.meta.url)));

test('demo registry keeps exact licensed regular and bold bytes', async () => {
  const shaping = await createLayoutShaping(createDemoFontConfiguration(regular, bold));
  const regularFace = shaping.fonts.resolve({
    family: 'DejaVu Sans',
    weight: 400,
    style: 'normal',
  });
  const boldFace = shaping.fonts.resolve({
    family: 'DejaVu Sans',
    weight: 700,
    style: 'normal',
  });
  if (regularFace instanceof FontResolutionError || boldFace instanceof FontResolutionError) {
    throw new Error('demo faces did not resolve');
  }

  expect(sha256FontBytes(regularFace.bytes)).toBe(
    'sha256:7da195a74c55bef988d0d48f9508bd5d849425c1770dba5d7bfc6ce9ed848954'
  );
  expect(sha256FontBytes(boldFace.bytes)).toBe(
    'sha256:e6476c1b80502924294eed40894c5b18e06c181444ca953e5334262df9c27724'
  );
  expect(regularFace.hash).not.toBe(boldFace.hash);
});

test('default comprehensive fixture lays out through declared demo substitutions', async () => {
  const parsed = parseDocx(
    readFileSync(
      new URL('../../e2e/fixtures/comprehensive-word-element-test.docx', import.meta.url)
    )
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const shaping = await createLayoutShaping(createDemoFontConfiguration(regular, bold));

  const layout = layoutBody(parsed.model, {
    pageWidth: 12240,
    pageHeight: 15840,
    margin: 1440,
    shaping,
  });

  expect(layout.pages.length).toBeGreaterThan(0);
});
