import { expect, test } from 'bun:test';
import { readConversionResponse, type ConversionProgress } from './conversion-response';

function streamed(chunks: string[]): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }),
    { headers: { 'Content-Type': 'application/x-ndjson' } }
  );
}

test('handles fragmented events, combined chunks and a final line without a newline', async () => {
  const progress: ConversionProgress[] = [];
  const result = await readConversionResponse(
    streamed([
      '{"type":"pro',
      'gress","phase":"starting"}\n{"type":"progress","phase":"generating",',
      '"workerStartupMs":125}\n{"type":"result","pdf":"JVBERg==","timings":{"generationMs":240}}',
    ]),
    (event) => progress.push(event)
  );
  expect(progress.map(({ phase }) => phase)).toEqual(['starting', 'generating']);
  expect(progress[1].workerStartupMs).toBe(125);
  expect(result.pdf).toBe('JVBERg==');
  expect(result.timings?.generationMs).toBe(240);
});

test('an incomplete stream cannot be mistaken for a completed conversion', async () => {
  await expect(
    readConversionResponse(streamed(['{"type":"progress","phase":"starting"}\n']), () => {})
  ).rejects.toThrow('disconnected');
});

test('returns streamed failures and supports existing JSON responses', async () => {
  const error = await readConversionResponse(
    streamed(['{"type":"result","status":500,"message":"Worker failed"}\n']),
    () => {}
  );
  expect(error.message).toBe('Worker failed');
  const legacy = await readConversionResponse(Response.json({ pdf: 'JVBERg==' }), () => {
    throw new Error('A JSON response has no progress events');
  });
  expect(legacy.pdf).toBe('JVBERg==');
});
