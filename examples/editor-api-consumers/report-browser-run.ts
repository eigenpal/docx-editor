/** Run after report-agent.ts: bun examples/editor-api-consumers/report-browser-run.ts */
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = process.cwd();
const out = '/tmp/editor-api-consumers/report/browser';
await mkdir(out, { recursive: true });
const server = await createServer({
  configFile: false,
  root,
  optimizeDeps: { entries: ['examples/editor-api-consumers/report-browser.html'] },
  server: {
    host: '127.0.0.1',
    port: 5197,
    strictPort: true,
    fs: { allow: [root, '/tmp/editor-api-consumers'] },
  },
  resolve: {
    alias: [
      {
        find: '@docx-editor.dev/core/styles/editor.css',
        replacement: resolve(root, 'packages/core/dist/editor.css'),
      },
      {
        find: '@docx-editor.dev/editor-api/browser',
        replacement: resolve(root, 'packages/editor-api/src/browser.ts'),
      },
      { find: '@docx-editor.dev/core', replacement: resolve(root, 'packages/core/src') },
    ],
  },
});
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1100 } });
  const messages: string[] = [];
  page.on('pageerror', (error) => messages.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') messages.push(message.text());
  });
  await page.goto('http://127.0.0.1:5197/examples/editor-api-consumers/report-browser.html');
  try {
    await page.waitForFunction(() => 'reportResult' in window, undefined, { timeout: 60000 });
  } catch (error) {
    messages.push(String(error));
  }
  const result = await page.evaluate(
    () =>
      (
        window as unknown as {
          reportResult?: { bytes?: number[]; evidence?: unknown[]; fatal?: string };
        }
      ).reportResult
  );
  await writeFile(
    `${out}/evidence.json`,
    JSON.stringify(
      { result: { ...result, bytes: result?.bytes?.length }, consoleErrors: messages },
      null,
      2
    )
  );
  await page.screenshot({ path: `${out}/report.png`, fullPage: true });
  if (result?.bytes) await writeFile(`${out}/report.docx`, new Uint8Array(result.bytes));
  process.stdout.write(
    JSON.stringify({ ...result, bytes: result?.bytes?.length, consoleErrors: messages }, null, 2)
  );
  if (
    !result ||
    result.fatal ||
    result.evidence?.some((e) => (e as { status?: string }).status === 'failed')
  )
    process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
