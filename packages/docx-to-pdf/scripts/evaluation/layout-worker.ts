/** Bounded sequential requests within one reusable evaluation process. */
import { createInterface } from 'node:readline';
import { readFile, writeFile } from 'node:fs/promises';
import { summarizePages } from './layout-summary.ts';

const requests = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of requests) {
  try {
    if (line.length > 16_384) throw new Error('Request exceeds limit');
    const { input, output } = JSON.parse(line);
    if (typeof input !== 'string' || typeof output !== 'string')
      throw new Error('Expected input and output paths');
    const result = await summarizePages(new Uint8Array(await readFile(input)));
    await writeFile(output, JSON.stringify(result));
    process.stdout.write(JSON.stringify({ status: 'laid-out', pages: result.pageCount }) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({ status: 'error', error: String(error).slice(0, 1000) }) + '\n');
  }
}
