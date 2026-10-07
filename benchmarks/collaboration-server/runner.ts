// Run one benchmark step: one fresh server, one room, N participants.
//
// Phases:
//   1. start   the example server under Node, with the resource probe preloaded
//   2. join    the first participant creates the room; the others join it
//   3. load    every participant types its planned edits for the configured duration
//   4. drain   wait until every replica holds the same state
//   5. save    disconnect everyone and check the server's saved DOCX against the replicas

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Subprocess } from 'bun';
import {
  distribution,
  editLatencies,
  summarizeServer,
  type Distribution,
  type ServerSample,
  type ServerSummary,
} from './analysis.ts';
import { documentTextDigest, storeFrom } from './document-text.ts';
import type { EditProfile } from './edit-model.ts';
import {
  now,
  type ClientDigest,
  type ClientReport,
  type RunnerMessage,
  type Traffic,
  type WorkerConfig,
  type WorkerMessage,
  type WorkerReport,
} from './protocol.ts';

const SERVER_ENTRY = path.join(import.meta.dirname, 'server.ts');
const PROBE_ENTRY = path.join(import.meta.dirname, 'server-probe.ts');
const WORKER_ENTRY = path.join(import.meta.dirname, 'client-worker.ts');

export interface StepOptions {
  readonly participants: number;
  /** Share of participants who type, 0 to 1. The rest stay connected as observers. */
  readonly activeShare: number;
  readonly participantsPerWorker: number;
  readonly durationMs: number;
  readonly seed: number;
  readonly profile: EditProfile;
  readonly documentPath: string;
  /** Directory for this step's raw files: server samples, worker reports, logs. */
  readonly workDir: string;
  /** Connect to this server instead of starting one. The server probe is then unavailable. */
  readonly externalUrl?: string;
  readonly token: string;
}

export interface StepHealth {
  readonly serverCrashed: boolean;
  readonly serverExitCode: number | null;
  readonly joinFailures: readonly string[];
  readonly workerErrors: readonly string[];
  readonly sessionErrors: readonly string[];
  readonly disconnects: number;
  readonly refusedEdits: Readonly<Record<string, number>>;
  readonly undeliveredEdits: number;
  readonly converged: boolean;
  readonly convergenceMs: number | null;
  readonly savedDocumentMatches: boolean | null;
  /** Keystroke scheduling fell behind, so the client machine, not the server, set the pace. */
  readonly clientMachineSaturated: boolean;
}

export interface DiskSummary {
  /** Times the server persisted the room during typing. */
  readonly stores: number;
  /** Bytes written per second during typing: the room state plus its DOCX export. */
  readonly writeKBps: number;
  readonly roomBytes: number;
  readonly docxBytes: number;
  readonly exportMsP95: number;
  readonly exportMsMax: number;
}

