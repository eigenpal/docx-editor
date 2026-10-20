import { createServer, type IncomingMessage } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { API_PORT, COLLAB_URL, DATA_DIR, USER_TOKEN, requireRoomId } from './config.ts';
import { atomicWrite } from './files.ts';
import { JobStore, type Job } from './jobs.ts';
import { openAgentRoom, waitForOutboundSync } from './room.ts';
import { sampleDocument } from './sample.ts';

const jobs = new JobStore(path.join(DATA_DIR, 'jobs'));
await jobs.load();
const jobInput = z.object({
  requestId: z.string().uuid(),
  instruction: z.string().trim().min(1).max(4000),
  mode: z.enum(['scripted', 'ai']),
});
const titleInput = z.string().trim().min(1).max(150);
async function body(request: IncomingMessage, limit: number): Promise<Buffer> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error(`Request exceeds ${limit} bytes`);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
async function metadata(roomId: string) {
  return JSON.parse(
    await readFile(path.join(DATA_DIR, 'rooms', `${requireRoomId(roomId)}.json`), 'utf8')
  ) as { roomId: string; title: string };
}
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const send = (status: number, value: unknown) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(value));
  };
  try {
    const origin = request.headers.origin;
    const allowedOrigins = (
      process.env.ALLOWED_ORIGINS ??
      `http://localhost:${process.env.REVIEW_UI_PORT ?? 5180},http://127.0.0.1:${process.env.REVIEW_UI_PORT ?? 5180}`
    ).split(',');
    if (origin && !allowedOrigins.includes(origin))
      return send(403, { error: 'Origin not allowed' });
    if (url.pathname === '/api/config' && request.method === 'GET')
      return send(200, {
        url: COLLAB_URL,
        token: USER_TOKEN,
        ai: Boolean(process.env.OPENAI_API_KEY),
      });
    if ((request.headers['x-review-token'] ?? url.searchParams.get('token')) !== USER_TOKEN)
      return send(401, { error: 'Invalid review token' });
    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      const roomId = crypto.randomUUID().replaceAll('-', '');
      const uploaded =
        request.headers['content-type'] ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      const document = uploaded
        ? new Uint8Array(await body(request, 10 * 1024 * 1024))
        : sampleDocument();
      const title = uploaded
        ? titleInput.parse(
            decodeURIComponent(String(request.headers['x-document-title'] ?? 'Uploaded document'))
          )
        : 'Northstar · Services agreement';
      const session = await openAgentRoom(roomId, document);
      try {
        await waitForOutboundSync(session.room.provider);
      } finally {
        session.dispose();
      }
      const info = { roomId, title };
      await atomicWrite(path.join(DATA_DIR, 'rooms', `${roomId}.json`), JSON.stringify(info));
      return send(201, info);
    }
    const match = /^\/api\/rooms\/([A-Za-z0-9_-]+)(?:\/(jobs|events|download))?$/.exec(
      url.pathname
    );
    if (match) {
      const roomId = requireRoomId(match[1]!);
      const info = await metadata(roomId);
      const action = match[2];
      if (!action && request.method === 'GET')
        return send(200, { ...info, job: jobs.latest(roomId) });
      if (action === 'jobs' && request.method === 'POST') {
        const input = jobInput.parse(JSON.parse((await body(request, 10_000)).toString()));
        if (input.mode === 'ai' && !process.env.OPENAI_API_KEY)
          return send(503, {
            error: 'Set OPENAI_API_KEY on the worker, or choose Scripted review.',
          });
        try {
          return send(202, await jobs.start({ ...input, roomId }));
        } catch (error) {
          return send(409, { error: (error as Error).message });
        }
      }
      if (action === 'events' && request.method === 'GET') {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        const emit = (job: Job | null) => response.write(`data: ${JSON.stringify(job)}\n\n`);
        jobs.events.on(roomId, emit);
        emit(jobs.latest(roomId));
        const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15_000);
        response.on('close', () => {
          clearInterval(heartbeat);
          jobs.events.off(roomId, emit);
        });
        return;
      }
      if (action === 'download' && request.method === 'GET') {
        const session = await openAgentRoom(roomId);
        try {
          const document = await session.runtime.save();
          response.writeHead(200, {
            'Content-Type':
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'Content-Disposition': 'attachment; filename="reviewed-document.docx"',
          });
          response.end(document);
        } finally {
          session.dispose();
        }
        return;
      }
    }
    const cancel = /^\/api\/jobs\/([a-f0-9-]+)\/cancel$/.exec(url.pathname);
    if (cancel && request.method === 'POST') return send(200, jobs.cancel(cancel[1]!));
    send(404, { error: 'Not found' });
  } catch (error) {
    if (!response.headersSent)
      send((error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 400, {
        error: (error as Error).message,
      });
    else response.end();
  }
});
server.listen(API_PORT, '127.0.0.1', () =>
  console.log(`Review worker: http://127.0.0.1:${API_PORT}`)
);
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => {
    server.close();
    void jobs.close().finally(() => {
      server.closeAllConnections();
      process.exit(0);
    });
  });
