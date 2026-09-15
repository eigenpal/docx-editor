import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';

export class Peer {
  constructor(directory, label, trace = []) {
    directory = resolve(directory);
    this.label = label;
    this.trace = trace;
    this.pending = new Map();
    this.sequence = 0;
    this.child = spawn(process.execPath, [join(directory, 'worker.mjs')], {
      cwd: directory,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_PATH: '' },
    });
    this.stderr = '';
    this.child.stderr.on('data', (data) => {
      this.stderr = (this.stderr + data).slice(-8000);
    });
    createInterface({ input: this.child.stdout }).on('line', (line) => {
      let reply;
      try {
        reply = JSON.parse(line);
      } catch {
        this.fail(new Error(`Invalid worker output: ${line}`));
        return;
      }
      const pending = this.pending.get(reply.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(reply.id);
      reply.error
        ? pending.reject(new Error(`${label}: ${reply.error}`))
        : pending.resolve(reply.value);
    });
    this.child.stdin.on('error', (error) =>
      this.fail(new Error(`${label}: worker input failed: ${error.message}`))
    );
    this.child.on('error', (error) => this.fail(error));
    this.child.on('exit', (code) =>
      this.fail(new Error(`${label} worker exited (${code}): ${this.stderr}`))
    );
  }
  fail(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.failure = error;
  }
  request(command, values = {}) {
    if (this.failure) return Promise.reject(this.failure);
    const input = { id: ++this.sequence, command, ...values };
    if (command === 'open')
      input.clientID = createHash('sha256')
        .update(`${this.label}:${input.actor}:${input.id}`)
        .digest()
        .readUInt32BE(0);
    this.trace.push({ peer: this.label, ...input });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(input.id);
        reject(new Error(`${this.label}: ${command} timed out`));
        this.child.kill();
      }, 30_000);
      this.pending.set(input.id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify(input) + '\n');
    });
  }
  async close() {
    try {
      if (!this.failure) await this.request('close');
    } finally {
      this.child.stdin.end();
      this.child.kill();
    }
  }
}
