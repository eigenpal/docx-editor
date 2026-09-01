import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertRoutingContract } from '../check-demo-deployment.mjs';

const config = JSON.parse(
  readFileSync(join(import.meta.dir, '..', '..', 'vercel.json'), 'utf8')
) as { rewrites: Array<Record<string, unknown>> };

test('the current rewrite order satisfies every host and path route', () => {
  expect(() => assertRoutingContract(config.rewrites)).not.toThrow();
});

test('a generic root before host roots is rejected', () => {
  const genericRoot = config.rewrites.find(
    (rewrite) => rewrite.source === '/' && rewrite.has === undefined
  )!;
  const reordered = [genericRoot, ...config.rewrites.filter((rewrite) => rewrite !== genericRoot)];

  expect(() => assertRoutingContract(reordered)).toThrow('igloo.docx-editor.dev/');
});

test('an app fallback before host fallbacks is rejected for cross-app paths', () => {
  const reactFallback = config.rewrites.find((rewrite) => rewrite.source === '/react/(.*)')!;
  const reordered = [
    reactFallback,
    ...config.rewrites.filter((rewrite) => rewrite !== reactFallback),
  ];

  expect(() => assertRoutingContract(reordered)).toThrow('igloo.docx-editor.dev/react/deep/link');
});
