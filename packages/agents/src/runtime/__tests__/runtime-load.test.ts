// What `load` selects, and when a property is allowed to answer.
//
// A batching object model's central bargain is that a property is DATA a previous sync brought
// back, not a question asked on access. So there are exactly two states — loaded and not — and
// the unloaded one is an error with its own code, never `undefined`. These tests hold that line
// at both ends: reading too early is refused, and asking for something that cannot be loaded is
// refused at the `load` call rather than at the read three lines later.

import { describe, expect, test } from 'bun:test';
import { createRuntime } from '../runtime.ts';
import { MiniDocument } from '../examples/minimal-model.ts';
import type { LoadOption } from '../load-options.ts';
import { openHost, spyHost } from './support/hosts.ts';
import { docx, p } from './support/docx.ts';

const FOUR = docx(`${p('one')}${p('two')}${p('three')}${p('four')}`);

describe('a property is only readable once a sync has filled it', () => {
  test('reading before any load names the property that was not loaded', async () => {
    const runtime = createRuntime({ host: openHost(), save: true });
    await runtime.run(async (context) => {
      const body = MiniDocument.open(context).body;
      expect(() => body.text).toThrowError(
        expect.objectContaining({ code: 'PropertyNotLoaded', target: 'document.body.text' })
      );
    });
    runtime.dispose();
  });

  test('reading after load but before sync is still not loaded', async () => {
    const runtime = createRuntime({ host: openHost(), save: true });
    await runtime.run(async (context) => {
      const body = MiniDocument.open(context).body;
      body.load('text');
      expect(() => body.text).toThrowError(expect.objectContaining({ code: 'PropertyNotLoaded' }));
      await context.sync();
      expect(body.text).toBe('alpha\nbeta');
    });
    runtime.dispose();
  });

  test('a collection item is not loaded by the load that produced the item', async () => {
    const runtime = createRuntime({ host: openHost(), save: true });
    await runtime.run(async (context) => {
      const paragraphs = MiniDocument.open(context).body.paragraphs;
      expect(() => paragraphs.items).toThrowError(
        expect.objectContaining({ code: 'PropertyNotLoaded' })
      );
      paragraphs.load();
      await context.sync();
      const first = paragraphs.items[0]!;
      expect(() => first.text).toThrowError(expect.objectContaining({ code: 'PropertyNotLoaded' }));
      first.load('text');
      await context.sync();
      expect(first.text).toBe('alpha');
    });
    runtime.dispose();
  });
});

describe('the shapes load accepts', () => {
  const shapes: readonly [string, LoadOption][] = [
    ['a name', 'text'],
    ['a comma-separated list', 'text'],
    ['an array', ['text']],
    ['a query object', { select: 'text' }],
    ['a query object with an array', { select: ['text'] }],
  ];

  for (const [what, option] of shapes) {
    test(`${what} selects the property`, async () => {
      const runtime = createRuntime({ host: openHost(), save: true });
      await runtime.run(async (context) => {
        const body = MiniDocument.open(context).body;
        body.load(option);
        await context.sync();
        expect(body.text).toBe('alpha\nbeta');
      });
      runtime.dispose();
    });
  }

  test('no argument at all loads what the object offers', async () => {
    const runtime = createRuntime({ host: openHost(), save: true });
    await runtime.run(async (context) => {
      const body = MiniDocument.open(context).body;
      body.load();
      await context.sync();
      expect(body.text).toBe('alpha\nbeta');
    });
    runtime.dispose();
  });

  test('the same name twice is one read, not two', async () => {
    const spy = spyHost(openHost());
    const runtime = createRuntime({ host: spy.host, save: true });
    await runtime.run(async (context) => {
      const body = MiniDocument.open(context).body;
      body.load('text,text');
      spy.reset();
      await context.sync();
      expect(spy.requests[0]?.operations).toHaveLength(1);
    });
    runtime.dispose();
  });

  test('top and skip select a window of a collection', async () => {
    const runtime = createRuntime({ host: openHost(FOUR), save: true });
    const texts = await runtime.run(async (context) => {
      const paragraphs = MiniDocument.open(context).body.paragraphs;
      paragraphs.load({ select: 'items', top: 2, skip: 1 });
      await context.sync();
      for (const item of paragraphs.items) item.load('text');
      await context.sync();
      return paragraphs.items.map((item) => item.text);
    });
    expect(texts).toEqual(['two', 'three']);
    runtime.dispose();
  });
});

describe('what load refuses, at the load call', () => {
  const refusals: readonly [string, unknown, string][] = [
    ['an unknown option key', { nope: 1 }, 'document.body.nope'],
    ['a fractional top', { top: 1.5 }, 'document.body.top'],
    ['a negative top', { top: -1 }, 'document.body.top'],
    ['a fractional skip', { skip: 0.5 }, 'document.body.skip'],
    ['an empty name', '', 'document.body'],
    ['a trailing comma', 'text,', 'document.body'],
    ['a non-string entry', ['text', 7], 'document.body'],
    ['a name that is not a property of this object', 'nope', 'document.body.nope'],
    ['a prototype key posing as a property', '__proto__', 'document.body'],
    ['a number where an option belongs', 42, 'document.body'],
    ['null where an option belongs', null, 'document.body'],
  ];

  for (const [what, option, target] of refusals) {
    test(`${what} is InvalidArgument naming ${target}`, async () => {
      const runtime = createRuntime({ host: openHost(), save: true });
      await runtime.run(async (context) => {
        const body = MiniDocument.open(context).body;
        expect(() => body.load(option as LoadOption)).toThrowError(
          expect.objectContaining({ code: 'InvalidArgument', target })
        );
      });
      runtime.dispose();
    });
  }

  test('a refused load queues nothing, so the next sync is not carrying it', async () => {
    const spy = spyHost(openHost());
    const runtime = createRuntime({ host: spy.host, save: true });
    await runtime.run(async (context) => {
      const body = MiniDocument.open(context).body;
      expect(() => body.load('nope')).toThrow();
      spy.reset();
      await context.sync();
      expect(spy.requests).toHaveLength(0);
    });
    runtime.dispose();
  });

  test('a load name is never used as an object key: Object.prototype is untouched', async () => {
    // The structural half of the prototype-pollution rule. Loaded values live in a `Map`, so even
    // a name that got past validation could not reach a prototype — this asserts the property
    // rather than the filter, because the filter is the part that can be relaxed by mistake.
    const runtime = createRuntime({ host: openHost(), save: true });
    await runtime.run(async (context) => {
      const body = MiniDocument.open(context).body;
      expect(() => body.load(['__proto__'] as unknown as LoadOption)).toThrow();
      expect(Object.prototype).not.toHaveProperty('polluted');
      expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
      body.load('text');
      await context.sync();
      expect(body.text).toBe('alpha\nbeta');
    });
    runtime.dispose();
  });
});