export interface StepResult {
  readonly participants: number;
  readonly activeParticipants: number;
  readonly activeShare: number;
  readonly disk: DiskSummary | null;
  readonly workers: number;
  readonly durationMs: number;
  readonly documentBytes: number;
  readonly edits: {
    readonly planned: number;
    readonly applied: number;
    readonly perSecond: number;
  };
  readonly latencyMs: Distribution;
  readonly joinMs: Distribution;
  readonly server: {
    readonly idle: ServerSummary | null;
    readonly load: ServerSummary | null;
    readonly savedRoomBytes: number | null;
    readonly savedDocxBytes: number | null;
  };
  readonly traffic: {
    /** Server ingress and egress during the load phase. */
    readonly load: Traffic;
    readonly inboundKBps: number;
    readonly outboundKBps: number;
    /** Load-phase traffic by Hocuspocus message type. */
    readonly byType: Readonly<Record<string, Traffic>>;
    /** Everything, including the initial document download for each participant. */
    readonly total: Traffic;
  };
  readonly clients: {
    readonly cpuCores: number;
    readonly peakRssMb: number;
    /** CPU cores the typing participants used during typing, divided by the typists. */
    readonly cpuCoresPerParticipant: number;
    readonly schedulerLagMs: Distribution;
    /** Client time to integrate and materialize one remote transaction. */
    readonly remoteApplyMs: Distribution;
  };
  readonly health: StepHealth;
  readonly healthy: boolean;
  readonly problems: readonly string[];
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

function roomId(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ServerHandle {
  readonly url: string;
  readonly dataDir: string | null;
  readonly probeFile: string | null;
  readonly exited: () => number | null;
  readonly stop: () => Promise<void>;
}

async function startServer(options: StepOptions): Promise<ServerHandle> {
  if (options.externalUrl) {
    return {
      url: options.externalUrl,
      dataDir: null,
      probeFile: null,
      exited: () => null,
      stop: async () => {},
    };
  }
  const port = await freePort();
  const dataDir = path.join(options.workDir, 'rooms');
  const probeFile = path.join(options.workDir, 'server-samples.jsonl');
  const logFile = path.join(options.workDir, 'server.log');
  let exitCode: number | null = null;
  let stopping = false;
  const child = Bun.spawn(['node', '--import', PROBE_ENTRY, SERVER_ENTRY], {
    cwd: import.meta.dirname,
    env: {
      ...process.env,
      PORT: String(port),
      BENCH_TOKEN: options.token,
      BENCH_DATA_DIR: dataDir,
      BENCH_STORE_LOG: path.join(options.workDir, 'stores.jsonl'),
      BENCH_PROBE_FILE: probeFile,
    },
    stdout: 'pipe',
    stderr: 'pipe',
    onExit(_process, code) {
      exitCode = stopping ? null : (code ?? -1);
    },
  });
  const log: string[] = [];
  let listening = false;
  const pump = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder();
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      const text = decoder.decode(value);
      log.push(text);
      if (text.includes('listening')) listening = true;
    }
  };
  void pump(child.stdout);
  void pump(child.stderr);
  const deadline = Date.now() + 20_000;
  while (!listening) {
    if (exitCode !== null || Date.now() > deadline) {
      throw new Error(`the server did not start:\n${log.join('')}`);
    }
    await sleep(50);
  }
  return {
    url: `ws://127.0.0.1:${port}`,
    dataDir,
    probeFile,
    exited: () => exitCode,
    stop: async () => {
      stopping = exitCode === null;
      child.kill('SIGTERM');
      await Promise.race([child.exited, sleep(5_000)]);
      if (child.exitCode === null) child.kill('SIGKILL');
      writeFileSync(logFile, log.join(''));
    },
  };
}

interface WorkerHandle {
  readonly id: number;
  readonly process: Subprocess;
  readonly next: (type: WorkerMessage['type'], timeoutMs: number) => Promise<WorkerMessage>;
  readonly send: (message: RunnerMessage) => void;
  readonly errors: string[];
  readonly reportPath: string;
}

function startWorker(config: WorkerConfig): WorkerHandle {
  const errors: string[] = [];
  const inbox: WorkerMessage[] = [];
  const waiters: (() => void)[] = [];
  // BENCH_PROFILE_WORKER=<id> writes a CPU profile of that worker to the step directory.
  const profile =
    process.env.BENCH_PROFILE_WORKER === String(config.workerId)
      ? ['--cpu-prof', '--cpu-prof-md', `--cpu-prof-dir=${path.dirname(config.reportPath)}`]
      : [];
  const child = Bun.spawn(['bun', ...profile, WORKER_ENTRY], {
    cwd: import.meta.dirname,
    env: { ...process.env, BENCH_WORKER: JSON.stringify(config) },
    stdout: 'inherit',
    stderr: 'inherit',
    ipc(message: WorkerMessage) {
      if (message.type === 'fatal') errors.push(`worker ${config.workerId}: ${message.error}`);
      inbox.push(message);
      for (const wake of waiters.splice(0)) wake();
    },
    onExit(_process, code) {
      if (code !== 0) errors.push(`worker ${config.workerId} exited with code ${code}`);
      for (const wake of waiters.splice(0)) wake();
    },
  });
  const next = async (type: WorkerMessage['type'], timeoutMs: number): Promise<WorkerMessage> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const at = inbox.findIndex((message) => message.type === type);
      if (at >= 0) return inbox.splice(at, 1)[0]!;
      if (child.exitCode !== null) throw new Error(`worker ${config.workerId} exited early`);
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`worker ${config.workerId} sent no '${type}' message`);
      await Promise.race([new Promise<void>((resolve) => waiters.push(resolve)), sleep(left)]);
    }
  };
  return {
    id: config.workerId,
    process: child,
    next,
    send: (message) => child.send(message),
    errors,
    reportPath: config.reportPath,
  };
}

