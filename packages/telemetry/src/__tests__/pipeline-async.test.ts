/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/telemetry/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { callbackExporter, createTelemetry } from '../index.ts';
import { createPipeline, type TelemetryEvent } from '../pipeline.ts';
import { METRICS } from '../metrics.ts';

const event: TelemetryEvent = {
  schemaVersion: 1,
  editorSessionId: 'e_0123456789abcdef',
  time: 1_700_000_000_000,
  engineVersion: 'development',
  kind: 'edit.rejected',
  code: 'edit.read-only',
  origin: 'input',
  tracked: false,
  attributes: {},
  resource: {},
};

test('async callback failures report once without unhandled rejections', async () => {
  const failures: string[] = [];
  const telemetry = createTelemetry({
    dedupeWindowMs: 0,
    exporters: [
      callbackExporter(
        async () => {
          throw new Error('event failure');
        },
        async () => {
          throw new Error('metric failure');
        }
      ),
    ],
    onExporterError: async (_error, name) => {
      failures.push(name);
      throw new Error('reporting failure');
    },
  });
  telemetry.record(event);
  telemetry.record(event);
  await telemetry.shutdown();
  expect(failures).toEqual(['callback']);
});

for (const operation of ['flush', 'shutdown'] as const) {
  test(`${operation} can release the promises returned by buffered event and metric callbacks`, async () => {
    const order: string[] = [];
    let releaseEvent!: () => void;
    let releaseMetric!: () => void;
    const pipeline = createPipeline({
      exporters: [
        {
          name: 'async',
          async event() {
            await new Promise<void>((resolve) => {
              releaseEvent = resolve;
            });
            order.push('event');
          },
          async metric() {
            await new Promise<void>((resolve) => {
              releaseMetric = resolve;
            });
            order.push('metric');
          },
          flush() {
            order.push('flush');
            releaseEvent();
            releaseMetric();
          },
          shutdown() {
            order.push('shutdown');
            releaseEvent();
            releaseMetric();
          },
        },
      ],
    });
    pipeline.event(event);
    pipeline.metric(METRICS.editRejections, 1);
    const completed = pipeline[operation]();
    // The hook must run before callback delivery settles, or each waits for the other.
    expect(order).toEqual([operation]);
    await completed;
    expect(order).toEqual([operation, 'event', 'metric']);
    if (operation === 'flush') await pipeline.shutdown();
  });
}

test('shutdown flushes an exporter without a shutdown hook before buffered callbacks settle', async () => {
  let deliver!: () => void;
  let delivered = false;
  const pipeline = createPipeline({
    exporters: [
      {
        name: 'buffered',
        async event() {
          await new Promise<void>((resolve) => {
            deliver = resolve;
          });
          delivered = true;
        },
        flush() {
          deliver();
        },
      },
    ],
  });
  pipeline.event(event);
  await pipeline.shutdown();
  expect(delivered).toBe(true);
});
