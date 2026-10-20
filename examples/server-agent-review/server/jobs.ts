import { EventEmitter } from 'node:events';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicWrite } from './files.ts';
import { runReview } from './agent.ts';

export type JobState =
  | 'connecting'
  | 'reading'
  | 'proposing'
  | 'syncing'
  | 'completed'
  | 'cancelled'
  | 'interrupted'
  | 'failed';
export interface Job {
  id: string;
  version: number;
  epoch: string;
  requestId: string;
  roomId: string;
  instruction: string;
  mode: 'scripted' | 'ai';
  state: JobState;
  message: string;
  proposals: number;
  createdAt: string;
  updatedAt: string;
}
export const activeJob = (job: Job) =>
  ['connecting', 'reading', 'proposing', 'syncing'].includes(job.state);
export class JobStore {
  readonly events = new EventEmitter();
  readonly jobs = new Map<string, Job>();
  private controllers = new Map<string, AbortController>();
  private pending = new Set<Promise<void>>();
  private writes = Promise.resolve();
  private closing = false;
  private version = 0;
  private readonly epoch = crypto.randomUUID();
  private directory: string;
  private execute: typeof runReview;
  constructor(directory: string, execute: typeof runReview = runReview) {
    this.directory = directory;
    this.execute = execute;
    this.events.setMaxListeners(100);
  }
  async load() {
    await mkdir(this.directory, { recursive: true });
    for (const name of await readdir(this.directory)) {
      if (!name.endsWith('.json')) continue;
      const job = JSON.parse(await readFile(path.join(this.directory, name), 'utf8')) as Job;
      job.epoch = this.epoch;
      this.jobs.set(job.id, job);
      this.version = Math.max(this.version, job.version ?? 0);
    }
    for (const job of [...this.jobs.values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt)
    )) {
      if (activeJob(job)) {
        job.version = ++this.version;
        job.state = 'interrupted';
        job.message = 'The worker restarted. Start a new review to continue.';
      }
      job.version ??= ++this.version;
      await this.save(job);
    }
  }

  latest(roomId: string) {
    return (
      [...this.jobs.values()]
        .filter((job) => job.roomId === roomId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
    );
  }
  private save(job: Job) {
    const data = JSON.stringify(job, null, 2);
    const write = this.writes.then(() =>
      atomicWrite(path.join(this.directory, `${job.id}.json`), data)
    );
    this.writes = write.catch(() => {});
    return write;
  }
  async start(input: Pick<Job, 'requestId' | 'roomId' | 'instruction' | 'mode'>) {
    if (this.closing) throw new Error('Worker is stopping');
    const previous = [...this.jobs.values()].find(
      (job) => job.roomId === input.roomId && job.requestId === input.requestId
    );
    if (previous) return previous;
    if ([...this.jobs.values()].some((job) => job.roomId === input.roomId && activeJob(job))) {
      throw new Error('A review is already running in this room');
    }
    const now = new Date().toISOString();
    const job: Job = {
      ...input,
      id: crypto.randomUUID(),
      version: ++this.version,
      epoch: this.epoch,
      state: 'connecting',
      message: 'Connecting the review agent',
      proposals: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(job.id, job);
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    try {
      await this.save(job);
    } catch (error) {
      this.jobs.delete(job.id);
      this.controllers.delete(job.id);
      throw error;
    }
    const execution = this.run(job, controller);
    this.pending.add(execution);
    void execution.finally(() => this.pending.delete(execution));
    return job;
  }
  private async run(job: Job, controller: AbortController) {
    const update = (patch: Partial<Job>) => {
      Object.assign(job, patch, { version: ++this.version, updatedAt: new Date().toISOString() });
      this.events.emit(job.roomId, { ...job });
      void this.save(job).catch((error) => controller.abort(error));
    };
    try {
      await this.execute({
        ...job,
        signal: controller.signal,
        progress: (message) =>
          update({
            message,
            state: message.startsWith('Connecting')
              ? 'connecting'
              : message.startsWith('Proposing')
                ? 'proposing'
                : message.startsWith('Syncing')
                  ? 'syncing'
                  : 'reading',
          }),
        committed: () => update({ proposals: job.proposals + 1, state: 'proposing' }),
      });
      update({
        state: 'completed',
        message: job.proposals
          ? 'Review complete. Your suggestions are ready.'
          : 'Review complete. No suggestions were committed.',
      });
    } catch (error) {
      const state = this.closing
        ? 'interrupted'
        : controller.signal.aborted && controller.signal.reason === 'user-cancelled'
          ? 'cancelled'
          : 'failed';
      update({
        state,
        message:
          state === 'cancelled'
            ? 'Review cancelled. Committed suggestions remain.'
            : state === 'interrupted'
              ? 'The worker stopped. Start a new review to continue.'
              : (error as Error).message,
      });
    } finally {
      this.controllers.delete(job.id);
      try {
        await this.save(job);
      } catch (error) {
        console.error('Could not persist job', error);
      }
    }
  }
  cancel(id: string) {
    const job = this.jobs.get(id);
    if (!job) throw new Error('Unknown job');
    this.controllers.get(id)?.abort('user-cancelled');
    return job;
  }
  async close() {
    this.closing = true;
    for (const controller of this.controllers.values()) controller.abort('worker-stopped');
    await Promise.allSettled(this.pending);
    await this.writes;
  }
}