function sumTraffic(values: readonly Traffic[]): Traffic {
  return values.reduce(
    (sum, value) => ({
      bytesSent: sum.bytesSent + value.bytesSent,
      bytesReceived: sum.bytesReceived + value.bytesReceived,
      messagesSent: sum.messagesSent + value.messagesSent,
      messagesReceived: sum.messagesReceived + value.messagesReceived,
    }),
    { bytesSent: 0, bytesReceived: 0, messagesSent: 0, messagesReceived: 0 }
  );
}

function trafficByType(reports: readonly WorkerReport[]): Record<string, Traffic> {
  const types = new Set(reports.flatMap((report) => Object.keys(report.loadTrafficByType)));
  return Object.fromEntries(
    [...types].map((type) => [
      type,
      sumTraffic(reports.flatMap((report) => report.loadTrafficByType[type] ?? [])),
    ])
  );
}

function diskSummary(file: string, from: number, to: number): DiskSummary | null {
  if (!existsSync(file)) return null;
  const all = readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(
      (line) =>
        JSON.parse(line) as { t: number; roomBytes: number; docxBytes: number; exportMs: number }
    );
  if (all.length === 0) return null;
  const during = all.filter((store) => store.t >= from && store.t <= to);
  const written = during.reduce((sum, store) => sum + store.roomBytes + store.docxBytes, 0);
  const last = all[all.length - 1]!;
  const exports = distribution(during.map((store) => store.exportMs));
  return {
    stores: during.length,
    writeKBps: written / 1024 / Math.max(0.001, (to - from) / 1000),
    roomBytes: last.roomBytes,
    docxBytes: last.docxBytes,
    exportMsP95: exports.p95,
    exportMsMax: exports.max,
  };
}

function readSamples(file: string | null): ServerSample[] {
  if (!file || !existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ServerSample);
}

const OBSERVERS_PER_WORKER = 10;

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start }, (_, offset) => start + offset);
}

function allEqual(digests: readonly ClientDigest[], expected: number): boolean {
  if (digests.length !== expected || digests.length === 0) return false;
  const [first] = digests;
  // Observers hold the same Yjs state; only replicas have a document text to compare.
  const text = digests.find((digest) => digest.text !== null)?.text ?? null;
  return digests.every(
    (digest) =>
      digest.stateVector === first!.stateVector &&
      digest.deleteSet === first!.deleteSet &&
      (digest.text === null || digest.text === text) &&
      digest.status === 'ready'
  );
}

async function collectDigests(workers: readonly WorkerHandle[]): Promise<ClientDigest[]> {
  const replies = await Promise.all(
    workers.map(async (worker) => {
      worker.send({ type: 'digest' });
      const reply = await worker.next('digest', 30_000);
      return reply.type === 'digest' ? reply.digests : [];
    })
  );
  return replies.flat();
}

/** Wait until the server has written the room and stopped rewriting it. */
async function savedDocx(dataDir: string | null, room: string): Promise<Uint8Array | null> {
  if (!dataDir) return null;
  const file = path.join(dataDir, `${room}.ydoc.docx`);
  const deadline = Date.now() + 20_000;
  let lastSize = -1;
  let lastTime = -1;
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      const stat = statSync(file);
      if (stat.size === lastSize && stat.mtimeMs === lastTime) return readFileSync(file);
      lastSize = stat.size;
      lastTime = stat.mtimeMs;
    }
    await sleep(500);
  }
  return existsSync(file) ? readFileSync(file) : null;
}

