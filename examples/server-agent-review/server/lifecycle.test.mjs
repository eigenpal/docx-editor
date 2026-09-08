import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(() => resolve()));
  return port;
}
async function until(read, ready) {
  const deadline = Date.now() + 15_000;
  while (true) {
    try {
      const value = await read();
      if (ready(value)) return value;
    } catch {
      // Servers may still be starting or recovering after a restart.
    }
    if (Date.now() > deadline) throw new Error('Timed out waiting for worker state');
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
}
async function stop(child, signal = 'SIGTERM') {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill(signal);
  await exited;
}
test(
  'real Node processes stop on transport loss and recover interrupted jobs without replay',
  { timeout: 45_000 },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'agent-lifecycle-'));
    const apiPort = await freePort();
    const collabPort = await freePort();
    const children = [];
    const env = {
      ...process.env,
      REVIEW_DATA_DIR: directory,
      REVIEW_API_PORT: String(apiPort),
      COLLAB_PORT: String(collabPort),
      COLLAB_URL: `ws://127.0.0.1:${collabPort}`,
      COLLAB_TOKEN: 'lifecycle-user',
      AGENT_COLLAB_TOKEN: 'lifecycle-agent',
      REVIEW_SCRIPT_DELAY_MS: '3000',
      OPENAI_API_KEY: '',
    };
    let logs = '';
    function start(file) {
      const child = spawn('node', [file], { cwd: import.meta.dirname, env, stdio: 'pipe' });
      child.stderr?.on('data', (data) => {
        logs += String(data);
      });
      children.push(child);
      return child;
    }
    async function api(route, value) {
      const response = await fetch(`http://127.0.0.1:${apiPort}/api/${route}`, {
        method: value === undefined ? 'GET' : 'POST',
        headers: { 'x-review-token': 'lifecycle-user', 'Content-Type': 'application/json' },
        ...(value === undefined ? {} : { body: JSON.stringify(value) }),
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    }
    try {
      let collab = start('collaboration.ts');
      let worker = start('index.ts');
      await until(() => api('config'), Boolean);
      const room = await until(() => api('rooms', {}), Boolean);
      const request = { requestId: crypto.randomUUID(), mode: 'scripted', instruction: 'Review' };
      await api(`rooms/${room.roomId}/jobs`, request);
      await until(
        () => api(`rooms/${room.roomId}`),
        (r) => r.job?.proposals === 1
      );
      await stop(collab, 'SIGKILL');
      const failed = await until(
        () => api(`rooms/${room.roomId}`),
        (r) => r.job?.state === 'failed'
      );
      assert.equal(failed.job.proposals, 1);
      collab = start('collaboration.ts');
      // A read through the live collaboration session also verifies persisted room recovery.
      await until(async () => {
        const response = await fetch(
          `http://127.0.0.1:${apiPort}/api/rooms/${room.roomId}/download?token=lifecycle-user`
        );
        return response.ok;
      }, Boolean);
      const freshRoom = await api('rooms', {});
      await api(`rooms/${freshRoom.roomId}/jobs`, { ...request, requestId: crypto.randomUUID() });
      const active = await until(
        () => api(`rooms/${freshRoom.roomId}`),
        (r) => r.job?.state === 'proposing'
      );
      await stop(worker, 'SIGKILL');
      worker = start('index.ts');
      const recovered = await until(
        () => api(`rooms/${freshRoom.roomId}`),
        (r) => r.job?.state === 'interrupted'
      );
      assert.equal(recovered.job.id, active.job.id);
      const count = recovered.job.proposals;
      await new Promise((resolve) => setTimeout(resolve, 3200));
      assert.equal((await api(`rooms/${freshRoom.roomId}`)).job.proposals, count);
    } catch (error) {
      throw new Error(`${String(error)}\n${logs}`);
    } finally {
      await Promise.all(children.map((child) => stop(child, 'SIGKILL')));
      await rm(directory, { recursive: true, force: true });
    }
  }
);
