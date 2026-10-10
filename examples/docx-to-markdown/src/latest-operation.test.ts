import { describe, expect, test } from 'bun:test';
import { createLatestOperationGate } from './latest-operation';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('latest document operation gate', () => {
  test('a later upload wins when an initial sample resolves last', async () => {
    const gate = createLatestOperationGate();
    const sample = deferred<string>();
    const upload = deferred<string>();
    const published: string[] = [];
    const sampleOperation = gate.begin();
    const samplePublish = sample.promise.then((value) => {
      if (gate.isCurrent(sampleOperation)) published.push(value);
    });
    const uploadOperation = gate.begin();
    const uploadPublish = upload.promise.then((value) => {
      if (gate.isCurrent(uploadOperation)) published.push(value);
    });

    upload.resolve('upload');
    sample.resolve('sample');
    await Promise.all([samplePublish, uploadPublish]);

    expect(published).toEqual(['upload']);
  });

  test('an older save cannot publish after the next editor revision begins', async () => {
    const gate = createLatestOperationGate();
    const olderSave = deferred<string>();
    const latestSave = deferred<string>();
    const published: string[] = [];
    const olderOperation = gate.begin();
    const olderPublish = olderSave.promise.then((value) => {
      if (gate.isCurrent(olderOperation)) published.push(value);
    });
    const latestOperation = gate.begin();
    const latestPublish = latestSave.promise.then((value) => {
      if (gate.isCurrent(latestOperation)) published.push(value);
    });

    olderSave.resolve('stale revision');
    latestSave.resolve('latest revision');
    await Promise.all([olderPublish, latestPublish]);

    expect(published).toEqual(['latest revision']);
  });
});