export async function runStep(options: StepOptions): Promise<StepResult> {
  mkdirSync(options.workDir, { recursive: true });
  // The server appends to the store log, so a reused directory must not mix in an old run.
  rmSync(path.join(options.workDir, 'stores.jsonl'), { force: true });
  const room = roomId();
  const server = await startServer(options);
  // Two seconds of an empty server: the baseline that participants add to.
  const idleFrom = now();
  await sleep(2_000);
  const workers: WorkerHandle[] = [];
  // Typists are full replicas, one process each by default, as a browser tab is. Readers are
  // observers, ten to a process: the server serves them the same, and they cost the load
  // machine little.
  const active = Math.max(1, Math.round(options.participants * options.activeShare));
  const groups: { clients: number[]; observers: boolean }[] = [];
  for (let at = 0; at < active; at += options.participantsPerWorker) {
    const end = Math.min(active, at + options.participantsPerWorker);
    groups.push({ clients: range(at, end), observers: false });
  }
  for (let at = active; at < options.participants; at += OBSERVERS_PER_WORKER) {
    const end = Math.min(options.participants, at + OBSERVERS_PER_WORKER);
    groups.push({ clients: range(at, end), observers: true });
  }
  const workerConfig = (
    workerId: number,
    group: { clients: number[]; observers: boolean }
  ): WorkerConfig => ({
    workerId,
    url: server.url,
    roomId: room,
    token: options.token,
    clients: group.clients,
    observers: group.observers,
    ...(workerId === 0 ? { seedDocumentPath: options.documentPath } : {}),
    durationMs: options.durationMs,
    seed: options.seed,
    profile: options.profile,
    reportPath: path.join(options.workDir, `worker-${workerId}.json`),
  });

  const joinFailures: string[] = [];
  let loadStart = 0;
  let loadEnd = 0;
  let converged = false;
  let convergenceMs: number | null = null;
  let finalDigests: ClientDigest[] = [];
  const reports: WorkerReport[] = [];
  try {
    // The seeding worker goes first, so the room exists before anyone joins it.
    const seeding = startWorker(workerConfig(0, groups[0]!));
    workers.push(seeding);
    const seeded = await seeding.next('joined', 120_000);
    if (seeded.type === 'joined') joinFailures.push(...seeded.failures);
    workers.push(...groups.slice(1).map((group, at) => startWorker(workerConfig(at + 1, group))));
    for (const worker of workers.slice(1)) {
      const joined = await worker.next('joined', 120_000);
      if (joined.type === 'joined') joinFailures.push(...joined.failures);
    }

    // Start everyone on one shared clock, a moment from now.
    loadStart = now() + 1_000;
    for (const worker of workers) worker.send({ type: 'start-load', startAt: loadStart });
    for (const worker of workers) await worker.next('load-finished', options.durationMs + 120_000);
    loadEnd = now();

    const drainDeadline = Date.now() + 60_000;
    for (;;) {
      finalDigests = await collectDigests(workers);
      if (allEqual(finalDigests, options.participants - joinFailures.length)) {
        converged = true;
        convergenceMs = now() - loadEnd;
        break;
      }
      if (Date.now() > drainDeadline) break;
      await sleep(250);
    }
  } finally {
    for (const worker of workers) {
      try {
        worker.send({ type: 'shutdown' });
        await worker.next('reported', 30_000);
        reports.push(JSON.parse(readFileSync(worker.reportPath, 'utf8')) as WorkerReport);
      } catch (error) {
        worker.errors.push(`worker ${worker.id}: no report (${(error as Error).message})`);
        worker.process.kill('SIGKILL');
      }
    }
  }

  const saved = await savedDocx(server.dataDir, room);
  const serverExitCode = server.exited();
  await server.stop();

  const samples = readSamples(server.probeFile);
  const clients: ClientReport[] = reports.flatMap((report) => report.clients);
  const latency = editLatencies(clients);
  const statusEvents = clients.flatMap((client) =>
    client.statusEvents.map((event) => ({ ...event, index: client.index }))
  );
  const refusedEdits: Record<string, number> = {};
  for (const client of clients) {
    for (const [reason, count] of Object.entries(client.refused)) {
      refusedEdits[reason] = (refusedEdits[reason] ?? 0) + count;
    }
  }
  const schedulerLag = distribution(clients.flatMap((client) => client.schedulerLagMs));
  const loadSeconds = Math.max(0.001, (loadEnd - loadStart) / 1000);
  const loadTraffic = sumTraffic(reports.map((report) => report.loadTraffic));
  const expectedDigest = finalDigests.find((digest) => digest.text !== null)?.text;
  let savedDocumentMatches: boolean | null = null;
  if (saved && expectedDigest) {
    try {
      savedDocumentMatches = documentTextDigest(storeFrom(saved)) === expectedDigest;
    } catch {
      savedDocumentMatches = false;
    }
  } else if (server.dataDir) {
    savedDocumentMatches = false;
  }
  const savedRoomFile = server.dataDir ? path.join(server.dataDir, `${room}.ydoc`) : null;

  const health: StepHealth = {
    serverCrashed: serverExitCode !== null,
    serverExitCode,
    joinFailures,
    workerErrors: workers.flatMap((worker) => worker.errors),
    sessionErrors: statusEvents
      .filter((event) => event.status === 'error')
      .map(
        (event) =>
          `participant ${event.index + 1}: ${event.reason ?? 'error'} ${event.detail ?? ''}`
      ),
    disconnects: statusEvents.filter((event) => event.status === 'disconnected').length,
    refusedEdits,
    undeliveredEdits: latency.missing,
    converged,
    convergenceMs,
    savedDocumentMatches,
    clientMachineSaturated: schedulerLag.p95 > 50,
  };
  const problems = [
    ...(health.serverCrashed ? [`server exited with code ${serverExitCode}`] : []),
    ...health.joinFailures,
    ...health.workerErrors,
    ...health.sessionErrors,
    ...(health.disconnects ? [`${health.disconnects} disconnects`] : []),
    ...(health.undeliveredEdits ? [`${health.undeliveredEdits} undelivered edits`] : []),
    ...(health.converged ? [] : ['replicas did not converge']),
    ...(health.savedDocumentMatches === false ? ['saved DOCX does not match the replicas'] : []),
  ];

  const coresOf = (selected: readonly WorkerReport[]) =>
    selected.reduce((sum, report) => sum + report.cpuUserMs + report.cpuSystemMs, 0) /
    Math.max(1, loadEnd - loadStart);
  const clientCores = coresOf(reports);
  // Readers run in their own workers, so typist cost divides by typists only.
  const typistCores = coresOf(
    reports.filter((report) => report.clients.some((client) => !client.observer))
  );
  const typists = clients.filter((client) => !client.observer).length;
  const planned = clients.reduce((sum, client) => sum + client.planned, 0);
  const applied = clients.reduce((sum, client) => sum + client.applied, 0);
  return {
    participants: options.participants,
    activeParticipants: active,
    activeShare: options.activeShare,
    disk: diskSummary(path.join(options.workDir, 'stores.jsonl'), loadStart, loadEnd),
    workers: groups.length,
    durationMs: options.durationMs,
    documentBytes: statSync(options.documentPath).size,
    edits: { planned, applied, perSecond: applied / loadSeconds },
    latencyMs: distribution(latency.samples),
    joinMs: distribution(clients.map((client) => client.joinMs)),
    server: {
      idle: samples.length ? summarizeServer(samples, idleFrom, idleFrom + 2_000) : null,
      load: samples.length ? summarizeServer(samples, loadStart, loadEnd) : null,
      savedRoomBytes:
        savedRoomFile && existsSync(savedRoomFile) ? statSync(savedRoomFile).size : null,
      savedDocxBytes: saved?.byteLength ?? null,
    },
    traffic: {
      load: loadTraffic,
      inboundKBps: loadTraffic.bytesSent / 1024 / loadSeconds,
      outboundKBps: loadTraffic.bytesReceived / 1024 / loadSeconds,
      byType: trafficByType(reports),
      total: sumTraffic(reports.map((report) => report.traffic)),
    },
    clients: {
      cpuCores: clientCores,
      peakRssMb: reports.reduce((sum, report) => sum + report.peakRssMb, 0),
      cpuCoresPerParticipant: typistCores / Math.max(1, typists),
      schedulerLagMs: schedulerLag,
      remoteApplyMs: distribution(clients.flatMap((client) => client.remoteApplyMs)),
    },
    health,
    healthy: problems.length === 0,
    problems,
  };
}

export function environment(): Record<string, string | number> {
  const node = Bun.spawnSync(['node', '--version']).stdout.toString().trim();
  return {
    platform: `${os.type()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0]?.model ?? 'unknown',
    cpuCores: os.cpus().length,
    memoryGb: Math.round(os.totalmem() / 1024 ** 3),
    node,
    bun: Bun.version,
  };
}
