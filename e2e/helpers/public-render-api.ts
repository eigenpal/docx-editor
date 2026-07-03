import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';

const PARSER_MODULE = `/@fs/${resolve('packages/core/dist/docx/parser.mjs')}`;
export const PUBLIC_RENDER_API_MODULE = `/@fs/${resolve('packages/core/dist/api.mjs')}`;

export async function renderDocumentThroughPublicApi(page: Page, input: unknown): Promise<void> {
  await page.goto('/');
  await page.evaluate(
    async ({ apiModule, documentInput }) => {
      const api = (await import(apiModule)) as {
        renderDocument(input: unknown, root: HTMLElement): unknown;
      };
      const root = document.createElement('div');
      root.id = 'public-render-api-root';
      document.body.replaceChildren(root);
      const rendered = api.renderDocument(documentInput, root);
      (
        window as unknown as {
          __publicRenderedDocument: unknown;
        }
      ).__publicRenderedDocument = rendered;
    },
    { apiModule: PUBLIC_RENDER_API_MODULE, documentInput: input }
  );
  await page.waitForSelector('#public-render-api-root .layout-page');
}

/**
 * Render a real DOCX fixture through the supported core rendering facade.
 *
 * The fixture bytes are parsed and painted in Chromium so canvas text metrics,
 * Range geometry, and DOM layout are the same facilities used by consumers.
 */
export async function renderFixtureThroughPublicApi(page: Page, fixture: string): Promise<void> {
  const bytes = Array.from(await readFile(resolve('e2e/fixtures', fixture)));
  await page.goto('/');
  await page.evaluate(
    async ({ apiModule, parserModule, fixtureBytes }) => {
      const parser = (await import(parserModule)) as {
        parseDocx(input: Uint8Array): Promise<unknown>;
      };
      const api = (await import(apiModule)) as {
        renderDocument(input: unknown, root: HTMLElement): unknown;
      };
      const root = document.createElement('div');
      root.id = 'public-render-api-root';
      document.body.replaceChildren(root);
      const parsed = await parser.parseDocx(new Uint8Array(fixtureBytes));
      const rendered = api.renderDocument(parsed, root);
      (
        window as unknown as {
          __publicRenderedDocument: unknown;
        }
      ).__publicRenderedDocument = rendered;
    },
    { apiModule: PUBLIC_RENDER_API_MODULE, parserModule: PARSER_MODULE, fixtureBytes: bytes }
  );
  await page.waitForSelector('#public-render-api-root .layout-page');
}
