// Resource probe for the benchmark's room server.
//
// Node preloads this module before the server:
//
//   node --import ./server-probe.ts ./server.ts
//
// The probe only reads process counters and appends one JSON line per sample to
// `BENCH_PROBE_FILE`. It never touches Hocuspocus, so the server code is unchanged by it.

import { appendFileSync } from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';

const file = process.env.BENCH_PROBE_FILE;
const intervalMs = Number(process.env.BENCH_PROBE_INTERVAL_MS ?? 500);

if (file) {
  const delay = monitorEventLoopDelay({ resolution: 1 });
  delay.enable();
  let lastCpu = process.cpuUsage();
  let lastWall = performance.now();

  const sample = (): void => {
    const now = performance.now();
    const cpu = process.cpuUsage();
    const wallUs = (now - lastWall) * 1000;
    const usedUs = cpu.user - lastCpu.user + (cpu.system - lastCpu.system);
    const memory = process.memoryUsage();
    const resources = process.getActiveResourcesInfo();
    const line = {
      // Epoch milliseconds with sub-millisecond precision, comparable across processes.
      t: performance.timeOrigin + now,
      // 100 means one full core. The JavaScript thread of one Node process cannot use more.
      cpuPct: wallUs > 0 ? (usedUs / wallUs) * 100 : 0,
      rssMb: memory.rss / 1048576,
      heapUsedMb: memory.heapUsed / 1048576,
      heapTotalMb: memory.heapTotal / 1048576,
      externalMb: memory.external / 1048576,
      arrayBuffersMb: memory.arrayBuffers / 1048576,
      eventLoopP50Ms: delay.percentile(50) / 1e6,
      eventLoopP99Ms: delay.percentile(99) / 1e6,
      eventLoopMaxMs: delay.max / 1e6,
      tcpSockets: resources.filter((name) => name === 'TCPSocketWrap').length,
    };
    delay.reset();
    lastCpu = cpu;
    lastWall = now;
    appendFileSync(file, `${JSON.stringify(line)}\n`);
  };

  const timer = setInterval(sample, intervalMs);
  // The probe must never keep the server alive after Hocuspocus closes.
  timer.unref();
}
